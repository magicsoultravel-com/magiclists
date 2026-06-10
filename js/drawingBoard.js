import { ACTION_ICONS, DRAWING_ICONS } from './ui.js';
import { ColorPicker, PALETTE_DRAWING } from './colorPicker.js';
import {
    readDocument, writeDocument, getActiveStrokes, getActiveTexts, setActiveStrokes,
    getActiveBackground, setActiveBackground, getPageDimensions, addPage, nextPage, prevPage,
    expandInfiniteBounds, STORAGE_KEY, createId, CANVAS_MODES, BACKGROUNDS
} from './canvasDocument.js';
import { BRUSH_STYLES, drawBrushStroke, drawShapeStroke, drawTextObject } from './canvasBrushes.js';
import { renderBackground } from './canvasBackgrounds.js';
import { CanvasViewport } from './canvasViewport.js';
import { exportCanvasJson, exportCanvasPng, exportCanvasPdf } from './canvasExport.js';

const PREFS_KEY = 'matrix_drawing_prefs';
const TOOLBAR_HIDDEN_KEY = 'matrix_drawing_toolbar_hidden';
const WIDTH_MIN = 1;
const WIDTH_MAX = 48;
const HISTORY_MAX = 50;
const SAVE_DEBOUNCE_MS = 400;

function readPressure(event) {
    const p = event.pressure;
    if (typeof p === 'number' && p > 0) return Math.min(1, p);
    return 0.5;
}

function readPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        const styles = {};
        BRUSH_STYLES.forEach((s) => {
            styles[s] = {
                width: Number.isFinite(raw?.styles?.[s]?.width) ? raw.styles[s].width : (s === 'highlighter' ? 12 : 3),
                color: raw?.styles?.[s]?.color || '#f8fafc'
            };
        });
        return {
            activeStyle: BRUSH_STYLES.includes(raw?.activeStyle) ? raw.activeStyle : 'pen',
            activeTool: ['brush', 'eraser', 'line', 'rect', 'ellipse', 'text'].includes(raw?.activeTool) ? raw.activeTool : 'brush',
            styles
        };
    } catch {
        const styles = {};
        BRUSH_STYLES.forEach((s) => { styles[s] = { width: s === 'highlighter' ? 12 : 3, color: '#f8fafc' }; });
        return { activeStyle: 'pen', activeTool: 'brush', styles };
    }
}

function writePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
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
    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
}

