"""SQLite reads, version migration and process ownership safety."""
import sqlite3

import pytest

from backend.main import Store
from backend.runtime import InstanceLease


def test_read_can_snapshot_during_reserved_writer_and_cannot_write(tmp_path):
    store = Store(tmp_path)
    store.initialize()
    with store.transaction() as writer:
        writer.execute("UPDATE records SET data=data WHERE collection='product'")
        with store.read() as reader:
            assert reader.execute('SELECT count(*) FROM records').fetchone()[0] > 0
            with pytest.raises(sqlite3.OperationalError, match='readonly'):
                reader.execute('DELETE FROM records')


def test_migration_is_repeatable_and_query_uses_task_index(tmp_path):
    store = Store(tmp_path)
    store.initialize()
    with store.read() as db:
        before = db.execute('SELECT collection,id,data FROM records ORDER BY collection,id').fetchall()
    store.initialize()
    with store.read() as db:
        assert db.execute('SELECT count(*) FROM schema_migrations').fetchone()[0] == 1
        assert db.execute('SELECT collection,id,data FROM records ORDER BY collection,id').fetchall() == before
        plan = db.execute("EXPLAIN QUERY PLAN SELECT data FROM records WHERE collection='demand_results' AND json_extract(data,'$.task_id')=?", ('task-test',)).fetchall()
        assert any('records_task_idx' in row[3] for row in plan)


def test_data_directory_lease_blocks_duplicate_then_releases(tmp_path):
    first, second = InstanceLease(tmp_path), InstanceLease(tmp_path)
    first.acquire()
    try:
        with pytest.raises(RuntimeError, match='单 worker'):
            second.acquire()
    finally:
        first.release()
    second.acquire()
    second.release()
