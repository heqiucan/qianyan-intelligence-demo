"""Verified SQLite backups and restore into a new directory only.

Only demo.sqlite3 and uploads are included. Configuration, environment files,
runtime locks and model credentials are never copied from the data directory.
"""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import time
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[1]
FORMAT_VERSION = 1
DATABASE = 'demo.sqlite3'


class BackupError(ValueError):
    pass


def separate(left, right):
    left, right = Path(left).resolve(), Path(right).resolve()
    if left == right or left in right.parents or right in left.parents:
        raise BackupError('源目录和目标目录必须分开，不能相同或相互嵌套。')


def forbidden(path):
    return any(part.casefold().startswith(('.env', 'credential', 'secret'))
               or part.casefold() in {'id_rsa', 'id_ed25519'}
               or Path(part).suffix.casefold() in {'.pem', '.key', '.pfx', '.p12'} for part in path.parts)


def safe_path(root, relative):
    if not isinstance(relative, str) or '\\' in relative or ':' in relative:
        raise BackupError('备份清单含不安全的文件路径。')
    path = PurePosixPath(relative)
    if path.is_absolute() or relative != path.as_posix() or any(part in {'.', '..'} for part in path.parts):
        raise BackupError('备份清单路径不能越过备份目录。')
    if relative != DATABASE and (not path.parts or path.parts[0] != 'uploads' or len(path.parts) < 2):
        raise BackupError('备份仅允许数据库及 uploads 文件。')
    if forbidden(path):
        raise BackupError('备份不能包含环境配置、凭据或私钥文件。')
    root = Path(root).resolve()
    target = root.joinpath(*path.parts)
    cursor = target
    while cursor != root:
        if cursor.is_symlink() or (hasattr(cursor, 'is_junction') and cursor.is_junction()):
            raise BackupError('备份不接受符号链接或目录联接。')
        cursor = cursor.parent
    if root not in target.resolve().parents:
        raise BackupError('备份文件路径越界。')
    return target


def file_hash(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def database_info(path):
    with closing(sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True, timeout=15)) as db:
        if [row[0] for row in db.execute('PRAGMA integrity_check')] != ['ok']:
            raise BackupError('SQLite 完整性检查未通过。')
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {'records', 'requests'} <= tables:
            raise BackupError('该数据库不是完整的 Demo 数据库。')
        migrations = [row[0] for row in db.execute('SELECT version FROM schema_migrations ORDER BY version')] if 'schema_migrations' in tables else []
        return {'sqlite_user_version': db.execute('PRAGMA user_version').fetchone()[0], 'schema_migrations': migrations}


def verify_backup(directory):
    directory = Path(directory).resolve()
    manifest_path = directory / 'manifest.json'
    if not manifest_path.is_file() or manifest_path.is_symlink() or manifest_path.stat().st_size > 5 * 1024 * 1024:
        raise BackupError('备份缺少有效的 manifest.json。')
    try:
        manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (ValueError, UnicodeError) as error:
        raise BackupError('备份清单无法读取。') from error
    if not isinstance(manifest, dict) or manifest.get('format_version') != FORMAT_VERSION or manifest.get('complete') is not True:
        raise BackupError('备份格式不支持或备份尚未完成。')
    entries = manifest.get('files')
    if not isinstance(entries, list) or not entries or len(entries) > 100_000:
        raise BackupError('备份文件清单无效。')
    names = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise BackupError('备份文件条目无效。')
        relative = entry.get('path')
        path = safe_path(directory, relative)
        if relative.casefold() in names:
            raise BackupError('备份清单含重复文件。')
        names.add(relative.casefold())
        if not path.is_file() or path.stat().st_size != entry.get('bytes') or file_hash(path) != entry.get('sha256'):
            raise BackupError(f'备份文件缺失或校验失败：{relative}')
    actual = set()
    for path in directory.rglob('*'):
        relative = path.relative_to(directory).as_posix()
        if path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction()):
            raise BackupError('备份不接受符号链接或目录联接。')
        if not path.is_dir():
            actual.add(relative.casefold())
    if actual != names | {'manifest.json'} or DATABASE not in names:
        raise BackupError('实际文件与备份清单不一致，或缺少数据库。')
    info = database_info(directory / DATABASE)
    if manifest.get('database') != info:
        raise BackupError('数据库版本与备份清单不一致。')
    return manifest


