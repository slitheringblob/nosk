"""Sync protocol tests."""

from uuid import uuid4

from tests.conftest import User, add_component, make_page


def op(type_: str, page_id: str, component_id: str | None = None, version: int = 0, **data) -> dict:
    return {
        "operation_id": str(uuid4()),
        "type": type_,
        "page_id": page_id,
        "component_id": component_id,
        "page_version": version,
        "data": data,
    }


def push(user: User, *operations: dict) -> dict:
    response = user.post("/api/sync/push", {"operations": list(operations)})
    assert response.status_code == 200, response.text
    return response.json()


def pull(user: User, cursor: int = 0) -> dict:
    response = user.get("/api/sync/pull", params={"cursor": cursor})
    assert response.status_code == 200, response.text
    return response.json()


def test_offline_created_page_syncs_to_other_device(alice: User) -> None:
    phone = alice.second_device()
    start = phone.get("/api/sync/bootstrap").json()["cursor"]
    page_id, comp_id = str(uuid4()), str(uuid4())
    result = push(
        alice,
        op("create_page", page_id, title="Offline page"),
        op(
            "create_component", page_id, comp_id, type="heading", content={"text": "Hi", "level": 1}
        ),
        op("update_component", page_id, comp_id, version=1, content={"text": "Hello", "level": 1}),
    )
    assert result["synced"] == 3
    assert result["conflicts"] == []
    assert result["page_versions"] == {page_id: 2}
    assert list(result["op_versions"].values()) == [0, 1, 2]

    changes = pull(phone, start)
    assert [c["type"] for c in changes["changes"]] == [
        "page_created",
        "component_created",
        "component_updated",
    ]
    assert changes["changes"][-1]["data"]["component"]["content"]["text"] == "Hello"
    assert changes["changes"][0]["device_id"] == alice.device_id
    assert changes["cursor"] == changes["changes"][-1]["seq"]
    assert pull(phone, changes["cursor"])["changes"] == []
    assert changes["data_epoch"] == phone.get("/api/sync/bootstrap").json()["data_epoch"]


def test_push_is_idempotent(alice: User) -> None:
    page_id = str(uuid4())
    create = op("create_page", page_id, title="Once")
    push(alice, create)
    again = push(alice, create)
    assert again["synced"] == 1
    assert alice.get("/api/pages").json()["total"] == 1


def test_edits_to_different_components_do_not_conflict(alice: User) -> None:
    phone = alice.second_device()
    page = make_page(alice)
    a = add_component(alice, page["id"], "text-block", {"text": "a"})
    b = add_component(alice, page["id"], "text-block", {"text": "b"})
    base = 2
    push(alice, op("update_component", page["id"], a["id"], base, content={"text": "a2"}))
    result = push(phone, op("update_component", page["id"], b["id"], base, content={"text": "b2"}))
    assert result["conflicts"] == []


def test_concurrent_edit_to_same_component_conflicts(alice: User) -> None:
    phone = alice.second_device()
    page = make_page(alice)
    comp = add_component(alice, page["id"], "text-block", {"text": "original"})
    base = comp["page_version"]
    push(alice, op("update_component", page["id"], comp["id"], base, content={"text": "laptop"}))
    result = push(
        phone, op("update_component", page["id"], comp["id"], base, content={"text": "phone"})
    )
    assert result["synced"] == 0
    conflict = result["conflicts"][0]
    assert conflict["reason"] == "version_mismatch"
    assert conflict["resolution"] == "manual"
    assert conflict["server_data"]["content"]["text"] == "laptop"
    assert conflict["server_version"] == base + 1

    # Same device editing again after its own change is not a conflict.
    mine = push(
        alice, op("update_component", page["id"], comp["id"], base, content={"text": "laptop2"})
    )
    assert mine["conflicts"] == []

    # "Keep mine" resolution.
    forced = op("update_component", page["id"], comp["id"], base, content={"text": "phone wins"})
    forced["force"] = True
    assert push(phone, forced)["conflicts"] == []
    assert alice.get(f"/api/components/{comp['id']}").json()["content"]["text"] == "phone wins"


def test_editing_a_deleted_component_reports_entity_deleted(alice: User) -> None:
    phone = alice.second_device()
    page = make_page(alice)
    comp = add_component(alice, page["id"])
    alice.delete(f"/api/components/{comp['id']}")
    result = push(phone, op("update_component", page["id"], comp["id"], 1, content={"text": "x"}))
    assert result["conflicts"][0]["reason"] == "entity_deleted"


