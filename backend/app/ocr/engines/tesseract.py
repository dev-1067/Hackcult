"""Tesseract 5 (LSTM) via its command-line binary, used when it is installed.

Adds Gujarati (`guj`) and a dedicated Sanskrit model (`san`). Nothing to install in Python: we call the
binary directly with `--psm 7` (single text line) and parse the TSV output for confidences.
"""

import os
import shutil
import subprocess
import tempfile
from functools import cached_property
from pathlib import Path

import cv2
import numpy as np

from app.config import get_settings
from app.ocr.engines.base import EngineUnavailable, LineResult, OCREngine

_COMMON_PATHS = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    "/usr/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/opt/homebrew/bin/tesseract",
]

_SCRIPT_LANGS = {
    "devanagari": ["san", "hin", "mar"],
    "gujarati": ["guj"],
    "latin": ["eng"],
    "tamil": ["tam"],
    "telugu": ["tel"],
    "kannada": ["kan"],
}


class TesseractEngine(OCREngine):
    name = "tesseract"
    label = "Tesseract 5 LSTM"
    kind = "local"
    architecture = "Bidirectional LSTM line recogniser (CLI)"

    @cached_property
    def binary(self) -> str | None:
        configured = get_settings().tesseract_cmd
        candidates = [configured] if configured else []
        candidates += [shutil.which("tesseract") or "", *_COMMON_PATHS]
        for c in candidates:
            if c and Path(c).exists():
                return c
        return None

    @cached_property
    def installed_langs(self) -> set[str]:
        if not self.binary:
            return set()
        try:
            out = subprocess.run([self.binary, "--list-langs"], capture_output=True, text=True, timeout=10)
            return {ln.strip() for ln in out.stdout.splitlines()[1:] if ln.strip()}
        except Exception:
            return set()

    def available(self) -> bool:
        return bool(self.binary) and bool(self.installed_langs)

    def supported_scripts(self) -> set[str]:
        return {s for s, langs in _SCRIPT_LANGS.items() if any(lang in self.installed_langs for lang in langs)}

    def recognize(self, line_images: list[np.ndarray], script: str) -> list[LineResult]:
        if not self.supports(script):
            raise EngineUnavailable(f"Tesseract language data for '{script}' is not installed")
        langs = "+".join(lang for lang in _SCRIPT_LANGS[script] if lang in self.installed_langs)
        results = []
        with tempfile.TemporaryDirectory() as tmp:
            for i, img in enumerate(line_images):
                path = os.path.join(tmp, f"l{i}.png")
                cv2.imwrite(path, img)
                proc = subprocess.run(
                    [self.binary, path, "stdout", "-l", langs, "--psm", "7", "tsv"],
                    capture_output=True,
                    timeout=60,
                )
                words, confs = [], []
                for row in proc.stdout.decode("utf-8", errors="replace").splitlines()[1:]:
                    cols = row.split("\t")
                    if len(cols) == 12 and cols[11].strip():
                        words.append(cols[11].strip())
                        try:
                            confs.append(max(0.0, float(cols[10])) / 100)
                        except ValueError:
                            pass
                text = " ".join(words)
                results.append(LineResult(text, float(np.mean(confs)) if confs and text else 0.0))
        return results
