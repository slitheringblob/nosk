import * as markedLib from 'marked';
import { beforeAll, describe, expect, it } from 'vitest';
import { LinkIndex } from '../../js/vault/links.js';
import { hydrate, noteTags, parseFrontmatter, renderNote, sectionOf, splitFrontmatter } from '../../js/vault/render.js';

const links = new LinkIndex(['Home.md', 'Projects/Plan.md', 'img/pic.png', 'docs/spec.pdf']);
const render = (text, path = 'Home.md') => {
    const root = document.createElement('div');
    root.innerHTML = renderNote(text, { path, links }).html;
    return root;
};

beforeAll(() => {
    window.marked = markedLib;
});

describe('frontmatter', () => {
    it('parses scalars and both list styles', () => {
        const { data, body } = splitFrontmatter(
            '---\ntitle: "Hi"\ntags: [a, b]\naliases:\n  - one\n  - two\nempty:\n---\n# Body',
        );
        expect(data).toEqual({ title: 'Hi', tags: ['a', 'b'], aliases: ['one', 'two'], empty: '' });
        expect(body).toBe('# Body');
    });

    it('leaves notes without frontmatter alone', () => {
        expect(splitFrontmatter('no --- here').body).toBe('no --- here');
        expect(parseFrontmatter('k: v')).toEqual({ k: 'v' });
    });

    it('collects tags from frontmatter and body, skipping code and headings', () => {
        const tags = noteTags(
            '---\ntags: [work]\n---\n# Heading\nsome #idea and #nested/tag `#notatag`\n```\n#nope\n```\nissue #123',
        );
        expect(tags.sort()).toEqual(['idea', 'nested/tag', 'work']);
    });
});

describe('renderNote', () => {
    it('turns wikilinks into routes and marks missing ones', () => {
        const root = render('Go to [[Plan|the plan]] or [[Missing]]');
        const [good, bad] = root.querySelectorAll('a.wikilink');
        expect(good.getAttribute('href')).toBe('#/n/Projects%2FPlan.md');
        expect(good.textContent).toBe('the plan');
        expect(bad.classList.contains('is-unresolved')).toBe(true);
        expect(bad.hasAttribute('href')).toBe(false);
    });

    it('embeds images and notes', () => {
        const root = render('![[pic.png|200]]\n\n![[Plan#Goals]]\n\n![[spec.pdf]]');
        const img = root.querySelector('img.vault-img');
        expect(img.dataset.vaultSrc).toBe('img/pic.png');
        expect(img.getAttribute('width')).toBe('200');
        expect(img.hasAttribute('src')).toBe(false);
        const embed = root.querySelector('.note-embed');
        expect(embed.dataset.embed).toBe('Projects/Plan.md');
        expect(embed.dataset.fragment).toBe('Goals');
        expect(root.querySelector('.wikilink--file').getAttribute('href')).toBe('#/n/docs%2Fspec.pdf');
    });

    it('resolves relative markdown links and images', () => {
        const root = render('[plan](Projects/Plan.md) ![p](img/pic.png) [ext](https://example.com)');
        expect(root.querySelector('a.wikilink').getAttribute('href')).toBe('#/n/Projects%2FPlan.md');
        expect(root.querySelector('img').dataset.vaultSrc).toBe('img/pic.png');
        const external = root.querySelector('a[href^="https"]');
        expect(external.target).toBe('_blank');
        expect(external.rel).toContain('noopener');
    });

    it('handles highlights, tags, comments, block ids and math', () => {
        const root = render(
            '==bright== #tag %%secret%% text ^abc123\n\n%%\nblock comment\n%%\n\n$$\nx^2\n$$\n\ncost $5 and $10, inline $a+b$',
        );
        expect(root.querySelector('mark').textContent).toBe('bright');
        expect(root.querySelector('a.tag').getAttribute('href')).toBe('#/tag/tag');
        expect(root.textContent).not.toContain('secret');
        expect(root.textContent).not.toContain('block comment');
        expect(root.textContent).not.toContain('^abc123');
        expect(root.querySelector('[data-block-id]').dataset.blockId).toBe('abc123');
        expect(root.querySelector('.math-block').dataset.tex).toBe('x^2');
        expect([...root.querySelectorAll('.math-inline')].map((n) => n.dataset.tex)).toEqual(['a+b']);
        expect(root.textContent).toContain('cost $5 and $10');
    });

    it('does not parse Obsidian syntax inside code', () => {
        const root = render('`[[Plan]] #tag`\n\n```js\nconst x = "[[Plan]]"; // #tag\n```');
        expect(root.querySelector('a')).toBeNull();
        expect(root.querySelectorAll('code')[0].textContent).toBe('[[Plan]] #tag');
    });

    it('sanitizes raw HTML', () => {
        const root = render(
            '<script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a><style>body{}</style>',
        );
        expect(root.querySelector('script, style')).toBeNull();
        expect(root.querySelector('img').hasAttribute('onerror')).toBe(false);
        expect(root.querySelector('a').getAttribute('href')).toBeNull();
    });

    it('extracts a heading section for embeds', () => {
        const body = '# A\none\n## Goals\ntwo\n### Sub\nthree\n## Next\nfour';
        expect(sectionOf(body, 'goals')).toBe('## Goals\ntwo\n### Sub\nthree');
        expect(sectionOf(body, 'missing')).toBe(body);
    });
});

