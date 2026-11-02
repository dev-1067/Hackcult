"""Page clean-up for historical manuscripts.

Steps (each one is a small pure function so it can be tested and benchmarked on its own):
    1. limit resolution        - keep processing time predictable
    2. crop to page            - drop scanner bed / table background
    3. contrast (CLAHE)        - recover faded ink locally, not globally
    4. denoise                 - remove speckle without eroding thin strokes
    5. Sauvola binarisation    - local threshold that survives stains and uneven light
    6. deskew                  - projection-profile search for the angle that makes rows sharpest
"""

from dataclasses import dataclass

import cv2
import numpy as np
from skimage.filters import threshold_sauvola


@dataclass
class Preprocessed:
    color: np.ndarray  # cropped + deskewed BGR page (what the viewer shows)
    gray: np.ndarray  # contrast-enhanced, denoised grayscale (fed to the recogniser)
    binary: np.ndarray  # uint8, 255 = ink, 0 = background
    skew_angle: float
    crop_box: tuple[int, int, int, int]  # x, y, w, h inside the (resized) original
    scale: float  # resize factor applied to the original


def limit_size(img: np.ndarray, max_side: int) -> tuple[np.ndarray, float]:
    h, w = img.shape[:2]
    longest = max(h, w)
    if longest <= max_side:
        return img, 1.0
    scale = max_side / longest
    return cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA), scale


def crop_to_page(img: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    """Crop to the largest bright-ish region when it clearly is a page lying on a darker background."""
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (0, 0), max(h, w) / 300)
    _, mask = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return img, (0, 0, w, h)
    x, y, cw, ch = cv2.boundingRect(max(contours, key=cv2.contourArea))
    area_ratio = (cw * ch) / (w * h)
    # Only crop when the page is clearly smaller than the frame but still most of it.
    if 0.35 < area_ratio < 0.95:
        pad = round(0.01 * max(cw, ch))
        x0, y0 = max(0, x - pad), max(0, y - pad)
        x1, y1 = min(w, x + cw + pad), min(h, y + ch + pad)
        return img[y0:y1, x0:x1], (x0, y0, x1 - x0, y1 - y0)
    return img, (0, 0, w, h)


def enhance_contrast(gray: np.ndarray) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def denoise(gray: np.ndarray) -> np.ndarray:
    return cv2.medianBlur(gray, 3)


def sauvola_binarize(gray: np.ndarray, window: int | None = None, k: float = 0.2) -> np.ndarray:
    """Return 255 for ink, 0 for background."""
    if window is None:
        window = max(15, (min(gray.shape[:2]) // 40) | 1)  # odd, scales with resolution
    window |= 1
    thresh = threshold_sauvola(gray, window_size=window, k=k)
    ink = (gray < thresh).astype(np.uint8) * 255
    # Remove isolated specks (smaller than ~0.002% of the page).
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    min_area = max(4, int(gray.size * 0.00002))
    small = np.where(stats[1:, cv2.CC_STAT_AREA] < min_area)[0] + 1
    if len(small):
        ink[np.isin(labels, small)] = 0
    return remove_frame(ink)


def remove_frame(ink: np.ndarray) -> np.ndarray:
    """Drop page edges, folds and ruling: components far larger than any glyph, or thin and touching the border."""
    h, w = ink.shape
    n, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    if n <= 1:
        return ink
    x, y = stats[1:, cv2.CC_STAT_LEFT], stats[1:, cv2.CC_STAT_TOP]
    cw, ch = stats[1:, cv2.CC_STAT_WIDTH], stats[1:, cv2.CC_STAT_HEIGHT]
    area = stats[1:, cv2.CC_STAT_AREA]
    huge = (cw > 0.6 * w) | (ch > 0.6 * h)
    touches = (x <= 1) | (y <= 1) | (x + cw >= w - 1) | (y + ch >= h - 1)
    sparse = area < 0.25 * cw * ch
    thin = (np.minimum(cw, ch) < 0.02 * max(h, w)) & (np.maximum(cw, ch) > 0.15 * min(h, w))
    drop = np.where(huge | (touches & (sparse | thin)))[0] + 1
    if len(drop):
        ink = ink.copy()
        ink[np.isin(labels, drop)] = 0
    return ink


def otsu_binarize(gray: np.ndarray) -> np.ndarray:
    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return ink


def _row_sharpness(ink_small: np.ndarray, angle: float) -> float:
    h, w = ink_small.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    rotated = cv2.warpAffine(ink_small, m, (w, h), flags=cv2.INTER_NEAREST, borderValue=0)
    profile = rotated.sum(axis=1, dtype=np.float64)
    return float(np.var(np.diff(profile)))


def estimate_skew(ink: np.ndarray, max_angle: float = 8.0) -> float:
    """Angle (degrees) that makes text rows sharpest: coarse 0.5 deg search, then 0.1 deg refine."""
    h, w = ink.shape
    scale = min(1.0, 900 / max(h, w))
    small = cv2.resize(ink, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    if small.sum() == 0:
        return 0.0
    coarse = np.arange(-max_angle, max_angle + 0.01, 0.5)
    best = max(coarse, key=lambda a: _row_sharpness(small, a))
    fine = np.arange(best - 0.5, best + 0.51, 0.1)
    best = max(fine, key=lambda a: _row_sharpness(small, a))
    return round(float(best), 2)


def rotate(img: np.ndarray, angle: float, border: int | tuple[int, int, int]) -> np.ndarray:
    if abs(angle) < 0.05:
        return img
    h, w = img.shape[:2]
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    interp = cv2.INTER_NEAREST if img.ndim == 2 and border == 0 else cv2.INTER_LINEAR
    return cv2.warpAffine(img, m, (w, h), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=border)


def _background_color(img: np.ndarray) -> tuple[int, int, int]:
    b, g, r = (int(np.median(img[..., c])) for c in range(3))
    return b, g, r


def preprocess(img: np.ndarray, max_side: int = 2400, deskew: bool = True) -> Preprocessed:
    if img.ndim == 2:
        img = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    elif img.shape[2] == 4:
        img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

    img, scale = limit_size(img, max_side)
    img, crop_box = crop_to_page(img)

    gray = denoise(enhance_contrast(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)))
    ink = sauvola_binarize(gray)

    angle = estimate_skew(ink) if deskew else 0.0
    if abs(angle) >= 0.05:
        img = rotate(img, angle, _background_color(img))
        gray = rotate(gray, angle, int(np.median(gray)))
        ink = rotate(ink, angle, 0)

    return Preprocessed(color=img, gray=gray, binary=ink, skew_angle=angle, crop_box=crop_box, scale=scale)
