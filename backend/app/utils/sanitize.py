"""Allowlist-based sanitizing for the inline HTML stored in rich-text components.

Browsers' contentEditable emits <b>/<i>/<strike> rather than the semantic tags the data model
documents, so those are normalised here. Anything outside the allowlist is dropped, but its text
content is kept.
"""

from __future__ import annotations

import html
import re
from html.parser import HTMLParser

ALLOWED_TAGS = {"strong", "em", "del", "code", "a", "mark", "br", "u"}
TAG_ALIASES = {"b": "strong", "i": "em", "s": "del", "strike": "del"}
VOID_TAGS = {"br"}
# Tags whose text content must never leak into the output.
DROP_CONTENT_TAGS = {"script", "style", "template", "iframe", "object", "noscript"}
BLOCK_BREAK_TAGS = {"div", "p", "li"}
SAFE_URL = re.compile(r"^(https?:|mailto:|/|#)", re.IGNORECASE)


def is_safe_url(url: str) -> bool:
    # Strip control characters and whitespace browsers ignore when parsing schemes.
    cleaned = re.sub(r"[\x00-\x20]", "", url)
    return bool(SAFE_URL.match(cleaned))


class _Sanitizer(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.open_tags: list[str] = []
        self.drop_depth = 0
        self.seen_block = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.drop_depth += 1
            return
        if self.drop_depth:
            return
        if tag in BLOCK_BREAK_TAGS:
            # contentEditable wraps new lines in <div>; flatten them to <br>.
            if self.seen_block or self.parts:
                self.parts.append("<br>")
            self.seen_block = True
            return
        tag = TAG_ALIASES.get(tag, tag)
        if tag not in ALLOWED_TAGS:
            return
        if tag == "a":
            href = dict(attrs).get("href") or ""
            if not is_safe_url(href):
                self.parts.append("<a>")
            else:
                self.parts.append(
                    f'<a href="{html.escape(href, quote=True)}" target="_blank" '
                    'rel="noopener noreferrer">'
                )
        else:
            self.parts.append(f"<{tag}>")
        if tag not in VOID_TAGS:
            self.open_tags.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        tag = TAG_ALIASES.get(tag.lower(), tag.lower())
        if tag in ALLOWED_TAGS and tag not in VOID_TAGS:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in DROP_CONTENT_TAGS:
            self.drop_depth = max(0, self.drop_depth - 1)
            return
        if self.drop_depth:
            return
        tag = TAG_ALIASES.get(tag, tag)
        if tag not in self.open_tags:
            return
        # Close any tags left open inside this one so output is always well-formed.
        while self.open_tags:
            current = self.open_tags.pop()
            self.parts.append(f"</{current}>")
            if current == tag:
                break

    def handle_data(self, data: str) -> None:
        if not self.drop_depth:
            self.parts.append(html.escape(data, quote=False))

    def result(self) -> str:
        while self.open_tags:
            self.parts.append(f"</{self.open_tags.pop()}>")
        return "".join(self.parts)


def sanitize_html(value: str) -> str:
    parser = _Sanitizer()
    parser.feed(value)
    parser.close()
    return parser.result()


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.drop_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in DROP_CONTENT_TAGS:
            self.drop_depth += 1
        elif tag == "br" or tag in BLOCK_BREAK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in DROP_CONTENT_TAGS:
            self.drop_depth = max(0, self.drop_depth - 1)

    def handle_data(self, data: str) -> None:
        if not self.drop_depth:
            self.parts.append(data)


def html_to_text(value: str) -> str:
    """Return the visible text of an HTML fragment, with line breaks preserved as newlines."""

    parser = _TextExtractor()
    parser.feed(value)
    parser.close()
    return "".join(parser.parts).strip("\n")


def text_to_html(value: str) -> str:
    return "<br>".join(html.escape(line, quote=False) for line in value.split("\n"))
