"""Component content validation tests."""

import pytest

from app.schemas.component_content import COMPONENT_TYPES, validate_content
from app.utils.errors import ValidationFailed

REQUIRED_CONTENT = {
    "database": {"columns": [{"id": "c1", "name": "Name", "type": "text"}]},
}


@pytest.mark.parametrize("component_type", sorted(COMPONENT_TYPES))
def test_every_type_accepts_its_defaults(component_type: str) -> None:
    content = validate_content(component_type, REQUIRED_CONTENT.get(component_type, {}))
    assert isinstance(content, dict)


def test_all_planned_types_are_supported() -> None:
    planned = {
        "text-block",
        "heading",
        "markdown",
        "checklist",
        "bullet-list",
        "numbered-list",
        "toggle",
        "callout",
        "divider",
        "quote",
        "code",
        "table",
        "image",
        "bookmark",
        "embed",
        "file",
        "properties",
        "date",
        "tags",
        "columns",
        "template",
        "math",
        "comment",
        "page-link",
        "canvas",
        "database",
    }
    assert planned <= COMPONENT_TYPES


def test_unknown_type_is_rejected() -> None:
    with pytest.raises(ValidationFailed):
        validate_content("hologram", {})


def test_unknown_fields_are_rejected() -> None:
    with pytest.raises(ValidationFailed):
        validate_content("divider", {"style": "solid", "colour": "red"})


def test_heading_level_and_length_limits() -> None:
    with pytest.raises(ValidationFailed):
        validate_content("heading", {"text": "x", "level": 4})
    with pytest.raises(ValidationFailed):
        validate_content("heading", {"text": "x" * 201, "level": 1})


def test_text_block_is_sanitized() -> None:
    content = validate_content("text-block", {"text": "<b>hi</b><script>x</script>"})
    assert content["text"] == "<strong>hi</strong>"


def test_checklist_limits() -> None:
    item = {"id": "i", "text": "t", "checked": False, "indent_level": 4}
    with pytest.raises(ValidationFailed):
        validate_content("checklist", {"items": [item]})
    too_many = [{"id": str(n), "text": "", "checked": False, "indent_level": 0} for n in range(501)]
    with pytest.raises(ValidationFailed):
        validate_content("checklist", {"items": too_many})


def test_table_must_be_rectangular() -> None:
    with pytest.raises(ValidationFailed):
        validate_content("table", {"rows": [["a", "b"], ["c"]]})


def test_urls_must_be_http() -> None:
    with pytest.raises(ValidationFailed):
        validate_content("bookmark", {"url": "javascript:alert(1)"})
    assert validate_content("embed", {"url": "https://youtu.be/x"})["url"] == "https://youtu.be/x"


def test_template_blocks_are_validated_recursively() -> None:
    with pytest.raises(ValidationFailed):
        validate_content("template", {"blocks": [{"type": "heading", "content": {"level": 9}}]})
    with pytest.raises(ValidationFailed):
        validate_content("template", {"blocks": [{"type": "template", "content": {}}]})


def test_database_drops_cells_for_unknown_columns() -> None:
    content = validate_content(
        "database",
        {
            "columns": [{"id": "a", "name": "A", "type": "text"}],
            "rows": [{"id": "r", "cells": {"a": "x", "ghost": "y"}}],
        },
    )
    assert content["rows"][0]["cells"] == {"a": "x"}
