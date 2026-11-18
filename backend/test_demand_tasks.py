"""Isolated acceptance tests for demand filtering and durable human decisions."""
import time
from threading import Event
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.main import Store
from backend.knowledge import get, put, records
from backend.demand_assets import register_demand_assets
from backend.demand_schemas import TaskConfig
from backend import demand_tasks as worker


@pytest.fixture
def system(tmp_path):
    store = Store(tmp_path)
    store.initialize()
    runner = worker.DemandRunner(store)
    runner.start()
    app = FastAPI()
    register_demand_assets(app, store)
    worker.register_demand_tasks(app, store, runner)
    with TestClient(app) as client:
        yield client, store, runner
    runner.stop()


def config(client, **extra):
    response = client.post('/api/demand/batches/samples', json={'space_id': 'kb-medical'})
    assert response.status_code == 200, response.text
    return {'space_id': 'kb-medical', 'name': '需求整理', 'goal': '整理医美咨询问题',
            'batch_id': response.json()['id'], 'filters': {}, **extra}


def create(client, values):
    preview = client.post('/api/demand/preview', json={'config': values})
    assert preview.status_code == 200, preview.text
    response = client.post('/api/demand/tasks', json={'config': values,
        'preview_signature': preview.json()['signature'], 'request_id': uuid4().hex})
    assert response.status_code == 202, response.text
    return response.json()


def wait(client, task_id):
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        run = client.get('/api/demand/tasks/' + task_id).json()
        if run['status'] not in {'queued', 'running'}:
            return run
        time.sleep(.02)
    pytest.fail('Demand worker did not reach checkpoint: ' + str(run))


def review(client, run, action='confirm', rows=None, **extra):
    rows = rows if rows is not None else run['results']
    return client.post(f"/api/demand/tasks/{run['id']}/review", json={'selected': [
        {'id': r['id'], 'revision': r['revision']} for r in rows], 'action': action, **extra})


def ctl(client, run, action):
    return client.post(f"/api/demand/tasks/{run['id']}/control", json={
        'expected_revision': run['revision'], 'action': action})


def test_full_processing_has_real_counts_provenance_and_rule_flags(system):
    client, store, _ = system
    run = wait(client, create(client, config(client))['id'])
    assert run['status'] == 'waiting_review'
    assert run['counts'] == {'input': 8, 'matched': 7, 'excluded': 0, 'duplicates': 1, 'limited': 0,
                             'processed': 7, 'pending': 7, 'confirmed': 0, 'excluded_manual': 0, 'transferred': 0}
    assert all(r['status'] == 'pending' and r['source']['row'] for r in run['results'])
    assert any('否定' in flag for r in run['results'] for flag in r['flags'])
    assert any('同行' in flag for r in run['results'] for flag in r['flags'])
    assert run['results'][0]['duplicate_sources'][0]['row'] == 6
    assert ctl(client, run, 'complete').status_code == 409
    confirmed = review(client, run).json()['task']
    assert confirmed['counts']['confirmed'] == 7
    assert ctl(client, confirmed, 'complete').json()['status'] == 'completed'
    with store.transaction() as db:
        assert not records(db, 'kb_documents')
        assert not records(db, 'kb_drafts')


def test_filters_exclusion_override_intent_dates_sort_limit():
    originals = ['超声炮预约价格？', '超声炮预约同行', '超声炮分享', '热玛吉预约', '超声炮预约价格？', '超声炮预约下周']
    dates = ['2026-11-02', '2026-11-03', None, '2026-11-04', '2026-11-05', None]
    snapshot = {'batch': {'rows': [{'id': str(i), 'original': text, 'occurred_at': dates[i], 'source': {'row': i + 1}}
                                   for i, text in enumerate(originals)]}}
    values = {'space_id': 'kb-medical', 'batch_id': 'b', 'name': 'test', 'goal': 'filter test', 'filters': {
        'theme_terms': ['超声炮'], 'intent_terms': ['预约'], 'exclude_terms': ['同行'], 'date_from': '2026-11-01',
        'date_to': '2026-11-04', 'missing_time': 'review', 'sort': 'newest', 'limit': 1}}
    result = worker.collect_candidates(snapshot, TaskConfig.model_validate(values))
    assert [r['id'] for r in result['candidates']] == ['0']
    assert result['counts'] == {'input': 6, 'matched': 2, 'excluded': 4, 'duplicates': 0, 'limited': 1}
    values['filters']['missing_time'] = 'exclude'
    assert worker.collect_candidates(snapshot, TaskConfig.model_validate(values))['counts']['matched'] == 1
    values['filters'].update(theme_terms=['超声炮', '价格'], match_mode='all', limit=200)
    assert [r['id'] for r in worker.collect_candidates(snapshot, TaskConfig.model_validate(values))['candidates']] == ['0']


