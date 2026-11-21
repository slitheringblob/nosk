"""Page endpoints, including sharing, history, comments, templates and import/export."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query, status
from fastapi.responses import PlainTextResponse
from sqlalchemy import String, and_, cast, func, or_, select

from app.api.deps import AuthDep, SessionDep
from app.models import Component, Page, PageShare, PageSnapshot, SyncOperation, User
from app.schemas.component import ComponentCreate, ComponentList, ComponentOut, ReorderRequest
from app.schemas.page import (
    CommentCreate,
    CommentOut,
    DuplicateRequest,
    FromTemplateRequest,
    ImportRequest,
    PageCreate,
    PageList,
    PageOut,
    PageUpdate,
    ShareCreate,
    ShareOut,
    SnapshotCreate,
    SnapshotOut,
)
from app.services import (
    comment_service,
    component_service,
    export_service,
    page_service,
    share_service,
    snapshot_service,
)
from app.services.access import accessible_page_ids_query, get_page, owner_email
from app.services.realtime import commit_and_publish
from app.services.serializers import serialize_component, serialize_page
from app.services.templates import builtin_templates, get_builtin
from app.utils.errors import APIError, NotFound

router = APIRouter(tags=["pages"])

SORT_COLUMNS = {"created_at": Page.created_at, "updated_at": Page.updated_at, "title": Page.title}


async def _page_out(db: SessionDep, page: Page, role: str) -> dict:
    email = None if role == "owner" else await owner_email(db, page)
    return serialize_page(page, role, email)


@router.get("/pages", response_model=PageList)
async def list_pages(
    auth: AuthDep,
    db: SessionDep,
    deleted: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    sort: Literal["created_at", "updated_at", "title"] = "updated_at",
    order: Literal["asc", "desc"] = "desc",
    scope: Literal["all", "owned", "shared"] = "all",
    tag: Annotated[str | None, Query(max_length=50)] = None,
    is_template: bool | None = None,
) -> dict:
    user_id = auth.user.id
    share_join = and_(PageShare.page_id == Page.id, PageShare.user_id == user_id)
    query = (
        select(Page, PageShare.role, User.email)
        .outerjoin(PageShare, share_join)
        .join(User, User.id == Page.user_id)
        .where(Page.deleted.is_(deleted))
    )
    if scope == "owned":
        query = query.where(Page.user_id == user_id)
    elif scope == "shared":
        query = query.where(PageShare.id.is_not(None))
    else:
        query = query.where(or_(Page.user_id == user_id, PageShare.id.is_not(None)))
    if tag:
        query = query.where(cast(Page.tags, String).like(f'%"{tag.strip().lower()}"%'))
    if is_template is not None:
        query = query.where(Page.is_template.is_(is_template))

    total = await db.scalar(select(func.count()).select_from(query.subquery()))
    column = SORT_COLUMNS[sort]
    query = query.order_by(column.asc() if order == "asc" else column.desc())
    rows = (await db.execute(query.limit(limit).offset(offset))).all()
    pages = [
        serialize_page(
            page,
            "owner" if page.user_id == user_id else role,
            None if page.user_id == user_id else email,
        )
        for page, role, email in rows
    ]
    return {"pages": pages, "total": total or 0, "limit": limit, "offset": offset}


@router.get("/tags")
async def list_tags(auth: AuthDep, db: SessionDep) -> dict:
    rows = await db.scalars(
        select(Page.tags).where(
            Page.id.in_(accessible_page_ids_query(auth.user.id)), Page.deleted.is_(False)
        )
    )
    counts: dict[str, int] = {}
    for tags in rows:
        for tag in tags or []:
            counts[tag] = counts.get(tag, 0) + 1
    return {"tags": [{"tag": t, "count": c} for t, c in sorted(counts.items())]}


@router.post("/pages", response_model=PageOut, status_code=status.HTTP_201_CREATED)
async def create_page(body: PageCreate, auth: AuthDep, db: SessionDep) -> dict:
    page, _ = await page_service.create_page(db, auth.actor(), body.model_dump())
    await commit_and_publish(db)
    return serialize_page(page)


@router.get("/pages/{page_id}", response_model=PageOut)
async def get_page_detail(page_id: str, auth: AuthDep, db: SessionDep) -> dict:
    page, role = await get_page(db, auth.user.id, page_id)
    return await _page_out(db, page, role)


@router.put("/pages/{page_id}", response_model=PageOut)
async def update_page(page_id: str, body: PageUpdate, auth: AuthDep, db: SessionDep) -> dict:
    page, role = await get_page(db, auth.user.id, page_id, "edit")
    fields = body.model_dump(exclude_unset=True)
    if role != "owner":
        fields.pop("is_template", None)
    await page_service.update_page(db, auth.actor(), page, fields)
    await commit_and_publish(db)
    return await _page_out(db, page, role)


@router.delete("/pages/{page_id}")
async def delete_page(page_id: str, auth: AuthDep, db: SessionDep, permanent: bool = False) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id, "owner")
    await page_service.delete_page(db, auth.actor(), page, permanent)
    await commit_and_publish(db)
    return {"message": "Page deleted successfully", "page_id": page_id, "permanent": permanent}


@router.post("/pages/{page_id}/restore")
async def restore_page(page_id: str, auth: AuthDep, db: SessionDep) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id, "owner")
    await page_service.restore_page(db, auth.actor(), page)
    await commit_and_publish(db)
    return {"message": "Page restored successfully", "page": serialize_page(page)}


@router.post("/pages/{page_id}/duplicate", response_model=PageOut, status_code=201)
async def duplicate_page(
    page_id: str, body: DuplicateRequest, auth: AuthDep, db: SessionDep
) -> dict:
    source, _ = await get_page(db, auth.user.id, page_id)
    page, _ = await page_service.duplicate_page(
        db, auth.actor(), source, body.title, body.as_template
    )
    await commit_and_publish(db)
    return serialize_page(page)


# --- Components -----------------------------------------------------------------------------


@router.get("/pages/{page_id}/components", response_model=ComponentList)
async def list_components(page_id: str, auth: AuthDep, db: SessionDep) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id)
    components = await snapshot_service.load_components(db, page.id)
    return {
        "components": [serialize_component(c) for c in components],
        "total": len(components),
        "page_id": page.id,
    }


@router.post("/pages/{page_id}/components", response_model=ComponentOut, status_code=201)
async def create_component(
    page_id: str, body: ComponentCreate, auth: AuthDep, db: SessionDep
) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id, "edit")
    component = await component_service.create_component(db, auth.actor(), page, body.model_dump())
    await commit_and_publish(db)
    return serialize_component(component, page.version)


@router.put("/pages/{page_id}/reorder")
async def reorder_components(
    page_id: str, body: ReorderRequest, auth: AuthDep, db: SessionDep
) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id, "edit")
    ids = await component_service.reorder_components(
        db, auth.actor(), page, body.component_ids, strict=True
    )
    await commit_and_publish(db)
    return {
        "message": "Components reordered successfully",
        "page_id": page.id,
        "component_ids": ids,
        "page_version": page.version,
    }


# --- Templates, import & export -------------------------------------------------------------


@router.get("/templates")
async def list_templates(auth: AuthDep, db: SessionDep) -> dict:
    user_templates = await db.scalars(
        select(Page)
        .where(Page.user_id == auth.user.id, Page.is_template.is_(True), Page.deleted.is_(False))
        .order_by(Page.title)
    )
    builtins = [
        {
            "id": t["id"],
            "title": t["title"],
            "icon": t["icon"],
            "description": t["description"],
            "builtin": True,
        }
        for t in builtin_templates()
    ]
    mine = [
        {"id": p.id, "title": p.title, "icon": p.icon, "description": "", "builtin": False}
        for p in user_templates
    ]
    return {"templates": builtins + mine}


@router.get("/templates/{template_id}")
async def get_template(template_id: str, auth: AuthDep, db: SessionDep) -> dict:
    """A template's blocks, so clients can build pages from it offline (daily journal)."""

    builtin = get_builtin(template_id)
    if builtin:
        return {
            "id": builtin["id"],
            "title": builtin["title"],
            "icon": builtin["icon"],
            "builtin": True,
            "blocks": builtin["blocks"],
        }
    page, _ = await get_page(db, auth.user.id, template_id)
    if not page.is_template:
        raise NotFound("Template not found")
    components = await snapshot_service.load_components(db, page.id)
    return {
        "id": page.id,
        "title": page.title,
        "icon": page.icon,
        "builtin": False,
        "blocks": page_service.blocks_from_components(components),
    }


