import BaseComponent from './base-component.js';
import { createUploader } from './media-helpers.js';
import { downloadFile, el, formatBytes } from '../utils.js';

export default class FileComponent extends BaseComponent {
    static type = 'file';
    static label = 'File';
    static icon = '📎';
    static category = 'media';
    static description = 'Attach a file';
    static keywords = ['file', 'attachment', 'upload', 'pdf', 'document'];

    getDefaultContent() {
        return { asset_id: null, filename: '', mime_type: '', size: 0 };
    }

    renderBody() {
        if (!this.content.asset_id) {
            if (this.readOnly) return el('div', { className: 'muted' }, 'No file');
            return createUploader(this, {
                label: 'Attach a file',
                onFile: async (file) => {
                    const assetId = await this.services.media.upload(file);
                    this.update({
                        asset_id: assetId,
                        filename: file.name.slice(0, 255),
                        mime_type: file.type || 'application/octet-stream',
                        size: file.size,
                    });
                    this.refresh();
                },
            });
        }
        const download = el(
            'button',
            { type: 'button', className: 'file-card' },
            el('span', { className: 'file-card__icon' }, '📎'),
            el('span', { className: 'file-card__name' }, this.content.filename || 'file'),
            el('span', { className: 'file-card__meta' }, formatBytes(this.content.size)),
        );
        this.addEventListener(download, 'click', async () => {
            const blob = await this.services.media.blob(this.content.asset_id);
            downloadFile(this.content.filename || 'download', blob);
        });
        return el('div', { className: 'file-container' }, download);
    }

    isEmpty() {
        return !this.content.asset_id;
    }
}
