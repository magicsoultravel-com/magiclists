/** @module {"owns":"magicCanvas rendering - redraw loop, viewport sizing, page background fill/swatch, note overlay fit","related":["drawingBoard.js","canvasViewport.js","canvasDocument.js","canvasBrushes.js","canvasBackgrounds.js","canvasImages.js","noteCanvasTextOverlay.js","colorPicker.js"]} */
import { resolveNoteColor } from '../colorPicker.js';
import { CanvasViewport } from '../canvasViewport.js';
import {
    getActiveTexts,
    getActiveBackground,
    getActiveBackgroundColor,
    getPageDimensions
} from '../canvasDocument.js';
import {
    drawBrushStroke,
    drawShapeStroke,
    drawTextObject
} from '../canvasBrushes.js';
import { renderBackground } from '../canvasBackgrounds.js';
import {
    ensureImagesLoaded,
    drawImageObject,
    drawImageGhost,
    cropLimitRect
} from '../canvasImages.js';
import {
    paintNoteTextOverlay,
    ensureCanvasFitsNoteText,
    noteHasTextOverlayEnabled,
    activePageIndex,
    migrateNoteCanvasTextFlags
} from '../noteCanvasTextOverlay.js';

export function clientToCanvas(board, clientX, clientY) {
    return CanvasViewport.screenToWorld(clientX, clientY, board.canvas);
}

export function resize(board) {
    if (!board.canvas || !board.boardEl) return;
    const dims = getPageDimensions(board.doc);
    const dpr = window.devicePixelRatio || 1;
    const cssW = dims.width / dpr;
    const cssH = dims.height / dpr;

    [board.canvas, board.bgCanvas].forEach((c) => {
        if (!c) return;
        c.width = dims.width;
        c.height = dims.height;
        c.style.width = cssW + 'px';
        c.style.height = cssH + 'px';
    });
    if (board.innerEl) {
        board.innerEl.style.width = cssW + 'px';
        board.innerEl.style.height = cssH + 'px';
        board.innerEl.classList.toggle('is-paged-canvas', board.doc.canvasMode !== 'infinite');
        board.innerEl.classList.toggle('is-infinite-canvas', board.doc.canvasMode === 'infinite');
    }
    CanvasViewport.setContentSize(cssW, cssH);
    board.redrawBackground();
    board.redraw();
}

export function pageBackgroundFill(board) {
    const custom = getActiveBackgroundColor(board.doc);
    if (custom) return custom;
    if (board.isNoteCanvasMode && board.noteCanvasItem) {
        return resolveNoteColor(board.noteCanvasItem.backgroundColor) || '';
    }
    return '';
}

export function pageBackgroundSwatch(board) {
    const custom = board.pageBackgroundFill();
    if (custom) return custom;
    return getComputedStyle(document.documentElement).getPropertyValue('--desktop-bg').trim() || '#121214';
}

export function redrawBackground(board) {
    if (!board.bgCtx || !board.bgCanvas) return;
    const fillColor = board.pageBackgroundFill();
    // In flowchart mode the visible grid must match the snap size exactly,
    // otherwise the +/- stepper changes behaviour with no visual feedback.
    const spacing = board.isFlowchartMode ? (board.flowchartGrid().size || 24) : 24;
    renderBackground(board.bgCtx, getActiveBackground(board.doc), board.bgCanvas.width, board.bgCanvas.height, {
        fillColor,
        spacing
    });
    // Note text overlay is painted in redraw() on the main canvas (under strokes).
}

export function adaptNoteTextOverlayToCanvas(board) {
    if (!board.isNoteCanvasMode || !board.noteCanvasItem || !board.doc) return false;
    migrateNoteCanvasTextFlags(board.noteCanvasItem);
    if (!noteHasTextOverlayEnabled(board.noteCanvasItem)) return false;
    const grew = ensureCanvasFitsNoteText(board.doc, board.noteCanvasItem);
    if (grew) board.resize();
    else {
        board.redrawBackground();
        board.redraw();
    }
    return grew;
}

export function requestRedraw(board) {
    if (board.rafId) return;
    board.rafId = requestAnimationFrame(() => { board.rafId = null; board.redraw(); });
}

export function redraw(board) {
    if (!board.ctx || !board.canvas) return;
    board.ctx.clearRect(0, 0, board.canvas.width, board.canvas.height);

    // Copy-paper note text under strokes (same world coords as drawing).
    if (board.isNoteCanvasMode && noteHasTextOverlayEnabled(board.noteCanvasItem)) {
        paintNoteTextOverlay(board.ctx, board.noteCanvasItem, {
            fillColor: board.pageBackgroundFill(),
            doc: board.doc,
            pageIndex: activePageIndex(board.doc)
        });
    }

    const images = board.images();
    ensureImagesLoaded(images, () => { if (board.active) board.requestRedraw(); });
    const cropTarget = board.cropState?.target;
    images.forEach((img) => {
        // Dimmed full-frame ghost under the live crop target only.
        if (img === cropTarget && board.cropState) {
            drawImageGhost(board.ctx, img, {
                limitRect: cropLimitRect(board.cropState.metrics)
            });
        }
        drawImageObject(board.ctx, img);
    });

    board.strokes().forEach((stroke) => {
        if (stroke.tool === 'brush') drawBrushStroke(board.ctx, stroke);
        else drawShapeStroke(board.ctx, stroke);
    });
    getActiveTexts(board.doc).forEach((t) => drawTextObject(board.ctx, t));
    if (board.draftStroke) drawBrushStroke(board.ctx, board.draftStroke);
    if (board.shapePreview) drawShapeStroke(board.ctx, board.shapePreview);

    if (board.isFlowchartMode) board.renderFlowchartOverlays();

    // Render lasso overlay (path, box selection, selection box, resize handles)
    if (board.isLassoActive || board.selectedStrokes.size > 0 || board.isBoxSelecting) {
        board.renderLassoOverlay();
    }

    // Crop tool overlay (active drag box)
    if (board.cropState) board.renderCropOverlay();
}

export function pageLabel(board) {
    const idx = board.doc.pages.findIndex((p) => p.id === board.doc.activePageId);
    return (idx + 1) + ' / ' + board.doc.pages.length;
}
