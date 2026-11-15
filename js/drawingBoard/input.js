/** @module {"owns":"magicCanvas pointer and keyboard input - press routing, stroke drafting, gesture end and shortcuts","related":["drawingBoard.js","drawingBoard/geometry.js","drawingBoard/fill.js","drawingBoardSelection.js","drawingBoardCrop.js","drawingBoardFlowchart.js","drawingBoardClipboard.js","canvasViewport.js","lassoGeometry.js"]} */
import { CanvasViewport } from '../canvasViewport.js';
import { createId } from '../canvasDocument.js';
import {
    THIN_MIN_DIST,
    pointSpacingForStyle,
    isDragShape
} from '../drawingBoardCore.js';
import * as ClipboardSession from '../drawingBoardClipboard.js';
import { getStrokesBounds } from '../lassoGeometry.js';
import { isFillableShape } from './fill.js';
import {
    dist2,
    thinStrokePoints,
    readPressure
} from '../drawingBoard/geometry.js';

export function onPointerDown(board, e) {
    if (!board.active || e.button > 0) return;
    if (CanvasViewport.panning || CanvasViewport.spaceHeld) return;
    if (e.pointerType === 'touch' && board.penPointerActive) return;
    if (e.pointerType === 'pen') board.penPointerActive = true;

    const { x, y } = board.clientToCanvas(e.clientX, e.clientY);
    board.expandInfiniteIfNeeded(x, y);

    board.canvas.setPointerCapture(e.pointerId);

    // Crop tool: drag the live frame edges/corners, or slide its window
    if (board.activeTool === 'crop') {
        board.onCropPointerDown(x, y);
        return;
    }

    // Elbow bend grab: the pointer must sit on the bend itself before this
    // steals the gesture, so ordinary drawing on a selected connector still
    // works. Runs before the endpoint grab so a bend never starts an endpoint drag.
    if (board.flowBendDrag === null && board.startFlowBendDrag(x, y)) return;

    // Connector endpoint grab: when exactly one connector is selected and the
    // pointer lands on one of its endpoints, start dragging that endpoint so
    // the origin/terminus can be re-attached to a different port. Takes
    // priority over the lasso drag that would otherwise start for any click
    // inside the connector's bounding box.
    if (board.selectedStrokes.size === 1) {
        const only = board.getSelectedStrokesArray()[0];
        if (only && only.flowchartKind === 'connector') {
            const hitEnd = board.hitFlowEndpoint(only, x, y);
            if (hitEnd) {
                board.startFlowEndpointDrag(only, hitEnd, x, y);
                return;
            }
        }
    }

    // Resize handles take priority when something is selected
    if (board.selectedStrokes.size > 0) {
        const handle = board.hitResizeHandle(x, y);
        if (handle) {
            board.startResize(handle, x, y);
            return;
        }
        const bounds = getStrokesBounds(board.getSelectedStrokesArray());
        if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
            board.startLassoDrag(x, y);
            return;
        }
    }

    // Rectangle marquee (lasso mode or pointer select tool)
    if (board.isLassoActive || board.activeTool === 'pointer') {
        // A click picks the shape/connector under the cursor so double-click
        // labels and reroutes have a target; dragging still falls through to
        // marquee. Selection never repaints the toolbar (no selection chrome).
        if (!board.isLassoActive) {
            const hit = board.flowHit(x, y);
            if (hit) {
                board.selectedStrokes.clear();
                board.selectedStrokes.add(hit);
                board.startLassoDrag(x, y);
                return;
            }
            if (board.selectedStrokes.size) board.selectedStrokes.clear();
        }
        // Keep prior selection visible until endBoxSelect commits the replacement
        board.beginBoxSelect(x, y);
        return;
    }

    if (board.activeTool === 'text') {
        // Text on a shape/connector edits that label; empty canvas drops a
        // free-floating text box exactly as before.
        const target = board.flowHit(x, y);
        if (target) { board.flowEditLabel(target); return; }
        board.placeTextBox(x, y);
        return;
    }

    if (board.isFlowConnector(board.activeTool)) {
        const anchor = board.flowResolveEndpoint(x, y, null);
        const from = anchor
            ? { shapeId: anchor.shapeId, port: anchor.port }
            : null;
        const snapped = board.flowSnapPoint(x, y, e.shiftKey);
        board.flowConnect = {
            x: snapped.x, y: snapped.y,
            from,
            fromPt: anchor ? { x: anchor.point.x, y: anchor.point.y } : snapped,
            hover: null
        };
        return;
    }

    if (board.activeTool === 'eraser') {
        // Every press starts a fresh gesture; eraseAt pushes history itself,
        // and only once something is actually removed.
        board.eraseHistoryPushed = false;
        board.eraseAt(x, y);
        board.redraw();
        return;
    }

    if (board.activeTool === 'brush') {
        const brush = board.currentBrush();
        board.pushLayerHistory();
        board.draftStroke = {
            id: createId('stroke'),
            tool: 'brush',
            style: board.activeStyle,
            color: brush.color,
            width: brush.width,
            points: [{ x, y, p: readPressure(e), tiltX: e.tiltX || 0, tiltY: e.tiltY || 0 }]
        };
        return;
    }

    if (isDragShape(board.activeTool)) {
        const brush = board.currentBrush();
        const anchor = board.flowSnapPoint(x, y, e.shiftKey);
        const preview = {
            id: createId('stroke'),
            tool: board.activeTool,
            style: board.activeStyle,
            color: brush.color,
            width: brush.width,
            x0: anchor.x, y0: anchor.y, x1: anchor.x, y1: anchor.y
        };
        if (board.isFlowShape(board.activeTool)) {
            // Shapes are connector targets and accept inline labels; the stroke
            // colour/width comes from the active brush, like every other stroke.
            preview.flowchartKind = 'shape';
        }
        // New shapes inherit the fill swatch; connectors have no interior, so
        // isFillableShape keeps them outline-only.
        if (isFillableShape(preview)) {
            const fill = board.shapeFillColor();
            if (fill) preview.fillColor = fill;
        }
        board.shapePreview = preview;
    }
}

