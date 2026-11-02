"""Engine orchestration: pick engines for a script, fall back on failure, trip a circuit breaker
when an engine keeps failing so a broken engine does not slow every job down."""

import logging
import threading
import time
from dataclasses import dataclass, field

import numpy as np

from app.ocr.engines import EngineUnavailable, LineResult, OCREngine, get_engine, list_engines

log = logging.getLogger(__name__)


class NoEngineAvailable(RuntimeError):
    pass


@dataclass
class _Breaker:
    failures: int = 0
    open_until: float = 0.0


@dataclass
class CircuitBreaker:
    threshold: int = 3
    cooldown_s: float = 120.0
    _state: dict[str, _Breaker] = field(default_factory=dict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def is_open(self, name: str) -> bool:
        with self._lock:
            b = self._state.get(name)
            return bool(b and b.open_until > time.monotonic())

    def success(self, name: str) -> None:
        with self._lock:
            self._state[name] = _Breaker()

    def failure(self, name: str) -> None:
        with self._lock:
            b = self._state.setdefault(name, _Breaker())
            b.failures += 1
            if b.failures >= self.threshold:
                b.open_until = time.monotonic() + self.cooldown_s
                b.failures = 0
                log.warning("circuit opened for engine %s", name)


breaker = CircuitBreaker()


def candidates(script: str, requested: str = "auto") -> list[OCREngine]:
    if requested and requested != "auto":
        eng = get_engine(requested)
        if eng is None:
            raise NoEngineAvailable(f"Unknown engine '{requested}'")
        if not eng.supports(script):
            raise NoEngineAvailable(f"Engine '{eng.label}' cannot read {script} on this server")
        # An explicit choice still falls back to the others if it fails at run time.
        rest = [e for e in list_engines() if e is not eng and e.supports(script)]
        return [eng, *rest]
    found = [e for e in list_engines() if e.supports(script)]
    if not found:
        raise NoEngineAvailable(
            f"No OCR engine on this server supports {script}. "
            "Install Tesseract with the matching language data or set ANTHROPIC_API_KEY."
        )
    return found


def recognize(line_images: list[np.ndarray], script: str, requested: str = "auto") -> tuple[str, list[LineResult]]:
    errors = []
    for eng in candidates(script, requested):
        if breaker.is_open(eng.name):
            errors.append(f"{eng.name}: circuit open")
            continue
        try:
            results = eng.recognize(line_images, script)
            breaker.success(eng.name)
            return eng.name, results
        except EngineUnavailable as exc:
            errors.append(f"{eng.name}: {exc}")
        except Exception as exc:  # engine crashed: count it against the breaker and try the next one
            log.exception("engine %s failed", eng.name)
            breaker.failure(eng.name)
            errors.append(f"{eng.name}: {exc}")
    raise NoEngineAvailable("All engines failed - " + "; ".join(errors))
