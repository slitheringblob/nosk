"""Built-in page templates available to every user."""

from __future__ import annotations

from typing import Any


def _item(text: str, checked: bool = False, indent: int = 0) -> dict[str, Any]:
    from uuid import uuid4

    return {"id": str(uuid4()), "text": text, "checked": checked, "indent_level": indent}


def _li(text: str, indent: int = 0) -> dict[str, Any]:
    from uuid import uuid4

    return {"id": str(uuid4()), "text": text, "indent_level": indent}


def _prop(key: str) -> dict[str, Any]:
    from uuid import uuid4

    return {"id": str(uuid4()), "key": key, "value": ""}


def _builtin_definitions() -> list[dict[str, Any]]:
    return [
        {
            "id": "builtin-meeting-notes",
            "title": "Meeting notes",
            "icon": "🗓️",
            "description": "Agenda, notes and action items for a meeting.",
            "blocks": [
                {
                    "type": "properties",
                    "content": {
                        "items": [
                            _prop("Date"),
                            _prop("Attendees"),
                        ]
                    },
                },
                {"type": "heading", "content": {"text": "Agenda", "level": 2}},
                {"type": "bullet-list", "content": {"items": [_li("")]}},
                {"type": "heading", "content": {"text": "Notes", "level": 2}},
                {"type": "text-block", "content": {"text": "", "format": "html"}},
                {"type": "heading", "content": {"text": "Action items", "level": 2}},
                {"type": "checklist", "content": {"items": [_item("")]}},
            ],
        },
        {
            "id": "builtin-project-plan",
            "title": "Project plan",
            "icon": "🚀",
            "description": "Goals, milestones and a task tracker.",
            "blocks": [
                {
                    "type": "callout",
                    "content": {"text": "One-sentence summary of the project.", "variant": "info"},
                },
                {"type": "heading", "content": {"text": "Goals", "level": 2}},
                {"type": "numbered-list", "content": {"items": [_li("")], "start_number": 1}},
                {"type": "heading", "content": {"text": "Milestones", "level": 2}},
                {
                    "type": "database",
                    "content": {
                        "title": "Milestones",
                        "columns": [
                            {"id": "name", "name": "Milestone", "type": "text", "options": []},
                            {
                                "id": "status",
                                "name": "Status",
                                "type": "select",
                                "options": ["Not started", "In progress", "Done"],
                            },
                            {"id": "due", "name": "Due", "type": "date", "options": []},
                        ],
                        "rows": [],
                    },
                },
                {"type": "heading", "content": {"text": "Risks", "level": 2}},
                {"type": "bullet-list", "content": {"items": [_li("")]}},
            ],
        },
        {
            "id": "builtin-daily-journal",
            "title": "Daily journal",
            "icon": "📓",
            "description": "A short daily reflection with a to-do list.",
            "blocks": [
                {
                    "type": "date",
                    "content": {"date": None, "include_time": False, "label": "Today"},
                },
                {"type": "heading", "content": {"text": "Top priorities", "level": 3}},
                {"type": "checklist", "content": {"items": [_item(""), _item(""), _item("")]}},
                {"type": "heading", "content": {"text": "Notes", "level": 3}},
                {"type": "text-block", "content": {"text": "", "format": "html"}},
                {"type": "toggle", "content": {"title": "Gratitude", "is_open": False}},
                {"type": "bullet-list", "content": {"items": [_li("")]}, "parent_index": 5},
            ],
        },
        {
            "id": "builtin-reading-list",
            "title": "Reading list",
            "icon": "📚",
            "description": "Track books and articles.",
            "blocks": [
                {
                    "type": "database",
                    "content": {
                        "title": "Reading list",
                        "columns": [
                            {"id": "title", "name": "Title", "type": "text", "options": []},
                            {"id": "author", "name": "Author", "type": "text", "options": []},
                            {"id": "done", "name": "Read", "type": "checkbox", "options": []},
                            {"id": "link", "name": "Link", "type": "url", "options": []},
                        ],
                        "rows": [],
                    },
                },
            ],
        },
    ]


def builtin_templates() -> list[dict[str, Any]]:
    return _builtin_definitions()


def get_builtin(template_id: str) -> dict[str, Any] | None:
    return next((t for t in _builtin_definitions() if t["id"] == template_id), None)
