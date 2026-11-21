"""Media upload and download endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.api.deps import AuthDep, SessionDep
from app.config import settings
from app.services import media_service
from app.utils.errors import APIError

router = APIRouter(prefix="/media", tags=["media"])


class UploadUrlRequest(BaseModel):
    mime_type: Annotated[str, Field(max_length=100, pattern=r"^[\w.+-]+/[\w.+-]+$")]
    file_size: Annotated[int, Field(gt=0)]
    checksum: Annotated[str, Field(max_length=100, pattern=r"^sha256:[0-9a-fA-F]{64}$")] | None = (
        None
    )
    filename: Annotated[str, Field(max_length=255)] | None = None


@router.post("/upload-url")
async def upload_url(body: UploadUrlRequest, auth: AuthDep, db: SessionDep) -> dict:
    return await media_service.request_upload(
        db, auth.user.id, body.mime_type.lower(), body.file_size, body.checksum, body.filename
    )


@router.put("/upload/{asset_id}")
async def upload(asset_id: str, token: str, request: Request, db: SessionDep) -> dict:
    declared = request.headers.get("content-length")
    if declared and int(declared) > settings.max_upload_bytes:
        raise APIError("File too large", status_code=413, code="PAYLOAD_TOO_LARGE")
    body = b""
    async for chunk in request.stream():
        body += chunk
        if len(body) > settings.max_upload_bytes:
            raise APIError("File too large", status_code=413, code="PAYLOAD_TOO_LARGE")
    asset = await media_service.complete_upload(db, asset_id, token, body)
    return {
        "asset_id": asset.id,
        "status": asset.status,
        "mime_type": asset.mime_type,
        "file_size": asset.file_size,
    }


@router.get("/{asset_id}")
async def download(asset_id: str, auth: AuthDep, db: SessionDep) -> FileResponse:
    asset = await media_service.get_readable_asset(db, auth.user.id, asset_id)
    inline = asset.mime_type in media_service.INLINE_SAFE_TYPES
    return FileResponse(
        media_service.asset_path(asset),
        media_type=asset.mime_type if inline else "application/octet-stream",
        filename=asset.filename or asset.id,
        content_disposition_type="inline" if inline else "attachment",
        headers={
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, max-age=86400",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )
