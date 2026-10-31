import ListComponent from './list-base.js';
import { el } from '../utils.js';

export default class ChecklistComponent extends ListComponent {
    static type = 'checklist';
    static label = 'Checklist';
    static icon = '☑';
    static description = 'Track tasks with checkboxes';
    static keywords = ['todo', 'task', 'checkbox', 'check', 'checklist'];
    static richItems = false;

    newItem(indentLevel) {
        return { ...super.newItem(indentLevel), checked: false };
    }

    containerClass() {
        return 'list-container checklist-container';
    }

    renderBody() {
        const container = super.renderBody();
        const total = this.content.items.length;
        const done = this.content.items.filter((item) => item.checked).length;
        if (total > 1) {
            const progress = el(
                'div',
                { className: 'checklist-progress', contentEditable: 'false' },
                el(
                    'div',
                    { className: 'checklist-progress__bar' },
                    el('span', { style: { width: `${Math.round((done / total) * 100)}%` } }),
                ),
                el('span', { className: 'checklist-progress__label' }, `${done}/${total}`),
            );
            container.prepend(progress);
        }
        return container;
    }

    renderItem(item, index) {
        const row = super.renderItem(item, index);
        row.classList.toggle('is-checked', Boolean(item.checked));
        return row;
    }

    renderMarker(item) {
        const checkbox = el('input', {
            type: 'checkbox',
            className: 'checklist-checkbox',
            checked: Boolean(item.checked),
            disabled: this.readOnly,
            ariaLabel: 'Done',
        });
        this.addEventListener(checkbox, 'change', () => this.toggle(item, checkbox.checked));
        return checkbox;
    }

    /** Checking an item also checks its sub-tasks (items indented below it). */
    toggle(item, checked) {
        const index = this.itemIndex(item);
        item.checked = checked;
        for (let i = index + 1; i < this.content.items.length; i += 1) {
            const child = this.content.items[i];
            if (child.indent_level <= item.indent_level) break;
            child.checked = checked;
        }
        this.commit(true);
    }
}
