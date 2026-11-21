import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Sidebar } from '../js/sidebar.js';

let container;
let handlers;
let sidebar;

const page = (id, fields = {}) => ({
    id,
    title: id,
    role: 'owner',
    is_template: false,
    deleted: false,
    tags: [],
    updated_at: 1,
    ...fields,
});

beforeEach(() => {
    localStorage.clear();
    container = document.createElement('div');
    container.innerHTML = '<input data-sidebar-filter><div data-sidebar-tags></div><nav data-sidebar-list></nav>';
    handlers = { onOpen: vi.fn(), onUseTemplate: vi.fn() };
    sidebar = new Sidebar({ container, ...handlers });
    sidebar.setBuiltinTemplates([{ id: 'builtin-daily-journal', title: 'Daily journal', icon: '📓' }]);
    sidebar.setPages([
        page('Notes'),
        page('Weekly review', { is_template: true }),
        page('From Ana', { role: 'viewer', owner_email: 'ana@example.com' }),
    ]);
});

const sectionLabels = () => [...container.querySelectorAll('.nav-section__header .eyebrow')].map((n) => n.textContent);

describe('Sidebar', () => {
    test('templates sit in their own group below a divider', () => {
        const children = [...container.querySelector('[data-sidebar-list]').children];
        const divider = children.findIndex((n) => n.classList.contains('nav-divider'));
        expect(divider).toBeGreaterThan(0);
        expect(children[divider + 1].classList.contains('nav-section--templates')).toBe(true);
        expect(sectionLabels()).toEqual(['01/pages', '02/shared', '03/templates']);
        // Templates never appear among your pages.
        const pagesSection = children[0];
        expect(pagesSection.textContent).toContain('Notes');
        expect(pagesSection.textContent).not.toContain('Weekly review');
        expect(pagesSection.textContent).not.toContain('Daily journal');
    });

    test('lists your templates and built-ins; clicking uses the template', () => {
        const rows = [...container.querySelectorAll('.nav-template')];
        expect(rows.map((r) => r.dataset.templateId)).toEqual(['Weekly review', 'builtin-daily-journal']);
        rows[1].querySelector('.nav-template__use').click();
        expect(handlers.onUseTemplate).toHaveBeenCalledWith('builtin-daily-journal');
        rows[0].querySelector('.nav-template__edit').click();
        expect(handlers.onOpen).toHaveBeenCalledWith('Weekly review');
        expect(rows[1].querySelector('.nav-template__edit')).toBeNull();
    });

    test('numbers only the sections shown and keeps the templates group when empty', () => {
        sidebar.setBuiltinTemplates([]);
        sidebar.setPages([page('Solo')]);
        expect(sectionLabels()).toEqual(['01/pages', '02/templates']);
        expect(container.querySelector('.nav-section--templates .nav-empty').textContent).toMatch(/template/);
    });

    test('filtering applies to templates too', () => {
        const filter = container.querySelector('[data-sidebar-filter]');
        filter.value = 'journal';
        filter.dispatchEvent(new Event('input'));
        expect([...container.querySelectorAll('.nav-template')].map((r) => r.dataset.templateId)).toEqual([
            'builtin-daily-journal',
        ]);
        expect(container.querySelector('.nav-section .nav-empty').textContent).toBe('No matches');
    });

    test('pages made from a template are grouped under that template', async () => {
        const { localDate, addDays } = await import('../js/journal.js');
        const today = localDate();
        const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1);
        const tpl = 'builtin-daily-journal';
        sidebar.setPages([
            page('Notes'),
            page('Weekly review', { is_template: true }),
            page('Week 42', { template_id: 'Weekly review' }),
            page('Daily journal', { template_id: tpl }),
            page(`${today} · Custom`, { journal_date: today, template_id: tpl }),
            page('old', { journal_date: lastMonth, template_id: tpl }),
            page('blank day', { journal_date: lastMonth.slice(0, 8) + '01' }),
        ]);
        expect(sectionLabels()).toEqual([
            '01/pages',
            '02/Daily journal',
            '03/journal',
            '04/Weekly review',
            '05/templates',
        ]);
        const groups = [...container.querySelectorAll('.nav-section--group')];
        expect(groups.map((g) => g.dataset.group)).toEqual([tpl, 'journal', 'Weekly review']);
        // Scratch pages only under "pages".
        expect(container.querySelector('.nav-section').textContent).toContain('Notes');
        expect(container.querySelector('.nav-section').textContent).not.toContain('Week 42');

        const daily = groups[0];
        // Undated page first, then months: current open with today marked, older collapsed.
        expect(daily.querySelector('.nav-page').textContent).toContain('Daily journal');
        const months = [...daily.querySelectorAll('.nav-month')];
        expect(months.map((m) => m.getAttribute('aria-expanded'))).toEqual(['true', 'false']);
        const days = [...daily.querySelectorAll('.nav-page--journal')];
        expect(days).toHaveLength(1);
        expect(days[0].textContent).toContain('today');
        months[1].click();
        expect(
            container.querySelectorAll('.nav-section--group')[0].querySelectorAll('.nav-page--journal'),
        ).toHaveLength(2);

        // Whole groups collapse.
        container.querySelectorAll('.nav-section--group')[0].querySelector('.nav-section__header').click();
        expect(container.querySelectorAll('.nav-section--group')[0].querySelectorAll('.nav-page')).toHaveLength(0);
        expect(sidebar.groupName({ template_id: 'gone' })).toBe('removed template');
        expect(sidebar.groupName({})).toBeNull();
    });
});
