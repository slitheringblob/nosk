"""In-process pub/sub that pushes change notifications and presence over WebSockets.

The hub is per-process. Running several API workers needs a shared broker (e.g. Redis pub/sub)
in front of `publish`; clients also poll, so a missed notification only delays sync.
"""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass, field
from typing import Any

from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

NOTIFY_KEY = "nosk_notify_users"


@dataclass(eq=False)
class Connection:
    websocket: WebSocket
    user_id: str
    email: str
    device_id: str
    page_id: str | None = None
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    async def send(self, message: dict[str, Any]) -> None:
        async with self.send_lock:
            with contextlib.suppress(Exception):
                await self.websocket.send_json(message)


class Hub:
    def __init__(self) -> None:
        self.connections: dict[str, set[Connection]] = {}

    def add(self, connection: Connection) -> None:
        self.connections.setdefault(connection.user_id, set()).add(connection)

    def remove(self, connection: Connection) -> None:
        user_connections = self.connections.get(connection.user_id)
        if user_connections:
            user_connections.discard(connection)
            if not user_connections:
                del self.connections[connection.user_id]

    def all_connections(self) -> list[Connection]:
        return [conn for conns in self.connections.values() for conn in conns]

    async def publish(self, user_ids: set[str], message: dict[str, Any]) -> None:
        targets = [conn for uid in user_ids for conn in self.connections.get(uid, ())]
        await asyncio.gather(*(conn.send(message) for conn in targets))

    def viewers(self, page_id: str) -> list[dict[str, str]]:
        return [
            {"user_id": conn.user_id, "email": conn.email, "device_id": conn.device_id}
            for conn in self.all_connections()
            if conn.page_id == page_id
        ]


hub = Hub()


def queue_notification(session: AsyncSession, user_ids: set[str]) -> None:
    session.info.setdefault(NOTIFY_KEY, set()).update(user_ids)


async def commit_and_publish(session: AsyncSession, cursor: int | None = None) -> None:
    """Commit, then tell every affected user's open sockets that new changes exist."""

    await session.commit()
    user_ids: set[str] = session.info.pop(NOTIFY_KEY, set())
    if user_ids:
        await hub.publish(user_ids, {"type": "changes", "cursor": cursor})


def discard_notifications(session: AsyncSession) -> None:
    session.info.pop(NOTIFY_KEY, None)
