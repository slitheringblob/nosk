import { api, ApiError, NetworkError } from './api-client.js';
import { auth } from './auth.js';
import { CommandPalette } from './command-palette.js';
import { CommentsPanel } from './comments-panel.js';
import { ComponentPicker } from './component-picker.js';
import { canConvert, CONVERTIBLE_TYPES } from './component-converter.js';
import registry from './components/registry.js';
import {
    openConflictsDialog,
    openHistoryDialog,
    openImportDialog,
    openSettingsDialog,
    openShareDialog,
    openTemplatesDialog,
    openTrashDialog,
} from './dialogs.js';
import { DragDropManager } from './dragdrop-manager.js';
import { KeyboardManager } from './keyboard-manager.js';
import { media } from './media.js';
import { PageManager } from './page-manager.js';
import { Journal, addDays, journalTitle, localDate } from './journal.js';
import { Sidebar } from './sidebar.js';
import { SidebarLayout } from './sidebar-layout.js';
import { storage } from './storage.js';
import { syncClient } from './sync-client.js';
import { theme } from './theme.js';
import { confirmDialog, showMenu, toast } from './ui.js';
import { debounce, downloadFile, el, formatRelativeTime, generateUUID, isEditableTarget, isMac, now } from './utils.js';

const $ = (selector) => document.querySelector(selector);

class App {
    constructor() {
        this.currentPageId = null;
        this.picker = new ComponentPicker();
        this.keyboard = new KeyboardManager();
        this.presence = [];
    }

