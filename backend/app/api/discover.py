"""Search, heritage sites and trails."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api import get_or_404
from app.db import get_db
from app.models import Manuscript, Site, Trail, User
from app.ratelimit import limit
from app.schemas import SiteIn, TrailIn
from app.security import current_user, optional_user, require_role
from app.serializers import manuscript_out, site_out, trail_out
from app.services import audit
from app.services import search as search_service
from app.services.geo import Point, bounding_box, haversine_km, plan_order, route

router = APIRouter(tags=["discover"])


@router.get("/search", dependencies=[Depends(limit("search", 120))])
def search(
    q: str = Query(min_length=1, max_length=200),
    script: str | None = None,
    language: str | None = None,
    manuscript_id: str | None = None,
    site_id: str | None = None,
    verified_only: bool = False,
    limit_: int = Query(30, alias="limit", ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    if len(q.strip()) < 2:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Type at least 2 characters")
    return search_service.search(
        db,
        q.strip(),
        script=script,
        language=language,
        manuscript_id=manuscript_id,
        site_id=site_id,
        verified_only=verified_only,
        limit=limit_,
        offset=offset,
    )


def _ms_counts(db: Session) -> dict[str, int]:
    return dict(db.execute(select(Manuscript.site_id, func.count(Manuscript.id)).group_by(Manuscript.site_id)).all())


@router.get("/sites")
def list_sites(
    bbox: str | None = Query(None, description="minLng,minLat,maxLng,maxLat"),
    kind: str | None = None,
    q: str | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Site)
    if bbox:
        try:
            min_lng, min_lat, max_lng, max_lat = (float(v) for v in bbox.split(","))
        except ValueError as exc:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "bbox must be minLng,minLat,maxLng,maxLat") from exc
        stmt = stmt.where(Site.lat.between(min_lat, max_lat), Site.lng.between(min_lng, max_lng))
    if kind:
        stmt = stmt.where(Site.kind == kind)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Site.name.ilike(like), Site.city.ilike(like), Site.description.ilike(like)))
    counts = _ms_counts(db)
    sites = db.scalars(stmt.order_by(Site.name)).all()
    return {"total": len(sites), "items": [site_out(s, counts.get(s.id, 0)) for s in sites]}


@router.get("/sites/nearby")
def nearby(
    lat: float = Query(ge=-90, le=90),
    lng: float = Query(ge=-180, le=180),
    radius_km: float = Query(25, gt=0, le=1000),
    kind: str | None = None,
    limit_: int = Query(30, alias="limit", ge=1, le=200),
    db: Session = Depends(get_db),
):
    lat0, lat1, lng0, lng1 = bounding_box(lat, lng, radius_km)
    stmt = select(Site).where(Site.lat.between(lat0, lat1), Site.lng.between(lng0, lng1))
    if kind:
        stmt = stmt.where(Site.kind == kind)
    counts = _ms_counts(db)
    found = []
    for s in db.scalars(stmt).all():
        d = haversine_km(lat, lng, s.lat, s.lng)
        if d <= radius_km:
            found.append((d, s))
    found.sort(key=lambda t: t[0])
    return {
        "center": {"lat": lat, "lng": lng},
        "radius_km": radius_km,
        "total": len(found),
        "items": [site_out(s, counts.get(s.id, 0), d) for d, s in found[:limit_]],
    }


@router.get("/sites/{site_id}")
def get_site(site_id: str, db: Session = Depends(get_db)):
    from app.api.manuscripts import manuscript_stats

    site = get_or_404(db, Site, site_id, "Site")
    mss = db.scalars(select(Manuscript).where(Manuscript.site_id == site.id).order_by(Manuscript.title)).all()
    stats = manuscript_stats(db, [m.id for m in mss])
    return {**site_out(site, len(mss)), "manuscripts": [manuscript_out(m, stats.get(m.id)) for m in mss]}


@router.post("/sites", status_code=201)
def create_site(body: SiteIn, user: User = Depends(require_role("curator")), db: Session = Depends(get_db)):
    site = Site(**body.model_dump())
    db.add(site)
    db.flush()
    audit.record(db, user.id, "site.created", "site", site.id, name=site.name)
    db.commit()
    return site_out(site, 0)


@router.patch("/sites/{site_id}")
def update_site(site_id: str, body: SiteIn, user: User = Depends(require_role("curator")), db: Session = Depends(get_db)):
    site = get_or_404(db, Site, site_id, "Site")
    for k, v in body.model_dump().items():
        setattr(site, k, v)
    audit.record(db, user.id, "site.updated", "site", site.id)
    db.commit()
    return site_out(site, _ms_counts(db).get(site.id, 0))


@router.delete("/sites/{site_id}", status_code=204)
def delete_site(site_id: str, user: User = Depends(require_role("curator")), db: Session = Depends(get_db)):
    site = get_or_404(db, Site, site_id, "Site")
    audit.record(db, user.id, "site.deleted", "site", site.id, name=site.name)
    db.delete(site)
    db.commit()


@router.post("/trails", status_code=201, dependencies=[Depends(limit("trails", 30))])
def create_trail(body: TrailIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    unique_ids = list(dict.fromkeys(body.site_ids))
    sites = db.scalars(select(Site).where(Site.id.in_(unique_ids))).all()
    by_id = {s.id: s for s in sites}
    missing = [sid for sid in unique_ids if sid not in by_id]
    if missing:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown site id(s): {', '.join(missing)}")
    stops = [by_id[sid] for sid in unique_ids]
    order = plan_order((body.start_lat, body.start_lng), [Point(s.id, s.lat, s.lng) for s in stops])
    ordered = [stops[i] for i in order]
    coords = [(body.start_lat, body.start_lng)] + [(s.lat, s.lng) for s in ordered]
    r = route(coords, body.mode)
    travel = sum(leg["minutes"] for leg in r["legs"])
    visiting = sum(s.visit_minutes for s in ordered)
    trail = Trail(
        user_id=user.id,
        name=body.name,
        mode=body.mode,
        start_lat=body.start_lat,
        start_lng=body.start_lng,
        total_km=round(sum(leg["km"] for leg in r["legs"]), 2),
        total_minutes=travel + visiting,
        routing=r["routing"],
        geometry=r["geometry"],
        legs=[{**leg, "to_site_id": s.id} for leg, s in zip(r["legs"], ordered, strict=True)],
        stops=[s.id for s in ordered],
        is_public=body.is_public,
    )
    db.add(trail)
    db.flush()
    audit.record(db, user.id, "trail.created", "trail", trail.id, stops=len(ordered))
    db.commit()
    return {**trail_out(trail, by_id), "travel_minutes": travel, "visit_minutes": visiting}


@router.get("/trails")
def my_trails(user: User = Depends(current_user), db: Session = Depends(get_db)):
    trails = db.scalars(select(Trail).where(Trail.user_id == user.id).order_by(Trail.created_at.desc())).all()
    site_ids = {sid for t in trails for sid in t.stops}
    sites = {s.id: s for s in db.scalars(select(Site).where(Site.id.in_(site_ids))).all()}
    return {"items": [trail_out(t, sites) for t in trails]}


@router.get("/trails/{trail_id}")
def get_trail(trail_id: str, user: User | None = Depends(optional_user), db: Session = Depends(get_db)):
    trail = get_or_404(db, Trail, trail_id, "Trail")
    if not trail.is_public and (user is None or user.id != trail.user_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Trail not found")
    sites = {s.id: s for s in db.scalars(select(Site).where(Site.id.in_(trail.stops))).all()}
    return trail_out(trail, sites)


@router.delete("/trails/{trail_id}", status_code=204)
def delete_trail(trail_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    trail = get_or_404(db, Trail, trail_id, "Trail")
    if trail.user_id != user.id and user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can only delete your own trails")
    db.delete(trail)
    db.commit()
