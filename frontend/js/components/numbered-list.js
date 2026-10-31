import ListComponent from './list-base.js';
import { el } from '../utils.js';

/** Hierarchical labels (1, 1.1, 1.1.1) computed from indent levels. */
export function numberLabels(items, start = 1) {
    const counters = [];
    return items.map((item) => {
        const level = item.indent_level;
        counters.length = level + 1;
        for (let i = 0; i < level; i += 1) if (counters[i] === undefined) counters[i] = i === 0 ? start : 1;
        counters[level] = counters[level] === undefined ? (level === 0 ? start : 1) : counters[level] + 1;
        return counters.slice(0, level + 1).join('.');
    });
}

export default class NumberedListComponent extends ListComponent {
    static type = 'numbered-list';
    static label = 'Numbered list';
    static icon = '1.';
    static description = 'List with automatic numbering';
    static keywords = ['number', 'numbered', 'ordered', 'ol', 'list'];

    getDefaultContent() {
        return { ...super.getDefaultContent(), start_number: 1 };
    }

    containerClass() {
        return 'list-container numbered-list-container';
    }

    renderBody() {
        this.labels = numberLabels(this.content.items, this.content.start_number || 1);
        return super.renderBody();
    }

    renderMarker(item, index) {
        return el('span', { className: 'list-marker number', contentEditable: 'false' }, `${this.labels[index]}.`);
    }
}
