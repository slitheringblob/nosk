import BaseComponent from './base-component.js';
import { renderMath } from '../markdown.js';
import { el } from '../utils.js';

export default class MathComponent extends BaseComponent {
    static type = 'math';
    static label = 'Math equation';
    static icon = '∑';
    static category = 'advanced';
    static description = 'LaTeX equation rendered with KaTeX';
    static keywords = ['math', 'latex', 'equation', 'formula', 'tex'];

    getDefaultContent() {
        return { latex: '', display: true };
    }

    renderBody() {
        const container = el('div', { className: `math-container${this.content.display ? '' : ' math--inline'}` });
        const output = el('div', { className: 'math-output', tabIndex: this.readOnly ? -1 : 0 });
        const draw = () => {
            if (this.content.latex.trim()) renderMath(output, this.content.latex, this.content.display);
            else output.innerHTML = '<span class="muted">Empty equation — click to edit</span>';
        };
        draw();
        container.append(output);
        if (this.readOnly) return container;

        const editor = el('div', { className: 'math-editor', hidden: true });
        const textarea = el('textarea', { value: this.content.latex, spellcheck: false, placeholder: 'E = mc^2' });
        const display = el(
            'label',
            { className: 'math-display-toggle' },
            el('input', { type: 'checkbox', checked: this.content.display }),
            ' Display mode',
        );
        editor.append(textarea, display);
        container.append(editor);

        const open = () => {
            editor.hidden = false;
            textarea.focus();
        };
        this.addEventListener(output, 'click', open);
        this.addEventListener(output, 'keydown', (event) => {
            if (event.key === 'Enter') open();
        });
        this.addEventListener(textarea, 'input', () => {
            this.update({ latex: textarea.value });
            draw();
        });
        this.addEventListener(textarea, 'keydown', (event) => {
            if (event.key === 'Escape' || (event.key === 'Enter' && (event.metaKey || event.ctrlKey))) {
                editor.hidden = true;
                output.focus();
            }
        });
        this.addEventListener(display.querySelector('input'), 'change', (event) => {
            this.update({ display: event.target.checked });
            container.classList.toggle('math--inline', !event.target.checked);
            draw();
        });
        this.addEventListener(container, 'focusout', (event) => {
            if (!container.contains(event.relatedTarget)) editor.hidden = true;
        });
        this.openEditor = open;
        return container;
    }

    focus() {
        this.openEditor?.();
        return Boolean(this.openEditor);
    }

    isEmpty() {
        return !this.content.latex.trim();
    }

    getText() {
        return this.content.latex;
    }
}
