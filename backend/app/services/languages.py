"""Languages, scripts and transliteration between them."""

import re
import unicodedata
from functools import lru_cache

from indic_transliteration import sanscript

LANGUAGES: dict[str, dict] = {
    "sa": {"label": "Sanskrit", "script": "devanagari"},
    "hi": {"label": "Hindi", "script": "devanagari"},
    "mr": {"label": "Marathi", "script": "devanagari"},
    "ne": {"label": "Nepali", "script": "devanagari"},
    "pra": {"label": "Prakrit", "script": "devanagari"},
    "gu": {"label": "Gujarati", "script": "gujarati"},
    "en": {"label": "English", "script": "latin"},
    "ta": {"label": "Tamil", "script": "tamil"},
    "te": {"label": "Telugu", "script": "telugu"},
    "kn": {"label": "Kannada", "script": "kannada"},
}

_SANSCRIPT = {
    "devanagari": sanscript.DEVANAGARI,
    "gujarati": sanscript.GUJARATI,
    "tamil": sanscript.TAMIL,
    "telugu": sanscript.TELUGU,
    "kannada": sanscript.KANNADA,
}

TARGETS = {
    "iast": sanscript.IAST,
    "devanagari": sanscript.DEVANAGARI,
    "gujarati": sanscript.GUJARATI,
    "itrans": sanscript.ITRANS,
}

_RANGES = [
    ("devanagari", 0x0900, 0x097F),
    ("gujarati", 0x0A80, 0x0AFF),
    ("tamil", 0x0B80, 0x0BFF),
    ("telugu", 0x0C00, 0x0C7F),
    ("kannada", 0x0C80, 0x0CFF),
]


def detect_script(text: str) -> str:
    counts: dict[str, int] = {}
    for ch in text:
        cp = ord(ch)
        for name, lo, hi in _RANGES:
            if lo <= cp <= hi:
                counts[name] = counts.get(name, 0) + 1
                break
    return max(counts, key=counts.get) if counts else "latin"


@lru_cache(maxsize=20000)
def transliterate(text: str, target: str, source_script: str | None = None) -> str:
    """Convert Indic text to IAST / Devanagari / Gujarati / ITRANS. Latin input is returned as-is."""
    if not text:
        return ""
    src = source_script or detect_script(text)
    if src == "latin" or src not in _SANSCRIPT:
        return text
    tgt = TARGETS.get(target)
    if tgt is None:
        raise ValueError(f"unknown target '{target}'")
    if _SANSCRIPT[src] == tgt:
        return text
    return sanscript.transliterate(text, _SANSCRIPT[src], tgt)


def ascii_fold(text: str) -> str:
    """'Rāmāyaṇa' -> 'ramayana'. Lets people search Indic text with a plain keyboard."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", "", stripped.lower())).strip()


def searchable_ascii(text: str) -> str:
    script = detect_script(text)
    roman = transliterate(text, "iast", script) if script != "latin" else text
    return ascii_fold(roman)


def latin_query_to_indic(query: str) -> list[str]:
    """Interpret a Latin query as ITRANS / Harvard-Kyoto / IAST and render it in Devanagari."""
    out = []
    for scheme in (sanscript.ITRANS, sanscript.HK, sanscript.IAST):
        try:
            converted = sanscript.transliterate(query, scheme, sanscript.DEVANAGARI)
        except Exception:
            continue
        if converted and converted not in out and re.search(r"[ऀ-ॿ]", converted):
            out.append(converted)
    return out
