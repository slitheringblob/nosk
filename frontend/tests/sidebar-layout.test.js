import { beforeEach, describe, expect, test } from 'vitest';
import { DEFAULT_WIDTH, MAX_WIDTH, MIN_WIDTH, SidebarLayout, clampWidth } from '../js/sidebar-layout.js';

let app;
let resizer;
let root;

beforeEach(() => {
    localStorage.clear();
    app = document.createElement('div');
    resizer = document.createElement('div');
    root = document.createElement('div');
});

const make = (mobile = false) => {
    window.matchMedia = () => ({ matches: mobile, addEventListener() {} });
    return new SidebarLayout({ app, resizer, root });
};

describe('SidebarLayout', () => {
    test('width is clamped, applied and remembered', () => {
        const layout = make();
        expect(root.style.getPropertyValue('--sidebar-w')).toBe(`${DEFAULT_WIDTH}px`);
        layout.setWidth(1000);
        expect(layout.width).toBe(MAX_WIDTH);
        expect(clampWidth(10)).toBe(MIN_WIDTH);
        layout.setWidth(320);
        expect(make().width).toBe(320);
    });

    test('keyboard resizing and double-click reset', () => {
        const layout = make();
        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        expect(layout.width).toBe(DEFAULT_WIDTH + 16);
        resizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true }));
        expect(layout.width).toBe(DEFAULT_WIDTH + 16 - 48);
        resizer.dispatchEvent(new MouseEvent('dblclick'));
        expect(layout.width).toBe(DEFAULT_WIDTH);
        expect(resizer.getAttribute('aria-valuenow')).toBe(String(DEFAULT_WIDTH));
    });

    test('toggle closes on desktop (remembered) and slides the panel on phones', () => {
        const layout = make();
        layout.toggle();
        expect(app.classList.contains('sidebar-closed')).toBe(true);
        expect(make().closed).toBe(true);
        make().toggle();
        expect(app.classList.contains('sidebar-closed')).toBe(false);

        const phone = make(true);
        phone.toggle();
        expect(app.classList.contains('sidebar-open')).toBe(true);
        expect(app.classList.contains('sidebar-closed')).toBe(false);
    });
});