def test_semantic_receives_only_hard_eligible_and_cannot_bypass_exclusions(monkeypatch):
    seen = []
    def rank(query, rows):
        seen.extend(r['id'] for r in rows)
        return {'status': 'ready', 'message': 'test local', 'scores': {r['id']: .8 for r in rows}}
    monkeypatch.setattr(worker, 'rank_semantic', rank)
    values = TaskConfig(space_id='kb-medical', batch_id='b', name='test', goal='semantic test',
                        filters={'theme_terms': ['超声炮'], 'exclude_terms': ['同行'], 'semantic': True})
    snapshot = {'batch': {'rows': [{'id': 'a', 'original': '面部紧致咨询', 'source': {}},
                                  {'id': 'b', 'original': '同行面部紧致咨询', 'source': {}}]}}
    result = worker.collect_candidates(snapshot, values)
    assert seen == ['a']
    assert [r['id'] for r in result['candidates']] == ['a']
    assert '向量语义' in result['candidates'][0]['reasons'][1]
    seen.clear()
    values.filters.match_mode = 'all'
    assert not worker.collect_candidates(snapshot, values)['candidates']
    assert seen == []


def test_unavailable_semantic_truthfully_falls_back(system):
    client, _, _ = system
    values = config(client, filters={'theme_terms': ['面部紧致'], 'semantic': True})
    response = client.post('/api/demand/preview', json={'config': values}).json()
    assert response['retrieval']['status'] == 'disabled'
    assert response['warnings']
    assert response['sample'] == []


def test_stale_preview_wrong_space_and_medical_channel_are_rejected(system):
    client, store, _ = system
    values = config(client)
    signature = client.post('/api/demand/preview', json={'config': values}).json()['signature']
    changed = {**values, 'filters': {'theme_terms': ['热玛吉']}}
    assert client.post('/api/demand/tasks', json={'config': changed, 'preview_signature': signature}).status_code == 409
    assert client.post('/api/demand/preview', json={'config': {**values, 'space_id': 'kb-live'}}).status_code == 422
    assert client.post('/api/demand/preview', json={'config': {**values, 'channel': 'douyin'}}).status_code == 422
    with store.transaction() as db:
        assert not records(db, 'demand_runs')


def test_template_and_pack_version_changes_invalidate_preview(system):
    client, _, _ = system
    pack = client.post('/api/demand/packs', json={'space_id': 'kb-medical', 'name': '词包', 'theme_terms': ['超声炮']}).json()
    values = config(client, pack_id=pack['id'], pack_version=1, template_id='builtin-analyze', template_version=1)
    signature = client.post('/api/demand/preview', json={'config': values}).json()['signature']
    updated = client.put('/api/demand/packs/' + pack['id'], json={'space_id': 'kb-medical', 'name': '词包',
                    'theme_terms': ['热玛吉'], 'expected_version': 1})
    assert updated.status_code == 200, updated.text
    assert client.post('/api/demand/tasks', json={'config': values, 'preview_signature': signature}).status_code == 409


def test_creation_retry_is_idempotent_and_changed_payload_conflicts(system):
    client, store, _ = system
    values = config(client)
    signature = client.post('/api/demand/preview', json={'config': values}).json()['signature']
    body = {'config': values, 'preview_signature': signature, 'request_id': 'same-create'}
    first = client.post('/api/demand/tasks', json=body)
    second = client.post('/api/demand/tasks', json=body)
    assert first.status_code == second.status_code == 202
    assert first.json()['id'] == second.json()['id']
    body['config'] = {**values, 'name': '不同任务'}
    assert client.post('/api/demand/tasks', json=body).status_code == 409
    with store.transaction() as db:
        assert len(records(db, 'demand_runs')) == 1


