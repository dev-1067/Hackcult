"""Jobs, OCR Lab, dataset export, statistics, administration and health."""

import csv
import io
import json
import time

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app import __version__
from app.api import get_or_404
from app.config import get_settings
from app.db import get_db
from app.models import AuditLog, Correction, Job, Line, Manuscript, Page, Site, Trail, User
from app.ocr.engines import SCRIPTS, list_engines
from app.ratelimit import limit
from app.schemas import BenchmarkIn, RoleIn
from app.security import current_user, require_role
from app.serializers import iso, job_out, user_out
from app.services import audit, jobs
from app.services.handlers import VARIANTS
from app.services.languages import LANGUAGES
from app.services.storage import storage
from app.services.translate import provider_status

router = APIRouter(tags=["operations"])


# ---------------------------------------------------------------- meta / health


@router.get("/meta")
def meta():
    return {
        "app": "LipiSetu",
        "version": __version__,
        "languages": [{"code": k, **v} for k, v in LANGUAGES.items()],
        "scripts": [{"id": k, "label": v} for k, v in SCRIPTS.items()],
        "engines": [e.describe() for e in list_engines()],
        "translation": provider_status(),
        "transliteration_targets": ["iast", "devanagari", "gujarati", "itrans"],
    }


@router.get("/health")
def health():
    return {"status": "ok", "version": __version__}


@router.get("/ready")
def ready(db: Session = Depends(get_db)):
    from app.worker import heartbeat

    checks = {}
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # pragma: no cover
        checks["database"] = f"error: {exc}"
    try:
        storage.put(".ready", b"ok")
        checks["storage"] = "ok"
    except Exception as exc:  # pragma: no cover
        checks["storage"] = f"error: {exc}"
    engines = [e.name for e in list_engines() if e.available()]
    checks["ocr_engines"] = "ok" if engines else "error: no engine available"
    hb = heartbeat()
    age = time.time() - hb["at"] if hb["at"] else None
    if get_settings().embedded_worker:
        checks["worker"] = "ok" if age is not None and age < 30 else "error: no recent heartbeat"
    else:
        checks["worker"] = "external"
    ok = all(v in ("ok", "external") for v in checks.values())
    body = {"status": "ok" if ok else "degraded", "checks": checks, "engines": engines}
    if not ok:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, body)
    return body


# ---------------------------------------------------------------- jobs


@router.get("/jobs")
def list_jobs(
    status_: str | None = Query(None, alias="status"),
    kind: str | None = None,
    limit_: int = Query(50, alias="limit", ge=1, le=200),
    user: User = Depends(require_role("contributor")),
    db: Session = Depends(get_db),
):
    stmt = select(Job)
    if status_:
        stmt = stmt.where(Job.status == status_)
    if kind:
        stmt = stmt.where(Job.kind == kind)
    items = db.scalars(stmt.order_by(Job.created_at.desc()).limit(limit_)).all()
    pages = {
        p.id: (p, m)
        for p, m in db.execute(
            select(Page, Manuscript).join(Manuscript).where(Page.id.in_([j.page_id for j in items if j.page_id]))
        ).all()
    }
    counts = dict(db.execute(select(Job.status, func.count(Job.id)).group_by(Job.status)).all())
    out = []
    for j in items:
        d = job_out(j)
        d.pop("result", None)
        if j.page_id in pages:
            p, m = pages[j.page_id]
            d.update(page_no=p.page_no, manuscript_id=m.id, manuscript_title=m.title)
        out.append(d)
    return {"counts": counts, "items": out}


