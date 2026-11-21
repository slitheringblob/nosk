"""Daily journal pages, template blocks and user settings."""

from uuid import uuid4

from tests.conftest import User, make_page
from tests.sync.test_sync_api import op, push


def test_journal_date_round_trips_and_is_unique_per_user(alice: User, bob: User) -> None:
    first = make_page(alice, "2026-10-19 · Mon", journal_date="2026-10-19")
    assert first["journal_date"] == "2026-10-19"
    # A second page for the same day (different id) is kept as a normal page, not rejected.
    clash = make_page(alice, "Another entry", journal_date="2026-10-19")
    assert clash["journal_date"] is None
    # Other users have their own calendar.
    assert make_page(bob, "Bob's day", journal_date="2026-10-19")["journal_date"] == "2026-10-19"
    assert alice.post("/api/pages", {"title": "x", "journal_date": "2026-02-30"}).status_code == 422


def test_duplicates_are_not_journal_entries(alice: User) -> None:
    page = make_page(alice, "Day", journal_date="2026-10-19")
    copy = alice.post(f"/api/pages/{page['id']}/duplicate", {}).json()
    assert copy["journal_date"] is None


def test_two_devices_creating_the_same_day_converge(alice: User) -> None:
    phone = alice.second_device()
    page_id, block_id = str(uuid4()), str(uuid4())
    for device in (alice, phone):
        result = push(
            device,
            op("create_page", page_id, title="2026-10-19 · Mon", journal_date="2026-10-19"),
            op(
                "create_component",
                page_id,
                block_id,
                type="heading",
                content={"text": "Plan", "level": 2},
            ),
        )
        assert result["conflicts"] == [], result
    pages = alice.get("/api/pages").json()["pages"]
    assert [p["journal_date"] for p in pages] == ["2026-10-19"]
    assert len(alice.get(f"/api/pages/{page_id}/components").json()["components"]) == 1


def test_recreating_a_trashed_day_restores_it(alice: User) -> None:
    page_id = str(uuid4())
    push(alice, op("create_page", page_id, title="Day", journal_date="2026-10-20"))
    alice.delete(f"/api/pages/{page_id}")
    phone = alice.second_device()
    assert (
        push(phone, op("create_page", page_id, title="Day", journal_date="2026-10-20"))["conflicts"]
        == []
    )
    assert alice.get(f"/api/pages/{page_id}").json()["deleted"] is False


def test_template_blocks(alice: User, bob: User) -> None:
    builtin = alice.get("/api/templates/builtin-daily-journal").json()
    assert builtin["builtin"] is True
    assert [b["type"] for b in builtin["blocks"]][:2] == ["date", "heading"]

    source = make_page(alice, "My day", is_template=True)
    alice.post(
        f"/api/pages/{source['id']}/components",
        {"type": "heading", "content": {"text": "Wins", "level": 2}},
    )
    mine = alice.get(f"/api/templates/{source['id']}").json()
    assert mine["blocks"] == [
        {
            "type": "heading",
            "content": {"text": "Wins", "level": 2},
            "parent_index": None,
            "slot": 0,
        }
    ]

    plain = make_page(alice, "Not a template")
    assert alice.get(f"/api/templates/{plain['id']}").status_code == 404
    assert bob.get(f"/api/templates/{source['id']}").status_code == 404
    assert alice.get("/api/templates/nope").status_code == 404


def test_settings(alice: User, bob: User) -> None:
    first = alice.get("/api/auth/settings").json()
    assert first["journal_template_id"] == "builtin-daily-journal"
    assert len(first["journal_salt"]) == 32
    assert alice.get("/api/auth/settings").json()["journal_salt"] == first["journal_salt"]
    assert bob.get("/api/auth/settings").json()["journal_salt"] != first["journal_salt"]

    template = make_page(alice, "Mine", is_template=True)
    updated = alice.put("/api/auth/settings", {"journal_template_id": template["id"]}).json()
    assert updated["journal_template_id"] == template["id"]
    assert updated["journal_salt"] == first["journal_salt"]
    assert (
        alice.put("/api/auth/settings", {"journal_template_id": None}).json()["journal_template_id"]
        is None
    )

    # Someone else's template, or a page that isn't a template, is refused.
    bobs = make_page(bob, "Bob's", is_template=True)
    assert alice.put("/api/auth/settings", {"journal_template_id": bobs["id"]}).status_code == 422
    plain = make_page(alice, "Plain")
    assert alice.put("/api/auth/settings", {"journal_template_id": plain["id"]}).status_code == 422


def test_simultaneous_creation_race_is_absorbed(alice: User, monkeypatch) -> None:
    """The second of two concurrent creates hits the unique constraint and is retried."""

    from app.api import sync as sync_api
    from app.models import Page
    from app.services import page_service, sync_service

    page_id = str(uuid4())
    real_create = page_service.create_page
    calls = {"n": 0}

    async def racing_create(session, actor, fields, blocks=None):
        calls["n"] += 1
        if calls["n"] == 1:
            # Another device's request commits the same page between our check and insert.
            async with sync_api.async_session_factory() as other:
                other.add(
                    Page(
                        id=page_id,
                        user_id=actor.user_id,
                        title="Day",
                        journal_date="2026-10-22",
                        component_ids=[],
                        created_at=1,
                        updated_at=1,
                        version=0,
                        deleted=False,
                        tags=[],
                        is_template=False,
                    )
                )
                await other.commit()
        return await real_create(session, actor, fields, blocks)

    monkeypatch.setattr(sync_service.page_service, "create_page", racing_create)
    result = push(alice, op("create_page", page_id, title="Day", journal_date="2026-10-22"))
    assert result["conflicts"] == []
    assert result["synced"] == 1
    assert [p["id"] for p in alice.get("/api/pages").json()["pages"]] == [page_id]


def test_pages_remember_their_template(alice: User) -> None:
    from_builtin = alice.post(
        "/api/pages/from-template", {"template_id": "builtin-meeting-notes"}
    ).json()
    assert from_builtin["template_id"] == "builtin-meeting-notes"
    assert from_builtin["title"] == "Meeting notes"

    template = make_page(alice, "Weekly review", is_template=True)
    from_mine = alice.post("/api/pages/from-template", {"template_id": template["id"]}).json()
    assert from_mine["template_id"] == template["id"]
    assert from_mine["title"] == "Weekly review"  # the template's name, not "(copy)"
    assert from_mine["is_template"] is False

    # Copies stay with their template; saving as a template starts a new one.
    copy = alice.post(f"/api/pages/{from_mine['id']}/duplicate", {}).json()
    assert copy["template_id"] == template["id"]
    as_template = alice.post(
        f"/api/pages/{from_mine['id']}/duplicate", {"as_template": True}
    ).json()
    assert as_template["template_id"] is None
    assert make_page(alice, "Scratch")["template_id"] is None

    # Journal pages created through sync carry their template too.
    page_id = str(uuid4())
    push(
        alice,
        op(
            "create_page",
            page_id,
            title="Day",
            journal_date="2026-10-23",
            template_id="builtin-daily-journal",
        ),
    )
    assert alice.get(f"/api/pages/{page_id}").json()["template_id"] == "builtin-daily-journal"
