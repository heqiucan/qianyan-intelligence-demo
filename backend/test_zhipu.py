"""Provider contract and failure tests. All model responses are HTTP mocks."""
from concurrent.futures import ThreadPoolExecutor
import json
from threading import Event

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.model_adapter import FREE_MODEL, ZHIPU_BASE, ModelAdapter, ModelFailure
from scripts.configure_zhipu import write_settings


KEY = "test-only-credential-never-a-real-key"
ORIGINAL_CLIENT = httpx.Client
COPY = {"direction": "周末出行", "title": "带上日常好物", "body": "青禾随行保温杯，500 ml，奶油白。演示售价 ¥99。", "cta": "查看商品规格", "script": "0–3 秒：展示商品与 500 ml 容量。\n3–15 秒：展示奶油白外观和 ¥99 演示价格。"}


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "zhipu-free")
    monkeypatch.setenv("MODEL_API_KEY", KEY)
    monkeypatch.delenv("MODEL_NAME", raising=False)
    monkeypatch.delenv("MODEL_BASE_URL", raising=False)
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)


def response(data, finish_reason="stop"):
    return httpx.Response(200, json={"choices": [{"finish_reason": finish_reason, "message": {"content": json.dumps(data, ensure_ascii=False)}}]})


def mock_http(monkeypatch, callback):
    calls = []
    def handle(request):
        calls.append(json.loads(request.content))
        assert str(request.url) == ZHIPU_BASE + "/chat/completions"
        assert request.headers["Authorization"] == "Bearer " + KEY
        return callback(request)
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: ORIGINAL_CLIENT(transport=httpx.MockTransport(handle), **kwargs))
    return calls


def state(client):
    return client.get("/api/state").json()


def business(client):
    return {k: v for k, v in state(client).items() if k != "model"}


def generate(client, key="generate-free"):
    return client.post("/api/campaigns/campaign-demo/generate", json={"tone": "简洁", "angle": "规格", "request_id": key})


@pytest.mark.parametrize("model", ["glm-4.7-flashx", "glm-5.3", "glm-4.7", "glm-4-flashx"])
def test_paid_models_are_rejected_before_any_network(env, monkeypatch, model):
    monkeypatch.setenv("MODEL_NAME", model)
    calls = mock_http(monkeypatch, lambda _: pytest.fail("Must not call a paid model"))
    adapter = ModelAdapter()
    with pytest.raises(ModelFailure, match="免费模式已拦截"):
        adapter.check_connection()
    assert not calls and not adapter.info["configured"]


@pytest.mark.parametrize("base", ["https://example.com/v1", "https://open.bigmodel.cn/api/coding/paas/v4", "http://open.bigmodel.cn/api/paas/v4"])
def test_other_endpoints_are_rejected(env, monkeypatch, base):
    monkeypatch.setenv("MODEL_BASE_URL", base)
    calls = mock_http(monkeypatch, lambda _: pytest.fail("Must not send credential"))
    with pytest.raises(ModelFailure, match="免费模式已拦截"):
        ModelAdapter().check_connection()
    assert not calls


def test_seed_no_network_and_missing_key_is_actionable(env, monkeypatch, tmp_path):
    monkeypatch.delenv("MODEL_API_KEY")
    calls = mock_http(monkeypatch, lambda _: pytest.fail("Seed must be local"))
    with TestClient(create_app(tmp_path)) as client:
        before = business(client)
        assert not state(client)["model"]["configured"]
        result = generate(client)
        assert result.status_code == 502 and "configure-zhipu.cmd" in result.text
        assert business(client) == before
    assert not calls


