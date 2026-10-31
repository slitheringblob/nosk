"""WebSocket live channel tests."""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from tests.conftest import User, make_page


def test_rejects_bad_auth(client: TestClient) -> None:
    with client.websocket_connect("/api/sync/live") as ws:
        ws.send_json({"type": "auth", "token": "bad"})
        with pytest.raises(WebSocketDisconnect) as exc:
            ws.receive_json()
        assert exc.value.code == 4401


def test_notifies_other_devices_and_presence(client: TestClient, alice: User) -> None:
    phone = alice.second_device()
    page = make_page(alice)
    with client.websocket_connect("/api/sync/live") as ws:
        ws.send_json({"type": "auth", "token": phone.data["access_token"]})
        assert ws.receive_json() == {"type": "ready", "device_id": phone.device_id}

        ws.send_json({"type": "ping"})
        assert ws.receive_json() == {"type": "pong"}

        ws.send_json({"type": "presence", "page_id": page["id"]})
        presence = ws.receive_json()
        assert presence["type"] == "presence"
        assert presence["viewers"][0]["device_id"] == phone.device_id

        alice.put(f"/api/pages/{page['id']}", {"title": "Changed"})
        assert ws.receive_json()["type"] == "changes"


def test_presence_requires_page_access(client: TestClient, alice: User, bob: User) -> None:
    page = make_page(alice)
    with client.websocket_connect("/api/sync/live") as ws:
        ws.send_json({"type": "auth", "token": bob.data["access_token"]})
        ws.receive_json()
        ws.send_json({"type": "presence", "page_id": page["id"]})
        ws.send_json({"type": "ping"})
        # No presence broadcast for a page bob can't see; the next message is the pong.
        assert ws.receive_json() == {"type": "pong"}
