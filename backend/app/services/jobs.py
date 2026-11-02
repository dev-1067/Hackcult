"""Database-backed job queue.

Why not Redis: one less moving part to fail during a live demo, and the database already gives us
atomic claims. A worker claims a job with a conditional UPDATE (only one worker can win), holds it
under a lease, and reports progress. If a worker dies, the lease expires and another worker picks the
job up. Failures retry with exponential backoff up to `max_attempts`.
Scaling out = run more `python -m app.worker` processes against the same database.
"""

import logging
from datetime import timedelta

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import SessionLocal
from app.models import Job, Page, utcnow

log = logging.getLogger(__name__)


def enqueue(
    db: Session,
    *,
    kind: str,
    page_id: str | None = None,
    engine: str = "auto",
    options: dict | None = None,
    idempotency_key: str | None = None,
    user_id: str | None = None,
) -> tuple[Job, bool]:
    """Create a job, or return the existing one for the same idempotency key. Returns (job, created)."""
    if idempotency_key:
        existing = db.scalar(select(Job).where(Job.idempotency_key == idempotency_key))
        if existing:
            return existing, False
    if page_id:
        active = db.scalar(select(Job).where(Job.page_id == page_id, Job.status.in_(("queued", "running"))))
        if active:
            return active, False
    job = Job(
        kind=kind,
        page_id=page_id,
        engine_requested=engine,
        options=options or {},
        idempotency_key=idempotency_key,
        created_by=user_id,
        max_attempts=get_settings().job_max_attempts,
    )
    db.add(job)
    if page_id:
        db.execute(update(Page).where(Page.id == page_id).values(status="queued"))
    db.flush()
    return job, True


def claim_next(worker_id: str) -> str | None:
    settings = get_settings()
    now = utcnow()
    with SessionLocal() as db:
        claimable = or_(
            (Job.status == "queued") & (Job.available_at <= now),
            (Job.status == "running") & (Job.locked_until < now),  # lease expired: worker died
        )
        candidate = db.scalar(select(Job.id).where(claimable).order_by(Job.created_at).limit(1))
        if not candidate:
            return None
        result = db.execute(
            update(Job)
            .where(Job.id == candidate, claimable)
            .values(
                status="running",
                locked_until=now + timedelta(seconds=settings.job_lease_seconds),
                attempts=Job.attempts + 1,
                started_at=now,
                stage="Starting",
                progress=2,
                result={"worker": worker_id},
            )
        )
        db.commit()
        return candidate if result.rowcount == 1 else None


def report(job_id: str, progress: int, stage: str) -> None:
    settings = get_settings()
    with SessionLocal() as db:
        db.execute(
            update(Job)
            .where(Job.id == job_id)
            .values(
                progress=max(0, min(100, progress)),
                stage=stage[:60],
                locked_until=utcnow() + timedelta(seconds=settings.job_lease_seconds),
            )
        )
        db.commit()


def finish(job_id: str, engine_used: str = "", result: dict | None = None) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        job.status, job.progress, job.stage = "done", 100, "Done"
        job.engine_used = engine_used
        job.finished_at = utcnow()
        job.locked_until = None
        job.error = ""
        if job.started_at:
            job.duration_ms = int((job.finished_at - job.started_at).total_seconds() * 1000)
        job.result = {**(job.result or {}), **(result or {})}
        db.commit()


def fail(job_id: str, error: str, retryable: bool = True) -> None:
    with SessionLocal() as db:
        job = db.get(Job, job_id)
        if not job:
            return
        job.error = error[:2000]
        job.locked_until = None
        if retryable and job.attempts < job.max_attempts:
            delay = 5 * 2 ** (job.attempts - 1)
            job.status, job.stage = "queued", f"Retrying in {delay}s"
            job.available_at = utcnow() + timedelta(seconds=delay)
        else:
            job.status, job.stage = "failed", "Failed"
            job.finished_at = utcnow()
            if job.page_id:
                page = db.get(Page, job.page_id)
                if page:
                    page.status = "failed"
        db.commit()


def retry(db: Session, job: Job) -> Job:
    job.status, job.stage, job.progress, job.error = "queued", "Queued", 0, ""
    job.attempts, job.available_at, job.finished_at = 0, utcnow(), None
    if job.page_id:
        db.execute(update(Page).where(Page.id == job.page_id).values(status="queued"))
    return job
