/** @module {"owns":"grid board layout engine, push resolution", "related":["board/noteGeometry.js","layoutStorage.js","gridDensity.js"]} */
import { getGridMetrics } from '../gridDensity.js';
import { resolveGridPushLayout } from './noteGeometry.js';
import { getGridBoardBounds } from './boardExtents.js';
import { DesktopManager } from '../desktopManager.js';

/**
 * @typedef {object} GridEngineDeps
 * @property {function(HTMLElement): object} getGridBoardBounds
 * @property {function(): object} getGridLayout
 * @property {function(string, object): void} saveGridLayout
 * @property {function(): string[]} getBoardPins
 * @property {function(HTMLElement, object, boolean): object} gridBoardRectForCard
 * @property {function(string): boolean} isSavedLayoutExpanded
 * @property {function(HTMLElement): object} readNoteRect
 * @property {function(HTMLElement, object, object=): void} applyNoteRect
 * @property {function(HTMLElement, object=): void} finalizeDesktopCard
 * @property {function(HTMLElement): void} scheduleBoardCanvasExtents
 */

export function clearSnapPanelPreview(panelEl) {
    panelEl?.querySelectorAll('.mini-card.layout-preview').forEach((c) => {
        c.classList.remove('layout-preview');
    });
}

export function computeSnapPanelLayout(deps, {
    panelEl,
    cardSelector,
    getSavedRect,
    rectForCard,
    isCardExpanded,
    actorId,
    actorRect,
    bounds
}) {
    const origin = bounds.origin ?? 0;
    const packW = bounds.packW;
    const limitH = bounds.maxH ?? Infinity;
    const edgePad = bounds.edgePad ?? getGridMetrics().edgePad;
    const cards = [...panelEl.querySelectorAll(cardSelector)];
    const pinnedIds = new Set(deps.getBoardPins());

    const cardEntries = cards.map((card) => {
        const id = card.dataset.id;
        const isExpanded = isCardExpanded(id, card);
        const saved = getSavedRect(id);
        const source = id === actorId && actorRect ? actorRect : (saved || deps.readNoteRect(card));
        const rect = rectForCard(card, source, isExpanded);
        return { id, card, rect };
    });

    return resolveGridPushLayout({
        cardEntries,
        actorId,
        actorRect,
        pinnedIds,
        packW,
        origin,
        maxH: limitH,
        edgePad
    });
}

export function computeGridBoardLayout(deps, canvas, actorId, actorRect = null) {
    if (!canvas?.classList.contains('view-grid')) return new Map();
    const { origin, packW, edgePad } = deps.getGridBoardBounds(canvas);
    const activeDesktop = DesktopManager.getActiveDesktop();
    return computeSnapPanelLayout(deps, {
        panelEl: canvas,
        cardSelector: `.mini-card[data-desktop="${activeDesktop}"]`,
        getSavedRect: (id) => deps.getGridLayout()[id],
        rectForCard: (card, saved, isExpanded) => deps.gridBoardRectForCard(card, saved, isExpanded),
        isCardExpanded: (id) => deps.isSavedLayoutExpanded(id),
        actorId,
        actorRect,
        bounds: { origin, packW, maxH: Infinity, edgePad }
    });
}

export function applyGridBoardLayout(deps, canvas, layout, { animate = true, save = true, preview = false } = {}) {
    if (!canvas || !layout?.size) return [];
    const placed = [];
    const activeDesktop = DesktopManager.getActiveDesktop();
    layout.forEach((rect, id) => {
        const card = canvas.querySelector(`.mini-card[data-desktop="${activeDesktop}"][data-id="${CSS.escape(id)}"]`);
        if (!card) return;
        deps.applyNoteRect(card, rect, { settling: animate });
        card.classList.toggle('layout-preview', preview);
        if (save) {
            deps.saveGridLayout(id, rect);
        }
        deps.finalizeDesktopCard(card);
        placed.push(rect);
    });
    deps.scheduleBoardCanvasExtents(canvas);
    if (animate && !preview) {
        window.setTimeout(() => {
            canvas.querySelectorAll('.mini-card.layout-settling').forEach((c) => {
                c.classList.remove('layout-settling');
            });
        }, 160);
    }
    return placed;
}

