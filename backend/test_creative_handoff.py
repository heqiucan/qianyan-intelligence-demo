"""Handoff boundaries, immutable evidence and actual plan/order continuation."""
from datetime import date, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.test_agents import create, wait, command
from backend.test_claims import cup_seed


@pytest.fixture
def client(tmp_path, monkeypatch, cup_seed):
    monkeypatch.setenv("MODEL_PROVIDER", "replay")
    monkeypatch.delenv("DEMO_ACCESS_TOKEN", raising=False)
    with TestClient(create_app(tmp_path)) as c:
        yield c


def knowledge_draft(client, scene="live", confirm=True):
    space = "kb-" + scene
    docs = client.post(f"/api/knowledge/spaces/{space}/samples").json()
    for doc in docs:
        response = client.post(f"/api/knowledge/documents/{doc['id']}/review", json={"expected_version": 1, "status": "approved"})
        assert response.status_code == 200
    query = "保温杯规格" if scene == "live" else "咨询预约流程"
    search = client.post("/api/knowledge/search", json={"space_id": space, "query": query, "channel": "internal"}).json()
    draft = client.post("/api/knowledge/drafts", json={"space_id": space, "query": query, "channel": "internal", "task": "script", "signature": search["signature"]}).json()
    assert "id" in draft, draft
    if confirm:
        draft = client.post(f"/api/knowledge/drafts/{draft['id']}/confirm", json={"acknowledged": True, "expected_revision": 1}).json()
    return draft


def payload(draft, **extra):
    return {"request_id": uuid4().hex, "campaign_id": "campaign-demo", "expected_revision": draft["revision"],
            "expected_product_version": 1, "acknowledged": True, "title": "青禾随行保温杯",
            "body": "青禾随行保温杯，500 ml，奶油白。", "script": "展示杯身外观、容量标识和杯盖结构。",
            "cta": "查看商品详情", **extra}


def transfer(client, draft, **extra):
    return client.post(f"/api/knowledge/drafts/{draft['id']}/creative", json=payload(draft, **extra))


def plan(client, creative):
    return client.post("/api/plans", json={"creative_id": creative["id"], "name": "知识内容模拟计划", "budget": 100,
                      "start_date": date.today().isoformat(), "end_date": (date.today() + timedelta(days=2)).isoformat()})


def test_rag_handoff_reaches_plan_and_order_without_implicit_approval(client):
    draft = knowledge_draft(client)
    before = client.get('/api/state').json()
    response = transfer(client, draft)
    assert response.status_code == 200, response.text
    creative = response.json()['creative']
    assert creative['status'] == 'draft' and creative['source'] == 'knowledge'
    assert creative['knowledge_origin']['sources'] == draft['sources']
    assert creative['knowledge_origin']['blocks'] == draft['blocks']
    assert creative['knowledge_origin']['revision'] == draft['revision']
    after = client.get('/api/state').json()
    for key in ('product', 'campaigns', 'plans', 'orders'):
        assert before[key] == after[key]
    assert plan(client, creative).status_code == 409
    assert client.post(f"/api/creatives/{creative['id']}/approve").status_code == 200
    p = plan(client, creative).json()
    assert p['creative_snapshot']['knowledge_origin'] == creative['knowledge_origin']
    assert client.post(f"/api/plans/{p['id']}/status", json={'status': 'running'}).status_code == 200
    order = client.post('/api/orders', json={'plan_id': p['id'], 'buyer_id': 'new-001', 'quantity': 1}).json()
    assert order['creative_id'] == creative['id'] and order['amount'] == 99
    assert order['simulation']


def test_double_click_retry_and_reload_return_same_creative(client):
    draft = knowledge_draft(client)
    body = payload(draft)
    url = f"/api/knowledge/drafts/{draft['id']}/creative"
    first = client.post(url, json=body).json()
    assert client.post(url, json=body).json() == first
    again = transfer(client, draft).json()
    assert again['reused'] and again['creative']['id'] == first['creative']['id']
    items = client.get('/api/knowledge/drafts?space_id=kb-live').json()
    assert len(items[0]['transfers']) == 1


@pytest.mark.parametrize('overrides,expected', [
    ({'acknowledged': False}, 422), ({'expected_revision': 9}, 409),
    ({'expected_product_version': 9}, 409), ({'campaign_id': 'missing'}, 404),
    ({'script': 'a' * 6001}, 422), ({'title': ''}, 422),
])
def test_invalid_handoffs_leave_creatives_unchanged(client, overrides, expected):
    draft = knowledge_draft(client)
    before = client.get('/api/state').json()['creatives']
    response = transfer(client, draft, **overrides)
    assert response.status_code == expected, response.text
    assert client.get('/api/state').json()['creatives'] == before


