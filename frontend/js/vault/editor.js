// Markdown source editor: a textarea that grows with its content, plus the small comforts of
// Obsidian's editor (list continuation, indenting, bold/italic, task toggling, [[link
// suggestions) and a toolbar for phones. Edits go through execCommand so undo keeps working.
import { debounce, el, modKey } from '../utils.js';

const LIST_ITEM = /^(\s*)((?:[-*+]|\d+[.)])\s+)(\[[^\]]\]\s+)?(.*)$/;
const QUOTE = /^(\s*(?:>\s?)+)(.*)$/;

/**
 * What Enter should do at the end of `line`: { insert } to continue a list or quote,
 * { replace } to end it (an empty item ends the list, or moves up a level if nested),
 * or null for a plain newline.
 */
export function continuation(line) {
    const item = line.match(LIST_ITEM);
    if (item) {
        const [, indent, marker, task, rest] = item;
        if (!rest.trim()) {
            if (!indent) return { replace: '' };
            return { replace: `${indent.replace(/(\t| {1,4})$/, '')}${marker}${task ? '[ ] ' : ''}` };
        }
        const number = marker.match(/^(\d+)([.)])(\s+)$/);
        const next = number ? `${Number(number[1]) + 1}${number[2]}${number[3]}` : marker;
        return { insert: `\n${indent}${next}${task ? '[ ] ' : ''}` };
    }
    const quote = line.match(QUOTE);
    if (quote) return quote[2].trim() ? { insert: `\n${quote[1]}` } : { replace: '' };
    return null;
}

/** Cycle a line through "- [ ] " → "- [x] " → "- [ ] ", turning plain lines into tasks. */
export function toggleTaskLine(line) {
    const item = line.match(LIST_ITEM);
    if (item) {
        const [, indent, marker, task, rest] = item;
        if (!task) return `${indent}${marker}[ ] ${rest}`;
        return `${indent}${marker}${/\[ \]/.test(task) ? '[x] ' : '[ ] '}${rest}`;
    }
    const indent = line.match(/^\s*/)[0];
    return `${indent}- [ ] ${line.slice(indent.length)}`;
}

/** Pixel position of the caret inside a textarea, relative to the textarea's top-left. */
function caretPosition(textarea, index) {
    const style = getComputedStyle(textarea);
    const mirror = document.createElement('div');
    for (const prop of [
        'fontFamily',
        'fontSize',
        'fontWeight',
        'lineHeight',
        'letterSpacing',
        'padding',
        'border',
        'boxSizing',
        'tabSize',
        'textIndent',
    ]) {
        mirror.style[prop] = style[prop];
    }
    Object.assign(mirror.style, {
        position: 'absolute',
        visibility: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
        width: `${textarea.clientWidth}px`,
        top: '0',
        left: '0',
    });
    mirror.textContent = textarea.value.slice(0, index);
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.append(marker);
    document.body.append(mirror);
    const position = { top: marker.offsetTop, left: marker.offsetLeft, height: marker.offsetHeight };
    mirror.remove();
    return position;
}

export class NoteEditor {
    /**
     * onChange(text): called (debounced) as the user types.
     * suggest(query): returns [{ label, detail, insert }] for [[link suggestions.
     * onSave(): Ctrl/Cmd+S.
     * onUploadImages(files): called with File[] on paste, drag-drop, or toolbar image button;
     *   returns Promise<string[]> of markdown snippets to insert at the caret.
     */
    constructor({ text, onChange, suggest, onSave, onUploadImages = null, saveDelay = 300 }) {
        this.onChange = onChange;
        this.suggest = suggest;
        this.onSave = onSave;
        this.onUploadImages = onUploadImages;
        this.textarea = el('textarea', {
            className: 'note-editor',
            spellcheck: true,
            autocapitalize: 'sentences',
            ariaLabel: 'Note text (markdown)',
            value: text,
        });
        this.menu = el('div', { className: 'link-suggest', role: 'listbox', hidden: true });
        this.toolbar = this.buildToolbar();
        this.element = el('div', { className: 'note-editor-wrap' }, this.toolbar, this.textarea, this.menu);
        this.lastSaved = text;
        this.save = debounce(() => this.emitChange(), saveDelay);
        this.suggestions = [];
        this.suggestIndex = 0;
        this.textarea.addEventListener('input', () => {
            this.autosize();
            this.save();
            this.updateSuggestions();
        });
        this.textarea.addEventListener('keydown', (event) => this.onKeydown(event));
        this.textarea.addEventListener('blur', () => {
            setTimeout(() => this.closeSuggestions(), 150);
            this.flush();
        });
        if (this.onUploadImages) this.bindImageDrops();
        requestAnimationFrame(() => this.autosize());
    }

