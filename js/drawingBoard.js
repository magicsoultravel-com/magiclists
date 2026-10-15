/** @module {"owns":"magicCanvas drawing board, workspace drawing mode", "related":["canvasDocument.js","drawingToolbarMenu.js","layoutStorage.js"]} */
import { DRAWING_ICONS } from './icons.js';
import { ColorPicker, PALETTE_UNIFIED, resolveNoteColor } from './colorPicker.js';
import { DrawingToolbarMenu } from './drawingToolbarMenu.js';
import { CanvasViewport } from './canvasViewport.js';
import {
    readDocument, writeDocument, getActiveStrokes, getActiveTexts, setActiveStrokes, setActiveTexts,
    getActiveImages, setActiveImages,
    getActiveBackground, setActiveBackground, getActiveBackgroundColor, setActiveBackgroundColor,
    getPageDimensions, addPage, nextPage, prevPage, switchCanvasMode,
    expandInfiniteBounds, shrinkInfiniteBounds, STORAGE_KEY, createId, CANVAS_MODES, BACKGROUNDS,
    PAGE_FORMATS
} from './canvasDocument.js';
import { BRUSH_STYLES, DRAG_SHAPE_TOOLS, drawBrushStroke, drawShapeStroke, drawTextObject } from './canvasBrushes.js';
import {
    WIDTH_MIN, WIDTH_MAX, DEFAULT_WIDTH, HIGHLIGHTER_WIDTH, HISTORY_MAX, SAVE_DEBOUNCE_MS,
    RESIZE_HANDLE_SIZE, RESIZE_HANDLE_HIT, POINT_SPACING, THIN_MIN_DIST, THIN_COLLINEAR_EPS,
    defaultWidthForStyle, pointSpacingForStyle
} from './drawingBoardCore.js';
import { renderBackground } from './canvasBackgrounds.js';
import { DrawingToolbarChrome } from './drawingToolbarChrome.js';
import * as FlowSession from './drawingBoardFlowchart.js';
import * as CropSession from './drawingBoardCrop.js';
import * as SelectSession from './drawingBoardSelection.js';
import * as ToolbarSession from './drawingBoardToolbar.js';
import { getStrokesBounds } from './lassoGeometry.js';
import {
    loadImage,
    clearImageCache,
    ensureImagesLoaded,
    initialImageSize,
    drawImageObject,
    drawImageGhost
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
    // Flowchart mode state (per-note diagram profile on top of the canvas engine)
    isFlowchartMode: false,
    flowchartItem: null,
    flowchartRouting: 'straight',
    flowchartColorOpen: false,
    flowLabelColorOpen: false,
    /** Live connector endpoint drag: { conn, end:'from'|'to', moved:false } */
    flowEndpointDrag: null,
    /** Live connector drag: { x, y, from: {shapeId,port}|null, hover: {...}|null } */
    flowConnect: null,
    /** Double-click label editor overlay + the stroke it edits. */
    flowLabelEl: null,
    flowLabelTarget: null,
    /** Session owner for flush routing: 'workspace' | 'note' | 'flowchart' | null when idle. */
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
        this.canvas.addEventListener('dblclick', (e) => {
            if (!this.isFlowchartMode) return;
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            const target = this.flowHit(pt.x, pt.y);
            if (target) { e.preventDefault(); this.flowEditLabel(target); }
        });
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
        this.isFlowchartMode = false;
        this.flowchartItem = null;
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
        if (this.isFlowchartMode) this.bindFlowBendEvents();
    },

    /**
     * Flowchart edit mode: per-note diagram on the same canvas engine.
     * Forces dot-square grid + snap on first open; keeps full magicCanvas suite.
     * @param {object} item note with item.flowchart
     */
    async openNoteFlowchart(item) {
        if (!item?.id) return;
        const { normalizeFlowchart, createEmptyFlowchart } = await import('./flowchart.js');
        if (!item.flowchart) {
            item.flowchart = createEmptyFlowchart();
            item.flowchartHidden = false;
        }
        const normalized = normalizeFlowchart(item.flowchart) || createEmptyFlowchart();
        item.flowchart = normalized;
        this.history.clear();
        this.active = true;
        this.docOwner = 'flowchart';
        this.isNoteCanvasMode = false;
        this.noteCanvasItem = null;
        this.isFlowchartMode = true;
        this.flowchartItem = item;
        this.flowchartRouting = 'straight';
        this.activeNoteId = item.id;
        this.cropState = null;
        this.doc = normalized.doc;
        // Force the dot grid + snap on entry; the user can relax either afterwards.
        normalized.grid = {
            type: 'dots',
            size: Number.isFinite(Number(normalized.grid?.size)) && Number(normalized.grid.size) > 0
                ? Number(normalized.grid.size)
                : 24,
            snap: true,
            visible: true
        };
        item.flowchart.grid = { ...normalized.grid };
        setActiveBackground(this.doc, normalized.grid.type);
        this.prefs = readPrefs();
        // Keep the user's brush prefs; default new diagrams to a shape tool.
        this.activeTool = 'rect';
        this.activeStyle = this.prefs.activeStyle || 'pen';

        DrawingToolbarChrome.show();
        this.toolbarEl = DrawingToolbarChrome.getToolbarMount();

        if (this.brandEl) this.brandEl.textContent = 'magicCanvas · Flowchart';
        this.updateNoteToolbarChrome();

        this.boardEl.classList.remove('is-hidden');
        this.boardEl.setAttribute('aria-hidden', 'false');

        CanvasViewport.loadFromDoc(this.doc.viewport || { scale: 1, offsetX: 0, offsetY: 0 });
        CanvasViewport.setHandMode(false);
        if (this.canvas) this.canvas.dataset.tool = this.activeTool;
        this.shrinkInfiniteIfNeeded();
        this.renderToolbar();
        this.updateZoomLevel();
        this.resize();
        this.redrawBackground();
        this.redraw();
    },

    flowchartGrid() { return FlowSession.flowchartGrid(this); },

    /** Active flowchart stroke color, persisted per diagram. */
    flowchartColor() { return FlowSession.flowchartColor(this); },

    /** Active flowchart stroke width, persisted per diagram. */
    flowchartWidth() { return FlowSession.flowchartWidth(this); },

    /** Set the flowchart stroke color on the live item + the toolbar chip. */
    persistFlowchartColor(color) { return FlowSession.persistFlowchartColor(this, color); },

    /** Set the flowchart stroke width on the live item + the toolbar readout. */
    persistFlowchartWidth(width) { return FlowSession.persistFlowchartWidth(this, width); },

    /** Shared persist helper for flowchart prefs that live on item.flowchart. */
    persistFlowchartPref(patch) { return FlowSession.persistFlowchartPref(this, patch); },

    /**
     * Flowchart stroke color picker. Same chrome as the brush color rollout but
     * persists to item.flowchart.flowchartColor so every shape and connector
     * repaints consistently.
     */
    openFlowchartColorPicker(anchor) { return FlowSession.openFlowchartColorPicker(this, anchor); },

    /**
     * Label color picker. Persists to the selected shape/connector's label so a
     * label can be tinted independently of the stroke.
     */
    openFlowLabelColorPicker(anchor) { return FlowSession.openFlowLabelColorPicker(this, anchor); },

    /**
     * Adjust the flowchart stroke width (1-16px, snapped to the allowed steps).
     * @param {number} delta
     */
    adjustFlowchartWidth(delta) { return FlowSession.adjustFlowchartWidth(this, delta); },

    async persistFlowchartGrid(patch) { return FlowSession.persistFlowchartGrid(this, patch); },

    /** True when the given tool draws a flowchart shape. */
    isFlowShape(tool) { return FlowSession.isFlowShape(this, tool); },

    /** True when the given tool drags a flowchart connector. */
    isFlowConnector(tool) { return FlowSession.isFlowConnector(this, tool); },

    /**
     * Shape strokes on the active layer (connector endpoints magnet to these).
     * Ports only bind to shapes, never to other connectors.
     */
    flowchartShapes() { return FlowSession.flowchartShapes(this); },

    flowchartShapesById() { return FlowSession.flowchartShapesById(this); },

    /** World-space port magnet radius (constant on screen regardless of zoom). */
    flowchartMagnetRadius() { return FlowSession.flowchartMagnetRadius(this); },

    /**
     * Snap a world point to the grid unless Shift is held or snap is off.
     * @param {number} x
     * @param {number} y
     * @param {boolean} bypass Shift-key override
     */
    flowSnapPoint(x, y, bypass = false) { return FlowSession.flowSnapPoint(this, x, y, bypass); },

    /** Resolve a free connector end to a port when it lands inside the magnet. */
    flowResolveEndpoint(x, y, excludeShapeId) { return FlowSession.flowResolveEndpoint(this, x, y, excludeShapeId); },

    /** Recompute cached endpoints for every connector attached to the moved shapes. */
    flowReroute(movedShapeIds) { return FlowSession.flowReroute(this, movedShapeIds); },

    /** Topmost flowchart stroke under the pointer (shapes and connectors). */
    flowHit(x, y) { return FlowSession.flowHit(this, x, y); },

    /** Point-to-segment hit test across a straight or single-bend elbow path. */
    flowConnectorHit(conn, x, y, tol) { return FlowSession.flowConnectorHit(this, conn, x, y, tol); },

    /**
     * Which endpoint ('from' or 'to') of a connector the pointer is on, or null.
     * Hit radius scales with zoom so the grab target stays a comfortable size.
     * @param {object} conn
     * @param {number} x
     * @param {number} y
     * @returns {string|null}
     */
    hitFlowEndpoint(conn, x, y) { return FlowSession.hitFlowEndpoint(this, conn, x, y); },

    /**
     * Flowchart overlay: live connector drag with its port magnet, plus port dots
     * on every shape while connecting so targets are discoverable.
     */
    
    /**
     * Test if pointer is over a connector elbow bend point (within tolerance).
     * Returns { kind: 'bend', connector, point: {x,y} } or null.
     */
    flowConnectorBendHit(conn, x, y, tol) { return FlowSession.flowConnectorBendHit(this, conn, x, y, tol); },


    /** Live bend-drag state while pointer moves over a connector. */
    flowBendDrag: null,

    /**
     * Render live bend preview while dragging a connector elbow.
     */
    renderFlowBendPreview() { return FlowSession.renderFlowBendPreview(this); },

    /**
     * Clear the live bend preview state.
     */
    clearFlowBendPreview() { return FlowSession.clearFlowBendPreview(this); },

    /**
     * Called on pointerdown over a connector bend: start the drag capture.
     */
    startFlowBendDrag(x, y) { return FlowSession.startFlowBendDrag(this, x, y); },

    /**
     * Called on pointerup after starting a bend drag: commit the new midpoint.
     */
    finishFlowBendDrag() { return FlowSession.finishFlowBendDrag(this); },

    /**
     * Bind bend-drag pointer events into the canvas overlay.
     */
    bindFlowBendEvents() { return FlowSession.bindFlowBendEvents(this); },

    /**
     * Called each render to draw live bend preview and update bend-hit state.
     */
    renderFlowchartOverlays() { return FlowSession.renderFlowchartOverlays(this); },

    renderFlowchartOverlay() { return FlowSession.renderFlowchartOverlay(this); },

    /**
     * When a connector is selected, draw grabbable handles on its two endpoints
     * so the user can re-attach an origin/terminus to a different port.
     * Runs in redraw() after the flowchart overlay; a no-op unless exactly one
     * connector is selected.
     */
    renderFlowchartEndpointHandles() { return FlowSession.renderFlowchartEndpointHandles(this); },

    /**
     * Start dragging an endpoint of the selected connector.
     * @param {object} conn
     * @param {'from'|'to'} end
     * @param {number} x
     * @param {number} y
     */
    startFlowEndpointDrag(conn, end, x, y) { return FlowSession.startFlowEndpointDrag(this, conn, end, x, y); },

    /**
     * Move the dragged endpoint, snapping to the grid and magnetising onto a
     * shape port when one is close enough. Reroutes the connector live.
     * @param {number} x
     * @param {number} y
     */
    applyFlowEndpointDrag(x, y) { return FlowSession.applyFlowEndpointDrag(this, x, y); },

    /**
     * Finish the endpoint drag, pushing one undo step if anything moved.
     */
    finishFlowEndpointDrag() { return FlowSession.finishFlowEndpointDrag(this); },

    /**
     * Commit the in-flight connector drag.    /**
     * Commit the in-flight connector drag.
     * Attached-to-port when the pointer lands inside the magnet radius, otherwise
     * a free-floating straight arrow. Self-loops are rejected; tiny drags dropped.
     */
    commitFlowConnect() { return FlowSession.commitFlowConnect(this); },
    /**
     * Inline contentEditable editor for the label of a shape/connector.
     * Commits on blur or Enter, clears on Escape, and pushes a single undo step
     * so label edits never tear the shape and its text apart.
     */
    flowEditLabel(target) { return FlowSession.flowEditLabel(this, target); },

    flowCloseLabel() { return FlowSession.flowCloseLabel(this); },

    /**
     * The stroke the label toolbar acts on: the open editor's target, else the
     * current selection when it is a flowchart shape/connector.
     */
    flowLabelTargetShape() { return FlowSession.flowLabelTargetShape(this); },

    /** Current label size of the toolbar target, clamped to the allowed range. */
    flowLabelFontSize() { return FlowSession.flowLabelFontSize(this); },

    /** Toolbar "text" action: open the label editor on the selection. */
    editSelectedFlowchartLabel() { return FlowSession.editSelectedFlowchartLabel(this); },

    /** Toolbar A- / A+: resize the selected shape's label as one undo step. */
    nudgeSelectedFlowchartLabel(delta) { return FlowSession.nudgeSelectedFlowchartLabel(this, delta); },

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

    /**
     * Request exit from flowchart mode. Reuses note:canvas_draw_exited so the
     * app owns teardown exactly as it does for note-canvas (single flush path).
     */
    exitFlowchart() {
        if (!this.isFlowchartMode) return;
        const item = this.flowchartItem;
        if (!item) return;
        window.dispatchEvent(new CustomEvent('note:canvas_draw_exited', { detail: { item } }));
    },

    /**
     * Toolbar "Back to note" routing. Each mode has its own exit because the
     * guards differ (isNoteCanvasMode vs isFlowchartMode); calling the wrong one
     * early-returns and strands the user in drawing mode.
     */
    exitFromToolbar() {
        if (this.isFlowchartMode) { this.exitFlowchart(); return; }
        if (this.isNoteCanvasMode) { this.exitNoteCanvas(); return; }
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
        this.isFlowchartMode = false;
        this.activeNoteId = null;
        this.noteCanvasItem = null;
        this.flowchartItem = null;
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
        // In flowchart mode the visible grid must match the snap size exactly,
        // otherwise the +/- stepper changes behaviour with no visual feedback.
        const spacing = this.isFlowchartMode ? (this.flowchartGrid().size || 24) : 24;
        renderBackground(this.bgCtx, getActiveBackground(this.doc), this.bgCanvas.width, this.bgCanvas.height, {
            fillColor,
            spacing
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
        // Switching to the eraser is destructive — drop the selection frame so
        // it cannot linger as a ghost over the eraser stroke.
        if (tool === 'eraser' && this.selectedStrokes.size > 0) {
            this.selectedStrokes.clear();
        }
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


    updatePointerWidthLabel() { return ToolbarSession.updatePointerWidthLabel(this); },

    updateBrushSizeControls() { return ToolbarSession.updateBrushSizeControls(this); },

    setColor(color, { rerender = true } = {}) {
        this.prefs.styles[this.activeStyle].color = color;
        writePrefs(this.prefs);
        if (rerender) this.renderToolbar();
        else this.updateColorChip(color);
    },

    updateColorChip(color) { return ToolbarSession.updateColorChip(this, color); },

    toggleColorRollout(anchor) { return ToolbarSession.toggleColorRollout(this, anchor); },

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

        // Connector endpoint grab: when exactly one connector is selected and the
        // pointer lands on one of its endpoints, start dragging that endpoint so
        // the origin/terminus can be re-attached to a different port. Takes
        // priority over the lasso drag that would otherwise start for any click
        // inside the connector's bounding box.
        if (this.isFlowchartMode && this.selectedStrokes.size === 1) {
            const only = this.getSelectedStrokesArray()[0];
            if (only && only.flowchartKind === 'connector') {
                const hitEnd = this.hitFlowEndpoint(only, x, y);
                if (hitEnd) {
                    this.startFlowEndpointDrag(only, hitEnd, x, y);
                    return;
                }
            }
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
            // In flowchart mode a click picks the shape/connector under the cursor so
            // labels and reroutes have a target; dragging still falls through to marquee.
            if (this.isFlowchartMode && !this.isLassoActive) {
                const hit = this.flowHit(x, y);
                if (hit) {
                    this.selectedStrokes.clear();
                    this.selectedStrokes.add(hit);
                    this.startLassoDrag(x, y);
                    this.renderToolbar();
                    return;
                }
                if (this.selectedStrokes.size) {
                    this.selectedStrokes.clear();
                    this.renderToolbar();
                }
            }
            // Keep prior selection visible until endBoxSelect commits the replacement
            this.beginBoxSelect(x, y);
            return;
        }

        if (this.activeTool === 'text') {
            if (this.isFlowchartMode) {
                // Flowchart text edits the selected shape instead of dropping a loose note.
                const target = this.flowHit(x, y);
                if (target) { this.flowEditLabel(target); return; }
                showAppToast('Click a shape to add text');
                return;
            }
            this.placeTextBox(x, y);
            return;
        }

        if (this.isFlowConnector(this.activeTool)) {
            const anchor = this.flowResolveEndpoint(x, y, null);
            const from = anchor
                ? { shapeId: anchor.shapeId, port: anchor.port }
                : null;
            const snapped = this.flowSnapPoint(x, y, e.shiftKey);
            this.flowConnect = {
                x: snapped.x, y: snapped.y,
                from,
                fromPt: anchor ? { x: anchor.point.x, y: anchor.point.y } : snapped,
                hover: null
            };
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
            const anchor = this.flowSnapPoint(x, y, e.shiftKey);
            const preview = {
                id: createId('stroke'),
                tool: this.activeTool,
                style: this.activeStyle,
                color: brush.color,
                width: brush.width,
                x0: anchor.x, y0: anchor.y, x1: anchor.x, y1: anchor.y
            };
            if (this.isFlowShape(this.activeTool)) {
                preview.flowchartKind = 'shape';
                // Flowchart strokes use the diagram's own color/width so a palette
                // change repaints every shape and connector consistently.
                preview.color = this.flowchartColor();
                preview.width = this.flowchartWidth();
                // No label yet: drawFlowchartLabel skips empty labels, so text only
                // appears once the user actually types something.
                preview.label = null;
            }
            this.shapePreview = preview;
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
        // Live connector endpoint drag
        if (this.flowEndpointDrag) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            this.applyFlowEndpointDrag(pt.x, pt.y);
            return;
        }

        if (this.flowConnect) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            const snapped = this.flowSnapPoint(pt.x, pt.y, e.shiftKey);
            this.flowConnect.x = snapped.x;
            this.flowConnect.y = snapped.y;
            const anchor = this.flowResolveEndpoint(snapped.x, snapped.y, this.flowConnect.from?.shapeId);
            this.flowConnect.hover = anchor
                ? { shapeId: anchor.shapeId, port: anchor.port, x: anchor.point.x, y: anchor.point.y }
                : null;
            this.requestRedraw();
            return;
        }
        if (this.shapePreview) {
            const pt = this.clientToCanvas(e.clientX, e.clientY);
            const snapped = this.flowSnapPoint(pt.x, pt.y, e.shiftKey);
            this.shapePreview.x1 = snapped.x;
            this.shapePreview.y1 = snapped.y;
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

        // Commit the flowchart connector drag
        if (this.flowConnect) {
            this.commitFlowConnect();
            return;
        }

        // Finish connector endpoint drag
        if (this.flowEndpointDrag) {
            this.finishFlowEndpointDrag();
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

    beginBoxSelect(x, y) { return SelectSession.beginBoxSelect(this, x, y); },

    updateBoxSelect(x, y) { return SelectSession.updateBoxSelect(this, x, y); },

    endBoxSelect() { return SelectSession.endBoxSelect(this); },

    /**
     * Click-select: pick the visually topmost item at the point and raise it to
     * the top of its own layer (undoable). Misses clear the selection.
     * @param {number} x
     * @param {number} y
     * @param {number} [radius=0]
     */
    selectAndRaiseAtPoint(x, y, radius = 0) { return SelectSession.selectAndRaiseAtPoint(this, x, y, radius); },

    selectStrokesInRect(rect) { return SelectSession.selectStrokesInRect(this, rect); },

    placeTextBox(x, y) { return SelectSession.placeTextBox(this, x, y); },

    eraseAt(x, y, radius = 14) { return SelectSession.eraseAt(this, x, y, radius); },

    hitImage(img, x, y, radius) { return SelectSession.hitImage(this, img, x, y, radius); },

    hitStroke(stroke, x, y, radius) { return SelectSession.hitStroke(this, stroke, x, y, radius); },

    /** Topmost image (last painted) under the pointer, or null. */
    findTopmostImageAt(x, y) { return SelectSession.findTopmostImageAt(this, x, y); },


    cropBoxBounds(box) { return CropSession.cropBoxBounds(this, box); },

    isPointInCropBox(x, y) { return CropSession.isPointInCropBox(this, x, y); },

    hitCropHandle(x, y) { return CropSession.hitCropHandle(this, x, y); },

    startCropSession(target) { return CropSession.startCropSession(this, target); },

    beginCropGesture(mode, x, y, extra = {}) { return CropSession.beginCropGesture(this, mode, x, y, extra); },

    /**
     * Pointer entry for the crop tool. Handles resize the live frame, inner
     * drags slide the window over the original image, and drags outside the
     * frame start a fresh box. Nothing persists until the gesture completes.
     */
    onCropPointerDown(x, y) { return CropSession.onCropPointerDown(this, x, y); },

    /** Live crop: rewrite the item rect + source window on every move. */
    moveCropGesture(x, y) { return CropSession.moveCropGesture(this, x, y); },

    /** End the gesture; push one undo entry and persist only when it moved. */
    endCropGesture() { return CropSession.endCropGesture(this); },

    /**
     * Undoable layer snapshot with a stale images array, so a completed crop
     * gesture records exactly the pre-gesture layout as its undo entry.
     */
    pushCropHistory(imagesSnapshot) { return CropSession.pushCropHistory(this, imagesSnapshot); },

    /** Escape during a crop drag: restore the gesture start, keep the session. */
    revertCropGesture() { return CropSession.revertCropGesture(this); },

    /** Escape with no in-flight crop drag: drop the session entirely. */
    clearCropSession() { return CropSession.clearCropSession(this); },

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

        if (this.isFlowchartMode) this.renderFlowchartOverlays();

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
        if (this.docOwner === 'flowchart') {
            const item = this.flowchartItem;
            if (!item) return;
            const doc = JSON.parse(JSON.stringify(this.doc));
            const { mutateItem } = await import('./noteSurfaceMutations.js');
            mutateItem(item, (it) => {
                if (!it.flowchart) return;
                it.flowchart.doc = doc;
                // Drawing implies the flowchart should be visible on board/modal.
                it.flowchartHidden = false;
            }, { preserveView: true, skipRerender: true });
            import('./flowchartUi.js').then(({ syncNoteFlowchartDom }) => {
                syncNoteFlowchartDom(item);
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


    currentToolEcho() { return ToolbarSession.currentToolEcho(this); },

    updateToolEcho() { return ToolbarSession.updateToolEcho(this); },

    updateNoteToolbarChrome() { return ToolbarSession.updateNoteToolbarChrome(this); },

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


    pointerSelected() { return ToolbarSession.pointerSelected(this); },

    pointerTriggerIcon() { return ToolbarSession.pointerTriggerIcon(this); },

    shapeTriggerIcon() { return ToolbarSession.shapeTriggerIcon(this); },

    pointerMenuItems() { return ToolbarSession.pointerMenuItems(this); },

    openPointerMenu(anchor) { return ToolbarSession.openPointerMenu(this, anchor); },

    formatTriggerLabel() { return ToolbarSession.formatTriggerLabel(this); },

    typeTriggerIcon() { return ToolbarSession.typeTriggerIcon(this); },

    menuItemsWithIcons(items) { return ToolbarSession.menuItemsWithIcons(this, items); },

    formatMenuItems() { return ToolbarSession.formatMenuItems(this); },

    backgroundMenuItems(bg = getActiveBackground(this.doc)) { return ToolbarSession.backgroundMenuItems(this, bg); },

    handleFormatMenu(id) { return ToolbarSession.handleFormatMenu(this, id); },

    handleBackgroundMenu(id) { return ToolbarSession.handleBackgroundMenu(this, id); },

    flowchartToolbarRowHtml() { return ToolbarSession.flowchartToolbarRowHtml(this); },

    stepFlowchartGrid(delta) { return ToolbarSession.stepFlowchartGrid(this, delta); },

    renderToolbar() { return ToolbarSession.renderToolbar(this); },

    updateZoomLevel() { return ToolbarSession.updateZoomLevel(this); },

    bindToolbar() { return ToolbarSession.bindToolbar(this); },

    updateToolbarState() { return ToolbarSession.updateToolbarState(this); },

    /**
     * Keep the flowchart label group honest: text actions need a selected shape
     * or connector, and A-/A+ clamp at the label size bounds.
     */
    updateFlowLabelControls() { return ToolbarSession.updateFlowLabelControls(this); },

    handleKeydown(e) {
        if (!this.active) return false;
        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return true; }
            if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); return true; }
        }

        // Escape: revert an in-flight crop drag first, else drop the crop session
        if (e.key === 'Escape') {
            if (this.flowEndpointDrag) { this.flowEndpointDrag = null; this.redraw(); return true; }
            if (this.flowConnect) { this.flowConnect = null; this.redraw(); return true; }
            if (this.flowLabelEl) return false;
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
    toggleLassoMode() { return SelectSession.toggleLassoMode(this); },

    startLassoMode() { return SelectSession.startLassoMode(this); },

    clearLassoSelection() { return SelectSession.clearLassoSelection(this); },

    getSelectedStrokesArray() { return SelectSession.getSelectedStrokesArray(this); },

    startLassoDrag(x, y) { return SelectSession.startLassoDrag(this, x, y); },

    dragLassoSelection(dx, dy) { return SelectSession.dragLassoSelection(this, dx, dy); },

    finishLassoDrag() { return SelectSession.finishLassoDrag(this); },

    renderLassoOverlay() { return SelectSession.renderLassoOverlay(this); },

    /** Crop frame overlay: veil over the discarded band, thirds, edge handles. */
    renderCropOverlay() { return CropSession.renderCropOverlay(this); },

    getResizeHandles(bounds) { return SelectSession.getResizeHandles(this, bounds); },

    hitResizeHandle(x, y) { return SelectSession.hitResizeHandle(this, x, y); },

    startResize(handle, x, y) { return SelectSession.startResize(this, handle, x, y); },

    applyResize(x, y) { return SelectSession.applyResize(this, x, y); },

    finishResize() { return SelectSession.finishResize(this); },

    updateHoverCursor(x, y) { return SelectSession.updateHoverCursor(this, x, y); },

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

export { getCanvasDocumentBackupKeys, applyDrawingBackupKeys } from './drawingBoardBackup.js';
export { DRAWING_TOOLBAR_STATE_KEY as TOOLBAR_STATE_KEY } from './drawingBoardBackup.js';
