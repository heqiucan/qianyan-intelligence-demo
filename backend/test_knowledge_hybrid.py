"""Hybrid retrieval business boundaries, using isolated data and a fake local ranker.

The semantic ranker is replaced at its boundary. These checks exercise the real
HTTP routes, FTS index, scoped corpus selection, draft budget and SQLite locks.
"""
import sqlite3
from threading import Event

import pytest

from backend import knowledge
from backend.model_adapter import ModelAdapter
from backend.test_knowledge import add, approve, client, edit_document, generate, search


def semantic_result(scores=None, status="ready"):
    return {"scores": scores or {}, "status": status, "model": "isolated-test-encoder",
            "message": "测试替身；不代表真实语义质量。"}


def archive(client, doc):
    response = client.post(f"/api/knowledge/documents/{doc['id']}/review",
                           json={"status": "archived", "expected_version": doc["version"]})
    assert response.status_code == 200, response.text
    return response.json()


def test_semantic_ranker_only_receives_current_eligible_scope(client, monkeypatch):
    own = approve(client, add(client, "超声炮预约流程。", title="本机构说明"))
    hidden = [
        approve(client, add(client, "其他空间的未公开资料。", space_id="kb-live")),
        approve(client, add(client, "其他渠道的未公开资料。", channel="douyin")),
        add(client, "待审核内容不应进行向量计算。"),
        approve(client, add(client, "过期内容。", valid_until="2000-01-01")),
        approve(client, add(client, "未来生效内容。", valid_from="2099-01-01")),
        archive(client, approve(client, add(client, "已归档内容。"))),
    ]
    observed = []

    def rank(query, candidates):
        observed.extend(candidates)
        # Even a malformed ranker's out-of-scope id must not become evidence.
        return semantic_result({own["chunks"][0]["id"]: .81,
                                hidden[0]["chunks"][0]["id"]: .99})

    monkeypatch.setattr(knowledge, "rank_semantic", rank)
    result = search(client, "登记访客")
    assert [row["id"] for row in observed] == [own["chunks"][0]["id"]]
    assert observed[0]["text"] == own["chunks"][0]["text"]
    assert {row["document_id"] for row in result["hits"]} == {own["id"]}
    assert result["hits"][0]["retrieval_methods"] == ["semantic"]


def test_one_document_can_show_twelve_chunks_but_generation_sees_six(client, monkeypatch):
    text = "\n\n".join(f"预约流程第 {number} 步：核对登记信息。" for number in range(15))
    doc = approve(client, add(client, text, title="预约流程"))
    result = search(client, "预约", mode="keyword")
    assert len(result["hits"]) == 12
    assert {row["document_id"] for row in result["hits"]} == {doc["id"]}
    assert len(result["evidence_ids"]) == 6
    assert len(set(result["evidence_ids"])) == 6
    supplied = []

    def draft(adapter, context, task):
        supplied.extend(context["hits"])
        return {"title": "隔离测试草稿", "blocks": [
            {"text": row["text"], "citation_ids": [row["id"]]} for row in context["hits"]],
            "missing": []}

    monkeypatch.setattr(ModelAdapter, "knowledge_draft", draft)
    response = generate(client, result, mode="keyword")
    assert response.status_code == 200, response.text
    assert [row["id"] for row in supplied] == result["evidence_ids"]
    saved = response.json()
    assert len(saved["sources"]) == 6
    assert all(row["text"] == next(chunk["text"] for chunk in doc["chunks"]
                                     if chunk["id"] == row["id"]) for row in saved["sources"])


def test_displayed_candidate_outside_evidence_budget_cannot_be_cited(client, monkeypatch):
    approve(client, add(client, "\n\n".join(f"预约登记 {number}。" for number in range(10))))
    result = search(client, "预约", mode="keyword")
    extra = next(hit for hit in result["hits"] if hit["id"] not in result["evidence_ids"])
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", lambda *args: {
        "title": "错误引用", "blocks": [{"text": extra["text"], "citation_ids": [extra["id"]]}],
        "missing": []})
    assert generate(client, result, mode="keyword").status_code == 422
    assert client.get("/api/knowledge/drafts?space_id=kb-medical").json() == []