def test_unconfirmed_and_medical_drafts_cannot_enter_product_campaign(client):
    draft = knowledge_draft(client, confirm=False)
    assert not draft['can_transfer'] and transfer(client, draft).status_code == 409
    medical = knowledge_draft(client, scene='medical')
    assert not medical['can_transfer'] and transfer(client, medical).status_code == 422


def test_agent_must_complete_and_stays_bound_to_original_campaign(client):
    task = wait(client, create(client, scene='live', goal='整理保温杯规格和直播讲解脚本', campaign_id='campaign-demo'))
    draft = task['draft']
    assert task['campaign_id'] == 'campaign-demo'
    assert client.post(f"/api/knowledge/drafts/{draft['id']}/confirm", json={'acknowledged': True, 'expected_revision': 1}).status_code == 200
    assert transfer(client, draft).status_code == 409
    assert command(client, task, 'complete', draft_id=draft['id'], draft_revision=1).status_code == 200
    result = transfer(client, draft)
    assert result.status_code == 200, result.text
    assert result.json()['creative']['knowledge_origin']['agent_task_id'] == task['id']
    other = client.post('/api/campaigns', json={'name': '另一场活动'}).json()
    assert transfer(client, draft, campaign_id=other['id']).status_code == 422
    current = client.get('/api/agent/tasks/' + task['id']).json()
    assert current['draft']['linked_campaign_id'] == 'campaign-demo'
    assert current['draft']['can_transfer']


def test_medical_agent_cannot_bind_product_activity(client):
    response = client.post('/api/agent/tasks', json={'scene': 'medical', 'goal': '整理咨询预约流程', 'campaign_id': 'campaign-demo'})
    assert response.status_code == 422
    assert client.get('/api/agent/tasks').json() == []


@pytest.mark.parametrize('change', ['update', 'archive', 'expire'])
def test_changed_evidence_blocks_handoff_approval_plan_and_start(client, change):
    draft = knowledge_draft(client)
    creative = transfer(client, draft).json()['creative']
    assert client.post(f"/api/creatives/{creative['id']}/approve").status_code == 200
    p = plan(client, creative).json()
    doc = client.get('/api/knowledge/documents/' + draft['sources'][0]['document_id']).json()
    if change == 'archive':
        response = client.post(f"/api/knowledge/documents/{doc['id']}/review", json={'expected_version': 1, 'status': 'archived'})
    else:
        body = {key: doc[key] for key in ('space_id', 'title', 'kind', 'channel', 'pages')}
        body['expected_version'] = doc['version']
        if change == 'expire':
            body['valid_until'] = '2020-01-01'
        response = client.put('/api/knowledge/documents/' + doc['id'], json=body)
    assert response.status_code == 200, response.text
    snapshot = client.get(f"/api/creatives/{creative['id']}/knowledge-origin").json()
    assert snapshot['origin'] == creative['knowledge_origin'] and snapshot['warnings']
    assert transfer(client, draft).status_code == 409
    assert client.post(f"/api/creatives/{creative['id']}/approve").status_code == 409
    assert plan(client, creative).status_code == 409
    assert client.post(f"/api/plans/{p['id']}/status", json={'status': 'running'}).status_code == 409


def test_creative_revision_preserves_origin_and_original_content(client):
    draft = knowledge_draft(client)
    creative = transfer(client, draft).json()['creative']
    revised = client.post(f"/api/creatives/{creative['id']}/revise", json={
        'title': '新的讲解标题', 'body': creative['body'], 'script': '请看这款 500 ml 保温杯。', 'cta': creative['cta']}).json()
    assert revised['status'] == 'draft' and revised['version'] == 2
    assert revised['knowledge_origin'] == creative['knowledge_origin']
    original = next(c for c in client.get('/api/state').json()['creatives'] if c['id'] == creative['id'])
    assert original == creative


def test_free_text_edit_still_passes_existing_fact_checks(client):
    draft = knowledge_draft(client)
    creative = transfer(client, draft, body='超大 1L 容量，现在只要 79 元。').json()['creative']
    assert client.post(f"/api/creatives/{creative['id']}/approve").status_code == 422
    assert plan(client, creative).status_code == 409
