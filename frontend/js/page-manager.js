import { SAVE_DEBOUNCE_MS } from './config.js';
import registry from './components/registry.js';
import { canConvert, convertContent } from './component-converter.js';
import { debounce, el, Emitter, generateUUID, now } from './utils.js';

const UNDO_LIMIT = 100;
const TEXT_LIKE = new Set(['text-block', 'heading', 'quote', 'callout']);

/**
 * Owns the open page: renders its block tree and applies every local edit to IndexedDB, the
 * sync outbox and the DOM. Remote changes arrive through reconcile().
 */
export class PageManager extends Emitter {
    constructor({ storage, sync, root, services = {}, picker = null }) {
        super();
        this.storage = storage;
        this.sync = sync;
        this.root = root;
        this.services = services;
        this.picker = picker;
        this.page = null;
        this.records = new Map();
        this.instances = new Map();
        this.saveTimers = new Map();
        this.undoStack = [];
        this.redoStack = [];
        this.replaying = false;
        this.commentCounts = new Map();
    }

    get readOnly() {
        return this.page?.role === 'viewer';
    }

    // --- Loading & rendering --------------------------------------------------------------

    async open(pageId) {
        await this.flushSaves();
        const page = await this.storage.getPage(pageId);
        if (!page) return false;
        this.page = page;
        this.undoStack = [];
        this.redoStack = [];
        const records = await this.storage.getComponents(pageId);
        this.records = new Map(records.map((record) => [record.id, record]));
        this.renderAll();
        this.sync.sendPresence(pageId);
        this.emit('opened', page);
        return true;
    }

    close() {
        this.flushSaves();
        this.destroyInstances();
        this.page = null;
        this.root.replaceChildren();
        this.sync.sendPresence(null);
    }

    destroyInstances() {
        for (const instance of this.instances.values()) instance.destroy();
        this.instances.clear();
    }

    /** Records in display order: page.component_ids first, then any stragglers. */
    orderedRecords() {
        const ids = this.page?.component_ids || [];
        const seen = new Set();
        const ordered = [];
        for (const id of ids) {
            const record = this.records.get(id);
            if (record && !seen.has(id)) {
                ordered.push(record);
                seen.add(id);
            }
        }
        for (const record of [...this.records.values()].sort((a, b) => a.order - b.order)) {
            if (!seen.has(record.id)) ordered.push(record);
        }
        return ordered;
    }

    renderAll() {
        this.destroyInstances();
        this.root.replaceChildren();
        this.root.classList.toggle('is-readonly', this.readOnly);
        for (const record of this.orderedRecords()) this.instantiate(record);
        this.layout();
        this.updateEmptyState();
        this.applyCommentBadges();
    }

    instantiate(record) {
        if (!registry.has(record.type)) {
            const unknown = el(
                'div',
                { className: 'block block--unknown', dataset: { componentId: record.id } },
                `Unsupported block: ${record.type}`,
            );
            this.instances.set(record.id, {
                id: record.id,
                element: unknown,
                destroy: () => unknown.remove(),
                content: record.content,
                type: record.type,
            });
            return;
        }
        const instance = registry.create(record.type, record, {
            readOnly: this.readOnly,
            onChange: (component) => this.handleChange(component),
            hooks: this.hooks(),
            services: this.componentServices(),
        });
        instance.render();
        this.instances.set(record.id, instance);
    }

    containerFor(record) {
        if (record.parent_id) {
            const parent = this.instances.get(record.parent_id);
            const slot = parent?.getSlotElement?.(record.slot);
            if (slot) return slot;
        }
        return this.root;
    }

    /** Put every block element into its container in order, moving only what is out of place. */
    layout() {
        const groups = new Map();
        for (const record of this.orderedRecords()) {
            const container = this.containerFor(record);
            if (!groups.has(container)) groups.set(container, []);
            const element = this.instances.get(record.id)?.element;
            if (element) groups.get(container).push(element);
        }
        for (const [container, elements] of groups) {
            const current = [...container.children].filter((child) => child.classList.contains('block'));
            const same = current.length === elements.length && current.every((child, i) => child === elements[i]);
            if (same) continue;
            elements.forEach((element, index) => {
                const atIndex = [...container.children].filter((c) => c.classList.contains('block'))[index];
                if (atIndex !== element) container.insertBefore(element, atIndex || null);
            });
        }
        // Drop elements of blocks that no longer exist or moved to another container.
        for (const container of [this.root, ...this.root.querySelectorAll('.block-slot')]) {
            const expected = new Set(groups.get(container) || []);
            [...container.children].forEach((child) => {
                if (child.classList.contains('block') && !expected.has(child)) child.remove();
            });
        }
    }

