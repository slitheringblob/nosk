# nosk v3 — git-backed, no server

**Status:** milestones 1 and 2 done, plus merging and daily notes (2026-11-21), released as v0.1.0. Replaces the FastAPI backend for single-user use.

### Progress

| Milestone | State | Notes |
|---|---|---|
| 1. Read-only vault | done | Tested against the real vault: 394 notes render with no errors; first download 7 s / 13 requests; reopen costs 1 request; offline reload works |
| Write primitive | done | `GitHub.commit` via `createCommitOnBranch`. Real test commit `95c125d` added `nosk/Sample note from nosk.md`; a commit against a stale head was refused (409) and wrote nothing |
| 2. Editing | done | Markdown source editor (not blocks, see below), tickable tasks, new / rename (rewrites links) / delete, pending edits pushed after 15 s idle, on hide or Ctrl+S |
| 3. Merging | done | Line-based diff3 on pull and on a refused push; overlapping edits keep ours and save theirs as a conflict copy. Verified on the real vault with simulated Obsidian commits |
| 4. Journal, templates, history | journal done | Daily notes follow the vault's format (detected); templates and history not started |
| 5. Polish | not started | Attachment upload, QR token transfer, remove the backend |

**Revision (milestone 2):** editing is markdown source, not the block editor. Editing the file
itself can't mangle syntax nosk doesn't understand, needs no markdown⇄blocks round trip, and is
how Obsidian works. The source-span/block plan below is kept for reference only.

## Decision

nosk becomes a static web app on GitHub Pages at `nosk.jaydeepganatra.dev`. The browser reads
and writes an Obsidian vault in a private GitHub repo through the GitHub API. The repo is the
only source of truth; each device keeps a full offline copy in IndexedDB.

- One user, laptop/PC/phone, always online. Edits reach other devices on the next commit and pull
  (seconds to a minute), not instantly.
- Obsidian keeps working on the same repo (the vault already runs obsidian-git), so there are two
  writers and merging is a core feature, not an edge case.
- Dropped: the backend, sharing, comments, live presence, link previews, server-side history.
  History becomes the git log of a file.

## What the vault looks like (measured)

- 430 user files, ~11 MB; 394 `.md`, plus png/svg/pdf/docx, 4 `.excalidraw`, 3 `.canvas`,
  3 `.base`. `.obsidian/` holds config, themes and plugins (ignored apart from the config below).
- About a dozen top-level folders; the largest holds ~120 notes, the daily-notes folder ~100.
- Daily notes: `.obsidian/daily-notes.json` says folder `Worklog`, format `DD-MM-YYYY`; 66 notes
  follow it and 34 older ones use month folders (`Nov-25/12Nov25`). nosk counts matches per
  pattern and uses the most common one.
- Plugins in use that write custom syntax: tasks, calendar, excalidraw, advanced-slides.

## Architecture

```
GitHub Pages (static frontend/)          api.github.com (CORS-enabled)
        │                                         ▲
        ▼                                         │ REST: trees, blobs, compare, commits
   browser ── IndexedDB (files, blocks, outbox) ──┤ GraphQL: createCommitOnBranch
                                                  │
                                        vault repo ◄── Obsidian (obsidian-git)
```

### Auth
A fine-grained personal access token scoped to the one repo (Contents: read/write, Metadata:
read), pasted once per device and stored in IndexedDB. The token is only sent to `api.github.com`.
GitHub's OAuth token exchange has no CORS support, so a real OAuth/GitHub App login needs a small
proxy (e.g. a Cloudflare Worker); that's a later option, not needed for one user. On the phone,
the token can be transferred from the laptop with a QR code instead of typing it.

Hardening: strict CSP (`connect-src https://api.github.com`, no inline script), everything
rendered from markdown goes through DOMPurify (already in place), no third-party scripts.

