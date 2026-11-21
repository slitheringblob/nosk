import BaseComponent from './base-component.js';
import { el } from '../utils.js';

export default class BookmarkComponent extends BaseComponent {
    static type = 'bookmark';
    static label = 'Web bookmark';
    static icon = '🔖';
    static category = 'media';
    static description = 'Link preview card';
    static keywords = ['bookmark', 'link', 'url', 'preview', 'web'];

    getDefaultContent() {
        return { url: null, title: '', description: '', image_url: null, site_name: '' };
    }

    renderBody() {
        if (!this.content.url) {
            if (this.readOnly) return el('div', { className: 'muted' }, 'Empty bookmark');
            const form = el('form', { className: 'url-form' });
            const input = el('input', {
                type: 'url',
                placeholder: 'Paste a link to create a bookmark…',
                required: true,
            });
            const status = el('span', { className: 'muted' });
            form.append(input, el('button', { type: 'submit', className: 'btn btn-primary btn-sm' }, 'Create'), status);
            this.addEventListener(form, 'submit', async (event) => {
                event.preventDefault();
                const url = input.value.trim();
                status.textContent = 'Fetching preview…';
                try {
                    const meta = await this.services.api.post('/api/unfurl', { url });
                    this.update({
                        url: meta.url || url,
                        title: meta.title || url,
                        description: meta.description || '',
                        image_url: meta.image_url || null,
                        site_name: meta.site_name || '',
                    });
                } catch {
                    // Previews are best-effort; keep the bare link.
                    this.update({
                        url,
                        title: url,
                        description: '',
                        image_url: null,
                        site_name: new URL(url).hostname,
                    });
                }
                this.refresh();
            });
            return form;
        }
        const card = el('a', {
            className: 'bookmark-card',
            href: this.content.url,
            target: '_blank',
            rel: 'noopener noreferrer',
        });
        const text = el(
            'div',
            { className: 'bookmark-card__text' },
            el('div', { className: 'bookmark-card__title' }, this.content.title || this.content.url),
            this.content.description
                ? el('div', { className: 'bookmark-card__description' }, this.content.description)
                : null,
            el(
                'div',
                { className: 'bookmark-card__url' },
                this.content.site_name ? `${this.content.site_name} · ` : '',
                this.content.url,
            ),
        );
        card.append(text);
        if (this.content.image_url) {
            card.append(
                el('img', {
                    className: 'bookmark-card__image',
                    src: this.content.image_url,
                    alt: '',
                    loading: 'lazy',
                    referrerPolicy: 'no-referrer',
                }),
            );
        }
        const wrap = el('div', { className: 'bookmark-container' }, card);
        if (!this.readOnly) {
            const reset = el('button', { type: 'button' }, 'Change link');
            this.addEventListener(reset, 'click', () => {
                this.update(this.getDefaultContent());
                this.refresh();
            });
            wrap.append(el('div', { className: 'block-options' }, reset));
        }
        return wrap;
    }

    isEmpty() {
        return !this.content.url;
    }
}
