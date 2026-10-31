"""Comments attached to a page or one of its components."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.utils.time import now_ms


class Comment(Base):
    __tablename__ = "comments"
    __table_args__ = (Index("ix_comments_page_component", "page_id", "component_id"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    component_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    body: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
