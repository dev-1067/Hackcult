"""Cross-script, typo-tolerant search over recognised lines.

Index: SQLite FTS5 with the trigram tokenizer. Trigrams work for any script (no word segmentation or
stemmer needed) and give substring matches inside long Sanskrit compounds. Each line is indexed twice:
in its own script and as plain ASCII romanisation ('rāmāyaṇa' -> 'ramayana'), so a query typed on a
normal keyboard finds Devanagari text.

Query plan:
    1. exact substring matches on every variant of the query (native, other script, romanised),
    2. if that is not enough, candidate lines sharing trigrams with the query, re-ranked with a
       partial edit-distance score so OCR errors ("धरम" vs "धर्म") still match.
"""

from dataclasses import dataclass

from rapidfuzz import fuzz
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Line, Manuscript, Page
from app.services.languages import ascii_fold, detect_script, latin_query_to_indic, searchable_ascii, transliterate

FUZZY_MIN_SCORE = 72


def index_lines(db: Session, lines: list[Line]) -> None:
    if not get_settings().is_sqlite or not lines:
        return
    ids = [ln.id for ln in lines]
    db.execute(text("DELETE FROM line_fts WHERE line_id IN (SELECT value FROM json_each(:ids))"), {"ids": _json(ids)})
    db.execute(
        text("INSERT INTO line_fts(text, text_ascii, line_id) VALUES (:t, :a, :id)"),
        [{"t": ln.text, "a": searchable_ascii(ln.text), "id": ln.id} for ln in lines if ln.text],
    )


def unindex_page(db: Session, page_id: str) -> None:
    if get_settings().is_sqlite:
        db.execute(
            text("DELETE FROM line_fts WHERE line_id IN (SELECT id FROM lines WHERE page_id = :p)"), {"p": page_id}
        )


def rebuild_index(db: Session) -> int:
    if not get_settings().is_sqlite:
        return 0
    db.execute(text("DELETE FROM line_fts"))
    lines = db.scalars(select(Line)).all()
    index_lines(db, list(lines))
    return len(lines)


def _json(values: list[str]) -> str:
    import json

    return json.dumps(values)