def test_rrf_promotes_shared_hit_and_returns_each_original_chunk_once(client, monkeypatch):
    lexical = approve(client, add(client, "超声炮。" * 20, title="超声炮"))
    shared = approve(client, add(client, "超声炮咨询需要核对登记信息和预约排期。", title="服务说明"))
    semantic_only = approve(client, add(client, "到院之前先登记联系信息。", title="访客须知"))
    lexical_id, shared_id, semantic_id = [doc["chunks"][0]["id"]
                                          for doc in (lexical, shared, semantic_only)]
    lexical_result = search(client, "超声炮", mode="keyword")
    assert [row["id"] for row in lexical_result["hits"]] == [lexical_id, shared_id]
    monkeypatch.setattr(knowledge, "rank_semantic", lambda *args: semantic_result({
        semantic_id: .99, shared_id: .80}))
    result = search(client, "超声炮")
    assert result["hits"][0]["id"] == shared_id
    assert result["hits"][0]["retrieval_methods"] == ["keyword", "semantic"]
    assert len(result["hits"]) == 3
    assert {row["id"] for row in result["hits"]} == {lexical_id, shared_id, semantic_id}
    assert result["retrieval"]["used_mode"] == "hybrid"


def test_mode_change_invalidates_generation_even_when_hits_are_identical(client, monkeypatch):
    approve(client, add(client))
    monkeypatch.setattr(knowledge, "rank_semantic", lambda *args: semantic_result(status="unavailable"))
    keyword = search(client, mode="keyword")
    hybrid = search(client, mode="hybrid")
    assert keyword["hits"] == hybrid["hits"]
    assert keyword["signature"] != hybrid["signature"]
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", lambda *args: pytest.fail("Stale search cannot call model"))
    assert generate(client, keyword, mode="hybrid").status_code == 409


@pytest.mark.parametrize("mutation", ["edit", "archive"])
def test_change_during_generation_rejects_new_draft_and_preserves_old_snapshot(client, monkeypatch, mutation):
    doc = approve(client, add(client))
    monkeypatch.setattr(knowledge, "rank_semantic", lambda *args: semantic_result(
        {doc["chunks"][0]["id"]: .8}))
    result = search(client)
    old_response = generate(client, result)
    assert old_response.status_code == 200, old_response.text
    old_draft = old_response.json()
    original = ModelAdapter.knowledge_draft

    def racing(adapter, context, task):
        if mutation == "edit":
            assert edit_document(client, doc, "新版热玛吉说明，重新登记预约。").status_code == 200
        else:
            archive(client, doc)
        return original(adapter, context, task)

    monkeypatch.setattr(ModelAdapter, "knowledge_draft", racing)
    response = generate(client, result)
    assert response.status_code == 409
    drafts = client.get("/api/knowledge/drafts?space_id=kb-medical").json()
    assert len(drafts) == 1
    assert drafts[0]["id"] == old_draft["id"]
    assert drafts[0]["sources"] == old_draft["sources"]
    assert drafts[0]["source_warnings"]
    assert not drafts[0]["can_confirm"]


@pytest.mark.parametrize("status", ["disabled", "unavailable"])
def test_explicit_semantic_fallback_preserves_keyword_results(client, monkeypatch, status):
    approve(client, add(client))
    keyword = search(client, mode="keyword")
    monkeypatch.setattr(knowledge, "rank_semantic", lambda *args: semantic_result(status=status))
    result = search(client)
    assert result["hits"] == keyword["hits"]
    assert result["retrieval"]["used_mode"] == "keyword"
    assert result["retrieval"]["semantic_status"] == status
    assert result["can_generate"]


def test_synonym_recall_and_typo_suggestion_do_not_silently_rewrite_query(client):
    doc = approve(client, add(client, "预约先登记姓名。", title="服务说明"))
    expanded = search(client, "约个时间", mode="keyword")
    assert expanded["query"] == "约个时间"
    assert "预约" in expanded["expanded_terms"]
    assert expanded["hits"][0]["document_id"] == doc["id"]
    typo = search(client, "预跃", mode="keyword")
    assert typo["query"] == "预跃"
    assert typo["hits"] == []
    assert typo["corrections"] == [{"original": "预跃", "suggestion": "预约", "query": "预约"}]
    explicit = search(client, typo["corrections"][0]["query"], mode="keyword")
    assert explicit["hits"][0]["document_id"] == doc["id"]


def test_unreviewed_vocabulary_is_not_exposed_through_correction_suggestions(client):
    doc = add(client, "优惠券说明。", title="未审核文档", space_id="kb-live")
    hidden = search(client, "优慧券", space_id="kb-live", mode="keyword")
    assert hidden["corrections"] == []
    approve(client, doc)
    visible = search(client, "优慧券", space_id="kb-live", mode="keyword")
    assert visible["corrections"][0]["suggestion"] == "优惠券"
    assert visible["hits"] == []


def test_search_and_generation_inference_release_sqlite_writer_lock(client, monkeypatch):
    doc = approve(client, add(client))
    acquired = []

    def rank(query, candidates):
        other_connection = sqlite3.connect(client.app.state.store.path, timeout=.1)
        try:
            other_connection.execute("BEGIN IMMEDIATE")
            acquired.append(True)
            other_connection.rollback()
        finally:
            other_connection.close()
        return semantic_result({doc["chunks"][0]["id"]: .8})

    monkeypatch.setattr(knowledge, "rank_semantic", rank)
    result = search(client)
    response = generate(client, result)
    assert response.status_code == 200, response.text
    assert len(acquired) >= 2


