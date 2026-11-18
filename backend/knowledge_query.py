"""Small, inspectable query aids; neither source text nor user input is rewritten.

Synonyms are retrieval hints for the current scene, not equivalence claims about
medical treatments or products. Spelling suggestions only target the allowlisted
business vocabulary below when that target is present in the eligible corpus.
The caller must build ``vocabulary`` AFTER scope, review and date filtering.
"""
from __future__ import annotations

from collections.abc import Iterable
import re
import unicodedata

from rapidfuzz.distance import Levenshtein

from backend.knowledge_text import terms


QUERY_POLICY_VERSION = "2026-11-17.1"
MAX_EXPANSIONS = 16
MAX_CORRECTIONS = 3
GENERIC_EXPANSIONS = {"时间", "时段"}

# Match phrases before tokenizing their alternatives, so colloquial questions
# such as "约个时间" still recall the indexed token "预约". Keep the groups
# scene-specific; no medical intervention, brand or efficacy synonym is added.
SYNONYM_GROUPS = {
    "medical": (
        ("预约", "预订时段", "约时间", "约个时间"),
        ("到店", "来店", "到院", "来院"),
        ("改期", "改约"),
        ("营业时间", "开门时间"),
    ),
    "live": (
        ("退货", "退换货"),
        ("物流", "快递"),
        ("运费", "邮费"),
        ("发货", "寄出"),
        ("下单", "订购", "购买"),
    ),
}

# These are suggestions, not automatic synonyms. Two-character Chinese input
# is never fuzzy-matched; only the explicit, reviewed pairs below are eligible.
KNOWN_TYPOS = {
    "medical": {"预跃": "预约", "予约": "预约"},
    "live": {"优恵券": "优惠券", "忧惠券": "优惠券"},
}
FUZZY_TARGETS = {
    "medical": {"预约流程", "营业时间", "booking", "appointment"},
    "live": {"优惠券", "直播间", "售后服务", "退款流程", "发货时间",
             "coupon", "delivery", "shipping", "refund"},
}
PROTECTED_TERMS = {"医美", "超声炮", "热玛吉", "水光", "知情同意"}
CHINESE_RUN = re.compile(r"[\u3400-\u9fff]+")
LATIN_WORD = re.compile(r"[A-Za-zＡ-Ｚａ-ｚ]{4,30}")


def _normalized(text: str) -> str:
    return unicodedata.normalize("NFKC", text).lower()


def _protected(span: str, vocabulary: set[str], present_words: list[str]) -> bool:
    # Do not suggest changing an exact known term, or a fragment of a longer
    # known term (which may be a brand). Targets never include medical names.
    return span in vocabulary or any(
        span in word
        for word in present_words
        if len(word) > len(span)
    )


def _corrections(query: str, scene: str, vocabulary: set[str]) -> list[dict]:
    normalized = _normalized(query)
    present_words = [word for word in vocabulary | PROTECTED_TERMS
                     if len(word) > 2 and word in normalized]
    suggestions: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def append(start: int, end: int, target: str):
        original = query[start:end]
        value = _normalized(original)
        key = (value, target)
        if (len(suggestions) >= MAX_CORRECTIONS or key in seen
                or _protected(value, vocabulary, present_words)):
            return
        seen.add(key)
        suggestions.append({"original": original, "suggestion": target,
                            "query": query[:start] + target + query[end:]})

    for typo, target in KNOWN_TYPOS.get(scene, {}).items():
        if target not in vocabulary:
            continue
        for match in re.finditer(re.escape(typo), query):
            append(match.start(), match.end(), target)

    candidates = sorted(FUZZY_TARGETS.get(scene, set()) & vocabulary)
    if not candidates or len(suggestions) == MAX_CORRECTIONS:
        return suggestions
    chinese = [target for target in candidates if CHINESE_RUN.fullmatch(target) and len(target) >= 3]
    latin = [target for target in candidates if re.fullmatch(r"[a-z]{5,30}", target)]
    spans: list[tuple[int, int, list[str]]] = []
    for match in CHINESE_RUN.finditer(query):
        # A same-length, single-character typo only; no generic Chinese
        # word-boundary inference, insertion/deletion or pinyin correction.
        for size in sorted({len(target) for target in chinese}):
            pool = [target for target in chinese if len(target) == size]
            spans.extend((start, start + size, pool)
                         for start in range(match.start(), match.end() - size + 1))
    spans.extend((match.start(), match.end(), latin) for match in LATIN_WORD.finditer(query))
    for start, end, pool in spans:
        value = _normalized(query[start:end])
        if _protected(value, vocabulary, present_words):
            continue
        near = [target for target in pool
                if Levenshtein.distance(value, target, score_cutoff=1) == 1]
        # Ambiguous neighbours are intentionally not guessed.
        if len(near) == 1:
            append(start, end, near[0])
    return suggestions


def expand_query(query: str, scene: str, vocabulary: Iterable[str]) -> dict:
    """Return original tokens, bounded synonym tokens and opt-in corrections.

    ``terms`` is exactly the existing tokenizer's first 32 unique query tokens.
    Neither spelling suggestions nor their targets enter ``expanded_terms``.
    """
    original = terms(query)[:32]
    expanded: list[str] = []
    normalized = _normalized(query)
    for group in SYNONYM_GROUPS.get(scene, ()):
        if not any(phrase in normalized for phrase in group):
            continue
        for phrase in group:
            for token in terms(phrase):
                if token not in original and token not in expanded and token not in GENERIC_EXPANSIONS:
                    expanded.append(token)
    known = {_normalized(word) for word in vocabulary if isinstance(word, str) and word.strip()}
    return {"terms": original, "expanded_terms": expanded[:MAX_EXPANSIONS],
            "corrections": _corrections(query, scene, known)}
