"""Authentication API tests."""

import re

from fastapi.testclient import TestClient

from app.services import email_service
from tests.conftest import PASSWORD, User, register


def _token_from_outbox(kind: str) -> str:
    body = email_service.outbox[-1].get_content()
    match = re.search(rf"{kind}=([\w.\-]+)", body)
    assert match, body
    return match.group(1)


def test_register_returns_tokens_and_user(client: TestClient) -> None:
    user = register(client, "New@Example.com")
    assert user.email == "new@example.com"
    assert user.data["token_type"] == "bearer"
    assert user.data["expires_in"] == 900
    assert user.device_id.startswith("device-")
    assert user.data["user"]["is_verified"] is False


def test_register_rejects_duplicates_case_insensitively(client: TestClient, alice: User) -> None:
    response = client.post(
        "/api/auth/register", json={"email": "ALICE@example.com", "password": PASSWORD}
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "CONFLICT"


def test_register_validates_password_length(client: TestClient) -> None:
    response = client.post(
        "/api/auth/register", json={"email": "x@example.com", "password": "short"}
    )
    assert response.status_code == 422
    body = response.json()["error"]
    assert body["code"] == "VALIDATION_ERROR"
    assert body["details"][0]["field"] == "password"


def test_login_and_wrong_password(client: TestClient, alice: User) -> None:
    assert (
        client.post(
            "/api/auth/login", json={"email": alice.email, "password": PASSWORD}
        ).status_code
        == 200
    )
    bad = client.post("/api/auth/login", json={"email": alice.email, "password": "wrong-password"})
    assert bad.status_code == 401
    unknown = client.post(
        "/api/auth/login", json={"email": "nobody@example.com", "password": "x" * 8}
    )
    assert unknown.status_code == 401


def test_protected_routes_require_token(client: TestClient) -> None:
    assert client.get("/api/pages").status_code == 401
    bad = client.get("/api/pages", headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401
    assert bad.json()["error"]["code"] == "AUTHENTICATION_ERROR"


def test_verify_and_me(alice: User) -> None:
    assert alice.get("/api/auth/verify").json() == {
        "valid": True,
        "user_id": alice.id,
        "email": alice.email,
    }
    assert alice.get("/api/auth/me").json()["email"] == alice.email


def test_refresh_rotates_token(client: TestClient, alice: User) -> None:
    body = {"refresh_token": alice.data["refresh_token"], "device_id": alice.device_id}
    first = client.post("/api/auth/refresh", json=body)
    assert first.status_code == 200
    assert first.json()["refresh_token"] != alice.data["refresh_token"]
    # The old refresh token is now spent.
    assert client.post("/api/auth/refresh", json=body).status_code == 401
    new_headers = {"Authorization": f"Bearer {first.json()['access_token']}"}
    assert client.get("/api/auth/verify", headers=new_headers).status_code == 200


def test_logout_revokes_access_and_refresh(client: TestClient, alice: User) -> None:
    response = alice.post("/api/auth/logout")
    assert response.json() == {"message": "Logged out successfully", "device_id": alice.device_id}
    assert alice.get("/api/auth/verify").status_code == 401
    refresh = client.post(
        "/api/auth/refresh",
        json={"refresh_token": alice.data["refresh_token"], "device_id": alice.device_id},
    )
    assert refresh.status_code == 401


def test_login_with_existing_device_reuses_session(client: TestClient, alice: User) -> None:
    response = client.post(
        "/api/auth/login",
        json={"email": alice.email, "password": PASSWORD, "device_id": alice.device_id},
    )
    assert response.json()["device_id"] == alice.device_id
    sessions = alice.second_device().get("/api/auth/sessions").json()["sessions"]
    assert len(sessions) == 2


def test_list_and_revoke_sessions(alice: User) -> None:
    phone = alice.second_device("Phone")
    sessions = alice.get("/api/auth/sessions").json()["sessions"]
    assert {s["device_name"] for s in sessions} == {"Laptop", "Phone"}
    assert sum(s["current"] for s in sessions) == 1
    phone_session = next(s for s in sessions if s["device_name"] == "Phone")
    assert alice.delete(f"/api/auth/sessions/{phone_session['session_id']}").status_code == 200
    assert phone.get("/api/auth/verify").status_code == 401
    assert alice.delete(f"/api/auth/sessions/{phone_session['session_id']}").status_code == 404


def test_cannot_revoke_another_users_session(alice: User, bob: User) -> None:
    bob_session = bob.get("/api/auth/sessions").json()["sessions"][0]["session_id"]
    assert alice.delete(f"/api/auth/sessions/{bob_session}").status_code == 404


def test_email_verification_flow(client: TestClient) -> None:
    user = register(client, "verify@example.com")
    token = _token_from_outbox("verify")
    response = client.post("/api/auth/verify-email", json={"token": token})
    assert response.status_code == 200
    assert user.get("/api/auth/me").json()["is_verified"] is True
    assert client.post("/api/auth/verify-email", json={"token": token}).status_code == 400
    assert client.post("/api/auth/verify-email", json={"token": "garbage"}).status_code == 400


def test_request_verification_does_not_leak_accounts(client: TestClient) -> None:
    response = client.post("/api/auth/request-verification", json={"email": "ghost@example.com"})
    assert response.status_code == 200
    assert email_service.outbox == []


def test_password_reset_flow(client: TestClient, alice: User) -> None:
    other_device = alice.second_device()
    client.post("/api/auth/request-password-reset", json={"email": alice.email})
    token = _token_from_outbox("reset")
    response = client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "brand-new-password"}
    )
    assert response.json() == {"message": "Password updated", "sessions_revoked": True}
    assert other_device.get("/api/auth/verify").status_code == 401
    assert (
        client.post(
            "/api/auth/login", json={"email": alice.email, "password": "brand-new-password"}
        ).status_code
        == 200
    )
    # Links are single-use because they're bound to the old password hash.
    again = client.post(
        "/api/auth/reset-password", json={"token": token, "new_password": "another-pass"}
    )
    assert again.status_code == 400


def test_change_password_keeps_current_session(client: TestClient, alice: User) -> None:
    other = alice.second_device()
    wrong = alice.post(
        "/api/auth/change-password",
        {"current_password": "nope-nope", "new_password": "fresh-password"},
    )
    assert wrong.status_code == 400
    ok = alice.post(
        "/api/auth/change-password",
        {"current_password": PASSWORD, "new_password": "fresh-password"},
    )
    assert ok.status_code == 200
    assert alice.get("/api/auth/verify").status_code == 200
    assert other.get("/api/auth/verify").status_code == 401
