"""Authentication endpoints."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Request, status

from app.api.deps import AuthDep, SessionDep, client_info
from app.schemas.auth import (
    AuthResponse,
    ChangePasswordRequest,
    EmailRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    ResetPasswordRequest,
    SessionList,
    SettingsOut,
    SettingsUpdate,
    TokenPair,
    TokenRequest,
    UserOut,
)
from app.services import auth_service, email_service
from app.services.auth_service import serialize_user

router = APIRouter(prefix="/auth", tags=["auth"])


def _auth_response(user, tokens) -> dict:  # type: ignore[no-untyped-def]
    return {
        **tokens.as_response(),
        "device_id": tokens.session.device_id,
        "user": serialize_user(user),
    }


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    body: RegisterRequest, request: Request, db: SessionDep, background: BackgroundTasks
) -> dict:
    user, tokens = await auth_service.register(
        db, body.email, body.password, body.device_id, body.device_name, client_info(request)
    )
    background.add_task(
        email_service.send_verification_email, user.email, auth_service.verification_token(user)
    )
    return _auth_response(user, tokens)


@router.post("/login", response_model=AuthResponse)
async def login(body: LoginRequest, request: Request, db: SessionDep) -> dict:
    user, tokens = await auth_service.login(
        db, body.email, body.password, body.device_id, body.device_name, client_info(request)
    )
    return _auth_response(user, tokens)


@router.post("/logout")
async def logout(auth: AuthDep, db: SessionDep) -> dict:
    await auth_service.revoke_session(db, auth.user.id, auth.session.id)
    return {"message": "Logged out successfully", "device_id": auth.device_id}


@router.get("/verify")
async def verify(auth: AuthDep) -> dict:
    return {"valid": True, "user_id": auth.user.id, "email": auth.user.email}


@router.get("/me", response_model=UserOut)
async def me(auth: AuthDep) -> dict:
    return serialize_user(auth.user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(body: RefreshRequest, db: SessionDep) -> dict:
    tokens = await auth_service.refresh(db, body.refresh_token, body.device_id)
    return tokens.as_response()


@router.post("/request-verification")
async def request_verification(
    body: EmailRequest, db: SessionDep, background: BackgroundTasks
) -> dict:
    user = await auth_service.get_user_by_email(db, body.email)
    if user is not None and not user.is_verified:
        background.add_task(
            email_service.send_verification_email, user.email, auth_service.verification_token(user)
        )
    # Same response either way so this can't be used to discover accounts.
    return {"message": "Verification email sent"}


@router.post("/verify-email")
async def verify_email(body: TokenRequest, db: SessionDep) -> dict:
    user = await auth_service.verify_email(db, body.token)
    return {"message": "Email verified", "user": {"id": user.id, "is_verified": True}}


@router.post("/request-password-reset")
async def request_password_reset(
    body: EmailRequest, db: SessionDep, background: BackgroundTasks
) -> dict:
    user = await auth_service.get_user_by_email(db, body.email)
    if user is not None and user.is_active:
        background.add_task(
            email_service.send_password_reset_email, user.email, auth_service.reset_token(user)
        )
    return {"message": "Password reset email sent"}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordRequest, db: SessionDep) -> dict:
    await auth_service.reset_password(db, body.token, body.new_password)
    return {"message": "Password updated", "sessions_revoked": True}


@router.post("/change-password")
async def change_password(body: ChangePasswordRequest, auth: AuthDep, db: SessionDep) -> dict:
    await auth_service.change_password(
        db, auth.user, auth.session.id, body.current_password, body.new_password
    )
    return {"message": "Password updated", "other_sessions_revoked": True}


@router.get("/sessions", response_model=SessionList)
async def sessions(auth: AuthDep, db: SessionDep) -> dict:
    rows = await auth_service.list_sessions(db, auth.user.id)
    return {
        "sessions": [
            {
                "session_id": s.id,
                "device_id": s.device_id,
                "device_name": s.device_name,
                "issued_at": s.issued_at,
                "expires_at": s.expires_at,
                "last_used_at": s.last_used_at,
                "ip_address": s.ip_address,
                "user_agent": s.user_agent,
                "current": s.id == auth.session.id,
            }
            for s in rows
        ]
    }


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: str, auth: AuthDep, db: SessionDep) -> dict:
    await auth_service.revoke_session(db, auth.user.id, session_id)
    return {"message": "Session revoked", "session_id": session_id}


@router.get("/settings", response_model=SettingsOut)
async def get_settings(auth: AuthDep, db: SessionDep) -> dict:
    return await auth_service.get_settings(db, auth.user)


@router.put("/settings", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, auth: AuthDep, db: SessionDep) -> dict:
    return await auth_service.update_settings(db, auth.user, body.model_dump(exclude_unset=True))
