"""Query aids preserve intent and cannot reveal unavailable corpus vocabulary."""
import pytest

from backend.knowledge_query import expand_query
from backend.knowledge_text import terms


def test_colloquial_phrase_expands_before_word_segmentation():
    query = "我想约个时间来院咨询"
    result = expand_query(query, "medical", {"预约", "到店", "咨询"})
    assert result["terms"] == terms(query)[:32]
    assert "预约" in result["expanded_terms"]
    assert "到店" in result["expanded_terms"]
    assert result["corrections"] == []
    assert query == "我想约个时间来院咨询"


def test_scene_specific_expansions():
    assert "快递" in expand_query("物流查询", "live", [])['expanded_terms']
    assert expand_query("物流查询", "medical", [])['expanded_terms'] == []
    assert expand_query("约个时间", "live", [])['expanded_terms'] == []
    assert expand_query("物流查询", "unknown", [])['expanded_terms'] == []


def test_expansion_is_unique_bounded_and_does_not_repeat_original_terms():
    result = expand_query("预约 约个时间 到院 来院 改期 营业时间", "medical", [])
    assert len(result["expanded_terms"]) <= 16
    assert len(result["expanded_terms"]) == len(set(result["expanded_terms"]))
    assert not set(result["terms"]) & set(result["expanded_terms"])


def test_booking_expansion_does_not_recall_every_document_mentioning_time():
    result = expand_query("预约", "medical", [])
    assert "时间" not in result["expanded_terms"]
    assert "时段" not in result["expanded_terms"]


def test_known_typo_only_suggests_and_preserves_rest_of_query():
    query = "请问：预跃的流程？"
    result = expand_query(query, "medical", {"预约", "流程"})
    assert result["terms"] == terms(query)
    assert "预约" not in result["expanded_terms"]
    assert result["corrections"] == [{"original": "预跃", "suggestion": "预约",
                                      "query": "请问：预约的流程？"}]
    assert query == "请问：预跃的流程？"


def test_known_typo_requires_eligible_corpus_term():
    assert expand_query("预跃", "medical", [])['corrections'] == []
    assert expand_query("预跃", "live", {"预约"})['corrections'] == []
    assert expand_query("预跃", "medical", {"预约", "预跃"})['corrections'] == []


def test_rapidfuzz_proposes_single_character_business_typo():
    result = expand_query("请问优慧券怎么领", "live", {"优惠券"})
    assert result["corrections"] == [{"original": "优慧券", "suggestion": "优惠券",
                                      "query": "请问优惠券怎么领"}]
    assert "优惠券" not in result["expanded_terms"]


def test_latin_suggestion_preserves_original_query_and_handles_fullwidth():
    result = expand_query("查询 ＣＯＵＰＮＯ", "live", {"coupon"})
    # A transposition costs two edits; do not claim a general spell checker.
    assert result["corrections"] == []
    result = expand_query("查询 ＣＯＵＰＮ", "live", {"coupon"})
    assert result["corrections"] == [{"original": "ＣＯＵＰＮ", "suggestion": "coupon",
                                      "query": "查询 coupon"}]


@pytest.mark.parametrize("query,vocabulary", [
    ("热玛吉 水光 超声跑", {"热玛吉", "水光", "超声炮"}),
    ("澄光", {"晨光", "预约"}),
    ("青禾保暖杯", {"青禾保温杯", "保温杯"}),
    ("来电", {"来店", "到店"}),
    ("某品牌优慧券", {"某品牌优慧券", "优惠券"}),
    ("优慧券", {"优慧券", "优惠券"}),
])
def test_no_general_medical_brand_or_two_character_replacement(query, vocabulary):
    assert expand_query(query, "medical", vocabulary)['corrections'] == []
    assert expand_query(query, "live", vocabulary)['corrections'] == []


@pytest.mark.parametrize("query", ["", "。！？", "请帮我", "\n\t"])
def test_empty_or_stopword_query_is_safe(query):
    assert expand_query(query, "medical", iter([])) == {
        "terms": [], "expanded_terms": [], "corrections": []}


def test_correct_business_phrase_is_never_changed():
    assert expand_query("如何使用优惠券", "live", {"优惠券"})['corrections'] == []


def test_suggestions_are_bounded_and_repeated_typos_are_deduplicated():
    result = expand_query("优慧券 优慧券 shippng delivry refun", "live",
                          {"优惠券", "shipping", "delivery", "refund"})
    assert len(result["corrections"]) == 3
    keys = [(item["original"], item["suggestion"]) for item in result["corrections"]]
    assert len(keys) == len(set(keys))
