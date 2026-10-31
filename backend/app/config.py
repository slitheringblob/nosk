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
    debug: bool = Field(False, alias="DEBUG")
    database_url: str = Field("sqlite+aiosqlite:///./nosk.db", alias="DATABASE_URL")
    secret_key: str = Field("dev-secret", alias="SECRET_KEY")
    jwt_algorithm: str = Field("HS256", alias="JWT_ALGORITHM")
    access_token_expire_minutes: int = Field(15, alias="ACCESS_TOKEN_EXPIRE_MINUTES")
    refresh_token_expire_minutes: int = Field(60 * 24 * 14, alias="REFRESH_TOKEN_EXPIRE_MINUTES")
    verify_token_expire_minutes: int = Field(60 * 48, alias="VERIFY_TOKEN_EXPIRE_MINUTES")
    reset_token_expire_minutes: int = Field(60, alias="RESET_TOKEN_EXPIRE_MINUTES")
    email_backend: str = Field("console", alias="EMAIL_BACKEND")
    smtp_sender: str = Field("noreply@example.com", alias="SMTP_SENDER")
    smtp_host: str = Field("localhost", alias="SMTP_HOST")
    smtp_port: int = Field(1025, alias="SMTP_PORT")
    smtp_username: str | None = Field(None, alias="SMTP_USERNAME")
    smtp_password: str | None = Field(None, alias="SMTP_PASSWORD")
    smtp_use_tls: bool = Field(False, alias="SMTP_USE_TLS")
    frontend_origin: str = Field(
        "http://localhost:3000,http://127.0.0.1:3000", alias="FRONTEND_ORIGIN"
    )
    media_root: str = Field("./media", alias="MEDIA_ROOT")
    max_upload_bytes: int = Field(10 * 1024 * 1024, alias="MAX_UPLOAD_BYTES")
    rate_limit_enabled: bool = Field(True, alias="RATE_LIMIT_ENABLED")
    rate_limit_anonymous_per_minute: int = Field(60, alias="RATE_LIMIT_ANONYMOUS_PER_MINUTE")
    rate_limit_authenticated_per_minute: int = Field(
        600, alias="RATE_LIMIT_AUTHENTICATED_PER_MINUTE"
    )
    snapshot_interval_minutes: int = Field(15, alias="SNAPSHOT_INTERVAL_MINUTES")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.frontend_origin.split(",") if origin.strip()]

    @property
    def primary_frontend_origin(self) -> str:
        """Origin used when building links in outgoing emails."""

        origins = self.cors_origins
        return origins[0] if origins else "http://localhost:3000"

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
