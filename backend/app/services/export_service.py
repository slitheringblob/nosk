"""Markdown / HTML / JSON export and Markdown / JSON import."""

from __future__ import annotations

import html
import json
import re
from typing import Any
from uuid import uuid4

from app.models import Component, Page
from app.schemas.component_content import COMPONENT_TYPES
from app.utils.errors import ValidationFailed
from app.utils.sanitize import html_to_text, sanitize_html


def _inline_md(value: str) -> str:
    """Convert sanitized inline HTML to Markdown."""

    replacements = [
        (r"<strong>(.*?)</strong>", r"**\1**"),
        (r"<em>(.*?)</em>", r"*\1*"),
        (r"<del>(.*?)</del>", r"~~\1~~"),
        (r"<code>(.*?)</code>", r"`\1`"),
        (r"<mark>(.*?)</mark>", r"==\1=="),
        (r"<u>(.*?)</u>", r"\1"),
        (r'<a href="([^"]*)"[^>]*>(.*?)</a>', r"[\2](\1)"),
        (r"<br\s*/?>", "  \n"),
    ]
    for pattern, replacement in replacements:
        value = re.sub(pattern, replacement, value, flags=re.DOTALL)
    value = re.sub(r"<[^>]+>", "", value)
    return html.unescape(value)


def _children(components: list[Component]) -> dict[str | None, list[Component]]:
    tree: dict[str | None, list[Component]] = {}
    for component in components:
        tree.setdefault(component.parent_id, []).append(component)
    return tree


def _component_md(component: Component, tree: dict[str | None, list[Component]], depth: int) -> str:
    c = component.content
    kind = component.type
    if kind == "text-block":
        return _inline_md(c.get("text", ""))
    if kind == "heading":
        return "#" * c.get("level", 1) + " " + c.get("text", "")
    if kind == "markdown":
        return c.get("source", "")
    if kind == "checklist":
        return "\n".join(
            "  " * i["indent_level"] + f"- [{'x' if i['checked'] else ' '}] {i['text']}"
            for i in c.get("items", [])
        )
    if kind == "bullet-list":
        return "\n".join(
            "  " * i["indent_level"] + "- " + _inline_md(i["text"]) for i in c.get("items", [])
        )
    if kind == "numbered-list":
        start = c.get("start_number", 1)
        return "\n".join(
            "   " * i["indent_level"] + f"{start + n}. " + _inline_md(i["text"])
            for n, i in enumerate(c.get("items", []))
        )
    if kind in ("quote", "callout"):
        prefix = f"**{c.get('variant', 'note').title()}:** " if kind == "callout" else ""
        body = prefix + _inline_md(c.get("text", ""))
        quoted = "\n".join("> " + line for line in body.split("\n"))
        if kind == "quote" and c.get("citation"):
            quoted += f"\n>\n> — {c['citation']}"
        return quoted
    if kind == "divider":
        return "---"
    if kind == "code":
        lang = c.get("language", "")
        return f"```{'' if lang == 'plaintext' else lang}\n{c.get('code', '')}\n```"
    if kind == "math":
        return (
            f"$$\n{c.get('latex', '')}\n$$" if c.get("display", True) else f"${c.get('latex', '')}$"
        )
    if kind == "table":
        rows = c.get("rows", [])
        if not rows:
            return ""
        escape = lambda cell: cell.replace("|", "\\|").replace("\n", " ")  # noqa: E731
        lines = [
            "| " + " | ".join(escape(cell) for cell in rows[0]) + " |",
            "| " + " | ".join("---" for _ in rows[0]) + " |",
        ]
        lines += ["| " + " | ".join(escape(cell) for cell in row) + " |" for row in rows[1:]]
        return "\n".join(lines)
    if kind == "image":
        src = c.get("url") or (f"asset:{c['asset_id']}" if c.get("asset_id") else "")
        text = f"![{c.get('alt', '')}]({src})"
        return text + (f"\n*{c['caption']}*" if c.get("caption") else "")
    if kind in ("bookmark", "embed"):
        url = c.get("url") or ""
        return f"[{c.get('title') or url}]({url})" if url else ""
    if kind == "file":
        return f"📎 {c.get('filename', 'file')}"
    if kind == "properties":
        return "\n".join(f"- **{i['key']}:** {i['value']}" for i in c.get("items", []))
    if kind == "date":
        return f"📅 {c.get('label') + ': ' if c.get('label') else ''}{c.get('date') or ''}"
    if kind == "tags":
        return " ".join(f"#{tag}" for tag in c.get("tags", []))
    if kind == "page-link":
        return f"[[{c.get('title') or c.get('page_id', '')}]]"
    if kind == "comment":
        return f"<!-- {c.get('author', '')}: {c.get('text', '')} -->"
    if kind == "template":
        return f"<!-- template: {c.get('title', '')} -->"
    if kind == "canvas":
        return "*(drawing)*"
    if kind == "database":
        columns = c.get("columns", [])
        lines = [
            f"**{c.get('title') or 'Database'}**",
            "",
            "| " + " | ".join(col["name"] for col in columns) + " |",
            "| " + " | ".join("---" for _ in columns) + " |",
        ]
        for row in c.get("rows", []):
            cells = []
            for col in columns:
                value = row["cells"].get(col["id"])
                cells.append("✓" if value is True else "" if value in (None, False) else str(value))
            lines.append("| " + " | ".join(cells) + " |")
        return "\n".join(lines)
    if kind == "toggle":
        inner = _children_md(component.id, tree, depth + 1)
        body = "\n\n".join(
            filter(None, [f"<summary>{html.escape(c.get('title', ''))}</summary>", inner])
        )
        return f"<details>\n{body}\n</details>"
    if kind == "columns":
        return _children_md(component.id, tree, depth + 1)
    return ""


