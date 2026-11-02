"""End-to-end page OCR used by the worker and by the benchmark."""

import time
from collections.abc import Callable
from dataclasses import dataclass, field

import cv2
import numpy as np

from app.ocr import chain
from app.ocr.postprocess import normalize_text
from app.ocr.preprocess import Preprocessed, preprocess
from app.ocr.segment import Box, segment_lines

ProgressFn = Callable[[int, str], None]


@dataclass
class OCRLine:
    box: Box
    text: str
    confidence: float


@dataclass
class PageOCR:
    pre: Preprocessed
    lines: list[OCRLine]
    engine: str
    timings_ms: dict[str, int] = field(default_factory=dict)

    @property
    def mean_confidence(self) -> float | None:
        scored = [ln.confidence for ln in self.lines if ln.text]
        return round(float(np.mean(scored)), 4) if scored else None


def crop_lines(source: np.ndarray, boxes: list[Box]) -> list[np.ndarray]:
    crops = []
    for b in boxes:
        crop = source[b.y : b.y + b.h, b.x : b.x + b.w]
        if crop.ndim == 2:
            crop = cv2.cvtColor(crop, cv2.COLOR_GRAY2BGR)
        crops.append(crop)
    return crops


def _noop(_: int, __: str) -> None:
    pass


_SCRIPT_RANGES = {
    "devanagari": (0x0900, 0x097F),
    "gujarati": (0x0A80, 0x0AFF),
    "tamil": (0x0B80, 0x0BFF),
    "telugu": (0x0C00, 0x0C7F),
    "kannada": (0x0C80, 0x0CFF),
}


def _in_script(text: str, script: str) -> bool:
    if script == "latin":
        return any(ch.isalnum() for ch in text)
    lo, hi = _SCRIPT_RANGES.get(script, (0, 0x10FFFF))
    native = sum(1 for ch in text if lo <= ord(ch) <= hi)
    return native >= 2 and native >= 0.5 * sum(1 for ch in text if not ch.isspace())


def run_page_ocr(
    image: np.ndarray,
    script: str,
    engine: str = "auto",
    *,
    max_side: int = 2400,
    use_preprocessing: bool = True,
    progress: ProgressFn = _noop,
) -> PageOCR:
    t0 = time.perf_counter()
    timings: dict[str, int] = {}

    progress(10, "Cleaning page")
    if use_preprocessing:
        pre = preprocess(image, max_side=max_side)
    else:
        # Baseline for the benchmark: no contrast, denoise or deskew; plain Otsu for segmentation only.
        from app.ocr.preprocess import limit_size, otsu_binarize

        img, scale = limit_size(image if image.ndim == 3 else cv2.cvtColor(image, cv2.COLOR_GRAY2BGR), max_side)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        pre = Preprocessed(img, gray, otsu_binarize(gray), 0.0, (0, 0, img.shape[1], img.shape[0]), scale)
    timings["preprocess"] = round((time.perf_counter() - t0) * 1000)

    progress(35, "Finding text lines")
    t1 = time.perf_counter()
    boxes = segment_lines(pre.binary)
    timings["segment"] = round((time.perf_counter() - t1) * 1000)

    if not boxes:
        progress(95, "No text lines found")
        return PageOCR(pre, [], "", timings)

    progress(50, f"Reading {len(boxes)} lines")
    t2 = time.perf_counter()
    # Recognisers were trained on natural photos: the cropped, deskewed colour page reads better
    # than the CLAHE grey or binary images (measured in the OCR Lab while tuning).
    engine_used, results = chain.recognize(crop_lines(pre.color, boxes), script, engine)
    timings["recognize"] = round((time.perf_counter() - t2) * 1000)

    lines = [
        OCRLine(box, normalize_text(r.text, script), round(float(r.confidence), 4))
        for box, r in zip(boxes, results, strict=True)
    ]
    # Boxes that read as nothing, or as letters of a different script, are ornaments, borders or stains.
    lines = [ln for ln in lines if ln.text and _in_script(ln.text, script)]
    timings["total"] = round((time.perf_counter() - t0) * 1000)
    progress(90, "Saving results")
    return PageOCR(pre, lines, engine_used, timings)
