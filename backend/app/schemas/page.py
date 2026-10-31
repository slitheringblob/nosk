"""Page schemas."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, Field, field_validator

from app.schemas.component_content import HEX_COLOR

Title = Annotated[str, Field(min_length=1, max_length=200)]
Icon = Annotated[str, Field(max_length=10)]
Tag = Annotated[str, Field(min_length=1, max_length=50)]
Uuid = Annotated[str, Field(pattern=r"^[0-9a-fA-F-]{36}$")]


def _check_color(value: str | None) -> str | None:
    if value is not None and not HEX_COLOR.match(value):
        raise ValueError("Color must be a #RRGGBB hex value")
    return value


def _normalise_tags(value: list[str] | None) -> list[str] | None:
    if value is None:
        return None
    seen: list[str] = []
    for tag in value:
        cleaned = tag.strip().lower()
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    return seen


def _check_journal_date(value: str | None) -> str | None:
    if value is not None:
        try:
            date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("journal_date must be a real YYYY-MM-DD date") from exc
    return value


class PageCreate(BaseModel):
    id: Uuid | None = None
    title: Title
    icon: Icon | None = None
    color: str | None = None
    tags: Annotated[list[Tag], Field(max_length=30)] = []
    is_template: bool = False
    journal_date: Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")] | None = None
    template_id: Annotated[str, Field(max_length=64)] | None = None

    _color = field_validator("color")(_check_color)
    _tags = field_validator("tags")(_normalise_tags)
    _journal_date = field_validator("journal_date")(_check_journal_date)


class PageUpdate(BaseModel):
    title: Title | None = None
    icon: Icon | None = None
    color: str | None = None
    tags: Annotated[list[Tag], Field(max_length=30)] | None = None
    is_template: bool | None = None

    _color = field_validator("color")(_check_color)
    _tags = field_validator("tags")(_normalise_tags)


class PageOut(BaseModel):
    id: str
    user_id: str
    title: str
    component_ids: list[str]
    created_at: int
    updated_at: int
    version: int
    deleted: bool
    icon: str | None
    color: str | None
    tags: list[str]
    is_template: bool
    journal_date: str | None = None
    template_id: str | None = None
    role: Literal["owner", "editor", "viewer"] = "owner"
    owner_email: str | None = None


class PageList(BaseModel):
    pages: list[PageOut]
    total: int
    limit: int
    offset: int


class DuplicateRequest(BaseModel):
    title: Title | None = None
    as_template: bool = False


class FromTemplateRequest(BaseModel):
    template_id: Annotated[str, Field(max_length=64)]
    title: Title | None = None


class ImportRequest(BaseModel):
    format: Literal["markdown", "json"] = "markdown"
    content: Annotated[str, Field(max_length=2_000_000)]
    title: Title | None = None


class ShareCreate(BaseModel):
    email: Annotated[str, Field(max_length=255)]
    role: Literal["viewer", "editor"] = "viewer"


class ShareOut(BaseModel):
    user_id: str
    email: str
    role: str
    created_at: int


class SnapshotCreate(BaseModel):
    label: Annotated[str, Field(max_length=200)] | None = None


class SnapshotOut(BaseModel):
    id: str
    page_id: str
    version: int
    created_at: int
    created_by: str | None
    label: str | None
    is_auto: bool
    title: str
    component_count: int


class CommentCreate(BaseModel):
    component_id: Annotated[str, Field(max_length=36)] | None = None
    body: Annotated[str, Field(min_length=1, max_length=5_000)]


class CommentUpdate(BaseModel):
    body: Annotated[str, Field(min_length=1, max_length=5_000)] | None = None
    resolved: bool | None = None


class CommentOut(BaseModel):
    id: str
    page_id: str
    component_id: str | None
    user_id: str
    author_email: str
    body: str
    resolved: bool
    created_at: int
    updated_at: int
