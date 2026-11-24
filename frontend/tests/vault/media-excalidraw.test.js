import LZString from 'lz-string';
import * as markedLib from 'marked';
import { beforeAll, describe, expect, it } from 'vitest';
import { attachmentFolderFor, imageFileName } from '../../js/vault/app.js';
import {
    isExcalidrawFile,
    isExcalidrawPath,
    newExcalidrawMarkdownTemplate,
    parseEmbeddedFiles,
    parseExcalidraw,
    renderExcalidrawSvg,
    resolveExcalidrawFiles,
    serializeExcalidraw,
} from '../../js/vault/excalidraw.js';
import { LinkIndex } from '../../js/vault/links.js';
import { gitBlobSha } from '../../js/vault/merge.js';
import { hydrate, parseImageAlias, renderNote } from '../../js/vault/render.js';
import { VaultStore } from '../../js/vault/store.js';
import { VaultSync } from '../../js/vault/sync.js';

beforeAll(() => {
    window.marked = markedLib;
    window.LZString = LZString;
});

const sampleElements = [
    {
        id: 'rect-1',
        type: 'rectangle',
        x: 10,
        y: 20,
        width: 120,
        height: 60,
        isDeleted: false,
    },
    {
        id: 'txt-1',
        type: 'text',
        x: 20,
        y: 30,
        width: 80,
        height: 24,
        text: 'Hello Vault',
        originalText: 'Hello Vault',
        isDeleted: false,
    },
];

describe('Excalidraw parsing and serialization', () => {
    it('detects both .excalidraw and .excalidraw.md paths plus frontmatter-tagged notes', () => {
        expect(isExcalidrawPath('Diagrams/Arch.excalidraw')).toBe(true);
        expect(isExcalidrawPath('Diagrams/Arch.excalidraw.md')).toBe(true);
        expect(isExcalidrawPath('Notes/Plain.md')).toBe(false);
        expect(isExcalidrawFile('Custom.md', '---\nexcalidraw-plugin: parsed\n---\nbody')).toBe(true);
        expect(isExcalidrawFile('Custom.md', '---\ntitle: hi\n---\nbody')).toBe(false);
    });

    it('round-trips raw .excalidraw JSON files', () => {
        const raw = JSON.stringify({
            type: 'excalidraw',
            version: 2,
            elements: sampleElements,
            appState: { viewBackgroundColor: '#fafafa', gridSize: 20 },
            files: {},
        });
        const parsed = parseExcalidraw(raw, 'Arch.excalidraw');
        expect(parsed.format).toBe('json');
        expect(parsed.scene.elements).toHaveLength(2);

        const updated = serializeExcalidraw(
            raw,
            {
                elements: [...sampleElements, { id: 'del-1', type: 'rectangle', isDeleted: true }],
                appState: parsed.scene.appState,
                files: {},
            },
            { path: 'Arch.excalidraw', format: parsed.format },
        );
        const reparsed = parseExcalidraw(updated, 'Arch.excalidraw');
        expect(reparsed.scene.elements.map((e) => e.id)).toEqual(['rect-1', 'txt-1']);
        expect(reparsed.scene.appState.viewBackgroundColor).toBe('#fafafa');
    });

    it('round-trips Obsidian .excalidraw.md compressed-json notes and updates # Text Elements', () => {
        const template = newExcalidrawMarkdownTemplate();
        const parsed0 = parseExcalidraw(template, 'Flow.excalidraw.md');
        expect(parsed0.format).toBe('md-compressed');
        expect(parsed0.scene.elements).toEqual([]);

        const saved = serializeExcalidraw(
            template,
            { elements: sampleElements, appState: { viewBackgroundColor: '#ffffff' }, files: {} },
            { path: 'Flow.excalidraw.md', format: 'md-compressed' },
        );
        expect(saved).toContain('excalidraw-plugin: parsed');
        expect(saved).toContain('```compressed-json');
        expect(saved).toContain('Hello Vault ^txt-1');

        const parsed1 = parseExcalidraw(saved, 'Flow.excalidraw.md');
        expect(parsed1.format).toBe('md-compressed');
        expect(parsed1.scene.elements.map((e) => e.id)).toEqual(['rect-1', 'txt-1']);
    });

    it('parses uncompressed ```json .excalidraw.md notes and preserves format', () => {
        const md = [
            '---',
            'excalidraw-plugin: parsed',
            '---',
            '# Text Elements',
            '',
            '# Embedded files',
            'abc123: [[Attachments/logo.png]]',
            'def456: [icon](assets/icon.png)',
            '',
            '%%',
            '# Drawing',
            '```json',
            JSON.stringify({ type: 'excalidraw', version: 2, elements: sampleElements, appState: {} }),
            '```',
            '%%',
        ].join('\n');

        const parsed = parseExcalidraw(md, 'Spec.excalidraw.md');
        expect(parsed.format).toBe('md-json');
        expect([...parsed.embeddedFiles.entries()]).toEqual([
            ['abc123', 'Attachments/logo.png'],
            ['def456', 'assets/icon.png'],
        ]);

        const saved = serializeExcalidraw(
            md,
            { elements: sampleElements, appState: {}, files: {} },
            { path: 'Spec.excalidraw.md', format: parsed.format },
        );
        expect(saved).toContain('```json');
        expect(saved).toContain('abc123: [[Attachments/logo.png]]');
        expect(saved).toContain('Hello Vault ^txt-1');
    });

    it('resolves vault images referenced in # Embedded files into Excalidraw files map', async () => {
        const embedded = parseEmbeddedFiles('# Embedded files\nimg1: [[pic.png]]\n');
        const links = new LinkIndex(['Diagrams/D.excalidraw.md', 'Attachments/pic.png']);
        const sync = {
            blobDataUrl: async (path) =>
                path === 'Attachments/pic.png'
                    ? { dataURL: 'data:image/png;base64,AAAA', mimeType: 'image/png', sha: 's1' }
                    : null,
        };
        const files = await resolveExcalidrawFiles({ files: {} }, embedded, {
            path: 'Diagrams/D.excalidraw.md',
            links,
            sync,
        });
        expect(files.img1?.dataURL).toBe('data:image/png;base64,AAAA');
        expect(files.img1?.mimeType).toBe('image/png');
    });
});