### Files and identity
- A page is a file; its path is its identity (Obsidian's model). Renames are detected on pull when
  a path disappears and the same blob sha appears elsewhere.
- Per file, IndexedDB stores: `path`, `base_sha` + `base_text` (last version seen on the remote),
  `text` (current), `dirty`, parsed blocks.
- Page metadata lives in frontmatter, and only when it's set: `tags` (native Obsidian),
  `nosk-icon`, `nosk-template`. Files nosk never edited are never rewritten.
- Attachments (images, pdf) are fetched through the API as blobs (the repo is private) and shown
  via object URLs; uploads go to the vault's attachment folder.

### Markdown ⇄ blocks (the hard part)
- Parse each file into blocks that keep their original source span. Saving re-serializes only the
  blocks that changed and splices them back, so untouched text stays byte-identical. This keeps
  Obsidian diffs small and lets merges work.
- Mapped natively: headings, paragraphs, bullet/numbered/task lists (tasks-plugin emoji dates
  kept as text), quotes, callouts `> [!note]`, code, mermaid, math `$$`, tables, dividers, images,
  `[[wikilinks]]` and `![[embeds]]`, frontmatter → properties block.
- Anything nosk doesn't understand (dataview queries, slides separators, HTML, unknown syntax)
  becomes a raw block, shown as rendered markdown and edited as source, and preserved exactly.
- nosk-only blocks (kanban/database, columns, toggle, bookmark...) are written as fenced
  ```` ```nosk-<type> ```` blocks holding JSON; Obsidian shows them as code.
- `.excalidraw`, `.canvas`, `.base`, binaries: listed and openable read-only/download, not edited.
- Conversion logic currently lives in `backend/app/services/conversion.py` and
  `export_service.py`; the JS side (`component-converter.js`, `markdown.js`) becomes the only copy.

### Sync loop
Pull (on open, on focus, every 60 s while visible):
1. `GET /repos/:repo/git/ref/heads/:branch` → head sha. Unchanged → done (1 request).
2. Changed → fetch the recursive tree (one request, ~850 entries), diff blob shas against
   `base_sha`, fetch only changed blobs: text in batches of 50 through GraphQL, binaries
   lazily when first viewed.
3. For each changed file: not dirty locally → replace. Dirty → three-way merge
   (`base_text`, local `text`, remote text) at block level, falling back to line-level diff3.
   Overlapping edits to the same block → the merged file keeps the local version and the remote
   version is saved next to it as `Name (conflict 2026-11-21 phone).md`, and nosk flags it.

Push (30 s after the last edit, when the tab is hidden, or every 2 min with pending edits):
- One `createCommitOnBranch` with all dirty files, `expectedHeadOid` = last pulled head.
  If the branch moved (Obsidian pushed), pull + merge and retry. That gives optimistic
  concurrency without a server.
- Commit message: `nosk: <paths> (<device name>)`.

Rate limits are not a concern for one user (5,000 REST requests/hour; an idle pull is 1).

### Daily journal
- Location and filename come from `daily-notes.json`, checked against the files that exist
  (most common pattern wins), and can be overridden in settings.
- Today / previous / next navigation stays. Entries are found by parsing filenames, so existing
  worklog notes show up immediately.
- Since the path is derived from the date, two devices creating the same day produce the same
  file and the merge handles it (the deterministic-id logic is no longer needed).

### Templates
- A templates folder (setting; default `Templates/`, created on first use). Built-in templates
  ship with the app and can be copied into the vault.
- Pages made from a template get `nosk-template: <template path>` in frontmatter, which keeps
  the "grouped by template" sidebar section working.

### Sidebar
- Primary: the vault's folder tree (collapsible, remembered), since that's how the vault is
  organized. Then "from templates" groups, then the templates section below a divider.
- Resize/close behaviour and the Terminal Mono design system carry over unchanged.

### Search and history
- Search: client-side over IndexedDB (11 MB of text is small); title + full text, tags.
- History: `GET /repos/:repo/commits?path=<file>` lists versions; restoring writes the old blob
  as a new edit.

## Hosting

- GitHub Actions (`.github/workflows/pages.yml`) runs the tests and publishes the app's files
  from `frontend/` to Pages on every push to `main`.
- `nosk.jaydeepganatra.dev`: set as the custom domain in Settings → Pages (a CNAME file is
  ignored for Actions deployments) plus a DNS CNAME record `nosk → slitheringblob.github.io`,
  then "Enforce HTTPS". The apex `jaydeepganatra.dev` already
  points at the user site, so this doesn't touch it.
- The nosk repo is private. Pages for a private repo needs a paid plan; otherwise make the nosk
  repo public (the code holds no secrets; notes and token never touch it) or deploy the same static
  folder to Cloudflare Pages, which works with private repos on the free plan.
- The service worker keeps the app shell cached, so it opens instantly and offline.

## What carries over / what goes

| Keep | Rewrite | Remove |
|---|---|---|
| Editor + 26 components, design system, command palette, dialogs, sidebar layout, drag & drop, keyboard, journal UI, IndexedDB storage, service worker, vitest/Playwright setup | `sync-client.js` → git sync engine; `storage.js` schema → files + blocks; `auth.js`/`login.js` → token setup; `journal.js` → path-based; `sidebar.js` → folder tree; markdown parser/serializer with source spans | `backend/` (kept in git history / the `dev` branch), comments panel, sharing, presence, unfurl, media server |

## Milestones (each shippable)

1. **Read-only vault on any device.** Token setup, pull vault into IndexedDB, folder tree,
   rendered notes with images and wikilinks, search, offline, deployed to
   `nosk.jaydeepganatra.dev`.
2. **Editing.** Markdown ⇄ blocks with source-span preservation, dirty tracking, debounced
   commits via `createCommitOnBranch`, create/rename/delete files.
3. **Merging.** Three-way block merge, conflict copies, retry on moved head, rename detection.
   Tested against a scratch copy of the vault with simulated Obsidian commits.
4. **Journal, templates, history** on the vault's conventions.
5. **Polish.** Attachment upload, QR token transfer, remove the backend.

## Risks

- **Round-trip fidelity.** A serializer bug could rewrite notes. Mitigation: source-span splicing,
  a round-trip test over every note in a copy of the vault (parse → serialize must be identical),
  and all of milestone 1 is read-only.
- **Merge mistakes** with Obsidian editing the same file. Mitigation: never drop text; worst case
  is a conflict copy. Develop against a fork/copy of the vault, not the real one.
- **Token in the browser.** Scoped to one repo; CSP + sanitization; revocable from GitHub settings.
- **Obsidian-specific syntax growth** (new plugins). Unknown syntax is preserved as raw blocks.
