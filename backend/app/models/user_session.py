"""User session / refresh token tracking."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:  # pragma: no cover
    from app.models.user import User


def current_timestamp() -> int:
    return int(datetime.utcnow().timestamp() * 1000)


class UserSession(Base):
    __tablename__ = "user_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(String(100))
    device_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    refresh_token_hash: Mapped[str] = mapped_column(String(255))
    issued_at: Mapped[int] = mapped_column(BigInteger, default=current_timestamp)
    expires_at: Mapped[int] = mapped_column(BigInteger)
    last_used_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
    revoked_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    user: Mapped["User"] = relationship("User", back_populates="sessions")
