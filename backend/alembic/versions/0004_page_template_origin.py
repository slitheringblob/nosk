"""Remember which template a page was made from."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0004_page_template_origin"
down_revision = "0003_journal_and_settings"
branch_labels = None
depends_on = None

# Built-in templates and the titles pages made from them received before this column existed.
BUILTIN_TITLES = {
    "builtin-meeting-notes": "Meeting notes",
    "builtin-project-plan": "Project plan",
    "builtin-daily-journal": "Daily journal",
    "builtin-reading-list": "Reading list",
}


def upgrade() -> None:
    with op.batch_alter_table("pages") as batch:
        batch.add_column(sa.Column("template_id", sa.String(length=64), nullable=True))
    pages = sa.table(
        "pages",
        sa.column("title", sa.String),
        sa.column("is_template", sa.Boolean),
        sa.column("template_id", sa.String),
    )
    # Best-effort backfill: untouched titles identify pages made from a built-in template.
    for template_id, title in BUILTIN_TITLES.items():
        op.execute(
            pages.update()
            .where(pages.c.title == title, pages.c.is_template == sa.false())
            .values(template_id=template_id)
        )


def downgrade() -> None:
    with op.batch_alter_table("pages") as batch:
        batch.drop_column("template_id")
