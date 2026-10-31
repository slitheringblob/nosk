import { journalTitle, localDate, monthLabel, weekday } from './journal.js';
import { el } from './utils.js';

function readCollapsed() {
    try {
        return new Set(JSON.parse(localStorage.getItem('nosk.sidebar.collapsed') || '[]'));
    } catch {
        return new Set();
    }
}

/**
 * Page navigation. Your content comes first: pages started from scratch, then one collapsible
 * group per template holding everything made from it (named after the template), then pages
 * shared with you. Templates themselves live below a divider; clicking one creates a new page
 * from it, and your own templates can also be opened for editing.
 */
export class Sidebar {
    constructor({ container, onOpen, onTag, onUseTemplate }) {
        this.container = container;
        this.onOpen = onOpen;
        this.onTag = onTag;
        this.onUseTemplate = onUseTemplate;
        this.list = container.querySelector('[data-sidebar-list]');
        this.tagsEl = container.querySelector('[data-sidebar-tags]');
        this.filterInput = container.querySelector('[data-sidebar-filter]');
        this.pages = [];
        this.builtinTemplates = [];
        this.activeId = null;
        this.tag = null;
        this.collapsed = readCollapsed();
        this.filterInput?.addEventListener('input', () => this.render());
    }

    setPages(pages) {
        this.pages = pages;
        this.render();
    }

    /** Built-in templates come from the server: [{ id, title, icon, description }]. */
    setBuiltinTemplates(templates) {
        this.builtinTemplates = templates;
        this.render();
    }

    setActive(id) {
        this.activeId = id;
        this.list
            .querySelectorAll('[data-page-id]')
            .forEach((node) => node.classList.toggle('is-active', node.dataset.pageId === id));
    }

    setTag(tag) {
        this.tag = this.tag === tag ? null : tag;
        this.render();
    }

    toggleSection(id) {
        if (this.collapsed.has(id)) this.collapsed.delete(id);
        else this.collapsed.add(id);
        try {
            localStorage.setItem('nosk.sidebar.collapsed', JSON.stringify([...this.collapsed]));
        } catch {
            // Collapsed state just won't persist.
        }
        this.render();
    }

    sectionHeader(id, label, count, number) {
        const header = el(
            'button',
            { type: 'button', className: 'nav-section__header', ariaExpanded: String(!this.collapsed.has(id)) },
            el('span', { className: 'eyebrow' }, `${String(number).padStart(2, '0')}/${label}`),
            el('span', { className: 'nav-section__count' }, String(count)),
        );
        header.addEventListener('click', () => this.toggleSection(id));
        return header;
    }

    pageLink(page) {
        const link = el(
            'a',
            {
                className: `nav-page${page.id === this.activeId ? ' is-active' : ''}`,
                href: `#/page/${page.id}`,
                dataset: { pageId: page.id },
                title: page.owner_email ? `Shared by ${page.owner_email}` : page.title,
            },
            el('span', { className: 'nav-page__icon' }, page.icon || '·'),
            el('span', { className: 'nav-page__title' }, page.title || 'Untitled'),
            page.role === 'viewer' ? el('span', { className: 'nav-page__badge' }, 'ro') : null,
        );
        link.addEventListener('click', (event) => {
            event.preventDefault();
            this.onOpen(page.id);
        });
        return link;
    }

    templateRow({ id, title, icon, builtin, pageId }) {
        const row = el('div', {
            className: `nav-template${pageId && pageId === this.activeId ? ' is-active' : ''}`,
            dataset: { templateId: id, ...(pageId ? { pageId } : {}) },
        });
        const use = el(
            'button',
            { type: 'button', className: 'nav-template__use', title: `New page from "${title}"` },
            el('span', { className: 'nav-page__icon' }, icon || '⧉'),
            el('span', { className: 'nav-page__title' }, title || 'Untitled'),
            el('span', { className: 'nav-template__hint' }, '+ use'),
        );
        use.addEventListener('click', () => this.onUseTemplate?.(id));
        row.append(use);
        if (builtin) {
            row.append(el('span', { className: 'nav-page__badge', title: 'Built-in template' }, 'built-in'));
        } else {
            const edit = el(
                'button',
                {
                    type: 'button',
                    className: 'icon-btn nav-template__edit',
                    title: `Edit template "${title}"`,
                    ariaLabel: `Edit template ${title}`,
                },
                '✎',
            );
            edit.addEventListener('click', () => this.onOpen(pageId));
            row.append(edit);
        }
        return row;
    }

    /**
     * Name of the template a page came from, or null for pages started from scratch. Journal
     * entries made from a blank page group under "journal".
     */
    groupName(page) {
        const templateId = page.template_id;
        if (!templateId) return page.journal_date ? 'journal' : null;
        const builtin = this.builtinTemplates.find((t) => t.id === templateId);
        if (builtin) return builtin.title;
        const mine = this.pages.find((p) => p.id === templateId && p.is_template);
        if (mine) return mine.deleted ? `${mine.title} (deleted template)` : mine.title;
        return 'removed template';
    }

    groupKey(page) {
        return page.template_id || (page.journal_date ? 'journal' : null);
    }

    dayLink(page, today) {
        const date = page.journal_date;
        const link = this.pageLink(page);
        link.classList.add('nav-page--journal');
        link.querySelector('.nav-page__icon').textContent = date.slice(8);
        link.querySelector('.nav-page__title').textContent =
            page.title === journalTitle(date) ? weekday(date) : `${weekday(date)} · ${page.title}`;
        if (date === today) link.append(el('span', { className: 'nav-page__badge nav-page__badge--today' }, 'today'));
        return link;
    }

