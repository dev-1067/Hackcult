"""What a worker actually does for each job kind."""

import logging
import time

import cv2
import numpy as np
from sqlalchemy import delete

from app.config import get_settings
from app.db import SessionLocal
from app.models import Job, Line, Manuscript, Page
from app.ocr.chain import NoEngineAvailable
from app.ocr.metrics import cer, wer
from app.ocr.pipeline import run_page_ocr
from app.services import audit, jobs, search
from app.services.storage import load_image, put_image, storage
from app.services.synthetic import make_page

log = logging.getLogger(__name__)


class PermanentError(RuntimeError):
    """Retrying will not help (bad input, no engine for the script)."""


def run_job(job_id: str) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        kind = job.kind
    try:
        if kind == "ocr":
            engine_used, result = _ocr(job_id)
        elif kind == "benchmark":
            engine_used, result = _benchmark(job_id)
        else:
            raise PermanentError(f"unknown job kind {kind}")
        jobs.finish(job_id, engine_used, result)
    except (PermanentError, NoEngineAvailable) as exc:
        log.warning("job %s failed permanently: %s", job_id, exc)
        jobs.fail(job_id, str(exc), retryable=False)
    except Exception as exc:
        log.exception("job %s crashed", job_id)
        jobs.fail(job_id, f"{type(exc).__name__}: {exc}", retryable=True)


def _ocr(job_id: str) -> tuple[str, dict]:
    settings = get_settings()
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        page = db.get(Page, job.page_id) if job.page_id else None
        if not page:
            raise PermanentError("page no longer exists")
        ms = db.get(Manuscript, page.manuscript_id)
        script, engine, image_key = ms.script, job.engine_requested, page.image_key
        page.status = "processing"
        db.commit()

    jobs.report(job_id, 5, "Loading image")
    image = load_image(image_key)
    result = run_page_ocr(
        image, script, engine, max_side=settings.processing_max_side, progress=lambda p, s: jobs.report(job_id, p, s)
    )

    base = image_key.rsplit("/", 1)[0]
    normalized_key = put_image(f"{base}/normalized.jpg", result.pre.color)
    binary_key = put_image(f"{base}/binary.png", 255 - result.pre.binary)

    with SessionLocal() as db:
        page = db.get(Page, job.page_id)
        if not page:
            raise PermanentError("page was deleted while processing")
        search.unindex_page(db, page.id)
        db.execute(delete(Line).where(Line.page_id == page.id))
        new_lines = [
            Line(
                page_id=page.id,
                line_no=i + 1,
                x=ln.box.x,
                y=ln.box.y,
                w=ln.box.w,
                h=ln.box.h,
                text=ln.text,
                ocr_text=ln.text,
                confidence=ln.confidence,
                engine=result.engine,
            )
            for i, ln in enumerate(result.lines)
        ]
        db.add_all(new_lines)
        db.flush()
        search.index_lines(db, new_lines)
        h, w = result.pre.color.shape[:2]
        page.normalized_key, page.binary_key = normalized_key, binary_key
        page.norm_width, page.norm_height = w, h
        page.status, page.engine = "done", result.engine
        page.mean_confidence = result.mean_confidence
        page.skew_angle = result.pre.skew_angle
        audit.record(db, job.created_by, "ocr.completed", "page", page.id, lines=len(new_lines), engine=result.engine)
        db.commit()
    return result.engine, {
        "lines": len(result.lines),
        "mean_confidence": result.mean_confidence,
        "skew_angle": result.pre.skew_angle,
        "timings_ms": result.timings_ms,
    }


VARIANTS = {
    "stock": "Off-the-shelf PP-OCR (own detector)",
    "raw": "Our segmentation, no clean-up",
    "full": "LipiSetu full pipeline",
}


