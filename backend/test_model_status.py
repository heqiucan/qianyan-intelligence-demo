"""Durable, private model metadata; all provider responses are local HTTP mocks."""
from concurrent.futures import ThreadPoolExecutor
import json
from threading import Event
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend.main import create_app
from backend.model_adapter import FREE_MODEL


REAL_CLIENT = httpx.Client
KEY = 'model-status-test-credential-not-real'
PRIVATE = 'private-product-and-prompt-text-must-not-be-in-call-log'
COPY = {'direction': '桌面展示', 'title': '认识这款杯子', 'body': PRIVATE,
        'cta': '查看规格', 'script': '0–3秒展示杯子。'}


@pytest.fixture
def live_env(monkeypatch):
    monkeypatch.setenv('MODEL_PROVIDER', 'zhipu-free')
    monkeypatch.setenv('MODEL_API_KEY', KEY)
    monkeypatch.delenv('MODEL_NAME', raising=False)
    monkeypatch.delenv('MODEL_BASE_URL', raising=False)
    monkeypatch.delenv('DEMO_ACCESS_TOKEN', raising=False)


def mock_provider(monkeypatch, handler):
    calls = []
    def dispatch(request):
        calls.append(request)
        return handler(request)
    monkeypatch.setattr(httpx, 'Client', lambda **options: REAL_CLIENT(transport=httpx.MockTransport(dispatch), **options))
    return calls


def result(data=None, usage=None):
    return httpx.Response(200, json={'choices': [{'finish_reason': 'stop', 'message': {'content': json.dumps(data or {'ok': True})}}], 'usage': usage})


def status(client):
    response = client.get('/api/model/status')
    assert response.status_code == 200, response.text
    return response.json()


def test_success_history_usage_and_restart_are_truthfully_distinguished(live_env, monkeypatch, tmp_path):
    usage = {'prompt_tokens': 17, 'completion_tokens': 23, 'total_tokens': 40, 'prompt_text': PRIVATE, 'cost': 999}
    calls = mock_provider(monkeypatch, lambda _: result({'creatives': [COPY, COPY]}, usage))
    app = create_app(tmp_path)
    with TestClient(app) as client:
        assert status(client)['call_count'] == 0 and not calls
        response = client.post('/api/campaigns/campaign-demo/generate', json={'request_id': 'private-request-id'})
        assert response.status_code == 200, response.text
        first = status(client)
        assert first['call_count'] == 1 and first['live_verified'] and first['last_success_at']
        assert not first['busy'] and first['operation_started_at'] is None
        record = first['recent_calls'][0]
        assert record['operation'] == 'generate' and record['outcome'] == 'success'
        assert record['provider_succeeded'] and record['remote_calls'] == 1
        assert record['usage'] == {key: usage[key] for key in ('prompt_tokens', 'completion_tokens', 'total_tokens')}
        assert record['cost'] is None and first['cost'] is None
        assert client.post('/api/campaigns/campaign-demo/generate', json={'request_id': 'private-request-id'}).status_code == 200
        assert status(client)['call_count'] == 1 and len(status(client)['recent_calls']) == 1
        with app.state.store.read() as db:
            records = [dict(row) for row in db.execute('SELECT * FROM model_calls')]
        serialized = json.dumps(records) + json.dumps(first)
        for sensitive in (KEY, PRIVATE, 'private-request-id', 'campaign-demo', 'Authorization', 'messages'):
            assert sensitive not in serialized
    with TestClient(create_app(tmp_path)) as client:
        restored = status(client)
        assert restored['call_count'] == 1 and restored['last_success_at'] == first['last_success_at']
        assert restored['recent_calls'] == first['recent_calls']
        assert not restored['live_verified'] and not restored['busy']
        assert '本次启动尚未验证' in restored['status']
        assert len(calls) == 1  # A status read and restart never invoke the provider.


@pytest.mark.parametrize('failure,kind,count', [('configuration', 'configuration', 0), ('http', 'authentication', 1), ('json', 'response', 1), ('schema', 'validation', 1), ('timeout', 'timeout', 1)])
def test_failures_persist_without_raw_provider_messages(live_env, monkeypatch, tmp_path, failure, kind, count):
    if failure == 'configuration':
        monkeypatch.delenv('MODEL_API_KEY')
    def provider(request):
        if failure == 'http':
            return httpx.Response(401, json={'error': {'message': KEY + PRIVATE}})
        if failure == 'json':
            return httpx.Response(200, text=KEY + PRIVATE)
        if failure == 'timeout':
            raise httpx.ReadTimeout(KEY + PRIVATE, request=request)
        return result({'ok': False})
    calls = mock_provider(monkeypatch, provider)
    with TestClient(create_app(tmp_path)) as client:
        response = client.post('/api/model/check')
        assert response.status_code in {502, 504}
        saved = status(client)
        assert saved['last_failure_at'] and not saved['last_success_at']
        assert saved['last_error_kind'] == kind and saved['call_count'] == count
        assert not saved['busy'] and not saved['live_verified']
        assert saved['recent_calls'][0]['outcome'] == 'failed'
        assert saved['recent_calls'][0]['usage'] is None
        assert KEY not in json.dumps(saved) and PRIVATE not in json.dumps(saved)
    with TestClient(create_app(tmp_path)) as client:
        restored = status(client)
        assert restored['last_failure_at'] == saved['last_failure_at']
        assert restored['last_error_kind'] == kind and restored['last_error'] == saved['last_error']
        assert len(calls) == count


