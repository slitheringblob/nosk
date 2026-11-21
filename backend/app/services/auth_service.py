"""Accounts, device sessions and token lifecycle."""

from __future__ import annotations

import secrets
from dataclasses import dataclass

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Page, User, UserSession
from app.services.templates import get_builtin
from app.utils.errors import APIError, AuthenticationFailed, NotFound
from app.utils.security import (
    TokenError,
    create_access_token,
    create_token,
    decode_token,
    generate_device_id,
    generate_refresh_token,
    hash_opaque_token,
    hash_password,
    password_fingerprint,
    tokens_match,
    verify_password,
)
from app.utils.time import now_ms

# Compared against when the email is unknown so login timing doesn't reveal which emails exist.
_DUMMY_HASH = hash_password("timing-equaliser-password")


@dataclass
class IssuedTokens:
    access_token: str
    refresh_token: str
    session: UserSession

    def as_response(self) -> dict:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "token_type": "bearer",
            "expires_in": settings.access_token_expire_minutes * 60,
            "refresh_expires_in": settings.refresh_token_expire_minutes * 60,
        }


@dataclass
class ClientInfo:
    ip_address: str | None = None
    user_agent: str | None = None


def serialize_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "created_at": user.created_at,
        "is_verified": user.is_verified,
    }


def normalise_email(email: str) -> str:
    return email.strip().lower()


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    return await session.scalar(
        select(User).where(func.lower(User.email) == normalise_email(email))
    )


async def open_session(
    session: AsyncSession,
    user: User,
    device_id: str | None,
    device_name: str | None,
    client: ClientInfo,
) -> IssuedTokens:
    """Create or rotate the session for this device and issue a fresh token pair."""

    device_id = device_id or generate_device_id()
    refresh_token = generate_refresh_token()
    timestamp = now_ms()
    expires_at = timestamp + settings.refresh_token_expire_minutes * 60_000
    user_session = await session.scalar(
        select(UserSession).where(
            UserSession.user_id == user.id, UserSession.device_id == device_id
        )
    )
    if user_session is None:
        user_session = UserSession(user_id=user.id, device_id=device_id)
        session.add(user_session)
    user_session.device_name = device_name or user_session.device_name
    user_session.refresh_token_hash = hash_opaque_token(refresh_token)
    user_session.issued_at = timestamp
    user_session.expires_at = expires_at
    user_session.last_used_at = timestamp
    user_session.revoked_at = None
    user_session.ip_address = client.ip_address
    user_session.user_agent = (client.user_agent or "")[:500] or None
    await session.flush()
    access = create_access_token(user.id, user_session.id, device_id)
    return IssuedTokens(access, refresh_token, user_session)


async def register(
    session: AsyncSession,
    email: str,
    password: str,
    device_id: str | None,
    device_name: str | None,
    client: ClientInfo,
) -> tuple[User, IssuedTokens]:
    if await get_user_by_email(session, email) is not None:
        raise APIError(
            "Email already registered",
            [{"field": "email", "message": "Email is already registered"}],
            code="CONFLICT",
        )
    user = User(
        email=normalise_email(email),
        password_hash=hash_password(password),
        created_at=now_ms(),
        last_login=now_ms(),
    )
    session.add(user)
    await session.flush()
    tokens = await open_session(session, user, device_id, device_name, client)
    await session.commit()
    return user, tokens


async def login(
    session: AsyncSession,
    email: str,
    password: str,
    device_id: str | None,
    device_name: str | None,
    client: ClientInfo,
) -> tuple[User, IssuedTokens]:
    user = await get_user_by_email(session, email)
    if user is None:
        verify_password(password, _DUMMY_HASH)
        raise AuthenticationFailed("Invalid email or password")
    if not verify_password(password, user.password_hash) or not user.is_active:
        raise AuthenticationFailed("Invalid email or password")
    user.last_login = now_ms()
    tokens = await open_session(session, user, device_id, device_name, client)
    await session.commit()
    return user, tokens


async def refresh(session: AsyncSession, refresh_token: str, device_id: str) -> IssuedTokens:
    candidates = await session.scalars(
        select(UserSession).where(UserSession.device_id == device_id)
    )
    user_session = next(
        (s for s in candidates if tokens_match(refresh_token, s.refresh_token_hash)), None
    )
    if user_session is None:
        raise AuthenticationFailed("Invalid refresh token")
    if user_session.revoked_at is not None or user_session.expires_at < now_ms():
        raise AuthenticationFailed("Session expired or revoked")
    user = await session.get(User, user_session.user_id)
    if user is None or not user.is_active:
        raise AuthenticationFailed("Account disabled")

    new_refresh = generate_refresh_token()
    timestamp = now_ms()
    user_session.refresh_token_hash = hash_opaque_token(new_refresh)
    user_session.last_used_at = timestamp
    user_session.expires_at = timestamp + settings.refresh_token_expire_minutes * 60_000
    access = create_access_token(user.id, user_session.id, user_session.device_id)
    await session.commit()
    return IssuedTokens(access, new_refresh, user_session)


