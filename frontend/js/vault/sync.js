// Keeps the device's copy of the vault and GitHub in step.
//
// Pull: one request when nothing changed (the branch head); otherwise a tree listing and the
// changed files. Local edits wait in the `pending` store and are rebased onto whatever the pull
// brought in (three-way merge). Push: all pending edits in one commit that only lands if the
// branch is still where we last saw it; if Obsidian pushed first, pull, merge, and try again.
// Pull, push and local edits run one at a time, so they never see each other half-done.
import { GitHubError, OfflineError } from './github.js';
import { gitBlobSha, merge3 } from './merge.js';
import { Emitter } from '../utils.js';

const NOTE_EXT = new Set(['md', 'markdown']);
const TEXT_EXT = new Set([
    'txt',
    'json',
    'canvas',
    'base',
    'excalidraw',
    'csv',
    'tsv',
    'yml',
    'yaml',
    'css',
    'js',
    'html',
    'xml',
    'drawio',
    'log',
]);
const IMAGE_TYPES = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    avif: 'image/avif',
    bmp: 'image/bmp',
    svg: 'image/svg+xml',
};
// Obsidian settings nosk reads (daily notes, templates). The rest of .obsidian is ignored.
const CONFIG_FILES = new Set(['.obsidian/app.json', '.obsidian/daily-notes.json', '.obsidian/templates.json']);
// Larger text files are downloaded when opened instead of on every pull.
const EAGER_TEXT_LIMIT = 2 * 1024 * 1024;
const TEXT_BATCH = 50;
// Local edits are committed this long after the last change (or right away on hide / Ctrl+S).
const PUSH_DELAY_MS = 15_000;
const MAX_PUSH_ATTEMPTS = 4;

export const extOf = (path) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};

/** note | text | image | pdf | config | file */
export function kindOf(path) {
    if (CONFIG_FILES.has(path)) return 'config';
    const ext = extOf(path);
    if (NOTE_EXT.has(ext)) return 'note';
    if (TEXT_EXT.has(ext)) return 'text';
    if (IMAGE_TYPES[ext]) return 'image';
    if (ext === 'pdf') return 'pdf';
    return 'file';
}

export function mimeOf(path) {
    const ext = extOf(path);
    if (IMAGE_TYPES[ext]) return IMAGE_TYPES[ext];
    if (ext === 'pdf') return 'application/pdf';
    if (NOTE_EXT.has(ext) || TEXT_EXT.has(ext)) return 'text/plain;charset=utf-8';
    return 'application/octet-stream';
}

/** Hidden paths (.obsidian, .git*, .trash) are skipped, apart from the settings nosk reads. */
export function isTracked(path) {
    return CONFIG_FILES.has(path) || !path.split('/').some((part) => part.startsWith('.'));
}

function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}

export const hasText = (kind) => kind === 'note' || kind === 'text' || kind === 'config';
const eager = (file) => hasText(file.kind) && file.size <= EAGER_TEXT_LIMIT;
const decoder = new TextDecoder('utf-8');

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '');

/** "Folder/Note (conflict 2026-11-21 14.05).md" next to the original. */
export function conflictPath(path, date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
    const name = path.slice(dirOf(path).length);
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    return `${dirOf(path)}${stem} (conflict ${stamp})${ext}`;
}

/** Commit message for a set of additions and deletions. */
export function commitMessage(additions, deletions, existing) {
    const moved = new Set(
        additions.filter((a) => a.movedFrom && deletions.includes(a.movedFrom)).map((a) => a.movedFrom),
    );
    const lines = [
        ...additions.map((a) =>
            moved.has(a.movedFrom)
                ? `move ${a.movedFrom} → ${a.path}`
                : `${existing.has(a.path) ? 'edit' : 'add'} ${a.path}`,
        ),
        ...deletions.filter((path) => !moved.has(path)).map((path) => `delete ${path}`),
    ];
    if (lines.length === 1) return `nosk: ${lines[0]}`;
    return `nosk: update ${lines.length} files\n\n${lines.join('\n')}`;
}

async function pool(items, size, fn) {
    let next = 0;
    const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
        while (next < items.length) await fn(items[next++]);
    });
    await Promise.all(workers);
}

