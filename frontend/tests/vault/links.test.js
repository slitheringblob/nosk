import { describe, expect, it } from 'vitest';
import { LinkIndex, displayName, outgoingLinks, parseLinkTarget } from '../../js/vault/links.js';

const paths = [
    'Home.md',
    'Worklog/Nov-25/12Nov25.md',
    'Projects/Alpha/Plan.md',
    'Projects/Beta/Plan.md',
    'Projects/Beta/Notes.md',
    'attachments/diagram one.png',
    'Projects/Beta/diagram one.png',
];
const index = new LinkIndex(paths);

describe('parseLinkTarget', () => {
    it('splits heading and alias', () => {
        expect(parseLinkTarget('Plan#Goals|the plan')).toEqual({
            target: 'Plan',
            fragment: 'Goals',
            alias: 'the plan',
        });
        expect(parseLinkTarget('#Local')).toEqual({ target: '', fragment: 'Local', alias: null });
    });
});

describe('LinkIndex.resolveWikilink', () => {
    it('finds notes by name anywhere, case-insensitively', () => {
        expect(index.resolveWikilink('12nov25', 'Home.md')).toBe('Worklog/Nov-25/12Nov25.md');
        expect(index.resolveWikilink('home', 'x.md')).toBe('Home.md');
    });

    it('prefers a note in the same folder when names collide', () => {
        expect(index.resolveWikilink('Plan', 'Projects/Beta/Notes.md')).toBe('Projects/Beta/Plan.md');
        expect(index.resolveWikilink('Alpha/Plan', 'Home.md')).toBe('Projects/Alpha/Plan.md');
    });

    it('resolves attachments with their extension', () => {
        expect(index.resolveWikilink('diagram one.png', 'Home.md')).toBe('attachments/diagram one.png');
        expect(index.resolveWikilink('diagram one.png', 'Projects/Beta/Notes.md')).toBe(
            'Projects/Beta/diagram one.png',
        );
    });

    it('returns null for missing notes and the source note for bare #heading links', () => {
        expect(index.resolveWikilink('Nope', 'Home.md')).toBeNull();
        expect(index.resolveWikilink('', 'Home.md')).toBe('Home.md');
    });
});

describe('LinkIndex.resolveHref', () => {
    it('resolves relative, encoded markdown links', () => {
        expect(index.resolveHref('../Alpha/Plan.md', 'Projects/Beta/Notes.md')).toBe('Projects/Alpha/Plan.md');
        expect(index.resolveHref('attachments/diagram%20one.png', 'Home.md')).toBe('attachments/diagram one.png');
        expect(index.resolveHref('Plan.md#Goals', 'Projects/Alpha/x.md')).toBe('Projects/Alpha/Plan.md');
    });

    it('ignores external links and anchors', () => {
        expect(index.resolveHref('https://example.com/Plan.md', 'Home.md')).toBeNull();
        expect(index.resolveHref('#top', 'Home.md')).toBeNull();
    });
});

describe('helpers', () => {
    it('names files like Obsidian', () => {
        expect(displayName('a/b/Note.md')).toBe('Note');
        expect(displayName('a/pic.png')).toBe('pic.png');
    });

    it('lists outgoing links outside code', () => {
        const links = outgoingLinks('See [[Plan#x|p]] and ![[pic.png]] and [n](Notes.md)\n```\n[[Hidden]]\n```');
        expect(links).toEqual([
            { kind: 'wiki', target: 'Plan' },
            { kind: 'wiki', target: 'pic.png' },
            { kind: 'href', target: 'Notes.md' },
        ]);
    });
});