    updateEmptyState() {
        let empty = this.root.querySelector(':scope > .page-empty');
        if (this.records.size) {
            empty?.remove();
            return;
        }
        if (empty) return;
        empty = el(
            'button',
            { type: 'button', className: 'page-empty' },
            this.readOnly ? 'This page is empty.' : 'Empty page. Click here or press Enter to start writing.',
        );
        if (!this.readOnly)
            empty.addEventListener('click', () => this.createBlock({ type: 'text-block', focus: true }));
        this.root.append(empty);
    }

    /** Re-read the page from storage after remote changes and patch the DOM. */
    async reconcile() {
        if (!this.page) return;
        const page = await this.storage.getPage(this.page.id);
        if (!page || (page.deleted && this.page && !this.page.deleted)) {
            this.page = page || this.page;
            this.emit('page-removed', { pageId: this.page.id, deleted: Boolean(page?.deleted), gone: !page });
            if (!page) return;
        }
        const roleChanged = page.role !== this.page.role;
        this.page = page;
        if (roleChanged) {
            this.records = new Map((await this.storage.getComponents(page.id)).map((r) => [r.id, r]));
            this.renderAll();
            this.emit('page-updated', page);
            return;
        }
        const records = await this.storage.getComponents(page.id);
        const fresh = new Map(records.map((record) => [record.id, record]));
        for (const [id, instance] of this.instances) {
            if (!fresh.has(id)) {
                instance.destroy();
                this.instances.delete(id);
            }
        }
        for (const record of records) {
            const instance = this.instances.get(record.id);
            const pendingLocal = this.saveTimers.has(record.id);
            // Keep unsaved local edits; the queued save must send them, not the stored copy.
            if (pendingLocal && this.records.has(record.id)) {
                record.content = this.records.get(record.id).content;
                fresh.set(record.id, record);
            }
            if (!instance || instance.type !== record.type) {
                instance?.destroy();
                this.instances.delete(record.id);
                this.records.set(record.id, record);
                this.instantiate(record);
            } else if (!pendingLocal && JSON.stringify(instance.content) !== JSON.stringify(record.content)) {
                instance.setContent(record.content);
            }
        }
        this.records = fresh;
        this.layout();
        this.updateEmptyState();
        this.applyCommentBadges();
        this.emit('page-updated', page);
    }

    // --- Component wiring ---------------------------------------------------------------

    hooks() {
        return {
            onEnter: (component, afterHTML) => this.onEnter(component, afterHTML),
            onBackspaceEmpty: (component) => this.onBackspaceEmpty(component),
            onMergeUp: (component, html) => this.onMergeUp(component, html),
            onSlash: (component, node) => this.onSlash(component, node),
            onReplace: (component, type, content) => this.replaceBlock(component.id, type, content),
            onNavigate: (component, direction) => this.focusSibling(component.id, direction),
            onAddChild: (component, slot) => this.addChild(component.id, slot),
            onExitList: (component, trailing) => this.onExitList(component, trailing),
            onLayoutChanged: (component) => this.onColumnsChanged(component),
        };
    }

    componentServices() {
        return {
            ...this.services,
            currentPageId: () => this.page?.id,
            insertBlocksAfter: (component, blocks) => this.insertBlocks(component.id, blocks),
            captureBlocksAfter: (component) => this.captureBlocksAfter(component.id),
        };
    }

    handleChange(component) {
        const record = this.records.get(component.id);
        if (!record || this.readOnly) return;
        record.content = component.content;
        record.updated_at = now();
        if (!this.saveTimers.has(component.id)) {
            this.saveTimers.set(
                component.id,
                debounce(() => this.persistContent(component.id), SAVE_DEBOUNCE_MS),
            );
        }
        this.saveTimers.get(component.id)();
        this.emit('dirty');
    }

    async persistContent(id) {
        this.saveTimers.delete(id);
        const record = this.records.get(id);
        if (!record || !this.page) return;
        await this.storage.putComponent(record);
        await this.sync.queue({
            type: 'update_component',
            page_id: this.page.id,
            component_id: id,
            data: { content: record.content },
        });
    }

