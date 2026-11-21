import BaseComponent from './base-component.js';
import { el } from '../utils.js';

export default class ColumnsComponent extends BaseComponent {
    static type = 'columns';
    static label = 'Columns';
    static icon = '▥';
    static category = 'advanced';
    static description = 'Lay blocks out side by side';
    static keywords = ['columns', 'layout', 'side by side', 'grid'];
    static isContainer = true;

    getDefaultContent() {
        return { count: 2 };
    }

    slotCount() {
        return this.content.count;
    }

    getSlotElement(slot) {
        return this.slots?.[slot] || null;
    }

    renderBody() {
        const count = Math.min(4, Math.max(2, this.content.count || 2));
        const container = el('div', { className: 'columns-container' });
        const grid = el('div', {
            className: 'columns-grid',
            style: { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` },
        });
        this.slots = [];
        for (let slot = 0; slot < count; slot += 1) {
            const column = el('div', { className: 'column' });
            const slotElement = el('div', {
                className: 'column-slot block-slot',
                dataset: { parentId: this.id, slot: String(slot) },
            });
            const add = el('button', { type: 'button', className: 'slot-empty' }, this.readOnly ? '' : '+ Add block');
            if (!this.readOnly) this.addEventListener(add, 'click', () => this.hooks.onAddChild?.(this, slot));
            column.append(slotElement, add);
            grid.append(column);
            this.slots.push(slotElement);
        }
        container.append(
            this.optionBar(
                'columns-count-selector',
                [2, 3, 4],
                count,
                (value) => {
                    this.update({ count: value });
                    this.refresh();
                    this.hooks.onLayoutChanged?.(this);
                },
                (value) => `${value} cols`,
            ),
            grid,
        );
        return container;
    }
}