def _benchmark(job_id: str) -> tuple[str, dict]:
    from app.ocr.engines import get_engine

    with SessionLocal() as db:
        job = db.get(Job, job_id)
        opts = dict(job.options or {})
    script = opts.get("script", "devanagari")
    pages = int(opts.get("pages", 6))
    difficulty = float(opts.get("difficulty", 1.0))
    rapid = get_engine("ppocr")
    if not rapid or not rapid.supports(script):
        raise PermanentError(f"The benchmark needs the PP-OCR engine for {script}")

    totals = {k: {"cer": 0.0, "wer": 0.0, "ms": 0} for k in VARIANTS}
    per_page = []
    samples = []
    for i in range(pages):
        jobs.report(job_id, 5 + int(90 * i / pages), f"Page {i + 1} of {pages}")
        page = make_page(script, seed=1000 + i, difficulty=difficulty)
        truth = " ".join(page.lines)
        row = {"seed": 1000 + i, "lines": len(page.lines), "skew": page.skew, "font": page.font}

        t = time.perf_counter()
        stock = rapid.read_page_stock(page.image, script)
        ms = int((time.perf_counter() - t) * 1000)
        row["stock"] = {"cer": round(cer(stock, truth), 4), "wer": round(wer(stock, truth), 4), "ms": ms}

        for variant, use_pre in (("raw", False), ("full", True)):
            t = time.perf_counter()
            res = run_page_ocr(page.image, script, "ppocr", use_preprocessing=use_pre)
            ms = int((time.perf_counter() - t) * 1000)
            text = " ".join(ln.text for ln in res.lines)
            row[variant] = {
                "cer": round(cer(text, truth), 4),
                "wer": round(wer(text, truth), 4),
                "ms": ms,
                "lines_found": len(res.lines),
            }
            if variant == "full" and i < 3:
                prefix = f"lab/{job_id}/p{i}"
                samples.append(
                    {
                        "original": storage.url(put_image(f"{prefix}-original.jpg", page.image)),
                        "normalized": storage.url(put_image(f"{prefix}-normalized.jpg", _draw_boxes(res))),
                        "binary": storage.url(put_image(f"{prefix}-binary.png", 255 - res.pre.binary)),
                        "truth": page.lines,
                        "predicted": [ln.text for ln in res.lines],
                        "skew_true": page.skew,
                        "skew_estimated": res.pre.skew_angle,
                    }
                )
        for k in VARIANTS:
            for m in ("cer", "wer", "ms"):
                totals[k][m] += row[k][m]
        per_page.append(row)

    summary = {
        k: {
            "label": VARIANTS[k],
            "cer": round(totals[k]["cer"] / pages, 4),
            "wer": round(totals[k]["wer"] / pages, 4),
            "ms": round(totals[k]["ms"] / pages),
        }
        for k in VARIANTS
    }
    jobs.report(job_id, 96, "Measuring real manuscripts")
    return "ppocr", {
        "script": script,
        "pages": pages,
        "difficulty": difficulty,
        "summary": summary,
        "per_page": per_page,
        "samples": samples,
        "real_coverage": _real_coverage(rapid, script),
    }


def _real_coverage(rapid, script: str, limit: int = 8) -> list[dict]:
    """Real handwritten folios have no ground truth, so we compare how much text each approach finds:
    the stock detector on the original photo vs the lines LipiSetu read (stored in the database)."""
    from sqlalchemy import func, select

    with SessionLocal() as db:
        rows = db.execute(
            select(Page, Manuscript)
            .join(Manuscript)
            .where(Manuscript.script == script, Manuscript.material != "print", Page.status == "done")
            .order_by(Manuscript.title, Page.page_no)
            .limit(limit)
        ).all()
        counts = dict(
            db.execute(
                select(Line.page_id, func.sum(func.length(func.replace(Line.text, " ", "")))).where(Line.page_id.in_([p.id for p, _ in rows])).group_by(Line.page_id)
            ).all()
        )
        line_counts = dict(
            db.execute(select(Line.page_id, func.count(Line.id)).where(Line.page_id.in_([p.id for p, _ in rows])).group_by(Line.page_id)).all()
        )
    out = []
    for page, ms in rows:
        try:
            stock_text = rapid.read_page_stock(load_image(page.image_key), script)
        except Exception:  # a single unreadable image should not fail the whole run
            continue
        out.append(
            {
                "manuscript": ms.title,
                "page_id": page.id,
                "page_no": page.page_no,
                "stock_chars": len(stock_text.replace(" ", "")),
                "ours_chars": int(counts.get(page.id) or 0),
                "our_lines": int(line_counts.get(page.id) or 0),
            }
        )
    return out


def _draw_boxes(res) -> np.ndarray:
    vis = res.pre.color.copy()
    for ln in res.lines:
        b = ln.box
        color = (60, 160, 60) if ln.confidence >= 0.85 else (40, 160, 230) if ln.confidence >= 0.6 else (60, 60, 220)
        cv2.rectangle(vis, (b.x, b.y), (b.x + b.w, b.y + b.h), color, 2)
    return vis
