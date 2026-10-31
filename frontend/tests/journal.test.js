import { beforeEach, describe, expect, test } from 'vitest';
import { auth } from '../js/auth.js';
import {
    addDays,
    blocksForDay,
    blocksFromComponents,
    deterministicId,
    Journal,
    journalTitle,
    localDate,
    monthLabel,
} from '../js/journal.js';
import { Storage } from '../js/storage.js';

class FakeSync {
    constructor() {
        this.ops = [];
    }

    async queue(op) {
        this.ops.push(op);
        return op;
    }
}

const TEMPLATE = [
    { type: 'date', content: { date: null, include_time: false, label: 'Today' }, parent_index: null, slot: 0 },
    { type: 'heading', content: { text: 'Top priorities', level: 3 }, parent_index: null, slot: 0 },
    { type: 'toggle', content: { title: 'Gratitude', is_open: false }, parent_index: null, slot: 0 },
    { type: 'bullet-list', content: { items: [{ id: 'i', text: '', indent_level: 0 }] }, parent_index: 2, slot: 0 },
];

let storage;
let sync;
let journal;

beforeEach(() => {
    localStorage.clear();
    auth.saveSession({
        access_token: 'a',
        refresh_token: 'r',
        device_id: 'dev-1',
        user: { id: 'user-1', email: 'u@example.com' },
    });
    localStorage.setItem(
        'nosk.settings',
        JSON.stringify({ journal_template_id: 'builtin-daily-journal', journal_salt: 'salt-1' }),
    );
    localStorage.setItem('nosk.template.builtin-daily-journal', JSON.stringify(TEMPLATE));
    storage = new Storage(`journal-${Math.random()}`);
    sync = new FakeSync();
    journal = new Journal({
        storage,
        sync,
        api: {
            get: async () => {
                throw new Error('offline');
            },
        },
        getUser: () => auth.user,
    });
});

describe('dates', () => {
    test('local dates, arithmetic and labels', () => {
        expect(localDate(new Date(2026, 9, 19, 23, 59))).toBe('2026-10-19');
        expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
        expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
        expect(journalTitle('2026-10-19')).toBe('2026-10-19 · Mon');
        expect(monthLabel('2026-10-01')).toBe('oct 2026');
    });

    test('deterministic ids are stable, distinct and UUID-shaped', () => {
        const a = deterministicId('journal', 'user-1', 'salt', '2026-10-19');
        expect(a).toBe(deterministicId('journal', 'user-1', 'salt', '2026-10-19'));
        expect(a).not.toBe(deterministicId('journal', 'user-1', 'salt', '2026-10-20'));
        expect(a).not.toBe(deterministicId('journal', 'user-1', 'other-salt', '2026-10-19'));
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });
});

describe('template blocks', () => {
    test('date blocks get the day filled in', () => {
        const [date] = blocksForDay(TEMPLATE, '2026-10-19');
        expect(date.content).toEqual({ date: '2026-10-19', include_time: false, label: '' });
        expect(TEMPLATE[0].content.date).toBeNull();
    });

    test('components become blocks that keep nesting', () => {
        const blocks = blocksFromComponents([
            { id: 't', type: 'toggle', content: { title: 'T' }, parent_id: null, slot: 0 },
            { id: 'c', type: 'divider', content: {}, parent_id: 't', slot: 0 },
        ]);
        expect(blocks.map((b) => b.parent_index)).toEqual([null, 0]);
    });
});

describe('Journal', () => {
    test('creates the day offline from the cached template with derived ids', async () => {
        const pageId = await journal.open('2026-10-19');
        expect(pageId).toBe(deterministicId('journal', 'user-1', 'salt-1', '2026-10-19'));
        const page = await storage.getPage(pageId);
        expect(page).toMatchObject({ title: '2026-10-19 · Mon', journal_date: '2026-10-19', role: 'owner' });
        const components = await storage.getComponents(pageId);
        expect(components.map((c) => c.type)).toEqual(['date', 'heading', 'toggle', 'bullet-list']);
        expect(components[0].content.date).toBe('2026-10-19');
        expect(components[3].parent_id).toBe(components[2].id);
        expect(components[1].id).toBe(deterministicId(pageId, 'block', 1));
        expect(sync.ops.map((o) => o.type)).toEqual([
            'create_page',
            'create_component',
            'create_component',
            'create_component',
            'create_component',
        ]);
        expect(sync.ops[0].data).toEqual({
            title: '2026-10-19 · Mon',
            icon: '📓',
            journal_date: '2026-10-19',
            template_id: 'builtin-daily-journal',
        });
        expect(sync.ops[2].data.after_id).toBe(components[0].id);
    });

    test('opening an existing day reuses it; a trashed day is restored', async () => {
        const id = await journal.open('2026-10-19');
        sync.ops = [];
        expect(await journal.open('2026-10-19')).toBe(id);
        expect(sync.ops).toEqual([]);
        await storage.updatePage(id, (p) => {
            p.deleted = true;
        });
        expect(await journal.open('2026-10-19')).toBe(id);
        expect((await storage.getPage(id)).deleted).toBe(false);
        expect(sync.ops).toEqual([expect.objectContaining({ type: 'restore_page', page_id: id })]);
    });

    test('your own template is read from this device and blank works', async () => {
        await storage.putPage({ id: 'tpl', title: 'Mine', is_template: true, role: 'owner', component_ids: ['h'] });
        await storage.putComponent({
            id: 'h',
            page_id: 'tpl',
            type: 'heading',
            content: { text: 'Wins', level: 2 },
            order: 0,
            parent_id: null,
            slot: 0,
        });
        localStorage.setItem('nosk.settings', JSON.stringify({ journal_template_id: 'tpl', journal_salt: 'salt-1' }));
        const id = await journal.open('2026-10-20');
        expect((await storage.getComponents(id)).map((c) => c.content.text)).toEqual(['Wins']);

        localStorage.setItem('nosk.settings', JSON.stringify({ journal_template_id: null, journal_salt: 'salt-1' }));
        const blank = await journal.open('2026-10-21');
        expect(await storage.getComponents(blank)).toEqual([]);
    });

    test('neighbours skip missing days', async () => {
        await journal.open('2026-10-01');
        await journal.open('2026-10-05');
        await journal.open('2026-10-09');
        const { previous, next } = await journal.neighbours('2026-10-05');
        expect([previous.journal_date, next.journal_date]).toEqual(['2026-10-01', '2026-10-09']);
        expect((await journal.neighbours('2026-10-01')).previous).toBeNull();
    });
});
