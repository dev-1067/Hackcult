"""PP-OCRv5 recognisers run through ONNX Runtime (RapidOCR).

We only use the *recognition* head: PP-OCRv5's SVTR-based recogniser (a vision-transformer-style
mixing network over the line image) reads one text line at a time. Detection and layout are done by
our own pipeline, which is what makes it work on manuscripts (the stock detector drops many words).
"""

import logging
import threading

import numpy as np

from app.ocr.engines.base import EngineUnavailable, LineResult, OCREngine

log = logging.getLogger(__name__)

try:  # optional at import time so the API still starts if the wheel is missing
    from rapidocr import LangRec, ModelType, OCRVersion, RapidOCR

    _IMPORT_ERROR: Exception | None = None
except Exception as exc:  # pragma: no cover
    _IMPORT_ERROR = exc


def _lang_for(script: str):
    return {
        "devanagari": LangRec.DEVANAGARI,
        "latin": LangRec.EN,
        "tamil": LangRec.TA,
        "telugu": LangRec.TE,
        "kannada": LangRec.KA,
    }.get(script)


class RapidEngine(OCREngine):
    name = "ppocr"
    label = "PP-OCRv5 (SVTR) · ONNX"
    kind = "local"
    architecture = "SVTR transformer-mixing recogniser, CTC decoding, CPU via ONNX Runtime"

    def __init__(self) -> None:
        self._engines: dict[str, object] = {}
        self._lock = threading.Lock()

    def available(self) -> bool:
        return _IMPORT_ERROR is None

    def supported_scripts(self) -> set[str]:
        return {"devanagari", "latin", "tamil", "telugu", "kannada"}

    def _engine(self, script: str):
        if script in self._engines:
            return self._engines[script]
        lang = _lang_for(script)
        if lang is None:
            raise EngineUnavailable(f"PP-OCR has no recogniser for script '{script}'")
        logging.getLogger("RapidOCR").setLevel(logging.WARNING)
        last: Exception | None = None
        for version in (OCRVersion.PPOCRV5, OCRVersion.PPOCRV4):
            try:
                eng = RapidOCR(
                    params={
                        "Rec.lang_type": lang,
                        "Rec.ocr_version": version,
                        "Rec.model_type": ModelType.MOBILE,
                    }
                )
                self._engines[script] = eng
                return eng
            except Exception as exc:  # unsupported combination -> try the older model family
                last = exc
        raise EngineUnavailable(f"Could not load PP-OCR model for '{script}': {last}")

    def read_page_stock(self, image: np.ndarray, script: str) -> str:
        """Off-the-shelf PP-OCR (its own detector + recogniser) on a whole page. Used only as a
        benchmark baseline to show what our segmentation adds."""
        with self._lock:
            # Flags must be explicit: RapidOCR keeps the ones from the previous call (rec-only).
            out = self._engine(script)(image, use_det=True, use_cls=False, use_rec=True)
        boxes = getattr(out, "boxes", None)
        txts = list(getattr(out, "txts", None) or ())
        if boxes is None or not len(txts):
            return ""
        # Reading order: top-to-bottom by box centre, then left-to-right.
        order = sorted(range(len(txts)), key=lambda i: (round(float(np.mean(boxes[i][:, 1])) / 25), float(np.min(boxes[i][:, 0]))))
        return " ".join(txts[i] for i in order)

    def recognize(self, line_images: list[np.ndarray], script: str) -> list[LineResult]:
        if not self.available():
            raise EngineUnavailable(f"rapidocr not importable: {_IMPORT_ERROR}")
        with self._lock:
            eng = self._engine(script)
            results: list[LineResult] = []
            for img in line_images:
                if img.size == 0:
                    results.append(LineResult("", 0.0))
                    continue
                out = eng(img, use_det=False, use_cls=False, use_rec=True)
                txts = getattr(out, "txts", None) or ()
                scores = getattr(out, "scores", None) or ()
                text = " ".join(t for t in txts if t).strip()
                conf = float(np.mean(scores)) if len(scores) else 0.0
                results.append(LineResult(text, conf if text else 0.0))
            return results
