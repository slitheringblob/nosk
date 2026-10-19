// Copies the browser builds of third-party libraries from node_modules into lib/.
// lib/ is committed so the app runs from any static file server without npm.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const modules = join(root, 'node_modules');
const lib = join(root, 'lib');

const files = [
    ['marked/marked.min.js', 'marked.min.js'],
    ['dompurify/dist/purify.min.js', 'purify.min.js'],
    ['@highlightjs/cdn-assets/highlight.min.js', 'highlight.min.js'],
    ['@highlightjs/cdn-assets/styles/github.min.css', 'highlight-github.min.css'],
    ['@highlightjs/cdn-assets/styles/github-dark.min.css', 'highlight-github-dark.min.css'],
    ['katex/dist/katex.min.js', 'katex/katex.min.js'],
    ['katex/dist/katex.min.css', 'katex/katex.min.css'],
    ['katex/dist/fonts', 'katex/fonts'],
];

// Every supported browser loads woff2, so the larger fallback formats are dropped.
const dropFontExtensions = ['.ttf', '.woff'];

rmSync(lib, { recursive: true, force: true });
for (const [from, to] of files) {
    const target = join(lib, to);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(modules, from), target, { recursive: true });
}
const fontDir = join(lib, 'katex/fonts');
for (const name of readdirSync(fontDir)) {
    if (dropFontExtensions.some((ext) => name.endsWith(ext))) rmSync(join(fontDir, name));
}
console.log(`Vendored ${files.length} entries into lib/`);
