"""Pytest setup for backend tests."""

from __future__ import annotations

import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import create_engine as create_sync_engine
from sqlalchemy.ext.asyncio import async_sessionmaker
from sqlalchemy.pool import NullPool

ROOT = Path(__file__).resolve().parents[1]

if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402,F401
from app.api import sync as sync_api  # noqa: E402
from app.config import settings  # noqa: E402
from app.database import Base, create_engine, get_session  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services import email_service  # noqa: E402

PASSWORD = "correct-horse-battery"


@pytest.fixture(autouse=True)
def test_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "rate_limit_enabled", False)
    monkeypatch.setattr(settings, "media_root", str(tmp_path / "media"))
    monkeypatch.setattr(settings, "email_backend", "console")
    email_service.outbox.clear()


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    db_path = tmp_path / "test.db"
    sync_engine = create_sync_engine(f"sqlite:///{db_path}")
    Base.metadata.create_all(sync_engine)
    sync_engine.dispose()

    # NullPool: TestClient runs the app on its own event loop, so connections must not be reused
    # across loops.
    engine = create_engine(f"sqlite+aiosqlite:///{db_path}", poolclass=NullPool)
    factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_session():  # type: ignore[no-untyped-def]
        async with factory() as session:
            yield session

    monkeypatch.setattr(sync_api, "async_session_factory", factory)
    application = create_app()
    application.dependency_overrides[get_session] = override_session
    with TestClient(application) as test_client:
        yield test_client


class User:
    """A registered test user with one device session."""

    def __init__(self, client: TestClient, data: dict[str, Any], password: str) -> None:
        self.client = client
        self.data = data
        self.password = password

    @property
    def id(self) -> str:
        return self.data["user"]["id"]

    @property
    def email(self) -> str:
        return self.data["user"]["email"]

    @property
    def device_id(self) -> str:
        return self.data["device_id"]

    @property
    def headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.data['access_token']}"}

    def get(self, url: str, **kwargs: Any):  # type: ignore[no-untyped-def]
        return self.client.get(url, headers=self.headers, **kwargs)

    def post(self, url: str, json: Any = None, **kwargs: Any):  # type: ignore[no-untyped-def]
        return self.client.post(url, json=json, headers=self.headers, **kwargs)

    def put(self, url: str, json: Any = None, **kwargs: Any):  # type: ignore[no-untyped-def]
        return self.client.put(url, json=json, headers=self.headers, **kwargs)

    def delete(self, url: str, **kwargs: Any):  # type: ignore[no-untyped-def]
        return self.client.delete(url, headers=self.headers, **kwargs)

    def second_device(self, name: str = "Phone") -> "User":
        response = self.client.post(
            "/api/auth/login",
            json={"email": self.email, "password": self.password, "device_name": name},
        )
        assert response.status_code == 200, response.text
        return User(self.client, response.json(), self.password)


def register(client: TestClient, email: str = "alice@example.com") -> User:
    response = client.post(
        "/api/auth/register", json={"email": email, "password": PASSWORD, "device_name": "Laptop"}
    )
    assert response.status_code == 201, response.text
    return User(client, response.json(), PASSWORD)


@pytest.fixture
def alice(client: TestClient) -> User:
    return register(client, "alice@example.com")


@pytest.fixture
def bob(client: TestClient) -> User:
    return register(client, "bob@example.com")


def make_page(user: User, title: str = "Notes", **fields: Any) -> dict[str, Any]:
    response = user.post("/api/pages", {"title": title, **fields})
    assert response.status_code == 201, response.text
    return response.json()


def add_component(
    user: User, page_id: str, type_: str = "text-block", content: Any = None, **extra: Any
) -> dict[str, Any]:
    body = {"type": type_, "content": content if content is not None else {}, **extra}
    response = user.post(f"/api/pages/{page_id}/components", body)
    assert response.status_code == 201, response.text
    return response.json()
