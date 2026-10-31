"""Search tests."""

from tests.conftest import User, add_component, make_page


def test_search_titles_and_content(alice: User, bob: User) -> None:
    trip = make_page(alice, "Trip to Lisbon")
    notes = make_page(alice, "Notes")
    component = add_component(
        alice, notes["id"], "text-block", {"text": "Remember the <strong>pastéis</strong> de nata"}
    )
    add_component(
        alice,
        notes["id"],
        "checklist",
        {"items": [{"id": "x", "text": "pack lisbon guide", "checked": False, "indent_level": 0}]},
    )
    make_page(bob, "Lisbon (bob's)")

    results = alice.get("/api/search", params={"q": "lisbon"}).json()["results"]
    assert {r["page_id"] for r in results} == {trip["id"], notes["id"]}

    content_hit = alice.get("/api/search", params={"q": "pastéis"}).json()["results"]
    assert content_hit[0]["component_id"] == component["id"]
    assert "pastéis" in content_hit[0]["snippet"]


def test_search_ignores_markup_and_deleted_pages(alice: User) -> None:
    page = make_page(alice, "Doc")
    add_component(alice, page["id"], "text-block", {"text": "<strong>bold</strong> words"})
    assert alice.get("/api/search", params={"q": "strong"}).json()["results"] == []
    alice.delete(f"/api/pages/{page['id']}")
    assert alice.get("/api/search", params={"q": "words"}).json()["results"] == []


def test_search_escapes_wildcards(alice: User) -> None:
    make_page(alice, "100% done")
    make_page(alice, "1000 things")
    results = alice.get("/api/search", params={"q": "100%"}).json()["results"]
    assert [r["title"] for r in results] == ["100% done"]
