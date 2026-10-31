"""Password hashing, JWT handling and opaque token helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.config import settings

BCRYPT_ROUNDS = 12


class TokenError(Exception):
    """Raised when a token is malformed, expired, or of the wrong type."""


def _prehash(password: str) -> bytes:
    # bcrypt only looks at the first 72 bytes; pre-hashing keeps long passphrases fully significant.
    digest = hashlib.sha256(password.encode("utf-8")).digest()
    return base64.b64encode(digest)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_prehash(password), bcrypt.gensalt(BCRYPT_ROUNDS)).decode("ascii")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_prehash(password), password_hash.encode("ascii"))
    except ValueError:
        return False


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def hash_opaque_token(token: str) -> str:
    # Refresh tokens carry 384 bits of entropy, so a keyed SHA-256 is sufficient and lets us
    # compare in constant time without bcrypt's per-request cost.
    return hmac.new(settings.secret_key.encode(), token.encode(), hashlib.sha256).hexdigest()


def tokens_match(token: str, token_hash: str) -> bool:
    return hmac.compare_digest(hash_opaque_token(token), token_hash)


def generate_device_id() -> str:
    return f"device-{secrets.token_hex(8)}"


def password_fingerprint(password_hash: str) -> str:
    """Short digest of the current password hash; changes whenever the password changes."""

    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


def create_token(token_type: str, subject: str, expires_minutes: int, **claims: Any) -> str:
    issued = datetime.now(timezone.utc)
    payload = {
        "sub": subject,
        "type": token_type,
        "iat": int(issued.timestamp()),
        "exp": int((issued + timedelta(minutes=expires_minutes)).timestamp()),
        **claims,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise TokenError(str(exc)) from exc
    if payload.get("type") != expected_type or not payload.get("sub"):
        raise TokenError("Unexpected token type")
    return payload


def create_access_token(user_id: str, session_id: str, device_id: str) -> str:
    return create_token(
        "access", user_id, settings.access_token_expire_minutes, sid=session_id, did=device_id
    )