def _quote(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'


@dataclass
class Variants:
    native: list[str]  # searched against line text
    ascii: list[str]  # searched against romanised text


def query_variants(q: str) -> Variants:
    q = " ".join(q.split())
    script = detect_script(q)
    native, asc = [], []
    if script == "latin":
        native.extend(latin_query_to_indic(q))
        native.extend(transliterate(v, "gujarati", "devanagari") for v in list(native))
        folded = ascii_fold(q)
        if folded:
            asc.append(folded)
    else:
        native.append(q)
        for target in ("devanagari", "gujarati"):
            v = transliterate(q, target, script)
            if v not in native:
                native.append(v)
        folded = searchable_ascii(q)
        if folded:
            asc.append(folded)
    return Variants([v for v in native if v], [v for v in asc if v])


def _trigrams(s: str) -> set[str]:
    s = s.replace('"', "")
    return {s[i : i + 3] for i in range(len(s) - 2) if s[i : i + 3].strip() and " " not in s[i : i + 3]}


def _candidate_ids_sqlite(db: Session, v: Variants, fuzzy: bool, cap: int) -> list[str]:
    clauses = []
    for n in v.native:
        if len(n) >= 3:
            clauses.append(f"text : {_quote(n)}")
    for a in v.ascii:
        if len(a) >= 3:
            clauses.append(f"text_ascii : {_quote(a)}")
    if fuzzy:
        for n in v.native:
            clauses.extend(f"text : {_quote(t)}" for t in _trigrams(n))
        for a in v.ascii:
            clauses.extend(f"text_ascii : {_quote(t)}" for t in _trigrams(a))
    if not clauses:
        return []
    match = " OR ".join(dict.fromkeys(clauses))
    rows = db.execute(
        text("SELECT line_id FROM line_fts WHERE line_fts MATCH :m ORDER BY rank LIMIT :cap"), {"m": match, "cap": cap}
    ).all()
    return [r[0] for r in rows]


def _candidate_ids_like(db: Session, v: Variants, fuzzy: bool, cap: int) -> list[str]:
    """Portable fallback for non-SQLite databases: substring filter, or a capped scan for fuzzy ranking."""
    from sqlalchemy import or_

    stmt = select(Line.id).where(Line.text != "")
    if v.native and not fuzzy:
        stmt = stmt.where(or_(*[Line.text.ilike(f"%{t}%") for t in v.native]))
    return list(db.scalars(stmt.limit(cap)).all())


def min_fuzzy_score(query_ascii: str) -> int:
    """Short words need near-exact matches, or every long line 'matches' something."""
    n = len(query_ascii.replace(" ", ""))
    if n <= 4:
        return 100
    if n <= 6:
        return 85
    return 80


def _score(line_text: str, ascii_text: str, v: Variants) -> tuple[int, str, tuple[int, int] | None]:
    for n in v.native:
        i = line_text.find(n)
        if i >= 0:
            return 100, "text", (i, i + len(n))
    best = (0, "ascii", None)
    # Fuzzy matching is done on the romanised form so every script is scored the same way.
    for a in v.ascii:
        i = ascii_text.find(a)
        if i >= 0:
            return 99, "ascii", None
        al = fuzz.partial_ratio_alignment(a, ascii_text)
        if al and al.score > best[0]:
            best = (round(al.score), "ascii", None)
    return best


def search(
    db: Session,
    q: str,
    *,
    script: str | None = None,
    language: str | None = None,
    manuscript_id: str | None = None,
    site_id: str | None = None,
    verified_only: bool = False,
    limit: int = 30,
    offset: int = 0,
) -> dict:
    v = query_variants(q)
    settings = get_settings()

    def candidates(fuzzy: bool) -> list[str]:
        if settings.is_sqlite:
            return _candidate_ids_sqlite(db, v, fuzzy, cap=3000)
        return _candidate_ids_like(db, v, fuzzy, cap=3000)

    ids = candidates(fuzzy=False)
    fuzzy_used = False
    if len(ids) < limit + offset:
        more = candidates(fuzzy=True)
        fuzzy_used = len(more) > len(ids)
        ids = list(dict.fromkeys(ids + more))
    if not ids:
        return {"query": q, "variants": v.native + v.ascii, "total": 0, "fuzzy": False, "results": []}

    stmt = (
        select(Line, Page, Manuscript)
        .join(Page, Line.page_id == Page.id)
        .join(Manuscript, Page.manuscript_id == Manuscript.id)
        .where(Line.id.in_(ids))
    )
    if script:
        stmt = stmt.where(Manuscript.script == script)
    if language:
        stmt = stmt.where(Manuscript.language == language)
    if manuscript_id:
        stmt = stmt.where(Manuscript.id == manuscript_id)
    if site_id:
        stmt = stmt.where(Manuscript.site_id == site_id)
    if verified_only:
        stmt = stmt.where(Line.verified.is_(True))

    threshold = max(FUZZY_MIN_SCORE, min_fuzzy_score(v.ascii[0])) if v.ascii else 100
    scored = []
    for line, page, ms in db.execute(stmt).all():
        score, field, span = _score(line.text, searchable_ascii(line.text), v)
        if score < threshold and score < 99:
            continue
        scored.append((score, line, page, ms, field, span))
    scored.sort(key=lambda r: (-r[0], -r[1].confidence))

    results = []
    for score, line, page, ms, field, span in scored[offset : offset + limit]:
        results.append(
            {
                "line_id": line.id,
                "text": line.text,
                "iast": transliterate(line.text, "iast"),
                "match_field": field,
                "highlight": list(span) if span else None,
                "score": score,
                "exact": score >= 99,
                "confidence": line.confidence,
                "verified": line.verified,
                "line_no": line.line_no,
                "page_id": page.id,
                "page_no": page.page_no,
                "manuscript_id": ms.id,
                "manuscript_title": ms.title,
                "script": ms.script,
                "language": ms.language,
            }
        )
    return {
        "query": q,
        "variants": v.native + v.ascii,
        "total": len(scored),
        "fuzzy": fuzzy_used and any(s[0] < 99 for s in scored),
        "results": results,
    }
