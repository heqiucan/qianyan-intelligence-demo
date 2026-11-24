"""Configuration tests use fake credentials and never contact a provider."""
from types import SimpleNamespace
import pytest
from scripts import configure_deepseek as config


@pytest.mark.parametrize('invalid', ['sk-example\nMODEL_BASE_URL=https://invalid.example', 'key with spaces', 'short'])
def test_invalid_key_file_does_not_modify_environment(tmp_path, monkeypatch, capsys, invalid):
    target = tmp_path / '.env'
    target.write_text('MODEL_PROVIDER=replay\n', encoding='utf-8')
    source = tmp_path / 'key.txt'
    source.write_text(invalid, encoding='utf-8')
    monkeypatch.setattr(config, 'ROOT', tmp_path)
    monkeypatch.setattr(config.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0))
    monkeypatch.setattr(config.sys, 'argv', ['configure', '--key-file', str(source)])
    assert config.main() == 1
    assert target.read_text() == 'MODEL_PROVIDER=replay\n'
    assert invalid not in capsys.readouterr().out


def test_local_write_preserves_unrelated_settings_and_never_prints_key(tmp_path, monkeypatch, capsys):
    fake_key = 'sk-this-is-only-a-unit-test-credential'
    target = tmp_path / '.env'
    target.write_text('# keep\nDEMO_DATA_DIR=custom-data\nMODEL_NAME=old\nMODEL_NAME=duplicate\nMODEL_API_KEY=old-fake-secret\n', encoding='utf-8')
    source = tmp_path / 'key.txt'
    source.write_text(fake_key, encoding='utf-8-sig')
    monkeypatch.setattr(config, 'ROOT', tmp_path)
    monkeypatch.setattr(config.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=0))
    monkeypatch.setattr(config.sys, 'argv', ['configure', '--key-file', str(source)])
    assert config.main() == 0
    text = target.read_text(encoding='utf-8')
    assert '# keep\nDEMO_DATA_DIR=custom-data\n' in text
    assert text.count('MODEL_NAME=') == 1
    assert 'MODEL_NAME=deepseek-flash' in text and 'MODEL_PROVIDER=deepseek' in text
    assert 'MODEL_BASE_URL=https://api.deepseek.com' in text
    assert fake_key in text and 'old-fake-secret' not in text
    assert fake_key not in capsys.readouterr().out
    assert len(list(tmp_path.iterdir())) == 2


def test_refuses_key_storage_when_env_is_not_gitignored(tmp_path, monkeypatch):
    monkeypatch.setattr(config, 'ROOT', tmp_path)
    monkeypatch.setattr(config.subprocess, 'run', lambda *a, **k: SimpleNamespace(returncode=1))
    monkeypatch.setattr(config.sys, 'argv', ['configure', '--key-file', str(tmp_path / 'missing')])
    assert config.main() == 1
    assert not (tmp_path / '.env').exists()
