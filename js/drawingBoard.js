import { ACTION_ICONS } from './ui.js';

const STORAGE_KEY = 'matrix_global_drawing';
const PREFS_KEY = 'matrix_drawing_prefs';
const TOOLBAR_COLLAPSED_KEY = 'matrix_drawing_toolbar_collapsed';

const BRUSH_STYLES = ['pen', 'marker', 'highlighter', 'pencil'];
const DEFAULT_COLORS = ['#f1f5f9', '#fbbf24', '#22d3ee', '#f472b6', '#4ade80', '#fb923c', '#f87171', '#60a5fa'];
const WIDTH_MIN = 1;
const WIDTH_MAX = 48;
const HISTORY_MAX = 50;
const SAVE_DEBOUNCE_MS = 400;

const STYLE_CONFIG = {
    pen: { alpha: 1, widthMul: 1, pressureMin: 0.25, pressureRange: 0.75 },
    marker: { alpha: 0.85, widthMul: 1, pressureMin: 0.4, pressureRange: 0.6 },
    highlighter: { alpha: 0.35, widthMul: 1.8, pressureMin: 0.6, pressureRange: 0.4 },
    pencil: { alpha: 0.55, widthMul: 1, pressureMin: 0.25, pressureRange: 0.75, grain: true }
};

