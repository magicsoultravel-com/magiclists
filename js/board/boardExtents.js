import { getGridMetrics } from '../gridDensity.js';
import { getCanvasColGap, CANVAS_LAYOUT_ORIGIN } from '../tileGeometry.js';
import {
    GRID_LAYOUT_KEY,
    FREEFORM_POSITIONS_KEY,
    FREEFORM_SIZES_KEY
} from './layoutKeys.js';
import { readNoteRect } from './noteGeometry.js';
import { DesktopManager } from '../desktopManager.js';
import { SIDEBAR_DEFAULT_WIDTH, readSidebarWidth, readPanelCollapsed } from '../sidebarPrefs.js';

export const DESKTOP_BOARD_PANE_CLASS = 'desktop-board-pane';

const boardExtentsFrames = new WeakMap();

// Stable layout width independent of the live canvas width (sidebar resizing).
// Captured once so packW doesn't shift when the sidebar is resized, which
// would otherwise re-pack saved cards on every render. Reset when the board
// area itself changes (sidebar collapse/expand, dock change, window resize,
// committed sidebar drag) so placements follow the visible board edge.
let stableLayoutWidth = null;

export function getStableBoardLayoutWidth() {
    if (stableLayoutWidth != null) return stableLayoutWidth;
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1280;

    // The board packing width must match the *visible* board area. The sidebar
    // collapses to 0px (and is expanded by default), so subtracting the fixed
    // default width unconditionally would leave an invisible wall — a deadband
    // on the right of the board where notes can't be placed or expanded.
    // A detached panel floats above the board (position: fixed) and consumes no
    // flex width, so it must count as a 0px footprint just like collapsed.
    // Reflect the real sidebar footprint: 0px when collapsed or detached,
    // otherwise the persisted custom width (or the default).
    let sidebarWidth = 0;
    const sidebarEl = typeof document !== 'undefined' ? document.getElementById('side-panel') : null;
    const isSidebarCollapsed = sidebarEl
        ? sidebarEl.classList.contains('is-collapsed')
        : readPanelCollapsed();
    const isSidebarDetached = sidebarEl
        ? sidebarEl.classList.contains('is-detached')
        : false;
    if (!isSidebarCollapsed && !isSidebarDetached) {
        sidebarWidth = readSidebarWidth() ?? SIDEBAR_DEFAULT_WIDTH;
    }

    stableLayoutWidth = Math.max(320, viewportW - sidebarWidth);
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

/** Floor for a measured page height so vertical packing always has a row. */
const MIN_LIVE_VIEWPORT_H = 200;

/**
 * Measure the board box the user can actually see, in layout pixels.
 *
 * `#app-canvas` is transformed by the desktop zoom and clipped by
 * `.desktop-surface` (overflow-x: hidden), so the usable board is the
 * intersection of the two on-screen boxes divided by the real transform scale.
 * That is deliberately not `window.innerWidth - sidebar`: this version follows
 * zoom, canvas scroll, the file cabinet and the sidebar's current state.
 *
 * Returns zeros when there is no layout engine (unit tests, detached canvas);
 * callers fall back to the stable layout width in that case.
 */
export function readVisibleBoardBox(canvas) {
    const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
    const rect = typeof canvas?.getBoundingClientRect === 'function' ? canvas.getBoundingClientRect() : null;
    const hasRect = !!rect && rect.width > 0 && rect.height > 0;

    if (!hasRect) {
        return {
            width: canvas?.clientWidth > 0 ? canvas.clientWidth / zoom : 0,
            height: canvas?.clientHeight > 0 ? canvas.clientHeight / zoom : 0,
            scale: zoom
        };
    }

    let width = rect.width;
    let height = rect.height;
    const surfaceRect = typeof document !== 'undefined'
        ? document.getElementById('desktop-surface')?.getBoundingClientRect?.() ?? null
        : null;
    if (surfaceRect && surfaceRect.width > 0 && surfaceRect.height > 0) {
        width = Math.max(0, Math.min(rect.right, surfaceRect.right) - Math.max(rect.left, surfaceRect.left));
        height = Math.max(0, Math.min(rect.bottom, surfaceRect.bottom) - Math.max(rect.top, surfaceRect.top));
    }

    // The canvas box is the scaled page: rect.width / offsetWidth is the real
    // scale (works for every zoom level, independent of the CSS variable).
    const scale = canvas.offsetWidth > 0 ? rect.width / canvas.offsetWidth : zoom;
    const safeScale = scale > 0 ? scale : 1;
    return { width: width / safeScale, height: height / safeScale, scale: safeScale };
}

/**
 * Live, zoom-aware board bounds used by one-shot layout actions (sort / reset).
 * Unlike getGridBoardBounds (which uses a stable, default-sidebar width so
 * continuous renders don't re-pack), this measures the visible board box:
 * `packW` is what fits on screen right now (sidebar state, zoom, scroll and the
 * file cabinet included) and `viewportH` is the page height a vertical sort
 * fills before starting a new column.
 */
export function getLiveBoardBounds(canvas) {
    const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
    const { origin, edgePad, canvasGridW, columnMinInnerW } = getGridMetrics();
    const visible = readVisibleBoardBox(canvas);

    // Never exceed the stable layout width (a sidebar drag in progress would
    // otherwise shrink the page mid-action) and never drop below the grid's
    // minimum canvas width.
    const stableW = getStableBoardLayoutWidth() / zoom;
    const liveW = visible.width > 0 ? Math.min(visible.width, stableW) : stableW;
    const rawW = Math.max(liveW, canvasGridW + origin * 2);
    const packW = Math.max(columnMinInnerW, rawW - origin * 2 - edgePad * 2);

    const { maxBottom } = getBoardContentExtent(canvas);
    const viewportH = Math.max(
        MIN_LIVE_VIEWPORT_H,
        visible.height > 0
            ? visible.height
            : (typeof window !== 'undefined' ? window.innerHeight / zoom : 800)
    );
    const maxH = Math.max(viewportH, maxBottom + origin + getCanvasColGap());

    return { origin, edgePad, packW, maxH, viewportH, viewportW: rawW, zoom };
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