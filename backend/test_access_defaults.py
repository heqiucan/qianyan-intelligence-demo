from fastapi.testclient import TestClient

from backend.main import create_app


def test_local_host_and_token_protect_docs(tmp_path, monkeypatch):
    monkeypatch.setenv('MODEL_PROVIDER', 'replay')
    monkeypatch.setenv('DEMO_ACCESS_TOKEN', 'test-token')
    monkeypatch.delenv('DEMO_SHARE_MODE', raising=False)
    with TestClient(create_app(tmp_path)) as client:
        assert client.get('/api/health', headers={'Host': 'rebinding.example'}).status_code == 400
        assert client.get('/api/state').status_code == 401
        assert client.get('/openapi.json').status_code == 401
        assert client.get('/api/state', headers={'X-Demo-Token': 'test-token'}).status_code == 200


def test_public_replay_share_has_no_docs_and_only_explicit_host(tmp_path, monkeypatch):
    monkeypatch.setenv('MODEL_PROVIDER', 'replay')
    monkeypatch.setenv('DEMO_SHARE_MODE', '1')
    monkeypatch.setenv('DEMO_ALLOWED_HOSTS', '192.0.2.4')
    monkeypatch.delenv('DEMO_ACCESS_TOKEN', raising=False)
    with TestClient(create_app(tmp_path)) as client:
        assert client.get('/openapi.json').status_code == 404
        assert client.get('/api/health', headers={'Host': 'demo.trycloudflare.com'}).status_code == 200
        assert client.get('/api/health', headers={'Host': '192.0.2.4'}).status_code == 200
        assert client.get('/api/health', headers={'Host': 'unlisted.example'}).status_code == 400
