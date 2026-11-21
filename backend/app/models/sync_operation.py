"""Sync operation log model."""

from __future__ import annotations

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils.time import now_ms


class SyncOperation(Base):
    """Append-only change log. `id` doubles as the monotonically increasing sync cursor.

    `page_id` deliberately has no foreign key: the log must outlive permanently deleted pages so
    other devices still learn about the deletion.
    """

    __tablename__ = "sync_operations"
    __table_args__ = (
        Index("ix_sync_operation_id", "operation_id", unique=True),
        Index("ix_sync_user_timestamp", "user_id", "timestamp"),
        Index("ix_sync_page_version", "page_id", "page_version"),
        Index("ix_sync_entity", "entity_type", "entity_id"),
        Index("ix_sync_audience", "audience_user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(String(64))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    operation_type: Mapped[str] = mapped_column(String(50))
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str] = mapped_column(String(36))
    page_id: Mapped[str] = mapped_column(String(36), index=True)
    page_version: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    device_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    synced: Mapped[bool] = mapped_column(Boolean, default=False)
    # Extra recipient for ops that concern a user without page access (e.g. share revoked).
    audience_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
