"""Behavior tests for durable, scoped Agent tasks; no real model/network calls."""
import time
from threading import Event
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.agents import runner as worker
from backend.agents.schemas import Action, LIMITS
from backend.agents.policy import choose_action
from backend.knowledge import get, put
from backend.model_adapter import ModelAdapter, ModelFailure


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    with TestClient(create_app(tmp_path)) as c:
        yield c


def create(client, **extra):
    body = {"scene": "medical", "goal": "整理咨询预约流程和接待时间的内部 FAQ", "request_id": uuid4().hex, **extra}
    response = client.post("/api/agent/tasks", json=body)
    assert response.status_code == 202, response.text
    return response.json()["id"]


def wait(client, task_id):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        result = client.get("/api/agent/tasks/" + task_id).json()
        if result["status"] not in {"queued", "running"}:
            return result
        time.sleep(.025)
    pytest.fail("Task did not reach a checkpoint: " + str(result))


def command(client, task, action, **extra):
    return client.post(f"/api/agent/tasks/{task['id']}/{action}", json={"request_id": uuid4().hex, "expected_attempt": task["attempt"], **extra})


@pytest.mark.parametrize("scene,goal", [("medical", "整理咨询预约流程和接待时间 FAQ"), ("live", "整理保温杯一分钟直播讲解脚本")])
def test_full_task_evidence_review_and_completion(client, scene, goal):
    before = client.get("/api/state").json()
    task = wait(client, create(client, scene=scene, goal=goal))
    assert task["status"] == "waiting_review", task
    assert task["source"] == "replay" and task["model_calls"] == 0
    assert "scratch" not in task
    actions = [e["action"] for e in task["events"]]
    for action in ("search_knowledge", "read_evidence", "generate_draft", "check_draft", "save_draft"):
        assert action in actions
    assert all(s["is_demo"] for s in task["evidence"])
    draft = task["draft"]
    assert draft["agent_task_id"] == task["id"]
    assert command(client, task, "complete", draft_id=draft["id"], draft_revision=1).status_code == 409
    confirmed = client.post(f"/api/knowledge/drafts/{draft['id']}/confirm", json={"acknowledged": True, "expected_revision": 1})
    assert confirmed.status_code == 200
    assert command(client, task, "complete", draft_id=draft["id"], draft_revision=1).status_code == 200
    current = client.get("/api/agent/tasks/" + task["id"]).json()
    assert current["status"] == "completed" and not current["completion_stale"]
    # A completed task records its confirmed version, not any future edited text.
    assert client.put(f"/api/knowledge/drafts/{draft['id']}", json={"expected_revision": 1, "title": "另一次修改", "blocks": draft["blocks"]}).status_code == 200
    assert client.get("/api/agent/tasks/" + task["id"]).json()["completion_stale"]
    after = client.get("/api/state").json()
    for key in ("product", "campaigns", "creatives", "plans", "orders", "events"):
        assert before[key] == after[key]


def test_no_evidence_requests_input_then_new_approved_document_resumes(client):
    task = wait(client, create(client, source_mode="knowledge", space_id="kb-medical"))
    assert task["status"] == "waiting_input" and task["draft"] is None
    doc = client.post("/api/knowledge/documents", json={"space_id": "kb-medical", "title": "咨询预约流程", "pages": [{"text": "咨询预约须先核对希望到店时间，再由本人确认预约信息。"}]}).json()
    # Unapproved input is still excluded after resume.
    assert command(client, task, "continue").status_code == 202
    task = wait(client, task["id"])
    assert task["status"] == "waiting_input"
    client.post(f"/api/knowledge/documents/{doc['id']}/review", json={"expected_version": 1, "status": "approved"})
    assert command(client, task, "continue", note="已补充并审核预约流程，只说明已确认内容").status_code == 202
    task = wait(client, task["id"])
    assert task["status"] == "waiting_review", task
    assert {s["document_id"] for s in task["evidence"]} == {doc["id"]}
    assert task["attempt"] == 3


