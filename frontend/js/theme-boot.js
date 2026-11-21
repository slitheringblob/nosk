// Apply the theme before first paint to avoid a flash. A classic script (not a module) so it runs
// before the stylesheet-dependent body renders; kept out of the HTML so the CSP can forbid inline JS.
(function () {
    var pref = 'system';
    try {
        pref = localStorage.getItem('nosk.theme') || 'system';
    } catch (e) {}
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = pref === 'system' ? (dark ? 'dark' : 'light') : pref;
})();
