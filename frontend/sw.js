// Caches the app shell so nosk opens offline. Page data lives in IndexedDB, not here.
const VERSION = 'nosk-shell-v2';
const SHELL = [
    './',
    'index.html',
    'login.html',
    'manifest.webmanifest',
    'assets/icon.svg',
    'css/main.css',
    'css/components.css',
    'css/picker.css',
    'css/dragdrop.css',
    'css/print.css',
    'lib/purify.min.js',
    'lib/marked.min.js',
    'lib/highlight.min.js',
    'lib/highlight-github.min.css',
    'lib/highlight-github-dark.min.css',
    'lib/katex/katex.min.js',
    'lib/katex/katex.min.css',
    'js/api-client.js',
    'js/app.js',
    'js/auth.js',
    'js/command-palette.js',
    'js/comments-panel.js',
    'js/component-converter.js',
    'js/component-picker.js',
    'js/components/base-component.js',
    'js/components/bookmark.js',
    'js/components/bullet-list.js',
    'js/components/callout.js',
    'js/components/canvas.js',
    'js/components/checklist.js',
    'js/components/code.js',
    'js/components/columns.js',
    'js/components/comment.js',
    'js/components/database.js',
    'js/components/date.js',
    'js/components/divider.js',
    'js/components/embed.js',
    'js/components/file.js',
    'js/components/heading.js',
    'js/components/image.js',
    'js/components/list-base.js',
    'js/components/markdown.js',
    'js/components/math.js',
    'js/components/media-helpers.js',
    'js/components/numbered-list.js',
    'js/components/page-link.js',
    'js/components/properties.js',
    'js/components/quote.js',
    'js/components/registry.js',
    'js/components/table.js',
    'js/components/tags.js',
    'js/components/template.js',
    'js/components/text-block.js',
    'js/components/toggle.js',
    'js/config.js',
    'js/dialogs.js',
    'js/dragdrop-manager.js',
    'js/journal.js',
    'js/keyboard-manager.js',
    'js/markdown.js',
    'js/media.js',
    'js/page-manager.js',
    'js/sanitize.js',
    'js/sidebar-layout.js',
    'js/sidebar.js',
    'js/storage.js',
    'js/sync-client.js',
    'js/theme.js',
    'js/ui.js',
    'js/utils.js',
    'js/login.js',
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
// Cross-origin requests (the API, fonts) are left to the browser.
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
