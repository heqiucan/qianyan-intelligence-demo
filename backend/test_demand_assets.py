"""Real CSV/XLSX parsing, immutable provenance and scoped asset versioning."""
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.demand_assets import register_demand_assets
from backend.knowledge import DocumentInput, get, save_document
from backend.main import Store


@pytest.fixture
def client(tmp_path):
    store = Store(tmp_path)
    store.initialize()
    app = FastAPI()
    app.state.store = store
    register_demand_assets(app, store)
    with TestClient(app) as client:
        yield client


def upload(client, data, filename="需求.csv"):
    return client.post("/api/demand/import/preview", files={"file": (filename, data)})


def batch_payload(**extra):
    return {"space_id": "kb-medical", "title": "问题词库", "filename": "问题.csv", "sheet": "CSV",
            "columns": [{"column": 0, "label": "主题"}], "has_header": True, "time_column": 1,
            "rows": [{"row": 1, "values": ["主题", "时间"]},
                     {"row": 2, "values": ["  超声炮  预约？  ", "2026-11-02"]},
                     {"row": 3, "values": ["超声炮  预约？", ""]},
                     {"row": 4, "values": ["热玛吉多少钱？", "不详"]}], **extra}


def make_batch(client, **extra):
    response = client.post("/api/demand/batches", json=batch_payload(**extra))
    assert response.status_code == 200, response.text
    return response.json()


def workbook_bytes():
    from openpyxl import Workbook
    from datetime import datetime
    workbook = Workbook()
    worksheet = workbook.active
    worksheet.title = "词库"
    worksheet.append(["词条", "时间", "未核公式"])
    worksheet.append(["超声炮怎么预约", datetime(2026, 11, 2), "=1+1"])
    workbook.create_sheet("第二页").append(["另一个问题"])
    stream = BytesIO()
    workbook.save(stream)
    workbook.close()
    return stream.getvalue()


def test_csv_multiline_physical_locations_and_unicode(client):
    response = upload(client, '\ufeff问题,时间\r\n"超声炮\n怎么预约？",2026-11-02\r\n价格？,\r\n'.encode())
    assert response.status_code == 200, response.text
    sheet = response.json()["sheets"][0]
    assert sheet["headers"][0] == {"column": 0, "label": "问题"}
    assert [r["row"] for r in sheet["rows"]] == [1, 2, 4]
    assert sheet["rows"][1]["values"][0] == "超声炮\n怎么预约？"


def test_gb18030_csv_and_tsv(client):
    response = upload(client, "问题\t备注\n热玛吉\t咨询".encode("gb18030"), "词库.tsv")
    assert response.status_code == 200
    assert "GB18030" in response.json()["warnings"][0]
    assert response.json()["sheets"][0]["rows"][1]["values"] == ["热玛吉", "咨询"]


def test_txt_preserves_commas_as_sentence(client):
    response = upload(client, "超声炮，怎么预约?\n热玛吉,多少钱?".encode(), "问题.txt")
    assert response.status_code == 200
    assert response.json()["sheets"][0]["rows"][1]["values"] == ["热玛吉,多少钱?"]


def test_formula_values_never_enter_preview_or_batch(client):
    response = upload(client, '问题,备注\n=1+1,普通内容\n@SUM(A1),原文'.encode())
    assert response.status_code == 200
    data = response.json()
    assert len(data["warnings"]) == 2
    assert data["sheets"][0]["rows"][1]["values"][0] == ""
    body = batch_payload(rows=[{"row": 1, "values": ["词条", "时间"]}, {"row": 2, "values": ["=1+1", ""]}])
    assert client.post("/api/demand/batches", json=body).status_code == 422


@pytest.mark.parametrize("data,filename,status", [
    (b"", "x.csv", 413), (b"x" * (5 * 1024 * 1024 + 1), "x.csv", 413),
    (b"anything", "x.xls", 422), (b"notzip", "x.xlsx", 422),
    (b"a\x00b", "x.csv", 422), (b'"broken', "x.csv", 422),
    ((b"x\n" * 2001), "x.txt", 422), ((b"x," * 20) + b"x", "x.csv", 422),
])
def test_import_rejects_invalid_or_unbounded_files(client, data, filename, status):
    assert upload(client, data, filename).status_code == status


def test_xlsx_real_sheets_dates_formulas_and_reimport(client):
    response = upload(client, workbook_bytes(), "词表.xlsx")
    assert response.status_code == 200, response.text
    data = response.json()
    assert [s["name"] for s in data["sheets"]] == ["词库", "第二页"]
    assert data["sheets"][0]["rows"][1]["values"] == ["超声炮怎么预约", "2026-11-02T00:00:00", ""]
    assert "公式" in data["warnings"][0]
    body = batch_payload(filename=data["filename"], sheet="词库", rows=data["sheets"][0]["rows"])
    imported = client.post("/api/demand/batches", json=body).json()
    assert imported["rows"][0]["source"]["row"] == 2
    assert imported["rows"][0]["occurred_at"] == "2026-11-02T00:00:00+00:00"


