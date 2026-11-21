"""Component schemas."""

from __future__ import annotations

from typing import Annotated, Any

from pydantic import BaseModel, Field

from app.schemas.page import Uuid


class ComponentCreate(BaseModel):
    id: Uuid | None = None
    type: Annotated[str, Field(max_length=50)]
    content: dict[str, Any] = {}
    order: Annotated[int, Field(ge=0)] | None = None
    after_id: Annotated[str, Field(max_length=36)] | None = None
    parent_id: Annotated[str, Field(max_length=36)] | None = None
    slot: Annotated[int, Field(ge=0, le=10)] = 0


class ComponentUpdate(BaseModel):
    content: dict[str, Any]


class ComponentMove(BaseModel):
    parent_id: Annotated[str, Field(max_length=36)] | None = None
    slot: Annotated[int, Field(ge=0, le=10)] = 0
    after_id: Annotated[str, Field(max_length=36)] | None = None


class ConvertRequest(BaseModel):
    to_type: Annotated[str, Field(max_length=50)]


class ReorderRequest(BaseModel):
    component_ids: Annotated[list[str], Field(max_length=5_000)]


class ComponentOut(BaseModel):
    id: str
    page_id: str
    type: str
    content: dict[str, Any]
    created_at: int
    updated_at: int
    order: int
    schema_version: int
    parent_id: str | None
    slot: int
    page_version: int | None = None


class ComponentList(BaseModel):
    components: list[ComponentOut]
    total: int
    page_id: str