def test_pause_resume_retains_exact_progress_and_fences_late_writes(system, monkeypatch):
    client, store, runner = system
    started, release = Event(), Event()
    original = runner.process_candidate
    calls = []
    def blocked(run, row):
        calls.append(row['id'])
        if len(calls) == 2:
            started.set()
            assert release.wait(5)
        return original(run, row)
    monkeypatch.setattr(runner, 'process_candidate', blocked)
    created = create(client, config(client))
    assert started.wait(5)
    current = client.get('/api/demand/tasks/' + created['id']).json()
    assert current['counts']['processed'] == 1
    paused = ctl(client, current, 'pause').json()
    release.set()
    assert paused['status'] == 'paused'
    assert paused['counts']['processed'] == 1
    assert ctl(client, paused, 'resume').status_code == 200
    complete = wait(client, created['id'])
    assert complete['status'] == 'waiting_review'
    assert complete['counts']['processed'] == 7
    assert len({r['source_row_id'] for r in complete['results']}) == 7
    assert calls.count(calls[0]) == 1  # First persisted row was not recomputed.


def test_failure_keeps_checkpoint_and_retry_processes_only_remaining(system, monkeypatch):
    client, _, runner = system
    original = runner.process_candidate
    calls = []
    def fail(run, row):
        calls.append(row['id'])
        if len(calls) == 2:
            raise ValueError('test failure')
        return original(run, row)
    monkeypatch.setattr(runner, 'process_candidate', fail)
    failed = wait(client, create(client, config(client))['id'])
    assert failed['status'] == 'failed' and failed['counts']['processed'] == 1
    assert ctl(client, failed, 'resume').status_code == 200
    completed = wait(client, failed['id'])
    assert completed['counts']['processed'] == 7
    assert calls.count(calls[0]) == 1


def test_restart_marks_interrupted_and_manual_resume_does_not_duplicate(system):
    client, store, runner = system
    runner.stop()
    created = create(client, config(client))
    restarted = worker.DemandRunner(store)
    restarted.start()
    try:
        current = client.get('/api/demand/tasks/' + created['id']).json()
        assert current['status'] == 'interrupted'
        assert current['counts']['processed'] == 0
        assert ctl(client, current, 'resume').status_code == 200
        restarted.notify()
        completed = wait(client, current['id'])
        assert completed['counts']['processed'] == 7
    finally:
        restarted.stop()


def test_cancel_fences_inflight_row_and_does_not_resume(system, monkeypatch):
    client, _, runner = system
    started, release = Event(), Event()
    original = runner.process_candidate
    def blocked(run, row):
        started.set()
        assert release.wait(5)
        return original(run, row)
    monkeypatch.setattr(runner, 'process_candidate', blocked)
    created = create(client, config(client))
    assert started.wait(5)
    current = client.get('/api/demand/tasks/' + created['id']).json()
    cancelled = ctl(client, current, 'cancel').json()
    release.set()
    assert cancelled['status'] == 'cancelled' and cancelled['counts']['processed'] == 0
    assert ctl(client, cancelled, 'resume').status_code == 409


def test_bulk_conflicts_undo_preserves_later_decisions_and_audit(system):
    client, store, _ = system
    run = wait(client, create(client, config(client))['id'])
    first = review(client, run, rows=run['results'][:2]).json()
    stale = review(client, run, rows=run['results'][:3]).json()
    assert len(stale['conflicts']) == 2 and len(stale['applied']) == 1
    changed = review(client, stale['task'], 'classify', rows=stale['task']['results'][:1], category='人工分类').json()
    undone = client.post(f"/api/demand/tasks/{run['id']}/undo", json={'operation_id': first['operation_id']}).json()
    assert len(undone['applied']) == 1 and len(undone['conflicts']) == 1
    assert undone['task']['results'][0]['category'] == '人工分类'
    assert undone['task']['results'][0]['status'] == 'confirmed'
    assert undone['task']['results'][1]['status'] == 'pending'
    assert undone['task']['results'][1]['revision'] == 3
    with store.transaction() as db:
        assert len(records(db, 'demand_reviews')) == 4


