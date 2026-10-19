import BaseComponent from './base-component.js';
import { el, generateUUID } from '../utils.js';

export const COLUMN_TYPES = ['text', 'number', 'checkbox', 'select', 'date', 'url'];
const FILTER_OPS = {
    text: ['contains', 'equals', 'empty', 'not_empty'],
    url: ['contains', 'empty', 'not_empty'],
    number: ['equals', 'gt', 'lt', 'empty', 'not_empty'],
    checkbox: ['checked', 'unchecked'],
    select: ['equals', 'empty', 'not_empty'],
    date: ['equals', 'gt', 'lt', 'empty', 'not_empty'],
};
const OP_LABELS = {
    contains: 'contains',
    equals: 'is',
    empty: 'is empty',
    not_empty: 'is not empty',
    gt: '>',
    lt: '<',
    checked: 'is checked',
    unchecked: 'is unchecked',
};

export function matchesFilter(row, filter, column) {
    if (!filter || !column) return true;
    const value = row.cells[filter.column_id];
    const empty = value === undefined || value === null || value === '' || value === false;
    switch (filter.op) {
        case 'empty':
            return empty;
        case 'not_empty':
            return !empty;
        case 'checked':
            return value === true;
        case 'unchecked':
            return value !== true;
        case 'contains':
            return String(value ?? '')
                .toLowerCase()
                .includes(filter.value.toLowerCase());
        case 'equals':
            return column.type === 'number'
                ? Number(value) === Number(filter.value)
                : String(value ?? '') === filter.value;
        case 'gt':
            return column.type === 'number' ? Number(value) > Number(filter.value) : String(value ?? '') > filter.value;
        case 'lt':
            return column.type === 'number'
                ? Number(value) < Number(filter.value)
                : !empty && String(value) < filter.value;
        default:
            return true;
    }
}

export function sortRows(rows, sort, column) {
    if (!sort || !column) return rows;
    const direction = sort.direction === 'desc' ? -1 : 1;
    const key = (row) => {
        const value = row.cells[sort.column_id];
        if (column.type === 'number')
            return value === null || value === undefined || value === '' ? -Infinity : Number(value);
        if (column.type === 'checkbox') return value ? 1 : 0;
        return String(value ?? '').toLowerCase();
    };
    return [...rows].sort((a, b) => (key(a) > key(b) ? direction : key(a) < key(b) ? -direction : 0));
}

export default class DatabaseComponent extends BaseComponent {
    static type = 'database';
    static label = 'Database';
    static icon = '⊟';
    static category = 'data';
    static description = 'Table of records with typed columns, sort and filter';
    static keywords = ['database', 'collection', 'table', 'records', 'tracker', 'kanban'];

    getDefaultContent() {
        return {
            title: '',
            columns: [
                { id: generateUUID(), name: 'Name', type: 'text', options: [] },
                { id: generateUUID(), name: 'Done', type: 'checkbox', options: [] },
            ],
            rows: [],
            sort: null,
            filter: null,
        };
    }

    commit(rerender = true) {
        const { title, columns, rows, sort, filter } = this.content;
        this.update({ title, columns, rows, sort, filter });
        if (rerender) this.refresh();
    }

    column(id) {
        return this.content.columns.find((column) => column.id === id);
    }

    renderBody() {
        const container = el('div', { className: 'database-container' });
        const title = this.editable({
            className: 'database-title',
            rich: false,
            singleLine: true,
            value: this.content.title,
            placeholder: 'Untitled database',
            onInput: (text) => {
                this.content.title = text.slice(0, 200);
                this.commit(false);
            },
        });
        container.append(el('div', { className: 'database-header' }, title, this.renderControls()));

        const { columns } = this.content;
        let rows = this.content.rows.filter((row) =>
            matchesFilter(row, this.content.filter, this.column(this.content.filter?.column_id)),
        );
        rows = sortRows(rows, this.content.sort, this.column(this.content.sort?.column_id));

        const table = el('table', { className: 'database-table' });
        const head = el('tr');
        for (const column of columns) {
            head.append(el('th', {}, this.renderColumnHeader(column)));
        }
        if (!this.readOnly)
            head.append(
                el(
                    'th',
                    { className: 'database-col-add' },
                    this.button('+', () => this.addColumn(), 'Add column'),
                ),
            );
        table.append(el('thead', {}, head));
        const body = el('tbody');
        for (const row of rows) {
            const tr = el('tr');
            for (const column of columns)
                tr.append(el('td', { className: `cell cell--${column.type}` }, this.renderCell(row, column)));
            if (!this.readOnly)
                tr.append(
                    el(
                        'td',
                        { className: 'database-row-actions' },
                        this.button(
                            '×',
                            () => {
                                this.content.rows = this.content.rows.filter((r) => r.id !== row.id);
                                this.commit();
                            },
                            'Delete row',
                        ),
                    ),
                );
            body.append(tr);
        }
        table.append(body);
        container.append(el('div', { className: 'table-scroll' }, table));
        const footer = el(
            'div',
            { className: 'database-footer' },
            el(
                'span',
                { className: 'muted' },
                `${rows.length}${rows.length !== this.content.rows.length ? ` of ${this.content.rows.length}` : ''} rows`,
            ),
        );
        if (!this.readOnly && this.content.rows.length < 1000) {
            footer.prepend(
                this.button(
                    '+ New row',
                    () => {
                        this.content.rows.push({ id: generateUUID(), cells: {} });
                        this.commit();
                    },
                    'Add row',
                    'slot-empty',
                ),
            );
        }
        container.append(footer);
        return container;
    }