def test_invalid_operations_are_rejected_without_blocking_others(alice: User) -> None:
    page = make_page(alice)
    result = push(
        alice,
        op("create_component", page["id"], str(uuid4()), type="heading", content={"level": 99}),
        op("create_component", page["id"], str(uuid4()), type="divider", content={}),
    )
    assert result["synced"] == 1
    assert result["conflicts"][0]["reason"] == "invalid"
    assert result["conflicts"][0]["resolution"] == "rejected"


def test_reorder_merges_unknown_components(alice: User) -> None:
    phone = alice.second_device()
    page = make_page(alice)
    a = add_component(alice, page["id"], "divider")
    b = add_component(alice, page["id"], "divider")
    c = add_component(phone, page["id"], "divider")  # phone's laptop doesn't know about c yet
    push(alice, op("reorder_components", page["id"], version=2, component_ids=[b["id"], a["id"]]))
    ids = alice.get(f"/api/pages/{page['id']}").json()["component_ids"]
    assert ids == [b["id"], a["id"], c["id"]]


def test_move_and_delete_through_push(alice: User) -> None:
    page = make_page(alice)
    toggle = add_component(alice, page["id"], "toggle")
    text = add_component(alice, page["id"], "text-block")
    push(
        alice,
        op(
            "move_component",
            page["id"],
            text["id"],
            2,
            parent_id=toggle["id"],
            slot=0,
            after_id=toggle["id"],
        ),
    )
    assert alice.get(f"/api/components/{text['id']}").json()["parent_id"] == toggle["id"]
    push(alice, op("delete_component", page["id"], toggle["id"], 3))
    assert alice.get(f"/api/pages/{page['id']}/components").json()["components"] == []


def test_page_operations_through_push(alice: User) -> None:
    page = make_page(alice)
    push(alice, op("update_page", page["id"], version=0, title="Renamed", tags=["a"]))
    assert alice.get(f"/api/pages/{page['id']}").json()["title"] == "Renamed"
    push(alice, op("delete_page", page["id"]))
    assert alice.get(f"/api/pages/{page['id']}").json()["deleted"] is True
    push(alice, op("restore_page", page["id"]))
    assert alice.get(f"/api/pages/{page['id']}").json()["deleted"] is False
    push(alice, op("delete_page", page["id"], permanent=True))
    assert alice.get(f"/api/pages/{page['id']}").status_code == 404


def test_permanent_delete_is_visible_to_other_devices(alice: User) -> None:
    phone = alice.second_device()
    page = make_page(alice)
    cursor = phone.get("/api/sync/bootstrap").json()["cursor"]
    alice.delete(f"/api/pages/{page['id']}", params={"permanent": True})
    changes = pull(phone, cursor)["changes"]
    assert changes[-1]["type"] == "page_deleted"
    assert changes[-1]["data"] == {"permanent": True}


def test_other_users_cannot_push_to_my_pages(alice: User, bob: User) -> None:
    page = make_page(alice)
    result = push(bob, op("update_page", page["id"], title="mine now"))
    assert result["conflicts"][0]["reason"] == "forbidden"
    assert pull(bob)["changes"] == []


def test_bootstrap_and_status(alice: User) -> None:
    page = make_page(alice)
    add_component(alice, page["id"], "divider")
    data = alice.get("/api/sync/bootstrap").json()
    assert [p["id"] for p in data["pages"]] == [page["id"]]
    assert len(data["components"]) == 1
    assert data["device_id"] == alice.device_id
    status = alice.get("/api/sync/status", params={"cursor": 0}).json()
    assert status["cursor"] == data["cursor"]
    phone = alice.second_device()
    assert phone.get("/api/sync/status", params={"cursor": 0}).json()["pending_changes"] == 2


def test_pull_requires_cursor_or_since(alice: User) -> None:
    assert alice.get("/api/sync/pull").status_code == 422
    assert alice.get("/api/sync/pull", params={"since": 0}).status_code == 200


def test_pull_pagination(alice: User) -> None:
    page = make_page(alice)
    for _ in range(4):
        add_component(alice, page["id"], "divider")
    first = alice.get("/api/sync/pull", params={"cursor": 0, "limit": 3}).json()
    assert first["has_more"] is True
    second = pull(alice, first["cursor"])
    assert second["has_more"] is False
    assert len(first["changes"]) + len(second["changes"]) == 5