@router.post("/pages/from-template", response_model=PageOut, status_code=201)
async def create_from_template(body: FromTemplateRequest, auth: AuthDep, db: SessionDep) -> dict:
    builtin = get_builtin(body.template_id)
    actor = auth.actor()
    if builtin:
        fields = {
            "title": body.title or builtin["title"],
            "icon": builtin["icon"],
            "template_id": builtin["id"],
        }
        page, _ = await page_service.create_page(db, actor, fields, builtin["blocks"])
    else:
        source, _ = await get_page(db, auth.user.id, body.template_id)
        if not source.is_template:
            raise APIError("That page is not a template")
        page, _ = await page_service.duplicate_page(
            db, actor, source, body.title or source.title, False
        )
    await commit_and_publish(db)
    return serialize_page(page)


@router.post("/pages/import", response_model=PageOut, status_code=201)
async def import_page(body: ImportRequest, auth: AuthDep, db: SessionDep) -> dict:
    fields: dict = {}
    if body.format == "markdown":
        title, blocks = export_service.import_markdown(body.content)
    else:
        title, fields, blocks = export_service.import_json(body.content)
    fields = {k: v for k, v in fields.items() if v is not None}
    fields["title"] = (body.title or title or "Imported page")[:200]
    page, _ = await page_service.create_page(db, auth.actor(), fields, blocks)
    await commit_and_publish(db)
    return serialize_page(page)


