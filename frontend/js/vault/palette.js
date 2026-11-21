// Keyboard-driven picker used for the quick switcher and full-text search. `source(query)`
// returns items: { icon, label, snippet (HTML), kind, hint, run }. With `anchor`, the bar floats
// centred over that element (the note pane) instead of the whole window.
import { el } from '../utils.js';

export class Palette {
    constructor() {
        this.element = null;
        this.seq = 0;
    }

    close() {
        this.element?.remove();
        this.element = null;
        if (this.onResize) window.removeEventListener('resize', this.onResize);
        this.onResize = null;
    }

    get isOpen() {
        return Boolean(this.element);
    }

    async open({ placeholder, sigil = '>', source, debounceMs = 0, initial = '', anchor = null }) {
        this.close();
        const input = el('input', { className: 'palette__input', placeholder, ariaLabel: placeholder, value: initial });
        const list = el('div', { className: 'palette__list', role: 'listbox' });
        const footer = el(
            'div',
            { className: 'palette__footer' },
            el('span', {}, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' navigate'),
            el('span', {}, el('kbd', {}, '↵'), ' open'),
            el('span', {}, el('kbd', {}, 'esc'), ' close'),
        );
        const panel = el(
            'div',
            { className: 'palette', role: 'dialog', ariaLabel: placeholder },
            el('div', { className: 'palette__prompt' }, el('span', { className: 'palette__sigil' }, sigil), input),
            list,
            footer,
        );
        const backdrop = el('div', { className: 'palette-backdrop' }, panel);
        backdrop.addEventListener('mousedown', (event) => {
            if (event.target === backdrop) this.close();
        });
        document.body.append(backdrop);
        this.element = backdrop;
        if (anchor) {
            backdrop.classList.add('is-anchored');
            this.onResize = () => {
                const rect = anchor.getBoundingClientRect();
                const width = Math.max(0, Math.min(640, rect.width - 32));
                panel.style.width = `${width}px`;
                panel.style.left = `${rect.left + (rect.width - width) / 2}px`;
            };
            this.onResize();
            window.addEventListener('resize', this.onResize);
        }

        let items = [];
        let index = 0;
        const run = (item) => {
            this.close();
            item.run();
        };
        const draw = () => {
            list.replaceChildren(
                ...(items.length
                    ? items.map((item, i) => {
                          const row = el(
                              'button',
                              {
                                  type: 'button',
                                  className: `palette__item${i === index ? ' is-selected' : ''}`,
                                  role: 'option',
                              },
                              el('span', { className: 'palette__icon' }, item.icon || '›'),
                              el(
                                  'span',
                                  { className: 'palette__text' },
                                  el('span', { className: 'palette__label' }, item.label),
                                  item.snippet
                                      ? el('span', { className: 'palette__snippet', innerHTML: item.snippet })
                                      : null,
                              ),
                              item.hint
                                  ? el('kbd', {}, item.hint)
                                  : el('span', { className: 'eyebrow' }, item.kind || ''),
                          );
                          row.addEventListener('click', () => run(item));
                          row.addEventListener('mousemove', () => {
                              if (index !== i) {
                                  index = i;
                                  draw();
                              }
                          });
                          return row;
                      })
                    : [el('div', { className: 'palette__empty' }, input.value ? 'No results' : 'Type to search')]),
            );
            list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
        };
        const refresh = async () => {
            const seq = ++this.seq;
            const results = await source(input.value.trim());
            if (seq !== this.seq || !this.element) return;
            items = results;
            index = 0;
            draw();
        };
        let timer;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(refresh, debounceMs);
        });
        input.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                index = Math.min(items.length - 1, index + 1);
                draw();
            } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                index = Math.max(0, index - 1);
                draw();
            } else if (event.key === 'Enter' && items[index]) {
                event.preventDefault();
                run(items[index]);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                this.close();
            }
        });
        input.focus();
        await refresh();
    }
}
