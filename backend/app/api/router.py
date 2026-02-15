"""Root API router placeholder."""

from fastapi import APIRouter


api_router = APIRouter(prefix="/api")


@api_router.get("/health", tags=["health"])
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}
