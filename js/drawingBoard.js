/** @module {"owns":"magicCanvas drawing board, workspace drawing mode", "related":["canvasDocument.js","drawingToolbarMenu.js","layoutStorage.js"]} */
import { ACTION_ICONS, DRAWING_ICONS } from './icons.js';
import { ColorPicker, PALETTE_UNIFIED } from './colorPicker.js';
import { DrawingToolbarMenu, CHEVRON } from './drawingToolbarMenu.js';
import { DisplayOptions } from './displayOptions.js';
import { Fullscreen } from './fullscreen.js';
import {
    readDocument, writeDocument, getActiveStrokes, getActiveTexts, setActiveStrokes, setActiveTexts,
    getActiveBackground, setActiveBackground, getActiveBackgroundColor, setActiveBackgroundColor,
    getPageDimensions, addPage, nextPage, prevPage,
    expandInfiniteBounds, STORAGE_KEY, createId, CANVAS_MODES, BACKGROUNDS
} from './canvasDocument.js';
import { BRUSH_STYLES, drawBrushStroke, drawShapeStroke, drawTextObject } from './canvasBrushes.js';
import { renderBackground } from './canvasBackgrounds.js';
import { CanvasViewport } from './canvasViewport.js';
import { exportCanvasPng, exportCanvasPdf } from './canvasExport.js';
import { DrawingToolbarChrome } from './drawingToolbarChrome.js';
import {
    isPointInPolygon,
    strokeHasPointInPolygon,
    getStrokesBounds,
    clampStrokesToBounds,
    translateStrokes,
    getPageBounds,
    rectToPolygon
} from './lassoGeometry.js';

const PREFS_KEY = 'matrix_drawing_prefs';
const WIDTH_MIN = 1;
const WIDTH_MAX = 48;
const DEFAULT_WIDTH = 10;
const HIGHLIGHTER_WIDTH = 14;
const HISTORY_MAX = 50;
const SAVE_DEBOUNCE_MS = 400;

const POINTER_ITEMS = [
    { id: 'pen', label: 'Pen' },
    { id: 'marker', label: 'Marker' },
    { id: 'highlighter', label: 'Highlighter' },
    { id: 'pencil', label: 'Pencil' },
    { id: 'spray', label: 'Spray' },
    { id: 'calligraphy', label: 'Calligraphy' },
    { id: 'brush', label: 'Brush' },
    { id: 'eraser', label: 'Eraser' }
];

const DRAG_SHAPE_TOOLS = [
    'line', 'arrow', 'rect', 'rounded_rect', 'ellipse', 'triangle', 'diamond',
    'star', 'chevron', 'trapezoid', 'parallelogram', 'cube', 'pyramid', 'cylinder', 'sphere'
];

const SHAPE_ITEMS = [
    { id: 'line', label: 'Line' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'rect', label: 'Rectangle' },
    { id: 'rounded_rect', label: 'Rounded rectangle' },
    { id: 'ellipse', label: 'Ellipse' },
    { id: 'triangle', label: 'Triangle' },
    { id: 'diamond', label: 'Diamond' },
    { id: 'star', label: 'Star' },
    { id: 'chevron', label: 'Chevron' },
    { id: 'trapezoid', label: 'Trapezoid' },
    { id: 'parallelogram', label: 'Parallelogram' },
    { id: 'cube', label: 'Cube' },
    { id: 'pyramid', label: 'Pyramid' },
    { id: 'cylinder', label: 'Cylinder' },
    { id: 'sphere', label: 'Sphere' },
    { id: 'text', label: 'Text' }
];

const GRID_BACKGROUNDS = [
    { id: 'grid', label: 'Grid' },
    { id: 'dots', label: 'Dot grid' },
    { id: 'graph', label: 'Graph paper' },
    { id: 'coarse', label: 'Coarse grid' },
    { id: 'isometric', label: 'Isometric' },
    { id: 'hex', label: 'Hex grid' }
];

const WRITING_BACKGROUNDS = [
    { id: 'ruled', label: 'Ruled' },
    { id: 'notebook', label: 'Notebook' },
    { id: 'staff', label: 'Staff' },
    { id: 'football', label: 'Football' }
];

function isDragShape(tool) {
    return DRAG_SHAPE_TOOLS.includes(tool);
}

const FORMAT_ITEMS = [
    { id: 'a4', label: 'A4 page' },
    { id: 'a5', label: 'A5 page' },
    { id: 'a3', label: 'A3 page' },
    { id: 'infinite', label: 'Infinite canvas' }
];

const EXPORT_ITEMS = [
    { id: 'export-png', label: 'Export PNG' },
    { id: 'export-pdf', label: 'Export PDF' }
];

function defaultWidthForStyle(style) {
    return style === 'highlighter' ? HIGHLIGHTER_WIDTH : DEFAULT_WIDTH;
}

