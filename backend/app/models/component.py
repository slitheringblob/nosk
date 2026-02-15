"""Component model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import BigInteger, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:  # pragma: no cover
    from app.models.page import Page


def current_timestamp() -> int:
    return int(datetime.utcnow().timestamp() * 1000)


class Component(Base):
    __tablename__ = "components"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(50))
    content: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[int] = mapped_column(BigInteger, default=current_timestamp)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=current_timestamp, onupdate=current_timestamp)
    order: Mapped[int] = mapped_column(Integer, default=0)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)

    page: Mapped["Page"] = relationship("Page", back_populates="components")
