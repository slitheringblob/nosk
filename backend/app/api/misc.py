"""Search and link previews."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.api.deps import AuthDep, SessionDep
from app.services import search_service, unfurl_service

router = APIRouter(tags=["misc"])


@router.get("/search")
async def search(
    auth: AuthDep,
    db: SessionDep,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
) -> dict:
    return {"query": q, "results": await search_service.search(db, auth.user.id, q, limit)}


class UnfurlRequest(BaseModel):
    url: Annotated[str, Field(max_length=2048, pattern=r"^https?://")]


@router.post("/unfurl")
async def unfurl(body: UnfurlRequest, auth: AuthDep) -> dict:
    return await unfurl_service.unfurl(body.url)
