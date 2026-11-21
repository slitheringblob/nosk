"""Markdown import/export tests."""

from app.models import Component, Page
from app.schemas.component_content import validate_content
from app.services.export_service import export_markdown, import_markdown

SAMPLE = """# Trip plan

Some **bold** and *italic* text
with a [link](https://example.com).

## Packing

- [x] passport
- [ ] charger
  - [ ] cable

1. book flights
2. book hotel

> be early

```python
print("hi")
```

| City | Days |
| --- | --- |
| Rome | 3 |

---
"""


def test_import_produces_valid_blocks() -> None:
    title, blocks = import_markdown(SAMPLE)
    assert title == "Trip plan"
    types = [block["type"] for block in blocks]
    assert types == [
        "text-block",
        "heading",
        "checklist",
        "numbered-list",
        "quote",
        "code",
        "table",
        "divider",
    ]
    for block in blocks:
        validate_content(block["type"], block["content"])
    assert blocks[0]["content"]["text"].startswith("Some <strong>bold</strong> and <em>italic</em>")
    assert blocks[2]["content"]["items"][2]["indent_level"] == 1
    assert blocks[5]["content"]["language"] == "python"


def test_export_round_trips_common_blocks() -> None:
    _, blocks = import_markdown(SAMPLE)
    page = Page(id="p", title="Trip plan", icon=None, tags=["travel"])
    components = [
        Component(
            id=str(n), page_id="p", type=b["type"], content=b["content"], parent_id=None, slot=0
        )
        for n, b in enumerate(blocks)
    ]
    markdown = export_markdown(page, components)
    assert markdown.startswith("# Trip plan")
    assert "- [x] passport" in markdown
    assert "1. book flights" in markdown
    assert '```python\nprint("hi")\n```' in markdown
    assert "| Rome | 3 |" in markdown
    assert "Tags: travel" in markdown
