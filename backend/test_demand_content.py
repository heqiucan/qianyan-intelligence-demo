"""Real API integration: demand never becomes a fact, references remain versioned."""
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.knowledge import get, put
from backend.model_adapter import ModelFailure
from backend.demand_content import evidence_units, missing_evidence, compose_content, questions_for


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MODEL_PROVIDER', 'replay')
    monkeypatch.delenv('DEMO_ACCESS_TOKEN', raising=False)
    with TestClient(create_app(tmp_path)) as c:
        yield c


def post(client, path, body, status=200):
    r = client.post('/api' + path, json=body)
    assert r.status_code == status, r.text
    return r.json()


def batch(client, text='超声炮怎么预约？'):
    return post(client, '/demand/batches', {'space_id': 'kb-medical', 'title': '原始需求', 'filename': '问题.csv',
        'sheet': 'Sheet1', 'columns': [{'column': 0, 'label': '问题'}], 'rows': [{'row': 1, 'values': [text]}],
        'time_column': None, 'has_header': False})


def wait(client, task_id):
    for _ in range(150):
        task = client.get('/api/demand/tasks/' + task_id).json()
        if task['status'] not in {'queued', 'running'}:
            return task
        time.sleep(.02)
    pytest.fail('worker timeout')


def task(client, text='超声炮怎么预约？'):
    source = batch(client, text)
    config = {'space_id': source['space_id'], 'name': '确认需求', 'goal': '整理已导入问题', 'batch_id': source['id']}
    preview = post(client, '/demand/preview', {'config': config})
    run = post(client, '/demand/tasks', {'config': config, 'preview_signature': preview['signature']}, 202)
    run = confirm(client, wait(client, run['id']))
    child = post(client, '/demand/tasks/' + run['id'] + '/handoff', {'task_type': 'faq',
        'selected': [{'id': r['id'], 'revision': r['revision']} for r in run['results']]}, 202)
    return run, confirm(client, wait(client, child['id']))


def confirm(client, run):
    return post(client, '/demand/tasks/' + run['id'] + '/review', {'action': 'confirm',
        'selected': [{'id': r['id'], 'revision': r['revision']} for r in run['results']]})['task']


def document(client, text='超声炮预约需先与客服确认到店时间。预约时记录咨询项目。', kind='facts', **extra):
    doc = post(client, '/knowledge/documents', {'space_id': 'kb-medical', 'title': '超声炮预约流程',
        'kind': kind, 'pages': [{'text': text}], **extra})
    return post(client, '/knowledge/documents/' + doc['id'] + '/review', {'status': 'approved', 'expected_version': doc['version']})


def generate(client, run, **extra):
    return client.post('/api/demand/tasks/' + run['id'] + '/generate', json={'expected_revision': run['revision'],
        'result_id': run['results'][0]['id'], **extra})


def test_plan_never_runs_and_preserves_scope_template_and_missing_input(client):
    result = post(client, '/demand/plan', {'space_id': 'kb-medical', 'goal': '整理超声炮预约问题'})
    assert result['config'] is None and result['missing']
    source = batch(client)
    result = post(client, '/demand/plan', {'space_id': 'kb-medical', 'goal': '整理超声炮预约问题',
        'batch_id': source['id'], 'template_id': 'builtin-faq'})
    assert result['config']['task_type'] == 'faq' and result['config']['template_version'] == 1
    assert result['source'] == 'replay' and not client.get('/api/demand/tasks?space_id=kb-medical').json()
    assert client.post('/api/demand/plan', json={'space_id': 'kb-live', 'goal': '整理预约问题', 'batch_id': source['id']}).status_code == 422


def test_approved_demand_never_enters_factual_keyword_or_semantic_search(client, monkeypatch):
    document(client, '超声炮价格 3000 元，一次见效。', kind='demand')
    seen = []
    def semantic(query, candidates):
        seen.extend(candidates)
        return {'scores': {}, 'status': 'ready', 'model': 'test', 'message': 'test'}
    monkeypatch.setattr('backend.knowledge.rank_semantic', semantic)
    result = post(client, '/knowledge/search', {'space_id': 'kb-medical', 'query': '超声炮价格'})
    assert result['hits'] == [] and not result['can_generate'] and seen == []


@pytest.mark.parametrize('kind', ['demand', 'script', 'rules'])
def test_no_facts_means_no_model_call_or_draft(client, monkeypatch, kind):
    document(client, kind=kind)
    _, child = task(client)
    monkeypatch.setattr(client.app.state.model_adapter, '_complete', lambda *a, **kw: pytest.fail('must not call model'))
    result = generate(client, child)
    assert result.status_code == 200, result.text
    assert result.json()['draft_id'] is None and result.json()['missing']
    assert not client.get('/api/knowledge/drafts?space_id=kb-medical').json()


def test_budget_in_demand_is_not_price_evidence(client):
    document(client)
    _, child = task(client, '超声炮价格多少钱？预算 3000 元。')
    result = generate(client, child).json()
    assert result['draft_id'] is None and any('预算不是机构报价' in x for x in result['missing'])