describe('Image and Excalidraw rendering in notes', () => {
    const links = new LinkIndex([
        'Notes/Home.md',
        'Attachments/pic.png',
        'Diagrams/Arch.excalidraw',
        'Diagrams/Flow.excalidraw.md',
    ]);

    it('parses Obsidian image alias sizing and captions for both wikilinks and markdown images', () => {
        expect(parseImageAlias('200')).toEqual({ alt: '', width: '200', height: null });
        expect(parseImageAlias('200x100')).toEqual({ alt: '', width: '200', height: '100' });
        expect(parseImageAlias('caption|320')).toEqual({ alt: 'caption', width: '320', height: null });
        expect(parseImageAlias('caption|320x180')).toEqual({ alt: 'caption', width: '320', height: '180' });
        expect(parseImageAlias('just alt')).toEqual({ alt: 'just alt', width: null, height: null });

        const root = document.createElement('div');
        root.innerHTML = renderNote('![[pic.png|My Diagram|300x150]]\n\n![Architecture|400](../Attachments/pic.png)', {
            path: 'Notes/Home.md',
            links,
        }).html;
        const [wikiImg, mdImg] = root.querySelectorAll('img.vault-img');
        expect(wikiImg.dataset.vaultSrc).toBe('Attachments/pic.png');
        expect(wikiImg.alt).toBe('My Diagram');
        expect(wikiImg.getAttribute('width')).toBe('300');
        expect(wikiImg.getAttribute('height')).toBe('150');
        expect(mdImg.dataset.vaultSrc).toBe('Attachments/pic.png');
        expect(mdImg.alt).toBe('Architecture');
        expect(mdImg.getAttribute('width')).toBe('400');
    });

    it('rewrites raw HTML relative <img src="..."> into vault-src placeholders', () => {
        const root = document.createElement('div');
        root.innerHTML = renderNote(
            '<img src="../Attachments/pic.png" width="120" alt="raw">\n<img src="https://example.com/a.png" alt="ext">',
            { path: 'Notes/Home.md', links },
        ).html;
        const [vaultImg, extImg] = root.querySelectorAll('img');
        expect(vaultImg.dataset.vaultSrc).toBe('Attachments/pic.png');
        expect(vaultImg.hasAttribute('src')).toBe(false);
        expect(vaultImg.getAttribute('width')).toBe('120');
        expect(extImg.getAttribute('src')).toBe('https://example.com/a.png');
    });

    it('emits and hydrates Excalidraw embeds for both .excalidraw and .excalidraw.md', async () => {
        const root = document.createElement('div');
        root.innerHTML = renderNote('![[Arch.excalidraw|500]]\n\n![[Flow.excalidraw.md]]', {
            path: 'Notes/Home.md',
            links,
        }).html;
        const embeds = root.querySelectorAll('.excalidraw-embed');
        expect(embeds).toHaveLength(2);
        expect(embeds[0].dataset.excalidraw).toBe('Diagrams/Arch.excalidraw');
        expect(embeds[0].dataset.width).toBe('500');
        expect(embeds[1].dataset.excalidraw).toBe('Diagrams/Flow.excalidraw.md');

        const fakeRuntime = {
            restore: ({ elements, appState, files }) => ({ elements, appState, files }),
            exportToSvg: async ({ elements }) => {
                const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
                svg.setAttribute('width', '200');
                svg.setAttribute('height', '100');
                svg.dataset.count = String(elements.length);
                return svg;
            },
        };
        const sync = {
            text: async (path) =>
                path.endsWith('.md')
                    ? newExcalidrawMarkdownTemplate()
                    : JSON.stringify({ type: 'excalidraw', version: 2, elements: sampleElements }),
        };
        await hydrate(root, { path: 'Notes/Home.md', links, sync, excalidrawRuntime: fakeRuntime });
        const svgs = root.querySelectorAll('.excalidraw-embed svg.excalidraw-svg');
        expect(svgs).toHaveLength(2);
        expect(svgs[0].getAttribute('viewBox')).toBe('0 0 200 100');
        expect(svgs[0].dataset.count).toBe('2');
        expect(svgs[1].dataset.count).toBe('0');

        // Direct renderExcalidrawSvg check.
        const direct = await renderExcalidrawSvg(
            JSON.stringify({ type: 'excalidraw', version: 2, elements: sampleElements }),
            { path: 'Diagrams/Arch.excalidraw', runtime: fakeRuntime },
        );
        expect(direct.svg.classList.contains('excalidraw-svg')).toBe(true);
    });
});

