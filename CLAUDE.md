# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**nosk** is a task and notes management system designed to sync seamlessly across devices. The full plan in `project_plan/` is implemented; read the "Status & Revisions" section of `project_plan/PROJECT_PLAN.md` before changing sync, nesting or auth.

## Project Goals

- Create a system for managing tasks and notes
- Enable cross-device synchronization
- Provide a seamless user experience across platforms

## Development Setup

```bash
cd backend && source venv/bin/activate && uvicorn app.main:app --reload   # API on :8000
cd backend && source venv/bin/activate && pytest                          # backend tests
cd backend && source venv/bin/activate && alembic upgrade head            # migrations
cd backend && source venv/bin/activate && black app tests alembic --line-length 100
cd frontend && python -m http.server 3000                                 # app on :3000
cd frontend && npm test                                                   # vitest + jsdom
cd frontend && npm run format                                             # prettier
cd frontend && npm run vendor                                             # refresh lib/ from node_modules
```

## Architecture

- **Local-first**: the browser writes to IndexedDB (`js/storage.js`) and queues idempotent ops in
  an outbox. `js/sync-client.js` batches pushes (`/api/sync/push`), pulls by cursor
  (`/api/sync/pull`), and listens on `/api/sync/live` for change notifications and presence.
- **One mutation path on the server**: REST endpoints and sync push both call
  `app/services/{page,component}_service.py`, which bump `page.version` and append to
  `sync_operations` via `app/services/oplog.py`. Never write pages/components without going
  through these services, or other devices won't hear about it.
- **Conflicts are per entity**: an op conflicts only when another device changed the same block
  or page after the client's base version (`oplog.concurrent_change`).
- **Nesting**: `components.parent_id` + `slot`; `pages.component_ids` is the single flat order.
- **Data migrations**: a migration that changes existing rows (not just adds empty columns) must
  bump `DATA_EPOCH` in `app/services/sync_service.py`, or devices keep their stale local copies.
- **Components** (`frontend/js/components/`): each block subclasses `BaseComponent`, declares
  static metadata, and is registered in `registry.js`. Content schemas must match
  `backend/app/schemas/component_content.py` (unknown fields are rejected).
- **Conversions** are implemented twice and must stay in sync:
  `backend/app/services/conversion.py` and `frontend/js/component-converter.js`.
- **Design system**: terminal-style tokens in `frontend/css/main.css` (`:root` dark,
  `[data-theme="light"]`); monospace, square corners, amber accent.

## Key Implementation Areas

When developing features, focus on:

- **Data Model**: Task and note structures, relationships, metadata (timestamps, tags, categories)
- **Sync Engine**: Conflict resolution, versioning, offline queue management
- **Storage Layer**: Local persistence and sync state management
- **API/Protocol**: Communication format between devices and any backend services
