import { describe, expect, it } from 'vitest';
import { folderMoves, movedPath, notePathFrom, relativePath, rewriteLinks, taskLines } from '../../js/vault/app.js';
import { canDrop } from '../../js/vault/tree.js';
import { applyTemplate, dailyPath, detectDaily, formatDate, patternRegExp } from '../../js/vault/daily.js';
import { NoteEditor, continuation, toggleTaskLine } from '../../js/vault/editor.js';
import { LinkIndex } from '../../js/vault/links.js';

const nov21 = new Date(2026, 10, 21, 9, 5);

describe('daily notes', () => {
    it('formats moment-style patterns', () => {
        expect(formatDate(nov21, 'YYYY-MM-DD')).toBe('2026-11-21');
        expect(formatDate(nov21, 'MMM-YY/DMMMYY')).toBe('Nov-26/21Nov26');
        expect(formatDate(new Date(2026, 0, 5), 'DD-MM-YYYY dddd [week]')).toBe('05-01-2026 Monday week');
    });

    it('matches existing files against a pattern', () => {
        expect(patternRegExp('MMM-YY/DMMMYY').test('Nov-25/12Nov25')).toBe(true);
        expect(patternRegExp('MMM-YY/DMMMYY').test('Jan-24/Jan Retro')).toBe(false);
        expect(patternRegExp('YYYY-MM-DD').test('2026-11-21')).toBe(true);
    });

    it('trusts the files over Obsidian settings when they disagree', () => {
        const paths = ['Worklog/Nov-25/11Nov25.md', 'Worklog/Nov-25/12Nov25.md', 'Worklog/Jan-24/9Jan24.md', 'Worklog/Jan-24/Jan Retro.md', 'Other.md'];
        const daily = detectDaily(paths, { folder: 'Worklog', format: 'DD-MM-YYYY' });
        expect(daily).toEqual({ folder: 'Worklog', format: 'MMM-YY/DMMMYY', template: null });
        expect(dailyPath(nov21, daily)).toBe('Worklog/Nov-26/21Nov26.md');
    });

    it('falls back to settings, then ISO dates', () => {
        expect(detectDaily([], { folder: '/Journal/', format: 'DD-MM-YYYY', template: 'Templates/Day' })).toEqual({
            folder: 'Journal',
            format: 'DD-MM-YYYY',
            template: 'Templates/Day',
        });
        expect(dailyPath(nov21, detectDaily([], {}))).toBe('2026-11-21.md');
    });

    it('fills Obsidian template variables', () => {
        expect(applyTemplate('# {{title}}\n{{date}} · {{date:dddd}} · {{time}}', { date: nov21, title: 'Day' })).toBe(
            '# Day\n2026-11-21 · Saturday · 09:05',
        );
    });
});

describe('editor helpers', () => {
    it('continues lists, numbering and tasks', () => {
        expect(continuation('- item')).toEqual({ insert: '\n- ' });
        expect(continuation('\t* nested')).toEqual({ insert: '\n\t* ' });
        expect(continuation('9. ninth')).toEqual({ insert: '\n10. ' });
        expect(continuation('- [x] done')).toEqual({ insert: '\n- [ ] ' });
        expect(continuation('> quoted')).toEqual({ insert: '\n> ' });
        expect(continuation('plain text')).toBeNull();
    });

    it('ends a list on an empty item, or moves up a level when nested', () => {
        expect(continuation('- ')).toEqual({ replace: '' });
        expect(continuation('\t- [ ] ')).toEqual({ replace: '- [ ] ' });
        expect(continuation('> ')).toEqual({ replace: '' });
    });

    it('toggles tasks', () => {
        expect(toggleTaskLine('- [ ] a')).toBe('- [x] a');
        expect(toggleTaskLine('- [x] a')).toBe('- [ ] a');
        expect(toggleTaskLine('- a')).toBe('- [ ] a');
        expect(toggleTaskLine('  write it')).toBe('  - [ ] write it');
    });

    it('saves edits, flushes on demand, and offers [[link suggestions', async () => {
        const saved = [];
        const editor = new NoteEditor({
            text: 'hello',
            onChange: (text) => saved.push(text),
            suggest: async (query) => [{ label: `Plan ${query}`, insert: 'Projects/Plan' }],
            saveDelay: 10_000,
        });
        document.body.append(editor.element);
        const area = editor.textarea;
        area.value = 'hello [[pl';
        area.setSelectionRange(area.value.length, area.value.length);
        area.dispatchEvent(new Event('input'));
        expect(editor.dirty).toBe(true);
        editor.flush();
        expect(saved).toEqual(['hello [[pl']);
        await new Promise((r) => setTimeout(r, 0));
        expect(editor.suggestionsOpen).toBe(true);
        area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(area.value).toBe('hello [[Projects/Plan]]');
        editor.flush();
        expect(saved.at(-1)).toBe('hello [[Projects/Plan]]');
        editor.element.remove();
    });

    it('wraps the selection in bold and continues lists on Enter', () => {
        const editor = new NoteEditor({ text: '- one', onChange: () => {} });
        document.body.append(editor.element);
        const area = editor.textarea;
        area.setSelectionRange(2, 5);
        area.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
        expect(area.value).toBe('- **one**');
        area.setSelectionRange(area.value.length, area.value.length);
        area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(area.value).toBe('- **one**\n- ');
        editor.element.remove();
    });
});

