import { api, NetworkError } from './api-client.js';
import { el, escapeHTML } from './utils.js';

/**
 * Cmd/Ctrl+K quick actions (jump to page, run a command) and Cmd/Ctrl+F search across all page
 * content. Search uses the server and falls back to local titles and text when offline.
 */
export class CommandPalette {
    constructor({ storage, onOpenPage, commands }) {
        this.storage = storage;
        this.onOpenPage = onOpenPage;
        this.commands = commands;
        this.element = null;
        this.searchSeq = 0;
    }

    close() {
        this.element?.remove();
        this.element = null;
    }

    async open(mode = 'actions') {
        this.close();
        const input = el('input', {
            className: 'palette__input',
            placeholder: mode === 'search' ? 'Search all pages…' : 'Jump to a page or run a command…',
            ariaLabel: 'Command palette',
        });
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
            { className: 'palette', role: 'dialog', ariaLabel: 'Command palette' },
            el(
                'div',
                { className: 'palette__prompt' },
                el('span', { className: 'palette__sigil' }, mode === 'search' ? '?' : '>'),
                input,
            ),
            list,
            footer,
        );
        const backdrop = el('div', { className: 'palette-backdrop' }, panel);
        backdrop.addEventListener('mousedown', (event) => {
            if (event.target === backdrop) this.close();
        });
        document.body.append(backdrop);
        this.element = backdrop;

        let items = [];
        let index = 0;
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
        const run = (item) => {
            this.close();
            item.run();
        };
        const refresh = async () => {
            const query = input.value.trim();
            const seq = ++this.searchSeq;
            const results = mode === 'search' ? await this.search(query) : await this.actions(query);
            if (seq !== this.searchSeq || !this.element) return;
            items = results;
            index = 0;
            draw();
        };
        let timer;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(refresh, mode === 'search' ? 180 : 0);
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

    pageItem(page, extra = {}) {
        return {
            icon: page.icon || '📄',
            label: page.title || 'Untitled',
            kind: page.role && page.role !== 'owner' ? 'shared' : page.is_template ? 'template' : 'page',
            run: () => this.onOpenPage(page.id, extra.componentId),
            ...extra,
        };
    }

    async actions(query) {
        const q = query.toLowerCase();
        const pages = (await this.storage.getPages())
            .filter((page) => !page.deleted && page.title.toLowerCase().includes(q))
            .sort((a, b) => b.updated_at - a.updated_at)
            .slice(0, 8)
            .map((page) => this.pageItem(page));
        const commands = this.commands()
            .filter((command) => command.label.toLowerCase().includes(q))
            .map((command) => ({ ...command, kind: 'command' }));
        return q ? [...pages, ...commands] : [...commands.slice(0, 6), ...pages];
    }

    async search(query) {
        if (!query) return [];
        try {
            const { results } = await api.get('/api/search', { q: query, limit: 30 });
            const pages = new Map((await this.storage.getPages()).map((page) => [page.id, page]));
            return results.map((result) =>
                this.pageItem(
                    pages.get(result.page_id) || { id: result.page_id, title: result.title, icon: result.icon },
                    {
                        componentId: result.component_id,
                        snippet: result.snippet ? this.highlight(result.snippet, query) : '',
                    },
                ),
            );
        } catch (error) {
            if (!(error instanceof NetworkError)) throw error;
            return this.localSearch(query);
        }
    }

    async localSearch(query) {
        const q = query.toLowerCase();
        const results = [];
        for (const page of await this.storage.getPages()) {
            if (page.deleted) continue;
            if (page.title.toLowerCase().includes(q)) {
                results.push(this.pageItem(page));
                continue;
            }
            const components = await this.storage.getComponents(page.id);
            for (const component of components) {
                const text = JSON.stringify(component.content).replace(/<[^>]+>/g, '');
                const at = text.toLowerCase().indexOf(q);
                if (at >= 0) {
                    results.push(
                        this.pageItem(page, {
                            componentId: component.id,
                            snippet: this.highlight(text.slice(Math.max(0, at - 40), at + 60), query),
                        }),
                    );
                    break;
                }
            }
            if (results.length >= 30) break;
        }
        return results;
    }

    highlight(text, query) {
        const safe = escapeHTML(text);
        const pattern = new RegExp(escapeHTML(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        return safe.replace(pattern, (match) => `<mark>${match}</mark>`);
    }
}
