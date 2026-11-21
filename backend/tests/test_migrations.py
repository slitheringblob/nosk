"""Alembic migrations match the models and round-trip cleanly."""

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def _alembic(db_url: str, *args: str) -> subprocess.CompletedProcess:
    env = {**os.environ, "DATABASE_URL": db_url}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_upgrade_check_and_downgrade(tmp_path: Path) -> None:
    url = f"sqlite+aiosqlite:///{tmp_path / 'migrate.db'}"
    for args in (["upgrade", "head"], ["check"], ["downgrade", "base"], ["upgrade", "head"]):
        result = _alembic(url, *args)
        assert result.returncode == 0, result.stderr


def test_template_origin_backfill(tmp_path: Path) -> None:
    import sqlite3

    db_path = tmp_path / "backfill.db"
    url = f"sqlite+aiosqlite:///{db_path}"
    assert _alembic(url, "upgrade", "0003_journal_and_settings").returncode == 0
    db = sqlite3.connect(db_path)
    db.execute(
        "insert into users (id, email, password_hash, created_at, is_active, is_verified, settings) "
        "values ('u', 'u@example.com', 'x', 1, 1, 0, '{}')"
    )
    for page_id, title, is_template in [
        ("a", "Daily journal", 0),
        ("b", "Reading list", 1),
        ("c", "Notes", 0),
    ]:
        db.execute(
            "insert into pages (id, user_id, title, component_ids, created_at, updated_at, version, "
            "deleted, tags, is_template) values (?, 'u', ?, '[]', 1, 1, 0, 0, '[]', ?)",
            (page_id, title, is_template),
        )
    db.commit()
    db.close()
    assert _alembic(url, "upgrade", "head").returncode == 0
    rows = dict(sqlite3.connect(db_path).execute("select id, template_id from pages").fetchall())
    assert rows == {"a": "builtin-daily-journal", "b": None, "c": None}