    /** Persist and queue every debounced edit now. */
    async flushSaves() {
        await Promise.all([...this.saveTimers.values()].map((timer) => timer.flush()));
    }

    // --- Tree helpers -------------------------------------------------------------------

    children(parentId, slot = null) {
        return this.orderedRecords().filter(
            (r) => (r.parent_id ?? null) === (parentId ?? null) && (slot === null || r.slot === slot),
        );
    }

    siblings(id) {
        const record = this.records.get(id);
        return this.children(record.parent_id ?? null, record.parent_id ? record.slot : null);
    }

    descendants(id) {
        const result = [];
        const stack = [id];
        const all = this.orderedRecords();
        while (stack.length) {
            const current = stack.pop();
            for (const record of all) {
                if (record.parent_id === current) {
                    result.push(record.id);
                    stack.push(record.id);
                }
            }
        }
        return result;
    }

    /** The last id of `id`'s subtree in flat order, so insertions land after its children. */
    subtreeEnd(id) {
        const subtree = new Set([id, ...this.descendants(id)]);
        const ids = this.page.component_ids;
        let end = id;
        for (const candidate of ids) if (subtree.has(candidate)) end = candidate;
        return end;
    }

    /** Blocks in visual (document) order, used for arrow-key navigation. */
    visualOrder() {
        return [...this.root.querySelectorAll('.block[data-component-id]')].map((node) => node.dataset.componentId);
    }

    focusBlock(id, position = 'end') {
        const instance = this.instances.get(id);
        if (!instance) return false;
        const focused = instance.focus?.(position);
        if (!focused) instance.element?.scrollIntoView({ block: 'nearest' });
        return focused;
    }

    focusSibling(id, direction) {
        const order = this.visualOrder();
        let index = order.indexOf(id) + direction;
        while (index >= 0 && index < order.length) {
            if (this.focusBlock(order[index], direction < 0 ? 'end' : 'start')) return true;
            index += direction;
        }
        return false;
    }

    // --- Mutations ----------------------------------------------------------------------

    /** Save the page's block order; sync-owned fields (version, sv, deleted…) are left alone. */
    async persistPage() {
        const ids = [...this.page.component_ids];
        const stored = await this.storage.updatePage(this.page.id, (page) => {
            page.component_ids = ids;
            page.updated_at = now();
        });
        if (stored) Object.assign(this.page, { version: stored.version, sv: stored.sv, updated_at: stored.updated_at });
    }

    reindexOrders() {
        this.page.component_ids.forEach((id, index) => {
            const record = this.records.get(id);
            if (record) record.order = index;
        });
    }

    pushUndo(entry) {
        if (this.replaying) return;
        this.undoStack.push(entry);
        if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift();
        this.redoStack = [];
    }

    async undo() {
        const entry = this.undoStack.pop();
        if (!entry) return false;
        this.replaying = true;
        try {
            await entry.undo();
        } finally {
            this.replaying = false;
        }
        this.redoStack.push(entry);
        return true;
    }

    async redo() {
        const entry = this.redoStack.pop();
        if (!entry) return false;
        this.replaying = true;
        try {
            await entry.redo();
        } finally {
            this.replaying = false;
        }
        this.undoStack.push(entry);
        return true;
    }

    /**
     * Create a block. Placement: after `afterId` (and its children); otherwise first inside
     * `parentId`/`slot`; otherwise at the end of the page.
     */
    async createBlock({
        id = generateUUID(),
        type,
        content = null,
        parentId = null,
        slot = 0,
        afterId = null,
        focus = false,
        focusPosition = 'end',
    }) {
        if (this.readOnly || !this.page) return null;
        const ids = [...this.page.component_ids];
        let anchor = null;
        let index = ids.length;
        if (afterId && this.records.has(afterId)) {
            anchor = this.subtreeEnd(afterId);
            index = ids.indexOf(anchor) + 1;
        } else if (parentId && this.records.has(parentId)) {
            anchor = parentId;
            index = ids.indexOf(parentId) + 1;
        }
        const record = {
            id,
            page_id: this.page.id,
            type,
            content: content ?? registry.defaultContent(type),
            parent_id: parentId,
            slot: parentId ? slot : 0,
            order: index,
            created_at: now(),
            updated_at: now(),
            schema_version: 1,
            sv: this.page.version,
        };
        ids.splice(index, 0, id);
        this.page.component_ids = ids;
        this.records.set(id, record);
        this.reindexOrders();
        // Update the DOM and focus before any awaits so keystrokes typed right after Enter land
        // in the new block.
        this.instantiate(record);
        this.layout();
        this.updateEmptyState();
        if (focus) this.focusBlock(id, focusPosition);
        await this.storage.putMany('components', [...this.records.values()]);
        await this.persistPage();
        await this.sync.queue({
            type: 'create_component',
            page_id: this.page.id,
            component_id: id,
            data: { type, content: record.content, parent_id: parentId, slot: record.slot, after_id: anchor },
        });
        this.pushUndo({
            undo: () => this.deleteBlock(id),
            redo: () => this.createBlock({ id, type, content: record.content, parentId, slot, afterId }),
        });
        this.emit('structure');
        return id;
    }

