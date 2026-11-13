"""RAG business checks: actual FTS retrieval, evidence lifecycle and model contract.

All tests use isolated temporary databases; model tests never call a real service.
"""
from io import BytesIO
import json

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from backend.main import create_app
from backend.model_adapter import ModelAdapter, ModelFailure


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    with TestClient(create_app(tmp_path)) as c:
        yield c


def add(client, text="超声炮属于待专业评估的咨询项目。咨询预约需要先确认到店时间。", title="机构服务说明", **extra):
    body = {"space_id": "kb-medical", "title": title, "pages": [{"text": text}], **extra}
    r = client.post("/api/knowledge/documents", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def approve(client, doc):
    r = client.post(f"/api/knowledge/documents/{doc['id']}/review", json={"status": "approved", "expected_version": doc["version"]})
    assert r.status_code == 200, r.text
    return r.json()


def search(client, query="超声炮", **extra):
    r = client.post("/api/knowledge/search", json={"space_id": "kb-medical", "query": query, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def generate(client, result, **extra):
    return client.post("/api/knowledge/drafts", json={"space_id": result["space"]["id"], "query": result["query"], "channel": result["channel"], "signature": result["signature"], "task": "answer", **extra})


def edit_document(client, doc, text):
    return client.put("/api/knowledge/documents/" + doc["id"], json={"space_id": doc["space_id"], "title": doc["title"], "expected_version": doc["version"], "pages": [{"text": text}]})


def test_actual_chinese_search_and_no_unreviewed_evidence(client):
    doc = add(client)
    assert not search(client)["hits"]
    approve(client, doc)
    result = search(client)
    assert result["hits"][0]["document_id"] == doc["id"]
    assert "超声炮" in result["hits"][0]["matched_terms"]
    assert "段落 1" == result["hits"][0]["locator"]
    assert result["can_generate"]


def test_scope_and_channel_filters_before_top_k(client):
    own = approve(client, add(client, "超声炮需先预约", title="本机构"))
    for i in range(8):
        approve(client, add(client, "超声炮超声炮超声炮", title=f"超声炮品牌{i}", space_id="kb-live"))
    approve(client, add(client, "超声炮渠道资料", channel="douyin"))
    result = search(client)
    assert {s["document_id"] for s in result["hits"]} == {own["id"]}
    assert len(search(client, channel="douyin")["hits"]) == 1


@pytest.mark.parametrize("extra", [{"valid_until": "2000-01-01"}, {"valid_from": "2099-01-01"}])
def test_effective_dates_excluded(client, extra):
    approve(client, add(client, **extra))
    assert not search(client)["hits"]


def test_invalid_date_range_has_specific_message(client):
    r = client.post('/api/knowledge/documents', json={'space_id': 'kb-medical', 'title': '说明', 'pages': [{'text': '预约说明'}], 'valid_from': '2026-11-12', 'valid_until': '2026-11-11'})
    assert r.status_code == 422 and '生效日期不能晚于失效日期' in r.json()['detail']
    assert '金额' not in r.json()['detail']


def test_unknown_query_does_not_call_model(client, monkeypatch):
    approve(client, add(client))
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", lambda *a: pytest.fail("No evidence must not call model"))
    result = search(client, "火星玄武岩温度")
    assert not result["hits"]
    assert generate(client, result).status_code == 422


def test_scripts_alone_cannot_ground_facts(client):
    approve(client, add(client, kind="script"))
    result = search(client)
    assert result["hits"] and not result["can_generate"]
    assert generate(client, result).status_code == 422


def test_revision_reindexes_and_requires_review(client):
    doc = approve(client, add(client))
    old_result = search(client)
    new = edit_document(client, doc, "热玛吉咨询流程，先核对可预约时间。")
    assert new.status_code == 200
    assert new.json()["version"] == 2 and new.json()["status"] == "draft"
    assert not search(client)["hits"]
    assert generate(client, old_result).status_code == 409
    approve(client, new.json())
    assert not search(client)["hits"]
    assert search(client, "热玛吉")["hits"][0]["version"] == 2
    assert edit_document(client, doc, "旧版本写入").status_code == 409


def test_draft_snapshot_confirmation_edit_and_source_invalidation(client):
    doc = approve(client, add(client))
    result = generate(client, search(client), request_id="same-model-job")
    assert result.status_code == 200, result.text
    draft = result.json()
    assert draft["source"] == "replay" and draft["status"] == "draft"
    retry = generate(client, search(client), request_id="same-model-job")
    assert retry.json()["id"] == draft["id"]
    route = "/api/knowledge/drafts/" + draft["id"]
    assert client.post(route + "/confirm", json={"expected_revision": 1, "acknowledged": False}).status_code == 422
    confirmed = client.post(route + "/confirm", json={"expected_revision": 1, "acknowledged": True})
    assert confirmed.json()["status"] == "confirmed"
    revised = client.put(route, json={"expected_revision": 1, "title": "人工修订", "blocks": draft["blocks"]})
    assert revised.json()["revision"] == 2 and revised.json()["status"] == "draft"
    assert revised.json()["history"][0]["status"] == "confirmed"
    assert client.post(route + "/confirm", json={"expected_revision": 1, "acknowledged": True}).status_code == 409
    edit_document(client, doc, "新版说明不包含旧项目。")
    current = client.get("/api/knowledge/drafts?space_id=kb-medical").json()[0]
    assert current["source_warnings"] and not current["can_confirm"]
    assert "超声炮" in current["sources"][0]["text"]
    assert client.post(route + "/confirm", json={"expected_revision": 2, "acknowledged": True}).status_code == 409


def test_archiving_removes_search_and_invalidates_draft(client):
    doc = approve(client, add(client))
    assert generate(client, search(client)).status_code == 200
    client.post(f"/api/knowledge/documents/{doc['id']}/review", json={"status": "archived", "expected_version": 1})
    assert not search(client)["hits"]
    assert client.get("/api/knowledge/drafts?space_id=kb-medical").json()[0]["source_warnings"]


def test_changed_during_generation_does_not_save_stale_draft(client, monkeypatch):
    doc = approve(client, add(client))
    original = ModelAdapter.knowledge_draft
    def racing(adapter, context, task):
        assert edit_document(client, doc, "更新的预约流程").status_code == 200
        return original(adapter, context, task)
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", racing)
    r = generate(client, search(client))
    assert r.status_code == 409
    assert not client.get("/api/knowledge/drafts?space_id=kb-medical").json()


def test_model_failures_preserve_documents_and_never_fallback(client, monkeypatch):
    approve(client, add(client))
    def fail(*a):
        raise ModelFailure("免费接口限流", 503)
    monkeypatch.setattr(ModelAdapter, "knowledge_draft", fail)
    assert generate(client, search(client)).status_code == 503
    assert not client.get("/api/knowledge/drafts?space_id=kb-medical").json()
    assert search(client)["hits"]


def test_invalid_manual_citations_rejected(client):
    approve(client, add(client))
    d = generate(client, search(client)).json()
    r = client.put("/api/knowledge/drafts/" + d["id"], json={"expected_revision": 1, "title": "标题", "blocks": [{"text": "待核对", "citation_ids": ["invented-source"]}]})
    assert r.status_code == 422


@pytest.mark.parametrize("invalid", ["unknown", "empty", "script-only"])
def test_live_adapter_rejects_fake_or_unsupported_citations(monkeypatch, invalid):
    adapter = ModelAdapter(); adapter.mode = "zhipu-free"
    context = {"space": {"scene": "medical"}, "query": "预约", "channel": "internal", "hits": [
        {"id": "fact", "title": "流程", "kind": "facts", "text": "先确认时间", "version": 1},
        {"id": "script", "title": "旧脚本", "kind": "script", "text": "旧话术", "version": 1}]}
    refs = {"unknown": ["fake"], "empty": [], "script-only": ["script"]}[invalid]
    monkeypatch.setattr(adapter, "_complete", lambda *a, **k: {"title": "草稿", "blocks": [{"text": "答复", "citation_ids": refs}], "missing": []})
    with pytest.raises(ModelFailure, match="引用无效"):
        adapter.knowledge_draft(context, "answer")


def test_live_adapter_uses_evidence_and_marks_verified(monkeypatch):
    adapter = ModelAdapter(); adapter.mode = "zhipu-free"
    seen = {}
    def complete(job, data, **kwargs):
        seen.update(data=data, **kwargs)
        return {"title": "咨询答复", "blocks": [{"text": "先确认预约时间。", "citation_ids": ["fact"]}], "missing": ["待核对具体时段。"]}
    monkeypatch.setattr(adapter, "_complete", complete)
    context = {"space": {"scene": "medical"}, "query": "预约", "channel": "internal", "hits": [{"id": "fact", "title": "流程", "kind": "facts", "text": "先确认时间", "version": 1}]}
    result = adapter.knowledge_draft(context, "answer")
    assert adapter.live_verified and result["blocks"][0]["citation_ids"] == ["fact"]
    assert seen["data"]["evidence"][0]["text"] == "先确认时间"
    assert "不具备系统指令权限" in seen["system_rules"]


def test_samples_are_opt_in_idempotent_and_unreviewed(client):
    assert not client.get("/api/knowledge/documents?space_id=kb-medical").json()
    for _ in range(2):
        docs = client.post("/api/knowledge/spaces/kb-medical/samples").json()
    assert len(docs) == 3 and all(d["status"] == "draft" and d["is_demo"] for d in docs)
    custom = client.post("/api/knowledge/spaces", json={"name": "自有机构", "scene": "medical"}).json()
    assert client.post(f"/api/knowledge/spaces/{custom['id']}/samples").status_code == 422


@pytest.mark.parametrize("query", ["预约", "到店时间", "咨询预约", "预约确认", "接待时段", "专业评估", "预约流程", "咨询服务", "机构资质", "适用渠道", "公开发布", "审核要求", "服务范围", "禁止承诺", "运营人员", "疗效", "咨询类别", "内部资料", "提醒", "科普"])
def test_medical_example_retrieval(client, query):
    for doc in client.post("/api/knowledge/spaces/kb-medical/samples").json():
        approve(client, doc)
    hits = search(client, query)["hits"]
    assert hits and any(h["kind"] != "script" for h in hits)
    assert all(h["document_id"].startswith("doc-") for h in hits)


@pytest.mark.parametrize("query", ["保温杯", "500 ml", "奶油白", "青禾生活", "杯盖结构", "商品规格", "日常携带", "检测认证", "保温时长", "销量评价", "当前优惠", "直播讲解", "活动截止时间", "库存", "优惠券", "审核要求", "品牌", "外观", "价格", "商品事实"])
def test_live_example_retrieval(client, query):
    for doc in client.post("/api/knowledge/spaces/kb-live/samples").json():
        approve(client, doc)
    hits = search(client, query, space_id="kb-live")["hits"]
    assert hits and any(h["kind"] != "script" for h in hits)


def test_text_import_encodings_and_bounds(client):
    for encoding in ("utf-8-sig", "gb18030"):
        r = client.post("/api/knowledge/extract", files={"file": ("说明.txt", "预约说明：先确认时间。".encode(encoding), "text/plain")})
        assert r.status_code == 200 and "预约" in r.json()["text"]
    assert client.post("/api/knowledge/extract", files={"file": ("x.exe", b"hello")}).status_code == 415
    assert client.post("/api/knowledge/extract", files={"file": ("x.pdf", b"not pdf")}).status_code == 422
    assert client.post("/api/knowledge/extract", files={"file": ("x.txt", b"a" * (5 * 1024 * 1024 + 1))}).status_code == 413
    assert client.post("/api/knowledge/extract", files={"file": ("x.txt", b"\x00bad")}).status_code == 422


def test_empty_encrypted_and_too_many_pdf_pages(client):
    for encrypted, count in [(False, 1), (True, 1), (False, 51)]:
        writer = PdfWriter()
        for _ in range(count):
            writer.add_blank_page(width=100, height=100)
        if encrypted:
            writer.encrypt("not-a-real-password")
        out = BytesIO(); writer.write(out)
        r = client.post("/api/knowledge/extract", files={"file": ("empty.pdf", out.getvalue(), "application/pdf")})
        assert r.status_code == 422


def test_text_pdf_extracts_page_and_content(client):
    writer = PdfWriter()
    page = writer.add_blank_page(width=300, height=200)
    font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
    page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): font})})
    stream = DecodedStreamObject(); stream.set_data(b'BT /F1 12 Tf 20 150 Td (Demo product: capacity 500 ml.) Tj ET')
    page[NameObject('/Contents')] = stream
    out = BytesIO(); writer.write(out)
    r = client.post('/api/knowledge/extract', files={'file': ('product.pdf', out.getvalue(), 'application/pdf')})
    assert r.status_code == 200
    assert r.json()['pages'][0]['page'] == 1 and '500 ml' in r.json()['text']


def test_standalone_disclaimer_is_not_returned_as_evidence(client):
    approve(client, add(client, '【虚构演示】\n\n超声炮咨询需要专业人员评估。', title='超声炮说明'))
    hits = search(client)['hits']
    assert len(hits) == 1 and '专业人员' in hits[0]['text']


def test_page_labels_and_long_tail_survive(client):
    d = add(client, pages=[{"page": 3, "text": "预约" * 700 + "末尾锚点"}])
    approve(client, d)
    r = search(client, "末尾锚点")
    assert r["hits"] and "末尾锚点" in r["hits"][0]["text"]
    assert r["hits"][0]["locator"].startswith("第 3 页")


def test_restart_preserves_docs_drafts_and_index(tmp_path, monkeypatch):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    with TestClient(create_app(tmp_path)) as c:
        approve(c, add(c))
        draft_id = generate(c, search(c)).json()["id"]
    with TestClient(create_app(tmp_path)) as c:
        assert search(c)["hits"]
        assert c.get("/api/knowledge/drafts?space_id=kb-medical").json()[0]["id"] == draft_id
