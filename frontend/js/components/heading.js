import BaseComponent from './base-component.js';
import { el } from '../utils.js';

export function slugify(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60);
}

export default class HeadingComponent extends BaseComponent {
    static type = 'heading';
    static label = 'Heading';
    static icon = 'H';
    static description = 'Section heading (H1–H3)';
    static keywords = ['heading', 'title', 'h1', 'h2', 'h3'];

    getDefaultContent() {
        return { text: '', level: 1 };
    }

    renderBody() {
        const level = [1, 2, 3].includes(this.content.level) ? this.content.level : 1;
        const container = el('div', { className: 'heading-container' });
        const heading = this.editable({
            tag: `h${level}`,
            className: 'heading-content',
            rich: false,
            singleLine: true,
            value: this.content.text,
            placeholder: `Heading ${level}`,
            blockNavigation: true,
            onInput: (text) => {
                heading.id = `h-${slugify(text)}`;
                this.update({ text: text.replace(/\n/g, ' ').slice(0, 200) });
            },
        });
        heading.id = `h-${slugify(this.content.text)}`;
        container.append(
            heading,
            this.optionBar(
                'heading-level-selector',
                [1, 2, 3],
                level,
                (value) => {
                    this.update({ level: value });
                    this.refresh();
                    this.focus();
                },
                (value) => `H${value}`,
            ),
        );
        return container;
    }

    isEmpty() {
        return !this.content.text.trim();
    }

    getText() {
        return this.content.text;
    }
}