export function onPointerMove(board, e) {
    if (!board.active || CanvasViewport.panning) return;
    if (e.pointerType === 'touch' && board.penPointerActive) return;
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];

    // Resize selected images via grab handles
    if (board.resizeHandle && board.resizeStart) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        board.applyResize(pt.x, pt.y);
        return;
    }

    // Live crop frame drag
    if (board.cropState?.mode) {
        const cropPt = board.clientToCanvas(e.clientX, e.clientY);
        board.moveCropGesture(cropPt.x, cropPt.y);
        return;
    }

    // Live connector bend drag
    if (board.flowBendDrag) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        board.moveFlowBendDrag(pt.x, pt.y);
        return;
    }

    // Drag selected items (used by both pointer and lasso modes)
    if (board.isDraggingLasso && board.lassoDragStart) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        const dx = pt.x - board.lassoDragStart.x;
        const dy = pt.y - board.lassoDragStart.y;
        board.dragLassoSelection(dx, dy);
        board.lassoDragStart = { x: pt.x, y: pt.y };
        return;
    }

    // Hover cursor: crop session has priority while the crop tool is active
    if (!board.isBoxSelecting && !board.draftStroke && !board.shapePreview && !board.cropState?.mode
        && (board.activeTool === 'pointer' || board.activeTool === 'crop' || board.isLassoActive || board.selectedStrokes.size > 0)) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        board.updateHoverCursor(pt.x, pt.y);
    }

    // Rectangle marquee update
    if (board.isBoxSelecting && board.boxSelectStart) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        board.updateBoxSelect(pt.x, pt.y);
        board.requestRedraw();
        return;
    }

    if (board.draftStroke) {
        const minDist = pointSpacingForStyle(board.draftStroke.style || board.activeStyle);
        const minDist2 = minDist * minDist;
        let added = false;
        events.forEach((ev) => {
            const pt = board.clientToCanvas(ev.clientX, ev.clientY);
            board.expandInfiniteIfNeeded(pt.x, pt.y);
            const last = board.draftStroke.points[board.draftStroke.points.length - 1];
            if (last && dist2(last, pt) < minDist2) return;
            board.draftStroke.points.push({
                x: pt.x, y: pt.y, p: readPressure(ev), tiltX: ev.tiltX || 0, tiltY: ev.tiltY || 0
            });
            added = true;
        });
        if (added) board.requestRedraw();
        return;
    }
    // Live connector endpoint drag
    if (board.flowEndpointDrag) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        board.applyFlowEndpointDrag(pt.x, pt.y);
        return;
    }

    if (board.flowConnect) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        const snapped = board.flowSnapPoint(pt.x, pt.y, e.shiftKey);
        board.flowConnect.x = snapped.x;
        board.flowConnect.y = snapped.y;
        const anchor = board.flowResolveEndpoint(snapped.x, snapped.y, board.flowConnect.from?.shapeId);
        board.flowConnect.hover = anchor
            ? { shapeId: anchor.shapeId, port: anchor.port, x: anchor.point.x, y: anchor.point.y }
            : null;
        board.requestRedraw();
        return;
    }
    if (board.shapePreview) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        const snapped = board.flowSnapPoint(pt.x, pt.y, e.shiftKey);
        board.shapePreview.x1 = snapped.x;
        board.shapePreview.y1 = snapped.y;
        board.requestRedraw();
        return;
    }
    if (board.activeTool === 'eraser' && (e.buttons & 1)) {
        const pt = board.clientToCanvas(e.clientX, e.clientY);
        board.eraseAt(pt.x, pt.y);
        board.requestRedraw();
    }
}

