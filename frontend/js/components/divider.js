import BaseComponent from './base-component.js';
import { el } from '../utils.js';

export default class DividerComponent extends BaseComponent {
    static type = 'divider';
    static label = 'Divider';
    static icon = '—';
    static description = 'Horizontal separator';
    static keywords = ['divider', 'separator', 'hr', 'line'];

    getDefaultContent() {
        return { style: 'solid' };
    }

    renderBody() {
        const style = this.content.style || 'solid';
        return el(
            'div',
            { className: 'divider-container', tabIndex: 0 },
            el('hr', { className: `divider divider-${style}` }),
            this.optionBar('divider-style-selector', ['solid', 'dashed', 'dotted', 'thick'], style, (value) => {
                this.update({ style: value });
                this.refresh();
            }),
        );
    }

    focus() {
        this.body?.focus();
        return true;
    }
}
