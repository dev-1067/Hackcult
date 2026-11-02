"""Line translation with a database cache keyed by the exact source text."""

import hashlib

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Line, Translation
from app.services.languages import LANGUAGES

TARGET_LANGS = {"en": "English", "hi": "Hindi", "gu": "Gujarati"}


class TranslationUnavailable(RuntimeError):
    pass


def provider_status() -> dict:
    key = bool(get_settings().anthropic_api_key)
    return {
        "available": key,
        "provider": "claude" if key else None,
        "message": "" if key else "Translation needs an Anthropic API key. Set ANTHROPIC_API_KEY in backend/.env.",
    }


def _claude_translate(text: str, source_lang: str, target_lang: str) -> str:
    import anthropic

    settings = get_settings()
    client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=60.0, max_retries=2)
    src = LANGUAGES.get(source_lang, {}).get("label", source_lang)
    prompt = (
        f"Translate this line from a historical {src} manuscript into {TARGET_LANGS[target_lang]}. "
        "It may contain OCR errors; translate the most likely intended meaning. "
        "Reply with only the translation, no notes.\n\n"
        f"{text}"
    )
    try:
        response = client.beta.messages.create(
            model=settings.anthropic_model,
            max_tokens=2000,
            output_config={"effort": "low"},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": prompt}],
        )
    except anthropic.AuthenticationError as exc:
        raise TranslationUnavailable("The Anthropic API key was rejected") from exc
    except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as exc:
        raise TranslationUnavailable(f"Translation service error: {exc}") from exc
    if response.stop_reason == "refusal":
        raise TranslationUnavailable("The translation request was declined")
    return "".join(b.text for b in response.content if b.type == "text").strip()


def translate_line(db: Session, line: Line, source_lang: str, target_lang: str) -> Translation:
    if target_lang not in TARGET_LANGS:
        raise ValueError(f"unsupported target language '{target_lang}'")
    source_hash = hashlib.sha256(f"{source_lang}|{line.text}".encode()).hexdigest()
    cached = db.scalar(
        select(Translation).where(
            Translation.line_id == line.id,
            Translation.target_lang == target_lang,
            Translation.source_hash == source_hash,
        )
    )
    if cached:
        return cached
    if not get_settings().anthropic_api_key:
        raise TranslationUnavailable(provider_status()["message"])
    out = Translation(
        line_id=line.id,
        target_lang=target_lang,
        source_hash=source_hash,
        text=_claude_translate(line.text, source_lang, target_lang),
        provider="claude",
    )
    db.add(out)
    db.commit()
    return out
