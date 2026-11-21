"""Component mutations. Each one bumps the page version and appends to the sync log."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Component, Page
from app.schemas.component_content import slot_count, validate_content
from app.services.conversion import can_convert, convert_content
from app.services.oplog import Actor, bump, record
from app.services.serializers import serialize_component
from app.services.snapshot_service import load_components, maybe_auto_snapshot
from app.utils.errors import AlreadyExists, APIError, NotFound, ValidationFailed
from app.utils.time import now_ms


def _insert_index(ids: list[str], after_id: str | None, order: int | None) -> int:
    if after_id is not None:
        if after_id not in ids:
            raise ValidationFailed("after_id is not on this page")
        return ids.index(after_id) + 1
    if order is not None:
        return min(order, len(ids))
    return len(ids)


def _apply_order(page: Page, components: dict[str, Component]) -> None:
    """Make page.component_ids and each component's `order` agree, repairing drift."""

    ids = [cid for cid in page.component_ids or [] if cid in components]
    seen = set(ids)
    ids.extend(cid for cid in components if cid not in seen)
    page.component_ids = ids
    for index, cid in enumerate(ids):
        components[cid].order = index


def _descendants(component_id: str, components: dict[str, Component]) -> list[str]:
    children: dict[str, list[str]] = {}
    for comp in components.values():
        if comp.parent_id:
            children.setdefault(comp.parent_id, []).append(comp.id)
    found, stack = [], [component_id]
    while stack:
        current = stack.pop()
        for child in children.get(current, []):
            found.append(child)
            stack.append(child)
    return found


def _check_parent(
    components: dict[str, Component], parent_id: str | None, slot: int, moving_id: str | None
) -> None:
    if parent_id is None:
        if slot != 0:
            raise ValidationFailed("Top-level components must use slot 0")
        return
    parent = components.get(parent_id)
    if parent is None:
        raise ValidationFailed("Parent component is not on this page")
    slots = slot_count(parent.type, parent.content)
    if slots == 0:
        raise ValidationFailed(f"'{parent.type}' components cannot contain other components")
    if slot >= slots:
        raise ValidationFailed("Slot is out of range for the parent component")
    # Walk up from the new parent to make sure we aren't nesting a block inside itself.
    cursor: str | None = parent_id
    while cursor is not None:
        if cursor == moving_id:
            raise ValidationFailed("A component cannot be nested inside itself")
        cursor = components[cursor].parent_id if cursor in components else None


async def _page_components(session: AsyncSession, page: Page) -> dict[str, Component]:
    return {c.id: c for c in await load_components(session, page.id)}


async def create_component(
    session: AsyncSession, actor: Actor, page: Page, payload: dict[str, Any]
) -> Component:
    component_type = payload.get("type", "")
    content = validate_content(component_type, payload.get("content"))
    component_id = payload.get("id")
    if component_id and await session.get(Component, component_id) is not None:
        raise AlreadyExists("A component with this id already exists")

    components = await _page_components(session, page)
    parent_id, slot = payload.get("parent_id"), payload.get("slot", 0) or 0
    _check_parent(components, parent_id, slot, None)
    ids = list(page.component_ids or [])
    index = _insert_index(ids, payload.get("after_id"), payload.get("order"))

    await maybe_auto_snapshot(session, page, actor.user_id)
    timestamp = now_ms()
    component = Component(
        page_id=page.id,
        type=component_type,
        content=content,
        parent_id=parent_id,
        slot=slot,
        created_at=timestamp,
        updated_at=timestamp,
        schema_version=1,
    )
    if component_id:
        component.id = component_id
    session.add(component)
    await session.flush()
    ids.insert(index, component.id)
    page.component_ids = ids
    components[component.id] = component
    _apply_order(page, components)
    bump(page)
    await record(
        session,
        actor,
        "component_created",
        "component",
        component.id,
        page,
        {"component": serialize_component(component), "component_ids": page.component_ids},
    )
    return component


async def update_component(
    session: AsyncSession, actor: Actor, page: Page, component: Component, content: dict[str, Any]
) -> Component:
    validated = validate_content(component.type, content)
    await maybe_auto_snapshot(session, page, actor.user_id)
    reparented: list[Component] = []
    if component.type == "columns":
        # Shrinking a columns block folds orphaned children into its last column.
        last_slot = validated["count"] - 1
        for child in (await _page_components(session, page)).values():
            if child.parent_id == component.id and child.slot > last_slot:
                child.slot = last_slot
                reparented.append(child)
    component.content = validated
    component.updated_at = now_ms()
    bump(page)
    await record(
        session,
        actor,
        "component_updated",
        "component",
        component.id,
        page,
        {"component": serialize_component(component)},
    )
    for child in reparented:
        await _record_move(session, actor, page, child)
    return component


