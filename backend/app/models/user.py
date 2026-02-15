"""User model definition."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base

if TYPE_CHECKING:  # pragma: no cover
    from app.models.page import Page
    from app.models.user_session import UserSession
    from app.models.sync_operation import SyncOperation


def current_timestamp() -> int:
    return int(datetime.utcnow().timestamp() * 1000)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[int] = mapped_column(BigInteger, default=current_timestamp)
    last_login: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False)

    pages: Mapped[list["Page"]] = relationship("Page", back_populates="user", cascade="all, delete-orphan")
    sessions: Mapped[list["UserSession"]] = relationship(
        "UserSession", back_populates="user", cascade="all, delete-orphan"
    )
    operations: Mapped[list["SyncOperation"]] = relationship(
        "SyncOperation", back_populates="user", cascade="all, delete-orphan"
    )