describe('Attachment folder resolution and binary blob upload sync', () => {
    it('resolves Obsidian attachmentFolderPath settings', () => {
        expect(attachmentFolderFor('Projects/Plan.md', {})).toBe('');
        expect(attachmentFolderFor('Projects/Plan.md', { attachmentFolderPath: 'Attachments' })).toBe('Attachments');
        expect(attachmentFolderFor('Projects/Plan.md', { attachmentFolderPath: './' })).toBe('Projects');
        expect(attachmentFolderFor('Projects/Plan.md', { attachmentFolderPath: './assets' })).toBe('Projects/assets');
        expect(attachmentFolderFor('Root.md', { attachmentFolderPath: './assets' })).toBe('assets');
    });

    it('generates clean names for pasted and named image files', () => {
        const d = new Date(2026, 10, 24, 14, 5, 9);
        expect(imageFileName({ name: 'image.png', type: 'image/png' }, d)).toBe('Pasted image 20261124140509.png');
        expect(imageFileName({ name: 'diagram:v1.webp', type: 'image/webp' }, d)).toBe('diagram-v1.webp');
    });

    it('saves binary blobs locally, preserves them across pruneBlobs, and commits base64 on push', async () => {
        const store = new VaultStore(`test-blob-upload-${Date.now()}`);
        const commits = [];
        const github = {
            headCommit: async () => 'h1',
            listFiles: async () => [],
            commit: async (payload) => {
                commits.push(payload);
                return { oid: 'h2', url: '' };
            },
        };
        await store.setMeta('head', 'h1');
        const sync = new VaultSync({ store, github, branch: 'main', pushDelayMs: 60_000 });

        const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
        const expectedSha = await gitBlobSha(bytes);
        const saved = await sync.saveBlobLocal('Attachments/shot.png', bytes.buffer);
        expect(saved.sha).toBe(expectedSha);

        // pruneBlobs must NOT delete the pending uploaded blob before it's pushed.
        expect(await store.pruneBlobs()).toBe(0);
        expect(await store.getBlob(expectedSha)).toBeTruthy();

        const dataUrl = await sync.blobDataUrl('Attachments/shot.png');
        expect(dataUrl.mimeType).toBe('image/png');
        expect(dataUrl.dataURL).toMatch(/^data:image\/png;base64,/);

        await sync.push();
        expect(commits).toHaveLength(1);
        expect(commits[0].additions[0].path).toBe('Attachments/shot.png');
        expect(commits[0].additions[0].base64).toBe(dataUrl.dataURL.split(',')[1]);
        expect((await store.getFile('Attachments/shot.png'))?.sha).toBe(expectedSha);
    });
});
