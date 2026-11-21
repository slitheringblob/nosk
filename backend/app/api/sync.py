"""Sync endpoints and the live WebSocket channel."""

from __future__ import annotations

import asyncio
import contextlib
import time
from typing import Annotated

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.api.deps import AuthDep, SessionDep, authenticate_token
from app.database import async_session_factory
from app.schemas.sync import PullResponse, PushRequest, PushResponse, SyncStatus
from app.services import sync_service
from app.services.access import get_page
from app.services.realtime import Connection, hub
from app.utils.errors import APIError

router = APIRouter(prefix="/sync", tags=["sync"])

AUTH_TIMEOUT_SECONDS = 10
MAX_CLIENT_MESSAGES_PER_SECOND = 20


@router.get("/bootstrap")
async def bootstrap(auth: AuthDep, db: SessionDep) -> dict:
    data = await sync_service.bootstrap(db, auth.user.id)
    return {**data, "device_id": auth.device_id}


@router.get("/pull", response_model=PullResponse)
async def pull(
    auth: AuthDep,
    db: SessionDep,
    cursor: Annotated[int | None, Query(ge=0)] = None,
    since: Annotated[int | None, Query(ge=0)] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 500,
) -> dict:
    if cursor is None and since is None:
        raise APIError("Provide either cursor or since", status_code=422, code="VALIDATION_ERROR")
    return await sync_service.pull(db, auth.user.id, cursor, since, limit)


@router.post("/push", response_model=PushResponse)
async def push(body: PushRequest, auth: AuthDep, db: SessionDep) -> dict:
    return await sync_service.push(db, auth.user.id, auth.device_id, body.operations)


@router.get("/status", response_model=SyncStatus)
async def sync_status(
    auth: AuthDep, db: SessionDep, cursor: Annotated[int | None, Query(ge=0)] = None
) -> dict:
    return await sync_service.status(db, auth.user.id, auth.device_id, cursor)


async def _broadcast_presence(page_id: str | None) -> None:
    if not page_id:
        return
    # Only connections currently on the page can see it, so access was checked on join.
    targets = [conn for conn in hub.all_connections() if conn.page_id == page_id]
    message = {"type": "presence", "page_id": page_id, "viewers": hub.viewers(page_id)}
    await asyncio.gather(*(conn.send(message) for conn in targets))


@router.websocket("/live")
async def live(websocket: WebSocket) -> None:
    """Push channel. First client message must be {"type": "auth", "token": "<access token>"}.

    Server -> client: {"type": "changes", "cursor": n} (pull now), {"type": "presence", ...}.
    Client -> server: {"type": "presence", "page_id": "..."|null}, {"type": "ping"}.
    """

    await websocket.accept()
    try:
        message = await asyncio.wait_for(websocket.receive_json(), AUTH_TIMEOUT_SECONDS)
        if message.get("type") != "auth":
            raise ValueError("auth required")
        async with async_session_factory() as db:
            auth = await authenticate_token(db, str(message.get("token", "")))
            user_id, email, device_id = auth.user.id, auth.user.email, auth.device_id
    except (asyncio.TimeoutError, ValueError, APIError, WebSocketDisconnect, KeyError, TypeError):
        with contextlib.suppress(Exception):
            await websocket.close(code=4401)
        return

    connection = Connection(websocket=websocket, user_id=user_id, email=email, device_id=device_id)
    hub.add(connection)
    await connection.send({"type": "ready", "device_id": device_id})
    window_start, window_count = time.monotonic(), 0
    try:
        while True:
            message = await websocket.receive_json()
            now = time.monotonic()
            if now - window_start >= 1:
                window_start, window_count = now, 0
            window_count += 1
            if window_count > MAX_CLIENT_MESSAGES_PER_SECOND:
                continue  # Drop floods rather than disconnecting a misbehaving tab.
            kind = message.get("type") if isinstance(message, dict) else None
            if kind == "ping":
                await connection.send({"type": "pong"})
            elif kind == "presence":
                await _update_presence(connection, message.get("page_id"))
    except (WebSocketDisconnect, ValueError, RuntimeError):
        pass
    finally:
        hub.remove(connection)
        await _broadcast_presence(connection.page_id)


async def _update_presence(connection: Connection, page_id: object) -> None:
    previous = connection.page_id
    new_page = page_id if isinstance(page_id, str) and len(page_id) <= 36 else None
    if new_page:
        async with async_session_factory() as db:
            try:
                await get_page(db, connection.user_id, new_page)
            except APIError:
                new_page = None
    connection.page_id = new_page
    if previous != new_page:
        await _broadcast_presence(previous)
    await _broadcast_presence(new_page)
