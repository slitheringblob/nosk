import * as markedLib from 'marked';
import { beforeAll, describe, expect, it } from 'vitest';
import { folderHref, parseRepo, parseRoute } from '../../js/vault/app.js';
import { LinkIndex, outgoingLinks } from '../../js/vault/links.js';
import { VaultSearch } from '../../js/vault/search.js';
import { VaultTree, buildTree } from '../../js/vault/tree.js';

beforeAll(() => {
    window.marked = markedLib;
});

const files = [
    { path: 'Home.md', kind: 'note', text: 'Welcome. See [[Plan]].' },
    { path: 'Projects/Plan.md', kind: 'note', text: '---\ntags: [work]\n---\nThe plan for #launch. Rocket rocket.' },
    { path: 'Projects/Ideas/idea 2.md', kind: 'note', text: 'Rocket fuel? [plan](../Plan.md)' },
    { path: 'Projects/Ideas/idea 10.md', kind: 'note', text: 'Nothing here' },
    { path: 'Projects/diagram.png', kind: 'image' },
    { path: '.obsidian/daily-notes.json', kind: 'config', text: '{}' },
];
const fakeStore = { allFiles: async () => files };

describe('buildTree', () => {
    it('nests files under their folders', () => {
        const root = buildTree(files.slice(0, 5));
        expect(root.files.map((f) => f.path)).toEqual(['Home.md']);
        const projects = root.folders.get('Projects');
        expect(projects.path).toBe('Projects');
        expect(projects.folders.get('Ideas').files).toHaveLength(2);
    });
});

describe('VaultTree', () => {
    const setup = () => {
        localStorage.clear();
        const list = document.createElement('nav');
        const filterInput = document.createElement('input');
        const tree = new VaultTree({ list, filterInput });
        tree.setFiles(files);
        return { tree, list, filterInput };
    };

    it('shows folders first, closed, and hides config files', () => {
        const { list } = setup();
        const rows = [...list.children].map((row) => row.textContent);
        expect(rows[0]).toContain('Projects');
        expect(rows[1]).toContain('Home');
        expect(list.textContent).not.toContain('daily-notes');
        expect(list.querySelector('[data-path="Projects/Plan.md"]')).toBeNull();
    });

    it('unfolds ancestors of the active file and sorts numbers naturally', () => {
        const { tree, list } = setup();
        tree.setActive('Projects/Ideas/idea 10.md');
        const names = [...list.querySelectorAll('.tree-file')].map((a) => a.dataset.path);
        expect(names).toEqual([
            'Projects/Ideas/idea 2.md',
            'Projects/Ideas/idea 10.md',
            'Projects/diagram.png',
            'Projects/Plan.md',
            'Home.md',
        ]);
        expect(list.querySelector('.is-active').dataset.path).toBe('Projects/Ideas/idea 10.md');
    });

    it('filters to a flat list of matches', () => {
        const { tree, list, filterInput } = setup();
        filterInput.value = 'idea';
        tree.render();
        expect([...list.querySelectorAll('.tree-file')].map((a) => a.dataset.path)).toEqual([
            'Projects/Ideas/idea 2.md',
            'Projects/Ideas/idea 10.md',
        ]);
    });
});

describe('VaultSearch', () => {
    const search = new VaultSearch(fakeStore);

    it('matches every term and ranks title hits first', async () => {
        const results = await search.fullText('rocket');
        expect(results.map((r) => r.path)).toEqual(['Projects/Plan.md', 'Projects/Ideas/idea 2.md']);
        expect(results[0].snippet).toContain('<mark>Rocket</mark>');
        expect(await search.fullText('rocket fuel')).toHaveLength(1);
        expect((await search.fullText('plan'))[0].path).toBe('Projects/Plan.md');
    });

    it('filters by #tag from frontmatter or body', async () => {
        expect((await search.fullText('#work')).map((r) => r.path)).toEqual(['Projects/Plan.md']);
        expect((await search.fullText('#launch rocket')).map((r) => r.path)).toEqual(['Projects/Plan.md']);
        expect(await search.tags()).toEqual([
            ['launch', 1],
            ['work', 1],
        ]);
    });

    it('finds files by name for the quick switcher', async () => {
        expect((await search.files('idea')).map((f) => f.path)).toEqual([
            'Projects/Ideas/idea 2.md',
            'Projects/Ideas/idea 10.md',
        ]);
        expect(await search.files('daily')).toEqual([]);
    });

    it('lists backlinks from wikilinks and markdown links', async () => {
        const links = new LinkIndex(files.map((f) => f.path));
        const hits = await search.backlinks('Projects/Plan.md', links, outgoingLinks);
        expect(hits.map((h) => h.path)).toEqual(['Home.md', 'Projects/Ideas/idea 2.md']);
    });
});

describe('app helpers', () => {
    it('parses repo references', () => {
        expect(parseRepo('me/my-vault')).toEqual({ owner: 'me', repo: 'my-vault' });
        expect(parseRepo('https://github.com/me/my-vault.git')).toEqual({
            owner: 'me',
            repo: 'my-vault',
        });
        expect(parseRepo('git@github.com:me/my-vault.git')).toEqual({
            owner: 'me',
            repo: 'my-vault',
        });
        expect(parseRepo('nonsense')).toBeNull();
    });

    it('parses routes', () => {
        expect(parseRoute('#/n/Projects%2FPlan.md?h=Goals')).toEqual({
            name: 'note',
            path: 'Projects/Plan.md',
            fragment: 'Goals',
        });
        expect(parseRoute('#/tag/work')).toEqual({ name: 'tag', tag: 'work' });
        expect(parseRoute('#/f/Projects%2FIdeas')).toEqual({ name: 'folder', path: 'Projects/Ideas' });
        expect(folderHref('Projects/Ideas')).toBe('#/f/Projects%2FIdeas');
        expect(folderHref('')).toBe('#/');
        expect(parseRoute('')).toEqual({ name: 'home' });
    });
});
