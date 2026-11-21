import { describe, expect, it } from 'vitest';
import { GitHub, GitHubError, OfflineError, toBase64 } from '../../js/vault/github.js';

function fakeFetch(respond) {
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: init.body ? JSON.parse(init.body) : null });
        const { status = 200, json = {}, headers = {} } = respond(url, init) || {};
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: '',
            headers: { get: (name) => headers[name.toLowerCase()] ?? null },
            json: async () => json,
            arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(json)).buffer,
            text: async () => JSON.stringify(json),
        };
    };
    return { fetchImpl, calls };
}

describe('toBase64', () => {
    it('encodes UTF-8, not just Latin-1', () => {
        expect(toBase64('héllo ✓')).toBe(Buffer.from('héllo ✓', 'utf8').toString('base64'));
    });
});

describe('GitHub.request', () => {
    it('sends the token and revalidates instead of trusting the HTTP cache', async () => {
        const { fetchImpl, calls } = fakeFetch(() => ({ json: { object: { sha: 'abc' } } }));
        const gh = new GitHub({ token: 't0k', owner: 'me', repo: 'vault', fetchImpl });
        expect(await gh.headCommit('feature/x')).toBe('abc');
        expect(calls[0].url).toBe('https://api.github.com/repos/me/vault/git/ref/heads/feature/x');
        expect(calls[0].init.headers.Authorization).toBe('Bearer t0k');
        expect(calls[0].init.cache).toBe('no-cache');
    });

    it('maps failures to typed errors', async () => {
        const gh = (respond) =>
            new GitHub({ token: 't', owner: 'o', repo: 'r', fetchImpl: fakeFetch(respond).fetchImpl });
        await expect(gh(() => ({ status: 401, json: { message: 'Bad credentials' } })).getRepo()).rejects.toMatchObject(
            { status: 401, message: 'Bad credentials' },
        );
        await expect(gh(() => ({ status: 403, headers: { 'retry-after': '30' } })).getRepo()).rejects.toMatchObject({
            retryAfter: 30,
            message: expect.stringContaining('rate limit'),
        });
        const offline = new GitHub({
            token: 't',
            owner: 'o',
            repo: 'r',
            fetchImpl: async () => {
                throw new TypeError('Failed to fetch');
            },
        });
        await expect(offline.getRepo()).rejects.toBeInstanceOf(OfflineError);
    });
});

describe('GitHub.blobTexts', () => {
    it('fetches many blobs in one query and skips binary or truncated ones', async () => {
        const a = 'a'.repeat(40);
        const b = 'b'.repeat(40);
        const c = 'c'.repeat(40);
        const { fetchImpl, calls } = fakeFetch(() => ({
            json: {
                data: {
                    repository: {
                        b0: { text: 'hello', isBinary: false, isTruncated: false },
                        b1: { text: null, isBinary: true, isTruncated: false },
                        b2: { text: 'cut', isBinary: false, isTruncated: true },
                    },
                },
            },
        }));
        const gh = new GitHub({ token: 't', owner: 'me', repo: 'vault', fetchImpl });
        const texts = await gh.blobTexts([a, b, c, 'not-a-sha']);
        expect([...texts]).toEqual([[a, 'hello']]);
        expect(calls).toHaveLength(1);
        expect(calls[0].body.query).toContain(`b2: object(oid: "${c}")`);
        expect(calls[0].body.query).not.toContain('not-a-sha');
        expect(calls[0].body.variables).toEqual({ owner: 'me', name: 'vault' });
    });
});

describe('GitHub.commit', () => {
    it('sends one createCommitOnBranch with the expected head', async () => {
        const { fetchImpl, calls } = fakeFetch(() => ({
            json: { data: { createCommitOnBranch: { commit: { oid: 'new', url: 'u' } } } },
        }));
        const gh = new GitHub({ token: 't', owner: 'me', repo: 'vault', fetchImpl });
        const commit = await gh.commit({
            branch: 'main',
            expectedHead: 'old',
            message: 'nosk: edit A.md\n\nfrom phone',
            additions: [{ path: 'A.md', text: '# A ✓' }],
            deletions: ['B.md'],
        });
        expect(commit.oid).toBe('new');
        expect(calls[0].url).toBe('https://api.github.com/graphql');
        expect(calls[0].init.method).toBe('POST');
        const { input } = calls[0].body.variables;
        expect(input).toEqual({
            branch: { repositoryNameWithOwner: 'me/vault', branchName: 'main' },
            expectedHeadOid: 'old',
            message: { headline: 'nosk: edit A.md', body: 'from phone' },
            fileChanges: { additions: [{ path: 'A.md', contents: toBase64('# A ✓') }], deletions: [{ path: 'B.md' }] },
        });
    });

    it('reports a moved branch as a 409 conflict', async () => {
        const { fetchImpl } = fakeFetch(() => ({
            json: {
                errors: [
                    {
                        type: 'STALE_DATA',
                        message: 'Expected branch to point to "old" but it did not. Pull and try again.',
                    },
                ],
            },
        }));
        const gh = new GitHub({ token: 't', owner: 'me', repo: 'vault', fetchImpl });
        const error = await gh
            .commit({ branch: 'main', expectedHead: 'old', message: 'x', additions: [] })
            .catch((e) => e);
        expect(error).toBeInstanceOf(GitHubError);
        expect(error.status).toBe(409);
    });
});