def test_live_generation_brief_provenance_and_retry(env, monkeypatch, tmp_path):
    calls = mock_http(monkeypatch, lambda _: response({"creatives": [COPY, {**COPY, "direction": "桌面收纳", "title": "给桌面留一点清爽"}]}))
    with TestClient(create_app(tmp_path)) as client:
        assert not calls  # Seeding is replay even with a configured key.
        edit = {"name": "周末活动", "audience": "周末露营人群", "selling_point": "奶油白外观", "goal": "先看商品规格", "request_id": "brief"}
        assert client.put("/api/campaigns/campaign-demo", json=edit).status_code == 200
        result = generate(client)
        assert result.status_code == 200, result.text
        creatives = result.json()
        assert all(c["model_name"] == FREE_MODEL and c["source"] == "model" and c["status"] == "draft" for c in creatives)
        assert generate(client).json() == creatives and len(calls) == 1
        prompt = json.loads(calls[0]["messages"][1]["content"].split("输入资料：", 1)[1])
        assert prompt["campaign_brief"]["audience"] == "周末露营人群"
        assert prompt["campaign_brief"]["tone"] == "简洁"
        assert prompt["campaign_brief"]["angle"] == "规格"
        assert calls[0]["model"] == FREE_MODEL
        assert "thinking" not in calls[0]  # GLM-4-Flash is not a reasoning model.
        assert "tools" not in calls[0] and "web_search" not in json.dumps(calls[0])
        edited = client.post(f'/api/creatives/{creatives[0]["id"]}/revise', json={**COPY, "request_id": "human-edit"}).json()
        assert edited["model_name"] == FREE_MODEL and edited["edited_by"] == "演示运营"
        s = state(client)
        assert s["model"]["live_verified"] and s["model"]["free_only"]
        assert KEY not in json.dumps(s) and "Authorization" not in json.dumps(s)
        assert s["creatives"][0]["source"] == "replay"
        assert s["plans"][0]["creative_id"] == "creative-commute"


@pytest.mark.parametrize("http_status,api_status,expected", [(401, 502, "密钥"), (403, 502, "权限"), (429, 503, "限流"), (500, 502, "暂时不可用"), (404, 502, "可用状态"), (302, 502, "暂时不可用")])
def test_provider_failure_preserves_business_data(env, monkeypatch, tmp_path, http_status, api_status, expected):
    calls = mock_http(monkeypatch, lambda _: httpx.Response(http_status, json={"error": {"message": KEY}}, headers={"Location": "https://other.example"}))
    with TestClient(create_app(tmp_path)) as client:
        before = business(client)
        result = generate(client)
        assert result.status_code == api_status and expected in result.text
        assert business(client) == before
        assert KEY not in result.text and not state(client)["model"]["live_verified"]
    assert len(calls) == 1  # No retries, redirects or fallback requests.


@pytest.mark.parametrize("data,finish", [
    ({"creatives": [COPY]}, "stop"),
    ({"creatives": [COPY, {**COPY, "title": "字" * 61}]}, "stop"),
    ({"creatives": [COPY, {**COPY, "cta": "字" * 17}]}, "stop"),
    ({"creatives": [COPY, {**COPY, "script": " "}]}, "stop"),
    ({"creatives": [COPY, COPY]}, "length"),
])
def test_incomplete_creatives_never_partially_saved(env, monkeypatch, tmp_path, data, finish):
    mock_http(monkeypatch, lambda _: response(data, finish))
    with TestClient(create_app(tmp_path)) as client:
        before = business(client)
        assert generate(client).status_code == 502
        assert business(client) == before


def test_timeout_and_invalid_json_are_sanitized(env, monkeypatch):
    def timeout(request):
        raise httpx.ReadTimeout(KEY, request=request)
    calls = mock_http(monkeypatch, timeout)
    with pytest.raises(ModelFailure, match="超时") as error:
        ModelAdapter().check_connection()
    assert KEY not in str(error.value) and len(calls) == 1
    mock_http(monkeypatch, lambda _: httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]}))
    with pytest.raises(ModelFailure, match="无效 JSON"):
        ModelAdapter().check_connection()


def test_glm47_optional_free_model_parameters_and_overload(env, monkeypatch):
    monkeypatch.setenv("MODEL_NAME", "glm-4.7-flash")
    calls = mock_http(monkeypatch, lambda _: response({"ok": True}))
    adapter = ModelAdapter()
    assert adapter.check_connection()["model_name"] == "glm-4.7-flash"
    assert calls[0]["model"] == "glm-4.7-flash" and calls[0]["thinking"] == {"type": "disabled"}
    calls = mock_http(monkeypatch, lambda _: httpx.Response(429, json={"error": {"code": "1305", "message": KEY}}))
    with pytest.raises(ModelFailure, match="1305"):
        adapter.check_connection()
    assert len(calls) == 1