/**
 * Cancel whatever the first finger started, when a second finger turns the
 * press into a two-finger pan/pinch. Drafts are dropped without ever reaching
 * the document, but the two press-time writers need an explicit rollback: the
 * brush pushes its history entry on press (dropping the draft alone would leave
 * a dead undo step) and the eraser writes on contact (the dab would stay).
 */
export function abortGesture(board) {
    let touched = false;

    // Crop: restore the frame geometry captured at press time, keep the session.
    if (board.revertCropGesture?.()) touched = true;

    if (board.draftStroke) {
        board.draftStroke = null;
        // Pops the snapshot the brush press pushed; the stroke never landed, so
        // the restore is visually a no-op and only the orphan entry goes away.
        board.undo();
        touched = true;
    }

    if (board.eraseHistoryPushed) {
        // The flag is press-scoped: reset at every eraser press, set only when
        // eraseAt actually removed something. One undo drops that single entry.
        board.eraseHistoryPushed = false;
        board.undo();
        touched = true;
    }

    // Live previews and drags never reached the document — drop the state.
    if (board.shapePreview) { board.shapePreview = null; touched = true; }
    if (board.flowConnect) { board.flowConnect = null; touched = true; }
    if (board.flowEndpointDrag) { board.flowEndpointDrag = null; touched = true; }
    if (board.flowBendDrag) { board.flowBendDrag = null; touched = true; }

    // A resize, selection drag or marquee under the pan is committed rather than
    // rewound: the geometry on screen is what the user built before adding the
    // second finger, and committing is what Escape does with the same gestures.
    if (board.resizeHandle) { board.finishResize(); touched = true; }
    if (board.isDraggingLasso) { board.finishLassoDrag(); touched = true; }
    if (board.isBoxSelecting) {
        board.isBoxSelecting = false;
        board.boxSelectStart = null;
        board.boxSelectCurrent = null;
        touched = true;
    }

    if (touched) board.redraw();
    return touched;
}

