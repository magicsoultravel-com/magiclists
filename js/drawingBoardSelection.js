/** @module {"owns":"magicCanvas selection session (box select, lasso drag, resize handles)", "related":["drawingBoard.js","lassoGeometry.js","canvasDocument.js"]} */
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
    getActiveTexts, setActiveTexts,
    getPageDimensions,
    createId
} from './canvasDocument.js';
import { CanvasViewport } from './canvasViewport.js';
import { DRAWING_PREFS_KEY } from './drawingBoardBackup.js';
import { RESIZE_HANDLE_SIZE, RESIZE_HANDLE_HIT } from './drawingBoardCore.js';
import { MIN_IMAGE_SIDE } from './canvasImages.js';

function writePrefs(prefs) {
    try { localStorage.setItem(DRAWING_PREFS_KEY, JSON.stringify(prefs)); } catch { /* ignore quota */ }
}

export function beginBoxSelect(board, x, y) {
        board.isBoxSelecting = true;
        board.boxSelectStart = { x, y };
        board.boxSelectCurrent = { x, y };
        board.requestRedraw();
}

export function updateBoxSelect(board, x, y) {
        board.boxSelectCurrent = { x, y };
}

export function endBoxSelect(board) {
        if (!board.boxSelectStart || !board.boxSelectCurrent) {
            board.isBoxSelecting = false;
            board.boxSelectStart = null;
            board.boxSelectCurrent = null;
            return;
        }

        const { x: x0, y: y0 } = board.boxSelectStart;
        const { x: x1, y: y1 } = board.boxSelectCurrent;
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
            board.selectAndRaiseAtPoint(x0, y0, threshold / 2);
        } else if (result.rect) {
            // Commit selection in one shot (replaces any prior selection)
            board.selectedStrokes.clear();
            board.selectStrokesInRect(result.rect);
        }

        board.isBoxSelecting = false;
        board.boxSelectStart = null;
        board.boxSelectCurrent = null;
}

    /**
     * Click-select: pick the visually topmost item at the point and raise it to
     * the top of its own layer (undoable). Misses clear the selection.
     * @param {number} x
     * @param {number} y
     * @param {number} [radius=0]
     */
export function selectAndRaiseAtPoint(board, x, y, radius = 0) {
        const item = findTopmostItemAt(x, y, {
            texts: getActiveTexts(board.doc),
            strokes: board.strokes(),
            images: board.images()
        }, radius);

        board.selectedStrokes.clear();
        if (!item) return;

        const raised = raiseItemInLayer(item, {
            strokes: board.strokes(),
            texts: getActiveTexts(board.doc),
            images: board.images()
        });

        if (raised) {
            // Snapshot before assigning so Ctrl+Z restores the previous order.
            board.pushLayerHistory();
            if (raised.kind === 'images') board.setImages(raised.items);
            else if (raised.kind === 'texts') setActiveTexts(board.doc, raised.items);
            else board.setStrokes(raised.items);
            board.scheduleSave();
        }

        board.selectedStrokes.add(item);
}

export function selectStrokesInRect(board, rect) {
        if (!rect) return;

        const strokes = board.strokes();
        const texts = getActiveTexts(board.doc);
        const images = board.images();
        board.selectedStrokes.clear();

        for (const stroke of strokes) {
            if (itemIntersectsRect(stroke, rect)) {
                board.selectedStrokes.add(stroke);
            }
        }
        for (const text of texts) {
            if (itemIntersectsRect(text, rect)) {
                board.selectedStrokes.add(text);
            }
        }
        for (const image of images) {
            if (itemIntersectsRect(image, rect)) {
                board.selectedStrokes.add(image);
            }
        }
        // Select-only must not push undo history
}

export function placeTextBox(board, x, y) {
        const brush = board.currentBrush();
        const dpr = window.devicePixelRatio || 1;
        const el = document.createElement('div');
        el.className = 'canvas-text-box';
        el.contentEditable = 'true';
        el.dataset.placeholder = 'Type…';
        el.style.left = (x / dpr) + 'px';
        el.style.top = (y / dpr) + 'px';
        el.style.color = brush.color;
        el.style.fontSize = Math.max(16, brush.width * 4) + 'px';
        board.textLayer.appendChild(el);
        el.focus();

        const commit = () => {
            const text = el.innerText.trim();
            el.remove();
            if (!text) return;
            board.pushLayerHistory();
            const texts = getActiveTexts(board.doc);
            texts.push({
                id: createId('text'),
                tool: 'text',
                x, y,
                text,
                fontSize: Math.max(16, brush.width * 4) * dpr,
                color: brush.color,
                fontFamily: 'Inter, sans-serif'
            });
            setActiveTexts(board.doc, texts);
            board.scheduleSave();
            board.redraw();
        };
        el.addEventListener('blur', commit, { once: true });
        el.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') { el.innerText = ''; el.blur(); }
        });
}

export function eraseAt(board, x, y, radius = 14) {
        const strokes = board.strokes().filter((stroke) => !board.hitStroke(stroke, x, y, radius));
        if (strokes.length !== board.strokes().length) {
            board.setStrokes(strokes);
            board.scheduleSave();
        }
        // Eraser skips media/images — remove those via Clear or selection tooling.
}

