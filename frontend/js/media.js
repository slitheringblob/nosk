import { api } from './api-client.js';
import { storage } from './storage.js';
import { sha256Hex } from './utils.js';

const objectUrls = new Map();

/** Media access for blocks. Blobs are cached in IndexedDB so images work offline. */
export const media = {
    async upload(file) {
        // crypto.subtle only exists on HTTPS/localhost; over plain http on a LAN, skip the checksum.
        const checksum = globalThis.crypto?.subtle ? await sha256Hex(await file.arrayBuffer()) : null;
        const assetId = await api.uploadFile(file, checksum);
        await storage.putMedia(assetId, file);
        return assetId;
    },

    async blob(assetId) {
        const cached = await storage.getMedia(assetId);
        if (cached) return cached;
        const blob = await api.fetchMedia(assetId);
        await storage.putMedia(assetId, blob);
        return blob;
    },

    async url(assetId) {
        if (objectUrls.has(assetId)) return objectUrls.get(assetId);
        const url = URL.createObjectURL(await this.blob(assetId));
        objectUrls.set(assetId, url);
        return url;
    },
};