@router.get("/pages/{page_id}/export")
async def export_page(
    page_id: str,
    auth: AuthDep,
    db: SessionDep,
    format: Literal["markdown", "json"] = "markdown",
):
    page, _ = await get_page(db, auth.user.id, page_id)
    components = await snapshot_service.load_components(db, page.id)
    safe_name = "".join(ch for ch in page.title if ch.isalnum() or ch in " -_").strip() or "page"
    if format == "json":
        return export_service.export_json(page, components)
    return PlainTextResponse(
        export_service.export_markdown(page, components),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.md"'},
    )


# --- Sharing --------------------------------------------------------------------------------


@router.get("/pages/{page_id}/shares", response_model=list[ShareOut])
async def list_shares(page_id: str, auth: AuthDep, db: SessionDep) -> list[dict]:
    page, _ = await get_page(db, auth.user.id, page_id)
    return await share_service.list_shares(db, page)


@router.post("/pages/{page_id}/shares", response_model=ShareOut, status_code=201)
async def share_page(page_id: str, body: ShareCreate, auth: AuthDep, db: SessionDep) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id, "owner")
    share = await share_service.share_page(db, auth.actor(), page, body.email, body.role)
    await commit_and_publish(db)
    return share


@router.delete("/pages/{page_id}/shares/{user_id}")
async def unshare_page(page_id: str, user_id: str, auth: AuthDep, db: SessionDep) -> dict:
    # Owners can remove anyone; collaborators can remove themselves (leave the page).
    need = "view" if user_id == auth.user.id else "owner"
    page, _ = await get_page(db, auth.user.id, page_id, need)
    await share_service.unshare_page(db, auth.actor(), page, user_id)
    await commit_and_publish(db)
    return {"message": "Share removed", "page_id": page_id, "user_id": user_id}


# --- Version history ------------------------------------------------------------------------


def _snapshot_out(snapshot: PageSnapshot) -> dict:
    return {
        "id": snapshot.id,
        "page_id": snapshot.page_id,
        "version": snapshot.version,
        "created_at": snapshot.created_at,
        "created_by": snapshot.created_by,
        "label": snapshot.label,
        "is_auto": snapshot.is_auto,
        "title": snapshot.title,
        "component_count": len(snapshot.data.get("components", [])),
    }


@router.get("/pages/{page_id}/versions", response_model=list[SnapshotOut])
async def list_versions(page_id: str, auth: AuthDep, db: SessionDep) -> list[dict]:
    page, _ = await get_page(db, auth.user.id, page_id)
    rows = await db.scalars(
        select(PageSnapshot)
        .where(PageSnapshot.page_id == page.id)
        .order_by(PageSnapshot.created_at.desc())
        .limit(200)
    )
    return [_snapshot_out(s) for s in rows]


