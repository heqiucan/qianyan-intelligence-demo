"""Real SQLite behavior and compatibility checks for the storage extraction."""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys

from fastapi import HTTPException
import pytest

from backend.core.storage import SQLiteStore, all_records, get, put


@pytest.fixture
def store(tmp_path):
    instance = SQLiteStore(tmp_path)
    with instance.transaction() as db:
        db.execute("CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id))")
        db.execute("CREATE TABLE requests (scope TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(scope,request_id))")
    return instance


def test_committed_records_keep_scope_order_unicode_and_upsert_identity(store):
    first = {"id": "z-first", "name": "中文记录", "nested": {"missing": None, "zero": 0}}
    second = {"id": "a-second", "amount": 12.5}
    other = {"id": first["id"], "name": "另一集合"}
    with store.transaction() as db:
        assert put(db, "items", first) is first
        put(db, "items", second)
        put(db, "other", other)
        original_rowid = db.execute("SELECT rowid FROM records WHERE collection=? AND id=?", ("items", first["id"])).fetchone()[0]
    changed = {**first, "name": "更新后的记录", "version": 2}
    with store.transaction() as db:
        put(db, "items", changed)
    with store.read() as db:
        assert get(db, "items", first["id"]) == changed
        assert get(db, "other", first["id"]) == other
        assert all_records(db, "items") == [changed, second]
        assert all_records(db, "absent") == []
        row = db.execute("SELECT rowid,data FROM records WHERE collection=? AND id=?", ("items", first["id"])).fetchone()
        assert isinstance(row, sqlite3.Row)
        assert row["rowid"] == original_rowid
        assert row["data"] == json.dumps(changed, ensure_ascii=False)


def test_transaction_rolls_back_insert_update_delete_and_request_cache_together(store):
    original = {"id": "existing", "version": 1}
    removed = {"id": "to-delete", "version": 1}
    with store.transaction() as db:
        put(db, "items", original)
        put(db, "items", removed)
    failure = RuntimeError("abort after several SQL writes")
    with pytest.raises(RuntimeError) as caught:
        with store.transaction() as db:
            put(db, "items", {**original, "version": 2})
            put(db, "items", {"id": "new"})
            db.execute("DELETE FROM records WHERE collection=? AND id=?", ("items", removed["id"]))
            db.execute("INSERT INTO requests VALUES (?,?,?,?)", ("scope", "request", "fingerprint", "{}"))
            raise failure
    assert caught.value is failure
    with store.read() as db:
        assert all_records(db, "items") == [original, removed]
        assert db.execute("SELECT count(*) FROM requests").fetchone()[0] == 0
    with store.transaction() as db:
        put(db, "items", {"id": "retry"})
    with store.read() as db:
        assert get(db, "items", "retry") == {"id": "retry"}


def test_sqlite_constraint_failure_rolls_back_preceding_writes(store):
    with pytest.raises(sqlite3.IntegrityError):
        with store.transaction() as db:
            put(db, "items", {"id": "must-not-persist"})
            db.execute("INSERT INTO requests VALUES (?,?,?,?)", ("scope", "same-id", "first", "{}"))
            db.execute("INSERT INTO requests VALUES (?,?,?,?)", ("scope", "same-id", "second", "{}"))
    with store.read() as db:
        assert all_records(db, "items") == []
        assert db.execute("SELECT count(*) FROM requests").fetchone()[0] == 0


@pytest.mark.parametrize("operation", ["put", "update", "delete", "create_table", "drop_table"])
def test_read_rejects_record_and_schema_writes(store, operation):
    original = {"id": "existing", "value": 1}
    with store.transaction() as db:
        put(db, "items", original)
    statements = {
        "update": "UPDATE records SET data='{}'",
        "delete": "DELETE FROM records",
        "create_table": "CREATE TABLE forbidden (id INTEGER)",
        "drop_table": "DROP TABLE records",
    }
    with store.read() as db:
        assert get(db, "items", original["id"]) == original
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            if operation == "put":
                put(db, "items", {"id": "new"})
            else:
                db.execute(statements[operation])
    with store.read() as db:
        assert all_records(db, "items") == [original]
        assert not db.execute("SELECT 1 FROM sqlite_master WHERE name='forbidden'").fetchone()


@pytest.mark.parametrize("collection,record_id", [("items", "absent"), ("other", "existing")])
def test_get_missing_record_or_wrong_collection_preserves_404(store, collection, record_id):
    with store.transaction() as db:
        put(db, "items", {"id": "existing"})
    with store.read() as db:
        with pytest.raises(HTTPException) as caught:
            get(db, collection, record_id)
    assert caught.value.status_code == 404
    assert caught.value.detail == "找不到对应记录。"


def test_record_keys_remain_bound_sql_values(store):
    collection = "items' OR 1=1 --"
    record = {"id": "x'); DROP TABLE records; --", "value": "literal"}
    with store.transaction() as db:
        put(db, collection, record)
        put(db, "items", {"id": "ordinary"})
    with store.read() as db:
        assert get(db, collection, record["id"]) == record
        assert all_records(db, collection) == [record]
        assert all_records(db, "items") == [{"id": "ordinary"}]


@pytest.mark.parametrize("method", ["read", "transaction"])
@pytest.mark.parametrize("failed", [False, True])
def test_connections_close_after_success_or_exception(store, method, failed):
    class Abort(Exception):
        pass

    connection = None
    try:
        with getattr(store, method)() as connection:
            connection.execute("SELECT 1").fetchone()
            if failed:
                raise Abort()
    except Abort:
        assert failed
    assert connection is not None
    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connection.execute("SELECT 1")


def test_core_import_does_not_load_the_application_or_business_initializers():
    result = subprocess.run(
        [sys.executable, "-B", "-c", "import sys; import backend.core.storage; "
         "assert not {'backend.main', 'backend.v2', 'backend.knowledge', 'backend.model_adapter'}.intersection(sys.modules)"],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def test_main_exports_the_same_primitives_and_keeps_business_initialization(tmp_path):
    from backend import main

    assert main.put is put
    assert main.get is get
    assert main.all_records is all_records
    assert issubclass(main.Store, SQLiteStore)
    instance = main.Store(tmp_path / "app")
    assert instance.directory == (tmp_path / "app").resolve()
    assert instance.path == instance.directory / "demo.sqlite3"
    instance.initialize()
    assert (instance.directory / "uploads").is_dir()
    with instance.read() as db:
        assert get(db, "product", "product-demo")["price"] == 99
        assert len(all_records(db, "plans")) == 2
        assert db.execute("SELECT version FROM schema_migrations").fetchone()[0] == 1


def test_business_seed_failure_rolls_back_schema_and_records_and_can_retry(tmp_path, monkeypatch):
    from backend import main

    instance = main.Store(tmp_path)

    def failing_seed(db):
        put(db, "product", {"id": "partial-seed"})
        raise RuntimeError("seed failed")

    with monkeypatch.context() as patch:
        patch.setattr(main, "seed", failing_seed)
        with pytest.raises(RuntimeError, match="seed failed"):
            instance.initialize()
    with instance.read() as db:
        assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []
    instance.initialize()
    with instance.read() as db:
        assert [item["id"] for item in all_records(db, "product")] == ["product-demo"]