async def _record_move(
    session: AsyncSession, actor: Actor, page: Page, component: Component
) -> None:
    await record(
        session,
        actor,
        "component_moved",
        "component",
        component.id,
        page,
        {"component": serialize_component(component), "component_ids": page.component_ids},
    )


async def move_component(
    session: AsyncSession,
    actor: Actor,
    page: Page,
    component: Component,
    parent_id: str | None,
    slot: int,
    after_id: str | None,
) -> Component:
    components = await _page_components(session, page)
    _check_parent(components, parent_id, slot, component.id)
    if after_id == component.id:
        raise ValidationFailed("Cannot place a component after itself")
    # Move the block together with its descendants so subtrees stay contiguous.
    subtree = [component.id, *_descendants(component.id, components)]
    remaining = [cid for cid in page.component_ids if cid not in subtree]
    if after_id is not None and after_id not in remaining:
        raise ValidationFailed("after_id is not on this page")
    index = (
        _insert_index(remaining, after_id, None)
        if after_id
        else (0 if parent_id is None else remaining.index(parent_id) + 1)
    )
    ordered_subtree = [cid for cid in page.component_ids if cid in subtree]
    page.component_ids = remaining[:index] + ordered_subtree + remaining[index:]
    component.parent_id = parent_id
    component.slot = slot
    component.updated_at = now_ms()
    _apply_order(page, components)
    bump(page)
    await _record_move(session, actor, page, component)
    return component


async def delete_component(
    session: AsyncSession, actor: Actor, page: Page, component: Component
) -> list[str]:
    components = await _page_components(session, page)
    doomed = [*_descendants(component.id, components), component.id]
    await maybe_auto_snapshot(session, page, actor.user_id)
    for cid in doomed:
        await session.delete(components.pop(cid))
    page.component_ids = [cid for cid in page.component_ids if cid not in doomed]
    _apply_order(page, components)
    bump(page)
    for cid in doomed:
        await record(
            session,
            actor,
            "component_deleted",
            "component",
            cid,
            page,
            {"component_ids": page.component_ids},
        )
    return doomed


async def reorder_components(
    session: AsyncSession, actor: Actor, page: Page, ordered_ids: list[str], strict: bool
) -> list[str]:
    components = await _page_components(session, page)
    if strict:
        if len(ordered_ids) != len(set(ordered_ids)) or set(ordered_ids) != set(components):
            raise APIError("component_ids must contain every component on the page exactly once")
        new_order = list(ordered_ids)
    else:
        # Sync merge: honour the client's order for ids that still exist and keep any the client
        # didn't know about (created on another device) in their current relative position.
        known = [cid for cid in dict.fromkeys(ordered_ids) if cid in components]
        known_set = set(known)
        new_order = known + [cid for cid in page.component_ids if cid not in known_set]
    page.component_ids = new_order
    _apply_order(page, components)
    bump(page)
    await record(
        session,
        actor,
        "components_reordered",
        "page",
        page.id,
        page,
        {"component_ids": page.component_ids},
    )
    return page.component_ids


async def convert_component(
    session: AsyncSession, actor: Actor, page: Page, component: Component, to_type: str
) -> Component:
    if not can_convert(component.type, to_type):
        raise APIError(f"Cannot convert {component.type} to {to_type}")
    new_content = validate_content(
        to_type, convert_content(component.type, to_type, component.content)
    )
    components = await _page_components(session, page)
    await maybe_auto_snapshot(session, page, actor.user_id)
    moved_children = []
    if component.type == "toggle":
        # The converted block can't hold children; lift them to the toggle's own level.
        for child in components.values():
            if child.parent_id == component.id:
                child.parent_id, child.slot = component.parent_id, component.slot
                moved_children.append(child)
    component.type = to_type
    component.content = new_content
    component.updated_at = now_ms()
    bump(page)
    await record(
        session,
        actor,
        "component_updated",
        "component",
        component.id,
        page,
        {"component": serialize_component(component)},
    )
    for child in moved_children:
        await _record_move(session, actor, page, child)
    return component


async def get_component(session: AsyncSession, component_id: str) -> Component:
    component = await session.get(Component, component_id)
    if component is None:
        raise NotFound("Component not found")
    return component
