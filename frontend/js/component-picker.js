import registry, { CATEGORIES } from './components/registry.js';
import { el } from './utils.js';

export function filterEntries(entries, query) {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    const scored = [];
    for (const entry of entries) {
        let score = 0;
        if (entry.commands.some((command) => command === q)) score = 100;
        else if (entry.commands.some((command) => command.startsWith(q))) score = 80;
        else if (entry.label.toLowerCase().startsWith(q)) score = 60;
        else if (entry.label.toLowerCase().includes(q)) score = 40;
        else if (entry.keywords.some((keyword) => keyword.includes(q))) score = 20;
        if (score) scored.push({ entry, score });
    }
    return scored.sort((a, b) => b.score - a.score).map(({ entry }) => entry);
}

function position(popover, anchor) {
    const rect = anchor.getBoundingClientRect();
    popover.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - popover.offsetWidth - 12))}px`;
    const below = rect.bottom + 6;
    const fitsBelow = below + popover.offsetHeight < window.innerHeight - 12;
    popover.style.top = `${fitsBelow ? below : Math.max(12, rect.top - popover.offsetHeight - 6)}px`;
}

/** Slash-command menu and the "+" block picker. */
export class ComponentPicker {
    constructor() {
        this.entries = registry.pickerEntries();
        this.active = null;
    }

    close() {
        this.active?.teardown();
        this.active = null;
    }

    renderItem(entry, selected) {
        return el(
            'button',
            {
                type: 'button',
                className: `picker-item${selected ? ' is-selected' : ''}`,
                role: 'option',
                ariaSelected: String(selected),
                dataset: { key: entry.key },
            },
            el('span', { className: 'picker-item__icon' }, entry.icon),
            el(
                'span',
                { className: 'picker-item__text' },
                el('span', { className: 'picker-item__label' }, entry.label),
                el('span', { className: 'picker-item__description' }, entry.description),
            ),
            entry.commands[0] ? el('kbd', {}, `/${entry.commands[0]}`) : null,
        );
    }

    /** Menu anchored to a block while the user types "/query" into it. */
    openSlash({ anchor, readQuery, onSelect, onCancel }) {
        this.close();
        const popover = el('div', { className: 'picker picker--slash', role: 'listbox' });
        document.body.append(popover);
        let index = 0;
        let results = this.entries;
        let misses = 0;

        const draw = () => {
            popover.replaceChildren(
                el(
                    'div',
                    { className: 'picker__header' },
                    el('span', { className: 'eyebrow' }, 'blocks'),
                    el('span', { className: 'muted' }, '↑↓ to navigate · ↵ to insert · esc'),
                ),
                ...(results.length
                    ? results.slice(0, 50).map((entry, i) => this.renderItem(entry, i === index))
                    : [el('div', { className: 'picker__empty' }, 'No matching blocks')]),
            );
            popover.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
            position(popover, anchor);
        };
        const choose = (entry) => {
            this.close();
            onSelect(entry);
        };
        const onInput = () => {
            if (!anchor.textContent.startsWith('/')) {
                this.close();
                onCancel?.();
                return;
            }
            results = filterEntries(this.entries, readQuery());
            index = 0;
            misses = results.length ? 0 : misses + 1;
            if (misses > 3) this.close();
            else draw();
        };
        const onKey = (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                event.stopImmediatePropagation();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                index = (index + step + results.length) % Math.max(results.length, 1);
                draw();
            } else if (event.key === 'Enter' || event.key === 'Tab') {
                if (!results.length) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                choose(results[index]);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                this.close();
                onCancel?.();
            }
        };
        const onClick = (event) => {
            const button = event.target.closest('.picker-item');
            if (button) choose(this.entries.find((e) => e.key === button.dataset.key));
        };
        const onOutside = (event) => {
            if (!popover.contains(event.target)) this.close();
        };
        anchor.addEventListener('input', onInput);
        anchor.addEventListener('keydown', onKey, true);
        anchor.addEventListener('blur', () => setTimeout(() => this.active?.anchor === anchor && this.close(), 150), {
            once: true,
        });
        popover.addEventListener('mousedown', (event) => event.preventDefault());
        popover.addEventListener('click', onClick);
        document.addEventListener('mousedown', onOutside);
        this.active = {
            anchor,
            teardown: () => {
                anchor.removeEventListener('input', onInput);
                anchor.removeEventListener('keydown', onKey, true);
                document.removeEventListener('mousedown', onOutside);
                popover.remove();
            },
        };
        draw();
    }

    /** Category grid opened from a block's "+" button. */
    openGrid({ anchor, onSelect }) {
        this.close();
        const popover = el('div', { className: 'picker picker--grid', role: 'dialog', ariaLabel: 'Insert block' });
        const search = el('input', {
            type: 'search',
            className: 'picker__search',
            placeholder: 'Search blocks…',
            ariaLabel: 'Search blocks',
        });
        const body = el('div', { className: 'picker__body' });
        popover.append(search, body);
        document.body.append(popover);
        let flat = [];
        let index = 0;

        const draw = () => {
            const results = filterEntries(this.entries, search.value);
            flat = [];
            const sections = CATEGORIES.map((category, n) => {
                const items = results.filter((entry) => entry.category === category.id);
                if (!items.length) return null;
                const grid = el('div', { className: 'picker-grid' });
                items.forEach((entry) => {
                    const card = el(
                        'button',
                        {
                            type: 'button',
                            className: `picker-card${flat.length === index ? ' is-selected' : ''}`,
                            dataset: { key: entry.key },
                            title: entry.description,
                        },
                        el('span', { className: 'picker-card__icon' }, entry.icon),
                        el('span', { className: 'picker-card__label' }, entry.label),
                    );
                    flat.push(entry);
                    grid.append(card);
                });
                return el(
                    'section',
                    { className: 'picker-section' },
                    el(
                        'div',
                        { className: 'eyebrow' },
                        `${String(n + 1).padStart(2, '0')}/${category.label.toLowerCase()}`,
                    ),
                    grid,
                );
            }).filter(Boolean);
            body.replaceChildren(
                ...(sections.length ? sections : [el('div', { className: 'picker__empty' }, 'No matching blocks')]),
            );
            position(popover, anchor);
        };
        const choose = (entry) => {
            this.close();
            onSelect(entry);
        };
        search.addEventListener('input', () => {
            index = 0;
            draw();
        });
        search.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                event.preventDefault();
                index = Math.min(flat.length - 1, index + 1);
                draw();
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                event.preventDefault();
                index = Math.max(0, index - 1);
                draw();
            } else if (event.key === 'Enter' && flat[index]) {
                event.preventDefault();
                choose(flat[index]);
            } else if (event.key === 'Escape') {
                this.close();
            }
        });
        popover.addEventListener('click', (event) => {
            const card = event.target.closest('.picker-card');
            if (card) choose(this.entries.find((e) => e.key === card.dataset.key));
        });
        const onOutside = (event) => {
            if (!popover.contains(event.target) && event.target !== anchor) this.close();
        };
        setTimeout(() => document.addEventListener('mousedown', onOutside), 0);
        this.active = {
            anchor,
            teardown: () => {
                document.removeEventListener('mousedown', onOutside);
                popover.remove();
            },
        };
        draw();
        search.focus();
    }
}
