// Daily notes, named the way the vault already names them. Patterns use Obsidian/moment
// tokens (YYYY, YY, MMMM, MMM, MM, M, DD, D, dddd, ddd; [text] is literal) and may contain
// folders, e.g. "MMM-YY/DMMMYY" for Worklog/Nov-25/12Nov25.md.

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TOKENS = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd/g;
const CANDIDATES = [
    'YYYY-MM-DD',
    'DD-MM-YYYY',
    'MMM-YY/DMMMYY',
    'DMMMYY',
    'YYYY/MM/YYYY-MM-DD',
    'YYYY/YYYY-MM-DD',
    'D MMM YYYY',
    'MM-DD-YYYY',
];

const pad = (n) => String(n).padStart(2, '0');

export function formatDate(date, pattern) {
    return pattern.replace(TOKENS, (token, literal) => {
        if (literal !== undefined) return literal;
        switch (token) {
            case 'YYYY':
                return String(date.getFullYear());
            case 'YY':
                return pad(date.getFullYear() % 100);
            case 'MMMM':
                return MONTHS[date.getMonth()];
            case 'MMM':
                return MONTHS[date.getMonth()].slice(0, 3);
            case 'MM':
                return pad(date.getMonth() + 1);
            case 'M':
                return String(date.getMonth() + 1);
            case 'DD':
                return pad(date.getDate());
            case 'D':
                return String(date.getDate());
            case 'dddd':
                return DAYS[date.getDay()];
            default:
                return DAYS[date.getDay()].slice(0, 3);
        }
    });
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A regex that matches paths written with `pattern` (relative to the daily folder, no .md). */
export function patternRegExp(pattern) {
    let source = '';
    let last = 0;
    for (const match of pattern.matchAll(TOKENS)) {
        source += escapeRegExp(pattern.slice(last, match.index));
        const [token, literal] = match;
        if (literal !== undefined) source += escapeRegExp(literal);
        else if (token === 'YYYY') source += '\\d{4}';
        else if (token === 'YY' || token === 'MM' || token === 'DD') source += '\\d{2}';
        else if (token === 'M' || token === 'D') source += '\\d{1,2}';
        else if (token === 'MMMM') source += `(?:${MONTHS.join('|')})`;
        else if (token === 'MMM') source += `(?:${MONTHS.map((m) => m.slice(0, 3)).join('|')})`;
        else if (token === 'dddd') source += `(?:${DAYS.join('|')})`;
        else source += `(?:${DAYS.map((d) => d.slice(0, 3)).join('|')})`;
        last = match.index + token.length;
    }
    source += escapeRegExp(pattern.slice(last));
    return new RegExp(`^${source}$`, 'i');
}

const trimSlashes = (value) => String(value || '').replace(/^\/+|\/+$/g, '');

/**
 * Work out where daily notes live: Obsidian's daily-notes settings, corrected by what the vault's
 * files actually look like (the settings and the files often disagree).
 * Returns { folder, format, template }.
 */
export function detectDaily(paths, config = {}) {
    const folder = trimSlashes(config.folder);
    const prefix = folder ? `${folder}/` : '';
    const notes = paths
        .filter((p) => p.toLowerCase().endsWith('.md') && p.startsWith(prefix))
        .map((p) => p.slice(prefix.length, -3));
    const candidates = [...new Set([config.format, ...CANDIDATES].filter(Boolean))];
    let best = { format: config.format || 'YYYY-MM-DD', hits: 0 };
    for (const format of candidates) {
        const regex = patternRegExp(format);
        const hits = notes.filter((n) => regex.test(n)).length;
        if (hits > best.hits) best = { format, hits };
    }
    return { folder, format: best.format, template: trimSlashes(config.template) || null };
}

/** Vault path of the daily note for `date`. */
export function dailyPath(date, { folder, format }) {
    const name = formatDate(date, format);
    return `${folder ? `${trimSlashes(folder)}/` : ''}${name}.md`;
}

/** Obsidian template variables: {{date}}, {{date:FORMAT}}, {{time}}, {{title}}. */
export function applyTemplate(text, { date, title, format = 'YYYY-MM-DD' }) {
    return String(text || '')
        .replace(/\{\{\s*date(?::([^}]+))?\s*\}\}/gi, (_, custom) => formatDate(date, custom?.trim() || format))
        .replace(/\{\{\s*time(?::([^}]+))?\s*\}\}/gi, (_, custom) =>
            custom ? formatDate(date, custom.trim()) : `${pad(date.getHours())}:${pad(date.getMinutes())}`,
        )
        .replace(/\{\{\s*title\s*\}\}/gi, title);
}