def _children_md(parent_id: str | None, tree: dict[str | None, list[Component]], depth: int) -> str:
    parts = [_component_md(child, tree, depth) for child in tree.get(parent_id, [])]
    return "\n\n".join(part for part in parts if part)


def export_markdown(page: Page, components: list[Component]) -> str:
    title = f"# {page.icon + ' ' if page.icon else ''}{page.title}"
    body = _children_md(None, _children(components), 0)
    tags = ("\n\nTags: " + ", ".join(page.tags)) if page.tags else ""
    return f"{title}{tags}\n\n{body}\n"


def export_json(page: Page, components: list[Component]) -> dict[str, Any]:
    from app.services.serializers import serialize_component, serialize_page

    return {
        "format": "nosk",
        "version": 1,
        "page": serialize_page(page),
        "components": [serialize_component(c) for c in components],
    }


# --- Import ---------------------------------------------------------------------------------

INLINE_PATTERNS = [
    (re.compile(r"\*\*(.+?)\*\*"), r"<strong>\1</strong>"),
    (re.compile(r"(?<!\*)\*(?!\s)(.+?)(?<!\s)\*(?!\*)"), r"<em>\1</em>"),
    (re.compile(r"~~(.+?)~~"), r"<del>\1</del>"),
    (re.compile(r"`([^`]+)`"), r"<code>\1</code>"),
    (re.compile(r"==(.+?)=="), r"<mark>\1</mark>"),
    (re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)"), r'<a href="\2">\1</a>'),
]


def _md_inline_to_html(text: str) -> str:
    value = html.escape(text, quote=False)
    for pattern, replacement in INLINE_PATTERNS:
        value = pattern.sub(replacement, value)
    return sanitize_html(value)


