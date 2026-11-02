from abc import ABC, abstractmethod
from dataclasses import dataclass

import numpy as np

# Script id -> human label. Language codes map onto these scripts in app.services.languages.
SCRIPTS: dict[str, str] = {
    "devanagari": "Devanagari (Sanskrit, Hindi, Marathi, Nepali)",
    "gujarati": "Gujarati",
    "latin": "Latin (English, IAST romanisation)",
    "tamil": "Tamil",
    "telugu": "Telugu",
    "kannada": "Kannada",
}


class EngineUnavailable(RuntimeError):
    """The engine cannot run here (missing binary, model or API key) or does not support the script."""


@dataclass
class LineResult:
    text: str
    confidence: float  # 0..1


class OCREngine(ABC):
    """Recognises already-segmented line images. Segmentation is done by our own pipeline."""

    name: str
    label: str
    kind: str  # "local" | "cloud"
    architecture: str

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    def supported_scripts(self) -> set[str]: ...

    def supports(self, script: str) -> bool:
        return self.available() and script in self.supported_scripts()

    @abstractmethod
    def recognize(self, line_images: list[np.ndarray], script: str) -> list[LineResult]:
        """Return one result per input image, in the same order."""

    def describe(self) -> dict:
        ok = self.available()
        return {
            "name": self.name,
            "label": self.label,
            "kind": self.kind,
            "architecture": self.architecture,
            "available": ok,
            "scripts": sorted(self.supported_scripts()) if ok else [],
        }
