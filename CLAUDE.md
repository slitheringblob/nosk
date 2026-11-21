# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**nosk** is a task and notes management system designed to sync seamlessly across devices.

It is moving to a git-backed, serverless design: a static app (GitHub Pages) that reads and writes
an Obsidian vault in a GitHub repo. Read `project_plan/GIT_BACKED_PLAN.md` first; milestone 1
(vault reading and editing) lives in `frontend/index.html` + `frontend/js/vault/`. The earlier
FastAPI + block-editor build is still in `backend/` and `frontend/legacy.html`; its plan is
`project_plan/PROJECT_PLAN.md` ("Status & Revisions" section).

## Project Goals

- Create a system for managing tasks and notes
- Enable cross-device synchronization
- Provide a seamless user experience across platforms

## Development Setup

```bash
cd frontend && python -m http.server 3000                                 # vault app on :3000
cd frontend && npm test                                                   # vitest + jsdom
# legacy server build:
cd backend && source venv/bin/activate && uvicorn app.main:app --reload   # API on :8000
cd backend && source venv/bin/activate && pytest                          # backend tests
cd backend && source venv/bin/activate && alembic upgrade head            # migrations
cd backend && source venv/bin/activate && black app tests alembic --line-length 100
# legacy app: same static server, open /legacy.html
cd frontend && npm run format                                             # prettier
cd frontend && npm run vendor                                             # refresh lib/ from node_modules
```

## Architecture: vault mode (`frontend/js/vault/`)

- **The repo is the source of truth.** `github.js` talks to api.github.com directly (CORS) with a
  fine-grained token stored in IndexedDB. Never add a server dependency.
- **Pull** (`sync.js`): branch head → if changed, recursive tree → download only blobs whose sha
  changed. Text comes ~50 files per GraphQL request (`blobTexts`); binaries download on first
  view (`blobUrl`) and are cached by sha. The head is recorded last so interrupted pulls resume.
- **Local edits** go to the `pending` store (`sync.saveLocal/deleteLocal/moveLocal`); the UI
  reads `sync.files()` / `sync.text()`, which overlay pending on GitHub's copy. Never write
  `files` directly: it must always mirror GitHub.
- **Writes** go through `GitHub.commit` (GraphQL `createCommitOnBranch`) with `expectedHead`; a
  moved branch is a 409 and nothing is written. `runPush` then pulls, rebases pending edits with
  `merge3` (overlaps: ours kept, theirs saved as a conflict copy) and retries. Never write with
  the contents API (no optimistic concurrency).
- **Moves** (rename, drag in the tree, Move to…, folder moves) all go through `app.moveFiles`,
  which rewrites `[[wikilinks]]` and `[markdown](links)` vault-wide (`rewriteLinks`; a link is
  only changed when it no longer names the same file exactly, `LinkIndex.resolveStrict`) and
  saves everything with one `sync.moveLocal`. Moved binaries are pending rows with `blobSha`
  (no text); their bytes are sent as base64 at push. `movedFrom` only shapes the commit message.
- Pull, push and local edits run one at a time through `sync.exclusive()`; open editors flush
  via `sync.beforeSync` before each sync.
- **Rendering** (`render.js`): marked + extensions for Obsidian syntax, sanitized with DOMPurify,
  then `hydrate()` adds images, embeds, callouts, math, highlighting. Link resolution follows
  Obsidian (`links.js`).
- **CSP** in `index.html` forbids inline/eval scripts; keep scripts in files.
- **Deploy**: `.github/workflows/pages.yml` copies an explicit file list; add new shell files
  there and to `sw.js` `SHELL`.

## Architecture: legacy server build

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