export class VaultSync extends Emitter {
    constructor({ store, github, branch, concurrency = 6, intervalMs = 60_000, pushDelayMs = PUSH_DELAY_MS }) {
        super();
        this.store = store;
        this.github = github;
        this.branch = branch;
        this.concurrency = concurrency;
        this.intervalMs = intervalMs;
        this.pushDelayMs = pushDelayMs;
        this.state = 'idle';
        this.error = null;
        this.lastPull = 0;
        this.pendingCount = 0;
        this.urls = new Map();
        this.lock = Promise.resolve();
        this.pulling = null;
        this.pushing = null;
        // Called before every pull/push so open editors can save what's in them first.
        this.beforeSync = null;
    }

    setState(state, error = null) {
        if (state === 'idle' && this.pendingCount) state = 'pending';
        this.state = state;
        this.error = error;
        this.emit('state', { state, error, pending: this.pendingCount });
    }

    failed(error) {
        if (error instanceof OfflineError) this.setState('offline', error);
        else if (error instanceof GitHubError && error.status === 401) this.setState('auth', error);
        else if (
            error instanceof GitHubError &&
            error.status === 403 &&
            !error.retryAfter &&
            !/rate limit/i.test(error.message)
        ) {
            this.setState('readonly', error);
        } else this.setState('error', error);
    }

    async countPending() {
        this.pendingCount = (await this.store.allPending()).length;
        return this.pendingCount;
    }

    /** Run `fn` once nothing else is reading or writing the store. */
    exclusive(fn) {
        const run = this.lock.then(fn, fn);
        this.lock = run.catch(() => {});
        return run;
    }

    // ------------------------------------------------------------ pull

    /** Pull now; concurrent calls share one run. */
    pull(options) {
        this.pulling ??= (async () => {
            await this.beforeSync?.();
            return this.exclusive(() => this.runPull(options));
        })().finally(() => {
            this.pulling = null;
        });
        return this.pulling;
    }

    async runPull({ force = false } = {}) {
        this.setState('syncing');
        try {
            const head = await this.github.headCommit(this.branch);
            this.lastPull = Date.now();
            if (!force && head === (await this.store.getMeta('head'))) {
                await this.countPending();
                this.setState('idle');
                return { head, changed: [], removed: [], merged: [], conflicts: [] };
            }
            const remote = (await this.github.listFiles(head))
                .filter((f) => isTracked(f.path))
                .map((f) => ({ ...f, kind: kindOf(f.path) }));
            const local = new Map((await this.store.allFiles()).map((f) => [f.path, f]));
            const changed = remote.filter((f) => {
                const mine = local.get(f.path);
                return !mine || mine.sha !== f.sha || (eager(f) && mine.text === undefined);
            });
            const remotePaths = new Set(remote.map((f) => f.path));
            const removed = [...local.keys()].filter((path) => !remotePaths.has(path));

            let done = 0;
            let batch = [];
            const flush = async () => {
                const rows = batch;
                batch = [];
                if (rows.length) await this.store.putFiles(rows);
            };
            this.emit('progress', { done, total: changed.length });
            const add = async (row) => {
                batch.push(row);
                done += 1;
                this.emit('progress', { done, total: changed.length });
                if (batch.length >= 25) await flush();
            };
            const rowOf = (file) => ({ path: file.path, sha: file.sha, size: file.size, kind: file.kind });
            try {
                // Binaries are only listed here; they download when first viewed.
                for (const file of changed.filter((f) => !eager(f))) await add(rowOf(file));
                // Text comes ~50 files per GraphQL request; anything it can't return
                // (truncated, odd encodings) falls back to one REST request per file.
                const texts = changed.filter(eager);
                const chunks = [];
                for (let i = 0; i < texts.length; i += TEXT_BATCH) chunks.push(texts.slice(i, i + TEXT_BATCH));
                await pool(chunks, 3, async (chunk) => {
                    const fetched = this.github.blobTexts
                        ? await this.github.blobTexts(chunk.map((f) => f.sha))
                        : new Map();
                    await pool(chunk, this.concurrency, async (file) => {
                        const text = fetched.has(file.sha)
                            ? fetched.get(file.sha)
                            : decoder.decode(await this.github.blob(file.sha));
                        await add({ ...rowOf(file), text });
                    });
                });
            } finally {
                // Keep whatever finished, even if the connection dropped part-way.
                await flush();
            }
            if (removed.length) await this.store.deleteFiles(removed);
            const { merged, conflicts } = await this.rebasePending(new Map(remote.map((f) => [f.path, f])));
            // Recorded last, so an interrupted pull simply resumes where it stopped next time.
            await this.store.setMeta('head', head);
            await this.store.setMeta('pulledAt', Date.now());
            await this.countPending();
            this.setState('idle');
            const result = { head, changed: changed.map((f) => f.path), removed, merged, conflicts };
            this.emit('changed', result);
            if (conflicts.length) this.emit('conflict', { conflicts });
            if (removed.length) this.store.pruneBlobs().catch(() => {});
            return result;
        } catch (error) {
            this.failed(error);
            throw error;
        }
    }

