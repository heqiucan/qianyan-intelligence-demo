"""DeepSeek contracts using mock HTTP and isolated SQLite only."""
import json
import traceback

import httpx
import pytest

from backend.core.storage import SQLiteStore
from backend.model_adapter import (
    DEEPSEEK_BASE, DEEPSEEK_MODEL, DEEPSEEK_VERSION, FREE_MODEL, ZHIPU_BASE,
    ModelAdapter, ModelFailure,
)


CLIENT = httpx.Client
KEY = 'fake-deepseek-test-key'
PRIVATE = 'private-provider-response-and-prompt'
COPY = dict(direction='Direction', title='Title', body='Body', cta='View', script='Script')


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv('MODEL_PROVIDER', 'deepseek')
    monkeypatch.setenv('MODEL_API_KEY', KEY)
    monkeypatch.delenv('MODEL_NAME', raising=False)
    monkeypatch.delenv('MODEL_BASE_URL', raising=False)
    # Fail closed even when a test accidentally forgets its mock transport.
    monkeypatch.setattr(httpx, 'Client', lambda **kwargs: pytest.fail('HTTP mock required'))


def mock_http(monkeypatch, handler):
    calls = []

    def dispatch(request):
        calls.append(request)
        assert str(request.url) == DEEPSEEK_BASE + '/chat/completions'
        assert request.headers['Authorization'] == 'Bearer ' + KEY
        return handler(request)

    def client(**kwargs):
        assert kwargs['follow_redirects'] is False
        return CLIENT(transport=httpx.MockTransport(dispatch), **kwargs)

    monkeypatch.setattr(httpx, 'Client', client)
    return calls


def result(data=None, finish='stop'):
    return httpx.Response(200, json={
        'choices': [{'finish_reason': finish, 'message': {'content': json.dumps(data if data is not None else {'ok': True})}}],
        'usage': {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15, 'raw': PRIVATE},
    })


def test_request_and_metadata(monkeypatch):
    monkeypatch.setenv('MODEL_BASE_URL', DEEPSEEK_BASE + '/')
    calls = mock_http(monkeypatch, lambda _: result())
    adapter = ModelAdapter()
    assert adapter.info['configured'] and not adapter.info['live_verified']
    info = adapter.check_connection()
    payload = json.loads(calls[0].content)
    assert payload['model'] == DEEPSEEK_MODEL
    assert payload['response_format'] == {'type': 'json_object'}
    assert payload['thinking'] == {'type': 'disabled'}
    assert payload['stream'] is False and 'tools' not in payload
    assert [message['role'] for message in payload['messages']] == ['system', 'user']
    assert info['mode'] == 'deepseek' and info['model_name'] == DEEPSEEK_MODEL
    assert info['model_version'] == DEEPSEEK_VERSION
    assert '滚动别名' in info['label'] and '滚动别名' in info['model_version_note']
    assert info['live_verified'] and info['free_only'] is False
    assert info['pricing_checked_on'] is None and info['cost'] is None
    assert adapter.provenance == {'model_provider': 'deepseek', 'model_name': DEEPSEEK_MODEL}
    assert KEY not in json.dumps(info) and 'Authorization' not in json.dumps(info)
    assert len(calls) == 1


@pytest.mark.parametrize('name,value', [
    ('MODEL_BASE_URL', 'https://attacker.example'),
    ('MODEL_BASE_URL', 'http://api.deepseek.com'),
    ('MODEL_BASE_URL', 'https://api.deepseek.com@attacker.example'),
    ('MODEL_BASE_URL', 'https://api.deepseek.com.attacker.example'),
    ('MODEL_BASE_URL', 'https://api.deepseek.com/?target=private'),
    ('MODEL_BASE_URL', 'https://api.deepseek.com/v1'),
    ('MODEL_BASE_URL', ZHIPU_BASE),
    ('MODEL_NAME', FREE_MODEL),
    ('MODEL_NAME', 'deepseek-v4-flash'),
    ('MODEL_NAME', 'DeepSeek-V4.1-Flash-1017'),
    ('MODEL_NAME', 'deepseek-pro'),
    ('MODEL_NAME', PRIVATE),
    ('MODEL_PROVIDER', PRIVATE),
    ('MODEL_PROVIDER', 'openai-compatible'),
    ('MODEL_API_KEY', ''),
    ('MODEL_API_KEY', 'your-api-key'),
    ('MODEL_API_KEY', 'configure-only-on-the-server'),
])
def test_configuration_blocked_before_http(monkeypatch, name, value):
    monkeypatch.setenv('MODEL_NAME', DEEPSEEK_MODEL)
    monkeypatch.setenv(name, value)
    adapter = ModelAdapter()
    assert not adapter.info['configured']
    with pytest.raises(ModelFailure) as caught:
        adapter.check_connection()
    assert adapter.last_error_kind == 'configuration'
    assert KEY not in str(caught.value) and PRIVATE not in str(caught.value)
    assert not adapter.info['live_verified']


