// Folder tree of the vault for the sidebar: folders first, then files, sorted like Obsidian.
// Typing in the filter box switches to a flat list of matching files. Files and folders can be
// dragged onto a folder (or onto a file, meaning its folder, or empty space, meaning the root);
// `onMove(item, folder)` and `onMenu(item, row)` get { path } for a file or { folder }.
import { el } from '../utils.js';
import { isExcalidrawPath } from './excalidraw.js';
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

const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');
const EXPAND_DELAY_MS = 700;

/** Can `item` ({ path } or { folder }) be dropped into `target`? Not where it already is. */
export function canDrop(item, target) {
    if (!item || target == null) return false;
    if (item.path) return parentOf(item.path) !== target;
    return target !== parentOf(item.folder) && target !== item.folder && !target.startsWith(`${item.folder}/`);
}

export class VaultTree {
    constructor({ list, filterInput, onMove = null, onMenu = null }) {
        this.list = list;
        this.filterInput = filterInput;
        this.onMove = onMove;
        this.onMenu = onMenu;
        this.files = [];
        this.root = buildTree([]);
        this.activePath = null;
        this.open = readOpen();
        this.dragging = null;
        this.filterInput?.addEventListener('input', () => this.render());
        this.bindDrag();
        this.list.addEventListener('contextmenu', (event) => {
            const row = event.target.closest('.tree-file, .tree-folder');
            if (!row || !this.onMenu) return;
            event.preventDefault();
            this.onMenu(this.itemOf(row), row);
        });
    }

    itemOf(row) {
        return row.dataset.folder != null ? { folder: row.dataset.folder } : { path: row.dataset.path };
    }

    /** The folder a drop at this element means: a folder row, a file's folder, or the root. */
    dropTarget(element) {
        if (this.filtering) return null;
        const row = element.closest?.('.tree-file, .tree-folder');
        if (!row) return '';
        return row.dataset.folder ?? parentOf(row.dataset.path);
    }

    bindDrag() {
        const clear = () => {
            this.list.querySelectorAll('.is-drop-target').forEach((row) => row.classList.remove('is-drop-target'));
            this.list.classList.remove('is-drop-root');
        };
        const stop = () => {
            clearTimeout(this.expandTimer);
            this.expandTimer = null;
            this.expandFolder = null;
            this.dragging = null;
            clear();
            this.list.querySelector('.is-dragging')?.classList.remove('is-dragging');
        };
        this.list.addEventListener('dragstart', (event) => {
            const row = event.target.closest?.('.tree-file, .tree-folder');
            if (!row || !this.onMove || this.filtering) return;
            this.dragging = this.itemOf(row);
            row.classList.add('is-dragging');
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', this.dragging.path || this.dragging.folder);
        });
        this.list.addEventListener('dragover', (event) => {
            if (!this.dragging) return;
            const target = this.dropTarget(event.target);
            clear();
            if (!canDrop(this.dragging, target)) {
                event.dataTransfer.dropEffect = 'none';
                return;
            }
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            if (target === '') this.list.classList.add('is-drop-root');
            else
                this.list
                    .querySelector(`.tree-folder[data-folder="${CSS.escape(target)}"]`)
                    ?.classList.add('is-drop-target');
            // Hovering a closed folder opens it, so you can drop deeper.
            const folderRow = event.target.closest?.('.tree-folder');
            const hover = folderRow && !this.open.has(folderRow.dataset.folder) ? folderRow.dataset.folder : null;
            if (hover !== this.expandFolder) {
                clearTimeout(this.expandTimer);
                this.expandFolder = hover;
                this.expandTimer = hover
                    ? setTimeout(() => {
                          if (this.dragging && this.expandFolder === hover) {
                              this.open.add(hover);
                              this.saveOpen();
                              this.render();
                          }
                      }, EXPAND_DELAY_MS)
                    : null;
            }
        });
        this.list.addEventListener('dragleave', (event) => {
            if (!this.list.contains(event.relatedTarget)) clear();
        });
        this.list.addEventListener('drop', (event) => {
            if (!this.dragging) return;
            event.preventDefault();
            const item = this.dragging;
            const target = this.dropTarget(event.target);
            stop();
            if (canDrop(item, target)) this.onMove?.(item, target);
        });
        // The dragged row may have been re-rendered away, so listen on the document.
        document.addEventListener('dragend', stop);
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

    /** Unfold a folder and everything above it (folder view). */
    reveal(folder) {
        this.activePath = null;
        const parts = folder.split('/');
        for (let i = 1; i <= parts.length; i += 1) this.open.add(parts.slice(0, i).join('/'));
        this.saveOpen();
        this.render();
        this.list.querySelector(`[data-folder="${CSS.escape(folder)}"]`)?.scrollIntoView({ block: 'nearest' });
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
        const excalidraw = isExcalidrawPath(file.path);
        const name = excalidraw
            ? displayName(file.path).replace(/\.excalidraw$/i, '')
            : file.kind === 'note'
              ? displayName(file.path)
              : file.path.slice(file.path.lastIndexOf('/') + 1);
        const icon = excalidraw ? '✎' : KIND_ICONS[file.kind] || '·';
        return el(
            'a',
            {
                className: `nav-page tree-file tree-file--${excalidraw ? 'excalidraw' : file.kind}${file.path === this.activePath ? ' is-active' : ''}${file.dirty ? ' is-dirty' : ''}`,
                href: noteHref(file.path),
                title: file.path,
                draggable: 'true',
                dataset: { path: file.path },
                style: `--depth: ${depth}`,
            },
            el('span', { className: 'nav-page__icon' }, icon),
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
                    draggable: 'true',
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
        this.filtering = Boolean(query);
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
