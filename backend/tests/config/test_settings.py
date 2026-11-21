"""Settings tests."""

from app.config import Settings


def test_sync_database_url_converts_sqlite_driver() -> None:
    settings = Settings(DATABASE_URL="sqlite+aiosqlite:///./test.db")

    assert settings.sync_database_url == "sqlite:///./test.db"


def test_sync_database_url_converts_postgres_driver() -> None:
    settings = Settings(DATABASE_URL="postgresql+asyncpg://user:pass@localhost/nosk")

    assert settings.sync_database_url == "postgresql://user:pass@localhost/nosk"