def test_scene_channel_and_scope_are_server_owned(client, monkeypatch):
    bad = client.post("/api/agent/tasks", json={"scene": "medical", "goal": "预约任务", "source_mode": "knowledge", "space_id": "kb-live"})
    assert bad.status_code == 422
    bad = client.post("/api/agent/tasks", json={"scene": "medical", "goal": "预约任务", "channel": "douyin"})
    assert bad.status_code == 422
    monkeypatch.setattr(worker, "choose_action", lambda *args: Action(action="read_evidence", source_ids=["foreign-source"]))
    task = wait(client, create(client))
    assert task["status"] == "failed" and "候选之外" in task["message"]
    assert task["draft"] is None


def test_idempotent_creation_does_not_duplicate_examples_or_jobs(client):
    request_id = uuid4().hex
    first = create(client, request_id=request_id)
    assert create(client, request_id=request_id) == first
    wait(client, first)
    create(client)
    tasks = client.get("/api/agent/tasks").json()
    assert len(tasks) == 2
    docs = client.get("/api/knowledge/documents?space_id=agent-demo-medical").json()
    assert len(docs) == 3
    assert all("虚构示例" in d["reviewed_by"] for d in docs)


def test_failed_model_preserves_checkpoint_and_manual_retry(client, monkeypatch):
    original = ModelAdapter.knowledge_draft
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", lambda *a: (_ for _ in ()).throw(ModelFailure("接口限流", 429)))
    task = wait(client, create(client))
    assert task["status"] == "failed" and task["stage"] == "generate"
    assert task["evidence"] and task["draft"] is None
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", original)
    assert command(client, task, "continue").status_code == 202
    task = wait(client, task["id"])
    assert task["status"] == "waiting_review"
    assert sum(e["action"] == "search_knowledge" for e in task["events"]) == 1


def test_cancellation_while_network_pending_discards_late_result(client, monkeypatch):
    entered, release = Event(), Event()
    original = ModelAdapter.knowledge_draft
    def pending(*args):
        entered.set()
        assert release.wait(5)
        return original(*args)
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", pending)
    task_id = create(client)
    try:
        assert entered.wait(5)
        task = client.get("/api/agent/tasks/" + task_id).json()
        assert command(client, task, "cancel").status_code == 200
    finally:
        release.set()
    deadline = time.monotonic() + 3
    while client.app.state.model_adapter.operation_lock.locked() and time.monotonic() < deadline:
        time.sleep(.02)
    assert not client.app.state.model_adapter.operation_lock.locked()
    task = wait(client, task_id)
    assert task["status"] == "cancelled" and task["draft"] is None
    assert not client.get("/api/knowledge/drafts?space_id=agent-demo-medical").json()


def test_changed_source_during_generation_requires_new_retrieval(client, monkeypatch):
    original = ModelAdapter.knowledge_draft
    def changed(adapter, context, task):
        source = context["hits"][0]
        doc = client.get("/api/knowledge/documents/" + source["document_id"]).json()
        response = client.put("/api/knowledge/documents/" + doc["id"], json={"expected_version": doc["version"], "space_id": doc["space_id"], "title": doc["title"], "pages": [{"text": "预约信息更新，正在审核"}]})
        assert response.status_code == 200
        return original(adapter, context, task)
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", changed)
    task = wait(client, create(client))
    assert task["status"] == "waiting_input" and task["draft"] is None
    assert "引用资料已更新" in task["message"]


def test_bounded_repair_wont_save_guaranteed_claim(client, monkeypatch):
    calls = []
    def unsupported(adapter, context, task):
        calls.append(1)
        return {"title": "问题草稿", "blocks": [{"text": "本项目保证效果。", "citation_ids": [context["hits"][0]["id"]]}], "missing": []}
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", unsupported)
    task = wait(client, create(client))
    assert task["status"] == "waiting_input" and task["draft"] is None
    assert len(calls) == 2 and not task["check"]["passed"]


def test_forced_generation_without_reading_is_rejected(client, monkeypatch):
    monkeypatch.setattr(worker, "choose_action", lambda *a: Action(action="generate_draft"))
    task = wait(client, create(client))
    assert task["status"] == "failed" and task["draft"] is None
    assert "尚未读取" in task["message"]


