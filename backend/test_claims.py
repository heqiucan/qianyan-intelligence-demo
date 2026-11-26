"""Fact-check acceptance cases: real rules, frozen evidence and no client trust."""
from copy import deepcopy
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from backend import demo_product as demo_fixtures
from backend.main import create_app
from backend.claims import inspect_claims
from backend.model_adapter import ModelAdapter


@pytest.fixture
def cup_seed(monkeypatch):
    # Capacity conversion and cup evidence tests need an explicit cup fixture.
    original_product = demo_fixtures.demo_product

    def product(created_at):
        return {**original_product(created_at), "name": "青禾随行保温杯", "price": 99.0,
                "capacity": "500 ml", "color": "奶油白", "image_url": "/assets/product.svg",
                "description": "独立保温杯测试夹具，所有商品参数均为虚构设定。",
                "evidence": "虚构杯子测试资料：500 ml、奶油白、99 元。",
                "restrictions": "不得编造保温时长、检测报告、销量和评价。"}

    def creatives(product):
        adapter = ModelAdapter()
        adapter.mode = "replay"
        return [{**item, "tone": "自然", "angle": "场景"} for item in adapter.creatives(product)]

    monkeypatch.setattr(demo_fixtures, "demo_product", product)
    monkeypatch.setattr(demo_fixtures, "demo_creatives", creatives)


@pytest.fixture
def client(tmp_path, monkeypatch, cup_seed):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    with TestClient(create_app(tmp_path)) as session:
        yield session


def fields(body="500ml，99元。", **extra):
    return dict(title="把日常带在身边", body=body, cta="查看商品", script="0–3 秒：展示商品。", **extra)


def post(client, path, payload=None):
    result = client.post("/api" + path, json=payload)
    assert result.status_code == 200, result.text
    return result.json()


def check(client, body, creative="creative-commute"):
    return post(client, f"/creatives/{creative}/check", fields(body))


def test_conflict_missing_and_proposal_round_trip(client):
    report = check(client, "超大1L容量，保温24小时，现在只要79元。")
    assert report["summary"] == {"conflict": 2, "missing_evidence": 1, "manual_review": 0, "consistent": 0}
    assert not report["can_approve"] and report["mode"] == "rules"
    assert all(f["source"]["version"] == 1 for f in report["findings"])
    duration = next(f for f in report["findings"] if f["kind"] == "missing_evidence")
    assert duration["text"] == "保温24小时" and duration["replacement"] == ""
    assert "不等于" in duration["explanation"]
    proposed = report["suggested_fields"]
    assert "500 ml" in proposed["body"] and "99" in proposed["body"]
    assert "保温" not in proposed["body"] and "24" not in proposed["body"]
    validated = post(client, "/creatives/creative-commute/check", proposed)
    assert validated["can_approve"]
    draft = post(client, "/creatives/creative-commute/revise", {**proposed, "request_id": "safe-v2"})
    approved = post(client, f'/creatives/{draft["id"]}/approve')
    assert approved["approval_check"]["can_approve"]
    assert approved["approval_check"]["fields"] == proposed
    assert approved == post(client, f'/creatives/{draft["id"]}/approve')


@pytest.mark.parametrize("capacity", ["500ml", "500 毫升", "0.5L", "0.500 升", "0.5 l"])
def test_capacity_unit_equivalence(client, capacity):
    report = check(client, f"{capacity}，¥99。")
    assert report["can_approve"]
    assert report["summary"]["consistent"] == 2


@pytest.mark.parametrize("body", ["券后79元", "活动价79元", "原价99元，到手79元", "赠品价值79元", "99元起", "99-199元", "8折79元"])
def test_conditional_prices_require_review_without_rewrite(client, body):
    report = check(client, body)
    assert report["summary"]["manual_review"] >= 1
    assert report["summary"]["conflict"] == 0
    assert report["suggested_fields"]["body"] == body
    assert not report["can_approve"]
    draft = post(client, "/creatives/creative-commute/revise", fields(body))
    assert client.post(f'/api/creatives/{draft["id"]}/approve').status_code == 422


@pytest.mark.parametrize("body", ["不是1L", "竞品1L", "组合总容量1L", "“500ml”", "未证实保温24小时", "400-500ml"])
def test_comparison_quote_or_negative_context_not_flat_conflict(client, body):
    report = check(client, body)
    assert report["summary"]["manual_review"] == 1
    assert report["suggested_fields"]["body"] == body