def test_change_while_generation_reranks_is_checked_before_model_call(client, monkeypatch):
    doc = approve(client, add(client))
    monkeypatch.setattr(knowledge, "rank_semantic", lambda *args: semantic_result(
        {doc["chunks"][0]["id"]: .8}))
    result = search(client)

    def racing_rank(query, candidates):
        archive(client, doc)
        return semantic_result({doc["chunks"][0]["id"]: .8})

    monkeypatch.setattr(knowledge, "rank_semantic", racing_rank)
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", lambda *args: pytest.fail("Changed scope must not call model"))
    assert generate(client, result).status_code == 409
    assert client.get("/api/knowledge/drafts?space_id=kb-medical").json() == []


def test_agent_cancellation_during_semantic_ranking_fences_late_candidates(client, monkeypatch):
    from backend.test_agents import create, command

    doc = approve(client, add(client))
    entered, release, finished = Event(), Event(), Event()
    runner = client.app.state.agent_runner
    execute = runner.execute

    def track_execute(task_id, attempt):
        try:
            execute(task_id, attempt)
        finally:
            finished.set()

    def pending_rank(query, candidates):
        other = sqlite3.connect(client.app.state.store.path, timeout=.1)
        try:
            other.execute("BEGIN IMMEDIATE")
            other.rollback()
        finally:
            other.close()
        entered.set()
        assert release.wait(5), "Test must release the pending local ranker"
        return semantic_result({doc["chunks"][0]["id"]: .8})

    monkeypatch.setattr(runner, "execute", track_execute)
    monkeypatch.setattr(knowledge, "rank_semantic", pending_rank)
    task_id = create(client, source_mode="knowledge", space_id="kb-medical")
    try:
        assert entered.wait(5), "Agent must reach unlocked semantic inference"
        task = client.get("/api/agent/tasks/" + task_id).json()
        assert command(client, task, "cancel").status_code == 200
    finally:
        release.set()
    assert finished.wait(5), "Wait for the late result to pass the cancellation fence"
    current = client.get("/api/agent/tasks/" + task_id).json()
    assert current["status"] == "cancelled" and current["draft"] is None
    assert not any(event["action"] == "search_knowledge" for event in current["events"])
    with client.app.state.store.transaction() as db:
        stored = knowledge.get(db, "agent_runs", task_id)
        assert not stored["scratch"].get("candidates")
    assert client.get("/api/knowledge/drafts?space_id=kb-medical").json() == []


def test_agent_revalidates_scope_after_unlocked_semantic_ranking(client, monkeypatch):
    from backend.test_agents import create, wait

    doc = approve(client, add(client))

    def racing_rank(query, candidates):
        archive(client, doc)
        return semantic_result({doc["chunks"][0]["id"]: .8})

    monkeypatch.setattr(knowledge, "rank_semantic", racing_rank)
    task = wait(client, create(client, source_mode="knowledge", space_id="kb-medical"))
    assert task["status"] == "waiting_input"
    assert "检索期间资料发生变化" in task["message"]
    assert task["draft"] is None
    with client.app.state.store.transaction() as db:
        stored = knowledge.get(db, "agent_runs", task["id"])
        assert not stored["scratch"].get("candidates")
    assert client.get("/api/knowledge/drafts?space_id=kb-medical").json() == []


def test_single_character_query_can_reach_semantic_search_without_fts_terms(client, monkeypatch):
    doc = approve(client, add(client, "杯具规格为500毫升。", title="杯子资料", space_id="kb-live"))
    queries = []

    def rank(query, candidates):
        queries.append(query)
        return semantic_result({doc["chunks"][0]["id"]: .9})

    monkeypatch.setattr(knowledge, "rank_semantic", rank)
    result = search(client, "杯", space_id="kb-live")
    assert result["terms"] == []
    assert queries == ["杯"]
    assert result["hits"][0]["document_id"] == doc["id"]
    assert result["hits"][0]["retrieval_methods"] == ["semantic"]
    assert result["retrieval"]["used_mode"] == "hybrid"


def test_punctuation_only_query_does_not_call_semantic_model(client, monkeypatch):
    approve(client, add(client))
    monkeypatch.setattr(knowledge, "rank_semantic", lambda *args: pytest.fail("Punctuation has no retrieval intent"))
    result = search(client, "？！……。")
    assert result["terms"] == []
    assert result["hits"] == []
    assert not result["can_generate"]
