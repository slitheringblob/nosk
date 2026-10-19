"""Sync protocol schemas."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

PushOperationType = Literal[
    "create_page",
    "update_page",
    "delete_page",
    "restore_page",
    "create_component",
    "update_component",
    "move_component",
    "delete_component",
    "reorder_components",
    "convert_component",
]


class PushOperation(BaseModel):
    operation_id: Annotated[str, Field(min_length=1, max_length=64)]
    type: PushOperationType
    page_id: Annotated[str, Field(max_length=36)]
    component_id: Annotated[str, Field(max_length=36)] | None = None
    # Last server page version this client had seen when it made the change.
    page_version: Annotated[int, Field(ge=0)] = 0
    device_id: Annotated[str, Field(max_length=100)] | None = None
    timestamp: int | None = None
    data: dict[str, Any] = {}
    # Apply even if another device changed the same entity ("keep mine").
    force: bool = False


class PushRequest(BaseModel):
    operations: Annotated[list[PushOperation], Field(max_length=500)]
    client_timestamp: int | None = None


class SyncConflict(BaseModel):
    operation_index: int
    operation_id: str
    page_id: str
    entity_type: str
    entity_id: str
    reason: Literal["version_mismatch", "entity_deleted", "forbidden", "invalid"]
    local_version: int
    server_version: int
    resolution: Literal["manual", "rejected"] = "manual"
    message: str | None = None
    server_data: dict[str, Any] | None = None


class PushResponse(BaseModel):
    message: str
    synced: int
    conflicts: list[SyncConflict]
    page_versions: dict[str, int]
    op_versions: dict[str, int] = {}
    server_timestamp: int
    cursor: int


class Change(BaseModel):
    seq: int
    operation_id: str
    type: str
    page_id: str
    component_id: str | None = None
    page_version: int
    timestamp: int
    device_id: str | None
    user_id: str
    data: dict[str, Any] | None


class PullResponse(BaseModel):
    changes: list[Change]
    last_sync: int
    cursor: int
    has_more: bool
    data_epoch: str


class SyncStatus(BaseModel):
    last_sync: int
    cursor: int
    pending_changes: int
    sync_enabled: bool = True
    device_id: str
