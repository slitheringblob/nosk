import { MAX_PUSH_BATCH, SYNC_POLL_INTERVAL_MS, SYNC_PUSH_DELAY_MS, WS_BASE_URL } from './config.js';
import { api, ApiError, NetworkError } from './api-client.js';
import { auth } from './auth.js';
import { storage as defaultStorage } from './storage.js';
import { debounce, Emitter, generateUUID } from './utils.js';

const STRUCTURAL_OPS = new Set(['create_component', 'delete_component', 'move_component', 'reorder_components']);

/**
 * Merge the server's ordering with local-only components (created here but not yet pushed),
 * keeping each local-only id right after the component that precedes it locally.
 */
export function mergeOrder(serverIds, localIds, existsLocally) {
    const result = serverIds.filter(existsLocally);
    const inResult = new Set(result);
    localIds.forEach((id, index) => {
        if (inResult.has(id) || !existsLocally(id)) return;
        let insertAt = 0;
        for (let i = index - 1; i >= 0; i -= 1) {
            const position = result.indexOf(localIds[i]);
            if (position >= 0) {
                insertAt = position + 1;
                break;
            }
        }
        result.splice(insertAt, 0, id);
        inResult.add(id);
    });
    return result;
}

/** True when a change at `version` is not newer than a local copy last synced at `localVersion`. */
export function isNotNewer(localVersion, version) {
    return typeof localVersion === 'number' && version <= localVersion;
}

export class SyncClient extends Emitter {
    constructor({ storage = defaultStorage, apiClient = api } = {}) {
        super();
        this.storage = storage;
        this.api = apiClient;
        this.status = 'idle';
        this.pendingCount = 0;
        this.running = null;
        this.again = false;
        this.sending = new Set();
        this.socket = null;
        this.socketRetry = 0;
        this.currentPageId = null;
        this.pollTimer = null;
        this.stopped = false;
        this.schedulePush = debounce(() => this.sync(), SYNC_PUSH_DELAY_MS);
        this.scheduleSoon = debounce(() => this.sync(), 150);
    }

    get deviceId() {
        return auth.deviceId;
    }

    get userId() {
        return auth.user?.id;
    }

    setStatus(status, extra = {}) {
        this.status = status;
        this.emit('status', { status, pending: this.pendingCount, ...extra });
    }

    async refreshPendingCount() {
        this.pendingCount = (await this.storage.outbox()).length;
        const conflicts = (await this.storage.getConflicts()).length;
        this.emit('status', { status: this.status, pending: this.pendingCount, conflicts });
    }

    // --- Lifecycle ----------------------------------------------------------------------

    async start() {
        this.stopped = false;
        const storedUser = await this.storage.getMeta('userId');
        if (storedUser && storedUser !== this.userId) await this.storage.clearAll();
        await this.storage.setMeta('userId', this.userId);
        if ((await this.storage.getMeta('cursor')) === null) {
            try {
                await this.bootstrap();
            } catch (error) {
                if (!(error instanceof NetworkError)) throw error;
                this.setStatus('offline');
            }
        }
        await this.refreshPendingCount();
        this.sync();
        this.connectLive();
        this.pollTimer = setInterval(() => this.sync(), SYNC_POLL_INTERVAL_MS);
        globalThis.addEventListener?.('online', this.onOnline);
        globalThis.document?.addEventListener('visibilitychange', this.onVisible);
    }

    stop() {
        this.stopped = true;
        clearInterval(this.pollTimer);
        this.schedulePush.cancel();
        this.socket?.close();
        globalThis.removeEventListener?.('online', this.onOnline);
        globalThis.document?.removeEventListener('visibilitychange', this.onVisible);
    }

    onOnline = () => {
        this.sync();
        if (!this.socket) this.connectLive();
    };

    onVisible = () => {
        if (globalThis.document?.visibilityState === 'visible') this.sync();
    };