def test_real_pipeline_citations_idempotency_and_upstream_change(client):
    fact = document(client)
    parent, child = task(client)
    key = uuid4().hex
    response = generate(client, child, request_id=key)
    assert response.status_code == 200, response.text
    result = response.json()
    draft = result['draft']
    assert draft['source'] == 'replay' and draft['writing_mode'] == 'evidence_composed'
    assert draft['sources'][0]['document_id'] == fact['id'] and draft['sources'][0]['version'] == 1
    assert draft['demand_origin']['upstream'][0]['id'] == parent['results'][0]['id']
    assert draft['can_confirm'] and not draft['can_transfer']
    assert generate(client, child, request_id=key).json()['draft_id'] == draft['id']
    current = client.get('/api/demand/tasks/' + child['id']).json()
    assert generate(client, current).json()['draft_id'] == draft['id']
    post(client, '/demand/tasks/' + parent['id'] + '/review', {'action': 'exclude', 'selected': [
        {'id': parent['results'][0]['id'], 'revision': parent['results'][0]['revision']}]})
    saved = client.get('/api/knowledge/drafts?space_id=kb-medical').json()[0]
    assert saved['source_warnings'] and not saved['can_confirm']
    assert client.post('/api/knowledge/drafts/' + draft['id'] + '/confirm', json={
        'expected_revision': 1, 'acknowledged': True}).status_code == 409


def test_reclassifying_old_fact_preserves_snapshot_and_warns_draft(client):
    doc = document(client)
    _, child = task(client)
    draft = generate(client, child).json()['draft']
    response = client.put('/api/knowledge/documents/' + doc['id'], json={'space_id': 'kb-medical',
        'title': doc['title'], 'kind': 'demand', 'pages': doc['pages'], 'expected_version': 1})
    assert response.status_code == 200 and response.json()['version'] == 2
    current = client.get('/api/knowledge/drafts?space_id=kb-medical').json()[0]
    assert current['sources'] == draft['sources'] and current['source_warnings']


def test_regenerating_after_fact_revision_saves_new_draft(client):
    doc = document(client)
    _, child = task(client)
    first = generate(client, child).json()['draft']
    revised = client.put('/api/knowledge/documents/' + doc['id'], json={'space_id': 'kb-medical',
        'title': doc['title'], 'pages': [{'text': '超声炮预约需先联系接待人员，核对预约时间。'}], 'expected_version': 1}).json()
    post(client, '/knowledge/documents/' + doc['id'] + '/review', {'status': 'approved', 'expected_version': revised['version']})
    current = client.get('/api/demand/tasks/' + child['id']).json()
    second = generate(client, current).json()['draft']
    assert second['id'] != first['id'] and second['sources'][0]['version'] == 2
    assert second['can_confirm']
    saved = client.get('/api/knowledge/drafts?space_id=kb-medical').json()
    assert len(saved) == 2 and next(d for d in saved if d['id'] == first['id'])['source_warnings']


def test_model_selects_only_real_sentences_and_revalidates_after_io(client, monkeypatch):
    doc = document(client)
    _, child = task(client)
    adapter = client.app.state.model_adapter
    adapter.mode = 'zhipu-free'
    monkeypatch.setattr(adapter, '_complete', lambda *a, **kw: {'sentence_ids': ['invented'], 'missing': []})
    assert generate(client, child).status_code == 502
    def completion(*args, **kwargs):
        with client.app.state.store.transaction() as db:
            current = get(db, 'kb_documents', doc['id'])
            current['status'] = 'archived'
            put(db, 'kb_documents', current)
        return {'sentence_ids': ['f1'], 'missing': []}
    monkeypatch.setattr(adapter, '_complete', completion)
    assert generate(client, child).status_code == 409
    assert not client.get('/api/knowledge/drafts?space_id=kb-medical').json()


def test_model_plan_cannot_override_scope_or_execute(client, monkeypatch):
    source = batch(client)
    adapter = client.app.state.model_adapter
    adapter.mode = 'zhipu-free'
    monkeypatch.setattr(adapter, '_complete', lambda *a, **kw: {
        'name': 'Injected', 'task_type': 'analyze', 'space_id': 'kb-live', 'filters': {}})
    response = client.post('/api/demand/plan', json={'space_id': 'kb-medical', 'goal': '整理并调用外部平台', 'batch_id': source['id']})
    assert response.status_code == 502
    assert not client.get('/api/demand/tasks?space_id=kb-medical').json()


