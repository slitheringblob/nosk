"""Sync operation log model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:  # pragma: no cover
    from app.models.page import Page
    from app.models.user import User


def current_timestamp() -> int:
    return int(datetime.utcnow().timestamp() * 1000)


class SyncOperation(Base):
    __tablename__ = "sync_operations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    operation_id: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    operation_type: Mapped[str] = mapped_column(String(50))
    entity_type: Mapped[str] = mapped_column(String(50))
    entity_id: Mapped[str] = mapped_column(String(36))
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    page_version: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    timestamp: Mapped[int] = mapped_column(BigInteger, default=current_timestamp)
    device_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    synced: Mapped[bool] = mapped_column(Boolean, default=False)

    user: Mapped["User"] = relationship("User", back_populates="operations")
    page: Mapped["Page"] = relationship("Page", back_populates="operations")
