"""Populate a fresh database with demo accounts, heritage sites and real manuscripts (OCR is run for real).

    python -m scripts.seed           # only if the database is empty
    python -m scripts.seed --reset   # wipe and re-seed
"""

import argparse
import json
import logging
from pathlib import Path

import cv2
from sqlalchemy import func, select

from app.config import get_settings
from app.db import Base, SessionLocal, engine, init_db
from app.logging_setup import configure_logging
from app.models import Correction, Line, Manuscript, Page, Site, Trail, User
from app.services import jobs, search
from app.services.geo import Point, plan_order, route
from app.services.handlers import run_job
from app.services.storage import put_image, storage
from app.services.synthetic import make_page
from app.security import hash_password

log = logging.getLogger("seed")
SEED = Path(__file__).resolve().parent.parent / "seed"

# Demo accounts for local testing and judging. Change or remove them before any real deployment.
DEMO_PASSWORD = "Lipi@2026"
USERS = [
    ("admin@lipisetu.in", "Aditi Admin", "admin"),
    ("curator@lipisetu.in", "Kavya Curator", "curator"),
    ("contributor@lipisetu.in", "Rohan Contributor", "contributor"),
    ("viewer@lipisetu.in", "Vihaan Viewer", "viewer"),
]

# Index in seed/manuscripts/sources.json -> catalogue metadata (from the Commons file descriptions).
CATALOGUE = {
    0: dict(title="Yogaśāstra of Hemacandra", language="sa", century=12, material="palm_leaf", site="hemchandra-gyan-mandir",
            description="Jain treatise on yoga and ethics by Hemacandra (1088-1173), who worked at Aṇahilapāṭaka (Patan). Written in very small (about 1 mm) Devanagari. Linked to Patan as the author's city."),
    1: dict(title="Prayāga Snāna Vidhi (1674 CE)", language="sa", century=17, material="paper", site=None,
            description="Purāṇic ritual text on bathing at Prayāga, dated 1674 CE. Two folios.", pages=[1, 2]),
    3: dict(title="Jaiminīya Mīmāṃsā Sūtra Bhāṣya", language="sa", script="telugu", century=16, material="palm_leaf", site="saraswati-mahal",
            description="Commentary on the Mīmāṃsā Sūtras, Sanskrit written in Telugu script, from Andhra Pradesh. Mapped to Thanjavur's Saraswathi Mahal as a representative South Indian palm-leaf repository."),
    4: dict(title="Devī Māhātmya — Nārāyaṇī Stuti", language="sa", century=16, material="paper", site="royal-danish-library",
            description="Hymn to the Goddess from the Devī Māhātmya, held at the Royal Danish Library (Det Kongelige Bibliotek)."),
    5: dict(title="Yajurveda Saṃhitā, folio 1", language="sa", century=18, material="paper", site="raghunath-jammu",
            description="Opening folio beginning 'gaṇānāṃ tvā gaṇapatiṃ havāmahe', from the Raghunath temple archives in Jammu."),
    6: dict(title="Advaita Viveka", language="sa", century=None, material="paper", site=None,
            description="Vedānta manuscript (public domain scan)."),
    7: dict(title="Aitareya Brāhmaṇa, folio 3a", language="sa", century=None, material="paper", site="penn-libraries",
            description="Ṛgvedic Brāhmaṇa text, Schoenberg Center manuscript at the University of Pennsylvania Libraries."),
    8: dict(title="Bhagavad Bhakti Ratnāvalī, leaf 5 of 70", language="sa", century=18, material="paper", site=None,
            description="Devotional anthology, 18th century India."),
    9: dict(title="Bhāgavata Purāṇa", language="sa", century=18, material="paper", site=None,
            description="18th-century manuscript folio of the Bhāgavata Purāṇa (public domain)."),
}
TYPESET_SEEDS = (23, 1, 11)


def _ensure_empty_or_reset(reset: bool) -> bool:
    if reset:
        Base.metadata.drop_all(engine)
        with engine.begin() as conn:
            conn.exec_driver_sql("DROP TABLE IF EXISTS line_fts")
        storage.delete_prefix("manuscripts")
        storage.delete_prefix("lab")
    init_db()
    with SessionLocal() as db:
        return (db.scalar(select(func.count(User.id))) or 0) == 0


def seed_users(db) -> dict[str, User]:
    out = {}
    for email, name, role in USERS:
        u = User(email=email, name=name, role=role, password_hash=hash_password(DEMO_PASSWORD))
        db.add(u)
        out[role] = u
    db.flush()
    return out


def seed_sites(db) -> dict[str, Site]:
    out = {}
    for s in json.loads((SEED / "sites.json").read_text(encoding="utf-8")):
        key = s.pop("key")
        site = Site(**s)
        db.add(site)
        out[key] = site
    db.flush()
    return out


def _add_pages(db, ms: Manuscript, images, user: User) -> list[str]:
    job_ids = []
    for i, img in enumerate(images, 1):
        page = Page(manuscript_id=ms.id, page_no=i, image_key="", width=img.shape[1], height=img.shape[0])
        db.add(page)
        db.flush()
        page.image_key = put_image(f"manuscripts/{ms.id}/{page.id}/original.jpg", img, quality=92)
        job, _ = jobs.enqueue(db, kind="ocr", page_id=page.id, user_id=user.id)
        job_ids.append(job.id)
    return job_ids


