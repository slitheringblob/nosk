"""Point-in-time copies of a page used for version history."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils.time import now_ms


class PageSnapshot(Base):
    __tablename__ = "page_snapshots"
    __table_args__ = (Index("ix_page_snapshots_page_created", "page_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    created_by: Mapped[str | None] = mapped_column(String(36), nullable=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_auto: Mapped[bool] = mapped_column(Boolean, default=False)
    title: Mapped[str] = mapped_column(String(200))
    # {"page": {...metadata}, "components": [...serialized components in order]}
    data: Mapped[dict] = mapped_column(JSON)
