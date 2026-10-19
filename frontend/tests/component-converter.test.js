import { describe, expect, test } from 'vitest';
import { canConvert, convertContent } from '../js/component-converter.js';

// Same cases as backend/tests/services/test_conversion.py so client and server agree.
describe('component converter', () => {
    test('text to checklist splits lines', () => {
        const content = convertContent('text-block', 'checklist', { text: 'buy milk<br><b>call</b> mom' });
        expect(content.items.map((i) => i.text)).toEqual(['buy milk', 'call mom']);
        expect(content.items.every((i) => i.checked === false)).toBe(true);
    });

    test('checklist to bullets keeps indent and escapes text', () => {
        const content = convertContent('checklist', 'bullet-list', {
            items: [{ id: '1', text: 'a & b', checked: true, indent_level: 2 }],
        });
        expect(content.items[0]).toMatchObject({ text: 'a &amp; b', indent_level: 2 });
    });

    test('list to text joins with breaks', () => {
        const content = convertContent('numbered-list', 'text-block', {
            items: [
                { id: '1', text: '<strong>one</strong>', indent_level: 0 },
                { id: '2', text: 'two', indent_level: 0 },
            ],
            start_number: 1,
        });
        expect(content).toEqual({ text: '<strong>one</strong><br>two', format: 'html' });
    });

    test('checklist to markdown uses task syntax', () => {
        const content = convertContent('checklist', 'markdown', {
            items: [{ id: '1', text: 'done', checked: true, indent_level: 0 }],
        });
        expect(content.source).toBe('- [x] done');
    });

    test('drops trailing empty lines', () => {
        expect(convertContent('text-block', 'bullet-list', { text: 'a<br>' }).items).toHaveLength(1);
    });

    test('matrix', () => {
        expect(canConvert('text-block', 'numbered-list')).toBe(true);
        expect(canConvert('heading', 'toggle')).toBe(true);
        expect(canConvert('divider', 'text-block')).toBe(false);
        expect(canConvert('text-block', 'text-block')).toBe(false);
    });
});
