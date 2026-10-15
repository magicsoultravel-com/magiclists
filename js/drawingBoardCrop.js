/** @module {"owns":"magicCanvas crop session (frame gesture, overlay)", "related":["drawingBoard.js","canvasImages.js","lassoGeometry.js"]} */
import {
    cropMetrics,
    cropLimitRect,
    resizeCropBox,
    moveCropBox,
    normalizeCropBox,
    boxToCropPatch,
    getImageSourceWindow
} from './canvasImages.js';
import { getActiveStrokes, getActiveTexts } from './canvasDocument.js';
import { showAppToast } from './toast.js';

export function cropBoxBounds(board, box) {
        if (!box) return null;
        return { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
}

export function isPointInCropBox(board, x, y) {
        const state = board.cropState;
        if (!state?.box) return false;
        const { x: bx, y: by, width, height } = state.box;
        return x >= bx && x <= bx + width && y >= by && y <= by + height;
}

export function hitCropHandle(board, x, y) {
        const box = board.cropState?.box;
        if (!box) return null;
        const handles = board.getResizeHandles(board.cropBoxBounds(box));
        for (const h of handles) {
            if (Math.abs(x - h.x) <= RESIZE_HANDLE_HIT / 2 && Math.abs(y - h.y) <= RESIZE_HANDLE_HIT / 2) {
                return h;
            }
        }
        return null;
}

export function startCropSession(board, target) {
        board.selectedStrokes.clear();
        board.cropState = {
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
}

export function beginCropGesture(board, mode, x, y, extra = {}) {
        const state = board.cropState;
        if (!state) return;
        const target = state.target;
        state.mode = mode;
        state.handle = extra.handle || null;
        state.start = {
            x,
            y,
            box: { ...state.box },
            images: JSON.parse(JSON.stringify(board.images())),
            geometry: {
                x: target.x,
                y: target.y,
                width: target.width,
                height: target.height,
                crop: target.crop ? { ...target.crop } : null
            }
        };
}

    /**
     * Pointer entry for the crop tool. Handles resize the live frame, inner
     * drags slide the window over the original image, and drags outside the
     * frame start a fresh box. Nothing persists until the gesture completes.
     */
export function onCropPointerDown(board, x, y) {
        const state = board.cropState;
        if (state?.target) {
            const handle = board.hitCropHandle(x, y);
            if (handle) {
                board.beginCropGesture('resize', x, y, { handle: handle.id });
                return;
            }
            if (board.isPointInCropBox(x, y)) {
                board.beginCropGesture(state.adjusted ? 'move' : 'new', x, y);
                return;
            }
        }
        const target = board.findTopmostImageAt(x, y);
        if (!target) {
            if (!state) showAppToast('Crop: click on an image');
            return;
        }
        if (!state || state.target !== target) board.startCropSession(target);
        board.beginCropGesture('new', x, y);
}

    /** Live crop: rewrite the item rect + source window on every move. */
export function moveCropGesture(board, x, y) {
        const state = board.cropState;
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
        board.requestRedraw();
}

    /** End the gesture; push one undo entry and persist only when it moved. */
export function endCropGesture(board) {
        const state = board.cropState;
        if (!state?.mode) return;
        const changed = !!state.start?.changed;
        const geometry = state.start?.images || null;
        const target = state.target;
        state.mode = null;
        state.handle = null;
        state.start = null;
        if (!changed) {
            board.requestRedraw();
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
        if (geometry) board.pushCropHistory(geometry);
        board.scheduleSave();
        board.redraw();
}

    /**
     * Undoable layer snapshot with a stale images array, so a completed crop
     * gesture records exactly the pre-gesture layout as its undo entry.
     */
export function pushCropHistory(board, imagesSnapshot) {
        board.history.push({
            kind: 'layer',
            canvasMode: board.doc.canvasMode,
            activePageId: board.doc.activePageId,
            strokes: JSON.parse(JSON.stringify(getActiveStrokes(board.doc))),
            texts: JSON.parse(JSON.stringify(getActiveTexts(board.doc))),
            images: JSON.parse(JSON.stringify(imagesSnapshot || []))
        });
        board.updateToolbarState();
}

    /** Escape during a crop drag: restore the gesture start, keep the session. */
export function revertCropGesture(board) {
        const state = board.cropState;
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
        board.scheduleSave();
        board.requestRedraw();
        return true;
}

    /** Escape with no in-flight crop drag: drop the session entirely. */
export function clearCropSession(board) {
        if (!board.cropState) return false;
        board.cropState = null;
        board.requestRedraw();
        return true;
}
    /** Crop frame overlay: veil over the discarded band, thirds, edge handles. */
export function renderCropOverlay(board) {
        if (!board.ctx || !board.canvas || !board.cropState) return;
        const { box, metrics } = board.cropState;
        if (!box || !metrics) return;

        const limit = cropLimitRect(metrics);
        const rx = box.x;
        const ry = box.y;
        const rw = box.width;
        const rh = box.height;

        board.ctx.save();
        // Dim above / below / left / right of the kept frame (within the full frame).
        board.ctx.fillStyle = 'rgba(2, 6, 23, 0.5)';
        board.ctx.fillRect(limit.x, limit.y, limit.width, Math.max(0, ry - limit.y));
        board.ctx.fillRect(limit.x, ry + rh, limit.width, Math.max(0, limit.y + limit.height - (ry + rh)));
        board.ctx.fillRect(limit.x, ry, Math.max(0, rx - limit.x), rh);
        board.ctx.fillRect(rx + rw, ry, Math.max(0, limit.x + limit.width - (rx + rw)), rh);

        // Kept-frame border
        board.ctx.strokeStyle = '#38bdf8';
        board.ctx.lineWidth = 1.5;
        board.ctx.strokeRect(rx, ry, rw, rh);

        // Rule-of-thirds guides
        board.ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
        board.ctx.lineWidth = 1;
        board.ctx.beginPath();
        board.ctx.moveTo(rx + rw / 3, ry);
        board.ctx.lineTo(rx + rw / 3, ry + rh);
        board.ctx.moveTo(rx + (rw * 2) / 3, ry);
        board.ctx.lineTo(rx + (rw * 2) / 3, ry + rh);
        board.ctx.moveTo(rx, ry + rh / 3);
        board.ctx.lineTo(rx + rw, ry + rh / 3);
        board.ctx.moveTo(rx, ry + (rh * 2) / 3);
        board.ctx.lineTo(rx + rw, ry + (rh * 2) / 3);
        board.ctx.stroke();

        // Draggable edge/corner handles (same chrome as selection handles)
        board.getResizeHandles(board.cropBoxBounds(box)).forEach((h) => {
            board.ctx.fillStyle = '#ffffff';
            board.ctx.strokeStyle = '#38bdf8';
            board.ctx.lineWidth = 1.5;
            board.ctx.fillRect(h.x - RESIZE_HANDLE_SIZE / 2, h.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
            board.ctx.strokeRect(h.x - RESIZE_HANDLE_SIZE / 2, h.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
        });
        board.ctx.restore();
}
