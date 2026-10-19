import BaseComponent from './base-component.js';
import { el } from '../utils.js';

export default class TagsComponent extends BaseComponent {
    static type = 'tags';
    static label = 'Tags';
    static icon = '#';
    static category = 'data';
    static description = 'Tag cloud for this page';
    static keywords = ['tags', 'labels', 'categories', 'hashtag'];

    getDefaultContent() {
        return { tags: [] };
    }

    renderBody() {
        const container = el('div', { className: 'tags-container' });
        this.content.tags.forEach((tag, index) => {
            const chip = el('span', { className: 'tag-chip' });
            const name = el(
                'button',
                { type: 'button', className: 'tag-chip__name', title: `Show pages tagged ${tag}` },
                `#${tag}`,
            );
            this.addEventListener(name, 'click', () => this.services.filterByTag?.(tag));
            chip.append(name);
            if (!this.readOnly) {
                const remove = el(
                    'button',
                    { type: 'button', className: 'tag-chip__remove', ariaLabel: `Remove ${tag}` },
                    '×',
                );
                this.addEventListener(remove, 'click', () => {
                    this.content.tags.splice(index, 1);
                    this.update({ tags: this.content.tags });
                    this.refresh();
                });
                chip.append(remove);
            }
            container.append(chip);
        });
        if (!this.readOnly && this.content.tags.length < 50) {
            const input = el('input', {
                className: 'tags-input',
                placeholder: this.content.tags.length ? 'Add tag' : 'Add tags…',
                maxLength: 50,
            });
            this.addEventListener(input, 'keydown', (event) => {
                if ((event.key === 'Enter' || event.key === ',') && input.value.trim()) {
                    event.preventDefault();
                    this.addTag(input.value);
                } else if (event.key === 'Backspace' && !input.value && this.content.tags.length) {
                    this.content.tags.pop();
                    this.update({ tags: this.content.tags });
                    this.refresh();
                    this.focus();
                }
            });
            this.addEventListener(input, 'blur', () => {
                if (input.value.trim()) this.addTag(input.value, false);
            });
            container.append(input);
        }
        return container;
    }

    addTag(raw, keepFocus = true) {
        const tag = raw.trim().replace(/^#/, '').toLowerCase().slice(0, 50);
        if (tag && !this.content.tags.includes(tag)) {
            this.content.tags.push(tag);
            this.update({ tags: this.content.tags });
        }
        this.refresh();
        if (keepFocus) this.focus();
    }

    getText() {
        return this.content.tags.map((tag) => `#${tag}`).join(' ');
    }
}
