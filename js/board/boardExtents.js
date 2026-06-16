import { getGridMetrics } from '../gridDensity.js';
import { getCanvasColGap, CANVAS_LAYOUT_ORIGIN } from '../tileGeometry.js';
import {
    GRID_LAYOUT_KEY,
    FREEFORM_POSITIONS_KEY,
    FREEFORM_SIZES_KEY
} from './layoutKeys.js';
import { readNoteRect } from './noteGeometry.js';

export const DESKTOP_BOARD_PANE_CLASS = 'desktop-board-pane';

const boardExtentsFrames = new WeakMap();

function readStorageLayoutExtent() {
    let maxBottom = 0;
    let maxRight = 0;

    try {
        const grid = JSON.parse(localStorage.getItem(GRID_LAYOUT_KEY) || '{}');
        Object.values(grid).forEach((entry) => {
            if (!entry || !Number.isFinite(entry.y) || !Number.isFinite(entry.h)) return;
            maxBottom = Math.max(maxBottom, entry.y + entry.h);
            if (Number.isFinite(entry.x) && Number.isFinite(entry.w)) {
                maxRight = Math.max(maxRight, entry.x + entry.w);
            }
        });
    } catch { /* ignore */ }

    try {
        const positions = JSON.parse(localStorage.getItem(FREEFORM_POSITIONS_KEY) || '{}');
        const sizes = JSON.parse(localStorage.getItem(FREEFORM_SIZES_KEY) || '{}');
        Object.entries(positions).forEach(([id, pos]) => {
            if (!pos || !Number.isFinite(pos.y)) return;
            const size = sizes[id];
            const h = size?.h ?? 0;
            const w = size?.w ?? 0;
            if (Number.isFinite(h)) maxBottom = Math.max(maxBottom, pos.y + h);
            if (Number.isFinite(pos.x) && Number.isFinite(w)) {
                maxRight = Math.max(maxRight, pos.x + w);
            }
        });
    } catch { /* ignore */ }

    return { maxBottom, maxRight };
}

export function getBoardContentExtent(canvas) {
    const cards = canvas?.querySelectorAll('.mini-card[data-desktop="1"]');
    if (cards?.length) {
        let maxBottom = 0;
        let maxRight = 0;
        [...cards].forEach((card) => {
            const r = readNoteRect(card);
            maxBottom = Math.max(maxBottom, r.y + r.h);
            maxRight = Math.max(maxRight, r.x + r.w);
        });
        return { maxBottom, maxRight };
    }
    return readStorageLayoutExtent();
}

export function getGridBoardBounds(canvas) {
    const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
    const { origin, edgePad, canvasGridW, columnMinInnerW } = getGridMetrics();
    const rawW = Math.max((canvas?.clientWidth || 320) / zoom, canvasGridW + origin * 2);
    const packW = Math.max(columnMinInnerW, rawW - origin * 2 - edgePad * 2);

    const viewportMinH = Math.max(
        (canvas?.clientHeight || 0) / zoom,
        typeof window !== 'undefined' ? window.innerHeight / zoom : 800
    );
    const { maxBottom } = getBoardContentExtent(canvas);
    const maxH = Math.max(viewportMinH, maxBottom + origin + getCanvasColGap());

    return { origin, edgePad, packW, maxH, canvasW: rawW };
}

export function getGridViewportBounds(canvas) {
    const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
    const pad = 24;
    const { origin, packW, edgePad } = getGridBoardBounds(canvas);
    const viewportH = Math.max(200, (canvas.clientHeight || 400) / zoom - pad);
    const scrollY = (canvas?.scrollTop || 0) / zoom;
    const viewportBottom = origin + scrollY + viewportH;
    return { origin, packW, viewportH, edgePad, scrollY, viewportBottom };
}

export function getDesktopBoardPane(canvas) {
    return canvas?.querySelector(`:scope > .${DESKTOP_BOARD_PANE_CLASS}`) ?? null;
}

export function ensureDesktopBoardPane(canvas) {
    if (!canvas) return null;
    let pane = getDesktopBoardPane(canvas);
    if (pane) return pane;
    pane = document.createElement('div');
    pane.className = DESKTOP_BOARD_PANE_CLASS;
    const cards = [...canvas.querySelectorAll(':scope > .mini-card[data-desktop="1"]')];
    canvas.appendChild(pane);
    cards.forEach((card) => pane.appendChild(card));
    return pane;
}

export function updateDesktopScrollPolicy(canvas) {
    if (!canvas?.classList.contains('view-grid') && !canvas?.classList.contains('view-freeform')) return;
    canvas.style.overflow = 'auto';
    canvas.style.overflowY = '';
    canvas.style.overflowX = '';
}

export function updateBoardCanvasExtents(canvas, { readCardRect = readNoteRect, getOrigin = null } = {}) {
    if (!canvas) return;
    const isSpatial = canvas.classList.contains('view-grid') || canvas.classList.contains('view-freeform');
    if (!isSpatial) return;

    canvas.style.minHeight = '';
    canvas.style.minWidth = '';

    const cards = canvas.querySelectorAll('.mini-card[data-desktop="1"]');
    const pane = getDesktopBoardPane(canvas);
    if (!cards.length) {
        if (pane) {
            pane.style.minHeight = '';
            pane.style.minWidth = '';
        }
        return;
    }

    const boardPane = pane || ensureDesktopBoardPane(canvas);
    if (!boardPane) return;

    const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
    const origin = getOrigin
        ? getOrigin(canvas)
        : (canvas.classList.contains('view-grid')
            ? getGridBoardBounds(canvas).origin
            : CANVAS_LAYOUT_ORIGIN);
    const placed = [...cards].map((c) => readCardRect(c));
    const bottom = placed.reduce((m, r) => Math.max(m, r.y + r.h), 0);
    const right = placed.reduce((m, r) => Math.max(m, r.x + r.w), 0);
    boardPane.style.minHeight = `${bottom + origin + getCanvasColGap()}px`;
    const viewportW = (canvas.clientWidth || 320) / zoom;
    boardPane.style.minWidth = `${Math.max(viewportW, right + origin + getCanvasColGap())}px`;
    updateDesktopScrollPolicy(canvas);
}

export function scheduleBoardCanvasExtents(canvas, updateFn) {
    if (!canvas) return;
    if (boardExtentsFrames.has(canvas)) return;
    const frame = requestAnimationFrame(() => {
        boardExtentsFrames.delete(canvas);
        updateFn(canvas);
    });
    boardExtentsFrames.set(canvas, frame);
}
