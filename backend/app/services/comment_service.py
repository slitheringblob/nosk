"""Comment threads on pages and blocks."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Comment, Component, Page, User
from app.services.oplog import Actor, record
from app.services.serializers import serialize_comment
from app.utils.errors import Forbidden, NotFound, ValidationFailed
from app.utils.time import now_ms


async def list_comments(session: AsyncSession, page_id: str) -> list[dict]:
    rows = (
        await session.execute(
            select(Comment, User.email)
            .join(User, User.id == Comment.user_id)
            .where(Comment.page_id == page_id)
            .order_by(Comment.created_at)
        )
    ).all()
    return [serialize_comment(comment, email) for comment, email in rows]


async def add_comment(
    session: AsyncSession,
    actor: Actor,
    page: Page,
    author: User,
    component_id: str | None,
    body: str,
) -> dict:
    if component_id:
        component = await session.get(Component, component_id)
        if component is None or component.page_id != page.id:
            raise ValidationFailed("Component is not on this page")
    timestamp = now_ms()
    comment = Comment(
        page_id=page.id,
        component_id=component_id,
        user_id=author.id,
        body=body.strip(),
        created_at=timestamp,
        updated_at=timestamp,
    )
    session.add(comment)
    await session.flush()
    data = serialize_comment(comment, author.email)
    await record(session, actor, "comment_created", "comment", comment.id, page, data)
    return data


async def get_comment(session: AsyncSession, comment_id: str) -> Comment:
    comment = await session.get(Comment, comment_id)
    if comment is None:
        raise NotFound("Comment not found")
    return comment


async def update_comment(
    session: AsyncSession,
    actor: Actor,
    page: Page,
    role: str,
    comment: Comment,
    body: str | None,
    resolved: bool | None,
) -> dict:
    if body is not None:
        if comment.user_id != actor.user_id:
            raise Forbidden("Only the author can edit a comment")
        comment.body = body.strip()
    if resolved is not None:
        if role == "viewer" and comment.user_id != actor.user_id:
            raise Forbidden("Viewers can only resolve their own comments")
        comment.resolved = resolved
    comment.updated_at = now_ms()
    author_email = await session.scalar(select(User.email).where(User.id == comment.user_id))
    data = serialize_comment(comment, author_email or "")
    await record(session, actor, "comment_updated", "comment", comment.id, page, data)
    return data


async def delete_comment(session: AsyncSession, actor: Actor, page: Page, comment: Comment) -> None:
    if comment.user_id != actor.user_id and page.user_id != actor.user_id:
        raise Forbidden("Only the author or page owner can delete a comment")
    await session.delete(comment)
    await record(
        session,
        actor,
        "comment_deleted",
        "comment",
        comment.id,
        page,
        {"id": comment.id, "component_id": comment.component_id},
    )
