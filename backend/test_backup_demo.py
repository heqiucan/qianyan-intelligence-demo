"""Backup acceptance uses only synthetic SQLite files under pytest tmp_path."""
import json
import sqlite3
from pathlib import Path

import pytest

from scripts import backup_demo as backup


@pytest.fixture
def source(tmp_path):
    folder = tmp_path / 'source'
    folder.mkdir()
    (folder / 'uploads').mkdir()
    (folder / 'uploads' / 'fixture.png').write_bytes(b'fictional uploaded media')
    # Settings near the data must never be swept into a backup.
    (folder / '.env').write_text('MODEL_API_KEY=fixture-not-a-real-secret', encoding='utf-8')
    (folder / 'credentials.json').write_text('{"fixture":true}', encoding='utf-8')
    connection = sqlite3.connect(folder / 'demo.sqlite3')
    connection.executescript('''
        CREATE TABLE records(collection TEXT, id TEXT, data TEXT, PRIMARY KEY(collection,id));
        CREATE TABLE requests(scope TEXT, request_id TEXT, fingerprint TEXT, result TEXT);
        CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT);
        INSERT INTO schema_migrations VALUES(1,'2026-11-17');
        INSERT INTO records VALUES('fixture','one','{"original":"原始内容"}');
        PRAGMA user_version=2;
    ''')
    connection.commit()
    connection.close()
    return folder


def test_online_wal_backup_restore_hashes_and_version(source, tmp_path):
    writer = sqlite3.connect(source / 'demo.sqlite3')
    try:
        assert writer.execute('PRAGMA journal_mode=WAL').fetchone()[0] == 'wal'
        writer.execute("INSERT INTO records VALUES('fixture','wal','uncheckpointed row')")
        writer.commit()
        # The writer and WAL remain open during backup. Copying the main file
        # alone would not reliably include this row.
        saved = backup.create_backup(source, tmp_path / 'backups')
        manifest = backup.verify_backup(saved)
        assert manifest['format_version'] == 1 and manifest['complete'] is True
        assert manifest['database'] == {'sqlite_user_version': 2, 'schema_migrations': [1]}
        assert {item['path'] for item in manifest['files']} == {'demo.sqlite3', 'uploads/fixture.png'}
        assert all(len(item['sha256']) == 64 for item in manifest['files'])
        restored = backup.restore_backup(saved, tmp_path / 'recovered')
        assert not (restored / '.env').exists() and not (restored / 'credentials.json').exists()
        assert (restored / 'uploads/fixture.png').read_bytes() == (source / 'uploads/fixture.png').read_bytes()
        with sqlite3.connect(restored / 'demo.sqlite3') as result:
            assert result.execute("SELECT data FROM records WHERE id='wal'").fetchone()[0] == 'uncheckpointed row'
        assert writer.execute('SELECT count(*) FROM records').fetchone()[0] == 2
        assert backup.verify_backup(restored)['database'] == manifest['database']
    finally:
        writer.close()


@pytest.mark.parametrize('destination', ['same', 'inside', 'parent'])
def test_backup_rejects_same_and_nested_directories(source, tmp_path, destination):
    output = {'same': source, 'inside': source / 'backup', 'parent': tmp_path}[destination]
    with pytest.raises(backup.BackupError, match='嵌套'):
        backup.create_backup(source, output)


def test_restore_cannot_overwrite_existing_source_or_empty_directory(source, tmp_path):
    saved = backup.create_backup(source, tmp_path / 'backups')
    original_hash = backup.file_hash(source / 'demo.sqlite3')
    with pytest.raises(backup.BackupError, match='不存在的新目录'):
        backup.restore_backup(saved, source)
    existing = tmp_path / 'existing-empty'
    existing.mkdir()
    with pytest.raises(backup.BackupError, match='不存在的新目录'):
        backup.restore_backup(saved, existing)
    assert backup.file_hash(source / 'demo.sqlite3') == original_hash


@pytest.mark.parametrize('unsafe', ['../outside.txt', '/absolute/path', 'uploads/../../outside',
                                   'uploads\\..\\outside', 'C:/outside', 'uploads/.env', 'uploads/credentials.json'])
def test_restore_rejects_manifest_traversal_and_secrets_before_creating_target(source, tmp_path, unsafe):
    saved = backup.create_backup(source, tmp_path / 'backups')
    path = saved / 'manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest['files'][1]['path'] = unsafe
    path.write_text(json.dumps(manifest), encoding='utf-8')
    with pytest.raises(backup.BackupError):
        backup.restore_backup(saved, tmp_path / 'recovered')
    assert not (tmp_path / 'recovered').exists()


def test_tampered_upload_and_corrupt_database_are_rejected(source, tmp_path):
    saved = backup.create_backup(source, tmp_path / 'backups')
    (saved / 'uploads/fixture.png').write_bytes(b'modified')
    with pytest.raises(backup.BackupError, match='校验失败'):
        backup.verify_backup(saved)
    second = backup.create_backup(source, tmp_path / 'backups')
    db = second / 'demo.sqlite3'
    db.write_bytes(b'not a sqlite database')
    manifest_path = second / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    record = next(item for item in manifest['files'] if item['path'] == 'demo.sqlite3')
    record.update(bytes=db.stat().st_size, sha256=backup.file_hash(db))
    manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
    with pytest.raises((backup.BackupError, sqlite3.DatabaseError)):
        backup.verify_backup(second)


def test_secrets_in_uploads_and_incomplete_copy_never_publish_success(source, tmp_path, monkeypatch):
    secret = source / 'uploads/secret-config.json'
    secret.write_text('fixture', encoding='utf-8')
    with pytest.raises(backup.BackupError, match='凭据'):
        backup.create_backup(source, tmp_path / 'backups')
    assert not list((tmp_path / 'backups').glob('demo-backup-*'))
    secret.unlink()
    def cannot_copy(*args, **kwargs):
        raise OSError('injected copy failure')
    monkeypatch.setattr(backup.shutil, 'copy2', cannot_copy)
    with pytest.raises(backup.BackupError, match='未生成正式备份'):
        backup.create_backup(source, tmp_path / 'backups')
    assert not list((tmp_path / 'backups').glob('demo-backup-*'))
    for partial in (tmp_path / 'backups').glob('.partial-*'):
        assert not (partial / 'manifest.json').exists()


def test_verify_rejects_unlisted_files_and_restore_copy_failure_marks_new_directory(source, tmp_path, monkeypatch):
    saved = backup.create_backup(source, tmp_path / 'backups')
    extra = saved / '.env'
    extra.write_text('unexpected', encoding='utf-8')
    with pytest.raises(backup.BackupError, match='清单不一致'):
        backup.verify_backup(saved)
    extra.unlink()
    def cannot_copy(*args, **kwargs):
        raise OSError('injected restore failure')
    monkeypatch.setattr(backup.shutil, 'copy2', cannot_copy)
    destination = tmp_path / 'recovered'
    with pytest.raises(backup.BackupError, match='未触碰原数据'):
        backup.restore_backup(saved, destination)
    assert (destination / '.restore-incomplete').is_file()
    with pytest.raises(backup.BackupError, match='不存在的新目录'):
        backup.restore_backup(saved, destination)
    assert (source / 'uploads/fixture.png').read_bytes() == b'fictional uploaded media'
