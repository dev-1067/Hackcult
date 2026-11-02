import time

import cv2

from app.services.synthetic import make_page

API = "/api/v1"


def _png(seed: int) -> bytes:
    ok, buf = cv2.imencode(".jpg", make_page("devanagari", seed=seed).image)
    assert ok
    return buf.tobytes()


def _wait(client, job_id: str, timeout: float = 90) -> dict:
    end = time.time() + timeout
    while time.time() < end:
        job = client.get(f"{API}/jobs/{job_id}").json()
        if job["status"] in ("done", "failed"):
            return job
        time.sleep(0.3)
    raise AssertionError("job did not finish")


def test_health_and_meta(client):
    assert client.get(f"{API}/health").json()["status"] == "ok"
    meta = client.get(f"{API}/meta").json()
    assert any(e["name"] == "ppocr" and e["available"] for e in meta["engines"])
    assert meta["translation"]["available"] is False


def test_auth_errors_have_consistent_shape(client):
    r = client.post(f"{API}/auth/login", json={"email": "nobody@x.in", "password": "wrongpass"})
    assert r.status_code == 401
    body = r.json()["error"]
    assert body["code"] == "unauthorized" and body["message"] and body["request_id"]
    r = client.post(f"{API}/auth/register", json={"name": "A", "email": "bad", "password": "short"})
    assert r.status_code == 422
    assert client.get(f"{API}/auth/me").status_code == 401


def test_roles_are_enforced(client, viewer):
    r = client.post(f"{API}/manuscripts", json={"title": "Not allowed"}, headers=viewer)
    assert r.status_code == 403
    assert "contributor" in r.json()["error"]["message"]


def test_full_manuscript_flow(client, contributor, curator):
    r = client.post(
        f"{API}/manuscripts",
        json={"title": "Test Gita pages", "language": "sa", "century": 19, "material": "paper"},
        headers=contributor,
    )
    assert r.status_code == 201, r.text
    ms = r.json()
    assert ms["script"] == "devanagari"

    r = client.post(
        f"{API}/manuscripts/{ms['id']}/pages",
        files=[("files", ("p1.jpg", _png(31), "image/jpeg")), ("files", ("p2.jpg", _png(32), "image/jpeg"))],
        data={"auto_ocr": "true"},
        headers=contributor,
    )
    assert r.status_code == 201, r.text
    up = r.json()
    assert len(up["pages"]) == 2 and len(up["jobs"]) == 2
    for job in up["jobs"]:
        done = _wait(client, job["id"])
        assert done["status"] == "done", done
        assert done["result"]["lines"] >= 5

    page_id = up["pages"][0]["id"]
    page = client.get(f"{API}/pages/{page_id}").json()
    assert page["status"] == "done" and page["lines"] and page["next_page_id"] == up["pages"][1]["id"]
    assert page["normalized_url"].startswith("/media/")
    assert client.get(page["normalized_url"]).status_code == 200
    line = page["lines"][0]
    img = client.get(f"{API}/lines/{line['id']}/image")
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert client.get(f"{API}/lines/{line['id']}/transliterate?to=iast").json()["text"]

    # Idempotent re-run: same key -> same job
    h = {**contributor, "Idempotency-Key": "rerun-1"}
    j1 = client.post(f"{API}/pages/{page_id}/ocr", json={"engine": "auto"}, headers=h).json()
    j2 = client.post(f"{API}/pages/{page_id}/ocr", json={"engine": "auto"}, headers=h).json()
    assert j1["job"]["id"] == j2["job"]["id"] and j2["created"] is False
    assert _wait(client, j1["job"]["id"])["status"] == "done"

    # Search: romanised query finds Devanagari text
    s = client.get(f"{API}/search", params={"q": "dharma"}).json()
    assert s["total"] >= 1
    assert any("धर्म" in r["text"] or "dharm" in r["iast"] for r in s["results"])

    # Correction: contributor suggests, curator approves -> line text changes and is verified
    page = client.get(f"{API}/pages/{page_id}").json()
    target = page["lines"][1]
    r = client.post(f"{API}/lines/{target['id']}/corrections", json={"text": target["text"] + " ॥"}, headers=contributor)
    assert r.status_code == 201 and r.json()["auto_approved"] is False
    cid = r.json()["correction"]["id"]
    queue = client.get(f"{API}/corrections", headers=curator).json()
    assert any(c["id"] == cid for c in queue["items"])
    r = client.post(f"{API}/corrections/{cid}/review", json={"action": "approve"}, headers=curator)
    assert r.status_code == 200 and r.json()["status"] == "approved"
    updated = next(ln for ln in client.get(f"{API}/pages/{page_id}").json()["lines"] if ln["id"] == target["id"])
    assert updated["verified"] and updated["text"].endswith("॥")
    assert client.post(f"{API}/corrections/{cid}/review", json={"action": "reject"}, headers=curator).status_code == 409

    # Export (curator only)
    assert client.get(f"{API}/export/training-data", headers=contributor).status_code == 403
    exp = client.get(f"{API}/export/training-data?format=jsonl", headers=curator)
    assert exp.status_code == 200 and '"source": "human-verified"' in exp.text

    stats = client.get(f"{API}/stats/overview").json()
    assert stats["manuscripts"] >= 1 and stats["lines"] >= 10


