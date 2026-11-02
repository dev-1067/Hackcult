"""Line segmentation by horizontal projection profile.

Devanagari and Gujarati-style scripts are written on a strong baseline/headline, so every text row
produces a clear peak in the row-wise ink count. We:
    1. estimate the typical glyph height from connected components,
    2. smooth the row profile with a Gaussian sized to that height,
    3. take rows above an adaptive threshold as text bands,
    4. merge bands split by vowel signs (matras) and split bands that hold two lines,
    5. inside each band, trim margins and split on wide horizontal gaps (columns / marginalia).
"""

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class Box:
    x: int
    y: int
    w: int
    h: int


def estimate_glyph_height(ink: np.ndarray) -> float:
    n, _, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    if n <= 1:
        return 0.0
    heights = stats[1:, cv2.CC_STAT_HEIGHT]
    widths = stats[1:, cv2.CC_STAT_WIDTH]
    areas = stats[1:, cv2.CC_STAT_AREA]
    page_h = ink.shape[0]
    keep = (heights > 3) & (heights < page_h * 0.25) & (areas > 8) & (widths < ink.shape[1] * 0.5)
    if not keep.any():
        return float(np.median(heights))
    return float(np.median(heights[keep]))


def _smooth(profile: np.ndarray, sigma: float) -> np.ndarray:
    radius = max(1, int(3 * sigma))
    xs = np.arange(-radius, radius + 1)
    kernel = np.exp(-(xs**2) / (2 * sigma * sigma))
    kernel /= kernel.sum()
    return np.convolve(profile, kernel, mode="same")


def _bands(mask: np.ndarray) -> list[tuple[int, int]]:
    bands, start = [], None
    for i, on in enumerate(mask):
        if on and start is None:
            start = i
        elif not on and start is not None:
            bands.append((start, i - 1))
            start = None
    if start is not None:
        bands.append((start, len(mask) - 1))
    return bands


def _split_tall(band: tuple[int, int], profile: np.ndarray, line_h: float) -> list[tuple[int, int]]:
    top, bottom = band
    height = bottom - top + 1
    if height < 1.8 * line_h:
        return [band]
    pieces = max(2, round(height / line_h))
    cuts = []
    for i in range(1, pieces):
        centre = top + round(i * height / pieces)
        lo, hi = max(top + 1, centre - int(line_h * 0.4)), min(bottom - 1, centre + int(line_h * 0.4))
        if hi > lo:
            cuts.append(lo + int(np.argmin(profile[lo:hi])))
    edges = [top, *sorted(set(cuts)), bottom]
    return [(edges[i], edges[i + 1]) for i in range(len(edges) - 1) if edges[i + 1] - edges[i] > line_h * 0.3]


def _horizontal_chunks(row_ink: np.ndarray, line_h: float) -> list[tuple[int, int]]:
    cols = row_ink.sum(axis=0) > 0
    if not cols.any():
        return []
    gap = max(8, int(line_h * 3.0))
    # Close small gaps (spaces between words) so only wide gaps split the row.
    closed = cv2.morphologyEx(cols.astype(np.uint8)[None, :], cv2.MORPH_CLOSE, np.ones((1, gap), np.uint8))[0] > 0
    return [(a, b) for a, b in _bands(closed) if b - a > line_h * 0.8]


def segment_lines(ink: np.ndarray) -> list[Box]:
    """Return line boxes (reading order) for a binary page where ink == 255."""
    h, w = ink.shape
    binary = (ink > 0).astype(np.uint8)
    glyph_h = estimate_glyph_height(binary * 255)
    if glyph_h <= 0:
        return []
    line_h = max(6.0, glyph_h * 1.35)

    profile = binary.sum(axis=1).astype(np.float64)
    smooth = _smooth(profile, sigma=max(1.0, line_h / 6))
    positive = smooth[smooth > 0]
    if positive.size == 0:
        return []
    threshold = max(1.0, 0.12 * np.percentile(positive, 90))
    bands = _bands(smooth > threshold)

    # Merge bands separated by tiny gaps (detached matras / anusvara above the headline).
    merged: list[tuple[int, int]] = []
    for band in bands:
        if merged and band[0] - merged[-1][1] < line_h * 0.25 and (band[1] - merged[-1][0]) < 1.6 * line_h:
            merged[-1] = (merged[-1][0], band[1])
        else:
            merged.append(band)

    rows: list[tuple[int, int]] = []
    for band in merged:
        rows.extend(_split_tall(band, smooth, line_h))

    boxes: list[Box] = []
    # The smoothed bands already include vowel signs above and below the headline. Extra vertical
    # padding only pulls in fragments of neighbouring lines (OCR Lab: 0 pad 4.1% CER, 0.22 pad 5.9%).
    pad_y = max(1, int(round(line_h * 0.02)))
    pad_x = int(round(line_h * 0.3))
    for top, bottom in rows:
        if bottom - top < line_h * 0.35:
            continue
        row_ink = binary[top : bottom + 1]
        for x0, x1 in _horizontal_chunks(row_ink, line_h):
            if row_ink[:, x0 : x1 + 1].sum() < line_h * 2:
                continue
            y0, y1 = max(0, top - pad_y), min(h, bottom + 1 + pad_y)
            xa, xb = max(0, x0 - pad_x), min(w, x1 + 1 + pad_x)
            boxes.append(Box(xa, y0, xb - xa, y1 - y0))

    boxes.sort(key=lambda b: (b.y // max(1, int(line_h)), b.x))
    return boxes