def test_unknown_model_tools_and_extra_permissions_fail_closed(monkeypatch):
    adapter = ModelAdapter(); adapter.mode = "zhipu-free"
    task = {"scratch": {}, "goal": "整理预约流程", "scene": "medical", "notes": []}
    for action in [{"action": "publish_ad", "budget": 100}, {"action": "search_knowledge", "query": "预约", "space_id": "another"}]:
        monkeypatch.setattr(adapter, "_complete", lambda *a, **k: action)
        with pytest.raises(ModelFailure, match="工具名称"):
            choose_action(adapter, task)


def test_repeated_search_stops_and_attempt_limit_is_enforced(client, monkeypatch):
    monkeypatch.setattr(worker, "choose_action", lambda *a: Action(action="search_knowledge", query="预约"))
    task = wait(client, create(client))
    assert task["status"] == "waiting_input"
    assert sum(e["action"] == "search_knowledge" for e in task["events"]) == 1
    with client.app.state.store.transaction() as db:
        record = get(db, "agent_runs", task["id"]); record["attempt"] = LIMITS["attempts"]; put(db, "agent_runs", record)
    task["attempt"] = LIMITS["attempts"]
    assert command(client, task, "continue").status_code == 422


def test_service_restart_requires_explicit_resume(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    first = create_app(tmp_path)
    with TestClient(first) as c:
        first.state.agent_runner.stop()
        task_id = create(c)
    with TestClient(create_app(tmp_path)) as c:
        task = wait(c, task_id)
        assert task["status"] == "interrupted" and task["draft"] is None
        assert command(c, task, "continue").status_code == 202
        assert wait(c, task_id)["status"] == "waiting_review"


def test_confirm_cannot_complete_stale_source(client):
    task = wait(client, create(client))
    draft = task["draft"]
    client.post(f"/api/knowledge/drafts/{draft['id']}/confirm", json={"acknowledged": True, "expected_revision": 1})
    source = draft["sources"][0]
    client.post(f"/api/knowledge/documents/{source['document_id']}/review", json={"expected_version": source["version"], "status": "archived"})
    assert command(client, task, "complete", draft_id=draft["id"], draft_revision=1).status_code == 409
    assert not client.get("/api/agent/tasks/" + task["id"]).json()["can_complete"]


def test_semantic_review_repairs_unsupported_claim_before_saving(client, monkeypatch):
    adapter = client.app.state.model_adapter
    adapter.mode = "zhipu-free"; adapter._key = "test-only-not-a-real-key"
    monkeypatch.setattr(worker, "choose_action", lambda a, t: choose_action(SimpleNamespace(mode="replay"), t))
    generations = []
    def generate(a, context, kind):
        generations.append(1)
        source = next(s for s in context["hits"] if s["kind"] == "facts")
        text = "杯盖密封性好，可以有效防止漏水。" if len(generations) == 1 else "这是青禾保温杯，规格为500 ml。"
        return {"title": "内部讲解", "blocks": [{"text": text, "citation_ids": [source["id"]]} for i in range(3)], "missing": []}
    monkeypatch.setattr(worker.tools, "compose_live_script", lambda a, t, s: generate(a, {"hits": s}, "script"))
    def review(job, data, **kwargs):
        if len(generations) == 1:
            return {"supported": False, "issues": [{"block": 1, "claim": "防止漏水", "reason": "原文只说明杯盖结构，没有防漏性能依据"}]}
        return {"supported": True, "issues": []}
    monkeypatch.setattr(adapter, "_complete", review)
    task = wait(client, create(client, scene="live", goal="写保温杯的直播讲解"))
    assert task["status"] == "waiting_review", task
    assert len(generations) == 2 and task["model_calls"] == 7
    assert task["check"]["evidence_review"]["supported"]
    assert not any("漏水" in b["text"] for b in task["draft"]["blocks"])
    assert any(e["action"] == "check_draft" and e["status"] == "attention" for e in task["events"])


@pytest.mark.parametrize("result", [{"supported": True, "issues": [{"block": 1, "claim": "x", "reason": "x"}]}, {"supported": False, "issues": []}, {"supported": False, "issues": [{"block": 6, "claim": "x", "reason": "x"}]}])
def test_invalid_semantic_review_is_not_treated_as_pass(monkeypatch, result):
    from backend.agents.tools import review_evidence
    adapter = ModelAdapter()
    monkeypatch.setattr(adapter, "_complete", lambda *a, **k: result)
    with pytest.raises(ModelFailure, match="复核格式无效"):
        review_evidence(adapter, {"goal": "预约说明", "scratch": {"content": {"blocks": [{"text": "草稿", "citation_ids": ["x"]}]}, "sources": [{"id": "x", "kind": "facts", "text": "预约说明"}]}})


def test_repeated_read_action_stops_before_spending_remaining_budget(client, monkeypatch):
    def decide(adapter, task):
        candidates = task["scratch"].get("candidates", [])
        return Action(action="read_evidence", source_ids=[candidates[0]["id"]]) if candidates else Action(action="search_knowledge", query="预约")
    monkeypatch.setattr(worker, "choose_action", decide)
    task = wait(client, create(client))
    assert task["status"] == "failed" and "重复读取" in task["message"]
    assert sum(e["action"] == "read_evidence" for e in task["events"]) == 1


def test_feature_rules_do_not_treat_missing_or_prohibited_claims_as_positive_evidence():
    from backend.agents.tools import check_content
    source = {"id": "f", "kind": "facts", "text": "规格为500 ml。未提供防漏和剩余水量检测依据。"}
    body = {"blocks": [{"text": "杯盖防漏，可查看剩余水量。", "citation_ids": ["f"]}]}
    result = check_content(body, [source], "live")
    assert not result["passed"] and len(result["blocking"]) == 2
    body["blocks"][0]["text"] = "资料未提供防漏和剩余水量检测依据，不作这些承诺。"
    assert check_content(body, [source], "live")["passed"]
    source["text"] = "已核对具有防漏结构。"
    body["blocks"][0]["text"] = "杯盖采用防漏结构。"
    assert check_content(body, [source], "live")["passed"]


def test_queue_capacity_and_access_code(client, monkeypatch):
    client.app.state.agent_runner.stop()
    ids = [create(client) for _ in range(4)]
    assert client.post("/api/agent/tasks", json={"scene": "medical", "goal": "整理预约说明"}).status_code == 409
    queued = client.get("/api/agent/tasks/" + ids[0]).json()
    assert command(client, queued, "cancel").status_code == 200
    create(client)
    monkeypatch.setenv("DEMO_ACCESS_TOKEN", "agent-test-code")
    assert client.get("/api/agent/tasks").status_code == 401
    assert client.get("/api/agent/tasks", headers={"X-Demo-Token": "agent-test-code"}).status_code == 200


def test_live_composition_preserves_exact_facts_and_rejects_invented_ids(monkeypatch):
    from backend.agents.tools import compose_live_script
    adapter = ModelAdapter()
    sources = [{"id": "s1", "kind": "facts", "text": "青禾保温杯。商品规格为500 ml。未提供密封、防漏等性能依据。"}]
    task = {"goal": "直播讲解", "notes": []}
    monkeypatch.setattr(adapter, "_complete", lambda *a, **k: {"title": "随意标题不作为业务事实", "opening_ids": ["f1"], "display_ids": ["f2"], "closing_ids": []})
    result = compose_live_script(adapter, task, sources)
    assert result["writing_mode"] == "evidence_composed" and len(result["blocks"]) == 3
    assert [f["text"] for f in result["selected_facts"]] == ["青禾保温杯。", "商品规格为500 ml。"]
    assert all(f["text"] in sources[0]["text"] for f in result["selected_facts"])
    assert "防漏" not in "".join(b["text"] for b in result["blocks"])
    monkeypatch.setattr(adapter, "_complete", lambda *a, **k: {"title": "错误", "opening_ids": ["f99"], "display_ids": ["f2"]})
    with pytest.raises(ModelFailure, match="不存在的事实"):
        compose_live_script(adapter, task, sources)