    /**
     * Move local edits onto the versions just pulled. Changes on both sides are merged; where
     * they overlap, the local version wins and the remote one is kept as a conflict copy.
     */
    async rebasePending(remote) {
        const merged = [];
        const conflicts = [];
        for (const edit of await this.store.allPending()) {
            const theirs = remote.get(edit.path);
            if ((theirs?.sha ?? null) === edit.baseSha) continue;
            if (!theirs) {
                // Deleted on GitHub. A local delete agrees; a local edit brings the file back.
                if (edit.text === null) await this.store.deletePending(edit.path);
                else await this.store.putPending({ ...edit, baseSha: null, baseText: '' });
                continue;
            }
            if (edit.blobSha) {
                // A moved binary landing where GitHub now has a file: ours wins, nothing to merge.
                if (theirs.sha === edit.blobSha) await this.store.deletePending(edit.path);
                else await this.store.putPending({ ...edit, baseSha: theirs.sha });
                continue;
            }
            const remoteText = (await this.store.getFile(edit.path))?.text ?? '';
            if (edit.text === null) {
                // Changed on GitHub while deleted here: keep the changed version.
                await this.store.deletePending(edit.path);
                conflicts.push({ path: edit.path, kept: 'remote' });
                continue;
            }
            const result = merge3(edit.baseText ?? '', edit.text, remoteText);
            if (result.text === remoteText) await this.store.deletePending(edit.path);
            else await this.store.putPending({ ...edit, text: result.text, baseSha: theirs.sha, baseText: remoteText });
            merged.push(edit.path);
            if (result.conflicts) {
                const copy = conflictPath(edit.path);
                await this.store.putPending({
                    path: copy,
                    kind: theirs.kind,
                    text: remoteText,
                    baseSha: null,
                    baseText: '',
                    updatedAt: Date.now(),
                });
                conflicts.push({ path: edit.path, copy, kept: 'local' });
            }
        }
        return { merged, conflicts };
    }

    // ------------------------------------------------------------ local edits

    /** Save a note's new text on the device; it's committed shortly after. */
    saveLocal(path, text, kind = kindOf(path)) {
        return this.exclusive(() => this.writeLocal(path, text, kind)).then(async (result) => {
            await this.afterLocal([path]);
            return result;
        });
    }

    async writeLocal(path, text, kind) {
        const [file, edit] = await Promise.all([this.store.getFile(path), this.store.getPending(path)]);
        const baseSha = edit ? edit.baseSha : (file?.sha ?? null);
        const baseText = edit ? edit.baseText : (file?.text ?? '');
        if (file && baseSha === file.sha && text === file.text) {
            if (edit) await this.store.deletePending(path);
            return false;
        }
        const movedFrom = edit?.movedFrom;
        await this.store.putPending({ path, kind, text, baseSha, baseText, movedFrom, updatedAt: Date.now() });
        return true;
    }

    async removeLocal(path) {
        const [file, edit] = await Promise.all([this.store.getFile(path), this.store.getPending(path)]);
        if (!file) {
            if (edit) await this.store.deletePending(path);
            return;
        }
        await this.store.putPending({
            path,
            kind: file.kind,
            text: null,
            baseSha: edit ? edit.baseSha : file.sha,
            baseText: edit ? edit.baseText : (file.text ?? ''),
            updatedAt: Date.now(),
        });
    }

    deleteLocal(path) {
        return this.exclusive(() => this.removeLocal(path)).then(() => this.afterLocal([path]));
    }

    /** Rename or move one file. `rewrites` ([{ path, text }]) update links in other notes. */
    renameLocal(from, to, rewrites = []) {
        return this.moveLocal([{ from, to }], rewrites);
    }