    /**
     * Load every accessible page and block from the server. Used for a fresh device and again
     * whenever the server's data epoch changes (a migration rewrote rows without sync ops).
     * Anything still waiting to be pushed keeps its local version.
     */
    async bootstrap() {
        this.setStatus('syncing');
        const data = await this.api.get('/api/sync/bootstrap');
        const pending = await this.pendingIndex();
        const versions = Object.fromEntries(data.pages.map((p) => [p.id, p.version]));
        const pages = [];
        for (const page of data.pages) {
            const local = await this.storage.getPage(page.id);
            if (local && (pending.pageMeta.has(page.id) || pending.structure.has(page.id))) {
                // Keep unsynced local edits; take only what the server alone knows.
                const { template_id: templateId, journal_date: journalDate, role, owner_email: ownerEmail } = page;
                pages.push({
                    ...local,
                    template_id: templateId,
                    journal_date: journalDate,
                    role,
                    owner_email: ownerEmail,
                    version: Math.max(local.version || 0, page.version),
                });
            } else {
                pages.push({ ...page, sv: page.version });
            }
        }
        await this.storage.putMany('pages', pages);
        await this.storage.putMany(
            'components',
            data.components
                .filter((c) => !pending.components.has(c.id))
                .map((c) => ({ ...c, sv: versions[c.page_id] ?? 0 })),
        );
        await this.storage.setMeta('cursor', data.cursor);
        await this.storage.setMeta('data_epoch', data.data_epoch ?? null);
        this.emit('bootstrapped');
        return data.pages.map((p) => p.id);
    }

    // --- Queueing local changes ---------------------------------------------------------

    /** Queue a local operation. `op` needs type, page_id, optional component_id and data. */
    async queue(op) {
        const operation = {
            operation_id: generateUUID(),
            device_id: this.deviceId,
            timestamp: Date.now(),
            page_version: await this.baseVersion(op),
            data: {},
            ...op,
        };
        const merged =
            operation.type === 'update_component' &&
            (await this.storage.mergeIntoOutbox(operation, (seq) => this.sending.has(seq)));
        if (!merged) await this.storage.enqueue(operation);
        await this.refreshPendingCount();
        this.schedulePush();
        return operation;
    }

    /** True while a page created on this device hasn't reached the server yet. */
    async isPendingCreate(pageId) {
        return (await this.storage.outbox()).some(({ op }) => op.type === 'create_page' && op.page_id === pageId);
    }

    /** Last server version this device saw for the entity being changed. */
    async baseVersion(op) {
        if (op.page_version !== undefined) return op.page_version;
        if (op.component_id) {
            const component = await this.storage.getComponent(op.component_id);
            if (component?.sv !== undefined) return component.sv;
        }
        const page = await this.storage.getPage(op.page_id);
        return page?.sv ?? page?.version ?? 0;
    }

    // --- Sync loop ----------------------------------------------------------------------

    sync() {
        if (this.stopped) return Promise.resolve();
        if (this.running) {
            this.again = true;
            return this.running;
        }
        this.running = (async () => {
            try {
                do {
                    this.again = false;
                    this.setStatus('syncing');
                    await this.pushAll();
                    await this.pullAll();
                    await this.refreshStale();
                } while (this.again);
                await this.refreshPendingCount();
                this.setStatus('idle', { lastSync: Date.now() });
            } catch (error) {
                await this.refreshPendingCount();
                if (error instanceof NetworkError) this.setStatus('offline');
                else {
                    console.error('Sync failed', error);
                    this.setStatus('error', { message: error.message });
                }
            } finally {
                this.running = null;
            }
        })();
        return this.running;
    }

    async pushAll() {
        for (;;) {
            const entries = (await this.storage.outbox()).slice(0, MAX_PUSH_BATCH);
            if (!entries.length) return;
            entries.forEach((entry) => this.sending.add(entry.seq));
            try {
                const response = await this.api.post('/api/sync/push', {
                    operations: entries.map((entry) => entry.op),
                    client_timestamp: Date.now(),
                });
                await this.handlePushResponse(entries, response);
                await this.storage.removeFromOutbox(entries.map((entry) => entry.seq));
            } finally {
                entries.forEach((entry) => this.sending.delete(entry.seq));
            }
        }
    }