    button(label, onClick, title = '', className = 'icon-btn') {
        const button = el('button', { type: 'button', className, title, ariaLabel: title || label }, label);
        this.addEventListener(button, 'click', onClick);
        return button;
    }

    renderControls() {
        const controls = el('div', { className: 'database-controls' });
        const { columns, sort, filter } = this.content;
        const columnOptions = (selected) => [
            el('option', { value: '' }, '—'),
            ...columns.map((c) => el('option', { value: c.id, selected: c.id === selected }, c.name || 'Untitled')),
        ];

        const sortSelect = el(
            'select',
            { ariaLabel: 'Sort by', disabled: this.readOnly },
            ...columnOptions(sort?.column_id),
        );
        const sortDir = el(
            'select',
            { ariaLabel: 'Sort direction', disabled: this.readOnly || !sort },
            el('option', { value: 'asc', selected: sort?.direction !== 'desc' }, '↑ asc'),
            el('option', { value: 'desc', selected: sort?.direction === 'desc' }, '↓ desc'),
        );
        const applySort = () => {
            this.content.sort = sortSelect.value ? { column_id: sortSelect.value, direction: sortDir.value } : null;
            this.commit();
        };
        this.addEventListener(sortSelect, 'change', applySort);
        this.addEventListener(sortDir, 'change', applySort);

        const filterColumn = el(
            'select',
            { ariaLabel: 'Filter column', disabled: this.readOnly },
            ...columnOptions(filter?.column_id),
        );
        const active = this.column(filter?.column_id);
        const ops = FILTER_OPS[active?.type || 'text'];
        const filterOp = el(
            'select',
            { ariaLabel: 'Filter operator', disabled: this.readOnly || !filter },
            ...ops.map((op) => el('option', { value: op, selected: op === filter?.op }, OP_LABELS[op])),
        );
        const filterValue = el('input', {
            placeholder: 'value',
            value: filter?.value || '',
            disabled: this.readOnly || !filter,
            hidden: ['empty', 'not_empty', 'checked', 'unchecked'].includes(filter?.op),
        });
        const applyFilter = (rerender = true) => {
            if (!filterColumn.value) {
                this.content.filter = null;
            } else {
                const column = this.column(filterColumn.value);
                const allowed = FILTER_OPS[column.type];
                const op = allowed.includes(filterOp.value) ? filterOp.value : allowed[0];
                this.content.filter = { column_id: column.id, op, value: filterValue.value.slice(0, 200) };
            }
            this.commit(rerender);
        };
        this.addEventListener(filterColumn, 'change', () => applyFilter());
        this.addEventListener(filterOp, 'change', () => applyFilter());
        this.addEventListener(filterValue, 'change', () => applyFilter());

        controls.append(
            el('span', { className: 'eyebrow' }, 'sort'),
            sortSelect,
            sortDir,
            el('span', { className: 'eyebrow' }, 'filter'),
            filterColumn,
            filterOp,
            filterValue,
        );
        return controls;
    }

    renderColumnHeader(column) {
        const wrap = el('div', { className: 'database-col' });
        const name = this.editable({
            className: 'database-col__name',
            rich: false,
            singleLine: true,
            value: column.name,
            placeholder: 'Column',
            onInput: (text) => {
                column.name = text.slice(0, 100);
                this.commit(false);
            },
        });
        wrap.append(el('span', { className: 'database-col__type', title: column.type }, column.type.slice(0, 3)), name);
        if (!this.readOnly) {
            wrap.append(this.button('⋯', () => this.editColumn(column), 'Column settings'));
        }
        return wrap;
    }

