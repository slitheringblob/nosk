"""Media uploads stored on local disk behind short-lived signed upload URLs.

The API shape (request URL -> PUT bytes -> reference asset_id) matches object-storage pre-signed
uploads, so swapping in S3/R2 later only changes this module.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Component, MediaAsset
from app.services.access import accessible_page_ids_query
from app.utils.errors import APIError, NotFound
from app.utils.security import TokenError, create_token, decode_token
from app.utils.time import now_ms

UPLOAD_URL_MINUTES = 5
ALLOWED_MIME_PREFIXES = ("image/", "audio/", "video/", "text/")
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/zip",
    "application/json",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/octet-stream",
}
# Types a browser may render inline without risking script execution in our origin.
INLINE_SAFE_TYPES = {
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "application/pdf",
    "audio/mpeg",
    "audio/ogg",
    "video/mp4",
    "video/webm",
}


def media_root() -> Path:
    root = Path(settings.media_root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def asset_path(asset: MediaAsset) -> Path:
    return media_root() / asset.user_id / asset.id


def _check_mime(mime_type: str) -> None:
    if not (mime_type.startswith(ALLOWED_MIME_PREFIXES) or mime_type in ALLOWED_MIME_TYPES):
        raise APIError(f"Files of type {mime_type} are not allowed")


async def request_upload(
    session: AsyncSession,
    user_id: str,
    mime_type: str,
    file_size: int,
    checksum: str | None,
    filename: str | None,
) -> dict:
    _check_mime(mime_type)
    if file_size <= 0 or file_size > settings.max_upload_bytes:
        raise APIError(f"Files must be between 1 byte and {settings.max_upload_bytes} bytes")
    expires_at = now_ms() + UPLOAD_URL_MINUTES * 60_000
    asset = MediaAsset(
        user_id=user_id,
        mime_type=mime_type,
        file_size=file_size,
        checksum=checksum,
        filename=filename,
        status="pending",
        created_at=now_ms(),
        upload_expires_at=expires_at,
    )
    session.add(asset)
    await session.flush()
    token = create_token("upload", asset.id, UPLOAD_URL_MINUTES, uid=user_id)
    await session.commit()
    return {
        "upload_url": f"/api/media/upload/{asset.id}?token={token}",
        "asset_id": asset.id,
        "expires_at": expires_at,
        "headers": {"Content-Type": mime_type},
    }


async def complete_upload(
    session: AsyncSession, asset_id: str, token: str, body: bytes
) -> MediaAsset:
    try:
        payload = decode_token(token, "upload")
    except TokenError as exc:
        raise APIError(
            "Upload URL is invalid or expired", status_code=403, code="AUTHORIZATION_ERROR"
        ) from exc
    asset = await session.get(MediaAsset, asset_id)
    if asset is None or payload["sub"] != asset_id or payload.get("uid") != asset.user_id:
        raise NotFound("Upload not found")
    if asset.status != "pending":
        raise APIError("Upload URLs are single-use")
    if len(body) != asset.file_size:
        raise APIError("Uploaded size does not match the declared file_size")
    if asset.checksum:
        algorithm, _, expected = asset.checksum.partition(":")
        if algorithm != "sha256" or hashlib.sha256(body).hexdigest() != expected.lower():
            raise APIError("Checksum mismatch")
    path = asset_path(asset)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    asset.status = "ready"
    await session.commit()
    return asset


async def get_readable_asset(session: AsyncSession, user_id: str, asset_id: str) -> MediaAsset:
    """Owners can always read; others only if the asset is used on a page they can access."""

    asset = await session.get(MediaAsset, asset_id)
    if asset is None or asset.status != "ready":
        raise NotFound("File not found")
    if asset.user_id == user_id:
        return asset
    referenced = await session.scalar(
        select(Component.id)
        .where(
            Component.page_id.in_(accessible_page_ids_query(user_id)),
            or_(Component.type == "image", Component.type == "file"),
            Component.content["asset_id"].as_string() == asset_id,
        )
        .limit(1)
    )
    if referenced is None:
        raise NotFound("File not found")
    return asset