export const DrawingBoard = {
    active: false,
    doc: null,
    prefs: readPrefs(),
    history: new DrawingHistory(),
    canvas: null,
    bgCanvas: null,
    ctx: null,
    bgCtx: null,
    boardEl: null,
    viewportEl: null,
    innerEl: null,
    textLayer: null,
    toolbarEl: null,
    toolbarFab: null,
    controlBar: null,
    onExit: null,
    activeTool: 'brush',
    activeStyle: 'pen',
    penPointerActive: false,
    draftStroke: null,
    shapePreview: null,
    saveTimer: null,
    rafId: null,
    brandEl: null,
    brandNotesText: 'magicNotes',

    init({ onExit } = {}) {
        this.onExit = onExit;
        this.boardEl = document.getElementById('drawing-board');
        this.canvas = document.getElementById('drawing-canvas');
        this.bgCanvas = document.getElementById('drawing-bg-canvas');
        this.viewportEl = document.getElementById('canvas-viewport');
        this.innerEl = document.getElementById('canvas-viewport-inner');
        this.textLayer = document.getElementById('canvas-text-layer');
        this.toolbarFab = document.getElementById('canvas-toolbar-fab');
        this.controlBar = document.getElementById('control-bar');
        this.brandEl = document.getElementById('app-brand');
        if (this.brandEl) this.brandNotesText = this.brandEl.textContent || 'magicNotes';

        if (!this.canvas || !this.boardEl) return;
        this.ctx = this.canvas.getContext('2d');
        this.bgCtx = this.bgCanvas?.getContext('2d');

        CanvasViewport.init(this.innerEl, this.viewportEl);

        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        this.toolbarFab?.addEventListener('click', () => this.showToolbar());
        window.addEventListener('resize', () => { if (this.active) this.resize(); });
    },

    activate(toolbarMount) {
        this.active = true;
        this.toolbarEl = toolbarMount;
        this.doc = readDocument();
        this.prefs = readPrefs();
        this.activeTool = this.prefs.activeTool;
        this.activeStyle = this.prefs.activeStyle;

        if (this.brandEl) this.brandEl.textContent = 'magicCanvas';

        this.boardEl.classList.remove('is-hidden');
        this.boardEl.setAttribute('aria-hidden', 'false');

        this.controlBar?.classList.add('is-drawing-toolbar');
        const hidden = localStorage.getItem(TOOLBAR_HIDDEN_KEY) === 'true';
        if (hidden) this.hideToolbar(); else this.showToolbar(false);

        CanvasViewport.loadFromDoc(this.doc.viewport);
        this.renderToolbar();
        this.resize();
        this.redraw();
    },

    deactivate() {
        this.active = false;
        this.flushSave();
        if (this.brandEl) this.brandEl.textContent = this.brandNotesText;
        this.boardEl?.classList.add('is-hidden');
        this.boardEl?.setAttribute('aria-hidden', 'true');
        this.controlBar?.classList.remove('is-drawing-toolbar', 'is-toolbar-hidden');
        this.toolbarFab?.classList.add('is-hidden');
        this.textLayer.innerHTML = '';
        this.toolbarEl = null;
        this.draftStroke = null;
        this.shapePreview = null;
    },

    hideToolbar() {
        this.controlBar?.classList.add('is-toolbar-hidden');
        this.toolbarFab?.classList.remove('is-hidden');
        if (this.toolbarFab) this.toolbarFab.innerHTML = ACTION_ICONS.expandAll;
        localStorage.setItem(TOOLBAR_HIDDEN_KEY, 'true');
        requestAnimationFrame(() => this.resize());
    },

    showToolbar(render = true) {
        this.controlBar?.classList.remove('is-toolbar-hidden');
        this.toolbarFab?.classList.add('is-hidden');
        localStorage.setItem(TOOLBAR_HIDDEN_KEY, 'false');
        if (render) this.renderToolbar();
        requestAnimationFrame(() => this.resize());
    },

    getSnapshot() {
        return JSON.parse(JSON.stringify(this.doc));
    },

    applySnapshot(snapshot) {
        this.doc = JSON.parse(JSON.stringify(snapshot));
        this.redraw();
        this.scheduleSave();
        this.updateToolbarState();
    },

    strokes() {
        return getActiveStrokes(this.doc);
    },

    setStrokes(strokes) {
        setActiveStrokes(this.doc, strokes);
    },

    clientToCanvas(clientX, clientY) {
        return CanvasViewport.screenToWorld(clientX, clientY, this.canvas);
    },

    resize() {
        if (!this.canvas || !this.boardEl) return;
        const dims = getPageDimensions(this.doc);
        const dpr = window.devicePixelRatio || 1;
        const cssW = dims.width / dpr;
        const cssH = dims.height / dpr;

        [this.canvas, this.bgCanvas].forEach((c) => {
            if (!c) return;
            c.width = dims.width;
            c.height = dims.height;
            c.style.width = cssW + 'px';
            c.style.height = cssH + 'px';
        });
        if (this.innerEl) {
            this.innerEl.style.width = cssW + 'px';
            this.innerEl.style.height = cssH + 'px';
        }
        this.redrawBackground();
        this.redraw();
    },

    redrawBackground() {
        if (!this.bgCtx || !this.bgCanvas) return;
        renderBackground(this.bgCtx, getActiveBackground(this.doc), this.bgCanvas.width, this.bgCanvas.height);
    },

    currentBrush() {
        const s = this.prefs.styles[this.activeStyle] || { width: 3, color: '#f8fafc' };
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
        this.prefs.styles[style].width = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, cur + delta));
        writePrefs(this.prefs);
        this.renderToolbar();
    },

    setColor(color) {
        this.prefs.styles[this.activeStyle].color = color;
        writePrefs(this.prefs);
        this.renderToolbar();
    },

    openColorPicker(anchor) {
        const brush = this.currentBrush();
        ColorPicker.open({
            anchor,
            presets: PALETTE_DRAWING,
            value: brush.color,
            align: 'end',
            onSelect: (c) => this.setColor(c)
        });
    },

    onPointerDown(e) {
        if (!this.active || e.button > 0) return;
        if (CanvasViewport.panning || CanvasViewport.spaceHeld) return;
        if (e.pointerType === 'touch' && this.penPointerActive) return;
        if (e.pointerType === 'pen') this.penPointerActive = true;

        const { x, y } = this.clientToCanvas(e.clientX, e.clientY);
        if (this.doc.canvasMode === 'infinite') expandInfiniteBounds(this.doc, x, y);

        this.canvas.setPointerCapture(e.pointerId);

        if (this.activeTool === 'text') {
            this.placeTextBox(x, y);
            return;
        }

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
                id: createId('stroke'),
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
                id: createId('stroke'),
                tool: this.activeTool,
                style: this.activeStyle,
                color: brush.color,
                width: brush.width,
                x0: x, y0: y, x1: x, y1: y
            };
        }
    },

    onPointerMove(e) {
        if (!this.active || CanvasViewport.panning) return;
        if (e.pointerType === 'touch' && this.penPointerActive) return;
        const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];

        if (this.draftStroke) {
            events.forEach((ev) => {
                const pt = this.clientToCanvas(ev.clientX, ev.clientY);
                this.draftStroke.points.push({
                    x: pt.x, y: pt.y, p: readPressure(ev), tiltX: ev.tiltX || 0, tiltY: ev.tiltY || 0
                });
            });
            this.requestRedraw();
            return;
        }
        if (this.shapePreview) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            this.shapePreview.x1 = pt.x;
            this.shapePreview.y1 = pt.y;
            this.requestRedraw();
            return;
        }
        if (this.activeTool === 'eraser' && (e.buttons & 1)) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            this.eraseAt(pt.x, pt.y);
            this.requestRedraw();
        }
    },

    onPointerUp(e) {
        if (e.pointerType === 'pen') this.penPointerActive = false;
        try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

        if (this.draftStroke) {
            if (this.draftStroke.points.length >= 1) {
                const s = this.strokes();
                s.push(this.draftStroke);
                this.setStrokes(s);
                this.scheduleSave();
            }
            this.draftStroke = null;
            this.redraw();
            return;
        }
        if (this.shapePreview) {
            const s = this.shapePreview;
            if (Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > 2) {
                this.history.push(this.getSnapshot());
                const strokes = this.strokes();
                strokes.push({ ...s });
                this.setStrokes(strokes);
                this.scheduleSave();
            }
            this.shapePreview = null;
            this.redraw();
        }
    },

    placeTextBox(x, y) {
        const brush = this.currentBrush();
        const dpr = window.devicePixelRatio || 1;
        const el = document.createElement('div');
        el.className = 'canvas-text-box';
        el.contentEditable = 'true';
        el.dataset.placeholder = 'Type…';
        el.style.left = (x / dpr) + 'px';
        el.style.top = (y / dpr) + 'px';
        el.style.color = brush.color;
        el.style.fontSize = Math.max(16, brush.width * 4) + 'px';
        this.textLayer.appendChild(el);
        el.focus();

        const commit = () => {
            const text = el.innerText.trim();
            el.remove();
            if (!text) return;
            this.history.push(this.getSnapshot());
            const texts = getActiveTexts(this.doc);
            texts.push({
                id: createId('text'),
                tool: 'text',
                x, y,
                text,
                fontSize: Math.max(16, brush.width * 4) * dpr,
                color: brush.color,
                fontFamily: 'Inter, sans-serif'
            });
            if (this.doc.canvasMode === 'infinite') this.doc.infinite.texts = texts;
            else { const page = this.doc.pages.find((p) => p.id === this.doc.activePageId); if (page) page.texts = texts; }
            this.scheduleSave();
            this.redraw();
        };
        el.addEventListener('blur', commit, { once: true });
        el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { el.innerText = ''; el.blur(); }
        });
    },

    eraseAt(x, y, radius = 14) {
        const strokes = this.strokes().filter((stroke) => !this.hitStroke(stroke, x, y, radius));
        if (strokes.length !== this.strokes().length) {
            this.setStrokes(strokes);
            this.scheduleSave();
        }
    },

    hitStroke(stroke, x, y, radius) {
        if (stroke.tool === 'brush' && stroke.points?.length) {
            return stroke.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) <= radius + (stroke.width || 3));
        }
        if (stroke.tool === 'text') {
            return x >= stroke.x - radius && x <= stroke.x + 200 && y >= stroke.y - radius && y <= stroke.y + 60;
        }
        const x0 = Math.min(stroke.x0, stroke.x1);
        const x1 = Math.max(stroke.x0, stroke.x1);
        const y0 = Math.min(stroke.y0, stroke.y1);
        const y1 = Math.max(stroke.y0, stroke.y1);
        return x >= x0 - radius && x <= x1 + radius && y >= y0 - radius && y <= y1 + radius;
    },

    requestRedraw() {
        if (this.rafId) return;
        this.rafId = requestAnimationFrame(() => { this.rafId = null; this.redraw(); });
    },

    redraw() {
        if (!this.ctx || !this.canvas) return;
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.strokes().forEach((stroke) => {
            if (stroke.tool === 'brush') drawBrushStroke(this.ctx, stroke);
            else drawShapeStroke(this.ctx, stroke);
        });
        getActiveTexts(this.doc).forEach((t) => drawTextObject(this.ctx, t));
        if (this.draftStroke) drawBrushStroke(this.ctx, this.draftStroke);
        if (this.shapePreview) drawShapeStroke(this.ctx, this.shapePreview);
    },

    undo() {
        const prev = this.history.undo(this.getSnapshot());
        if (prev) { this.applySnapshot(prev); this.renderToolbar(); }
    },

    redo() {
        const next = this.history.redo(this.getSnapshot());
        if (next) { this.applySnapshot(next); this.renderToolbar(); }
    },

    clearAll() {
        if (!this.strokes().length && !getActiveTexts(this.doc).length) return;
        if (!confirm('Clear the current canvas page?')) return;
        this.history.push(this.getSnapshot());
        this.setStrokes([]);
        if (this.doc.canvasMode === 'infinite') this.doc.infinite.texts = [];
        else { const page = this.doc.pages.find((p) => p.id === this.doc.activePageId); if (page) page.texts = []; }
        this.redraw();
        this.scheduleSave();
    },

    scheduleSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
    },

    flushSave() {
        clearTimeout(this.saveTimer);
        this.doc.viewport = CanvasViewport.toDoc();
        writeDocument(this.doc);
    },

    setCanvasMode(mode) {
        if (!CANVAS_MODES.includes(mode)) return;
        this.history.push(this.getSnapshot());
        this.doc.canvasMode = mode;
        if (mode !== 'infinite') {
            const page = this.doc.pages.find((p) => p.id === this.doc.activePageId) || this.doc.pages[0];
            if (page) page.format = mode;
        }
        this.resize();
        this.scheduleSave();
        this.renderToolbar();
    },

    setBackground(bg) {
        if (!BACKGROUNDS.includes(bg)) return;
        setActiveBackground(this.doc, bg);
        this.redrawBackground();
        this.scheduleSave();
        this.renderToolbar();
    },

    pageLabel() {
        const idx = this.doc.pages.findIndex((p) => p.id === this.doc.activePageId);
        return (idx + 1) + ' / ' + this.doc.pages.length;
    },

    renderToolbar() {
        if (!this.toolbarEl) return;
        const brush = this.currentBrush();
        const styleBtns = BRUSH_STYLES.map((s) =>
            `<button type="button" class="btn btn--compact btn--icon draw-style-btn${this.activeStyle === s && this.activeTool === 'brush' ? ' active' : ''}" data-style="${s}" title="${s}" aria-label="${s}">${DRAWING_ICONS[s] || ''}</button>`
        ).join('');
        const toolBtns = ['eraser', 'line', 'rect', 'ellipse', 'text'].map((t) =>
            `<button type="button" class="btn btn--compact btn--icon draw-tool-btn${this.activeTool === t ? ' active' : ''}" data-tool="${t}" title="${t}" aria-label="${t}">${DRAWING_ICONS[t] || ''}</button>`
        ).join('');
        const modeBtns = ['a4', 'a5', 'a3', 'infinite'].map((m) =>
            `<button type="button" class="btn btn--compact btn--icon draw-mode-btn${this.doc.canvasMode === m ? ' active' : ''}" data-mode="${m}" title="${m}" aria-label="${m}">${m === 'infinite' ? '∞' : m.toUpperCase()}</button>`
        ).join('');
        const bgBtns = ['blank', 'grid', 'notebook', 'staff'].map((b) =>
            `<button type="button" class="btn btn--compact btn--icon draw-bg-btn${getActiveBackground(this.doc) === b ? ' active' : ''}" data-bg="${b}" title="${b}" aria-label="${b}">${DRAWING_ICONS[b === 'blank' ? 'rect' : b] || ''}</button>`
        ).join('');

        this.toolbarEl.innerHTML = `
            <button type="button" class="btn btn--compact btn--icon" id="draw-exit" title="Back to notes" aria-label="Back to notes">${ACTION_ICONS.drawingExit}</button>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <div class="drawing-toolbar-group" role="group" aria-label="Brush style">${styleBtns}</div>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <div class="drawing-toolbar-group drawing-width-control">
                <button type="button" class="btn btn--compact btn--icon" id="draw-width-down" title="Thinner" aria-label="Thinner">−</button>
                <span class="drawing-width-label" id="draw-width-label">${brush.width}px</span>
                <button type="button" class="btn btn--compact btn--icon" id="draw-width-up" title="Thicker" aria-label="Thicker">+</button>
            </div>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="btn btn--compact btn--icon drawing-color-chip-btn" id="draw-color-btn" title="Color" aria-label="Color" style="--chip-color:${brush.color}"><span class="drawing-color-chip" style="background:${brush.color}"></span></button>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <div class="drawing-toolbar-group">${toolBtns}</div>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <div class="drawing-toolbar-group">${modeBtns}</div>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <div class="drawing-toolbar-group">${bgBtns}</div>
            ${this.doc.canvasMode !== 'infinite' ? `<span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="btn btn--compact btn--icon" id="draw-page-prev" title="Previous page" aria-label="Previous page">${DRAWING_ICONS.pagePrev}</button>
            <span class="drawing-width-label" id="draw-page-label">${this.pageLabel()}</span>
            <button type="button" class="btn btn--compact btn--icon" id="draw-page-next" title="Next page" aria-label="Next page">${DRAWING_ICONS.pageNext}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-page-add" title="Add page" aria-label="Add page">${DRAWING_ICONS.pageAdd}</button>` : ''}
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="btn btn--compact btn--icon" id="draw-zoom-out" title="Zoom out" aria-label="Zoom out">${DRAWING_ICONS.zoomOut}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-zoom-in" title="Zoom in" aria-label="Zoom in">${DRAWING_ICONS.zoomIn}</button>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="btn btn--compact btn--icon" id="draw-undo" title="Undo" aria-label="Undo" ${this.history.canUndo ? '' : 'disabled'}>${ACTION_ICONS.undo}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-redo" title="Redo" aria-label="Redo" ${this.history.canRedo ? '' : 'disabled'}>${ACTION_ICONS.redo}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-clear" title="Clear" aria-label="Clear">${ACTION_ICONS.layoutReset}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-export-png" title="Export PNG" aria-label="Export PNG">${DRAWING_ICONS.exportPng}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-export-pdf" title="Export PDF" aria-label="Export PDF">${ACTION_ICONS.export}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-export-json" title="Export JSON" aria-label="Export JSON">${ACTION_ICONS.export}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-toolbar-hide" title="Hide toolbar" aria-label="Hide toolbar">${ACTION_ICONS.collapseAll}</button>
        `;
        this.bindToolbar();
    },

    bindToolbar() {
        if (!this.toolbarEl) return;
        const q = (sel) => this.toolbarEl.querySelector(sel);

        q('#draw-exit')?.addEventListener('click', () => this.onExit?.());
        q('#draw-toolbar-hide')?.addEventListener('click', () => this.hideToolbar());
        q('#draw-undo')?.addEventListener('click', () => this.undo());
        q('#draw-redo')?.addEventListener('click', () => this.redo());
        q('#draw-clear')?.addEventListener('click', () => this.clearAll());
        q('#draw-width-down')?.addEventListener('click', () => this.adjustWidth(-1));
        q('#draw-width-up')?.addEventListener('click', () => this.adjustWidth(1));
        q('#draw-color-btn')?.addEventListener('click', (e) => this.openColorPicker(e.currentTarget));
        q('#draw-zoom-in')?.addEventListener('click', () => { CanvasViewport.stepZoom(0.1); this.doc.viewport = CanvasViewport.toDoc(); });
        q('#draw-zoom-out')?.addEventListener('click', () => { CanvasViewport.stepZoom(-0.1); this.doc.viewport = CanvasViewport.toDoc(); });
        q('#draw-export-png')?.addEventListener('click', () => exportCanvasPng());
        q('#draw-export-pdf')?.addEventListener('click', () => exportCanvasPdf());
        q('#draw-export-json')?.addEventListener('click', () => exportCanvasJson());
        q('#draw-page-prev')?.addEventListener('click', () => { if (prevPage(this.doc)) { this.resize(); this.scheduleSave(); this.renderToolbar(); } });
        q('#draw-page-next')?.addEventListener('click', () => { if (nextPage(this.doc)) { this.resize(); this.scheduleSave(); this.renderToolbar(); } });
        q('#draw-page-add')?.addEventListener('click', () => { addPage(this.doc); this.resize(); this.scheduleSave(); this.renderToolbar(); });

        this.toolbarEl.querySelectorAll('.draw-style-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.setStyle(btn.dataset.style));
        });
        this.toolbarEl.querySelectorAll('.draw-tool-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.setTool(btn.dataset.tool));
        });
        this.toolbarEl.querySelectorAll('.draw-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.setCanvasMode(btn.dataset.mode));
        });
        this.toolbarEl.querySelectorAll('.draw-bg-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.setBackground(btn.dataset.bg));
        });
    },

    updateToolbarState() {
        if (!this.toolbarEl) return;
        this.toolbarEl.querySelector('#draw-undo')?.toggleAttribute('disabled', !this.history.canUndo);
        this.toolbarEl.querySelector('#draw-redo')?.toggleAttribute('disabled', !this.history.canRedo);
        const label = this.toolbarEl.querySelector('#draw-width-label');
        if (label) label.textContent = this.currentBrush().width + 'px';
        const pageLabel = this.toolbarEl.querySelector('#draw-page-label');
        if (pageLabel) pageLabel.textContent = this.pageLabel();
    },

    handleKeydown(e) {
        if (!this.active) return false;
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return true; }
            if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); return true; }
        }
        return false;
    }
};

export function getDrawingBackupKeys() {
    return {
        matrix_global_drawing: localStorage.getItem(STORAGE_KEY),
        matrix_drawing_prefs: localStorage.getItem(PREFS_KEY),
        matrix_workspace_mode: localStorage.getItem('matrix_workspace_mode'),
        matrix_drawing_toolbar_hidden: localStorage.getItem(TOOLBAR_HIDDEN_KEY),
        matrix_canvas_viewport: localStorage.getItem('matrix_canvas_viewport')
    };
}

export function applyDrawingBackupKeys(backup) {
    if (backup.matrix_global_drawing != null) {
        localStorage.setItem(STORAGE_KEY, typeof backup.matrix_global_drawing === 'string'
            ? backup.matrix_global_drawing : JSON.stringify(backup.matrix_global_drawing));
    }
    if (backup.matrix_drawing_prefs != null) {
        localStorage.setItem(PREFS_KEY, typeof backup.matrix_drawing_prefs === 'string'
            ? backup.matrix_drawing_prefs : JSON.stringify(backup.matrix_drawing_prefs));
    }
    if (backup.matrix_workspace_mode != null) localStorage.setItem('matrix_workspace_mode', backup.matrix_workspace_mode);
    if (backup.matrix_drawing_toolbar_hidden != null) localStorage.setItem(TOOLBAR_HIDDEN_KEY, backup.matrix_drawing_toolbar_hidden);
}