function createId() {
    return `stroke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function readPressure(event) {
    const p = event.pressure;
    if (typeof p === 'number' && p > 0) return Math.min(1, p);
    return 0.5;
}

function effectiveWidth(baseWidth, pressure, style) {
    const cfg = STYLE_CONFIG[style] || STYLE_CONFIG.pen;
    return baseWidth * cfg.widthMul * (cfg.pressureMin + cfg.pressureRange * pressure);
}

function readPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        const styles = {};
        BRUSH_STYLES.forEach((s) => {
            styles[s] = {
                width: Number.isFinite(raw?.styles?.[s]?.width) ? raw.styles[s].width : (s === 'highlighter' ? 12 : 3),
                color: raw?.styles?.[s]?.color || DEFAULT_COLORS[0]
            };
        });
        return {
            activeStyle: BRUSH_STYLES.includes(raw?.activeStyle) ? raw.activeStyle : 'pen',
            activeTool: ['brush', 'eraser', 'line', 'rect', 'ellipse'].includes(raw?.activeTool) ? raw.activeTool : 'brush',
            styles
        };
    } catch {
        const styles = {};
        BRUSH_STYLES.forEach((s) => {
            styles[s] = { width: s === 'highlighter' ? 12 : 3, color: DEFAULT_COLORS[0] };
        });
        return { activeStyle: 'pen', activeTool: 'brush', styles };
    }
}

function writePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function readDrawingData() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (!raw || raw.version !== 1 || !Array.isArray(raw.strokes)) {
            return { version: 1, strokes: [] };
        }
        return raw;
    } catch {
        return { version: 1, strokes: [] };
    }
}

function writeDrawingData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

class DrawingHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
    }

    push(snapshot) {
        this.undoStack.push(JSON.stringify(snapshot));
        if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
        this.redoStack = [];
    }

    undo(current) {
        if (!this.undoStack.length) return null;
        this.redoStack.push(JSON.stringify(current));
        return JSON.parse(this.undoStack.pop());
    }

    redo(current) {
        if (!this.redoStack.length) return null;
        this.undoStack.push(JSON.stringify(current));
        return JSON.parse(this.redoStack.pop());
    }

    clear() {
        this.undoStack = [];
        this.redoStack = [];
    }

    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
}

export const DrawingBoard = {
    active: false,
    canvas: null,
    ctx: null,
    boardEl: null,
    toolbarEl: null,
    controlBar: null,
    onExit: null,

    data: { version: 1, strokes: [] },
    prefs: readPrefs(),
    history: new DrawingHistory(),

    activeTool: 'brush',
    activeStyle: 'pen',
    penPointerActive: false,

    draftStroke: null,
    shapePreview: null,
    saveTimer: null,
    rafId: null,

    init({ onExit } = {}) {
        this.onExit = onExit;
        this.boardEl = document.getElementById('drawing-board');
        this.canvas = document.getElementById('drawing-canvas');
        this.controlBar = document.getElementById('control-bar');
        if (!this.canvas || !this.boardEl) return;

        this.ctx = this.canvas.getContext('2d');
        this.activeTool = this.prefs.activeTool;
        this.activeStyle = this.prefs.activeStyle;

        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        window.addEventListener('resize', () => {
            if (this.active) this.resize();
        });
        window.addEventListener('desktop:zoom_changed', () => {
            if (this.active) this.resize();
        });
    },

    activate(toolbarMount) {
        this.active = true;
        this.toolbarEl = toolbarMount;
        this.data = readDrawingData();
        this.prefs = readPrefs();
        this.activeTool = this.prefs.activeTool;
        this.activeStyle = this.prefs.activeStyle;

        this.boardEl.classList.remove('is-hidden');
        this.boardEl.setAttribute('aria-hidden', 'false');
        this.canvas.setAttribute('tabindex', '0');

        const collapsed = localStorage.getItem(TOOLBAR_COLLAPSED_KEY) === 'true';
        this.controlBar?.classList.add('is-drawing-toolbar');
        this.controlBar?.classList.toggle('is-toolbar-minimized', collapsed);

        this.renderToolbar();
        this.resize();
        this.redraw();
        this.updateToolbarState();
    },

    deactivate() {
        this.active = false;
        this.flushSave();
        this.boardEl?.classList.add('is-hidden');
        this.boardEl?.setAttribute('aria-hidden', 'true');
        this.controlBar?.classList.remove('is-drawing-toolbar', 'is-toolbar-minimized');
        this.toolbarEl = null;
        this.draftStroke = null;
        this.shapePreview = null;
    },

    getSnapshot() {
        return JSON.parse(JSON.stringify(this.data));
    },

    applySnapshot(snapshot) {
        this.data = JSON.parse(JSON.stringify(snapshot));
        this.redraw();
        this.scheduleSave();
        this.updateToolbarState();
    },

    clientToCanvas(clientX, clientY) {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) return { x: 0, y: 0 };
        return {
            x: (clientX - rect.left) * (this.canvas.width / rect.width),
            y: (clientY - rect.top) * (this.canvas.height / rect.height)
        };
    },

    resize() {
        if (!this.canvas || !this.boardEl) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = this.boardEl.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (this.canvas.width !== w || this.canvas.height !== h) {
            this.canvas.width = w;
            this.canvas.height = h;
            this.canvas.style.width = `${rect.width}px`;
            this.canvas.style.height = `${rect.height}px`;
            this.redraw();
        }
    },

    currentBrush() {
        const s = this.prefs.styles[this.activeStyle] || { width: 3, color: DEFAULT_COLORS[0] };
        return { width: s.width, color: s.color };
    },

    setStyle(style) {
        if (!BRUSH_STYLES.includes(style)) return;
        this.activeStyle = style;
        this.activeTool = 'brush';
        this.prefs.activeStyle = style;
        this.prefs.activeTool = 'brush';
        writePrefs(this.prefs);
        this.renderToolbar();
        this.updateToolbarState();
    },

    setTool(tool) {
        this.activeTool = tool;
        this.prefs.activeTool = tool;
        writePrefs(this.prefs);
        this.updateToolbarState();
    },

    adjustWidth(delta) {
        const style = this.activeStyle;
        const cur = this.prefs.styles[style]?.width ?? 3;
        const next = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, cur + delta));
        this.prefs.styles[style].width = next;
        writePrefs(this.prefs);
        this.renderToolbar();
        this.updateToolbarState();
    },

    setColor(color) {
        this.prefs.styles[this.activeStyle].color = color;
        writePrefs(this.prefs);
        this.renderToolbar();
        this.updateToolbarState();
    },

    onPointerDown(e) {
        if (!this.active || e.button > 0) return;
        if (e.pointerType === 'touch' && this.penPointerActive) return;

        if (e.pointerType === 'pen') this.penPointerActive = true;

        const { x, y } = this.clientToCanvas(e.clientX, e.clientY);
        this.canvas.setPointerCapture(e.pointerId);

        if (this.activeTool === 'eraser') {
            this.history.push(this.getSnapshot());
            this.eraseAt(x, y);
            this.scheduleSave();
            this.redraw();
            return;
        }

        if (this.activeTool === 'brush') {
            const brush = this.currentBrush();
            this.history.push(this.getSnapshot());
            this.draftStroke = {
                id: createId(),
                tool: 'brush',
                style: this.activeStyle,
                color: brush.color,
                width: brush.width,
                points: [{ x, y, p: readPressure(e), tiltX: e.tiltX || 0, tiltY: e.tiltY || 0 }]
            };
            return;
        }

        if (['line', 'rect', 'ellipse'].includes(this.activeTool)) {
            const brush = this.currentBrush();
            this.shapePreview = {
                id: createId(),
                tool: this.activeTool,
                style: this.activeStyle,
                color: brush.color,
                width: brush.width,
                x0: x, y0: y, x1: x, y1: y
            };
        }
    },

    onPointerMove(e) {
        if (!this.active) return;
        if (e.pointerType === 'touch' && this.penPointerActive) return;

        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];

        if (this.draftStroke) {
            events.forEach((ev) => {
                const { x, y } = this.clientToCanvas(ev.clientX, ev.clientY);
                this.draftStroke.points.push({
                    x, y, p: readPressure(ev), tiltX: ev.tiltX || 0, tiltY: ev.tiltY || 0
                });
            });
            this.requestRedraw();
            return;
        }

        if (this.shapePreview) {
            const { x, y } = this.clientToCanvas(e.clientX, e.clientY);
            this.shapePreview.x1 = x;
            this.shapePreview.y1 = y;
            this.requestRedraw();
            return;
        }

        if (this.activeTool === 'eraser' && (e.buttons & 1)) {
            const { x, y } = this.clientToCanvas(e.clientX, e.clientY);
            this.eraseAt(x, y);
            this.requestRedraw();
        }
    },

    onPointerUp(e) {
        if (e.pointerType === 'pen') this.penPointerActive = false;

        try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

        if (this.draftStroke) {
            if (this.draftStroke.points.length >= 1) {
                this.data.strokes.push(this.draftStroke);
                this.scheduleSave();
            }
            this.draftStroke = null;
            this.redraw();
            return;
        }

        if (this.shapePreview) {
            const s = this.shapePreview;
            const moved = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > 2;
            if (moved) {
                this.history.push(this.getSnapshot());
                this.data.strokes.push({ ...s });
                this.scheduleSave();
            }
            this.shapePreview = null;
            this.redraw();
        }
    },

    eraseAt(x, y, radius = 14) {
        const before = this.data.strokes.length;
        this.data.strokes = this.data.strokes.filter((stroke) => !this.hitStroke(stroke, x, y, radius));
        if (this.data.strokes.length !== before) this.scheduleSave();
    },

    hitStroke(stroke, x, y, radius) {
        if (stroke.tool === 'brush' && stroke.points?.length) {
            for (let i = 0; i < stroke.points.length; i++) {
                const pt = stroke.points[i];
                if (Math.hypot(pt.x - x, pt.y - y) <= radius + (stroke.width || 3)) return true;
            }
            return false;
        }
        const x0 = Math.min(stroke.x0, stroke.x1);
        const x1 = Math.max(stroke.x0, stroke.x1);
        const y0 = Math.min(stroke.y0, stroke.y1);
        const y1 = Math.max(stroke.y0, stroke.y1);
        return x >= x0 - radius && x <= x1 + radius && y >= y0 - radius && y <= y1 + radius;
    },

    requestRedraw() {
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            this.redraw();
        });
    },

    redraw() {
        if (!this.ctx || !this.canvas) return;
        const { width, height } = this.canvas;
        this.ctx.clearRect(0, 0, width, height);

        this.data.strokes.forEach((stroke) => this.drawStroke(stroke));
        if (this.draftStroke) this.drawStroke(this.draftStroke);
        if (this.shapePreview) this.drawStroke(this.shapePreview);
    },

    drawStroke(stroke) {
        const ctx = this.ctx;
        if (!ctx) return;

        if (stroke.tool === 'brush') {
            this.drawBrushStroke(stroke);
            return;
        }

        const cfg = STYLE_CONFIG[stroke.style] || STYLE_CONFIG.pen;
        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.lineWidth = (stroke.width || 2) * cfg.widthMul;
        ctx.globalAlpha = cfg.alpha;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const { x0, y0, x1, y1 } = stroke;

        ctx.beginPath();
        if (stroke.tool === 'line') {
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y1);
            ctx.stroke();
        } else if (stroke.tool === 'rect') {
            ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
        } else if (stroke.tool === 'ellipse') {
            const cx = (x0 + x1) / 2;
            const cy = (y0 + y1) / 2;
            const rx = Math.abs(x1 - x0) / 2;
            const ry = Math.abs(y1 - y0) / 2;
            ctx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();
    },

    drawBrushStroke(stroke) {
        const pts = stroke.points;
        if (!pts?.length) return;
        const cfg = STYLE_CONFIG[stroke.style] || STYLE_CONFIG.pen;
        const ctx = this.ctx;

        ctx.save();
        ctx.strokeStyle = stroke.color;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = cfg.alpha;

        if (pts.length === 1) {
            const w = effectiveWidth(stroke.width, pts[0].p, stroke.style);
            ctx.fillStyle = stroke.color;
            ctx.beginPath();
            ctx.arc(pts[0].x, pts[0].y, Math.max(w / 2, 0.5), 0, Math.PI * 2);
            ctx.fill();
            if (cfg.grain) this.drawPencilGrain(pts[0].x, pts[0].y, w);
            ctx.restore();
            return;
        }

        for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1];
            const b = pts[i];
            const w = effectiveWidth(stroke.width, (a.p + b.p) / 2, stroke.style);
            ctx.lineWidth = Math.max(w, 0.5);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
            if (cfg.grain) this.drawPencilGrain(b.x, b.y, w);
        }
        ctx.restore();
    },

    drawPencilGrain(x, y, w) {
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = '#ffffff';
        const r = Math.max(w * 0.3, 1);
        ctx.beginPath();
        ctx.arc(x + r * 0.3, y - r * 0.2, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },

    undo() {
        const prev = this.history.undo(this.getSnapshot());
        if (prev) {
            this.applySnapshot(prev);
            this.renderToolbar();
        }
    },

    redo() {
        const next = this.history.redo(this.getSnapshot());
        if (next) {
            this.applySnapshot(next);
            this.renderToolbar();
        }
    },

    clearAll() {
        if (!this.data.strokes.length) return;
        if (!confirm('Clear the entire drawing board?')) return;
        this.history.push(this.getSnapshot());
        this.data.strokes = [];
        this.redraw();
        this.scheduleSave();
        this.updateToolbarState();
    },

    scheduleSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
    },

    flushSave() {
        clearTimeout(this.saveTimer);
        writeDrawingData(this.data);
    },

    toggleToolbarMinimized() {
        const minimized = !this.controlBar?.classList.contains('is-toolbar-minimized');
        this.controlBar?.classList.toggle('is-toolbar-minimized', minimized);
        localStorage.setItem(TOOLBAR_COLLAPSED_KEY, minimized ? 'true' : 'false');
        this.renderToolbar();
        requestAnimationFrame(() => this.resize());
    },

    styleIcon(style) {
        const icons = {
            pen: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M8.8 1.2 10.8 3.2 4.6 9.4 2.2 9.8l.4-2.4 6.2-6.2z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
            marker: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.4 8.8h7.2M3.2 8.8l4-5.6 2.4 2.4-4 5.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
            highlighter: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2 9.2h8M3.6 9.2l3.2-6 2.4 2.4-3.2 6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
            pencil: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M7.6 1.6 10.4 4.4 4.2 10.6 1.8 10.8l.2-2.4 5.6-6.8z" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/></svg>'
        };
        return icons[style] || icons.pen;
    },

    toolIcon(tool) {
        const icons = {
            eraser: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.4 7.6 6.4 3.6l3.2 3.2-4 4H2.4z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/><path d="M5.6 10.8h4.8" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
            line: '<svg viewBox="0 0 12 12" width="12" height="12"><path d="M2.2 9.8 9.8 2.2" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
            rect: '<svg viewBox="0 0 12 12" width="12" height="12"><rect x="2.2" y="3.2" width="7.6" height="5.6" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
            ellipse: '<svg viewBox="0 0 12 12" width="12" height="12"><ellipse cx="6" cy="6" rx="4" ry="2.8" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>'
        };
        return icons[tool] || '';
    },

    renderToolbar() {
        if (!this.toolbarEl) return;
        const minimized = this.controlBar?.classList.contains('is-toolbar-minimized');
        const brush = this.currentBrush();

        if (minimized) {
            this.toolbarEl.innerHTML = `
                <button type="button" class="btn btn--compact btn--icon" id="draw-toolbar-expand" title="Expand toolbar" aria-label="Expand toolbar">${ACTION_ICONS.expandAll}</button>
                <span class="drawing-toolbar-summary" title="${this.activeStyle} · ${brush.width}px">
                    <span class="drawing-style-chip">${this.styleIcon(this.activeStyle)}</span>
                    <span class="drawing-color-chip" style="background:${brush.color}"></span>
                    <span class="drawing-width-label">${brush.width}px</span>
                </span>
                <button type="button" class="btn btn--compact btn--icon" id="draw-exit" title="Back to notes" aria-label="Back to notes">${ACTION_ICONS.drawingExit}</button>
            `;
        } else {
            const styleBtns = BRUSH_STYLES.map((s) =>
                `<button type="button" class="btn btn--compact btn--icon draw-style-btn${this.activeStyle === s && this.activeTool === 'brush' ? ' active' : ''}" data-style="${s}" title="${s}" aria-label="${s}">${this.styleIcon(s)}</button>`
            ).join('');

            const colorBtns = DEFAULT_COLORS.map((c) =>
                `<button type="button" class="drawing-color-swatch${brush.color === c ? ' is-active' : ''}" data-color="${c}" style="background:${c}" title="Color ${c}" aria-label="Color"></button>`
            ).join('');

            const toolBtns = ['eraser', 'line', 'rect', 'ellipse'].map((t) =>
                `<button type="button" class="btn btn--compact btn--icon draw-tool-btn${this.activeTool === t ? ' active' : ''}" data-tool="${t}" title="${t}" aria-label="${t}">${this.toolIcon(t)}</button>`
            ).join('');

            this.toolbarEl.innerHTML = `
                <button type="button" class="btn btn--compact btn--icon" id="draw-exit" title="Back to notes" aria-label="Back to notes">${ACTION_ICONS.drawingExit}</button>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <div class="drawing-toolbar-group" role="group" aria-label="Brush style">${styleBtns}</div>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <div class="drawing-toolbar-group drawing-width-control" role="group" aria-label="Stroke width">
                    <button type="button" class="btn btn--compact btn--icon" id="draw-width-down" title="Thinner" aria-label="Thinner">−</button>
                    <span class="drawing-width-label" id="draw-width-label">${brush.width}px</span>
                    <button type="button" class="btn btn--compact btn--icon" id="draw-width-up" title="Thicker" aria-label="Thicker">+</button>
                </div>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <div class="drawing-toolbar-group drawing-color-row" role="group" aria-label="Color">${colorBtns}
                    <input type="color" id="draw-color-custom" class="drawing-color-input" value="${brush.color}" title="Custom color" aria-label="Custom color">
                </div>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <div class="drawing-toolbar-group" role="group" aria-label="Tools">${toolBtns}</div>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <button type="button" class="btn btn--compact btn--icon" id="draw-undo" title="Undo (Ctrl+Z)" aria-label="Undo" ${this.history.canUndo ? '' : 'disabled'}>${ACTION_ICONS.undo}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-redo" title="Redo (Ctrl+Y)" aria-label="Redo" ${this.history.canRedo ? '' : 'disabled'}>${ACTION_ICONS.redo}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-clear" title="Clear board" aria-label="Clear board">${ACTION_ICONS.layoutReset}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-toolbar-minimize" title="Minimize toolbar" aria-label="Minimize toolbar">${ACTION_ICONS.collapseAll}</button>
            `;
        }

        this.bindToolbar();
    },

    bindToolbar() {
        if (!this.toolbarEl) return;

        this.toolbarEl.querySelector('#draw-exit')?.addEventListener('click', () => this.onExit?.());
        this.toolbarEl.querySelector('#draw-toolbar-expand')?.addEventListener('click', () => this.toggleToolbarMinimized());
        this.toolbarEl.querySelector('#draw-toolbar-minimize')?.addEventListener('click', () => this.toggleToolbarMinimized());
        this.toolbarEl.querySelector('#draw-undo')?.addEventListener('click', () => this.undo());
        this.toolbarEl.querySelector('#draw-redo')?.addEventListener('click', () => this.redo());
        this.toolbarEl.querySelector('#draw-clear')?.addEventListener('click', () => this.clearAll());
        this.toolbarEl.querySelector('#draw-width-down')?.addEventListener('click', () => this.adjustWidth(-1));
        this.toolbarEl.querySelector('#draw-width-up')?.addEventListener('click', () => this.adjustWidth(1));

        this.toolbarEl.querySelectorAll('.draw-style-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.setStyle(btn.dataset.style));
        });
        this.toolbarEl.querySelectorAll('.draw-tool-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
        });
        this.toolbarEl.querySelectorAll('.drawing-color-swatch').forEach((btn) => {
            btn.addEventListener('click', () => this.setColor(btn.dataset.color));
        });
        this.toolbarEl.querySelector('#draw-color-custom')?.addEventListener('input', (e) => {
            this.setColor(e.target.value);
        });
    },

    updateToolbarState() {
        if (!this.toolbarEl) return;
        this.toolbarEl.querySelector('#draw-undo')?.toggleAttribute('disabled', !this.history.canUndo);
        this.toolbarEl.querySelector('#draw-redo')?.toggleAttribute('disabled', !this.history.canRedo);
        this.toolbarEl.querySelectorAll('.draw-style-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.style === this.activeStyle && this.activeTool === 'brush');
        });
        this.toolbarEl.querySelectorAll('.draw-tool-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tool === this.activeTool);
        });
        const brush = this.currentBrush();
        const label = this.toolbarEl.querySelector('#draw-width-label');
        if (label) label.textContent = `${brush.width}px`;
    },

    handleKeydown(e) {
        if (!this.active) return false;
        if (!(e.ctrlKey || e.metaKey)) return false;
        if (e.key === 'z' && !e.shiftKey) {
            e.preventDefault();
            this.undo();
            return true;
        }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
            e.preventDefault();
            this.redo();
            return true;
        }
        return false;
    }
};

export function getDrawingBackupKeys() {
    return {
        matrix_global_drawing: localStorage.getItem(STORAGE_KEY),
        matrix_drawing_prefs: localStorage.getItem(PREFS_KEY),
        matrix_workspace_mode: localStorage.getItem('matrix_workspace_mode'),
        matrix_drawing_toolbar_collapsed: localStorage.getItem(TOOLBAR_COLLAPSED_KEY)
    };
}

export function applyDrawingBackupKeys(backup) {
    if (backup.matrix_global_drawing != null) {
        localStorage.setItem(STORAGE_KEY, typeof backup.matrix_global_drawing === 'string'
            ? backup.matrix_global_drawing
            : JSON.stringify(backup.matrix_global_drawing));
    }
    if (backup.matrix_drawing_prefs != null) {
        localStorage.setItem(PREFS_KEY, typeof backup.matrix_drawing_prefs === 'string'
            ? backup.matrix_drawing_prefs
            : JSON.stringify(backup.matrix_drawing_prefs));
    }
    if (backup.matrix_workspace_mode != null) {
        localStorage.setItem('matrix_workspace_mode', backup.matrix_workspace_mode);
    }
    if (backup.matrix_drawing_toolbar_collapsed != null) {
        localStorage.setItem(TOOLBAR_COLLAPSED_KEY, backup.matrix_drawing_toolbar_collapsed);
    }
}
