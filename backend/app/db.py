from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings

settings = get_settings()

_connect_args = {"check_same_thread": False, "timeout": 30} if settings.is_sqlite else {}
engine = create_engine(settings.database_url, connect_args=_connect_args, pool_pre_ping=True)

if settings.is_sqlite:

    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - driver hook
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")  # concurrent readers while the worker writes
        cur.execute("PRAGMA synchronous=NORMAL")
        cur.execute("PRAGMA foreign_keys=ON")
        cur.execute("PRAGMA busy_timeout=30000")
        cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


FTS_DDL = """
CREATE VIRTUAL TABLE IF NOT EXISTS line_fts USING fts5(
    text, text_ascii, line_id UNINDEXED, tokenize='trigram'
)
"""


def init_db() -> None:
    """Create tables and the full-text index. Idempotent."""
    from app import models  # noqa: F401  (registers mappers)

    Base.metadata.create_all(engine)
    if settings.is_sqlite:
        with engine.begin() as conn:
            conn.execute(text(FTS_DDL))