def _list_indent(raw: str) -> int:
    spaces = len(raw) - len(raw.lstrip(" "))
    return min(spaces // 2, 3)


def import_markdown(source: str) -> tuple[str | None, list[dict[str, Any]]]:
    """Parse Markdown into (title, blocks). The first H1 becomes the page title."""

    lines = source.replace("\r\n", "\n").split("\n")
    blocks: list[dict[str, Any]] = []
    title: str | None = None
    paragraph: list[str] = []
    i = 0

    def flush_paragraph() -> None:
        if paragraph:
            text = "<br>".join(_md_inline_to_html(line) for line in paragraph)
            blocks.append({"type": "text-block", "content": {"text": text, "format": "html"}})
            paragraph.clear()

    def append_list(kind: str, item: dict[str, Any]) -> None:
        if blocks and blocks[-1]["type"] == kind and blocks[-1].get("_open"):
            blocks[-1]["content"]["items"].append(item)
        else:
            content: dict[str, Any] = {"items": [item]}
            if kind == "numbered-list":
                content["start_number"] = 1
            blocks.append({"type": kind, "content": content, "_open": True})

    while i < len(lines):
        raw = lines[i]
        line = raw.strip()
        if not line:
            flush_paragraph()
            for block in blocks:
                block.pop("_open", None)
            i += 1
            continue
        fence = re.match(r"^(```|~~~)\s*([\w+#.-]*)", line)
        if fence:
            flush_paragraph()
            marker, language = fence.group(1), fence.group(2) or "plaintext"
            code_lines = []
            i += 1
            while i < len(lines) and not lines[i].strip().startswith(marker):
                code_lines.append(lines[i])
                i += 1
            blocks.append(
                {
                    "type": "code",
                    "content": {"code": "\n".join(code_lines), "language": language, "wrap": False},
                }
            )
            i += 1
            continue
        if line == "$$":
            flush_paragraph()
            math_lines = []
            i += 1
            while i < len(lines) and lines[i].strip() != "$$":
                math_lines.append(lines[i])
                i += 1
            blocks.append(
                {"type": "math", "content": {"latex": "\n".join(math_lines), "display": True}}
            )
            i += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            flush_paragraph()
            level, text = len(heading.group(1)), heading.group(2).strip()
            if level == 1 and title is None and not blocks:
                title = text[:200]
            else:
                blocks.append(
                    {"type": "heading", "content": {"text": text[:200], "level": min(level, 3)}}
                )
            i += 1
            continue
        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", line):
            flush_paragraph()
            blocks.append({"type": "divider", "content": {"style": "solid"}})
            i += 1
            continue
        task = re.match(r"^[-*+]\s+\[([ xX])\]\s*(.*)$", line)
        if task:
            flush_paragraph()
            append_list(
                "checklist",
                {
                    "id": str(uuid4()),
                    "text": task.group(2)[:1000],
                    "checked": task.group(1).lower() == "x",
                    "indent_level": _list_indent(raw),
                },
            )
            i += 1
            continue
        bullet = re.match(r"^[-*+]\s+(.*)$", line)
        if bullet:
            flush_paragraph()
            append_list(
                "bullet-list",
                {
                    "id": str(uuid4()),
                    "text": _md_inline_to_html(bullet.group(1)),
                    "indent_level": _list_indent(raw),
                },
            )
            i += 1
            continue
        numbered = re.match(r"^\d+[.)]\s+(.*)$", line)
        if numbered:
            flush_paragraph()
            append_list(
                "numbered-list",
                {
                    "id": str(uuid4()),
                    "text": _md_inline_to_html(numbered.group(1)),
                    "indent_level": _list_indent(raw),
                },
            )
            i += 1
            continue
        if line.startswith(">"):
            flush_paragraph()
            quote_lines = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(re.sub(r"^>\s?", "", lines[i].strip()))
                i += 1
            text = "<br>".join(_md_inline_to_html(q) for q in quote_lines)
            blocks.append({"type": "quote", "content": {"text": text}})
            continue
        if (
            line.startswith("|")
            and i + 1 < len(lines)
            and re.match(r"^\|?\s*:?-{3,}", lines[i + 1].strip())
        ):
            flush_paragraph()
            rows = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                if not re.match(r"^\|?\s*:?-{3,}", lines[i].strip()):
                    cells = [cell.strip() for cell in lines[i].strip().strip("|").split("|")]
                    rows.append(cells)
                i += 1
            width = max(len(row) for row in rows)
            rows = [(row + [""] * width)[:width] for row in rows][:200]
            blocks.append({"type": "table", "content": {"rows": rows, "has_header_row": True}})
            continue
        image = re.match(r"^!\[([^\]]*)\]\((https?://[^)\s]+)\)$", line)
        if image:
            flush_paragraph()
            blocks.append(
                {"type": "image", "content": {"url": image.group(2), "alt": image.group(1)[:300]}}
            )
            i += 1
            continue
        paragraph.append(line)
        i += 1

    flush_paragraph()
    for block in blocks:
        block.pop("_open", None)
    return title, blocks[:2000]


def import_json(source: str) -> tuple[str | None, dict[str, Any], list[dict[str, Any]]]:
    try:
        payload = json.loads(source)
        page = payload["page"]
        components = payload["components"]
    except (ValueError, KeyError, TypeError) as exc:
        raise ValidationFailed("Not a nosk JSON export") from exc
    components = [c for c in components if isinstance(c, dict) and c.get("type") in COMPONENT_TYPES]
    index_of = {c.get("id"): n for n, c in enumerate(components)}
    blocks = []
    for component in components:
        parent_index = (
            index_of.get(component.get("parent_id")) if component.get("parent_id") else None
        )
        blocks.append(
            {
                "type": component["type"],
                "content": component.get("content", {}),
                "parent_index": parent_index,
                "slot": component.get("slot", 0),
            }
        )
    fields = {k: page.get(k) for k in ("icon", "color", "tags")}
    return page.get("title"), fields, blocks


def plain_text(component: Component) -> str:
    """All human-readable text in a component, for search snippets."""

    texts: list[str] = []

    def walk(value: Any, key: str = "") -> None:
        if isinstance(value, str):
            if key in (
                "id",
                "asset_id",
                "page_id",
                "format",
                "variant",
                "style",
                "language",
                "provider",
                "mime_type",
                "color",
                "column_id",
                "type",
                "url",
                "image_url",
            ):
                return
            texts.append(html_to_text(value) if "<" in value else value)
        elif isinstance(value, dict):
            for k, v in value.items():
                walk(v, k)
        elif isinstance(value, list):
            for v in value:
                walk(v, key)

    walk(component.content)
    return " ".join(t for t in texts if t)
