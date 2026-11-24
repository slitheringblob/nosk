// Obsidian-flavoured markdown to HTML: [[wikilinks]], ![[embeds]], #tags, ==highlights==,
// %%comments%%, $math$, callouts, frontmatter and custom task states, on top of marked's GFM.
// renderNote() returns sanitized HTML; hydrate() then fills in the parts that need the DOM or
// the vault (images, embedded notes, math, syntax highlighting).
import { highlightCode, renderMath } from '../markdown.js';
import { escapeHTML } from '../utils.js';
import { isExcalidrawFile, isExcalidrawPath, renderExcalidrawSvg } from './excalidraw.js';
import { displayName, parseLinkTarget } from './links.js';
import { kindOf } from './sync.js';
/** Hash route of a vault file, optionally scrolled to a heading or block. */
export function noteHref(path, fragment) {
    return `#/n/${encodeURIComponent(path)}${fragment ? `?h=${encodeURIComponent(fragment)}` : ''}`;
}

// ---------------------------------------------------------------- frontmatter

const unquote = (value) => {
    const v = value.trim();
    return /^(['"]).*\1$/.test(v) ? v.slice(1, -1) : v;
};

/** Just enough YAML for Obsidian properties: scalars, inline [lists] and "- item" lists. */
export function parseFrontmatter(source) {
    const data = {};
    let listKey = null;
    for (const line of source.split(/\r?\n/)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const item = line.match(/^\s+-\s*(.*)$/) || (listKey && line.match(/^-\s*(.*)$/));
        if (item && listKey) {
            data[listKey].push(unquote(item[1]));
            continue;
        }
        const pair = line.match(/^([^\s:][^:]*):\s*(.*)$/);
        if (!pair) {
            listKey = null;
            continue;
        }
        const key = pair[1].trim();
        const value = pair[2].trim();
        if (!value) {
            data[key] = [];
            listKey = key;
        } else if (value.startsWith('[') && value.endsWith(']')) {
            data[key] = value.slice(1, -1).split(',').map(unquote).filter(Boolean);
            listKey = null;
        } else {
            data[key] = unquote(value);
            listKey = null;
        }
    }
    for (const [key, value] of Object.entries(data)) if (Array.isArray(value) && !value.length) data[key] = '';
    return data;
}

/** { data, body } with the leading `---` block split off. */
export function splitFrontmatter(text) {
    const match = String(text ?? '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    if (!match) return { data: {}, body: String(text ?? ''), hasFrontmatter: false };
    return { data: parseFrontmatter(match[1]), body: text.slice(match[0].length), hasFrontmatter: true };
}

const TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;

/** Tags from frontmatter (`tags`/`tag`) and #tags in the body, outside code. */
export function noteTags(text) {
    const { data, body } = splitFrontmatter(text);
    const tags = new Set();
    for (const key of ['tags', 'tag']) {
        const value = data[key];
        const list = Array.isArray(value) ? value : String(value || '').split(/[,\s]+/);
        list.map((t) => t.replace(/^#/, '').trim()).forEach((t) => t && tags.add(t));
    }
    const prose = body.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
    for (const match of prose.matchAll(TAG_RE)) tags.add(match[1]);
    return [...tags];
}

// ---------------------------------------------------------------- marked extensions

// marked renders synchronously, so the note being rendered is passed to the renderers here.
let context = { path: '', links: null };

function safeDecode(value) {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

const isExternal = (href) => /^[a-z][a-z0-9+.-]*:/i.test(href || '');

/**
 * Parse Obsidian image alias/alt text for optional trailing `|width` or `|widthxheight`:
 *   "200"           → { alt: '', width: '200', height: null }
 *   "200x100"       → { alt: '', width: '200', height: '100' }
 *   "caption|200"   → { alt: 'caption', width: '200', height: null }
 *   "caption"       → { alt: 'caption', width: null, height: null }
 */
export function parseImageAlias(raw) {
    const value = String(raw || '').trim();
    if (!value) return { alt: '', width: null, height: null };
    const parts = value.split('|').map((p) => p.trim());
    const last = parts[parts.length - 1];
    const size = last.match(/^(\d+)(?:x(\d+))?$/);
    if (size) {
        return {
            alt: parts.slice(0, -1).join(' | '),
            width: size[1],
            height: size[2] || null,
        };
    }
    return { alt: value, width: null, height: null };
}

function sizeAttrs(width, height) {
    if (!width) return '';
    return ` width="${width}"${height ? ` height="${height}"` : ''}`;
}

function excalidrawEmbedHTML(resolved, alias) {
    const { width, height } = parseImageAlias(alias);
    const dims = `${width ? ` data-width="${width}"` : ''}${height ? ` data-height="${height}"` : ''}`;
    return `<div class="excalidraw-embed" data-excalidraw="${escapeHTML(resolved)}"${dims}></div>`;
}

function wikilinkHTML({ embed, raw }) {
    const { target, fragment, alias } = parseLinkTarget(raw);
    const resolved = context.links?.resolveWikilink(target, context.path) ?? null;
    const label = escapeHTML(alias && !embed ? alias : fragment && !target ? fragment : raw.split('|')[0]);
    if (!resolved) {
        return `<a class="wikilink is-unresolved" title="Not in this vault">${embed ? '⧉ ' : ''}${label}</a>`;
    }
    const kind = kindOf(resolved);
    const path = escapeHTML(resolved);
    if (embed && isExcalidrawPath(resolved)) {
        return excalidrawEmbedHTML(resolved, alias);
    }
    if (embed && kind === 'image') {
        const { alt, width, height } = parseImageAlias(alias);
        return `<img class="vault-img" data-vault-src="${path}" alt="${escapeHTML(alt || displayName(resolved))}"${sizeAttrs(width, height)}>`;
    }
    if (embed && kind === 'note') {
        return `<div class="note-embed" data-embed="${path}" data-fragment="${escapeHTML(fragment || '')}"></div>`;
    }
    const href = escapeHTML(noteHref(resolved, fragment));
    const text = embed ? `⧉ ${escapeHTML(alias || displayName(resolved))}` : label;
    return `<a class="wikilink${kind === 'note' ? '' : ' wikilink--file'}" href="${href}">${text}</a>`;
}

const extensions = [
    {
        name: 'comment',
        level: 'block',
        start: (src) => src.match(/^%%/m)?.index,
        tokenizer: (src) => {
            const match = src.match(/^%%[\s\S]*?%%[ \t]*(?:\n|$)/);
            return match ? { type: 'comment', raw: match[0] } : undefined;
        },
        renderer: () => '',
    },
    {
        name: 'mathBlock',
        level: 'block',
        start: (src) => src.match(/^\$\$/m)?.index,
        tokenizer: (src) => {
            const match = src.match(/^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/);
            return match ? { type: 'mathBlock', raw: match[0], tex: match[1].trim() } : undefined;
        },
        renderer: (token) => `<div class="math-block" data-tex="${escapeHTML(token.tex)}"></div>`,
    },
    {
        name: 'inlineComment',
        level: 'inline',
        start: (src) => (src.indexOf('%%') >= 0 ? src.indexOf('%%') : undefined),
        tokenizer: (src) => {
            const match = src.match(/^%%[\s\S]*?%%/);
            return match ? { type: 'inlineComment', raw: match[0] } : undefined;
        },
        renderer: () => '',
    },
    {
        name: 'wikilink',
        level: 'inline',
        start: (src) => {
            const index = src.search(/!?\[\[/);
            return index >= 0 ? index : undefined;
        },
        tokenizer: (src) => {
            const match = src.match(/^(!?)\[\[([^\[\]\n]+?)\]\]/);
            return match ? { type: 'wikilink', raw: match[0], embed: Boolean(match[1]), target: match[2] } : undefined;
        },
        renderer: (token) => wikilinkHTML({ embed: token.embed, raw: token.target }),
    },
    {
        name: 'highlight',
        level: 'inline',
        start: (src) => (src.indexOf('==') >= 0 ? src.indexOf('==') : undefined),
        tokenizer(src) {
            const match = src.match(/^==(?=\S)([\s\S]*?\S)==/);
            if (!match) return undefined;
            return { type: 'highlight', raw: match[0], tokens: this.lexer.inlineTokens(match[1]) };
        },
        renderer(token) {
            return `<mark>${this.parser.parseInline(token.tokens)}</mark>`;
        },
    },
    {
        name: 'mathInline',
        level: 'inline',
        start: (src) => (src.indexOf('$') >= 0 ? src.indexOf('$') : undefined),
        tokenizer: (src) => {
            const match = src.match(/^\$(?=[^\s$])([^$\n]*?[^\s$\\])\$(?!\d)/) || src.match(/^\$([^\s$])\$(?!\d)/);
            return match ? { type: 'mathInline', raw: match[0], tex: match[1] } : undefined;
        },
        renderer: (token) => `<span class="math-inline" data-tex="${escapeHTML(token.tex)}"></span>`,
    },
    {
        name: 'tag',
        level: 'inline',
        start: (src) => {
            const match = src.match(/(?:^|[\s(])#[\p{L}\p{N}_\-/]/u);
            if (!match) return undefined;
            return match.index + (match[0].length - 2);
        },
        tokenizer: (src) => {
            const match = src.match(/^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u);
            return match ? { type: 'tag', raw: match[0], tag: match[1] } : undefined;
        },
        renderer: (token) =>
            `<a class="tag" href="#/tag/${encodeURIComponent(token.tag)}">#${escapeHTML(token.tag)}</a>`,
    },
    {
        name: 'blockId',
        level: 'inline',
        start: (src) => {
            const index = src.search(/ \^[A-Za-z0-9-]+(?=\n|$)/);
            return index >= 0 ? index : undefined;
        },
        tokenizer: (src) => {
            const match = src.match(/^ \^([A-Za-z0-9-]+)(?=\n|$)/);
            return match ? { type: 'blockId', raw: match[0], id: match[1] } : undefined;
        },
        renderer: (token) => `<span class="block-id" data-block-id="${escapeHTML(token.id)}"></span>`,
    },
];

// marked 12 renderers take positional arguments.
const renderer = {
    link(href, title, text) {
        const titleAttr = title ? ` title="${escapeHTML(title)}"` : '';
        const resolved = isExternal(href) ? null : context.links?.resolveHref(href, context.path);
        if (resolved) {
            const fragment = href.includes('#') ? safeDecode(href.split('#').slice(1).join('#')) : null;
            return `<a class="wikilink" href="${escapeHTML(noteHref(resolved, fragment))}"${titleAttr}>${text}</a>`;
        }
        if (href && !isExternal(href) && !href.startsWith('#')) {
            return `<a class="wikilink is-unresolved" title="Not in this vault">${text}</a>`;
        }
        return false;
    },
    image(href, title, text) {
        if (isExternal(href) || !href) return false;
        const resolved = context.links?.resolveHref(href, context.path);
        if (!resolved) return `<span class="wikilink is-unresolved">⧉ ${escapeHTML(text || href)}</span>`;
        if (isExcalidrawPath(resolved)) return excalidrawEmbedHTML(resolved, text);
        const { alt, width, height } = parseImageAlias(text);
        return `<img class="vault-img" data-vault-src="${escapeHTML(resolved)}" alt="${escapeHTML(alt)}"${title ? ` title="${escapeHTML(title)}"` : ''}${sizeAttrs(width, height)}>`;
    },
};

let instance = null;

function markedInstance() {
    const lib = globalThis.window?.marked;
    if (!lib) return null;
    if (!instance) {
        instance = new lib.Marked({ gfm: true, breaks: true });
        instance.use({ extensions, renderer });
    }
    return instance;
}

function sanitize(html) {
    const purify = globalThis.window?.DOMPurify;
    if (!purify) return null;
    const fragment = purify.sanitize(html, {
        FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'dialog'],
        ADD_ATTR: ['target'],
        RETURN_DOM_FRAGMENT: true,
    });
    fragment.querySelectorAll('a[href]').forEach((link) => {
        if (/^https?:/i.test(link.getAttribute('href'))) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
        }
    });
    // Rewrite raw HTML <img src="relative/path.png"> into vault-src placeholders so the browser
    // doesn't fire a 404 against the app origin before hydrate() resolves the vault blob.
    fragment.querySelectorAll('img[src]:not([data-vault-src])').forEach((img) => {
        const src = img.getAttribute('src');
        if (!src || isExternal(src) || src.startsWith('//')) return;
        const resolved = context.links?.resolveHref(src, context.path);
        img.removeAttribute('src');
        if (resolved) {
            img.classList.add('vault-img');
            img.dataset.vaultSrc = resolved;
        } else {
            img.classList.add('vault-img', 'is-missing');
            img.alt = `${img.alt || src} (not in this vault)`;
        }
    });
    const container = document.createElement('div');
    container.append(fragment);
    return container.innerHTML;
}

/** Render a note's markdown. Returns { html, data, body }; html is safe to assign to innerHTML. */
export function renderNote(text, { path = '', links = null } = {}) {
    const { data, body } = splitFrontmatter(text);
    const marked = markedInstance();
    let html;
    context = { path, links };
    try {
        html = marked ? sanitize(marked.parse(body)) : null;
    } finally {
        context = { path: '', links: null };
    }
    return { html: html ?? `<pre>${escapeHTML(body)}</pre>`, data, body };
}

/** The part of a note under one heading (for ![[Note#Heading]]), or the whole body. */
export function sectionOf(body, fragment) {
    if (!fragment || fragment.startsWith('^')) return body;
    const lines = body.split('\n');
    const want = fragment.trim().toLowerCase();
    const start = lines.findIndex((line) => {
        const match = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
        return match && match[2].trim().toLowerCase() === want;
    });
    if (start < 0) return body;
    const level = lines[start].match(/^#+/)[0].length;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i += 1) {
        const match = lines[i].match(/^(#{1,6})\s/);
        if (match && match[1].length <= level) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join('\n');
}

// ---------------------------------------------------------------- hydrate

const CALLOUT_COLORS = {
    note: 'blue',
    info: 'blue',
    todo: 'blue',
    abstract: 'cyan',
    summary: 'cyan',
    tldr: 'cyan',
    tip: 'cyan',
    hint: 'cyan',
    important: 'cyan',
    success: 'green',
    check: 'green',
    done: 'green',
    question: 'amber',
    help: 'amber',
    faq: 'amber',
    warning: 'amber',
    caution: 'amber',
    attention: 'amber',
    failure: 'rose',
    fail: 'rose',
    missing: 'rose',
    danger: 'rose',
    error: 'rose',
    bug: 'rose',
    example: 'violet',
    quote: 'muted',
    cite: 'muted',
};

/** > [!type]± Title  →  a styled (optionally foldable) callout box. */
function upgradeCallouts(root) {
    for (const quote of [...root.querySelectorAll('blockquote')]) {
        const first = quote.firstElementChild;
        const lead = first?.tagName === 'P' ? first.firstChild : null;
        const match = lead?.nodeType === Node.TEXT_NODE ? lead.textContent.match(/^\[!([\w-]+)\]([+-]?)[ \t]*/) : null;
        if (!match) continue;
        const type = match[1].toLowerCase();
        const fold = match[2];
        lead.textContent = lead.textContent.slice(match[0].length);
        const title = document.createElement(fold ? 'summary' : 'div');
        title.className = 'callout__title';
        // The title is everything on the first line, up to the first line break.
        while (first.firstChild && first.firstChild.nodeName !== 'BR') title.append(first.firstChild);
        if (first.firstChild?.nodeName === 'BR') first.firstChild.remove();
        if (first.firstChild?.nodeType === Node.TEXT_NODE)
            first.firstChild.textContent = first.firstChild.textContent.replace(/^\n/, '');
        if (!title.textContent.trim()) title.textContent = type[0].toUpperCase() + type.slice(1);
        if (!first.childNodes.length || !first.textContent.trim()) first.remove();
        const box = document.createElement(fold ? 'details' : 'div');
        box.className = 'callout';
        box.dataset.callout = type;
        box.dataset.color = CALLOUT_COLORS[type] || 'blue';
        if (fold === '+') box.open = true;
        const content = document.createElement('div');
        content.className = 'callout__content';
        content.append(...quote.childNodes);
        box.append(title, content);
        quote.replaceWith(box);
    }
}

/** GFM tasks get a class; Obsidian's extra states ([/], [-], [>] ...) are shown as markers. */
function upgradeTasks(root) {
    root.querySelectorAll('li').forEach((item) => {
        const box = item.querySelector(':scope > input[type="checkbox"], :scope > p > input[type="checkbox"]');
        if (box) {
            item.classList.add('task');
            if (box.checked) item.classList.add('is-done');
            item.closest('ul, ol')?.classList.add('task-list');
            return;
        }
        const lead =
            item.firstChild?.nodeType === Node.TEXT_NODE
                ? item.firstChild
                : item.querySelector(':scope > p')?.firstChild;
        const match = lead?.nodeType === Node.TEXT_NODE && lead.textContent.match(/^\[([^\]\s])\]\s/);
        if (!match) return;
        lead.textContent = lead.textContent.slice(match[0].length);
        item.classList.add(
            'task',
            `task--${{ '/': 'doing', '-': 'cancelled', '>': 'deferred', '!': 'important', '?': 'question' }[match[1]] || 'other'}`,
        );
        item.prepend(
            Object.assign(document.createElement('span'), { className: 'task__marker', textContent: `[${match[1]}]` }),
        );
        item.closest('ul, ol')?.classList.add('task-list');
    });
}

function decorateCode(root) {
    root.querySelectorAll('pre > code').forEach((code) => {
        const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9) || '';
        const pre = code.parentElement;
        if (lang) pre.dataset.lang = lang;
        if (lang === 'dataview' || lang === 'dataviewjs' || lang === 'tasks' || lang === 'query') {
            pre.classList.add('is-query');
            pre.dataset.lang = `${lang} · runs in Obsidian`;
            return;
        }
        if (lang === 'mermaid') return;
        highlightCode(code, lang);
    });
}

/** Fill in images, embeds, Excalidraw drawings, math and code highlighting for rendered note HTML inside `root`. */
export async function hydrate(root, { path, links, sync, depth = 0, excalidrawRuntime = null } = {}) {
    upgradeCallouts(root);
    upgradeTasks(root);
    decorateCode(root);
    root.querySelectorAll('.math-inline, .math-block').forEach((node) => {
        renderMath(node, node.dataset.tex, node.classList.contains('math-block'));
    });
    root.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((heading) => {
        heading.dataset.heading = heading.textContent.trim().toLowerCase();
    });
    const jobs = [];

    const hydrateExcalidrawBox = (box, target) => {
        const label = displayName(target).replace(/\.excalidraw$/i, '');
        const header = Object.assign(document.createElement('a'), {
            className: 'excalidraw-embed__title',
            href: noteHref(target),
            textContent: `✎ ${label}`,
        });
        const stage = Object.assign(document.createElement('div'), {
            className: 'excalidraw-embed__stage',
            textContent: 'rendering diagram…',
        });
        if (box.dataset.width) stage.style.maxWidth = `${box.dataset.width}px`;
        if (box.dataset.height) stage.style.maxHeight = `${box.dataset.height}px`;
        box.replaceChildren(header, stage);
        if (depth >= 2 || target === path) {
            stage.textContent = '';
            return;
        }
        jobs.push(
            (async () => {
                const text = await sync?.text(target);
                if (text == null) {
                    stage.classList.add('is-missing');
                    stage.textContent = "Drawing hasn't been downloaded yet. It will load when you're online.";
                    return;
                }
                const { svg } = await renderExcalidrawSvg(text, {
                    path: target,
                    links,
                    sync,
                    runtime: excalidrawRuntime,
                });
                stage.replaceChildren(svg);
            })().catch((error) => {
                stage.classList.add('is-missing');
                stage.textContent = `Couldn't render Excalidraw drawing (${error?.message || 'error'}).`;
            }),
        );
    };

    root.querySelectorAll('img[data-vault-src]').forEach((img) => {
        jobs.push(
            (sync ? sync.blobUrl(img.dataset.vaultSrc) : Promise.resolve(null))
                .then((url) => {
                    if (url) img.src = url;
                    else throw new Error('missing');
                })
                .catch(() => {
                    img.classList.add('is-missing');
                    img.alt = `${img.alt || 'image'} (not downloaded yet; it loads when you're online)`;
                }),
        );
    });

    root.querySelectorAll('.excalidraw-embed[data-excalidraw]').forEach((box) => {
        hydrateExcalidrawBox(box, box.dataset.excalidraw);
    });

    root.querySelectorAll('.note-embed[data-embed]').forEach((box) => {
        const target = box.dataset.embed;
        const header = Object.assign(document.createElement('a'), {
            className: 'note-embed__title',
            href: noteHref(target, box.dataset.fragment || null),
            textContent: `⧉ ${displayName(target)}${box.dataset.fragment ? ` › ${box.dataset.fragment}` : ''}`,
        });
        box.append(header);
        if (depth >= 2 || target === path) return;
        jobs.push(
            (async () => {
                const text = await sync?.text(target);
                if (text == null) return;
                // Notes with `excalidraw-plugin: parsed` frontmatter (even without `.excalidraw.md` suffix)
                // render as diagrams instead of dumping raw compressed JSON.
                if (isExcalidrawFile(target, text)) {
                    box.className = 'excalidraw-embed';
                    box.dataset.excalidraw = target;
                    hydrateExcalidrawBox(box, target);
                    return;
                }
                const { body } = splitFrontmatter(text);
                const section = sectionOf(body, box.dataset.fragment);
                const content = document.createElement('div');
                content.className = 'note-embed__body rendered';
                content.innerHTML = renderNote(section, { path: target, links }).html;
                box.append(content);
                await hydrate(content, { path: target, links, sync, depth: depth + 1, excalidrawRuntime });
            })().catch(() => {}),
        );
    });
    await Promise.all(jobs);
}
