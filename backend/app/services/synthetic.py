"""Synthetic "aged manuscript" pages with exact ground truth, for the OCR Lab benchmark.

Text is real (public-domain Sanskrit verses and plain Hindi/Gujarati sentences), shaped with HarfBuzz,
then degraded the way photographed manuscripts are: parchment tint, stains, uneven light, ink bleed,
blur, sensor noise, skew, and the page lying on a darker table.
"""

from dataclasses import dataclass

import cv2
import numpy as np

from app.services.textrender import render_line

CORPUS: dict[str, list[str]] = {
    "devanagari": [
        "कर्मण्येवाधिकारस्ते मा फलेषु कदाचन ।",
        "मा कर्मफलहेतुर्भूर्मा ते सङ्गोऽस्त्वकर्मणि ॥",
        "यदा यदा हि धर्मस्य ग्लानिर्भवति भारत ।",
        "अभ्युत्थानमधर्मस्य तदात्मानं सृजाम्यहम् ॥",
        "परित्राणाय साधूनां विनाशाय च दुष्कृताम् ।",
        "धर्मसंस्थापनार्थाय सम्भवामि युगे युगे ॥",
        "ईशा वास्यमिदं सर्वं यत्किञ्च जगत्यां जगत् ।",
        "तेन त्यक्तेन भुञ्जीथा मा गृधः कस्यस्विद्धनम् ॥",
        "विद्या ददाति विनयं विनयाद्याति पात्रताम् ।",
        "पात्रत्वाद्धनमाप्नोति धनाद्धर्मं ततः सुखम् ॥",
        "अयं निजः परो वेति गणना लघुचेतसाम् ।",
        "उदारचरितानां तु वसुधैव कुटुम्बकम् ॥",
        "भारत की सांस्कृतिक धरोहर अत्यंत समृद्ध और विविध है ।",
        "पुरानी पांडुलिपियाँ ताड़पत्र और कागज़ पर लिखी जाती थीं ।",
        "इन ग्रंथों को सुरक्षित रखना हम सबका कर्तव्य है ।",
        "प्राचीन ज्ञान को पढ़ने योग्य बनाना ही इस परियोजना का लक्ष्य है ।",
    ],
    "gujarati": [
        "ગુજરાતની સાંસ્કૃતિક વિરાસત ખૂબ સમૃદ્ધ છે .",
        "રાણી કી વાવ પાટણમાં આવેલી પ્રાચીન વાવ છે .",
        "જૂની હસ્તપ્રતો તાડપત્ર અને કાગળ પર લખાતી હતી .",
        "આ ગ્રંથોને સાચવવા એ આપણી ફરજ છે .",
        "અમદાવાદ ભારતનું પહેલું વિશ્વ ધરોહર શહેર છે .",
        "જ્ઞાનને સૌ માટે સુલભ બનાવવું એ અમારું લક્ષ્ય છે .",
    ],
}

FONTS_FOR = {"devanagari": ["devanagari-sans", "devanagari-serif"], "gujarati": ["gujarati-sans"]}


@dataclass
class SyntheticPage:
    image: np.ndarray  # BGR
    lines: list[str]
    skew: float
    font: str


