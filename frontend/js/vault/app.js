// nosk, git-backed: the app shell. Connects to a vault repo, keeps a copy on the device, and
// renders notes read-only (editing arrives in milestone 2 of project_plan/GIT_BACKED_PLAN.md).
import { SidebarLayout } from '../sidebar-layout.js';
import { theme } from '../theme.js';
import { confirmDialog, modal, toast } from '../ui.js';
import { el, formatRelativeTime, isEditableTarget, modKey } from '../utils.js';
import { GitHub, GitHubError, OfflineError } from './github.js';
import { LinkIndex, displayName, outgoingLinks } from './links.js';
import { Palette } from './palette.js';
import { hydrate, noteHref, noteTags, renderNote } from './render.js';
import { VaultSearch } from './search.js';
import { VaultStore } from './store.js';
import { VaultSync } from './sync.js';
import { VaultTree } from './tree.js';

const $ = (id) => document.getElementById(id);
const RECENT_KEY = 'nosk.vault.recent';
const TOKEN_URL = 'https://github.com/settings/personal-access-tokens/new';
const KIND_LABELS = { canvas: 'Obsidian canvas', excalidraw: 'Excalidraw drawing', base: 'Obsidian base' };

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

/** #/ → home, #/n/<path>?h=<fragment> → a file, #/tag/<tag> → notes with that tag. */
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
    const tag = route.match(/^\/tag\/(.+)$/);
    if (tag) return { name: 'tag', tag: decodeURIComponent(tag[1]) };
    return { name: 'home' };
}

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
            if (error.status === 404) throw new Error(`${owner}/${repo} not found, or the token can't see it.`);
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
        this.search = new VaultSearch(this.store);
        $('vault-name').textContent = `${owner}/${repo}`;
        $('vault-name').title = `${owner}/${repo} · ${branch}`;
        if (!this.bound) this.bindUI();
        await this.reloadFiles();
        this.sync.on('state', ({ state, error }) => this.showSyncState(state, error));
        this.sync.on('progress', ({ done, total }) => this.showProgress(done, total));
        this.sync.on('changed', (result) => this.onChanged(result));
        await this.route();
        this.sync.start().catch((error) => this.onSyncError(error));
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
        $('sync-status').addEventListener('click', () => this.sync.pull().catch((error) => this.onSyncError(error)));
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
            } else if (event.key === '/' && !isEditableTarget(event.target) && !this.palette.isOpen) {
                event.preventDefault();
                this.openSearch();
            }
        });
    }

    async reloadFiles() {
        this.files = await this.store.allFiles();
        this.links.update(this.files.map((f) => f.path));
        this.search.invalidate();
        this.tree.setFiles(this.files);
        if (this.current?.path) this.tree.setActive(this.current.path);
    }

    async onChanged({ changed, removed }) {
        await this.reloadFiles();
        const touched = new Set([...changed, ...removed]);
        const route = parseRoute(location.hash);
        // Re-render what's on screen if it changed, or if the first download just finished.
        if (route.name !== 'note' || touched.has(route.path) || !this.current?.sha)
            await this.route({ keepScroll: true });
    }

    onSyncError(error) {
        if (error instanceof OfflineError) return;
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
        pill.dataset.state = state === 'auth' ? 'error' : state;
        const label = pill.querySelector('.sync-status__label');
        const labels = { idle: 'synced', syncing: 'syncing', offline: 'offline', auth: 'token?', error: 'error' };
        label.textContent = labels[state] || state;
        pill.title =
            state === 'error' || state === 'auth'
                ? error?.message || 'Sync failed'
                : this.sync.lastPull
                  ? `Checked GitHub ${formatRelativeTime(this.sync.lastPull)}. Click to check now.`
                  : 'Click to check GitHub now';
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
        else if (route.name === 'tag') await this.showTag(route.tag);
        else await this.showHome();
        if (keepScroll) window.scrollTo(0, scroll);
    }

    beginView(title) {
        this.renderSeq += 1;
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
                    { type: 'button', className: 'btn btn-primary', onclick: () => this.openSwitcher() },
                    'open a note ',
                    el('kbd', { dataset: { kbdMod: '' } }, '⌘K'),
                ),
                el(
                    'button',
                    { type: 'button', className: 'btn btn-ghost', onclick: () => this.openSearch() },
                    'search everything ',
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
        const results = await this.search.fullText(`#${tag}`, 1000);
        if (seq !== this.renderSeq) return;
        view.append(
            el(
                'article',
                { className: 'editor note' },
                el(
                    'header',
                    { className: 'page-header' },
                    el(
                        'div',
                        { className: 'eyebrow page-header__crumb' },
                        el('span', { className: 'accent' }, '~/'),
                        'tags',
                    ),
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

    crumbs(path) {
        const parts = path.split('/').slice(0, -1);
        return el(
            'div',
            { className: 'eyebrow page-header__crumb' },
            el('span', { className: 'accent' }, '~/'),
            parts.length ? parts.join(' / ') : this.connection.repo,
        );
    }

    async showFile(path, fragment) {
        const file = await this.store.getFile(path);
        this.current = { path, sha: file?.sha };
        this.tree.setActive(path);
        const { view, seq } = this.beginView(displayName(path));
        const article = el('article', { className: 'editor note' });
        view.append(article);
        if (!file) {
            article.append(
                el(
                    'header',
                    { className: 'page-header' },
                    this.crumbs(path),
                    el('h1', { className: 'page-title' }, displayName(path)),
                ),
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
        const github = el(
            'a',
            {
                className: 'link-btn',
                href: this.github.webUrl(path, this.connection.branch),
                target: '_blank',
                rel: 'noopener noreferrer',
            },
            'view on github ↗',
        );
        const header = el(
            'header',
            { className: 'page-header' },
            this.crumbs(path),
            el('h1', { className: 'page-title' }, displayName(path)),
        );
        article.append(header);

        if (file.kind === 'note') {
            const text = await this.sync.text(path).catch(() => null);
            if (seq !== this.renderSeq) return;
            if (text == null) {
                article.append(
                    el(
                        'div',
                        { className: 'notice' },
                        "This note hasn't been downloaded yet. It will load when you're online.",
                    ),
                );
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
            header.append(el('div', { className: 'page-meta' }, github));
            const body = el('div', { className: 'note-body rendered', innerHTML: html });
            // Many notes open with "# <file name>"; the page title already says that.
            const first = body.firstElementChild;
            if (first?.tagName === 'H1' && first.textContent.trim() === displayName(path).trim()) first.remove();
            article.append(body);
            await hydrate(body, { path, links: this.links, sync: this.sync });
            if (seq !== this.renderSeq) return;
            this.scrollToFragment(body, fragment);
            this.showBacklinks(article, path, seq);
            return;
        }

        header.append(
            el(
                'div',
                { className: 'page-meta' },
                `${file.path.split('.').pop()} · ${Math.max(1, Math.round(file.size / 1024))} KB · `,
                github,
            ),
        );
        if (file.kind === 'image' || file.kind === 'pdf') {
            const holder = el(
                'div',
                { className: `file-view file-view--${file.kind}` },
                el('div', { className: 'muted' }, 'loading…'),
            );
            article.append(holder);
            try {
                const url = await this.sync.blobUrl(path);
                if (seq !== this.renderSeq) return;
                holder.replaceChildren(
                    file.kind === 'image'
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
        if (file.kind === 'text') {
            const ext = path.split('.').pop().toLowerCase();
            const text = await this.sync.text(path).catch(() => null);
            if (seq !== this.renderSeq) return;
            if (KIND_LABELS[ext])
                article.append(
                    el(
                        'div',
                        { className: 'notice' },
                        `${KIND_LABELS[ext]}: open it in Obsidian to see it drawn. The raw file is below.`,
                    ),
                );
            const code = el('code', {}, text ?? '');
            article.append(el('pre', { className: 'file-source' }, code));
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
            const syncNow = el('button', { type: 'button', className: 'btn btn-ghost btn-sm' }, 'sync now');
            syncNow.addEventListener('click', () =>
                this.sync.pull().then(
                    () => toast('Up to date', { type: 'success' }),
                    (error) => this.onSyncError(error),
                ),
            );
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
                if (
                    !(await confirmDialog(
                        'Remove the token and the downloaded vault from this device? Nothing on GitHub changes.',
                        { confirmLabel: 'Disconnect', danger: true },
                    ))
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
                el('div', { className: 'section-label eyebrow' }, 'theme'),
                el('div', { className: 'segmented' }, ...themeButtons),
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
