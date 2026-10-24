/** @module {"owns":"magicCanvas drawing board, workspace drawing mode", "related":["canvasDocument.js","drawingToolbarMenu.js","layoutStorage.js"]} */
import { DRAWING_ICONS } from './icons.js';
import {
    ColorPicker,
    PALETTE_UNIFIED,
    resolveNoteColor
} from './colorPicker.js';
import { DrawingToolbarMenu } from './drawingToolbarMenu.js';
import { CanvasViewport } from './canvasViewport.js';
import {
    readDocument,
    writeDocument,
    getActiveStrokes,
    getActiveTexts,
    setActiveStrokes,
    setActiveTexts,
    getActiveImages,
    setActiveImages,
    getActiveBackground,
    setActiveBackground,
    getActiveBackgroundColor,
    setActiveBackgroundColor,
    getPageDimensions,
    addPage,
    nextPage,
    prevPage,
    switchCanvasMode,
    expandInfiniteBounds,
    shrinkInfiniteBounds,
    STORAGE_KEY,
    createId,
    CANVAS_MODES,
    BACKGROUNDS,
    PAGE_FORMATS
} from './canvasDocument.js';
import {
    BRUSH_STYLES,
    drawBrushStroke,
    drawShapeStroke,
    drawTextObject
} from './canvasBrushes.js';
import {
    WIDTH_MIN,
    WIDTH_MAX,
    DEFAULT_WIDTH,
    HIGHLIGHTER_WIDTH,
    SAVE_DEBOUNCE_MS,
    RESIZE_HANDLE_SIZE,
    RESIZE_HANDLE_HIT,
    POINT_SPACING,
    THIN_MIN_DIST,
    THIN_COLLINEAR_EPS,
    defaultWidthForStyle,
    pointSpacingForStyle,
    isDragShape
} from './drawingBoardCore.js';

import { DrawingToolbarChrome } from './drawingToolbarChrome.js';
import * as FlowSession from './drawingBoardFlowchart.js';
import * as CropSession from './drawingBoardCrop.js';
import * as SelectSession from './drawingBoardSelection.js';
import * as ToolbarSession from './drawingBoardToolbar.js';
import * as ClipboardSession from './drawingBoardClipboard.js';

import {
    loadImage,
    clearImageCache,
    ensureImagesLoaded,
    initialImageSize,
    drawImageObject,
    drawImageGhost,
    cropLimitRect
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

import {
    dist2,
    thinStrokePoints,
    readPressure
} from './drawingBoard/geometry.js';
import {
    readPrefs,
    writePrefs
} from './drawingBoard/prefs.js';

import {
    DrawingHistory,
    wireHistoryToolbar
} from './drawingBoard/history.js';
import * as InputSession from './drawingBoard/input.js';
import * as ViewSession from './drawingBoard/view.js';

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
    // One history entry per eraser gesture / background-picker session.
    eraseHistoryPushed: false,
    bgColorHistoryPushed: false,

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
        // Gesture-scoped history flags must not leak into the next session.
        this.eraseHistoryPushed = false;
        this.bgColorHistoryPushed = false;
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
            background: getActiveBackground(this.doc),
            backgroundColor: getActiveBackgroundColor(this.doc),
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
            // A layer snapshot belongs to the page it was taken on. Restore that
            // page first: undoing from page 2 must not paste page 1's strokes
            // into page 2 (the pages would silently swap content).
            const switchedPage = this.restoreSnapshotPage(snapshot.activePageId);
            setActiveStrokes(this.doc, JSON.parse(JSON.stringify(snapshot.strokes || [])));
            setActiveTexts(this.doc, JSON.parse(JSON.stringify(snapshot.texts || [])));
            setActiveImages(this.doc, JSON.parse(JSON.stringify(snapshot.images || [])));
            const hasBackground = snapshot.background !== undefined || snapshot.backgroundColor !== undefined;
            if (snapshot.background !== undefined) setActiveBackground(this.doc, snapshot.background);
            if (snapshot.backgroundColor !== undefined) setActiveBackgroundColor(this.doc, snapshot.backgroundColor);
            if (hasBackground) this.redrawBackground();
            if (switchedPage) this.resize();
        } else {
            this.doc = JSON.parse(JSON.stringify(snapshot));
            this.resize();
            if (this.doc.viewport) CanvasViewport.loadFromDoc(this.doc.viewport);
        }
        // Layers are fresh deep clones — re-point selection by id or drop orphans.
        ClipboardSession.pruneSelection(this);
        this.redraw();
        this.scheduleSave();
        this.updateToolbarState();
    },

    /**
     * Point the board at the page a snapshot was captured on.
     * @param {string} pageId
     * @returns {boolean} true when the active page actually changed
     */
    restoreSnapshotPage(pageId) {
        if (!pageId || !Array.isArray(this.doc?.pages)) return false;
        if (pageId === this.doc.activePageId) return false;
        if (!this.doc.pages.some((page) => page.id === pageId)) return false;
        this.doc.activePageId = pageId;
        return true;
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

    clientToCanvas(clientX, clientY) { return ViewSession.clientToCanvas(this, clientX, clientY); },

    resize() { return ViewSession.resize(this); },

    pageBackgroundFill() { return ViewSession.pageBackgroundFill(this); },

    pageBackgroundSwatch() { return ViewSession.pageBackgroundSwatch(this); },

    redrawBackground() { return ViewSession.redrawBackground(this); },

    adaptNoteTextOverlayToCanvas() { return ViewSession.adaptNoteTextOverlayToCanvas(this); },

    setPageBackgroundColor(color, { rerender = true } = {}) {
        // The picker streams onSelect while a slider is dragged — one entry per
        // session keeps the history usable and makes the drag undo in one step.
        if (!this.bgColorHistoryPushed) {
            this.pushLayerHistory();
            this.bgColorHistoryPushed = true;
        }
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
        // Reset before opening: any onSelect the picker fires (including a
        // preview during construction) must start a fresh undo entry.
        this.bgColorHistoryPushed = false;
        ColorPicker.open({
            anchor,
            presets: PALETTE_UNIFIED,
            value: this.pageBackgroundFill() || this.pageBackgroundSwatch(),
            align: 'end',
            onSelect: (c) => this.setPageBackgroundColor(c, { rerender: false }),
            onClose: () => { this.bgColorRolloutOpen = false; this.bgColorHistoryPushed = false; }
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
        // Only a full-document snapshot can remove the new page again.
        this.history.push(this.getSnapshot());
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

    onPointerDown(e) { return InputSession.onPointerDown(this, e); },

    onPointerMove(e) { return InputSession.onPointerMove(this, e); },

    onPointerUp(e) { return InputSession.onPointerUp(this, e); },

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

    requestRedraw() { return ViewSession.requestRedraw(this); },

    redraw() { return ViewSession.redraw(this); },

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
        this.pushLayerHistory();
        setActiveBackground(this.doc, bg);
        this.redrawBackground();
        this.scheduleSave();
        this.renderToolbar();
    },

    pageLabel() { return ViewSession.pageLabel(this); },

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

    handleKeydown(e) { return InputSession.handleKeydown(this, e); },

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

wireHistoryToolbar(DrawingBoard);
ClipboardSession.bindBoard(DrawingBoard);

export { getCanvasDocumentBackupKeys, applyDrawingBackupKeys } from './drawingBoardBackup.js';
export { DrawingHistory, wireHistoryToolbar } from './drawingBoard/history.js';
export { DRAWING_TOOLBAR_STATE_KEY as TOOLBAR_STATE_KEY } from './drawingBoardBackup.js';
