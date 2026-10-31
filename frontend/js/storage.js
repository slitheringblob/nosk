// IndexedDB persistence: the local source of truth the UI renders from.
//
// Stores
//   pages       page records (server shape plus `sv`, the server version last applied locally)
//   components  component records, indexed by page_id
//   outbox      queued sync operations, in order (autoIncrement `seq`)
//   conflicts   push conflicts awaiting a user decision, keyed by operation_id
//   meta        key/value: cursor, userId
//   media       cached media blobs keyed by asset_id

const DB_NAME = 'nosk';
const DB_VERSION = 1;

function promisify(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
        tx.onerror = () => reject(tx.error);
    });
}

export class Storage {
    constructor(name = DB_NAME) {
        this.name = name;
        this.dbPromise = null;
    }

    open() {
        if (!this.dbPromise) {
            this.dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(this.name, DB_VERSION);
                request.onupgradeneeded = () => {
                    const db = request.result;
                    db.createObjectStore('pages', { keyPath: 'id' });
                    const components = db.createObjectStore('components', { keyPath: 'id' });
                    components.createIndex('page_id', 'page_id');
                    db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
                    db.createObjectStore('conflicts', { keyPath: 'operation_id' });
                    db.createObjectStore('meta', { keyPath: 'key' });
                    db.createObjectStore('media', { keyPath: 'asset_id' });
                };
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return this.dbPromise;
    }

    async tx(storeNames, mode, work) {
        const db = await this.open();
        const tx = db.transaction(storeNames, mode);
        const stores = Object.fromEntries([].concat(storeNames).map((name) => [name, tx.objectStore(name)]));
        const result = await work(stores, tx);
        await transactionDone(tx);
        return result;
    }

    async get(store, key) {
        const db = await this.open();
        return promisify(db.transaction(store).objectStore(store).get(key));
    }

    async getAll(store) {
        const db = await this.open();
        return promisify(db.transaction(store).objectStore(store).getAll());
    }

    async put(store, value) {
        return this.tx(store, 'readwrite', (s) => promisify(s[store].put(value)));
    }

    async putMany(store, values) {
        if (!values.length) return;
        await this.tx(store, 'readwrite', (s) => {
            for (const value of values) s[store].put(value);
        });
    }

    async delete(store, key) {
        return this.tx(store, 'readwrite', (s) => promisify(s[store].delete(key)));
    }

    async clearAll() {
        const names = ['pages', 'components', 'outbox', 'conflicts', 'meta', 'media'];
        await this.tx(names, 'readwrite', (s) => {
            for (const name of names) s[name].clear();
        });
    }

    // --- Meta ---------------------------------------------------------------------------

    async getMeta(key, fallback = null) {
        const row = await this.get('meta', key);
        return row ? row.value : fallback;
    }

    setMeta(key, value) {
        return this.put('meta', { key, value });
    }

    // --- Pages & components -------------------------------------------------------------

    getPage(id) {
        return this.get('pages', id);
    }

    getPages() {
        return this.getAll('pages');
    }

    putPage(page) {
        return this.put('pages', page);
    }

    /**
     * Read-modify-write a page in one transaction so concurrent writers (the editor and the
     * sync client) don't overwrite each other's fields. Returns the updated page.
     */
    async updatePage(id, mutate) {
        return this.tx('pages', 'readwrite', async (s) => {
            const page = await promisify(s.pages.get(id));
            if (!page) return null;
            mutate(page);
            s.pages.put(page);
            return page;
        });
    }

    async getComponents(pageId) {
        const db = await this.open();
        const index = db.transaction('components').objectStore('components').index('page_id');
        const components = await promisify(index.getAll(pageId));
        return components.sort((a, b) => a.order - b.order);
    }

    getComponent(id) {
        return this.get('components', id);
    }

    putComponent(component) {
        return this.put('components', component);
    }

    deleteComponent(id) {
        return this.delete('components', id);
    }

    /** Remove a page and every component on it. */
    async deletePage(pageId) {
        const components = await this.getComponents(pageId);
        await this.tx(['pages', 'components'], 'readwrite', (s) => {
            s.pages.delete(pageId);
            for (const component of components) s.components.delete(component.id);
        });
    }

    /** Replace all components of a page in one transaction. */
    async replaceComponents(pageId, components) {
        const existing = await this.getComponents(pageId);
        await this.tx('components', 'readwrite', (s) => {
            for (const component of existing) s.components.delete(component.id);
            for (const component of components) s.components.put(component);
        });
    }

    // --- Outbox -------------------------------------------------------------------------

    async enqueue(operation) {
        return this.put('outbox', { op: operation });
    }

    async outbox() {
        return this.getAll('outbox');
    }

    async removeFromOutbox(seqs) {
        if (!seqs.length) return;
        await this.tx('outbox', 'readwrite', (s) => {
            for (const seq of seqs) s.outbox.delete(seq);
        });
    }

    /**
     * Fold a content update into an unsent update for the same component, keeping the original
     * base version so the server still detects edits made elsewhere since the first change.
     * Returns true if merged.
     */
    async mergeIntoOutbox(operation, isSending) {
        return this.tx('outbox', 'readwrite', async (s) => {
            const entries = await promisify(s.outbox.getAll());
            for (let i = entries.length - 1; i >= 0; i -= 1) {
                const entry = entries[i];
                if (isSending(entry.seq)) break;
                if (entry.op.type === 'update_component' && entry.op.component_id === operation.component_id) {
                    entry.op.data = operation.data;
                    entry.op.timestamp = operation.timestamp;
                    s.outbox.put(entry);
                    return true;
                }
                // Anything structural on the same component must keep its relative order.
                if (entry.op.component_id === operation.component_id) break;
            }
            return false;
        });
    }

    // --- Conflicts ----------------------------------------------------------------------

    getConflicts() {
        return this.getAll('conflicts');
    }

    putConflict(conflict) {
        return this.put('conflicts', conflict);
    }

    deleteConflict(operationId) {
        return this.delete('conflicts', operationId);
    }

    // --- Media cache --------------------------------------------------------------------

    async getMedia(assetId) {
        const row = await this.get('media', assetId);
        return row ? row.blob : null;
    }

    putMedia(assetId, blob) {
        return this.put('media', { asset_id: assetId, blob, cached_at: Date.now() });
    }
}

export const storage = new Storage();
