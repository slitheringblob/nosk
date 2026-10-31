import { describe, expect, test, vi } from 'vitest';
import { debounce, el, Emitter, escapeHTML, generateUUID, stripHTML, textToHTML } from '../js/utils.js';
import { sanitizeInline, sanitizeRich } from '../js/sanitize.js';

describe('utils', () => {
    test('generateUUID produces v4 ids', () => {
        expect(generateUUID()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    test('escape and strip HTML', () => {
        expect(escapeHTML('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
        expect(stripHTML('one<br><strong>two</strong>')).toBe('one\ntwo');
        expect(textToHTML('a <b>\nc')).toBe('a &lt;b&gt;<br>c');
    });

    test('debounce delays and flush runs immediately', () => {
        vi.useFakeTimers();
        const fn = vi.fn();
        const debounced = debounce(fn, 100);
        debounced(1);
        debounced(2);
        expect(fn).not.toHaveBeenCalled();
        vi.advanceTimersByTime(100);
        expect(fn).toHaveBeenCalledWith(2);
        debounced(3);
        debounced.flush();
        expect(fn).toHaveBeenLastCalledWith(3);
        expect(fn).toHaveBeenCalledTimes(2);
        vi.useRealTimers();
    });

    test('el builds elements with props, listeners and children', () => {
        const onclick = vi.fn();
        const node = el(
            'button',
            { className: 'x', dataset: { id: '1' }, onclick, disabled: false },
            'Go',
            el('span', {}, '!'),
        );
        node.click();
        expect(node.outerHTML).toBe('<button class="x" data-id="1">Go<span>!</span></button>');
        expect(onclick).toHaveBeenCalled();
    });

    test('Emitter isolates handler errors', () => {
        const emitter = new Emitter();
        const good = vi.fn();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        emitter.on('e', () => {
            throw new Error('boom');
        });
        const off = emitter.on('e', good);
        emitter.emit('e', 1);
        off();
        emitter.emit('e', 2);
        expect(good).toHaveBeenCalledTimes(1);
    });
});

describe('sanitize', () => {
    test('inline allowlist strips scripts and unsafe links', () => {
        const dirty = '<b>ok</b><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a><script>bad()</script>';
        const clean = sanitizeInline(dirty);
        expect(clean).toContain('<b>ok</b>');
        expect(clean).not.toMatch(/img|script|javascript|onerror/);
    });

    test('links open safely in a new tab', () => {
        expect(sanitizeInline('<a href="https://example.com">e</a>')).toBe(
            '<a href="https://example.com" target="_blank" rel="noopener noreferrer">e</a>',
        );
    });

    test('rich sanitizer keeps markdown structure', () => {
        const clean = sanitizeRich('<h2>T</h2><ul><li>a</li></ul><iframe src="x"></iframe>');
        expect(clean).toBe('<h2>T</h2><ul><li>a</li></ul>');
    });
});