    editColumn(column) {
        const choice = window.prompt(
            `Column "${column.name}"\nType one of: ${COLUMN_TYPES.join(', ')}\n` +
                'Or type "delete" to remove the column.\nFor select columns use: select: option1, option2',
            column.type === 'select' ? `select: ${column.options.join(', ')}` : column.type,
        );
        if (choice === null) return;
        const value = choice.trim();
        if (value.toLowerCase() === 'delete') {
            if (this.content.columns.length <= 1) return;
            this.content.columns = this.content.columns.filter((c) => c.id !== column.id);
            for (const row of this.content.rows) delete row.cells[column.id];
            if (this.content.sort?.column_id === column.id) this.content.sort = null;
            if (this.content.filter?.column_id === column.id) this.content.filter = null;
        } else if (value.toLowerCase().startsWith('select')) {
            column.type = 'select';
            column.options = value
                .replace(/^select:?/i, '')
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
                .slice(0, 50);
        } else if (COLUMN_TYPES.includes(value.toLowerCase())) {
            column.type = value.toLowerCase();
            if (column.type !== 'select') column.options = [];
            // Coerce existing values so cells stay valid for the new type.
            for (const row of this.content.rows) {
                const cell = row.cells[column.id];
                if (cell === undefined) continue;
                if (column.type === 'checkbox') row.cells[column.id] = Boolean(cell) && cell !== 'false';
                else if (column.type === 'number')
                    row.cells[column.id] = cell === '' || Number.isNaN(Number(cell)) ? null : Number(cell);
                else row.cells[column.id] = cell === true ? 'true' : cell === false ? '' : String(cell ?? '');
            }
        } else {
            return;
        }
        this.commit();
    }

    addColumn() {
        if (this.content.columns.length >= 30) return;
        this.content.columns.push({
            id: generateUUID(),
            name: `Column ${this.content.columns.length + 1}`,
            type: 'text',
            options: [],
        });
        this.commit();
    }

    renderCell(row, column) {
        const value = row.cells[column.id];
        const set = (next, rerender = false) => {
            row.cells[column.id] = next;
            this.commit(rerender);
        };
        const disabled = this.readOnly;
        switch (column.type) {
            case 'checkbox': {
                const input = el('input', {
                    type: 'checkbox',
                    checked: value === true,
                    disabled,
                    ariaLabel: column.name,
                });
                this.addEventListener(input, 'change', () =>
                    set(input.checked, Boolean(this.content.sort || this.content.filter)),
                );
                return input;
            }
            case 'number': {
                const input = el('input', { type: 'number', value: value ?? '', disabled, ariaLabel: column.name });
                this.addEventListener(input, 'change', () =>
                    set(input.value === '' ? null : Number(input.value), Boolean(this.content.sort)),
                );
                return input;
            }
            case 'date': {
                const input = el('input', { type: 'date', value: value ?? '', disabled, ariaLabel: column.name });
                this.addEventListener(input, 'change', () => set(input.value || null, Boolean(this.content.sort)));
                return input;
            }
            case 'select': {
                const select = el(
                    'select',
                    { disabled, ariaLabel: column.name },
                    el('option', { value: '' }, '—'),
                    ...column.options.map((option) =>
                        el('option', { value: option, selected: option === value }, option),
                    ),
                );
                this.addEventListener(select, 'change', () =>
                    set(select.value || null, Boolean(this.content.sort || this.content.filter)),
                );
                return select;
            }
            case 'url': {
                if (disabled) {
                    return value && /^https?:\/\//i.test(value)
                        ? el('a', { href: value, target: '_blank', rel: 'noopener noreferrer' }, value)
                        : el('span', {}, value || '');
                }
                const input = el('input', {
                    type: 'url',
                    value: value ?? '',
                    placeholder: 'https://',
                    ariaLabel: column.name,
                });
                this.addEventListener(input, 'change', () => set(input.value.slice(0, 2000)));
                return input;
            }
            default:
                return this.editable({
                    className: 'database-cell',
                    rich: false,
                    singleLine: true,
                    value: value ?? '',
                    onInput: (text) => set(text.slice(0, 2000)),
                });
        }
    }

    getText() {
        return [this.content.title, ...this.content.rows.map((row) => Object.values(row.cells).join(' '))].join('\n');
    }
}
