import BaseComponent from './base-component.js';
import { renderMarkdown } from '../markdown.js';
import { el } from '../utils.js';

export default class MarkdownComponent extends BaseComponent {
    static type = 'markdown';
    static label = 'Markdown';
    static icon = 'M↓';
    static category = 'advanced';
    static description = 'Write raw Markdown with a live preview';
    static keywords = ['markdown', 'md'];

    getDefaultContent() {
        return { source: '', preview_mode: false };
    }

    renderBody() {
        const container = el('div', { className: 'markdown-container' });
        const showPreview = this.readOnly || this.content.preview_mode;
        if (!this.readOnly) {
            const toggle = el(
                'button',
                { type: 'button', className: 'markdown-toggle-btn' },
                showPreview ? 'Edit' : 'Preview',
            );
            this.addEventListener(toggle, 'click', () => {
                this.update({ preview_mode: !this.content.preview_mode });
                this.refresh();
                if (!this.content.preview_mode) this.focus();
            });
            container.append(el('div', { className: 'markdown-toolbar', contentEditable: 'false' }, toggle));
        }
        if (showPreview) {
            const preview = el('div', { className: 'markdown-preview rendered' });
            preview.innerHTML = this.content.source.trim()
                ? renderMarkdown(this.content.source)
                : '<p class="muted">Nothing to preview</p>';
            if (!this.readOnly) {
                this.addEventListener(preview, 'dblclick', () => {
                    this.update({ preview_mode: false });
                    this.refresh();
                    this.focus();
                });
            }
            container.append(preview);
        } else {
            const textarea = el('textarea', {
                className: 'markdown-editor',
                value: this.content.source,
                placeholder: 'Write Markdown…',
                spellcheck: false,
            });
            const autosize = () => {
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight + 2}px`;
            };
            this.addEventListener(textarea, 'input', () => {
                autosize();
                this.update({ source: textarea.value });
            });
            requestAnimationFrame(autosize);
            container.append(textarea);
        }
        return container;
    }

    isEmpty() {
        return !this.content.source.trim();
    }

    getText() {
        return this.content.source;
    }
}
