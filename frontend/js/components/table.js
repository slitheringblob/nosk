import BaseComponent from './base-component.js';
import { el } from '../utils.js';

const MAX_ROWS = 200;
const MAX_COLUMNS = 26;

export default class TableComponent extends BaseComponent {
    static type = 'table';
    static label = 'Table';
    static icon = '⊞';
    static category = 'advanced';
    static description = 'Simple table with editable cells';
    static keywords = ['table', 'grid', 'spreadsheet', 'rows'];

    getDefaultContent() {
        return {
            rows: [
                ['', '', ''],
                ['', '', ''],
                ['', '', ''],
            ],
            has_header_row: true,
        };
    }

    renderBody() {
        const { rows, has_header_row: header } = this.content;
        const container = el('div', { className: 'table-container' });
        const table = el('table', { className: `table${header ? ' table--header' : ''}` });
        rows.forEach((row, r) => {
            const tr = el('tr');
            row.forEach((cell, c) => {
                const td = el(header && r === 0 ? 'th' : 'td');
                td.append(
                    this.editable({
                        className: 'table-cell',
                        rich: false,
                        value: cell,
                        singleLine: false,
                        onInput: (text) => {
                            this.content.rows[r][c] = text.slice(0, 1000);
                            this.update({ rows: this.content.rows });
                        },
                        onKeyDown: (event) => this.handleCellKey(event, r, c),
                    }),
                );
                tr.append(td);
            });
            table.append(tr);
        });
        container.append(el('div', { className: 'table-scroll' }, table));
        if (!this.readOnly) {
            const action = (label, handler, disabled = false) => {
                const button = el('button', { type: 'button', disabled }, label);
                this.addEventListener(button, 'click', handler);
                return button;
            };
            const width = rows[0].length;
            container.append(
                el(
                    'div',
                    { className: 'table-actions block-options' },
                    action('+ Row', () => this.mutate(() => rows.push(Array(width).fill(''))), rows.length >= MAX_ROWS),
                    action(
                        '+ Column',
                        () => this.mutate(() => rows.forEach((row) => row.push(''))),
                        width >= MAX_COLUMNS,
                    ),
                    action('− Row', () => this.mutate(() => rows.pop()), rows.length <= 1),
                    action('− Column', () => this.mutate(() => rows.forEach((row) => row.pop())), width <= 1),
                    action(header ? 'Header: on' : 'Header: off', () => {
                        this.update({ has_header_row: !header });
                        this.refresh();
                    }),
                ),
            );
        }
        return container;
    }

    mutate(change) {
        change();
        this.update({ rows: this.content.rows });
        this.refresh();
    }

    handleCellKey(event, r, c) {
        const { rows } = this.content;
        const width = rows[0].length;
        if (event.key === 'Tab') {
            event.preventDefault();
            let index = r * width + c + (event.shiftKey ? -1 : 1);
            if (index >= rows.length * width && rows.length < MAX_ROWS) {
                this.mutate(() => rows.push(Array(width).fill('')));
            }
            index = Math.max(0, Math.min(index, rows.length * width - 1));
            this.focusCell(Math.floor(index / width), index % width);
            return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (r + 1 < rows.length) this.focusCell(r + 1, c);
            return true;
        }
        return false;
    }

    focusCell(r, c) {
        const width = this.content.rows[0].length;
        const cell = this.body.querySelectorAll('.table-cell')[r * width + c];
        cell?.focus();
    }

    isEmpty() {
        return this.content.rows.every((row) => row.every((cell) => !cell.trim()));
    }

    getText() {
        return this.content.rows.map((row) => row.join('\t')).join('\n');
    }
}