@pytest.mark.parametrize('failure,kind,status', [
    (401, 'authentication', 502), (403, 'authentication', 502),
    (402, 'provider', 502), (429, 'rate_limit', 503),
    (400, 'provider', 502), (404, 'provider', 502), (500, 'provider', 502),
    (302, 'provider', 502), ('timeout', 'timeout', 504),
    ('network', 'response', 502), ('json', 'response', 502),
    ('array', 'response', 502), ('schema', 'validation', 502),
    ('length', 'validation', 502),
])
def test_failure_is_private_durable_and_never_retried(monkeypatch, tmp_path, failure, kind, status):
    def handler(request):
        if failure == 'timeout':
            raise httpx.ReadTimeout(KEY + PRIVATE, request=request)
        if failure == 'network':
            raise httpx.ConnectError(KEY + PRIVATE, request=request)
        if failure == 'json':
            return httpx.Response(200, text=KEY + PRIVATE)
        if failure == 'array':
            return result([])
        if failure == 'schema':
            return result({'ok': False})
        if failure == 'length':
            return result(finish='length')
        return httpx.Response(failure, json={'error': {'message': KEY + PRIVATE}},
                              headers={'Location': 'https://attacker.example'})

    calls = mock_http(monkeypatch, handler)
    adapter = ModelAdapter()
    store = SQLiteStore(tmp_path)
    adapter.bind_store(store)
    adapter.operation_started('model-check:' + PRIVATE)
    with pytest.raises(ModelFailure) as caught:
        adapter.check_connection()
    adapter.operation_finished()
    assert caught.value.status_code == status
    assert adapter.info['last_error_kind'] == kind
    assert 'DeepSeek' in str(caught.value) and '智谱' not in str(caught.value)
    record = adapter.info['recent_calls'][0]
    assert record['provider'] == 'deepseek' and record['model'] == DEEPSEEK_MODEL
    assert record['remote_calls'] == 1 and record['outcome'] == 'failed'
    assert not record['provider_succeeded'] and not adapter.info['live_verified']
    restored = ModelAdapter()
    restored.bind_store(store)
    assert restored.info['recent_calls'] == adapter.info['recent_calls']
    with store.read() as db:
        rows = [dict(row) for row in db.execute('SELECT * FROM model_calls')]
    serialized = json.dumps(rows) + json.dumps(restored.info) + ''.join(traceback.format_exception(caught.value))
    assert KEY not in serialized and PRIVATE not in serialized
    assert len(calls) == 1


def test_success_history_scope_and_creative_provenance(monkeypatch, tmp_path):
    calls = mock_http(monkeypatch, lambda _: result({'creatives': [COPY, COPY]}))
    store = SQLiteStore(tmp_path)
    adapter = ModelAdapter()
    adapter.bind_store(store)
    adapter.operation_started('generate:' + PRIVATE)
    copies = adapter.creatives({'name': PRIVATE})
    adapter.operation_finished(success=True)
    assert all(copy['model_provider'] == 'deepseek' and copy['model_name'] == DEEPSEEK_MODEL for copy in copies)
    record = adapter.info['recent_calls'][0]
    assert record['usage'] == {'prompt_tokens': 10, 'completion_tokens': 5, 'total_tokens': 15}
    assert record['provider_succeeded'] and record['outcome'] == 'success'
    assert record['cost'] is None
    restored = ModelAdapter()
    restored.bind_store(store)
    assert restored.info['call_count'] == 1 and restored.info['last_success_at']
    assert not restored.info['live_verified'] and '本次启动尚未验证' in restored.info['status']
    assert restored.info['recent_calls'] == adapter.info['recent_calls']
    for provider in ('zhipu-free', 'openai-compatible', 'replay', 'unsupported'):
        monkeypatch.setenv('MODEL_PROVIDER', provider)
        other = ModelAdapter()
        other.bind_store(store)
        assert other.info['call_count'] == 0 and other.info['recent_calls'] == []
        assert other.info['last_success_at'] is None
        assert other.info['free_only'] == (provider != 'unsupported')
    assert len(calls) == 1
    assert KEY not in json.dumps(restored.info) and PRIVATE not in json.dumps(restored.info)


@pytest.mark.parametrize('operation', ['creatives', 'copy', 'insight-format', 'insight-action', 'insight-claim', 'knowledge'])
def test_domain_validation_names_current_provider(monkeypatch, operation):
    data = {}
    if operation.startswith('insight-') and operation != 'insight-format':
        data = {'hypotheses': ['可能'], 'missing': ['依据'], 'recommendation': '分析成本' if operation == 'insight-action' else '保证提升标题效果'}
    calls = mock_http(monkeypatch, lambda _: result(data))
    adapter = ModelAdapter()
    with pytest.raises(ModelFailure) as caught:
        if operation == 'creatives':
            adapter.creatives({})
        elif operation == 'copy':
            adapter.optimize({}, COPY, {'recommendation': 'Update'})
        elif operation == 'knowledge':
            adapter.knowledge_draft({'hits': [], 'space': {'scene': 'retail'}, 'query': '', 'channel': {}}, 'answer')
        else:
            adapter.insight({'label': 'Demo', 'dataset': 'history', 'metrics': {
                'orders': 0, 'buyers': 0, 'new_customers': 0, 'revenue': 0, 'spend': None}})
    assert '智谱' not in str(caught.value)
    assert adapter.last_error_kind == 'validation' and len(calls) == 1
