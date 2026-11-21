"""Page sharing between users."""

from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.utils.time import now_ms

if TYPE_CHECKING:  # pragma: no cover
    from app.models.page import Page
    from app.models.user import User

SHARE_ROLES = ("viewer", "editor")


class PageShare(Base):
    __tablename__ = "page_shares"
    __table_args__ = (Index("uq_page_shares_page_user", "page_id", "user_id", unique=True),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    page_id: Mapped[str] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(20), default="viewer")
    created_at: Mapped[int] = mapped_column(BigInteger, default=now_ms)

    page: Mapped["Page"] = relationship("Page", back_populates="shares")
    user: Mapped["User"] = relationship("User")
