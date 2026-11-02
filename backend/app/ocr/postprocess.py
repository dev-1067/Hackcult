import re
import unicodedata

_PIPES = [(re.compile(r"\s*\|\|\s*"), " ॥ "), (re.compile(r"\s*\|\s*"), " । ")]
_INDIC = re.compile(r"[ऀ-෿]")


def normalize_text(text: str, script: str) -> str:
    """Unicode NFC, Indic danda normalisation, whitespace clean-up."""
    text = unicodedata.normalize("NFC", text or "")
    if script != "latin" and _INDIC.search(text):
        for pattern, repl in _PIPES:
            text = pattern.sub(repl, text)
        # Common recogniser confusions in Devanagari: Latin 's' for avagraha, ':' for visarga.
        text = re.sub(r"(?<=[ऀ-ॿ])s(?=[ऀ-ॿ])", "ऽ", text)
        text = re.sub(r"(?<=[ऀ-ॿ]):", "ः", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text
