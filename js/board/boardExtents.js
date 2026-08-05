import { getGridMetrics } from '../gridDensity.js';
import { getCanvasColGap, CANVAS_LAYOUT_ORIGIN } from '../tileGeometry.js';
import {
    GRID_LAYOUT_KEY,
    FREEFORM_POSITIONS_KEY,
    FREEFORM_SIZES_KEY
} from './layoutKeys.js';
import { readNoteRect } from './noteGeometry.js';
import { DesktopManager } from '../desktopManager.js';
import { SIDEBAR_DEFAULT_WIDTH } from '../sidebarPrefs.js';

export const DESKTOP_BOARD_PANE_CLASS = 'desktop-board-pane';

const boardExtentsFrames = new WeakMap();

// Stable layout width independent of the live canvas width (sidebar resizing).
// Captured once so packW doesn't shift when the sidebar is resized, which
// would otherwise re-pack saved cards on every render.
let stableLayoutWidth = null;

export function getStableBoardLayoutWidth() {
    if (stableLayoutWidth != null) return stableLayoutWidth;
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;
    stableLayoutWidth = Math.max(320, viewportW - SIDEBAR_DEFAULT_WIDTH);
    return stableLayoutWidth;
}

export function resetStableBoardLayoutWidth() {
    stableLayoutWidth = null;
}

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
    const activeDesktop = DesktopManager.getActiveDesktop();
    const cards = canvas?.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`);
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
    const stableW = getStableBoardLayoutWidth() / zoom;
    const rawW = Math.max(stableW, canvasGridW + origin * 2);
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
    const activeDesktop = DesktopManager.getActiveDesktop();
    const cards = [...canvas.querySelectorAll(`:scope > .mini-card[data-desktop="${activeDesktop}"]`)];
    canvas.appendChild(pane);
    cards.forEach((card) => pane.appendChild(card));
    return pane;
}

// DISABLED: These functions were overriding CSS layout with inline styles
export function updateDesktopScrollPolicy(canvas) {
    // if (!canvas?.classList.contains('view-grid') && !canvas?.classList.contains('view-freeform')) return;
    // canvas.style.overflow = 'auto';
    // canvas.style.overflowY = '';
    // canvas.style.overflowX = '';
}

// Re-enabled with protective boundary check to prevent layout thrashing
export function updateBoardCanvasExtents(canvas, { readCardRect = readNoteRect, getOrigin = null } = {}) {
    if (!canvas) return;
    const isSpatial = canvas.classList.contains('view-grid') || canvas.classList.contains('view-freeform');
    if (!isSpatial) return;

    // Prevent recursive calls during requestAnimationFrame(reflowGridBoard())
    if (canvas.dataset._extentsUpdating === 'true') return;
    canvas.dataset._extentsUpdating = 'true';

    // Use requestAnimationFrame to ensure we don't cause layout thrashing
    requestAnimationFrame(() => {
        // Double-check canvas still exists and has content
        if (!canvas || !canvas.isConnected) {
            delete canvas.dataset._extentsUpdating;
            return;
        }

        const activeDesktop = DesktopManager.getActiveDesktop();
        const cards = canvas.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`);
        const pane = getDesktopBoardPane(canvas);
        if (!cards.length) {
            if (pane) {
                pane.style.minHeight = '';
                pane.style.minWidth = '';
            }
            delete canvas.dataset._extentsUpdating;
            return;
        }

        const boardPane = pane || ensureDesktopBoardPane(canvas);
        if (!boardPane) {
            delete canvas.dataset._extentsUpdating;
            return;
        }

        // We no longer resize the boardPane based on content to prevent the positive feedback loop.
        // The container (.desktop-surface) handles scrolling, and #app-canvas is allowed to overflow.
        updateDesktopScrollPolicy(canvas);

        // Clear the flag after update
        delete canvas.dataset._extentsUpdating;
    });
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