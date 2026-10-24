/** @module {"owns":"magicCanvas pointer and keyboard input - press routing, stroke drafting, gesture end and shortcuts","related":["drawingBoard.js","drawingBoard/geometry.js","drawingBoardSelection.js","drawingBoardCrop.js","drawingBoardFlowchart.js","drawingBoardClipboard.js","canvasViewport.js","lassoGeometry.js"]} */
import { CanvasViewport } from '../canvasViewport.js';
import { createId } from '../canvasDocument.js';
import {
    THIN_MIN_DIST,
    pointSpacingForStyle,
    isDragShape
} from '../drawingBoardCore.js';
import * as ClipboardSession from '../drawingBoardClipboard.js';
import { getStrokesBounds } from '../lassoGeometry.js';
import { showAppToast } from '../toast.js';
import {
    dist2,
    thinStrokePoints,
    readPressure
} from '../drawingBoard/geometry.js';

export function onPointerDown(board, e) {
    if (!board.active || e.button > 0) return;
    if (CanvasViewport.panning || CanvasViewport.spaceHeld || CanvasViewport.handMode || board.activeTool === 'pan') return;
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

    // Connector endpoint grab: when exactly one connector is selected and the
    // pointer lands on one of its endpoints, start dragging that endpoint so
    // the origin/terminus can be re-attached to a different port. Takes
    // priority over the lasso drag that would otherwise start for any click
    // inside the connector's bounding box.
    if (board.isFlowchartMode && board.selectedStrokes.size === 1) {
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
        // In flowchart mode a click picks the shape/connector under the cursor so
        // labels and reroutes have a target; dragging still falls through to marquee.
        if (board.isFlowchartMode && !board.isLassoActive) {
            const hit = board.flowHit(x, y);
            if (hit) {
                board.selectedStrokes.clear();
                board.selectedStrokes.add(hit);
                board.startLassoDrag(x, y);
                board.renderToolbar();
                return;
            }
            if (board.selectedStrokes.size) {
                board.selectedStrokes.clear();
                board.renderToolbar();
            }
        }
        // Keep prior selection visible until endBoxSelect commits the replacement
        board.beginBoxSelect(x, y);
        return;
    }

    if (board.activeTool === 'text') {
        if (board.isFlowchartMode) {
            // Flowchart text edits the selected shape instead of dropping a loose note.
            const target = board.flowHit(x, y);
            if (target) { board.flowEditLabel(target); return; }
            showAppToast('Click a shape to add text');
            return;
        }
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
            preview.flowchartKind = 'shape';
            // Flowchart strokes use the diagram's own color/width so a palette
            // change repaints every shape and connector consistently.
            preview.color = board.flowchartColor();
            preview.width = board.flowchartWidth();
            // No label yet: drawFlowchartLabel skips empty labels, so text only
            // appears once the user actually types something.
            preview.label = null;
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

export function onPointerUp(board, e) {
    if (e.pointerType === 'pen') board.penPointerActive = false;
    try { board.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }

    // End a live crop gesture (persisted only when the frame moved)
    if (board.cropState?.mode) {
        board.endCropGesture();
        return;
    }

    // Commit the flowchart connector drag
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
