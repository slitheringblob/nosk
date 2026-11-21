import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubError, OfflineError } from '../../js/vault/github.js';
import { gitBlobSha } from '../../js/vault/merge.js';
import { VaultStore } from '../../js/vault/store.js';
import { VaultSync, commitMessage, conflictPath } from '../../js/vault/sync.js';

/** A tiny in-memory GitHub: files + head, with createCommitOnBranch semantics. */
function fakeRepo(initial) {
    const repo = {
        files: { ...initial },
        head: 'c0',
        n: 0,
        commits: [],
        offline: false,
        readonly: false,
        async headCommit() {
            if (repo.offline) throw new OfflineError(new Error('x'));
            return repo.head;
        },
        async listFiles() {
            return Promise.all(
                Object.entries(repo.files).map(async ([path, text]) => ({ path, sha: await gitBlobSha(text), size: text.length })),
            );
        },
        async blob(sha) {
            for (const text of Object.values(repo.files)) if ((await gitBlobSha(text)) === sha) return new TextEncoder().encode(text).buffer;
            throw new GitHubError('missing', 404);
        },
        async commit({ expectedHead, message, additions, deletions }) {
            if (repo.offline) throw new OfflineError(new Error('x'));
            if (repo.readonly) throw new GitHubError('Resource not accessible by personal access token', 403);
            if (expectedHead !== repo.head) throw new GitHubError('Expected branch to point to ...', 409);
            for (const { path, text, base64 } of additions)
                repo.files[path] = text ?? new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
            for (const path of deletions) delete repo.files[path];
            repo.head = `c${(repo.n += 1)}`;
            repo.commits.push({ message, additions: additions.map((a) => a.path), deletions });
            return { oid: repo.head, url: 'u' };
        },
        /** Simulate Obsidian pushing a change. */
        external(path, text) {
            if (text === null) delete repo.files[path];
            else repo.files[path] = text;
            repo.head = `c${(repo.n += 1)}`;
        },
    };
    return repo;
}

let n = 0;
let store;
let repo;
let sync;
beforeEach(async () => {
    store = new VaultStore(`push-test-${(n += 1)}`);
    repo = fakeRepo({ 'Note.md': 'line 1\nline 2\nline 3\n', 'Other.md': 'other\n' });
    sync = new VaultSync({ store, github: repo, branch: 'main', pushDelayMs: 1e9 });
    await sync.pull();
});

describe('local edits', () => {
    it('shows edits on the device right away and commits them in one go', async () => {
        await sync.saveLocal('Note.md', 'line 1\nline 2 edited\nline 3\n');
        await sync.saveLocal('New.md', '# New\n');
        await sync.deleteLocal('Other.md');
        expect(sync.pendingCount).toBe(3);
        expect(sync.state).toBe('pending');
        const view = Object.fromEntries((await sync.files()).map((f) => [f.path, f]));
        expect(Object.keys(view).sort()).toEqual(['New.md', 'Note.md']);
        expect(view['Note.md'].dirty).toBe(true);
        expect(await sync.text('Note.md')).toBe('line 1\nline 2 edited\nline 3\n');

        const commit = await sync.push();
        expect(commit.oid).toBe('c1');
        expect(repo.files).toEqual({ 'Note.md': 'line 1\nline 2 edited\nline 3\n', 'New.md': '# New\n' });
        expect(repo.commits[0].message).toBe('nosk: update 3 files\n\nadd New.md\nedit Note.md\ndelete Other.md');
        expect(sync.pendingCount).toBe(0);
        expect(sync.state).toBe('idle');
        // The device now matches GitHub, so the next pull downloads nothing.
        const next = await sync.pull();
        expect(next.changed).toEqual([]);
    });

    it('drops an edit that returns the note to its original text', async () => {
        await sync.saveLocal('Note.md', 'changed');
        await sync.saveLocal('Note.md', 'line 1\nline 2\nline 3\n');
        expect(sync.pendingCount).toBe(0);
        expect(await sync.push()).toBeNull();
    });

    it('creating then deleting a new note leaves nothing to push', async () => {
        await sync.saveLocal('Tmp.md', 'x');
        await sync.deleteLocal('Tmp.md');
        expect(sync.pendingCount).toBe(0);
    });

    it('renames a note and rewrites links in other notes', async () => {
        await sync.renameLocal('Note.md', 'Folder/Renamed.md', [{ path: 'Other.md', text: 'see [[Renamed]]\n' }]);
        await sync.push();
        expect(repo.files).toEqual({ 'Folder/Renamed.md': 'line 1\nline 2\nline 3\n', 'Other.md': 'see [[Renamed]]\n' });
        expect(repo.commits).toHaveLength(1);
        expect(repo.commits[0].message).toContain('move Note.md → Folder/Renamed.md');
    });

    it('moves several files, including a binary, in one commit', async () => {
        repo.external('img/pic.png', 'PNG-BYTES');
        await sync.pull();
        await sync.moveLocal([
            { from: 'Note.md', to: 'Archive/Note.md' },
            { from: 'img/pic.png', to: 'Archive/pic.png' },
        ]);
        const view = new Map((await sync.files()).map((f) => [f.path, f]));
        expect(view.get('Archive/pic.png')).toMatchObject({ kind: 'image', dirty: true });
        expect(view.has('img/pic.png')).toBe(false);
        await sync.push();
        expect(repo.files['Archive/pic.png']).toBe('PNG-BYTES');
        expect(repo.files['Archive/Note.md']).toBe('line 1\nline 2\nline 3\n');
        expect(repo.files['img/pic.png']).toBeUndefined();
        expect(repo.commits).toHaveLength(1);
        expect(repo.commits[0].message).toMatch(/move img\/pic\.png → Archive\/pic\.png/);
        // Afterwards the device's copy matches GitHub: same blob, nothing pending, a pull is a no-op.
        expect((await store.getFile('Archive/pic.png')).sha).toBe(await gitBlobSha('PNG-BYTES'));
        expect(sync.pendingCount).toBe(0);
        expect((await sync.pull()).changed).toEqual([]);
    });

    it('moving a file back where it was leaves nothing to push', async () => {
        await sync.renameLocal('Note.md', 'A/Note.md');
        await sync.renameLocal('A/Note.md', 'Note.md');
        expect(sync.pendingCount).toBe(0);
    });
});