    get value() {
        return this.textarea.value;
    }

    get dirty() {
        return this.textarea.value !== this.lastSaved;
    }

    emitChange() {
        const text = this.textarea.value;
        if (text === this.lastSaved) return undefined;
        this.lastSaved = text;
        return this.onChange(text);
    }

    /** Save now if there are unsaved keystrokes. */
    flush() {
        this.save.cancel();
        return this.emitChange();
    }

    /** Replace the text (e.g. after a merge) keeping the caret roughly where it was. */
    setValue(text) {
        if (text === this.textarea.value) return;
        const { selectionStart, selectionEnd } = this.textarea;
        const focused = document.activeElement === this.textarea;
        this.textarea.value = text;
        this.lastSaved = text;
        if (focused)
            this.textarea.setSelectionRange(Math.min(selectionStart, text.length), Math.min(selectionEnd, text.length));
        this.autosize();
    }

    focus(atEnd = false) {
        this.textarea.focus({ preventScroll: true });
        if (atEnd) this.textarea.setSelectionRange(this.textarea.value.length, this.textarea.value.length);
    }

    autosize() {
        const scroll = window.scrollY;
        this.textarea.style.height = 'auto';
        this.textarea.style.height = `${this.textarea.scrollHeight + 2}px`;
        window.scrollTo(window.scrollX, scroll);
    }

    /** Replace [start, end) with text through the browser's editing pipeline (undoable). */
    replace(start, end, text, select = null) {
        const area = this.textarea;
        area.focus({ preventScroll: true });
        const expected = area.value.slice(0, start) + text + area.value.slice(end);
        area.setSelectionRange(start, end);
        if (typeof document.execCommand === 'function') {
            // Chrome mis-places the caret after insertText(''), so deletions use "delete".
            if (text) document.execCommand('insertText', false, text);
            else if (start !== end) document.execCommand('delete');
        }
        if (area.value !== expected) area.value = expected;
        if (select) area.setSelectionRange(select[0], select[1]);
        else area.setSelectionRange(start + text.length, start + text.length);
        this.autosize();
        this.save();
    }

    lineBounds(index = this.textarea.selectionStart) {
        const value = this.textarea.value;
        const start = value.lastIndexOf('\n', index - 1) + 1;
        const newline = value.indexOf('\n', index);
        return { start, end: newline < 0 ? value.length : newline };
    }

    /** Apply `fn(line)` to every line touched by the selection. */
    mapLines(fn) {
        const area = this.textarea;
        const first = this.lineBounds(area.selectionStart).start;
        const last = this.lineBounds(Math.max(area.selectionStart, area.selectionEnd)).end;
        const lines = area.value.slice(first, last).split('\n');
        const next = lines.map(fn).join('\n');
        const caretShift = next.length - (last - first);
        const single = lines.length === 1;
        const caret = single ? Math.max(first, area.selectionStart + caretShift) : null;
        this.replace(first, last, next, single ? [caret, caret] : [first, first + next.length]);
    }

