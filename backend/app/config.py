"""Application configuration using Pydantic settings."""

from __future__ import annotations

from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("backend/.env", ".env"), env_file_encoding="utf-8", extra="ignore"
    )

    app_name: str = Field("nosk", alias="APP_NAME")
    environment: str = Field("dev", alias="ENVIRONMENT")
    debug: bool = Field(True, alias="DEBUG")
    database_url: str = Field("sqlite+aiosqlite:///./nosk.db", alias="DATABASE_URL")
    secret_key: str = Field("dev-secret", alias="SECRET_KEY")
    access_token_expire_minutes: int = Field(15, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_minutes: int = Field(60 * 24 * 14, alias="REFRESH_TOKEN_EXPIRE_MINUTES")
    smtp_sender: str = Field("noreply@example.com", alias="SMTP_SENDER")
    smtp_host: str = Field("localhost", alias="SMTP_HOST")
    smtp_port: int = Field(1025, alias="SMTP_PORT")
    smtp_username: str | None = Field(None, alias="SMTP_USERNAME")
    smtp_password: str | None = Field(None, alias="SMTP_PASSWORD")
    frontend_origin: str = Field("http://localhost:3000", alias="FRONTEND_ORIGIN")

    @property
    def sync_database_url(self) -> str:
        """Return a synchronous URL for Alembic migrations."""

        url = str(self.database_url)
        if url.startswith("sqlite+aiosqlite"):
            return url.replace("sqlite+aiosqlite", "sqlite", 1)
        if url.startswith("postgresql+asyncpg"):
            return url.replace("postgresql+asyncpg", "postgresql", 1)
        return url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[arg-type]


settings = get_settings()
