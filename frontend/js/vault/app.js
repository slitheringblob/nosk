// nosk, git-backed: the app shell. Connects to a vault repo, keeps a copy on the device, renders
// notes, and edits them: changes are saved on the device at once and committed to GitHub shortly
// after (see sync.js). Design: project_plan/GIT_BACKED_PLAN.md.
import { SidebarLayout } from '../sidebar-layout.js';
import { PALETTES, theme } from '../theme.js';
import { confirmDialog, modal, promptDialog, showMenu, toast } from '../ui.js';
import { el, formatRelativeTime, isEditableTarget, modKey } from '../utils.js';
import { applyTemplate, dailyPath, detectDaily } from './daily.js';
import { NoteEditor, toggleTaskLine } from './editor.js';
import { GitHub, GitHubError, OfflineError } from './github.js';
import { LinkIndex, displayName, outgoingLinks, parseLinkTarget } from './links.js';
import { Palette } from './palette.js';
import { hydrate, noteHref, noteTags, renderNote } from './render.js';
import { VaultSearch } from './search.js';
import { VaultStore } from './store.js';
import { VaultSync, kindOf } from './sync.js';
import { VaultTree } from './tree.js';

const $ = (id) => document.getElementById(id);
const RECENT_KEY = 'nosk.vault.recent';
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const KIND_LABELS = { canvas: 'Obsidian canvas', excalidraw: 'Excalidraw drawing', base: 'Obsidian base' };
// Characters Obsidian won't put in a file name (plus ones that break [[links]]).
const BAD_NAME = /[*"\\<>:|?#^[\]]/;
const TASK_LINE = /^[\s>]*(?:[-*+]|\d+[.)])\s+\[[^\]]\]/;