    /** Delete a block and its nested children. */
    async deleteBlock(id, { focusPrevious = false } = {}) {
        const record = this.records.get(id);
        if (this.readOnly || !record) return;
        this.saveTimers.get(id)?.cancel();
        this.saveTimers.delete(id);
        const order = this.visualOrder();
        const previous = order[order.indexOf(id) - 1];
        const doomed = [id, ...this.descendants(id)];
        const snapshot = doomed.map((cid) => structuredClone(this.records.get(cid)));
        const ids = this.page.component_ids;
        const position = ids.indexOf(id);
        const afterId = position > 0 ? ids[position - 1] : null;

        for (const cid of doomed) {
            this.instances.get(cid)?.destroy();
            this.instances.delete(cid);
            this.records.delete(cid);
        }
        this.page.component_ids = ids.filter((cid) => !doomed.includes(cid));
        this.reindexOrders();
        this.layout();
        this.updateEmptyState();
        if (focusPrevious && previous) this.focusBlock(previous, 'end');
        await this.storage.tx('components', 'readwrite', (s) => doomed.forEach((cid) => s.components.delete(cid)));
        await this.persistPage();
        await this.sync.queue({ type: 'delete_component', page_id: this.page.id, component_id: id });
        this.pushUndo({
            undo: () => this.restoreRecords(snapshot, afterId),
            redo: () => this.deleteBlock(id),
        });
        this.emit('structure');
    }

    /** Re-create a deleted subtree (undo of delete). Parents come first in `snapshot`. */
    async restoreRecords(snapshot, afterId) {
        let previous = afterId && this.records.has(afterId) ? afterId : null;
        for (const record of snapshot) {
            const isRoot = record === snapshot[0];
            await this.createBlock({
                id: record.id,
                type: record.type,
                content: record.content,
                parentId: record.parent_id && this.records.has(record.parent_id) ? record.parent_id : null,
                slot: record.slot,
                afterId: isRoot ? previous : null,
            });
            if (isRoot) previous = record.id;
        }
    }

    async moveBlock(id, { parentId = null, slot = 0, afterId = null }) {
        const record = this.records.get(id);
        if (this.readOnly || !record) return;
        if (parentId && (parentId === id || this.descendants(id).includes(parentId))) return;
        const before = { parentId: record.parent_id ?? null, slot: record.slot, afterId: this.previousAnchor(id) };
        const subtree = new Set([id, ...this.descendants(id)]);
        const moving = this.page.component_ids.filter((cid) => subtree.has(cid));
        const remaining = this.page.component_ids.filter((cid) => !subtree.has(cid));
        let anchor = null;
        let index = 0;
        if (afterId && !subtree.has(afterId) && this.records.has(afterId)) {
            anchor = this.subtreeEndIn(afterId, remaining);
            index = remaining.indexOf(anchor) + 1;
        } else if (parentId) {
            anchor = null;
            index = remaining.indexOf(parentId) + 1;
        }
        this.page.component_ids = [...remaining.slice(0, index), ...moving, ...remaining.slice(index)];
        record.parent_id = parentId;
        record.slot = parentId ? slot : 0;
        record.updated_at = now();
        this.reindexOrders();
        await this.storage.putMany('components', [...this.records.values()]);
        await this.persistPage();
        this.layout();
        await this.sync.queue({
            type: 'move_component',
            page_id: this.page.id,
            component_id: id,
            data: { parent_id: parentId, slot: record.slot, after_id: anchor },
        });
        this.pushUndo({
            undo: () => this.moveBlock(id, before),
            redo: () => this.moveBlock(id, { parentId, slot, afterId }),
        });
        this.emit('structure');
    }