def test_handoff_requires_all_current_confirmations_idempotent_and_tracks_stale(system):
    client, store, _ = system
    run = wait(client, create(client, config(client))['id'])
    body = {'selected': [{'id': r['id'], 'revision': r['revision']} for r in run['results'][:2]], 'task_type': 'faq'}
    url = f"/api/demand/tasks/{run['id']}/handoff"
    assert client.post(url, json=body).status_code == 409
    confirmed = review(client, run, rows=run['results'][:2]).json()['task']
    body['selected'] = [{'id': r['id'], 'revision': r['revision']} for r in confirmed['results'][:2]]
    one, two = client.post(url, json=body), client.post(url, json=body)
    assert one.status_code == two.status_code == 202
    assert one.json()['id'] == two.json()['id']
    child = wait(client, one.json()['id'])
    assert child['channel'] == 'internal' and child['space_id'] == 'kb-medical'
    assert child['counts']['processed'] == 2 and child['counts']['pending'] == 2
    assert len(child['upstream']) == 2 and not child['upstream_warnings']
    assert all(r['topic']['missing'] and r['status'] == 'pending' for r in child['results'])
    deliberate = client.post(url, json={**body, 'new_version': True})
    assert deliberate.json()['id'] != child['id']
    updated = review(client, confirmed, 'exclude', rows=confirmed['results'][:1])
    assert updated.status_code == 200
    stale = client.get('/api/demand/tasks/' + child['id']).json()
    assert stale['upstream_warnings']
    assert stale['upstream'][0]['revision'] == 2
    with store.transaction() as db:
        source = get(db, 'demand_results', confirmed['results'][0]['id'])
        assert len(source['downstream_task_ids']) == 2


def test_cross_task_review_and_handoff_cannot_mutate_or_copy(system):
    client, _, _ = system
    first = wait(client, create(client, config(client))['id'])
    second = wait(client, create(client, config(client))['id'])
    confirmed = review(client, first).json()['task']
    response = review(client, second, rows=confirmed['results'][:1]).json()
    assert response['applied'] == [] and len(response['conflicts']) == 1
    assert client.post(f"/api/demand/tasks/{second['id']}/handoff", json={
        'selected': [{'id': confirmed['results'][0]['id'], 'revision': 2}]}).status_code == 409


def test_semantic_ranking_never_holds_write_transaction(system, monkeypatch):
    client, store, _ = system
    def rank(query, rows):
        # This independent writer would time out if preview kept BEGIN IMMEDIATE.
        with store.transaction() as db:
            put(db, 'test_rank_lock', {'id': uuid4().hex})
        return {'status': 'ready', 'scores': {}, 'message': 'lock test'}
    monkeypatch.setattr(worker, 'rank_semantic', rank)
    values = config(client, filters={'theme_terms': ['超声炮'], 'semantic': True})
    run = wait(client, create(client, values)['id'])
    assert run['status'] == 'waiting_review'


def test_sort_preserves_same_day_hours_and_timezone():
    snapshot = {'batch': {'rows': [
        {'id': 'z', 'original': '早间预约', 'occurred_at': '2026-11-17T08:00:00+08:00', 'source': {}},
        {'id': 'a', 'original': '晚间预约', 'occurred_at': '2026-11-17T21:00:00+08:00', 'source': {}},
        {'id': 'b', 'original': 'UTC预约', 'occurred_at': '2026-11-17T14:00:00Z', 'source': {}},
        {'id': 'x', 'original': '缺日期预约', 'occurred_at': None, 'source': {}}]}}
    values = {'space_id': 'kb-medical', 'batch_id': 'b', 'name': '时间排序', 'goal': '完整时间排序测试', 'filters': {'sort': 'newest'}}
    assert [r['id'] for r in worker.collect_candidates(snapshot, TaskConfig.model_validate(values))['candidates']] == ['b', 'a', 'z', 'x']
    values['filters']['sort'] = 'oldest'
    assert [r['id'] for r in worker.collect_candidates(snapshot, TaskConfig.model_validate(values))['candidates']] == ['z', 'a', 'b', 'x']


def test_short_handoff_note_keeps_parent_goal(system):
    client, _, _ = system
    parent = review(client, wait(client, create(client, config(client))['id'])).json()['task']
    result = client.post('/api/demand/tasks/' + parent['id'] + '/handoff', json={'note': '改', 'task_type': 'faq',
        'selected': [{'id': parent['results'][0]['id'], 'revision': parent['results'][0]['revision']}]})
    assert result.status_code == 202, result.text
    assert parent['goal'] in result.json()['goal'] and '内容备注：改' in result.json()['goal']