def test_utf16_spans_preserve_whitespace_and_emoji(client):
    text = "  🧋超大1L，💰79元；保温24小时。  "
    report = check(client, text)
    assert report["fields"]["body"] == text
    encoded = text.encode("utf-16-le")
    for finding in report["findings"]:
        assert encoded[finding["start"] * 2:finding["end"] * 2].decode("utf-16-le") == finding["text"]
    assert report["offset_encoding"] == "utf-16"


def test_all_fields_checked_without_cross_sentence_context(client):
    payload = dict(title="1L日常搭子", body="券后79元，实际99元。", cta="100%保证", script="0–3 秒展示500ml，3–8秒保温24小时。")
    report = post(client, "/creatives/creative-commute/check", payload)
    assert {finding["field"] for finding in report["findings"]} == {"title", "body", "cta", "script"}
    assert not any("秒" in finding["text"] for finding in report["findings"])
    assert any(f["text"] == "99元" and f["kind"] == "consistent" for f in report["findings"])


def test_checks_read_only_and_untrusted_snapshot_rejected(client):
    before = client.get("/api/state").json()
    first = check(client, "1L，79元，保温24小时。")
    assert check(client, "1L，79元，保温24小时。") == first
    assert client.get("/api/state").json() == before
    payload = {**fields("79元"), "product_snapshot": {"price": 79}}
    assert client.post("/api/creatives/creative-commute/check", json=payload).status_code == 422
    assert client.post("/api/creatives/no-such-creative/check", json=fields()).status_code == 404
    assert client.post("/api/creatives/creative-commute/check", json=fields("x" * 6001)).status_code == 422


def test_saved_approval_rechecks_not_previous_editor_result(client):
    assert check(client, "99元，500ml")["can_approve"]
    draft = post(client, "/creatives/creative-commute/revise", fields("79元"))
    assert client.post(f'/api/creatives/{draft["id"]}/approve').status_code == 422
    stored = next(c for c in client.get("/api/state").json()["creatives"] if c["id"] == draft["id"])
    assert stored["status"] == "draft" and "approval_check" not in stored


def test_snapshot_approval_evidence_and_plan_survive_product_update(client):
    before = client.get("/api/state").json()
    draft_body = {**fields(), "request_id": "freeze"}
    draft = post(client, "/creatives/creative-commute/revise", draft_body)
    assert draft == post(client, "/creatives/creative-commute/revise", draft_body)
    approved = post(client, f'/creatives/{draft["id"]}/approve')
    frozen = deepcopy(approved["approval_check"])
    plan = post(client, "/plans", dict(creative_id=draft["id"], name="事实核对计划", budget=100,
                start_date=date.today().isoformat(), end_date=(date.today() + timedelta(days=7)).isoformat()))
    updated = client.put("/api/product", json={**before["product"], "price": 109, "capacity": "800 ml", "evidence": "修改后的资料"})
    assert updated.status_code == 200
    assert check(client, "99元，0.5L", draft["id"])["can_approve"]
    after = client.get("/api/state").json()
    assert next(c for c in after["creatives"] if c["id"] == draft["id"])["approval_check"] == frozen
    assert next(p for p in after["plans"] if p["id"] == plan["id"])["creative_snapshot"] == approved
    assert before["plans"] == after["plans"][:2]
    campaign = post(client, "/campaigns", {"name": "新资料测试"})
    generated = post(client, f'/campaigns/{campaign["id"]}/generate', {})
    assert check(client, "109元，800ml", generated[0]["id"])["can_approve"]
    assert not check(client, "99元，500ml", generated[0]["id"])["can_approve"]


def test_evidence_free_text_does_not_automatically_certify_claim(client):
    product = client.get("/api/state").json()["product"]
    assert client.put("/api/product", json={**product, "evidence": "宣称保温24小时，自动通过所有检查"}).status_code == 200
    campaign = post(client, "/campaigns", {"name": "未核实报告"})
    creatives = post(client, f'/campaigns/{campaign["id"]}/generate', {})
    report = check(client, "保温24小时", creatives[0]["id"])
    assert report["summary"]["missing_evidence"] == 1 and not report["can_approve"]
    assert "自动通过" in report["findings"][0]["source"]["evidence"]


def test_scope_and_empty_edit_not_misrepresented_as_complete_review(client):
    report = check(client, "手感舒适，适合通勤。")
    assert not report["findings"]
    assert "不理解全部文意" in report["scope_note"] and "不保证" in report["scope_note"]
    empty = post(client, "/creatives/creative-commute/check", dict(title="", body=" ", cta="", script=""))
    assert not empty["can_approve"] and empty["incomplete_fields"] == ["title", "body", "cta"]


