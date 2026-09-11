/** @module {"owns":"magicCanvas drawing board, workspace drawing mode", "related":["canvasDocument.js","drawingToolbarMenu.js","layoutStorage.js"]} */
import { ACTION_ICONS, DRAWING_ICONS, FORMAT_ICONS } from './icons.js';
import { ColorPicker, PALETTE_UNIFIED, resolveNoteColor } from './colorPicker.js';
import { DrawingToolbarMenu, CHEVRON } from './drawingToolbarMenu.js';
import { DisplayOptions } from './displayOptions.js';
import { Fullscreen } from './fullscreen.js';
import {
    readDocument, writeDocument, getActiveStrokes, getActiveTexts, setActiveStrokes, setActiveTexts,
    getActiveImages, setActiveImages,
    getActiveBackground, setActiveBackground, getActiveBackgroundColor, setActiveBackgroundColor,
    getPageDimensions, addPage, nextPage, prevPage, switchCanvasMode,
    expandInfiniteBounds, shrinkInfiniteBounds, STORAGE_KEY, createId, CANVAS_MODES, BACKGROUNDS
} from './canvasDocument.js';
import { BRUSH_STYLES, drawBrushStroke, drawShapeStroke, drawTextObject } from './canvasBrushes.js';
import { renderBackground } from './canvasBackgrounds.js';
import { CanvasViewport } from './canvasViewport.js';
// import { exportCanvasPng, exportCanvasPdf } from './canvasExport.js'; // Disabled until export renderer is unified.
import { DrawingToolbarChrome } from './drawingToolbarChrome.js';
import {
    strokeHasPointInPolygon,
    getStrokesBounds,
    clampStrokesToBounds,
    translateStrokes,
    getPageBounds,
    rectToPolygon,
    getImageBounds,
    resolveBoxSelection
} from './lassoGeometry.js';
import {
    loadImage,
    clearImageCache,
    ensureImagesLoaded,
    initialImageSize,
    drawImageObject,
    MIN_IMAGE_SIDE
} from './canvasImages.js';
import { listMedia } from './mediaLibrary.js';
import { showAppToast } from './toast.js';
import { stripRichText } from './richText.js';
import {
    paintNoteTextOverlay,
    ensureCanvasFitsNoteText,
    noteHasTextOverlayEnabled,
    activePageIndex,
    migrateNoteCanvasTextFlags,
    resolveOverlayFontSize,
    overlayFontSizeToPercent,
    OVERLAY_FONT_MIN,
    OVERLAY_FONT_MAX,
    OVERLAY_FONT_STEP
} from './noteCanvasTextOverlay.js';

const PREFS_KEY = 'matrix_drawing_prefs';
const WIDTH_MIN = 1;
const WIDTH_MAX = 48;
const DEFAULT_WIDTH = 10;
const HIGHLIGHTER_WIDTH = 14;
const HISTORY_MAX = 50;
const SAVE_DEBOUNCE_MS = 400;
const RESIZE_HANDLE_SIZE = 10;
const RESIZE_HANDLE_HIT = 14;

