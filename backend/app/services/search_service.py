"""Full-text-ish search across page titles and component content."""

from __future__ import annotations

from sqlalchemy import String, cast, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Component, Page
from app.services.access import accessible_page_ids_query
from app.services.export_service import plain_text


def _snippet(text: str, query: str, radius: int = 60) -> str:
    position = text.lower().find(query.lower())
    if position < 0:
        return text[: radius * 2]
    start = max(0, position - radius)
    end = min(len(text), position + len(query) + radius)
    return ("…" if start else "") + text[start:end] + ("…" if end < len(text) else "")


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search(session: AsyncSession, user_id: str, query: str, limit: int = 30) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    pattern = f"%{_escape_like(query)}%"
    accessible = accessible_page_ids_query(user_id)

    title_hits = await session.scalars(
        select(Page)
        .where(
            Page.id.in_(accessible), Page.deleted.is_(False), Page.title.ilike(pattern, escape="\\")
        )
        .order_by(Page.updated_at.desc())
        .limit(limit)
    )
    results: dict[str, dict] = {
        page.id: {
            "page_id": page.id,
            "title": page.title,
            "icon": page.icon,
            "component_id": None,
            "snippet": "",
            "match": "title",
        }
        for page in title_hits
    }

    # JSON content is searched as text; matches inside markup or keys are filtered out below.
    rows = (
        await session.execute(
            select(Component, Page)
            .join(Page, Page.id == Component.page_id)
            .where(
                Page.id.in_(accessible),
                Page.deleted.is_(False),
                or_(cast(Component.content, String).ilike(pattern, escape="\\")),
            )
            .order_by(Page.updated_at.desc())
            .limit(limit * 5)
        )
    ).all()
    for component, page in rows:
        if page.id in results and results[page.id]["match"] == "content":
            continue
        text = plain_text(component)
        if query.lower() not in text.lower():
            continue
        entry = results.setdefault(
            page.id,
            {"page_id": page.id, "title": page.title, "icon": page.icon, "match": "content"},
        )
        entry.update(component_id=component.id, snippet=_snippet(text, query))
        if len(results) >= limit:
            break
    return list(results.values())[:limit]
