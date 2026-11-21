"""Converting a component's content between text-bearing types.

Every convertible type is reduced to a list of lines (inline HTML + indent + checked) and rebuilt
as the target type. The frontend mirrors this in js/component-converter.js.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any
from uuid import uuid4

from app.utils.sanitize import html_to_text, sanitize_html, text_to_html

CONVERTIBLE_TYPES = frozenset(
    {
        "text-block",
        "heading",
        "quote",
        "callout",
        "toggle",
        "code",
        "markdown",
        "checklist",
        "bullet-list",
        "numbered-list",
    }
)
BR_SPLIT = re.compile(r"<br\s*/?>", re.IGNORECASE)


@dataclass
class Line:
    html: str
    indent: int = 0
    checked: bool = False

    @property
    def text(self) -> str:
        return html_to_text(self.html)


def can_convert(from_type: str, to_type: str) -> bool:
    return from_type != to_type and {from_type, to_type} <= CONVERTIBLE_TYPES


def _split_html(value: str) -> list[Line]:
    return [Line(sanitize_html(part)) for part in BR_SPLIT.split(value or "")]


def _split_text(value: str) -> list[Line]:
    return [Line(html.escape(part, quote=False)) for part in (value or "").split("\n")]


def extract_lines(component_type: str, content: dict[str, Any]) -> list[Line]:
    if component_type in ("text-block", "quote", "callout"):
        return _split_html(content.get("text", ""))
    if component_type == "heading":
        return _split_text(content.get("text", ""))
    if component_type == "toggle":
        return _split_text(content.get("title", ""))
    if component_type == "code":
        return _split_text(content.get("code", ""))
    if component_type == "markdown":
        return _split_text(content.get("source", ""))
    if component_type == "checklist":
        return [
            Line(
                html.escape(item.get("text", ""), quote=False),
                item.get("indent_level", 0),
                item.get("checked", False),
            )
            for item in content.get("items", [])
        ]
    if component_type in ("bullet-list", "numbered-list"):
        return [
            Line(item.get("text", ""), item.get("indent_level", 0))
            for item in content.get("items", [])
        ]
    raise ValueError(f"Cannot convert from {component_type}")


def _markdown_prefix(source_type: str, index: int, line: Line) -> str:
    indent = "  " * line.indent
    if source_type == "checklist":
        return f"{indent}- [{'x' if line.checked else ' '}] "
    if source_type == "bullet-list":
        return f"{indent}- "
    if source_type == "numbered-list":
        return f"{indent}{index + 1}. "
    return ""


def build_content(
    source_type: str, target_type: str, lines: list[Line], previous: dict[str, Any]
) -> dict[str, Any]:
    # Drop trailing empty lines so "a<br>" doesn't become a list with an empty last item.
    while len(lines) > 1 and not lines[-1].text.strip():
        lines.pop()
    joined_text = "\n".join(line.text for line in lines)

    if target_type in ("text-block", "quote", "callout"):
        content: dict[str, Any] = {"text": "<br>".join(line.html for line in lines)}
        if target_type == "text-block":
            content["format"] = "html"
        if target_type == "callout":
            content["variant"] = previous.get("variant", "note")
        return content
    if target_type == "heading":
        return {"text": " ".join(line.text for line in lines).strip()[:200], "level": 2}
    if target_type == "toggle":
        return {"title": " ".join(line.text for line in lines).strip()[:500], "is_open": True}
    if target_type == "code":
        return {"code": joined_text, "language": "plaintext", "wrap": False}
    if target_type == "markdown":
        source = "\n".join(
            _markdown_prefix(source_type, index, line) + line.text
            for index, line in enumerate(lines)
        )
        return {"source": source, "preview_mode": False}
    if target_type == "checklist":
        return {
            "items": [
                {
                    "id": str(uuid4()),
                    "text": line.text[:1000],
                    "checked": line.checked,
                    "indent_level": min(line.indent, 3),
                }
                for line in lines
            ]
        }
    if target_type in ("bullet-list", "numbered-list"):
        items = [
            {
                "id": str(uuid4()),
                "text": line.html or text_to_html(line.text),
                "indent_level": min(line.indent, 3),
            }
            for line in lines
        ]
        content = {"items": items}
        if target_type == "numbered-list":
            content["start_number"] = previous.get("start_number", 1)
        return content
    raise ValueError(f"Cannot convert to {target_type}")


def convert_content(from_type: str, to_type: str, content: dict[str, Any]) -> dict[str, Any]:
    lines = extract_lines(from_type, content) or [Line("")]
    return build_content(from_type, to_type, lines, content)
