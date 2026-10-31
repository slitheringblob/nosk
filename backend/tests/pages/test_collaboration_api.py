"""Sharing, comments, version history, activity and backlinks."""

from uuid import uuid4

from tests.conftest import User, add_component, make_page
from tests.sync.test_sync_api import op, pull, push


def test_share_with_editor(alice: User, bob: User) -> None:
    page = make_page(alice, "Shared")
    add_component(alice, page["id"], "divider")
    cursor = bob.get("/api/sync/bootstrap").json()["cursor"]
    share = alice.post(f"/api/pages/{page['id']}/shares", {"email": bob.email, "role": "editor"})
    assert share.status_code == 201

    shared_change = pull(bob, cursor)["changes"][-1]
    assert shared_change["type"] == "page_shared"
    assert len(shared_change["data"]["components"]) == 1

    listed = bob.get("/api/pages", params={"scope": "shared"}).json()["pages"]
    assert listed[0]["role"] == "editor"
    assert listed[0]["owner_email"] == alice.email
    assert bob.get(f"/api/pages/{page['id']}").json()["role"] == "editor"

    component = add_component(bob, page["id"], "text-block", {"text": "from bob"})
    alice_view = alice.get(f"/api/pages/{page['id']}/components").json()["components"]
    assert component["id"] in [c["id"] for c in alice_view]

    # Editors can't delete or re-share the page.
    assert bob.delete(f"/api/pages/{page['id']}").status_code == 403
    assert bob.post(f"/api/pages/{page['id']}/shares", {"email": alice.email}).status_code == 403


def test_viewer_is_read_only(alice: User, bob: User) -> None:
    page = make_page(alice)
    alice.post(f"/api/pages/{page['id']}/shares", {"email": bob.email, "role": "viewer"})
    assert bob.get(f"/api/pages/{page['id']}/components").status_code == 200
    assert bob.post(f"/api/pages/{page['id']}/components", {"type": "divider"}).status_code == 403
    result = push(bob, op("create_component", page["id"], str(uuid4()), type="divider", content={}))
    assert result["conflicts"][0]["reason"] == "forbidden"


def test_unshare_notifies_target(alice: User, bob: User) -> None:
    page = make_page(alice)
    alice.post(f"/api/pages/{page['id']}/shares", {"email": bob.email})
    cursor = bob.get("/api/sync/bootstrap").json()["cursor"]
    assert alice.delete(f"/api/pages/{page['id']}/shares/{bob.id}").status_code == 200
    changes = pull(bob, cursor)["changes"]
    assert changes[-1]["type"] == "page_unshared"
    assert bob.get(f"/api/pages/{page['id']}").status_code == 404


def test_collaborator_can_leave(alice: User, bob: User) -> None:
    page = make_page(alice)
    alice.post(f"/api/pages/{page['id']}/shares", {"email": bob.email})
    assert bob.delete(f"/api/pages/{page['id']}/shares/{bob.id}").status_code == 200
    assert alice.get(f"/api/pages/{page['id']}/shares").json() == []


def test_share_errors(alice: User) -> None:
    page = make_page(alice)
    assert (
        alice.post(f"/api/pages/{page['id']}/shares", {"email": "ghost@example.com"}).status_code
        == 404
    )
    assert alice.post(f"/api/pages/{page['id']}/shares", {"email": alice.email}).status_code == 400


def test_comments(alice: User, bob: User) -> None:
    page = make_page(alice)
    component = add_component(alice, page["id"])
    alice.post(f"/api/pages/{page['id']}/shares", {"email": bob.email, "role": "viewer"})
    comment = bob.post(
        f"/api/pages/{page['id']}/comments", {"component_id": component["id"], "body": "Typo here"}
    ).json()
    assert comment["author_email"] == bob.email
    assert alice.put(f"/api/comments/{comment['id']}", {"body": "edited"}).status_code == 403
    resolved = alice.put(f"/api/comments/{comment['id']}", {"resolved": True}).json()
    assert resolved["resolved"] is True
    listed = alice.get(f"/api/pages/{page['id']}/comments").json()
    assert len(listed) == 1
    assert alice.delete(f"/api/comments/{comment['id']}").status_code == 200
    bad = alice.post(f"/api/pages/{page['id']}/comments", {"component_id": "nope", "body": "x"})
    assert bad.status_code == 422


def test_version_history_and_restore(alice: User) -> None:
    page = make_page(alice)
    component = add_component(alice, page["id"], "text-block", {"text": "v1"})
    manual = alice.post(f"/api/pages/{page['id']}/versions", {"label": "Before rewrite"}).json()
    assert manual["component_count"] == 1
    alice.put(f"/api/components/{component['id']}", {"content": {"text": "v2"}})
    add_component(alice, page["id"], "divider")

    versions = alice.get(f"/api/pages/{page['id']}/versions").json()
    assert versions[0]["label"] == "Before rewrite"
    detail = alice.get(f"/api/pages/{page['id']}/versions/{manual['id']}").json()
    assert detail["data"]["components"][0]["content"]["text"] == "v1"

    restored = alice.post(f"/api/pages/{page['id']}/versions/{manual['id']}/restore").json()
    assert [c["content"].get("text") for c in restored["components"]] == ["v1"]
    assert alice.get(f"/api/components/{component['id']}").json()["content"]["text"] == "v1"
    labels = [v["label"] for v in alice.get(f"/api/pages/{page['id']}/versions").json()]
    assert "Before restore" in labels


def test_auto_snapshot_before_first_edit(alice: User) -> None:
    page = make_page(alice)
    add_component(alice, page["id"], "divider")
    add_component(alice, page["id"], "divider")
    versions = alice.get(f"/api/pages/{page['id']}/versions").json()
    # One auto snapshot taken before the second edit; the interval suppresses further ones.
    assert [v["is_auto"] for v in versions] == [True]


def test_activity_and_backlinks(alice: User) -> None:
    target = make_page(alice, "Target")
    source = make_page(alice, "Source")
    add_component(alice, source["id"], "page-link", {"page_id": target["id"], "title": "Target"})
    activity = alice.get(f"/api/pages/{source['id']}/activity").json()["activity"]
    assert [a["type"] for a in activity] == ["component_created", "page_created"]
    assert activity[0]["user_email"] == alice.email
    assert activity[0]["component_type"] == "page-link"
    backlinks = alice.get(f"/api/pages/{target['id']}/backlinks").json()["backlinks"]
    assert [b["page_id"] for b in backlinks] == [source["id"]]