export function hitImage(board, img, x, y, radius) {
        if (!img) return false;
        const b = getImageBounds(img);
        return x >= b.minX - radius && x <= b.maxX + radius && y >= b.minY - radius && y <= b.maxY + radius;
}

export function hitStroke(board, stroke, x, y, radius) {
        if (stroke.tool === 'brush' && stroke.points?.length) {
            return stroke.points.some((pt) => Math.hypot(pt.x - x, pt.y - y) <= radius + (stroke.width || 3));
        }
        if (stroke.tool === 'text') {
            return x >= stroke.x - radius && x <= stroke.x + 200 && y >= stroke.y - radius && y <= stroke.y + 60;
        }
        if (stroke.tool === 'image') {
            return board.hitImage(stroke, x, y, radius);
        }
        const x0 = Math.min(stroke.x0, stroke.x1);
        const x1 = Math.max(stroke.x0, stroke.x1);
        const y0 = Math.min(stroke.y0, stroke.y1);
        const y1 = Math.max(stroke.y0, stroke.y1);
        return x >= x0 - radius && x <= x1 + radius && y >= y0 - radius && y <= y1 + radius;
}

    /** Topmost image (last painted) under the pointer, or null. */
export function findTopmostImageAt(board, x, y) {
        const images = board.images();
        for (let i = images.length - 1; i >= 0; i -= 1) {
            if (board.hitImage(images[i], x, y, 0)) return images[i];
        }
        return null;
}
    // Marquee (lasso button) methods — rectangle select mode
export function toggleLassoMode(board) {
        if (board.isLassoActive) {
            board.clearLassoSelection();
        } else {
            board.startLassoMode();
        }
}

export function startLassoMode(board) {
        board.isLassoActive = true;
        board.selectedStrokes.clear();
        board.isDraggingLasso = false;
        board.lassoDragMoved = false;
        board.lassoHistoryPushed = false;
        board.isBoxSelecting = false;
        board.boxSelectStart = null;
        board.boxSelectCurrent = null;
        // Marquee mode uses pointer-style selection; keep activeTool as pointer for prefs
        board.activeTool = 'pointer';
        board.prefs.activeTool = 'pointer';
        writePrefs(board.prefs);
        if (board.canvas) board.canvas.dataset.tool = 'lasso';
        board.renderToolbar();
        board.redraw();
}

export function clearLassoSelection(board) {
        board.isLassoActive = false;
        board.selectedStrokes.clear();
        board.isDraggingLasso = false;
        board.lassoDragStart = null;
        board.lassoDragMoved = false;
        board.lassoHistoryPushed = false;
        board.isBoxSelecting = false;
        board.boxSelectStart = null;
        board.boxSelectCurrent = null;
        // Do not wipe textLayer here — it may contain active contentEditable boxes.
        if (board.canvas) {
            board.canvas.dataset.tool = board.activeTool;
            board.canvas.style.cursor = '';
            board.lastHoverCursor = null;
        }
        board.renderToolbar();
        board.redraw();
}

export function getSelectedStrokesArray(board) {
        return Array.from(board.selectedStrokes);
}

export function startLassoDrag(board, x, y) {
        if (board.selectedStrokes.size === 0) return;

        board.isDraggingLasso = true;
        board.lassoDragStart = { x, y };
        board.lassoDragMoved = false;
        board.lassoHistoryPushed = false;
}

export function dragLassoSelection(board, dx, dy) {
        if (!board.isDraggingLasso || board.selectedStrokes.size === 0) return;
        if (!dx && !dy) return;

        if (!board.lassoHistoryPushed) {
            board.pushLayerHistory();
            board.lassoHistoryPushed = true;
        }
        board.lassoDragMoved = true;

        translateStrokes(board.getSelectedStrokesArray(), dx, dy);

        // Clamp to page bounds for fixed page modes
        const dims = getPageDimensions(board.doc);
        const pageBounds = getPageBounds(board.doc, dims);
        clampStrokesToBounds(board.getSelectedStrokesArray(), pageBounds);

        // Connectors follow their shapes so links survive the move.
        board.flowReroute(board.getSelectedStrokesArray().map((s) => s.id));

        board.requestRedraw();
}

export function finishLassoDrag(board) {
        if (!board.isDraggingLasso) return;

        const moved = board.lassoDragMoved;
        board.isDraggingLasso = false;
        board.lassoDragStart = null;
        board.lassoDragMoved = false;
        board.lassoHistoryPushed = false;
        if (moved) board.scheduleSave();
}

