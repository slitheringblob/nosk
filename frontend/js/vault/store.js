// The device's offline copy of the vault, in IndexedDB.
//
//   meta   { key, value }            connection settings, last synced head
//   files  { path, sha, size, kind, text? }   one row per file in the repo
//   blobs  { sha, buffer, type }     downloaded binaries (images, pdfs), keyed by content hash
//   pending { path, text, baseSha, baseText, updatedAt }   local edits not yet on GitHub;
//            text === null means "delete", baseSha === null means "new file"
//
// `files` always mirrors GitHub; what the user sees is files overlaid with pending (view()).
const DB_NAME = 'nosk-vault';
const DB_VERSION = 2;

const promisify = (request) =>
    new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

export class VaultStore {
    constructor(name = DB_NAME) {
        this.name = name;
        this.db = null;
    }

    async open() {
        if (this.db) return this.db;
        const request = indexedDB.open(this.name, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
            if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'sha' });
            if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'path' });
        };
        this.db = await promisify(request);
        return this.db;
    }

    async tx(stores, mode, fn) {
        const db = await this.open();
        const transaction = db.transaction(stores, mode);
        const result = fn(...[stores].flat().map((s) => transaction.objectStore(s)));
        await new Promise((resolve, reject) => {
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
        return result instanceof IDBRequest ? result.result : result;
    }

    async getMeta(key) {
        const row = await this.tx('meta', 'readonly', (meta) => meta.get(key));
        return row?.value;
    }

    setMeta(key, value) {
        return this.tx('meta', 'readwrite', (meta) => meta.put({ key, value }));
    }

    deleteMeta(key) {
        return this.tx('meta', 'readwrite', (meta) => meta.delete(key));
    }

    getFile(path) {
        return this.tx('files', 'readonly', (files) => files.get(path));
    }

    allFiles() {
        return this.tx('files', 'readonly', (files) => files.getAll());
    }

    putFiles(rows) {
        return this.tx('files', 'readwrite', (files) => rows.forEach((row) => files.put(row)));
    }

    deleteFiles(paths) {
        return this.tx('files', 'readwrite', (files) => paths.forEach((path) => files.delete(path)));
    }

    getBlob(sha) {
        return this.tx('blobs', 'readonly', (blobs) => blobs.get(sha));
    }

    putBlob(row) {
        return this.tx('blobs', 'readwrite', (blobs) => blobs.put(row));
    }

    /** Drop downloaded binaries that no file points at any more. */
    async pruneBlobs() {
        const live = new Set((await this.allFiles()).map((f) => f.sha));
        const keys = await this.tx('blobs', 'readonly', (blobs) => blobs.getAllKeys());
        const dead = keys.filter((sha) => !live.has(sha));
        if (dead.length) await this.tx('blobs', 'readwrite', (blobs) => dead.forEach((sha) => blobs.delete(sha)));
        return dead.length;
    }

    getPending(path) {
        return this.tx('pending', 'readonly', (pending) => pending.get(path));
    }

    allPending() {
        return this.tx('pending', 'readonly', (pending) => pending.getAll());
    }

    putPending(row) {
        return this.tx('pending', 'readwrite', (pending) => pending.put(row));
    }

    deletePending(paths) {
        return this.tx('pending', 'readwrite', (pending) => [paths].flat().forEach((path) => pending.delete(path)));
    }

    /**
     * The vault as the user sees it: GitHub's files with local edits applied. Edited files carry
     * `dirty: true`; files deleted locally are left out.
     */
    async view() {
        const [files, pending] = await Promise.all([this.allFiles(), this.allPending()]);
        const byPath = new Map(files.map((f) => [f.path, f]));
        for (const edit of pending) {
            if (edit.text === null) byPath.delete(edit.path);
            else {
                const file = byPath.get(edit.path);
                const base = file || { path: edit.path, sha: null, kind: edit.kind || 'note' };
                // A moved binary keeps its blob; it has no text.
                if (edit.blobSha)
                    byPath.set(edit.path, {
                        ...base,
                        kind: edit.kind || base.kind,
                        sha: edit.blobSha,
                        text: undefined,
                        dirty: true,
                    });
                else byPath.set(edit.path, { ...base, text: edit.text, size: edit.text.length, dirty: true });
            }
        }
        return [...byPath.values()];
    }

    /** Forget everything on this device (disconnect). */
    clear() {
        return this.tx(['meta', 'files', 'blobs', 'pending'], 'readwrite', (...stores) =>
            stores.forEach((s) => s.clear()),
        );
    }
}
