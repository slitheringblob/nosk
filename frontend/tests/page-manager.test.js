import { beforeEach, describe, expect, test, vi } from 'vitest';
import { PageManager } from '../js/page-manager.js';
import { Storage } from '../js/storage.js';

class FakeSync {
    constructor() {
        this.ops = [];
    }

    async queue(op) {
        this.ops.push(op);
        return op;
    }

    sendPresence() {}
}

let storage;
let sync;
let manager;
let root;

beforeEach(async () => {
    storage = new Storage(`pm-${Math.random()}`);
    sync = new FakeSync();
    root = document.createElement('div');
    document.body.replaceChildren(root);
    await storage.putPage({ id: 'p', title: 'Page', component_ids: [], version: 0, role: 'owner' });
    manager = new PageManager({ storage, sync, root });
    await manager.open('p');
});

const topLevelTypes = () => [...root.querySelectorAll(':scope > .block')].map((n) => n.dataset.componentType);

describe('PageManager', () => {
    test('shows an empty state and creates blocks in order', async () => {
        expect(root.querySelector('.page-empty')).not.toBeNull();
        const a = await manager.createBlock({ type: 'heading' });
        await manager.createBlock({ type: 'divider' });
        await manager.createBlock({ type: 'checklist', afterId: a });
        expect(topLevelTypes()).toEqual(['heading', 'checklist', 'divider']);
        expect(root.querySelector('.page-empty')).toBeNull();
        expect((await storage.getPage('p')).component_ids).toHaveLength(3);
        expect(sync.ops.map((op) => op.type)).toEqual(['create_component', 'create_component', 'create_component']);
        expect(sync.ops[2].data.after_id).toBe(a);
    });

    test('nests blocks inside containers and deletes subtrees', async () => {
        const toggle = await manager.createBlock({ type: 'toggle', content: { title: 'T', is_open: true } });
        const child = await manager.createBlock({ type: 'text-block', parentId: toggle });
        await manager.createBlock({ type: 'divider', afterId: toggle });
        const slot = root.querySelector('.toggle-children');
        expect(slot.querySelector(`[data-component-id="${child}"]`)).not.toBeNull();
        // The divider goes after the toggle's whole subtree in the flat order.
        expect(manager.page.component_ids.indexOf(child)).toBeLessThan(manager.page.component_ids.length - 1);
        await manager.deleteBlock(toggle);
        expect(topLevelTypes()).toEqual(['divider']);
        expect(await storage.getComponent(child)).toBeUndefined();
        expect(sync.ops.at(-1)).toMatchObject({ type: 'delete_component', component_id: toggle });
    });

    test('undo and redo structural changes', async () => {
        const id = await manager.createBlock({ type: 'text-block', content: { text: 'keep me', format: 'html' } });
        await manager.deleteBlock(id);
        expect(topLevelTypes()).toEqual([]);
        await manager.undo();
        expect(topLevelTypes()).toEqual(['text-block']);
        expect(root.textContent).toContain('keep me');
        await manager.redo();
        expect(topLevelTypes()).toEqual([]);
    });

    test('moves blocks up and down among siblings', async () => {
        const a = await manager.createBlock({ type: 'heading' });
        const b = await manager.createBlock({ type: 'divider' });
        await manager.createBlock({ type: 'quote' });
        await manager.moveBy(b, -1);
        expect(topLevelTypes()).toEqual(['divider', 'heading', 'quote']);
        expect(sync.ops.at(-1)).toMatchObject({ type: 'move_component', component_id: b, data: { after_id: null } });
        await manager.moveBy(a, 1);
        expect(topLevelTypes()).toEqual(['divider', 'quote', 'heading']);
    });

    test('moves a block into a container', async () => {
        const toggle = await manager.createBlock({ type: 'toggle', content: { title: 'T', is_open: true } });
        const text = await manager.createBlock({ type: 'text-block' });
        await manager.moveBlock(text, { parentId: toggle, slot: 0 });
        expect(root.querySelector('.toggle-children').children).toHaveLength(1);
        expect((await storage.getComponent(text)).parent_id).toBe(toggle);
        await manager.moveBlock(toggle, { parentId: text });
        expect((await storage.getComponent(toggle)).parent_id).toBeNull();
    });

    test('converts blocks and undoes the conversion', async () => {
        const id = await manager.createBlock({ type: 'text-block', content: { text: 'one<br>two', format: 'html' } });
        await manager.convertBlock(id, 'checklist');
        expect(topLevelTypes()).toEqual(['checklist']);
        expect((await storage.getComponent(id)).content.items).toHaveLength(2);
        expect(sync.ops.at(-1)).toMatchObject({ type: 'convert_component', data: { to_type: 'checklist' } });
        await manager.undo();
        expect(topLevelTypes()).toEqual(['text-block']);
    });

    test('content edits are debounced into one update op', async () => {
        const id = await manager.createBlock({ type: 'text-block' });
        const editable = root.querySelector('.text-block-content');
        editable.innerHTML = 'a';
        editable.dispatchEvent(new Event('input'));
        editable.innerHTML = 'ab';
        editable.dispatchEvent(new Event('input'));
        await manager.flushSaves();
        await new Promise((resolve) => setTimeout(resolve, 0));
        const updates = sync.ops.filter((op) => op.type === 'update_component');
        expect(updates).toHaveLength(1);
        expect(updates[0]).toMatchObject({ component_id: id, data: { content: { text: 'ab' } } });
        expect((await storage.getComponent(id)).content.text).toBe('ab');
    });

    test('reconcile applies remote content and removals', async () => {
        const a = await manager.createBlock({ type: 'text-block', content: { text: 'old', format: 'html' } });
        const b = await manager.createBlock({ type: 'divider' });
        const record = await storage.getComponent(a);
        record.content = { text: 'from another device', format: 'html' };
        await storage.putComponent(record);
        await storage.deleteComponent(b);
        await manager.reconcile();
        expect(root.textContent).toContain('from another device');
        expect(topLevelTypes()).toEqual(['text-block']);
    });

    test('viewers get a read-only page and cannot mutate', async () => {
        await storage.putPage({ id: 'v', title: 'Shared', component_ids: ['x'], version: 1, role: 'viewer' });
        await storage.putComponent({ id: 'x', page_id: 'v', type: 'text-block', content: { text: 'hi' }, order: 0 });
        await manager.open('v');
        expect(root.querySelector('[contenteditable="true"]')).toBeNull();
        expect(await manager.createBlock({ type: 'divider' })).toBeNull();
    });

    test('template blocks capture the blocks below until a divider', async () => {
        const template = await manager.createBlock({ type: 'template' });
        await manager.createBlock({ type: 'heading', content: { text: 'Entry', level: 3 } });
        await manager.createBlock({ type: 'checklist' });
        await manager.createBlock({ type: 'divider' });
        await manager.createBlock({ type: 'quote' });
        const captured = manager.captureBlocksAfter(template);
        expect(captured.map((b) => b.type)).toEqual(['heading', 'checklist']);
        await manager.insertBlocks(template, captured);
        expect(topLevelTypes().slice(0, 3)).toEqual(['template', 'heading', 'checklist']);
        expect(topLevelTypes()).toHaveLength(7);
    });

    test('new text blocks take focus immediately', async () => {
        const first = await manager.createBlock({ type: 'text-block' });
        const focusBlock = vi.spyOn(manager, 'focusBlock');
        const pending = manager.createBlock({ type: 'text-block', afterId: first, focus: true });
        // Focus moves before the async persistence finishes so fast typing isn't lost.
        expect(focusBlock).toHaveBeenCalledTimes(1);
        expect(root.querySelectorAll('.text-block-content')).toHaveLength(2);
        await pending;
    });
});
