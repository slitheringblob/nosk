import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubError, OfflineError } from '../../js/vault/github.js';
import { VaultStore } from '../../js/vault/store.js';
import { VaultSync, isTracked, kindOf } from '../../js/vault/sync.js';

const encoder = new TextEncoder();

/** In-memory stand-in for the GitHub client: a head sha and a set of files. */
function fakeGitHub(files, head = 'c1') {
    const gh = {
        head,
        files,
        calls: [],
        fail: null,
        async headCommit(branch) {
            gh.calls.push(['head', branch]);
            if (gh.fail) throw gh.fail;
            return gh.head;
        },
        async listFiles(sha) {
            gh.calls.push(['tree', sha]);
            return Object.entries(gh.files).map(([path, text]) => ({ path, sha: `sha:${text}`, size: text.length }));
        },
        async blob(sha) {
            gh.calls.push(['blob', sha]);
            if (gh.failBlob === sha) throw new OfflineError(new Error('dropped'));
            return encoder.encode(sha.slice(4)).buffer;
        },
    };
    return gh;
}

let n = 0;
let store;
beforeEach(() => {
    store = new VaultStore(`test-vault-${(n += 1)}`);
});

describe('file kinds', () => {
    it('classifies paths and hides Obsidian internals', () => {
        expect(kindOf('a/Note.md')).toBe('note');
        expect(kindOf('pic.PNG')).toBe('image');
        expect(kindOf('x.canvas')).toBe('text');
        expect(kindOf('doc.pdf')).toBe('pdf');
        expect(kindOf('a.docx')).toBe('file');
        expect(kindOf('.obsidian/daily-notes.json')).toBe('config');
        expect(isTracked('.obsidian/plugins/x/main.js')).toBe(false);
        expect(isTracked('.obsidian/daily-notes.json')).toBe(true);
        expect(isTracked('.trash/old.md')).toBe(false);
        expect(isTracked('Notes/.hidden/x.md')).toBe(false);
    });
});

describe('VaultSync.pull', () => {
    it('downloads text files, skips binaries until viewed, and records the head', async () => {
        const gh = fakeGitHub({ 'A.md': 'alpha', 'pics/p.png': 'PNG', '.obsidian/themes/t.css': 'x' });
        const sync = new VaultSync({ store, github: gh, branch: 'main' });
        const events = [];
        sync.on('changed', (result) => events.push(result));
        await sync.pull();
        const files = await store.allFiles();
        expect(files.map((f) => f.path).sort()).toEqual(['A.md', 'pics/p.png']);
        expect((await store.getFile('A.md')).text).toBe('alpha');
        expect((await store.getFile('pics/p.png')).text).toBeUndefined();
        expect(await store.getMeta('head')).toBe('c1');
        expect(events[0].changed.sort()).toEqual(['A.md', 'pics/p.png']);
        expect(gh.calls.filter(([kind]) => kind === 'blob')).toHaveLength(1);
    });

    it('costs a single request when nothing changed', async () => {
        const gh = fakeGitHub({ 'A.md': 'alpha' });
        const sync = new VaultSync({ store, github: gh, branch: 'main' });
        await sync.pull();
        gh.calls = [];
        const result = await sync.pull();
        expect(gh.calls).toEqual([['head', 'main']]);
        expect(result.changed).toEqual([]);
    });

    it('fetches only changed files and deletes removed ones', async () => {
        const gh = fakeGitHub({ 'A.md': 'alpha', 'B.md': 'beta' });
        const sync = new VaultSync({ store, github: gh, branch: 'main' });
        await sync.pull();
        gh.files = { 'A.md': 'alpha', 'C.md': 'gamma' };
        gh.head = 'c2';
        gh.calls = [];
        const result = await sync.pull();
        expect(result.changed).toEqual(['C.md']);
        expect(result.removed).toEqual(['B.md']);
        expect(gh.calls.filter(([kind]) => kind === 'blob')).toEqual([['blob', 'sha:gamma']]);
        expect((await store.allFiles()).map((f) => f.path).sort()).toEqual(['A.md', 'C.md']);
    });

    it('resumes an interrupted first download without refetching finished files', async () => {
        const gh = fakeGitHub({ 'A.md': 'alpha', 'B.md': 'beta' });
        gh.failBlob = 'sha:beta';
        const sync = new VaultSync({ store, github: gh, branch: 'main', concurrency: 1 });
        await expect(sync.pull()).rejects.toBeInstanceOf(OfflineError);
        expect(sync.state).toBe('offline');
        expect(await store.getMeta('head')).toBeUndefined();
        gh.failBlob = null;
        gh.calls = [];
        await sync.pull();
        expect(gh.calls.filter(([kind]) => kind === 'blob')).toEqual([['blob', 'sha:beta']]);
        expect(await store.getMeta('head')).toBe('c1');
    });

    it('reports an expired token as an auth problem', async () => {
        const gh = fakeGitHub({});
        gh.fail = new GitHubError('Bad credentials', 401);
        const sync = new VaultSync({ store, github: gh, branch: 'main' });
        await expect(sync.pull()).rejects.toBeInstanceOf(GitHubError);
        expect(sync.state).toBe('auth');
    });

    it('shares one run between concurrent pulls', async () => {
        const gh = fakeGitHub({ 'A.md': 'alpha' });
        const sync = new VaultSync({ store, github: gh, branch: 'main' });
        await Promise.all([sync.pull(), sync.pull()]);
        expect(gh.calls.filter(([kind]) => kind === 'head')).toHaveLength(1);
    });
});

describe('VaultSync batched text download', () => {
    it('gets text through blobTexts and falls back per file for anything it skips', async () => {
        const gh = fakeGitHub({ 'A.md': 'alpha', 'B.md': 'beta', 'C.md': 'gamma', 'p.png': 'PNG' });
        gh.blobTexts = async (shas) => {
            gh.calls.push(['texts', shas.length]);
            return new Map(shas.filter((sha) => sha !== 'sha:gamma').map((sha) => [sha, sha.slice(4)]));
        };
        const sync = new VaultSync({ store, github: gh, branch: 'main' });
        await sync.pull();
        expect(gh.calls.filter(([kind]) => kind === 'texts')).toEqual([['texts', 3]]);
        expect(gh.calls.filter(([kind]) => kind === 'blob')).toEqual([['blob', 'sha:gamma']]);
        const texts = Object.fromEntries((await store.allFiles()).map((f) => [f.path, f.text]));
        expect(texts).toEqual({ 'A.md': 'alpha', 'B.md': 'beta', 'C.md': 'gamma', 'p.png': undefined });
    });
});

describe('VaultSync file access', () => {
    it('downloads binaries once and keeps them on the device', async () => {
        const gh = fakeGitHub({ 'p.png': 'PNG' });
        const sync = new VaultSync({ store, github: gh, branch: 'main' });
        await sync.pull();
        globalThis.URL.createObjectURL ??= () => 'blob:fake';
        const url = await sync.blobUrl('p.png');
        expect(url).toBeTruthy();
        expect(await store.getBlob('sha:PNG')).toBeTruthy();
        const fresh = new VaultSync({ store, github: gh, branch: 'main' });
        gh.calls = [];
        await fresh.blobUrl('p.png');
        expect(gh.calls).toEqual([]);
    });

    it('prunes binaries no file points at', async () => {
        await store.putBlob({ sha: 'gone', buffer: new ArrayBuffer(1), type: 'image/png' });
        expect(await store.pruneBlobs()).toBe(1);
    });
});