async def revoke_session(session: AsyncSession, user_id: str, session_id: str) -> UserSession:
    user_session = await session.get(UserSession, session_id)
    if user_session is None or user_session.user_id != user_id or user_session.revoked_at:
        raise NotFound("Session not found")
    user_session.revoked_at = now_ms()
    await session.commit()
    return user_session


async def list_sessions(session: AsyncSession, user_id: str) -> list[UserSession]:
    result = await session.scalars(
        select(UserSession)
        .where(
            UserSession.user_id == user_id,
            UserSession.revoked_at.is_(None),
            UserSession.expires_at > now_ms(),
        )
        .order_by(UserSession.last_used_at.desc())
    )
    return list(result)


async def revoke_all_sessions(
    session: AsyncSession, user_id: str, except_id: str | None = None
) -> None:
    query = update(UserSession).where(
        UserSession.user_id == user_id, UserSession.revoked_at.is_(None)
    )
    if except_id:
        query = query.where(UserSession.id != except_id)
    await session.execute(query.values(revoked_at=now_ms()))


def verification_token(user: User) -> str:
    return create_token("verify", user.id, settings.verify_token_expire_minutes, email=user.email)


def reset_token(user: User) -> str:
    return create_token(
        "reset",
        user.id,
        settings.reset_token_expire_minutes,
        pwd=password_fingerprint(user.password_hash),
    )


async def verify_email(session: AsyncSession, token: str) -> User:
    try:
        payload = decode_token(token, "verify")
    except TokenError as exc:
        raise APIError("Verification link is invalid or has expired") from exc
    user = await session.get(User, payload["sub"])
    if user is None or user.email != payload.get("email"):
        raise APIError("Verification link is invalid or has expired")
    if user.is_verified:
        raise APIError("Email is already verified")
    user.is_verified = True
    await session.commit()
    return user


async def reset_password(session: AsyncSession, token: str, new_password: str) -> None:
    try:
        payload = decode_token(token, "reset")
    except TokenError as exc:
        raise APIError("Reset link is invalid or has expired") from exc
    user = await session.get(User, payload["sub"])
    # The fingerprint changes as soon as the password does, making each link single-use.
    if user is None or payload.get("pwd") != password_fingerprint(user.password_hash):
        raise APIError("Reset link is invalid or has expired")
    user.password_hash = hash_password(new_password)
    await revoke_all_sessions(session, user.id)
    await session.commit()


async def change_password(
    session: AsyncSession, user: User, current_session_id: str, current: str, new: str
) -> None:
    if not verify_password(current, user.password_hash):
        raise APIError(
            "Current password is incorrect",
            [{"field": "current_password", "message": "Incorrect password"}],
        )
    user.password_hash = hash_password(new)
    await revoke_all_sessions(session, user.id, except_id=current_session_id)
    await session.commit()


DEFAULT_SETTINGS = {"journal_template_id": "builtin-daily-journal"}


async def get_settings(session: AsyncSession, user: User) -> dict:
    """User preferences with defaults filled in.

    `journal_salt` is a per-user secret mixed into journal page ids so devices agree on the id
    of a given day's page without anyone else (e.g. collaborators who see your user id) being
    able to predict it.
    """

    stored = dict(user.settings or {})
    if "journal_salt" not in stored:
        stored["journal_salt"] = secrets.token_hex(16)
        user.settings = stored
        await session.commit()
    return {**DEFAULT_SETTINGS, **stored}


async def update_settings(session: AsyncSession, user: User, changes: dict) -> dict:
    template_id = changes.get("journal_template_id")
    if (
        "journal_template_id" in changes
        and template_id is not None
        and not get_builtin(template_id)
    ):
        page = await session.get(Page, template_id)
        if page is None or page.user_id != user.id or not page.is_template or page.deleted:
            raise APIError(
                "Choose one of your templates or a built-in template",
                [{"field": "journal_template_id", "message": "Unknown template"}],
                status_code=422,
                code="VALIDATION_ERROR",
            )
    await get_settings(session, user)  # make sure the salt exists before merging
    user.settings = {**user.settings, **changes}
    await session.commit()
    return {**DEFAULT_SETTINGS, **user.settings}
