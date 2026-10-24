/** @module {"owns":"magicCanvas session enter/exit (workspace, note canvas, flowchart) and toolbar chrome lifecycle","related":["drawingBoard.js","drawingBoard/prefs.js","canvasViewport.js","flowchart.js","noteModel.js"]} */
import { ColorPicker } from '../colorPicker.js';
import { DrawingToolbarMenu } from '../drawingToolbarMenu.js';
import { CanvasViewport } from '../canvasViewport.js';
import {
    readDocument,
    setActiveBackground
} from '../canvasDocument.js';
import { DrawingToolbarChrome } from '../drawingToolbarChrome.js';
import { clearImageCache } from '../canvasImages.js';
import {
    ensureCanvasFitsNoteText,
    noteHasTextOverlayEnabled,
    migrateNoteCanvasTextFlags
} from '../noteCanvasTextOverlay.js';
import { readPrefs } from '../drawingBoard/prefs.js';

export function init(board, app) {
    board.app = app;
    board.boardEl = document.getElementById('drawing-board');
    board.canvas = document.getElementById('drawing-canvas');
    board.bgCanvas = document.getElementById('drawing-bg-canvas');
    board.viewportEl = document.getElementById('canvas-viewport');
    board.innerEl = document.getElementById('canvas-viewport-inner');
    board.textLayer = document.getElementById('canvas-text-layer');
    board.brandEl = document.getElementById('app-brand');
    DrawingToolbarChrome.init();
    DrawingToolbarChrome.onCollapse = () => {
        ColorPicker.close();
        DrawingToolbarMenu.close();
        board.colorRolloutOpen = false;
        board.bgColorRolloutOpen = false;
        requestAnimationFrame(() => board.resize());
    };
    DrawingToolbarChrome.onExpand = () => {
        board.renderToolbar();
        requestAnimationFrame(() => board.resize());
    };
    if (board.brandEl) {
        board.brandNotesText = board.brandEl.querySelector('.app-brand__text')?.textContent?.trim()
            || board.brandEl.textContent?.trim()
            || 'magicNotes';
    }

    if (!board.canvas || !board.boardEl) return;
    board.ctx = board.canvas.getContext('2d');
    board.bgCtx = board.bgCanvas?.getContext('2d');

    CanvasViewport.init(board.innerEl, board.viewportEl);
    board.viewportEl?.addEventListener('canvas:zoom', () => {
        board.updateZoomLevel();
        board.persistViewport();
        CanvasViewport.syncScrollbars();
    });
    board.viewportEl?.addEventListener('canvas:pan', () => {
        board.persistViewport();
        CanvasViewport.syncScrollbars();
    });

    board.canvas.addEventListener('pointerdown', (e) => board.onPointerDown(e));
    board.canvas.addEventListener('dblclick', (e) => {
        if (!board.isFlowchartMode) return;
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        const target = board.flowHit(pt.x, pt.y);
        if (target) { e.preventDefault(); board.flowEditLabel(target); }
    });
    board.canvas.addEventListener('pointermove', (e) => board.onPointerMove(e));
    board.canvas.addEventListener('pointerup', (e) => board.onPointerUp(e));
    board.canvas.addEventListener('pointercancel', (e) => board.onPointerUp(e));
    board.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('resize', () => { if (board.active) board.resize(); });
}

export async function activate(board) {
    board.history.clear();
    board.active = true;
    board.docOwner = 'workspace';
    DrawingToolbarChrome.show();
    board.toolbarEl = DrawingToolbarChrome.getToolbarMount();
    board.doc = await readDocument();
    board.prefs = readPrefs();
    board.activeTool = board.prefs.activeTool;
    board.activeStyle = board.prefs.activeStyle;
    board.isNoteCanvasMode = false;
    board.activeNoteId = null;
    board.noteCanvasItem = null;
    board.cropState = null;

    if (board.brandEl) board.brandEl.textContent = 'magicCanvas';
    board.updateNoteToolbarChrome();

    board.boardEl.classList.remove('is-hidden');
    board.boardEl.setAttribute('aria-hidden', 'false');

    CanvasViewport.loadFromDoc(board.doc.viewport);
    CanvasViewport.setHandMode(board.activeTool === 'pan');
    if (board.canvas) board.canvas.dataset.tool = board.activeTool;
    board.shrinkInfiniteIfNeeded();
    board.renderToolbar();
    board.updateZoomLevel();
    board.resize();
    board.redraw();
}

