import BaseComponent from './base-component.js';
import { el, stripHTML } from '../utils.js';

export const CALLOUT_VARIANTS = ['note', 'info', 'warning', 'success', 'error'];
const DEFAULT_ICONS = { info: 'ℹ️', warning: '⚠️', success: '✅', error: '❌', note: '📝' };

export default class CalloutComponent extends BaseComponent {
    static type = 'callout';
    static label = 'Callout';
    static icon = '💡';
    static category = 'advanced';
    static description = 'Colored box to make text stand out';
    static keywords = ['callout', 'alert', 'note', 'warning', 'info', 'tip'];

    getDefaultContent() {
        return { text: '', variant: 'note', icon: null };
    }

    renderBody() {
        const variant = CALLOUT_VARIANTS.includes(this.content.variant) ? this.content.variant : 'note';
        const container = el('div', { className: `callout-container callout-${variant}`, role: 'note' });
        const icon = el(
            'button',
            {
                type: 'button',
                className: 'callout-icon',
                title: this.readOnly ? '' : 'Change icon',
                disabled: this.readOnly,
            },
            this.content.icon || DEFAULT_ICONS[variant],
        );
        this.addEventListener(icon, 'click', () => {
            const value = window.prompt('Callout icon (emoji). Leave empty for the default.', this.content.icon || '');
            if (value === null) return;
            this.update({ icon: value.trim() ? [...value.trim()].slice(0, 2).join('') : null });
            this.refresh();
        });
        container.append(
            icon,
            this.editable({
                className: 'callout-content',
                value: this.content.text,
                placeholder: 'Callout text',
                blockNavigation: true,
                onInput: (html) => this.update({ text: html }),
            }),
            this.optionBar('callout-variant-selector', CALLOUT_VARIANTS, variant, (value) => {
                this.update({ variant: value });
                this.refresh();
            }),
        );
        return container;
    }

    isEmpty() {
        return !stripHTML(this.content.text).trim();
    }

    getText() {
        return stripHTML(this.content.text);
    }
}
