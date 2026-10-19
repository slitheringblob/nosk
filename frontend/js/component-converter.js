// Mirrors backend/app/services/conversion.py so conversions work offline and match the server.
import { escapeHTML, generateUUID, stripHTML } from './utils.js';
import { sanitizeInline } from './sanitize.js';

export const CONVERTIBLE_TYPES = [
    'text-block',
    'heading',
    'quote',
    'callout',
    'toggle',
    'code',
    'markdown',
    'checklist',
    'bullet-list',
    'numbered-list',
];

export function canConvert(fromType, toType) {
    return fromType !== toType && CONVERTIBLE_TYPES.includes(fromType) && CONVERTIBLE_TYPES.includes(toType);
}

const splitHTML = (value) =>
    String(value || '')
        .split(/<br\s*\/?>/i)
        .map((part) => ({ html: sanitizeInline(part), indent: 0, checked: false }));
const splitText = (value) =>
    String(value || '')
        .split('\n')
        .map((part) => ({ html: escapeHTML(part), indent: 0, checked: false }));

export function extractLines(type, content) {
    switch (type) {
        case 'text-block':
        case 'quote':
        case 'callout':
            return splitHTML(content.text);
        case 'heading':
            return splitText(content.text);
        case 'toggle':
            return splitText(content.title);
        case 'code':
            return splitText(content.code);
        case 'markdown':
            return splitText(content.source);
        case 'checklist':
            return (content.items || []).map((item) => ({
                html: escapeHTML(item.text),
                indent: item.indent_level,
                checked: item.checked,
            }));
        case 'bullet-list':
        case 'numbered-list':
            return (content.items || []).map((item) => ({
                html: item.text,
                indent: item.indent_level,
                checked: false,
            }));
        default:
            throw new Error(`Cannot convert from ${type}`);
    }
}

function markdownPrefix(sourceType, index, line) {
    const indent = '  '.repeat(line.indent);
    if (sourceType === 'checklist') return `${indent}- [${line.checked ? 'x' : ' '}] `;
    if (sourceType === 'bullet-list') return `${indent}- `;
    if (sourceType === 'numbered-list') return `${indent}${index + 1}. `;
    return '';
}

export function convertContent(fromType, toType, content) {
    const lines = extractLines(fromType, content);
    if (!lines.length) lines.push({ html: '', indent: 0, checked: false });
    while (lines.length > 1 && !stripHTML(lines[lines.length - 1].html).trim()) lines.pop();
    const text = (line) => stripHTML(line.html);
    switch (toType) {
        case 'text-block':
            return { text: lines.map((l) => l.html).join('<br>'), format: 'html' };
        case 'quote':
            return { text: lines.map((l) => l.html).join('<br>'), citation: null };
        case 'callout':
            return { text: lines.map((l) => l.html).join('<br>'), variant: content.variant || 'note', icon: null };
        case 'heading':
            return { text: lines.map(text).join(' ').trim().slice(0, 200), level: 2 };
        case 'toggle':
            return { title: lines.map(text).join(' ').trim().slice(0, 500), is_open: true };
        case 'code':
            return { code: lines.map(text).join('\n'), language: 'plaintext', wrap: false };
        case 'markdown':
            return {
                source: lines.map((l, i) => markdownPrefix(fromType, i, l) + text(l)).join('\n'),
                preview_mode: false,
            };
        case 'checklist':
            return {
                items: lines.map((l) => ({
                    id: generateUUID(),
                    text: text(l).slice(0, 1000),
                    checked: l.checked,
                    indent_level: Math.min(l.indent, 3),
                })),
            };
        case 'bullet-list':
        case 'numbered-list': {
            const items = lines.map((l) => ({ id: generateUUID(), text: l.html, indent_level: Math.min(l.indent, 3) }));
            return toType === 'numbered-list' ? { items, start_number: content.start_number || 1 } : { items };
        }
        default:
            throw new Error(`Cannot convert to ${toType}`);
    }
}