    /**
     * Everything made from one template, under a collapsible section named after it. Undated
     * pages come first (most recent first); dated journal entries follow, grouped by month with
     * the current month open.
     */
    templateGroupSection(key, name, pages, number) {
        const id = `group:${key}`;
        const section = el(
            'section',
            { className: 'nav-section nav-section--group', dataset: { group: key } },
            this.sectionHeader(id, name, pages.length, number),
        );
        if (this.collapsed.has(id)) return section;
        const filtering = Boolean((this.filterInput?.value || '').trim() || this.tag);
        const today = localDate();
        const undated = pages.filter((p) => !p.journal_date).sort((a, b) => b.updated_at - a.updated_at);
        section.append(...undated.map((page) => this.pageLink(page)));
        const months = new Map();
        for (const page of pages
            .filter((p) => p.journal_date)
            .sort((a, b) => b.journal_date.localeCompare(a.journal_date))) {
            const month = page.journal_date.slice(0, 7);
            if (!months.has(month)) months.set(month, []);
            months.get(month).push(page);
        }
        const currentMonth = today.slice(0, 7);
        for (const [month, entries] of months) {
            const monthKey = `${id}:${month}`;
            // Older months start collapsed; the toggle flips that default.
            const open =
                filtering || (month === currentMonth ? !this.collapsed.has(monthKey) : this.collapsed.has(monthKey));
            const toggle = el(
                'button',
                { type: 'button', className: 'nav-month', ariaExpanded: String(open) },
                el('span', {}, monthLabel(`${month}-01`)),
                el('span', { className: 'nav-section__count' }, String(entries.length)),
            );
            toggle.addEventListener('click', () => this.toggleSection(monthKey));
            section.append(toggle);
            if (open) section.append(...entries.map((page) => this.dayLink(page, today)));
        }
        return section;
    }

    render() {
        const query = (this.filterInput?.value || '').trim().toLowerCase();
        const filtering = Boolean(query || this.tag);
        const live = this.pages.filter((page) => !page.deleted);
        const matchesQuery = (title) => !query || (title || '').toLowerCase().includes(query);
        const matches = (page) => matchesQuery(page.title) && (!this.tag || (page.tags || []).includes(this.tag));
        const byRecent = (a, b) => b.updated_at - a.updated_at;
        let number = 0;
        const sections = [];

        const pushGroup = (id, label, pages, always) => {
            if (!pages.length && !always) return;
            number += 1;
            const collapsed = this.collapsed.has(id);
            const items = collapsed ? [] : pages.map((page) => this.pageLink(page));
            if (!collapsed && !pages.length) {
                items.push(el('div', { className: 'nav-empty' }, filtering ? 'No matches' : 'No pages yet'));
            }
            sections.push(
                el(
                    'section',
                    { className: 'nav-section' },
                    this.sectionHeader(id, label, pages.length, number),
                    ...items,
                ),
            );
        };

        // Your content: pages started from scratch, one group per template, then shared pages.
        const owned = live.filter((p) => p.role === 'owner' && !p.is_template).filter(matches);
        pushGroup('pages', 'pages', owned.filter((p) => !this.groupKey(p)).sort(byRecent), true);
        const groups = new Map();
        for (const page of owned) {
            const key = this.groupKey(page);
            if (!key) continue;
            if (!groups.has(key)) groups.set(key, { name: this.groupName(page), pages: [] });
            groups.get(key).pages.push(page);
        }
        for (const [key, group] of [...groups].sort((a, b) => a[1].name.localeCompare(b[1].name))) {
            number += 1;
            sections.push(this.templateGroupSection(key, group.name, group.pages, number));
        }
        pushGroup(
            'shared',
            'shared',
            live
                .filter((p) => p.role !== 'owner')
                .filter(matches)
                .sort(byRecent),
            false,
        );

        // Templates: always shown below a divider, built-ins first, then yours.
        const mine = live
            .filter((p) => p.role === 'owner' && p.is_template && matches(p))
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((p) => ({ id: p.id, pageId: p.id, title: p.title, icon: p.icon, builtin: false }));
        const builtins = this.tag
            ? []
            : this.builtinTemplates
                  .filter((t) => matchesQuery(t.title))
                  .map((t) => ({ id: t.id, title: t.title, icon: t.icon, builtin: true }));
        const templates = [...mine, ...builtins];
        number += 1;
        const collapsed = this.collapsed.has('templates');
        const items = [];
        if (!collapsed) {
            items.push(...templates.map((template) => this.templateRow(template)));
            if (!templates.length) {
                items.push(
                    el(
                        'div',
                        { className: 'nav-empty' },
                        filtering ? 'No matches' : 'Save any page as a template from its ⋯ menu',
                    ),
                );
            }
        }
        sections.push(el('div', { className: 'nav-divider', role: 'separator' }));
        sections.push(
            el(
                'section',
                { className: 'nav-section nav-section--templates' },
                this.sectionHeader('templates', 'templates', templates.length, number),
                ...items,
            ),
        );
        this.list.replaceChildren(...sections);

        const counts = new Map();
        for (const page of live) {
            if (page.is_template) continue;
            for (const tag of page.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
        }
        this.tagsEl.replaceChildren(
            ...[...counts.entries()].sort().map(([tag, count]) => {
                const chip = el(
                    'button',
                    { type: 'button', className: `tag-filter${tag === this.tag ? ' is-active' : ''}` },
                    `#${tag}`,
                    el('span', {}, String(count)),
                );
                chip.addEventListener('click', () => {
                    this.setTag(tag);
                    this.onTag?.(this.tag);
                });
                return chip;
            }),
        );
        this.tagsEl.hidden = !counts.size;
    }
}