def test_slow_provider_exposes_busy_status_without_blocking_reads_or_writes(live_env, monkeypatch, tmp_path):
    entered, release = Event(), Event()
    def provider(_):
        entered.set()
        assert release.wait(10)
        return result()
    calls = mock_provider(monkeypatch, provider)
    with TestClient(create_app(tmp_path)) as client, ThreadPoolExecutor(max_workers=2) as pool:
        future = pool.submit(client.post, '/api/model/check')
        try:
            assert entered.wait(3)
            waiting = pool.submit(status, client).result(timeout=3)
            assert waiting['busy'] and waiting['operation'] == 'model-check' and waiting['operation_started_at']
            assert waiting['call_count'] == 1 and waiting['recent_calls'][0]['outcome'] == 'running'
            product = client.get('/api/state').json()['product']
            assert pool.submit(client.put, '/api/product', json={**product, 'name': '模型等待时可保存'}).result(timeout=3).status_code == 200
            assert client.post('/api/model/check').status_code == 409
            assert len(calls) == 1
        finally:
            release.set()
        finished = future.result(timeout=3)
        assert finished.status_code == 200 and not finished.json()['busy']
        assert status(client)['last_success_at']


def test_replay_has_no_provider_success_or_usage(live_env, monkeypatch, tmp_path):
    monkeypatch.setenv('MODEL_PROVIDER', 'replay')
    calls = mock_provider(monkeypatch, lambda _: pytest.fail('Replay must not make HTTP calls'))
    with TestClient(create_app(tmp_path)) as client:
        assert client.post('/api/campaigns/campaign-demo/generate', json={'request_id': 'replay-only'}).status_code == 200
        info = status(client)
        assert info['call_count'] == 0 and info['last_success_at'] is None and not info['live_verified']
        record = info['recent_calls'][0]
        assert record['provider'] == 'replay' and record['outcome'] == 'replay'
        assert not record['provider_succeeded'] and record['usage'] is None and not calls


def test_restart_marks_running_call_interrupted_without_retry(live_env, monkeypatch, tmp_path):
    calls = mock_provider(monkeypatch, lambda _: pytest.fail('No automatic retry at startup'))
    app = create_app(tmp_path)
    with TestClient(app):
        app.state.model_adapter.operation_started('generate:sensitive-business-id')
    with TestClient(create_app(tmp_path)) as client:
        info = status(client)
        assert not info['busy'] and info['last_error_kind'] == 'interrupted'
        assert info['recent_calls'][0]['outcome'] == 'interrupted'
        assert '未自动重发' in info['last_error'] and info['last_success_at'] is None
        assert not calls and 'sensitive-business-id' not in json.dumps(info)


def test_current_model_does_not_inherit_other_models_success(live_env, monkeypatch, tmp_path):
    mock_provider(monkeypatch, lambda _: result())
    with TestClient(create_app(tmp_path)) as client:
        assert client.post('/api/model/check').status_code == 200
        assert status(client)['model_name'] == FREE_MODEL
    monkeypatch.setenv('MODEL_NAME', 'glm-4.7-flash')
    with TestClient(create_app(tmp_path)) as client:
        info = status(client)
        assert info['call_count'] == 0 and not info['recent_calls'] and info['last_success_at'] is None


def test_agent_uses_same_operation_history(live_env, monkeypatch, tmp_path):
    mock_provider(monkeypatch, lambda _: result({'action': 'request_input', 'query': '', 'source_ids': [], 'message': '请补充依据'}))
    with TestClient(create_app(tmp_path)) as client:
        response = client.post('/api/agent/tasks', json={'scene': 'medical', 'goal': '整理预约流程 FAQ', 'request_id': 'agent-status-test'})
        assert response.status_code == 202
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            task = client.get('/api/agent/tasks/' + response.json()['id']).json()
            if task['status'] not in {'queued', 'running'}:
                break
            time.sleep(.025)
        assert task['status'] == 'waiting_input'
        info = status(client)
        assert info['call_count'] == 1 and info['last_success_at']
        assert info['recent_calls'][0]['operation'] == 'choose_action'
        assert info['recent_calls'][0]['outcome'] == 'success'


@pytest.mark.parametrize('usage,expected', [(None, None), ({}, None), ({'total_tokens': 0}, {'total_tokens': 0}), ({'prompt_tokens': -1, 'completion_tokens': True, 'total_tokens': '12', 'data': PRIVATE}, None)])
def test_missing_or_invalid_usage_is_not_invented(live_env, monkeypatch, tmp_path, usage, expected):
    mock_provider(monkeypatch, lambda _: result(usage=usage))
    with TestClient(create_app(tmp_path)) as client:
        assert client.post('/api/model/check').status_code == 200
        record = status(client)['recent_calls'][0]
        assert record['usage'] == expected and record['cost'] is None


def test_status_endpoint_keeps_access_gate_and_no_store_header(live_env, monkeypatch, tmp_path):
    monkeypatch.setenv('DEMO_ACCESS_TOKEN', 'private-test-access')
    mock_provider(monkeypatch, lambda _: pytest.fail('Status must not use provider'))
    with TestClient(create_app(tmp_path)) as client:
        assert client.get('/api/model/status').status_code == 401
        response = client.get('/api/model/status', headers={'X-Demo-Token': 'private-test-access'})
        assert response.status_code == 200 and response.headers['Cache-Control'] == 'no-store'
