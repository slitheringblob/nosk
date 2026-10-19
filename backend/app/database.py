"""Database utilities and SQLAlchemy session management."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import Any

from sqlalchemy import MetaData, event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def _enable_sqlite_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
    # SQLite ignores ON DELETE CASCADE unless foreign keys are switched on per connection.
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def create_engine(url: str | None = None, **engine_options: Any) -> AsyncEngine:
    database_url = url or str(settings.database_url)
    # ensure_ascii=False keeps non-ASCII text searchable when JSON content is matched as text.
    async_engine = create_async_engine(
        database_url,
        echo=settings.debug,
        json_serializer=lambda value: json.dumps(value, ensure_ascii=False),
        **engine_options,
    )
    if database_url.startswith("sqlite"):
        event.listen(async_engine.sync_engine, "connect", _enable_sqlite_foreign_keys)
    return async_engine


engine = create_engine()
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
        finally:
            await session.close()
