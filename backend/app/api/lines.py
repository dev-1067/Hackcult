from functools import lru_cache

import cv2
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api import get_or_404
from app.db import get_db
from app.models import ROLE_RANK, Correction, Line, Manuscript, Page, User, utcnow
from app.ratelimit import limit
from app.schemas import CorrectionIn, TranslateIn
from app.security import current_user, require_role
from app.serializers import iso, line_out
from app.services import audit, search
from app.services.languages import TARGETS, transliterate
from app.services.storage import load_image, storage
from app.services.translate import TranslationUnavailable, translate_line

router = APIRouter(prefix="/lines", tags=["lines"])


@lru_cache(maxsize=16)
def _cached_image(key: str, version: float):
    return load_image(key)


def _page_image(key: str):
    # Re-running OCR rewrites the file under the same key, so the cache is keyed by modification time.
    return _cached_image(key, storage.version(key))


@router.get("/{line_id}/image")
def line_image(line_id: str, db: Session = Depends(get_db)):
    line = get_or_404(db, Line, line_id, "Line")
    page = db.get(Page, line.page_id)
    if not page.normalized_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Page has not been processed yet")
    img = _page_image(page.normalized_key)
    crop = img[line.y : line.y + line.h, line.x : line.x + line.w]
    ok, buf = cv2.imencode(".png", crop)
    if not ok:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Could not encode image")
    return Response(buf.tobytes(), media_type="image/png", headers={"Cache-Control": "public, max-age=300"})


@router.get("/{line_id}/transliterate")
def line_transliterate(line_id: str, to: str = Query("iast"), db: Session = Depends(get_db)):
    if to not in TARGETS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown target. Use one of: {', '.join(TARGETS)}")
    line = get_or_404(db, Line, line_id, "Line")
    return {"line_id": line.id, "to": to, "text": transliterate(line.text, to)}


@router.post("/{line_id}/translate", dependencies=[Depends(limit("translate", 30))])
def line_translate(line_id: str, body: TranslateIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    line = get_or_404(db, Line, line_id, "Line")
    ms = db.scalar(select(Manuscript).join(Page).where(Page.id == line.page_id))
    if not line.text.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This line has no text to translate")
    try:
        t = translate_line(db, line, ms.language, body.target)
    except TranslationUnavailable as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return {"line_id": line.id, "target": t.target_lang, "text": t.text, "provider": t.provider, "cached_at": iso(t.created_at)}


def _correction_out(c: Correction, line: Line | None = None) -> dict:
    line = line or c.line
    return {
        "id": c.id,
        "line_id": c.line_id,
        "page_id": line.page_id if line else None,
        "line_no": line.line_no if line else None,
        "current_text": line.text if line else "",
        "previous_text": c.previous_text,
        "text": c.text,
        "status": c.status,
        "user_id": c.user_id,
        "user_name": c.user.name if c.user else "Deleted user",
        "review_note": c.review_note,
        "created_at": iso(c.created_at),
        "reviewed_at": iso(c.reviewed_at),
    }


def apply_correction(db: Session, c: Correction, reviewer: User, text: str | None = None) -> None:
    line = db.get(Line, c.line_id)
    if text:
        c.text = text.strip()
    c.status, c.reviewer_id, c.reviewed_at = "approved", reviewer.id, utcnow()
    line.text, line.verified = c.text, True
    search.index_lines(db, [line])
    # Other pending suggestions for this line are now based on stale text.
    for other in db.scalars(select(Correction).where(Correction.line_id == line.id, Correction.status == "pending", Correction.id != c.id)):
        other.status, other.review_note, other.reviewer_id, other.reviewed_at = "rejected", "Superseded by an approved correction", reviewer.id, utcnow()


@router.post("/{line_id}/corrections", status_code=201, dependencies=[Depends(limit("corrections", 60))])
def suggest_correction(
    line_id: str, body: CorrectionIn, user: User = Depends(require_role("contributor")), db: Session = Depends(get_db)
):
    line = get_or_404(db, Line, line_id, "Line")
    text = " ".join(body.text.split())
    if text == line.text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The correction is identical to the current text")
    c = Correction(line_id=line.id, user_id=user.id, previous_text=line.text, text=text)
    db.add(c)
    db.flush()
    auto = ROLE_RANK[user.role] >= ROLE_RANK["curator"]
    if auto:  # curators' own edits are applied immediately but still recorded
        apply_correction(db, c, user)
        c.review_note = "Applied directly by a curator"
    audit.record(db, user.id, "correction.applied" if auto else "correction.suggested", "line", line.id, correction_id=c.id)
    db.commit()
    db.refresh(c)
    return {"auto_approved": auto, "correction": _correction_out(c, line), "line": line_out(line)}


@router.get("/{line_id}/corrections")
def line_corrections(line_id: str, db: Session = Depends(get_db)):
    line = get_or_404(db, Line, line_id, "Line")
    items = db.scalars(select(Correction).where(Correction.line_id == line.id).order_by(Correction.created_at.desc())).all()
    return {"items": [_correction_out(c, line) for c in items]}