/** Line numbers of task items ("- [ ] ...", also inside quotes/callouts), skipping code blocks. */
export function taskLines(text) {
    const lines = [];
    let fence = null;
    String(text)
        .split('\n')
        .forEach((line, index) => {
            const marker = line.match(/^\s*(```|~~~)/);
            if (marker) {
                if (!fence) fence = marker[1];
                else if (marker[1] === fence) fence = null;
                return;
            }
            if (!fence && TASK_LINE.test(line)) lines.push(index);
        });
    return lines;
}

/** Point [[links]] at `to` in a note, for links that resolved to `from` before a rename. */
export function rewriteLinks(text, notePath, { before, after, from, to }) {
    const bare = displayName(to);
    const target = after.resolveWikilink(bare, notePath) === to ? bare : to.replace(/\.md$/i, '');
    let changed = false;
    const next = text.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (match, bang, inner) => {
        const { target: old, fragment, alias } = parseLinkTarget(inner);
        if (!old || before.resolveWikilink(old, notePath) !== from) return match;
        changed = true;
        return `${bang}[[${target}${fragment ? `#${fragment}` : ''}${alias ? `|${alias}` : ''}]]`;
    });
    return changed ? next : null;
}

/** Turn what the user typed into a vault path for a note, or throw with a readable reason. */
export function notePathFrom(input) {
    const cleaned = String(input || '')
        .trim()
        .replace(/\.md$/i, '')
        .split('/')
        .map((part) => part.trim())
        .filter(Boolean);
    if (!cleaned.length) throw new Error('Give the note a name.');
    const bad = cleaned.find((part) => BAD_NAME.test(part) || part.startsWith('.'));
    if (bad) throw new Error(`"${bad}" can't be used: names can't start with "." or contain * " \\ < > : | ? # ^ [ ]`);
    return `${cleaned.join('/')}.md`;
}

/** "owner/repo", a github.com URL or an ssh remote → { owner, repo }. */
export function parseRepo(input) {
    const value = String(input || '')
        .trim()
        .replace(/\.git$/, '')
        .replace(/\/+$/, '');
    const match =
        value.match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i) || value.match(/^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/);
    return match ? { owner: match[1], repo: match[2] } : null;
}

/** #/ → home, #/n/<path>?h=<fragment> → a file, #/f/<folder> → a folder, #/tag/<tag> → notes with that tag. */
export function parseRoute(hash) {
    const route = String(hash || '').replace(/^#/, '');
    const note = route.match(/^\/n\/([^?]+)(?:\?h=(.*))?$/);
    if (note) {
        const decode = (v) => {
            try {
                return decodeURIComponent(v);
            } catch {
                return v;
            }
        };
        return { name: 'note', path: decode(note[1]), fragment: note[2] ? decode(note[2]) : null };
    }
    const folder = route.match(/^\/f\/(.+)$/);
    if (folder) return { name: 'folder', path: safeDecode(folder[1]) };
    const tag = route.match(/^\/tag\/(.+)$/);
    if (tag) return { name: 'tag', tag: safeDecode(tag[1]) };
    return { name: 'home' };
}

function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

export const folderHref = (folder) => (folder ? `#/f/${encodeURIComponent(folder)}` : '#/');

function readRecent() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    } catch {
        return [];
    }
}

function pushRecent(path) {
    try {
        const recent = [path, ...readRecent().filter((p) => p !== path)].slice(0, 12);
        localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch {
        // Recent list just won't update.
    }
}

class VaultApp {
    constructor() {
        this.store = new VaultStore();
        this.palette = new Palette();
        this.links = new LinkIndex();
        this.files = [];
        this.renderSeq = 0;
        this.current = null;
    }

    async start() {
        theme.watch();
        if ('serviceWorker' in navigator && location.protocol !== 'file:') {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
        this.connection = await this.store.getMeta('connection');
        if (this.connection) await this.boot();
        else this.showSetup();
    }

    // ------------------------------------------------------------ connecting

    showSetup({ reason = '' } = {}) {
        $('app').hidden = true;
        const setup = $('setup');
        setup.hidden = false;
        const previous = this.connection || {};
        const error = el('p', { className: 'form-error', role: 'alert' }, reason);
        const repoInput = el('input', {
            name: 'repo',
            required: true,
            placeholder: 'owner/vault-repo',
            value: previous.owner ? `${previous.owner}/${previous.repo}` : '',
            autocomplete: 'off',
            spellcheck: false,
        });
        const branchInput = el('input', {
            name: 'branch',
            placeholder: 'default branch',
            value: previous.branch || '',
            autocomplete: 'off',
            spellcheck: false,
        });
        const tokenInput = el('input', {
            name: 'token',
            required: true,
            type: 'password',
            placeholder: 'github_pat_…',
            autocomplete: 'off',
            spellcheck: false,
        });
        const submit = el('button', { type: 'submit', className: 'btn btn-primary btn-block' }, 'connect vault');
        const form = el(
            'form',
            { className: 'form' },
            el('label', { className: 'field' }, el('span', { className: 'eyebrow' }, 'vault repo'), repoInput),
            el('label', { className: 'field' }, el('span', { className: 'eyebrow' }, 'branch'), branchInput),
            el('label', { className: 'field' }, el('span', { className: 'eyebrow' }, 'access token'), tokenInput),
            error,
            submit,
        );
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            error.textContent = '';
            const repo = parseRepo(repoInput.value);
            if (!repo) {
                error.textContent = 'Use the form owner/repo, or paste the repo URL.';
                return;
            }
            submit.disabled = true;
            submit.textContent = 'checking…';
            try {
                const connection = await this.verify({
                    ...repo,
                    branch: branchInput.value.trim(),
                    token: tokenInput.value.trim(),
                });
                if (previous.owner && (previous.owner !== connection.owner || previous.repo !== connection.repo)) {
                    await this.store.clear();
                }
                await this.store.setMeta('connection', connection);
                this.connection = connection;
                setup.hidden = true;
                await this.boot();
            } catch (failure) {
                error.textContent = failure.message;
            } finally {
                submit.disabled = false;
                submit.textContent = 'connect vault';
            }
        });
        setup.replaceChildren(
            el(
                'div',
                { className: 'setup__card' },
                el(
                    'div',
                    { className: 'brand brand--large' },
                    'nosk',
                    el('span', { className: 'cursor', ariaHidden: 'true' }),
                ),
                el(
                    'div',
                    { className: 'eyebrow' },
                    '~/connect ',
                    el('span', { className: 'accent' }, '●'),
                    ' your vault on github',
                ),
                el(
                    'p',
                    { className: 'setup__lead' },
                    'nosk reads your Obsidian vault straight from its GitHub repo and keeps a copy on this device, so it opens instantly and works offline.',
                ),
                form,
                el(
                    'ol',
                    { className: 'setup__steps' },
                    el(
                        'li',
                        {},
                        'Create a ',
                        el(
                            'a',
                            { href: TOKEN_URL, target: '_blank', rel: 'noopener noreferrer' },
                            'fine-grained token',
                        ),
                        ' on GitHub.',
                    ),
                    el('li', {}, 'Repository access: ', el('b', {}, 'only select repositories'), ' → your vault.'),
                    el(
                        'li',
                        {},
                        'Permissions: ',
                        el('b', {}, 'Contents → Read and write'),
                        ' (read-only works for now).',
                    ),
                    el('li', {}, 'The token stays in this browser and is only ever sent to api.github.com.'),
                ),
            ),
        );
        (previous.owner ? tokenInput : repoInput).focus();
    }

    /** Check the token can read the repo and branch; fills in the default branch. */
    async verify({ owner, repo, branch, token }) {
        if (!token) throw new Error('Paste a GitHub access token.');
        const github = new GitHub({ token, owner, repo });
        let info;
        try {
            info = await github.getRepo();
        } catch (error) {
            if (error instanceof OfflineError) throw new Error("Can't reach GitHub. Check your connection.");
            if (error.status === 401) throw new Error('GitHub rejected the token (expired or mistyped?).');
            if (error.status === 404) {
                throw new Error(
                    `This token can't see ${owner}/${repo}. On GitHub, edit the token: Repository access → Only select repositories → ${repo}, and Contents → Read and write.`,
                );
            }
            throw error;
        }
        const chosen = branch || info.default_branch;
        try {
            await github.headCommit(chosen);
        } catch (error) {
            if (error.status === 404 || error.status === 409)
                throw new Error(`Branch "${chosen}" not found (is the repo empty?).`);
            throw error;
        }
        return { owner: info.owner.login, repo: info.name, branch: chosen, token, private: info.private };
    }

    // ------------------------------------------------------------ boot

    async boot() {
        $('app').hidden = false;
        $('setup').hidden = true;
        const { owner, repo, branch, token } = this.connection;
        this.github = new GitHub({ token, owner, repo });
        this.sync?.stop();
        this.sync = new VaultSync({ store: this.store, github: this.github, branch });
        this.search = new VaultSearch({ allFiles: () => this.sync.files() });
        this.sync.beforeSync = () => this.editor?.flush();
        $('vault-name').textContent = `${owner}/${repo}`;
        $('vault-name').title = `${owner}/${repo} · ${branch}`;
        if (!this.bound) this.bindUI();
        await this.reloadFiles();
        this.sync.on('state', ({ state, error }) => this.showSyncState(state, error));
        this.sync.on('progress', ({ done, total }) => this.showProgress(done, total));
        this.sync.on('changed', (result) => this.onChanged(result));
        this.sync.on('local', () => this.onLocal());
        this.sync.on('pushed', () => this.reloadFiles());
        this.sync.on('conflict', ({ conflicts }) => this.onConflict(conflicts));
        await this.route();
        this.sync.start().catch((error) => this.onSyncError(error));
    }

    /** Sync now (pull, then push edits); errors are shown, not thrown. */
    syncNow() {
        return this.sync.sync().catch((error) => this.onSyncError(error));
    }

    bindUI() {
        this.bound = true;
        this.tree = new VaultTree({ list: $('tree'), filterInput: $('tree-filter') });
        this.layout = new SidebarLayout({ app: $('app'), resizer: $('sidebar-resizer') });
        $('toggle-sidebar').addEventListener('click', () => this.layout.toggle());
        $('close-sidebar').addEventListener('click', () => this.layout.toggle());
        $('scrim').addEventListener('click', () => $('app').classList.remove('sidebar-open'));
        $('open-palette').addEventListener('click', () => this.openSwitcher());
        $('open-search').addEventListener('click', () => this.openSearch());
        $('open-settings').addEventListener('click', () => this.openSettings());
        $('collapse-tree').addEventListener('click', () => this.tree.collapseAll());
        $('new-note').addEventListener('click', () => this.newNote());
        $('nav-back').addEventListener('click', () => history.back());
        $('nav-forward').addEventListener('click', () => history.forward());
        $('open-today').addEventListener('click', () => this.openToday());
        $('sync-status').addEventListener('click', () => this.syncNow());
        window.addEventListener('hashchange', () => {
            $('app').classList.remove('sidebar-open');
            this.route();
        });
        document.addEventListener('keydown', (event) => {
            const key = event.key.toLowerCase();
            if (modKey(event) && !event.shiftKey && (key === 'k' || key === 'o')) {
                event.preventDefault();
                this.openSwitcher();
            } else if (modKey(event) && event.shiftKey && key === 'f') {
                event.preventDefault();
                this.openSearch();
            } else if (modKey(event) && event.key === '\\') {
                event.preventDefault();
                this.layout.toggle();
            } else if (modKey(event) && key === 'e' && this.current?.kind === 'note') {
                event.preventDefault();
                this.toggleEdit();
            } else if (modKey(event) && key === 's') {
                event.preventDefault();
                this.editor?.flush();
                this.syncNow();
            } else if (event.altKey && key === 'n') {
                event.preventDefault();
                this.newNote();
            } else if (event.altKey && key === 'd') {
                event.preventDefault();
                this.openToday();
            } else if (event.key === '/' && !isEditableTarget(event.target) && !this.palette.isOpen) {
                event.preventDefault();
                this.openSearch();
            }
        });
    }

    async reloadFiles() {
        this.files = await this.sync.files();
        this.pendingKey = this.files
            .filter((f) => f.dirty)
            .map((f) => f.path)
            .join('|');
        this.links.update(this.files.map((f) => f.path));
        this.search.invalidate();
        this.tree.setFiles(this.files);
        if (this.current?.path) this.tree.setActive(this.current.path);
        this.showDirtyMarker();
    }

    /** Keep the "not synced yet" label under the title in step with the open note. */
    showDirtyMarker() {
        const row = document.querySelector('#view .page-actions');
        if (!row || !this.current?.path) return;
        const dirty = this.files.some((f) => f.path === this.current.path && f.dirty);
        const marker = row.querySelector('.unsynced');
        if (dirty && !marker) row.insertBefore(this.unsyncedLabel(), row.querySelector('.icon-btn'));
        else if (!dirty && marker) marker.remove();
    }

    unsyncedLabel() {
        return el(
            'span',
            { className: 'unsynced', title: 'Saved on this device; not on GitHub yet' },
            '● not synced yet',
        );
    }

    async onChanged({ changed, removed, merged = [] }) {
        await this.reloadFiles();
        const touched = new Set([...changed, ...removed, ...merged]);
        const route = parseRoute(location.hash);
        // While editing, bring merged/remote changes into the editor instead of re-rendering.
        if (this.editor && route.name === 'note' && route.path === this.editorPath) {
            if (touched.has(route.path)) {
                const text = await this.sync.text(route.path);
                if (text != null && !this.editor.dirty) this.editor.setValue(text);
            }
            return;
        }
        // Re-render what's on screen if it changed, or if the first download just finished.
        if (route.name !== 'note' || touched.has(route.path) || !this.current?.sha)
            await this.route({ keepScroll: true });
    }

    /** A local edit was saved: refresh the tree only when the set of edited files changed. */
    async onLocal() {
        const pending = (await this.store.allPending()).map((e) => `${e.path}${e.text === null ? ':x' : ''}`);
        const files = await this.sync.files();
        const key = files
            .filter((f) => f.dirty)
            .map((f) => f.path)
            .join('|');
        const shape = `${key}#${files.length}#${pending.join('|')}`;
        if (shape === this.localShape) {
            this.showDirtyMarker();
            return;
        }
        this.localShape = shape;
        await this.reloadFiles();
    }

    onConflict(conflicts) {
        for (const conflict of conflicts) {
            const name = displayName(conflict.path);
            if (conflict.kept === 'remote') {
                toast(`"${name}" was changed on another device, so it wasn't deleted.`, {
                    type: 'warning',
                    timeout: 8000,
                });
                continue;
            }
            toast(
                `"${name}" was also changed elsewhere. Kept your version; the other one is saved as "${displayName(conflict.copy)}".`,
                {
                    type: 'warning',
                    timeout: 12_000,
                    action: { label: 'open it', onSelect: () => (location.hash = noteHref(conflict.copy)) },
                },
            );
        }
    }

    onSyncError(error) {
        if (error instanceof OfflineError) return;
        if (error instanceof GitHubError && this.sync.state === 'readonly') {
            toast("Your edits are saved on this device, but the token can't write to the repo.", {
                type: 'error',
                timeout: 12_000,
                action: { label: 'change token', onSelect: () => this.reconnect() },
            });
            return;
        }
        if (error instanceof GitHubError && error.status === 401) {
            toast('GitHub no longer accepts the saved token.', {
                type: 'error',
                timeout: 10_000,
                action: { label: 'reconnect', onSelect: () => this.reconnect() },
            });
        } else {
            toast(`Sync failed: ${error.message}`, { type: 'error', timeout: 6000 });
        }
    }

    reconnect() {
        this.sync?.stop();
        this.showSetup({ reason: 'Paste a new token to keep syncing. Your downloaded notes stay on this device.' });
    }

    showSyncState(state, error) {
        const pill = $('sync-status');
        const pending = this.sync.pendingCount;
        pill.dataset.state = state === 'auth' || state === 'readonly' ? 'error' : state;
        const label = pill.querySelector('.sync-status__label');
        const labels = {
            idle: 'synced',
            pending: `${pending} to sync`,
            syncing: 'syncing',
            offline: pending ? `offline · ${pending}` : 'offline',
            auth: 'token?',
            readonly: 'read-only',
            error: 'error',
        };
        label.textContent = labels[state] || state;
        const saved = pending ? `${pending} change${pending === 1 ? '' : 's'} saved on this device. ` : '';
        pill.title =
            state === 'error' || state === 'auth' || state === 'readonly'
                ? `${saved}${error?.message || 'Sync failed'}`
                : state === 'pending'
                  ? `${saved}Committing to GitHub shortly. Click to sync now.`
                  : state === 'offline'
                    ? `${saved}Offline; will sync when you're back online.`
                    : this.sync.lastPull
                      ? `Checked GitHub ${formatRelativeTime(this.sync.lastPull)}. Click to sync now.`
                      : 'Click to sync now';
    }

    showProgress(done, total) {
        if (total > 3) $('sync-status').querySelector('.sync-status__label').textContent = `${done}/${total}`;
        const bar = $('first-sync');
        if (bar) {
            bar.querySelector('[data-done]').textContent = String(done);
            bar.querySelector('[data-total]').textContent = String(total);
            bar.querySelector('.progress__fill').style.width = `${total ? (done / total) * 100 : 0}%`;
        }
    }

    // ------------------------------------------------------------ routing

    async route({ keepScroll = false } = {}) {
        const route = parseRoute(location.hash);
        const scroll = window.scrollY;
        if (route.name === 'note') await this.showFile(route.path, route.fragment);
        else if (route.name === 'folder') await this.showFolder(route.path);
        else if (route.name === 'tag') await this.showTag(route.tag);
        else await this.showHome();
        if (keepScroll) window.scrollTo(0, scroll);
    }

    beginView(title) {
        this.renderSeq += 1;
        if (this.editor) {
            this.editor.flush();
            this.editor = null;
            this.editorPath = null;
        }
        document.title = title ? `${title} · nosk` : 'nosk';
        const view = $('view');
        view.replaceChildren();
        window.scrollTo(0, 0);
        return { view, seq: this.renderSeq };
    }

    async showHome() {
        this.current = null;
        this.tree.setActive(null);
        const { view } = this.beginView('');
        this.setCrumbs('');
        const notes = this.files.filter((f) => f.kind === 'note');
        const { owner, repo, branch } = this.connection;
        const recent = readRecent().filter((path) => this.files.some((f) => f.path === path));
        const pulledAt = await this.store.getMeta('pulledAt');
        const home = el(
            'section',
            { className: 'welcome' },
            el(
                'div',
                { className: 'eyebrow' },
                `~/${owner}/${repo} `,
                el('span', { className: 'accent' }, '●'),
                ` ${branch}`,
            ),
            el(
                'h1',
                { className: 'hero-title hero-title--compact' },
                'Your vault,',
                el('br'),
                el('span', { className: 'hl' }, 'everywhere.'),
                el('span', { className: 'hero-cursor', ariaHidden: 'true' }),
            ),
            el(
                'p',
                { className: 'hero-sub' },
                notes.length
                    ? `${notes.length} notes and ${this.files.length - notes.length} other files on this device${pulledAt ? `, synced ${formatRelativeTime(pulledAt)}` : ''}.`
                    : 'Downloading your vault to this device…',
            ),
        );
        if (!notes.length) {
            home.append(
                el(
                    'div',
                    { id: 'first-sync', className: 'progress' },
                    el('div', { className: 'progress__track' }, el('div', { className: 'progress__fill' })),
                    el(
                        'div',
                        { className: 'eyebrow' },
                        el('span', { dataset: { done: '' } }, '0'),
                        ' / ',
                        el('span', { dataset: { total: '' } }, '…'),
                        ' files',
                    ),
                ),
            );
            view.append(home);
            return;
        }
        home.append(
            el(
                'div',
                { className: 'hero-actions' },
                el(
                    'button',
                    { type: 'button', className: 'btn btn-primary', onclick: () => this.openToday() },
                    "today's note",
                ),
                el(
                    'button',
                    { type: 'button', className: 'btn btn-ghost', onclick: () => this.newNote() },
                    '+ new note',
                ),
                el(
                    'button',
                    { type: 'button', className: 'btn btn-ghost', onclick: () => this.openSwitcher() },
                    'open a note ',
                    el('kbd', { dataset: { kbdMod: '' } }, '⌘K'),
                ),
                el(
                    'button',
                    { type: 'button', className: 'btn btn-ghost', onclick: () => this.openSearch() },
                    'search ',
                    el('kbd', {}, '/'),
                ),
            ),
        );
        if (recent.length) {
            home.append(
                el('div', { className: 'section-label eyebrow' }, '01/recent'),
                el(
                    'div',
                    { className: 'home-list' },
                    ...recent.map((path) =>
                        el(
                            'a',
                            { className: 'home-list__item', href: noteHref(path) },
                            el('span', {}, displayName(path)),
                            el(
                                'span',
                                { className: 'muted' },
                                path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
                            ),
                        ),
                    ),
                ),
            );
        }
        const tags = (await this.search.tags()).slice(0, 40);
        if (tags.length) {
            home.append(
                el('div', { className: 'section-label eyebrow' }, `${recent.length ? '02' : '01'}/tags`),
                el(
                    'div',
                    { className: 'tag-cloud' },
                    ...tags.map(([tag, count]) =>
                        el(
                            'a',
                            { className: 'tag', href: `#/tag/${encodeURIComponent(tag)}` },
                            `#${tag}`,
                            el('span', { className: 'muted' }, ` ${count}`),
                        ),
                    ),
                ),
            );
        }
        view.append(home);
        this.markShortcuts(view);
    }

    async showTag(tag) {
        this.current = null;
        this.tree.setActive(null);
        const { view, seq } = this.beginView(`#${tag}`);
        this.setCrumbs('', { extra: `#${tag}` });
        const results = await this.search.fullText(`#${tag}`, 1000);
        if (seq !== this.renderSeq) return;
        view.append(
            el(
                'article',
                { className: 'editor note' },
                el(
                    'header',
                    { className: 'page-header' },
                    el('h1', { className: 'page-title' }, `#${tag}`),
                    el('div', { className: 'page-meta' }, `${results.length} notes`),
                ),
                el(
                    'div',
                    { className: 'home-list' },
                    ...results.map((r) =>
                        el(
                            'a',
                            { className: 'home-list__item', href: noteHref(r.path) },
                            el('span', {}, r.name),
                            el('span', { className: 'muted', innerHTML: r.snippet }),
                        ),
                    ),
                ),
            ),
        );
    }

    /**
     * Top bar path: vault › folder › … › current. Folders link to their folder view; the vault
     * name goes home. `path` is a file or folder path ('' for home); `extra` adds a last label.
     */
    setCrumbs(path = '', { extra = null } = {}) {
        const parts = path ? path.split('/') : [];
        const items = [{ label: this.connection.repo, href: '#/' }];
        parts.forEach((part, index) => {
            const isLast = index === parts.length - 1;
            items.push({
                label: isLast && !extra ? displayName(part) : part,
                href: folderHref(parts.slice(0, index + 1).join('/')),
            });
        });
        if (extra) items.push({ label: extra });
        const last = items.length - 1;
        $('crumbs').replaceChildren(
            ...items.flatMap((item, index) => {
                const node =
                    index === last
                        ? el(
                              'span',
                              { className: 'crumb crumb--current', title: item.label, ariaCurrent: 'page' },
                              item.label,
                          )
                        : el('a', { className: 'crumb', href: item.href, title: item.label }, item.label);
                return index ? [el('span', { className: 'crumb-sep', ariaHidden: 'true' }, '/'), node] : [node];
            }),
        );
        this.updateHistoryButtons();
    }

    updateHistoryButtons() {
        const nav = globalThis.navigation;
        $('nav-back').disabled = nav ? !nav.canGoBack : false;
        $('nav-forward').disabled = nav ? !nav.canGoForward : false;
    }

    async showFolder(folder) {
        this.current = null;
        this.tree.reveal(folder);
        const { view } = this.beginView(folder.split('/').pop());
        this.setCrumbs(folder);
        const prefix = `${folder}/`;
        const inside = this.files.filter((f) => f.path.startsWith(prefix) && f.kind !== 'config');
        const subfolders = new Map();
        const files = [];
        for (const file of inside) {
            const rest = file.path.slice(prefix.length);
            if (rest.includes('/')) {
                const name = rest.slice(0, rest.indexOf('/'));
                subfolders.set(name, (subfolders.get(name) || 0) + 1);
            } else files.push(file);
        }
        const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
        const article = el(
            'article',
            { className: 'editor note' },
            el(
                'header',
                { className: 'page-header' },
                el('h1', { className: 'page-title' }, folder.split('/').pop()),
                el('div', { className: 'page-meta' }, `${inside.length} file${inside.length === 1 ? '' : 's'}`),
            ),
        );
        if (!inside.length) {
            article.append(el('div', { className: 'notice' }, 'Nothing here.'));
        } else {
            article.append(
                el(
                    'div',
                    { className: 'home-list folder-list' },
                    ...[...subfolders]
                        .sort((a, b) => collator.compare(a[0], b[0]))
                        .map(([name, count]) =>
                            el(
                                'a',
                                { className: 'home-list__item', href: folderHref(`${folder}/${name}`) },
                                el('span', {}, el('span', { className: 'folder-list__icon' }, '▸'), name),
                                el('span', { className: 'muted' }, `${count}`),
                            ),
                        ),
                    ...files
                        .sort((a, b) => collator.compare(displayName(a.path), displayName(b.path)))
                        .map((file) =>
                            el(
                                'a',
                                { className: 'home-list__item', href: noteHref(file.path) },
                                el(
                                    'span',
                                    {},
                                    el('span', { className: 'folder-list__icon' }, file.kind === 'note' ? '•' : '◇'),
                                    file.kind === 'note' ? displayName(file.path) : file.path.slice(prefix.length),
                                ),
                                el('span', { className: 'muted' }, file.dirty ? '● not synced' : ''),
                            ),
                        ),
                ),
            );
        }
        view.append(article);
    }

    async showFile(path, fragment) {
        const [file, edit] = await Promise.all([this.store.getFile(path), this.store.getPending(path)]);
        const exists = edit ? edit.text !== null : Boolean(file);
        const kind = file?.kind || edit?.kind || kindOf(path);
        const editing = kind === 'note' && exists && this.editNext === path;
        this.editNext = null;
        this.current = { path, sha: file?.sha ?? null, kind, exists };
        this.tree.setActive(path);
        const { view, seq } = this.beginView(displayName(path));
        this.setCrumbs(path);
        const article = el('article', { className: `editor note${editing ? ' is-editing' : ''}` });
        view.append(article);
        const header = el(
            'header',
            { className: 'page-header' },
            el('h1', { className: 'page-title' }, displayName(path)),
        );
        article.append(header);
        if (!exists) {
            article.append(
                el(
                    'div',
                    { className: 'notice' },
                    this.files.length
                        ? "This file isn't in the vault (it may have been moved or deleted)."
                        : 'Still downloading the vault…',
                ),
            );
            return;
        }
        pushRecent(path);
        const actions = this.fileActions(path, kind, editing, Boolean(edit));
        if (kind === 'note') {
            const text = await this.sync.text(path).catch(() => null);
            if (seq !== this.renderSeq) return;
            if (text == null) {
                header.append(actions);
                article.append(
                    el(
                        'div',
                        { className: 'notice' },
                        "This note hasn't been downloaded yet. It will load when you're online.",
                    ),
                );
                return;
            }
            if (editing) {
                header.append(actions);
                this.openEditor(article, path, text);
                return;
            }
            const { html, data } = renderNote(text, { path, links: this.links });
            const tags = noteTags(text);
            if (tags.length) {
                header.append(
                    el(
                        'div',
                        { className: 'page-tags' },
                        ...tags.map((tag) =>
                            el('a', { className: 'tag', href: `#/tag/${encodeURIComponent(tag)}` }, `#${tag}`),
                        ),
                    ),
                );
            }
            const properties = this.propertiesTable(data, path);
            if (properties) header.append(properties);
            header.append(actions);
            const body = el('div', { className: 'note-body rendered', innerHTML: html });
            // Many notes open with "# <file name>"; the page title already says that.
            const first = body.firstElementChild;
            if (first?.tagName === 'H1' && first.textContent.trim() === displayName(path).trim()) first.remove();
            if (!text.trim())
                body.append(el('p', { className: 'muted' }, 'Empty note. Press edit (or Ctrl/⌘+E) to write.'));
            // Double-click (or double-tap) the text to start editing.
            body.addEventListener('dblclick', (event) => {
                if (!event.target.closest('a, input, summary, img')) this.toggleEdit();
            });
            article.append(body);
            await hydrate(body, { path, links: this.links, sync: this.sync });
            if (seq !== this.renderSeq) return;
            this.wireTasks(body, path, text);
            this.scrollToFragment(body, fragment);
            this.showBacklinks(article, path, seq);
            return;
        }

        header.append(actions);
        if (file && (kind === 'image' || kind === 'pdf')) {
            const holder = el(
                'div',
                { className: `file-view file-view--${kind}` },
                el('div', { className: 'muted' }, 'loading…'),
            );
            article.append(holder);
            try {
                const url = await this.sync.blobUrl(path);
                if (seq !== this.renderSeq) return;
                holder.replaceChildren(
                    kind === 'image'
                        ? el('img', { src: url, alt: displayName(path) })
                        : el('iframe', { src: url, title: displayName(path) }),
                    el(
                        'div',
                        { className: 'file-view__actions' },
                        el(
                            'a',
                            { className: 'btn btn-ghost btn-sm', href: url, download: path.split('/').pop() },
                            'download',
                        ),
                        el(
                            'a',
                            { className: 'btn btn-ghost btn-sm', href: url, target: '_blank', rel: 'noopener' },
                            'open',
                        ),
                    ),
                );
            } catch {
                holder.replaceChildren(
                    el('div', { className: 'notice' }, "Couldn't download this file. It will load when you're online."),
                );
            }
            return;
        }
        if (kind === 'text') {
            const ext = path.split('.').pop().toLowerCase();
            const text = await this.sync.text(path).catch(() => null);
            if (seq !== this.renderSeq) return;
            if (KIND_LABELS[ext]) {
                article.append(
                    el(
                        'div',
                        { className: 'notice' },
                        `${KIND_LABELS[ext]}: open it in Obsidian to see it drawn. The raw file is below.`,
                    ),
                );
            }
            article.append(el('pre', { className: 'file-source' }, el('code', {}, text ?? '')));
            return;
        }
        article.append(
            el(
                'div',
                { className: 'notice' },
                "nosk can't show this kind of file. Download it from GitHub to open it.",
            ),
        );
    }

    /** The row under a file's title: edit/done, unsynced marker and the ⋯ menu. */
    fileActions(path, kind, editing, dirty) {
        const row = el('div', { className: 'page-meta page-actions' });
        if (kind === 'note') {
            row.append(
                el(
                    'button',
                    {
                        type: 'button',
                        className: `btn btn-sm ${editing ? 'btn-primary' : 'btn-ghost'}`,
                        title: 'Ctrl/⌘+E',
                        onclick: () => this.toggleEdit(),
                    },
                    editing ? 'done' : 'edit',
                ),
            );
        }
        if (dirty) row.append(this.unsyncedLabel());
        const more = el(
            'button',
            { type: 'button', className: 'icon-btn', ariaLabel: 'More actions', title: 'More' },
            '⋯',
        );
        more.addEventListener('click', () => {
            const text = kind === 'note' || kind === 'text';
            showMenu(more, [
                { label: 'Rename or move', icon: '✎', disabled: !text, onSelect: () => this.renameFile(path) },
                {
                    label: 'View on GitHub',
                    icon: '↗',
                    disabled: !this.current?.sha,
                    onSelect: () => window.open(this.github.webUrl(path, this.connection.branch), '_blank', 'noopener'),
                },
                { separator: true },
                { label: 'Delete', icon: '×', danger: true, onSelect: () => this.deleteFile(path) },
            ]);
        });
        row.append(more);
        return row;
    }

    openEditor(article, path, text) {
        const editor = new NoteEditor({
            text,
            onChange: (value) => this.sync.saveLocal(path, value),
            suggest: (query) => this.linkSuggestions(query, path),
            onSave: () => this.syncNow(),
        });
        this.editor = editor;
        this.editorPath = path;
        article.append(editor.element);
        editor.focus(!text.trim() ? false : this.focusEnd);
        this.focusEnd = false;
    }

    toggleEdit() {
        const path = this.current?.path;
        if (!path || this.current.kind !== 'note') return;
        if (this.editor && this.editorPath === path) {
            this.editor.flush();
            this.route({ keepScroll: false });
        } else {
            this.editNext = path;
            this.route();
        }
    }

    linkSuggestions(query, fromPath) {
        const q = query.toLowerCase();
        return this.files
            .filter((f) => f.kind === 'note' && f.path !== fromPath)
            .map((f) => {
                const name = displayName(f.path);
                const lower = name.toLowerCase();
                const score = !q
                    ? 2
                    : lower.startsWith(q)
                      ? 0
                      : lower.includes(q)
                        ? 1
                        : f.path.toLowerCase().includes(q)
                          ? 2
                          : -1;
                return { f, name, score };
            })
            .filter((m) => m.score >= 0)
            .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
            .slice(0, 8)
            .map(({ f, name }) => {
                const unique = this.links.resolveWikilink(name, fromPath) === f.path;
                return {
                    label: name,
                    detail: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '',
                    insert: unique ? name : f.path.replace(/\.md$/i, ''),
                };
            });
    }

    /** Make checkboxes in reading view tickable; each one maps to a task line in the source. */
    wireTasks(body, path, text) {
        const items = [...body.querySelectorAll('li.task')].filter((li) => !li.closest('.note-embed'));
        const lines = taskLines(text);
        if (items.length !== lines.length) return;
        items.forEach((item, index) => {
            const box = item.querySelector('input[type="checkbox"]');
            if (!box) return;
            box.disabled = false;
            box.addEventListener('change', async () => {
                const current = await this.sync.text(path);
                if (current !== text) {
                    this.route({ keepScroll: true });
                    return;
                }
                const all = current.split('\n');
                all[lines[index]] = toggleTaskLine(all[lines[index]]);
                text = all.join('\n');
                item.classList.toggle('is-done', box.checked);
                await this.sync.saveLocal(path, text);
            });
        });
    }

    // ------------------------------------------------------------ creating, renaming, deleting

    exists(path) {
        return this.files.some((f) => f.path.toLowerCase() === path.toLowerCase());
    }

    freePath(path) {
        if (!this.exists(path)) return path;
        const stem = path.replace(/\.md$/i, '');
        for (let n = 1; ; n += 1) if (!this.exists(`${stem} ${n}.md`)) return `${stem} ${n}.md`;
    }

    async newNote() {
        const folder = this.current?.path?.includes('/')
            ? this.current.path.slice(0, this.current.path.lastIndexOf('/') + 1)
            : '';
        const input = await promptDialog('New note', {
            label: 'name (use / for folders)',
            value: `${folder}Untitled`,
            placeholder: 'Folder/Note name',
            confirmLabel: 'Create',
        });
        if (input === null) return;
        let path;
        try {
            path = this.freePath(notePathFrom(input));
        } catch (error) {
            toast(error.message, { type: 'error' });
            return;
        }
        await this.sync.saveLocal(path, '');
        await this.reloadFiles();
        this.editNext = path;
        location.hash = noteHref(path);
    }

    async renameFile(path) {
        const input = await promptDialog('Rename or move', {
            label: 'new name (use / for folders)',
            value: path.replace(/\.md$/i, ''),
            confirmLabel: 'Rename',
        });
        if (input === null) return;
        let to;
        try {
            to = kindOf(path) === 'note' ? notePathFrom(input) : input.trim().replace(/^\/+/, '');
        } catch (error) {
            toast(error.message, { type: 'error' });
            return;
        }
        if (to === path) return;
        if (this.exists(to) && to.toLowerCase() !== path.toLowerCase()) {
            toast(`"${to}" already exists.`, { type: 'error' });
            return;
        }
        // Keep [[links]] pointing at the note, the way Obsidian does.
        const before = this.links;
        const after = new LinkIndex(this.files.map((f) => (f.path === path ? to : f.path)));
        const rewrites = [];
        if (kindOf(path) === 'note' || kindOf(path) === 'image' || kindOf(path) === 'pdf') {
            for (const note of this.files) {
                if (note.kind !== 'note' || note.path === path || note.text == null) continue;
                const text = rewriteLinks(note.text, note.path, { before, after, from: path, to });
                if (text !== null) rewrites.push({ path: note.path, text });
            }
        }
        await this.sync.renameLocal(path, to, rewrites);
        await this.reloadFiles();
        location.hash = noteHref(to);
        if (rewrites.length)
            toast(`Updated links in ${rewrites.length} note${rewrites.length === 1 ? '' : 's'}.`, { type: 'success' });
    }

    async deleteFile(path) {
        const ok = await confirmDialog(`Delete "${displayName(path)}"? It stays in the repo's git history.`, {
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!ok) return;
        if (this.editorPath === path) {
            this.editor.save.cancel();
            this.editor = null;
            this.editorPath = null;
        }
        await this.sync.deleteLocal(path);
        await this.reloadFiles();
        location.hash = '#/';
    }

    // ------------------------------------------------------------ daily notes

    async dailySettings() {
        const saved = (await this.store.getMeta('settings')) || {};
        if (saved.dailyFormat)
            return {
                folder: saved.dailyFolder || '',
                format: saved.dailyFormat,
                template: saved.dailyTemplate || null,
            };
        let config = {};
        try {
            config = JSON.parse((await this.sync.text('.obsidian/daily-notes.json')) || '{}');
        } catch {
            config = {};
        }
        return detectDaily(
            this.files.map((f) => f.path),
            config,
        );
    }

    async openToday() {
        const settings = await this.dailySettings();
        const date = new Date();
        const path = dailyPath(date, settings);
        if (!this.exists(path)) {
            let text = '';
            if (settings.template) {
                const template = await this.sync.text(
                    settings.template.endsWith('.md') ? settings.template : `${settings.template}.md`,
                );
                if (template != null)
                    text = applyTemplate(template, { date, title: displayName(path), format: settings.format });
            }
            await this.sync.saveLocal(path, text);
            await this.reloadFiles();
            this.editNext = path;
            this.focusEnd = true;
        }
        location.hash = noteHref(path);
        if (parseRoute(location.hash).path === this.current?.path) this.route();
    }

    propertiesTable(data, path) {
        const entries = Object.entries(data).filter(
            ([key]) => !['tags', 'tag'].includes(key) && !key.startsWith('nosk-'),
        );
        if (!entries.length) return null;
        const value = (v) => {
            const items = Array.isArray(v) ? v : [v];
            return items.flatMap((item, i) => {
                const node = String(item).match(/^\[\[(.+)\]\]$/)
                    ? el('span', {
                          innerHTML: renderNote(String(item), { path, links: this.links }).html.replace(
                              /^<p>|<\/p>\s*$/g,
                              '',
                          ),
                      })
                    : document.createTextNode(String(item));
                return i ? [document.createTextNode(', '), node] : [node];
            });
        };
        return el(
            'dl',
            { className: 'kv properties' },
            ...entries.flatMap(([key, v]) => [el('dt', {}, key), el('dd', {}, ...value(v))]),
        );
    }

    scrollToFragment(body, fragment) {
        if (!fragment) return;
        const want = fragment.toLowerCase();
        const target = fragment.startsWith('^')
            ? (body
                  .querySelector(`[data-block-id="${CSS.escape(fragment.slice(1))}"]`)
                  ?.closest('p, li, blockquote, div') ?? null)
            : [...body.querySelectorAll('[data-heading]')].find((h) => h.dataset.heading === want);
        if (target) {
            target.scrollIntoView({ block: 'start' });
            target.classList.add('is-target');
        }
    }

    async showBacklinks(article, path, seq) {
        const hits = await this.search.backlinks(path, this.links, outgoingLinks);
        if (seq !== this.renderSeq || !hits.length) return;
        article.append(
            el(
                'section',
                { className: 'backlinks' },
                el('div', { className: 'eyebrow' }, `linked from ${hits.length}`),
                ...hits.map((hit) => el('a', { className: 'backlink', href: noteHref(hit.path) }, hit.name)),
            ),
        );
    }

    markShortcuts(root) {
        const mac = /Mac|iPhone|iPad/.test(navigator.platform || '');
        root.querySelectorAll('[data-kbd-mod]').forEach((kbd) => {
            kbd.textContent = kbd.textContent.replace('⌘', mac ? '⌘' : 'Ctrl+');
        });
    }

    // ------------------------------------------------------------ palettes & settings

    openSwitcher() {
        this.palette.open({
            anchor: $('main'),
            placeholder: 'Open a note…',
            sigil: '>',
            source: async (query) => {
                const files = query
                    ? await this.search.files(query)
                    : readRecent()
                          .map((path) => this.files.find((f) => f.path === path))
                          .filter(Boolean);
                return files.map((file) => ({
                    icon: file.kind === 'note' ? '·' : '◇',
                    label: displayName(file.path),
                    snippet: file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '',
                    kind: query ? '' : 'recent',
                    run: () => {
                        location.hash = noteHref(file.path);
                    },
                }));
            },
        });
    }

    openSearch() {
        this.palette.open({
            anchor: $('main'),
            placeholder: 'Search all notes… (#tag to filter)',
            sigil: '?',
            debounceMs: 120,
            source: async (query) =>
                (await this.search.fullText(query)).map((result) => ({
                    icon: '·',
                    label: result.name,
                    snippet: result.snippet,
                    run: () => {
                        location.hash = noteHref(result.path);
                    },
                })),
        });
    }

    openSettings() {
        modal('Settings', async (body, close) => {
            const { owner, repo, branch } = this.connection;
            const pulledAt = await this.store.getMeta('pulledAt');
            const estimate = await navigator.storage?.estimate?.().catch(() => null);
            const themeButtons = ['system', 'dark', 'light'].map((value) => {
                const button = el(
                    'button',
                    { type: 'button', className: theme.get() === value ? 'is-active' : '' },
                    value,
                );
                button.addEventListener('click', () => {
                    theme.set(value);
                    themeButtons.forEach((b) => b.classList.toggle('is-active', b === button));
                });
                return button;
            });
            const paletteButtons = PALETTES.map(({ id, label, swatch }) => {
                const button = el(
                    'button',
                    { type: 'button', className: theme.palette() === id ? 'is-active' : '' },
                    el('span', { className: 'theme-swatch', style: `--swatch: ${swatch}` }),
                    label,
                );
                button.addEventListener('click', () => {
                    theme.setPalette(id);
                    paletteButtons.forEach((b) => b.classList.toggle('is-active', b === button));
                });
                return button;
            });
            const syncNow = el('button', { type: 'button', className: 'btn btn-ghost btn-sm' }, 'sync now');
            syncNow.addEventListener('click', () =>
                this.sync.sync().then(
                    () => toast('Up to date', { type: 'success' }),
                    (error) => this.onSyncError(error),
                ),
            );
            // Daily notes: detected from the vault, adjustable here.
            const daily = await this.dailySettings();
            const folderInput = el('input', { value: daily.folder, placeholder: '(vault root)', spellcheck: false });
            const formatInput = el('input', { value: daily.format, placeholder: 'YYYY-MM-DD', spellcheck: false });
            const preview = el('p', { className: 'muted' });
            const showPreview = () => {
                const path = dailyPath(new Date(), {
                    folder: folderInput.value.trim(),
                    format: formatInput.value.trim() || 'YYYY-MM-DD',
                });
                preview.textContent = `Today: ${path}`;
            };
            folderInput.addEventListener('input', showPreview);
            formatInput.addEventListener('input', showPreview);
            showPreview();
            const saveDaily = el('button', { type: 'button', className: 'btn btn-ghost btn-sm' }, 'save');
            saveDaily.addEventListener('click', async () => {
                const settings = (await this.store.getMeta('settings')) || {};
                await this.store.setMeta('settings', {
                    ...settings,
                    dailyFolder: folderInput.value.trim().replace(/^\/+|\/+$/g, ''),
                    dailyFormat: formatInput.value.trim() || 'YYYY-MM-DD',
                    dailyTemplate: daily.template,
                });
                toast('Daily notes updated', { type: 'success' });
            });
            const redownload = el(
                'button',
                { type: 'button', className: 'btn btn-ghost btn-sm' },
                're-download everything',
            );
            redownload.addEventListener('click', async () => {
                close();
                await this.store.deleteMeta('head');
                this.sync.pull({ force: true }).catch((error) => this.onSyncError(error));
            });
            const token = el('button', { type: 'button', className: 'btn btn-ghost btn-sm' }, 'change token');
            token.addEventListener('click', () => {
                close();
                this.reconnect();
            });
            const disconnect = el(
                'button',
                { type: 'button', className: 'btn btn-danger btn-sm' },
                'disconnect this device',
            );
            disconnect.addEventListener('click', async () => {
                const unsynced = await this.sync.countPending();
                const warning = unsynced
                    ? ` ${unsynced} change${unsynced === 1 ? " hasn't" : "s haven't"} reached GitHub yet and will be lost.`
                    : ' Nothing on GitHub changes.';
                if (
                    !(await confirmDialog(`Remove the token and the downloaded vault from this device?${warning}`, {
                        confirmLabel: 'Disconnect',
                        danger: true,
                    }))
                )
                    return;
                close();
                this.sync.stop();
                await this.store.clear();
                this.connection = null;
                location.hash = '';
                this.showSetup();
            });
            body.append(
                el('div', { className: 'section-label eyebrow' }, 'vault'),
                el(
                    'dl',
                    { className: 'kv' },
                    el('dt', {}, 'repo'),
                    el(
                        'dd',
                        {},
                        el(
                            'a',
                            {
                                href: `https://github.com/${owner}/${repo}`,
                                target: '_blank',
                                rel: 'noopener noreferrer',
                            },
                            `${owner}/${repo}`,
                        ),
                    ),
                    el('dt', {}, 'branch'),
                    el('dd', {}, branch),
                    el('dt', {}, 'files'),
                    el('dd', {}, `${this.files.length} on this device`),
                    el('dt', {}, 'synced'),
                    el('dd', {}, pulledAt ? formatRelativeTime(pulledAt) : 'never'),
                    estimate?.usage ? el('dt', {}, 'storage') : null,
                    estimate?.usage
                        ? el('dd', {}, `${(estimate.usage / 1024 / 1024).toFixed(1)} MB used by nosk in this browser`)
                        : null,
                ),
                el('div', { className: 'modal__actions modal__actions--start' }, syncNow, redownload, token),
                el('div', { className: 'section-label eyebrow' }, 'daily notes'),
                el(
                    'div',
                    { className: 'daily-settings' },
                    el('label', { className: 'field' }, el('span', { className: 'eyebrow' }, 'folder'), folderInput),
                    el(
                        'label',
                        { className: 'field' },
                        el('span', { className: 'eyebrow' }, 'name format'),
                        formatInput,
                    ),
                ),
                preview,
                el('div', { className: 'modal__actions modal__actions--start' }, saveDaily),
                el('div', { className: 'section-label eyebrow' }, 'theme'),
                el('div', { className: 'segmented' }, ...themeButtons),
                el('div', { className: 'section-label eyebrow' }, 'palette'),
                el('div', { className: 'segmented' }, ...paletteButtons),
                el('div', { className: 'section-label eyebrow' }, 'device'),
                el(
                    'p',
                    { className: 'muted' },
                    'Disconnecting removes the token and the downloaded notes from this browser only.',
                ),
                el('div', { className: 'modal__actions modal__actions--start' }, disconnect),
            );
        });
    }
}

if (typeof window !== 'undefined' && document.getElementById('app')) {
    new VaultApp().start().catch((error) => {
        console.error(error);
        toast(`nosk failed to start: ${error.message}`, { type: 'error', timeout: 10_000 });
    });
}
