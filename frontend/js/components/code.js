import BaseComponent from './base-component.js';
import { highlightCode } from '../markdown.js';
import { el } from '../utils.js';

export const CODE_LANGUAGES = [
    'plaintext',
    'bash',
    'c',
    'cpp',
    'csharp',
    'css',
    'diff',
    'go',
    'graphql',
    'html',
    'java',
    'javascript',
    'json',
    'kotlin',
    'markdown',
    'php',
    'python',
    'ruby',
    'rust',
    'scss',
    'shell',
    'sql',
    'swift',
    'typescript',
    'xml',
    'yaml',
];

export default class CodeComponent extends BaseComponent {
    static type = 'code';
    static label = 'Code';
    static icon = '</>';
    static category = 'advanced';
    static description = 'Code with syntax highlighting';
    static keywords = ['code', 'snippet', 'pre', 'program'];

    getDefaultContent() {
        return { code: '', language: 'plaintext', wrap: false };
    }

    renderBody() {
        const container = el('div', { className: `code-container${this.content.wrap ? ' code--wrap' : ''}` });
        const toolbar = el('div', { className: 'code-toolbar', contentEditable: 'false' });
        if (!this.readOnly) {
            const select = el(
                'select',
                { className: 'code-language', ariaLabel: 'Language' },
                ...CODE_LANGUAGES.map((lang) =>
                    el('option', { value: lang, selected: lang === this.content.language }, lang),
                ),
            );
            this.addEventListener(select, 'change', () => {
                this.update({ language: select.value });
                this.refresh();
            });
            const wrap = el('button', { type: 'button', className: this.content.wrap ? 'is-active' : '' }, 'Wrap');
            this.addEventListener(wrap, 'click', () => {
                this.update({ wrap: !this.content.wrap });
                this.refresh();
            });
            toolbar.append(select, wrap);
        } else {
            toolbar.append(el('span', { className: 'code-language-label' }, this.content.language));
        }
        const copy = el('button', { type: 'button' }, 'Copy');
        this.addEventListener(copy, 'click', async () => {
            await navigator.clipboard?.writeText(this.content.code);
            copy.textContent = 'Copied';
            setTimeout(() => {
                copy.textContent = 'Copy';
            }, 1200);
        });
        toolbar.append(copy);

        const pre = el('pre', { className: 'code-preview' });
        const code = el('code', { className: `hljs language-${this.content.language}` });
        code.textContent = this.content.code || (this.readOnly ? '' : ' ');
        if (this.content.code) highlightCode(code, this.content.language);
        pre.append(code);
        container.append(toolbar, pre);

        if (!this.readOnly) {
            const textarea = el('textarea', {
                className: 'code-editor',
                value: this.content.code,
                spellcheck: false,
                placeholder: 'Write code…',
                hidden: true,
            });
            const autosize = () => {
                textarea.style.height = 'auto';
                textarea.style.height = `${textarea.scrollHeight + 2}px`;
            };
            const edit = () => {
                pre.hidden = true;
                textarea.hidden = false;
                autosize();
                textarea.focus();
            };
            this.addEventListener(pre, 'click', edit);
            this.addEventListener(textarea, 'input', () => {
                autosize();
                this.update({ code: textarea.value });
            });
            this.addEventListener(textarea, 'keydown', (event) => {
                if (event.key === 'Tab') {
                    event.preventDefault();
                    const { selectionStart: start, selectionEnd: end } = textarea;
                    textarea.setRangeText('    ', start, end, 'end');
                    textarea.dispatchEvent(new Event('input'));
                } else if (event.key === 'Escape') {
                    textarea.blur();
                }
            });
            this.addEventListener(textarea, 'blur', () => {
                code.textContent = this.content.code || ' ';
                if (this.content.code) highlightCode(code, this.content.language);
                textarea.hidden = true;
                pre.hidden = false;
            });
            this.startEditing = edit;
            container.append(textarea);
        }
        return container;
    }

    focus() {
        if (this.startEditing) {
            this.startEditing();
            return true;
        }
        return false;
    }

    isEmpty() {
        return !this.content.code;
    }

    getText() {
        return this.content.code;
    }
}
