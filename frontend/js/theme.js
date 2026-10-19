// Theme preference: "system" follows the OS, otherwise forces dark or light.
const KEY = 'nosk.theme';

export const theme = {
    get() {
        try {
            return localStorage.getItem(KEY) || 'system';
        } catch {
            return 'system';
        }
    },
    set(value) {
        try {
            localStorage.setItem(KEY, value);
        } catch {
            // Preference just won't persist.
        }
        this.apply();
    },
    apply() {
        const preference = this.get();
        const systemDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
        const resolved = preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
        document.documentElement.dataset.theme = resolved;
        const highlight = document.getElementById('hljs-theme');
        if (highlight) highlight.href = `lib/highlight-github${resolved === 'dark' ? '-dark' : ''}.min.css`;
    },
    watch() {
        window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => this.apply());
        this.apply();
    },
};
