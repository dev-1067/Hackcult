import logging
import threading
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import __version__
from app.api import auth, corrections, discover, lines, manuscripts, ops, pages
from app.config import get_settings
from app.db import init_db
from app.logging_setup import configure_logging, request_id_var
from app.ratelimit import client_key, limiter

log = logging.getLogger("lipisetu")
settings = get_settings()


def _warm_up() -> None:
    """Load the Devanagari recogniser once so the first real job is not slowed by model loading."""
    try:
        import numpy as np

        from app.ocr.engines import get_engine

        eng = get_engine("ppocr")
        if eng and eng.available():
            eng.recognize([np.full((48, 200, 3), 255, np.uint8)], "devanagari")
            log.info("OCR engine warmed up")
    except Exception:  # never block start-up on this
        log.exception("warm-up failed")


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging()
    init_db()
    stop = None
    if settings.embedded_worker:
        from app.worker import start_background

        stop = start_background()
    threading.Thread(target=_warm_up, daemon=True).start()
    log.info("LipiSetu %s started", __version__)
    yield
    if stop:
        stop.set()


app = FastAPI(
    title="LipiSetu API",
    version=__version__,
    description="Manuscript OCR, search and heritage discovery.",
    lifespan=lifespan,
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or uuid.uuid4().hex[:12]
    token = request_id_var.set(rid)
    start = time.perf_counter()
    try:
        if request.url.path.startswith("/api/"):
            try:
                limiter.check(client_key(request), "global", settings.rate_limit_per_minute)
            except HTTPException as exc:
                return _error(exc.status_code, "rate_limited", exc.detail, rid, exc.headers)
        response = await call_next(request)
    finally:
        request_id_var.reset(token)
    elapsed = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = rid
    response.headers["X-Response-Time"] = f"{elapsed:.1f}ms"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/") and response.status_code >= 500:
        log.error("%s %s -> %s in %.0fms", request.method, request.url.path, response.status_code, elapsed)
    return response


_CODES = {400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict",
          413: "too_large", 422: "invalid", 429: "rate_limited", 503: "unavailable"}


def _error(status_code: int, code: str, message, rid: str | None = None, headers=None) -> JSONResponse:
    body = {"error": {"code": code, "message": message if isinstance(message, str) else "Request failed",
                      "request_id": rid or request_id_var.get()}}
    if not isinstance(message, str):
        body["error"]["detail"] = message
    return JSONResponse(body, status_code=status_code, headers=headers)


@app.exception_handler(StarletteHTTPException)
async def http_error(_: Request, exc: StarletteHTTPException):
    return _error(exc.status_code, _CODES.get(exc.status_code, "error"), exc.detail, headers=getattr(exc, "headers", None))


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, exc: RequestValidationError):
    errors = exc.errors()
    first = errors[0] if errors else {}
    field = ".".join(str(p) for p in first.get("loc", [])[1:]) or "request"
    msg = str(first.get("msg", "Invalid request")).removeprefix("Value error, ")
    return _error(422, "invalid", f"{field}: {msg}" if field != "request" else msg)


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    log.exception("unhandled error")
    return _error(500, "server_error", "Something went wrong on our side. The error has been logged.")


API = "/api/v1"
for module in (auth, manuscripts, pages, lines, corrections, discover, ops):
    app.include_router(module.router, prefix=API)

app.mount("/media", StaticFiles(directory=settings.storage_dir), name="media")

# Serve the built single-page app (frontend/dist) from the same origin in production.
_dist = settings.frontend_dist
if (_dist / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith(("api/", "media/")):
            raise StarletteHTTPException(404, "Not found")
        candidate = (_dist / full_path).resolve()
        if full_path and candidate.is_file() and _dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(_dist / "index.html")