    async handlePushResponse(entries, response) {
        const conflictByIndex = new Map(response.conflicts.map((c) => [c.operation_index, c]));
        const touchedPages = new Set();
        for (const [index, entry] of entries.entries()) {
            const { op } = entry;
            const conflict = conflictByIndex.get(index);
            if (!conflict) {
                const version = response.op_versions?.[op.operation_id] ?? response.page_versions[op.page_id];
                if (version !== undefined) await this.markSynced(op, version);
                // Presence for a page created offline was ignored until the server had it.
                if (op.type === 'create_page' && op.page_id === this.currentPageId) this.sendPresence(op.page_id);
                continue;
            }
            if (conflict.resolution === 'manual') {
                const localData = op.component_id
                    ? await this.storage.getComponent(op.component_id)
                    : await this.storage.getPage(op.page_id);
                await this.storage.putConflict({
                    ...conflict,
                    op,
                    local_data: localData || null,
                    created_at: Date.now(),
                });
                this.emit('conflict', conflict);
            } else {
                touchedPages.add(op.page_id);
                this.emit('rejected', { op, conflict });
            }
        }
        // A rejected operation means local state diverged; reload those pages from the server.
        for (const pageId of touchedPages) await this.refreshPage(pageId);
    }

    async markSynced(op, version) {
        await this.storage.updatePage(op.page_id, (page) => {
            page.version = Math.max(page.version || 0, version);
            if (op.type === 'update_page' || op.type === 'create_page') page.sv = version;
        });
        if (op.component_id) {
            const component = await this.storage.getComponent(op.component_id);
            if (component) {
                component.sv = version;
                await this.storage.putComponent(component);
            }
        }
    }

    async pullAll() {
        for (;;) {
            const cursor = (await this.storage.getMeta('cursor')) ?? 0;
            const response = await this.api.get('/api/sync/pull', { cursor });
            if (response.data_epoch && response.data_epoch !== (await this.storage.getMeta('data_epoch'))) {
                // Server data changed outside the change log; refresh everything, then carry on.
                const pageIds = await this.bootstrap();
                this.emit('changes', { pageIds, changes: [] });
                continue;
            }
            if (response.changes.length) await this.applyChanges(response.changes);
            await this.storage.setMeta('cursor', response.cursor);
            if (!response.has_more) return;
        }
    }

    async pendingIndex() {
        const outbox = await this.storage.outbox();
        const index = { components: new Set(), pageMeta: new Set(), structure: new Set() };
        for (const { op } of outbox) {
            if (op.component_id) index.components.add(op.component_id);
            if (op.type === 'update_page') index.pageMeta.add(op.page_id);
            if (STRUCTURAL_OPS.has(op.type)) index.structure.add(op.page_id);
        }
        return index;
    }

    async applyChanges(changes) {
        const pending = await this.pendingIndex();
        const changedPages = new Set();
        for (const change of changes) {
            try {
                await this.applyChange(change, pending);
                changedPages.add(change.page_id);
            } catch (error) {
                console.error('Failed to apply change', change, error);
            }
        }
        this.emit('changes', { pageIds: [...changedPages], changes });
    }

    isOwnChange(change) {
        return change.device_id === this.deviceId && change.user_id === this.userId;
    }