def test_bad_upload_is_rejected(client, contributor):
    ms = client.post(f"{API}/manuscripts", json={"title": "Upload checks"}, headers=contributor).json()
    r = client.post(
        f"{API}/manuscripts/{ms['id']}/pages",
        files=[("files", ("evil.jpg", b"<script>alert(1)</script>", "image/jpeg"))],
        headers=contributor,
    )
    assert r.status_code == 400
    assert "not a readable image" in r.json()["error"]["message"]


def test_sites_nearby_and_trail(client, contributor, curator):
    a = client.post(f"{API}/sites", json={"name": "Adalaj Stepwell", "kind": "stepwell", "lat": 23.1667, "lng": 72.5803}, headers=curator).json()
    b = client.post(f"{API}/sites", json={"name": "Dada Harir Stepwell", "kind": "stepwell", "lat": 23.0434, "lng": 72.6023}, headers=curator).json()
    far = client.post(f"{API}/sites", json={"name": "Dwarka", "kind": "temple", "lat": 22.2378, "lng": 68.9675}, headers=curator).json()
    near = client.get(f"{API}/sites/nearby", params={"lat": 23.2135, "lng": 72.6847, "radius_km": 40}).json()
    ids = [s["id"] for s in near["items"]]
    assert a["id"] in ids and b["id"] in ids and far["id"] not in ids
    assert near["items"] == sorted(near["items"], key=lambda s: s["distance_km"])

    r = client.post(
        f"{API}/trails",
        json={"name": "Test trail", "mode": "drive", "start_lat": 23.2135, "start_lng": 72.6847, "site_ids": [b["id"], a["id"]]},
        headers=contributor,
    )
    assert r.status_code == 201, r.text
    trail = r.json()
    assert [s["id"] for s in trail["stops"]] == [a["id"], b["id"]]  # nearer stop first
    assert trail["routing"] == "straight-line" and trail["total_km"] > 0
    assert client.get(f"{API}/trails/{trail['id']}").status_code == 200


def test_benchmark_job(client, contributor):
    r = client.post(f"{API}/lab/benchmarks", json={"pages": 2, "difficulty": 0.8}, headers=contributor)
    assert r.status_code == 202
    job = _wait(client, r.json()["id"], timeout=180)
    assert job["status"] == "done", job
    s = job["result"]["summary"]
    assert s["full"]["cer"] < s["raw"]["cer"]
    assert len(job["result"]["samples"]) == 2
