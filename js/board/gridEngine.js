import { getGridMetrics } from '../gridDensity.js';
import {
    resolveGridPushLayout,
    snapNotePosition,
    snapNoteRect
} from './noteGeometry.js';
import { getGridBoardBounds } from './boardExtents.js';

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
    const limitH = bounds.maxH;
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

    let resolvedActor = null;
    if (actorId && actorRect) {
        resolvedActor = snapNotePosition(actorRect, {
            maxW: packW,
            maxH: limitH,
            origin,
            edgePad
        });
    }

    return resolveGridPushLayout({
        cardEntries,
        actorId,
        actorRect: resolvedActor,
        pinnedIds,
        packW,
        origin,
        maxH: limitH,
        edgePad
    });
}

export function computeGridBoardLayout(deps, canvas, actorId, actorRect = null, { maxH } = {}) {
    if (!canvas?.classList.contains('view-grid')) return new Map();
    const { origin, packW, maxH: boardMaxH, edgePad } = deps.getGridBoardBounds(canvas);
    return computeSnapPanelLayout(deps, {
        panelEl: canvas,
        cardSelector: '.mini-card[data-desktop="1"]',
        getSavedRect: (id) => deps.getGridLayout()[id],
        rectForCard: (card, saved, isExpanded) => deps.gridBoardRectForCard(card, saved, isExpanded),
        isCardExpanded: (id) => deps.isSavedLayoutExpanded(id),
        actorId,
        actorRect,
        bounds: { origin, packW, maxH: maxH ?? boardMaxH, edgePad }
    });
}

export function applyGridBoardLayout(deps, canvas, layout, { animate = true, save = true, preview = false } = {}) {
    if (!canvas || !layout?.size) return [];
    const placed = [];
    layout.forEach((rect, id) => {
        const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
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
    let actorRect = explicitActorRect;
    if (!actorRect && actorId) {
        const actorCard = canvas.querySelector(
            `.mini-card[data-desktop="1"][data-id="${CSS.escape(actorId)}"]`
        );
        if (actorCard) actorRect = deps.readNoteRect(actorCard);
    }
    const layout = computeGridBoardLayout(deps, canvas, actorId, actorRect);
    applyGridBoardLayout(deps, canvas, layout, { animate, save: true });
}

export { getGridBoardBounds };
