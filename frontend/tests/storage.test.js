import { beforeEach, describe, expect, test } from 'vitest';
import { Storage } from '../js/storage.js';

let storage;
beforeEach(() => {
    storage = new Storage(`test-${Math.random()}`);
});

describe('storage', () => {
    test('pages and components round-trip, ordered by order', async () => {
        await storage.putPage({ id: 'p', title: 'x' });
        await storage.putMany('components', [
            { id: 'b', page_id: 'p', order: 1 },
            { id: 'a', page_id: 'p', order: 0 },
            { id: 'z', page_id: 'other', order: 0 },
        ]);
        expect((await storage.getComponents('p')).map((c) => c.id)).toEqual(['a', 'b']);
        await storage.deletePage('p');
        expect(await storage.getPage('p')).toBeUndefined();
        expect(await storage.getComponents('p')).toEqual([]);
    });

    test('meta values', async () => {
        expect(await storage.getMeta('cursor', 0)).toBe(0);
        await storage.setMeta('cursor', 42);
        expect(await storage.getMeta('cursor')).toBe(42);
    });

    test('content updates merge into the pending op, keeping the first base version', async () => {
        await storage.enqueue({
            type: 'update_component',
            component_id: 'c',
            page_version: 3,
            data: { content: { text: 'a' } },
        });
        const merged = await storage.mergeIntoOutbox(
            { type: 'update_component', component_id: 'c', page_version: 9, data: { content: { text: 'ab' } } },
            () => false,
        );
        expect(merged).toBe(true);
        const outbox = await storage.outbox();
        expect(outbox).toHaveLength(1);
        expect(outbox[0].op).toMatchObject({ page_version: 3, data: { content: { text: 'ab' } } });
    });

    test('does not merge into an op that is being sent or across a structural op', async () => {
        await storage.enqueue({ type: 'update_component', component_id: 'c', data: {} });
        const [first] = await storage.outbox();
        expect(
            await storage.mergeIntoOutbox(
                { type: 'update_component', component_id: 'c', data: { x: 1 } },
                (seq) => seq === first.seq,
            ),
        ).toBe(false);
        await storage.enqueue({ type: 'move_component', component_id: 'd', data: {} });
        await storage.enqueue({ type: 'convert_component', component_id: 'e', data: {} });
        await storage.enqueue({ type: 'convert_component', component_id: 'f', data: {} });
        await storage.enqueue({ type: 'update_component', component_id: 'f', data: {} });
        expect(
            await storage.mergeIntoOutbox({ type: 'update_component', component_id: 'e', data: {} }, () => false),
        ).toBe(false);
    });
});