    /**
     * Move several files at once (a folder move). Text files carry their current text; binaries
     * are recorded by blob sha and their bytes are sent with the next push. `rewrites` are
     * applied last, by their new paths, so a moved note can also get its links updated.
     */
    moveLocal(moves, rewrites = []) {
        return this.exclusive(async () => {
            for (const { from, to } of moves) {
                const [file, edit] = await Promise.all([this.store.getFile(from), this.store.getPending(from)]);
                // Moved twice before a push: still one move from where GitHub has it.
                const origin = edit?.movedFrom ?? from;
                const blobSha = edit ? edit.blobSha : file && !hasText(file.kind) ? file.sha : undefined;
                if (blobSha) await this.writeBlobLocal(to, blobSha, edit?.kind || file.kind);
                else await this.writeLocal(to, (await this.textUnlocked(from)) ?? '', kindOf(to));
                await this.removeLocal(from);
                const added = await this.store.getPending(to);
                if (added && added.text !== null) await this.store.putPending({ ...added, movedFrom: origin });
            }
            for (const rewrite of rewrites) await this.writeLocal(rewrite.path, rewrite.text, kindOf(rewrite.path));
        }).then(() => this.afterLocal([...moves.flatMap((m) => [m.from, m.to]), ...rewrites.map((r) => r.path)]));
    }

    /** A binary file at `path` with the contents of blob `sha` (a moved image or pdf). */
    async writeBlobLocal(path, sha, kind) {
        const [file, edit] = await Promise.all([this.store.getFile(path), this.store.getPending(path)]);
        const baseSha = edit ? edit.baseSha : (file?.sha ?? null);
        if (file && baseSha === file.sha && file.sha === sha) {
            if (edit) await this.store.deletePending(path);
            return;
        }
        await this.store.putPending({
            path,
            kind,
            text: '',
            blobSha: sha,
            baseSha,
            baseText: '',
            updatedAt: Date.now(),
        });
    }

    async blobAddition(edit) {
        const buffer = await this.blobBuffer(edit.blobSha, edit.path);
        return {
            path: edit.path,
            blobSha: edit.blobSha,
            base64: bufferToBase64(buffer),
            size: buffer.byteLength,
            movedFrom: edit.movedFrom,
        };
    }

    /** Bytes of a blob, from the device cache or GitHub. */
    async blobBuffer(sha, path) {
        let row = await this.store.getBlob(sha);
        if (!row) {
            row = { sha, buffer: await this.github.blob(sha), type: mimeOf(path) };
            await this.store.putBlob(row);
        }
        return row.buffer;
    }

    async afterLocal(paths) {
        await this.countPending();
        if (this.state === 'idle' || this.state === 'pending') this.setState('idle');
        else this.emit('state', { state: this.state, error: this.error, pending: this.pendingCount });
        this.emit('local', { paths });
        this.schedulePush();
    }

    /** All files as the user sees them (GitHub plus local edits). */
    files() {
        return this.store.view();
    }

    // ------------------------------------------------------------ push

    schedulePush(delay = this.pushDelayMs) {
        clearTimeout(this.pushTimer);
        this.pushTimer = setTimeout(() => this.push().catch(() => {}), delay);
    }

    /** Commit every pending edit now. Resolves with the commit, or null if there was nothing. */
    push() {
        clearTimeout(this.pushTimer);
        this.pushing ??= (async () => {
            await this.beforeSync?.();
            return this.exclusive(() => this.runPush());
        })().finally(() => {
            this.pushing = null;
        });
        return this.pushing;
    }