function readPressure(event) {
    const p = event.pressure;
    if (event.pointerType === 'pen') {
        if (typeof p === 'number' && p > 0) return Math.min(1, p);
        return 0.05;
    }
    if (typeof p === 'number' && p > 0) return Math.min(1, p);
    return 0.5;
}

function readPrefs() {
    try {
        const raw = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        const styles = {};
        BRUSH_STYLES.forEach((s) => {
            styles[s] = {
                width: Number.isFinite(raw?.styles?.[s]?.width) ? raw.styles[s].width : defaultWidthForStyle(s),
                color: raw?.styles?.[s]?.color || '#f8fafc'
            };
        });
        return {
            activeStyle: BRUSH_STYLES.includes(raw?.activeStyle) ? raw.activeStyle : 'pen',
            activeTool: ['pointer', 'brush', 'eraser', 'text', ...DRAG_SHAPE_TOOLS].includes(raw?.activeTool) ? raw.activeTool : 'pointer',
            styles
        };
    } catch {
        const styles = {};
        BRUSH_STYLES.forEach((s) => { styles[s] = { width: defaultWidthForStyle(s), color: '#f8fafc' }; });
        return { activeStyle: 'pen', activeTool: 'pointer', styles };
    }
}

function writePrefs(prefs) {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

function trimDrawingStack(stack) {
    while (stack.length > HISTORY_MAX) stack.shift();
}

class DrawingHistory {
    constructor() {
        this.undoStack = [];
        this.redoStack = [];
    }
    push(snapshot) {
        this.undoStack.push(JSON.stringify(snapshot));
        trimDrawingStack(this.undoStack);
        this.redoStack = [];
    }
    undo(current) {
        if (!this.undoStack.length) return null;
        this.redoStack.push(JSON.stringify(current));
        trimDrawingStack(this.redoStack);
        return JSON.parse(this.undoStack.pop());
    }
    redo(current) {
        if (!this.redoStack.length) return null;
        this.undoStack.push(JSON.stringify(current));
        trimDrawingStack(this.undoStack);
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
    activeTool: 'brush',
    activeStyle: 'pen',
    penPointerActive: false,
    draftStroke: null,
    shapePreview: null,
    saveTimer: null,
    rafId: null,
    brandEl: null,
    brandNotesText: 'magicNotes',
    colorRolloutOpen: false,

    // Lasso tool state
    isLassoActive: false,
    lassoPoints: [],
    selectedStrokes: new Set(),
    isDraggingLasso: false,
    lassoDragStart: null,
    
    // Pointer (Select) tool state
    isBoxSelecting: false,
    boxSelectStart: null,
    boxSelectCurrent: null,

    init(app) {
        this.app = app;
        this.boardEl = document.getElementById('drawing-board');
        this.canvas = document.getElementById('drawing-canvas');
        this.bgCanvas = document.getElementById('drawing-bg-canvas');
        this.viewportEl = document.getElementById('canvas-viewport');
        this.innerEl = document.getElementById('canvas-viewport-inner');
        this.textLayer = document.getElementById('canvas-text-layer');
        this.brandEl = document.getElementById('app-brand');
        DrawingToolbarChrome.init();
        DrawingToolbarChrome.onCollapse = () => requestAnimationFrame(() => this.resize());
        DrawingToolbarChrome.onExpand = () => {
            this.renderToolbar();
            requestAnimationFrame(() => this.resize());
        };
        if (this.brandEl) {
            this.brandNotesText = this.brandEl.querySelector('.app-brand__text')?.textContent?.trim()
                || this.brandEl.textContent?.trim()
                || 'magicNotes';
        }

        if (!this.canvas || !this.boardEl) return;
        this.ctx = this.canvas.getContext('2d');
        this.bgCtx = this.bgCanvas?.getContext('2d');

        CanvasViewport.init(this.innerEl, this.viewportEl);

        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        window.addEventListener('resize', () => { if (this.active) this.resize(); });
    },

    activate() {
        this.active = true;
        DrawingToolbarChrome.show();
        this.toolbarEl = DrawingToolbarChrome.getToolbarMount();
        this.doc = readDocument();
        this.prefs = readPrefs();
        this.activeTool = this.prefs.activeTool;
        this.activeStyle = this.prefs.activeStyle;

        if (this.brandEl) this.brandEl.textContent = 'magicCanvas';

        this.boardEl.classList.remove('is-hidden');
        this.boardEl.setAttribute('aria-hidden', 'false');

        CanvasViewport.loadFromDoc(this.doc.viewport);
        this.renderToolbar();
        this.resize();
        this.redraw();
    },

    deactivate() {
        this.active = false;
        this.flushSave();
        ColorPicker.close();
        DrawingToolbarMenu.close();
        this.colorRolloutOpen = false;
        if (this.brandEl) this.brandEl.textContent = this.brandNotesText;
        this.boardEl?.classList.add('is-hidden');
        this.boardEl?.setAttribute('aria-hidden', 'true');
        DrawingToolbarChrome.hide();
        this.textLayer.innerHTML = '';
        this.toolbarEl = null;
        this.draftStroke = null;
        this.shapePreview = null;
    },

    hideToolbar() {
        DrawingToolbarChrome.collapse();
    },

    showToolbar(render = true) {
        DrawingToolbarChrome.expand();
        if (render) this.renderToolbar();
    },

    getSnapshot() {
        return JSON.parse(JSON.stringify(this.doc));
    },

    getLayerUndoSlice() {
        return {
            kind: 'layer',
            canvasMode: this.doc.canvasMode,
            activePageId: this.doc.activePageId,
            strokes: JSON.parse(JSON.stringify(getActiveStrokes(this.doc))),
            texts: JSON.parse(JSON.stringify(getActiveTexts(this.doc)))
        };
    },

    pushLayerHistory() {
        this.history.push(this.getLayerUndoSlice());
    },

    applySnapshot(snapshot) {
        if (snapshot?.kind === 'layer') {
            setActiveStrokes(this.doc, JSON.parse(JSON.stringify(snapshot.strokes || [])));
            setActiveTexts(this.doc, JSON.parse(JSON.stringify(snapshot.texts || [])));
        } else {
            this.doc = JSON.parse(JSON.stringify(snapshot));
        }
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
            this.innerEl.classList.toggle('is-paged-canvas', this.doc.canvasMode !== 'infinite');
            this.innerEl.classList.toggle('is-infinite-canvas', this.doc.canvasMode === 'infinite');
        }
        this.redrawBackground();
        this.redraw();
    },

    pageBackgroundFill() {
        return getActiveBackgroundColor(this.doc) || '';
    },

    pageBackgroundSwatch() {
        const custom = this.pageBackgroundFill();
        if (custom) return custom;
        return getComputedStyle(document.documentElement).getPropertyValue('--desktop-bg').trim() || '#121214';
    },

    redrawBackground() {
        if (!this.bgCtx || !this.bgCanvas) return;
        renderBackground(this.bgCtx, getActiveBackground(this.doc), this.bgCanvas.width, this.bgCanvas.height, {
            fillColor: this.pageBackgroundFill()
        });
    },

    setPageBackgroundColor(color) {
        setActiveBackgroundColor(this.doc, color);
        this.redrawBackground();
        this.scheduleSave();
        this.renderToolbar();
    },

    openPageBackgroundPicker(anchor) {
        ColorPicker.open({
            anchor,
            presets: PALETTE_UNIFIED,
            value: this.pageBackgroundFill() || this.pageBackgroundSwatch(),
            align: 'end',
            onSelect: (c) => this.setPageBackgroundColor(c)
        });
    },

    currentBrush() {
        const s = this.prefs.styles[this.activeStyle] || { width: DEFAULT_WIDTH, color: '#f8fafc' };
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
        this.renderToolbar();
    },

    adjustWidth(delta, { refreshMenu = false } = {}) {
        const style = this.activeStyle;
        const cur = this.prefs.styles[style]?.width ?? DEFAULT_WIDTH;
        this.prefs.styles[style].width = Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, cur + delta));
        writePrefs(this.prefs);
        if (refreshMenu && DrawingToolbarMenu.isOpen()) {
            DrawingToolbarMenu.setItems(this.pointerMenuItems(), this.pointerSelected());
            this.updatePointerWidthLabel();
        } else {
            this.renderToolbar();
        }
    },

    updatePointerWidthLabel() {
        const label = this.toolbarEl?.querySelector('#draw-pointer-width');
        if (label) label.textContent = this.currentBrush().width + 'px';
    },

    setColor(color, { rerender = true } = {}) {
        this.prefs.styles[this.activeStyle].color = color;
        writePrefs(this.prefs);
        if (rerender) this.renderToolbar();
        else this.updateColorChip(color);
    },

    updateColorChip(color) {
        const chip = this.toolbarEl?.querySelector('.drawing-color-chip');
        const btn = this.toolbarEl?.querySelector('#draw-color-btn');
        if (chip) chip.style.background = color;
        if (btn) btn.style.setProperty('--chip-color', color);
    },

    toggleColorRollout(anchor) {
        if (this.colorRolloutOpen) {
            ColorPicker.close();
            return;
        }
        const brush = this.currentBrush();
        const rollout = this.toolbarEl?.querySelector('#draw-color-rollout');
        if (!rollout) return;
        ColorPicker.open({
            mode: 'inline',
            container: rollout,
            anchor,
            presets: PALETTE_UNIFIED,
            value: brush.color,
            onSelect: (c) => this.setColor(c, { rerender: false }),
            onClose: () => { this.colorRolloutOpen = false; }
        });
        this.colorRolloutOpen = true;
    },

    onPointerDown(e) {
        if (!this.active || e.button > 0) return;
        if (CanvasViewport.panning || CanvasViewport.spaceHeld) return;
        if (e.pointerType === 'touch' && this.penPointerActive) return;
        if (e.pointerType === 'pen') this.penPointerActive = true;

        const { x, y } = this.clientToCanvas(e.clientX, e.clientY);
        if (this.doc.canvasMode === 'infinite') expandInfiniteBounds(this.doc, x, y);

        this.canvas.setPointerCapture(e.pointerId);

        // Pointer (Select) tool - check if clicking on center point of selection
        if (this.activeTool === 'pointer' && this.selectedStrokes.size > 0) {
            const bounds = getStrokesBounds(this.getSelectedStrokesArray());
            const centerX = bounds.minX + bounds.width / 2;
            const centerY = bounds.minY + bounds.height / 2;
            const handleRadius = 10;
            if (Math.hypot(x - centerX, y - centerY) <= handleRadius) {
                this.startLassoDrag(x, y);
                return;
            }
        }

        // Lasso tool - check if clicking on center point of selection
        if (this.selectedStrokes.size > 0 && !this.isLassoActive) {
            const bounds = getStrokesBounds(this.getSelectedStrokesArray());
            const centerX = bounds.minX + bounds.width / 2;
            const centerY = bounds.minY + bounds.height / 2;
            const handleRadius = 10;
            if (Math.hypot(x - centerX, y - centerY) <= handleRadius) {
                this.startLassoDrag(x, y);
                return;
            }
        }

        // Lasso tool handling
        if (this.isLassoActive) {
            this.beginLassoPath(x, y);
            return;
        }

        // Pointer (Select) tool - start box selection
        if (this.activeTool === 'pointer') {
            this.beginBoxSelect(x, y);
            return;
        }

        if (this.activeTool === 'text') {
            this.placeTextBox(x, y);
            return;
        }

        if (this.activeTool === 'eraser') {
            this.pushLayerHistory();
            this.eraseAt(x, y);
            this.scheduleSave();
            this.redraw();
            return;
        }

        if (this.activeTool === 'brush') {
            const brush = this.currentBrush();
            this.pushLayerHistory();
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

        if (isDragShape(this.activeTool)) {
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

        // Lasso tool - dragging selected strokes
        if (this.isDraggingLasso && this.lassoDragStart) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            const dx = pt.x - this.lassoDragStart.x;
            const dy = pt.y - this.lassoDragStart.y;
            this.dragLassoSelection(dx, dy);
            this.lassoDragStart = { x: pt.x, y: pt.y };
            return;
        }

        // Pointer (Select) tool - dragging selected strokes
        if (this.isDraggingLasso && this.lassoDragStart) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            const dx = pt.x - this.lassoDragStart.x;
            const dy = pt.y - this.lassoDragStart.y;
            this.dragLassoSelection(dx, dy);
            this.lassoDragStart = { x: pt.x, y: pt.y };
            return;
        }

        // Lasso tool handling
        if (this.isLassoActive && this.lassoPoints.length > 0) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            this.extendLassoPath(pt.x, pt.y);
            this.requestRedraw();
            return;
        }

        // Pointer (Select) tool - update box selection
        if (this.isBoxSelecting && this.boxSelectStart) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            this.updateBoxSelect(pt.x, pt.y);
            this.requestRedraw();
            return;
        }

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

        // Pointer (Select) tool - finish box selection
        if (this.isBoxSelecting) {
            this.endBoxSelect();
            this.redraw();
            return;
        }

        // Lasso tool - finish dragging
        if (this.isDraggingLasso) {
            this.finishLassoDrag();
            this.redraw();
            return;
        }

        // Lasso tool handling
        if (this.isLassoActive && this.lassoPoints.length > 0) {
            if (this.closeLassoPath()) {
                this.selectStrokesInLasso();
                if (this.selectedStrokes.size > 0) {
                    this.pushLayerHistory();
                }
            }
            this.redraw();
            return;
        }

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
                this.pushLayerHistory();
                const strokes = this.strokes();
                strokes.push({ ...s });
                this.setStrokes(strokes);
                this.scheduleSave();
            }
            this.shapePreview = null;
            this.redraw();
        }
    },

    // Pointer (Select) tool - box selection methods
    beginBoxSelect(x, y) {
        this.isBoxSelecting = true;
        this.boxSelectStart = { x, y };
        this.boxSelectCurrent = { x, y };
    },

    updateBoxSelect(x, y) {
        this.boxSelectCurrent = { x, y };
    },

    endBoxSelect() {
        if (!this.boxSelectStart || !this.boxSelectCurrent) {
            this.isBoxSelecting = false;
            this.boxSelectStart = null;
            this.boxSelectCurrent = null;
            return;
        }

        const { x: x0, y: y0 } = this.boxSelectStart;
        const { x: x1, y: y1 } = this.boxSelectCurrent;
        
        // Calculate box dimensions
        const width = Math.abs(x1 - x0);
        const height = Math.abs(y1 - y0);
        
        // If it's a small box (single click), use 6x6 pixel area
        if (width < 6 && height < 6) {
            const polygon = rectToPolygon(x0 - 3, y0 - 3, x0 + 3, y0 + 3);
            this.selectStrokesInPolygon(polygon);
        } else {
            // Normal box selection
            const polygon = rectToPolygon(x0, y0, x1, y1);
            this.selectStrokesInPolygon(polygon);
        }
        
        this.isBoxSelecting = false;
        this.boxSelectStart = null;
        this.boxSelectCurrent = null;
    },

    selectStrokesInPolygon(polygon) {
        if (polygon.length < 3) return;
        
        const strokes = this.strokes();
        this.selectedStrokes.clear();
        
        for (const stroke of strokes) {
            if (strokeHasPointInPolygon(stroke, polygon)) {
                this.selectedStrokes.add(stroke);
            }
        }
        
        if (this.selectedStrokes.size > 0) {
            this.pushLayerHistory();
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
            this.pushLayerHistory();
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
        
        // Render lasso overlay (path, box selection, and selection box)
        if (this.isLassoActive || this.selectedStrokes.size > 0 || this.isBoxSelecting) {
            this.renderLassoOverlay();
        }
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
        this.pushLayerHistory();
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

    pointerSelected() {
        return this.activeTool === 'eraser' ? 'eraser' : this.activeStyle;
    },

    pointerTriggerIcon() {
        const id = this.pointerSelected();
        return DRAWING_ICONS[id] || DRAWING_ICONS.pen;
    },

    shapeTriggerIcon() {
        return DRAWING_ICONS.shapes || DRAWING_ICONS.line;
    },

    pointerMenuItems() {
        const brush = this.currentBrush();
        const items = this.menuItemsWithIcons(POINTER_ITEMS);
        items.push({ divider: true });
        items.push({ stepper: true, id: 'brush-width', label: 'Size', value: `${brush.width}px` });
        return items;
    },

    openPointerMenu(anchor) {
        DrawingToolbarMenu.toggle({
            anchor,
            ariaLabel: 'Pointer tools',
            items: this.pointerMenuItems(),
            selected: this.pointerSelected(),
            onSelect: (id) => {
                if (id === 'eraser') this.setTool('eraser');
                else this.setStyle(id);
                this.renderToolbar();
            },
            onStepper: (id, delta) => {
                if (id === 'brush-width') this.adjustWidth(delta, { refreshMenu: true });
            }
        });
    },

    formatTriggerLabel() {
        if (this.doc.canvasMode === 'infinite') return '∞';
        return this.doc.canvasMode.toUpperCase();
    },

    typeTriggerIcon() {
        const bg = getActiveBackground(this.doc);
        return DRAWING_ICONS[bg === 'blank' ? 'rect' : bg] || DRAWING_ICONS.grid;
    },

    menuItemsWithIcons(items) {
        return items.map((item) => {
            if (item.heading || item.divider || item.stepper) return { ...item };
            return {
                ...item,
                icon: item.icon || DRAWING_ICONS[item.id] || DRAWING_ICONS[item.iconKey || item.id] || ''
            };
        });
    },

    backgroundMenuItems(bg) {
        const withSel = (list) => this.menuItemsWithIcons(list.map((item) => ({
            ...item,
            iconKey: item.iconKey || item.id,
            selected: item.id === bg
        })));
        const items = [];
        items.push({ heading: 'Page format' });
        items.push(...this.menuItemsWithIcons(FORMAT_ITEMS.map((item) => ({
            ...item,
            selected: item.id === this.doc.canvasMode
        }))));
        items.push({ divider: true });
        items.push({ heading: 'Background' });
        items.push(...withSel([{ id: 'blank', label: 'Blank', iconKey: 'blank' }]));
        items.push({ heading: 'Grids' });
        items.push(...withSel(GRID_BACKGROUNDS));
        items.push({ heading: 'Writing' });
        items.push(...withSel(WRITING_BACKGROUNDS));
        if (this.doc.canvasMode !== 'infinite') {
            items.push({ heading: 'Pages' });
            items.push(
                { id: 'page-prev', label: 'Previous page', icon: DRAWING_ICONS.pagePrev },
                { id: 'page-next', label: 'Next page', icon: DRAWING_ICONS.pageNext },
                { id: 'page-add', label: 'Add page', icon: DRAWING_ICONS.pageAdd }
            );
        }
        items.push({ heading: 'Fill' });
        const swatch = this.pageBackgroundSwatch();
        items.push({
            id: 'bg-color',
            label: 'Background color…',
            icon: `<span class="drawing-menu-swatch" style="background:${swatch}"></span>`
        });
        return items;
    },

    canvasMenuItems() {
        return this.backgroundMenuItems(getActiveBackground(this.doc));
    },

    handleCanvasMenu(id, anchor) {
        if (id === 'bg-color') {
            this.openPageBackgroundPicker(anchor);
            return;
        }
        if (id === 'page-prev') {
            if (prevPage(this.doc)) { this.resize(); this.scheduleSave(); this.renderToolbar(); }
            return;
        }
        if (id === 'page-next') {
            if (nextPage(this.doc)) { this.resize(); this.scheduleSave(); this.renderToolbar(); }
            return;
        }
        if (id === 'page-add') {
            addPage(this.doc);
            this.resize();
            this.scheduleSave();
            this.renderToolbar();
            return;
        }
        if (FORMAT_ITEMS.some((item) => item.id === id)) {
            this.setCanvasMode(id);
            return;
        }
        if (BACKGROUNDS.includes(id)) {
            this.setBackground(id);
        }
    },

    renderToolbar() {
        if (!this.toolbarEl) return;
        const wasColorOpen = this.colorRolloutOpen;
        DrawingToolbarMenu.close();
        const brush = this.currentBrush();
        const isPointerActive = this.activeTool === 'pointer';

        this.toolbarEl.innerHTML = `
            <button type="button" class="btn btn--compact drawing-toolbar-dropdown ${isPointerActive ? 'active' : ''}" id="draw-menu-pointer" aria-haspopup="menu" aria-expanded="false" title="Pointer tools (V)" aria-label="Pointer tools">
                <span class="drawing-dropdown-icon">${this.pointerTriggerIcon()}</span>
                <span class="drawing-dropdown-width" id="draw-pointer-width">${brush.width}px</span>
                <span class="drawing-dropdown-chevron">${CHEVRON}</span>
            </button>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <div class="drawing-color-group" id="draw-color-group">
                <button type="button" class="btn btn--compact btn--icon drawing-color-chip-btn" id="draw-color-btn" title="Color" aria-label="Color" aria-expanded="false" style="--chip-color:${brush.color}">
                    <span class="drawing-color-chip" style="background:${brush.color}"></span>
                </button>
                <div class="drawing-color-rollout" id="draw-color-rollout" aria-hidden="true"></div>
            </div>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-shapes" aria-haspopup="menu" aria-expanded="false" title="Shapes" aria-label="Shapes">
                <span class="drawing-dropdown-icon">${this.shapeTriggerIcon()}</span>
                <span class="drawing-dropdown-chevron">${CHEVRON}</span>
            </button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-lasso" title="Lasso Select (L)" aria-label="Lasso Select" ${this.isLassoActive ? 'aria-pressed="true"' : ''}>${DRAWING_ICONS.lasso}</button>
            <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-canvas" aria-haspopup="menu" aria-expanded="false" title="Canvas settings" aria-label="Canvas settings">
                <span class="drawing-dropdown-label">Canvas</span>
                <span class="drawing-dropdown-chevron">${CHEVRON}</span>
            </button>
            <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-export" aria-haspopup="menu" aria-expanded="false" title="Export" aria-label="Export">
                <span class="drawing-dropdown-label">Export</span>
                <span class="drawing-dropdown-chevron">${CHEVRON}</span>
            </button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-display-options" title="Display options" aria-label="Display options" aria-expanded="false" aria-haspopup="menu">${ACTION_ICONS.displayOptions}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-fullscreen" title="Full screen" aria-label="Full screen" aria-pressed="false">${ACTION_ICONS.fullscreenEnter}</button>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="btn btn--compact btn--icon" id="draw-zoom-out" title="Zoom out" aria-label="Zoom out">${DRAWING_ICONS.zoomOut}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-zoom-in" title="Zoom in" aria-label="Zoom in">${DRAWING_ICONS.zoomIn}</button>
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="btn btn--compact btn--icon" id="draw-undo" title="Undo" aria-label="Undo" ${this.history.canUndo ? '' : 'disabled'}>${ACTION_ICONS.undo}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-redo" title="Redo" aria-label="Redo" ${this.history.canRedo ? '' : 'disabled'}>${ACTION_ICONS.redo}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-clear" title="Clear" aria-label="Clear">${ACTION_ICONS.layoutReset}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-toolbar-hide" title="Hide toolbar" aria-label="Hide toolbar">${ACTION_ICONS.collapseAll}</button>
            <button type="button" class="btn btn--compact btn--icon" id="draw-exit-drawing" title="Exit drawing mode" aria-label="Exit drawing mode">${ACTION_ICONS.viewFree}</button>
        `;
        this.bindToolbar();
        if (wasColorOpen) {
            const btn = this.toolbarEl.querySelector('#draw-color-btn');
            if (btn) this.toggleColorRollout(btn);
        }
    },

    bindToolbar() {
        if (!this.toolbarEl) return;
        const q = (sel) => this.toolbarEl.querySelector(sel);

        q('#draw-toolbar-hide')?.addEventListener('click', () => { ColorPicker.close(); this.colorRolloutOpen = false; this.hideToolbar(); });
        q('#draw-exit-drawing')?.addEventListener('click', () => { this.app.switchWorkspaceMode('notes'); });
        q('#draw-undo')?.addEventListener('click', () => this.undo());
        q('#draw-redo')?.addEventListener('click', () => this.redo());
        q('#draw-clear')?.addEventListener('click', () => this.clearAll());
        q('#draw-color-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleColorRollout(e.currentTarget);
        });
        q('#draw-zoom-in')?.addEventListener('click', () => { CanvasViewport.stepZoom(0.1); this.doc.viewport = CanvasViewport.toDoc(); });
        q('#draw-zoom-out')?.addEventListener('click', () => { CanvasViewport.stepZoom(-0.1); this.doc.viewport = CanvasViewport.toDoc(); });
        q('#draw-display-options')?.addEventListener('click', (e) => {
            e.stopPropagation();
            DisplayOptions.toggleFrom(e.currentTarget);
        });
        const fsBtn = q('#draw-fullscreen');
        if (fsBtn) Fullscreen.registerButton(fsBtn);

        q('#draw-menu-pointer')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPointerMenu(e.currentTarget);
        });

        q('#draw-menu-shapes')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const selected = SHAPE_ITEMS.some((item) => item.id === this.activeTool) ? this.activeTool : 'line';
            DrawingToolbarMenu.toggle({
                anchor: e.currentTarget,
                ariaLabel: 'Shapes',
                items: this.menuItemsWithIcons(SHAPE_ITEMS),
                selected,
                onSelect: (id) => {
                    this.setTool(id);
                    this.renderToolbar();
                }
            });
        });

        q('#draw-menu-canvas')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const anchor = e.currentTarget;
            DrawingToolbarMenu.toggle({
                anchor,
                ariaLabel: 'Canvas settings',
                items: this.canvasMenuItems(),
                onSelect: (id) => this.handleCanvasMenu(id, anchor)
            });
        });

        q('#draw-menu-export')?.addEventListener('click', (e) => {
            e.stopPropagation();
            DrawingToolbarMenu.toggle({
                anchor: e.currentTarget,
                ariaLabel: 'Export',
                items: EXPORT_ITEMS,
                onSelect: (id) => {
                    if (id === 'export-png') exportCanvasPng();
                    else if (id === 'export-pdf') exportCanvasPdf();
                }
            });
        });

        // Lasso button click handler
        q('#draw-lasso')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleLassoMode();
        });
    },

    updateToolbarState() {
        if (!this.toolbarEl) return;
        this.toolbarEl.querySelector('#draw-undo')?.toggleAttribute('disabled', !this.history.canUndo);
        this.toolbarEl.querySelector('#draw-redo')?.toggleAttribute('disabled', !this.history.canRedo);
        this.updatePointerWidthLabel();
    },

    handleKeydown(e) {
        if (!this.active) return false;
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return true; }
            if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); return true; }
        }
        
        // Pointer tool keyboard shortcut
        if (e.key === 'v' || e.key === 'V') {
            e.preventDefault();
            this.setTool('pointer');
            return true;
        }
        
        // Lasso tool keyboard shortcut
        if (e.key === 'l' || e.key === 'L') {
            e.preventDefault();
            this.toggleLassoMode();
            return true;
        }
        
        // Escape to clear lasso selection or exit lasso mode
        if (e.key === 'Escape') {
            if (this.isDraggingLasso) {
                this.finishLassoDrag();
                this.redraw();
                return true;
            }
            if (this.isLassoActive || this.selectedStrokes.size > 0) {
                this.clearLassoSelection();
                return true;
            }
        }
        
        return false;
    },

    // Lasso tool methods
    toggleLassoMode() {
        if (this.isLassoActive) {
            this.clearLassoSelection();
        } else {
            this.startLassoMode();
        }
    },

    startLassoMode() {
        this.isLassoActive = true;
        this.lassoPoints = [];
        this.selectedStrokes.clear();
        this.isDraggingLasso = false;
        this.renderToolbar();
    },

    clearLassoSelection() {
        this.isLassoActive = false;
        this.lassoPoints = [];
        this.selectedStrokes.clear();
        this.isDraggingLasso = false;
        this.lassoDragStart = null;
        this.textLayer.innerHTML = '';
        this.renderToolbar();
    },

    beginLassoPath(x, y) {
        this.lassoPoints = [{ x, y }];
    },

    extendLassoPath(x, y) {
        if (this.lassoPoints.length === 0) return;
        // Only add if far enough from last point to avoid too many points
        const last = this.lassoPoints[this.lassoPoints.length - 1];
        const dist = Math.hypot(x - last.x, y - last.y);
        if (dist > 2) {
            this.lassoPoints.push({ x, y });
        }
    },

    closeLassoPath() {
        if (this.lassoPoints.length < 3) return false;
        // Connect last point to first
        this.lassoPoints.push(this.lassoPoints[0]);
        return true;
    },

    selectStrokesInLasso() {
        if (this.lassoPoints.length < 3) return;
        
        const strokes = this.strokes();
        this.selectedStrokes.clear();
        
        for (const stroke of strokes) {
            if (strokeHasPointInPolygon(stroke, this.lassoPoints)) {
                this.selectedStrokes.add(stroke);
            }
        }
    },

    getSelectedStrokesArray() {
        return Array.from(this.selectedStrokes);
    },

    startLassoDrag(x, y) {
        if (this.selectedStrokes.size === 0) return;
        
        this.isDraggingLasso = true;
        this.lassoDragStart = { x, y };
        this.pushLayerHistory();
    },

    dragLassoSelection(dx, dy) {
        if (!this.isDraggingLasso || this.selectedStrokes.size === 0) return;
        
        translateStrokes(this.getSelectedStrokesArray(), dx, dy);
        
        // Clamp to page bounds for fixed page modes
        const dims = getPageDimensions(this.doc);
        const pageBounds = getPageBounds(this.doc, dims);
        clampStrokesToBounds(this.getSelectedStrokesArray(), pageBounds);
        
        this.redraw();
    },

    finishLassoDrag() {
        if (!this.isDraggingLasso) return;
        
        this.isDraggingLasso = false;
        this.lassoDragStart = null;
        this.scheduleSave();
    },

    renderLassoOverlay() {
        if (!this.ctx || !this.canvas) return;
        
        // Render dashed blue box selection marquee
        if (this.isBoxSelecting && this.boxSelectStart && this.boxSelectCurrent) {
            const x0 = Math.min(this.boxSelectStart.x, this.boxSelectCurrent.x);
            const y0 = Math.min(this.boxSelectStart.y, this.boxSelectCurrent.y);
            const x1 = Math.max(this.boxSelectStart.x, this.boxSelectCurrent.x);
            const y1 = Math.max(this.boxSelectStart.y, this.boxSelectCurrent.y);
            const width = x1 - x0;
            const height = y1 - y0;
            
            this.ctx.save();
            this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'; // Blue with opacity
            this.ctx.fillStyle = 'rgba(59, 130, 246, 0.15)'; // Light blue fill
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([4, 2]);
            this.ctx.strokeRect(x0, y0, width, height);
            this.ctx.restore();
        }
        
        // Render dashed blue lasso path
        if (this.lassoPoints.length > 0) {
            this.ctx.save();
            this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)'; // Blue with opacity
            this.ctx.fillStyle = 'rgba(59, 130, 246, 0.15)'; // Light blue fill
            this.ctx.lineWidth = 2;
            this.ctx.setLineDash([6, 4]);
            this.ctx.beginPath();
            this.ctx.moveTo(this.lassoPoints[0].x, this.lassoPoints[0].y);
            for (let i = 1; i < this.lassoPoints.length; i++) {
                this.ctx.lineTo(this.lassoPoints[i].x, this.lassoPoints[i].y);
            }
            this.ctx.stroke();
            this.ctx.fill();
            this.ctx.setLineDash([]);
            this.ctx.restore();
        }
        
        // Render selection bounding box
        if (this.selectedStrokes.size > 0) {
            const bounds = getStrokesBounds(this.getSelectedStrokesArray());
            this.ctx.save();
            this.ctx.strokeStyle = '#3b82f6'; // Blue border
            this.ctx.fillStyle = 'rgba(59, 130, 246, 0.1)'; // Semi-transparent fill
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([4, 2]);
            this.ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
            this.ctx.restore();
            
            // Render drag handles (simple center point)
            const centerX = bounds.minX + bounds.width / 2;
            const centerY = bounds.minY + bounds.height / 2;
            this.ctx.save();
            this.ctx.fillStyle = '#3b82f6';
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
    },

    isLassoButtonActive() {
        return this.isLassoActive;
    }
};