def test_missing_input_result_can_be_excluded_and_completed(system):
    client, store, _ = system
    run = review(client, wait(client, create(client, config(client))['id'])).json()['task']
    with store.transaction() as db:
        current = get(db, 'demand_runs', run['id'])
        current['status'] = 'waiting_input'
        put(db, 'demand_runs', current)
        row = get(db, 'demand_results', run['results'][0]['id'])
        row['evidence_missing'] = True
        put(db, 'demand_results', row)
    run = client.get('/api/demand/tasks/' + run['id']).json()
    assert ctl(client, run, 'complete').status_code == 409
    result = review(client, run, 'exclude', rows=run['results'][:1])
    assert result.status_code == 200, result.text
    updated = result.json()['task']
    assert updated['status'] == 'waiting_review' and ctl(client, updated, 'complete').status_code == 200


def test_grandparent_edit_invalidates_transitive_handoff(system):
    client, _, _ = system
    parent = review(client, wait(client, create(client, config(client))['id'])).json()['task']
    def transfer(run):
        return wait(client, client.post(f"/api/demand/tasks/{run['id']}/handoff", json={
            'selected': [{'id': run['results'][0]['id'], 'revision': run['results'][0]['revision']}]}).json()['id'])
    child = review(client, transfer(parent)).json()['task']
    grandchild = transfer(child)
    assert not grandchild['upstream_warnings']
    assert review(client, parent, 'group', rows=parent['results'][:1], group='新的选题分组').status_code == 200
    assert client.get('/api/demand/tasks/' + grandchild['id']).json()['upstream_warnings']


def test_group_handoff_combines_topics_but_keeps_each_revision_and_source(system):
    client, _, _ = system
    parent = review(client, wait(client, create(client, config(client))['id'])).json()['task']
    parent = review(client, parent, 'group', rows=parent['results'][:2], group='超声炮咨询主题').json()['task']
    selected = parent['results'][:3]
    response = client.post(f"/api/demand/tasks/{parent['id']}/handoff", json={'task_type': 'topics',
        'selected': [{'id': row['id'], 'revision': row['revision']} for row in selected]})
    assert response.status_code == 202, response.text
    child = wait(client, response.json()['id'])
    assert child['counts']['input'] == 3 and child['counts']['processed'] == 2
    assert len(child['upstream']) == 3
    group, ungrouped = child['results']
    assert group['group'] == group['original'] == '超声炮咨询主题'
    assert len(group['members']) == 2 and len(ungrouped['members']) == 1
    assert [m['id'] for m in group['members']] == [row['id'] for row in selected[:2]]
    assert group['members'][0]['source'] == selected[0]['source']
    assert group['members'][0]['revision'] == selected[0]['revision']
    assert group['topic']['questions'] == [row['original'] for row in selected[:2]]
    assert group['topic']['outline'] and group['topic']['missing'] and group['status'] == 'pending'
    # Regrouping one source invalidates the child without destroying its snapshot.
    assert review(client, parent, 'group', rows=selected[:1], group='修改后的主题').status_code == 200
    stale = client.get('/api/demand/tasks/' + child['id']).json()
    assert stale['upstream_warnings'] and stale['results'][0]['members'] == group['members']


def test_confirmed_results_to_pack_retains_sources_across_edits_and_retries(system):
    client, store, _ = system
    run = wait(client, create(client, config(client))['id'])
    url = f"/api/demand/tasks/{run['id']}/to-pack"
    body = {'name': '审核后的问题词', 'role': 'theme', 'request_id': 'pack-create',
            'selected': [{'id': run['results'][0]['id'], 'revision': run['results'][0]['revision']}]}
    assert client.post(url, json=body).status_code == 409
    confirmed = review(client, run, rows=run['results'][:2]).json()['task']
    body['selected'] = [{'id': row['id'], 'revision': row['revision']} for row in confirmed['results'][:2]]
    response = client.post(url, json=body)
    assert response.status_code == 200, response.text
    pack = response.json()
    assert len(pack['entries']) == 2 and all(entry['status'] == 'confirmed' for entry in pack['entries'])
    first = pack['entries'][0]
    assert first['sources'][0]['result_revision'] == 2
    assert first['sources'][0]['original'] == run['results'][0]['original']
    assert first['sources'][0]['duplicate_sources'][0]['row'] == 6
    assert client.post(url, json=body).json() == pack
    changed = client.put('/api/demand/packs/' + pack['id'], json={'space_id': run['space_id'], 'name': pack['name'],
        'expected_version': 1, 'theme_terms': [pack['theme_terms'][0], '新词条']}).json()
    assert changed['entries'][0] == first and changed['entries'][1]['status'] == 'pending'
    assert changed['history'][0]['entries'] == pack['entries']
    with store.read() as db:
        assert len(records(db, 'demand_packs')) == 1
    assert client.post(url, json={**body, 'request_id': 'stale', 'selected': [
        {'id': run['results'][0]['id'], 'revision': 1}]}).status_code == 409


