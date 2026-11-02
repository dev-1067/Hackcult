"""Claude vision as an optional high-accuracy engine (only when ANTHROPIC_API_KEY is set).

Line crops are sent in small batches; the model returns a JSON array with one transcription per
image. Claude does not expose per-token probabilities, so confidence is the model's own 0-1 estimate.
"""

import base64
import json
import re

import cv2
import numpy as np

from app.config import get_settings
from app.ocr.engines.base import SCRIPTS, EngineUnavailable, LineResult, OCREngine

_BATCH = 12

_PROMPT = (
    "You are transcribing lines from a historical {script} manuscript for a digital archive. "
    "You will receive {n} images, each one line of text, in order. Transcribe each line exactly as written "
    "in its original script (do not translate, do not modernise spelling, keep dandas). "
    "If a line is illegible write an empty string. Respond with only a JSON array of {n} objects: "
    '[{{"text": "...", "confidence": 0.0-1.0}}, ...]'
)


class ClaudeEngine(OCREngine):
    name = "claude"
    label = "Claude vision (cloud)"
    kind = "cloud"
    architecture = "Multimodal transformer; transcribes line crops in batches"

    def available(self) -> bool:
        return bool(get_settings().anthropic_api_key)

    def supported_scripts(self) -> set[str]:
        return set(SCRIPTS)

    def _client(self):
        import anthropic

        return anthropic.Anthropic(api_key=get_settings().anthropic_api_key, timeout=120.0, max_retries=2)

    def recognize(self, line_images: list[np.ndarray], script: str) -> list[LineResult]:
        if not self.available():
            raise EngineUnavailable("ANTHROPIC_API_KEY is not configured")
        import anthropic

        client = self._client()
        settings = get_settings()
        results: list[LineResult] = []
        for start in range(0, len(line_images), _BATCH):
            batch = line_images[start : start + _BATCH]
            content: list[dict] = []
            for img in batch:
                ok, buf = cv2.imencode(".png", img)
                if not ok:
                    raise EngineUnavailable("could not encode line image")
                content.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": base64.standard_b64encode(buf.tobytes()).decode("ascii"),
                        },
                    }
                )
            content.append({"type": "text", "text": _PROMPT.format(script=SCRIPTS.get(script, script), n=len(batch))})
            try:
                response = client.beta.messages.create(
                    model=settings.anthropic_model,
                    max_tokens=16000,
                    output_config={"effort": "low"},
                    betas=["server-side-fallback-2026-07-01"],
                    fallbacks="default",
                    messages=[{"role": "user", "content": content}],
                )
            except anthropic.AuthenticationError as exc:
                raise EngineUnavailable("Anthropic API key was rejected") from exc
            except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as exc:
                raise EngineUnavailable(f"Claude request failed: {exc}") from exc
            if response.stop_reason == "refusal":
                raise EngineUnavailable("Claude declined this request")
            text = "".join(b.text for b in response.content if b.type == "text")
            results.extend(_parse(text, len(batch)))
        return results


def _parse(text: str, n: int) -> list[LineResult]:
    match = re.search(r"\[.*\]", text, re.S)
    items = []
    if match:
        try:
            items = json.loads(match.group(0))
        except json.JSONDecodeError:
            items = []
    out = []
    for i in range(n):
        item = items[i] if i < len(items) and isinstance(items[i], dict) else {}
        t = str(item.get("text", "")).strip()
        try:
            c = float(item.get("confidence", 0.8 if t else 0.0))
        except (TypeError, ValueError):
            c = 0.8 if t else 0.0
        out.append(LineResult(t, max(0.0, min(1.0, c))))
    return out
