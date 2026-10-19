import BaseComponent from './base-component.js';
import { caretAtStart, el, generateUUID, modKey, stripHTML } from '../utils.js';

const MAX_INDENT = 3;

/**
 * Shared behaviour for checklist, bulleted and numbered lists: one editable per item, Enter for
 * a new item, Tab/Shift+Tab to indent, Backspace on an empty item to remove it, and Enter on an
 * empty top-level item (or Cmd/Ctrl+Enter) to leave the list.
 */
export default class ListComponent extends BaseComponent {
    static richItems = true;

    getDefaultContent() {
        return { items: [this.newItem(0)] };
    }

    newItem(indentLevel) {
        return { id: generateUUID(), text: '', indent_level: indentLevel };
    }

    containerClass() {
        return 'list-container';
    }

    renderMarker() {
        return el('span');
    }

    renderBody() {
        const container = el('div', { className: this.containerClass(), role: 'list' });
        if (!this.content.items.length) this.content.items = [this.newItem(0)];
        this.content.items.forEach((item, index) => container.append(this.renderItem(item, index)));
        return container;
    }

    renderItem(item, index) {
        const row = el('div', {
            className: `list-item list-item--level-${item.indent_level}`,
            role: 'listitem',
            dataset: { itemId: item.id },
            style: { paddingLeft: `${item.indent_level * 24}px` },
        });
        const rich = this.constructor.richItems;
        const text = this.editable({
            className: 'list-item__text',
            rich,
            value: item.text,
            placeholder: index === 0 ? 'List item' : '',
            onInput: (value) => {
                item.text = rich ? value : value.slice(0, 1000);
                this.commit();
            },
            onKeyDown: (event, node) => this.handleItemKey(event, node, item),
        });
        row.append(this.renderMarker(item, index), text);
        return row;
    }

    itemIndex(item) {
        return this.content.items.findIndex((candidate) => candidate.id === item.id);
    }

    handleItemKey(event, node, item) {
        const index = this.itemIndex(item);
        const empty = !node.textContent.length;
        if (event.key === 'Enter' && modKey(event)) {
            event.preventDefault();
            this.hooks.onEnter?.(this, '');
            return true;
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (empty && item.indent_level === 0) {
                this.exitList(index);
            } else if (empty) {
                this.setIndent(item, item.indent_level - 1);
            } else {
                const after = this.extractAfterCaret(node);
                node.dispatchEvent(new Event('input'));
                const next = {
                    ...this.newItem(item.indent_level),
                    text: this.constructor.richItems ? after : stripHTML(after),
                };
                this.content.items.splice(index + 1, 0, next);
                this.commit(true);
                this.focusItem(index + 1, 'start');
            }
            return true;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            this.setIndent(item, item.indent_level + (event.shiftKey ? -1 : 1));
            return true;
        }
        if (event.key === 'Backspace' && caretAtStart(node)) {
            if (item.indent_level > 0) {
                event.preventDefault();
                this.setIndent(item, item.indent_level - 1);
                return true;
            }
            if (this.content.items.length === 1 && empty) {
                event.preventDefault();
                this.hooks.onBackspaceEmpty?.(this);
                return true;
            }
            if (index > 0) {
                event.preventDefault();
                const previous = this.content.items[index - 1];
                const joinAt = stripHTML(previous.text).length;
                previous.text += item.text;
                this.content.items.splice(index, 1);
                this.commit(true);
                this.focusItem(index - 1, joinAt);
                return true;
            }
            if (empty) {
                event.preventDefault();
                this.hooks.onBackspaceEmpty?.(this);
                return true;
            }
        }
        if (event.key === 'ArrowUp' && caretAtStart(node)) {
            event.preventDefault();
            if (index > 0) this.focusItem(index - 1);
            else this.hooks.onNavigate?.(this, -1);
            return true;
        }
        if (event.key === 'ArrowDown' && this.caretAtEnd(node)) {
            event.preventDefault();
            if (index < this.content.items.length - 1) this.focusItem(index + 1, 'start');
            else this.hooks.onNavigate?.(this, 1);
            return true;
        }
        return false;
    }

    exitList(index) {
        this.content.items.splice(index, 1);
        const trailing = this.content.items.splice(index);
        if (!this.content.items.length && !trailing.length) {
            this.hooks.onReplace?.(this, 'text-block', { text: '', format: 'html' });
            return;
        }
        this.commit(true);
        this.hooks.onExitList?.(this, trailing);
    }

    setIndent(item, level) {
        const clamped = Math.max(0, Math.min(MAX_INDENT, level));
        if (clamped === item.indent_level) return;
        item.indent_level = clamped;
        const index = this.itemIndex(item);
        this.commit(true);
        this.focusItem(index);
    }

    commit(rerender = false) {
        this.update({ items: this.content.items });
        if (rerender) this.refresh();
    }

    focusItem(index, position = 'end') {
        const nodes = this.body?.querySelectorAll('.list-item__text');
        const node = nodes?.[index];
        if (!node) return;
        node.focus();
        const selection = window.getSelection();
        const range = document.createRange();
        if (typeof position === 'number') {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
            let remaining = position;
            let current;
            while ((current = walker.nextNode())) {
                if (current.length >= remaining) {
                    range.setStart(current, remaining);
                    range.collapse(true);
                    selection.removeAllRanges();
                    selection.addRange(range);
                    return;
                }
                remaining -= current.length;
            }
        }
        range.selectNodeContents(node);
        range.collapse(position === 'start');
        selection.removeAllRanges();
        selection.addRange(range);
    }

    focus(position = 'end') {
        const count = this.content.items.length;
        this.focusItem(position === 'start' ? 0 : count - 1, position);
        return true;
    }

    isEmpty() {
        return this.content.items.every((item) => !stripHTML(item.text).trim());
    }

    getText() {
        return this.content.items.map((item) => stripHTML(item.text)).join('\n');
    }
}