@router.get("/jobs/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
    return job_out(get_or_404(db, Job, job_id, "Job"))


@router.post("/jobs/{job_id}/retry", status_code=202)
def retry_job(job_id: str, user: User = Depends(require_role("contributor")), db: Session = Depends(get_db)):
    job = get_or_404(db, Job, job_id, "Job")
    if job.status not in ("failed", "done"):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Job is {job.status}; only finished jobs can be retried")
    jobs.retry(db, job)
    audit.record(db, user.id, "job.retried", "job", job.id)
    db.commit()
    return job_out(job)


# ---------------------------------------------------------------- OCR Lab


@router.get("/lab/benchmarks")
def benchmarks(db: Session = Depends(get_db)):
    items = db.scalars(select(Job).where(Job.kind == "benchmark").order_by(Job.created_at.desc()).limit(20)).all()
    latest = next((j for j in items if j.status == "done"), None)
    return {
        "variants": VARIANTS,
        "latest": job_out(latest),
        "running": job_out(next((j for j in items if j.status in ("queued", "running")), None)),
        "history": [
            {
                "id": j.id,
                "status": j.status,
                "created_at": iso(j.created_at),
                "duration_ms": j.duration_ms,
                "summary": (j.result or {}).get("summary"),
                "pages": (j.result or {}).get("pages"),
                "difficulty": (j.result or {}).get("difficulty"),
            }
            for j in items
        ],
    }


@router.post("/lab/benchmarks", status_code=202, dependencies=[Depends(limit("benchmark", 6))])
def run_benchmark(body: BenchmarkIn, user: User = Depends(require_role("contributor")), db: Session = Depends(get_db)):
    running = db.scalar(select(Job).where(Job.kind == "benchmark", Job.status.in_(("queued", "running"))))
    if running:
        return job_out(running)
    job, _ = jobs.enqueue(db, kind="benchmark", options=body.model_dump(), user_id=user.id)
    audit.record(db, user.id, "benchmark.requested", "job", job.id, **body.model_dump())
    db.commit()
    return job_out(job)


# ---------------------------------------------------------------- dataset export


def _training_rows(db: Session, include: str, min_conf: float):
    stmt = (
        select(Line, Page, Manuscript)
        .join(Page, Line.page_id == Page.id)
        .join(Manuscript, Page.manuscript_id == Manuscript.id)
        .where(Line.text != "")
    )
    if include == "verified":
        stmt = stmt.where(Line.verified.is_(True))
    else:
        stmt = stmt.where((Line.verified.is_(True)) | (Line.confidence >= min_conf))
    for line, page, ms in db.execute(stmt.order_by(Manuscript.title, Page.page_no, Line.line_no)):
        yield {
            "id": line.id,
            "image_url": f"/api/v1/lines/{line.id}/image",
            "text": line.text,
            "source": "human-verified" if line.verified else "ocr-high-confidence",
            "ocr_confidence": line.confidence,
            "script": ms.script,
            "language": ms.language,
            "manuscript": ms.title,
            "page_no": page.page_no,
            "line_no": line.line_no,
            "license": ms.license,
        }


@router.get("/export/summary")
def export_summary(min_conf: float = Query(0.9, ge=0, le=1), db: Session = Depends(get_db)):
    verified = db.scalar(select(func.count(Line.id)).where(Line.verified.is_(True))) or 0
    high = db.scalar(select(func.count(Line.id)).where(Line.verified.is_(False), Line.confidence >= min_conf, Line.text != "")) or 0
    by_script = dict(
        db.execute(
            select(Manuscript.script, func.count(Line.id))
            .join(Page, Page.manuscript_id == Manuscript.id)
            .join(Line, Line.page_id == Page.id)
            .where((Line.verified.is_(True)) | (Line.confidence >= min_conf))
            .group_by(Manuscript.script)
        ).all()
    )
    return {"verified": verified, "high_confidence": high, "by_script": by_script, "min_conf": min_conf}


@router.get("/export/training-data")
def export_training(
    fmt: str = Query("jsonl", alias="format", pattern="^(jsonl|csv)$"),
    include: str = Query("verified", pattern="^(verified|verified_and_confident)$"),
    min_conf: float = Query(0.9, ge=0, le=1),
    user: User = Depends(require_role("curator")),
    db: Session = Depends(get_db),
):
    rows = list(_training_rows(db, include, min_conf))
    audit.record(db, user.id, "dataset.exported", "dataset", "", rows=len(rows), format=fmt, include=include)
    db.commit()
    if fmt == "jsonl":
        body = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
        media, name = "application/x-ndjson", "lipisetu-training.jsonl"
    else:
        buf = io.StringIO()
        fields = ["id", "image_url", "text", "source", "ocr_confidence", "script", "language", "manuscript", "page_no", "line_no", "license"]
        writer = csv.DictWriter(buf, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
        body = "﻿" + buf.getvalue()  # BOM so Excel opens Indic text correctly
        media, name = "text/csv; charset=utf-8", "lipisetu-training.csv"
    return StreamingResponse(
        iter([body.encode("utf-8")]), media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'}
    )


# ---------------------------------------------------------------- statistics


@router.get("/stats/overview")
def overview(db: Session = Depends(get_db)):
    lines_total = db.scalar(select(func.count(Line.id))) or 0
    verified = db.scalar(select(func.count(Line.id)).where(Line.verified.is_(True))) or 0
    conf = db.scalar(select(func.avg(Line.confidence)).where(Line.text != ""))
    buckets = {
        "high": db.scalar(select(func.count(Line.id)).where(Line.confidence >= 0.85)) or 0,
        "medium": db.scalar(select(func.count(Line.id)).where(Line.confidence >= 0.6, Line.confidence < 0.85)) or 0,
        "low": db.scalar(select(func.count(Line.id)).where(Line.confidence < 0.6)) or 0,
    }
    by_script = dict(db.execute(select(Manuscript.script, func.count(Manuscript.id)).group_by(Manuscript.script)).all())
    by_lang = dict(db.execute(select(Manuscript.language, func.count(Manuscript.id)).group_by(Manuscript.language)).all())
    pages_by_status = dict(db.execute(select(Page.status, func.count(Page.id)).group_by(Page.status)).all())
    recent_jobs = db.scalars(select(Job).order_by(Job.created_at.desc()).limit(6)).all()
    activity = db.execute(
        select(AuditLog, User.name).outerjoin(User, User.id == AuditLog.user_id).order_by(AuditLog.id.desc()).limit(10)
    ).all()
    done_durations = [j.duration_ms for j in db.scalars(select(Job).where(Job.kind == "ocr", Job.status == "done").order_by(Job.finished_at.desc()).limit(50)) if j.duration_ms]
    return {
        "manuscripts": db.scalar(select(func.count(Manuscript.id))) or 0,
        "pages": db.scalar(select(func.count(Page.id))) or 0,
        "lines": lines_total,
        "verified_lines": verified,
        "mean_confidence": round(conf, 4) if conf else None,
        "confidence_buckets": buckets,
        "pending_corrections": db.scalar(select(func.count(Correction.id)).where(Correction.status == "pending")) or 0,
        "sites": db.scalar(select(func.count(Site.id))) or 0,
        "trails": db.scalar(select(func.count(Trail.id))) or 0,
        "contributors": db.scalar(select(func.count(func.distinct(Correction.user_id)))) or 0,
        "by_script": by_script,
        "by_language": by_lang,
        "pages_by_status": pages_by_status,
        "avg_ocr_ms": round(sum(done_durations) / len(done_durations)) if done_durations else None,
        "recent_jobs": [job_out(j) | {"result": None} for j in recent_jobs],
        "activity": [
            {"id": a.id, "ts": iso(a.ts), "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "user": name or "System", "detail": a.detail}
            for a, name in activity
        ],
    }


# ---------------------------------------------------------------- administration


@router.get("/admin/users")
def users(user: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    items = db.scalars(select(User).order_by(User.created_at)).all()
    return {"items": [user_out(u) for u in items]}


@router.patch("/admin/users/{user_id}")
def set_role(user_id: str, body: RoleIn, admin: User = Depends(require_role("admin")), db: Session = Depends(get_db)):
    target = get_or_404(db, User, user_id, "User")
    if target.id == admin.id and (body.role != "admin" or not body.is_active):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own admin access")
    target.role, target.is_active = body.role, body.is_active
    audit.record(db, admin.id, "user.role_changed", "user", target.id, role=body.role, active=body.is_active)
    db.commit()
    return user_out(target)


@router.get("/audit")
def audit_log(
    limit_: int = Query(100, alias="limit", ge=1, le=500),
    user: User = Depends(require_role("curator")),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(AuditLog, User.name).outerjoin(User, User.id == AuditLog.user_id).order_by(AuditLog.id.desc()).limit(limit_)
    ).all()
    return {
        "items": [
            {"id": a.id, "ts": iso(a.ts), "action": a.action, "entity": a.entity, "entity_id": a.entity_id, "user": name or "System", "detail": a.detail}
            for a, name in rows
        ]
    }
