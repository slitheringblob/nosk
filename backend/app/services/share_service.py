"""Sharing pages with other users."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Page, PageShare, User
from app.services.auth_service import get_user_by_email
from app.services.oplog import Actor, record
from app.services.serializers import serialize_component, serialize_page
from app.services.snapshot_service import load_components
from app.utils.errors import APIError, NotFound
from app.utils.time import now_ms


async def list_shares(session: AsyncSession, page: Page) -> list[dict]:
    rows = (
        await session.execute(
            select(PageShare, User.email)
            .join(User, User.id == PageShare.user_id)
            .where(PageShare.page_id == page.id)
            .order_by(PageShare.created_at)
        )
    ).all()
    return [
        {
            "user_id": share.user_id,
            "email": email,
            "role": share.role,
            "created_at": share.created_at,
        }
        for share, email in rows
    ]


async def share_page(
    session: AsyncSession, actor: Actor, page: Page, email: str, role: str
) -> dict:
    target = await get_user_by_email(session, email)
    if target is None:
        raise NotFound("No nosk account uses that email")
    if target.id == page.user_id:
        raise APIError("You already own this page")
    share = await session.scalar(
        select(PageShare).where(PageShare.page_id == page.id, PageShare.user_id == target.id)
    )
    if share is None:
        share = PageShare(page_id=page.id, user_id=target.id, role=role, created_at=now_ms())
        session.add(share)
    else:
        share.role = role
    await session.flush()

    owner = await session.get(User, page.user_id)
    components = await load_components(session, page.id)
    await record(
        session,
        actor,
        "page_shared",
        "page",
        page.id,
        page,
        {
            **serialize_page(page, role, owner.email if owner else None),
            "components": [serialize_component(c) for c in components],
            "shared_with": target.id,
        },
        audience_user_id=target.id,
    )
    return {
        "user_id": target.id,
        "email": target.email,
        "role": share.role,
        "created_at": share.created_at,
    }


async def unshare_page(session: AsyncSession, actor: Actor, page: Page, user_id: str) -> None:
    share = await session.scalar(
        select(PageShare).where(PageShare.page_id == page.id, PageShare.user_id == user_id)
    )
    if share is None:
        raise NotFound("This page is not shared with that user")
    await session.delete(share)
    await record(
        session,
        actor,
        "page_unshared",
        "page",
        page.id,
        page,
        {"shared_with": user_id},
        audience_user_id=user_id,
    )


async def leave_page(session: AsyncSession, actor: Actor, page: Page) -> None:
    await unshare_page(session, actor, page, actor.user_id)
