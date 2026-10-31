"""Page model."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import BigInteger, Boolean, ForeignKey, Index, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils.time import now_ms

if TYPE_CHECKING:  # pragma: no cover
    from app.models.component import Component
    from app.models.page_share import PageShare
    from app.models.user import User


class Page(Base):
    __tablename__ = "pages"
    __table_args__ = (
        Index("ix_pages_deleted", "deleted"),
        Index("ix_pages_updated_at", "updated_at"),
        Index("ix_pages_user_deleted", "user_id", "deleted"),
        # One journal entry per user per day (NULLs don't collide, so normal pages are unaffected).
        Index("uq_pages_user_journal_date", "user_id", "journal_date", unique=True),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    # Canonical flat ordering of every component on the page. Nesting comes from
    # Component.parent_id; siblings render in the order they appear here.
    component_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    updated_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)
    version: Mapped[int] = mapped_column(Integer, default=0)
    deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    icon: Mapped[str | None] = mapped_column(String(10), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_template: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set on daily journal pages (YYYY-MM-DD in the user's local calendar); never changes.
    journal_date: Mapped[str | None] = mapped_column(String(10), nullable=True)
    # Template this page was made from: a built-in id ("builtin-…") or a template page's id.
    # The sidebar groups pages under their template.
    template_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="pages")
    components: Mapped[list["Component"]] = relationship(
        "Component", back_populates="page", cascade="all, delete-orphan", order_by="Component.order"
    )
    shares: Mapped[list["PageShare"]] = relationship(
        "PageShare", back_populates="page", cascade="all, delete-orphan"
    )
