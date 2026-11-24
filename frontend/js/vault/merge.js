// Three-way merge of text files, line by line (diff3). Used when a note was edited in nosk and,
// meanwhile, someone (usually Obsidian) pushed a different version of it.

// Above this many cells the LCS table gets slow; such large rewrites are treated as one change.
const MAX_LCS_CELLS = 4_000_000;

/**
 * Matching lines between `a` and `b` as an array: match[i] = index in b of a[i], or -1.
 * Common prefix and suffix are matched directly; the middle uses a classic LCS table.
 */
export function matchLines(a, b) {
    const match = new Array(a.length).fill(-1);
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) {
        match[start] = start;
        start += 1;
    }
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
        match[endA] = endB;
    }
    const n = endA - start;
    const m = endB - start;
    if (!n || !m || n * m > MAX_LCS_CELLS) return match;
    // lengths[i][j] = LCS of a[start+i..endA) and b[start+j..endB)
    const lengths = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            lengths[i][j] =
                a[start + i] === b[start + j]
                    ? lengths[i + 1][j + 1] + 1
                    : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
        }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[start + i] === b[start + j]) {
            match[start + i] = start + j;
            i += 1;
            j += 1;
        } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
            i += 1;
        } else {
            j += 1;
        }
    }
    return match;
}

const same = (x, y) => x.length === y.length && x.every((line, i) => line === y[i]);

/**
 * Merge `ours` and `theirs`, both edited from `base`. Returns { text, conflicts }:
 * non-overlapping changes from both sides are combined; where both sides changed the same lines
 * differently, ours is kept and `conflicts` counts how often that happened.
 */
export function merge3(base, ours, theirs) {
    if (ours === theirs) return { text: ours, conflicts: 0 };
    if (base === ours) return { text: theirs, conflicts: 0 };
    if (base === theirs) return { text: ours, conflicts: 0 };
    const O = base.split('\n');
    const A = ours.split('\n');
    const B = theirs.split('\n');
    const toA = matchLines(O, A);
    const toB = matchLines(O, B);
    const out = [];
    let conflicts = 0;
    let i = 0;
    let a = 0;
    let b = 0;
    while (i < O.length || a < A.length || b < B.length) {
        // Stable run: the same base line sits at the expected place on both sides.
        if (i < O.length && toA[i] === a && toB[i] === b) {
            out.push(O[i]);
            i += 1;
            a += 1;
            b += 1;
            continue;
        }
        // Unstable chunk: up to the next base line both sides still have.
        let j = i;
        while (j < O.length && (toA[j] < a || toB[j] < b)) j += 1;
        const endA = j < O.length ? toA[j] : A.length;
        const endB = j < O.length ? toB[j] : B.length;
        const baseChunk = O.slice(i, j);
        const chunkA = A.slice(a, endA);
        const chunkB = B.slice(b, endB);
        if (same(chunkA, baseChunk)) out.push(...chunkB);
        else if (same(chunkB, baseChunk) || same(chunkA, chunkB)) out.push(...chunkA);
        else {
            out.push(...chunkA);
            conflicts += 1;
        }
        i = j;
        a = endA;
        b = endB;
    }
    return { text: out.join('\n'), conflicts };
}

/** The sha git gives a file with this content ("blob <bytes>\0<content>", SHA-1). Accepts text or binary. */
export async function gitBlobSha(content) {
    const body =
        content instanceof Uint8Array
            ? content
            : content instanceof ArrayBuffer
              ? new Uint8Array(content)
              : ArrayBuffer.isView(content)
                ? new Uint8Array(content.buffer, content.byteOffset, content.byteLength)
                : new TextEncoder().encode(String(content ?? ''));
    const header = new TextEncoder().encode(`blob ${body.length}\0`);
    const bytes = new Uint8Array(header.length + body.length);
    bytes.set(header);
    bytes.set(body, header.length);
    const digest = await crypto.subtle.digest('SHA-1', bytes);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
