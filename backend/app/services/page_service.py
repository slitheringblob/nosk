"""Page mutations."""

from __future__ import annotations

from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Component, Page
from app.schemas.component_content import validate_content
from app.services.access import page_audience
from app.services.oplog import Actor, bump, record
from app.services.serializers import serialize_component, serialize_page
from app.services.snapshot_service import load_components, maybe_auto_snapshot
from app.utils.errors import AlreadyExists, APIError
from app.utils.time import now_ms

PAGE_FIELDS = ("title", "icon", "color", "tags", "is_template")


async def create_page(
    session: AsyncSession,
    actor: Actor,
    fields: dict[str, Any],
    blocks: list[dict[str, Any]] | None = None,
) -> tuple[Page, list[Component]]:
    """Create a page, optionally pre-filled with blocks ({type, content, parent_index?, slot?})."""

    page_id = fields.get("id")
    if page_id and await session.get(Page, page_id) is not None:
        raise AlreadyExists("A page with this id already exists")
    timestamp = now_ms()
    page = Page(
        user_id=actor.user_id,
        title=fields["title"],
        icon=fields.get("icon"),
        color=fields.get("color"),
        tags=list(fields.get("tags") or []),
        is_template=bool(fields.get("is_template", False)),
        journal_date=await _free_journal_date(session, actor.user_id, fields.get("journal_date")),
        template_id=fields.get("template_id"),
        component_ids=[],
        created_at=timestamp,
        updated_at=timestamp,
        version=0,
        deleted=False,
    )
    if page_id:
        page.id = page_id
    session.add(page)
    await session.flush()

    components = _build_components(page, blocks or [], timestamp)
    for component in components:
        session.add(component)
    page.component_ids = [c.id for c in components]

    data = serialize_page(page)
    if components:
        data["components"] = [serialize_component(c) for c in components]
    await record(session, actor, "page_created", "page", page.id, page, data, notify=set())
    return page, components


async def _free_journal_date(
    session: AsyncSession, user_id: str, journal_date: str | None
) -> str | None:
    """The journal date to store, or None if that day already has an entry.

    Devices derive the same page id for a given day, so a clash only happens when one created
    the page without knowing the shared id. Keeping the newcomer as a normal page (instead of
    rejecting it) means nothing written offline is lost.
    """

    if not journal_date:
        return None
    taken = await session.scalar(
        select(Page.id).where(Page.user_id == user_id, Page.journal_date == journal_date)
    )
    return None if taken else journal_date


def _build_components(page: Page, blocks: list[dict[str, Any]], timestamp: int) -> list[Component]:
    ids = [str(uuid4()) for _ in blocks]
    components: list[Component] = []
    for index, block in enumerate(blocks):
        parent_index = block.get("parent_index")
        valid_parent = parent_index is not None and 0 <= parent_index < len(blocks)
        parent_id = ids[parent_index] if valid_parent and parent_index != index else None
        components.append(
            Component(
                id=ids[index],
                page_id=page.id,
                type=block["type"],
                content=validate_content(block["type"], block.get("content")),
                parent_id=parent_id,
                slot=block.get("slot", 0) if parent_id else 0,
                order=index,
                created_at=timestamp,
                updated_at=timestamp,
                schema_version=1,
            )
        )
    return components


def blocks_from_components(components: list[Component]) -> list[dict[str, Any]]:
    """Turn existing components into creatable blocks, preserving nesting by index."""

    index_of = {c.id: i for i, c in enumerate(components)}
    blocks = []
    for component in components:
        parent_index = index_of.get(component.parent_id) if component.parent_id else None
        blocks.append(
            {
                "type": component.type,
                "content": component.content,
                "parent_index": parent_index,
                "slot": component.slot,
            }
        )
    return blocks


async def update_page(
    session: AsyncSession, actor: Actor, page: Page, fields: dict[str, Any]
) -> Page:
    changes = {key: value for key, value in fields.items() if key in PAGE_FIELDS}
    if "title" in changes and not changes["title"]:
        del changes["title"]
    if not changes:
        return page
    await maybe_auto_snapshot(session, page, actor.user_id)
    for key, value in changes.items():
        setattr(page, key, list(value) if key == "tags" else value)
    bump(page)
    await record(session, actor, "page_updated", "page", page.id, page, serialize_page(page))
    return page


async def delete_page(session: AsyncSession, actor: Actor, page: Page, permanent: bool) -> None:
    if permanent:
        # Compute recipients before the shares cascade away with the page.
        audience = await page_audience(session, page.id, page.user_id)
        bump(page)
        await record(
            session,
            actor,
            "page_deleted",
            "page",
            page.id,
            page,
            {"permanent": True},
            notify=audience,
        )
        await session.delete(page)
        return
    if page.deleted:
        return
    page.deleted = True
    bump(page)
    await record(session, actor, "page_deleted", "page", page.id, page, {"permanent": False})


async def restore_page(session: AsyncSession, actor: Actor, page: Page) -> Page:
    if not page.deleted:
        return page
    page.deleted = False
    bump(page)
    components = await load_components(session, page.id)
    await record(
        session,
        actor,
        "page_restored",
        "page",
        page.id,
        page,
        {**serialize_page(page), "components": [serialize_component(c) for c in components]},
    )
    return page


async def duplicate_page(
    session: AsyncSession,
    actor: Actor,
    source: Page,
    title: str | None,
    as_template: bool,
) -> tuple[Page, list[Component]]:
    components = await load_components(session, source.id)
    fields = {
        "title": title or (source.title if as_template else f"{source.title} (copy)")[:200],
        "icon": source.icon,
        "color": source.color,
        "tags": source.tags,
        "is_template": as_template,
        # Pages made from a template (or copies of them) stay grouped under that template.
        "template_id": (
            None if as_template else (source.id if source.is_template else source.template_id)
        ),
    }
    return await create_page(session, actor, fields, blocks_from_components(components))
