"""Component endpoints addressed by component id."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import AuthDep, SessionDep
from app.schemas.component import ComponentMove, ComponentOut, ComponentUpdate, ConvertRequest
from app.services import component_service
from app.services.access import get_page
from app.services.realtime import commit_and_publish
from app.services.serializers import serialize_component

router = APIRouter(prefix="/components", tags=["components"])


async def _editable(db: SessionDep, auth: AuthDep, component_id: str):  # type: ignore[no-untyped-def]
    component = await component_service.get_component(db, component_id)
    page, _ = await get_page(db, auth.user.id, component.page_id, "edit")
    return page, component


@router.get("/{component_id}", response_model=ComponentOut)
async def get_component(component_id: str, auth: AuthDep, db: SessionDep) -> dict:
    component = await component_service.get_component(db, component_id)
    page, _ = await get_page(db, auth.user.id, component.page_id)
    return serialize_component(component, page.version)


@router.put("/{component_id}", response_model=ComponentOut)
async def update_component(
    component_id: str, body: ComponentUpdate, auth: AuthDep, db: SessionDep
) -> dict:
    page, component = await _editable(db, auth, component_id)
    await component_service.update_component(db, auth.actor(), page, component, body.content)
    await commit_and_publish(db)
    return serialize_component(component, page.version)


@router.delete("/{component_id}")
async def delete_component(component_id: str, auth: AuthDep, db: SessionDep) -> dict:
    page, component = await _editable(db, auth, component_id)
    deleted = await component_service.delete_component(db, auth.actor(), page, component)
    await commit_and_publish(db)
    return {
        "message": "Component deleted successfully",
        "component_id": component_id,
        "deleted_ids": deleted,
        "page_version": page.version,
    }


@router.post("/{component_id}/convert", response_model=ComponentOut)
async def convert_component(
    component_id: str, body: ConvertRequest, auth: AuthDep, db: SessionDep
) -> dict:
    page, component = await _editable(db, auth, component_id)
    await component_service.convert_component(db, auth.actor(), page, component, body.to_type)
    await commit_and_publish(db)
    return serialize_component(component, page.version)


@router.post("/{component_id}/move", response_model=ComponentOut)
async def move_component(
    component_id: str, body: ComponentMove, auth: AuthDep, db: SessionDep
) -> dict:
    page, component = await _editable(db, auth, component_id)
    await component_service.move_component(
        db, auth.actor(), page, component, body.parent_id, body.slot, body.after_id
    )
    await commit_and_publish(db)
    return serialize_component(component, page.version)