const TOOLBAR_STATE_KEY = 'matrix_drawing_toolbar';

export function getDrawingBackupKeys() {
    return {
        matrix_global_drawing: localStorage.getItem(STORAGE_KEY),
        matrix_drawing_prefs: localStorage.getItem(PREFS_KEY),
        matrix_workspace_mode: localStorage.getItem('matrix_workspace_mode'),
        matrix_drawing_toolbar: localStorage.getItem(TOOLBAR_STATE_KEY),
        matrix_drawing_toolbar_hidden: localStorage.getItem(TOOLBAR_STATE_KEY),
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
    const toolbarState = backup.matrix_drawing_toolbar ?? backup.matrix_drawing_toolbar_hidden;
    if (toolbarState != null) {
        if (typeof toolbarState === 'string' && toolbarState === 'true') {
            localStorage.setItem(TOOLBAR_STATE_KEY, JSON.stringify({ collapsed: true }));
        } else if (typeof toolbarState === 'string' && toolbarState === 'false') {
            localStorage.setItem(TOOLBAR_STATE_KEY, JSON.stringify({ collapsed: false }));
        } else {
            localStorage.setItem(TOOLBAR_STATE_KEY, typeof toolbarState === 'string'
                ? toolbarState : JSON.stringify(toolbarState));
        }
    }
}