    subtreeEndIn(id, ids) {
        const subtree = new Set([id, ...this.descendants(id)]);
        let end = id;
        for (const candidate of ids) if (subtree.has(candidate)) end = candidate;
        return end;
    }

    /** The sibling just before `id` (to restore its position later), or null if first. */
    previousAnchor(id) {
        const siblings = this.siblings(id);
        const index = siblings.findIndex((r) => r.id === id);
        return index > 0 ? siblings[index - 1].id : null;
    }

    async moveBy(id, direction) {
        const record = this.records.get(id);
        if (!record) return;
        const siblings = this.siblings(id);
        const index = siblings.findIndex((r) => r.id === id);
        const target = index + direction;
        if (target < 0 || target >= siblings.length) return;
        const afterId = direction < 0 ? (siblings[target - 1]?.id ?? null) : siblings[target].id;
        await this.moveBlock(id, { parentId: record.parent_id ?? null, slot: record.slot, afterId });
        requestAnimationFrame(() => this.focusBlock(id));
    }

    async convertBlock(id, toType) {
        const record = this.records.get(id);
        if (this.readOnly || !record || !canConvert(record.type, toType)) return;
        await this.saveTimers.get(id)?.flush();
        const previous = { type: record.type, content: structuredClone(record.content) };
        const content = convertContent(record.type, toType, record.content);
        if (record.type === 'toggle') {
            for (const child of this.children(id)) {
                child.parent_id = record.parent_id ?? null;
                child.slot = record.slot;
            }
        }
        record.type = toType;
        record.content = content;
        record.updated_at = now();
        await this.storage.putMany('components', [...this.records.values()]);
        this.instances.get(id)?.destroy();
        this.instances.delete(id);
        this.instantiate(record);
        this.layout();
        await this.sync.queue({
            type: 'convert_component',
            page_id: this.page.id,
            component_id: id,
            data: { to_type: toType, content },
        });
        requestAnimationFrame(() => this.focusBlock(id));
        this.pushUndo({
            undo: () => this.replaceContent(id, previous.type, previous.content),
            redo: () => this.convertBlock(id, toType),
        });
        this.emit('structure');
    }

    /** Swap a block's type and content in place (undo of convert). */
    async replaceContent(id, type, content) {
        const record = this.records.get(id);
        if (!record) return;
        if (record.type === type) {
            record.content = content;
            await this.storage.putComponent(record);
            this.instances.get(id)?.setContent(content);
            await this.sync.queue({
                type: 'update_component',
                page_id: this.page.id,
                component_id: id,
                data: { content },
            });
            return;
        }
        if (canConvert(record.type, type)) {
            record.type = type;
            record.content = content;
            await this.storage.putComponent(record);
            this.instances.get(id)?.destroy();
            this.instances.delete(id);
            this.instantiate(record);
            this.layout();
            await this.sync.queue({
                type: 'convert_component',
                page_id: this.page.id,
                component_id: id,
                data: { to_type: type, content },
            });
        }
    }

    /** Replace a block with a new block of another type in the same position. */
    async replaceBlock(id, type, content = null) {
        const record = this.records.get(id);
        if (!record) return null;
        const wasReplaying = this.replaying;
        this.replaying = true;
        let newId;
        try {
            newId = await this.createBlock({
                type,
                content,
                parentId: record.parent_id ?? null,
                slot: record.slot,
                afterId: id,
                focus: true,
            });
            await this.deleteBlock(id);
        } finally {
            this.replaying = wasReplaying;
        }
        const removed = structuredClone(record);
        this.pushUndo({
            undo: async () => {
                await this.restoreRecords([removed], this.previousAnchor(newId) ?? null);
                await this.deleteBlock(newId);
            },
            redo: () => this.replaceBlock(id, type, content),
        });
        this.focusBlock(newId, 'end');
        return newId;
    }

    async duplicateBlock(id) {
        const record = this.records.get(id);
        if (!record) return;
        const subtree = [record, ...this.descendants(id).map((cid) => this.records.get(cid))];
        const idMap = new Map(subtree.map((r) => [r.id, generateUUID()]));
        let previous = id;
        for (const source of subtree) {
            const isRoot = source === record;
            await this.createBlock({
                id: idMap.get(source.id),
                type: source.type,
                content: structuredClone(source.content),
                parentId: isRoot ? (source.parent_id ?? null) : idMap.get(source.parent_id),
                slot: source.slot,
                afterId: isRoot ? previous : null,
            });
            if (isRoot) previous = idMap.get(source.id);
        }
        this.focusBlock(idMap.get(id));
    }