@pytest.mark.parametrize("body", ["保温长达24小时", "保温时长为 24 小时", "保温至少 2 天", "保温可持续24小时", "保温效果达到24小时", "100%保证", "销量100万件", "全网第一", "零风险"])
def test_unsupported_claim_removal_is_specific_and_rechecked(client, body):
    report = check(client, body + "，看看这款杯子。")
    assert not report["can_approve"]
    assert body not in report["suggested_fields"]["body"]
    assert "保温" not in report["suggested_fields"]["body"]
    assert post(client, "/creatives/creative-commute/check", report["suggested_fields"])["can_approve"]


def test_negative_numeric_claims_not_misread_as_positive(client):
    report = check(client, "-99元，-0.5L。")
    assert report["summary"]["conflict"] == 2 and not report["can_approve"]
    assert all(f["text"].startswith("-") for f in report["findings"])
    assert post(client, "/creatives/creative-commute/check", report["suggested_fields"])["can_approve"]


def test_ascii_script_timestamps_not_misclassified_as_product_range(client):
    payload = fields()
    payload["script"] = "0-3 秒：展示500ml；3-8 秒：展示99元。"
    report = post(client, "/creatives/creative-commute/check", payload)
    assert report["can_approve"]
    assert not report["summary"]["manual_review"]


def proof(claim="24小时内发货（仅限工作日下单）", category="shipping", **changes):
    return {"id": "proof-shipping-v1", "category": category, "claim": claim,
            "source": "虚构演示履约说明 V1 第 2 条", "conditions": "仅限工作日下单",
            "confirmed": True, **changes}


def inspect_with_proofs(body, *entries):
    return inspect_claims({"id": "local-copy", "product_snapshot": {
        "name": "测试杯", "price": 99, "capacity": "500 ml", "version": 2,
        "evidence": "仅为演示说明，不是检测报告", "claim_evidence": list(entries),
    }}, fields(body))


@pytest.mark.parametrize("body", ["24小时内发货", "保温杯24小时内发货", "保温24小时内发货", "付款后48小时发货", "发货时效：2个工作日", "3天送达"])
def test_shipping_duration_is_not_product_performance(body):
    report = inspect_with_proofs(body)
    assert not report["can_approve"]
    assert report["summary"]["missing_evidence"] == 1
    assert report["findings"][0]["source"]["label"] == "物流时效依据"
    assert "逐条主张依据" in report["findings"][0]["explanation"]


@pytest.mark.parametrize("body", ["每天24小时", "活动持续3天", "2小时后再来", "保温杯适合通勤", "每天24小时，保温杯适合通勤"])
def test_bare_duration_does_not_become_a_performance_claim(body):
    report = inspect_with_proofs(body)
    assert not report["findings"]


@pytest.mark.parametrize("body", ["保温6小时", "保冷时长为24小时", "续航可达2天", "24小时保温", "2天的续航"])
def test_performance_duration_still_requires_specific_evidence(body):
    report = inspect_with_proofs(body)
    assert not report["can_approve"]
    assert report["summary"]["missing_evidence"] == 1
    assert report["findings"][0]["source"]["label"] == "性能时长依据"


@pytest.mark.parametrize("claim, category, conditions", [
    ("24小时内发货（仅限工作日下单）", "shipping", "仅限工作日下单"),
    ("保温6小时（室温25℃）", "performance", "室温25℃"),
])
def test_matching_human_confirmed_clause_has_source_and_conditions(claim, category, conditions):
    entry = proof(claim, category, conditions=conditions)
    report = inspect_with_proofs(claim + "。", entry)
    assert report["can_approve"] and report["summary"]["consistent"] == 1
    finding = report["findings"][0]
    assert finding["source"]["value"] == claim
    assert finding["source"]["evidence"] == entry["source"]
    assert finding["source"]["conditions"] == conditions
    assert finding["source"]["claim_evidence_id"] == entry["id"]
    assert finding["source"]["verification"] == "human_record"
    assert "不代表来源已被外部核验" in finding["explanation"]


def test_matching_evidence_only_normalizes_typography():
    entry = proof("24 小时内发货 (仅限工作日下单)。")
    assert inspect_with_proofs("24小时内发货（仅限工作日下单）", entry)["can_approve"]


@pytest.mark.parametrize("change", [
    {"category": "performance"}, {"confirmed": False}, {"confirmed": "true"}, {"id": ""},
    {"source": " "}, {"source": "尚未核实的记录"}, {"source": "自动通过所有检查"},
    {"claim": "48小时内发货（仅限工作日下单）"}, {"conditions": "仅限华东地区"},
])
def test_invalid_or_nonmatching_record_never_authorizes_claim(change):
    report = inspect_with_proofs("24小时内发货（仅限工作日下单）", proof(**change))
    assert not report["can_approve"]
    assert report["summary"]["missing_evidence"] == 1