def test_to_pack_split_limit_preserves_all_confirmed_results(system):
    client, _, _ = system
    imported = client.post('/api/demand/batches', json={'space_id': 'kb-medical', 'title': '完整词条',
        'filename': '词条.txt', 'columns': [{'column': 0}], 'has_header': False,
        'rows': [{'row': i + 1, 'values': ['问题词' + str(i)]} for i in range(31)]}).json()
    values = {'space_id': 'kb-medical', 'name': '完整词条', 'goal': '整理全部词条', 'batch_id': imported['id']}
    run = review(client, wait(client, create(client, values)['id'])).json()['task']
    body = {'name': '超限词包', 'role': 'intent', 'selected': [{'id': row['id'], 'revision': row['revision']} for row in run['results']]}
    response = client.post(f"/api/demand/tasks/{run['id']}/to-pack", json=body)
    assert response.status_code == 422 and '拆成多个词包' in response.text
    assert len(client.get('/api/demand/tasks/' + run['id']).json()['results']) == 31
    body['selected'] = body['selected'][:30]
    accepted = client.post(f"/api/demand/tasks/{run['id']}/to-pack", json=body)
    assert accepted.status_code == 200 and len(accepted.json()['intent_terms']) == 30


def test_reviews_export_exclusions_and_summary_are_reviewable(system, monkeypatch):
    import csv
    from io import StringIO
    client, store, _ = system
    values = config(client, filters={'exclude_terms': ['同行']})
    preview = client.post('/api/demand/preview', json={'config': values}).json()
    assert preview['exclusions'][0]['original'] and preview['exclusions'][0]['source']['row']
    run = wait(client, create(client, values)['id'])
    confirmed = review(client, run, rows=run['results'][:1]).json()
    client.post(f"/api/demand/tasks/{run['id']}/undo", json={'operation_id': confirmed['operation_id']})
    history = client.get(f"/api/demand/tasks/{run['id']}/reviews").json()
    assert [entry['action'] for entry in history] == ['undo', 'confirm']
    assert history[1]['changes'][0]['before']['status'] == 'pending'
    assert history[1]['changes'][0]['after']['status'] == 'confirmed'
    with store.transaction() as db:
        row = get(db, 'demand_results', run['results'][0]['id'])
        row.update(original=' =HYPERLINK("bad")', group='+SUM(1,2)')
        row['source']['filename'] = '@evil.txt'
        put(db, 'demand_results', row)
    exported = client.get(f"/api/demand/tasks/{run['id']}/export?format=csv")
    assert exported.status_code == 200 and exported.content.startswith(b'\xef\xbb\xbf')
    rows = list(csv.reader(StringIO(exported.content.decode('utf-8-sig'))))
    assert rows[1][2].startswith("' =") and rows[1][6].startswith("'+") and rows[1][8].startswith("'@")
    assert '完整来源' in rows[0] and len(rows) == len(run['results']) + 1
    assert client.get(f"/api/demand/tasks/{run['id']}/export?format=xlsx").status_code == 422
    page = client.get(f"/api/demand/tasks/{run['id']}?limit=2&offset=1").json()
    assert len(page['results']) == 2 and page['result_page']['total'] == len(run['results'])
    def no_results(*_):
        pytest.fail('summary polling must not deserialize task results')
    monkeypatch.setattr(worker, 'results_for', no_results)
    summary = client.get(f"/api/demand/tasks/{run['id']}?summary=true").json()
    assert 'results' not in summary and 'config_snapshot' not in summary
    assert len(client.get('/api/demand/tasks?space_id=kb-medical').json()) == 1
