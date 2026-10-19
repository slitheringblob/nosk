import BaseComponent from './base-component.js';
import { el } from '../utils.js';

export default class ToggleComponent extends BaseComponent {
    static type = 'toggle';
    static label = 'Toggle';
    static icon = '▸';
    static category = 'advanced';
    static description = 'Collapsible section that holds other blocks';
    static keywords = ['toggle', 'collapse', 'accordion', 'details', 'dropdown'];
    static isContainer = true;

    getDefaultContent() {
        return { title: '', is_open: true };
    }

    slotCount() {
        return 1;
    }

    getSlotElement() {
        return this.childrenContainer || null;
    }

    renderBody() {
        const open = Boolean(this.content.is_open);
        const container = el('div', { className: `toggle-container${open ? ' is-open' : ''}` });
        const arrow = el(
            'button',
            {
                type: 'button',
                className: 'toggle-arrow',
                ariaExpanded: String(open),
                ariaLabel: open ? 'Collapse' : 'Expand',
            },
            '▸',
        );
        // Expanding/collapsing is allowed for viewers too, but only saved for editors.
        this.addEventListener(arrow, 'click', () => {
            const next = !this.content.is_open;
            if (this.readOnly) this.content.is_open = next;
            else this.update({ is_open: next });
            container.classList.toggle('is-open', next);
            arrow.setAttribute('aria-expanded', String(next));
        });
        const title = this.editable({
            className: 'toggle-title',
            rich: false,
            singleLine: true,
            value: this.content.title,
            placeholder: 'Toggle',
            blockNavigation: false,
            onInput: (text) => this.update({ title: text.slice(0, 500) }),
            onKeyDown: (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    if (!this.content.is_open) arrow.click();
                    this.hooks.onAddChild?.(this, 0);
                    return true;
                }
                return false;
            },
        });
        this.childrenContainer = el('div', {
            className: 'toggle-children block-slot',
            dataset: { parentId: this.id, slot: '0' },
        });
        const empty = el(
            'button',
            { type: 'button', className: 'slot-empty' },
            this.readOnly ? 'Empty toggle' : 'Empty toggle — click to add a block',
        );
        if (!this.readOnly) this.addEventListener(empty, 'click', () => this.hooks.onAddChild?.(this, 0));
        container.append(el('div', { className: 'toggle-header' }, arrow, title), this.childrenContainer, empty);
        return container;
    }

    isEmpty() {
        return !this.content.title.trim();
    }

    getText() {
        return this.content.title;
    }
}
