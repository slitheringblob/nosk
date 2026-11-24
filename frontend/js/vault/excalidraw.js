// Excalidraw support for nosk: parses and serializes both raw `.excalidraw` JSON files and
// Obsidian Excalidraw `.excalidraw.md` notes (compressed-json or json blocks), resolves embedded
// vault image files, renders read-only SVGs for inline embeds, and mounts the full interactive
// `@excalidraw/excalidraw` editor lazily from `lib/excalidraw/bundle.js`.
import { splitFrontmatter } from './render.js';

const EXCALIDRAW_PATH_RE = /\.excalidraw(?:\.md)?$/i;
const EXCALIDRAW_MD_RE = /\.excalidraw\.md$/i;
const BLOCK_RE = /```(compressed-json|json)[ \t]*\r?\n([\s\S]*?)\r?\n```/;

/** True for both `foo.excalidraw` and `foo.excalidraw.md`. */
export const isExcalidrawPath = (path) => EXCALIDRAW_PATH_RE.test(String(path || ''));

/** True for Obsidian Excalidraw markdown wrappers (`foo.excalidraw.md`). */
export const isExcalidrawMarkdownPath = (path) => EXCALIDRAW_MD_RE.test(String(path || ''));

/** True if the path or frontmatter marks this file as an Obsidian Excalidraw drawing. */
export function isExcalidrawFile(path, text = null) {
    if (isExcalidrawPath(path)) return true;
    if (text == null) return false;
    const { data } = splitFrontmatter(text);
    return Boolean(data['excalidraw-plugin']);
}

function getLZString() {
    const lz = globalThis.window?.LZString || globalThis.LZString;
    if (!lz) throw new Error('LZString library is not loaded');
    return lz;
}

/**
 * Extract the `# Embedded files` section from an Obsidian `.excalidraw.md` note:
 * lines like `fileId: [[path/to/image.png]]` or `fileId: [alias](path/to/image.png)`.
 * Returns Map(fileId → raw target string).
 */
export function parseEmbeddedFiles(text) {
    const map = new Map();
    const lines = String(text || '').split(/\r?\n/);
    const start = lines.findIndex((line) => /^#{1,6}\s+Embedded files[ \t]*$/i.test(line));
    if (start < 0) return map;
    for (let i = start + 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (/^#{1,6}\s/.test(line) || /^\s*%%\s*$/.test(line)) break;
        const wiki = line.match(/^\s*([A-Za-z0-9_-]+):\s*\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/);
        if (wiki) {
            map.set(wiki[1], wiki[2].trim());
            continue;
        }
        const md = line.match(/^\s*([A-Za-z0-9_-]+):\s*\[[^\]]*\]\((?:<([^>]+)>|([^)\s]+))\)/);
        if (md) {
            map.set(md[1], (md[2] || md[3]).trim());
        }
    }
    return map;
}

/**
 * Parse a `.excalidraw` or `.excalidraw.md` file into a normalized scene:
 * `{ format: 'json' | 'md-compressed' | 'md-json', scene: { type, version, source, elements, appState, files }, embeddedFiles: Map }`.
 */
export function parseExcalidraw(text, path = '') {
    const raw = String(text ?? '');
    const embeddedFiles = parseEmbeddedFiles(raw);
    const trimmed = raw.trim();

    // Raw JSON `.excalidraw` (or JSON content directly).
    if (!isExcalidrawMarkdownPath(path) && (trimmed.startsWith('{') || !BLOCK_RE.test(raw))) {
        const parsed = trimmed ? JSON.parse(trimmed) : {};
        return {
            format: 'json',
            scene: normalizeScene(parsed),
            embeddedFiles,
        };
    }

    const match = raw.match(BLOCK_RE);
    if (!match) {
        if (!trimmed) {
            return { format: 'md-compressed', scene: normalizeScene({}), embeddedFiles };
        }
        throw new Error('No Excalidraw drawing block found in this file.');
    }

    const kind = match[1];
    const payload = match[2];
    let jsonText;
    if (kind === 'compressed-json') {
        // Obsidian wraps base64 lines at ~256 chars; strip all whitespace before decompressing.
        const compact = payload.replace(/\s+/g, '');
        jsonText = getLZString().decompressFromBase64(compact);
        if (!jsonText) throw new Error('Could not decompress Excalidraw drawing data.');
    } else {
        jsonText = payload;
    }
    const parsed = JSON.parse(jsonText);
    return {
        format: kind === 'compressed-json' ? 'md-compressed' : 'md-json',
        scene: normalizeScene(parsed),
        embeddedFiles,
    };
}

