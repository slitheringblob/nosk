import BaseComponent from './base-component.js';
import { createUploader } from './media-helpers.js';
import { el } from '../utils.js';

export default class ImageComponent extends BaseComponent {
    static type = 'image';
    static label = 'Image';
    static icon = '🖼';
    static category = 'media';
    static description = 'Upload or embed an image';
    static keywords = ['image', 'picture', 'photo', 'img'];

    getDefaultContent() {
        return {
            asset_id: null,
            url: null,
            alt: '',
            caption: '',
            width: 100,
            natural_width: null,
            natural_height: null,
        };
    }

    renderBody() {
        const container = el('figure', { className: 'image-container' });
        if (!this.content.asset_id && !this.content.url) {
            if (this.readOnly) return el('div', { className: 'muted' }, 'No image');
            container.append(
                createUploader(this, {
                    accept: 'image/*',
                    label: 'Add an image',
                    allowUrl: true,
                    onFile: async (file) => {
                        const assetId = await this.services.media.upload(file);
                        this.update({
                            asset_id: assetId,
                            url: null,
                            alt: this.content.alt || file.name.replace(/\.\w+$/, ''),
                        });
                        this.refresh();
                    },
                    onUrl: (url) => {
                        if (!/^https?:\/\//i.test(url)) return;
                        this.update({ url, asset_id: null });
                        this.refresh();
                    },
                }),
            );
            return container;
        }

        const frame = el('div', { className: 'image-frame', style: { width: `${this.content.width || 100}%` } });
        const img = el('img', { alt: this.content.alt || '', loading: 'lazy', decoding: 'async' });
        if (this.content.natural_width && this.content.natural_height) {
            img.style.aspectRatio = `${this.content.natural_width} / ${this.content.natural_height}`;
        }
        this.addEventListener(img, 'load', () => {
            if (!this.readOnly && !this.content.natural_width) {
                this.update({ natural_width: img.naturalWidth, natural_height: img.naturalHeight });
            }
        });
        this.addEventListener(img, 'error', () => frame.classList.add('is-broken'));
        if (this.content.url) img.src = this.content.url;
        else
            this.services.media
                ?.url(this.content.asset_id)
                .then((src) => {
                    img.src = src;
                })
                .catch(() => frame.classList.add('is-broken'));
        frame.append(img);

        if (!this.readOnly) {
            const resize = el('input', {
                type: 'range',
                min: 20,
                max: 100,
                step: 5,
                value: this.content.width || 100,
                ariaLabel: 'Image width',
            });
            this.addEventListener(resize, 'input', () => {
                frame.style.width = `${resize.value}%`;
            });
            this.addEventListener(resize, 'change', () => this.update({ width: Number(resize.value) }));
            const alt = el('button', { type: 'button' }, 'Alt text');
            this.addEventListener(alt, 'click', () => {
                const value = window.prompt('Describe the image for screen readers', this.content.alt);
                if (value !== null) {
                    this.update({ alt: value.slice(0, 300) });
                    img.alt = value;
                }
            });
            const replace = el('button', { type: 'button' }, 'Replace');
            this.addEventListener(replace, 'click', () => {
                this.update({ asset_id: null, url: null, natural_width: null, natural_height: null });
                this.refresh();
            });
            container.append(el('div', { className: 'block-options image-options' }, resize, alt, replace));
        }
        container.append(frame);
        const caption = this.editable({
            tag: 'figcaption',
            className: 'image-caption',
            rich: false,
            singleLine: true,
            value: this.content.caption,
            placeholder: this.readOnly ? '' : 'Add a caption…',
            onInput: (text) => this.update({ caption: text.slice(0, 500) }),
        });
        container.append(caption);
        return container;
    }

    isEmpty() {
        return !this.content.asset_id && !this.content.url;
    }
}
