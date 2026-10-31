import { isEditableTarget, modKey } from './utils.js';

/**
 * Global shortcuts. Handlers receive the event and the id of the block containing the focus
 * (if any); return false to let the browser handle the key.
 */
export class KeyboardManager {
    constructor() {
        this.bindings = [];
        this.onKeyDown = this.onKeyDown.bind(this);
    }

    attach(target = document) {
        target.addEventListener('keydown', this.onKeyDown);
    }

    detach(target = document) {
        target.removeEventListener('keydown', this.onKeyDown);
    }

    /** combo like "mod+shift+z", "mod+arrowup", "/". `whenEditing` allows it inside editables. */
    bind(combo, handler, { whenEditing = true, description = '' } = {}) {
        const parts = combo.toLowerCase().split('+');
        this.bindings.push({
            key: parts[parts.length - 1],
            mod: parts.includes('mod'),
            shift: parts.includes('shift'),
            alt: parts.includes('alt'),
            handler,
            whenEditing,
            description,
            combo,
        });
    }

    onKeyDown(event) {
        if (event.defaultPrevented || event.isComposing) return;
        const key = event.key.toLowerCase();
        const editing = isEditableTarget(event.target);
        const blockId = event.target.closest?.('[data-component-id]')?.dataset.componentId || null;
        for (const binding of this.bindings) {
            if (binding.key !== key) continue;
            if (binding.mod !== modKey(event) || binding.shift !== event.shiftKey || binding.alt !== event.altKey)
                continue;
            if (editing && !binding.whenEditing) continue;
            if (binding.handler(event, blockId) !== false) {
                event.preventDefault();
                return;
            }
        }
    }
}
