import { afterEach, describe, expect, test, vi } from 'vitest';
import registry from '../../js/components/registry.js';
import { numberLabels } from '../../js/components/numbered-list.js';
import { resolveEmbed } from '../../js/components/embed.js';
import { matchesFilter, sortRows } from '../../js/components/database.js';
import { filterEntries } from '../../js/component-picker.js';

const mounted = [];
function mount(type, content, options = {}) {
    const component = registry.create(type, { id: `c-${type}`, content }, { services: {}, ...options });
    document.body.append(component.render());
    mounted.push(component);
    return component;
}

afterEach(() => {
    mounted.splice(0).forEach((component) => component.destroy());
});

describe('registry', () => {
    test('all 26 block types from the plan are registered', () => {
        expect(registry.getAvailableTypes()).toHaveLength(26);
    });

    test('every type renders with defaults, editable and read-only', () => {
        for (const type of registry.getAvailableTypes()) {
            const editable = mount(type);
            expect(editable.element.dataset.componentType).toBe(type);
            expect(editable.serialize()).toMatchObject({ id: `c-${type}`, type });
            const readOnly = mount(type, undefined, { readOnly: true });
            expect(readOnly.element.querySelector('[contenteditable="true"]')).toBeNull();
            expect(readOnly.element.querySelector('.block__gutter')).toBeNull();
        }
    });

    test('picker entries expand headings into H1-H3 with plan commands', () => {
        const entries = registry.pickerEntries();
        expect(entries.filter((e) => e.type === 'heading').map((e) => e.commands[0])).toEqual(['h1', 'h2', 'h3']);
        expect(filterEntries(entries, 'check')[0].type).toBe('checklist');
        expect(filterEntries(entries, 'h2')[0].content).toEqual({ text: '', level: 2 });
        expect(filterEntries(entries, 'youtube')[0].type).toBe('embed');
    });
});

describe('text block', () => {
    test('input updates content through onChange', () => {
        const onChange = vi.fn();
        const block = mount('text-block', { text: '', format: 'html' }, { onChange });
        const editable = block.element.querySelector('.text-block-content');
        editable.innerHTML = 'Hello <b>world</b><script>x</script>';
        editable.dispatchEvent(new Event('input'));
        expect(onChange).toHaveBeenCalledWith(block);
        expect(block.content.text).toBe('Hello <b>world</b>');
    });

    test('markdown shortcuts ask to replace the block', () => {
        const onReplace = vi.fn();
        const block = mount('text-block', {}, { hooks: { onReplace } });
        const editable = block.element.querySelector('.text-block-content');
        editable.textContent = '## ';
        editable.dispatchEvent(new Event('input'));
        expect(onReplace).toHaveBeenCalledWith(block, 'heading', { text: '', level: 2 });
        editable.textContent = '[] ';
        editable.dispatchEvent(new Event('input'));
        expect(onReplace.mock.calls[1][1]).toBe('checklist');
    });

    test('setContent re-renders without notifying', () => {
        const onChange = vi.fn();
        const block = mount('text-block', { text: 'a' }, { onChange });
        block.setContent({ text: 'remote', format: 'html' });
        expect(block.element.textContent).toContain('remote');
        expect(onChange).not.toHaveBeenCalled();
    });
});

describe('lists', () => {
    test('checking a task checks its sub-tasks', () => {
        const items = [
            { id: '1', text: 'parent', checked: false, indent_level: 0 },
            { id: '2', text: 'child', checked: false, indent_level: 1 },
            { id: '3', text: 'sibling', checked: false, indent_level: 0 },
        ];
        const list = mount('checklist', { items });
        const box = list.element.querySelector('.checklist-checkbox');
        box.checked = true;
        box.dispatchEvent(new Event('change'));
        expect(list.content.items.map((i) => i.checked)).toEqual([true, true, false]);
        expect(list.element.querySelector('.checklist-progress__label').textContent).toBe('2/3');
    });

    test('hierarchical numbering', () => {
        const levels = [0, 1, 1, 2, 0, 1].map((indent_level) => ({ indent_level }));
        expect(numberLabels(levels)).toEqual(['1', '1.1', '1.2', '1.2.1', '2', '2.1']);
        expect(numberLabels([{ indent_level: 0 }, { indent_level: 0 }], 5)).toEqual(['5', '6']);
    });

    test('tab indents an item up to level 3', () => {
        const list = mount('bullet-list', { items: [{ id: '1', text: 'x', indent_level: 2 }] });
        const text = list.element.querySelector('.list-item__text');
        for (let i = 0; i < 3; i += 1) text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
        expect(list.content.items[0].indent_level).toBe(3);
    });
});

