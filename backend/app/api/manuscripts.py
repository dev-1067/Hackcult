from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api import get_or_404
from app.config import get_settings
from app.db import get_db
from app.models import ROLE_RANK, Job, Line, Manuscript, Page, Site, User
from app.ratelimit import limit
from app.schemas import ManuscriptIn, OcrIn
from app.security import current_user, require_role
from app.serializers import job_out, manuscript_out, page_out
from app.services import audit, jobs, search
from app.services.languages import LANGUAGES
from app.services.storage import StorageError, decode_upload, pdf_to_images, put_image, storage

router = APIRouter(prefix="/manuscripts", tags=["manuscripts"])

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/tiff", "image/webp", "image/bmp", "application/pdf"}


def manuscript_stats(db: Session, ids: list[str]) -> dict[str, dict]:
    if not ids:
        return {}
    stats: dict[str, dict] = {i: {"page_count": 0, "done_pages": 0, "line_count": 0} for i in ids}
    rows = db.execute(
        select(
            Page.manuscript_id,
            func.count(Page.id),
            func.count(Page.id).filter(Page.status == "done"),
            func.avg(Page.mean_confidence),
            func.min(Page.page_no),
        )
        .where(Page.manuscript_id.in_(ids))
        .group_by(Page.manuscript_id)
    ).all()
    for mid, n, done, conf, _ in rows:
        stats[mid].update(page_count=n, done_pages=done or 0, mean_confidence=round(conf, 4) if conf else None)
    for mid, n in db.execute(
        select(Page.manuscript_id, func.count(Line.id))
        .join(Line, Line.page_id == Page.id)
        .where(Page.manuscript_id.in_(ids))
        .group_by(Page.manuscript_id)
    ).all():
        stats[mid]["line_count"] = n
    covers = db.execute(
        select(Page.manuscript_id, Page.image_key, Page.normalized_key)
        .where(Page.manuscript_id.in_(ids))
        .order_by(Page.manuscript_id, Page.page_no)
    ).all()
    for mid, image_key, norm_key in covers:
        stats[mid].setdefault("cover_url", storage.url(norm_key or image_key))
    return stats


def _can_edit(user: User, ms: Manuscript) -> bool:
    return ms.uploaded_by == user.id or ROLE_RANK[user.role] >= ROLE_RANK["curator"]