    wrap(marker) {
        const area = this.textarea;
        const { selectionStart: start, selectionEnd: end } = area;
        const selected = area.value.slice(start, end);
        if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= marker.length * 2) {
            const inner = selected.slice(marker.length, -marker.length);
            this.replace(start, end, inner, [start, start + inner.length]);
        } else {
            this.replace(start, end, `${marker}${selected}${marker}`, [start + marker.length, end + marker.length]);
        }
    }

    toggleTask() {
        this.mapLines(toggleTaskLine);
    }

    cycleHeading() {
        this.mapLines((line) => {
            const heading = line.match(/^(#{1,6})\s+(.*)$/);
            if (!heading) return `# ${line}`;
            return heading[1].length >= 3 ? heading[2] : `${heading[1]}# ${heading[2]}`;
        });
    }

    toggleList() {
        this.mapLines((line) =>
            /^\s*[-*+]\s/.test(line) ? line.replace(/^(\s*)[-*+]\s+/, '$1') : line.replace(/^(\s*)/, '$1- '),
        );
    }

    insertLink() {
        const { selectionStart: start, selectionEnd: end } = this.textarea;
        const selected = this.textarea.value.slice(start, end);
        this.replace(start, end, `[[${selected}`, null);
        this.updateSuggestions();
    }

    indent(outdent) {
        this.mapLines((line) => (outdent ? line.replace(/^(\t| {1,4})/, '') : `\t${line}`));
    }

    onKeydown(event) {
        if (this.suggestionsOpen && this.onSuggestKey(event)) return;
        if (event.isComposing) return;
        const mod = modKey(event);
        const key = event.key.toLowerCase();
        if (mod && key === 's') {
            event.preventDefault();
            this.flush();
            this.onSave?.();
        } else if (mod && key === 'b') {
            event.preventDefault();
            this.wrap('**');
        } else if (mod && key === 'i') {
            event.preventDefault();
            this.wrap('*');
        } else if (mod && key === 'enter') {
            event.preventDefault();
            this.toggleTask();
        } else if (event.key === 'Tab' && !mod && !event.altKey) {
            event.preventDefault();
            this.indent(event.shiftKey);
        } else if (event.key === 'Enter' && !event.shiftKey && !mod && !event.altKey) {
            const area = this.textarea;
            if (area.selectionStart !== area.selectionEnd) return;
            const { start } = this.lineBounds();
            const line = area.value.slice(start, area.selectionStart);
            const next = continuation(line);
            if (!next) return;
            event.preventDefault();
            if (next.replace !== undefined) this.replace(start, area.selectionStart, next.replace);
            else this.replace(area.selectionStart, area.selectionStart, next.insert);
        }
    }

    // ------------------------------------------------------------ [[link suggestions

    get suggestionsOpen() {
        return !this.menu.hidden;
    }

    async updateSuggestions() {
        const area = this.textarea;
        const before = area.value.slice(0, area.selectionStart);
        const open = before.match(/\[\[([^[\]\n|#]*)$/);
        if (!open || !this.suggest || area.selectionStart !== area.selectionEnd) {
            this.closeSuggestions();
            return;
        }
        const query = open[1];
        const seq = (this.suggestSeq = (this.suggestSeq || 0) + 1);
        const items = await this.suggest(query);
        if (seq !== this.suggestSeq) return;
        this.suggestions = items.slice(0, 8);
        this.suggestIndex = 0;
        this.suggestStart = area.selectionStart - query.length;
        if (!this.suggestions.length) {
            this.closeSuggestions();
            return;
        }
        this.drawSuggestions();
        const caret = caretPosition(area, area.selectionStart);
        this.menu.style.top = `${area.offsetTop + caret.top + caret.height + 4}px`;
        this.menu.style.left = `${Math.min(area.offsetLeft + caret.left, area.offsetLeft + area.clientWidth - 260)}px`;
    }

    drawSuggestions() {
        this.menu.hidden = false;
        this.menu.replaceChildren(
            ...this.suggestions.map((item, i) => {
                const row = el(
                    'button',
                    {
                        type: 'button',
                        className: `link-suggest__item${i === this.suggestIndex ? ' is-selected' : ''}`,
                        role: 'option',
                    },
                    el('span', {}, item.label),
                    item.detail ? el('span', { className: 'muted' }, item.detail) : null,
                );
                row.addEventListener('mousedown', (event) => {
                    event.preventDefault();
                    this.acceptSuggestion(i);
                });
                return row;
            }),
        );
    }

    onSuggestKey(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            this.suggestIndex = (this.suggestIndex + step + this.suggestions.length) % this.suggestions.length;
            this.drawSuggestions();
            return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault();
            this.acceptSuggestion(this.suggestIndex);
            return true;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            this.closeSuggestions();
            return true;
        }
        return false;
    }

    acceptSuggestion(index) {
        const item = this.suggestions[index];
        if (!item) return;
        const area = this.textarea;
        const end = area.selectionStart;
        const closed = area.value.slice(end, end + 2) === ']]';
        this.closeSuggestions();
        this.replace(this.suggestStart, end + (closed ? 2 : 0), `${item.insert}]]`);
    }

    closeSuggestions() {
        this.menu.hidden = true;
        this.suggestions = [];
    }

    // ------------------------------------------------------------ image paste / drop / pick

    bindImageDrops() {
        const extractImages = (list) =>
            [...(list || [])].filter(
                (file) =>
                    file &&
                    (file.type?.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(file.name || '')),
            );

        this.textarea.addEventListener('paste', (event) => {
            const items = event.clipboardData?.items;
            const files = items
                ? [...items]
                      .filter((item) => item.kind === 'file')
                      .map((item) => item.getAsFile())
                      .filter(Boolean)
                : [...(event.clipboardData?.files || [])];
            const images = extractImages(files);
            if (!images.length) return;
            event.preventDefault();
            this.handleImageFiles(images);
        });

        this.textarea.addEventListener('dragover', (event) => {
            if (!event.dataTransfer?.types?.includes('Files')) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
            this.textarea.classList.add('is-drop-image');
        });
        this.textarea.addEventListener('dragleave', () => {
            this.textarea.classList.remove('is-drop-image');
        });
        this.textarea.addEventListener('drop', (event) => {
            this.textarea.classList.remove('is-drop-image');
            const images = extractImages(event.dataTransfer?.files);
            if (!images.length) return;
            event.preventDefault();
            this.handleImageFiles(images);
        });
    }

    pickImages() {
        if (!this.onUploadImages) return;
        const input = el('input', {
            type: 'file',
            accept: 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/svg+xml',
            multiple: true,
        });
        input.addEventListener('change', () => {
            const files = [...(input.files || [])];
            if (files.length) this.handleImageFiles(files);
        });
        input.click();
    }

    async handleImageFiles(files) {
        if (!this.onUploadImages || !files.length) return;
        const { selectionStart: start, selectionEnd: end } = this.textarea;
        const snippets = await this.onUploadImages(files);
        if (!snippets?.length) return;
        this.replace(start, end, snippets.join('\n'));
    }

    // ------------------------------------------------------------ toolbar

    buildToolbar() {
        const button = (label, title, action) => {
            const node = el('button', { type: 'button', className: 'editor-tool', title, ariaLabel: title }, label);
            // Keep focus (and the phone keyboard) in the textarea.
            node.addEventListener('mousedown', (event) => event.preventDefault());
            node.addEventListener('click', () => action());
            return node;
        };
        return el(
            'div',
            { className: 'editor-toolbar', role: 'toolbar', ariaLabel: 'Formatting' },
            button('H', 'Heading', () => this.cycleHeading()),
            button('B', 'Bold (Ctrl/⌘+B)', () => this.wrap('**')),
            button('I', 'Italic (Ctrl/⌘+I)', () => this.wrap('*')),
            button('•', 'Bullet list', () => this.toggleList()),
            button('☐', 'Task (Ctrl/⌘+Enter)', () => this.toggleTask()),
            button('[[', 'Link to a note', () => this.insertLink()),
            this.onUploadImages ? button('▣', 'Insert image (or paste/drop)', () => this.pickImages()) : null,
            button('⇥', 'Indent', () => this.indent(false)),
            button('⇤', 'Outdent', () => this.indent(true)),
        );
    }
}
