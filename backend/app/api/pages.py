from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api import get_or_404
from app.api.manuscripts import _can_edit
from app.db import get_db
from app.models import Correction, Job, Line, Manuscript, Page, User
from app.ocr.chain import NoEngineAvailable, candidates
from app.ratelimit import limit
from app.schemas import OcrIn
from app.security import require_role
from app.serializers import job_out, line_out, manuscript_out, page_out
from app.services import audit, jobs, search
from app.services.languages import TARGETS, transliterate
from app.services.storage import storage

router = APIRouter(prefix="/pages", tags=["pages"])


@router.get("/{page_id}")
def get_page(page_id: str, db: Session = Depends(get_db)):
    page = get_or_404(db, Page, page_id, "Page")
    ms = db.get(Manuscript, page.manuscript_id)
    lines = db.scalars(select(Line).where(Line.page_id == page.id).order_by(Line.line_no)).all()
    pending = dict(
        db.execute(
            select(Correction.line_id, func.count(Correction.id))
            .where(Correction.line_id.in_([ln.id for ln in lines]), Correction.status == "pending")
            .group_by(Correction.line_id)
        ).all()
    )
    job = db.scalar(select(Job).where(Job.page_id == page.id).order_by(Job.created_at.desc()).limit(1))
    siblings = db.execute(
        select(Page.id, Page.page_no).where(Page.manuscript_id == ms.id).order_by(Page.page_no)
    ).all()
    ids = [s[0] for s in siblings]
    idx = ids.index(page.id)
    return {
        **page_out(page, len(lines), job),
        "manuscript": manuscript_out(ms),
        "lines": [line_out(ln, pending.get(ln.id, 0)) for ln in lines],
        "prev_page_id": ids[idx - 1] if idx > 0 else None,
        "next_page_id": ids[idx + 1] if idx < len(ids) - 1 else None,
        "page_total": len(ids),
    }


@router.get("/{page_id}/transliterate")
def transliterate_page(page_id: str, to: str = Query("iast"), db: Session = Depends(get_db)):
    """All lines of a page in another script, in one request."""
    if to not in TARGETS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown target. Use one of: {', '.join(TARGETS)}")
    page = get_or_404(db, Page, page_id, "Page")
    lines = db.scalars(select(Line).where(Line.page_id == page.id)).all()
    return {"to": to, "lines": {ln.id: transliterate(ln.text, to) for ln in lines}}


@router.post("/{page_id}/ocr", status_code=202, dependencies=[Depends(limit("ocr", 30))])
def run_ocr(
    page_id: str,
    body: OcrIn,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key", max_length=100),
    user: User = Depends(require_role("contributor")),
    db: Session = Depends(get_db),
):
    page = get_or_404(db, Page, page_id, "Page")
    ms = db.get(Manuscript, page.manuscript_id)
    try:
        candidates(ms.script, body.engine)  # fail fast with a clear message instead of a failed job
    except NoEngineAvailable as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    job, created = jobs.enqueue(
        db, kind="ocr", page_id=page.id, engine=body.engine, idempotency_key=idempotency_key, user_id=user.id
    )
    if created:
        audit.record(db, user.id, "ocr.requested", "page", page.id, engine=body.engine)
    db.commit()
    return {"created": created, "job": job_out(job)}


@router.delete("/{page_id}", status_code=204)
def delete_page(page_id: str, user: User = Depends(require_role("contributor")), db: Session = Depends(get_db)):
    page = get_or_404(db, Page, page_id, "Page")
    ms = db.get(Manuscript, page.manuscript_id)
    if not _can_edit(user, ms):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the uploader or a curator can delete pages")
    search.unindex_page(db, page.id)
    audit.record(db, user.id, "page.deleted", "page", page.id, manuscript_id=ms.id, page_no=page.page_no)
    db.delete(page)
    db.commit()
    storage.delete_prefix(f"manuscripts/{ms.id}/{page_id}")