def test_xlsx_sparse_malicious_dimensions_are_bounded(client):
    raw = workbook_bytes()
    output = BytesIO()
    with ZipFile(BytesIO(raw)) as original, ZipFile(output, "w", ZIP_DEFLATED) as changed:
        for item in original.infolist():
            data = original.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                data = data.replace(b'r="C2"', b'r="XFD2"')
            changed.writestr(item.filename, data)
    response = upload(client, output.getvalue(), "sparse.xlsx")
    assert response.status_code == 422
    assert "20 列" in response.text


def test_xlsx_entity_declarations_are_rejected(client):
    output = BytesIO()
    with ZipFile(BytesIO(workbook_bytes())) as original, ZipFile(output, "w", ZIP_DEFLATED) as changed:
        for item in original.infolist():
            data = original.read(item.filename)
            if item.filename == "xl/worksheets/sheet1.xml":
                data = b'<!DOCTYPE worksheet [<!ENTITY x "entity">]>' + data
            changed.writestr(item.filename, data)
    assert upload(client, output.getvalue(), "entity.xlsx").status_code == 422


def test_batch_original_normalization_duplicates_time_provenance(client):
    batch = make_batch(client, filename="C:\\private\\问题.csv")
    assert batch["row_count"] == 3 and batch["duplicate_count"] == 1
    first, duplicate, invalid = batch["rows"]
    assert first["original"] == "  超声炮  预约？  "
    assert first["normalized"] == "超声炮 预约?"
    assert first["source"] == {"filename": "问题.csv", "sheet": "CSV", "row": 2, "column": 0, "label": "主题"}
    assert duplicate["duplicate_of"] == first["id"]
    assert duplicate["occurred_at"] is None and invalid["warnings"]
    assert first["review_status"] == "pending" and batch["role"] == "demand"
    summaries = client.get("/api/demand/batches?space_id=kb-medical").json()
    assert len(summaries) == 1 and "rows" not in summaries[0]
    assert client.get("/api/demand/batches/" + batch["id"]).json() == batch


def test_batch_repeat_import_request_id_and_cross_space(client):
    first = make_batch(client, request_id="one")
    retry = make_batch(client, request_id="one")
    duplicate = make_batch(client, request_id="two", title="改名不重复入库")
    assert first == retry == duplicate
    different = make_batch(client, space_id="kb-live")
    assert first["id"] != different["id"]
    conflict = client.post("/api/demand/batches", json=batch_payload(request_id="one", title="修改相同幂等键"))
    assert conflict.status_code == 409
    assert make_batch(client, title="unused")["id"] == first["id"]


@pytest.mark.parametrize("change", [
    {"columns": [{"column": 0}, {"column": 0}]}, {"time_column": 0},
    {"columns": [{"column": 19}]}, {"rows": [{"row": 2, "values": ["x"]}, {"row": 1, "values": ["y"]}]},
    {"rows": [{"row": 1, "values": ["x" * 6001]}]}, {"rows": [{"row": 1, "values": [12]}]},
    {"columns": [{"column": 0, "document_id": "forged"}]},
])
def test_batch_mapping_rejects_invalid_cells(client, change):
    assert client.post("/api/demand/batches", json=batch_payload(**change)).status_code == 422


def test_multiple_columns_keep_each_nonempty_cell_and_header_option(client):
    batch = make_batch(client, columns=[{"column": 0, "label": "主题"}, {"column": 1, "label": "意向"}], time_column=None,
                       has_header=False, rows=[{"row": 3, "values": ["超声炮", "预约"]}, {"row": 4, "values": ["热玛吉", ""]}])
    assert [r["original"] for r in batch["rows"]] == ["超声炮", "预约", "热玛吉"]
    assert [r["source"]["column"] for r in batch["rows"]] == [0, 1, 0]


def test_samples_deterministic_fictional_and_no_knowledge_mutation(client):
    with client.app.state.store.transaction() as db:
        before = db.execute("SELECT count(*) FROM records WHERE collection='kb_documents'").fetchone()[0]
    a = client.post("/api/demand/batches/samples", json={"space_id": "kb-medical"}).json()
    b = client.post("/api/demand/batches/samples", json={"space_id": "kb-medical"}).json()
    assert a == b and a["is_demo"] and a["source_kind"] == "demo" and a["duplicate_count"] == 1
    assert any("暂时不" in r["original"] for r in a["rows"])
    with client.app.state.store.transaction() as db:
        assert db.execute("SELECT count(*) FROM records WHERE collection='kb_documents'").fetchone()[0] == before


