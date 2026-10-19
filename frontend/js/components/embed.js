import BaseComponent from './base-component.js';
import { el } from '../utils.js';

// Only these providers are framed; anything else falls back to a link.
const PROVIDERS = [
    {
        name: 'youtube',
        match: /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i,
        src: (m) => `https://www.youtube-nocookie.com/embed/${m[1]}`,
        height: 400,
    },
    {
        name: 'vimeo',
        match: /^https?:\/\/(?:www\.)?vimeo\.com\/(\d+)/i,
        src: (m) => `https://player.vimeo.com/video/${m[1]}`,
        height: 400,
    },
    {
        name: 'loom',
        match: /^https?:\/\/(?:www\.)?loom\.com\/share\/(\w+)/i,
        src: (m) => `https://www.loom.com/embed/${m[1]}`,
        height: 400,
    },
    {
        name: 'figma',
        match: /^(https?:\/\/(?:www\.)?figma\.com\/(?:file|design|proto)\/.+)$/i,
        src: (m) => `https://www.figma.com/embed?embed_host=nosk&url=${encodeURIComponent(m[1])}`,
        height: 480,
    },
    {
        name: 'codepen',
        match: /^https?:\/\/codepen\.io\/([\w-]+)\/pen\/(\w+)/i,
        src: (m) => `https://codepen.io/${m[1]}/embed/${m[2]}?default-tab=result`,
        height: 400,
    },
    {
        name: 'spotify',
        match: /^https?:\/\/open\.spotify\.com\/(track|album|playlist|episode|show)\/(\w+)/i,
        src: (m) => `https://open.spotify.com/embed/${m[1]}/${m[2]}`,
        height: 352,
    },
    {
        name: 'google-maps',
        match: /^(https?:\/\/(?:www\.)?google\.com\/maps\/embed\?.+)$/i,
        src: (m) => m[1],
        height: 400,
    },
];

export function resolveEmbed(url) {
    for (const provider of PROVIDERS) {
        const match = String(url || '').match(provider.match);
        if (match) return { provider: provider.name, src: provider.src(match), height: provider.height };
    }
    return null;
}

export default class EmbedComponent extends BaseComponent {
    static type = 'embed';
    static label = 'Embed';
    static icon = '▶';
    static category = 'media';
    static description = 'YouTube, Vimeo, Loom, Figma, CodePen, Spotify…';
    static keywords = ['embed', 'video', 'youtube', 'vimeo', 'figma', 'iframe', 'loom', 'spotify'];

    getDefaultContent() {
        return { url: null, provider: '', height: 400 };
    }

    renderBody() {
        if (!this.content.url) {
            if (this.readOnly) return el('div', { className: 'muted' }, 'Empty embed');
            const form = el('form', { className: 'url-form' });
            const input = el('input', {
                type: 'url',
                placeholder: 'Paste a YouTube, Vimeo, Loom, Figma, CodePen or Spotify link…',
                required: true,
            });
            const error = el('span', { className: 'form-error' });
            form.append(input, el('button', { type: 'submit', className: 'btn btn-primary btn-sm' }, 'Embed'), error);
            this.addEventListener(form, 'submit', (event) => {
                event.preventDefault();
                const resolved = resolveEmbed(input.value.trim());
                if (!resolved) {
                    error.textContent = 'That site is not supported. Try a web bookmark instead.';
                    return;
                }
                this.update({ url: input.value.trim(), provider: resolved.provider, height: resolved.height });
                this.refresh();
            });
            return form;
        }
        const resolved = resolveEmbed(this.content.url);
        const container = el('div', { className: 'embed-container' });
        if (!resolved) {
            container.append(
                el('a', { href: this.content.url, target: '_blank', rel: 'noopener noreferrer' }, this.content.url),
            );
            return container;
        }
        const frame = el('iframe', {
            src: resolved.src,
            title: `${resolved.provider} embed`,
            loading: 'lazy',
            allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write',
            allowFullscreen: true,
            referrerPolicy: 'strict-origin-when-cross-origin',
            sandbox: 'allow-scripts allow-same-origin allow-presentation allow-popups allow-forms',
            style: { height: `${this.content.height}px` },
        });
        container.append(frame);
        if (!this.readOnly) {
            const height = el('input', {
                type: 'range',
                min: 150,
                max: 1200,
                step: 10,
                value: this.content.height,
                ariaLabel: 'Embed height',
            });
            this.addEventListener(height, 'input', () => {
                frame.style.height = `${height.value}px`;
            });
            this.addEventListener(height, 'change', () => this.update({ height: Number(height.value) }));
            const reset = el('button', { type: 'button' }, 'Change link');
            this.addEventListener(reset, 'click', () => {
                this.update(this.getDefaultContent());
                this.refresh();
            });
            container.append(
                el(
                    'div',
                    { className: 'block-options' },
                    el('span', { className: 'eyebrow' }, resolved.provider),
                    height,
                    reset,
                ),
            );
        }
        return container;
    }

    isEmpty() {
        return !this.content.url;
    }
}
