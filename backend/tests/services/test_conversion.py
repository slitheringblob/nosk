"""Component conversion tests."""

from app.services.conversion import can_convert, convert_content


def test_text_to_checklist_splits_lines() -> None:
    content = convert_content("text-block", "checklist", {"text": "buy milk<br><b>call</b> mom"})
    assert [item["text"] for item in content["items"]] == ["buy milk", "call mom"]
    assert all(item["checked"] is False for item in content["items"])


def test_checklist_to_bullets_keeps_indent() -> None:
    content = convert_content(
        "checklist",
        "bullet-list",
        {"items": [{"id": "1", "text": "a & b", "checked": True, "indent_level": 2}]},
    )
    assert content["items"][0]["text"] == "a &amp; b"
    assert content["items"][0]["indent_level"] == 2


def test_list_to_text_joins_with_breaks() -> None:
    content = convert_content(
        "numbered-list",
        "text-block",
        {
            "items": [
                {"id": "1", "text": "<strong>one</strong>", "indent_level": 0},
                {"id": "2", "text": "two", "indent_level": 0},
            ],
            "start_number": 1,
        },
    )
    assert content == {"text": "<strong>one</strong><br>two", "format": "html"}


def test_list_to_markdown_uses_list_syntax() -> None:
    content = convert_content(
        "checklist",
        "markdown",
        {"items": [{"id": "1", "text": "done", "checked": True, "indent_level": 0}]},
    )
    assert content["source"] == "- [x] done"


def test_matrix() -> None:
    assert can_convert("text-block", "numbered-list")
    assert can_convert("heading", "toggle")
    assert not can_convert("divider", "text-block")
    assert not can_convert("text-block", "text-block")
