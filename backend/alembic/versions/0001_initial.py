"""Initial database schema."""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("last_login", sa.BigInteger(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    op.create_table(
        "pages",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("component_ids", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("icon", sa.String(length=10), nullable=True),
        sa.Column("color", sa.String(length=20), nullable=True),
    )
    op.create_index("ix_pages_user_id", "pages", ["user_id"], unique=False)
    op.create_index("ix_pages_deleted", "pages", ["deleted"], unique=False)

    op.create_table(
        "components",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "page_id",
            sa.String(length=36),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.BigInteger(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index("ix_components_page_id", "components", ["page_id"], unique=False)
    op.create_index("ix_components_page_order", "components", ["page_id", "order"], unique=False)

    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("device_id", sa.String(length=100), nullable=False),
        sa.Column("device_name", sa.String(length=100), nullable=True),
        sa.Column("refresh_token_hash", sa.String(length=255), nullable=False),
        sa.Column("issued_at", sa.BigInteger(), nullable=False),
        sa.Column("expires_at", sa.BigInteger(), nullable=False),
        sa.Column("last_used_at", sa.BigInteger(), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("ip_address", sa.String(length=45), nullable=True),
        sa.Column("revoked_at", sa.BigInteger(), nullable=True),
    )
    op.create_index("ix_user_sessions_user_id", "user_sessions", ["user_id"], unique=False)
    op.create_index(
        "uq_user_sessions_user_device", "user_sessions", ["user_id", "device_id"], unique=True
    )

    op.create_table(
        "sync_operations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("operation_id", sa.String(length=36), nullable=False),
        sa.Column(
            "user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("operation_type", sa.String(length=50), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("entity_id", sa.String(length=36), nullable=False),
        sa.Column(
            "page_id",
            sa.String(length=36),
            sa.ForeignKey("pages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("page_version", sa.Integer(), nullable=False),
        sa.Column("data", sa.JSON(), nullable=True),
        sa.Column("timestamp", sa.BigInteger(), nullable=False),
        sa.Column("device_id", sa.String(length=100), nullable=True),
        sa.Column("synced", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_sync_operation_id", "sync_operations", ["operation_id"], unique=True)
    op.create_index(
        "ix_sync_user_timestamp", "sync_operations", ["user_id", "timestamp"], unique=False
    )
    op.create_index(
        "ix_sync_page_version", "sync_operations", ["page_id", "page_version"], unique=False
    )


def downgrade() -> None:
    op.drop_index("ix_sync_page_version", table_name="sync_operations")
    op.drop_index("ix_sync_user_timestamp", table_name="sync_operations")
    op.drop_index("ix_sync_operation_id", table_name="sync_operations")
    op.drop_table("sync_operations")

    op.drop_index("uq_user_sessions_user_device", table_name="user_sessions")
    op.drop_index("ix_user_sessions_user_id", table_name="user_sessions")
    op.drop_table("user_sessions")

    op.drop_index("ix_components_page_order", table_name="components")
    op.drop_index("ix_components_page_id", table_name="components")
    op.drop_table("components")

    op.drop_index("ix_pages_deleted", table_name="pages")
    op.drop_index("ix_pages_user_id", table_name="pages")
    op.drop_table("pages")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
