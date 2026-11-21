"""Shared FastAPI dependencies."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models import User, UserSession
from app.services.auth_service import ClientInfo
from app.services.oplog import Actor
from app.utils.errors import AuthenticationFailed
from app.utils.security import TokenError, decode_token

bearer = HTTPBearer(auto_error=False)
SessionDep = Annotated[AsyncSession, Depends(get_session)]


@dataclass
class AuthContext:
    user: User
    session: UserSession

    @property
    def device_id(self) -> str:
        return self.session.device_id

    def actor(self) -> Actor:
        return Actor(user_id=self.user.id, device_id=self.session.device_id)


async def authenticate_token(db: AsyncSession, token: str) -> AuthContext:
    try:
        payload = decode_token(token, "access")
    except TokenError as exc:
        raise AuthenticationFailed("Invalid or expired token") from exc
    user_session = await db.get(UserSession, payload.get("sid"))
    if user_session is None or user_session.revoked_at is not None:
        raise AuthenticationFailed("Session has been revoked")
    user = await db.get(User, payload["sub"])
    if user is None or not user.is_active or user_session.user_id != user.id:
        raise AuthenticationFailed("Account not found or disabled")
    return AuthContext(user=user, session=user_session)


async def get_auth(
    db: SessionDep,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> AuthContext:
    if credentials is None:
        raise AuthenticationFailed("Not authenticated")
    return await authenticate_token(db, credentials.credentials)


AuthDep = Annotated[AuthContext, Depends(get_auth)]


def client_info(request: Request) -> ClientInfo:
    # Behind a proxy, run uvicorn with --proxy-headers so request.client reflects the real peer.
    ip = request.client.host if request.client else None
    return ClientInfo(
        ip_address=(ip or "")[:45] or None, user_agent=request.headers.get("user-agent")
    )
