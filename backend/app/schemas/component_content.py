"""Per-type content schemas for components.

Every component type's `content` payload is validated (and rich text sanitized) here before it is
persisted, whether it arrives through the REST API or a sync push.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, ValidationError, model_validator

from app.utils.errors import ValidationFailed
from app.utils.sanitize import is_safe_url, sanitize_html

HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")


def _http_url(value: str) -> str:
    if not re.match(r"^https?://", value, re.IGNORECASE) or not is_safe_url(value):
        raise ValueError("URL must start with http:// or https://")
    return value


def _hex_color(value: str) -> str:
    if not HEX_COLOR.match(value):
        raise ValueError("Color must be a #RRGGBB hex value")
    return value


def _rich_text(limit: int) -> Any:
    # Length is checked after sanitizing so normalised markup can't push valid input over.
    def check(value: str) -> str:
        cleaned = sanitize_html(value)
        if len(cleaned) > limit:
            raise ValueError(f"Text must be at most {limit} characters")
        return cleaned

    return Annotated[str, AfterValidator(check)]


HttpUrl = Annotated[str, Field(max_length=2048), AfterValidator(_http_url)]
HexColor = Annotated[str, AfterValidator(_hex_color)]
ItemId = Annotated[str, Field(min_length=1, max_length=64)]
IndentLevel = Annotated[int, Field(ge=0, le=3)]
RichText10k = _rich_text(10_000)
RichText5k = _rich_text(5_000)
RichText2k = _rich_text(2_000)


class Content(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- Text ---------------------------------------------------------------------------------


class TextBlockContent(Content):
    text: RichText10k = ""
    format: Literal["html"] = "html"


class HeadingContent(Content):
    text: Annotated[str, Field(max_length=200)] = ""
    level: Literal[1, 2, 3] = 1


class MarkdownContent(Content):
    source: Annotated[str, Field(max_length=50_000)] = ""
    preview_mode: bool = False


class QuoteContent(Content):
    text: RichText5k = ""
    citation: Annotated[str, Field(max_length=200)] | None = None


class CalloutContent(Content):
    text: RichText5k = ""
    variant: Literal["info", "warning", "success", "error", "note"] = "note"
    icon: Annotated[str, Field(max_length=10)] | None = None


class CodeContent(Content):
    code: Annotated[str, Field(max_length=50_000)] = ""
    language: Annotated[str, Field(max_length=30, pattern=r"^[a-zA-Z0-9+#._-]*$")] = "plaintext"
    wrap: bool = False


class MathContent(Content):
    latex: Annotated[str, Field(max_length=5_000)] = ""
    display: bool = True


# --- Lists --------------------------------------------------------------------------------


class ChecklistItem(Content):
    id: ItemId
    text: Annotated[str, Field(max_length=1_000)] = ""
    checked: bool = False
    indent_level: IndentLevel = 0


class ListItem(Content):
    id: ItemId
    text: RichText2k = ""
    indent_level: IndentLevel = 0


class ChecklistContent(Content):
    items: Annotated[list[ChecklistItem], Field(max_length=500)] = []


class BulletListContent(Content):
    items: Annotated[list[ListItem], Field(max_length=500)] = []


class NumberedListContent(Content):
    items: Annotated[list[ListItem], Field(max_length=500)] = []
    start_number: Annotated[int, Field(ge=1, le=100_000)] = 1


# --- Layout -------------------------------------------------------------------------------


class ToggleContent(Content):
    title: Annotated[str, Field(max_length=500)] = ""
    is_open: bool = False


class ColumnsContent(Content):
    count: Annotated[int, Field(ge=2, le=4)] = 2


class DividerContent(Content):
    style: Literal["solid", "dashed", "dotted", "thick"] = "solid"


class TableContent(Content):
    rows: list[list[Annotated[str, Field(max_length=1_000)]]] = [["", ""], ["", ""]]
    has_header_row: bool = True

    @model_validator(mode="after")
    def check_shape(self) -> "TableContent":
        if not 1 <= len(self.rows) <= 200:
            raise ValueError("Table must have between 1 and 200 rows")
        width = len(self.rows[0])
        if not 1 <= width <= 26:
            raise ValueError("Table must have between 1 and 26 columns")
        if any(len(row) != width for row in self.rows):
            raise ValueError("All table rows must have the same number of cells")
        return self


# --- Media & embeds -----------------------------------------------------------------------


class ImageContent(Content):
    asset_id: Annotated[str, Field(max_length=36)] | None = None
    url: HttpUrl | None = None
    alt: Annotated[str, Field(max_length=300)] = ""
    caption: Annotated[str, Field(max_length=500)] = ""
    width: Annotated[int, Field(ge=10, le=100)] = 100
    natural_width: Annotated[int, Field(ge=0)] | None = None
    natural_height: Annotated[int, Field(ge=0)] | None = None


class BookmarkContent(Content):
    url: HttpUrl | None = None
    title: Annotated[str, Field(max_length=300)] = ""
    description: Annotated[str, Field(max_length=1_000)] = ""
    image_url: HttpUrl | None = None
    site_name: Annotated[str, Field(max_length=200)] = ""


class EmbedContent(Content):
    url: HttpUrl | None = None
    provider: Annotated[str, Field(max_length=30)] = ""
    height: Annotated[int, Field(ge=100, le=1_200)] = 400


class FileContent(Content):
    asset_id: Annotated[str, Field(max_length=36)] | None = None
    filename: Annotated[str, Field(max_length=255)] = ""
    mime_type: Annotated[str, Field(max_length=100)] = ""
    size: Annotated[int, Field(ge=0)] = 0


# --- Structured data ----------------------------------------------------------------------


class PropertyItem(Content):
    id: ItemId
    key: Annotated[str, Field(max_length=100)] = ""
    value: Annotated[str, Field(max_length=1_000)] = ""


class PropertiesContent(Content):
    items: Annotated[list[PropertyItem], Field(max_length=100)] = []


class DateContent(Content):
    date: (
        Annotated[
            str,
            Field(
                pattern=r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$"
            ),
        ]
        | None
    ) = None
    include_time: bool = False
    label: Annotated[str, Field(max_length=100)] = ""


class TagsContent(Content):
    tags: Annotated[
        list[Annotated[str, Field(min_length=1, max_length=50)]], Field(max_length=50)
    ] = []


class PageLinkContent(Content):
    page_id: Annotated[str, Field(max_length=36)] | None = None
    title: Annotated[str, Field(max_length=200)] = ""


class CommentContent(Content):
    text: Annotated[str, Field(max_length=2_000)] = ""
    author: Annotated[str, Field(max_length=255)] = ""
    resolved: bool = False


class TemplateBlock(Content):
    type: Annotated[str, Field(max_length=50)]
    content: dict[str, Any] = {}


class TemplateContent(Content):
    title: Annotated[str, Field(max_length=200)] = "Template"
    blocks: Annotated[list[TemplateBlock], Field(max_length=100)] = []

    @model_validator(mode="after")
    def check_blocks(self) -> "TemplateContent":
        for block in self.blocks:
            if block.type in ("template", "toggle", "columns"):
                raise ValueError(f"Templates cannot contain '{block.type}' blocks")
            block.content = validate_content(block.type, block.content)
        return self


class CanvasStroke(Content):
    color: HexColor = "#1f2328"
    width: Annotated[float, Field(gt=0, le=40)] = 2
    points: Annotated[
        list[Annotated[list[float], Field(min_length=2, max_length=2)]], Field(max_length=5_000)
    ]


class CanvasContent(Content):
    strokes: Annotated[list[CanvasStroke], Field(max_length=2_000)] = []
    height: Annotated[int, Field(ge=100, le=2_000)] = 320

    @model_validator(mode="after")
    def check_size(self) -> "CanvasContent":
        if sum(len(stroke.points) for stroke in self.strokes) > 50_000:
            raise ValueError("Canvas has too many points")
        return self


DATABASE_COLUMN_TYPES = ("text", "number", "checkbox", "select", "date", "url")


class DatabaseColumn(Content):
    id: ItemId
    name: Annotated[str, Field(max_length=100)] = ""
    type: Literal["text", "number", "checkbox", "select", "date", "url"] = "text"
    options: Annotated[list[Annotated[str, Field(max_length=100)]], Field(max_length=50)] = []


class DatabaseRow(Content):
    id: ItemId
    cells: dict[str, str | float | bool | None] = {}


class DatabaseSort(Content):
    column_id: ItemId
    direction: Literal["asc", "desc"] = "asc"


class DatabaseFilter(Content):
    column_id: ItemId
    op: Literal["contains", "equals", "not_empty", "empty", "checked", "unchecked", "gt", "lt"]
    value: Annotated[str, Field(max_length=200)] = ""


class DatabaseContent(Content):
    title: Annotated[str, Field(max_length=200)] = ""
    columns: Annotated[list[DatabaseColumn], Field(min_length=1, max_length=30)]
    rows: Annotated[list[DatabaseRow], Field(max_length=1_000)] = []
    sort: DatabaseSort | None = None
    filter: DatabaseFilter | None = None

    @model_validator(mode="after")
    def check_cells(self) -> "DatabaseContent":
        column_ids = {column.id for column in self.columns}
        for row in self.rows:
            unknown = set(row.cells) - column_ids
            for key in unknown:
                del row.cells[key]
            for value in row.cells.values():
                if isinstance(value, str) and len(value) > 2_000:
                    raise ValueError("Database cell values must be at most 2000 characters")
        return self


CONTENT_SCHEMAS: dict[str, type[Content]] = {
    "text-block": TextBlockContent,
    "heading": HeadingContent,
    "markdown": MarkdownContent,
    "checklist": ChecklistContent,
    "bullet-list": BulletListContent,
    "numbered-list": NumberedListContent,
    "toggle": ToggleContent,
    "callout": CalloutContent,
    "divider": DividerContent,
    "quote": QuoteContent,
    "code": CodeContent,
    "table": TableContent,
    "image": ImageContent,
    "bookmark": BookmarkContent,
    "embed": EmbedContent,
    "file": FileContent,
    "properties": PropertiesContent,
    "date": DateContent,
    "tags": TagsContent,
    "columns": ColumnsContent,
    "template": TemplateContent,
    "math": MathContent,
    "comment": CommentContent,
    "page-link": PageLinkContent,
    "canvas": CanvasContent,
    "database": DatabaseContent,
}

COMPONENT_TYPES = frozenset(CONTENT_SCHEMAS)

# Container types and how many child slots each exposes.
CONTAINER_SLOTS = {"toggle": lambda content: 1, "columns": lambda content: content.get("count", 2)}


def slot_count(component_type: str, content: dict[str, Any]) -> int:
    counter = CONTAINER_SLOTS.get(component_type)
    return counter(content) if counter else 0


def validate_content(component_type: str, content: dict[str, Any] | None) -> dict[str, Any]:
    """Validate and normalise a content payload, raising ValidationFailed on bad input."""

    schema = CONTENT_SCHEMAS.get(component_type)
    if schema is None:
        raise ValidationFailed(
            f"Unknown component type: {component_type}",
            [{"field": "type", "message": "Unsupported component type"}],
        )
    try:
        return schema.model_validate(content or {}).model_dump(mode="json")
    except ValidationError as exc:
        details = [
            {
                "field": "content." + ".".join(str(part) for part in error["loc"]),
                "message": error["msg"],
            }
            for error in exc.errors()
        ]
        raise ValidationFailed("Invalid content for component type", details) from exc
