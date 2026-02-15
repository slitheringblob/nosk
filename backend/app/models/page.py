"""Page model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:  # pragma: no cover
    from app.models.component import Component
    from app.models.sync_operation import SyncOperation
    from app.models.user import User


def current_timestamp() -> int:
    return int(datetime.utcnow().timestamp() * 1000)


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    component_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[int] = mapped_column(BigInteger, default=current_timestamp)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=current_timestamp, onupdate=current_timestamp)
    version: Mapped[int] = mapped_column(Integer, default=0)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    icon: Mapped[str | None] = mapped_column(String(10), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="pages")
    components: Mapped[list["Component"]] = relationship(
        "Component", back_populates="page", cascade="all, delete-orphan", order_by="Component.order"
    )
    operations: Mapped[list["SyncOperation"]] = relationship(
        "SyncOperation", back_populates="page", cascade="all, delete-orphan"
    )