    async start() {
        theme.watch();
        if (!isMac()) {
            document.querySelectorAll('[data-kbd-mod]').forEach((node) => {
                node.textContent = node.textContent.replace('⌘', 'Ctrl+');
            });
        }
        if (!auth.isLoggedIn()) {
            window.location.replace('login.html');
            return;
        }
        api.on('unauthorized', () => this.signOut(false));
        this.cacheElements();
        this.pages = new PageManager({
            storage,
            sync: syncClient,
            root: this.el.blocks,
            picker: this.picker,
            services: {
                api,
                media,
                user: () => auth.user,
                navigate: (pageId) => this.openPage(pageId),
                filterByTag: (tag) => {
                    this.sidebar.setTag(tag);
                    this.el.app.classList.add('sidebar-open');
                },
                pages: { get: (id) => storage.getPage(id), list: () => storage.getPages() },
            },
        });
        this.layout = new SidebarLayout({ app: this.el.app, resizer: $('#sidebar-resizer') });
        this.sidebar = new Sidebar({
            container: this.el.sidebar,
            onOpen: (id) => this.openPage(id),
            onUseTemplate: (id) => this.useTemplate(id),
        });
        this.comments = new CommentsPanel({
            container: this.el.drawer,
            getUser: () => auth.user,
            getPage: () => this.pages.page,
            isPendingCreate: (pageId) => syncClient.isPendingCreate(pageId),
            onCountsChanged: (counts) => this.pages.setCommentCounts(counts),
            onFocusBlock: (id) => this.revealBlock(id),
        });
        this.journal = new Journal({ storage, sync: syncClient, api, getUser: () => auth.user });
        this.palette = new CommandPalette({
            storage,
            onOpenPage: (id, blockId) => this.openPage(id, blockId),
            commands: () => this.commands(),
        });
        this.dragdrop = new DragDropManager({
            root: this.el.blocks,
            onDrop: (id, target) => this.handleDrop(id, target),
        });

        this.bindChrome();
        this.bindBlocks();
        this.bindKeyboard();
        this.bindSync();
        this.renderUser();

        try {
            await syncClient.start();
        } catch (error) {
            toast(`Could not load your pages: ${error.message}`, { type: 'error' });
        }
        await this.refreshSidebar();
        window.addEventListener('hashchange', () => this.route());
        // Flush debounced edits when the tab is hidden or closed so nothing is lost.
        window.addEventListener('pagehide', () => this.pages.flushSaves());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') this.pages.flushSaves();
        });
        await this.route();
        this.registerServiceWorker();
        this.refreshUser();
        this.loadBuiltinTemplates();
        // Cache journal settings and template blocks so new days can be created offline.
        this.journal.refreshSettings().then(() => this.journal.warmTemplate());
    }

    cacheElements() {
        this.el = {
            app: $('#app'),
            sidebar: $('#sidebar'),
            blocks: $('#blocks'),
            drawer: $('#drawer'),
            main: $('#main'),
            editor: $('#editor'),
            welcome: $('#welcome'),
            title: $('#page-title'),
            icon: $('#page-icon'),
            tags: $('#page-tags'),
            meta: $('#page-meta'),
            presence: $('#presence'),
            syncStatus: $('#sync-status'),
            banner: $('#page-banner'),
            backlinks: $('#backlinks'),
            journalNav: $('#journal-nav'),
            breadcrumb: $('#breadcrumb'),
        };
    }

    // --- Routing ------------------------------------------------------------------------

    async route() {
        const match = window.location.hash.match(/^#\/page\/([\w-]+)(?:\?block=([\w-]+))?/);
        if (match) {
            await this.showPage(match[1], match[2]);
            return;
        }
        const pages = (await storage.getPages()).filter((p) => !p.deleted).sort((a, b) => b.updated_at - a.updated_at);
        if (pages.length) this.openPage(pages[0].id, null, true);
        else this.showWelcome();
    }

    openPage(pageId, blockId = null, replace = false) {
        const hash = `#/page/${pageId}${blockId ? `?block=${blockId}` : ''}`;
        if (window.location.hash === hash) {
            this.showPage(pageId, blockId);
        } else if (replace) {
            history.replaceState(null, '', hash);
            this.showPage(pageId, blockId);
        } else {
            window.location.hash = hash;
        }
        this.el.app.classList.remove('sidebar-open');
    }

    showWelcome() {
        this.pages.close();
        this.currentPageId = null;
        this.el.editor.hidden = true;
        this.el.welcome.hidden = false;
        this.sidebar.setActive(null);
        document.title = 'nosk';
    }

    async showPage(pageId, blockId) {
        if (this.currentPageId !== pageId) {
            const opened = await this.pages.open(pageId);
            if (!opened) {
                toast('That page is not available on this device.', { type: 'error' });
                this.showWelcome();
                return;
            }
            this.currentPageId = pageId;
            this.comments.close();
            this.presence = [];
            this.renderPresence();
            this.comments.load();
            this.loadBacklinks();
        }
        this.el.welcome.hidden = true;
        this.el.editor.hidden = false;
        this.renderHeader();
        this.sidebar.setActive(pageId);
        if (blockId) this.revealBlock(blockId);
        else if (!this.pages.records.size && this.pages.page.role !== 'viewer' && this.pages.page.title === 'Untitled')
            this.el.title.focus();
    }

    revealBlock(blockId) {
        const node = this.el.blocks.querySelector(`[data-component-id="${blockId}"]`);
        if (!node) return;
        let parent = node.parentElement?.closest('.toggle-container');
        while (parent) {
            parent.classList.add('is-open');
            parent = parent.parentElement?.closest('.toggle-container');
        }
        node.scrollIntoView({ block: 'center', behavior: 'smooth' });
        node.classList.add('is-highlighted');
        setTimeout(() => node.classList.remove('is-highlighted'), 1800);
    }

    // --- Page header --------------------------------------------------------------------

    renderHeader() {
        const page = this.pages.page;
        if (!page) return;
        const readOnly = page.role === 'viewer';
        document.title = `${page.title || 'Untitled'} — nosk`;
        if (document.activeElement !== this.el.title)
            this.el.title.textContent = page.title === 'Untitled' ? '' : page.title;
        this.el.title.contentEditable = readOnly ? 'false' : 'true';
        this.el.icon.textContent = page.icon || '◇';
        this.el.icon.disabled = readOnly;
        // Same name as the sidebar group: the page's template, or "pages" for scratch pages.
        this.el.breadcrumb.textContent =
            page.role === 'owner'
                ? page.is_template
                    ? 'templates'
                    : this.sidebar.groupName(page) || 'pages'
                : `shared by ${page.owner_email || 'someone'}`;
        this.renderJournalNav(page);
        this.renderTags();
        const parts = [`edited ${formatRelativeTime(page.updated_at)}`, `v${page.version}`];
        if (page.role !== 'owner') parts.push(page.role === 'viewer' ? 'view only' : 'can edit');
        this.el.meta.textContent = parts.join(' · ');
        this.el.banner.hidden = !page.deleted;
        this.el.banner.replaceChildren();
        if (page.deleted) {
            const restore = el('button', { type: 'button', className: 'btn btn-primary btn-sm' }, 'Restore');
            restore.addEventListener('click', () => this.restorePage(page.id));
            this.el.banner.append(el('span', {}, 'This page is in the trash.'), restore);
        }
        document.querySelectorAll('[data-requires-edit]').forEach((node) => {
            node.hidden = readOnly;
        });
        document.querySelectorAll('[data-requires-owner]').forEach((node) => {
            node.hidden = page.role !== 'owner';
        });
    }

    /** ← previous · today · next → navigation and a date picker on journal pages. */
    async renderJournalNav(page) {
        const nav = this.el.journalNav;
        if (!page.journal_date || page.role !== 'owner') {
            nav.hidden = true;
            nav.replaceChildren();
            return;
        }
        const date = page.journal_date;
        const { previous, next } = await this.journal.neighbours(date);
        if (this.pages.page?.id !== page.id) return;
        const today = localDate();
        const go = (label, title, target, disabled = false) => {
            const button = el('button', { type: 'button', className: 'btn btn-ghost btn-sm', title, disabled }, label);
            button.addEventListener('click', () => this.openJournal(target));
            return button;
        };
        const picker = el('input', {
            type: 'date',
            value: date,
            ariaLabel: 'Go to date',
            className: 'journal-nav__date',
        });
        picker.addEventListener('change', () => {
            if (picker.value) this.openJournal(picker.value);
        });
        nav.replaceChildren(
            go(
                '← ' + (previous ? previous.journal_date.slice(5) : 'prev'),
                previous ? journalTitle(previous.journal_date) : 'No earlier entries',
                previous?.journal_date,
                !previous,
            ),
            go('today', journalTitle(today), today, date === today),
            go(
                (next ? next.journal_date.slice(5) : 'next') + ' →',
                next ? journalTitle(next.journal_date) : 'No later entries',
                next?.journal_date,
                !next,
            ),
            picker,
        );
        nav.hidden = false;
    }

    /** Open (creating if needed) the journal entry for a YYYY-MM-DD date. */
    async openJournal(date = localDate()) {
        try {
            const pageId = await this.journal.open(date);
            await this.refreshSidebar();
            this.openPage(pageId);
        } catch (error) {
            toast(`Could not open the journal: ${error.message}`, { type: 'error' });
        }
    }

    renderTags() {
        const page = this.pages.page;
        const readOnly = page.role === 'viewer';
        const chips = (page.tags || []).map((tag) => {
            const chip = el(
                'span',
                { className: 'tag-chip' },
                el(
                    'button',
                    { type: 'button', className: 'tag-chip__name', onclick: () => this.sidebar.setTag(tag) },
                    `#${tag}`,
                ),
            );
            if (!readOnly) {
                chip.append(
                    el(
                        'button',
                        {
                            type: 'button',
                            className: 'tag-chip__remove',
                            ariaLabel: `Remove tag ${tag}`,
                            onclick: () => this.updatePage({ tags: page.tags.filter((t) => t !== tag) }),
                        },
                        '×',
                    ),
                );
            }
            return chip;
        });
        if (!readOnly && (page.tags || []).length < 30) {
            const input = el('input', {
                className: 'tags-input',
                placeholder: page.tags?.length ? '+ tag' : '+ add tag',
                maxLength: 50,
                ariaLabel: 'Add tag',
            });
            input.addEventListener('keydown', (event) => {
                if ((event.key === 'Enter' || event.key === ',') && input.value.trim()) {
                    event.preventDefault();
                    const tag = input.value.trim().replace(/^#/, '').toLowerCase();
                    if (!page.tags.includes(tag)) this.updatePage({ tags: [...page.tags, tag] });
                    input.value = '';
                }
            });
            chips.push(input);
        }
        this.el.tags.replaceChildren(...chips);
    }

    renderPresence() {
        const others = this.presence.filter((viewer) => viewer.device_id !== auth.deviceId);
        this.el.presence.replaceChildren(
            ...others.slice(0, 5).map((viewer) =>
                el(
                    'span',
                    {
                        className: 'avatar',
                        title: `${viewer.email} is viewing`,
                    },
                    viewer.email.slice(0, 1).toUpperCase(),
                ),
            ),
        );
        if (others.length)
            this.el.presence.append(el('span', { className: 'muted presence__label' }, `${others.length} here`));
    }

    async loadBacklinks() {
        const pageId = this.currentPageId;
        this.el.backlinks.hidden = true;
        if (await syncClient.isPendingCreate(pageId)) return;
        try {
            const { backlinks } = await api.get(`/api/pages/${pageId}/backlinks`);
            if (pageId !== this.currentPageId || !backlinks.length) return;
            this.el.backlinks.replaceChildren(
                el('div', { className: 'eyebrow' }, `backlinks · ${backlinks.length}`),
                ...backlinks.map((link) =>
                    el(
                        'a',
                        {
                            href: `#/page/${link.page_id}`,
                            className: 'backlink',
                            onclick: (event) => {
                                event.preventDefault();
                                this.openPage(link.page_id, link.component_id);
                            },
                        },
                        `${link.icon || '↗'} ${link.title}`,
                    ),
                ),
            );
            this.el.backlinks.hidden = false;
        } catch {
            // Backlinks are an online-only nicety.
        }
    }

    async updatePage(fields) {
        const page = this.pages.page;
        if (!page || page.role === 'viewer') return;
        Object.assign(page, fields, { updated_at: now() });
        await storage.updatePage(page.id, (stored) => Object.assign(stored, fields, { updated_at: page.updated_at }));
        await syncClient.queue({ type: 'update_page', page_id: page.id, data: fields });
        this.renderHeader();
        this.refreshSidebar();
    }

    // --- Page actions -------------------------------------------------------------------

    async createPage({ title = 'Untitled', icon = null } = {}) {
        const id = generateUUID();
        const timestamp = now();
        const page = {
            id,
            user_id: auth.user.id,
            title,
            icon,
            color: null,
            tags: [],
            is_template: false,
            component_ids: [],
            created_at: timestamp,
            updated_at: timestamp,
            version: 0,
            sv: 0,
            deleted: false,
            role: 'owner',
            owner_email: null,
        };
        await storage.putPage(page);
        await syncClient.queue({ type: 'create_page', page_id: id, data: { title, icon } });
        await this.refreshSidebar();
        this.openPage(id);
        return id;
    }

    async deletePage(pageId) {
        const page = await storage.getPage(pageId);
        if (!page || page.role !== 'owner') return;
        await storage.updatePage(pageId, (stored) => {
            stored.deleted = true;
        });
        await syncClient.queue({ type: 'delete_page', page_id: pageId, data: { permanent: false } });
        await this.refreshSidebar();
        toast(`Moved "${page.title}" to trash`, {
            action: { label: 'Undo', onSelect: () => this.restorePage(pageId) },
        });
        if (pageId === this.currentPageId) {
            this.currentPageId = null;
            history.replaceState(null, '', '#/');
            this.route();
        }
    }

    async restorePage(pageId) {
        const page = await storage.updatePage(pageId, (stored) => {
            stored.deleted = false;
        });
        if (!page) return;
        if (this.pages.page?.id === pageId) this.pages.page.deleted = false;
        await syncClient.queue({ type: 'restore_page', page_id: pageId });
        await this.refreshSidebar();
        if (pageId === this.currentPageId) this.renderHeader();
    }

    async serverAction(action, success) {
        try {
            await this.pages.flushSaves();
            await syncClient.sync();
            const result = await action();
            await syncClient.sync();
            success?.(result);
        } catch (error) {
            const message =
                error instanceof NetworkError ? 'This needs a connection — try again when online.' : error.message;
            toast(message, { type: 'error' });
        }
    }

    duplicatePage(asTemplate = false) {
        const page = this.pages.page;
        this.serverAction(
            () => api.post(`/api/pages/${page.id}/duplicate`, { as_template: asTemplate }),
            async (copy) => {
                await this.refreshSidebar();
                toast(asTemplate ? 'Saved as template' : 'Page duplicated');
                this.openPage(copy.id);
            },
        );
    }

    exportPage(format) {
        const page = this.pages.page;
        if (format === 'pdf') {
            window.print();
            return;
        }
        this.serverAction(
            async () => {
                const response = await api.request('GET', `/api/pages/${page.id}/export`, {
                    query: { format },
                    raw: true,
                });
                return format === 'json' ? JSON.stringify(await response.json(), null, 2) : response.text();
            },
            (content) => {
                const name = (page.title || 'page').replace(/[^\w\- ]+/g, '').trim() || 'page';
                downloadFile(
                    `${name}.${format === 'json' ? 'json' : 'md'}`,
                    content,
                    format === 'json' ? 'application/json' : 'text/markdown',
                );
            },
        );
    }

    async refreshSidebar() {
        this.sidebar.setPages(await storage.getPages());
    }

    /** Built-in templates live on the server; keep the last list so the sidebar shows them offline. */
    async loadBuiltinTemplates() {
        const KEY = 'nosk.templates.builtin';
        try {
            const cached = JSON.parse(localStorage.getItem(KEY) || '[]');
            if (cached.length) this.sidebar.setBuiltinTemplates(cached);
        } catch {
            // No usable cache; the fetch below fills it.
        }
        try {
            const { templates } = await api.get('/api/templates');
            const builtins = templates
                .filter((t) => t.builtin)
                .map(({ id, title, icon, description }) => ({ id, title, icon, description }));
            this.sidebar.setBuiltinTemplates(builtins);
            try {
                localStorage.setItem(KEY, JSON.stringify(builtins));
            } catch {
                // Cache is optional.
            }
        } catch {
            // Offline: the cached list (if any) stays.
        }
    }

    useTemplate(templateId) {
        this.serverAction(
            () => api.post('/api/pages/from-template', { template_id: templateId }),
            (page) => this.afterServerCreate(page),
        );
    }

    async renderUser() {
        const user = auth.user;
        $('#user-email').textContent = user?.email || '';
        $('#verify-reminder').hidden = Boolean(user?.is_verified);
    }

    async refreshUser() {
        try {
            const user = await api.get('/api/auth/me');
            auth.updateUser(user);
            this.renderUser();
        } catch {
            // Offline: keep the cached profile.
        }
    }

    async signOut(callServer = true) {
        syncClient.stop();
        if (callServer) {
            try {
                await syncClient.sync();
                await api.logout();
            } catch {
                auth.clear();
            }
        } else {
            auth.clear();
        }
        window.location.replace('login.html');
    }

    commands() {
        const page = this.pages.page;
        const editable = page && page.role !== 'viewer';
        const list = [
            { icon: '+', label: 'New page', hint: `${isMac() ? '⌥⌘' : 'Ctrl+Alt+'}N`, run: () => this.createPage() },
            {
                icon: '📓',
                label: "Open today's journal",
                hint: `${isMac() ? '⌥⌘' : 'Ctrl+Alt+'}J`,
                run: () => this.openJournal(),
            },
            { icon: '📓', label: "Open yesterday's journal", run: () => this.openJournal(addDays(localDate(), -1)) },
            {
                icon: '⧉',
                label: 'New page from template',
                run: () => openTemplatesDialog({ onCreated: (p) => this.afterServerCreate(p) }),
            },
            {
                icon: '?',
                label: 'Search all pages',
                hint: `${isMac() ? '⌘' : 'Ctrl+'}F`,
                run: () => this.palette.open('search'),
            },
            {
                icon: '↥',
                label: 'Import Markdown or JSON',
                run: () => openImportDialog({ onImported: (p) => this.afterServerCreate(p) }),
            },
            { icon: '⟳', label: 'Sync now', hint: `${isMac() ? '⌘' : 'Ctrl+'}S`, run: () => this.syncNow() },
            { icon: '🗑', label: 'Open trash', run: () => this.openTrash() },
            { icon: '⚙', label: 'Settings', run: () => this.openSettings() },
        ];
        if (page) {
            list.push(
                { icon: '💬', label: 'Toggle comments', run: () => this.comments.toggle() },
                { icon: '⏱', label: 'Page history', run: () => this.openHistory() },
                { icon: '⇪', label: 'Share page', run: () => openShareDialog(page) },
                { icon: 'M↓', label: 'Export as Markdown', run: () => this.exportPage('markdown') },
                { icon: '{}', label: 'Export as JSON', run: () => this.exportPage('json') },
                { icon: '⎙', label: 'Export as PDF (print)', run: () => this.exportPage('pdf') },
                { icon: '⧉', label: 'Duplicate page', run: () => this.duplicatePage() },
            );
            if (page.role === 'owner') {
                list.push(
                    { icon: '★', label: 'Save page as template', run: () => this.duplicatePage(true) },
                    { icon: '🗑', label: 'Move page to trash', run: () => this.deletePage(page.id) },
                );
            }
            if (editable) list.push({ icon: '⇥', label: 'Insert block…', run: () => this.insertAtEnd() });
        }
        list.push({ icon: '⏻', label: 'Sign out', run: () => this.signOut() });
        return list;
    }

    async afterServerCreate(page) {
        await syncClient.sync();
        await this.refreshSidebar();
        this.openPage(page.id);
    }

    async syncNow() {
        await this.pages.flushSaves();
        await syncClient.sync();
        if (syncClient.status === 'idle') toast('All changes synced');
    }

    openTrash() {
        openTrashDialog({ storage, sync: syncClient, onChanged: () => this.refreshSidebar() });
    }

    openSettings() {
        openSettingsDialog({ onLogout: () => this.signOut(), theme, journal: this.journal, storage });
    }

    openHistory() {
        const page = this.pages.page;
        openHistoryDialog(page, {
            onRestored: async () => {
                await syncClient.sync();
                await this.pages.reconcile();
                this.renderHeader();
            },
        });
    }

    insertAtEnd() {
        const records = this.pages.children(null);
        const last = records[records.length - 1];
        this.picker.openGrid({
            anchor: this.el.blocks.lastElementChild || this.el.blocks,
            onSelect: (entry) =>
                this.pages.createBlock({
                    type: entry.type,
                    content: entry.content,
                    afterId: last?.id ?? null,
                    focus: true,
                }),
        });
    }

    // --- Chrome bindings ----------------------------------------------------------------

    bindChrome() {
        $('#new-page').addEventListener('click', () => this.createPage());
        $('#welcome-new').addEventListener('click', () => this.createPage());
        $('#open-today').addEventListener('click', () => this.openJournal());
        $('#welcome-today').addEventListener('click', () => this.openJournal());
        $('#welcome-template').addEventListener('click', () =>
            openTemplatesDialog({ onCreated: (p) => this.afterServerCreate(p) }),
        );
        $('#welcome-import').addEventListener('click', () =>
            openImportDialog({ onImported: (p) => this.afterServerCreate(p) }),
        );
        $('#open-templates').addEventListener('click', () =>
            openTemplatesDialog({ onCreated: (p) => this.afterServerCreate(p) }),
        );
        $('#open-import').addEventListener('click', () =>
            openImportDialog({ onImported: (p) => this.afterServerCreate(p) }),
        );
        $('#open-trash').addEventListener('click', () => this.openTrash());
        $('#open-settings').addEventListener('click', () => this.openSettings());
        $('#open-palette').addEventListener('click', () => this.palette.open('actions'));
        $('#open-search').addEventListener('click', () => this.palette.open('search'));
        $('#toggle-sidebar').addEventListener('click', () => this.layout.toggle());
        $('#close-sidebar').addEventListener('click', () => this.layout.toggle());
        $('#scrim').addEventListener('click', () => this.el.app.classList.remove('sidebar-open'));
        $('#verify-reminder').addEventListener('click', async () => {
            await api.post('/api/auth/request-verification', { email: auth.user.email });
            toast('Verification email sent — check your inbox');
        });
        this.el.syncStatus.addEventListener('click', async () => {
            if ((await storage.getConflicts()).length) openConflictsDialog({ storage, sync: syncClient });
            else this.syncNow();
        });

        $('#action-share').addEventListener('click', () => openShareDialog(this.pages.page));
        $('#action-comments').addEventListener('click', () => this.comments.toggle());
        $('#action-history').addEventListener('click', () => this.openHistory());
        $('#action-more').addEventListener('click', (event) => {
            const page = this.pages.page;
            showMenu(event.currentTarget, [
                { heading: 'export' },
                { icon: 'M↓', label: 'Markdown', onSelect: () => this.exportPage('markdown') },
                { icon: '{}', label: 'JSON', onSelect: () => this.exportPage('json') },
                { icon: '⎙', label: 'PDF (print)', onSelect: () => this.exportPage('pdf') },
                { separator: true },
                { icon: '⧉', label: 'Duplicate page', onSelect: () => this.duplicatePage() },
                {
                    icon: '★',
                    label: page.is_template ? 'Duplicate as template' : 'Save as template',
                    disabled: page.role !== 'owner',
                    onSelect: () => this.duplicatePage(true),
                },
                page.is_template && page.role === 'owner'
                    ? {
                          icon: '☆',
                          label: 'Stop using as template',
                          onSelect: () => this.updatePage({ is_template: false }),
                      }
                    : {
                          icon: '☆',
                          label: 'Mark as template',
                          disabled: page.role !== 'owner',
                          onSelect: () => this.updatePage({ is_template: true }),
                      },
                { separator: true },
                {
                    icon: '🗑',
                    label: 'Move to trash',
                    danger: true,
                    disabled: page.role !== 'owner',
                    onSelect: () => this.deletePage(page.id),
                },
            ]);
        });

        const saveTitle = debounce((title) => this.updatePage({ title: title || 'Untitled' }), 500);
        this.el.title.addEventListener('input', () => {
            const title = this.el.title.textContent.replace(/\s+/g, ' ').trim().slice(0, 200);
            this.pages.page.title = title || 'Untitled';
            document.title = `${title || 'Untitled'} — nosk`;
            saveTitle(title);
        });
        this.el.title.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || (event.key === 'ArrowDown' && !event.shiftKey)) {
                event.preventDefault();
                saveTitle.flush();
                const first = this.pages.children(null)[0];
                if (!first || !this.pages.focusBlock(first.id, 'start')) {
                    this.pages.createBlock({ type: 'text-block', afterId: null, focus: true });
                }
            }
        });
        this.el.title.addEventListener('paste', (event) => {
            event.preventDefault();
            document.execCommand('insertText', false, event.clipboardData.getData('text/plain').replace(/\s+/g, ' '));
        });
        this.el.icon.addEventListener('click', () => {
            const icons = ['📝', '📋', '🚀', '💡', '📚', '🗓️', '✅', '🎯', '🧪', '🛠️', '📈', '🌱', '✈️', '🎨', '🔒'];
            showMenu(
                this.el.icon,
                [
                    ...icons.map((icon) => ({ icon, label: icon, onSelect: () => this.updatePage({ icon }) })),
                    { separator: true },
                    {
                        icon: '✎',
                        label: 'Custom emoji…',
                        onSelect: () => {
                            const value = window.prompt('Page icon (emoji)', this.pages.page.icon || '');
                            if (value !== null)
                                this.updatePage({ icon: value.trim() ? [...value.trim()].slice(0, 2).join('') : null });
                        },
                    },
                    { icon: '×', label: 'Remove icon', onSelect: () => this.updatePage({ icon: null }) },
                ],
                { className: 'menu--icons' },
            );
        });
    }

    // --- Block chrome (plus button, handle menu, comments) -------------------------------

    bindBlocks() {
        this.el.blocks.addEventListener('click', (event) => {
            const plus = event.target.closest('.block__plus');
            const handle = event.target.closest('.block__handle');
            const badge = event.target.closest('.block__comment-badge');
            const block = event.target.closest('.block');
            if (plus && block) this.openInsertPicker(block.dataset.componentId, plus);
            else if (handle && block) this.openBlockMenu(block.dataset.componentId, handle);
            else if (badge) this.comments.open(badge.dataset.componentId);
        });
        this.el.blocks.addEventListener('contextmenu', (event) => {
            const block = event.target.closest('.block[data-component-id]');
            if (!block || this.pages.readOnly || isEditableTarget(event.target)) return;
            event.preventDefault();
            this.openBlockMenu(block.dataset.componentId, new DOMRect(event.clientX, event.clientY, 0, 0));
        });
        // Clicking the empty area under the last block continues writing at the end.
        this.el.editor.querySelector('.editor__tail').addEventListener('click', () => {
            if (this.pages.readOnly || !this.pages.page) return;
            const top = this.pages.children(null);
            const last = top[top.length - 1];
            const lastInstance = last && this.pages.instances.get(last.id);
            if (last?.type === 'text-block' && lastInstance?.isEmpty()) this.pages.focusBlock(last.id);
            else this.pages.createBlock({ type: 'text-block', afterId: last?.id ?? null, focus: true });
        });
    }

    openInsertPicker(id, anchor) {
        const record = this.pages.records.get(id);
        const instance = this.pages.instances.get(id);
        this.picker.openGrid({
            anchor,
            onSelect: (entry) => {
                if (record.type === 'text-block' && instance?.isEmpty())
                    this.pages.replaceBlock(id, entry.type, entry.content);
                else
                    this.pages.createBlock({
                        type: entry.type,
                        content: entry.content,
                        parentId: record.parent_id ?? null,
                        slot: record.slot,
                        afterId: id,
                        focus: true,
                    });
            },
        });
    }

    openBlockMenu(id, anchor) {
        const record = this.pages.records.get(id);
        if (!record) return;
        const readOnly = this.pages.readOnly;
        const conversions = CONVERTIBLE_TYPES.filter((type) => canConvert(record.type, type)).map((type) => {
            const info = registry.getComponentInfo(type);
            return { icon: info.icon, label: info.label, onSelect: () => this.pages.convertBlock(id, type) };
        });
        const mod = isMac() ? '⌘' : 'Ctrl+';
        const items = [
            { heading: registry.getComponentInfo(record.type).label.toLowerCase() },
            { icon: '💬', label: 'Comment', onSelect: () => this.comments.open(id) },
            {
                icon: '🔗',
                label: 'Copy link to block',
                onSelect: () => {
                    navigator.clipboard?.writeText(
                        `${window.location.origin}${window.location.pathname}#/page/${record.page_id}?block=${id}`,
                    );
                    toast('Link copied');
                },
            },
        ];
        if (!readOnly) {
            items.push(
                { icon: '⧉', label: 'Duplicate', hint: `${mod}D`, onSelect: () => this.pages.duplicateBlock(id) },
                { icon: '↑', label: 'Move up', hint: `${mod}↑`, onSelect: () => this.pages.moveBy(id, -1) },
                { icon: '↓', label: 'Move down', hint: `${mod}↓`, onSelect: () => this.pages.moveBy(id, 1) },
            );
            if (record.parent_id) {
                const container = this.pages.records.get(record.parent_id);
                items.push({
                    icon: '⇤',
                    label: 'Move out of container',
                    onSelect: () =>
                        this.pages.moveBlock(id, {
                            parentId: container?.parent_id ?? null,
                            slot: container?.slot ?? 0,
                            afterId: record.parent_id,
                        }),
                });
            }
            if (conversions.length) items.push({ separator: true }, { heading: 'turn into' }, ...conversions);
            items.push(
                { separator: true },
                {
                    icon: '🗑',
                    label: 'Delete',
                    hint: 'Del',
                    danger: true,
                    onSelect: () => this.pages.deleteBlock(id, { focusPrevious: true }),
                },
            );
        }
        showMenu(anchor, items);
    }

    handleDrop(id, target) {
        if (target.kind === 'slot') {
            this.pages.moveBlock(id, { parentId: target.parentId, slot: target.slot, afterId: null });
            return;
        }
        const targetRecord = this.pages.records.get(target.id);
        if (!targetRecord) return;
        const parentId = targetRecord.parent_id ?? null;
        let afterId = target.id;
        if (target.kind === 'before') {
            const siblings = this.pages.siblings(target.id).filter((r) => r.id !== id);
            const index = siblings.findIndex((r) => r.id === target.id);
            afterId = index > 0 ? siblings[index - 1].id : null;
        }
        this.pages.moveBlock(id, { parentId, slot: targetRecord.slot, afterId });
    }

    // --- Keyboard -----------------------------------------------------------------------

    bindKeyboard() {
        const k = this.keyboard;
        k.bind('mod+k', () => this.palette.open('actions'));
        k.bind('mod+f', () => this.palette.open('search'));
        k.bind('mod+s', () => this.syncNow());
        k.bind('mod+alt+n', () => this.createPage());
        k.bind('mod+alt+j', () => this.openJournal());
        k.bind('mod+\\', () => this.layout.toggle());
        k.bind('mod+shift+c', () => this.pages.page && this.comments.toggle());
        // Text undo inside an editable stays native; block-level undo applies elsewhere.
        k.bind(
            'mod+z',
            () => {
                this.pages.undo();
            },
            { whenEditing: false },
        );
        k.bind(
            'mod+shift+z',
            () => {
                this.pages.redo();
            },
            { whenEditing: false },
        );
        k.bind(
            'mod+y',
            () => {
                this.pages.redo();
            },
            { whenEditing: false },
        );
        k.bind('mod+arrowup', (event, blockId) => (blockId ? this.pages.moveBy(blockId, -1) : false));
        k.bind('mod+arrowdown', (event, blockId) => (blockId ? this.pages.moveBy(blockId, 1) : false));
        k.bind('mod+d', (event, blockId) => (blockId ? this.pages.duplicateBlock(blockId) : false));
        k.bind('mod+enter', (event, blockId) => {
            if (!blockId) return false;
            const record = this.pages.records.get(blockId);
            this.pages.createBlock({
                type: 'text-block',
                parentId: record?.parent_id ?? null,
                slot: record?.slot ?? 0,
                afterId: blockId,
                focus: true,
            });
            return true;
        });
        k.bind('escape', () => {
            if (this.el.app.classList.contains('sidebar-open')) {
                this.el.app.classList.remove('sidebar-open');
                return true;
            }
            const block = document.activeElement?.closest?.('.block');
            if (block) {
                document.activeElement.blur();
                block.querySelector('.block__handle')?.focus();
                return true;
            }
            return false;
        });
        k.bind(
            'delete',
            (event, blockId) => {
                if (!blockId || !event.target.classList.contains('block__handle')) return false;
                this.pages.deleteBlock(blockId, { focusPrevious: true });
                return true;
            },
            { whenEditing: false },
        );
        k.bind(
            'backspace',
            (event, blockId) => {
                if (!blockId || !event.target.classList.contains('block__handle')) return false;
                this.pages.deleteBlock(blockId, { focusPrevious: true });
                return true;
            },
            { whenEditing: false },
        );
        k.bind(
            'enter',
            () => {
                if (this.pages.page && !this.pages.records.size && !this.pages.readOnly) {
                    this.pages.createBlock({ type: 'text-block', focus: true });
                    return true;
                }
                return false;
            },
            { whenEditing: false },
        );
        k.attach();
    }

    // --- Sync events --------------------------------------------------------------------

    bindSync() {
        syncClient.on('status', ({ status, pending = 0, conflicts }) =>
            this.renderSyncStatus(status, pending, conflicts),
        );
        syncClient.on('changes', async ({ pageIds }) => {
            await this.refreshSidebar();
            if (this.currentPageId && pageIds.includes(this.currentPageId)) {
                await this.pages.reconcile();
            }
        });
        syncClient.on('bootstrapped', () => this.refreshSidebar());
        syncClient.on('conflict', () => {
            toast('A change conflicted with an edit from another device.', {
                type: 'warning',
                timeout: 8000,
                action: { label: 'Review', onSelect: () => openConflictsDialog({ storage, sync: syncClient }) },
            });
        });
        syncClient.on('rejected', ({ conflict }) => {
            toast(
                `A change was rejected by the server: ${conflict.message || conflict.reason}. Reloaded the page from the server.`,
                { type: 'error', timeout: 7000 },
            );
        });
        syncClient.on('presence', (message) => {
            if (message.page_id !== this.currentPageId) return;
            this.presence = message.viewers;
            this.renderPresence();
        });
        syncClient.on('comment', (change) => this.comments.applyRemote(change));
        syncClient.on('live', (connected) => this.el.syncStatus.classList.toggle('is-live', connected));
        this.pages.on('page-updated', () => this.renderHeader());
        this.pages.on('page-removed', ({ gone, pageId }) => {
            if (!gone) return;
            toast('This page was deleted or is no longer shared with you.', { type: 'warning' });
            if (pageId === this.currentPageId) {
                this.currentPageId = null;
                history.replaceState(null, '', '#/');
                this.route();
            }
        });
    }

    async renderSyncStatus(status, pending, conflicts) {
        const conflictCount = conflicts ?? (await storage.getConflicts()).length;
        const labels = {
            idle: pending ? `${pending} pending` : 'synced',
            syncing: 'syncing',
            offline: `offline${pending ? ` · ${pending} queued` : ''}`,
            error: 'sync error',
        };
        const state = conflictCount ? 'conflict' : status;
        this.el.syncStatus.dataset.state = state;
        this.el.syncStatus.querySelector('.sync-status__label').textContent = conflictCount
            ? `${conflictCount} conflict${conflictCount === 1 ? '' : 's'}`
            : labels[status] || status;
        this.el.syncStatus.title = conflictCount ? 'Review sync conflicts' : 'Sync now';
    }

    registerServiceWorker() {
        if ('serviceWorker' in navigator && window.location.protocol !== 'file:') {
            navigator.serviceWorker.register('sw.js').catch(() => {});
        }
    }
}

const app = new App();
app.start().catch((error) => {
    console.error(error);
    if (error instanceof ApiError && error.status === 401) window.location.replace('login.html');
});
window.nosk = app;
