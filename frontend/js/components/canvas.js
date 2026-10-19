import BaseComponent from './base-component.js';
import { el } from '../utils.js';

const COLORS = ['#1f2328', '#fbbf24', '#7aa2f7', '#9ece6a', '#f7768e', '#bb9af7'];
const LOGICAL_WIDTH = 1000;

/** Freehand drawing. Strokes are stored in a 1000-unit-wide coordinate space so they scale. */
export default class CanvasComponent extends BaseComponent {
    static type = 'canvas';
    static label = 'Drawing';
    static icon = '✎';
    static category = 'media';
    static description = 'Freehand sketch canvas';
    static keywords = ['canvas', 'draw', 'drawing', 'sketch', 'whiteboard'];

    getDefaultContent() {
        return { strokes: [], height: 320 };
    }

    renderBody() {
        const container = el('div', { className: 'canvas-container' });
        const canvas = el('canvas', { className: 'drawing-canvas', ariaLabel: 'Drawing' });
        this.canvas = canvas;
        this.color = this.color || (document.documentElement.dataset.theme === 'light' ? COLORS[0] : '#e4e8f7');
        this.width = this.width || 3;
        container.append(canvas);

        if (!this.readOnly) {
            const palette = el('div', { className: 'block-options canvas-tools' });
            const swatches = [this.color, ...COLORS.filter((c) => c !== this.color)].slice(0, 6).map((color) => {
                const swatch = el('button', {
                    type: 'button',
                    className: `swatch${color === this.color ? ' is-active' : ''}`,
                    style: { background: color },
                    ariaLabel: `Color ${color}`,
                });
                this.addEventListener(swatch, 'click', () => {
                    this.color = color;
                    palette.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('is-active', s === swatch));
                });
                return swatch;
            });
            const size = el('input', { type: 'range', min: 1, max: 20, value: this.width, ariaLabel: 'Brush size' });
            this.addEventListener(size, 'input', () => {
                this.width = Number(size.value);
            });
            const undo = el('button', { type: 'button' }, 'Undo');
            this.addEventListener(undo, 'click', () => {
                this.content.strokes.pop();
                this.update({ strokes: this.content.strokes });
                this.draw();
            });
            const clear = el('button', { type: 'button' }, 'Clear');
            this.addEventListener(clear, 'click', () => {
                if (!this.content.strokes.length || !window.confirm('Clear the drawing?')) return;
                this.update({ strokes: [] });
                this.draw();
            });
            const taller = el('button', { type: 'button', title: 'Taller' }, '↕');
            this.addEventListener(taller, 'click', () => {
                this.update({ height: Math.min(2000, this.content.height + 160) });
                this.layout();
            });
            palette.append(...swatches, size, undo, clear, taller);
            container.prepend(palette);
            this.bindDrawing(canvas);
        }
        this.resizeObserver?.disconnect();
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(() => this.layout());
            this.resizeObserver.observe(container);
        }
        requestAnimationFrame(() => this.layout());
        return container;
    }

    scale() {
        return (this.canvas.clientWidth || LOGICAL_WIDTH) / LOGICAL_WIDTH;
    }

    layout() {
        const canvas = this.canvas;
        if (!canvas?.isConnected) return;
        const ratio = window.devicePixelRatio || 1;
        const width = canvas.clientWidth || LOGICAL_WIDTH;
        const height = this.content.height * this.scale();
        canvas.style.height = `${height}px`;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        this.draw();
    }

    draw() {
        const canvas = this.canvas;
        const ctx = canvas?.getContext?.('2d');
        if (!ctx) return;
        const ratio = window.devicePixelRatio || 1;
        const factor = this.scale() * ratio;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.setTransform(factor, 0, 0, factor, 0, 0);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const stroke of [...this.content.strokes, this.activeStroke].filter(Boolean)) {
            ctx.strokeStyle = stroke.color;
            ctx.lineWidth = stroke.width;
            ctx.beginPath();
            stroke.points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
            if (stroke.points.length === 1) ctx.lineTo(stroke.points[0][0] + 0.1, stroke.points[0][1]);
            ctx.stroke();
        }
    }

    bindDrawing(canvas) {
        const point = (event) => {
            const rect = canvas.getBoundingClientRect();
            const factor = this.scale();
            const round = (n) => Math.round(n * 10) / 10;
            return [round((event.clientX - rect.left) / factor), round((event.clientY - rect.top) / factor)];
        };
        this.addEventListener(canvas, 'pointerdown', (event) => {
            canvas.setPointerCapture(event.pointerId);
            this.activeStroke = { color: this.color, width: this.width, points: [point(event)] };
            this.draw();
        });
        this.addEventListener(canvas, 'pointermove', (event) => {
            if (!this.activeStroke || this.activeStroke.points.length >= 5000) return;
            this.activeStroke.points.push(point(event));
            this.draw();
        });
        const finish = () => {
            if (!this.activeStroke) return;
            this.content.strokes.push(this.activeStroke);
            this.activeStroke = null;
            this.update({ strokes: this.content.strokes });
            this.draw();
        };
        this.addEventListener(canvas, 'pointerup', finish);
        this.addEventListener(canvas, 'pointercancel', finish);
    }

    destroy() {
        this.resizeObserver?.disconnect();
        super.destroy();
    }

    isEmpty() {
        return !this.content.strokes.length;
    }
}
