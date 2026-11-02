"""Capture product screenshots of a running LipiSetu (for the README and the pitch deck).

    pip install playwright          # uses the installed Microsoft Edge, no browser download
    python -m scripts.screenshots   # server must be running on http://localhost:8000
"""

import json
import sqlite3
import sys
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8000"
OUT = Path(__file__).resolve().parents[2] / "docs" / "screenshots"
DB = Path(__file__).resolve().parents[1] / "data" / "lipisetu.db"
VIEWPORT = {"width": 1600, "height": 1000}


def session(email: str) -> dict:
    r = httpx.post(f"{BASE}/api/v1/auth/login", json={"email": email, "password": "Lipi@2026"}, timeout=20)
    r.raise_for_status()
    return r.json()


def ids() -> dict:
    con = sqlite3.connect(DB)
    q = lambda sql: (con.execute(sql).fetchone() or [None])[0]  # noqa: E731
    return {
        "yajurveda": q("select p.id from pages p join manuscripts m on m.id=p.manuscript_id where m.title like 'Yajurveda%'"),
        "yajur_line": q(
            "select l.id from lines l join pages p on p.id=l.page_id join manuscripts m on m.id=p.manuscript_id "
            "where m.title like 'Yajurveda%' order by l.line_no limit 1 offset 1"
        ),
        "trail": q("select id from trails order by created_at limit 1"),
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    s = session("curator@lipisetu.in")
    k = ids()
    shots = [
        ("02-dashboard", "/", 2000),
        ("03-manuscripts", "/manuscripts", 2500),
        ("04-page-viewer", f"/pages/{k['yajurveda']}?line={k['yajur_line']}", 3000),
        ("05-search", "/search?q=dharma", 2000),
        ("06-review", "/review", 2000),
        ("07-map", "/map", 5000),
        ("08-trail", f"/trails/{k['trail']}", 5000),
        ("09-ocr-lab", "/lab", 2500),
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        # Signed-out shot first.
        ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1.5, color_scheme="light")
        page = ctx.new_page()
        page.goto(f"{BASE}/login", wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.screenshot(path=str(OUT / "01-login.jpg"), quality=86, type="jpeg")
        ctx.close()

        ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1.5, color_scheme="light")
        ctx.add_init_script(
            f"localStorage.setItem('lipisetu-auth', {json.dumps(json.dumps(s))});"
            "localStorage.setItem('lipisetu-theme', 'light');"
        )
        page = ctx.new_page()
        for name, path, wait in shots:
            page.goto(f"{BASE}{path}", wait_until="networkidle")
            page.wait_for_timeout(wait)
            page.screenshot(path=str(OUT / f"{name}.jpg"), quality=86, type="jpeg")
            print("saved", name)
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