function normalizeScene(parsed) {
    const scene = parsed && typeof parsed === 'object' ? parsed : {};
    const appState = scene.appState && typeof scene.appState === 'object' ? { ...scene.appState } : {};
    // Strip transient collaborator / UI fields that shouldn't leak across sessions.
    delete appState.collaborators;
    return {
        type: 'excalidraw',
        version: scene.version ?? 2,
        source: scene.source ?? 'https://excalidraw.com',
        elements: Array.isArray(scene.elements) ? scene.elements : [],
        appState,
        files: scene.files && typeof scene.files === 'object' ? { ...scene.files } : {},
    };
}

/** Extract visible text elements for Obsidian `.excalidraw.md` `# Text Elements` section. */
function buildTextElementsSection(elements) {
    return (elements || [])
        .filter((el) => el && !el.isDeleted && el.type === 'text' && typeof el.text === 'string' && el.text.trim())
        .map((el) => `${(el.originalText ?? el.text).trim()} ^${el.id}`)
        .join('\n\n');
}

/** Wrap a base64 string into 256-char lines the way obsidian-excalidraw does. */
function wrapBase64(value, width = 256) {
    const lines = [];
    for (let i = 0; i < value.length; i += width) lines.push(value.slice(i, i + width));
    return lines.join('\n');
}

/** Clean Excalidraw scene JSON payload suitable for saving to `.excalidraw` or `.excalidraw.md`. */
export function buildSceneJSON(elements, appState = {}, files = {}) {
    const cleanState = {
        gridSize: appState.gridSize ?? null,
        viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
    };
    if (appState.theme) cleanState.theme = appState.theme;
    const cleanElements = (elements || []).filter((el) => el && !el.isDeleted);
    const usedIds = new Set(cleanElements.filter((el) => el.type === 'image' && el.fileId).map((el) => el.fileId));
    const cleanFiles = {};
    for (const [id, file] of Object.entries(files || {})) {
        if (usedIds.has(id) && file?.dataURL) cleanFiles[id] = file;
    }
    return JSON.stringify(
        {
            type: 'excalidraw',
            version: 2,
            source: 'https://nosk.jaydeepganatra.dev',
            elements: cleanElements,
            appState: cleanState,
            files: cleanFiles,
        },
        null,
        2,
    );
}

/**
 * Serialize updated `{ elements, appState, files }` back into the original file's format:
 * - `.excalidraw`: pretty JSON.
 * - `.excalidraw.md`: preserves existing frontmatter, embedded files, and surrounding sections,
 *   replacing the `# Text Elements` list and the `compressed-json`/`json` drawing block in place.
 */
