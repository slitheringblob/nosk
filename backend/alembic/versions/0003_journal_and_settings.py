"""Daily journal pages and per-user settings."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0003_journal_and_settings"
down_revision = "0002_nesting_sharing_history"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("pages") as batch:
        batch.add_column(sa.Column("journal_date", sa.String(length=10), nullable=True))
    op.create_index("uq_pages_user_journal_date", "pages", ["user_id", "journal_date"], unique=True)
    with op.batch_alter_table("users") as batch:
        batch.add_column(sa.Column("settings", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch:
        batch.drop_column("settings")
    op.drop_index("uq_pages_user_journal_date", table_name="pages")
    with op.batch_alter_table("pages") as batch:
        batch.drop_column("journal_date")