def seed_manuscripts(db, users: dict[str, User], sites: dict[str, Site]) -> list[str]:
    sources = json.loads((SEED / "manuscripts" / "sources.json").read_text(encoding="utf-8"))
    job_ids: list[str] = []
    used = set()
    for idx, meta in CATALOGUE.items():
        if idx in used:
            continue
        page_idx = meta.get("pages", [idx])
        used.update(page_idx)
        src = sources[page_idx[0]]
        ms = Manuscript(
            title=meta["title"],
            language=meta["language"],
            script=meta.get("script", "devanagari"),
            century=meta["century"],
            material=meta["material"],
            repository="Digitised scan on Wikimedia Commons",
            site_id=sites[meta["site"]].id if meta.get("site") else None,
            description=meta["description"] + f" Photo: {src['artist'] or 'unknown'} ({src['license']}).",
            license=src["license"],
            source_url=src["page"],
            uploaded_by=users["contributor"].id,
        )
        db.add(ms)
        db.flush()
        images = [cv2.imread(str(SEED / "manuscripts" / sources[i]["file"])) for i in page_idx]
        job_ids += _add_pages(db, ms, images, users["contributor"])

    # A clean typeset text: shows what the pipeline does on well-preserved printed pages.
    ms = Manuscript(
        title="Bhagavad Gītā and Subhāṣita — typeset reading copy",
        language="sa",
        script="devanagari",
        century=21,
        material="print",
        repository="LipiSetu demo collection",
        site_id=sites["ld-indology"].id,
        description="Verses from the Bhagavad Gītā (chapters 2 and 4), the Īśa Upaniṣad and classical subhāṣitas, typeset "
        "in Noto Serif Devanagari and photographed under uneven light. Use it to try search ('dharma', 'karma', 'vidya').",
        license="CC0 (generated by LipiSetu)",
        uploaded_by=users["curator"].id,
    )
    db.add(ms)
    db.flush()
    pages = [make_page("devanagari", seed=s, difficulty=0.35).image for s in TYPESET_SEEDS]
    job_ids += _add_pages(db, ms, pages, users["curator"])
    return job_ids


def seed_reviews(db, users: dict[str, User]) -> int:
    """Real suggestions for the review queue: on the typeset text we know the exact wording, so every
    line the OCR misread gets a correction proposing the true text."""
    ms = db.scalar(select(Manuscript).where(Manuscript.material == "print"))
    if not ms:
        return 0
    added = 0
    for page, seed in zip(sorted(ms.pages, key=lambda p: p.page_no), TYPESET_SEEDS, strict=True):
        truth = make_page("devanagari", seed=seed, difficulty=0.35).lines
        ocr_lines = sorted(page.lines, key=lambda ln: ln.line_no)
        if len(ocr_lines) != len(truth):
            continue
        for ln, true_text in zip(ocr_lines, truth, strict=True):
            if ln.text != true_text and added < 6:
                db.add(Correction(line_id=ln.id, user_id=users["contributor"].id, previous_text=ln.text, text=true_text))
                added += 1
    return added


def seed_trail(db, users: dict[str, User], sites: dict[str, Site]) -> None:
    start = (23.2135, 72.6847)  # IIT Gandhinagar, Palaj
    stops = [sites[k] for k in ("adalaj", "dada-harir", "sidi-saiyyed", "ld-indology")]
    order = plan_order(start, [Point(s.id, s.lat, s.lng) for s in stops])
    ordered = [stops[i] for i in order]
    r = route([start] + [(s.lat, s.lng) for s in ordered], "drive")
    db.add(
        Trail(
            user_id=users["contributor"].id,
            name="Stepwells and scripts of Ahmedabad",
            mode="drive",
            start_lat=start[0],
            start_lng=start[1],
            total_km=round(sum(leg["km"] for leg in r["legs"]), 2),
            total_minutes=sum(leg["minutes"] for leg in r["legs"]) + sum(s.visit_minutes for s in ordered),
            routing=r["routing"],
            geometry=r["geometry"],
            legs=[{**leg, "to_site_id": s.id} for leg, s in zip(r["legs"], ordered, strict=True)],
            stops=[s.id for s in ordered],
        )
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="drop all data first")
    args = parser.parse_args()
    configure_logging()
    if not _ensure_empty_or_reset(args.reset):
        print("Database already has data. Use --reset to wipe and re-seed.")
        return
    with SessionLocal() as db:
        users = seed_users(db)
        sites = seed_sites(db)
        job_ids = seed_manuscripts(db, users, sites)
        db.commit()
    print(f"Running OCR on {len(job_ids)} pages...")
    for jid in job_ids:
        claimed = jobs.claim_next("seed")
        run_job(claimed or jid)
    with SessionLocal() as db:
        users = {u.role: u for u in db.scalars(select(User)).all()}
        sites_by_name = {s.name: s for s in db.scalars(select(Site)).all()}
        reviews = seed_reviews(db, users)
        keyed = {s["key"]: sites_by_name[s["name"]] for s in json.loads((SEED / "sites.json").read_text(encoding="utf-8"))}
        seed_trail(db, users, keyed)
        search.rebuild_index(db)
        db.commit()
        n_lines = db.scalar(select(func.count(Line.id)))
    print(f"Seeded {len(USERS)} users, {len(keyed)} sites, {len(job_ids)} pages, {n_lines} lines, {reviews} pending corrections.")
    print(f"Demo password for all accounts: {DEMO_PASSWORD}  (database: {get_settings().database_url})")


if __name__ == "__main__":
    main()
