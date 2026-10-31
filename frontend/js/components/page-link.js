import BaseComponent from './base-component.js';
import { el } from '../utils.js';

export default class PageLinkComponent extends BaseComponent {
    static type = 'page-link';
    static label = 'Link to page';
    static icon = '↗';
    static category = 'advanced';
    static description = 'Reference another page';
    static keywords = ['link', 'page', 'reference', 'mention', 'backlink'];

    getDefaultContent() {
        return { page_id: null, title: '' };
    }

    renderBody() {
        if (!this.content.page_id)
            return this.readOnly ? el('div', { className: 'muted' }, 'Empty link') : this.renderPicker();
        const container = el('div', { className: 'page-link-container' });
        const link = el(
            'a',
            { className: 'page-link', href: `#/page/${this.content.page_id}` },
            el('span', { className: 'page-link__icon' }, '↗'),
            el('span', { className: 'page-link__title' }, this.content.title || 'Untitled'),
        );
        this.addEventListener(link, 'click', (event) => {
            event.preventDefault();
            this.services.navigate?.(this.content.page_id);
        });
        container.append(link);
        // Refresh the cached title from the local store; it may have been renamed.
        this.services.pages?.get(this.content.page_id).then((page) => {
            if (!page || page.deleted) {
                link.classList.add('is-missing');
                return;
            }
            const icon = link.querySelector('.page-link__icon');
            icon.textContent = page.icon || '↗';
            link.querySelector('.page-link__title').textContent = page.title;
            if (!this.readOnly && page.title !== this.content.title) this.update({ title: page.title.slice(0, 200) });
        });
        if (!this.readOnly) {
            const change = el('button', { type: 'button' }, 'Change');
            this.addEventListener(change, 'click', () => {
                this.update({ page_id: null });
                this.refresh();
                this.focus();
            });
            container.append(el('div', { className: 'block-options' }, change));
        }
        return container;
    }

    renderPicker() {
        const container = el('div', { className: 'page-link-picker' });
        const input = el('input', { type: 'search', placeholder: 'Search pages to link…' });
        const results = el('div', { className: 'page-link-results' });
        const draw = async () => {
            const query = input.value.trim().toLowerCase();
            const pages = (await this.services.pages?.list()) || [];
            results.replaceChildren(
                ...pages
                    .filter(
                        (page) =>
                            !page.deleted &&
                            page.id !== this.services.currentPageId?.() &&
                            page.title.toLowerCase().includes(query),
                    )
                    .slice(0, 8)
                    .map((page) => {
                        const option = el(
                            'button',
                            { type: 'button', className: 'page-link-option' },
                            `${page.icon || '📄'} ${page.title}`,
                        );
                        this.addEventListener(option, 'click', () => {
                            this.update({ page_id: page.id, title: page.title.slice(0, 200) });
                            this.refresh();
                        });
                        return option;
                    }),
            );
        };
        this.addEventListener(input, 'input', draw);
        draw();
        container.append(input, results);
        return container;
    }

    getText() {
        return this.content.title;
    }
}
