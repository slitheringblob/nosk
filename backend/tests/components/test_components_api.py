"""Component API tests."""

from tests.conftest import User, add_component, make_page


def _components(user: User, page_id: str) -> list[dict]:
    return user.get(f"/api/pages/{page_id}/components").json()["components"]


def test_create_update_delete(alice: User) -> None:
    page = make_page(alice)
    created = add_component(
        alice,
        page["id"],
        "checklist",
        {"items": [{"id": "i1", "text": "Do it", "checked": False, "indent_level": 0}]},
    )
    assert created["page_version"] == 1
    assert created["order"] == 0
    updated = alice.put(
        f"/api/components/{created['id']}",
        {"content": {"items": [{"id": "i1", "text": "Do it", "checked": True, "indent_level": 0}]}},
    ).json()
    assert updated["content"]["items"][0]["checked"] is True
    assert updated["page_version"] == 2
    assert alice.get(f"/api/pages/{page['id']}").json()["component_ids"] == [created["id"]]
    deleted = alice.delete(f"/api/components/{created['id']}").json()
    assert deleted["deleted_ids"] == [created["id"]]
    assert alice.get(f"/api/pages/{page['id']}").json()["component_ids"] == []


def test_content_is_validated(alice: User) -> None:
    page = make_page(alice)
    bad_type = alice.post(f"/api/pages/{page['id']}/components", {"type": "nope", "content": {}})
    assert bad_type.status_code == 422
    bad = alice.post(
        f"/api/pages/{page['id']}/components",
        {"type": "heading", "content": {"text": "x", "level": 7}},
    )
    assert bad.status_code == 422
    assert bad.json()["error"]["details"][0]["field"].startswith("content.level")


def test_positioning_with_order_and_after_id(alice: User) -> None:
    page = make_page(alice)
    first = add_component(alice, page["id"], "divider")
    third = add_component(alice, page["id"], "divider")
    second = add_component(alice, page["id"], "divider", after_id=first["id"])
    top = add_component(alice, page["id"], "divider", order=0)
    ids = alice.get(f"/api/pages/{page['id']}").json()["component_ids"]
    assert ids == [top["id"], first["id"], second["id"], third["id"]]
    assert [c["order"] for c in _components(alice, page["id"])] == [0, 1, 2, 3]


def test_reorder_requires_exact_set(alice: User) -> None:
    page = make_page(alice)
    a = add_component(alice, page["id"], "divider")
    b = add_component(alice, page["id"], "divider")
    missing = alice.put(f"/api/pages/{page['id']}/reorder", {"component_ids": [a["id"]]})
    assert missing.status_code == 400
    ok = alice.put(f"/api/pages/{page['id']}/reorder", {"component_ids": [b["id"], a["id"]]}).json()
    assert ok["component_ids"] == [b["id"], a["id"]]
    assert [c["id"] for c in _components(alice, page["id"])] == [b["id"], a["id"]]


def test_convert(alice: User) -> None:
    page = make_page(alice)
    text = add_component(alice, page["id"], "text-block", {"text": "one<br>two"})
    converted = alice.post(
        f"/api/components/{text['id']}/convert", {"to_type": "bullet-list"}
    ).json()
    assert converted["type"] == "bullet-list"
    assert [i["text"] for i in converted["content"]["items"]] == ["one", "two"]
    unsupported = alice.post(f"/api/components/{text['id']}/convert", {"to_type": "divider"})
    assert unsupported.status_code == 400


def test_nesting_and_cascading_delete(alice: User) -> None:
    page = make_page(alice)
    toggle = add_component(alice, page["id"], "toggle", {"title": "Details"})
    child = add_component(alice, page["id"], "text-block", parent_id=toggle["id"])
    grandchild_parent = add_component(alice, page["id"], "toggle", parent_id=toggle["id"])
    add_component(alice, page["id"], "divider", parent_id=grandchild_parent["id"])
    assert child["parent_id"] == toggle["id"]

    not_container = alice.post(
        f"/api/pages/{page['id']}/components",
        {"type": "divider", "content": {}, "parent_id": child["id"]},
    )
    assert not_container.status_code == 422

    deleted = alice.delete(f"/api/components/{toggle['id']}").json()["deleted_ids"]
    assert len(deleted) == 4
    assert _components(alice, page["id"]) == []


def test_columns_slots(alice: User) -> None:
    page = make_page(alice)
    columns = add_component(alice, page["id"], "columns", {"count": 3})
    right = add_component(alice, page["id"], "text-block", parent_id=columns["id"], slot=2)
    out_of_range = alice.post(
        f"/api/pages/{page['id']}/components",
        {"type": "divider", "content": {}, "parent_id": columns["id"], "slot": 3},
    )
    assert out_of_range.status_code == 422
    alice.put(f"/api/components/{columns['id']}", {"content": {"count": 2}})
    moved = alice.get(f"/api/components/{right['id']}").json()
    assert moved["slot"] == 1


def test_move_component(alice: User) -> None:
    page = make_page(alice)
    toggle = add_component(alice, page["id"], "toggle")
    text = add_component(alice, page["id"], "text-block")
    moved = alice.post(f"/api/components/{text['id']}/move", {"parent_id": toggle["id"]}).json()
    assert moved["parent_id"] == toggle["id"]
    ids = alice.get(f"/api/pages/{page['id']}").json()["component_ids"]
    assert ids == [toggle["id"], text["id"]]
    cycle = alice.post(f"/api/components/{toggle['id']}/move", {"parent_id": toggle["id"]})
    assert cycle.status_code == 422
    back = alice.post(f"/api/components/{text['id']}/move", {"parent_id": None}).json()
    assert back["parent_id"] is None
    assert alice.get(f"/api/pages/{page['id']}").json()["component_ids"][0] == text["id"]


def test_converting_toggle_lifts_children(alice: User) -> None:
    page = make_page(alice)
    toggle = add_component(alice, page["id"], "toggle", {"title": "Wrapper"})
    child = add_component(alice, page["id"], "divider", parent_id=toggle["id"])
    alice.post(f"/api/components/{toggle['id']}/convert", {"to_type": "heading"})
    assert alice.get(f"/api/components/{child['id']}").json()["parent_id"] is None


def test_component_access_control(alice: User, bob: User) -> None:
    page = make_page(alice)
    component = add_component(alice, page["id"])
    assert bob.get(f"/api/components/{component['id']}").status_code == 404
    assert bob.put(f"/api/components/{component['id']}", {"content": {}}).status_code == 404
    assert bob.post(f"/api/pages/{page['id']}/components", {"type": "divider"}).status_code == 404
