// Pulls the vault from GitHub into IndexedDB. A pull costs one request when nothing changed
// (the branch head); otherwise one tree listing plus one request per changed file.
import { GitHubError, OfflineError } from './github.js';
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

const hasText = (kind) => kind === 'note' || kind === 'text' || kind === 'config';
const eager = (file) => hasText(file.kind) && file.size <= EAGER_TEXT_LIMIT;
const decoder = new TextDecoder('utf-8');

async function pool(items, size, fn) {
    let next = 0;
    const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
        while (next < items.length) await fn(items[next++]);
    });
    await Promise.all(workers);
}

export class VaultSync extends Emitter {
    constructor({ store, github, branch, concurrency = 6, intervalMs = 60_000 }) {
        super();
        this.store = store;
        this.github = github;
        this.branch = branch;
        this.concurrency = concurrency;
        this.intervalMs = intervalMs;
        this.state = 'idle';
        this.error = null;
        this.pulling = null;
        this.lastPull = 0;
        this.urls = new Map();
    }

    setState(state, error = null) {
        this.state = state;
        this.error = error;
        this.emit('state', { state, error });
    }

    /** Pull now; concurrent calls share one run. */
    pull(options) {
        this.pulling ??= this.runPull(options).finally(() => {
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
                this.setState('idle');
                return { head, changed: [], removed: [] };
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
            // Recorded last, so an interrupted pull simply resumes where it stopped next time.
            await this.store.setMeta('head', head);
            await this.store.setMeta('pulledAt', Date.now());
            this.setState('idle');
            const result = { head, changed: changed.map((f) => f.path), removed };
            this.emit('changed', result);
            if (removed.length) this.store.pruneBlobs().catch(() => {});
            return result;
        } catch (error) {
            if (error instanceof OfflineError) this.setState('offline', error);
            else if (error instanceof GitHubError && error.status === 401) this.setState('auth', error);
            else this.setState('error', error);
            throw error;
        }
    }

    /** Text of a file, downloading it first if it was too big to fetch during the pull. */
    async text(path) {
        const file = await this.store.getFile(path);
        if (!file) return null;
        if (file.text !== undefined) return file.text;
        const text = decoder.decode(await this.github.blob(file.sha));
        if (hasText(file.kind)) await this.store.putFiles([{ ...file, text }]);
        return text;
    }

    /** Object URL for a binary file (image, pdf), cached on the device after the first view. */
    async blobUrl(path) {
        const file = await this.store.getFile(path);
        if (!file) return null;
        if (this.urls.has(file.sha)) return this.urls.get(file.sha);
        let row = await this.store.getBlob(file.sha);
        if (!row) {
            row = { sha: file.sha, buffer: await this.github.blob(file.sha), type: mimeOf(path) };
            await this.store.putBlob(row);
        }
        const url = URL.createObjectURL(new Blob([row.buffer], { type: row.type }));
        this.urls.set(file.sha, url);
        return url;
    }

    /** Pull now, then every minute while the tab is visible, and whenever it comes back. */
    start() {
        const quiet = () => this.pull().catch(() => {});
        const visible = () => globalThis.document?.visibilityState !== 'hidden';
        this.timer = setInterval(() => {
            if (visible()) quiet();
        }, this.intervalMs);
        this.onVisible = () => {
            if (visible() && Date.now() - this.lastPull > 10_000) quiet();
        };
        globalThis.document?.addEventListener('visibilitychange', this.onVisible);
        globalThis.addEventListener?.('online', quiet);
        this.onOnline = quiet;
        return this.pull();
    }

    stop() {
        clearInterval(this.timer);
        globalThis.document?.removeEventListener('visibilitychange', this.onVisible);
        globalThis.removeEventListener?.('online', this.onOnline);
        for (const url of this.urls.values()) URL.revokeObjectURL(url);
        this.urls.clear();
    }
}
