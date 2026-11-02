"""Job worker. Runs inside the API process (EMBEDDED_WORKER=true) or standalone:

    python -m app.worker            # scale out by starting more of these
"""

import logging
import os
import socket
import threading
import time

from app.config import get_settings
from app.services import jobs
from app.services.handlers import run_job

log = logging.getLogger("lipisetu.worker")

_heartbeat = {"at": 0.0, "worker": ""}


def heartbeat() -> dict:
    return dict(_heartbeat)


def loop(stop: threading.Event, worker_id: str) -> None:
    settings = get_settings()
    log.info("worker %s started", worker_id)
    while not stop.is_set():
        _heartbeat.update(at=time.time(), worker=worker_id)
        try:
            job_id = jobs.claim_next(worker_id)
        except Exception:
            log.exception("could not claim a job")
            job_id = None
        if job_id:
            log.info("worker %s running job %s", worker_id, job_id)
            run_job(job_id)
            continue
        stop.wait(settings.worker_poll_seconds)
    log.info("worker %s stopped", worker_id)


def start_background() -> threading.Event:
    stop = threading.Event()
    worker_id = f"{socket.gethostname()}:{os.getpid()}:embedded"
    threading.Thread(target=loop, args=(stop, worker_id), name="lipisetu-worker", daemon=True).start()
    return stop


if __name__ == "__main__":
    from app.db import init_db
    from app.logging_setup import configure_logging

    configure_logging()
    init_db()
    stop_event = threading.Event()
    try:
        loop(stop_event, f"{socket.gethostname()}:{os.getpid()}")
    except KeyboardInterrupt:
        stop_event.set()