def create_backup(source, output):
    source, output = Path(source).resolve(), Path(output).resolve()
    separate(source, output)
    original_db = safe_path(source, DATABASE)
    if not original_db.is_file():
        raise BackupError('源目录没有 demo.sqlite3，未创建空数据库。')
    uploads = source / 'uploads'
    if uploads.is_symlink() or (hasattr(uploads, 'is_junction') and uploads.is_junction()):
        raise BackupError('uploads 不能是符号链接或目录联接。')
    if uploads.exists():
        if not uploads.is_dir():
            raise BackupError('uploads 不是目录。')
    output.mkdir(parents=True, exist_ok=True)
    token = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid4().hex[:12]
    partial = output / ('.partial-' + token)
    final = output / ('demo-backup-' + token)
    partial.mkdir()
    try:
        started = time.monotonic()
        def bounded_copy(status, remaining, total):
            if time.monotonic() - started > 60:
                raise BackupError('在线数据库备份超过 60 秒，请稍后重试。')
        with closing(sqlite3.connect(original_db.as_uri() + '?mode=ro', uri=True, timeout=15)) as origin:
            with closing(sqlite3.connect(partial / DATABASE)) as target:
                origin.backup(target, pages=128, progress=bounded_copy, sleep=.05)
                target.execute('PRAGMA journal_mode=DELETE')
        (partial / 'uploads').mkdir()
        # Enumerate after the DB snapshot: uploads are written before a saved
        # record can reference them. A concurrently created later file is safe
        # to include, but a snapshot-referenced file must not be missed.
        upload_files = []
        if uploads.exists():
            for item in uploads.rglob('*'):
                relative = item.relative_to(source).as_posix()
                checked = safe_path(source, relative)
                if checked.is_file():
                    upload_files.append((relative, checked))
        for relative, original in upload_files:
            target = safe_path(partial, relative)
            target.parent.mkdir(parents=True, exist_ok=True)
            before = file_hash(original)
            shutil.copy2(original, target)
            if before != file_hash(target) or before != file_hash(original):
                raise BackupError(f'备份时上传文件发生变化，请重新备份：{relative}')
        info = database_info(partial / DATABASE)
        try:
            app_version = json.loads((ROOT / 'frontend/package.json').read_text(encoding='utf-8'))['version']
        except (OSError, ValueError, KeyError):
            app_version = 'unknown'
        files = [path for path in partial.rglob('*') if path.is_file()]
        manifest = {'format_version': FORMAT_VERSION, 'complete': True, 'app_version': app_version,
            'created_at': datetime.now(timezone.utc).isoformat(), 'database': info,
            'files': [{'path': path.relative_to(partial).as_posix(), 'bytes': path.stat().st_size,
                       'sha256': file_hash(path)} for path in sorted(files)],
            'scope': 'SQLite online snapshot plus stable uploads; configuration and credentials excluded'}
        (partial / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        verify_backup(partial)
        if final.exists():
            raise BackupError('备份目录意外重名，未覆盖。')
        partial.rename(final)
        return final
    except Exception as error:
        # Keep a clearly named incomplete directory for diagnosis. Never publish
        # it as a successful backup, and never recursively remove user paths.
        if (partial / 'manifest.json').is_file():
            (partial / 'manifest.json').unlink()
        raise BackupError(f'备份失败，未生成正式备份；不完整目录：{partial}；原因：{error}') from error


def restore_backup(backup, destination):
    backup, destination = Path(backup).resolve(), Path(destination).resolve()
    separate(backup, destination)
    if destination.exists():
        raise BackupError('恢复目标必须是不存在的新目录，不能覆盖原 data 或任何已有目录。')
    manifest = verify_backup(backup)
    if not destination.parent.is_dir():
        raise BackupError('恢复目标的父目录不存在，请先创建父目录。')
    # Exclusive mkdir closes the overwrite race. Only this newly created
    # directory receives writes; a failed restore stays visibly incomplete.
    destination.mkdir(exist_ok=False)
    marker = destination / '.restore-incomplete'
    marker.write_text('Restore has not passed verification.', encoding='utf-8')
    try:
        (destination / 'uploads').mkdir()
        for entry in manifest['files']:
            source = safe_path(backup, entry['path'])
            target = safe_path(destination, entry['path'])
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        shutil.copy2(backup / 'manifest.json', destination / 'manifest.json')
        marker.unlink()
        verify_backup(destination)
        return destination
    except Exception as error:
        marker.write_text('Restore failed verification. Do not start the demo here.', encoding='utf-8')
        raise BackupError(f'恢复失败；新目录保留为未完成状态，未触碰原数据：{destination}；原因：{error}') from error


def main():
    parser = argparse.ArgumentParser(description='备份 Demo SQLite 和 uploads；仅恢复到不存在的新目录')
    commands = parser.add_subparsers(dest='action', required=True)
    backup = commands.add_parser('backup', help='在线一致备份数据库和上传文件')
    backup.add_argument('--source', type=Path, default=ROOT / 'data')
    backup.add_argument('--output', type=Path, default=ROOT / 'tmp/backups')
    verify = commands.add_parser('verify', help='核验文件哈希和 SQLite 完整性')
    verify.add_argument('directory', type=Path)
    restore = commands.add_parser('restore', help='恢复到新目录，不启动服务')
    restore.add_argument('directory', type=Path)
    restore.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action == 'backup':
            print('备份成功并通过校验：' + str(create_backup(args.source, args.output)))
        elif args.action == 'verify':
            manifest = verify_backup(args.directory)
            print(f'备份校验通过，共 {len(manifest["files"])} 个文件。')
        else:
            print('已恢复并通过校验，尚未启动服务：' + str(restore_backup(args.directory, args.destination)))
        return 0
    except (BackupError, OSError, sqlite3.Error) as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