    async runPush() {
        for (let attempt = 1; ; attempt += 1) {
            const pending = await this.store.allPending();
            if (!pending.length) {
                this.pendingCount = 0;
                if (this.state === 'pending') this.setState('idle');
                return null;
            }
            const files = new Map((await this.store.allFiles()).map((f) => [f.path, f]));
            const additions = await Promise.all(
                pending
                    .filter((e) => e.text !== null)
                    .map(async (e) =>
                        e.blobSha ? await this.blobAddition(e) : { path: e.path, text: e.text, movedFrom: e.movedFrom },
                    ),
            );
            const deletions = pending.filter((e) => e.text === null && files.has(e.path)).map((e) => e.path);
            if (!additions.length && !deletions.length) {
                await this.store.deletePending(pending.map((e) => e.path));
                await this.countPending();
                this.setState('idle');
                return null;
            }
            this.setState('syncing');
            try {
                const expectedHead = await this.store.getMeta('head');
                const commit = await this.github.commit({
                    branch: this.branch,
                    expectedHead,
                    message: commitMessage(additions, deletions, files),
                    additions: additions.map(({ path, text, base64 }) => (base64 ? { path, base64 } : { path, text })),
                    deletions,
                });
                // The commit is exactly our edits on top of the head we had, so the device's
                // copy of GitHub becomes: what we had, plus these files.
                const rows = await Promise.all(
                    additions.map(async ({ path, text, blobSha, size }) =>
                        blobSha
                            ? { path, sha: blobSha, size, kind: kindOf(path) }
                            : {
                                  path,
                                  text,
                                  sha: await gitBlobSha(text),
                                  size: new TextEncoder().encode(text).length,
                                  kind: files.get(path)?.kind || kindOf(path),
                              },
                    ),
                );
                await this.store.putFiles(rows);
                if (deletions.length) await this.store.deleteFiles(deletions);
                await this.store.deletePending(pending.map((e) => e.path));
                await this.store.setMeta('head', commit.oid);
                await this.countPending();
                this.setState('idle');
                this.emit('pushed', { commit, paths: pending.map((e) => e.path) });
                return commit;
            } catch (error) {
                if (error instanceof GitHubError && error.status === 409 && attempt < MAX_PUSH_ATTEMPTS) {
                    // Someone pushed first: bring their changes in, merge, and try again.
                    await this.runPull();
                    continue;
                }
                this.failed(error);
                throw error;
            }
        }
    }

    // ------------------------------------------------------------ reading

    /**
     * Current text of a file (local edits first), downloading it if it wasn't fetched yet.
     * Reads don't wait for a running pull, so notes open instantly during the first download.
     */
    text(path) {
        return this.textUnlocked(path);
    }

    async textUnlocked(path) {
        const edit = await this.store.getPending(path);
        if (edit) return edit.text;
        const file = await this.store.getFile(path);
        if (!file) return null;
        if (file.text !== undefined) return file.text;
        const text = decoder.decode(await this.github.blob(file.sha));
        if (hasText(file.kind)) await this.store.putFiles([{ ...file, text }]);
        return text;
    }

    /** Object URL for a binary file (image, pdf), cached on the device after the first view. */
    async blobUrl(path) {
        const edit = await this.store.getPending(path);
        const sha = edit ? (edit.blobSha ?? null) : (await this.store.getFile(path))?.sha;
        if (!sha) return null;
        if (this.urls.has(sha)) return this.urls.get(sha);
        const buffer = await this.blobBuffer(sha, path);
        const url = URL.createObjectURL(new Blob([buffer], { type: mimeOf(path) }));
        this.urls.set(sha, url);
        return url;
    }

    // ------------------------------------------------------------ scheduling

    /** Pull, then push anything waiting. */
    async sync() {
        await this.pull();
        if (await this.countPending()) await this.push();
    }

    /**
     * Sync now, then every minute while the tab is visible and whenever it comes back online.
     * Pending edits are pushed right away when the tab is hidden (switching apps on a phone).
     */
    start() {
        const quiet = () => this.sync().catch(() => {});
        const visible = () => globalThis.document?.visibilityState !== 'hidden';
        this.timer = setInterval(() => {
            if (visible()) quiet();
        }, this.intervalMs);
        this.onVisible = () => {
            if (!visible()) {
                if (this.pendingCount) this.push().catch(() => {});
            } else if (Date.now() - this.lastPull > 10_000) quiet();
        };
        globalThis.document?.addEventListener('visibilitychange', this.onVisible);
        globalThis.addEventListener?.('online', quiet);
        this.onOnline = quiet;
        return this.countPending().then(() => this.sync());
    }

    stop() {
        clearInterval(this.timer);
        clearTimeout(this.pushTimer);
        globalThis.document?.removeEventListener('visibilitychange', this.onVisible);
        globalThis.removeEventListener?.('online', this.onOnline);
        for (const url of this.urls.values()) URL.revokeObjectURL(url);
        this.urls.clear();
    }
}