export function reflowGridBoard(deps, canvas, actorId, { animate = true, actorRect: explicitActorRect = null } = {}) {
    if (!canvas?.classList.contains('view-grid')) return;
    // A reflow without an actor is a "settle" pass (initial render, sort, etc.).
    // Running the push-resolution engine here would re-pack every card and
    // re-save, clobbering the user's saved positions on reload. Only update
    // extents/scroll policy — never re-pack or re-save.
    if (!actorId) {
        deps.scheduleBoardCanvasExtents(canvas);
        return;
    }
    let actorRect = explicitActorRect;
    if (!actorRect && actorId) {
        const activeDesktop = DesktopManager.getActiveDesktop();
        const actorCard = canvas.querySelector(
            `.mini-card[data-desktop="${activeDesktop}"][data-id="${CSS.escape(actorId)}"]`
        );
        if (actorCard) actorRect = deps.readNoteRect(actorCard);
    }
    const layout = computeGridBoardLayout(deps, canvas, actorId, actorRect);
    applyGridBoardLayout(deps, canvas, layout, { animate, save: true });
}

/**
 * Pure layout calculation for board items - computes rects without DOM manipulation.
 * @param {object} deps - Dependency object with layout functions
 * @param {Array} items - Items to layout
 * @param {object} bounds - Grid bounds { origin, packW, maxH, edgePad }
 * @param {function} getLayout - Function to get current layout
 * @param {function} isExpanded - Function to check if item is expanded
 * @param {function} resolveSpatialSize - Function to resolve remembered spatial size
 * @param {function} getTileDefaultRect - Function to get tile default rect
 * @param {function} resolveTileSize - Function to resolve tile size
 * @param {function} findSlot - Function to find first canvas slot
 * @param {function} snapRect - Function to snap rect to grid
 * @returns {object} { layout: object, placed: rect[], placedById: Map<itemId, rect> }
 */
export function computeBoardLayout(deps, items, bounds, {
    getLayout,
    isExpanded,
    resolveSpatialSize,
    getTileDefaultRect,
    resolveTileSize,
    findSlot,
    snapRect,
    clampRect
}) {
    const { origin, packW, maxH, edgePad } = bounds;
    const layout = getLayout();
    const placed = [];
    const placedById = new Map();

    const sortedItems = [...items].sort((a, b) => {
        const sa = layout[a.id];
        const sb = layout[b.id];
        const ay = sa?.y ?? Number.POSITIVE_INFINITY;
        const ax = sa?.x ?? Number.POSITIVE_INFINITY;
        const by = sb?.y ?? Number.POSITIVE_INFINITY;
        const bx = sb?.x ?? Number.POSITIVE_INFINITY;
        return ay - by || ax - bx;
    });

    sortedItems.forEach((item) => {
        const isLayoutExpanded = isExpanded(item.id);
        const saved = layout[item.id];
        let rect;

        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.w)) {
            // Use saved layout position VERBATIM — only clamp to board bounds,
            // never re-snap to the placement stride. This preserves the user's
            // exact placement across renders, desktop switches, and reloads.
            const cardRect = { x: saved.x, y: saved.y, w: saved.w, h: saved.h };
            rect = clampRect
                ? clampRect(cardRect, { packW, maxH, origin, edgePad })
                : snapRect(cardRect, { maxW: packW, maxH, origin, edgePad, itemId: item.id });
        } else {
            // Calculate new position — only unsaved cards are auto-placed
            // against the current packing width.
            const tileDefaults = getTileDefaultRect(resolveTileSize(item));
            let w = tileDefaults.w;
            let h = tileDefaults.h;

            if (isLayoutExpanded) {
                const target = resolveSpatialSize(null, item);
                w = target.w;
                h = target.h;
            }

            rect = findSlot(w, h, placed, packW + origin * 2, { origin, edgePad });
        }

        placed.push(rect);
        if (item.id) placedById.set(item.id, rect);
    });

    return { layout, placed, placedById };
}

export { getGridBoardBounds };