def test_model_no_relevant_sentence_persists_gap_and_can_retry(client, monkeypatch):
    document(client)
    _, child = task(client)
    adapter = client.app.state.model_adapter
    adapter.mode = 'zhipu-free'
    monkeypatch.setattr(adapter, '_complete', lambda *a, **kw: {'sentence_ids': [], 'missing': ['还缺少预约联系方式']})
    response = generate(client, child)
    assert response.status_code == 200 and response.json()['draft_id'] is None
    current = client.get('/api/demand/tasks/' + child['id']).json()
    assert current['status'] == 'waiting_input' and current['results'][0]['evidence_missing']
    assert any('预约联系方式' in s for s in current['results'][0]['topic']['missing'])
    assert client.post('/api/demand/tasks/' + current['id'] + '/control', json={
        'expected_revision': current['revision'], 'action': 'complete'}).status_code == 409
    monkeypatch.setattr(adapter, '_complete', lambda *a, **kw: {'sentence_ids': ['f1'], 'missing': []})
    assert generate(client, current).json()['draft_id']
    current = client.get('/api/demand/tasks/' + child['id']).json()
    assert current['status'] == 'waiting_review' and not current['results'][0]['evidence_missing']


def test_negative_service_policy_and_free_price_are_preserved():
    units = evidence_units([{'id': 'doc1', 'kind': 'facts', 'text': '本机构不提供上门服务。到店预约咨询免费。超声炮价格未核实。'}])
    assert len(units) == 2 and '不提供上门服务' in units[0]['text']
    assert not missing_evidence('到店预约咨询费用是多少？', units, 'medical')
    assert missing_evidence('项目价格多少钱？', [{'text': '预约咨询需登记。'}], 'medical')


def test_grouped_faq_has_per_question_evidence_and_preserves_gaps(client, monkeypatch):
    adapter = client.app.state.model_adapter
    adapter.mode = 'zhipu-free'
    context = {'run': {'task_type': 'faq'}, 'row': {'original': '预约与地址', 'members': [
        {'original': '怎样预约？'}, {'original': '地址在哪里？'}]},
        'units': [{'id': 'f1', 'source_id': 'c1', 'text': '预约需联系接待人员。'}, {'id': 'f2', 'source_id': 'c2', 'text': '地址位于示例路。'}],
        'question_units': {'q1': ['f1'], 'q2': ['f2']}}
    monkeypatch.setattr(adapter, '_complete', lambda *a, **k: {'answers': [
        {'question_id': 'q1', 'sentence_ids': ['f1']}, {'question_id': 'q2', 'sentence_ids': ['f2']}]})
    content = compose_content(adapter, context)
    assert len(content['blocks']) == 2 and not content['evidence_missing']
    assert '怎样预约？' in content['blocks'][0]['text'] and content['blocks'][0]['citation_ids'] == ['c1']
    assert '地址在哪里？' in content['blocks'][1]['text'] and content['blocks'][1]['citation_ids'] == ['c2']
    monkeypatch.setattr(adapter, '_complete', lambda *a, **k: {'answers': [
        {'question_id': 'q1', 'sentence_ids': ['f1']}, {'question_id': 'q2', 'sentence_ids': [], 'missing': ['缺少完整地址']}]})
    content = compose_content(adapter, context)
    assert content['evidence_missing'] and len(content['blocks']) == 1
    assert any('地址在哪里' in gap for gap in content['missing'])
    monkeypatch.setattr(adapter, '_complete', lambda *a, **k: {'answers': [
        {'question_id': 'q1', 'sentence_ids': ['f2']}, {'question_id': 'q2', 'sentence_ids': ['f2']}]})
    with pytest.raises(ModelFailure):
        compose_content(adapter, context)


def test_group_does_not_silently_drop_extra_questions():
    from fastapi import HTTPException
    with pytest.raises(HTTPException, match='12'):
        questions_for({'original': '大组', 'members': [{'original': f'问题{i}'} for i in range(13)]})


def test_nested_group_uses_original_questions():
    assert questions_for({'original':'FAQ组','members':[{'original':'预约组','members':[
        {'original':'怎样预约？'}, {'original':'地址在哪？'}]}]}) == [
            {'id':'q1','text':'怎样预约？'}, {'id':'q2','text':'地址在哪？'}]


def test_consultation_free_is_not_procedure_quote():
    units = [{'text': '超声炮预约咨询免费。'}]
    assert missing_evidence('超声炮项目价格多少钱？', units, 'medical')
    assert not missing_evidence('超声炮预约咨询费用多少？', units, 'medical')
    assert missing_evidence('超声炮咨询费用多少？', [{'text':'超声炮项目价格 3000 元。'}], 'medical')


def test_selected_price_sentence_is_checked_again(client, monkeypatch):
    adapter = client.app.state.model_adapter
    context = {'run': {'task_type': 'faq'}, 'row': {'original':'项目价格多少钱？'},
        'units':[{'id':'f1','source_id':'c1','text':'到店需登记。'},
                 {'id':'f2','source_id':'c1','text':'项目价格 3000 元。'}]}
    replay = compose_content(adapter, context)
    assert '3000 元' in replay['blocks'][0]['text'] and not replay['evidence_missing']
    adapter.mode = 'zhipu-free'
    monkeypatch.setattr(adapter, '_complete', lambda *a, **k: {'sentence_ids':['f1']})
    assert compose_content(adapter, context)['evidence_missing']
