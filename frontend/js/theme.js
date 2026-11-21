// Theme preference: "system" follows the OS, otherwise forces dark or light. The palette
// (amber, purple, teal) picks the accent colour, and for purple and teal a black dark mode.
const KEY = 'nosk.theme';
const PALETTE_KEY = 'nosk.palette';

export const PALETTES = [
    { id: 'amber', label: 'amber', swatch: '#fbbf24' },
    { id: 'purple', label: 'purple', swatch: '#a78bfa' },
    { id: 'teal', label: 'teal', swatch: '#2dd4bf' },
];

function read(key, fallback) {
    try {
        return localStorage.getItem(key) || fallback;
    } catch {
        return fallback;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Preference just won't persist.
    }
}

export const theme = {
    get() {
        return read(KEY, 'system');
    },
    set(value) {
        write(KEY, value);
        this.apply();
    },
    palette() {
        const id = read(PALETTE_KEY, 'amber');
        return PALETTES.some((p) => p.id === id) ? id : 'amber';
    },
    setPalette(id) {
        write(PALETTE_KEY, id);
        this.apply();
    },
    apply() {
        const preference = this.get();
        const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
        const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
        const root = document.documentElement;
        root.dataset.theme = resolved;
        root.dataset.palette = this.palette();
        // Match the browser/phone status bar to the page background.
        const meta = document.querySelector('meta[name="theme-color"]');
        const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
        if (meta && bg) meta.setAttribute('content', bg);
    },
    watch() {
        window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => this.apply());
        this.apply();
    },
};
