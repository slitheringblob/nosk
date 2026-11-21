# nosk Database Schema

**Version**: 1.0
**Database**: PostgreSQL 14+ (production) / SQLite 3.35+ (development)
**ORM**: SQLAlchemy 2.0+

---

## Table of Contents

1. [Overview](#overview)
2. [Tables](#tables)
3. [Relationships](#relationships)
4. [Indexes](#indexes)
5. [Constraints](#constraints)
6. [Migrations](#migrations)
7. [Sample Data](#sample-data)

---

## Overview

### Database Design Principles

1. **Normalized**: 3NF to reduce redundancy
2. **Soft Deletes**: Use `deleted` flag instead of hard deletes
3. **Timestamps**: All tables have `created_at` and `updated_at`
4. **UUIDs**: Use UUID v4 for primary keys (better for distributed systems)
5. **JSON Storage**: Component content stored as JSON for flexibility
6. **Version Tracking**: Pages have version numbers for conflict detection

### Entity Relationship Diagram

```
┌─────────────┐
│    users    │
└──────┬──────┘
       │ 1
       │
       │ N
┌──────┴──────┐
│    pages    │
└──────┬──────┘
       │ 1
       │
       │ N
┌──────┴──────────┐
│   components    │
└─────────────────┘
```

---

## Tables

### users

Stores user account information.

**Schema**:

```sql
CREATE TABLE users (
    id VARCHAR(36) PRIMARY KEY,              -- UUID v4
    email VARCHAR(255) NOT NULL UNIQUE,      -- User email (unique)
    password_hash VARCHAR(255) NOT NULL,     -- Bcrypt hashed password
    created_at BIGINT NOT NULL,              -- Unix timestamp (ms)
    last_login BIGINT,                       -- Last login timestamp
    is_active BOOLEAN DEFAULT TRUE,          -- Account active status
    is_verified BOOLEAN DEFAULT FALSE        -- Email verification status
);
```

**Columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR(36) | NO | - | UUID primary key |
| `email` | VARCHAR(255) | NO | - | User email address |
| `password_hash` | VARCHAR(255) | NO | - | Bcrypt hashed password |
| `created_at` | BIGINT | NO | - | Account creation timestamp |
| `last_login` | BIGINT | YES | NULL | Last login timestamp |
| `is_active` | BOOLEAN | NO | TRUE | Account active flag |
| `is_verified` | BOOLEAN | NO | FALSE | Email verified flag |

**Indexes**:
- `PRIMARY KEY (id)`
- `UNIQUE INDEX idx_users_email ON users(email)`
- `INDEX idx_users_created_at ON users(created_at)`

**Constraints**:
- Email must be valid format (enforced by application)
- Password hash must be bcrypt format (enforced by application)

---

### pages

Stores page metadata and component references.

**Schema**:

```sql
CREATE TABLE pages (
    id VARCHAR(36) PRIMARY KEY,              -- UUID v4
    user_id VARCHAR(36) NOT NULL,            -- Owner user ID
    title VARCHAR(200) NOT NULL,             -- Page title
    component_ids JSON NOT NULL DEFAULT '[]',-- Ordered array of component IDs
    created_at BIGINT NOT NULL,              -- Creation timestamp
    updated_at BIGINT NOT NULL,              -- Last update timestamp
    version INTEGER NOT NULL DEFAULT 0,      -- Version for sync conflict detection
    deleted BOOLEAN NOT NULL DEFAULT FALSE,  -- Soft delete flag
    icon VARCHAR(10),                        -- Emoji icon (optional)
    color VARCHAR(20),                       -- Color hex code (optional)

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR(36) | NO | - | UUID primary key |
| `user_id` | VARCHAR(36) | NO | - | Foreign key to users |
| `title` | VARCHAR(200) | NO | - | Page title |
| `component_ids` | JSON | NO | `[]` | Ordered component ID array |
| `created_at` | BIGINT | NO | - | Creation timestamp |
| `updated_at` | BIGINT | NO | - | Update timestamp |
| `version` | INTEGER | NO | 0 | Version number |
| `deleted` | BOOLEAN | NO | FALSE | Soft delete flag |
| `icon` | VARCHAR(10) | YES | NULL | Page icon (emoji) |
| `color` | VARCHAR(20) | YES | NULL | Page color (hex) |

**Indexes**:
- `PRIMARY KEY (id)`
- `INDEX idx_pages_user_id ON pages(user_id)`
- `INDEX idx_pages_updated_at ON pages(updated_at)`
- `INDEX idx_pages_deleted ON pages(deleted)`
- `INDEX idx_pages_user_deleted ON pages(user_id, deleted)`

**Constraints**:
- `title` max length: 200 characters
- `icon` max length: 10 characters (emoji)
- `color` format: `#RRGGBB` or NULL
- `component_ids` must be valid JSON array
- `version` must be non-negative

**Notes**:
- `component_ids` is the canonical ordering for components on a page. The backend updates the array
  and each component's `order` column inside a single transaction to keep derived data consistent.

**Foreign Keys**:
- `user_id` → `users.id` (CASCADE on delete)

---

### components

Stores component data for pages.

**Schema**:

```sql
CREATE TABLE components (
    id VARCHAR(36) PRIMARY KEY,              -- UUID v4
    page_id VARCHAR(36) NOT NULL,            -- Parent page ID
    type VARCHAR(50) NOT NULL,               -- Component type
    content JSON NOT NULL,                   -- Component content (type-specific)
    created_at BIGINT NOT NULL,              -- Creation timestamp
    updated_at BIGINT NOT NULL,              -- Last update timestamp
    "order" INTEGER NOT NULL DEFAULT 0,      -- Position in page (0-indexed)
    schema_version INTEGER NOT NULL DEFAULT 1,-- Schema version for migrations

    FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);
```

**Note**: `order` is quoted because it's a reserved SQL keyword.

**Columns**:

| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| `id` | VARCHAR(36) | NO | - | UUID primary key |
| `page_id` | VARCHAR(36) | NO | - | Foreign key to pages |
| `type` | VARCHAR(50) | NO | - | Component type identifier |
| `content` | JSON | NO | - | Component content data |
| `created_at` | BIGINT | NO | - | Creation timestamp |
| `updated_at` | BIGINT | NO | - | Update timestamp |
| `order` | INTEGER | NO | 0 | Order in page |
| `schema_version` | INTEGER | NO | 1 | Schema version |

**Indexes**:
- `PRIMARY KEY (id)`
- `INDEX idx_components_page_id ON components(page_id)`
- `INDEX idx_components_page_order ON components(page_id, "order")`
- `INDEX idx_components_type ON components(type)`
- `INDEX idx_components_updated_at ON components(updated_at)`

**Constraints**:
- `type` must be valid component type (enforced by application)
- `content` must be valid JSON matching component schema
- `order` must be non-negative
- `schema_version` must be positive

**Notes**:
- `order` is denormalized for efficient SQL sorting; it is always derived from `pages.component_ids`
  and should not be mutated directly outside the reorder service.

**Foreign Keys**:
- `page_id` → `pages.id` (CASCADE on delete)

**Valid Component Types**:
- `text-block`
- `heading`
- `markdown`
- `checklist`
- `bullet-list`
- `numbered-list`
- `toggle`
- `callout`
- `divider`

---

### user_sessions

Tracks refresh tokens / device sessions for multi-device authentication.

**Schema**:

```sql
CREATE TABLE user_sessions (
    id VARCHAR(36) PRIMARY KEY,              -- UUID v4
    user_id VARCHAR(36) NOT NULL,            -- Session owner
    device_id VARCHAR(100) NOT NULL,         -- Stable device identifier
    device_name VARCHAR(100),                -- Human-readable label
    refresh_token_hash VARCHAR(255) NOT NULL,-- Hashed refresh token
    issued_at BIGINT NOT NULL,               -- Unix timestamp (ms)
    expires_at BIGINT NOT NULL,              -- Expiration timestamp
    last_used_at BIGINT,                     -- Last refresh time
    user_agent TEXT,                         -- Optional agent string
    ip_address INET,                         -- Last known IP (Postgres)
    revoked_at BIGINT,                       -- Revocation timestamp

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

**Indexes**:
- `INDEX idx_sessions_user ON user_sessions(user_id)`
- `UNIQUE INDEX idx_sessions_device ON user_sessions(user_id, device_id)`
- `INDEX idx_sessions_active ON user_sessions(user_id) WHERE revoked_at IS NULL`

**Notes**:
- Refresh tokens are stored as bcrypt hashes; only hashes are persisted.
- Revoking a session sets `revoked_at` and deletes queued sync operations for that `device_id`.
- SQLite dev environments should store `ip_address` as TEXT because `INET` is PostgreSQL-specific.

---

### sync_operations

Stores all mutations so devices can replay incremental changes and detect conflicts.

**Schema**:

```sql
CREATE TABLE sync_operations (
    id BIGSERIAL PRIMARY KEY,                -- Auto-increment ID
    operation_id VARCHAR(36) NOT NULL,       -- Client-supplied UUID
    user_id VARCHAR(36) NOT NULL,            -- User who made change
    operation_type VARCHAR(50) NOT NULL,     -- Type of operation
    entity_type VARCHAR(50) NOT NULL,        -- page or component
    entity_id VARCHAR(36) NOT NULL,          -- Page or component ID
    page_id VARCHAR(36) NOT NULL,            -- Convenience reference
    page_version INTEGER NOT NULL,           -- Version after operation
    data JSON,                               -- Operation data
    timestamp BIGINT NOT NULL,               -- Operation timestamp (ms)
    device_id VARCHAR(100),                  -- Device identifier
    synced BOOLEAN DEFAULT FALSE,            -- Whether another device consumed it

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);
```

**Operation Types**:
- `create`
- `update`
- `delete`
- `reorder`
- `restore`

**Indexes**:
- `PRIMARY KEY (id)`
- `UNIQUE INDEX idx_sync_operation_id ON sync_operations(operation_id)`
- `INDEX idx_sync_user_timestamp ON sync_operations(user_id, timestamp)`
- `INDEX idx_sync_entity ON sync_operations(entity_type, entity_id)`
- `INDEX idx_sync_page_version ON sync_operations(page_id, page_version)`
- `INDEX idx_sync_synced ON sync_operations(synced)`

---

## Relationships

### One-to-Many Relationships

1. **users → pages**
   - One user can have many pages
   - `pages.user_id` → `users.id`
   - Cascade delete: If user is deleted, all their pages are deleted

2. **pages → components**
   - One page can have many components
   - `components.page_id` → `pages.id`
   - Cascade delete: If page is deleted, all its components are deleted

### Referential Integrity

```python
# SQLAlchemy ORM relationships

class User(Base):
    __tablename__ = "users"

    id = Column(String(36), primary_key=True)
    pages = relationship("Page", back_populates="user", cascade="all, delete-orphan")

class Page(Base):
    __tablename__ = "pages"

    id = Column(String(36), primary_key=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)

    user = relationship("User", back_populates="pages")
    components = relationship("Component", back_populates="page", cascade="all, delete-orphan")

class Component(Base):
    __tablename__ = "components"

    id = Column(String(36), primary_key=True)
    page_id = Column(String(36), ForeignKey("pages.id"), nullable=False)

    page = relationship("Page", back_populates="components")
```

---

## Indexes

### Performance Indexes

**users table**:
```sql
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_created_at ON users(created_at);
CREATE INDEX idx_users_active ON users(is_active) WHERE is_active = TRUE;
```

**pages table**:
```sql
CREATE INDEX idx_pages_user_id ON pages(user_id);
CREATE INDEX idx_pages_updated_at ON pages(updated_at);
CREATE INDEX idx_pages_deleted ON pages(deleted);
CREATE INDEX idx_pages_user_deleted ON pages(user_id, deleted);
CREATE INDEX idx_pages_user_updated ON pages(user_id, updated_at) WHERE deleted = FALSE;
```

**components table**:
```sql
CREATE INDEX idx_components_page_id ON components(page_id);
CREATE INDEX idx_components_page_order ON components(page_id, "order");
CREATE INDEX idx_components_type ON components(type);
CREATE INDEX idx_components_updated_at ON components(updated_at);
```

### Index Usage

| Query Pattern | Index Used |
|---------------|------------|
| Get user by email | `idx_users_email` |
| Get pages for user | `idx_pages_user_id` |
| Get non-deleted pages | `idx_pages_user_deleted` |
| Get components for page | `idx_components_page_id` |
| Get components ordered | `idx_components_page_order` |
| Sync changes since timestamp | `idx_pages_updated_at`, `idx_components_updated_at` |

---

## Constraints

### Primary Keys

All tables use UUID v4 as primary key:
- Globally unique across distributed systems
- Non-sequential (better for security)
- 36 characters (with hyphens)

```python
import uuid

def generate_uuid():
    return str(uuid.uuid4())
```

### Foreign Keys

- `pages.user_id` → `users.id` (CASCADE)
- `components.page_id` → `pages.id` (CASCADE)

### Unique Constraints

- `users.email` must be unique

### Check Constraints

```sql
-- PostgreSQL check constraints
ALTER TABLE pages ADD CONSTRAINT check_pages_title_length
    CHECK (LENGTH(title) > 0 AND LENGTH(title) <= 200);

ALTER TABLE pages ADD CONSTRAINT check_pages_version
    CHECK (version >= 0);

ALTER TABLE components ADD CONSTRAINT check_components_order
    CHECK ("order" >= 0);

ALTER TABLE components ADD CONSTRAINT check_components_schema_version
    CHECK (schema_version > 0);
```

### Not Null Constraints

All timestamps, IDs, and core fields are NOT NULL to ensure data integrity.

---

## Migrations

### Alembic Setup

```bash
# Initialize Alembic
alembic init alembic

# Create migration
alembic revision --autogenerate -m "Create initial tables"

# Apply migration
alembic upgrade head

# Rollback migration
alembic downgrade -1
```

### Initial Migration

**File**: `alembic/versions/001_create_initial_tables.py`

```python
"""Create initial tables

Revision ID: 001
Revises:
Create Date: 2026-01-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers
revision = '001'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    # Create users table
    op.create_table(
        'users',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('password_hash', sa.String(255), nullable=False),
        sa.Column('created_at', sa.BigInteger, nullable=False),
        sa.Column('last_login', sa.BigInteger, nullable=True),
        sa.Column('is_active', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('is_verified', sa.Boolean, nullable=False, server_default='false')
    )
    op.create_index('idx_users_email', 'users', ['email'])
    op.create_index('idx_users_created_at', 'users', ['created_at'])

    # Create pages table
    op.create_table(
        'pages',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('user_id', sa.String(36), nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('component_ids', postgresql.JSON, nullable=False, server_default='[]'),
        sa.Column('created_at', sa.BigInteger, nullable=False),
        sa.Column('updated_at', sa.BigInteger, nullable=False),
        sa.Column('version', sa.Integer, nullable=False, server_default='0'),
        sa.Column('deleted', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('icon', sa.String(10), nullable=True),
        sa.Column('color', sa.String(20), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE')
    )
    op.create_index('idx_pages_user_id', 'pages', ['user_id'])
    op.create_index('idx_pages_updated_at', 'pages', ['updated_at'])
    op.create_index('idx_pages_deleted', 'pages', ['deleted'])
    op.create_index('idx_pages_user_deleted', 'pages', ['user_id', 'deleted'])

    # Create components table
    op.create_table(
        'components',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('page_id', sa.String(36), nullable=False),
        sa.Column('type', sa.String(50), nullable=False),
        sa.Column('content', postgresql.JSON, nullable=False),
        sa.Column('created_at', sa.BigInteger, nullable=False),
        sa.Column('updated_at', sa.BigInteger, nullable=False),
        sa.Column('order', sa.Integer, nullable=False, server_default='0'),
        sa.Column('schema_version', sa.Integer, nullable=False, server_default='1'),
        sa.ForeignKeyConstraint(['page_id'], ['pages.id'], ondelete='CASCADE')
    )
    op.create_index('idx_components_page_id', 'components', ['page_id'])
    op.create_index('idx_components_page_order', 'components', ['page_id', 'order'])
    op.create_index('idx_components_type', 'components', ['type'])
    op.create_index('idx_components_updated_at', 'components', ['updated_at'])

def downgrade():
    op.drop_table('components')
    op.drop_table('pages')
    op.drop_table('users')
```

### Migration Best Practices

1. **Always test migrations**: Run on dev/staging before production
2. **Backup before migrate**: Backup database before running migrations
3. **Reversible migrations**: Include `downgrade()` for rollbacks
4. **Version control**: Commit migration files to git
5. **Data migrations**: Separate data changes from schema changes

---

## Sample Data

### Development Seed Data

```sql
-- Insert test user
INSERT INTO users (id, email, password_hash, created_at, is_active, is_verified)
VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'test@example.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5lW2mXZP9eGYa', -- password: test123
    1706284800000,
    TRUE,
    TRUE
);

-- Insert test page
INSERT INTO pages (id, user_id, title, component_ids, created_at, updated_at, version, deleted, icon, color)
VALUES (
    'page-660e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440000',
    'Welcome to nosk',
    '["comp-1", "comp-2", "comp-3"]'::json,
    1706284800000,
    1706284800000,
    0,
    FALSE,
    '📝',
    '#3498db'
);

-- Insert text block component
INSERT INTO components (id, page_id, type, content, created_at, updated_at, "order", schema_version)
VALUES (
    'comp-1',
    'page-660e8400-e29b-41d4-a716-446655440001',
    'heading',
    '{"text": "Welcome to nosk", "level": 1}'::json,
    1706284800000,
    1706284800000,
    0,
    1
);

-- Insert checklist component
INSERT INTO components (id, page_id, type, content, created_at, updated_at, "order", schema_version)
VALUES (
    'comp-2',
    'page-660e8400-e29b-41d4-a716-446655440001',
    'text-block',
    '{"text": "A <strong>powerful</strong> note-taking system", "format": "html"}'::json,
    1706284800000,
    1706284800000,
    1,
    1
);

-- Insert divider
INSERT INTO components (id, page_id, type, content, created_at, updated_at, "order", schema_version)
VALUES (
    'comp-3',
    'page-660e8400-e29b-41d4-a716-446655440001',
    'checklist',
    '{"items": [{"id": "item-1", "text": "Create your first page", "checked": true, "indent_level": 0}, {"id": "item-2", "text": "Add some components", "checked": false, "indent_level": 0}]}'::json,
    1706284800000,
    1706284800000,
    2,
    1
);
```

---

## Database Maintenance

### Vacuum (PostgreSQL)

```sql
-- Reclaim storage and update statistics
VACUUM ANALYZE users;
VACUUM ANALYZE pages;
VACUUM ANALYZE components;
```

### Analyze Performance

```sql
-- Check table sizes
SELECT
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check index usage
SELECT
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
```

### Backup

```bash
# PostgreSQL backup
pg_dump -U postgres nosk > backup_$(date +%Y%m%d_%H%M%S).sql

# SQLite backup
sqlite3 nosk.db ".backup 'backup_$(date +%Y%m%d_%H%M%S).db'"
```

---

## Security Considerations

1. **Password Storage**: Always use bcrypt with salt rounds ≥ 12
2. **SQL Injection**: Use parameterized queries (SQLAlchemy handles this)
3. **Access Control**: Verify user_id before any operation
4. **Soft Deletes**: Use `deleted` flag to allow recovery
5. **Audit Trail**: Log important operations (future: audit table)

---

## Performance Tuning

### Query Optimization

```sql
-- Good: Uses index
SELECT * FROM pages WHERE user_id = ? AND deleted = FALSE;

-- Bad: Full table scan
SELECT * FROM pages WHERE title LIKE '%search%';

-- Good: Limited results
SELECT * FROM pages WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100;
```

### Connection Pooling

```python
# SQLAlchemy connection pool
engine = create_engine(
    DATABASE_URL,
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True
)
```

---

**Last Updated**: 2026-01-27
**Version**: 1.0

---

## v2 — Implemented schema changes (migration `0002_nesting_sharing_history`)

**Changed tables**

- `pages`: `+ tags JSON NOT NULL DEFAULT '[]'`, `+ is_template BOOLEAN NOT NULL DEFAULT FALSE`;
  indexes `ix_pages_updated_at`, `ix_pages_user_deleted`.
- `components`: `+ parent_id VARCHAR(36) NULL` (container block), `+ slot INTEGER NOT NULL DEFAULT 0`
  (column index); indexes on `type`, `updated_at`, `parent_id`. Nesting replaces
  `toggle.content.children`. `pages.component_ids` stays the single flat order; siblings render in
  that order.
- `sync_operations`: **FK on `page_id` removed** so the log survives permanent page deletion;
  `operation_id` widened to 64; `+ audience_user_id` (extra recipient, e.g. the user a page was
  unshared from); indexes on `(entity_type, entity_id)`, `audience_user_id`, `user_id`, `page_id`.
  `id` is the sync cursor. `operation_type` stores the change type (`component_updated`, …).
- `users`: index `ix_users_created_at`.

**New tables**

```sql
CREATE TABLE page_shares (
    id VARCHAR(36) PRIMARY KEY,
    page_id VARCHAR(36) NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,              -- viewer | editor
    created_at BIGINT NOT NULL,
    UNIQUE (page_id, user_id)
);

CREATE TABLE page_snapshots (               -- version history
    id VARCHAR(36) PRIMARY KEY,
    page_id VARCHAR(36) NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    created_by VARCHAR(36),
    label VARCHAR(200),
    is_auto BOOLEAN NOT NULL DEFAULT FALSE, -- auto snapshots are pruned to the latest 50
    title VARCHAR(200) NOT NULL,
    data JSON NOT NULL                      -- {page: {...}, components: [...]}
);

CREATE TABLE comments (
    id VARCHAR(36) PRIMARY KEY,
    page_id VARCHAR(36) NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    component_id VARCHAR(36),               -- NULL = page-level comment
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
);

CREATE TABLE media_assets (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    checksum VARCHAR(100),                  -- "sha256:<hex>", verified on upload
    filename VARCHAR(255),
    status VARCHAR(20) NOT NULL,            -- pending | ready
    created_at BIGINT NOT NULL,
    upload_expires_at BIGINT NOT NULL
);
```

Files are stored under `MEDIA_ROOT/<user_id>/<asset_id>`.

**Notes**

- Refresh tokens are stored as keyed SHA-256 (HMAC) hashes, not bcrypt (see plan revision 7).
- Email verification / password reset use stateless signed tokens; no table is needed.
- SQLite connections enable `PRAGMA foreign_keys=ON` so cascades work in development.
- JSON is written with `ensure_ascii=False` so non-ASCII text in blocks is searchable.

## v2.1 — migration `0003_journal_and_settings`

- `pages.journal_date VARCHAR(10) NULL` with unique index `uq_pages_user_journal_date
  (user_id, journal_date)`; NULLs don't collide, so ordinary pages are unaffected.
- `users.settings JSON NOT NULL DEFAULT '{}'`: per-user preferences (`journal_template_id`,
  `journal_salt`).

## v2.2 — migration `0004_page_template_origin`

- `pages.template_id VARCHAR(64) NULL`: the template a page was made from. The migration
  backfills pages whose title exactly matches a built-in template's title (how such pages were
  named before this column existed).
