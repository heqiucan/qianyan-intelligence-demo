"""New campaigns use reviewed current facts without rewriting historical snapshots."""
import hashlib
import json

import pytest
from fastapi.testclient import TestClient

from backend.main import CampaignInput, create_app, request_fingerprint


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv('MODEL_PROVIDER', 'replay')
    monkeypatch.delenv('DEMO_ACCESS_TOKEN', raising=False)
    with TestClient(create_app(tmp_path)) as client:
        yield client


def state(client):
    response = client.get('/api/state')
    assert response.status_code == 200, response.text
    return response.json()


def replace_product(client, **changes):
    current = state(client)['product']
    response = client.put('/api/product', json={**current, **changes})
    assert response.status_code == 200, response.text
    return response.json()


def test_latest_product_snapshot_reaches_new_campaign_and_generation(client, monkeypatch):
    before = state(client)
    product = replace_product(client, name='三喜羽绒服', brand='三喜', price=500,
        capacity='M', color='香芋紫', description='虚构测试服装，前开襟外套。',
        evidence='测试商品资料 V2', restrictions='不编造保暖温度、销量或评价。',
        claim_evidence=[{'id': 'shipping-test', 'category': 'shipping',
            'claim': '24小时内发货（仅限工作日下单）', 'source': '测试流程记录 V2',
            'conditions': '仅限工作日下单', 'confirmed': True}])
    response = client.post('/api/campaigns', json={
        'name': '羽绒服创意', 'audience': '日常穿搭人群', 'expected_product_version': product['version']})
    assert response.status_code == 200, response.text
    campaign = response.json()
    assert campaign['product_snapshot'] == product
    assert 'expected_product_version' not in campaign
    sent = []
    def generate(product_facts, brief):
        sent.append(product_facts)
        return [{'direction': '规格说明', 'title': '三喜羽绒服',
                 'body': '三喜羽绒服，M，香芋紫，售价 ¥500。', 'cta': '查看规格',
                 'script': '展示三喜羽绒服的规格。'} for _ in range(2)]
    monkeypatch.setattr(client.app.state.model_adapter, 'creatives', generate)
    response = client.post(f'/api/campaigns/{campaign["id"]}/generate', json={'request_id': 'new-coat'})
    assert response.status_code == 200, response.text
    assert sent == [product]
    assert all(item['product_snapshot'] == product for item in response.json())
    after = state(client)
    for collection in ('campaigns', 'creatives', 'plans'):
        by_id = {record['id']: record for record in after[collection]}
        assert all(by_id[record['id']] == record for record in before[collection])


def test_stale_product_version_rejects_without_writes(client):
    shown = state(client)['product']
    latest = replace_product(client, name='已更新商品')
    with client.app.state.store.read() as db:
        before = [tuple(row) for row in db.execute('SELECT collection,id,data FROM records ORDER BY collection,id')]
        requests = [tuple(row) for row in db.execute('SELECT * FROM requests ORDER BY scope,request_id')]
    response = client.post('/api/campaigns', json={'name': '旧表单活动',
        'expected_product_version': shown['version'], 'request_id': 'stale-form'})
    assert response.status_code == 409 and f'V{latest["version"]}' in response.json()['detail']
    with client.app.state.store.read() as db:
        assert [tuple(row) for row in db.execute('SELECT collection,id,data FROM records ORDER BY collection,id')] == before
        assert [tuple(row) for row in db.execute('SELECT * FROM requests ORDER BY scope,request_id')] == requests


def test_completed_request_retries_old_snapshot_after_product_changes(client):
    first = state(client)['product']
    body = {'name': '已保存活动', 'expected_product_version': first['version'], 'request_id': 'completed-create'}
    response = client.post('/api/campaigns', json=body)
    assert response.status_code == 200, response.text
    saved = response.json()
    latest = replace_product(client, name='后续保存的商品')
    assert client.post('/api/campaigns', json=body).json() == saved
    assert client.post('/api/campaigns', json={**body, 'expected_product_version': latest['version']}).status_code == 409
    assert sum(c['id'] == saved['id'] for c in state(client)['campaigns']) == 1


def test_omitted_version_preserves_legacy_request_fingerprint(client):
    payload = CampaignInput(name='旧客户端活动', request_id='pre-guard')
    old_data = payload.model_dump(mode='json', exclude={'request_id', 'expected_product_version'})
    old_fingerprint = hashlib.sha256(json.dumps(old_data, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    assert request_fingerprint(payload) == ('pre-guard', old_fingerprint)
    existing = state(client)['campaigns'][0]
    with client.app.state.store.transaction() as db:
        db.execute('INSERT INTO requests VALUES (?,?,?,?)',
                   ('campaign', 'pre-guard', old_fingerprint, json.dumps(existing, ensure_ascii=False)))
    replace_product(client, name='较新商品')
    assert client.post('/api/campaigns', json={'name':'旧客户端活动', 'request_id':'pre-guard'}).json() == existing
    response = client.post('/api/campaigns', json={'name':'未传版本的新活动'})
    assert response.status_code == 200 and response.json()['product_snapshot']['name'] == '较新商品'


def test_control_version_is_not_saved_in_edited_strategy(client):
    campaign = state(client)['campaigns'][0]
    response = client.put('/api/campaigns/' + campaign['id'], json={
        'name': '新策略名称', 'expected_product_version': 99})
    assert response.status_code == 200, response.text
    changed = response.json()
    assert 'expected_product_version' not in changed
    assert all('expected_product_version' not in version for version in changed['strategy_history'])
    assert changed['product_snapshot'] == campaign['product_snapshot']