def test_knowledge_copy_scoped_immutable_and_does_not_reclassify(client):
    store = client.app.state.store
    with store.transaction() as db:
        document = save_document(db, DocumentInput(space_id="kb-medical", title="旧词库", pages=[{"text": "超声炮多少钱？"}]))
    body = {"space_id": "kb-medical", "document_id": document["id"]}
    first = client.post("/api/demand/batches/from-knowledge", json=body).json()
    assert first["rows"][0]["source"]["version"] == 1
    assert first["rows"][0]["source"]["chunk_id"] == document["chunks"][0]["id"]
    with store.transaction() as db:
        assert get(db, "kb_documents", document["id"]) == document
        save_document(db, DocumentInput(space_id="kb-medical", title="旧词库", pages=[{"text": "超声炮怎么预约？"}], expected_version=1), old=document)
    second = client.post("/api/demand/batches/from-knowledge", json=body).json()
    assert first["id"] != second["id"] and second["document_version"] == 2
    assert client.get("/api/demand/batches/" + first["id"]).json()["rows"][0]["original"] == "超声炮多少钱？"
    assert client.post("/api/demand/batches/from-knowledge", json={**body, "space_id": "kb-live"}).status_code == 404


def test_pack_normalization_conflicts_and_immutable_history(client):
    body = {"space_id": "kb-medical", "name": "医美词包", "theme_terms": [" ＡＢＣ ", "abc", "超声炮", "超生炮"],
            "intent_terms": ["预约"], "exclude_terms": ["abc"]}
    response = client.post("/api/demand/packs", json=body)
    assert response.status_code == 200, response.text
    first = response.json()
    assert first["theme_terms"] == ["abc", "超声炮", "超生炮"]
    assert "排除优先" in first["warnings"][1]
    update = {**body, "theme_terms": ["热玛吉"], "expected_version": 1}
    second = client.put("/api/demand/packs/" + first["id"], json=update).json()
    assert second["version"] == 2 and second["history"][0] == {k: v for k, v in first.items() if k != "history"}
    assert client.put("/api/demand/packs/" + first["id"], json=update).status_code == 409
    assert client.put("/api/demand/packs/" + first["id"], json={**update, "space_id": "kb-live", "expected_version": 2}).status_code == 404


def test_pack_source_scope_and_empty_validation(client):
    batch = make_batch(client)
    body = {"space_id": "kb-live", "name": "词包", "theme_terms": ["咨询"], "source_batch_id": batch["id"]}
    assert client.post("/api/demand/packs", json=body).status_code == 404
    assert client.post("/api/demand/packs", json={"space_id": "kb-medical", "name": "空词包"}).status_code == 422
    assert client.post("/api/demand/packs", json={**body, "space_id": "kb-medical"}).status_code == 200


def test_templates_four_builtins_custom_history_no_source_data(client):
    builtins = client.get("/api/demand/templates?space_id=kb-medical").json()
    assert {t["task_type"] for t in builtins} == {"organize", "analyze", "topics", "faq"}
    body = {"space_id": "kb-medical", "name": "预约分析", "task_type": "analyze", "filters": {"theme_terms": ["预约"]}}
    first = client.post("/api/demand/templates", json=body).json()
    second = client.put("/api/demand/templates/" + first["id"], json={**body, "expected_version": 1, "filters": {"theme_terms": ["咨询"]}}).json()
    assert second["version"] == 2 and second["history"][0]["filters"]["theme_terms"] == ["预约"]
    assert len(client.get("/api/demand/templates?space_id=kb-live").json()) == 4
    assert client.put("/api/demand/templates/" + first["id"], json={**body, "expected_version": 1}).status_code == 409
    assert client.put("/api/demand/templates/builtin-analyze", json={**body, "expected_version": 1}).status_code == 422
    assert client.post("/api/demand/templates", json={**body, "batch_id": "customer-data"}).status_code == 422
    assert client.post("/api/demand/templates", json={**body, "filters": {"date_from": "2026-11-02", "date_to": "2026-11-01"}}).status_code == 422


def test_assets_missing_space_is_not_implicitly_created(client):
    assert client.get("/api/demand/batches?space_id=missing").status_code == 404
    assert client.get("/api/demand/templates?space_id=missing").status_code == 404
    assert client.get("/api/demand/packs?space_id=missing").status_code == 404
    assert client.post("/api/demand/batches", json=batch_payload(space_id="missing")).status_code == 404


