// Resizing and closing the sidebar. On narrow screens the sidebar is an off-canvas panel instead,
// so "toggle" opens/closes that panel and the width handle is hidden by CSS.

const WIDTH_KEY = 'nosk.sidebar.width';
const CLOSED_KEY = 'nosk.sidebar.closed';
export const DEFAULT_WIDTH = 272;
export const MIN_WIDTH = 200;
export const MAX_WIDTH = 480;

export const clampWidth = (width) => Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)));

function read(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function write(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Layout just won't be remembered.
    }
}

export class SidebarLayout {
    constructor({ app, resizer, root = document.documentElement, mobileQuery = '(max-width: 860px)' }) {
        this.app = app;
        this.resizer = resizer;
        this.root = root;
        this.mobile = globalThis.matchMedia?.(mobileQuery);
        this.setWidth(Number(read(WIDTH_KEY)) || DEFAULT_WIDTH, false);
        this.setClosed(read(CLOSED_KEY) === '1', false);
        this.bindResizer();
    }

    get isMobile() {
        return Boolean(this.mobile?.matches);
    }

    get closed() {
        return this.app.classList.contains('sidebar-closed');
    }

    setWidth(width, persist = true) {
        this.width = clampWidth(width);
        this.root.style.setProperty('--sidebar-w', `${this.width}px`);
        this.resizer?.setAttribute('aria-valuenow', String(this.width));
        if (persist) write(WIDTH_KEY, String(this.width));
    }

    setClosed(closed, persist = true) {
        this.app.classList.toggle('sidebar-closed', closed);
        if (persist) write(CLOSED_KEY, closed ? '1' : '0');
    }

    /** Desktop: close/reopen the sidebar. Phone: slide the panel in or out. */
    toggle() {
        if (this.isMobile) this.app.classList.toggle('sidebar-open');
        else this.setClosed(!this.closed);
    }

    bindResizer() {
        const handle = this.resizer;
        if (!handle) return;
        handle.setAttribute('aria-valuemin', String(MIN_WIDTH));
        handle.setAttribute('aria-valuemax', String(MAX_WIDTH));
        handle.addEventListener('pointerdown', (event) => {
            event.preventDefault();
            handle.setPointerCapture?.(event.pointerId);
            const left = this.app.getBoundingClientRect().left;
            this.app.classList.add('is-resizing');
            const move = (moveEvent) => this.setWidth(moveEvent.clientX - left, false);
            const stop = () => {
                handle.removeEventListener('pointermove', move);
                handle.removeEventListener('pointerup', stop);
                handle.removeEventListener('pointercancel', stop);
                this.app.classList.remove('is-resizing');
                write(WIDTH_KEY, String(this.width));
            };
            handle.addEventListener('pointermove', move);
            handle.addEventListener('pointerup', stop);
            handle.addEventListener('pointercancel', stop);
        });
        handle.addEventListener('dblclick', () => this.setWidth(DEFAULT_WIDTH));
        handle.addEventListener('keydown', (event) => {
            const step = event.shiftKey ? 48 : 16;
            if (event.key === 'ArrowLeft') this.setWidth(this.width - step);
            else if (event.key === 'ArrowRight') this.setWidth(this.width + step);
            else if (event.key === 'Home') this.setWidth(MIN_WIDTH);
            else if (event.key === 'End') this.setWidth(MAX_WIDTH);
            else if (event.key === 'Enter') this.setClosed(true);
            else return;
            event.preventDefault();
        });
    }
}
