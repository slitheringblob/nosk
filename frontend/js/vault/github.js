// Thin client for the parts of the GitHub API nosk uses. The API sends CORS headers, so the
// browser talks to it directly with a fine-grained personal access token; there is no server.
const API = 'https://api.github.com';

export class GitHubError extends Error {
    constructor(message, status, retryAfter = 0) {
        super(message);
        this.name = 'GitHubError';
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

/** Raised when the request never reached GitHub (offline, DNS, CORS). */
export class OfflineError extends Error {
    constructor(cause) {
        super('GitHub is unreachable');
        this.name = 'OfflineError';
        this.cause = cause;
    }
}

export class GitHub {
    constructor({ token, owner, repo, fetchImpl = (...args) => globalThis.fetch(...args) }) {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.fetch = fetchImpl;
    }

    get repoPath() {
        return `/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}`;
    }

    /**
     * `cache: 'no-cache'` makes the browser revalidate with its ETag: unchanged answers come back
     * as 304s, which GitHub doesn't count against the rate limit, and we never read a stale head.
     */
    async request(path, { method = 'GET', accept = 'application/vnd.github+json', body, as = 'json' } = {}) {
        let response;
        try {
            response = await this.fetch(`${API}${path}`, {
                method,
                cache: 'no-cache',
                headers: {
                    Accept: accept,
                    Authorization: `Bearer ${this.token}`,
                    'X-GitHub-Api-Version': '2022-11-28',
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                body: body ? JSON.stringify(body) : undefined,
            });
        } catch (error) {
            throw new OfflineError(error);
        }
        if (!response.ok) {
            let message = response.statusText || `HTTP ${response.status}`;
            try {
                message = (await response.json()).message || message;
            } catch {
                // Keep the status text.
            }
            const retryAfter = Number(response.headers.get('retry-after')) || 0;
            const limited =
                response.status === 429 ||
                (response.status === 403 && (retryAfter || response.headers.get('x-ratelimit-remaining') === '0'));
            if (limited) message = `GitHub rate limit hit, try again ${retryAfter ? `in ${retryAfter}s` : 'later'}`;
            throw new GitHubError(message, response.status, retryAfter);
        }
        if (as === 'buffer') return response.arrayBuffer();
        if (as === 'text') return response.text();
        return response.json();
    }

    /** Repo info; also checks the token can see it. */
    getRepo() {
        return this.request(this.repoPath);
    }

    /** Commit sha at the tip of a branch. */
    async headCommit(branch) {
        const ref = await this.request(`${this.repoPath}/git/ref/heads/${encodePath(branch)}`);
        return ref.object.sha;
    }

    /**
     * Every blob in the tree as [{ path, sha, size }]. Falls back to walking folders one by one if
     * GitHub truncates the recursive listing (only happens for very large repos).
     */
    async listFiles(treeish) {
        const listing = await this.request(`${this.repoPath}/git/trees/${treeish}?recursive=1`);
        if (!listing.truncated) {
            return listing.tree.filter((e) => e.type === 'blob').map(({ path, sha, size }) => ({ path, sha, size }));
        }
        const files = [];
        const walk = async (sha, prefix) => {
            const { tree } = await this.request(`${this.repoPath}/git/trees/${sha}`);
            for (const entry of tree) {
                const path = prefix + entry.path;
                if (entry.type === 'blob') files.push({ path, sha: entry.sha, size: entry.size });
                else if (entry.type === 'tree') await walk(entry.sha, `${path}/`);
            }
        };
        await walk(treeish, '');
        return files;
    }

    /** Raw bytes of a blob. */
    blob(sha) {
        return this.request(`${this.repoPath}/git/blobs/${sha}`, {
            accept: 'application/vnd.github.raw',
            as: 'buffer',
        });
    }

    /**
     * Text of many blobs in one GraphQL request: Map(sha → text). Binary or truncated blobs are
     * left out, so callers fetch those one by one with blob().
     */
    async blobTexts(shas) {
        const wanted = shas.filter((sha) => /^[0-9a-f]{40}$/i.test(sha));
        if (!wanted.length) return new Map();
        const fields = wanted
            .map((sha, i) => `b${i}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated } }`)
            .join('\n');
        const data = await this.graphql(
            `query ($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields} } }`,
            { owner: this.owner, name: this.repo },
        );
        const texts = new Map();
        wanted.forEach((sha, i) => {
            const blob = data.repository?.[`b${i}`];
            if (blob && !blob.isBinary && !blob.isTruncated && typeof blob.text === 'string') texts.set(sha, blob.text);
        });
        return texts;
    }

    async graphql(query, variables) {
        const result = await this.request('/graphql', { method: 'POST', body: { query, variables } });
        if (result.errors?.length) {
            const message = result.errors.map((e) => e.message).join('; ');
            // createCommitOnBranch refuses when the branch moved since `expectedHeadOid`.
            const moved = result.errors.some(
                (e) => e.type === 'STALE_DATA' || /expected branch to point to/i.test(e.message),
            );
            // A read-only token gets FORBIDDEN ("Resource not accessible by personal access token").
            const forbidden = result.errors.some((e) => e.type === 'FORBIDDEN' || /not accessible/i.test(e.message));
            throw new GitHubError(message, moved ? 409 : forbidden ? 403 : 422);
        }
        return result.data;
    }

    /**
     * One commit with any number of added/changed and deleted files. It only lands if the branch
     * is still at `expectedHead`; otherwise it throws a GitHubError with status 409 and nothing
     * is written, so a newer commit (from Obsidian or another device) can never be overwritten.
     * additions: [{ path, text }] or [{ path, base64 }]; deletions: [path].
     */
    async commit({ branch, expectedHead, message, additions = [], deletions = [] }) {
        const [headline, ...rest] = String(message).split('\n');
        const data = await this.graphql(
            `mutation ($input: CreateCommitOnBranchInput!) {
                createCommitOnBranch(input: $input) { commit { oid url } }
            }`,
            {
                input: {
                    branch: { repositoryNameWithOwner: `${this.owner}/${this.repo}`, branchName: branch },
                    expectedHeadOid: expectedHead,
                    message: { headline, body: rest.join('\n').trim() || undefined },
                    fileChanges: {
                        additions: additions.map((file) => ({
                            path: file.path,
                            contents: file.base64 ?? toBase64(file.text),
                        })),
                        deletions: deletions.map((path) => ({ path })),
                    },
                },
            },
        );
        return data.createCommitOnBranch.commit;
    }

    webUrl(path, branch) {
        return `https://github.com/${this.owner}/${this.repo}/blob/${encodePath(branch)}/${encodePath(path)}`;
    }
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

/** UTF-8 text to base64 (btoa alone only handles Latin-1). */
export function toBase64(text) {
    const bytes = new TextEncoder().encode(String(text ?? ''));
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
}