export function serializeExcalidraw(originalText, { elements, appState, files }, { path = '', format } = {}) {
    const json = buildSceneJSON(elements, appState, files);
    const targetFormat =
        format || (isExcalidrawMarkdownPath(path) || BLOCK_RE.test(originalText || '') ? 'md-compressed' : 'json');

    if (targetFormat === 'json') return `${json}\n`;

    const blockLang = targetFormat === 'md-json' ? 'json' : 'compressed-json';
    const blockBody = blockLang === 'compressed-json' ? wrapBase64(getLZString().compressToBase64(json)) : json;
    const newBlock = `\`\`\`${blockLang}\n${blockBody}\n\`\`\``;
    const textSection = buildTextElementsSection(elements);

    let out = String(originalText || '');
    if (!out.trim() || !BLOCK_RE.test(out)) {
        return newExcalidrawMarkdownTemplate({ textSection, block: newBlock });
    }

    // Replace the drawing block in place.
    out = out.replace(BLOCK_RE, () => newBlock);

    // Update `# Text Elements` if present so Obsidian search stays in sync.
    out = out.replace(
        /(^#{1,6}\s+Text Elements[ \t]*\r?\n)([\s\S]*?)(?=^#{1,6}\s|^\s*%%\s*$)/im,
        (_, heading) => `${heading}${textSection ? `${textSection}\n\n` : '\n'}`,
    );

    return out;
}

/** Default template for a newly created `.excalidraw.md` drawing compatible with obsidian-excalidraw. */
export function newExcalidrawMarkdownTemplate({ textSection = '', block = null } = {}) {
    const drawingBlock =
        block ??
        `\`\`\`compressed-json\n${wrapBase64(getLZString().compressToBase64(buildSceneJSON([], {}, {})))}\n\`\`\``;
    return [
        '---',
        '',
        'excalidraw-plugin: parsed',
        'tags: [excalidraw]',
        '',
        '---',
        '==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==',
        '',
        '',
        '# Text Elements',
        ...(textSection ? [textSection, ''] : ['']),
        '%%',
        '# Drawing',
        drawingBlock,
        '%%',
        '',
    ].join('\n');
}

/**
 * Resolve vault-backed images listed in an `.excalidraw.md` `# Embedded files` section into
 * Excalidraw's `files` map (`{ [fileId]: { id, mimeType, dataURL, created } }`).
 */
export async function resolveExcalidrawFiles(scene, embeddedFiles, { path = '', links = null, sync = null } = {}) {
    const files = { ...(scene.files || {}) };
    if (!embeddedFiles?.size || !sync?.blobDataUrl) return files;
    const jobs = [];
    for (const [fileId, target] of embeddedFiles.entries()) {
        if (files[fileId]?.dataURL) continue;
        const resolved = links?.resolveWikilink(target, path) || links?.resolveHref(target, path) || null;
        if (!resolved) continue;
        jobs.push(
            sync
                .blobDataUrl(resolved)
                .then((data) => {
                    if (!data) return;
                    files[fileId] = {
                        id: fileId,
                        mimeType: data.mimeType,
                        dataURL: data.dataURL,
                        created: Date.now(),
                    };
                })
                .catch(() => {}),
        );
    }
    await Promise.all(jobs);
    return files;
}

// ---------------------------------------------------------------- lazy Excalidraw runtime

let runtimePromise = null;
let cssLoaded = false;

function ensureExcalidrawStyles() {
    if (cssLoaded || typeof document === 'undefined') return;
    cssLoaded = true;
    const href = new URL('../../lib/excalidraw/index.css', import.meta.url).href;
    if (document.querySelector(`link[data-excalidraw-css]`)) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset.excalidrawCss = 'true';
    document.head.append(link);
}

/** Lazy-load the vendored `@excalidraw/excalidraw` + React bundle and point asset paths locally. */
export function loadExcalidrawRuntime() {
    if (!runtimePromise) {
        if (typeof window !== 'undefined') {
            window.EXCALIDRAW_ASSET_PATH = new URL('../../lib/excalidraw/', import.meta.url).href;
        }
        ensureExcalidrawStyles();
        runtimePromise = import('../../lib/excalidraw/bundle.js');
    }
    return runtimePromise;
}

/** Current app theme as Excalidraw expects it ('dark' | 'light'). */
export function currentExcalidrawTheme() {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Render an Excalidraw scene to an `<svg>` element via `@excalidraw/excalidraw`'s `exportToSvg`.
 * Respects current light/dark theme unless overridden.
 */
export async function renderExcalidrawSvg(
    text,
    { path = '', links = null, sync = null, theme = currentExcalidrawTheme(), runtime = null } = {},
) {
    const parsed = parseExcalidraw(text, path);
    const files = await resolveExcalidrawFiles(parsed.scene, parsed.embeddedFiles, { path, links, sync });
    const mod = runtime || (await loadExcalidrawRuntime());
    const dark = theme === 'dark';
    const restored = mod.restore(
        { elements: parsed.scene.elements, appState: parsed.scene.appState, files },
        null,
        null,
    );
    const svg = await mod.exportToSvg({
        elements: restored.elements,
        appState: {
            ...restored.appState,
            exportWithDarkMode: dark,
            exportBackground: true,
        },
        files: restored.files,
        exportPadding: 16,
    });
    svg.classList.add('excalidraw-svg');
    // Keep natural pixel width when smaller than the container, while scaling down responsively.
    const w = parseFloat(svg.getAttribute('width'));
    const h = parseFloat(svg.getAttribute('height'));
    if (w && h && !svg.getAttribute('viewBox')) {
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }
    if (w) svg.style.width = `${w}px`;
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    return { svg, parsed, files };
}

/**
 * Mount the interactive Excalidraw React component into `container`.
 * Returns `{ flush(), unmount(), exportSvg(), setTheme(theme) }`.
 */
export async function mountExcalidrawEditor(
    container,
    {
        text,
        path = '',
        links = null,
        sync = null,
        viewMode = false,
        theme = currentExcalidrawTheme(),
        onSave = null,
        saveDelay = 600,
        runtime = null,
    } = {},
) {
    const parsed = parseExcalidraw(text, path);
    const resolvedFiles = await resolveExcalidrawFiles(parsed.scene, parsed.embeddedFiles, { path, links, sync });
    const mod = runtime || (await loadExcalidrawRuntime());
    const { React, createRoot, Excalidraw, getSceneVersion } = mod;

    let latestElements = parsed.scene.elements;
    let latestAppState = parsed.scene.appState;
    let latestFiles = resolvedFiles;
    let savedVersion = getSceneVersion(parsed.scene.elements);
    let savedFilesCount = Object.keys(resolvedFiles).length;
    let savedBg = parsed.scene.appState?.viewBackgroundColor;
    let currentText = text;
    let dirty = false;
    let timer = null;
    let api = null;

    const persist = () => {
        if (!dirty || !onSave) return;
        dirty = false;
        const next = serializeExcalidraw(
            currentText,
            { elements: latestElements, appState: latestAppState, files: latestFiles },
            { path, format: parsed.format },
        );
        if (next === currentText) return;
        currentText = next;
        savedVersion = getSceneVersion(latestElements);
        savedFilesCount = Object.keys(latestFiles || {}).length;
        savedBg = latestAppState?.viewBackgroundColor;
        return onSave(next);
    };

    const scheduleSave = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            persist();
        }, saveDelay);
    };

    let currentTheme = theme;
    let isViewMode = viewMode;
    const root = createRoot(container);

    const renderComponent = () => {
        root.render(
            React.createElement(Excalidraw, {
                initialData: {
                    elements: latestElements,
                    appState: {
                        ...latestAppState,
                        theme: currentTheme,
                    },
                    files: latestFiles,
                    scrollToContent: true,
                },
                theme: currentTheme,
                viewModeEnabled: isViewMode,
                excalidrawAPI: (instance) => {
                    api = instance;
                },
                onChange: (elements, appState, files) => {
                    latestElements = elements;
                    latestAppState = appState;
                    latestFiles = files;
                    if (isViewMode) return;
                    const version = getSceneVersion(elements);
                    const filesCount = Object.keys(files || {}).length;
                    const bg = appState?.viewBackgroundColor;
                    if (version !== savedVersion || filesCount !== savedFilesCount || bg !== savedBg) {
                        dirty = true;
                        scheduleSave();
                    }
                },
                UIOptions: {
                    canvasActions: {
                        loadScene: false,
                        saveToActiveFile: false,
                        toggleTheme: true,
                        export: { saveFileToDisk: true },
                    },
                },
            }),
        );
    };

    renderComponent();

    return {
        get dirty() {
            return dirty;
        },
        flush() {
            clearTimeout(timer);
            return persist();
        },
        setTheme(nextTheme) {
            currentTheme = nextTheme;
            if (api) api.updateScene({ appState: { theme: nextTheme } });
            else renderComponent();
        },
        setViewMode(nextViewMode) {
            isViewMode = nextViewMode;
            renderComponent();
        },
        async exportSvg() {
            const svg = await mod.exportToSvg({
                elements: api ? api.getSceneElements() : latestElements,
                appState: {
                    ...(api ? api.getAppState() : latestAppState),
                    exportWithDarkMode: currentTheme === 'dark',
                    exportBackground: true,
                },
                files: api ? api.getFiles() : latestFiles,
                exportPadding: 16,
            });
            return new XMLSerializer().serializeToString(svg);
        },
        unmount() {
            clearTimeout(timer);
            persist();
            root.unmount();
        },
    };
}