    async applyChange(change, pending) {
        const { type, page_id: pageId, data, page_version: version } = change;
        if (type.startsWith('comment_')) {
            this.emit('comment', change);
            return;
        }
        if (type === 'page_deleted' && data?.permanent) {
            await this.storage.deletePage(pageId);
            return;
        }
        if (type === 'page_unshared') {
            if (data?.shared_with === this.userId) await this.storage.deletePage(pageId);
            return;
        }

        let page = await this.storage.getPage(pageId);
        const own = this.isOwnChange(change);

        if (['page_created', 'page_restored', 'page_shared', 'page_replaced'].includes(type)) {
            const pageData = type === 'page_replaced' ? data.page : data;
            const { components, shared_with: sharedWith, ...fields } = pageData;
            const forMe = type === 'page_shared' && sharedWith === this.userId;
            // This device already holds newer local state for pages it created, restored or
            // shared itself; replaying the snapshot would undo edits made since (e.g. the title).
            // Server-side actions (duplicate, template, import, version restore) still arrive
            // with this device's id but create state we don't have yet, so apply those fully.
            // Skip snapshots that aren't newer than what we hold: our own (we already have newer local
            // state) or another device's create of a page we already have (same journal day).
            const alreadyLocal = page && type !== 'page_replaced' && (own || isNotNewer(page.sv, version));
            if (alreadyLocal || (type === 'page_shared' && !forMe)) {
                if (page) {
                    page.version = Math.max(page.version || 0, version);
                    if (type === 'page_restored') page.deleted = false;
                    await this.storage.putPage(page);
                }
                return;
            }
            const role = forMe ? fields.role : fields.user_id === this.userId ? 'owner' : page?.role || fields.role;
            page = { ...page, ...fields, role, version, sv: version };
            if (role === 'owner') page.owner_email = null;
            await this.storage.putPage(page);
            const list = type === 'page_replaced' ? data.components : components;
            if (list) {
                const withVersion = list.map((c) => ({ ...c, sv: version }));
                if (type === 'page_replaced') await this.storage.replaceComponents(pageId, withVersion);
                else await this.storage.putMany('components', withVersion);
            }
            return;
        }
        if (!page) return; // Change for a page we don't have (e.g. arrived before a share).

        page.version = Math.max(page.version || 0, version);

        if (type === 'page_updated') {
            if (!own && !pending.pageMeta.has(pageId) && !isNotNewer(page.sv, version)) {
                const { title, icon, color, tags, is_template: isTemplate, updated_at: updatedAt } = data;
                Object.assign(page, {
                    title,
                    icon,
                    color,
                    tags,
                    is_template: isTemplate,
                    updated_at: updatedAt,
                    sv: version,
                });
            }
        } else if (type === 'page_deleted') {
            page.deleted = true;
        } else if (type.startsWith('component') && !own) {
            await this.applyComponentChange(change, page, pending);
        }
        await this.storage.putPage(page);
    }

    async applyComponentChange(change, page, pending) {
        const { type, data, page_version: version, component_id: componentId } = change;
        const hasPending = componentId && pending.components.has(componentId);
        // A snapshot no newer than our copy (e.g. another device's create of a block we already
        // created and edited) must not overwrite it.
        const local = componentId ? await this.storage.getComponent(componentId) : null;
        const stale = Boolean(local) && isNotNewer(local.sv, version);
        if (type === 'component_deleted') {
            await this.storage.deleteComponent(componentId);
        } else if (data?.component && !hasPending && !stale) {
            await this.storage.putComponent({ ...data.component, sv: version });
        } else if (data?.component && hasPending) {
            // Our own pending op for this block wins locally for now. If the server ends up
            // treating that op as already applied (e.g. both devices created the same journal
            // block), this remote content would be lost, so re-fetch the block once we've pushed.
            await this.markStale(componentId);
        }
        if (data?.component_ids) {
            const local = await this.storage.getComponents(page.id);
            const localIds = new Set(local.map((c) => c.id));
            if (data.component?.id) localIds.add(data.component.id);
            page.component_ids = pending.structure.has(page.id)
                ? mergeOrder(data.component_ids, page.component_ids || [], (id) => localIds.has(id))
                : data.component_ids.filter((id) => localIds.has(id));
            await this.reindex(page);
        }
    }

    async markStale(componentId) {
        const stale = await this.storage.getMeta('stale', []);
        if (!stale.includes(componentId)) await this.storage.setMeta('stale', [...stale, componentId]);
    }

    /** Re-fetch blocks whose remote updates were skipped, once we have nothing pending on them. */
    async refreshStale() {
        const stale = await this.storage.getMeta('stale', []);
        if (!stale.length) return;
        const pending = await this.pendingIndex();
        const remaining = [];
        const pageIds = new Set();
        for (const id of stale) {
            if (pending.components.has(id)) {
                remaining.push(id);
                continue;
            }
            try {
                const { page_version: version, ...component } = await this.api.get(`/api/components/${id}`);
                await this.storage.putComponent({ ...component, sv: version });
                pageIds.add(component.page_id);
            } catch (error) {
                if (error instanceof ApiError && error.status === 404) {
                    const local = await this.storage.getComponent(id);
                    if (local) pageIds.add(local.page_id);
                    await this.storage.deleteComponent(id);
                } else {
                    remaining.push(id);
                    if (error instanceof NetworkError) {
                        await this.storage.setMeta('stale', remaining.concat(stale.slice(stale.indexOf(id) + 1)));
                        throw error;
                    }
                }
            }
        }
        await this.storage.setMeta('stale', remaining);
        if (pageIds.size) this.emit('changes', { pageIds: [...pageIds], changes: [] });
    }

