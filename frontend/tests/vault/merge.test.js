import { describe, expect, it } from 'vitest';
import { gitBlobSha, matchLines, merge3 } from '../../js/vault/merge.js';

describe('matchLines', () => {
    it('matches common lines in order', () => {
        expect(matchLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd'])).toEqual([0, -1, 2, 3]);
        expect(matchLines(['a', 'b'], [])).toEqual([-1, -1]);
    });
});

describe('merge3', () => {
    const base = ['# Plan', '', 'one', 'two', 'three', '', 'end'].join('\n');

    it('takes whichever side changed', () => {
        expect(merge3(base, base, 'x')).toEqual({ text: 'x', conflicts: 0 });
        expect(merge3(base, 'y', base)).toEqual({ text: 'y', conflicts: 0 });
        expect(merge3(base, 'same', 'same')).toEqual({ text: 'same', conflicts: 0 });
    });

    it('combines edits to different lines', () => {
        const ours = base.replace('one', 'ONE');
        const theirs = base.replace('three', 'THREE') + '\nappended';
        expect(merge3(base, ours, theirs)).toEqual({
            text: ['# Plan', '', 'ONE', 'two', 'THREE', '', 'end', 'appended'].join('\n'),
            conflicts: 0,
        });
    });

    it('combines an insertion with a deletion elsewhere', () => {
        const ours = base.replace('two\n', '');
        const theirs = base.replace('# Plan', '# Plan\nnew intro');
        expect(merge3(base, ours, theirs).text).toBe(['# Plan', 'new intro', '', 'one', 'three', '', 'end'].join('\n'));
    });

    it('keeps ours where both changed the same lines', () => {
        const ours = base.replace('two', 'two (mine)');
        const theirs = base.replace('two', 'two (theirs)').replace('end', 'END');
        expect(merge3(base, ours, theirs)).toEqual({
            text: ['# Plan', '', 'one', 'two (mine)', 'three', '', 'END'].join('\n'),
            conflicts: 1,
        });
    });

    it('does not duplicate identical additions on both sides', () => {
        const ours = `${base}\n- [ ] task`;
        const theirs = `${base}\n- [ ] task`;
        expect(merge3(base, ours, theirs)).toEqual({ text: ours, conflicts: 0 });
        const both = merge3(base, `${base}\nmine`, `x\n${base}\ntheirs`);
        expect(both.text.startsWith('x\n# Plan')).toBe(true);
        expect(both.conflicts).toBe(1);
    });
});

describe('gitBlobSha', () => {
    it('matches git hash-object', async () => {
        // printf 'hello\n' | git hash-object --stdin
        expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
        expect(await gitBlobSha('')).toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
    });
});
