"""Auth schema tests."""

import app.models  # noqa: F401
from app.database import Base


def test_user_table_contains_auth_columns() -> None:
    users = Base.metadata.tables["users"]

    assert {"email", "password_hash", "last_login", "is_active", "is_verified"} <= set(
        users.columns.keys()
    )


def test_user_sessions_table_contains_refresh_token_columns() -> None:
    user_sessions = Base.metadata.tables["user_sessions"]

    assert {
        "user_id",
        "device_id",
        "refresh_token_hash",
        "expires_at",
        "revoked_at",
    } <= set(user_sessions.columns.keys())
