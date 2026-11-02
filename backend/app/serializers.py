"""Shape ORM objects into JSON for the API."""

from datetime import datetime

from app.models import Job, Line, Manuscript, Page, Site, Trail, User
from app.services.languages import LANGUAGES
from app.services.storage import storage


def iso(dt: datetime | None) -> str | None:
    return dt.isoformat(timespec="seconds") + "Z" if dt else None


def user_out(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "is_active": u.is_active,
        "created_at": iso(u.created_at),
    }


def site_out(s: Site, manuscript_count: int | None = None, distance_km: float | None = None) -> dict:
    out = {
        "id": s.id,
        "name": s.name,
        "kind": s.kind,
        "description": s.description,
        "lat": s.lat,
        "lng": s.lng,
        "city": s.city,
        "state": s.state,
        "era": s.era,
        "visit_minutes": s.visit_minutes,
        "source_url": s.source_url,
    }
    if manuscript_count is not None:
        out["manuscript_count"] = manuscript_count
    if distance_km is not None:
        out["distance_km"] = round(distance_km, 2)
    return out


def job_out(j: Job | None) -> dict | None:
    if j is None:
        return None
    return {
        "id": j.id,
        "kind": j.kind,
        "page_id": j.page_id,
        "status": j.status,
        "stage": j.stage,
        "progress": j.progress,
        "attempts": j.attempts,
        "max_attempts": j.max_attempts,
        "engine_requested": j.engine_requested,
        "engine_used": j.engine_used,
        "error": j.error,
        "created_at": iso(j.created_at),
        "started_at": iso(j.started_at),
        "finished_at": iso(j.finished_at),
        "duration_ms": j.duration_ms,
        "result": j.result or {},
    }


def page_out(p: Page, line_count: int | None = None, job: Job | None = None) -> dict:
    return {
        "id": p.id,
        "manuscript_id": p.manuscript_id,
        "page_no": p.page_no,
        "status": p.status,
        "image_url": storage.url(p.image_key),
        "normalized_url": storage.url(p.normalized_key),
        "binary_url": storage.url(p.binary_key),
        "width": p.width,
        "height": p.height,
        "norm_width": p.norm_width,
        "norm_height": p.norm_height,
        "engine": p.engine,
        "mean_confidence": p.mean_confidence,
        "skew_angle": p.skew_angle,
        "line_count": line_count if line_count is not None else len(p.lines),
        "job": job_out(job),
        "created_at": iso(p.created_at),
    }


def manuscript_out(m: Manuscript, stats: dict | None = None) -> dict:
    stats = stats or {}
    return {
        "id": m.id,
        "title": m.title,
        "script": m.script,
        "language": m.language,
        "language_label": LANGUAGES.get(m.language, {}).get("label", m.language),
        "century": m.century,
        "material": m.material,
        "repository": m.repository,
        "site_id": m.site_id,
        "site_name": m.site.name if m.site else None,
        "description": m.description,
        "license": m.license,
        "source_url": m.source_url,
        "uploaded_by": m.uploaded_by,
        "created_at": iso(m.created_at),
        "page_count": stats.get("page_count", 0),
        "done_pages": stats.get("done_pages", 0),
        "line_count": stats.get("line_count", 0),
        "mean_confidence": stats.get("mean_confidence"),
        "cover_url": stats.get("cover_url"),
    }


def line_out(ln: Line, pending: int = 0) -> dict:
    return {
        "id": ln.id,
        "page_id": ln.page_id,
        "line_no": ln.line_no,
        "x": ln.x,
        "y": ln.y,
        "w": ln.w,
        "h": ln.h,
        "text": ln.text,
        "ocr_text": ln.ocr_text,
        "confidence": ln.confidence,
        "engine": ln.engine,
        "verified": ln.verified,
        "pending_corrections": pending,
    }


def trail_out(t: Trail, sites: dict[str, Site]) -> dict:
    return {
        "id": t.id,
        "name": t.name,
        "mode": t.mode,
        "start": {"lat": t.start_lat, "lng": t.start_lng},
        "total_km": t.total_km,
        "total_minutes": t.total_minutes,
        "routing": t.routing,
        "geometry": t.geometry,
        "legs": t.legs,
        "stops": [site_out(sites[sid]) for sid in t.stops if sid in sites],
        "is_public": t.is_public,
        "user_id": t.user_id,
        "created_at": iso(t.created_at),
    }
