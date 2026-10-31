"""Page-level authorization: ownership and sharing."""

from __future__ import annotations

from typing import Literal

from sqlalchemy import select, union
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.models import Page, PageShare, User
from app.utils.errors import Forbidden, NotFound

Need = Literal["view", "edit", "owner"]
ROLE_RANK = {"viewer": 0, "editor": 1, "owner": 2}
NEED_RANK = {"view": 0, "edit": 1, "owner": 2}


def accessible_page_ids_query(user_id: str) -> Select:
    """SELECT of every page id the user owns or has been shared."""

    owned = select(Page.id).where(Page.user_id == user_id)
    shared = select(PageShare.page_id).where(PageShare.user_id == user_id)
    return select(union(owned, shared).subquery().c[0])


async def page_role(session: AsyncSession, page: Page, user_id: str) -> str | None:
    if page.user_id == user_id:
        return "owner"
    share = await session.scalar(
        select(PageShare).where(PageShare.page_id == page.id, PageShare.user_id == user_id)
    )
    return share.role if share else None


async def get_page(
    session: AsyncSession, user_id: str, page_id: str, need: Need = "view"
) -> tuple[Page, str]:
    """Load a page the user may access. Pages the user can't see at all are reported as missing
    so ids of other people's pages can't be probed."""

    page = await session.get(Page, page_id)
    if page is None:
        raise NotFound("Page not found")
    role = await page_role(session, page, user_id)
    if role is None:
        raise NotFound("Page not found")
    if ROLE_RANK[role] < NEED_RANK[need]:
        raise Forbidden("You do not have permission to modify this page")
    return page, role


async def page_audience(session: AsyncSession, page_id: str, owner_id: str) -> set[str]:
    """Every user who should hear about changes to this page."""

    shared = await session.scalars(select(PageShare.user_id).where(PageShare.page_id == page_id))
    return {owner_id, *shared}


async def owner_email(session: AsyncSession, page: Page) -> str | None:
    return await session.scalar(select(User.email).where(User.id == page.user_id))
