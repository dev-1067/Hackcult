import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def utcnow() -> datetime:
    """Naive UTC: SQLite has no timezone type, so we store UTC everywhere and add "Z" in the API."""
    return datetime.now(UTC).replace(tzinfo=None)


ROLES = ("viewer", "contributor", "curator", "admin")
ROLE_RANK = {r: i for i, r in enumerate(ROLES)}


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default="contributor")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Site(Base):
    """A heritage site or a manuscript repository, placed on the map."""

    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(200), index=True)
    kind: Mapped[str] = mapped_column(String(30), default="monument")  # unesco|monument|temple|repository|museum
    description: Mapped[str] = mapped_column(Text, default="")
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    city: Mapped[str] = mapped_column(String(100), default="")
    state: Mapped[str] = mapped_column(String(100), default="")
    era: Mapped[str] = mapped_column(String(100), default="")
    visit_minutes: Mapped[int] = mapped_column(Integer, default=45)
    source_url: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    manuscripts: Mapped[list["Manuscript"]] = relationship(back_populates="site")

    __table_args__ = (Index("ix_sites_latlng", "lat", "lng"),)


class Manuscript(Base):
    __tablename__ = "manuscripts"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(300), index=True)
    script: Mapped[str] = mapped_column(String(30), default="devanagari")
    language: Mapped[str] = mapped_column(String(10), default="sa")
    century: Mapped[int | None] = mapped_column(Integer, nullable=True)
    material: Mapped[str] = mapped_column(String(30), default="paper")
    repository: Mapped[str] = mapped_column(String(200), default="")
    site_id: Mapped[str | None] = mapped_column(ForeignKey("sites.id", ondelete="SET NULL"), nullable=True, index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    license: Mapped[str] = mapped_column(String(120), default="")
    source_url: Mapped[str] = mapped_column(String(500), default="")
    uploaded_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    site: Mapped[Site | None] = relationship(back_populates="manuscripts")
    pages: Mapped[list["Page"]] = relationship(
        back_populates="manuscript", cascade="all, delete-orphan", order_by="Page.page_no"
    )


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    manuscript_id: Mapped[str] = mapped_column(ForeignKey("manuscripts.id", ondelete="CASCADE"), index=True)
    page_no: Mapped[int] = mapped_column(Integer)
    image_key: Mapped[str] = mapped_column(String(300))
    normalized_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    binary_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    width: Mapped[int] = mapped_column(Integer, default=0)
    height: Mapped[int] = mapped_column(Integer, default=0)
    norm_width: Mapped[int] = mapped_column(Integer, default=0)
    norm_height: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|queued|processing|done|failed
    engine: Mapped[str] = mapped_column(String(40), default="")
    mean_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    skew_angle: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    manuscript: Mapped[Manuscript] = relationship(back_populates="pages")
    lines: Mapped[list["Line"]] = relationship(
        back_populates="page", cascade="all, delete-orphan", order_by="Line.line_no"
    )

    __table_args__ = (UniqueConstraint("manuscript_id", "page_no", name="uq_page_no"),)


class Job(Base):
    """Background work item. Claimed by a worker with a lease so crashed jobs are retried."""

    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    kind: Mapped[str] = mapped_column(String(20), default="ocr")  # ocr|benchmark
    page_id: Mapped[str | None] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), nullable=True, index=True)
    engine_requested: Mapped[str] = mapped_column(String(40), default="auto")
    engine_used: Mapped[str] = mapped_column(String(40), default="")
    options: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="queued", index=True)  # queued|running|done|failed
    stage: Mapped[str] = mapped_column(String(60), default="Queued")
    progress: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    error: Mapped[str] = mapped_column(Text, default="")
    idempotency_key: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True)
    available_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result: Mapped[dict] = mapped_column(JSON, default=dict)

    __table_args__ = (Index("ix_jobs_claim", "status", "available_at"),)


class Line(Base):
    __tablename__ = "lines"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    line_no: Mapped[int] = mapped_column(Integer)
    x: Mapped[int] = mapped_column(Integer)
    y: Mapped[int] = mapped_column(Integer)
    w: Mapped[int] = mapped_column(Integer)
    h: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text, default="")
    ocr_text: Mapped[str] = mapped_column(Text, default="")
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    engine: Mapped[str] = mapped_column(String(40), default="")
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    page: Mapped[Page] = relationship(back_populates="lines")
    corrections: Mapped[list["Correction"]] = relationship(back_populates="line", cascade="all, delete-orphan")


class Correction(Base):
    __tablename__ = "corrections"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    line_id: Mapped[str] = mapped_column(ForeignKey("lines.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    previous_text: Mapped[str] = mapped_column(Text, default="")
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)  # pending|approved|rejected
    reviewer_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    review_note: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    line: Mapped[Line] = relationship(back_populates="corrections")
    user: Mapped[User | None] = relationship(foreign_keys=[user_id])


class Translation(Base):
    __tablename__ = "translations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    line_id: Mapped[str] = mapped_column(ForeignKey("lines.id", ondelete="CASCADE"), index=True)
    target_lang: Mapped[str] = mapped_column(String(10))
    source_hash: Mapped[str] = mapped_column(String(64))
    text: Mapped[str] = mapped_column(Text)
    provider: Mapped[str] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (UniqueConstraint("line_id", "target_lang", "source_hash", name="uq_translation"),)


class Trail(Base):
    __tablename__ = "trails"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200))
    mode: Mapped[str] = mapped_column(String(10), default="drive")  # walk|drive
    start_lat: Mapped[float] = mapped_column(Float)
    start_lng: Mapped[float] = mapped_column(Float)
    total_km: Mapped[float] = mapped_column(Float, default=0)
    total_minutes: Mapped[int] = mapped_column(Integer, default=0)
    routing: Mapped[str] = mapped_column(String(20), default="osrm")  # osrm|straight-line
    geometry: Mapped[dict] = mapped_column(JSON, default=dict)
    stops: Mapped[list] = mapped_column(JSON, default=list)  # ordered list of site ids
    legs: Mapped[list] = mapped_column(JSON, default=list)
    is_public: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    user_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    action: Mapped[str] = mapped_column(String(60))
    entity: Mapped[str] = mapped_column(String(40))
    entity_id: Mapped[str] = mapped_column(String(64), default="")
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
