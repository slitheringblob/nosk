// Caches the app shell so nosk opens offline. The vault itself lives in IndexedDB, not here.
const VERSION = 'nosk-vault-v1';
const SHELL = [
    './',
    'index.html',
    'manifest.webmanifest',
    'assets/icon.svg',
    'css/main.css',
    'css/components.css',
    'css/vault.css',
    'css/print.css',
    'lib/purify.min.js',
    'lib/marked.min.js',
    'lib/highlight.min.js',
    'lib/highlight-github.min.css',
    'lib/highlight-github-dark.min.css',
    'lib/katex/katex.min.js',
    'lib/katex/katex.min.css',
    'js/theme-boot.js',
    'js/markdown.js',
    'js/sanitize.js',
    'js/sidebar-layout.js',
    'js/theme.js',
    'js/ui.js',
    'js/utils.js',
    'js/vault/app.js',
    'js/vault/github.js',
    'js/vault/links.js',
    'js/vault/palette.js',
    'js/vault/render.js',
    'js/vault/search.js',
    'js/vault/store.js',
    'js/vault/sync.js',
    'js/vault/tree.js',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches
            .open(VERSION)
            .then((cache) => cache.addAll(SHELL))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

// Network first for the app's own files (so deploys show up), falling back to cache offline.
// `no-cache` revalidates with the server instead of trusting the browser's HTTP cache, which
// would otherwise keep serving old JS for a while after an update.
// Cross-origin requests (the GitHub API, fonts) are left to the browser.
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
    event.respondWith(
        fetch(event.request, { cache: 'no-cache' })
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    caches.open(VERSION).then((cache) => cache.put(event.request, copy));
                }
                return response;
            })
            .catch(() =>
                caches
                    .match(event.request, { ignoreSearch: true })
                    .then((cached) => cached || caches.match('index.html')),
            ),
    );
});