    async reindex(page) {
        const components = await this.storage.getComponents(page.id);
        const position = new Map(page.component_ids.map((id, index) => [id, index]));
        const changed = components.filter((c) => position.has(c.id) && c.order !== position.get(c.id));
        changed.forEach((c) => {
            c.order = position.get(c.id);
        });
        await this.storage.putMany('components', changed);
    }

    /** Replace local state for a page with the server's copy. */
    async refreshPage(pageId) {
        try {
            const page = await this.api.get(`/api/pages/${pageId}`);
            const { components } = await this.api.get(`/api/pages/${pageId}/components`);
            await this.storage.putPage({ ...page, sv: page.version });
            await this.storage.replaceComponents(
                pageId,
                components.map((c) => ({ ...c, sv: page.version })),
            );
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) await this.storage.deletePage(pageId);
            else throw error;
        }
        this.emit('changes', { pageIds: [pageId], changes: [] });
    }

    // --- Conflicts ----------------------------------------------------------------------

    async resolveConflict(conflict, choice) {
        const { op } = conflict;
        if (choice === 'mine') {
            if (conflict.reason === 'entity_deleted' && conflict.entity_type === 'component' && conflict.local_data) {
                const component = conflict.local_data;
                const page = await this.storage.getPage(op.page_id);
                const ids = page?.component_ids || [];
                const index = ids.indexOf(component.id);
                await this.queue({
                    type: 'create_component',
                    page_id: op.page_id,
                    component_id: component.id,
                    data: {
                        type: component.type,
                        content: component.content,
                        parent_id: component.parent_id,
                        slot: component.slot,
                        after_id: index > 0 ? ids[index - 1] : undefined,
                    },
                });
            } else {
                await this.queue({ ...op, operation_id: generateUUID(), force: true, page_version: op.page_version });
            }
        } else if (conflict.entity_type === 'component') {
            if (conflict.server_data) {
                await this.storage.putComponent({ ...conflict.server_data, sv: conflict.server_version });
            } else {
                await this.storage.deleteComponent(conflict.entity_id);
            }
        } else if (conflict.server_data) {
            const page = await this.storage.getPage(op.page_id);
            await this.storage.putPage({
                ...page,
                ...conflict.server_data,
                role: page?.role,
                sv: conflict.server_version,
            });
        }
        await this.storage.deleteConflict(conflict.operation_id);
        await this.refreshPendingCount();
        this.emit('changes', { pageIds: [op.page_id], changes: [] });
        this.emit('conflict-resolved', conflict);
    }

    // --- Live channel -------------------------------------------------------------------

    connectLive() {
        if (this.stopped || typeof WebSocket === 'undefined' || !auth.accessToken) return;
        const socket = new WebSocket(`${WS_BASE_URL}/api/sync/live`);
        this.socket = socket;
        socket.addEventListener('open', () => {
            socket.send(JSON.stringify({ type: 'auth', token: auth.accessToken }));
        });
        socket.addEventListener('message', (event) => {
            let message;
            try {
                message = JSON.parse(event.data);
            } catch {
                return;
            }
            if (message.type === 'ready') {
                this.socketRetry = 0;
                this.emit('live', true);
                this.sendPresence(this.currentPageId);
            } else if (message.type === 'changes') {
                this.scheduleSoon();
            } else if (message.type === 'presence') {
                this.emit('presence', message);
            }
        });
        socket.addEventListener('close', (event) => {
            if (this.socket === socket) this.socket = null;
            this.emit('live', false);
            if (this.stopped) return;
            const retry = async () => {
                // 4401 = token rejected: refresh before reconnecting.
                if (event.code === 4401) await this.api.refresh();
                this.connectLive();
            };
            const delay = Math.min(30_000, 1000 * 2 ** this.socketRetry);
            this.socketRetry += 1;
            setTimeout(retry, delay);
        });
    }

    sendPresence(pageId) {
        this.currentPageId = pageId;
        if (this.socket?.readyState === 1) {
            this.socket.send(JSON.stringify({ type: 'presence', page_id: pageId }));
        }
    }
}

export const syncClient = new SyncClient();