describe('hydrate', () => {
    it('upgrades callouts, including foldable ones', async () => {
        const root = render('> [!warning] Careful now\n> body **text**\n\n> [!tip]- Hidden\n> folded\n\n> plain quote');
        await hydrate(root, { path: 'Home.md', links });
        const [warning, tip] = root.querySelectorAll('.callout');
        expect(warning.dataset.callout).toBe('warning');
        expect(warning.dataset.color).toBe('amber');
        expect(warning.querySelector('.callout__title').textContent).toBe('Careful now');
        expect(warning.querySelector('.callout__content strong').textContent).toBe('text');
        expect(tip.tagName).toBe('DETAILS');
        expect(tip.open).toBe(false);
        expect(tip.querySelector('summary').textContent).toBe('Hidden');
        expect(root.querySelectorAll('blockquote')).toHaveLength(1);
    });

    it('marks tasks, including Obsidian task states', async () => {
        const root = render('- [ ] open\n- [x] done\n- [/] doing\n- [-] dropped\n- plain');
        await hydrate(root, { path: 'Home.md', links });
        const items = [...root.querySelectorAll('li')];
        expect(items.map((li) => li.classList.contains('task'))).toEqual([true, true, true, true, false]);
        expect(items[1].classList.contains('is-done')).toBe(true);
        expect(items[2].classList.contains('task--doing')).toBe(true);
        expect(items[3].querySelector('.task__marker').textContent).toBe('[-]');
        expect(items[3].textContent).toBe('[-]dropped');
    });

    it('loads vault images through sync and embeds notes', async () => {
        const sync = {
            blobUrl: async (path) => `blob:${path}`,
            text: async (path) =>
                path === 'Projects/Plan.md' ? '---\na: 1\n---\n# Intro\nskip\n## Goals\n**win**' : null,
        };
        const root = render('![[pic.png]]\n\n![[Plan#Goals]]');
        await hydrate(root, { path: 'Home.md', links, sync });
        expect(root.querySelector('img').getAttribute('src')).toBe('blob:img/pic.png');
        const embed = root.querySelector('.note-embed');
        expect(embed.querySelector('.note-embed__title').getAttribute('href')).toBe('#/n/Projects%2FPlan.md?h=Goals');
        expect(embed.querySelector('strong').textContent).toBe('win');
        expect(embed.textContent).not.toContain('skip');
    });

    it('flags images that are not available', async () => {
        const root = render('![[pic.png]]');
        await hydrate(root, {
            path: 'Home.md',
            links,
            sync: {
                blobUrl: async () => {
                    throw new Error('offline');
                },
            },
        });
        expect(root.querySelector('img').classList.contains('is-missing')).toBe(true);
    });
});
