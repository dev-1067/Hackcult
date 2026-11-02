"""Distances, nearby search and the heritage-trail planner."""

import math
from dataclasses import dataclass

import httpx

from app.config import get_settings

EARTH_KM = 6371.0088
SPEED_KMH = {"walk": 4.8, "drive": 32.0}  # urban averages, used when the router is unreachable
ROAD_FACTOR = 1.3  # straight line -> typical road distance


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(math.sqrt(a))


def bounding_box(lat: float, lng: float, radius_km: float) -> tuple[float, float, float, float]:
    """Cheap pre-filter for SQL before exact haversine distances."""
    dlat = radius_km / 111.32
    dlng = radius_km / (111.32 * max(0.01, math.cos(math.radians(lat))))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


@dataclass
class Point:
    id: str
    lat: float
    lng: float


def _route_length(order: list[int], dist: list[list[float]]) -> float:
    # index 0 is the start point; the route is open (does not return to start)
    return sum(dist[order[i]][order[i + 1]] for i in range(len(order) - 1))


def plan_order(start: tuple[float, float], stops: list[Point]) -> list[int]:
    """Visit order for stops: nearest-neighbour construction, then 2-opt until no improvement.
    Returns indices into `stops`."""
    if len(stops) <= 1:
        return list(range(len(stops)))
    pts = [start] + [(s.lat, s.lng) for s in stops]
    n = len(pts)
    dist = [[haversine_km(*pts[i], *pts[j]) for j in range(n)] for i in range(n)]

    order, left = [0], set(range(1, n))
    while left:
        nxt = min(left, key=lambda j: dist[order[-1]][j])
        order.append(nxt)
        left.remove(nxt)

    improved = True
    while improved:
        improved = False
        for i in range(1, n - 1):
            for k in range(i + 1, n):
                candidate = order[:i] + order[i : k + 1][::-1] + order[k + 1 :]
                if _route_length(candidate, dist) + 1e-9 < _route_length(order, dist):
                    order, improved = candidate, True
    return [i - 1 for i in order[1:]]


def route(coords: list[tuple[float, float]], mode: str) -> dict:
    """Road geometry from OSRM; straight-line estimate if the router is down."""
    settings = get_settings()
    path = ";".join(f"{lng:.6f},{lat:.6f}" for lat, lng in coords)
    try:
        r = httpx.get(
            f"{settings.osrm_url}/route/v1/driving/{path}",
            params={"overview": "full", "geometries": "geojson", "steps": "false"},
            timeout=settings.http_timeout_seconds,
        )
        r.raise_for_status()
        data = r.json()
        if data.get("code") != "Ok" or not data.get("routes"):
            raise ValueError(data.get("code"))
        best = data["routes"][0]
        legs = []
        for leg in best["legs"]:
            km = leg["distance"] / 1000
            minutes = leg["duration"] / 60 if mode == "drive" else km / SPEED_KMH["walk"] * 60
            legs.append({"km": round(km, 2), "minutes": round(minutes)})
        return {"routing": "osrm", "geometry": best["geometry"], "legs": legs}
    except Exception:
        legs = []
        for (a_lat, a_lng), (b_lat, b_lng) in zip(coords, coords[1:]):
            km = haversine_km(a_lat, a_lng, b_lat, b_lng) * ROAD_FACTOR
            legs.append({"km": round(km, 2), "minutes": round(km / SPEED_KMH[mode] * 60)})
        geometry = {"type": "LineString", "coordinates": [[lng, lat] for lat, lng in coords]}
        return {"routing": "straight-line", "geometry": geometry, "legs": legs}
