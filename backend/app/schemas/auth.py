"""Authentication request/response schemas."""

from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, EmailStr, Field

Password = Annotated[str, Field(min_length=8, max_length=100)]
DeviceName = Annotated[str, Field(max_length=100)]
DeviceId = Annotated[str, Field(min_length=1, max_length=100, pattern=r"^[A-Za-z0-9_.:-]+$")]


class RegisterRequest(BaseModel):
    email: Annotated[EmailStr, Field(max_length=255)]
    password: Password
    device_name: DeviceName | None = None
    device_id: DeviceId | None = None


class LoginRequest(BaseModel):
    email: EmailStr
    password: Annotated[str, Field(max_length=100)]
    device_name: DeviceName | None = None
    device_id: DeviceId | None = None


class RefreshRequest(BaseModel):
    refresh_token: Annotated[str, Field(max_length=200)]
    device_id: DeviceId


class EmailRequest(BaseModel):
    email: EmailStr


class TokenRequest(BaseModel):
    token: Annotated[str, Field(max_length=2000)]


class ResetPasswordRequest(BaseModel):
    token: Annotated[str, Field(max_length=2000)]
    new_password: Password


class ChangePasswordRequest(BaseModel):
    current_password: Annotated[str, Field(max_length=100)]
    new_password: Password


class UserOut(BaseModel):
    id: str
    email: str
    created_at: int
    is_verified: bool


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    refresh_expires_in: int


class AuthResponse(TokenPair):
    device_id: str
    user: UserOut


class SessionOut(BaseModel):
    session_id: str
    device_id: str
    device_name: str | None
    issued_at: int
    expires_at: int
    last_used_at: int | None
    ip_address: str | None
    user_agent: str | None
    current: bool = False


class SettingsOut(BaseModel):
    journal_template_id: str | None
    journal_salt: str


class SettingsUpdate(BaseModel):
    # null means "start journal pages blank".
    journal_template_id: Annotated[str, Field(max_length=64)] | None = None


class SessionList(BaseModel):
    sessions: list[SessionOut]
