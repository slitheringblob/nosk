"""Component nesting, tags/templates, sharing, version history, comments and media.

Also detaches sync_operations.page_id from pages so the change log survives permanent page
deletion, and adds the secondary indexes listed in DATABASE_SCHEMA.md.
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0002_nesting_sharing_history"
down_revision = "0001_initial"
branch_labels = None
depends_on = None

SQLITE_FK_CONVENTION = {"fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s"}


def _drop_sync_page_fk() -> None:
    if op.get_bind().dialect.name == "sqlite":
        # 0001 created the FK unnamed; batch mode recreates the table and needs a name to drop it.
        with op.batch_alter_table(
            "sync_operations", recreate="always", naming_convention=SQLITE_FK_CONVENTION
        ) as batch:
            batch.drop_constraint("fk_sync_operations_page_id_pages", type_="foreignkey")
            batch.alter_column(
                "operation_id", existing_type=sa.String(length=36), type_=sa.String(length=64)
            )
            batch.add_column(sa.Column("audience_user_id", sa.String(length=36), nullable=True))
    else:
        op.drop_constraint("sync_operations_page_id_fkey", "sync_operations", type_="foreignkey")
        op.alter_column(
            "sync_operations",
            "operation_id",
            existing_type=sa.String(length=36),
            type_=sa.String(length=64),
        )
        op.add_column(
            "sync_operations", sa.Column("audience_user_id", sa.String(length=36), nullable=True)
        )


def upgrade() -> None:
    _drop_sync_page_fk()
    op.create_index("ix_sync_entity", "sync_operations", ["entity_type", "entity_id"])
    op.create_index("ix_sync_audience", "sync_operations", ["audience_user_id"])
    op.create_index("ix_sync_operations_user_id", "sync_operations", ["user_id"])
    op.create_index("ix_sync_operations_page_id", "sync_operations", ["page_id"])

    with op.batch_alter_table("pages") as batch:
        batch.add_column(sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"))
        batch.add_column(
            sa.Column("is_template", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.create_index("ix_pages_updated_at", "pages", ["updated_at"])
    op.create_index("ix_pages_user_deleted", "pages", ["user_id", "deleted"])

    with op.batch_alter_table("components") as batch:
        batch.add_column(sa.Column("parent_id", sa.String(length=36), nullable=True))
        batch.add_column(sa.Column("slot", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_components_type", "components", ["type"])
    op.create_index("ix_components_updated_at", "components", ["updated_at"])
    op.create_index("ix_components_parent_id", "components", ["parent_id"])

    op.create_index("ix_users_created_at", "users", ["created_at"])

    op.create_table(
        "page_shares",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "page_id",
            sa.String(length=36),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_page_shares_page_id", "page_shares", ["page_id"])
    op.create_index("ix_page_shares_user_id", "page_shares", ["user_id"])
    op.create_index("uq_page_shares_page_user", "page_shares", ["page_id", "user_id"], unique=True)

    op.create_table(
        "page_snapshots",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "page_id",
            sa.String(length=36),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("created_by", sa.String(length=36), nullable=True),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("is_auto", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
    )
    op.create_index("ix_page_snapshots_page_id", "page_snapshots", ["page_id"])
    op.create_index("ix_page_snapshots_page_created", "page_snapshots", ["page_id", "created_at"])

    op.create_table(
        "comments",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "page_id",
            sa.String(length=36),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("component_id", sa.String(length=36), nullable=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_comments_page_id", "comments", ["page_id"])
    op.create_index("ix_comments_page_component", "comments", ["page_id", "component_id"])

    op.create_table(
        "media_assets",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("checksum", sa.String(length=100), nullable=True),
        sa.Column("filename", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("upload_expires_at", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_media_assets_user_id", "media_assets", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_media_assets_user_id", table_name="media_assets")
    op.drop_table("media_assets")
    op.drop_index("ix_comments_page_component", table_name="comments")
    op.drop_index("ix_comments_page_id", table_name="comments")
    op.drop_table("comments")
    op.drop_index("ix_page_snapshots_page_created", table_name="page_snapshots")
    op.drop_index("ix_page_snapshots_page_id", table_name="page_snapshots")
    op.drop_table("page_snapshots")
    op.drop_index("uq_page_shares_page_user", table_name="page_shares")
    op.drop_index("ix_page_shares_user_id", table_name="page_shares")
    op.drop_index("ix_page_shares_page_id", table_name="page_shares")
    op.drop_table("page_shares")

    op.drop_index("ix_users_created_at", table_name="users")

    op.drop_index("ix_components_parent_id", table_name="components")
    op.drop_index("ix_components_updated_at", table_name="components")
    op.drop_index("ix_components_type", table_name="components")
    with op.batch_alter_table("components") as batch:
        batch.drop_column("slot")
        batch.drop_column("parent_id")

    op.drop_index("ix_pages_user_deleted", table_name="pages")
    op.drop_index("ix_pages_updated_at", table_name="pages")
    with op.batch_alter_table("pages") as batch:
        batch.drop_column("is_template")
        batch.drop_column("tags")

    op.drop_index("ix_sync_operations_page_id", table_name="sync_operations")
    op.drop_index("ix_sync_operations_user_id", table_name="sync_operations")
    op.drop_index("ix_sync_audience", table_name="sync_operations")
    op.drop_index("ix_sync_entity", table_name="sync_operations")
    # Orphaned log rows would violate the restored FK.
    op.execute("DELETE FROM sync_operations WHERE page_id NOT IN (SELECT id FROM pages)")
    with op.batch_alter_table("sync_operations") as batch:
        batch.drop_column("audience_user_id")
        batch.alter_column(
            "operation_id", existing_type=sa.String(length=64), type_=sa.String(length=36)
        )
        batch.create_foreign_key(
            "fk_sync_operations_page_id_pages", "pages", ["page_id"], ["id"], ondelete="CASCADE"
        )
