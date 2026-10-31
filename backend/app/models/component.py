"""Component model."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import BigInteger, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils.time import now_ms

if TYPE_CHECKING:  # pragma: no cover
    from app.models.page import Page


class Component(Base):
    __tablename__ = "components"
    __table_args__ = (
        Index("ix_components_page_order", "page_id", "order"),
        Index("ix_components_type", "type"),
        Index("ix_components_updated_at", "updated_at"),
        Index("ix_components_parent_id", "parent_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(50))
    content: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    order: Mapped[int] = mapped_column(Integer, default=0)
    schema_version: Mapped[int] = mapped_column(Integer, default=1)
    # Container component (toggle/columns) this block lives in; None means top level.
    parent_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    # Which slot of the container (column index for `columns`, always 0 for `toggle`).
    slot: Mapped[int] = mapped_column(Integer, default=0)

    page: Mapped["Page"] = relationship("Page", back_populates="components")