describe('when Obsidian pushed first', () => {
    it('merges edits to different lines and retries the commit', async () => {
        await sync.saveLocal('Note.md', 'line 1 (nosk)\nline 2\nline 3\n');
        repo.external('Note.md', 'line 1\nline 2\nline 3 (obsidian)\n');
        await sync.push();
        expect(repo.files['Note.md']).toBe('line 1 (nosk)\nline 2\nline 3 (obsidian)\n');
        expect(sync.pendingCount).toBe(0);
    });

    it('keeps the local version and saves theirs as a conflict copy when lines overlap', async () => {
        const conflicts = [];
        sync.on('conflict', (e) => conflicts.push(...e.conflicts));
        await sync.saveLocal('Note.md', 'line 1\nline 2 (nosk)\nline 3\n');
        repo.external('Note.md', 'line 1\nline 2 (obsidian)\nline 3\n');
        await sync.push();
        expect(repo.files['Note.md']).toBe('line 1\nline 2 (nosk)\nline 3\n');
        const copy = Object.keys(repo.files).find((p) => p.startsWith('Note (conflict '));
        expect(repo.files[copy]).toBe('line 1\nline 2 (obsidian)\nline 3\n');
        expect(conflicts[0]).toMatchObject({ path: 'Note.md', copy, kept: 'local' });
    });

    it('a pull merges remote changes into an unpushed edit without pushing', async () => {
        await sync.saveLocal('Note.md', 'line 1 (nosk)\nline 2\nline 3\n');
        repo.external('Note.md', 'line 1\nline 2\nline 3\nline 4\n');
        const result = await sync.pull();
        expect(result.merged).toEqual(['Note.md']);
        expect(await sync.text('Note.md')).toBe('line 1 (nosk)\nline 2\nline 3\nline 4\n');
        expect(repo.commits).toHaveLength(0);
    });

    it('keeps a note that was changed on GitHub but deleted here', async () => {
        await sync.deleteLocal('Note.md');
        repo.external('Note.md', 'changed in obsidian\n');
        await sync.pull();
        expect(await sync.text('Note.md')).toBe('changed in obsidian\n');
        expect(sync.pendingCount).toBe(0);
    });

    it('brings back a note edited here but deleted on GitHub', async () => {
        await sync.saveLocal('Note.md', 'still needed\n');
        repo.external('Note.md', null);
        await sync.push();
        expect(repo.files['Note.md']).toBe('still needed\n');
    });
});

describe('failures', () => {
    it('keeps edits on the device while offline and sends them later', async () => {
        await sync.saveLocal('Note.md', 'offline edit\n');
        repo.offline = true;
        await expect(sync.push()).rejects.toBeInstanceOf(OfflineError);
        expect(sync.state).toBe('offline');
        expect(sync.pendingCount).toBe(1);
        repo.offline = false;
        await sync.sync();
        expect(repo.files['Note.md']).toBe('offline edit\n');
    });

    it('reports a token without write access', async () => {
        await sync.saveLocal('Note.md', 'x');
        repo.readonly = true;
        await expect(sync.push()).rejects.toBeInstanceOf(GitHubError);
        expect(sync.state).toBe('readonly');
        expect(sync.pendingCount).toBe(1);
    });

    it('saves typed text via beforeSync before pushing', async () => {
        let typed = 'from the editor\n';
        sync.beforeSync = () => sync.saveLocal('Note.md', typed);
        await sync.push();
        expect(repo.files['Note.md']).toBe('from the editor\n');
        typed = 'from the editor\n';
    });
});

describe('helpers', () => {
    it('names conflict copies next to the original', () => {
        expect(conflictPath('A/Note.md', new Date(2026, 10, 21, 9, 5))).toBe('A/Note (conflict 2026-11-21 09.05).md');
    });

    it('writes short commit messages for single changes', () => {
        expect(commitMessage([{ path: 'A.md' }], [], new Map([['A.md', {}]]))).toBe('nosk: edit A.md');
        expect(commitMessage([], ['B.md'], new Map())).toBe('nosk: delete B.md');
    });
});
