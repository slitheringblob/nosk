"""Page API tests."""

from tests.conftest import User, add_component, make_page


def test_create_and_get_page(alice: User) -> None:
    page = make_page(
        alice, "Project Planning", icon="📋", color="#3498db", tags=["Work", "work", " q1 "]
    )
    assert page["version"] == 0
    assert page["component_ids"] == []
    assert page["tags"] == ["work", "q1"]
    assert page["role"] == "owner"
    fetched = alice.get(f"/api/pages/{page['id']}").json()
    assert fetched["title"] == "Project Planning"


def test_create_page_with_client_id(alice: User) -> None:
    page_id = "11111111-2222-3333-4444-555555555555"
    page = make_page(alice, "Offline", id=page_id)
    assert page["id"] == page_id
    duplicate = alice.post("/api/pages", {"id": page_id, "title": "again"})
    assert duplicate.status_code == 400


def test_page_validation(alice: User) -> None:
    assert alice.post("/api/pages", {"title": ""}).status_code == 422
    assert alice.post("/api/pages", {"title": "x" * 201}).status_code == 422
    assert alice.post("/api/pages", {"title": "x", "color": "blue"}).status_code == 422


def test_update_page_bumps_version(alice: User) -> None:
    page = make_page(alice)
    updated = alice.put(f"/api/pages/{page['id']}", {"title": "Renamed", "icon": "🚀"}).json()
    assert updated["title"] == "Renamed"
    assert updated["version"] == 1
    assert updated["updated_at"] >= page["updated_at"]


def test_list_pages_sorting_pagination_and_filters(alice: User) -> None:
    for title in ["b", "a", "c"]:
        make_page(alice, title, tags=["x"] if title != "c" else [])
    template = make_page(alice, "tpl", is_template=True)
    listing = alice.get("/api/pages", params={"sort": "title", "order": "asc", "limit": 2}).json()
    assert [p["title"] for p in listing["pages"]] == ["a", "b"]
    assert listing["total"] == 4
    assert alice.get("/api/pages", params={"tag": "x"}).json()["total"] == 2
    templates = alice.get("/api/pages", params={"is_template": True}).json()["pages"]
    assert [p["id"] for p in templates] == [template["id"]]
    tags = alice.get("/api/tags").json()["tags"]
    assert tags == [{"tag": "x", "count": 2}]


def test_other_users_pages_are_invisible(alice: User, bob: User) -> None:
    page = make_page(alice)
    assert bob.get(f"/api/pages/{page['id']}").status_code == 404
    assert bob.put(f"/api/pages/{page['id']}", {"title": "hacked"}).status_code == 404
    assert bob.delete(f"/api/pages/{page['id']}").status_code == 404
    assert bob.get("/api/pages").json()["total"] == 0


def test_soft_delete_and_restore(alice: User) -> None:
    page = make_page(alice)
    assert alice.delete(f"/api/pages/{page['id']}").status_code == 200
    assert alice.get("/api/pages").json()["total"] == 0
    trash = alice.get("/api/pages", params={"deleted": True}).json()
    assert trash["pages"][0]["deleted"] is True
    restored = alice.post(f"/api/pages/{page['id']}/restore").json()
    assert restored["page"]["deleted"] is False


def test_permanent_delete(alice: User) -> None:
    page = make_page(alice)
    add_component(alice, page["id"])
    assert alice.delete(f"/api/pages/{page['id']}", params={"permanent": True}).status_code == 200
    assert alice.get(f"/api/pages/{page['id']}").status_code == 404


def test_duplicate_page_copies_nested_components(alice: User) -> None:
    page = make_page(alice, "Source")
    toggle = add_component(alice, page["id"], "toggle", {"title": "More"})
    add_component(alice, page["id"], "text-block", {"text": "inside"}, parent_id=toggle["id"])
    copy = alice.post(f"/api/pages/{page['id']}/duplicate", {}).json()
    assert copy["title"] == "Source (copy)"
    components = alice.get(f"/api/pages/{copy['id']}/components").json()["components"]
    assert len(components) == 2
    new_toggle = next(c for c in components if c["type"] == "toggle")
    child = next(c for c in components if c["type"] == "text-block")
    assert new_toggle["id"] != toggle["id"]
    assert child["parent_id"] == new_toggle["id"]


def test_templates(alice: User) -> None:
    templates = alice.get("/api/templates").json()["templates"]
    assert any(t["id"] == "builtin-meeting-notes" for t in templates)
    page = alice.post("/api/pages/from-template", {"template_id": "builtin-daily-journal"}).json()
    components = alice.get(f"/api/pages/{page['id']}/components").json()["components"]
    toggle = next(c for c in components if c["type"] == "toggle")
    assert any(c["parent_id"] == toggle["id"] for c in components)

    source = make_page(alice, "Weekly review")
    add_component(alice, source["id"], "heading", {"text": "Wins", "level": 2})
    saved = alice.post(f"/api/pages/{source['id']}/duplicate", {"as_template": True}).json()
    assert saved["is_template"] is True
    from_mine = alice.post(
        "/api/pages/from-template", {"template_id": saved["id"], "title": "Week 3"}
    ).json()
    assert from_mine["is_template"] is False
    assert from_mine["title"] == "Week 3"
    not_template = alice.post("/api/pages/from-template", {"template_id": source["id"]})
    assert not_template.status_code == 400


def test_import_and_export(alice: User) -> None:
    markdown = "# Imported\n\nHello **world**\n\n- [ ] task\n"
    page = alice.post("/api/pages/import", {"format": "markdown", "content": markdown}).json()
    assert page["title"] == "Imported"
    exported = alice.get(f"/api/pages/{page['id']}/export", params={"format": "markdown"})
    assert exported.headers["content-type"].startswith("text/markdown")
    assert "Hello **world**" in exported.text
    assert "- [ ] task" in exported.text

    as_json = alice.get(f"/api/pages/{page['id']}/export", params={"format": "json"}).text
    reimported = alice.post("/api/pages/import", {"format": "json", "content": as_json}).json()
    assert reimported["title"] == "Imported"
    assert len(reimported["component_ids"]) == 2
    bad = alice.post("/api/pages/import", {"format": "json", "content": "{}"})
    assert bad.status_code == 422