export function onPointerUp(board, e) {
    if (e.pointerType === 'pen') board.penPointerActive = false;
    try { board.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // Capture is released first, then the pan wins: a two-finger pan must not
    // commit the crop/resize/marquee the first finger started (abortGesture has
    // already cleared them, this just stops the up handler from re-reading).
    if (CanvasViewport.panning) return;

    // End a live crop gesture (persisted only when the frame moved)
    if (board.cropState?.mode) {
        board.endCropGesture();
        return;
    }

    // Commit a connector bend drag
    if (board.flowBendDrag) {
        board.finishFlowBendDrag();
        return;
    }

    // Commit the connector drag
    if (board.flowConnect) {
        board.commitFlowConnect();
        return;
    }

    // Finish connector endpoint drag
    if (board.flowEndpointDrag) {
        board.finishFlowEndpointDrag();
        return;
    }

    // Finish resize
    if (board.resizeHandle) {
        board.finishResize();
        board.redraw();
        return;
    }

    // Finish rectangle marquee
    if (board.isBoxSelecting) {
        board.endBoxSelect();
        board.redraw();
        return;
    }

    // Finish dragging selection
    if (board.isDraggingLasso) {
        board.finishLassoDrag();
        board.redraw();
        return;
    }

    if (board.draftStroke) {
        if (board.draftStroke.points.length >= 1) {
            const style = board.draftStroke.style || board.activeStyle;
            const spacing = pointSpacingForStyle(style);
            board.draftStroke.points = thinStrokePoints(
                board.draftStroke.points,
                Math.max(THIN_MIN_DIST, spacing * 0.75)
            );
            const s = board.strokes();
            s.push(board.draftStroke);
            board.setStrokes(s);
            board.scheduleSave();
        }
        board.draftStroke = null;
        board.redraw();
        return;
    }
    if (board.shapePreview) {
        const s = board.shapePreview;
        if (Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > 2) {
            board.pushLayerHistory();
            const strokes = board.strokes();
            strokes.push({ ...s });
            board.setStrokes(strokes);
            board.scheduleSave();
        }
        board.shapePreview = null;
        board.redraw();
    }
}

export function handleKeydown(board, e) {
    if (!board.active) return false;
    // The note UndoManager listens on document too. If it already claimed the
    // chord, undoing here as well would swallow two steps per Ctrl+Z.
    if (e.defaultPrevented) return false;
    // Never touch canvas history while a text box (or any field) is being
    // edited — Ctrl+Z there must undo typing, not delete strokes.
    const typing = ClipboardSession.isTextEditingTarget();
    if (e.ctrlKey || e.metaKey) {
        if (!typing && e.key === 'z' && !e.shiftKey) { e.preventDefault(); board.undo(); return true; }
        if (!typing && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); board.redo(); return true; }
        if (e.key === 'c') return ClipboardSession.handleCopyKey(board, e);
        if (e.key === 'x') return ClipboardSession.handleCutKey(board, e);
        // Ctrl+V arms only — never preventDefault (would suppress the paste event itself).
        if (e.key === 'v') return ClipboardSession.handlePasteKey(board, e);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
        return ClipboardSession.handleDeleteKey(board, e);
    }

    // Escape: revert an in-flight crop drag first, else drop the crop session
    if (e.key === 'Escape') {
        if (board.flowEndpointDrag) { board.flowEndpointDrag = null; board.redraw(); return true; }
        if (board.flowConnect) { board.flowConnect = null; board.redraw(); return true; }
        if (board.flowLabelEl) return false;
        if (board.revertCropGesture()) return true;
        if (board.clearCropSession()) { board.redraw(); return true; }
        if (board.resizeHandle) {
            board.finishResize();
            board.redraw();
            return true;
        }
        if (board.isDraggingLasso) {
            board.finishLassoDrag();
            board.redraw();
            return true;
        }
        if (board.isBoxSelecting) {
            board.isBoxSelecting = false;
            board.boxSelectStart = null;
            board.boxSelectCurrent = null;
            board.redraw();
            return true;
        }
        // Two-step Escape: clear selection first; exit marquee mode only when empty
        if (board.selectedStrokes.size > 0) {
            board.selectedStrokes.clear();
            board.isDraggingLasso = false;
            board.lassoDragStart = null;
            board.lassoDragMoved = false;
            board.lassoHistoryPushed = false;
            board.redraw();
            return true;
        }
        if (board.isLassoActive) {
            board.clearLassoSelection();
            return true;
        }
    }

    return false;
}
