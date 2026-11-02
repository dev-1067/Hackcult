"""Request validation models. Responses are shaped in app.serializers."""

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.ocr.engines import SCRIPTS
from app.services.languages import LANGUAGES

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class RegisterIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    email: str = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL.match(v):
            raise ValueError("Enter a valid email address")
        return v

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        return " ".join(v.split())


class LoginIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        return v.strip().lower()


class RefreshIn(BaseModel):
    refresh_token: str


class ProfileIn(BaseModel):
    name: str = Field(min_length=2, max_length=120)


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class RoleIn(BaseModel):
    role: Literal["viewer", "contributor", "curator", "admin"]
    is_active: bool = True


class ManuscriptIn(BaseModel):
    title: str = Field(min_length=2, max_length=300)
    language: str = "sa"
    script: str | None = None  # derived from the language when omitted
    century: int | None = Field(default=None, ge=1, le=21)
    material: Literal["paper", "palm_leaf", "birch_bark", "cloth", "print", "other"] = "paper"
    repository: str = Field(default="", max_length=200)
    site_id: str | None = None
    description: str = Field(default="", max_length=5000)
    license: str = Field(default="", max_length=120)
    source_url: str = Field(default="", max_length=500)

    @field_validator("language")
    @classmethod
    def _lang(cls, v: str) -> str:
        if v not in LANGUAGES:
            raise ValueError(f"Unsupported language '{v}'")
        return v

    @field_validator("script")
    @classmethod
    def _script(cls, v: str | None) -> str | None:
        if v is not None and v not in SCRIPTS:
            raise ValueError(f"Unsupported script '{v}'")
        return v

    @field_validator("source_url")
    @classmethod
    def _url(cls, v: str) -> str:
        if v and not v.startswith(("http://", "https://")):
            raise ValueError("Source URL must start with http:// or https://")
        return v


class OcrIn(BaseModel):
    engine: str = "auto"


class CorrectionIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ReviewIn(BaseModel):
    action: Literal["approve", "reject"]
    note: str = Field(default="", max_length=500)
    text: str | None = Field(default=None, max_length=2000)  # curator may adjust before approving


class TranslateIn(BaseModel):
    target: Literal["en", "hi", "gu"] = "en"


class SiteIn(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    kind: Literal["unesco", "monument", "temple", "repository", "museum", "stepwell", "fort", "other"] = "monument"
    description: str = Field(default="", max_length=5000)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    city: str = Field(default="", max_length=100)
    state: str = Field(default="", max_length=100)
    era: str = Field(default="", max_length=100)
    visit_minutes: int = Field(default=45, ge=5, le=600)
    source_url: str = Field(default="", max_length=500)


class TrailIn(BaseModel):
    name: str = Field(default="My heritage trail", min_length=2, max_length=200)
    mode: Literal["walk", "drive"] = "drive"
    start_lat: float = Field(ge=-90, le=90)
    start_lng: float = Field(ge=-180, le=180)
    site_ids: list[str] = Field(min_length=1, max_length=12)
    is_public: bool = True


class BenchmarkIn(BaseModel):
    script: Literal["devanagari"] = "devanagari"
    pages: int = Field(default=6, ge=2, le=20)
    difficulty: float = Field(default=1.0, ge=0.0, le=1.5)
