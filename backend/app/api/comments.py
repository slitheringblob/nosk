"""Comment endpoints addressed by comment id."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import AuthDep, SessionDep
from app.schemas.page import CommentOut, CommentUpdate
from app.services import comment_service
from app.services.access import get_page
from app.services.realtime import commit_and_publish

router = APIRouter(prefix="/comments", tags=["comments"])


@router.put("/{comment_id}", response_model=CommentOut)
async def update_comment(
    comment_id: str, body: CommentUpdate, auth: AuthDep, db: SessionDep
) -> dict:
    comment = await comment_service.get_comment(db, comment_id)
    page, role = await get_page(db, auth.user.id, comment.page_id)
    data = await comment_service.update_comment(
        db, auth.actor(), page, role, comment, body.body, body.resolved
    )
    await commit_and_publish(db)
    return data


@router.delete("/{comment_id}")
async def delete_comment(comment_id: str, auth: AuthDep, db: SessionDep) -> dict:
    comment = await comment_service.get_comment(db, comment_id)
    page, _ = await get_page(db, auth.user.id, comment.page_id)
    await comment_service.delete_comment(db, auth.actor(), page, comment)
    await commit_and_publish(db)
    return {"message": "Comment deleted", "comment_id": comment_id}