@router.get("")
def list_manuscripts(
    q: str | None = None,
    script: str | None = None,
    language: str | None = None,
    site_id: str | None = None,
    limit_: int = Query(50, alias="limit", ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    stmt = select(Manuscript).options(selectinload(Manuscript.site))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Manuscript.title.ilike(like), Manuscript.repository.ilike(like), Manuscript.description.ilike(like)))
    if script:
        stmt = stmt.where(Manuscript.script == script)
    if language:
        stmt = stmt.where(Manuscript.language == language)
    if site_id:
        stmt = stmt.where(Manuscript.site_id == site_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    items = db.scalars(stmt.order_by(Manuscript.created_at.desc()).limit(limit_).offset(offset)).all()
    stats = manuscript_stats(db, [m.id for m in items])
    return {"total": total, "items": [manuscript_out(m, stats.get(m.id)) for m in items]}


@router.get("/mine")
def my_manuscripts(user: User = Depends(current_user), db: Session = Depends(get_db)):
    items = db.scalars(
        select(Manuscript).options(selectinload(Manuscript.site)).where(Manuscript.uploaded_by == user.id).order_by(Manuscript.created_at.desc())
    ).all()
    stats = manuscript_stats(db, [m.id for m in items])
    return {"total": len(items), "items": [manuscript_out(m, stats.get(m.id)) for m in items]}


@router.post("", status_code=201)
def create_manuscript(body: ManuscriptIn, user: User = Depends(require_role("contributor")), db: Session = Depends(get_db)):
    if body.site_id:
        get_or_404(db, Site, body.site_id, "Site")
    data = body.model_dump()
    data["script"] = data["script"] or LANGUAGES[body.language]["script"]
    ms = Manuscript(**data, uploaded_by=user.id)
    db.add(ms)
    db.flush()
    audit.record(db, user.id, "manuscript.created", "manuscript", ms.id, title=ms.title)
    db.commit()
    db.refresh(ms)
    return manuscript_out(ms)


@router.get("/{manuscript_id}")
def get_manuscript(manuscript_id: str, db: Session = Depends(get_db)):
    ms = get_or_404(db, Manuscript, manuscript_id, "Manuscript")
    pages = db.scalars(select(Page).where(Page.manuscript_id == ms.id).order_by(Page.page_no)).all()
    counts = dict(
        db.execute(
            select(Line.page_id, func.count(Line.id)).where(Line.page_id.in_([p.id for p in pages])).group_by(Line.page_id)
        ).all()
    )
    active = {
        j.page_id: j
        for j in db.scalars(
            select(Job).where(Job.page_id.in_([p.id for p in pages]), Job.status.in_(("queued", "running")))
        ).all()
    }
    stats = manuscript_stats(db, [ms.id]).get(ms.id)
    return {
        **manuscript_out(ms, stats),
        "pages": [page_out(p, counts.get(p.id, 0), active.get(p.id)) for p in pages],
    }


@router.patch("/{manuscript_id}")
def update_manuscript(
    manuscript_id: str, body: ManuscriptIn, user: User = Depends(require_role("contributor")), db: Session = Depends(get_db)
):
    ms = get_or_404(db, Manuscript, manuscript_id, "Manuscript")
    if not _can_edit(user, ms):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the uploader or a curator can edit this manuscript")
    if body.site_id:
        get_or_404(db, Site, body.site_id, "Site")
    data = body.model_dump()
    data["script"] = data["script"] or LANGUAGES[body.language]["script"]
    for k, v in data.items():
        setattr(ms, k, v)
    audit.record(db, user.id, "manuscript.updated", "manuscript", ms.id)
    db.commit()
    db.refresh(ms)
    return manuscript_out(ms, manuscript_stats(db, [ms.id]).get(ms.id))


@router.delete("/{manuscript_id}", status_code=204)
def delete_manuscript(manuscript_id: str, user: User = Depends(require_role("contributor")), db: Session = Depends(get_db)):
    ms = get_or_404(db, Manuscript, manuscript_id, "Manuscript")
    if not _can_edit(user, ms):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the uploader or a curator can delete this manuscript")
    for page in ms.pages:
        search.unindex_page(db, page.id)
    audit.record(db, user.id, "manuscript.deleted", "manuscript", ms.id, title=ms.title)
    db.delete(ms)
    db.commit()
    storage.delete_prefix(f"manuscripts/{manuscript_id}")


@router.post("/{manuscript_id}/pages", status_code=201, dependencies=[Depends(limit("upload", 30))])
async def upload_pages(
    manuscript_id: str,
    files: list[UploadFile] = File(...),
    auto_ocr: bool = Form(True),
    engine: str = Form("auto"),
    user: User = Depends(require_role("contributor")),
    db: Session = Depends(get_db),
):
    settings = get_settings()
    ms = get_or_404(db, Manuscript, manuscript_id, "Manuscript")
    if not _can_edit(user, ms):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the uploader or a curator can add pages")
    if len(files) > 50:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload at most 50 files at a time")

    images = []
    for f in files:
        data = await f.read()
        if len(data) > settings.max_upload_mb * 1024 * 1024:
            raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, f"{f.filename} is larger than {settings.max_upload_mb} MB")
        if not data:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{f.filename} is empty")
        try:
            if data[:5] == b"%PDF-":
                images.extend(pdf_to_images(data))
            else:
                images.append(decode_upload(data, settings.max_image_pixels))
        except StorageError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{f.filename}: {exc}") from exc

    next_no = (db.scalar(select(func.max(Page.page_no)).where(Page.manuscript_id == ms.id)) or 0) + 1
    created, queued = [], []
    for offset, img in enumerate(images):
        page = Page(manuscript_id=ms.id, page_no=next_no + offset, image_key="", width=img.shape[1], height=img.shape[0])
        db.add(page)
        db.flush()
        page.image_key = put_image(f"manuscripts/{ms.id}/{page.id}/original.jpg", img, quality=92)
        created.append(page)
        if auto_ocr:
            job, _ = jobs.enqueue(db, kind="ocr", page_id=page.id, engine=engine, user_id=user.id)
            queued.append(job)
    audit.record(db, user.id, "pages.uploaded", "manuscript", ms.id, count=len(created))
    db.commit()
    return {"pages": [page_out(p, 0) for p in created], "jobs": [job_out(j) for j in queued]}


@router.post("/{manuscript_id}/ocr", status_code=202, dependencies=[Depends(limit("ocr", 30))])
def ocr_all(
    manuscript_id: str,
    body: OcrIn,
    only_pending: bool = True,
    user: User = Depends(require_role("contributor")),
    db: Session = Depends(get_db),
):
    ms = get_or_404(db, Manuscript, manuscript_id, "Manuscript")
    pages = [p for p in ms.pages if not only_pending or p.status in ("pending", "failed")]
    out = []
    for p in pages:
        job, _ = jobs.enqueue(db, kind="ocr", page_id=p.id, engine=body.engine, user_id=user.id)
        out.append(job)
    db.commit()
    return {"queued": len(out), "jobs": [job_out(j) for j in out]}
