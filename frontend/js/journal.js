// Daily journal: one page per calendar day, created from the user's journal template.
//
// A day's page id is derived from (user, per-user secret salt, date), and its blocks' ids from
// the page id. Two devices that create the same day while offline therefore produce identical
// ids, and the server treats the second creation as already applied instead of duplicating it.
import { generateUUID, now } from './utils.js';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const SETTINGS_KEY = 'nosk.settings';
const TEMPLATE_KEY = (id) => `nosk.template.${id}`;
const DEFAULT_TEMPLATE = 'builtin-daily-journal';

const pad = (n) => String(n).padStart(2, '0');

/** YYYY-MM-DD in the device's local calendar. */
export function localDate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function addDays(dateStr, days) {
    const date = parseDate(dateStr);
    date.setDate(date.getDate() + days);
    return localDate(date);
}

export function weekday(dateStr) {
    return WEEKDAYS[parseDate(dateStr).getDay()];
}

/** Default page title. Fixed English weekday names so every device derives the same title. */
export function journalTitle(dateStr) {
    return `${dateStr} · ${weekday(dateStr)}`;
}

export function monthLabel(dateStr) {
    const [y, m] = dateStr.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** 128-bit non-cryptographic hash (cyrb128) formatted as a UUID. Deterministic everywhere. */
export function deterministicId(...parts) {
    const input = parts.join('|');
    let h1 = 1779033703;
    let h2 = 3144134277;
    let h3 = 1013904242;
    let h4 = 2773480762;
    for (let i = 0; i < input.length; i += 1) {
        const k = input.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    const hex = [h1 ^ h2 ^ h3 ^ h4, h2 ^ h1, h3 ^ h1, h4 ^ h1]
        .map((h) => (h >>> 0).toString(16).padStart(8, '0'))
        .join('');
    // Shape it as an RFC 4122 v5-style UUID so it passes id validation.
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function readJSON(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || 'null');
    } catch {
        return null;
    }
}

function writeJSON(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Cache only; the server copy stays authoritative.
    }
}

/** Turn stored components (in order) into template blocks that keep their nesting. */
export function blocksFromComponents(components) {
    const indexOf = new Map(components.map((c, i) => [c.id, i]));
    return components.map((c) => ({
        type: c.type,
        content: structuredClone(c.content),
        parent_index: c.parent_id && indexOf.has(c.parent_id) ? indexOf.get(c.parent_id) : null,
        slot: c.slot || 0,
    }));
}

/** Template blocks adjusted for a specific day: blank date blocks get that day's date. */
export function blocksForDay(blocks, dateStr) {
    return blocks.map((block) => {
        const content = structuredClone(block.content || {});
        if (block.type === 'date' && !content.date) {
            content.date = dateStr;
            if (content.label === 'Today') content.label = '';
        }
        return { ...block, content };
    });
}

export class Journal {
    constructor({ storage, sync, api, getUser }) {
        this.storage = storage;
        this.sync = sync;
        this.api = api;
        this.getUser = getUser;
    }

    /** Cached settings, refreshed from the server when online. */
    cachedSettings() {
        return readJSON(SETTINGS_KEY) || { journal_template_id: DEFAULT_TEMPLATE, journal_salt: null };
    }

    async refreshSettings() {
        try {
            const settings = await this.api.get('/api/auth/settings');
            writeJSON(SETTINGS_KEY, settings);
            return settings;
        } catch {
            return this.cachedSettings();
        }
    }

    async saveSettings(changes) {
        const settings = await this.api.request('PUT', '/api/auth/settings', { body: changes });
        writeJSON(SETTINGS_KEY, settings);
        return settings;
    }

    /** Fetch and cache the blocks of the chosen template so new days can be created offline. */
    async warmTemplate(templateId = this.cachedSettings().journal_template_id) {
        if (!templateId) return [];
        try {
            const template = await this.api.get(`/api/templates/${templateId}`);
            writeJSON(TEMPLATE_KEY(templateId), template.blocks);
            return template.blocks;
        } catch {
            return readJSON(TEMPLATE_KEY(templateId));
        }
    }

    async templateBlocks(templateId) {
        if (!templateId) return [];
        // Your own templates are already on this device; they may have changed since caching.
        const page = await this.storage.getPage(templateId);
        if (page?.is_template) return blocksFromComponents(await this.storage.getComponents(templateId));
        return readJSON(TEMPLATE_KEY(templateId)) || (await this.warmTemplate(templateId)) || [];
    }

    async entries() {
        const pages = await this.storage.getPages();
        return pages
            .filter((p) => p.journal_date && p.role === 'owner' && !p.deleted)
            .sort((a, b) => a.journal_date.localeCompare(b.journal_date));
    }

    async find(dateStr) {
        const pages = await this.storage.getPages();
        return pages.find((p) => p.journal_date === dateStr && p.role === 'owner') || null;
    }

    /** Previous and next existing entries around a date. */
    async neighbours(dateStr) {
        const entries = await this.entries();
        const before = entries.filter((p) => p.journal_date < dateStr);
        const after = entries.filter((p) => p.journal_date > dateStr);
        return { previous: before[before.length - 1] || null, next: after[0] || null };
    }

    /** The page id for a day, creating (or restoring from trash) the entry if needed. */
    async open(dateStr) {
        const existing = await this.find(dateStr);
        if (existing && !existing.deleted) return existing.id;
        if (existing) {
            await this.storage.updatePage(existing.id, (page) => {
                page.deleted = false;
            });
            await this.sync.queue({ type: 'restore_page', page_id: existing.id });
            return existing.id;
        }
        return this.create(dateStr);
    }

    async create(dateStr) {
        const user = this.getUser();
        const settings = this.cachedSettings();
        const salt = settings.journal_salt;
        const pageId = salt ? deterministicId('journal', user.id, salt, dateStr) : generateUUID();
        const blocks = blocksForDay(await this.templateBlocks(settings.journal_template_id), dateStr);
        const ids = blocks.map((_, index) => (salt ? deterministicId(pageId, 'block', index) : generateUUID()));
        const timestamp = now();
        const title = journalTitle(dateStr);
        const components = blocks.map((block, index) => ({
            id: ids[index],
            page_id: pageId,
            type: block.type,
            content: block.content,
            parent_id: block.parent_index !== null && block.parent_index !== undefined ? ids[block.parent_index] : null,
            slot: block.parent_index !== null && block.parent_index !== undefined ? block.slot || 0 : 0,
            order: index,
            created_at: timestamp,
            updated_at: timestamp,
            schema_version: 1,
            sv: 0,
        }));
        await this.storage.putPage({
            id: pageId,
            user_id: user.id,
            title,
            icon: '📓',
            color: null,
            tags: [],
            is_template: false,
            journal_date: dateStr,
            template_id: settings.journal_template_id || null,
            component_ids: ids,
            created_at: timestamp,
            updated_at: timestamp,
            version: 0,
            sv: 0,
            deleted: false,
            role: 'owner',
            owner_email: null,
        });
        await this.storage.putMany('components', components);
        await this.sync.queue({
            type: 'create_page',
            page_id: pageId,
            data: { title, icon: '📓', journal_date: dateStr, template_id: settings.journal_template_id || null },
        });
        for (const [index, component] of components.entries()) {
            await this.sync.queue({
                type: 'create_component',
                page_id: pageId,
                component_id: component.id,
                data: {
                    type: component.type,
                    content: component.content,
                    parent_id: component.parent_id,
                    slot: component.slot,
                    after_id: index > 0 ? ids[index - 1] : null,
                },
            });
        }
        return pageId;
    }
}
