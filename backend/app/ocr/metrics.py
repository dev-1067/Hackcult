"""Character and word error rates (edit distance / reference length)."""

import unicodedata


def levenshtein(a: list | str, b: list | str) -> int:
    if len(a) < len(b):
        a, b = b, a
    previous = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        current = [i]
        for j, cb in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (ca != cb)))
        previous = current
    return previous[-1]


def _clean(s: str) -> str:
    return " ".join(unicodedata.normalize("NFC", s).split())


def cer(prediction: str, reference: str) -> float:
    ref, pred = _clean(reference), _clean(prediction)
    if not ref:
        return 0.0 if not pred else 1.0
    return levenshtein(pred, ref) / len(ref)


def wer(prediction: str, reference: str) -> float:
    ref, pred = _clean(reference).split(), _clean(prediction).split()
    if not ref:
        return 0.0 if not pred else 1.0
    return levenshtein(pred, ref) / len(ref)
