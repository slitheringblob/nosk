// Folder tree of the vault for the sidebar: folders first, then files, sorted like Obsidian.
// Typing in the filter box switches to a flat list of matching files.
import { el } from '../utils.js';
import { displayName } from './links.js';
import { noteHref } from './render.js';

const OPEN_KEY = 'nosk.vault.open';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const KIND_ICONS = { note: '•', image: '▣', pdf: '▤', text: '≡', config: '⚙', file: '◇' };

export function buildTree(files) {
    const root = { name: '', path: '', folders: new Map(), files: [] };
    for (const file of files) {
        const parts = file.path.split('/');
        let node = root;
        for (const [index, part] of parts.slice(0, -1).entries()) {
            if (!node.folders.has(part)) {
                node.folders.set(part, {
                    name: part,
                    path: parts.slice(0, index + 1).join('/'),
                    folders: new Map(),
                    files: [],
                });
            }
            node = node.folders.get(part);
        }
        node.files.push(file);
    }
    return root;
}

const countFiles = (node) => node.files.length + [...node.folders.values()].reduce((n, f) => n + countFiles(f), 0);

function readOpen() {
    try {
        return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'));
    } catch {
        return new Set();
    }
}

export class VaultTree {
    constructor({ list, filterInput }) {
        this.list = list;
        this.filterInput = filterInput;
        this.files = [];
        this.root = buildTree([]);
        this.activePath = null;
        this.open = readOpen();
        this.filterInput?.addEventListener('input', () => this.render());
    }

    setFiles(files) {
        this.files = files.filter((f) => f.kind !== 'config');
        this.root = buildTree(this.files);
        this.render();
    }

    /** Highlight a file and unfold the folders above it. */
    setActive(path) {
        this.activePath = path;
        if (path) {
            const parts = path.split('/');
            for (let i = 1; i < parts.length; i += 1) this.open.add(parts.slice(0, i).join('/'));
            this.saveOpen();
        }
        this.render();
        this.list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
    }

    saveOpen() {
        try {
            localStorage.setItem(OPEN_KEY, JSON.stringify([...this.open]));
        } catch {
            // Folder state just won't be remembered.
        }
    }

    toggle(path) {
        if (this.open.has(path)) this.open.delete(path);
        else this.open.add(path);
        this.saveOpen();
        this.render();
    }

    collapseAll() {
        this.open.clear();
        this.saveOpen();
        this.render();
    }

    fileRow(file, depth, { showFolder = false } = {}) {
        const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
        const name = file.kind === 'note' ? displayName(file.path) : file.path.slice(file.path.lastIndexOf('/') + 1);
        return el(
            'a',
            {
                className: `nav-page tree-file tree-file--${file.kind}${file.path === this.activePath ? ' is-active' : ''}${file.dirty ? ' is-dirty' : ''}`,
                href: noteHref(file.path),
                title: file.path,
                dataset: { path: file.path },
                style: `--depth: ${depth}`,
            },
            el('span', { className: 'nav-page__icon' }, KIND_ICONS[file.kind] || '·'),
            el('span', { className: 'nav-page__title' }, name),
            showFolder && folder ? el('span', { className: 'tree-file__folder' }, folder) : null,
        );
    }

    folderRows(node, depth) {
        const rows = [];
        const folders = [...node.folders.values()].sort((a, b) => collator.compare(a.name, b.name));
        for (const folder of folders) {
            const open = this.open.has(folder.path);
            const button = el(
                'button',
                {
                    type: 'button',
                    className: 'tree-folder',
                    ariaExpanded: String(open),
                    title: folder.path,
                    dataset: { folder: folder.path },
                    style: `--depth: ${depth}`,
                },
                el('span', { className: 'tree-folder__chevron', ariaHidden: 'true' }, open ? '▾' : '▸'),
                el('span', { className: 'tree-folder__name' }, folder.name),
                el('span', { className: 'nav-section__count' }, String(countFiles(folder))),
            );
            button.addEventListener('click', () => this.toggle(folder.path));
            rows.push(button);
            if (open) rows.push(...this.folderRows(folder, depth + 1));
        }
        const files = [...node.files].sort((a, b) => collator.compare(displayName(a.path), displayName(b.path)));
        rows.push(...files.map((file) => this.fileRow(file, depth)));
        return rows;
    }

    render() {
        const query = (this.filterInput?.value || '').trim().toLowerCase();
        if (!this.files.length) {
            this.list.replaceChildren(el('div', { className: 'nav-empty' }, 'Nothing synced yet'));
            return;
        }
        if (!query) {
            this.list.replaceChildren(...this.folderRows(this.root, 0));
            return;
        }
        const matches = this.files
            .map((file) => {
                const name = displayName(file.path).toLowerCase();
                const at = name.indexOf(query);
                const inPath = file.path.toLowerCase().includes(query);
                return { file, score: at === 0 ? 0 : at > 0 ? 1 : inPath ? 2 : -1 };
            })
            .filter((m) => m.score >= 0)
            .sort((a, b) => a.score - b.score || collator.compare(a.file.path, b.file.path))
            .slice(0, 200);
        this.list.replaceChildren(
            ...(matches.length
                ? matches.map((m) => this.fileRow(m.file, 0, { showFolder: true }))
                : [el('div', { className: 'nav-empty' }, 'No matches')]),
        );
    }
}
