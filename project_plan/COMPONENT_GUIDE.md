# Component Implementation Guide

**Version**: 1.0
**Target**: Pure HTML/CSS/JavaScript (ES6+)

This guide provides detailed implementation instructions for all 9 MVP components in the nosk system.

---

## Table of Contents

1. [Base Component](#base-component)
2. [Component Registry](#component-registry)
3. [Text Block Component](#text-block-component)
4. [Heading Component](#heading-component)
5. [Markdown Component](#markdown-component)
6. [Checklist Component](#checklist-component)
7. [Bullet List Component](#bullet-list-component)
8. [Numbered List Component](#numbered-list-component)
9. [Toggle Component](#toggle-component)
10. [Callout Component](#callout-component)
11. [Divider Component](#divider-component)
12. [Testing Components](#testing-components)

---

## Base Component

All components extend from this base class.

**File**: `frontend/js/components/base-component.js`

```javascript
import { generateUUID, now } from '../utils.js';

export default class BaseComponent {
    constructor(data = {}, options = {}) {
        this.id = data.id || generateUUID();
        this.type = '';  // Override in subclass
        this.content = data.content || this.getDefaultContent();
        this.metadata = {
            created_at: data.metadata?.created_at || now(),
            updated_at: now(),
            order: data.metadata?.order || 0,
            schema_version: 1
        };

        this.options = options;
        this.element = null;
        this.listeners = [];
    }

    /**
     * Get default content for this component type
     * Override in subclasses
     */
    getDefaultContent() {
        return {};
    }

    /**
     * Render the component and return DOM element
     * Must be implemented by subclasses
     */
    render() {
        throw new Error('render() must be implemented by subclass');
    }

    /**
     * Serialize component to JSON
     */
    serialize() {
        return {
            id: this.id,
            type: this.type,
            content: this.content,
            metadata: this.metadata
        };
    }

    /**
     * Update component content
     */
    update(content) {
        this.content = { ...this.content, ...content };
        this.metadata.updated_at = now();

        if (this.options.onChange) {
            this.options.onChange(this.serialize());
        }
    }

    /**
     * Clean up event listeners and DOM
     */
    destroy() {
        // Remove event listeners
        this.listeners.forEach(({ element, event, handler }) => {
            element.removeEventListener(event, handler);
        });
        this.listeners = [];

        // Remove DOM element
        if (this.element && this.element.parentNode) {
            this.element.parentNode.removeChild(this.element);
        }
    }

    /**
     * Add event listener and track for cleanup
     */
    addEventListener(element, event, handler) {
        element.addEventListener(event, handler);
        this.listeners.push({ element, event, handler });
    }

    /**
     * Create wrapper with drag handle and plus button
     */
    createWrapper() {
        const wrapper = document.createElement('div');
        wrapper.className = 'component';
        wrapper.dataset.componentId = this.id;
        wrapper.dataset.componentType = this.type;
        wrapper.dataset.order = this.metadata.order;

        // Add drag handle
        const dragHandle = document.createElement('div');
        dragHandle.className = 'drag-handle';
        dragHandle.innerHTML = '⋮⋮';
        dragHandle.title = 'Drag to reorder';
        wrapper.appendChild(dragHandle);

        // Add plus button
        const plusButton = document.createElement('button');
        plusButton.className = 'plus-button';
        plusButton.innerHTML = '+';
        plusButton.title = 'Add component';
        plusButton.type = 'button';
        wrapper.appendChild(plusButton);

        return wrapper;
    }

    /**
     * Focus this component
     */
    focus() {
        if (this.element) {
            const focusable = this.element.querySelector('[contenteditable], input, textarea');
            if (focusable) {
                focusable.focus();
            }
        }
    }
}
```

---

## Component Registry

Factory for creating component instances.

**File**: `frontend/js/components/registry.js`

```javascript
import TextBlockComponent from './text-block.js';
import HeadingComponent from './heading.js';
import MarkdownComponent from './markdown.js';
import ChecklistComponent from './checklist.js';
import BulletListComponent from './bullet-list.js';
import NumberedListComponent from './numbered-list.js';
import ToggleComponent from './toggle.js';
import CalloutComponent from './callout.js';
import DividerComponent from './divider.js';

class ComponentRegistry {
    constructor() {
        this.components = new Map();
        this.registerDefaultComponents();
    }

    registerDefaultComponents() {
        this.register('text-block', TextBlockComponent);
        this.register('heading', HeadingComponent);
        this.register('markdown', MarkdownComponent);
        this.register('checklist', ChecklistComponent);
        this.register('bullet-list', BulletListComponent);
        this.register('numbered-list', NumberedListComponent);
        this.register('toggle', ToggleComponent);
        this.register('callout', CalloutComponent);
        this.register('divider', DividerComponent);
    }

    register(type, ComponentClass) {
        this.components.set(type, ComponentClass);
    }

    create(type, data, options) {
        const ComponentClass = this.components.get(type);
        if (!ComponentClass) {
            throw new Error(`Unknown component type: ${type}`);
        }
        return new ComponentClass(data, options);
    }

    getAvailableTypes() {
        return Array.from(this.components.keys());
    }

    getComponentInfo(type) {
        const info = {
            'text-block': { icon: '📝', label: 'Text', category: 'basic' },
            'heading': { icon: '#', label: 'Heading', category: 'basic' },
            'markdown': { icon: '</>', label: 'Markdown', category: 'advanced' },
            'checklist': { icon: '✓', label: 'Checklist', category: 'basic' },
            'bullet-list': { icon: '•', label: 'List', category: 'basic' },
            'numbered-list': { icon: '1.', label: 'Numbered', category: 'basic' },
            'toggle': { icon: '▶', label: 'Toggle', category: 'advanced' },
            'callout': { icon: '💡', label: 'Callout', category: 'advanced' },
            'divider': { icon: '───', label: 'Divider', category: 'basic' }
        };
        return info[type] || { icon: '?', label: type, category: 'other' };
    }
}

export default new ComponentRegistry();
```

---

## Text Block Component

Rich text editor with inline formatting.

**File**: `frontend/js/components/text-block.js`

```javascript
import BaseComponent from './base-component.js';
import { debounce } from '../utils.js';

export default class TextBlockComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'text-block';
    }

    getDefaultContent() {
        return {
            text: '',
            format: 'html'
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const contentDiv = document.createElement('div');
        contentDiv.className = 'text-block-content';
        contentDiv.contentEditable = true;
        contentDiv.innerHTML = this.content.text || '';
        contentDiv.setAttribute('data-placeholder', 'Type / for commands');

        // Debounced update
        const debouncedUpdate = debounce(() => {
            this.update({ text: contentDiv.innerHTML });
        }, 500);

        this.addEventListener(contentDiv, 'input', debouncedUpdate);

        // Handle formatting shortcuts
        this.addEventListener(contentDiv, 'keydown', (e) => {
            this.handleKeydown(e, contentDiv);
        });

        // Prevent default behavior on Enter (let page manager handle it)
        this.addEventListener(contentDiv, 'keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Check if content is empty
                if (!contentDiv.textContent.trim()) {
                    e.preventDefault();
                }
            }
        });

        wrapper.appendChild(contentDiv);
        this.element = wrapper;
        return wrapper;
    }

    handleKeydown(e, element) {
        const isMod = e.metaKey || e.ctrlKey;

        if (isMod && e.key === 'b') {
            e.preventDefault();
            document.execCommand('bold');
            this.update({ text: element.innerHTML });
        } else if (isMod && e.key === 'i') {
            e.preventDefault();
            document.execCommand('italic');
            this.update({ text: element.innerHTML });
        } else if (isMod && e.key === 'e') {
            e.preventDefault();
            this.wrapSelection('code');
            this.update({ text: element.innerHTML });
        } else if (isMod && e.key === 'k') {
            e.preventDefault();
            this.insertLink();
            this.update({ text: element.innerHTML });
        }
    }

    wrapSelection(tag) {
        const selection = window.getSelection();
        if (selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const selectedText = range.toString();
        if (!selectedText) return;

        const wrapper = document.createElement(tag);
        wrapper.textContent = selectedText;

        range.deleteContents();
        range.insertNode(wrapper);
    }

    insertLink() {
        const selection = window.getSelection();
        const selectedText = selection.toString() || 'link text';
        const url = prompt('Enter URL:', 'https://');

        if (!url) return;

        const link = document.createElement('a');
        link.href = url;
        link.textContent = selectedText;
        link.target = '_blank';

        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            range.deleteContents();
            range.insertNode(link);
        }
    }
}
```

---

## Heading Component

Simple heading with level selection.

**File**: `frontend/js/components/heading.js`

```javascript
import BaseComponent from './base-component.js';
import { debounce, stripHTML } from '../utils.js';

export default class HeadingComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'heading';
    }

    getDefaultContent() {
        return {
            text: '',
            level: 1
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const headingElement = document.createElement(`h${this.content.level}`);
        headingElement.className = 'heading-content';
        headingElement.contentEditable = true;
        headingElement.textContent = this.content.text;
        headingElement.setAttribute('data-placeholder', 'Heading');

        // Debounced update
        const debouncedUpdate = debounce(() => {
            this.update({ text: stripHTML(headingElement.textContent) });
        }, 500);

        this.addEventListener(headingElement, 'input', debouncedUpdate);

        // Level selector
        const levelSelector = document.createElement('div');
        levelSelector.className = 'heading-level-selector';
        for (let i = 1; i <= 3; i++) {
            const btn = document.createElement('button');
            btn.textContent = `H${i}`;
            btn.className = i === this.content.level ? 'active' : '';
            btn.type = 'button';
            this.addEventListener(btn, 'click', () => {
                this.changeLevel(i, headingElement, levelSelector);
            });
            levelSelector.appendChild(btn);
        }

        wrapper.appendChild(levelSelector);
        wrapper.appendChild(headingElement);
        this.element = wrapper;
        return wrapper;
    }

    changeLevel(newLevel, headingElement, levelSelector) {
        this.content.level = newLevel;
        const newHeading = document.createElement(`h${newLevel}`);
        newHeading.className = headingElement.className;
        newHeading.contentEditable = true;
        newHeading.textContent = headingElement.textContent;

        headingElement.parentNode.replaceChild(newHeading, headingElement);

        // Update active button
        levelSelector.querySelectorAll('button').forEach((btn, idx) => {
            btn.className = (idx + 1) === newLevel ? 'active' : '';
        });

        this.update({ level: newLevel });
    }
}
```

---

## Markdown Component

Markdown editor with live preview.

**File**: `frontend/js/components/markdown.js`

```javascript
import BaseComponent from './base-component.js';
import { debounce } from '../utils.js';

export default class MarkdownComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'markdown';
    }

    getDefaultContent() {
        return {
            source: '',
            preview_mode: false
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const container = document.createElement('div');
        container.className = 'markdown-container';

        // Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'markdown-toolbar';

        const toggleBtn = document.createElement('button');
        toggleBtn.textContent = this.content.preview_mode ? 'Edit' : 'Preview';
        toggleBtn.className = 'markdown-toggle-btn';
        toggleBtn.type = 'button';
        this.addEventListener(toggleBtn, 'click', () => {
            this.togglePreview(container, toggleBtn);
        });
        toolbar.appendChild(toggleBtn);

        container.appendChild(toolbar);

        // Editor or preview
        if (this.content.preview_mode) {
            container.appendChild(this.createPreview());
        } else {
            container.appendChild(this.createEditor());
        }

        wrapper.appendChild(container);
        this.element = wrapper;
        return wrapper;
    }

    createEditor() {
        const textarea = document.createElement('textarea');
        textarea.className = 'markdown-editor';
        textarea.value = this.content.source;
        textarea.placeholder = 'Write markdown here...';

        const debouncedUpdate = debounce(() => {
            this.update({ source: textarea.value });
        }, 500);

        this.addEventListener(textarea, 'input', debouncedUpdate);

        return textarea;
    }

    createPreview() {
        const preview = document.createElement('div');
        preview.className = 'markdown-preview';

        // Use marked.js to parse markdown
        if (window.marked) {
            preview.innerHTML = marked.parse(this.content.source || '');
        } else {
            preview.textContent = this.content.source;
        }

        return preview;
    }

    togglePreview(container, toggleBtn) {
        this.content.preview_mode = !this.content.preview_mode;
        toggleBtn.textContent = this.content.preview_mode ? 'Edit' : 'Preview';

        // Remove current content
        const currentContent = container.querySelector('.markdown-editor, .markdown-preview');
        if (currentContent) {
            currentContent.remove();
        }

        // Add new content
        if (this.content.preview_mode) {
            container.appendChild(this.createPreview());
        } else {
            container.appendChild(this.createEditor());
        }

        this.update({ preview_mode: this.content.preview_mode });
    }
}
```

---

## Checklist Component

Task list with checkboxes and nesting.

**File**: `frontend/js/components/checklist.js`

```javascript
import BaseComponent from './base-component.js';
import { generateUUID } from '../utils.js';

export default class ChecklistComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'checklist';
    }

    getDefaultContent() {
        return {
            items: [
                {
                    id: generateUUID(),
                    text: '',
                    checked: false,
                    indent_level: 0
                }
            ]
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const container = document.createElement('div');
        container.className = 'checklist-container';

        this.content.items.forEach((item, index) => {
            container.appendChild(this.createItem(item, index));
        });

        wrapper.appendChild(container);
        this.element = wrapper;
        return wrapper;
    }

    createItem(item, index) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'checklist-item';
        itemDiv.style.paddingLeft = `${item.indent_level * 24}px`;
        itemDiv.dataset.itemId = item.id;

        // Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = item.checked;
        checkbox.className = 'checklist-checkbox';
        this.addEventListener(checkbox, 'change', () => {
            item.checked = checkbox.checked;
            textInput.style.textDecoration = item.checked ? 'line-through' : 'none';
            this.updateItems();
        });

        // Text input
        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = item.text;
        textInput.className = 'checklist-text';
        textInput.placeholder = 'Task';
        textInput.style.textDecoration = item.checked ? 'line-through' : 'none';

        this.addEventListener(textInput, 'input', () => {
            item.text = textInput.value;
            this.updateItems();
        });

        this.addEventListener(textInput, 'keydown', (e) => {
            this.handleItemKeydown(e, item, index);
        });

        itemDiv.appendChild(checkbox);
        itemDiv.appendChild(textInput);

        return itemDiv;
    }

    handleItemKeydown(e, item, index) {
        if (e.key === 'Enter') {
            e.preventDefault();
            this.addItemAfter(index);
        } else if (e.key === 'Backspace' && !item.text && this.content.items.length > 1) {
            e.preventDefault();
            this.deleteItem(index);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                this.outdentItem(item);
            } else {
                this.indentItem(item);
            }
        }
    }

    addItemAfter(index) {
        const newItem = {
            id: generateUUID(),
            text: '',
            checked: false,
            indent_level: this.content.items[index].indent_level
        };
        this.content.items.splice(index + 1, 0, newItem);
        this.rerender();
    }

    deleteItem(index) {
        this.content.items.splice(index, 1);
        this.rerender();
    }

    indentItem(item) {
        if (item.indent_level < 3) {
            item.indent_level++;
            this.rerender();
        }
    }

    outdentItem(item) {
        if (item.indent_level > 0) {
            item.indent_level--;
            this.rerender();
        }
    }

    updateItems() {
        this.update({ items: this.content.items });
    }

    rerender() {
        const container = this.element.querySelector('.checklist-container');
        container.innerHTML = '';
        this.content.items.forEach((item, index) => {
            container.appendChild(this.createItem(item, index));
        });
        this.updateItems();
    }
}
```

---

## Bullet List Component

**File**: `frontend/js/components/bullet-list.js`

```javascript
import BaseComponent from './base-component.js';
import { generateUUID } from '../utils.js';

export default class BulletListComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'bullet-list';
    }

    getDefaultContent() {
        return {
            items: [
                {
                    id: generateUUID(),
                    text: '',
                    indent_level: 0
                }
            ]
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const container = document.createElement('div');
        container.className = 'bullet-list-container';

        this.content.items.forEach((item, index) => {
            container.appendChild(this.createItem(item, index));
        });

        wrapper.appendChild(container);
        this.element = wrapper;
        return wrapper;
    }

    createItem(item, index) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'bullet-list-item';
        itemDiv.style.paddingLeft = `${item.indent_level * 24}px`;
        itemDiv.dataset.itemId = item.id;

        // Bullet
        const bullet = document.createElement('span');
        bullet.className = `bullet bullet-level-${item.indent_level}`;
        bullet.textContent = this.getBulletChar(item.indent_level);

        // Text input
        const textInput = document.createElement('div');
        textInput.contentEditable = true;
        textInput.innerHTML = item.text;
        textInput.className = 'bullet-list-text';
        textInput.setAttribute('data-placeholder', 'List item');

        this.addEventListener(textInput, 'input', () => {
            item.text = textInput.innerHTML;
            this.updateItems();
        });

        this.addEventListener(textInput, 'keydown', (e) => {
            this.handleItemKeydown(e, item, index, textInput);
        });

        itemDiv.appendChild(bullet);
        itemDiv.appendChild(textInput);

        return itemDiv;
    }

    getBulletChar(level) {
        const bullets = ['•', '○', '▪', '▫'];
        return bullets[level % bullets.length];
    }

    handleItemKeydown(e, item, index, textInput) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.addItemAfter(index);
        } else if (e.key === 'Backspace' && !textInput.textContent.trim() && this.content.items.length > 1) {
            e.preventDefault();
            this.deleteItem(index);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                this.outdentItem(item);
            } else {
                this.indentItem(item);
            }
        }
    }

    addItemAfter(index) {
        const newItem = {
            id: generateUUID(),
            text: '',
            indent_level: this.content.items[index].indent_level
        };
        this.content.items.splice(index + 1, 0, newItem);
        this.rerender();
    }

    deleteItem(index) {
        this.content.items.splice(index, 1);
        this.rerender();
    }

    indentItem(item) {
        if (item.indent_level < 3) {
            item.indent_level++;
            this.rerender();
        }
    }

    outdentItem(item) {
        if (item.indent_level > 0) {
            item.indent_level--;
            this.rerender();
        }
    }

    updateItems() {
        this.update({ items: this.content.items });
    }

    rerender() {
        const container = this.element.querySelector('.bullet-list-container');
        container.innerHTML = '';
        this.content.items.forEach((item, index) => {
            container.appendChild(this.createItem(item, index));
        });
        this.updateItems();
    }
}
```

---

## Numbered List Component

**File**: `frontend/js/components/numbered-list.js`

```javascript
import BaseComponent from './base-component.js';
import { generateUUID } from '../utils.js';

export default class NumberedListComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'numbered-list';
    }

    getDefaultContent() {
        return {
            items: [
                {
                    id: generateUUID(),
                    text: '',
                    indent_level: 0
                }
            ],
            start_number: 1
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const container = document.createElement('div');
        container.className = 'numbered-list-container';

        this.content.items.forEach((item, index) => {
            container.appendChild(this.createItem(item, index));
        });

        wrapper.appendChild(container);
        this.element = wrapper;
        return wrapper;
    }

    createItem(item, index) {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'numbered-list-item';
        itemDiv.style.paddingLeft = `${item.indent_level * 24}px`;
        itemDiv.dataset.itemId = item.id;

        // Number
        const number = document.createElement('span');
        number.className = 'number';
        number.textContent = `${this.getItemNumber(index, item.indent_level)}.`;

        // Text input
        const textInput = document.createElement('div');
        textInput.contentEditable = true;
        textInput.innerHTML = item.text;
        textInput.className = 'numbered-list-text';
        textInput.setAttribute('data-placeholder', 'List item');

        this.addEventListener(textInput, 'input', () => {
            item.text = textInput.innerHTML;
            this.updateItems();
        });

        this.addEventListener(textInput, 'keydown', (e) => {
            this.handleItemKeydown(e, item, index, textInput);
        });

        itemDiv.appendChild(number);
        itemDiv.appendChild(textInput);

        return itemDiv;
    }

    getItemNumber(index, indentLevel) {
        // Simple numbering: just use index + start_number
        // For nested, could implement 1.1, 1.2, etc.
        return this.content.start_number + index;
    }

    handleItemKeydown(e, item, index, textInput) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            this.addItemAfter(index);
        } else if (e.key === 'Backspace' && !textInput.textContent.trim() && this.content.items.length > 1) {
            e.preventDefault();
            this.deleteItem(index);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            if (e.shiftKey) {
                this.outdentItem(item);
            } else {
                this.indentItem(item);
            }
        }
    }

    addItemAfter(index) {
        const newItem = {
            id: generateUUID(),
            text: '',
            indent_level: this.content.items[index].indent_level
        };
        this.content.items.splice(index + 1, 0, newItem);
        this.rerender();
    }

    deleteItem(index) {
        this.content.items.splice(index, 1);
        this.rerender();
    }

    indentItem(item) {
        if (item.indent_level < 3) {
            item.indent_level++;
            this.rerender();
        }
    }

    outdentItem(item) {
        if (item.indent_level > 0) {
            item.indent_level--;
            this.rerender();
        }
    }

    updateItems() {
        this.update({ items: this.content.items });
    }

    rerender() {
        const container = this.element.querySelector('.numbered-list-container');
        container.innerHTML = '';
        this.content.items.forEach((item, index) => {
            container.appendChild(this.createItem(item, index));
        });
        this.updateItems();
    }
}
```

---

## Toggle Component

**File**: `frontend/js/components/toggle.js`

```javascript
import BaseComponent from './base-component.js';
import { debounce } from '../utils.js';

export default class ToggleComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'toggle';
    }

    getDefaultContent() {
        return {
            title: '',
            children: [],
            is_open: false
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const container = document.createElement('div');
        container.className = 'toggle-container';

        // Header
        const header = document.createElement('div');
        header.className = 'toggle-header';

        const arrow = document.createElement('span');
        arrow.className = 'toggle-arrow';
        arrow.textContent = this.content.is_open ? '▼' : '▶';

        const title = document.createElement('div');
        title.contentEditable = true;
        title.className = 'toggle-title';
        title.textContent = this.content.title;
        title.setAttribute('data-placeholder', 'Toggle heading');

        const debouncedUpdate = debounce(() => {
            this.update({ title: title.textContent });
        }, 500);

        this.addEventListener(title, 'input', debouncedUpdate);

        this.addEventListener(arrow, 'click', () => {
            this.toggle(arrow, childrenContainer);
        });

        header.appendChild(arrow);
        header.appendChild(title);

        // Children container
        const childrenContainer = document.createElement('div');
        childrenContainer.className = 'toggle-children';
        childrenContainer.style.display = this.content.is_open ? 'block' : 'none';

        // Note: Children components are rendered by page manager
        // This is just a placeholder

        container.appendChild(header);
        container.appendChild(childrenContainer);
        wrapper.appendChild(container);
        this.element = wrapper;
        return wrapper;
    }

    toggle(arrow, childrenContainer) {
        this.content.is_open = !this.content.is_open;
        arrow.textContent = this.content.is_open ? '▼' : '▶';
        childrenContainer.style.display = this.content.is_open ? 'block' : 'none';
        this.update({ is_open: this.content.is_open });
    }
}
```

---

## Callout Component

**File**: `frontend/js/components/callout.js`

```javascript
import BaseComponent from './base-component.js';
import { debounce } from '../utils.js';

export default class CalloutComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'callout';
    }

    getDefaultContent() {
        return {
            text: '',
            variant: 'note',
            icon: null
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const container = document.createElement('div');
        container.className = `callout-container callout-${this.content.variant}`;

        // Icon
        const icon = document.createElement('span');
        icon.className = 'callout-icon';
        icon.textContent = this.getIcon();

        // Content
        const content = document.createElement('div');
        content.contentEditable = true;
        content.className = 'callout-content';
        content.innerHTML = this.content.text;
        content.setAttribute('data-placeholder', 'Callout text');

        const debouncedUpdate = debounce(() => {
            this.update({ text: content.innerHTML });
        }, 500);

        this.addEventListener(content, 'input', debouncedUpdate);

        // Variant selector
        const variantSelector = this.createVariantSelector(container);

        container.appendChild(icon);
        container.appendChild(content);
        container.appendChild(variantSelector);

        wrapper.appendChild(container);
        this.element = wrapper;
        return wrapper;
    }

    getIcon() {
        if (this.content.icon) return this.content.icon;

        const defaultIcons = {
            info: 'ℹ️',
            warning: '⚠️',
            success: '✅',
            error: '❌',
            note: '📝'
        };
        return defaultIcons[this.content.variant] || '📝';
    }

    createVariantSelector(container) {
        const selector = document.createElement('div');
        selector.className = 'callout-variant-selector';

        const variants = ['note', 'info', 'warning', 'success', 'error'];
        variants.forEach(variant => {
            const btn = document.createElement('button');
            btn.textContent = variant;
            btn.className = variant === this.content.variant ? 'active' : '';
            btn.type = 'button';
            this.addEventListener(btn, 'click', () => {
                this.changeVariant(variant, container, selector);
            });
            selector.appendChild(btn);
        });

        return selector;
    }

    changeVariant(newVariant, container, selector) {
        // Remove old variant class
        container.className = container.className.replace(/callout-\w+/g, '');
        container.classList.add(`callout-${newVariant}`);

        this.content.variant = newVariant;

        // Update icon
        const icon = container.querySelector('.callout-icon');
        icon.textContent = this.getIcon();

        // Update active button
        selector.querySelectorAll('button').forEach(btn => {
            btn.className = btn.textContent === newVariant ? 'active' : '';
        });

        this.update({ variant: newVariant });
    }
}
```

---

## Divider Component

**File**: `frontend/js/components/divider.js`

```javascript
import BaseComponent from './base-component.js';

export default class DividerComponent extends BaseComponent {
    constructor(data, options) {
        super(data, options);
        this.type = 'divider';
    }

    getDefaultContent() {
        return {
            style: 'solid'
        };
    }

    render() {
        const wrapper = this.createWrapper();

        const divider = document.createElement('hr');
        divider.className = `divider divider-${this.content.style}`;

        // Style selector (appears on hover)
        const styleSelector = document.createElement('div');
        styleSelector.className = 'divider-style-selector';

        const styles = ['solid', 'dashed', 'dotted', 'thick'];
        styles.forEach(style => {
            const btn = document.createElement('button');
            btn.textContent = style;
            btn.className = style === this.content.style ? 'active' : '';
            btn.type = 'button';
            this.addEventListener(btn, 'click', () => {
                this.changeStyle(style, divider, styleSelector);
            });
            styleSelector.appendChild(btn);
        });

        wrapper.appendChild(divider);
        wrapper.appendChild(styleSelector);
        this.element = wrapper;
        return wrapper;
    }

    changeStyle(newStyle, divider, selector) {
        // Remove old style class
        divider.className = divider.className.replace(/divider-\w+/g, '');
        divider.classList.add(`divider-${newStyle}`);

        this.content.style = newStyle;

        // Update active button
        selector.querySelectorAll('button').forEach(btn => {
            btn.className = btn.textContent === newStyle ? 'active' : '';
        });

        this.update({ style: newStyle });
    }
}
```

---

## Testing Components

### Manual Testing Checklist

For each component:

1. **Rendering**
   - [ ] Component renders without errors
   - [ ] Default content displays correctly
   - [ ] Saved content loads properly

2. **Interaction**
   - [ ] All interactive elements work (buttons, inputs, etc.)
   - [ ] Keyboard shortcuts function as expected
   - [ ] Focus behavior is correct

3. **Content Updates**
   - [ ] Changes trigger `onChange` callback
   - [ ] Content serializes correctly
   - [ ] Updates are debounced appropriately

4. **Edge Cases**
   - [ ] Empty content handles gracefully
   - [ ] Maximum length constraints work
   - [ ] Special characters don't break rendering

5. **Cleanup**
   - [ ] `destroy()` removes all event listeners
   - [ ] DOM elements are properly removed
   - [ ] No memory leaks

### Unit Test Example

```javascript
// Example test for TextBlockComponent
describe('TextBlockComponent', () => {
    let component;
    let onChange;

    beforeEach(() => {
        onChange = jest.fn();
        component = new TextBlockComponent({}, { onChange });
    });

    afterEach(() => {
        component.destroy();
    });

    test('renders with default content', () => {
        const element = component.render();
        expect(element).toBeTruthy();
        expect(element.querySelector('.text-block-content')).toBeTruthy();
    });

    test('updates content on input', (done) => {
        const element = component.render();
        const content = element.querySelector('.text-block-content');

        content.innerHTML = 'Test content';
        content.dispatchEvent(new Event('input'));

        // Wait for debounce
        setTimeout(() => {
            expect(onChange).toHaveBeenCalled();
            expect(component.content.text).toBe('Test content');
            done();
        }, 600);
    });

    test('serializes correctly', () => {
        component.content.text = 'Test';
        const serialized = component.serialize();

        expect(serialized).toHaveProperty('id');
        expect(serialized).toHaveProperty('type', 'text-block');
        expect(serialized).toHaveProperty('content');
        expect(serialized.content.text).toBe('Test');
    });
});
```

---

## Best Practices

1. **Always extend BaseComponent**: Inherit common functionality
2. **Use debouncing**: Prevent excessive updates on rapid input
3. **Clean up**: Remove event listeners in `destroy()`
4. **Validate content**: Check content structure before rendering
5. **Handle edge cases**: Empty content, special characters, etc.
6. **Accessibility**: Add ARIA labels, keyboard navigation
7. **Performance**: Minimize DOM updates, use event delegation
8. **Consistency**: Follow the same patterns across all components

---

**Last Updated**: 2026-01-27
**Version**: 1.0
