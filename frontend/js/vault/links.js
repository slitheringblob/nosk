// Resolving links the way Obsidian does: [[Name]] finds a note by file name anywhere in the
// vault (case-insensitive), [[Folder/Name]] matches the end of a path, and ordinary markdown
// links are relative to the note they're in. Ties go to the closest file, then the shortest path.

const dirOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const baseOf = (path) => path.slice(path.lastIndexOf('/') + 1);
const stripMd = (name) => name.replace(/\.md$/i, '');

/** Display name of a file: notes without ".md", everything else with its extension. */
export const displayName = (path) => stripMd(baseOf(path));

/** Split "Note#Heading|Alias" into its parts. */
export function parseLinkTarget(raw) {
    let target = String(raw ?? '');
    let alias = null;
    const bar = target.indexOf('|');
    if (bar >= 0) {
        alias = target.slice(bar + 1).trim();
        target = target.slice(0, bar);
    }
    let fragment = null;
    const hash = target.indexOf('#');
    if (hash >= 0) {
        fragment = target.slice(hash + 1).trim();
        target = target.slice(0, hash);
    }
    return { target: target.trim(), fragment, alias };
}

function normalize(path) {
    const parts = [];
    for (const part of path.split('/')) {
        if (!part || part === '.') continue;
        if (part === '..') parts.pop();
        else parts.push(part);
    }
    return parts.join('/');
}

function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export class LinkIndex {
    constructor(paths = []) {
        this.update(paths);
    }

    update(paths) {
        this.paths = [...paths];
        this.exact = new Map();
        this.byName = new Map();
        for (const path of this.paths) {
            this.exact.set(path.toLowerCase(), path);
            const base = baseOf(path).toLowerCase();
            for (const key of new Set([base, stripMd(base)])) {
                if (!this.byName.has(key)) this.byName.set(key, []);
                this.byName.get(key).push(path);
            }
        }
    }

    pick(candidates, fromPath) {
        if (!candidates?.length) return null;
        if (candidates.length === 1) return candidates[0];
        const here = dirOf(fromPath || '');
        return [...candidates].sort((a, b) => {
            const near = Number(dirOf(b) === here) - Number(dirOf(a) === here);
            return near || a.split('/').length - b.split('/').length || a.length - b.length;
        })[0];
    }

    lookup(path) {
        const key = path.toLowerCase();
        return this.exact.get(key) || this.exact.get(`${key}.md`) || null;
    }

    /** Wikilink target ([[...]], without #fragment or |alias) to a vault path, or null. */
    resolveWikilink(target, fromPath) {
        const name = target.trim().replace(/^\/+/, '');
        if (!name) return fromPath || null;
        if (!name.includes('/')) return this.pick(this.byName.get(name.toLowerCase()), fromPath);
        const direct = this.lookup(normalize(name));
        if (direct) return direct;
        const suffix = `/${name.toLowerCase()}`;
        return this.pick(
            this.paths.filter((p) => {
                const lower = p.toLowerCase();
                return lower.endsWith(suffix) || lower.endsWith(`${suffix}.md`);
            }),
            fromPath,
        );
    }

    /** Markdown link href ([text](href)) to a vault path, or null for external links. */
    resolveHref(href, fromPath) {
        if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) return null;
        const path = safeDecode(href.split('#')[0]);
        if (!path) return null;
        if (path.startsWith('/')) return this.lookup(normalize(path));
        const relative = normalize(`${dirOf(fromPath || '')}/${path}`);
        return this.lookup(relative) || this.lookup(normalize(path)) || this.resolveWikilink(path, fromPath);
    }
}

/** Every link target a note mentions: [[wikilinks]], ![[embeds]] and relative markdown links. */
export function outgoingLinks(text) {
    const targets = [];
    const source = String(text ?? '').replace(/```[\s\S]*?```/g, '');
    for (const match of source.matchAll(/!?\[\[([^\]\n]+)\]\]/g)) {
        targets.push({ kind: 'wiki', target: parseLinkTarget(match[1]).target });
    }
    for (const match of source.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
        targets.push({ kind: 'href', target: match[1] });
    }
    return targets;
}
