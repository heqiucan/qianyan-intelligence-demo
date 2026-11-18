"""Acceptance tests exercise business boundaries using isolated databases."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    with TestClient(create_app(tmp_path)) as session:
        yield session


def post(client, path, payload=None):
    response = client.post(path, json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def buy(client, key, buyer="new-001", plan="plan-commute"):
    return post(client, "/api/orders", {"plan_id": plan, "buyer_id": buyer, "request_id": key})


def revise(client, title="把日常，装进随行的风景", body="演示售价 ¥99，500 ml 奶油白。"):
    return post(client, "/api/creatives/creative-commute/revise", {"title": title, "body": body, "cta": "查看商品", "script": "展示外观与已知规格。"})


def test_history_is_fixed_and_session_has_no_spend(client):
    original = client.get("/api/analytics?dataset=history").json()
    metrics = original["metrics"]
    assert (metrics["impressions"], metrics["clicks"], metrics["orders"], metrics["new_customers"]) == (10000, 300, 15, 9)
    assert metrics["roi"] == 4.95
    assert metrics["ctr"] == .03
    assert metrics["cac"] == pytest.approx(300 / 9, abs=1e-6)
    empty = client.get("/api/analytics?dataset=session").json()["metrics"]
    assert empty["orders"] == 0
    assert all(empty[key] is None for key in ("impressions", "spend", "roi", "ctr", "cpa", "cac"))
    buy(client, "one")
    assert client.get("/api/analytics?dataset=history").json() == original
    current = client.get("/api/analytics?dataset=session").json()["metrics"]
    assert current["revenue"] == 99 and current["orders"] == 1
    assert current["roi"] is None and current["spend"] is None


def test_buyer_history_and_distinct_buyers(client):
    assert buy(client, "first")["buyer_type"] == "new"
    assert buy(client, "repeat", plan="plan-capacity")["buyer_type"] == "returning"
    assert buy(client, "old", "old-001")["buyer_type"] == "returning"
    assert buy(client, "unknown", "unknown-001")["buyer_type"] == "unknown"
    report = client.get("/api/analytics?dataset=session").json()
    m = report["metrics"]
    assert (m["orders"], m["buyers"], m["new_customers"], m["unknown_buyers"]) == (4, 3, 1, 1)
    assert report["identification_coverage"] == pytest.approx(2 / 3)
    assert m["cac"] is None


def test_duplicate_orders_are_idempotent_even_concurrently(client):
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(lambda _: buy(client, "same-click"), range(4)))
    assert len({order["id"] for order in results}) == 1
    assert len(client.get("/api/state").json()["orders"]) == 1
    conflict = client.post("/api/orders", json={"plan_id": "plan-commute", "buyer_id": "old-001", "request_id": "same-click"})
    assert conflict.status_code == 409


def test_event_deduplication_and_paused_plan(client):
    body = {"plan_id": "plan-commute", "type": "click", "request_id": "event-once"}
    assert post(client, "/api/events", body) == post(client, "/api/events", body)
    post(client, "/api/plans/plan-commute/status", {"status": "paused"})
    assert client.post("/api/events", json={**body, "request_id": "blocked"}).status_code == 409
    assert client.post("/api/orders", json={"plan_id": "plan-commute", "buyer_id": "new-001", "request_id": "blocked"}).status_code == 409
    post(client, "/api/plans/plan-commute/status", {"status": "ended"})
    assert client.post("/api/plans/plan-commute/status", json={"status": "running"}).status_code == 409
    assert client.get("/api/analytics?dataset=session").json()["metrics"]["clicks"] == 1


def test_product_and_creative_snapshots_survive_edits(client):
    before = client.get("/api/state").json()
    product = before["product"]
    changed = client.put("/api/product", json={**product, "price": 129}).json()
    assert changed["version"] == 2
    v2 = revise(client)
    assert v2["version"] == 2 and v2["status"] == "draft"
    after = client.get("/api/state").json()
    assert after["plans"][0]["creative_snapshot"] == before["plans"][0]["creative_snapshot"]
    assert after["campaigns"][0]["product_snapshot"]["price"] == 99
    assert buy(client, "snapshot-order")["amount"] == 99
    campaign = post(client, "/api/campaigns", {"name": "新价格活动"})
    assert campaign["product_snapshot"]["price"] == 129
    payload = {"request_id": "generate-once"}
    generated = post(client, f'/api/campaigns/{campaign["id"]}/generate', payload)
    assert generated == post(client, f'/api/campaigns/{campaign["id"]}/generate', payload)
    assert all(c["product_snapshot"]["price"] == 129 for c in generated)
    assert "129" in generated[0]["body"]


@pytest.mark.parametrize("body", ["仅售 ¥89，500 ml。", "保温24小时", "全网第一", "容量1000 ml"])
def test_conflicting_claims_cannot_be_approved(client, body):
    draft = revise(client, body=body)
    assert client.post(f'/api/creatives/{draft["id"]}/approve').status_code == 422
    state = client.get("/api/state").json()
    assert next(c for c in state["creatives"] if c["id"] == draft["id"])["status"] == "draft"


def test_plan_requires_confirmation_and_valid_budget_dates(client):
    draft = revise(client)
    payload = {"creative_id": draft["id"], "name": "验证计划", "budget": 200, "start_date": (datetime.now(timezone.utc).date()-timedelta(days=1)).isoformat(), "end_date": (datetime.now(timezone.utc).date()+timedelta(days=7)).isoformat(), "request_id": "plan"}
    assert client.post("/api/plans", json=payload).status_code == 409
    post(client, f'/api/creatives/{draft["id"]}/approve')
    assert client.post("/api/plans", json={**payload, "budget": 0}).status_code == 422
    assert client.post("/api/plans", json={**payload, "end_date": "2026-11-01"}).status_code == 422
    plan = post(client, "/api/plans", payload)
    assert plan == post(client, "/api/plans", payload)
    assert plan["status"] == "draft"
    assert client.post("/api/orders", json={"plan_id": plan["id"], "buyer_id": "new-001", "request_id": "before-start"}).status_code == 409
    post(client, f'/api/plans/{plan["id"]}/status', {"status": "running"})
    assert buy(client, "after-start", plan=plan["id"])["creative_id"] == draft["id"]


def test_insight_accept_creates_draft_without_results(client):
    insight = post(client, "/api/insights", {"dataset": "history"})
    assert insight["source"] == "replay" and insight["facts"] and insight["missing"]
    payload = {"creative_id": "creative-commute", "request_id": "accept"}
    draft = post(client, f'/api/insights/{insight["id"]}/accept', payload)
    assert draft["status"] == "draft" and draft["version"] == 2
    assert draft == post(client, f'/api/insights/{insight["id"]}/accept', payload)
    state = client.get("/api/state").json()
    assert len(state["plans"]) == 2 and state["orders"] == []
    assert client.post(f'/api/insights/{insight["id"]}/accept', json={"creative_id": "creative-capacity", "request_id": "different"}).status_code == 409


def test_new_campaign_does_not_claim_history_or_cross_campaign_insights(client):
    campaign = post(client, "/api/campaigns", {"name": "独立活动"})
    report = client.get(f'/api/analytics?dataset=history&campaign_id={campaign["id"]}').json()
    assert report["rows"] == [] and report["orders"] == [] and report["metrics"]["roi"] is None
    insight = post(client, "/api/insights", {"dataset": "session", "campaign_id": campaign["id"]})
    assert client.post(f'/api/insights/{insight["id"]}/accept', json={"creative_id": "creative-commute", "request_id": "cross"}).status_code == 409


def test_persistence_and_access_gate(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    with TestClient(create_app(tmp_path)) as first:
        original = buy(first, "persist")
    monkeypatch.setenv("DEMO_ACCESS_TOKEN", "test-only-access-code")
    with TestClient(create_app(tmp_path)) as second:
        assert second.get("/api/health").status_code == 200
        assert second.get("/api/state").status_code == 401
        state = second.get("/api/state", headers={"X-Demo-Token": "test-only-access-code"}).json()
        assert state["orders"] == [original]
        assert second.get("/api/missing", headers={"X-Demo-Token": "test-only-access-code"}).status_code == 404


def test_upload_rejects_executable_and_external_media(client):
    assert client.post("/api/uploads", files={"file": ("bad.svg", b"<svg></svg>", "image/svg+xml")}).status_code == 415
    assert client.post("/api/uploads", files={"file": ("fake.png", b"not a png", "image/png")}).status_code == 415
    product = client.get("/api/state").json()["product"]
    assert client.put("/api/product", json={**product, "image_url": "https://example.org/pixel.png"}).status_code == 422
