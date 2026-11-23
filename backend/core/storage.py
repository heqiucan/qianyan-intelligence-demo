"""SQLite connections and records; application schema and seeds live in main."""
from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3

from fastapi import HTTPException


class SQLiteStore:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.path = self.directory / "demo.sqlite3"

    @contextmanager
    def read(self):
        """Read snapshots never claim the single SQLite writer slot."""
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute('PRAGMA query_only=ON')
            connection.execute('BEGIN')
            yield connection
        finally:
            connection.rollback()
            connection.close()

    @contextmanager
    def transaction(self):
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        try:
            connection.execute("PRAGMA busy_timeout=15000")
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()


def put(db, collection, record):
    db.execute("INSERT INTO records(collection,id,data) VALUES (?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data", (collection, record["id"], json.dumps(record, ensure_ascii=False)))
    return record


def all_records(db, collection):
    return [json.loads(x[0]) for x in db.execute("SELECT data FROM records WHERE collection=? ORDER BY rowid", (collection,))]


def get(db, collection, record_id):
    row = db.execute("SELECT data FROM records WHERE collection=? AND id=?", (collection, record_id)).fetchone()
    if not row:
        raise HTTPException(404, "找不到对应记录。")
    return json.loads(row[0])