export async function activateForNote(board, item) {
    if (!item?.id) return;
    const { normalizeNoteCanvas } = await import('../noteModel.js');
    migrateNoteCanvasTextFlags(item);
    board.history.clear();
    board.active = true;
    board.docOwner = 'note';
    board.isNoteCanvasMode = true;
    board.isFlowchartMode = false;
    board.flowchartItem = null;
    board.activeNoteId = item.id;
    board.noteCanvasItem = item;
    board.cropState = null;
    board.doc = normalizeNoteCanvas(item.canvas);
    board.prefs = readPrefs();
    board.activeTool = board.prefs.activeTool;
    board.activeStyle = board.prefs.activeStyle;

    DrawingToolbarChrome.show();
    board.toolbarEl = DrawingToolbarChrome.getToolbarMount();

    if (board.brandEl) board.brandEl.textContent = 'magicCanvas';
    board.updateNoteToolbarChrome();

    board.boardEl.classList.remove('is-hidden');
    board.boardEl.setAttribute('aria-hidden', 'false');

    CanvasViewport.loadFromDoc(board.doc.viewport || { scale: 1, offsetX: 0, offsetY: 0 });
    CanvasViewport.setHandMode(board.activeTool === 'pan');
    if (board.canvas) board.canvas.dataset.tool = board.activeTool;
    board.shrinkInfiniteIfNeeded();
    if (noteHasTextOverlayEnabled(item)) {
        ensureCanvasFitsNoteText(board.doc, item);
    }
    board.renderToolbar();
    board.updateZoomLevel();
    board.resize();
    board.redrawBackground();
    board.redraw();
    if (board.isFlowchartMode) board.bindFlowBendEvents();
}

export async function openNoteFlowchart(board, item) {
    if (!item?.id) return;
    const { normalizeFlowchart, createEmptyFlowchart } = await import('../flowchart.js');
    if (!item.flowchart) {
        item.flowchart = createEmptyFlowchart();
        item.flowchartHidden = false;
    }
    const normalized = normalizeFlowchart(item.flowchart) || createEmptyFlowchart();
    item.flowchart = normalized;
    board.history.clear();
    board.active = true;
    board.docOwner = 'flowchart';
    board.isNoteCanvasMode = false;
    board.noteCanvasItem = null;
    board.isFlowchartMode = true;
    board.flowchartItem = item;
    board.flowchartRouting = 'straight';
    board.activeNoteId = item.id;
    board.cropState = null;
    board.doc = normalized.doc;
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
    setActiveBackground(board.doc, normalized.grid.type);
    board.prefs = readPrefs();
    // Keep the user's brush prefs; default new diagrams to a shape tool.
    board.activeTool = 'rect';
    board.activeStyle = board.prefs.activeStyle || 'pen';

    DrawingToolbarChrome.show();
    board.toolbarEl = DrawingToolbarChrome.getToolbarMount();

    if (board.brandEl) board.brandEl.textContent = 'magicCanvas · Flowchart';
    board.updateNoteToolbarChrome();

    board.boardEl.classList.remove('is-hidden');
    board.boardEl.setAttribute('aria-hidden', 'false');

    CanvasViewport.loadFromDoc(board.doc.viewport || { scale: 1, offsetX: 0, offsetY: 0 });
    CanvasViewport.setHandMode(false);
    if (board.canvas) board.canvas.dataset.tool = board.activeTool;
    board.shrinkInfiniteIfNeeded();
    board.renderToolbar();
    board.updateZoomLevel();
    board.resize();
    board.redrawBackground();
    board.redraw();
}

export function exitNoteCanvas(board) {
    if (!board.isNoteCanvasMode) return;
    const item = board.noteCanvasItem;
    if (!item) return;
    window.dispatchEvent(new CustomEvent('note:canvas_draw_exited', { detail: { item } }));
}

export function exitFlowchart(board) {
    if (!board.isFlowchartMode) return;
    const item = board.flowchartItem;
    if (!item) return;
    window.dispatchEvent(new CustomEvent('note:canvas_draw_exited', { detail: { item } }));
}

export function exitFromToolbar(board) {
    if (board.isFlowchartMode) { board.exitFlowchart(); return; }
    if (board.isNoteCanvasMode) { board.exitNoteCanvas(); return; }
}

export async function deactivate(board) {
    if (!board.active && !board.docOwner) return;
    board.active = false;
    await board.flushSave();
    clearTimeout(board.saveTimer);
    board.saveTimer = null;
    ColorPicker.close();
    DrawingToolbarMenu.close();
    board.colorRolloutOpen = false;
    board.bgColorRolloutOpen = false;
    if (board.brandEl) board.brandEl.textContent = board.brandNotesText;
    board.boardEl?.classList.add('is-hidden');
    board.boardEl?.setAttribute('aria-hidden', 'true');
    DrawingToolbarChrome.hide();
    if (board.textLayer) board.textLayer.innerHTML = '';
    board.toolbarEl = null;
    board.draftStroke = null;
    board.shapePreview = null;
    board.resizeHandle = null;
    board.resizeStart = null;
    board.cropState = null;
    board.hoverHandle = null;
    board.selectedStrokes.clear();
    CanvasViewport.setHandMode(false);
    clearImageCache();
    board.isNoteCanvasMode = false;
    board.isFlowchartMode = false;
    board.activeNoteId = null;
    board.noteCanvasItem = null;
    board.flowchartItem = null;
    board.doc = null;
    board.docOwner = null;
    board.history.clear();
    // Gesture-scoped history flags must not leak into the next session.
    board.eraseHistoryPushed = false;
    board.bgColorHistoryPushed = false;
    board.updateNoteToolbarChrome();
}

export function hideToolbar(board) {
    DrawingToolbarChrome.collapse();
}
