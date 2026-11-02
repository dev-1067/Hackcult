from app.ocr.engines.base import OCREngine
from app.ocr.engines.claude import ClaudeEngine
from app.ocr.engines.rapid import RapidEngine
from app.ocr.engines.tesseract import TesseractEngine

# Order = preference for "auto": fast local transformer first, then Tesseract, then the cloud.
_ENGINES: dict[str, OCREngine] = {e.name: e for e in (RapidEngine(), TesseractEngine(), ClaudeEngine())}


def get_engine(name: str) -> OCREngine | None:
    return _ENGINES.get(name)


def list_engines() -> list[OCREngine]:
    return list(_ENGINES.values())