    async addChild(parentId, slot) {
        const existing = this.children(parentId, slot);
        const last = existing[existing.length - 1];
        await this.createBlock({ type: 'text-block', parentId, slot, afterId: last?.id ?? null, focus: true });
    }

    onColumnsChanged(component) {
        const count = component.content.count;
        for (const child of this.children(component.id)) {
            // The server folds children of removed columns into the last column; mirror it.
            if (child.slot >= count) child.slot = count - 1;
        }
        this.layout();
    }

    async insertBlocks(afterId, blocks) {
        const anchor = this.records.get(afterId);
        let previous = afterId;
        for (const block of blocks) {
            const content = structuredClone(block.content);
            for (const key of ['items', 'rows', 'columns']) {
                if (Array.isArray(content[key]))
                    content[key].forEach((item) => {
                        if (item && typeof item === 'object' && 'id' in item) item.id = generateUUID();
                    });
            }
            previous = await this.createBlock({
                type: block.type,
                content,
                parentId: anchor?.parent_id ?? null,
                slot: anchor?.slot ?? 0,
                afterId: previous,
            });
        }
        if (previous !== afterId) this.focusBlock(previous);
    }

    captureBlocksAfter(id) {
        const siblings = this.siblings(id);
        const index = siblings.findIndex((r) => r.id === id);
        const captured = [];
        for (const record of siblings.slice(index + 1)) {
            if (record.type === 'divider') break;
            if (['template', 'toggle', 'columns'].includes(record.type)) continue;
            captured.push({ type: record.type, content: structuredClone(record.content) });
        }
        return captured;
    }

    // --- Keyboard flows from components ---------------------------------------------------

    async onEnter(component, afterHTML) {
        const record = this.records.get(component.id);
        if (!record) return;
        const content = { text: afterHTML || '', format: 'html' };
        await this.createBlock({
            type: 'text-block',
            content,
            parentId: record.parent_id ?? null,
            slot: record.slot,
            afterId: component.id,
            focus: true,
            focusPosition: 'start',
        });
    }

    async onExitList(component, trailingItems) {
        const record = this.records.get(component.id);
        const textId = await this.createBlock({
            type: 'text-block',
            parentId: record.parent_id ?? null,
            slot: record.slot,
            afterId: component.id,
            focus: true,
        });
        if (trailingItems.length) {
            const content = { ...structuredClone(record.content), items: trailingItems };
            await this.createBlock({
                type: record.type,
                content,
                parentId: record.parent_id ?? null,
                slot: record.slot,
                afterId: textId,
            });
        }
    }

    async onBackspaceEmpty(component) {
        if (this.records.size === 1 && component.type === 'text-block') return;
        if (component.type !== 'text-block' && TEXT_LIKE.has(component.type)) {
            await this.replaceBlock(component.id, 'text-block');
            return;
        }
        await this.deleteBlock(component.id, { focusPrevious: true });
    }

    async onMergeUp(component, html) {
        const order = this.visualOrder();
        const previousId = order[order.indexOf(component.id) - 1];
        const previous = previousId && this.instances.get(previousId);
        if (component.type !== 'text-block' || previous?.type !== 'text-block') {
            if (previousId) this.focusBlock(previousId, 'end');
            return;
        }
        previous.appendHTML(html);
        await this.deleteBlock(component.id);
    }

    onSlash(component, node) {
        if (!this.picker) return;
        this.picker.openSlash({
            anchor: node,
            readQuery: () => node.textContent.replace(/^\//, ''),
            onSelect: (entry) => this.replaceBlock(component.id, entry.type, entry.content),
            onCancel: () => {},
        });
    }

    // --- Comments -----------------------------------------------------------------------

    setCommentCounts(counts) {
        this.commentCounts = counts;
        this.applyCommentBadges();
    }

    applyCommentBadges() {
        for (const [id, instance] of this.instances) {
            const badge = instance.element?.querySelector(':scope > .block__comment-badge');
            if (!badge) continue;
            const count = this.commentCounts.get(id) || 0;
            badge.hidden = !count;
            badge.textContent = count ? String(count) : '';
            badge.title = `${count} open comment${count === 1 ? '' : 's'}`;
            badge.dataset.componentId = id;
        }
    }

    // --- Export helpers -----------------------------------------------------------------

    snapshotBlocks() {
        return this.orderedRecords().map((record) => ({ ...record }));
    }
}