describe('structured blocks', () => {
    test('embed only frames known providers', () => {
        expect(resolveEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({
            provider: 'youtube',
            src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
        });
        expect(resolveEmbed('https://youtu.be/dQw4w9WgXcQ').provider).toBe('youtube');
        expect(resolveEmbed('https://evil.example.com/x')).toBeNull();
    });

    test('database filter and sort', () => {
        const rows = [
            { id: 'a', cells: { n: 3, t: 'pear', d: true } },
            { id: 'b', cells: { n: 1, t: 'apple' } },
            { id: 'c', cells: { n: 2, t: 'Apricot', d: false } },
        ];
        const num = { id: 'n', type: 'number' };
        const text = { id: 't', type: 'text' };
        const check = { id: 'd', type: 'checkbox' };
        expect(sortRows(rows, { column_id: 'n', direction: 'asc' }, num).map((r) => r.id)).toEqual(['b', 'c', 'a']);
        expect(sortRows(rows, { column_id: 't', direction: 'desc' }, text).map((r) => r.id)).toEqual(['a', 'c', 'b']);
        expect(
            rows
                .filter((r) => matchesFilter(r, { column_id: 't', op: 'contains', value: 'ap' }, text))
                .map((r) => r.id),
        ).toEqual(['b', 'c']);
        expect(rows.filter((r) => matchesFilter(r, { column_id: 'n', op: 'gt', value: '1' }, num))).toHaveLength(2);
        expect(
            rows.filter((r) => matchesFilter(r, { column_id: 'd', op: 'checked', value: '' }, check)).map((r) => r.id),
        ).toEqual(['a']);
    });

    test('table grows with + Row', () => {
        const table = mount('table');
        const addRow = [...table.element.querySelectorAll('.table-actions button')].find(
            (b) => b.textContent === '+ Row',
        );
        addRow.click();
        expect(table.content.rows).toHaveLength(4);
        expect(table.element.querySelectorAll('tr')).toHaveLength(4);
    });

    test('tags normalise and dedupe', () => {
        const tags = mount('tags', { tags: [] });
        tags.addTag('#Work');
        tags.addTag('work');
        expect(tags.content.tags).toEqual(['work']);
    });

    test('containers expose child slots', () => {
        const columns = mount('columns', { count: 3 });
        expect(columns.slotCount()).toBe(3);
        expect(columns.getSlotElement(2).dataset).toMatchObject({ parentId: 'c-columns', slot: '2' });
        const toggle = mount('toggle', { title: 'T', is_open: false });
        expect(toggle.getSlotElement(0).classList.contains('toggle-children')).toBe(true);
    });

    test('refresh keeps nested children in their slot', () => {
        const toggle = mount('toggle', { title: 'T', is_open: true });
        const child = document.createElement('div');
        child.className = 'block';
        toggle.getSlotElement(0).append(child);
        toggle.setContent({ title: 'Renamed', is_open: true });
        expect(toggle.getSlotElement(0).contains(child)).toBe(true);
    });

    test('markdown preview is sanitized', () => {
        window.marked = { parse: (s) => s };
        const md = mount('markdown', { source: '<img src=x onerror=alert(1)>**hi**', preview_mode: true });
        expect(md.element.querySelector('.markdown-preview').innerHTML).not.toContain('onerror');
        delete window.marked;
    });
});

describe('inline markdown', () => {
    test('closing markers format the span', async () => {
        const { applyInlineMarkdown } = await import('../../js/components/base-component.js');
        const cases = [
            ['ship the **first**', '<strong>first</strong>'],
            ['an *idea*', '<em>idea</em>'],
            ['run `npm test`', '<code>npm test</code>'],
            ['~~old~~', '<del>old</del>'],
            ['==key==', '<mark>key</mark>'],
        ];
        for (const [typed, expected] of cases) {
            const node = document.createElement('div');
            node.textContent = typed;
            document.body.append(node);
            const range = document.createRange();
            range.setStart(node.firstChild, typed.length);
            range.collapse(true);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            expect(applyInlineMarkdown(node)).toBe(true);
            expect(node.innerHTML).toContain(expected);
            node.remove();
        }
    });

    test('leaves plain asterisks alone', async () => {
        const { applyInlineMarkdown } = await import('../../js/components/base-component.js');
        const node = document.createElement('div');
        node.textContent = '2 * 3 *';
        document.body.append(node);
        const range = document.createRange();
        range.setStart(node.firstChild, 7);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        expect(applyInlineMarkdown(node)).toBe(false);
        node.remove();
    });
});