@router.post("/pages/{page_id}/versions", response_model=SnapshotOut, status_code=201)
async def create_version(page_id: str, body: SnapshotCreate, auth: AuthDep, db: SessionDep) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id, "edit")
    snapshot = await snapshot_service.create_snapshot(db, page, auth.user.id, body.label)
    await db.commit()
    return _snapshot_out(snapshot)


async def _snapshot(db: SessionDep, page: Page, snapshot_id: str) -> PageSnapshot:
    snapshot = await db.get(PageSnapshot, snapshot_id)
    if snapshot is None or snapshot.page_id != page.id:
        raise NotFound("Version not found")
    return snapshot


@router.get("/pages/{page_id}/versions/{snapshot_id}")
async def get_version(page_id: str, snapshot_id: str, auth: AuthDep, db: SessionDep) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id)
    snapshot = await _snapshot(db, page, snapshot_id)
    return {**_snapshot_out(snapshot), "data": snapshot.data}


@router.post("/pages/{page_id}/versions/{snapshot_id}/restore")
async def restore_version(page_id: str, snapshot_id: str, auth: AuthDep, db: SessionDep) -> dict:
    page, role = await get_page(db, auth.user.id, page_id, "edit")
    snapshot = await _snapshot(db, page, snapshot_id)
    components = await snapshot_service.restore_snapshot(db, auth.actor(), page, snapshot)
    await commit_and_publish(db)
    return {
        "page": await _page_out(db, page, role),
        "components": [serialize_component(c) for c in components],
    }


# --- Activity & backlinks -------------------------------------------------------------------


@router.get("/pages/{page_id}/activity")
async def page_activity(
    page_id: str,
    auth: AuthDep,
    db: SessionDep,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    before: int | None = None,
) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id)
    query = (
        select(SyncOperation, User.email)
        .join(User, User.id == SyncOperation.user_id)
        .where(SyncOperation.page_id == page.id)
    )
    if before is not None:
        query = query.where(SyncOperation.id < before)
    rows = (await db.execute(query.order_by(SyncOperation.id.desc()).limit(limit))).all()
    return {
        "activity": [
            {
                "seq": op.id,
                "type": op.operation_type,
                "entity_type": op.entity_type,
                "entity_id": op.entity_id,
                "page_version": op.page_version,
                "timestamp": op.timestamp,
                "device_id": op.device_id,
                "user_id": op.user_id,
                "user_email": email,
                "component_type": ((op.data or {}).get("component") or {}).get("type"),
            }
            for op, email in rows
        ]
    }


@router.get("/pages/{page_id}/backlinks")
async def backlinks(page_id: str, auth: AuthDep, db: SessionDep) -> dict:
    page, _ = await get_page(db, auth.user.id, page_id)
    rows = (
        await db.execute(
            select(Page.id, Page.title, Page.icon, Component.id)
            .join(Component, Component.page_id == Page.id)
            .where(
                Page.id.in_(accessible_page_ids_query(auth.user.id)),
                Page.deleted.is_(False),
                Component.type == "page-link",
                Component.content["page_id"].as_string() == page.id,
            )
        )
    ).all()
    seen: dict[str, dict] = {}
    for pid, title, icon, component_id in rows:
        seen.setdefault(
            pid, {"page_id": pid, "title": title, "icon": icon, "component_id": component_id}
        )
    return {"backlinks": list(seen.values())}


# --- Comments -------------------------------------------------------------------------------


@router.get("/pages/{page_id}/comments", response_model=list[CommentOut])
async def list_comments(page_id: str, auth: AuthDep, db: SessionDep) -> list[dict]:
    page, _ = await get_page(db, auth.user.id, page_id)
    return await comment_service.list_comments(db, page.id)


@router.post("/pages/{page_id}/comments", response_model=CommentOut, status_code=201)
async def add_comment(page_id: str, body: CommentCreate, auth: AuthDep, db: SessionDep) -> dict:
    # Viewers may comment; commenting doesn't change page content.
    page, _ = await get_page(db, auth.user.id, page_id)
    comment = await comment_service.add_comment(
        db, auth.actor(), page, auth.user, body.component_id, body.body
    )
    await commit_and_publish(db)
    return comment