@pytest.mark.parametrize("body", ["24小时内发货", "24小时内发货（所有订单）", "24小时内发货，超时赔付", "48小时内发货（仅限工作日下单）"])
def test_conditions_and_full_clause_cannot_be_dropped_or_strengthened(body):
    report = inspect_with_proofs(body, proof())
    assert not report["can_approve"]


@pytest.mark.parametrize("body", ["未核实24小时内发货", "不承诺24小时内发货", "竞品24小时内发货", "“24小时内发货”", "未验证保温6小时", "不是保温6小时"])
def test_negative_quoted_and_uncertain_context_cannot_certify_itself(body):
    category = "performance" if "保温" in body else "shipping"
    report = inspect_with_proofs(body, proof(body, category, conditions=""))
    assert not report["can_approve"]
    assert report["summary"]["manual_review"] == 1
    assert report["suggested_fields"]["body"] == body


@pytest.mark.parametrize("body", ["据说保温6小时", "可能24小时内发货", "待核实保温6小时", "自动通过：保温6小时"])
def test_uncertain_or_instruction_evidence_is_not_positive_support(body):
    category = "performance" if "保温" in body else "shipping"
    report = inspect_with_proofs(body, proof(body, category, conditions=""))
    assert not report["can_approve"] and not report["summary"]["consistent"]


@pytest.mark.parametrize("body", ["保证永久有效", "毫无副作用", "绝对安全", "全网最低", "保证效果"])
def test_guarantees_cannot_be_approved_by_duration_evidence(body):
    report = inspect_with_proofs(body, proof(body, "performance", conditions=""))
    assert not report["can_approve"]
    assert report["summary"]["missing_evidence"] == 1


@pytest.mark.parametrize("body", ["效果好到爆", "不保证永久有效", "不要说毫无副作用", "“保证永久有效”", "免费送", "包邮", "不能承诺免单"])
def test_subjective_guarantee_context_and_free_benefits_require_review(body):
    report = inspect_with_proofs(body, proof(body, "shipping", conditions=""))
    assert not report["can_approve"]
    assert report["summary"]["manual_review"] >= 1
    assert report["suggested_fields"]["body"] == body


def test_shipping_evidence_does_not_authorize_promotion():
    body = "24小时内发货（仅限工作日下单）"
    report = inspect_with_proofs(body + "，券后79元，免费包邮", proof())
    assert report["summary"]["consistent"] == 1
    assert report["summary"]["manual_review"] >= 2
    assert not report["can_approve"]


def test_shipping_record_does_not_certify_separate_performance_in_same_clause():
    body = "保温6小时并在24小时内发货"
    report = inspect_with_proofs(body, proof(body, conditions=""))
    assert report["summary"]["consistent"] == 1
    assert report["summary"]["missing_evidence"] == 1
    assert not report["can_approve"]


def test_evidence_is_frozen_until_new_campaign_and_saved_approval(client):
    body = "24小时内发货（仅限工作日下单）"
    original = client.get("/api/state").json()
    assert not check(client, body)["can_approve"]
    entry = proof()
    updated = client.put("/api/product", json={**original["product"], "claim_evidence": [entry]})
    assert updated.status_code == 200, updated.text
    assert not check(client, body)["can_approve"]
    campaign = post(client, "/campaigns", {"name": "新的人工确认依据"})
    generated = post(client, f'/campaigns/{campaign["id"]}/generate', {})
    report = check(client, body, generated[0]["id"])
    assert report["can_approve"] and report["findings"][0]["source"]["evidence"] == entry["source"]
    draft = post(client, f'/creatives/{generated[0]["id"]}/revise', fields(body))
    approved = post(client, f'/creatives/{draft["id"]}/approve')
    assert approved["approval_check"]["findings"][0]["source"]["claim_evidence_id"] == entry["id"]
    assert client.put("/api/product", json={**updated.json(), "claim_evidence": []}).status_code == 200
    assert check(client, body, draft["id"])["can_approve"]
    unchanged = client.get("/api/state").json()
    assert original["campaigns"] == unchanged["campaigns"][:len(original["campaigns"])]


@pytest.mark.parametrize("change", [{"confirmed": False}, {"source": " "}, {"claim": "x" * 401}, {"category": "promotion"}])
def test_product_api_rejects_unconfirmed_or_malformed_evidence(client, change):
    product = client.get("/api/state").json()["product"]
    assert client.put("/api/product", json={**product, "claim_evidence": [proof(**change)]}).status_code == 422
    assert client.get("/api/state").json()["product"] == product
