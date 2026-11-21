import { beforeEach, describe, expect, test, vi } from 'vitest';
import { auth } from '../js/auth.js';
import { Storage } from '../js/storage.js';
import { mergeOrder, SyncClient } from '../js/sync-client.js';

function fakeApi(handlers) {
    return {
        calls: [],
        async get(path, query) {
            this.calls.push(['GET', path, query]);
            return handlers[`GET ${path}`](query);
        },
        async post(path, body) {
            this.calls.push(['POST', path, body]);
            return handlers[`POST ${path}`](body);
        },
        refresh: async () => true,
    };
}

let storage;
beforeEach(() => {
    storage = new Storage(`sync-${Math.random()}`);
    auth.saveSession({
        access_token: 'a',
        refresh_token: 'r',
        device_id: 'dev-1',
        user: { id: 'u1', email: 'u@example.com' },
    });
});

describe('mergeOrder', () => {
    test('keeps local-only ids after their local predecessor', () => {
        const local = ['a', 'new', 'b', 'c'];
        const server = ['c', 'a', 'b', 'x'];
        const exists = (id) => id !== 'x';
        expect(mergeOrder(server, local, exists)).toEqual(['c', 'a', 'new', 'b']);
    });
});

describe('SyncClient', () => {
    test('queue then sync pushes ops and applies page versions', async () => {
        await storage.putPage({ id: 'p', version: 2, sv: 2, component_ids: ['c'] });
        await storage.putComponent({ id: 'c', page_id: 'p', type: 'text-block', content: {}, order: 0, sv: 1 });
        const api = fakeApi({
            'POST /api/sync/push': (body) => ({
                synced: body.operations.length,
                conflicts: [],
                page_versions: { p: 3 },
                cursor: 10,
            }),
            'GET /api/sync/pull': () => ({ changes: [], cursor: 10, last_sync: 0, has_more: false }),
        });
        const client = new SyncClient({ storage, apiClient: api });
        client.schedulePush.cancel = () => {};
        await client.queue({
            type: 'update_component',
            page_id: 'p',
            component_id: 'c',
            data: { content: { text: 'a' } },
        });
        await client.queue({
            type: 'update_component',
            page_id: 'p',
            component_id: 'c',
            data: { content: { text: 'ab' } },
        });
        client.schedulePush.cancel();
        await client.sync();

        const push = api.calls.find((c) => c[1] === '/api/sync/push')[2];
        expect(push.operations).toHaveLength(1);
        expect(push.operations[0]).toMatchObject({
            page_version: 1,
            device_id: 'dev-1',
            data: { content: { text: 'ab' } },
        });
        expect(await storage.outbox()).toEqual([]);
        expect((await storage.getComponent('c')).sv).toBe(3);
        expect((await storage.getPage('p')).version).toBe(3);
        expect(await storage.getMeta('cursor')).toBe(10);
    });

    test('conflicts are stored for review with the local copy', async () => {
        await storage.putPage({ id: 'p', version: 1, sv: 1, component_ids: ['c'] });
        await storage.putComponent({
            id: 'c',
            page_id: 'p',
            type: 'text-block',
            content: { text: 'mine' },
            order: 0,
            sv: 1,
        });
        const api = fakeApi({
            'POST /api/sync/push': () => ({
                synced: 0,
                conflicts: [
                    {
                        operation_index: 0,
                        operation_id: 'x',
                        page_id: 'p',
                        entity_type: 'component',
                        entity_id: 'c',
                        reason: 'version_mismatch',
                        resolution: 'manual',
                        server_version: 2,
                        server_data: { id: 'c', page_id: 'p', type: 'text-block', content: { text: 'theirs' } },
                    },
                ],
                page_versions: {},
                cursor: 5,
            }),
            'GET /api/sync/pull': () => ({ changes: [], cursor: 5, last_sync: 0, has_more: false }),
        });
        const client = new SyncClient({ storage, apiClient: api });
        const onConflict = vi.fn();
        client.on('conflict', onConflict);
        await client.queue({
            type: 'update_component',
            page_id: 'p',
            component_id: 'c',
            data: { content: { text: 'mine' } },
        });
        client.schedulePush.cancel();
        await client.sync();
        const [conflict] = await storage.getConflicts();
        expect(onConflict).toHaveBeenCalled();
        expect(conflict.local_data.content.text).toBe('mine');

        await client.resolveConflict(conflict, 'theirs');
        expect((await storage.getComponent('c')).content.text).toBe('theirs');
        expect(await storage.getConflicts()).toEqual([]);
    });

    test('keep mine re-queues the op with force', async () => {
        const client = new SyncClient({ storage, apiClient: fakeApi({}) });
        await storage.putPage({ id: 'p', version: 1 });
        await client.resolveConflict(
            {
                operation_id: 'x',
                reason: 'version_mismatch',
                entity_type: 'component',
                entity_id: 'c',
                op: {
                    operation_id: 'x',
                    type: 'update_component',
                    page_id: 'p',
                    component_id: 'c',
                    page_version: 1,
                    data: { content: { text: 'm' } },
                },
            },
            'mine',
        );
        client.schedulePush.cancel();
        const [entry] = await storage.outbox();
        expect(entry.op).toMatchObject({ force: true, type: 'update_component', data: { content: { text: 'm' } } });
        expect(entry.op.operation_id).not.toBe('x');
    });

    test('applies remote changes but not over pending local edits', async () => {
        await storage.putPage({ id: 'p', version: 1, sv: 1, component_ids: ['a', 'b'], role: 'owner', user_id: 'u1' });
        await storage.putMany('components', [
            { id: 'a', page_id: 'p', type: 'text-block', content: { text: 'a' }, order: 0 },
            { id: 'b', page_id: 'p', type: 'text-block', content: { text: 'b-local' }, order: 1 },
        ]);
        await storage.enqueue({ type: 'update_component', page_id: 'p', component_id: 'b', data: {} });
        const remote = (component, seq) => ({
            seq,
            type: 'component_updated',
            page_id: 'p',
            component_id: component.id,
            page_version: seq,
            device_id: 'dev-2',
            user_id: 'u1',
            data: { component },
        });
        const changes = [
            remote({ id: 'a', page_id: 'p', type: 'text-block', content: { text: 'a-remote' }, order: 0 }, 2),
            remote({ id: 'b', page_id: 'p', type: 'text-block', content: { text: 'b-remote' }, order: 1 }, 3),
            {
                seq: 4,
                type: 'component_created',
                page_id: 'p',
                component_id: 'n',
                page_version: 4,
                device_id: 'dev-2',
                user_id: 'u1',
                data: {
                    component: { id: 'n', page_id: 'p', type: 'divider', content: {}, order: 2 },
                    component_ids: ['a', 'b', 'n'],
                },
            },
            {
                seq: 5,
                type: 'page_updated',
                page_id: 'p',
                page_version: 5,
                device_id: 'dev-1',
                user_id: 'u1',
                data: { title: 'own change' },
            },
        ];
        const client = new SyncClient({ storage, apiClient: fakeApi({}) });
        await client.applyChanges(changes);
        expect((await storage.getComponent('a')).content.text).toBe('a-remote');
        expect((await storage.getComponent('b')).content.text).toBe('b-local');
        const page = await storage.getPage('p');
        expect(page.component_ids).toEqual(['a', 'b', 'n']);
        expect(page.version).toBe(5);
        expect(page.title).toBeUndefined();
    });

    test('permanent deletes and unshares remove local pages', async () => {
        await storage.putPage({ id: 'p1', version: 1 });
        await storage.putPage({ id: 'p2', version: 1 });
        const client = new SyncClient({ storage, apiClient: fakeApi({}) });
        await client.applyChanges([
            {
                seq: 1,
                type: 'page_deleted',
                page_id: 'p1',
                page_version: 2,
                device_id: 'x',
                user_id: 'u2',
                data: { permanent: true },
            },
            {
                seq: 2,
                type: 'page_unshared',
                page_id: 'p2',
                page_version: 1,
                device_id: 'x',
                user_id: 'u2',
                data: { shared_with: 'u1' },
            },
        ]);
        expect(await storage.getPages()).toEqual([]);
    });

    test('bootstrap loads pages, components and cursor', async () => {
        const api = fakeApi({
            'GET /api/sync/bootstrap': () => ({
                pages: [{ id: 'p', version: 4, title: 'x' }],
                components: [{ id: 'c', page_id: 'p', order: 0 }],
                cursor: 99,
            }),
        });
        const client = new SyncClient({ storage, apiClient: api });
        await client.bootstrap();
        expect((await storage.getPage('p')).sv).toBe(4);
        expect((await storage.getComponent('c')).sv).toBe(4);
        expect(await storage.getMeta('cursor')).toBe(99);
    });

    test('network failures leave ops queued and report offline', async () => {
        const { NetworkError } = await import('../js/api-client.js');
        const api = {
            post: async () => {
                throw new NetworkError(new Error('down'));
            },
            get: async () => {
                throw new NetworkError(new Error('down'));
            },
        };
        const client = new SyncClient({ storage, apiClient: api });
        await storage.putPage({ id: 'p', version: 0 });
        await client.queue({ type: 'update_page', page_id: 'p', data: { title: 'x' } });
        client.schedulePush.cancel();
        await client.sync();
        expect(client.status).toBe('offline');
        expect(await storage.outbox()).toHaveLength(1);
    });

    test('own page_created keeps newer local fields; server-side creations apply fully', async () => {
        await storage.putPage({ id: 'mine', title: 'Renamed locally', version: 0, role: 'owner', user_id: 'u1' });
        const client = new SyncClient({ storage, apiClient: fakeApi({}) });
        await client.applyChanges([
            {
                seq: 1,
                type: 'page_created',
                page_id: 'mine',
                page_version: 0,
                device_id: 'dev-1',
                user_id: 'u1',
                data: { id: 'mine', user_id: 'u1', title: 'Untitled', component_ids: [] },
            },
            {
                seq: 2,
                type: 'page_created',
                page_id: 'dup',
                page_version: 0,
                device_id: 'dev-1',
                user_id: 'u1',
                data: {
                    id: 'dup',
                    user_id: 'u1',
                    title: 'Copy',
                    component_ids: ['c1'],
                    components: [{ id: 'c1', page_id: 'dup', type: 'divider', content: {}, order: 0 }],
                },
            },
        ]);
        expect((await storage.getPage('mine')).title).toBe('Renamed locally');
        expect((await storage.getPage('dup')).role).toBe('owner');
        expect((await storage.getComponents('dup')).map((c) => c.id)).toEqual(['c1']);
    });

    test('page_shared adds the page for the recipient only', async () => {
        await storage.putPage({ id: 'p', title: 'Mine', version: 1, role: 'owner', user_id: 'u1' });
        const client = new SyncClient({ storage, apiClient: fakeApi({}) });
        await client.applyChanges([
            {
                seq: 1,
                type: 'page_shared',
                page_id: 'p',
                page_version: 1,
                device_id: 'dev-9',
                user_id: 'u1',
                data: { id: 'p', user_id: 'u1', title: 'Stale', role: 'editor', shared_with: 'u2' },
            },
            {
                seq: 2,
                type: 'page_shared',
                page_id: 'q',
                page_version: 3,
                device_id: 'dev-9',
                user_id: 'u2',
                data: {
                    id: 'q',
                    user_id: 'u2',
                    title: 'Theirs',
                    role: 'viewer',
                    owner_email: 'o@example.com',
                    shared_with: 'u1',
                    components: [],
                },
            },
        ]);
        expect(await storage.getPage('p')).toMatchObject({ title: 'Mine', role: 'owner' });
        expect(await storage.getPage('q')).toMatchObject({
            title: 'Theirs',
            role: 'viewer',
            owner_email: 'o@example.com',
        });
    });

    test('remote updates skipped for pending blocks are re-fetched after pushing', async () => {
        await storage.putPage({ id: 'p', version: 1, sv: 1, component_ids: ['c'], role: 'owner', user_id: 'u1' });
        await storage.putComponent({ id: 'c', page_id: 'p', type: 'text-block', content: { text: 'mine' }, order: 0 });
        await storage.enqueue({ type: 'create_component', page_id: 'p', component_id: 'c', data: {} });
        const api = fakeApi({
            'GET /api/components/c': () => ({
                id: 'c',
                page_id: 'p',
                type: 'text-block',
                content: { text: 'server' },
                order: 0,
                page_version: 7,
            }),
        });
        const client = new SyncClient({ storage, apiClient: api });
        await client.applyChanges([
            {
                seq: 1,
                type: 'component_updated',
                page_id: 'p',
                component_id: 'c',
                page_version: 6,
                device_id: 'dev-2',
                user_id: 'u1',
                data: {
                    component: { id: 'c', page_id: 'p', type: 'text-block', content: { text: 'theirs' }, order: 0 },
                },
            },
        ]);
        expect((await storage.getComponent('c')).content.text).toBe('mine');
        expect(await storage.getMeta('stale')).toEqual(['c']);

        // Still pending: nothing is fetched yet.
        await client.refreshStale();
        expect(api.calls).toEqual([]);

        // Once the outbox is empty the server copy is applied.
        await storage.removeFromOutbox((await storage.outbox()).map((e) => e.seq));
        await client.refreshStale();
        const component = await storage.getComponent('c');
        expect(component).toMatchObject({ content: { text: 'server' }, sv: 7 });
        expect(component.page_version).toBeUndefined();
        expect(await storage.getMeta('stale')).toEqual([]);
    });

    test('an older remote snapshot never overwrites a newer local copy', async () => {
        // The laptop created and edited block "c" (synced at version 5); the phone's earlier,
        // empty creation of the same block (version 2) arrives afterwards.
        await storage.putPage({ id: 'p', version: 5, sv: 0, component_ids: ['c'], role: 'owner', user_id: 'u1' });
        await storage.putComponent({
            id: 'c',
            page_id: 'p',
            type: 'text-block',
            content: { text: 'laptop note' },
            order: 0,
            sv: 5,
        });
        const client = new SyncClient({ storage, apiClient: fakeApi({}) });
        await client.applyChanges([
            {
                seq: 1,
                type: 'page_created',
                page_id: 'p',
                page_version: 0,
                device_id: 'dev-2',
                user_id: 'u1',
                data: { id: 'p', user_id: 'u1', title: 'Day', component_ids: [] },
            },
            {
                seq: 2,
                type: 'component_created',
                page_id: 'p',
                component_id: 'c',
                page_version: 2,
                device_id: 'dev-2',
                user_id: 'u1',
                data: {
                    component: { id: 'c', page_id: 'p', type: 'text-block', content: { text: '' }, order: 0 },
                    component_ids: ['c'],
                },
            },
            {
                seq: 3,
                type: 'component_updated',
                page_id: 'p',
                component_id: 'c',
                page_version: 6,
                device_id: 'dev-2',
                user_id: 'u1',
                data: {
                    component: {
                        id: 'c',
                        page_id: 'p',
                        type: 'text-block',
                        content: { text: 'newer from phone' },
                        order: 0,
                    },
                },
            },
        ]);
        expect((await storage.getPage('p')).component_ids).toEqual(['c']);
        expect((await storage.getComponent('c')).content.text).toBe('newer from phone');
    });

    test('a new data epoch re-downloads everything but keeps unsynced edits', async () => {
        // A device that synced before the server added template origins (no epoch stored).
        await storage.setMeta('cursor', 3);
        await storage.putPage({
            id: 'p',
            title: 'Daily journal',
            version: 2,
            sv: 2,
            component_ids: ['a', 'b'],
            role: 'owner',
            user_id: 'u1',
        });
        await storage.putMany('components', [
            { id: 'a', page_id: 'p', type: 'text-block', content: { text: 'old' }, order: 0, sv: 2 },
            { id: 'b', page_id: 'p', type: 'text-block', content: { text: 'my unsynced edit' }, order: 1, sv: 2 },
        ]);
        await storage.enqueue({ type: 'update_component', page_id: 'p', component_id: 'b', data: {} });
        let pulls = 0;
        const api = fakeApi({
            'GET /api/sync/pull': () => {
                pulls += 1;
                return { changes: [], cursor: 9, last_sync: 0, has_more: false, data_epoch: '0004' };
            },
            'GET /api/sync/bootstrap': () => ({
                pages: [
                    {
                        id: 'p',
                        title: 'Daily journal',
                        version: 5,
                        component_ids: ['a', 'b'],
                        role: 'owner',
                        user_id: 'u1',
                        template_id: 'builtin-daily-journal',
                    },
                ],
                components: [
                    { id: 'a', page_id: 'p', type: 'text-block', content: { text: 'server' }, order: 0 },
                    { id: 'b', page_id: 'p', type: 'text-block', content: { text: 'server b' }, order: 1 },
                ],
                cursor: 9,
                data_epoch: '0004',
            }),
        });
        const client = new SyncClient({ storage, apiClient: api });
        const changed = vi.fn();
        client.on('changes', changed);
        await client.pullAll();
        expect((await storage.getPage('p')).template_id).toBe('builtin-daily-journal');
        expect((await storage.getComponent('a')).content.text).toBe('server');
        expect((await storage.getComponent('b')).content.text).toBe('my unsynced edit');
        expect(await storage.getMeta('data_epoch')).toBe('0004');
        expect(changed).toHaveBeenCalledWith({ pageIds: ['p'], changes: [] });
        expect(pulls).toBe(2);

        // Same epoch next time: no re-download.
        await client.pullAll();
        expect(api.calls.filter((c) => c[1] === '/api/sync/bootstrap')).toHaveLength(1);
    });
});