const POINTER_ITEMS = [
    { id: 'pen', label: 'Pen' },
    { id: 'marker', label: 'Marker' },
    { id: 'highlighter', label: 'Highlighter' },
    { id: 'pencil', label: 'Pencil' },
    { id: 'spray', label: 'Spray' },
    { id: 'calligraphy', label: 'Calligraphy' },
    { id: 'brush', label: 'Brush' }
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
    { id: 'a2', label: 'A2 page' },
    { id: 'a3', label: 'A3 page' },
    { id: 'a4', label: 'A4 page' },
    { id: 'a5', label: 'A5 page' },
    { id: 'a6', label: 'A6 page' },
    { id: 'infinite', label: 'Infinite canvas' }
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
            activeTool: ['pointer', 'brush', 'eraser', 'pan', 'text', ...DRAG_SHAPE_TOOLS].includes(raw?.activeTool) ? raw.activeTool : 'pointer',
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

    // Marquee / rectangle select state (lasso button = rect marquee mode)
    isLassoActive: false,
    selectedStrokes: new Set(),
    isDraggingLasso: false,
    lassoDragStart: null,
    
    // Shared box-select state (pointer tool + lasso marquee)
    isBoxSelecting: false,
    boxSelectStart: null,
    boxSelectCurrent: null,

    // Resize handle state (for selected image objects)
    resizeHandle: null,
    resizeStart: null,
    hoverHandle: null,

    // Note-canvas mode state
    activeNoteId: null,
    isNoteCanvasMode: false,
    noteCanvasItem: null,

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
        this.viewportEl?.addEventListener('canvas:zoom', () => {
            this.updateZoomLevel();
            this.persistViewport();
            CanvasViewport.syncScrollbars();
        });
        this.viewportEl?.addEventListener('canvas:pan', () => {
            this.persistViewport();
            CanvasViewport.syncScrollbars();
        });

        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        window.addEventListener('resize', () => { if (this.active) this.resize(); });
    },

    async activate() {
        this.active = true;
        DrawingToolbarChrome.show();
        this.toolbarEl = DrawingToolbarChrome.getToolbarMount();
        this.doc = await readDocument();
        this.prefs = readPrefs();
        this.activeTool = this.prefs.activeTool;
        this.activeStyle = this.prefs.activeStyle;
        this.isNoteCanvasMode = false;
        this.activeNoteId = null;
        this.noteCanvasItem = null;

        if (this.brandEl) this.brandEl.textContent = 'magicCanvas';
        this.updateNoteToolbarChrome();

        this.boardEl.classList.remove('is-hidden');
        this.boardEl.setAttribute('aria-hidden', 'false');

        CanvasViewport.loadFromDoc(this.doc.viewport);
        CanvasViewport.setHandMode(this.activeTool === 'pan');
        if (this.canvas) this.canvas.dataset.tool = this.activeTool;
        this.shrinkInfiniteIfNeeded();
        this.renderToolbar();
        this.updateZoomLevel();
        this.resize();
        this.redraw();
    },

    async activateForNote(item) {
        if (!item?.id) return;
        const { normalizeNoteCanvas } = await import('./noteModel.js');
        migrateNoteCanvasTextFlags(item);
        this.active = true;
        this.isNoteCanvasMode = true;
        this.activeNoteId = item.id;
        this.noteCanvasItem = item;
        this.doc = normalizeNoteCanvas(item.canvas);
        this.prefs = readPrefs();
        this.activeTool = this.prefs.activeTool;
        this.activeStyle = this.prefs.activeStyle;

        DrawingToolbarChrome.show();
        this.toolbarEl = DrawingToolbarChrome.getToolbarMount();

        if (this.brandEl) this.brandEl.textContent = 'magicCanvas';
        this.updateNoteToolbarChrome();

        this.boardEl.classList.remove('is-hidden');
        this.boardEl.setAttribute('aria-hidden', 'false');

        CanvasViewport.loadFromDoc(this.doc.viewport || { scale: 1, offsetX: 0, offsetY: 0 });
        CanvasViewport.setHandMode(this.activeTool === 'pan');
        if (this.canvas) this.canvas.dataset.tool = this.activeTool;
        this.shrinkInfiniteIfNeeded();
        if (noteHasTextOverlayEnabled(item)) {
            ensureCanvasFitsNoteText(this.doc, item);
        }
        this.renderToolbar();
        this.updateZoomLevel();
        this.resize();
        this.redrawBackground();
        this.redraw();
    },

    async exitNoteCanvas() {
        if (!this.isNoteCanvasMode) return;
        const item = this.noteCanvasItem;
        await this.deactivate();
        if (!item) return;
        // Notify the app to return focus to the board and re-render the note card.
        window.dispatchEvent(new CustomEvent('note:canvas_draw_exited', { detail: { item } }));
    },

    async deactivate() {
        this.active = false;
        await this.flushSave();
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
        this.resizeHandle = null;
        this.resizeStart = null;
        this.hoverHandle = null;
        CanvasViewport.setHandMode(false);
        clearImageCache();
        this.isNoteCanvasMode = false;
        this.activeNoteId = null;
        this.noteCanvasItem = null;
        this.updateNoteToolbarChrome();
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
            texts: JSON.parse(JSON.stringify(getActiveTexts(this.doc))),
            images: JSON.parse(JSON.stringify(getActiveImages(this.doc)))
        };
    },

    pushLayerHistory() {
        this.history.push(this.getLayerUndoSlice());
    },

    applySnapshot(snapshot) {
        if (snapshot?.kind === 'layer') {
            setActiveStrokes(this.doc, JSON.parse(JSON.stringify(snapshot.strokes || [])));
            setActiveTexts(this.doc, JSON.parse(JSON.stringify(snapshot.texts || [])));
            setActiveImages(this.doc, JSON.parse(JSON.stringify(snapshot.images || [])));
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

    images() {
        return getActiveImages(this.doc);
    },

    setImages(images) {
        setActiveImages(this.doc, images);
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
        CanvasViewport.setContentSize(cssW, cssH);
        this.redrawBackground();
        this.redraw();
    },

    pageBackgroundFill() {
        const custom = getActiveBackgroundColor(this.doc);
        if (custom) return custom;
        if (this.isNoteCanvasMode && this.noteCanvasItem) {
            return resolveNoteColor(this.noteCanvasItem.backgroundColor) || '';
        }
        return '';
    },

    pageBackgroundSwatch() {
        const custom = this.pageBackgroundFill();
        if (custom) return custom;
        return getComputedStyle(document.documentElement).getPropertyValue('--desktop-bg').trim() || '#121214';
    },

    redrawBackground() {
        if (!this.bgCtx || !this.bgCanvas) return;
        const fillColor = this.pageBackgroundFill();
        renderBackground(this.bgCtx, getActiveBackground(this.doc), this.bgCanvas.width, this.bgCanvas.height, {
            fillColor
        });
        // Note text overlay is painted in redraw() on the main canvas (under strokes).
    },

    adaptNoteTextOverlayToCanvas() {
        if (!this.isNoteCanvasMode || !this.noteCanvasItem || !this.doc) return false;
        migrateNoteCanvasTextFlags(this.noteCanvasItem);
        if (!noteHasTextOverlayEnabled(this.noteCanvasItem)) return false;
        const grew = ensureCanvasFitsNoteText(this.doc, this.noteCanvasItem);
        if (grew) this.resize();
        else {
            this.redrawBackground();
            this.redraw();
        }
        return grew;
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
        CanvasViewport.setHandMode(false);
        if (this.isLassoActive) this.isLassoActive = false;
        if (this.canvas) this.canvas.dataset.tool = 'brush';
        writePrefs(this.prefs);
        this.renderToolbar();
    },

    setTool(tool) {
        this.activeTool = tool;
        this.prefs.activeTool = tool;
        CanvasViewport.setHandMode(tool === 'pan');
        // setTool is used by V / shapes / eraser / pan — leave dedicated marquee mode
        if (this.isLassoActive) this.isLassoActive = false;
        if (this.canvas) this.canvas.dataset.tool = tool;
        writePrefs(this.prefs);
        this.renderToolbar();
    },

    persistViewport() {
        if (!this.doc) return;
        this.doc.viewport = CanvasViewport.toDoc();
        this.scheduleSave();
    },

    expandInfiniteIfNeeded(x, y) {
        if (this.doc.canvasMode !== 'infinite') return;
        if (expandInfiniteBounds(this.doc, x, y)) {
            this.resize();
            this.scheduleSave();
        }
    },

    shrinkInfiniteIfNeeded() {
        if (!this.doc || this.doc.canvasMode !== 'infinite') return false;
        const shrank = shrinkInfiniteBounds(this.doc);
        // Keep copy-paper text extents after content-based shrink.
        const grewOverlay = this.isNoteCanvasMode && noteHasTextOverlayEnabled(this.noteCanvasItem)
            ? ensureCanvasFitsNoteText(this.doc, this.noteCanvasItem)
            : false;
        if (!shrank && !grewOverlay) return false;
        this.resize();
        this.scheduleSave();
        return true;
    },

    goToPrevPage() {
        if (!prevPage(this.doc)) return;
        this.shrinkInfiniteIfNeeded();
        this.resize();
        this.scheduleSave();
        this.renderToolbar();
        this.redrawBackground();
        this.redraw();
    },

    goToNextPage() {
        if (!nextPage(this.doc)) return;
        this.shrinkInfiniteIfNeeded();
        this.resize();
        this.scheduleSave();
        this.renderToolbar();
        this.redrawBackground();
        this.redraw();
    },

    addCanvasPage() {
        addPage(this.doc);
        this.shrinkInfiniteIfNeeded();
        this.resize();
        this.scheduleSave();
        this.renderToolbar();
        this.redraw();
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
        ColorPicker.open({
            anchor,
            presets: PALETTE_UNIFIED,
            value: brush.color,
            align: 'end',
            onSelect: (c) => this.setColor(c, { rerender: false }),
            onClose: () => { this.colorRolloutOpen = false; }
        });
        this.colorRolloutOpen = true;
        anchor?.setAttribute('aria-expanded', 'true');
    },

    onPointerDown(e) {
        if (!this.active || e.button > 0) return;
        if (CanvasViewport.panning || CanvasViewport.spaceHeld || CanvasViewport.handMode || this.activeTool === 'pan') return;
        if (e.pointerType === 'touch' && this.penPointerActive) return;
        if (e.pointerType === 'pen') this.penPointerActive = true;

        const { x, y } = this.clientToCanvas(e.clientX, e.clientY);
        this.expandInfiniteIfNeeded(x, y);

        this.canvas.setPointerCapture(e.pointerId);

        // Resize handles take priority when something is selected
        if (this.selectedStrokes.size > 0) {
            const handle = this.hitResizeHandle(x, y);
            if (handle) {
                this.startResize(handle, x, y);
                return;
            }
            const bounds = getStrokesBounds(this.getSelectedStrokesArray());
            if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
                this.startLassoDrag(x, y);
                return;
            }
        }

        // Rectangle marquee (lasso mode or pointer select tool)
        if (this.isLassoActive || this.activeTool === 'pointer') {
            // Starting a new marquee outside the selection clears it
            if (this.selectedStrokes.size > 0) {
                this.selectedStrokes.clear();
            }
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

        // Resize selected images via grab handles
        if (this.resizeHandle && this.resizeStart) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            this.applyResize(pt.x, pt.y);
            return;
        }

        // Drag selected items (used by both pointer and lasso modes)
        if (this.isDraggingLasso && this.lassoDragStart) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            const dx = pt.x - this.lassoDragStart.x;
            const dy = pt.y - this.lassoDragStart.y;
            this.dragLassoSelection(dx, dy);
            this.lassoDragStart = { x: pt.x, y: pt.y };
            return;
        }

        // Hover cursor affordances for pointer/select when idle
        if (!this.isBoxSelecting && !this.draftStroke && !this.shapePreview
            && (this.activeTool === 'pointer' || this.isLassoActive || this.selectedStrokes.size > 0)) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            this.updateHoverCursor(pt.x, pt.y);
        }

        // Rectangle marquee update
        if (this.isBoxSelecting && this.boxSelectStart) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            this.updateBoxSelect(pt.x, pt.y);
            this.requestRedraw();
            return;
        }

        if (this.draftStroke) {
            events.forEach((ev) => {
                const pt = this.clientToCanvas(ev.clientX, ev.clientY);
                this.expandInfiniteIfNeeded(pt.x, pt.y);
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

        // Finish resize
        if (this.resizeHandle) {
            this.finishResize();
            this.redraw();
            return;
        }

        // Finish rectangle marquee
        if (this.isBoxSelecting) {
            this.endBoxSelect();
            this.redraw();
            return;
        }

        // Finish dragging selection
        if (this.isDraggingLasso) {
            this.finishLassoDrag();
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

    // Pointer / lasso shared rectangle marquee methods
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
        const result = resolveBoxSelection(x0, y0, x1, y1);

        this.selectedStrokes.clear();
        if (result.kind === 'click') {
            // Point-hit: select items under the tiny click rect, or clear if none
            this.selectStrokesInPolygon(result.polygon);
            if (this.selectedStrokes.size === 0) {
                // Empty click — selection already cleared above
            }
        } else {
            this.selectStrokesInPolygon(result.polygon);
        }

        this.isBoxSelecting = false;
        this.boxSelectStart = null;
        this.boxSelectCurrent = null;
    },

    selectStrokesInPolygon(polygon) {
        if (polygon.length < 3) return;

        const strokes = this.strokes();
        const texts = getActiveTexts(this.doc);
        const images = this.images();
        this.selectedStrokes.clear();

        for (const stroke of strokes) {
            if (strokeHasPointInPolygon(stroke, polygon)) {
                this.selectedStrokes.add(stroke);
            }
        }
        for (const text of texts) {
            if (strokeHasPointInPolygon(text, polygon)) {
                this.selectedStrokes.add(text);
            }
        }
        for (const image of images) {
            if (strokeHasPointInPolygon(image, polygon)) {
                this.selectedStrokes.add(image);
            }
        }
        // Select-only must not push undo history
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
            setActiveTexts(this.doc, texts);
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
        const images = this.images().filter((img) => !this.hitImage(img, x, y, radius));
        if (images.length !== this.images().length) {
            this.setImages(images);
            this.scheduleSave();
        }
    },

    hitImage(img, x, y, radius) {
        if (!img) return false;
        const b = getImageBounds(img);
        return x >= b.minX - radius && x <= b.maxX + radius && y >= b.minY - radius && y <= b.maxY + radius;
    },

    hitStroke(stroke, x, y, radius) {
        if (stroke.tool === 'brush' && stroke.points?.length) {
            return stroke.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) <= radius + (stroke.width || 3));
        }
        if (stroke.tool === 'text') {
            return x >= stroke.x - radius && x <= stroke.x + 200 && y >= stroke.y - radius && y <= stroke.y + 60;
        }
        if (stroke.tool === 'image') {
            return this.hitImage(stroke, x, y, radius);
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

        // Copy-paper note text under strokes (same world coords as drawing).
        if (this.isNoteCanvasMode && noteHasTextOverlayEnabled(this.noteCanvasItem)) {
            paintNoteTextOverlay(this.ctx, this.noteCanvasItem, {
                fillColor: this.pageBackgroundFill(),
                doc: this.doc,
                pageIndex: activePageIndex(this.doc)
            });
        }

        const images = this.images();
        ensureImagesLoaded(images, () => { if (this.active) this.requestRedraw(); });
        images.forEach((img) => drawImageObject(this.ctx, img));

        this.strokes().forEach((stroke) => {
            if (stroke.tool === 'brush') drawBrushStroke(this.ctx, stroke);
            else drawShapeStroke(this.ctx, stroke);
        });
        getActiveTexts(this.doc).forEach((t) => drawTextObject(this.ctx, t));
        if (this.draftStroke) drawBrushStroke(this.ctx, this.draftStroke);
        if (this.shapePreview) drawShapeStroke(this.ctx, this.shapePreview);

        // Render lasso overlay (path, box selection, selection box, resize handles)
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
        if (!this.strokes().length && !getActiveTexts(this.doc).length && !this.images().length) return;
        if (!confirm('Clear the current canvas page?')) return;
        this.pushLayerHistory();
        this.setStrokes([]);
        this.setImages([]);
        setActiveTexts(this.doc, []);
        this.selectedStrokes.clear();
        this.shrinkInfiniteIfNeeded();
        this.redraw();
        this.scheduleSave();
    },

    scheduleSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
    },

    async flushSave() {
        clearTimeout(this.saveTimer);
        this.doc.viewport = CanvasViewport.toDoc();
        if (this.isNoteCanvasMode && this.noteCanvasItem) {
            const item = this.noteCanvasItem;
            const doc = JSON.parse(JSON.stringify(this.doc));
            const { mutateItem } = await import('./noteSurfaceMutations.js');
            mutateItem(item, (it) => {
                it.canvas = doc;
            }, { preserveView: true, skipRerender: true });
            return;
        }
        await writeDocument(this.doc);
    },

    setCanvasMode(mode) {
        if (!CANVAS_MODES.includes(mode)) return;
        if (this.doc.canvasMode === mode) {
            if (mode !== 'infinite') {
                const page = this.doc.pages.find((p) => p.id === this.doc.activePageId) || this.doc.pages[0];
                if (page) page.format = mode;
            }
            this.adaptNoteTextOverlayToCanvas();
            this.resize();
            this.scheduleSave();
            this.renderToolbar();
            return;
        }
        this.history.push(this.getSnapshot());
        switchCanvasMode(this.doc, mode);
        this.adaptNoteTextOverlayToCanvas();
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

    currentToolEcho() {
        if (this.isLassoActive) {
            return { id: 'lasso', label: 'Select', icon: DRAWING_ICONS.lasso };
        }
        const tool = this.activeTool;
        if (tool === 'pan') {
            return { id: 'pan', label: 'Hand', icon: DRAWING_ICONS.hand };
        }
        if (tool === 'eraser') {
            return { id: 'eraser', label: 'Eraser', icon: DRAWING_ICONS.eraser };
        }
        if (tool === 'pointer') {
            return { id: 'pointer', label: 'Pointer', icon: DRAWING_ICONS.pointer };
        }
        if (tool === 'text') {
            return { id: 'text', label: 'Text', icon: DRAWING_ICONS.text };
        }
        if (isDragShape(tool)) {
            const shape = SHAPE_ITEMS.find((item) => item.id === tool);
            return {
                id: tool,
                label: shape?.label || 'Shape',
                icon: DRAWING_ICONS[tool] || DRAWING_ICONS.shapes
            };
        }
        if (tool === 'brush') {
            const style = POINTER_ITEMS.find((item) => item.id === this.activeStyle);
            return {
                id: this.activeStyle,
                label: style?.label || 'Brush',
                icon: DRAWING_ICONS[this.activeStyle] || DRAWING_ICONS.pen
            };
        }
        return {
            id: tool || 'pointer',
            label: tool || 'Pointer',
            icon: DRAWING_ICONS[tool] || DRAWING_ICONS.pointer
        };
    },

    updateToolEcho() {
        const echo = this.currentToolEcho();
        const root = document.getElementById('draw-tool-echo');
        const iconEl = document.getElementById('draw-tool-echo-icon');
        const labelEl = document.getElementById('draw-tool-echo-label');
        if (!root || !iconEl || !labelEl) return;
        iconEl.innerHTML = echo.icon || '';
        labelEl.textContent = echo.label;
        root.dataset.tool = echo.id;
        root.setAttribute('aria-label', `Current tool: ${echo.label}`);
        root.title = `Current tool: ${echo.label}`;
    },

    updateNoteToolbarChrome() {
        const titleEl = document.getElementById('draw-note-title');
        const contentBtn = document.getElementById('draw-note-show-content');
        const checklistBtn = document.getElementById('draw-note-show-checklist');
        const sizeGroup = document.getElementById('draw-note-overlay-size-group');
        const sizeLabel = document.getElementById('draw-note-overlay-size');
        const smallerBtn = document.getElementById('draw-note-overlay-smaller');
        const largerBtn = document.getElementById('draw-note-overlay-larger');
        const noteMode = !!(this.isNoteCanvasMode && this.noteCanvasItem);
        if (this.noteCanvasItem) migrateNoteCanvasTextFlags(this.noteCanvasItem);

        if (titleEl) {
            if (noteMode) {
                const full = stripRichText(this.noteCanvasItem.title || '').trim() || 'Untitled';
                titleEl.textContent = full;
                titleEl.title = full;
                titleEl.setAttribute('aria-label', full);
                titleEl.hidden = false;
                titleEl.classList.remove('is-hidden');
            } else {
                titleEl.textContent = '';
                titleEl.removeAttribute('title');
                titleEl.removeAttribute('aria-label');
                titleEl.hidden = true;
                titleEl.classList.add('is-hidden');
            }
        }

        const bindToggle = (btn, { on, titleOn, titleOff, icon, flag }) => {
            if (!btn) return;
            if (noteMode) {
                btn.hidden = false;
                btn.classList.remove('is-hidden');
                btn.classList.toggle('active', on);
                btn.setAttribute('aria-pressed', on ? 'true' : 'false');
                btn.title = on ? titleOn : titleOff;
                btn.setAttribute('aria-label', on ? titleOn : titleOff);
                if (!btn.dataset.bound) {
                    btn.dataset.bound = '1';
                    btn.innerHTML = icon;
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        this.toggleNoteTextOverlayLayer(flag);
                    });
                }
            } else {
                btn.hidden = true;
                btn.classList.add('is-hidden');
                btn.classList.remove('active');
                btn.setAttribute('aria-pressed', 'false');
            }
        };

        bindToggle(contentBtn, {
            on: !!this.noteCanvasItem?.canvasShowNoteContent,
            titleOn: 'Hide note content',
            titleOff: 'Show note content',
            icon: DRAWING_ICONS.text,
            flag: 'content'
        });
        bindToggle(checklistBtn, {
            on: !!this.noteCanvasItem?.canvasShowNoteChecklist,
            titleOn: 'Hide checklist',
            titleOff: 'Show checklist',
            icon: FORMAT_ICONS.toChecklist,
            flag: 'checklist'
        });

        if (sizeGroup) {
            if (noteMode) {
                sizeGroup.hidden = false;
                sizeGroup.classList.remove('is-hidden');
                const size = resolveOverlayFontSize(this.noteCanvasItem);
                const percent = overlayFontSizeToPercent(size);
                if (sizeLabel) {
                    sizeLabel.textContent = `${percent}%`;
                    sizeLabel.title = `Text height ${size} (canvas units)`;
                }
                if (smallerBtn) {
                    smallerBtn.disabled = size <= OVERLAY_FONT_MIN;
                    smallerBtn.title = 'Smaller overlay text';
                    smallerBtn.setAttribute('aria-label', 'Smaller overlay text');
                    if (!smallerBtn.dataset.bound) {
                        smallerBtn.dataset.bound = '1';
                        smallerBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.nudgeNoteOverlayFontSize(-OVERLAY_FONT_STEP);
                        });
                    }
                }
                if (largerBtn) {
                    largerBtn.disabled = size >= OVERLAY_FONT_MAX;
                    largerBtn.title = 'Larger overlay text';
                    largerBtn.setAttribute('aria-label', 'Larger overlay text');
                    if (!largerBtn.dataset.bound) {
                        largerBtn.dataset.bound = '1';
                        largerBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            this.nudgeNoteOverlayFontSize(OVERLAY_FONT_STEP);
                        });
                    }
                }
            } else {
                sizeGroup.hidden = true;
                sizeGroup.classList.add('is-hidden');
            }
        }
    },

    async nudgeNoteOverlayFontSize(delta) {
        const item = this.noteCanvasItem;
        if (!item || !this.isNoteCanvasMode) return;
        const next = resolveOverlayFontSize({
            canvasOverlayFontSize: resolveOverlayFontSize(item) + delta
        });
        if (next === resolveOverlayFontSize(item) && item.canvasOverlayFontSize === next) return;
        item.canvasOverlayFontSize = next;
        this.updateNoteToolbarChrome();
        if (noteHasTextOverlayEnabled(item)) {
            ensureCanvasFitsNoteText(this.doc, item);
            this.resize();
        } else {
            this.redrawBackground();
            this.redraw();
        }
        try {
            const { mutateItem } = await import('./noteSurfaceMutations.js');
            mutateItem(item, (it) => {
                it.canvasOverlayFontSize = next;
            }, { preserveView: true, skipRerender: true, localOnly: true });
        } catch {
            /* ignore persist helper load errors — size already set on item */
        }
        this.scheduleSave();
    },

    async toggleNoteTextOverlayLayer(flag) {
        const item = this.noteCanvasItem;
        if (!item || !this.isNoteCanvasMode) return;
        migrateNoteCanvasTextFlags(item);
        const key = flag === 'checklist' ? 'canvasShowNoteChecklist' : 'canvasShowNoteContent';
        const next = !item[key];
        // Flip immediately so UI + paint don't wait on the dynamic import.
        item[key] = next;
        this.updateNoteToolbarChrome();
        if (next) {
            CanvasViewport.offsetX = 0;
            CanvasViewport.offsetY = 0;
            CanvasViewport.clampOffsets();
            CanvasViewport.applyTransform();
            CanvasViewport.syncScrollbars?.();
            ensureCanvasFitsNoteText(this.doc, item);
            this.resize();
        } else {
            this.redrawBackground();
            this.redraw();
        }
        try {
            const { mutateItem } = await import('./noteSurfaceMutations.js');
            mutateItem(item, (it) => {
                migrateNoteCanvasTextFlags(it);
                it[key] = next;
            }, { preserveView: true, skipRerender: true, localOnly: true });
        } catch {
            /* ignore persist helper load errors — flag already set on item */
        }
        this.scheduleSave();
    },

    pointerSelected() {
        return this.activeStyle;
    },

    pointerTriggerIcon() {
        return DRAWING_ICONS[this.activeStyle] || DRAWING_ICONS.pen;
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
                this.setStyle(id);
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
            this.goToPrevPage();
            return;
        }
        if (id === 'page-next') {
            this.goToNextPage();
            return;
        }
        if (id === 'page-add') {
            this.addCanvasPage();
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
        const isPointerActive = this.activeTool === 'pointer' || this.activeTool === 'brush';
        const isEraserActive = this.activeTool === 'eraser';
        const isPanActive = this.activeTool === 'pan';
        const pageIdx = this.doc.pages.findIndex((p) => p.id === this.doc.activePageId);
        const pageCount = this.doc.pages.length;
        const canPrev = pageIdx > 0;
        const canNext = pageIdx >= 0 && pageIdx < pageCount - 1;
        const exitBtn = this.isNoteCanvasMode
            ? `<button type="button" class="btn btn--compact btn--icon" id="draw-back-to-note" title="Back to note" aria-label="Back to note">${ACTION_ICONS.viewFree}</button>`
            : `<button type="button" class="btn btn--compact btn--icon" id="draw-exit-drawing" title="Exit drawing mode" aria-label="Exit drawing mode">${ACTION_ICONS.viewFree}</button>`;

        this.toolbarEl.innerHTML = `
            <div class="drawing-toolbar-row">
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown ${isPointerActive ? 'active' : ''}" id="draw-menu-pointer" aria-haspopup="menu" aria-expanded="false" title="Pointer tools (V)" aria-label="Pointer tools">
                    <span class="drawing-dropdown-icon">${this.pointerTriggerIcon()}</span>
                    <span class="drawing-dropdown-width" id="draw-pointer-width">${brush.width}px</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <button type="button" class="btn btn--compact btn--icon ${isEraserActive ? 'active' : ''}" id="draw-eraser" title="Eraser (E)" aria-label="Eraser" aria-pressed="${isEraserActive ? 'true' : 'false'}">${DRAWING_ICONS.eraser}</button>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <div class="drawing-color-group" id="draw-color-group">
                    <button type="button" class="btn btn--compact btn--icon drawing-color-chip-btn" id="draw-color-btn" title="Color" aria-label="Color" aria-expanded="false" style="--chip-color:${brush.color}">
                        <span class="drawing-color-chip" style="background:${brush.color}"></span>
                    </button>
                </div>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-shapes" aria-haspopup="menu" aria-expanded="false" title="Shapes" aria-label="Shapes">
                    <span class="drawing-dropdown-icon">${this.shapeTriggerIcon()}</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-insert-image" title="Insert image" aria-label="Insert image" aria-haspopup="menu">${DRAWING_ICONS.image}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-lasso" title="Rectangle select (L)" aria-label="Rectangle select" ${this.isLassoActive ? 'aria-pressed="true"' : ''}>${DRAWING_ICONS.lasso}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-display-options" title="Display options" aria-label="Display options" aria-expanded="false" aria-haspopup="menu">${ACTION_ICONS.displayOptions}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-fullscreen" title="Full screen" aria-label="Full screen" aria-pressed="false">${ACTION_ICONS.fullscreenEnter}</button>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <button type="button" class="btn btn--compact btn--icon ${isPanActive ? 'active' : ''}" id="draw-pan" title="Hand tool — pan canvas (H). Scroll also pans; Ctrl+scroll zooms; Space+drag pans." aria-label="Hand tool" aria-pressed="${isPanActive ? 'true' : 'false'}">${DRAWING_ICONS.hand}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-zoom-out" title="Zoom out" aria-label="Zoom out">${DRAWING_ICONS.zoomOut}</button>
                <span class="drawing-zoom-level" id="draw-zoom-level" title="Zoom level" aria-label="Zoom level">100%</span>
                <button type="button" class="btn btn--compact btn--icon" id="draw-zoom-in" title="Zoom in" aria-label="Zoom in">${DRAWING_ICONS.zoomIn}</button>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <button type="button" class="btn btn--compact btn--icon" id="draw-undo" title="Undo" aria-label="Undo" ${this.history.canUndo ? '' : 'disabled'}>${ACTION_ICONS.undo}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-redo" title="Redo" aria-label="Redo" ${this.history.canRedo ? '' : 'disabled'}>${ACTION_ICONS.redo}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-clear" title="Clear" aria-label="Clear">${ACTION_ICONS.layoutReset}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-toolbar-hide" title="Hide toolbar" aria-label="Hide toolbar">${ACTION_ICONS.collapseAll}</button>
                ${exitBtn}
            </div>
            <div class="drawing-toolbar-row drawing-toolbar-row--meta">
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-canvas" aria-haspopup="menu" aria-expanded="false" title="Canvas settings" aria-label="Canvas settings">
                    <span class="drawing-dropdown-label">Canvas</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <span class="drawing-page-nav" aria-label="Page navigation">
                    <button type="button" class="btn btn--compact btn--icon" id="draw-page-prev" title="Previous page" aria-label="Previous page" ${canPrev ? '' : 'disabled'}>${DRAWING_ICONS.pagePrev}</button>
                    <span class="drawing-page-label" id="draw-page-label" title="Current page">${this.pageLabel()}</span>
                    <button type="button" class="btn btn--compact btn--icon" id="draw-page-next" title="Next page" aria-label="Next page" ${canNext ? '' : 'disabled'}>${DRAWING_ICONS.pageNext}</button>
                    <button type="button" class="btn btn--compact btn--icon" id="draw-page-add" title="Add page" aria-label="Add page">${DRAWING_ICONS.pageAdd}</button>
                </span>
            </div>
        `;
        this.bindToolbar();
        this.updateZoomLevel();
        this.updateToolEcho();
        this.updateNoteToolbarChrome();
        if (wasColorOpen) {
            const btn = this.toolbarEl.querySelector('#draw-color-btn');
            if (btn) this.toggleColorRollout(btn);
        }
    },

    updateZoomLevel() {
        const el = this.toolbarEl?.querySelector('#draw-zoom-level');
        if (!el) return;
        el.textContent = `${Math.round(CanvasViewport.scale * 100)}%`;
    },

    bindToolbar() {
        if (!this.toolbarEl) return;
        const q = (sel) => this.toolbarEl.querySelector(sel);

        q('#draw-toolbar-hide')?.addEventListener('click', () => { ColorPicker.close(); this.colorRolloutOpen = false; this.hideToolbar(); });
        q('#draw-exit-drawing')?.addEventListener('click', () => { this.app.switchWorkspaceMode('notes'); });
        q('#draw-back-to-note')?.addEventListener('click', () => { this.exitNoteCanvas(); });
        q('#draw-undo')?.addEventListener('click', () => this.undo());
        q('#draw-redo')?.addEventListener('click', () => this.redo());
        q('#draw-clear')?.addEventListener('click', () => this.clearAll());
        q('#draw-color-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleColorRollout(e.currentTarget);
        });
        q('#draw-zoom-in')?.addEventListener('click', () => { CanvasViewport.stepZoom(0.1); this.persistViewport(); });
        q('#draw-zoom-out')?.addEventListener('click', () => { CanvasViewport.stepZoom(-0.1); this.persistViewport(); });
        q('#draw-pan')?.addEventListener('click', () => {
            if (this.activeTool === 'pan') this.setStyle(this.activeStyle || 'pen');
            else this.setTool('pan');
        });
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

        q('#draw-eraser')?.addEventListener('click', () => {
            this.setTool('eraser');
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

        q('#draw-insert-image')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openImageInsertMenu(e.currentTarget);
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

        q('#draw-page-prev')?.addEventListener('click', () => this.goToPrevPage());
        q('#draw-page-next')?.addEventListener('click', () => this.goToNextPage());
        q('#draw-page-add')?.addEventListener('click', () => this.addCanvasPage());

        // Export menu disabled until canvasExport.js is unified with live renderer.

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

        if (e.key === 'e' || e.key === 'E') {
            e.preventDefault();
            this.setTool('eraser');
            return true;
        }

        if (e.key === 'h' || e.key === 'H') {
            e.preventDefault();
            if (this.activeTool === 'pan') this.setStyle(this.activeStyle || 'pen');
            else this.setTool('pan');
            return true;
        }
        
        // Lasso tool keyboard shortcut
        if (e.key === 'l' || e.key === 'L') {
            e.preventDefault();
            this.toggleLassoMode();
            return true;
        }
        
        // Escape to clear selection or exit rectangle-select mode
        if (e.key === 'Escape') {
            if (this.resizeHandle) {
                this.finishResize();
                this.redraw();
                return true;
            }
            if (this.isDraggingLasso) {
                this.finishLassoDrag();
                this.redraw();
                return true;
            }
            if (this.isBoxSelecting) {
                this.isBoxSelecting = false;
                this.boxSelectStart = null;
                this.boxSelectCurrent = null;
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

    // Marquee (lasso button) methods — rectangle select mode
    toggleLassoMode() {
        if (this.isLassoActive) {
            this.clearLassoSelection();
        } else {
            this.startLassoMode();
        }
    },

    startLassoMode() {
        this.isLassoActive = true;
        this.selectedStrokes.clear();
        this.isDraggingLasso = false;
        this.isBoxSelecting = false;
        this.boxSelectStart = null;
        this.boxSelectCurrent = null;
        // Marquee mode uses pointer-style selection; keep activeTool as pointer for prefs
        this.activeTool = 'pointer';
        this.prefs.activeTool = 'pointer';
        writePrefs(this.prefs);
        if (this.canvas) this.canvas.dataset.tool = 'lasso';
        this.renderToolbar();
        this.redraw();
    },

    clearLassoSelection() {
        this.isLassoActive = false;
        this.selectedStrokes.clear();
        this.isDraggingLasso = false;
        this.lassoDragStart = null;
        this.isBoxSelecting = false;
        this.boxSelectStart = null;
        this.boxSelectCurrent = null;
        // Do not wipe textLayer here — it may contain active contentEditable boxes.
        if (this.canvas) this.canvas.dataset.tool = this.activeTool;
        this.renderToolbar();
        this.redraw();
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

        // Dashed blue rectangle marquee while dragging
        if (this.isBoxSelecting && this.boxSelectStart && this.boxSelectCurrent) {
            const x0 = Math.min(this.boxSelectStart.x, this.boxSelectCurrent.x);
            const y0 = Math.min(this.boxSelectStart.y, this.boxSelectCurrent.y);
            const x1 = Math.max(this.boxSelectStart.x, this.boxSelectCurrent.x);
            const y1 = Math.max(this.boxSelectStart.y, this.boxSelectCurrent.y);

            this.ctx.save();
            this.ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
            this.ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([4, 2]);
            this.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            this.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
            this.ctx.restore();
        }

        // Selection bounding box + resize handles
        if (this.selectedStrokes.size > 0) {
            const bounds = getStrokesBounds(this.getSelectedStrokesArray());
            this.ctx.save();
            this.ctx.strokeStyle = '#3b82f6';
            this.ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
            this.ctx.lineWidth = 1.5;
            this.ctx.setLineDash([4, 2]);
            this.ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
            this.ctx.setLineDash([]);
            this.ctx.restore();

            // Center move handle
            const centerX = bounds.minX + bounds.width / 2;
            const centerY = bounds.minY + bounds.height / 2;
            this.ctx.save();
            this.ctx.fillStyle = '#3b82f6';
            this.ctx.beginPath();
            this.ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();

            // Corner/edge resize handles
            this.getResizeHandles(bounds).forEach((h) => {
                this.ctx.save();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.strokeStyle = '#3b82f6';
                this.ctx.lineWidth = 1.5;
                this.ctx.fillRect(h.x - RESIZE_HANDLE_SIZE / 2, h.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
                this.ctx.strokeRect(h.x - RESIZE_HANDLE_SIZE / 2, h.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
                this.ctx.restore();
            });
        }
    },

    getResizeHandles(bounds) {
        if (!bounds) return [];
        const { minX, minY, maxX, maxY } = bounds;
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        return [
            { id: 'nw', x: minX, y: minY, cursor: 'nwse-resize' },
            { id: 'n', x: midX, y: minY, cursor: 'ns-resize' },
            { id: 'ne', x: maxX, y: minY, cursor: 'nesw-resize' },
            { id: 'e', x: maxX, y: midY, cursor: 'ew-resize' },
            { id: 'se', x: maxX, y: maxY, cursor: 'nwse-resize' },
            { id: 's', x: midX, y: maxY, cursor: 'ns-resize' },
            { id: 'sw', x: minX, y: maxY, cursor: 'nesw-resize' },
            { id: 'w', x: minX, y: midY, cursor: 'ew-resize' }
        ];
    },

    hitResizeHandle(x, y) {
        if (this.selectedStrokes.size === 0) return null;
        const bounds = getStrokesBounds(this.getSelectedStrokesArray());
        const handles = this.getResizeHandles(bounds);
        for (const h of handles) {
            if (Math.abs(x - h.x) <= RESIZE_HANDLE_HIT / 2 && Math.abs(y - h.y) <= RESIZE_HANDLE_HIT / 2) {
                return h;
            }
        }
        return null;
    },

    startResize(handle, x, y) {
        const selected = this.getSelectedStrokesArray();
        if (!selected.length) return;
        const bounds = getStrokesBounds(selected);
        this.pushLayerHistory();
        this.resizeHandle = handle.id;
        this.resizeStart = {
            x,
            y,
            bounds: { ...bounds },
            // Snapshot each selected item's geometry so we can scale from original
            items: selected.map((item) => ({
                ref: item,
                x: item.x,
                y: item.y,
                width: item.width,
                height: item.height,
                x0: item.x0,
                y0: item.y0,
                x1: item.x1,
                y1: item.y1,
                points: item.points ? item.points.map((p) => ({ ...p })) : null
            }))
        };
    },

    applyResize(x, y) {
        if (!this.resizeHandle || !this.resizeStart) return;
        const start = this.resizeStart.bounds;
        const handle = this.resizeHandle;
        let newMinX = start.minX;
        let newMinY = start.minY;
        let newMaxX = start.maxX;
        let newMaxY = start.maxY;

        if (handle.includes('w')) newMinX = Math.min(x, start.maxX - MIN_IMAGE_SIDE);
        if (handle.includes('e')) newMaxX = Math.max(x, start.minX + MIN_IMAGE_SIDE);
        if (handle.includes('n')) newMinY = Math.min(y, start.maxY - MIN_IMAGE_SIDE);
        if (handle.includes('s')) newMaxY = Math.max(y, start.minY + MIN_IMAGE_SIDE);

        // Maintain aspect ratio for corner handles
        const isCorner = handle.length === 2;
        if (isCorner && start.width > 0 && start.height > 0) {
            const aspect = start.width / start.height;
            let w = newMaxX - newMinX;
            let h = newMaxY - newMinY;
            if (w / h > aspect) {
                h = w / aspect;
            } else {
                w = h * aspect;
            }
            if (handle.includes('w')) newMinX = newMaxX - w;
            else newMaxX = newMinX + w;
            if (handle.includes('n')) newMinY = newMaxY - h;
            else newMaxY = newMinY + h;
        }

        const newW = Math.max(MIN_IMAGE_SIDE, newMaxX - newMinX);
        const newH = Math.max(MIN_IMAGE_SIDE, newMaxY - newMinY);
        const scaleX = start.width > 0 ? newW / start.width : 1;
        const scaleY = start.height > 0 ? newH / start.height : 1;

        for (const snap of this.resizeStart.items) {
            const item = snap.ref;
            if (!item) continue;
            if (item.tool === 'image' || (item.mediaId && snap.width != null)) {
                item.x = newMinX + (snap.x - start.minX) * scaleX;
                item.y = newMinY + (snap.y - start.minY) * scaleY;
                item.width = Math.max(MIN_IMAGE_SIDE, snap.width * scaleX);
                item.height = Math.max(MIN_IMAGE_SIDE, snap.height * scaleY);
            } else if (Array.isArray(item.points) && snap.points) {
                for (let i = 0; i < item.points.length; i++) {
                    item.points[i].x = newMinX + (snap.points[i].x - start.minX) * scaleX;
                    item.points[i].y = newMinY + (snap.points[i].y - start.minY) * scaleY;
                }
            } else if (item.tool === 'text') {
                item.x = newMinX + (snap.x - start.minX) * scaleX;
                item.y = newMinY + (snap.y - start.minY) * scaleY;
                if (item.fontSize) item.fontSize = Math.max(8, (snap.height || item.fontSize) * scaleY);
            } else if (snap.x0 != null) {
                item.x0 = newMinX + (snap.x0 - start.minX) * scaleX;
                item.y0 = newMinY + (snap.y0 - start.minY) * scaleY;
                item.x1 = newMinX + (snap.x1 - start.minX) * scaleX;
                item.y1 = newMinY + (snap.y1 - start.minY) * scaleY;
            }
        }

        const dims = getPageDimensions(this.doc);
        const pageBounds = getPageBounds(this.doc, dims);
        clampStrokesToBounds(this.getSelectedStrokesArray(), pageBounds);
        this.redraw();
    },

    finishResize() {
        if (!this.resizeHandle) return;
        this.resizeHandle = null;
        this.resizeStart = null;
        this.scheduleSave();
    },

    updateHoverCursor(x, y) {
        if (!this.canvas) return;
        if (this.selectedStrokes.size > 0) {
            const handle = this.hitResizeHandle(x, y);
            if (handle) {
                this.hoverHandle = handle.id;
                this.canvas.style.cursor = handle.cursor;
                return;
            }
            const bounds = getStrokesBounds(this.getSelectedStrokesArray());
            if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
                this.hoverHandle = null;
                this.canvas.style.cursor = 'move';
                return;
            }
        }
        this.hoverHandle = null;
        this.canvas.style.cursor = this.activeTool === 'pointer' ? 'default' : '';
        if (this.canvas.dataset.tool) {
            // Fall back to CSS data-tool rules when not hovering selection
            this.canvas.style.cursor = '';
        }
    },

    async openImageInsertMenu(anchor) {
        let items;
        try {
            const media = await listMedia();
            const images = (media || []).filter((m) => (m.mime || '').startsWith('image/') && m.blobPresent !== false);
            if (!images.length) {
                showAppToast('No images in the media library yet');
                return;
            }
            items = [
                { heading: 'Insert from media library' },
                ...images.slice(0, 40).map((m) => ({
                    id: m.id,
                    label: m.title || m.filename || m.id,
                    icon: DRAWING_ICONS.image
                }))
            ];
        } catch (err) {
            showAppToast('Could not open media library');
            return;
        }

        DrawingToolbarMenu.toggle({
            anchor,
            ariaLabel: 'Insert image',
            items,
            onSelect: (id) => { this.insertImageFromMedia(id); }
        });
    },

    async insertImageFromMedia(mediaId) {
        if (!mediaId || !this.doc) return;
        const img = await loadImage(mediaId);
        if (!img) {
            showAppToast('Could not load that image');
            return;
        }

        const size = initialImageSize(img.naturalWidth, img.naturalHeight);
        // Center in the current viewport (bitmap space)
        const vp = this.viewportEl?.getBoundingClientRect();
        let cx;
        let cy;
        if (vp) {
            const world = this.clientToCanvas(vp.left + vp.width / 2, vp.top + vp.height / 2);
            cx = world.x;
            cy = world.y;
        } else {
            const dims = getPageDimensions(this.doc);
            cx = dims.width / 2;
            cy = dims.height / 2;
        }

        const item = {
            id: createId('img'),
            tool: 'image',
            mediaId,
            x: cx - size.width / 2,
            y: cy - size.height / 2,
            width: size.width,
            height: size.height,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight
        };

        this.pushLayerHistory();
        const images = this.images().slice();
        images.push(item);
        this.setImages(images);
        if (this.doc.canvasMode === 'infinite') {
            this.expandInfiniteIfNeeded(item.x, item.y);
            this.expandInfiniteIfNeeded(item.x + item.width, item.y + item.height);
        }
        this.selectedStrokes.clear();
        this.selectedStrokes.add(item);
        this.setTool('pointer');
        this.scheduleSave();
        this.redraw();
    },

};

const TOOLBAR_STATE_KEY = 'matrix_drawing_toolbar';

export async function getDrawingBackupKeys() {
    // IndexedDB is the primary store; read the persisted document directly.
    let matrix_global_drawing = null;
    try {
        const doc = await readDocument();
        matrix_global_drawing = JSON.stringify(doc);
    } catch (e) {
        matrix_global_drawing = localStorage.getItem(STORAGE_KEY);
    }

    return {
        matrix_global_drawing,
        matrix_drawing_prefs: localStorage.getItem(PREFS_KEY),
        matrix_workspace_mode: localStorage.getItem('matrix_workspace_mode'),
        matrix_drawing_toolbar: localStorage.getItem(TOOLBAR_STATE_KEY)
    };
}

export async function applyDrawingBackupKeys(backup) {
    if (backup.matrix_global_drawing != null) {
        let doc = backup.matrix_global_drawing;
        if (typeof doc === 'string') {
            try {
                doc = JSON.parse(doc);
            } catch {
                // Leave as raw string; writeDocument will fail gracefully below.
            }
        }
        try {
            await writeDocument(doc);
        } catch (e) {
            // Fallback to localStorage only if IndexedDB write fails.
        }
        try {
            localStorage.setItem(STORAGE_KEY, typeof doc === 'string' ? doc : JSON.stringify(doc));
        } catch (e) {
            // Ignore quota errors.
        }
    }
    if (backup.matrix_drawing_prefs != null) {
        const prefs = typeof backup.matrix_drawing_prefs === 'string'
            ? backup.matrix_drawing_prefs : JSON.stringify(backup.matrix_drawing_prefs);
        localStorage.setItem(PREFS_KEY, prefs);
    }
    if (backup.matrix_workspace_mode != null) {
        localStorage.setItem('matrix_workspace_mode', backup.matrix_workspace_mode);
    }
    const toolbarState = backup.matrix_drawing_toolbar;
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
