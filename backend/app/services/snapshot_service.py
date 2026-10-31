"""Page version history."""

from __future__ import annotations

from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Component, Page, PageSnapshot
from app.services.oplog import Actor, bump, record
from app.services.serializers import serialize_component, serialize_page
from app.utils.time import now_ms

MAX_AUTO_SNAPSHOTS = 50


async def load_components(session: AsyncSession, page_id: str) -> list[Component]:
    result = await session.scalars(
        select(Component).where(Component.page_id == page_id).order_by(Component.order)
    )
    return list(result)


def snapshot_data(page: Page, components: list[Component]) -> dict[str, Any]:
    return {
        "page": {
            "title": page.title,
            "icon": page.icon,
            "color": page.color,
            "tags": list(page.tags or []),
        },
        "components": [
            {
                "id": c.id,
                "type": c.type,
                "content": c.content,
                "parent_id": c.parent_id,
                "slot": c.slot,
                "created_at": c.created_at,
                "schema_version": c.schema_version,
            }
            for c in components
        ],
    }


async def create_snapshot(
    session: AsyncSession,
    page: Page,
    created_by: str | None,
    label: str | None = None,
    is_auto: bool = False,
    components: list[Component] | None = None,
) -> PageSnapshot:
    if components is None:
        components = await load_components(session, page.id)
    snapshot = PageSnapshot(
        page_id=page.id,
        version=page.version,
        created_at=now_ms(),
        created_by=created_by,
        label=label,
        is_auto=is_auto,
        title=page.title,
        data=snapshot_data(page, components),
    )
    session.add(snapshot)
    if is_auto:
        await _prune_auto_snapshots(session, page.id)
    return snapshot


async def _prune_auto_snapshots(session: AsyncSession, page_id: str) -> None:
    keep = (
        select(PageSnapshot.id)
        .where(PageSnapshot.page_id == page_id, PageSnapshot.is_auto.is_(True))
        .order_by(PageSnapshot.created_at.desc())
        .limit(MAX_AUTO_SNAPSHOTS)
    )
    await session.execute(
        delete(PageSnapshot).where(
            PageSnapshot.page_id == page_id,
            PageSnapshot.is_auto.is_(True),
            PageSnapshot.id.not_in(keep),
        )
    )


async def maybe_auto_snapshot(session: AsyncSession, page: Page, actor_id: str) -> None:
    """Capture the page as it was before the first edit after a quiet period."""

    # An empty page has nothing worth restoring.
    if not page.component_ids:
        return
    latest = await session.scalar(
        select(func.max(PageSnapshot.created_at)).where(PageSnapshot.page_id == page.id)
    )
    interval_ms = settings.snapshot_interval_minutes * 60_000
    if latest is None or now_ms() - latest >= interval_ms:
        await create_snapshot(session, page, actor_id, is_auto=True)


async def restore_snapshot(
    session: AsyncSession, actor: Actor, page: Page, snapshot: PageSnapshot
) -> list[Component]:
    current = await load_components(session, page.id)
    await create_snapshot(session, page, actor.user_id, label="Before restore", components=current)
    for component in current:
        await session.delete(component)
    await session.flush()

    meta = snapshot.data.get("page", {})
    page.title = meta.get("title", snapshot.title)
    page.icon = meta.get("icon")
    page.color = meta.get("color")
    page.tags = list(meta.get("tags", []))
    timestamp = now_ms()
    restored = []
    for index, item in enumerate(snapshot.data.get("components", [])):
        component = Component(
            id=item["id"],
            page_id=page.id,
            type=item["type"],
            content=item["content"],
            parent_id=item.get("parent_id"),
            slot=item.get("slot", 0),
            order=index,
            schema_version=item.get("schema_version", 1),
            created_at=item.get("created_at", timestamp),
            updated_at=timestamp,
        )
        session.add(component)
        restored.append(component)
    page.component_ids = [c.id for c in restored]
    bump(page)
    await record(
        session,
        actor,
        "page_replaced",
        "page",
        page.id,
        page,
        {"page": serialize_page(page), "components": [serialize_component(c) for c in restored]},
    )
    return restored
