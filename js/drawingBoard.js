/** @module {"owns":"magicCanvas drawing board, workspace drawing mode", "related":["canvasDocument.js","drawingToolbarMenu.js","layoutStorage.js"]} */
import { ACTION_ICONS, CARD_ICONS, DRAWING_ICONS, FORMAT_ICONS } from './icons.js';
import { ColorPicker, PALETTE_UNIFIED, resolveNoteColor } from './colorPicker.js';
import { DrawingToolbarMenu, CHEVRON } from './drawingToolbarMenu.js';
import { Fullscreen } from './fullscreen.js';
import {
    readDocument, writeDocument, getActiveStrokes, getActiveTexts, setActiveStrokes, setActiveTexts,
    getActiveImages, setActiveImages,
    getActiveBackground, setActiveBackground, getActiveBackgroundColor, setActiveBackgroundColor,
    getPageDimensions, addPage, nextPage, prevPage, switchCanvasMode,
    expandInfiniteBounds, shrinkInfiniteBounds, STORAGE_KEY, createId, CANVAS_MODES, BACKGROUNDS,
    PAGE_FORMATS
} from './canvasDocument.js';
import { BRUSH_STYLES, DRAG_SHAPE_TOOLS, drawBrushStroke, drawShapeStroke, drawTextObject } from './canvasBrushes.js';
import { renderBackground } from './canvasBackgrounds.js';
import { CanvasViewport } from './canvasViewport.js';
import { DrawingToolbarChrome } from './drawingToolbarChrome.js';
import {
    itemIntersectsRect,
    getStrokesBounds,
    clampStrokesToBounds,
    translateStrokes,
    getPageBounds,
    getImageBounds,
    resolveBoxSelection,
    boxSelectThresholdWorld,
    findTopmostItemAt,
    raiseItemInLayer,
    BOX_SELECT_CLICK_THRESHOLD
} from './lassoGeometry.js';
import {
    loadImage,
    clearImageCache,
    ensureImagesLoaded,
    initialImageSize,
    cropMetrics,
    cropLimitRect,
    normalizeCropBox,
    resizeCropBox,
    moveCropBox,
    boxToCropPatch,
    drawImageObject,
    drawImageGhost,
    getImageSourceWindow,
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

/** Minimum world-space distance between recorded stroke points, by brush style. */
const POINT_SPACING = {
    pen: 1.5,
    marker: 1.5,
    highlighter: 2,
    pencil: 3.5,
    spray: 4,
    calligraphy: 2,
    brush: 2.5
};

/** Minimum distance used when simplifying a finished stroke (drop near-collinear points). */
const THIN_MIN_DIST = 2;
const THIN_COLLINEAR_EPS = 0.35;

const POINTER_ITEMS = [
    { id: 'pen', label: 'Pen' },
    { id: 'marker', label: 'Marker' },
    { id: 'highlighter', label: 'Highlighter' },
    { id: 'pencil', label: 'Pencil' },
    { id: 'spray', label: 'Spray' },
    { id: 'calligraphy', label: 'Broad nib' },
    { id: 'brush', label: 'Ink brush' }
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

function pointSpacingForStyle(style) {
    return POINT_SPACING[style] ?? 2;
}

function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

/**
 * Drop redundant points from a finished stroke while keeping endpoints and
 * pressure/tilt samples that meaningfully change direction or spacing.
 */
function thinStrokePoints(points, minDist = THIN_MIN_DIST, collinearEps = THIN_COLLINEAR_EPS) {
    if (!points || points.length <= 2) return points;
    const minDist2 = minDist * minDist;
    const kept = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const prev = kept[kept.length - 1];
        const cur = points[i];
        const next = points[i + 1];
        if (dist2(prev, cur) < minDist2) continue;
        // Drop if nearly collinear between prev → cur → next
        const ax = cur.x - prev.x;
        const ay = cur.y - prev.y;
        const bx = next.x - cur.x;
        const by = next.y - cur.y;
        const cross = Math.abs(ax * by - ay * bx);
        const lenA = Math.hypot(ax, ay);
        const lenB = Math.hypot(bx, by);
        if (lenA > 0 && lenB > 0 && cross / (lenA * lenB) < collinearEps && dist2(prev, next) < minDist2 * 9) {
            continue;
        }
        kept.push(cur);
    }
    kept.push(points[points.length - 1]);
    return kept;
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
            activeTool: ['pointer', 'brush', 'eraser', 'pan', 'text', 'crop', ...DRAG_SHAPE_TOOLS].includes(raw?.activeTool) ? raw.activeTool : 'pointer',
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
    clear() {
        this.undoStack = [];
        this.redoStack = [];
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
    bgColorRolloutOpen: false,

    // Marquee / rectangle select state (lasso button = rect marquee mode)
    isLassoActive: false,
    selectedStrokes: new Set(),
    isDraggingLasso: false,
    lassoDragStart: null,
    lassoDragMoved: false,
    lassoHistoryPushed: false,

    // Shared box-select state (pointer tool + lasso marquee)
    isBoxSelecting: false,
    boxSelectStart: null,
    boxSelectCurrent: null,

    // Resize handle state (for selected image objects)
    resizeHandle: null,
    resizeStart: null,
    hoverHandle: null,
    lastHoverCursor: null,

    // Crop tool state ({ target, rect: {x0,y0,x1,y1} }) while dragging a crop box
    cropState: null,

    // Note-canvas mode state
    activeNoteId: null,
    isNoteCanvasMode: false,
    noteCanvasItem: null,
    /** Session owner for flush routing: 'workspace' | 'note' | null when idle. */
    docOwner: null,

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
        DrawingToolbarChrome.onCollapse = () => {
            ColorPicker.close();
            DrawingToolbarMenu.close();
            this.colorRolloutOpen = false;
            this.bgColorRolloutOpen = false;
            requestAnimationFrame(() => this.resize());
        };
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
        this.history.clear();
        this.active = true;
        this.docOwner = 'workspace';
        DrawingToolbarChrome.show();
        this.toolbarEl = DrawingToolbarChrome.getToolbarMount();
        this.doc = await readDocument();
        this.prefs = readPrefs();
        this.activeTool = this.prefs.activeTool;
        this.activeStyle = this.prefs.activeStyle;
        this.isNoteCanvasMode = false;
        this.activeNoteId = null;
        this.noteCanvasItem = null;
        this.cropState = null;

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
        this.history.clear();
        this.active = true;
        this.docOwner = 'note';
        this.isNoteCanvasMode = true;
        this.activeNoteId = item.id;
        this.noteCanvasItem = item;
        this.cropState = null;
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

    /**
     * Request exit from note-canvas. App owns deactivate via note:canvas_draw_exited
     * so we never double-flush (which used to write the note doc into workspace storage).
     */
    exitNoteCanvas() {
        if (!this.isNoteCanvasMode) return;
        const item = this.noteCanvasItem;
        if (!item) return;
        window.dispatchEvent(new CustomEvent('note:canvas_draw_exited', { detail: { item } }));
    },

    async deactivate() {
        if (!this.active && !this.docOwner) return;
        this.active = false;
        await this.flushSave();
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        ColorPicker.close();
        DrawingToolbarMenu.close();
        this.colorRolloutOpen = false;
        this.bgColorRolloutOpen = false;
        if (this.brandEl) this.brandEl.textContent = this.brandNotesText;
        this.boardEl?.classList.add('is-hidden');
        this.boardEl?.setAttribute('aria-hidden', 'true');
        DrawingToolbarChrome.hide();
        if (this.textLayer) this.textLayer.innerHTML = '';
        this.toolbarEl = null;
        this.draftStroke = null;
        this.shapePreview = null;
        this.resizeHandle = null;
        this.resizeStart = null;
        this.cropState = null;
        this.hoverHandle = null;
        this.selectedStrokes.clear();
        CanvasViewport.setHandMode(false);
        clearImageCache();
        this.isNoteCanvasMode = false;
        this.activeNoteId = null;
        this.noteCanvasItem = null;
        this.doc = null;
        this.docOwner = null;
        this.history.clear();
        this.updateNoteToolbarChrome();
    },

    hideToolbar() {
        DrawingToolbarChrome.collapse();
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

    setPageBackgroundColor(color, { rerender = true } = {}) {
        setActiveBackgroundColor(this.doc, color);
        this.redrawBackground();
        this.scheduleSave();
        if (rerender) this.renderToolbar();
        else this.updateBgColorChip(color);
    },

    updateBgColorChip(color) {
        const chip = this.toolbarEl?.querySelector('.drawing-bg-color-chip');
        const btn = this.toolbarEl?.querySelector('#draw-bg-color-btn');
        const swatch = color || this.pageBackgroundSwatch();
        if (chip) chip.style.background = swatch;
        if (btn) btn.style.setProperty('--chip-color', swatch);
    },

    openPageBackgroundPicker(anchor) {
        if (this.bgColorRolloutOpen) {
            ColorPicker.close();
            return;
        }
        ColorPicker.close();
        this.colorRolloutOpen = false;
        ColorPicker.open({
            anchor,
            presets: PALETTE_UNIFIED,
            value: this.pageBackgroundFill() || this.pageBackgroundSwatch(),
            align: 'end',
            onSelect: (c) => this.setPageBackgroundColor(c, { rerender: false }),
            onClose: () => { this.bgColorRolloutOpen = false; }
        });
        this.bgColorRolloutOpen = true;
        anchor?.setAttribute('aria-expanded', 'true');
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
        this.cropState = null;
        CanvasViewport.setHandMode(tool === 'pan');
        // setTool is used by V / shapes / eraser / pan — leave dedicated marquee mode
        if (this.isLassoActive) this.isLassoActive = false;
        if (this.canvas) {
            this.canvas.dataset.tool = tool;
            this.canvas.style.cursor = '';
            this.lastHoverCursor = null;
        }
        writePrefs(this.prefs);
        this.renderToolbar();
    },

    persistViewport() {
        if (!this.active || !this.doc || !this.docOwner) return;
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
        this.updateBrushSizeControls();
        if (refreshMenu && DrawingToolbarMenu.isOpen()) {
            DrawingToolbarMenu.setItems(this.pointerMenuItems(), this.pointerSelected());
        }
    },

    updatePointerWidthLabel() {
        this.updateBrushSizeControls();
    },

    updateBrushSizeControls() {
        const width = this.currentBrush().width;
        const label = this.toolbarEl?.querySelector('#draw-brush-width');
        if (label) label.textContent = width + 'px';
        const smaller = this.toolbarEl?.querySelector('#draw-brush-smaller');
        const larger = this.toolbarEl?.querySelector('#draw-brush-larger');
        if (smaller) smaller.disabled = width <= WIDTH_MIN;
        if (larger) larger.disabled = width >= WIDTH_MAX;
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
        ColorPicker.close();
        this.bgColorRolloutOpen = false;
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

        // Crop tool: drag the live frame edges/corners, or slide its window
        if (this.activeTool === 'crop') {
            this.onCropPointerDown(x, y);
            return;
        }

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
            // Keep prior selection visible until endBoxSelect commits the replacement
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

        // Live crop frame drag
        if (this.cropState?.mode) {
            const cropPt = this.clientToCanvas(e.clientX, e.clientY);
            this.moveCropGesture(cropPt.x, cropPt.y);
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

        // Hover cursor: crop session has priority while the crop tool is active
        if (!this.isBoxSelecting && !this.draftStroke && !this.shapePreview && !this.cropState?.mode
            && (this.activeTool === 'pointer' || this.activeTool === 'crop' || this.isLassoActive || this.selectedStrokes.size > 0)) {
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
            const minDist = pointSpacingForStyle(this.draftStroke.style || this.activeStyle);
            const minDist2 = minDist * minDist;
            let added = false;
            events.forEach((ev) => {
                const pt = this.clientToCanvas(ev.clientX, ev.clientY);
                this.expandInfiniteIfNeeded(pt.x, pt.y);
                const last = this.draftStroke.points[this.draftStroke.points.length - 1];
                if (last && dist2(last, pt) < minDist2) return;
                this.draftStroke.points.push({
                    x: pt.x, y: pt.y, p: readPressure(ev), tiltX: ev.tiltX || 0, tiltY: ev.tiltY || 0
                });
                added = true;
            });
            if (added) this.requestRedraw();
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

        // End a live crop gesture (persisted only when the frame moved)
        if (this.cropState?.mode) {
            this.endCropGesture();
            return;
        }

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
                const style = this.draftStroke.style || this.activeStyle;
                const spacing = pointSpacingForStyle(style);
                this.draftStroke.points = thinStrokePoints(
                    this.draftStroke.points,
                    Math.max(THIN_MIN_DIST, spacing * 0.75)
                );
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
        this.requestRedraw();
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
        const threshold = boxSelectThresholdWorld(
            BOX_SELECT_CLICK_THRESHOLD,
            CanvasViewport.scale,
            window.devicePixelRatio || 1
        );
        const result = resolveBoxSelection(x0, y0, x1, y1, threshold);

        // Single click (no drag): select + raise the topmost object under the
        // cursor. Raising is per-layer — images over images, strokes over
        // strokes, texts over texts — so the last clicked object is on top of
        // its own layer without disturbing the paint order between layers.
        if (result.kind === 'click') {
            this.selectAndRaiseAtPoint(x0, y0, threshold / 2);
        } else if (result.rect) {
            // Commit selection in one shot (replaces any prior selection)
            this.selectedStrokes.clear();
            this.selectStrokesInRect(result.rect);
        }

        this.isBoxSelecting = false;
        this.boxSelectStart = null;
        this.boxSelectCurrent = null;
    },

    /**
     * Click-select: pick the visually topmost item at the point and raise it to
     * the top of its own layer (undoable). Misses clear the selection.
     * @param {number} x
     * @param {number} y
     * @param {number} [radius=0]
     */
    selectAndRaiseAtPoint(x, y, radius = 0) {
        const item = findTopmostItemAt(x, y, {
            texts: getActiveTexts(this.doc),
            strokes: this.strokes(),
            images: this.images()
        }, radius);

        this.selectedStrokes.clear();
        if (!item) return;

        const raised = raiseItemInLayer(item, {
            strokes: this.strokes(),
            texts: getActiveTexts(this.doc),
            images: this.images()
        });

        if (raised) {
            // Snapshot before assigning so Ctrl+Z restores the previous order.
            this.pushLayerHistory();
            if (raised.kind === 'images') this.setImages(raised.items);
            else if (raised.kind === 'texts') setActiveTexts(this.doc, raised.items);
            else this.setStrokes(raised.items);
            this.scheduleSave();
        }

        this.selectedStrokes.add(item);
    },

    selectStrokesInRect(rect) {
        if (!rect) return;

        const strokes = this.strokes();
        const texts = getActiveTexts(this.doc);
        const images = this.images();
        this.selectedStrokes.clear();

        for (const stroke of strokes) {
            if (itemIntersectsRect(stroke, rect)) {
                this.selectedStrokes.add(stroke);
            }
        }
        for (const text of texts) {
            if (itemIntersectsRect(text, rect)) {
                this.selectedStrokes.add(text);
            }
        }
        for (const image of images) {
            if (itemIntersectsRect(image, rect)) {
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
        // Eraser skips media/images — remove those via Clear or selection tooling.
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

    /** Topmost image (last painted) under the pointer, or null. */
    findTopmostImageAt(x, y) {
        const images = this.images();
        for (let i = images.length - 1; i >= 0; i -= 1) {
            if (this.hitImage(images[i], x, y, 0)) return images[i];
        }
        return null;
    },

    cropBoxBounds(box) {
        if (!box) return null;
        return { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
    },

    isPointInCropBox(x, y) {
        const state = this.cropState;
        if (!state?.box) return false;
        const { x: bx, y: by, width, height } = state.box;
        return x >= bx && x <= bx + width && y >= by && y <= by + height;
    },

    hitCropHandle(x, y) {
        const box = this.cropState?.box;
        if (!box) return null;
        const handles = this.getResizeHandles(this.cropBoxBounds(box));
        for (const h of handles) {
            if (Math.abs(x - h.x) <= RESIZE_HANDLE_HIT / 2 && Math.abs(y - h.y) <= RESIZE_HANDLE_HIT / 2) {
                return h;
            }
        }
        return null;
    },

    startCropSession(target) {
        this.selectedStrokes.clear();
        this.cropState = {
            target,
            metrics: cropMetrics(target),
            box: {
                x: target.x ?? 0,
                y: target.y ?? 0,
                width: Math.max(1, target.width ?? 1),
                height: Math.max(1, target.height ?? 1)
            },
            adjusted: false,
            mode: null,
            handle: null,
            start: null
        };
    },

    beginCropGesture(mode, x, y, extra = {}) {
        const state = this.cropState;
        if (!state) return;
        const target = state.target;
        state.mode = mode;
        state.handle = extra.handle || null;
        state.start = {
            x,
            y,
            box: { ...state.box },
            images: JSON.parse(JSON.stringify(this.images())),
            geometry: {
                x: target.x,
                y: target.y,
                width: target.width,
                height: target.height,
                crop: target.crop ? { ...target.crop } : null
            }
        };
    },

    /**
     * Pointer entry for the crop tool. Handles resize the live frame, inner
     * drags slide the window over the original image, and drags outside the
     * frame start a fresh box. Nothing persists until the gesture completes.
     */
    onCropPointerDown(x, y) {
        const state = this.cropState;
        if (state?.target) {
            const handle = this.hitCropHandle(x, y);
            if (handle) {
                this.beginCropGesture('resize', x, y, { handle: handle.id });
                return;
            }
            if (this.isPointInCropBox(x, y)) {
                this.beginCropGesture(state.adjusted ? 'move' : 'new', x, y);
                return;
            }
        }
        const target = this.findTopmostImageAt(x, y);
        if (!target) {
            if (!state) showAppToast('Crop: click on an image');
            return;
        }
        if (!state || state.target !== target) this.startCropSession(target);
        this.beginCropGesture('new', x, y);
    },

    /** Live crop: rewrite the item rect + source window on every move. */
    moveCropGesture(x, y) {
        const state = this.cropState;
        if (!state?.mode || !state.start) return;
        const limit = cropLimitRect(state.metrics);
        let next = state.box;
        if (state.mode === 'resize') {
            next = resizeCropBox(state.start.box, state.handle, x, y, limit, MIN_IMAGE_SIDE);
        } else if (state.mode === 'move') {
            next = moveCropBox(state.start.box, x - state.start.x, y - state.start.y, limit);
        } else {
            next = normalizeCropBox({
                x: Math.min(state.start.x, x),
                y: Math.min(state.start.y, y),
                width: Math.abs(x - state.start.x),
                height: Math.abs(y - state.start.y)
            }, limit, MIN_IMAGE_SIDE);
        }
        if (next.x === state.box.x && next.y === state.box.y
            && next.width === state.box.width && next.height === state.box.height) {
            return;
        }
        state.box = next;
        state.adjusted = true;
        state.start.changed = true;
        const patch = boxToCropPatch(state.metrics, next);
        if (!patch) return;
        const target = state.target;
        target.x = patch.x;
        target.y = patch.y;
        target.width = patch.width;
        target.height = patch.height;
        target.crop = patch.crop;
        this.requestRedraw();
    },

    /** End the gesture; push one undo entry and persist only when it moved. */
    endCropGesture() {
        const state = this.cropState;
        if (!state?.mode) return;
        const changed = !!state.start?.changed;
        const geometry = state.start?.images || null;
        const target = state.target;
        state.mode = null;
        state.handle = null;
        state.start = null;
        if (!changed) {
            this.requestRedraw();
            return;
        }
        if (target) {
            const src = getImageSourceWindow(target);
            const naturalW = Number(target.naturalWidth) || src.width;
            const naturalH = Number(target.naturalHeight) || src.height;
            if (src.x <= 0 && src.y <= 0 && src.width >= naturalW && src.height >= naturalH) {
                delete target.crop;
            }
        }
        if (geometry) this.pushCropHistory(geometry);
        this.scheduleSave();
        this.redraw();
    },

    /**
     * Undoable layer snapshot with a stale images array, so a completed crop
     * gesture records exactly the pre-gesture layout as its undo entry.
     */
    pushCropHistory(imagesSnapshot) {
        this.history.push({
            kind: 'layer',
            canvasMode: this.doc.canvasMode,
            activePageId: this.doc.activePageId,
            strokes: JSON.parse(JSON.stringify(getActiveStrokes(this.doc))),
            texts: JSON.parse(JSON.stringify(getActiveTexts(this.doc))),
            images: JSON.parse(JSON.stringify(imagesSnapshot || []))
        });
        this.updateToolbarState();
    },

    /** Escape during a crop drag: restore the gesture start, keep the session. */
    revertCropGesture() {
        const state = this.cropState;
        const start = state?.start;
        if (!state?.mode) return false;
        if (start) {
            const target = state.target;
            const geometry = start.geometry;
            target.x = geometry.x;
            target.y = geometry.y;
            target.width = geometry.width;
            target.height = geometry.height;
            if (geometry.crop) target.crop = { ...geometry.crop };
            else delete target.crop;
            state.box = { ...start.box };
            state.adjusted = true;
        }
        state.mode = null;
        state.handle = null;
        state.start = null;
        this.scheduleSave();
        this.requestRedraw();
        return true;
    },

    /** Escape with no in-flight crop drag: drop the session entirely. */
    clearCropSession() {
        if (!this.cropState) return false;
        this.cropState = null;
        this.requestRedraw();
        return true;
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
        const cropTarget = this.cropState?.target;
        images.forEach((img) => {
            // Dimmed full-frame ghost under the live crop target only.
            if (img === cropTarget && this.cropState) {
                drawImageGhost(this.ctx, img, {
                    limitRect: cropLimitRect(this.cropState.metrics)
                });
            }
            drawImageObject(this.ctx, img);
        });

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

        // Crop tool overlay (active drag box)
        if (this.cropState) this.renderCropOverlay();
    },

    undo() {
        this.clearCropSession();
        const prev = this.history.undo(this.getSnapshot());
        if (prev) { this.applySnapshot(prev); this.renderToolbar(); }
    },

    redo() {
        this.clearCropSession();
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
        if (!this.active || !this.doc || !this.docOwner) return;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
    },

    async flushSave() {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        if (!this.doc || !this.docOwner) return;
        this.doc.viewport = CanvasViewport.toDoc();
        if (this.docOwner === 'note') {
            const item = this.noteCanvasItem;
            if (!item) return;
            const doc = JSON.parse(JSON.stringify(this.doc));
            const { mutateItem } = await import('./noteSurfaceMutations.js');
            mutateItem(item, (it) => {
                it.canvas = doc;
                // Drawing implies the note canvas should be visible on board/modal.
                it.canvasHidden = false;
            }, { preserveView: true, skipRerender: true });
            import('./noteAttachmentsUi.js').then(({ syncNoteCanvasDom }) => {
                syncNoteCanvasDom(item);
            }).catch(() => {});
            return;
        }
        if (this.docOwner === 'workspace') {
            await writeDocument(this.doc);
        }
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
        if (tool === 'crop') {
            return { id: 'crop', label: 'Crop', icon: DRAWING_ICONS.crop };
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
        const plannerTableBtn = document.getElementById('draw-note-show-planner-table');
        const plannerChartBtn = document.getElementById('draw-note-show-planner-chart');
        const sizeGroup = document.getElementById('draw-note-overlay-size-group');
        const sizeLabel = document.getElementById('draw-note-overlay-size');
        const smallerBtn = document.getElementById('draw-note-overlay-smaller');
        const largerBtn = document.getElementById('draw-note-overlay-larger');
        const noteMode = !!(this.isNoteCanvasMode && this.noteCanvasItem);
        const plannerActive = !!(this.noteCanvasItem?.planner && !this.noteCanvasItem?.plannerHidden);
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

        const bindToggle = (btn, { on, titleOn, titleOff, icon, flag, visible = noteMode }) => {
            if (!btn) return;
            if (visible) {
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
        bindToggle(plannerTableBtn, {
            on: !!this.noteCanvasItem?.canvasShowNotePlannerTable,
            titleOn: 'Hide planner table',
            titleOff: 'Show planner table',
            icon: CARD_ICONS.plannerTable,
            flag: 'plannerTable',
            visible: noteMode && plannerActive
        });
        bindToggle(plannerChartBtn, {
            on: !!this.noteCanvasItem?.canvasShowNotePlannerChart,
            titleOn: 'Hide planner chart',
            titleOff: 'Show planner chart',
            icon: CARD_ICONS.plannerChart,
            flag: 'plannerChart',
            visible: noteMode && plannerActive
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
        const keyByFlag = {
            checklist: 'canvasShowNoteChecklist',
            content: 'canvasShowNoteContent',
            plannerTable: 'canvasShowNotePlannerTable',
            plannerChart: 'canvasShowNotePlannerChart'
        };
        const key = keyByFlag[flag] || 'canvasShowNoteContent';
        if ((flag === 'plannerTable' || flag === 'plannerChart')
            && !(item.planner && !item.plannerHidden)) {
            return;
        }
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
        return this.menuItemsWithIcons(POINTER_ITEMS);
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

    formatMenuItems() {
        return this.menuItemsWithIcons(FORMAT_ITEMS.map((item) => {
            const fmt = PAGE_FORMATS[item.id];
            const meta = fmt
                ? `(${fmt.mmW}×${fmt.mmH} mm · ${fmt.width}×${fmt.height} px)`
                : '';
            return {
                ...item,
                meta,
                selected: item.id === this.doc.canvasMode
            };
        }));
    },

    backgroundMenuItems(bg = getActiveBackground(this.doc)) {
        const withSel = (list) => this.menuItemsWithIcons(list.map((item) => ({
            ...item,
            iconKey: item.iconKey || item.id,
            selected: item.id === bg
        })));
        const items = [];
        items.push(...withSel([{ id: 'blank', label: 'Blank', iconKey: 'blank' }]));
        items.push({ heading: 'Grids' });
        items.push(...withSel(GRID_BACKGROUNDS));
        items.push({ heading: 'Writing' });
        items.push(...withSel(WRITING_BACKGROUNDS));
        return items;
    },

    handleFormatMenu(id) {
        if (FORMAT_ITEMS.some((item) => item.id === id)) {
            this.setCanvasMode(id);
        }
    },

    handleBackgroundMenu(id) {
        if (BACKGROUNDS.includes(id)) {
            this.setBackground(id);
        }
    },

    renderToolbar() {
        if (!this.toolbarEl) return;
        const wasColorOpen = this.colorRolloutOpen;
        const wasBgColorOpen = this.bgColorRolloutOpen;
        DrawingToolbarMenu.close();
        const brush = this.currentBrush();
        const bgSwatch = this.pageBackgroundSwatch();
        const isPointerActive = this.activeTool === 'pointer' || this.activeTool === 'brush';
        const isEraserActive = this.activeTool === 'eraser';
        const isPanActive = this.activeTool === 'pan';
        const isCropActive = this.activeTool === 'crop';
        const pageIdx = this.doc.pages.findIndex((p) => p.id === this.doc.activePageId);
        const pageCount = this.doc.pages.length;
        const canPrev = pageIdx > 0;
        const canNext = pageIdx >= 0 && pageIdx < pageCount - 1;
        const exitBtn = this.isNoteCanvasMode
            ? `<button type="button" class="btn btn--compact btn--icon" id="draw-back-to-note" title="Back to note" aria-label="Back to note">${ACTION_ICONS.viewFree}</button>`
            : `<button type="button" class="btn btn--compact btn--icon" id="draw-exit-drawing" title="Exit drawing mode" aria-label="Exit drawing mode">${ACTION_ICONS.viewFree}</button>`;

        this.toolbarEl.innerHTML = `
            <div class="drawing-toolbar-row">
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown ${isPointerActive ? 'active' : ''}" id="draw-menu-pointer" aria-haspopup="menu" aria-expanded="false" title="Pointer tools" aria-label="Pointer tools">
                    <span class="drawing-dropdown-icon">${this.pointerTriggerIcon()}</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <span class="drawing-brush-size" id="draw-brush-size-group" aria-label="Brush size">
                    <button type="button" class="btn btn--compact btn--icon drawing-brush-size__btn" id="draw-brush-smaller" title="Decrease brush size" aria-label="Decrease brush size">${ACTION_ICONS.minus}</button>
                    <span class="drawing-brush-size__value" id="draw-brush-width" aria-live="polite">${brush.width}px</span>
                    <button type="button" class="btn btn--compact btn--icon drawing-brush-size__btn" id="draw-brush-larger" title="Increase brush size" aria-label="Increase brush size">${ACTION_ICONS.plus}</button>
                </span>
                <button type="button" class="btn btn--compact btn--icon ${isEraserActive ? 'active' : ''}" id="draw-eraser" title="Eraser" aria-label="Eraser" aria-pressed="${isEraserActive ? 'true' : 'false'}">${DRAWING_ICONS.eraser}</button>
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
                <button type="button" class="btn btn--compact btn--icon ${isCropActive ? 'active' : ''}" id="draw-crop" title="Crop image — drag the frame edges, drag back out to restore" aria-label="Crop image" aria-pressed="${isCropActive ? 'true' : 'false'}">${DRAWING_ICONS.crop}</button>
                <button type="button" class="btn btn--compact btn--icon ${this.isLassoActive ? 'active' : ''}" id="draw-lasso" title="Rectangle select" aria-label="Rectangle select" aria-pressed="${this.isLassoActive ? 'true' : 'false'}">${DRAWING_ICONS.lasso}</button>
                <button type="button" class="btn btn--compact btn--icon" id="draw-fullscreen" title="Full screen" aria-label="Full screen" aria-pressed="false">${ACTION_ICONS.fullscreenEnter}</button>
                <span class="format-toolbar-sep" aria-hidden="true"></span>
                <button type="button" class="btn btn--compact btn--icon ${isPanActive ? 'active' : ''}" id="draw-pan" title="Hand tool — pan canvas. Scroll also pans; Ctrl+scroll zooms; Space+drag pans." aria-label="Hand tool" aria-pressed="${isPanActive ? 'true' : 'false'}">${DRAWING_ICONS.hand}</button>
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
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-format" aria-haspopup="menu" aria-expanded="false" title="Page format" aria-label="Page format">
                    <span class="drawing-dropdown-label">${this.formatTriggerLabel()}</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <button type="button" class="btn btn--compact drawing-toolbar-dropdown" id="draw-menu-background" aria-haspopup="menu" aria-expanded="false" title="Background" aria-label="Background">
                    <span class="drawing-dropdown-icon">${this.typeTriggerIcon()}</span>
                    <span class="drawing-dropdown-label">BG</span>
                    <span class="drawing-dropdown-chevron">${CHEVRON}</span>
                </button>
                <button type="button" class="btn btn--compact btn--icon drawing-color-chip-btn" id="draw-bg-color-btn" title="Background fill color" aria-label="Background fill color" aria-expanded="false" style="--chip-color:${bgSwatch}">
                    <span class="drawing-bg-color-chip drawing-color-chip" style="background:${bgSwatch}"></span>
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
        this.updateBrushSizeControls();
        if (wasColorOpen) {
            this.colorRolloutOpen = false;
            const btn = this.toolbarEl.querySelector('#draw-color-btn');
            if (btn) this.toggleColorRollout(btn);
        } else if (wasBgColorOpen) {
            this.bgColorRolloutOpen = false;
            const btn = this.toolbarEl.querySelector('#draw-bg-color-btn');
            if (btn) this.openPageBackgroundPicker(btn);
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

        q('#draw-toolbar-hide')?.addEventListener('click', () => this.hideToolbar());
        q('#draw-exit-drawing')?.addEventListener('click', () => { this.app.switchWorkspaceMode('notes'); });
        q('#draw-back-to-note')?.addEventListener('click', () => { this.exitNoteCanvas(); });
        q('#draw-undo')?.addEventListener('click', () => this.undo());
        q('#draw-redo')?.addEventListener('click', () => this.redo());
        q('#draw-clear')?.addEventListener('click', () => this.clearAll());
        q('#draw-color-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleColorRollout(e.currentTarget);
        });
        q('#draw-bg-color-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPageBackgroundPicker(e.currentTarget);
        });
        q('#draw-zoom-in')?.addEventListener('click', () => { CanvasViewport.stepZoom(0.1); this.persistViewport(); });
        q('#draw-zoom-out')?.addEventListener('click', () => { CanvasViewport.stepZoom(-0.1); this.persistViewport(); });
        q('#draw-pan')?.addEventListener('click', () => {
            if (this.activeTool === 'pan') this.setStyle(this.activeStyle || 'pen');
            else this.setTool('pan');
        });
        const fsBtn = q('#draw-fullscreen');
        if (fsBtn) Fullscreen.registerButton(fsBtn);

        q('#draw-menu-pointer')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openPointerMenu(e.currentTarget);
        });

        q('#draw-brush-smaller')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.adjustWidth(-1);
        });
        q('#draw-brush-larger')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.adjustWidth(1);
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

        q('#draw-crop')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.activeTool === 'crop') {
                this.setTool('pointer');
            } else {
                this.selectedStrokes.clear();
                this.setTool('crop');
                showAppToast('Crop: drag the frame edges — the dimmed area gets discarded');
            }
        });

        q('#draw-menu-format')?.addEventListener('click', (e) => {
            e.stopPropagation();
            DrawingToolbarMenu.toggle({
                anchor: e.currentTarget,
                ariaLabel: 'Page format',
                items: this.formatMenuItems(),
                selected: this.doc.canvasMode,
                onSelect: (id) => this.handleFormatMenu(id)
            });
        });

        q('#draw-menu-background')?.addEventListener('click', (e) => {
            e.stopPropagation();
            DrawingToolbarMenu.toggle({
                anchor: e.currentTarget,
                ariaLabel: 'Background',
                items: this.backgroundMenuItems(),
                selected: getActiveBackground(this.doc),
                onSelect: (id) => this.handleBackgroundMenu(id)
            });
        });

        q('#draw-page-prev')?.addEventListener('click', () => this.goToPrevPage());
        q('#draw-page-next')?.addEventListener('click', () => this.goToNextPage());
        q('#draw-page-add')?.addEventListener('click', () => this.addCanvasPage());

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

        // Escape: revert an in-flight crop drag first, else drop the crop session
        if (e.key === 'Escape') {
            if (this.revertCropGesture()) return true;
            if (this.clearCropSession()) { this.redraw(); return true; }
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
            // Two-step Escape: clear selection first; exit marquee mode only when empty
            if (this.selectedStrokes.size > 0) {
                this.selectedStrokes.clear();
                this.isDraggingLasso = false;
                this.lassoDragStart = null;
                this.lassoDragMoved = false;
                this.lassoHistoryPushed = false;
                this.redraw();
                return true;
            }
            if (this.isLassoActive) {
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
        this.lassoDragMoved = false;
        this.lassoHistoryPushed = false;
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
        this.lassoDragMoved = false;
        this.lassoHistoryPushed = false;
        this.isBoxSelecting = false;
        this.boxSelectStart = null;
        this.boxSelectCurrent = null;
        // Do not wipe textLayer here — it may contain active contentEditable boxes.
        if (this.canvas) {
            this.canvas.dataset.tool = this.activeTool;
            this.canvas.style.cursor = '';
            this.lastHoverCursor = null;
        }
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
        this.lassoDragMoved = false;
        this.lassoHistoryPushed = false;
    },

    dragLassoSelection(dx, dy) {
        if (!this.isDraggingLasso || this.selectedStrokes.size === 0) return;
        if (!dx && !dy) return;

        if (!this.lassoHistoryPushed) {
            this.pushLayerHistory();
            this.lassoHistoryPushed = true;
        }
        this.lassoDragMoved = true;

        translateStrokes(this.getSelectedStrokesArray(), dx, dy);

        // Clamp to page bounds for fixed page modes
        const dims = getPageDimensions(this.doc);
        const pageBounds = getPageBounds(this.doc, dims);
        clampStrokesToBounds(this.getSelectedStrokesArray(), pageBounds);

        this.requestRedraw();
    },

    finishLassoDrag() {
        if (!this.isDraggingLasso) return;

        const moved = this.lassoDragMoved;
        this.isDraggingLasso = false;
        this.lassoDragStart = null;
        this.lassoDragMoved = false;
        this.lassoHistoryPushed = false;
        if (moved) this.scheduleSave();
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

    /** Crop frame overlay: veil over the discarded band, thirds, edge handles. */
    renderCropOverlay() {
        if (!this.ctx || !this.canvas || !this.cropState) return;
        const { box, metrics } = this.cropState;
        if (!box || !metrics) return;

        const limit = cropLimitRect(metrics);
        const rx = box.x;
        const ry = box.y;
        const rw = box.width;
        const rh = box.height;

        this.ctx.save();
        // Dim above / below / left / right of the kept frame (within the full frame).
        this.ctx.fillStyle = 'rgba(2, 6, 23, 0.5)';
        this.ctx.fillRect(limit.x, limit.y, limit.width, Math.max(0, ry - limit.y));
        this.ctx.fillRect(limit.x, ry + rh, limit.width, Math.max(0, limit.y + limit.height - (ry + rh)));
        this.ctx.fillRect(limit.x, ry, Math.max(0, rx - limit.x), rh);
        this.ctx.fillRect(rx + rw, ry, Math.max(0, limit.x + limit.width - (rx + rw)), rh);

        // Kept-frame border
        this.ctx.strokeStyle = '#38bdf8';
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeRect(rx, ry, rw, rh);

        // Rule-of-thirds guides
        this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        this.ctx.lineWidth = 1;
        this.ctx.beginPath();
        this.ctx.moveTo(rx + rw / 3, ry);
        this.ctx.lineTo(rx + rw / 3, ry + rh);
        this.ctx.moveTo(rx + (rw * 2) / 3, ry);
        this.ctx.lineTo(rx + (rw * 2) / 3, ry + rh);
        this.ctx.moveTo(rx, ry + rh / 3);
        this.ctx.lineTo(rx + rw, ry + rh / 3);
        this.ctx.moveTo(rx, ry + (rh * 2) / 3);
        this.ctx.lineTo(rx + rw, ry + (rh * 2) / 3);
        this.ctx.stroke();

        // Draggable edge/corner handles (same chrome as selection handles)
        this.getResizeHandles(this.cropBoxBounds(box)).forEach((h) => {
            this.ctx.fillStyle = '#ffffff';
            this.ctx.strokeStyle = '#38bdf8';
            this.ctx.lineWidth = 1.5;
            this.ctx.fillRect(h.x - RESIZE_HANDLE_SIZE / 2, h.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
            this.ctx.strokeRect(h.x - RESIZE_HANDLE_SIZE / 2, h.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
        });
        this.ctx.restore();
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
        let next = '';
        const cropBox = this.cropState?.box;
        if (cropBox && (this.activeTool === 'crop' || !this.selectedStrokes.size)) {
            const handle = this.hitCropHandle(x, y);
            if (handle) {
                this.hoverHandle = null;
                next = handle.cursor;
            } else if (this.isPointInCropBox(x, y)) {
                this.hoverHandle = null;
                next = 'move';
            } else {
                this.hoverHandle = null;
                next = '';
            }
        } else if (this.selectedStrokes.size > 0) {
            const handle = this.hitResizeHandle(x, y);
            if (handle) {
                this.hoverHandle = handle.id;
                next = handle.cursor;
            } else {
                const bounds = getStrokesBounds(this.getSelectedStrokesArray());
                if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
                    this.hoverHandle = null;
                    next = 'move';
                } else {
                    this.hoverHandle = null;
                    next = '';
                }
            }
        } else {
            this.hoverHandle = null;
            next = '';
        }
        if (this.lastHoverCursor === next) return;
        this.lastHoverCursor = next;
        this.canvas.style.cursor = next;
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

        // Membership: canvas insert must also attach to the note's media list.
        if (this.isNoteCanvasMode && this.noteCanvasItem) {
            const { attachMediaToNote } = await import('./mediaAttachments.js');
            attachMediaToNote(this.noteCanvasItem, mediaId);
        }
    },

};

const TOOLBAR_STATE_KEY = 'matrix_drawing_toolbar';

/**
 * Canvas stream payload: the magicCanvas document plus its own prefs/toolbar.
 * Kept in drawingBoard.js next to readDocument()/writeDocument() because the
 * document is big — reading it eagerly on every export tick would re-download
 * the canvas on each unrelated board move.
 */
export async function getCanvasDocumentBackupKeys() {
    // IndexedDB is the primary store; read the persisted document directly.
    let matrix_global_drawing = null;
    let referencedMediaIds = [];
    try {
        const doc = await readDocument();
        matrix_global_drawing = JSON.stringify(doc);
        // Which media files the drawing points at — lets a canvas-only restore
        // warn about images that still need the media ZIP instead of failing
        // silently with blank placeholders.
        const { collectNoteCanvasMediaIds } = await import('./noteFieldOwnership.js');
        referencedMediaIds = collectNoteCanvasMediaIds(doc);
    } catch (e) {
        matrix_global_drawing = localStorage.getItem(STORAGE_KEY);
    }

    return {
        matrix_global_drawing,
        referencedMediaIds,
        matrix_drawing_prefs: localStorage.getItem(PREFS_KEY),
        matrix_drawing_toolbar: localStorage.getItem(TOOLBAR_STATE_KEY)
    };
}

export async function applyDrawingBackupKeys(backup) {
    const { applyCanvasBackupKeys } = await import('./layoutStorage.js');
    await applyCanvasBackupKeys(backup);
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
