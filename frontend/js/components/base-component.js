import { sanitizeInline } from '../sanitize.js';
import { caretAtStart, el, escapeHTML, generateUUID, modKey, now, placeCaretAtEnd, stripHTML } from '../utils.js';

// Closing an inline Markdown span while typing formats it, e.g. "**bold**" -> <strong>bold</strong>.
const INLINE_MARKDOWN = [
    { pattern: /\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, tag: 'strong', marker: 2 },
    { pattern: /~~([^~\s](?:[^~]*[^~\s])?)~~$/, tag: 'del', marker: 2 },
    { pattern: /==([^=\s](?:[^=]*[^=\s])?)==$/, tag: 'mark', marker: 2 },
    { pattern: /`([^`]+)`$/, tag: 'code', marker: 1 },
    { pattern: /(?:^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, tag: 'em', marker: 1 },
];

export function applyInlineMarkdown(root) {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const { startContainer: textNode, startOffset } = selection.getRangeAt(0);
    if (textNode.nodeType !== Node.TEXT_NODE || !root.contains(textNode)) return false;
    if (textNode.parentElement?.closest('code')) return false;
    const before = textNode.data.slice(0, startOffset);
    for (const { pattern, tag, marker } of INLINE_MARKDOWN) {
        const match = before.match(pattern);
        if (!match) continue;
        const inner = match[1];
        const start = startOffset - inner.length - marker * 2;
        const range = document.createRange();
        range.setStart(textNode, start);
        range.setEnd(textNode, startOffset);
        range.deleteContents();
        const element = document.createElement(tag);
        element.textContent = inner;
        range.insertNode(element);
        // Continue typing outside the new element.
        const after = document.createTextNode('\u200b');
        element.after(after);
        const caret = document.createRange();
        caret.setStart(after, 1);
        caret.collapse(true);
        selection.removeAllRanges();
        selection.addRange(caret);
        return true;
    }
    return false;
}

/**
 * Base class for all blocks.
 *
 * Subclasses set static metadata (type, label, icon, category, keywords) and implement
 * getDefaultContent() and renderBody(). The page manager owns persistence: components call
 * this.update(partial) and the manager is notified through options.onChange.
 *
 * Options (all optional):
 *   onChange(component)                 content changed locally
 *   readOnly                            render without editing affordances
 *   hooks.onEnter(component, afterHTML) Enter pressed at the end/middle of a text block
 *   hooks.onBackspaceEmpty(component)   Backspace in an empty block
 *   hooks.onMergeUp(component, html)    Backspace at the start of a non-empty block
 *   hooks.onSlash(component, query, anchor)  "/" typed in an empty text block
 *   hooks.onReplace(component, type, content) convert via Markdown shortcut
 *   hooks.onNavigate(component, direction)    arrow past the first/last line
 *   services.{api, media, pages, user, navigate, insertBlocksAfter, captureBlocksAfter}
 */
export default class BaseComponent {
    static type = '';
    static label = '';
    static icon = '';
    static category = 'basic';
    static description = '';
    static keywords = [];
    static isContainer = false;

    constructor(data = {}, options = {}) {
        this.id = data.id || generateUUID();
        this.type = this.constructor.type;
        this.content = { ...this.getDefaultContent(), ...(data.content || {}) };
        this.metadata = {
            created_at: data.created_at || data.metadata?.created_at || now(),
            updated_at: data.updated_at || now(),
            order: data.order ?? data.metadata?.order ?? 0,
            schema_version: 1,
        };
        this.parentId = data.parent_id ?? null;
        this.slot = data.slot ?? 0;
        this.options = options;
        this.hooks = options.hooks || {};
        this.services = options.services || {};
        this.readOnly = Boolean(options.readOnly);
        this.element = null;
        this.body = null;
        this.listeners = [];
    }

    getDefaultContent() {
        return {};
    }

    renderBody() {
        throw new Error('renderBody() must be implemented by subclass');
    }

    render() {
        const wrapper = this.createWrapper();
        this.body = this.renderBody();
        this.body.classList.add('block__body');
        wrapper.append(this.body);
        this.element = wrapper;
        return wrapper;
    }

    /** Re-render the body after content changed elsewhere, keeping nested children in place. */
    refresh() {
        if (!this.element) return;
        const slotChildren = this.constructor.isContainer
            ? Array.from({ length: this.slotCount() }, (_, slot) => [...(this.getSlotElement(slot)?.children || [])])
            : [];
        const hadFocus = this.body?.contains(document.activeElement);
        this.removeListeners();
        const body = this.renderBody();
        body.classList.add('block__body');
        this.body.replaceWith(body);
        this.body = body;
        slotChildren.forEach((children, slot) => {
            const target = this.getSlotElement(Math.min(slot, this.slotCount() - 1));
            children.forEach((child) => target?.append(child));
        });
        if (hadFocus) this.focus();
    }

    serialize() {
        return {
            id: this.id,
            type: this.type,
            content: this.content,
            parent_id: this.parentId,
            slot: this.slot,
            metadata: this.metadata,
        };
    }

    update(partial) {
        this.content = { ...this.content, ...partial };
        this.metadata.updated_at = now();
        this.options.onChange?.(this);
    }

    /** Apply content from storage/sync without notifying the change handler. */
    setContent(content) {
        this.content = { ...this.getDefaultContent(), ...content };
        this.refresh();
    }

    isEmpty() {
        return false;
    }

    /** Plain text used for conversions and search previews. */
    getText() {
        return '';
    }

    slotCount() {
        return 0;
    }

    getSlotElement() {
        return null;
    }

    removeListeners() {
        this.listeners.forEach(({ element, event, handler, options }) => {
            element.removeEventListener(event, handler, options);
        });
        this.listeners = [];
    }

    destroy() {
        this.removeListeners();
        this.element?.remove();
        this.element = null;
    }

    addEventListener(element, event, handler, options) {
        element.addEventListener(event, handler, options);
        this.listeners.push({ element, event, handler, options });
    }

    createWrapper() {
        const wrapper = el('div', {
            className: `block block--${this.type}`,
            dataset: { componentId: this.id, componentType: this.type },
        });
        if (!this.readOnly) {
            const gutter = el(
                'div',
                { className: 'block__gutter', contentEditable: 'false' },
                el(
                    'button',
                    {
                        className: 'block__plus',
                        type: 'button',
                        title: 'Add block below',
                        ariaLabel: 'Add block below',
                    },
                    '+',
                ),
                el(
                    'button',
                    {
                        className: 'block__handle drag-handle',
                        type: 'button',
                        title: 'Drag to move · click for options',
                        ariaLabel: 'Block options',
                        draggable: true,
                    },
                    '⋮⋮',
                ),
            );
            wrapper.append(gutter);
        }
        wrapper.append(el('span', { className: 'block__comment-badge', hidden: true }));
        return wrapper;
    }

    focus(position = 'end') {
        const selector =
            '[contenteditable="true"], textarea, input:not([type="checkbox"]):not([type="range"]):not([type="file"]):not([type="date"]):not([type="datetime-local"])';
        // For simple text blocks the body itself is the editable element.
        const target = this.body?.matches(selector) ? this.body : this.body?.querySelector(selector);
        if (!target) return false;
        if (position === 'start') {
            target.focus();
            if (target.isContentEditable) {
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
            } else {
                if (typeof target.selectionStart === 'number') target.setSelectionRange(0, 0);
            }
        } else {
            placeCaretAtEnd(target);
        }
        return true;
    }

    // --- Editable helper ----------------------------------------------------------------

    /**
     * Create a contentEditable element.
     *   rich: allow inline formatting (stored as sanitized HTML) vs plain text
     *   value: initial HTML (rich) or text (plain)
     *   onInput(value): called with sanitized HTML / plain text on every edit
     *   onKeyDown(event, element): return true if handled
     *   blockNavigation: wire Enter/Backspace/arrows/slash to block-level hooks
     */
    editable({
        tag = 'div',
        className = '',
        rich = true,
        value = '',
        placeholder = '',
        onInput,
        onKeyDown,
        blockNavigation = false,
        singleLine = false,
    }) {
        const node = el(tag, { className: `editable ${className}`.trim() });
        node.dataset.placeholder = placeholder;
        if (rich) node.innerHTML = sanitizeInline(value);
        else node.textContent = value;
        if (this.readOnly) return node;

        node.contentEditable = 'true';
        node.spellcheck = true;
        const read = () => (rich ? sanitizeInline(node.innerHTML) : node.innerText.replace(/\n$/, ''));
        const syncEmpty = () => node.classList.toggle('is-empty', !node.textContent.length);
        syncEmpty();

        this.addEventListener(node, 'input', (event) => {
            if (rich && event.inputType === 'insertText') applyInlineMarkdown(node);
            syncEmpty();
            onInput?.(read(), node);
        });
        this.addEventListener(node, 'paste', (event) => {
            event.preventDefault();
            const data = event.clipboardData;
            const html = rich ? data.getData('text/html') : '';
            const text = data.getData('text/plain');
            if (html) {
                document.execCommand('insertHTML', false, sanitizeInline(html));
            } else if (singleLine || !rich) {
                document.execCommand('insertText', false, singleLine ? text.replace(/\s*\n\s*/g, ' ') : text);
            } else {
                document.execCommand('insertHTML', false, escapeHTML(text).replace(/\n/g, '<br>'));
            }
        });
        this.addEventListener(node, 'keydown', (event) => {
            if (onKeyDown?.(event, node)) return;
            if (rich && this.handleFormatting(event, node)) return;
            if (blockNavigation) this.handleBlockKeys(event, node, read);
            else if (singleLine && event.key === 'Enter') event.preventDefault();
        });
        return node;
    }

    handleFormatting(event, node) {
        if (!modKey(event)) return false;
        const key = event.key.toLowerCase();
        const commands = { b: 'bold', i: 'italic', u: 'underline' };
        if (commands[key] && !event.shiftKey) {
            event.preventDefault();
            document.execCommand(commands[key]);
        } else if (key === 's' && event.shiftKey) {
            event.preventDefault();
            document.execCommand('strikeThrough');
        } else if (key === 'e') {
            event.preventDefault();
            this.wrapSelection('code');
        } else if (key === 'h' && event.shiftKey) {
            event.preventDefault();
            this.wrapSelection('mark');
        } else if (key === 'k') {
            event.preventDefault();
            event.stopPropagation();
            this.insertLink();
        } else {
            return false;
        }
        node.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
    }

    wrapSelection(tag) {
        const selection = window.getSelection();
        if (!selection.rangeCount || selection.isCollapsed) return;
        const range = selection.getRangeAt(0);
        const existing = range.commonAncestorContainer.parentElement?.closest(tag);
        if (existing) {
            existing.replaceWith(...existing.childNodes);
            return;
        }
        const wrapper = document.createElement(tag);
        wrapper.textContent = range.toString();
        range.deleteContents();
        range.insertNode(wrapper);
        selection.removeAllRanges();
    }

    insertLink() {
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const url = window.prompt('Link URL', 'https://');
        if (!url || !/^(https?:|mailto:)/i.test(url.trim())) return;
        const link = el('a', { href: url.trim(), target: '_blank', rel: 'noopener noreferrer' });
        link.textContent = range.toString() || url.trim();
        range.deleteContents();
        range.insertNode(link);
        selection.removeAllRanges();
    }

    handleBlockKeys(event, node, read) {
        const { hooks } = this;
        if (event.key === 'Enter' && !event.shiftKey && !modKey(event)) {
            event.preventDefault();
            const after = this.extractAfterCaret(node);
            node.dispatchEvent(new Event('input', { bubbles: true }));
            hooks.onEnter?.(this, after);
        } else if (event.key === 'Backspace' && caretAtStart(node)) {
            if (!node.textContent.length) {
                event.preventDefault();
                hooks.onBackspaceEmpty?.(this);
            } else if (window.getSelection().isCollapsed && hooks.onMergeUp) {
                event.preventDefault();
                hooks.onMergeUp(this, read());
            }
        } else if (event.key === '/' && !node.textContent.length) {
            // Let the slash be typed; the picker filters on what follows it.
            setTimeout(() => hooks.onSlash?.(this, node), 0);
        } else if (event.key === 'ArrowUp' && caretAtStart(node)) {
            event.preventDefault();
            hooks.onNavigate?.(this, -1);
        } else if (event.key === 'ArrowDown' && this.caretAtEnd(node)) {
            event.preventDefault();
            hooks.onNavigate?.(this, 1);
        }
    }

    caretAtEnd(node) {
        const selection = window.getSelection();
        if (!selection.rangeCount || !selection.isCollapsed) return false;
        const range = selection.getRangeAt(0).cloneRange();
        range.selectNodeContents(node);
        range.setStart(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
        return range.toString().length === 0;
    }

    /** Remove and return (as HTML) everything after the caret inside `node`. */
    extractAfterCaret(node) {
        const selection = window.getSelection();
        if (!selection.rangeCount) return '';
        const range = selection.getRangeAt(0);
        if (!node.contains(range.startContainer)) return '';
        range.deleteContents();
        const tail = document.createRange();
        tail.selectNodeContents(node);
        tail.setStart(range.startContainer, range.startOffset);
        const fragment = tail.extractContents();
        const holder = document.createElement('div');
        holder.append(fragment);
        return stripHTML(holder.innerHTML).length ? sanitizeInline(holder.innerHTML) : '';
    }

    /** A small labelled toolbar of option buttons shown when hovering the block. */
    optionBar(className, choices, active, onPick, labelFor = (value) => value) {
        const bar = el('div', { className: `block-options ${className}`, contentEditable: 'false' });
        if (this.readOnly) return bar;
        for (const value of choices) {
            const button = el(
                'button',
                {
                    type: 'button',
                    className: value === active ? 'is-active' : '',
                    title: String(labelFor(value)),
                },
                labelFor(value),
            );
            this.addEventListener(button, 'mousedown', (event) => event.preventDefault());
            this.addEventListener(button, 'click', () => onPick(value));
            bar.append(button);
        }
        return bar;
    }
}
