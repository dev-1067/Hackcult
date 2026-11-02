"""Correct Indic text rendering (HarfBuzz shaping + FreeType rasterising).

Pillow without libraqm places vowel signs and conjuncts wrongly for Devanagari/Gujarati, which would
corrupt benchmark ground truth. HarfBuzz is the shaping engine browsers use, so the rendered page is
exactly what the reference text says.
"""

from functools import lru_cache
from pathlib import Path

import freetype
import numpy as np
import uharfbuzz as hb

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"
FONTS = {
    "devanagari-sans": FONT_DIR / "NotoSansDevanagari.ttf",
    "devanagari-serif": FONT_DIR / "NotoSerifDevanagari.ttf",
    "gujarati-sans": FONT_DIR / "NotoSansGujarati.ttf",
}


@lru_cache(maxsize=8)
def _font(name: str):
    path = FONTS[name]
    blob = hb.Blob.from_file_path(str(path))
    face = hb.Face(blob)
    return hb.Font(face), freetype.Face(str(path)), face.upem


def render_line(text: str, font: str = "devanagari-sans", size_px: int = 48) -> np.ndarray:
    """Return a uint8 coverage mask (255 = ink) tightly containing the shaped line."""
    hb_font, ft_face, upem = _font(font)
    ft_face.set_pixel_sizes(0, size_px)
    scale = size_px / upem

    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hb_font, buf, {"kern": True, "liga": True})

    ascent = int(ft_face.size.ascender / 64)
    descent = int(-ft_face.size.descender / 64)
    pad = size_px // 2
    width = int(sum(p.x_advance for p in buf.glyph_positions) * scale) + 2 * pad
    height = ascent + descent + 2 * pad
    canvas = np.zeros((height, max(width, 1)), dtype=np.uint8)

    pen_x, baseline = float(pad), pad + ascent
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions, strict=True):
        ft_face.load_glyph(info.codepoint, freetype.FT_LOAD_RENDER | freetype.FT_LOAD_TARGET_NORMAL)
        slot = ft_face.glyph
        bmp = slot.bitmap
        if bmp.width and bmp.rows:
            glyph = np.array(bmp.buffer, dtype=np.uint8).reshape(bmp.rows, bmp.pitch)[:, : bmp.width]
            x = int(round(pen_x + pos.x_offset * scale)) + slot.bitmap_left
            y = baseline - int(round(pos.y_offset * scale)) - slot.bitmap_top
            x0, y0 = max(0, x), max(0, y)
            x1, y1 = min(canvas.shape[1], x + bmp.width), min(canvas.shape[0], y + bmp.rows)
            if x1 > x0 and y1 > y0:
                region = canvas[y0:y1, x0:x1]
                np.maximum(region, glyph[y0 - y : y1 - y, x0 - x : x1 - x], out=region)
        pen_x += pos.x_advance * scale

    cols = np.where(canvas.max(axis=0) > 0)[0]
    rows = np.where(canvas.max(axis=1) > 0)[0]
    if cols.size == 0:
        return canvas
    return canvas[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]
