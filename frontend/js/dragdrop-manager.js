import { el } from './utils.js';

/**
 * Drag blocks by their handle. A drop indicator shows where the block will land: above/below
 * another block (same parent) or into an empty toggle/column slot.
 */
export class DragDropManager {
    constructor({ root, onDrop }) {
        this.root = root;
        this.onDrop = onDrop;
        this.dragging = null;
        this.target = null;
        this.indicator = el('div', { className: 'drop-indicator', hidden: true });
        document.body.append(this.indicator);
        root.addEventListener('dragstart', (event) => this.start(event));
        root.addEventListener('dragover', (event) => this.over(event));
        root.addEventListener('drop', (event) => this.drop(event));
        root.addEventListener('dragend', () => this.end());
    }

    start(event) {
        const handle = event.target.closest?.('.block__handle');
        if (!handle) return;
        const block = handle.closest('.block');
        this.dragging = block.dataset.componentId;
        block.classList.add('is-dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/x-nosk-block', this.dragging);
        event.dataTransfer.setDragImage(block, 20, 20);
    }

    over(event) {
        if (!this.dragging) return;
        const dragged = this.root.querySelector(`[data-component-id="${this.dragging}"]`);
        const slot = event.target.closest('.block-slot');
        const block = event.target.closest('.block');
        let target = null;

        if (block && !dragged?.contains(block) && block !== dragged) {
            const rect = block.getBoundingClientRect();
            const before = event.clientY < rect.top + rect.height / 2;
            target = { kind: before ? 'before' : 'after', id: block.dataset.componentId, rect, before };
        } else if (slot && !dragged?.contains(slot) && !slot.querySelector(':scope > .block')) {
            target = {
                kind: 'slot',
                parentId: slot.dataset.parentId,
                slot: Number(slot.dataset.slot),
                rect: slot.getBoundingClientRect(),
            };
        }
        if (!target) {
            this.indicator.hidden = true;
            this.target = null;
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        this.target = target;
        const { rect } = target;
        const y = target.kind === 'slot' ? rect.top + 4 : target.before ? rect.top : rect.bottom;
        Object.assign(this.indicator.style, {
            left: `${rect.left}px`,
            width: `${rect.width}px`,
            top: `${y - 1 + window.scrollY}px`,
        });
        this.indicator.hidden = false;
    }

    drop(event) {
        if (!this.dragging || !this.target) return;
        event.preventDefault();
        const id = this.dragging;
        const target = this.target;
        this.end();
        this.onDrop(id, target);
    }

    end() {
        this.root.querySelector('.is-dragging')?.classList.remove('is-dragging');
        this.indicator.hidden = true;
        this.dragging = null;
        this.target = null;
    }
}