def test_insight_and_optimization_use_model_but_facts_stay_computed(env, monkeypatch, tmp_path):
    suggestion = "第一秒先展示容量和价格，再说明商品外观。"
    def handle(request):
        content = json.loads(request.content)["messages"][1]["content"]
        if '根据已保存的复盘建议' in content:
            assert suggestion in content
            return response({"creative": {**COPY, "title": "先了解规格，再选日常搭子"}})
        return response({"facts": ["恶意覆盖系统事实"], "hypotheses": ["规格信息可能不够清晰，需测试。"], "missing": ["没有随机分组数据。"], "recommendation": suggestion})
    calls = mock_http(monkeypatch, handle)
    with TestClient(create_app(tmp_path)) as client:
        insight = client.post("/api/insights", json={"dataset": "history", "campaign_id": "campaign-demo", "request_id": "review"}).json()
        assert insight["model_name"] == FREE_MODEL and "15" in "".join(insight["facts"])
        assert "恶意覆盖" not in "".join(insight["facts"])
        sent = json.loads(calls[0]["messages"][1]["content"].split("输入资料：", 1)[1])
        assert "orders" not in sent and "buyer_id" not in json.dumps(sent)
        body = {"creative_id": "creative-commute", "request_id": "accept"}
        result = client.post(f'/api/insights/{insight["id"]}/accept', json=body)
        assert result.status_code == 200, result.text
        revised = result.json()
        assert revised["title"] == "先了解规格，再选日常搭子" and revised["source"] == "model"
        assert revised["status"] == "draft" and revised["parent_id"] == "creative-commute"
        repeat = client.post(f'/api/insights/{insight["id"]}/accept', json={**body, "request_id": "accept-again"})
        assert repeat.json()["id"] == revised["id"] and len(calls) == 2
        s = state(client)
        assert len(s["plans"]) == 2 and not s["orders"]
        assert s["insights"][-1]["status"] == "accepted" and len(s["observations"]) == 1


def test_waiting_on_model_does_not_lock_db_and_stale_strategy_is_rejected(env, monkeypatch, tmp_path):
    entered, release = Event(), Event()
    def handle(_):
        entered.set()
        assert release.wait(8)
        return response({"creatives": [COPY, COPY]})
    calls = mock_http(monkeypatch, handle)
    with TestClient(create_app(tmp_path)) as client, ThreadPoolExecutor(max_workers=2) as pool:
        pending = pool.submit(generate, client)
        try:
            assert entered.wait(3)
            # Read finishes while provider is still waiting, not after its timeout.
            assert len(pool.submit(state, client).result(timeout=3)["creatives"]) == 2
            assert generate(client, "second-click").status_code == 409
            edited = client.put("/api/campaigns/campaign-demo", json={"name": "生成中修改策略", "audience": "新的受众", "request_id": "change"})
            assert edited.status_code == 200
        finally:
            release.set()
        assert pending.result(timeout=3).status_code == 409
        assert len(state(client)["creatives"]) == 2 and len(calls) == 1


def test_local_config_preserves_data_and_access_settings(tmp_path):
    path = tmp_path / ".env"
    path.write_text("# local\nDEMO_DATA_DIR=my-data\nDEMO_ACCESS_TOKEN=private-access-code\nMODEL_PROVIDER=replay\nMODEL_PROVIDER=old\n", encoding="utf-8")
    write_settings(path, {"MODEL_PROVIDER": "zhipu-free", "MODEL_API_KEY": KEY})
    content = path.read_text(encoding="utf-8")
    assert content.count("MODEL_PROVIDER=") == 1 and "DEMO_DATA_DIR=my-data" in content
    assert "DEMO_ACCESS_TOKEN=private-access-code" in content
    write_settings(path, {"MODEL_PROVIDER": "replay"})
    assert "MODEL_API_KEY=" + KEY in path.read_text(encoding="utf-8")


def test_connection_check_does_not_modify_business_or_expose_key(env, monkeypatch, tmp_path):
    calls = mock_http(monkeypatch, lambda _: response({"ok": True}))
    with TestClient(create_app(tmp_path)) as client:
        before = business(client)
        result = client.post("/api/model/check")
        assert result.status_code == 200 and result.json()["live_verified"]
        assert KEY not in result.text and business(client) == before and len(calls) == 1


@pytest.mark.parametrize("recommendation,hypotheses", [("分析成本，优化营销策略。", ["尚待验证。"]), ("优化标题，一定会提高成交。", ["测试表达方式。"]), ("调整广告开头。", ["广告已证明有效。"] )])
def test_unactionable_or_causal_review_rejected(env, monkeypatch, tmp_path, recommendation, hypotheses):
    mock_http(monkeypatch, lambda _: response({"hypotheses": hypotheses, "missing": ["没有随机试验。"], "recommendation": recommendation}))
    with TestClient(create_app(tmp_path)) as client:
        before = business(client)
        result = client.post("/api/insights", json={"dataset": "history", "request_id": "bad-advice"})
        assert result.status_code == 502 and business(client) == before
