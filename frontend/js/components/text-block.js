import BaseComponent from './base-component.js';
import { generateUUID, stripHTML, textToHTML } from '../utils.js';

// Typing one of these at the start of a text block turns it into another block type.
const SHORTCUTS = [
    { pattern: /^(#{1,3})\s$/, build: (m) => ['heading', { text: '', level: m[1].length }] },
    {
        pattern: /^[-*+]\s$/,
        build: () => ['bullet-list', { items: [{ id: generateUUID(), text: '', indent_level: 0 }] }],
    },
    {
        pattern: /^1[.)]\s$/,
        build: () => ['numbered-list', { items: [{ id: generateUUID(), text: '', indent_level: 0 }], start_number: 1 }],
    },
    {
        pattern: /^\[\s?\]\s$/,
        build: () => ['checklist', { items: [{ id: generateUUID(), text: '', checked: false, indent_level: 0 }] }],
    },
    { pattern: /^>\s$/, build: () => ['quote', { text: '', citation: null }] },
    { pattern: /^```$/, build: () => ['code', { code: '', language: 'plaintext', wrap: false }] },
    { pattern: /^(---|\*\*\*)$/, build: () => ['divider', { style: 'solid' }] },
    { pattern: /^\$\$$/, build: () => ['math', { latex: '', display: true }] },
];

export default class TextBlockComponent extends BaseComponent {
    static type = 'text-block';
    static label = 'Text';
    static icon = '📝';
    static description = 'Plain text with inline formatting';
    static keywords = ['text', 'paragraph', 'p'];

    getDefaultContent() {
        return { text: '', format: 'html' };
    }

    renderBody() {
        return this.editable({
            className: 'text-block-content',
            value: this.content.text,
            placeholder: "Type '/' for commands",
            blockNavigation: true,
            onInput: (html, node) => {
                if (this.tryShortcut(node)) return;
                this.update({ text: html });
            },
        });
    }

    tryShortcut(node) {
        const text = node.textContent;
        if (text.length > 4) return false;
        for (const { pattern, build } of SHORTCUTS) {
            const match = text.match(pattern);
            if (match) {
                const [type, content] = build(match);
                this.hooks.onReplace?.(this, type, content);
                return true;
            }
        }
        return false;
    }

    isEmpty() {
        return !stripHTML(this.content.text).trim();
    }

    getText() {
        return stripHTML(this.content.text);
    }

    appendHTML(html) {
        const node = this.body;
        const caretMarker = node.innerHTML;
        this.update({ text: (this.content.text || '') + html });
        this.refresh();
        // Leave the caret where the two blocks joined.
        const joinOffset = stripHTML(caretMarker).length;
        this.focusAtOffset(joinOffset);
    }

    focusAtOffset(offset) {
        const node = this.body;
        node.focus();
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let remaining = offset;
        let current;
        while ((current = walker.nextNode())) {
            if (current.length >= remaining) {
                const range = document.createRange();
                range.setStart(current, remaining);
                range.collapse(true);
                const selection = window.getSelection();
                selection.removeAllRanges();
                selection.addRange(range);
                return;
            }
            remaining -= current.length;
        }
        this.focus('end');
    }

    static fromText(text) {
        return { text: textToHTML(text), format: 'html' };
    }
}
