import BaseComponent from './base-component.js';
import { el } from '../utils.js';

/**
 * A template button: stores a list of blocks and inserts fresh copies of them on click.
 * "Capture" fills it from the blocks that follow it on the page, up to the next divider.
 */
export default class TemplateComponent extends BaseComponent {
    static type = 'template';
    static label = 'Template button';
    static icon = '⧉';
    static category = 'advanced';
    static description = 'Insert a reusable set of blocks with one click';
    static keywords = ['template', 'button', 'repeat', 'snippet', 'reuse'];

    getDefaultContent() {
        return { title: 'New entry', blocks: [] };
    }

    renderBody() {
        const container = el('div', { className: 'template-container' });
        const insert = el(
            'button',
            { type: 'button', className: 'btn btn-primary btn-sm' },
            `+ ${this.content.title || 'Insert template'}`,
        );
        insert.disabled = this.readOnly || !this.content.blocks.length;
        this.addEventListener(insert, 'click', () => this.services.insertBlocksAfter?.(this, this.content.blocks));
        container.append(insert);
        if (!this.readOnly) {
            const title = this.editable({
                className: 'template-title',
                rich: false,
                singleLine: true,
                value: this.content.title,
                placeholder: 'Button label',
                onInput: (text) => {
                    this.update({ title: text.slice(0, 200) });
                    insert.textContent = `+ ${text || 'Insert template'}`;
                },
            });
            const capture = el('button', { type: 'button' }, 'Capture blocks below');
            this.addEventListener(capture, 'click', async () => {
                const blocks = (await this.services.captureBlocksAfter?.(this)) || [];
                this.update({ blocks });
                this.refresh();
            });
            container.append(
                el(
                    'div',
                    { className: 'template-meta' },
                    el('span', { className: 'eyebrow' }, 'label'),
                    title,
                    el(
                        'span',
                        { className: 'muted' },
                        `${this.content.blocks.length} block${this.content.blocks.length === 1 ? '' : 's'}`,
                    ),
                    capture,
                ),
            );
        }
        return container;
    }

    getText() {
        return this.content.title;
    }
}
