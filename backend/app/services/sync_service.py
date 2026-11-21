"""Sync protocol: bootstrap, pull (cursor-based) and push (idempotent, per-entity conflicts)."""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Component, Page, PageShare, SyncOperation, User
from app.schemas.page import PageCreate, PageUpdate
from app.schemas.sync import PushOperation
from app.services import component_service, page_service
from app.services.access import ROLE_RANK, accessible_page_ids_query, page_role
from app.services.oplog import Actor, concurrent_change, operation_exists, was_deleted
from app.services.realtime import commit_and_publish, discard_notifications
from app.services.serializers import serialize_component, serialize_page
from app.utils.errors import AlreadyExists, APIError
from app.utils.time import now_ms

PULL_LIMIT = 500
# Bump whenever a migration changes existing rows (not just adds empty columns). Devices whose
# copy predates the bump re-download pages and blocks, since migrations don't produce sync ops.
DATA_EPOCH = "0004"
CONTENT_EDIT_OPS = {"update_component", "convert_component", "delete_component"}


class OperationConflict(Exception):
    def __init__(
        self,
        reason: str,
        message: str,
        server_data: dict[str, Any] | None = None,
        server_version: int = 0,
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.message = message
        self.server_data = server_data
        self.server_version = server_version


def _visible_operations(user_id: str):
    return or_(
        SyncOperation.page_id.in_(accessible_page_ids_query(user_id)),
        SyncOperation.user_id == user_id,
        SyncOperation.audience_user_id == user_id,
    )


async def current_cursor(session: AsyncSession, user_id: str) -> tuple[int, int]:
    row = (
        await session.execute(
            select(func.max(SyncOperation.id), func.max(SyncOperation.timestamp)).where(
                _visible_operations(user_id)
            )
        )
    ).one()
    return row[0] or 0, row[1] or 0


async def bootstrap(session: AsyncSession, user_id: str) -> dict[str, Any]:
    """Everything a fresh device needs, plus the cursor to pull from afterwards."""

    # Read the cursor first: anything committed after this point is re-delivered by pull, and
    # applying a full snapshot twice is harmless.
    cursor, last_sync = await current_cursor(session, user_id)
    owned = list(await session.scalars(select(Page).where(Page.user_id == user_id)))
    shared_rows = (
        await session.execute(
            select(Page, PageShare.role, User.email)
            .join(PageShare, PageShare.page_id == Page.id)
            .join(User, User.id == Page.user_id)
            .where(PageShare.user_id == user_id)
        )
    ).all()
    pages = [serialize_page(p) for p in owned]
    pages += [serialize_page(p, role, email) for p, role, email in shared_rows]
    page_ids = [p["id"] for p in pages]
    components = []
    if page_ids:
        rows = await session.scalars(
            select(Component).where(Component.page_id.in_(page_ids)).order_by(Component.order)
        )
        components = [serialize_component(c) for c in rows]
    return {
        "pages": pages,
        "components": components,
        "cursor": cursor,
        "last_sync": last_sync,
        "data_epoch": DATA_EPOCH,
    }


async def pull(
    session: AsyncSession, user_id: str, cursor: int | None, since: int | None, limit: int
) -> dict[str, Any]:
    limit = max(1, min(limit, PULL_LIMIT))
    query = select(SyncOperation).where(_visible_operations(user_id))
    if cursor is not None:
        query = query.where(SyncOperation.id > cursor)
    elif since is not None:
        query = query.where(SyncOperation.timestamp > since)
    rows = list(await session.scalars(query.order_by(SyncOperation.id).limit(limit + 1)))
    has_more = len(rows) > limit
    rows = rows[:limit]
    changes = [
        {
            "seq": op.id,
            "operation_id": op.operation_id,
            "type": op.operation_type,
            "page_id": op.page_id,
            "component_id": op.entity_id if op.entity_type == "component" else None,
            "page_version": op.page_version,
            "timestamp": op.timestamp,
            "device_id": op.device_id,
            "user_id": op.user_id,
            "data": op.data,
        }
        for op in rows
    ]
    if rows:
        new_cursor, last_sync = rows[-1].id, rows[-1].timestamp
    else:
        new_cursor, last_sync = await current_cursor(session, user_id)
        new_cursor = max(new_cursor, cursor or 0)
    return {
        "changes": changes,
        "cursor": new_cursor,
        "last_sync": last_sync,
        "has_more": has_more,
        "data_epoch": DATA_EPOCH,
    }


async def _editable_page(session: AsyncSession, user_id: str, page_id: str) -> Page:
    page = await session.get(Page, page_id)
    if page is None:
        if await was_deleted(session, "page", page_id):
            raise OperationConflict("entity_deleted", "Page was permanently deleted")
        raise OperationConflict("invalid", "Page not found")
    role = await page_role(session, page, user_id)
    if role is None:
        raise OperationConflict("forbidden", "Page not found")
    if ROLE_RANK[role] < ROLE_RANK["editor"]:
        raise OperationConflict("forbidden", "You only have view access to this page")
    return page


async def _component(session: AsyncSession, page: Page, component_id: str | None) -> Component:
    component = await session.get(Component, component_id) if component_id else None
    if component is None or component.page_id != page.id:
        if component_id and await was_deleted(session, "component", component_id):
            raise OperationConflict(
                "entity_deleted",
                "Component was deleted on another device",
                server_version=page.version,
            )
        raise OperationConflict("invalid", "Component not found", server_version=page.version)
    return component


async def _check_concurrent(
    session: AsyncSession,
    actor: Actor,
    op: PushOperation,
    page: Page,
    entity_type: str,
    entity_id: str,
    server_data: dict[str, Any] | None,
) -> None:
    if op.force:
        return
    competing = await concurrent_change(
        session, actor, entity_type, entity_id, op.page_version, page.id
    )
    if competing is not None:
        raise OperationConflict(
            "version_mismatch",
            "This was changed on another device",
            server_data=server_data,
            server_version=page.version,
        )


async def apply_operation(session: AsyncSession, actor: Actor, op: PushOperation) -> Page | None:
    """Apply a single pushed operation. Returns the affected page (None if it was removed)."""

    data = op.data
    if op.type == "create_page":
        existing = await session.get(Page, op.page_id)
        if existing is not None and existing.user_id == actor.user_id:
            # Same page created again: a retried push, or another device creating the same
            # day's journal entry (journal page ids are derived from the date).
            if existing.deleted:
                await page_service.restore_page(session, actor, existing)
            return existing
        fields = PageCreate.model_validate({**data, "id": op.page_id}).model_dump()
        page, _ = await page_service.create_page(session, actor, fields)
        return page

    page = await _editable_page(session, actor.user_id, op.page_id)

    if op.type == "update_page":
        if page.user_id != actor.user_id and "is_template" in data:
            data = {k: v for k, v in data.items() if k != "is_template"}
        fields = PageUpdate.model_validate(data).model_dump(exclude_unset=True)
        await _check_concurrent(session, actor, op, page, "page", page.id, serialize_page(page))
        await page_service.update_page(session, actor, page, fields)
        return page
    if op.type in ("delete_page", "restore_page"):
        if page.user_id != actor.user_id:
            raise OperationConflict("forbidden", "Only the owner can delete or restore a page")
        if op.type == "restore_page":
            await page_service.restore_page(session, actor, page)
            return page
        permanent = bool(data.get("permanent"))
        await page_service.delete_page(session, actor, page, permanent)
        return None if permanent else page
    if op.type == "create_component":
        payload = {**data, "id": op.component_id or data.get("id")}
        existing = await session.get(Component, payload["id"]) if payload["id"] else None
        if existing is not None:
            # Replayed create whose operation id was lost: treat as already applied.
            return page
        await component_service.create_component(session, actor, page, payload)
        return page
    if op.type == "reorder_components":
        await component_service.reorder_components(
            session, actor, page, list(data.get("component_ids", [])), strict=False
        )
        return page

    component = await _component(session, page, op.component_id)
    if op.type in CONTENT_EDIT_OPS:
        await _check_concurrent(
            session, actor, op, page, "component", component.id, serialize_component(component)
        )
    if op.type == "update_component":
        if data.get("type") and data["type"] != component.type:
            raise OperationConflict("invalid", "Use convert_component to change a component's type")
        await component_service.update_component(
            session, actor, page, component, data.get("content", {})
        )
    elif op.type == "convert_component":
        await component_service.convert_component(
            session, actor, page, component, data.get("to_type", "")
        )
        if data.get("content") is not None:
            await component_service.update_component(
                session, actor, page, component, data["content"]
            )
    elif op.type == "move_component":
        await component_service.move_component(
            session,
            actor,
            page,
            component,
            data.get("parent_id"),
            int(data.get("slot", 0)),
            data.get("after_id"),
        )
    elif op.type == "delete_component":
        await component_service.delete_component(session, actor, page, component)
    return page


async def _apply_with_retry(
    session: AsyncSession, user_id: str, device_id: str, op: PushOperation
) -> Page | None:
    """Apply and commit one op, retrying once if a concurrent request inserted the same row.

    Two devices can create the same entity at the same moment (e.g. today's journal page,
    whose id both derive from the date). The loser of that race hits a unique constraint or the
    service's own "already exists" check; re-running the op sees the winner's row and is treated
    as already applied.
    """

    for attempt in range(2):
        actor = Actor(user_id=user_id, device_id=device_id, operation_id=op.operation_id)
        try:
            page = await apply_operation(session, actor, op)
            await commit_and_publish(session)
            return page
        except (IntegrityError, AlreadyExists):
            await session.rollback()
            discard_notifications(session)
            if attempt == 1 or await operation_exists(session, op.operation_id):
                raise
    return None


async def push(
    session: AsyncSession, user_id: str, device_id: str, operations: list[PushOperation]
) -> dict[str, Any]:
    synced = 0
    conflicts: list[dict[str, Any]] = []
    page_versions: dict[str, int] = {}
    # Version each op produced, so clients know exactly how new their copy of an entity is.
    op_versions: dict[str, int] = {}

    for index, op in enumerate(operations):
        if await operation_exists(session, op.operation_id):
            synced += 1  # Already applied by an earlier (retried) push.
            continue
        try:
            page = await _apply_with_retry(session, user_id, device_id, op)
            synced += 1
            if page is not None:
                page_versions[page.id] = page.version
                op_versions[op.operation_id] = page.version
        except (OperationConflict, APIError, ValueError) as exc:
            await session.rollback()
            discard_notifications(session)
            if isinstance(exc, OperationConflict):
                reason, message = exc.reason, exc.message
                server_data, server_version = exc.server_data, exc.server_version
            else:
                reason = "invalid"
                message = getattr(exc, "message", None) or str(exc)
                server_data, server_version = None, 0
            entity_type = "component" if op.component_id else "page"
            conflicts.append(
                {
                    "operation_index": index,
                    "operation_id": op.operation_id,
                    "page_id": op.page_id,
                    "entity_type": entity_type,
                    "entity_id": op.component_id or op.page_id,
                    "reason": reason,
                    "local_version": op.page_version,
                    "server_version": server_version,
                    "resolution": (
                        "manual" if reason in ("version_mismatch", "entity_deleted") else "rejected"
                    ),
                    "message": message,
                    "server_data": server_data,
                }
            )

    cursor, _ = await current_cursor(session, user_id)
    return {
        "message": "Changes synced with conflicts" if conflicts else "Changes synced successfully",
        "synced": synced,
        "conflicts": conflicts,
        "page_versions": page_versions,
        "op_versions": op_versions,
        "server_timestamp": now_ms(),
        "cursor": cursor,
    }


async def status(
    session: AsyncSession, user_id: str, device_id: str, cursor: int | None
) -> dict[str, Any]:
    latest, last_sync = await current_cursor(session, user_id)
    pending = 0
    if cursor is not None:
        pending = (
            await session.scalar(
                select(func.count(SyncOperation.id)).where(
                    _visible_operations(user_id),
                    SyncOperation.id > cursor,
                    SyncOperation.device_id.is_distinct_from(device_id),
                )
            )
            or 0
        )
    return {
        "last_sync": last_sync,
        "cursor": latest,
        "pending_changes": pending,
        "sync_enabled": True,
        "device_id": device_id,
    }
