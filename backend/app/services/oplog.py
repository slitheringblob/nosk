"""Recording mutations in the sync log and detecting concurrent edits."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Page, SyncOperation
from app.services.access import page_audience
from app.services.realtime import queue_notification
from app.utils.time import now_ms

# Change types that alter an entity's content; only these count as competing edits.
CONTENT_CHANGES = {
    "component": ("component_updated", "component_deleted"),
    "page": ("page_updated", "page_deleted", "page_replaced"),
}


@dataclass
class Actor:
    user_id: str
    device_id: str | None = None
    # Client-supplied id for idempotent sync pushes; one is generated for REST calls.
    operation_id: str | None = None

    def next_operation_id(self) -> str:
        # A single client operation can fan out into several log rows (e.g. deleting a toggle
        # and its children); only the first may reuse the client's id.
        if self.operation_id:
            op_id, self.operation_id = self.operation_id, None
            return op_id
        return str(uuid4())


def bump(page: Page) -> int:
    page.version = (page.version or 0) + 1
    page.updated_at = now_ms()
    return page.version


async def record(
    session: AsyncSession,
    actor: Actor,
    change_type: str,
    entity_type: str,
    entity_id: str,
    page: Page,
    data: dict[str, Any] | None,
    audience_user_id: str | None = None,
    notify: set[str] | None = None,
) -> SyncOperation:
    operation = SyncOperation(
        operation_id=actor.next_operation_id(),
        user_id=actor.user_id,
        operation_type=change_type,
        entity_type=entity_type,
        entity_id=entity_id,
        page_id=page.id,
        page_version=page.version,
        data=data,
        timestamp=now_ms(),
        device_id=actor.device_id,
        audience_user_id=audience_user_id,
    )
    session.add(operation)
    recipients = (
        notify if notify is not None else await page_audience(session, page.id, page.user_id)
    )
    recipients = {*recipients, actor.user_id}
    if audience_user_id:
        recipients.add(audience_user_id)
    queue_notification(session, recipients)
    return operation


async def operation_exists(session: AsyncSession, operation_id: str) -> bool:
    return bool(
        await session.scalar(select(exists().where(SyncOperation.operation_id == operation_id)))
    )


async def concurrent_change(
    session: AsyncSession,
    actor: Actor,
    entity_type: str,
    entity_id: str,
    base_version: int,
    page_id: str,
) -> SyncOperation | None:
    """Most recent content change to this entity made elsewhere after `base_version`."""

    return await session.scalar(
        select(SyncOperation)
        .where(
            SyncOperation.page_id == page_id,
            SyncOperation.entity_type == entity_type,
            SyncOperation.entity_id == entity_id,
            SyncOperation.page_version > base_version,
            SyncOperation.operation_type.in_(CONTENT_CHANGES[entity_type]),
            or_(
                SyncOperation.user_id != actor.user_id,
                SyncOperation.device_id.is_distinct_from(actor.device_id),
            ),
        )
        .order_by(SyncOperation.id.desc())
        .limit(1)
    )


async def was_deleted(session: AsyncSession, entity_type: str, entity_id: str) -> bool:
    return bool(
        await session.scalar(
            select(
                exists().where(
                    SyncOperation.entity_type == entity_type,
                    SyncOperation.entity_id == entity_id,
                    SyncOperation.operation_type == f"{entity_type}_deleted",
                )
            )
        )
    )
