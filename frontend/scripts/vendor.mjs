// Copies the browser builds of third-party libraries from node_modules into lib/.
// lib/ is committed so the app runs from any static file server without npm.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
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
    ['lz-string/libs/lz-string.min.js', 'lz-string.min.js'],
    ['@excalidraw/excalidraw/dist/prod/index.css', 'excalidraw/index.css'],
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

// Bundle @excalidraw/excalidraw + React into a lazy-loaded ESM module.
const excalidrawDir = join(lib, 'excalidraw');
mkdirSync(excalidrawDir, { recursive: true });
await build({
    entryPoints: [join(root, 'scripts/excalidraw-entry.js')],
    outfile: join(excalidrawDir, 'bundle.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    minify: true,
    define: {
        'process.env.NODE_ENV': '"production"',
    },
    plugins: [
        {
            name: 'slim-excalidraw',
            setup(b) {
                // Mermaid-to-Excalidraw pulls in mermaid + cytoscape (~3.5 MB); skip it.
                b.onResolve({ filter: /^@excalidraw\/mermaid-to-excalidraw$/ }, () => ({
                    path: 'mermaid-stub',
                    namespace: 'stub',
                }));
                // Keep English locale only (other 50+ locale chunks add ~1.6 MB).
                b.onResolve({ filter: /^\.\/locales\/.*\.(js|json)$/ }, (args) =>
                    /\/en[.-]/.test(args.path) ? null : { path: 'empty-locale', namespace: 'stub' },
                );
                b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
                    contents:
                        args.path === 'empty-locale'
                            ? 'export default {};'
                            : 'export const parseMermaidToExcalidraw = async () => { throw new Error("Mermaid import is not bundled"); };',
                }));
            },
        },
    ],
});

// Copy core Excalidraw fonts (omit 13 MB Xiaolai CJK subsets to keep the repo lean).
const excalidrawFontsSrc = join(modules, '@excalidraw/excalidraw/dist/prod/fonts');
const excalidrawFontsDst = join(excalidrawDir, 'fonts');
for (const family of readdirSync(excalidrawFontsSrc)) {
    if (family === 'Xiaolai') continue;
    cpSync(join(excalidrawFontsSrc, family), join(excalidrawFontsDst, family), { recursive: true });
}

console.log(`Vendored ${files.length} entries + Excalidraw ESM bundle into lib/`);
