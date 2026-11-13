"""Fact-check acceptance cases: real rules, frozen evidence and no client trust."""
from copy import deepcopy
from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
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
