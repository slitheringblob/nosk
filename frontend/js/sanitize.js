// Client-side sanitizing (defense in depth: the server sanitizes stored rich text too).
// Uses DOMPurify when loaded, with the same inline allowlist as backend/app/utils/sanitize.py.

const INLINE_TAGS = ['strong', 'em', 'del', 'code', 'a', 'mark', 'br', 'u', 'b', 'i', 's'];
const RICH_TAGS = [
    ...INLINE_TAGS,
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'img',
    'span',
    'div',
    'input',
    'sup',
    'sub',
];
const SAFE_URL = /^(https?:|mailto:|\/|#)/i;

function purifier() {
    return typeof window !== 'undefined' ? window.DOMPurify : undefined;
}

function hardenLinks(root) {
    root.querySelectorAll('a').forEach((link) => {
        const href = link.getAttribute('href') || '';
        if (!SAFE_URL.test(href.replace(/[\x00-\x20]/g, ''))) link.removeAttribute('href');
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
    });
}

// Without DOMPurify, fall back to a conservative tag/attribute allowlist walk.
function fallbackSanitize(html, allowedTags, allowedAttrs) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const walk = (node) => {
        for (const child of [...node.childNodes]) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                const tag = child.tagName.toLowerCase();
                if (['script', 'style', 'iframe', 'object', 'template'].includes(tag)) {
                    child.remove();
                    continue;
                }
                walk(child);
                if (!allowedTags.includes(tag)) {
                    child.replaceWith(...child.childNodes);
                    continue;
                }
                for (const attr of [...child.attributes]) {
                    if (!allowedAttrs.includes(attr.name)) child.removeAttribute(attr.name);
                }
            } else if (child.nodeType !== Node.TEXT_NODE) {
                child.remove();
            }
        }
    };
    walk(template.content);
    hardenLinks(template.content);
    return template.innerHTML;
}

function purify(html, tags, attrs) {
    const dompurify = purifier();
    if (!dompurify) return fallbackSanitize(String(html ?? ''), tags, attrs);
    const fragment = dompurify.sanitize(String(html ?? ''), {
        ALLOWED_TAGS: tags,
        ALLOWED_ATTR: attrs,
        RETURN_DOM_FRAGMENT: true,
    });
    hardenLinks(fragment);
    const container = document.createElement('div');
    container.append(fragment);
    return container.innerHTML;
}

/** Inline rich text (text blocks, list items, callouts). */
export function sanitizeInline(html) {
    // Zero-width spaces are caret helpers inserted by the editor; never persist them.
    return purify(String(html ?? '').replace(/\u200b/g, ''), INLINE_TAGS, ['href']);
}

/** Rendered Markdown output. */
export function sanitizeRich(html) {
    return purify(html, RICH_TAGS, ['href', 'src', 'alt', 'title', 'class', 'type', 'checked', 'disabled', 'align']);
}