export function renderLassoOverlay(board) {
        if (!board.ctx || !board.canvas) return;

        // Dashed blue rectangle marquee while dragging
        if (board.isBoxSelecting && board.boxSelectStart && board.boxSelectCurrent) {
            const x0 = Math.min(board.boxSelectStart.x, board.boxSelectCurrent.x);
            const y0 = Math.min(board.boxSelectStart.y, board.boxSelectCurrent.y);
            const x1 = Math.max(board.boxSelectStart.x, board.boxSelectCurrent.x);
            const y1 = Math.max(board.boxSelectStart.y, board.boxSelectCurrent.y);

            board.ctx.save();
            board.ctx.strokeStyle = 'rgba(59, 130, 246, 0.8)';
            board.ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
            board.ctx.lineWidth = 1.5;
            board.ctx.setLineDash([4, 2]);
            board.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            board.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
            board.ctx.restore();
        }

        // Selection bounding box + resize handles. The frame only makes sense for
        // pointer/lasso selection — the eraser is destructive and a leftover
        // frame over the eraser stroke is the ghost users reported.
        const selectionToolActive = board.activeTool === 'pointer'
            || board.activeTool === 'crop' || board.isLassoActive;
        if (board.selectedStrokes.size > 0 && selectionToolActive) {
            const bounds = getStrokesBounds(board.getSelectedStrokesArray());
            board.ctx.save();
            board.ctx.strokeStyle = '#3b82f6';
            board.ctx.fillStyle = 'rgba(59, 130, 246, 0.1)';
            board.ctx.lineWidth = 1.5;
            board.ctx.setLineDash([4, 2]);
            board.ctx.strokeRect(bounds.minX, bounds.minY, bounds.width, bounds.height);
            board.ctx.setLineDash([]);
            board.ctx.restore();

            // Center move handle
            const centerX = bounds.minX + bounds.width / 2;
            const centerY = bounds.minY + bounds.height / 2;
            board.ctx.save();
            board.ctx.fillStyle = '#3b82f6';
            board.ctx.beginPath();
            board.ctx.arc(centerX, centerY, 6, 0, Math.PI * 2);
            board.ctx.fill();
            board.ctx.restore();

            // Corner/edge resize handles
            board.getResizeHandles(bounds).forEach((h) => {
                board.ctx.save();
                board.ctx.fillStyle = '#ffffff';
                board.ctx.strokeStyle = '#3b82f6';
                board.ctx.lineWidth = 1.5;
                board.ctx.fillRect(h.x - RESIZE_HANDLE_SIZE / 2, h.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
                board.ctx.strokeRect(h.x - RESIZE_HANDLE_SIZE / 2, h.y - RESIZE_HANDLE_SIZE / 2, RESIZE_HANDLE_SIZE, RESIZE_HANDLE_SIZE);
                board.ctx.restore();
            });
        }
}

export function getResizeHandles(board, bounds) {
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
}

export function hitResizeHandle(board, x, y) {
        if (board.selectedStrokes.size === 0) return null;
        const bounds = getStrokesBounds(board.getSelectedStrokesArray());
        const handles = board.getResizeHandles(bounds);
        for (const h of handles) {
            if (Math.abs(x - h.x) <= RESIZE_HANDLE_HIT / 2 && Math.abs(y - h.y) <= RESIZE_HANDLE_HIT / 2) {
                return h;
            }
        }
        return null;
}

export function startResize(board, handle, x, y) {
        const selected = board.getSelectedStrokesArray();
        if (!selected.length) return;
        const bounds = getStrokesBounds(selected);
        board.pushLayerHistory();
        board.resizeHandle = handle.id;
        board.resizeStart = {
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
}

export function applyResize(board, x, y) {
        if (!board.resizeHandle || !board.resizeStart) return;
        const start = board.resizeStart.bounds;
        const handle = board.resizeHandle;
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

        for (const snap of board.resizeStart.items) {
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

        const dims = getPageDimensions(board.doc);
        const pageBounds = getPageBounds(board.doc, dims);
        clampStrokesToBounds(board.getSelectedStrokesArray(), pageBounds);

        board.flowReroute(board.resizeStart.items.map((s) => s.ref?.id));

        board.redraw();
}

export function finishResize(board) {
        if (!board.resizeHandle) return;
        board.resizeHandle = null;
        board.resizeStart = null;
        board.scheduleSave();
}

export function updateHoverCursor(board, x, y) {
        if (!board.canvas) return;
        let next = '';
        const cropBox = board.cropState?.box;
        if (cropBox && (board.activeTool === 'crop' || !board.selectedStrokes.size)) {
            const handle = board.hitCropHandle(x, y);
            if (handle) {
                board.hoverHandle = null;
                next = handle.cursor;
            } else if (board.isPointInCropBox(x, y)) {
                board.hoverHandle = null;
                next = 'move';
            } else {
                board.hoverHandle = null;
                next = '';
            }
        } else if (board.selectedStrokes.size > 0) {
            const handle = board.hitResizeHandle(x, y);
            if (handle) {
                board.hoverHandle = handle.id;
                next = handle.cursor;
            } else {
                const bounds = getStrokesBounds(board.getSelectedStrokesArray());
                if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
                    board.hoverHandle = null;
                    next = 'move';
                } else {
                    board.hoverHandle = null;
                    next = '';
                }
            }
        } else {
            board.hoverHandle = null;
            next = '';
        }
        if (board.lastHoverCursor === next) return;
        board.lastHoverCursor = next;
        board.canvas.style.cursor = next;
}
