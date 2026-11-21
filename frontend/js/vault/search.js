// Search over the device's copy of the vault. Everything is local: a few MB of markdown is small
// enough to scan on every keystroke.
import { escapeHTML } from '../utils.js';
import { displayName } from './links.js';
import { noteTags, splitFrontmatter } from './render.js';

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function highlight(text, terms) {
    const safe = escapeHTML(text);
    if (!terms.length) return safe;
    const pattern = new RegExp(terms.map((t) => escapeRegExp(escapeHTML(t))).join('|'), 'gi');
    return safe.replace(pattern, (match) => `<mark>${match}</mark>`);
}

export class VaultSearch {
    constructor(store) {
        this.store = store;
        this.docs = null;
    }

    invalidate() {
        this.docs = null;
    }

    async load() {
        if (this.docs) return this.docs;
        const files = await this.store.allFiles();
        this.docs = files
            .filter((f) => f.kind === 'note')
            .map((f) => {
                const text = f.text || '';
                const body = splitFrontmatter(text).body;
                return {
                    path: f.path,
                    name: displayName(f.path),
                    lowerName: displayName(f.path).toLowerCase(),
                    lowerPath: f.path.toLowerCase(),
                    body,
                    lowerBody: body.toLowerCase(),
                    tags: noteTags(text).map((t) => t.toLowerCase()),
                };
            });
        return this.docs;
    }

    /** Files whose name or path matches, best first (quick switcher). */
    async files(query, limit = 12) {
        const files = (await this.store.allFiles()).filter((f) => f.kind !== 'config');
        const q = query.trim().toLowerCase();
        if (!q) return [];
        const words = q.split(/\s+/);
        return files
            .map((file) => {
                const name = displayName(file.path).toLowerCase();
                const path = file.path.toLowerCase();
                if (!words.every((w) => path.includes(w))) return null;
                const score = name === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : 3;
                return { file, score };
            })
            .filter(Boolean)
            .sort((a, b) => a.score - b.score || a.file.path.length - b.file.path.length)
            .slice(0, limit)
            .map((m) => m.file);
    }

    /**
     * Notes containing every term (title, path, body or tag). `#tag` terms match tags only.
     * Returns [{ path, name, snippet }] with the first hit highlighted.
     */
    async fullText(query, limit = 40) {
        const docs = await this.load();
        const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!terms.length) return [];
        const tagTerms = terms.filter((t) => t.startsWith('#') && t.length > 1).map((t) => t.slice(1));
        const textTerms = terms.filter((t) => !t.startsWith('#'));
        const results = [];
        for (const doc of docs) {
            if (!tagTerms.every((tag) => doc.tags.some((t) => t === tag || t.startsWith(`${tag}/`)))) continue;
            let score = 0;
            let ok = true;
            for (const term of textTerms) {
                const inName = doc.lowerName.includes(term);
                const count = doc.lowerBody.split(term).length - 1;
                if (!inName && !count && !doc.lowerPath.includes(term)) {
                    ok = false;
                    break;
                }
                score += (inName ? 20 : 0) + Math.min(count, 10);
            }
            if (!ok) continue;
            results.push({ doc, score });
        }
        results.sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path));
        return results.slice(0, limit).map(({ doc }) => ({
            path: doc.path,
            name: doc.name,
            snippet: this.snippet(doc, textTerms),
        }));
    }

    snippet(doc, terms) {
        const at = terms.length ? Math.min(...terms.map((t) => doc.lowerBody.indexOf(t)).filter((i) => i >= 0)) : -1;
        if (!Number.isFinite(at) || at < 0) return highlight(doc.body.slice(0, 120).replace(/\s+/g, ' '), terms);
        const start = Math.max(0, at - 50);
        const text = `${start > 0 ? '…' : ''}${doc.body.slice(start, at + 90).replace(/\s+/g, ' ')}…`;
        return highlight(text, terms);
    }

    /** Every tag with its note count. */
    async tags() {
        const counts = new Map();
        for (const doc of await this.load()) for (const tag of doc.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }

    /** Notes that link to `path` (backlinks), using a resolver from links.js. */
    async backlinks(path, links, outgoing) {
        const docs = await this.load();
        const hits = [];
        for (const doc of docs) {
            if (doc.path === path) continue;
            const found = outgoing(doc.body).some(
                ({ kind, target }) =>
                    (kind === 'wiki'
                        ? links.resolveWikilink(target, doc.path)
                        : links.resolveHref(target, doc.path)) === path,
            );
            if (found) hits.push({ path: doc.path, name: doc.name });
        }
        return hits.sort((a, b) => a.name.localeCompare(b.name));
    }
}
