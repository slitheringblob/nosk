"""Rate limiting tests."""

import pytest
from fastapi.testclient import TestClient

from app.config import settings


def test_anonymous_requests_are_limited(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "rate_limit_enabled", True)
    monkeypatch.setattr(settings, "rate_limit_anonymous_per_minute", 3)
    for _ in range(3):
        response = client.post(
            "/api/auth/login", json={"email": "a@example.com", "password": "x" * 8}
        )
        assert response.status_code == 401
        assert "x-ratelimit-remaining" in response.headers
    limited = client.post("/api/auth/login", json={"email": "a@example.com", "password": "x" * 8})
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "RATE_LIMIT_EXCEEDED"
    assert "retry-after" in limited.headers
    # Health checks are exempt.
    assert client.get("/api/health").status_code == 200
