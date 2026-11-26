"""New jacket fixtures stay coherent without replacing persisted user data."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.claims import inspect_claims
from backend.core.storage import SQLiteStore, all_records, get, put


@pytest.fixture(autouse=True)
def replay_only(monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)

    def reject_remote(*args, **kwargs):
        pytest.fail("Demo fixtures must not call a remote provider")

    monkeypatch.setattr(main.ModelAdapter, "_complete", reject_remote)


@pytest.fixture
def client(tmp_path):
    with TestClient(main.create_app(tmp_path)) as session:
        yield session


def records(store):
    with store.read() as db:
        return [tuple(row) for row in db.execute(
            "SELECT rowid,collection,id,data FROM records ORDER BY rowid")]


def test_new_seed_has_jacket_facts_and_matching_snapshots(client):
    state = client.get("/api/state").json()
    product = state["product"]
    assert product["name"] == "青禾紫色羽绒服"
    assert (product["capacity"], product["color"], product["price"]) == ("M 码", "紫色", 399.0)
    assert product["image_url"] == "/assets/purple-down-jacket.png"
    assert product["version"] == 1 and product["claim_evidence"] == []
    assert all("虚构" in product[key] for key in ("source", "description", "evidence"))
    campaign, = state["campaigns"]
    assert product["name"] in campaign["name"]
    assert campaign["product_snapshot"] == product
    creatives = {item["id"]: item for item in state["creatives"]}
    assert set(creatives) == {"creative-commute", "creative-capacity"}
    assert {item["direction"] for item in creatives.values()} == {"日常穿搭", "尺码与颜色"}
    for creative in creatives.values():
        assert creative["product_snapshot"] == product
        assert creative["campaign_id"] == campaign["id"]
        assert creative["source"] == "replay"
        assert creative["status"] == "approved"
        assert creative["family_id"] == creative["id"]
        assert "虚构商品样例" in creative["body"]
        assert inspect_claims(creative)["can_approve"]
        content = " ".join(creative[key] for key in ("title", "body", "script", "cta"))
        assert not any(term in content for term in ("杯", "容量", "500 ml", "奶油白"))
    assert len(state["plans"]) == 2
    for plan in state["plans"]:
        assert plan["simulation"] is True
        assert plan["campaign_id"] == campaign["id"]
        assert plan["creative_snapshot"] == creatives[plan["creative_id"]]
    assert state["orders"] == state["events"] == []


def test_history_and_scenarios_use_jacket_snapshot_price(client):
    state = client.get("/api/state").json()
    price = state["product"]["price"]
    history = client.get("/api/analytics?dataset=history").json()
    assert "虚构" in history["note"]
    assert history["metrics"]["orders"] == 15
    assert history["metrics"]["revenue"] == 15 * price
    for row in history["rows"]:
        orders = [item for item in history["orders"] if item["plan_id"] == row["plan_id"]]
        assert row["revenue"] == sum(item["amount"] for item in orders)
        assert all(item["amount"] == price and item["simulation"] for item in orders)
    for scenario in client.get("/api/scenarios").json():
        response = client.post("/api/batches/preview", json={
            "plan_id": "plan-commute", "scenario": scenario["id"]})
        assert response.status_code == 200, response.text
        batch = response.json()
        assert batch["simulation"] is True
        assert batch["plan_snapshot"]["creative_snapshot"]["product_snapshot"] == state["product"]
        assert batch["metrics"]["revenue"] == price * batch["metrics"]["orders"]
        assert all(item["unit_price"] == price for item in batch["orders"])
    order = client.post("/api/orders", json={
        "plan_id": "plan-commute", "buyer_id": "new-001", "quantity": 2})
    assert order.status_code == 200, order.text
    assert order.json()["amount"] == 2 * price
    assert client.get("/api/analytics?dataset=history").json() == history


def test_live_catalog_projects_jacket_without_writes_and_freezes_session(client):
    store = client.app.state.store
    product = client.get("/api/state").json()["product"]
    before = records(store)
    catalog = client.get("/api/live/catalog").json()
    assert records(store) == before
    projected, = catalog
    assert {key: projected[key] for key in product} == product
    sku, = projected["skus"]
    assert sku["id"] == "default"
    assert sku["label"] == "M 码 · 紫色"
    assert sku["price"] == product["price"]
    assert sku["price_source"] == product["evidence"]
    assert sku["stock"] is None and sku["stock_source"] == ""
    start = datetime.now(timezone.utc)
    response = client.post("/api/live/sessions", json={
        "campaign_id": "campaign-demo", "title": "紫色羽绒服样例场次", "host": "演示主播",
        "scheduled_start": start.isoformat(), "scheduled_end": (start + timedelta(hours=1)).isoformat(),
        "items": [{"product_id": product["id"], "sku_id": sku["id"]}],
    })
    assert response.status_code == 200, response.text
    session = response.json()
    item, = session["items"]
    assert item["product_snapshot"] == {**product, "sku_id": "default", "sku_label": sku["label"]}
    response = client.post(f'/api/live/sessions/{session["id"]}/items/{item["id"]}/generate',
                           json={"recipe": "spec"})
    assert response.status_code == 200, response.text
    assert all(creative["product_snapshot"] == item["product_snapshot"] for creative in response.json())


def test_restarting_new_database_is_idempotent(tmp_path):
    with TestClient(main.create_app(tmp_path)) as first:
        before = records(first.app.state.store)
    with TestClient(main.create_app(tmp_path)) as second:
        assert records(second.app.state.store) == before


def test_seed_product_can_be_saved_with_its_static_image(client):
    before = client.get("/api/state").json()
    response = client.put("/api/product", json={**before["product"], "description": "更新后的虚构样例说明"})
    assert response.status_code == 200, response.text
    assert response.json()["image_url"] == "/assets/purple-down-jacket.png"
    assert response.json()["version"] == 2
    after = client.get("/api/state").json()
    for collection in ("campaigns", "creatives", "plans"):
        assert after[collection] == before[collection]


@pytest.mark.parametrize("tone,angle", [("自然", "场景"), ("简洁", "规格")])
def test_jacket_classic_generation_review_and_revision_use_product_facts(client, tone, angle):
    product = client.get("/api/state").json()["product"]
    response = client.post("/api/campaigns/campaign-demo/generate", json={"tone": tone, "angle": angle})
    assert response.status_code == 200, response.text
    generated = response.json()
    assert len(generated) == 2
    response = client.post("/api/insights", json={"dataset": "history"})
    assert response.status_code == 200, response.text
    insight = response.json()
    review_text = " ".join(insight["facts"] + insight["hypotheses"] + insight["missing"] + [insight["recommendation"]])
    assert not any(term in review_text for term in ("杯", "容量", "保温"))
    assert "规格" in insight["recommendation"]
    response = client.post(f'/api/insights/{insight["id"]}/accept', json={"creative_id": generated[0]["id"]})
    assert response.status_code == 200, response.text
    revised = response.json()
    assert revised["parent_id"] == generated[0]["id"]
    assert revised["version"] == 2 and revised["status"] == "draft"
    for creative in [*generated, revised]:
        assert creative["product_snapshot"] == product and creative["source"] == "replay"
        assert inspect_claims(creative)["can_approve"]
        content = " ".join(creative[key] for key in ("direction", "title", "body", "script", "cta"))
        assert not any(term in content for term in ("杯", "容量", "保温", "500 ml", "奶油白"))
        assert all(str(value) in creative["body"] for value in (product["name"], product["capacity"], product["color"], f'{product["price"]:g}'))


def test_custom_cup_classic_generation_and_revision_preserve_cup_behavior(client):
    product = client.get("/api/state").json()["product"]
    response = client.put("/api/product", json={
        **product, "name": "星野旅行杯", "brand": "星野", "price": 129,
        "capacity": "600 ml", "color": "蓝色", "description": "虚构杯子测试资料",
        "evidence": "自定义杯子资料", "restrictions": "不得编造保温时长或销量。",
        "image_url": "/assets/product.svg",
    })
    assert response.status_code == 200, response.text
    cup = response.json()
    response = client.post("/api/campaigns", json={"name": "自定义杯子活动"})
    assert response.status_code == 200, response.text
    campaign = response.json()
    response = client.post(f'/api/campaigns/{campaign["id"]}/generate', json={})
    assert response.status_code == 200, response.text
    generated = response.json()
    assert [item["direction"] for item in generated] == ["通勤携带", "容量展示"]
    assert "杯身" in generated[0]["script"] and "杯盖" in generated[1]["script"]
    response = client.post("/api/insights", json={"dataset": "session", "campaign_id": campaign["id"]})
    assert response.status_code == 200, response.text
    insight = response.json()
    response = client.post(f'/api/insights/{insight["id"]}/accept', json={"creative_id": generated[0]["id"]})
    assert response.status_code == 200, response.text
    revised = response.json()
    assert "从桌面到通勤" in revised["body"]
    for creative in [*generated, revised]:
        assert creative["product_snapshot"] == cup
        assert inspect_claims(creative)["can_approve"]
        assert all(value in creative["body"] for value in ("星野旅行杯", "600 ml", "蓝色", "129"))
        assert "羽绒服" not in " ".join(creative[key] for key in ("title", "body", "script", "cta"))


@pytest.mark.parametrize("product_id,name,price,capacity,color", [
    ("product-demo", "青禾随行保温杯", 99.0, "500 ml", "奶油白"),
    ("product-demo", "用户修改的羽绒服", 568.0, "L 码", "蓝色"),
    ("customer-product", "用户自建商品", 88.5, "单件", "白色"),
])
def test_existing_products_do_not_trigger_seed(tmp_path, monkeypatch, product_id, name, price, capacity, color):
    product = dict(id=product_id, name=name, price=price, capacity=capacity, color=color,
                   brand="用户品牌", image_url="/uploads/user-product.png", video_url="",
                   description="用户保存的资料", restrictions="用户保存的限制", evidence="用户原始来源",
                   version=7, created_at="2026-01-01T00:00:00+00:00")
    existing = SQLiteStore(tmp_path)
    with existing.transaction() as db:
        db.execute("CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id))")
        put(db, "product", product)

    def reject_seed(db):
        pytest.fail("An existing product must prevent all demo seeding")

    monkeypatch.setattr(main, "seed", reject_seed)
    with TestClient(main.create_app(tmp_path)) as client:
        state = client.get("/api/state").json()
        assert state["product"] == product
        assert state["campaigns"] == state["creatives"] == state["plans"] == []
        projected, = client.get("/api/live/catalog").json()
        assert {key: projected[key] for key in product} == product
        assert projected["skus"][0]["price"] == price
        with client.app.state.store.read() as db:
            assert all_records(db, "datasets") == []


def test_restarting_preserves_custom_product_and_historical_records(tmp_path):
    with TestClient(main.create_app(tmp_path)) as first:
        original = first.get("/api/state").json()["product"]
        response = first.put("/api/product", json={
            **original, "name": "用户已保存商品", "price": 777, "capacity": "XL 码", "color": "绿色",
            "image_url": "/assets/product.svg", "evidence": "用户手工保存的来源",
        })
        assert response.status_code == 200, response.text
        custom = response.json()
        assert first.post("/api/live/catalog", json={**custom, "skus": [{
            "label": "用户 SKU", "capacity": "XL 码", "color": "绿色", "price": 777,
            "price_source": "用户记录的价格",
        }]}).status_code == 200
        assert first.post("/api/campaigns", json={"name": "用户活动"}).status_code == 200
        assert first.post("/api/orders", json={
            "plan_id": "plan-commute", "buyer_id": "new-001", "request_id": "saved-order"}).status_code == 200
        store = first.app.state.store
        with store.transaction() as db:
            history = get(db, "datasets", "D0")
            history["source"] = "用户保留的旧历史样例"
            for row in history["rows"]:
                row["revenue"] = 99.0 * row["orders"]
            for order in history["orders"]:
                order.update(amount=99.0, unit_price=99.0)
            put(db, "datasets", history)
        before = records(store)
        with store.read() as db:
            requests = [tuple(row) for row in db.execute("SELECT * FROM requests ORDER BY scope,request_id")]
    with TestClient(main.create_app(tmp_path)) as second:
        assert second.get("/api/state").json()["product"] == custom
        assert records(second.app.state.store) == before
        with second.app.state.store.read() as db:
            assert [tuple(row) for row in db.execute("SELECT * FROM requests ORDER BY scope,request_id")] == requests
            assert get(db, "campaigns", "campaign-demo")["product_snapshot"] == original
            assert get(db, "datasets", "D0") == history
