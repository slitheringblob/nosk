export function generateUUID() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    // RFC 4122 v4 fallback for older browsers / non-secure contexts.
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export const now = () => Date.now();

export function debounce(fn, wait) {
    let timer = null;
    let lastArgs = null;
    const debounced = (...args) => {
        lastArgs = args;
        clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...lastArgs);
        }, wait);
    };
    // Runs a pending call now and returns its result (e.g. a promise to await).
    debounced.flush = () => {
        if (!timer) return undefined;
        clearTimeout(timer);
        timer = null;
        return fn(...lastArgs);
    };
    debounced.cancel = () => {
        clearTimeout(timer);
        timer = null;
    };
    return debounced;
}

export function escapeHTML(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Visible text of an HTML fragment, with <br>/<div> turned into newlines. */
export function stripHTML(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html ?? '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(div|p|li)>/gi, '\n');
    return (template.content.textContent || '').replace(/\n+$/, '');
}

export function textToHTML(text) {
    return String(text ?? '')
        .split('\n')
        .map((line) => escapeHTML(line))
        .join('<br>');
}

/**
 * Tiny DOM builder: el('button', { className: 'x', onclick }, 'Label', child).
 * Keys starting with "on" become listeners; `dataset` and `style` objects are merged.
 */
export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
        if (value === undefined || value === null || value === false) continue;
        if (key === 'dataset') Object.assign(node.dataset, value);
        else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
        else if (key in node && key !== 'list') node[key] = value;
        else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
}

export function formatRelativeTime(timestamp) {
    const seconds = Math.round((Date.now() - timestamp) / 1000);
    if (seconds < 45) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
}

export function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

export function placeCaretAtEnd(element) {
    element.focus();
    if (element.isContentEditable) {
        const range = document.createRange();
        range.selectNodeContents(element);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    } else if (typeof element.selectionStart === 'number') {
        const end = element.value.length;
        element.setSelectionRange(end, end);
    }
}

/** True when the caret sits at the very start of a contentEditable element or input. */
export function caretAtStart(element) {
    if (typeof element.selectionStart === 'number') {
        return element.selectionStart === 0 && element.selectionEnd === 0;
    }
    const selection = window.getSelection();
    if (!selection.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(element);
    range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
    return range.toString().length === 0;
}

export function isEditableTarget(target) {
    return Boolean(target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)));
}

export const isMac = () => /Mac|iPhone|iPad/.test(globalThis.navigator?.platform || '');

export function modKey(event) {
    return isMac() ? event.metaKey : event.ctrlKey;
}

export function downloadFile(filename, content, mimeType) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function sha256Hex(buffer) {
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Simple event emitter used by the stores and managers. */
export class Emitter {
    constructor() {
        this.handlers = new Map();
    }

    on(event, handler) {
        if (!this.handlers.has(event)) this.handlers.set(event, new Set());
        this.handlers.get(event).add(handler);
        return () => this.handlers.get(event)?.delete(handler);
    }

    emit(event, payload) {
        for (const handler of this.handlers.get(event) || []) {
            try {
                handler(payload);
            } catch (error) {
                console.error(`Error in "${event}" handler`, error);
            }
        }
    }
}