describe('note operations', () => {
    it('finds task lines outside code blocks, including in callouts', () => {
        const text = '- [ ] a\ntext\n```\n- [ ] not a task\n```\n> - [x] quoted\n\t1. [/] doing';
        expect(taskLines(text)).toEqual([0, 5, 6]);
    });

    it('validates note names', () => {
        expect(notePathFrom(' Folder / My note ')).toBe('Folder/My note.md');
        expect(notePathFrom('Plan.md')).toBe('Plan.md');
        expect(() => notePathFrom('a:b')).toThrow(/can't be used/);
        expect(() => notePathFrom('.hidden')).toThrow();
        expect(() => notePathFrom('  ')).toThrow(/name/);
    });

    it('rewrites links after a rename, keeping headings and aliases', () => {
        const paths = ['A/Plan.md', 'B/Plan.md', 'Notes.md'];
        const before = new LinkIndex(paths);
        const after = new LinkIndex(['A/Roadmap.md', 'B/Plan.md', 'Notes.md']);
        const text = 'See [[A/Plan#Goals|the plan]] and ![[A/Plan]] but not [[B/Plan]] or [[Other]].';
        expect(rewriteLinks(text, 'Notes.md', { before, after, from: 'A/Plan.md', to: 'A/Roadmap.md' })).toBe(
            'See [[Roadmap#Goals|the plan]] and ![[Roadmap]] but not [[B/Plan]] or [[Other]].',
        );
        expect(rewriteLinks('nothing here', 'Notes.md', { before, after, from: 'A/Plan.md', to: 'A/Roadmap.md' })).toBeNull();
    });

    it('keeps every kind of link working when a folder moves', () => {
        const paths = ['Projects/Plan.md', 'Projects/img/chart.png', 'Projects/Spec.md', 'Index.md', 'Other/Plan.md'];
        const moves = new Map(folderMoves(paths, 'Projects', 'Archive/Projects').map((m) => [m.from, m.to]));
        expect(moves.get('Projects/img/chart.png')).toBe('Archive/Projects/img/chart.png');
        const before = new LinkIndex(paths);
        const after = new LinkIndex(paths.map((p) => moves.get(p) ?? p));
        const index = [
            '[[Projects/Plan#Goals|plan]] [[Spec]] ![[chart.png]] [[Other/Plan]]',
            '[spec](Projects/Spec.md#top) ![c](<Projects/img/chart.png>) [web](https://x.dev/a.md)',
        ].join('\n');
        expect(rewriteLinks(index, 'Index.md', { before, after, moves })).toBe(
            [
                '[[Archive/Projects/Plan#Goals|plan]] [[Spec]] ![[chart.png]] [[Other/Plan]]',
                '[spec](Archive/Projects/Spec.md#top) ![c](<Archive/Projects/img/chart.png>) [web](https://x.dev/a.md)',
            ].join('\n'),
        );
        // A moved note linking out of the folder by relative path.
        const spec = '[home](../Index.md) [plan](Plan.md) ![](img/chart.png)';
        expect(rewriteLinks(spec, 'Projects/Spec.md', { before, after, moves, newPath: 'Archive/Projects/Spec.md' })).toBe(
            '[home](../../Index.md) [plan](Plan.md) ![](img/chart.png)',
        );
    });

    it('writes markdown links Obsidian-style', () => {
        expect(relativePath('A/B/Note.md', 'A/C/My file.md')).toBe('../C/My file.md');
        expect(relativePath('Note.md', 'X/Y.md')).toBe('X/Y.md');
        const before = new LinkIndex(['Old/My note.md', 'Index.md']);
        const after = new LinkIndex(['New/My note.md', 'Index.md']);
        const moves = new Map([['Old/My note.md', 'New/My note.md']]);
        expect(rewriteLinks('[n](Old/My%20note.md "title")', 'Index.md', { before, after, moves })).toBe(
            '[n](New/My%20note.md "title")',
        );
    });

    it('only allows drops somewhere new', () => {
        expect(movedPath('A/Note.md', 'B')).toBe('B/Note.md');
        expect(movedPath('A/Note.md', '')).toBe('Note.md');
        expect(canDrop({ path: 'A/Note.md' }, 'A')).toBe(false);
        expect(canDrop({ path: 'A/Note.md' }, '')).toBe(true);
        expect(canDrop({ folder: 'A' }, 'A/B')).toBe(false);
        expect(canDrop({ folder: 'A/B' }, 'A')).toBe(false);
        expect(canDrop({ folder: 'A/B' }, '')).toBe(true);
        expect(canDrop({ folder: 'A' }, 'AB')).toBe(true);
    });
});
