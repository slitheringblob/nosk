import BaseComponent from './base-component.js';
import { el, generateUUID } from '../utils.js';

export default class PropertiesComponent extends BaseComponent {
    static type = 'properties';
    static label = 'Properties';
    static icon = '≡';
    static category = 'data';
    static description = 'Key–value metadata';
    static keywords = ['properties', 'metadata', 'key', 'value', 'fields', 'attributes'];

    getDefaultContent() {
        return { items: [{ id: generateUUID(), key: '', value: '' }] };
    }

    renderBody() {
        const container = el('div', { className: 'properties-container', role: 'table' });
        this.content.items.forEach((item, index) => {
            const remove = el(
                'button',
                {
                    type: 'button',
                    className: 'icon-btn properties-remove',
                    title: 'Remove property',
                    ariaLabel: 'Remove property',
                },
                '×',
            );
            this.addEventListener(remove, 'click', () => {
                this.content.items.splice(index, 1);
                this.commit(true);
            });
            const key = this.editable({
                className: 'properties-key',
                rich: false,
                singleLine: true,
                value: item.key,
                placeholder: 'Property',
                onInput: (text) => {
                    item.key = text.slice(0, 100);
                    this.commit();
                },
            });
            const value = this.editable({
                className: 'properties-value',
                rich: false,
                singleLine: true,
                value: item.value,
                placeholder: 'Empty',
                onInput: (text) => {
                    item.value = text.slice(0, 1000);
                    this.commit();
                },
                onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        this.addRow(index + 1);
                        return true;
                    }
                    return false;
                },
            });
            container.append(
                el('div', { className: 'properties-row', role: 'row' }, key, value, this.readOnly ? null : remove),
            );
        });
        if (!this.readOnly && this.content.items.length < 100) {
            const add = el('button', { type: 'button', className: 'slot-empty properties-add' }, '+ Add property');
            this.addEventListener(add, 'click', () => this.addRow(this.content.items.length));
            container.append(add);
        }
        return container;
    }

    addRow(index) {
        this.content.items.splice(index, 0, { id: generateUUID(), key: '', value: '' });
        this.commit(true);
        this.body.querySelectorAll('.properties-key')[index]?.focus();
    }

    commit(rerender = false) {
        this.update({ items: this.content.items });
        if (rerender) this.refresh();
    }

    getText() {
        return this.content.items.map((item) => `${item.key}: ${item.value}`).join('\n');
    }
}
