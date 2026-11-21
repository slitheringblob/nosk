import { escapeHTML } from './utils.js';
import { sanitizeRich } from './sanitize.js';

/** Render Markdown to sanitized HTML. Falls back to escaped text if marked isn't loaded. */
export function renderMarkdown(source) {
    const marked = typeof window !== 'undefined' ? window.marked : undefined;
    if (!marked) return `<pre>${escapeHTML(source)}</pre>`;
    const html = marked.parse(String(source ?? ''), { gfm: true, breaks: true });
    return sanitizeRich(html);
}

export function highlightCode(element, language) {
    const hljs = typeof window !== 'undefined' ? window.hljs : undefined;
    if (!hljs) return;
    const lang = language && hljs.getLanguage(language) ? language : null;
    const code = element.textContent;
    element.innerHTML = lang
        ? hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
        : hljs.highlightAuto(code).value;
}

export function renderMath(element, latex, displayMode) {
    const katex = typeof window !== 'undefined' ? window.katex : undefined;
    if (!katex) {
        element.textContent = latex;
        return;
    }
    try {
        katex.render(latex || ';', element, { displayMode, throwOnError: true, trust: false });
        element.classList.remove('math-error');
    } catch (error) {
        element.textContent = error.message.replace(/^KaTeX parse error: /, '');
        element.classList.add('math-error');
    }
}