def _parchment(h: int, w: int, rng: np.random.Generator) -> np.ndarray:
    base = np.array([196, 222, 236], dtype=np.float32)  # BGR warm paper
    tint = rng.normal(0, 6, 3).astype(np.float32)
    noise = cv2.GaussianBlur(rng.normal(0, 1, (h // 8 + 1, w // 8 + 1)).astype(np.float32), (0, 0), 2)
    noise = cv2.resize(noise, (w, h)) * 9
    page = np.empty((h, w, 3), np.float32)
    for c in range(3):
        page[..., c] = base[c] + tint[c] + noise
    return page


def _stains(page: np.ndarray, rng: np.random.Generator, count: int) -> None:
    h, w = page.shape[:2]
    for _ in range(count):
        mask = np.zeros((h, w), np.float32)
        center = (int(rng.integers(0, w)), int(rng.integers(0, h)))
        axes = (int(rng.integers(w // 14, w // 5)), int(rng.integers(h // 14, h // 5)))
        cv2.ellipse(mask, center, axes, float(rng.uniform(0, 180)), 0, 360, 1.0, -1)
        mask = cv2.GaussianBlur(mask, (0, 0), max(axes) / 3)
        strength = rng.uniform(25, 60)
        page -= mask[..., None] * np.array([strength * 1.3, strength, strength * 0.6], np.float32)


def make_page(script: str = "devanagari", seed: int = 0, n_lines: int = 7, difficulty: float = 1.0) -> SyntheticPage:
    rng = np.random.default_rng(seed)
    corpus = CORPUS[script]
    picks = rng.choice(len(corpus), size=min(n_lines, len(corpus)), replace=False)
    lines = [corpus[i] for i in picks]
    font = str(rng.choice(FONTS_FOR[script]))
    size = int(rng.integers(34, 50))

    masks = [render_line(t, font, size) for t in lines]
    line_gap = int(size * rng.uniform(0.55, 0.9))
    margin = int(size * 1.6)
    width = max(m.shape[1] for m in masks) + 2 * margin
    height = sum(m.shape[0] for m in masks) + line_gap * (len(masks) - 1) + 2 * margin

    page = _parchment(height, width, rng)
    _stains(page, rng, int(rng.integers(1, 4) * difficulty))

    # Uneven illumination: a soft gradient across the page.
    gx = np.linspace(0, 1, width, dtype=np.float32)[None, :]
    gy = np.linspace(0, 1, height, dtype=np.float32)[:, None]
    light = 1.0 - difficulty * 0.28 * (rng.uniform(0.3, 1) * gx + rng.uniform(0.3, 1) * gy) / 2
    page *= light[..., None]

    ink = np.array([38, 46, 62], np.float32) + rng.normal(0, 6, 3).astype(np.float32)
    y = margin
    for m in masks:
        x = margin + int(rng.integers(0, max(1, width - 2 * margin - m.shape[1] + 1)))
        alpha = m.astype(np.float32) / 255.0
        if difficulty > 0:
            alpha = np.clip(cv2.GaussianBlur(alpha, (0, 0), 0.6 * difficulty) * 1.15, 0, 1)  # ink bleed
        region = page[y : y + m.shape[0], x : x + m.shape[1]]
        region[:] = region * (1 - alpha[..., None]) + ink * alpha[..., None]
        y += m.shape[0] + line_gap

    page = np.clip(page, 0, 255).astype(np.uint8)

    # Lay the page on a dark table with a border, then skew the whole photograph.
    border = int(max(height, width) * 0.08)
    table = np.full((height + 2 * border, width + 2 * border, 3), (52, 68, 84), np.uint8)
    table = (table.astype(np.int16) + rng.normal(0, 6, table.shape).astype(np.int16)).clip(0, 255).astype(np.uint8)
    table[border : border + height, border : border + width] = page
    skew = float(rng.uniform(-1, 1) * 4.5 * difficulty)
    h2, w2 = table.shape[:2]
    rot = cv2.getRotationMatrix2D((w2 / 2, h2 / 2), skew, 1.0)
    photo = cv2.warpAffine(table, rot, (w2, h2), flags=cv2.INTER_LINEAR, borderValue=(52, 68, 84))

    if difficulty > 0:
        photo = cv2.GaussianBlur(photo, (0, 0), 0.5 + 0.4 * difficulty)
        noise = rng.normal(0, 6 * difficulty, photo.shape)
        photo = np.clip(photo.astype(np.float32) + noise, 0, 255).astype(np.uint8)
        ok, enc = cv2.imencode(".jpg", photo, [cv2.IMWRITE_JPEG_QUALITY, int(70 - 15 * difficulty)])
        photo = cv2.imdecode(enc, cv2.IMREAD_COLOR)

    return SyntheticPage(photo, lines, round(skew, 2), font)
