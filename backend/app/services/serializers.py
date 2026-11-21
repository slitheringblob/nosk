"""Model -> plain dict conversions shared by REST responses and the sync log."""

from __future__ import annotations

from typing import Any

from app.models import Comment, Component, Page


def serialize_page(
    page: Page, role: str = "owner", owner_email: str | None = None
) -> dict[str, Any]:
    return {
        "id": page.id,
        "user_id": page.user_id,
        "title": page.title,
        "component_ids": list(page.component_ids or []),
        "created_at": page.created_at,
        "updated_at": page.updated_at,
        "version": page.version,
        "deleted": page.deleted,
        "icon": page.icon,
        "color": page.color,
        "tags": list(page.tags or []),
        "is_template": page.is_template,
        "journal_date": page.journal_date,
        "template_id": page.template_id,
        "role": role,
        "owner_email": owner_email,
    }


def serialize_component(component: Component, page_version: int | None = None) -> dict[str, Any]:
    data = {
        "id": component.id,
        "page_id": component.page_id,
        "type": component.type,
        "content": component.content,
        "created_at": component.created_at,
        "updated_at": component.updated_at,
        "order": component.order,
        "schema_version": component.schema_version,
        "parent_id": component.parent_id,
        "slot": component.slot,
    }
    if page_version is not None:
        data["page_version"] = page_version
    return data


def serialize_comment(comment: Comment, author_email: str) -> dict[str, Any]:
    return {
        "id": comment.id,
        "page_id": comment.page_id,
        "component_id": comment.component_id,
        "user_id": comment.user_id,
        "author_email": author_email,
        "body": comment.body,
        "resolved": comment.resolved,
        "created_at": comment.created_at,
        "updated_at": comment.updated_at,
    }
