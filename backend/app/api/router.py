"""Root API router."""

from fastapi import APIRouter

from app.api import auth, comments, components, media, misc, pages, sync

api_router = APIRouter(prefix="/api")


@api_router.get("/health", tags=["health"])
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


api_router.include_router(auth.router)
api_router.include_router(pages.router)
api_router.include_router(components.router)
api_router.include_router(comments.router)
api_router.include_router(sync.router)
api_router.include_router(media.router)
api_router.include_router(misc.router)