def test_numbered_knowledge_preview_retains_full_entries_and_explicit_headings(client):
    # This entry crosses multiple retrieval chunks but must remain one source
    # record. Numbering must not prevent exact duplicate detection.
    original = '一、项目主题词\n1. 超声炮\n2、' + '完整长词条' * 150 + '\n继续说明\n二、问题词\n3）超声炮\n4. 热玛吉'
    with client.app.state.store.transaction() as db:
        doc = save_document(db, DocumentInput(space_id='kb-medical', title='原始词库',
            filename='原始词库.txt', pages=[{'page': 7, 'text': original}]))
    body = {'space_id': 'kb-medical', 'document_id': doc['id']}
    response = client.post('/api/demand/batches/from-knowledge/preview', json=body)
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview['counts'] == {'records': 4, 'skipped': 2, 'duplicates': 1}
    first, long, duplicate, final = preview['rows']
    assert first['original'] == '1. 超声炮' and first['text'] == '超声炮'
    assert first['source']['ordinal'] == '1' and first['source']['category'] == '一、项目主题词'
    assert long['raw_original'] == '2、' + '完整长词条' * 150 + '\n继续说明'
    assert long['source']['line'] == 3 and long['source']['end_line'] == 4 and long['source']['page'] == 7
    assert len(long['text']) > 600 and duplicate['duplicate_of'] == first['id']
    assert final['source']['category'] == '二、问题词'
    assert preview['skipped'][1]['original'] == '二、问题词' and preview['skipped'][1]['source']['line'] == 5
    copied = client.post('/api/demand/batches/from-knowledge', json=body).json()
    assert copied['row_count'] == 4 and copied['duplicate_count'] == 1
    assert copied['rows'][1]['original'] == long['original']
    with client.app.state.store.read() as db:
        assert get(db, 'kb_documents', doc['id'])['kind'] == 'facts'


def test_reclassification_requires_exact_preview_and_keeps_version_and_draft_warning(client):
    from backend.knowledge import put, source_warnings
    with client.app.state.store.transaction() as db:
        doc = save_document(db, DocumentInput(space_id='kb-medical', title='需求清单',
            pages=[{'text': '1. 超声炮咨询\n2. 热玛吉问题'}]))
        doc.update(status='approved', reviewed_by='隔离测试审核员', reviewed_at='2026-11-17T12:00:00Z')
        put(db, 'kb_documents', doc)
    body = {'space_id': 'kb-medical', 'document_id': doc['id']}
    preview = client.post('/api/demand/batches/from-knowledge/preview', json=body).json()
    assert client.post('/api/demand/batches/from-knowledge', json={**body, 'reclassify': True}).status_code == 422
    exact = {**body, 'reclassify': True, 'expected_version': 1, 'preview_signature': preview['signature'], 'request_id': 'migrate'}
    assert client.post('/api/demand/batches/from-knowledge', json={**exact, 'preview_signature': '0' * 64}).status_code == 409
    result = client.post('/api/demand/batches/from-knowledge', json=exact)
    assert result.status_code == 200, result.text
    assert result.json()['reclassified'] and result.json()['document_version'] == 2
    assert client.post('/api/demand/batches/from-knowledge', json=exact).json() == result.json()
    with client.app.state.store.read() as db:
        current = get(db, 'kb_documents', doc['id'])
        old = get(db, 'kb_versions', doc['id'] + ':v1')
        assert current['pages'] == old['pages'] == doc['pages']
        assert current['kind'] == 'demand' and current['status'] == 'draft' and old['kind'] == 'facts'
        assert old['status'] == 'approved' and old['reviewed_by'] == '隔离测试审核员'
        assert source_warnings(db, {'sources': [{'document_id': doc['id'], 'version': 1, 'title': doc['title']}]})
    assert client.post('/api/demand/batches/from-knowledge', json={**exact, 'request_id': 'stale'}).status_code == 409


def test_pack_word_metadata_stays_with_normalized_word_and_history(client):
    body = {'space_id': 'kb-medical', 'name': '主题词包', 'theme_terms': ['ＡＢＣ', '超声炮'],
            'entries': [{'text': 'abc', 'role': 'theme', 'status': 'confirmed', 'tags': ['项目'], 'aliases': ['ＡＢＣ项目']}]}
    one = client.post('/api/demand/packs', json=body).json()
    assert one['entries'][0]['status'] == 'confirmed' and one['entries'][1]['status'] == 'pending'
    changed = {**body, 'theme_terms': [' abc ', '热玛吉'], 'expected_version': 1}
    changed.pop('entries')
    two = client.put('/api/demand/packs/' + one['id'], json=changed).json()
    assert two['entries'][0] == one['entries'][0]
    assert two['history'][0]['entries'] == one['entries']
    assert two['entries'][1]['text'] == '热玛吉' and two['entries'][1]['status'] == 'pending'
    assert client.put('/api/demand/packs/' + one['id'], json={**changed, 'expected_version': 2,
        'entries': [{'text': '不存在', 'role': 'theme'}]}).status_code == 422
