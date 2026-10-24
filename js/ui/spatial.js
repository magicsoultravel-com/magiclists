/** @module {"owns":"spatial card geometry and chrome - rect resolution, expansion tiers, collapse/expand commits, the resize and toggle wiring, and the per-card update path; talks to storage through the facade and to the board lookup through boardState","related":["ui.js","ui/gridPack.js","ui/render.js","ui/boardState.js"]} */
import {
    ensureDesktopBoardPane as ensureDesktopBoardPaneCore,
    getDesktopBoardPane as getDesktopBoardPaneCore,
    getGridBoardBounds as getGridBoardBoundsCore,
    getGridViewportBounds,
    getLiveBoardBounds as getLiveBoardBoundsCore,
    scheduleBoardCanvasExtents as scheduleBoardCanvasExtentsCore,
    updateBoardCanvasExtents as updateBoardCanvasExtentsCore,
    updateDesktopScrollPolicy as updateDesktopScrollPolicyCore
} from '../board/boardExtents.js';
import {
    applyGridBoardLayout as applyGridBoardLayoutCore,
    clearSnapPanelPreview as clearSnapPanelPreviewCore,
    computeGridBoardLayout as computeGridBoardLayoutCore,
    reflowGridBoard as reflowGridBoardCore
} from '../board/gridEngine.js';
import { FREEFORM_POSITIONS_KEY, FREEFORM_SIZES_KEY, GRID_LAYOUT_KEY, GRID_PINS_KEY } from '../board/layoutKeys.js';
import {
    applyNoteRect as applyNoteRectCore,
    clampNoteToBoardEdges as clampNoteToBoardEdgesCore,
    findNearestGridSlot as findNearestGridSlotCore,
    readNoteRect as readNoteRectCore,
    rectsOverlap as rectsOverlapCore,
    snapNotePosition as snapNotePositionCore,
    snapNoteRect as snapNoteRectCore
} from '../board/noteGeometry.js';
import { BoardOperations } from '../boardOperations.js';
import { isBoardOverlayEnabled } from '../boardOverlay.js';
import { getCardRenderContext, readStoredCategories } from '../categories.js';
import { mountFloatChrome } from '../desktopFloatChrome.js';
import { DesktopManager, isDesktopCard } from '../desktopManager.js';
import { raiseDesktopElement, syncDesktopStackSeq } from '../desktopStack.js';
import {
    applyFileCabinetZoneToggle as applyFileCabinetZoneToggleCore,
    getFileCabinetToggleLabels,
    isFileCabinetActive,
    removeFromFileCabinetOrder,
    saveFiledCabinetLayout as saveFiledCabinetLayoutCore
} from '../fileCabinet.js';
import { cellsToSpanH as gridCellsToSpanH, cellsToSpanW as gridCellsToSpanW, getGridMetrics } from '../gridDensity.js';
import { CARD_ICONS } from '../icons.js';
import { NoteSurface } from '../noteSurface.js';
import {
    applyCardCategoryBand,
    applyItemCardTheme,
    refreshBoardEditorCard,
    renderBoardEditorCard
} from '../noteSurfaceHtml.js';
import { readTileSmallFootprint } from '../tileFootprint.js';
import {
    FREEFORM_DEFAULT_H,
    FREEFORM_DEFAULT_W,
    LEGACY_TILE_SIZE,
    cellsToSpanH as geoCellsToSpanH,
    cellsToSpanW as geoCellsToSpanW,
    clampSpatialSize as geoClampSpatialSize,
    getGridSnapMinH,
    getSmallRect,
    getTileDefaultRect as geoGetTileDefaultRect,
    inferTileTier as geoInferTileTier,
    isCollapsedSpatialSize,
    normalizeTileSize,
    readRememberedSize as geoReadRememberedSize,
    resolveExpandedDefaultRect as geoResolveExpandedDefaultRect,
    resolveSpatialFallbackRect as geoResolveSpatialFallbackRect,
    resolveTileSize,
    spanToCellsH as geoSpanToCellsH,
    spanToCellsW as geoSpanToCellsW
} from '../tileGeometry.js';
import { getBoardItem, readActiveBoardViewMode, setBoardItem, writeActiveBoardViewMode } from './boardState.js';
import { normalizeViewMode, persistViewSession, restoreViewSession } from '../viewSession.js';

import { sortItemsSpatially } from './gridPack.js';
function ensureSmallTile(item) {
    if (!NoteSurface.canEditInline() || resolveTileSize(item) === 'small') return;
    NoteSurface.mutateItem(item, (it) => { it.tileSize = 'small'; }, { preserveView: true, skipRerender: true });
    item.tileSize = 'small';
    setBoardItem(item);
}

export function updateBoardItemsMap(item) {
    setBoardItem(item);
}

export function resolveBoardItem(ui, itemId) {
    return getBoardItem(itemId);
}

export function getSavedLayoutRect(ui, card, item) {
    const id = item?.id || card?.dataset?.id;
    if (!id) return null;
    return ui.getGridLayout()[id] || null;
}

export function resolveRememberedSpatialSize(ui, saved, item) {
    const remembered = geoReadRememberedSize(saved);
    if (remembered) return remembered;
    return geoResolveExpandedDefaultRect(resolveTileSize(item), null);
}

export function resolveBoardExpandRect(ui, card, item) {
    const saved = ui.getSavedLayoutRect(card, item);
    const tileSize = resolveTileSize(item);
    const remembered = geoReadRememberedSize(saved);
    const size = remembered
        ? remembered
        : geoResolveExpandedDefaultRect(tileSize, null);
    const pos = ui.readNoteRect(card);
    return { x: pos.x, y: pos.y, w: size.w, h: size.h };
}

export function resolveBoardExpandPlacement(ui, card, item) {
    const sizeRect = ui.resolveBoardExpandRect(card, item);
    const canvas = card.closest('#app-canvas');
    return ui.findDesktopCenterSlot(sizeRect.w, sizeRect.h, canvas, 'grid', {
        excludeId: item.id
    });
}

export function mergeSpatialLayoutEntry(ui, prev, rect, tileSize = LEGACY_TILE_SIZE, {
    updateRemembered = false,
    rememberedW = null,
    rememberedH = null
} = {}) {
    const clamped = geoClampSpatialSize(rect.w, rect.h, tileSize);
    const entry = {
        w: Math.round(clamped.w),
        h: Math.round(clamped.h)
    };
    if (Number.isFinite(rect.x)) entry.x = Math.round(rect.x);
    if (Number.isFinite(rect.y)) entry.y = Math.round(rect.y);

    let rw = rememberedW;
    let rh = rememberedH;
    if (updateRemembered && !isCollapsedSpatialSize(entry.w, entry.h, tileSize)) {
        rw = entry.w;
        rh = entry.h;
    }
    if (!Number.isFinite(rw) || !Number.isFinite(rh)) {
        rw = prev?.rememberedW;
        rh = prev?.rememberedH;
    }
    if (Number.isFinite(rw) && Number.isFinite(rh) && !isCollapsedSpatialSize(rw, rh, tileSize)) {
        const mem = geoClampSpatialSize(rw, rh, tileSize);
        entry.rememberedW = Math.round(mem.w);
        entry.rememberedH = Math.round(mem.h);
    }
    if (isCollapsedSpatialSize(entry.w, entry.h, tileSize)) {
        const small = getSmallRect(readTileSmallFootprint());
        entry.w = small.w;
        entry.h = small.h;
    }
    return entry;
}

export function persistRememberedSpatialSize(ui, itemId, w, h, tileSize = LEGACY_TILE_SIZE) {
    if (!itemId || !Number.isFinite(w) || !Number.isFinite(h)) return;
    if (isCollapsedSpatialSize(w, h, tileSize)) return;
    const clamped = geoClampSpatialSize(w, h, tileSize);
    const layout = ui.getGridLayout();
    const prev = layout[itemId] || {};
    layout[itemId] = {
        ...prev,
        rememberedW: Math.round(clamped.w),
        rememberedH: Math.round(clamped.h)
    };
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
}

export function resolveCardRect(ui, card, item, { mode } = {}) {
    const pos = card ? ui.readNoteRect(card) : { x: 0, y: 0, w: 0, h: 0 };
    const saved = ui.getSavedLayoutRect(card, item);
    if (mode === 'small' || mode === 'label') {
        const small = getSmallRect(readTileSmallFootprint());
        return { x: pos.x, y: pos.y, w: small.w, h: small.h };
    }
    if (mode === 'editor' && saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
        return { x: pos.x, y: pos.y, w: saved.w, h: saved.h };
    }
    if (mode === 'remembered' || mode === 'toggleTarget' || mode === 'saved') {
        const size = mode === 'saved' && saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)
            ? geoClampSpatialSize(saved.w, saved.h, resolveTileSize(item))
            : ui.resolveRememberedSpatialSize(saved, item);
        return { x: pos.x, y: pos.y, w: size.w, h: size.h };
    }
    if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
        const size = geoClampSpatialSize(saved.w, saved.h, resolveTileSize(item));
        return { x: pos.x, y: pos.y, w: size.w, h: size.h };
    }
    const fallback = geoResolveSpatialFallbackRect(resolveTileSize(item));
    return { x: pos.x, y: pos.y, w: fallback.w, h: fallback.h };
}

export function isGridMultiCellSize(ui, w, h) {
    const { cellW } = getGridMetrics();
    return w > cellW + 2 || h > cellW + 2;
}

export function getCardTileSize(ui, card, item = null) {
    const resolved = item || ui.resolveBoardItem(card?.dataset?.id);
    return resolveTileSize(resolved);
}

export function applyCollapsedTileClasses(ui, card, tileSize) {
    card.classList.remove('tile-small', 'tile-large');
    const size = normalizeTileSize(tileSize);
    card.classList.add(size === 'small' ? 'tile-small' : 'tile-large');
}

export function isSpatiallyCollapsed(ui, card) {
    if (!card) return true;
    const { w, h } = ui.readNoteRect(card);
    const item = ui.resolveBoardItem(card?.dataset?.id);
    return isCollapsedSpatialSize(w, h, resolveTileSize(item));
}

export function isSavedLayoutExpanded(ui, itemId, footprint = readTileSmallFootprint()) {
    const saved = ui.getGridLayout()[itemId];
    if (!saved || !Number.isFinite(saved.w) || !Number.isFinite(saved.h)) return false;
    const item = ui.resolveBoardItem(itemId);
    return !isCollapsedSpatialSize(saved.w, saved.h, resolveTileSize(item), footprint);
}

export function syncSpatialCollapseState(ui, card, item, w, h) {
    if (!isDesktopCard(card)) return false;
    card.classList.add('note-surface');
    const atSmall = ui.isSpatiallyCollapsed(card);
    card.classList.toggle('spatial-at-small', atSmall);
    const resolvedItem = item || ui.resolveBoardItem(card?.dataset?.id);
    const tier = geoInferTileTier(w, h, resolveTileSize(resolvedItem));
    ui.applyCollapsedTileClasses(card, tier);
    return atSmall;
}

export function syncSpatialToggleButton(ui, card, atSmall) {
    if (!isDesktopCard(card)) return;
    const toggleBtn = card.querySelector('.card-act--toggle');
    if (!toggleBtn) return;
    if (atSmall === undefined) atSmall = ui.isSpatiallyCollapsed(card);
    const inFileCabinet = !!card.closest('#file-cabinet');
    let expandTitle;
    let lastIcon;
    if (isFileCabinetActive()) {
        const labels = getFileCabinetToggleLabels(inFileCabinet, atSmall);
        expandTitle = labels.title;
        lastIcon = labels.iconKey === 'expand' ? CARD_ICONS.expand : CARD_ICONS.collapse;
    } else {
        expandTitle = atSmall ? 'Expand' : 'Collapse to small';
        lastIcon = atSmall ? CARD_ICONS.expand : CARD_ICONS.collapse;
    }
    toggleBtn.innerHTML = lastIcon;
    toggleBtn.setAttribute('title', expandTitle);
    toggleBtn.setAttribute('aria-label', expandTitle);
}

export function bindBoardEditorFocusChrome(ui, card) {
    if (!isDesktopCard(card) || card.dataset.boardEditorFocusBound) return;
    card.dataset.boardEditorFocusBound = '1';
    card.addEventListener('focusin', (e) => {
        if (e.target.closest('.editor-note-shell .card-inline-edit')) {
            requestAnimationFrame(() => {
                card.classList.add('is-editing-inline');
                ui.syncSpatialChromeForEditing(card);
            });
        }
    });
    card.addEventListener('focusout', () => {
        requestAnimationFrame(() => {
            if (!card.querySelector('.editor-note-shell .card-inline-edit:focus')) {
                card.classList.remove('is-editing-inline');
                ui.syncSpatialChromeForEditing(card);
            }
        });
    });
}

export function saveTileLayoutFromCard(ui, card, item, rect, tileSize) {
    const id = item?.id || card.dataset.id;
    if (!id || !isDesktopCard(card)) return;
    const updateRemembered = !isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item));
    ui.saveGridLayout(id, rect, { updateRemembered });
}

export function saveSpatialLayoutFromResize(ui, card, item, tileSize) {
    if (!card || !item) return;
    const rect = ui.readNoteRect(card);
    ui.saveTileLayoutFromCard(card, item, rect, tileSize || resolveTileSize(item));
}

export function collapseSnapPanelCard(ui, card, item) {
    ui.finalizeDesktopCard(card);
}

export function commitSpatialRect(ui, card, item, rect, ctx = {}) {
    const tier = ctx.tier ?? (isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item)) ? 'small' : 'large');
    const normalizedTier = normalizeTileSize(tier);

    if (NoteSurface.canEditInline() && normalizedTier !== resolveTileSize(item)) {
        NoteSurface.mutateItem(item, (it) => {
            it.tileSize = normalizedTier;
        }, { preserveView: true, skipRerender: true });
        item.tileSize = normalizedTier;
        setBoardItem(item);
    }

    ui.applyNoteRect(card, rect, { settling: false });
    ui.saveTileLayoutFromCard(card, item, rect, normalizedTier);
    ui.finalizeDesktopCard(card, { skipSizeReapply: !!ctx.skipSizeReapply });
    const canvas = card.closest('#app-canvas');
    if (ctx.scheduleExtents) {
        ui.scheduleBoardCanvasExtents(canvas);
    }
    // Compose: expand-only + bento. Allow-overlap and collapse never push neighbors.
    if (canvas?.classList.contains('view-grid') && isBoardOverlayEnabled()) {
        if (!isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item))) {
            const reflowOpts = { animate: true };
            if (ctx.actorRect) reflowOpts.actorRect = ctx.actorRect;
            requestAnimationFrame(() => ui.reflowGridBoard(canvas, item.id, reflowOpts));
        }
    }
}

export function applyTileTierRect(ui, card, item, nextTier, rect, ctx = {}) {
    ui.commitSpatialRect(card, item, rect, { ...ctx, tier: nextTier });
}

export function applySpatialToggleRect(ui, card, item, rect, ctx = {}) {
    ui.commitSpatialRect(card, item, rect, { ...ctx, scheduleExtents: true, skipSizeReapply: true });
}

export function collapseSpatialAtCurrentPos(ui, card, item, ctx = {}) {
    const pos = ui.readNoteRect(card);
    ui.persistRememberedSpatialSize(item.id, pos.w, pos.h, resolveTileSize(item));
    const small = getSmallRect(readTileSmallFootprint());
    ui.applySpatialToggleRect(card, item, { x: pos.x, y: pos.y, w: small.w, h: small.h }, ctx);
}

export function collapseBoardCardToSmallFootprint(ui, card, item, ctx = {}) {
    if (!card || !item?.id || isFileCabinetActive() || ui.isSpatiallyCollapsed(card)) return;
    ui.collapseSpatialAtCurrentPos(card, item, ctx);
}

export function applyTileZoneToggle(ui, card, item, ctx = {}) {
    if (isFileCabinetActive()) {
        ui.applyFileCabinetZoneToggle(card, item, ctx);
        return;
    }

    if (ui.isSpatiallyCollapsed(card)) {
        removeFromFileCabinetOrder(item.id);
        // Use resolveBoardExpandRect to keep the current position and restore remembered size,
        // instead of resolveBoardExpandPlacement which placed the card at the viewport center.
        const rect = ui.resolveBoardExpandRect(card, item);
        ui.applySpatialToggleRect(card, item, rect, { ...ctx, actorRect: rect });
        ui.raiseDesktopCard(card);
        requestAnimationFrame(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    } else {
        ui.collapseSpatialAtCurrentPos(card, item, ctx);
    }
    const atSmall = ui.isSpatiallyCollapsed(card);
    ui.syncSpatialToggleButton(card, atSmall);
}

export function applyFileCabinetZoneToggle(ui, card, item, ctx = {}) {
    applyFileCabinetZoneToggleCore(card, item, ctx, ui);
}

export function reapplySmallFootprintOnBoard(ui) {
    const canvas = document.getElementById('app-canvas');
    if (!canvas) return;
    const footprint = readTileSmallFootprint();
    const smallRect = getSmallRect(footprint);
    const activeDesktop = DesktopManager.getActiveDesktop();
    canvas.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`).forEach((card) => {
        if (card.closest('#file-cabinet')) return;
        const item = ui.resolveBoardItem(card.dataset.id);
        if (!item) return;
        const rect = ui.readNoteRect(card);
        const wasSmall = isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item))
            || resolveTileSize(item) === 'small';
        if (!wasSmall) return;
        const next = { x: rect.x, y: rect.y, w: smallRect.w, h: smallRect.h };
        ui.applyNoteRect(card, next, { settling: false });
        ensureSmallTile(item);
        ui.saveTileLayoutFromCard(card, item, next, 'small');
        ui.finalizeDesktopCard(card);
    });
    ui.scheduleBoardCanvasExtents(canvas);
    requestAnimationFrame(() => ui.reflowGridBoard(canvas, null, { animate: true }));
    if (isFileCabinetActive()) {
        window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
    }
}

export function reapplyBoardMetricsOnBoard(ui, prevMetrics, nextMetrics) {
    const canvas = document.getElementById('app-canvas');
    if (!canvas) return;
    const footprint = readTileSmallFootprint();

    const migrateRect = (rect) => {
        if (!rect || !Number.isFinite(rect.w) || !Number.isFinite(rect.h)) return rect;
        const wCells = Math.max(1, Math.round((rect.w + prevMetrics.gap) / prevMetrics.strideX));
        const hCells = Math.max(1, Math.round((rect.h + prevMetrics.gap) / prevMetrics.strideY));
        const next = {
            w: gridCellsToSpanW(wCells, nextMetrics),
            h: gridCellsToSpanH(hCells, nextMetrics)
        };
        if (Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
            const xCells = Math.round((rect.x - prevMetrics.origin) / prevMetrics.strideX);
            const yCells = Math.round((rect.y - prevMetrics.origin) / prevMetrics.strideY);
            next.x = nextMetrics.origin + xCells * nextMetrics.strideX;
            next.y = nextMetrics.origin + yCells * nextMetrics.strideY;
        }
        return next;
    };

    canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
        if (card.closest('#file-cabinet')) return;
        const item = ui.resolveBoardItem(card.dataset.id);
        if (!item) return;
        let rect = migrateRect(ui.readNoteRect(card));
        const { packW, maxH, origin, edgePad } = ui.getGridBoardBounds(canvas);
        rect = ui.snapNoteRect(rect, { maxW: packW, maxH, origin, edgePad });
        ui.applyNoteRect(card, rect, { settling: false });
        ui.saveTileLayoutFromCard(card, item, rect, ui.getCardTileSize(card, item));
        ui.finalizeDesktopCard(card);
    });

    ui.scheduleBoardCanvasExtents(canvas);
    requestAnimationFrame(() => ui.reflowGridBoard(canvas, null, { animate: true }));
    if (isFileCabinetActive()) {
        window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
    }
}

export function clampNoteToBoardEdges(ui, rect, opts) {
    return clampNoteToBoardEdgesCore(rect, opts);
}

// Preserve a saved card's position VERBATIM — never clamp to packW/maxH.
// This allows cards saved beyond the visible width to overflow naturally,
// producing a horizontal scrollbar on zoom-in instead of being forced
// back inside the (shrinking) packing width.
export function preserveSavedBoardRect(ui, rect) {
    if (!rect) return rect;
    return {
        x: Math.max(0, rect.x),
        y: Math.max(0, rect.y),
        w: rect.w,
        h: rect.h
    };
}

export function gridBoardRectForCard(ui, card, savedRect, isExpanded, itemId = null) {
    // 1. Safely resolve the ID whether a card exists or the ID is passed directly
    const id = itemId || card?.dataset?.id;
    
    // 2. Safely resolve the base rect
    const base = savedRect && Number.isFinite(savedRect.x) && Number.isFinite(savedRect.w)
        ? { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h }
        : (card ? ui.readNoteRect(card) : { x: 0, y: 0, w: 0, h: 0 });

    if (isExpanded) {
        const item = ui.resolveBoardItem(id);
        const tileSize = ui.getCardTileSize(card, item);
        const expandedMin = geoResolveExpandedDefaultRect(tileSize, savedRect);
        if (base.w >= expandedMin.w && base.h >= expandedMin.h) return base;
        return {
            ...base,
            w: expandedMin.w,
            h: expandedMin.h
        };
    }
    
    const item = ui.resolveBoardItem(id);
    return ui.gridTileRect(ui.getCardTileSize(card, item), base, savedRect);
}

export function gridTileRect(ui, tileSize, base, saved) {
    if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
        if (isCollapsedSpatialSize(saved.w, saved.h, tileSize)) {
            const small = getSmallRect(readTileSmallFootprint());
            return { ...base, w: small.w, h: small.h };
        }
        const clamped = geoClampSpatialSize(saved.w, saved.h, tileSize);
        return { ...base, w: clamped.w, h: clamped.h };
    }
    const defaults = geoGetTileDefaultRect(tileSize);
    return { ...base, w: defaults.w, h: defaults.h };
}

export function syncCardDraggable(ui, card) {
    card.removeAttribute('draggable');
}

export function isGridBoardCard(ui, card) {
    return isDesktopCard(card);
}

export function updateSingleCard(ui, canvas, item, hiddenCategories = []) {
    if (!canvas || !item?.id) return false;
    const card = canvas.querySelector(`.mini-card[data-id="${item.id}"]`);
    if (!card) return false;

    // Keep the board lookup map on the same live item object AppState holds.
    updateBoardItemsMap(item);

    // Capture canvas scroll position before full re-render to prevent view jump
    const canvasScrollTop = canvas.scrollTop || 0;
    const canvasScrollLeft = canvas.scrollLeft || 0;

    let activeCategories = readStoredCategories()
        .filter((cat) => !hiddenCategories.includes(cat.name));
    const { targetCatName, categoryColor } = getCardRenderContext(item, activeCategories);

    const activeEdit = document.activeElement?.closest?.('.card-inline-edit');
    const isActivelyEditing = !!(activeEdit && card.contains(activeEdit));

    if (isActivelyEditing) {
        refreshBoardEditorCard(ui, card, item, activeCategories, targetCatName, categoryColor);
    } else {
        renderBoardEditorCard(ui, card, item, activeCategories, targetCatName, categoryColor);
    }
    applyItemCardTheme(card, item);
    applyCardCategoryBand(card, categoryColor);
    ui.finalizeDesktopCard(card);

    // Restore canvas scroll position after full re-render
    canvas.scrollTop = canvasScrollTop;
    canvas.scrollLeft = canvasScrollLeft;

    return true;
}

function createGridDeps(ui) {
    return {
        getGridBoardBounds,
        getGridLayout: () => ui.getGridLayout(),
        saveGridLayout: (id, rect, opts) => ui.saveGridLayout(id, rect, opts),
        getBoardPins: () => ui.getBoardPins(),
        gridBoardRectForCard: (card, saved, isExpanded) => ui.gridBoardRectForCard(card, saved, isExpanded),
        isSavedLayoutExpanded: (id) => ui.isSavedLayoutExpanded(id),
        readNoteRect: (card) => ui.readNoteRect(card),
        applyNoteRect: (card, rect, opts) => ui.applyNoteRect(card, rect, opts),
        finalizeDesktopCard: (card, opts) => ui.finalizeDesktopCard(card, opts),
        scheduleBoardCanvasExtents: (canvas) => ui.scheduleBoardCanvasExtents(canvas)
    };
}

function noteRectHooks(ui, card) {
    return {
        normalizeCollapsed: true,
        isActivelyResizing: ui.isCardActivelyResizing(card),
        getTileSize: (c) => resolveTileSize(ui.resolveBoardItem(c?.dataset?.id))
    };
}

export function flushAllInlineEditsFromCanvas(ui, canvas, items, { forceFlush = false, skipItemId = null, skipItemIds = null } = {}) {
    if (!canvas || !Array.isArray(items)) return;
    const byId = new Map(items.map((item) => [item.id, item]));
    const skip = new Set();
    if (skipItemId) skip.add(skipItemId);
    if (skipItemIds) {
        for (const id of skipItemIds) {
            if (id) skip.add(id);
        }
    }
    const activeDesktop = DesktopManager.getActiveDesktop();
    canvas.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`).forEach((card) => {
        const item = byId.get(card.dataset.id);
        if (!item) return;
        // While modal / Focus / popout owns this note, board card DOM is stale.
        if (skip.has(item.id)) return;
        NoteSurface.commitFocusedInlineField(card, item);
        // During view reset, force flush to ensure all pending changes are saved
        // even if there's a pending focus state that would otherwise skip
        if (!forceFlush && card.dataset.pendingFocusStepId) return;
        const shell = card.querySelector('.editor-note-shell');
        if (!shell) return;
        const beforeItem = NoteSurface.snapshotItem(item);
        NoteSurface.syncItemBodyFromDom(shell, item);
        if (JSON.stringify(beforeItem) !== JSON.stringify(NoteSurface.snapshotItem(item))) {
            NoteSurface.emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
        }
    });
}

export function persistViewSessionForMode(ui, mode, canvas = document.getElementById('app-canvas')) {
    persistViewSession(mode, {
        canvas,
        flushLayout: (c, m) => ui.flushLayoutFromCanvas(c, m)
    });
}

export function restoreViewSessionForMode(ui, mode) {
    restoreViewSession(mode);
}

export function setupFreeformChrome(ui, card) {
    const shell = card.querySelector('.editor-note-shell');
    mountFloatChrome(card, {
        resizable: true,
        mode: 'note',
        insertBefore: shell
    });
}

export function syncSpatialChromeForEditing(ui, card) {
    if (!card?.querySelector?.('.ff-chrome') || !isDesktopCard(card)) return;
    const layer = card.querySelector('.ff-resize-layer');
    const gutters = card.querySelectorAll('.ff-drag-gutter');
    const disableChrome = card.classList.contains('is-editing-inline');
    if (layer) {
        layer.style.pointerEvents = disableChrome ? 'none' : '';
        layer.style.zIndex = disableChrome ? '0' : '';
        layer.querySelectorAll('.ff-resize').forEach((handle) => {
            handle.style.pointerEvents = disableChrome ? 'none' : '';
            handle.style.zIndex = disableChrome ? '0' : '';
        });
    }
    gutters.forEach((g) => {
        g.style.pointerEvents = disableChrome ? 'none' : '';
    });
}

export function readFreeformCardSize(ui, card) {
    const { w, h } = ui.readNoteRect(card);
    return {
        w: Math.round(w) || FREEFORM_DEFAULT_W,
        h: Math.round(h) || FREEFORM_DEFAULT_H
    };
}

export function clearFreeformCustomSize(ui, itemId) {
    const sizes = ui.getFreeformSizes();
    if (!sizes[itemId]) return;
    delete sizes[itemId];
    localStorage.setItem(FREEFORM_SIZES_KEY, JSON.stringify(sizes));
}

export function applyFreeformDimensions(ui, card, w, h) {
    card.style.setProperty('width', `${w}px`, 'important');
    card.style.setProperty('height', `${h}px`, 'important');
    card.style.setProperty('min-width', `${w}px`, 'important');
    card.style.setProperty('max-width', `${w}px`, 'important');
    card.style.setProperty('min-height', `${h}px`, 'important');
    card.style.setProperty('max-height', `${h}px`, 'important');
}

export function isCardActivelyResizing(ui, card) {
    if (!card) return false;
    return card.classList.contains('is-tier-resizing')
        || card.classList.contains('is-freeform-resizing')
        || card.classList.contains('is-grid-resizing');
}

/** Canonical desktop card finalizer — syncs collapse classes, chrome, saved size, toggle label. */
export function finalizeDesktopCard(ui, card, { skipSizeReapply = false } = {}) {
    if (!isDesktopCard(card)) return;
    const item = ui.resolveBoardItem(card.dataset.id);
    ui.setupFreeformChrome(card);
    if (!skipSizeReapply) {
        ui.applyDesktopSize(card);
    }
    const { w, h } = ui.readNoteRect(card);
    const atSmall = ui.syncSpatialCollapseState(card, item, w, h);
    ui.syncSpatialChromeForEditing(card);
    ui.syncSpatialToggleButton(card, atSmall);
}

export function updateDesktopCard(ui, card, item, { dimensions = null } = {}) {
    if (!isDesktopCard(card)) return;

    const canvas = card.closest('#app-canvas');

    if (dimensions) {
        ui.applyFreeformDimensions(card, dimensions.w, dimensions.h);
    } else {
        ui.applyDesktopSize(card);
    }

    ui.finalizeDesktopCard(card);

    // Bento-only push; skip when Allow-overlap or spatially collapsed.
    if (canvas?.classList.contains('view-grid') && isBoardOverlayEnabled()) {
        const rect = ui.readNoteRect(card);
        if (!isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item))) {
            requestAnimationFrame(() => {
                ui.reflowGridBoard(canvas, item.id, { animate: true });
            });
        }
    }
}

export function focusPendingBoardField(ui, card) {
    const field = card?.dataset?.pendingFocusField;
    if (!field) return;
    delete card.dataset.pendingFocusField;
    requestAnimationFrame(() => {
        let el = null;
        if (field === 'content') {
            el = card.querySelector('.editor-note-body .card-inline-edit[data-field="content"]')
                || card.querySelector('.editor-note-body .card-inline-edit[data-field="step-text"]')
                || card.querySelector('.editor-note-header .card-inline-edit[data-field="title"]');
        } else {
            el = card.querySelector('.editor-note-header .card-inline-edit[data-field="title"]');
        }
        if (el) NoteSurface.focusInlineEdit(el, 'start');
    });
}

export function markNoteCollapsed(ui, itemId) {
    if (!itemId) return;
    const small = getSmallRect(readTileSmallFootprint());
    const item = ui.resolveBoardItem(itemId);
    const tileSize = resolveTileSize(item);
    const grid = ui.getGridLayout();
    if (grid[itemId]) {
        const prev = grid[itemId];
        grid[itemId] = ui.mergeSpatialLayoutEntry(prev, {
            x: prev.x,
            y: prev.y,
            w: small.w,
            h: small.h
        }, tileSize, { updateRemembered: false });
        localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(grid));
    }
    const sizes = ui.getFreeformSizes();
    if (sizes[itemId]) {
        const prev = sizes[itemId];
        sizes[itemId] = ui.mergeSpatialLayoutEntry(prev, { w: small.w, h: small.h }, tileSize, { updateRemembered: false });
        localStorage.setItem(FREEFORM_SIZES_KEY, JSON.stringify(sizes));
        const pos = ui.getFreeformPositions()[itemId];
        if (pos) ui.saveFreeformPosition(itemId, pos.x, pos.y);
    }
}

export function collapseBoardCardIfExpanded(ui, card, item, hiddenCategories = []) {
    if (!card || !item?.id) return;
    if (!ui.isSpatiallyCollapsed(card)) {
        ui.collapseBoardCardToSmallFootprint(card, item);
    }
}

export function getFreeformPositions(ui) {
    try {
        return JSON.parse(localStorage.getItem(FREEFORM_POSITIONS_KEY) || '{}');
    } catch {
        return {};
    }
}

export function saveFreeformPosition(ui, itemId, x, y) {
    const positions = ui.getFreeformPositions();
    positions[itemId] = { x: Math.round(x), y: Math.round(y) };
    localStorage.setItem(FREEFORM_POSITIONS_KEY, JSON.stringify(positions));
}

export function getFreeformSizes(ui) {
    try {
        return JSON.parse(localStorage.getItem(FREEFORM_SIZES_KEY) || '{}');
    } catch {
        return {};
    }
}

export function saveFreeformSize(ui, itemId, w, h, { updateRemembered = false } = {}) {
    const sizes = ui.getFreeformSizes();
    const prev = sizes[itemId] || {};
    const item = ui.resolveBoardItem(itemId);
    sizes[itemId] = ui.mergeSpatialLayoutEntry(prev, { w, h }, resolveTileSize(item), { updateRemembered });
    localStorage.setItem(FREEFORM_SIZES_KEY, JSON.stringify(sizes));
}

export function saveFreeformSizeFromCard(ui, card) {
    if (!isDesktopCard(card)) return;
    const { w, h } = ui.readFreeformCardSize(card);
    ui.saveFreeformSize(card.dataset.id, w, h, {
        updateRemembered: !isCollapsedSpatialSize(w, h, resolveTileSize(ui.resolveBoardItem(card.dataset.id)))
    });
}

export function flushLayoutFromCanvas(ui, canvas, _viewMode) {
    if (!canvas) return;
    const activeDesktop = DesktopManager.getActiveDesktop();
    canvas.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`).forEach((card) => {
        const id = card.dataset.id;
        if (!id) return;
        ui.saveGridLayout(id, ui.readNoteRect(card));
    });
}

export function migrateFreeformLayoutToGrid(ui, items) {
    const positions = ui.getFreeformPositions();
    const sizes = ui.getFreeformSizes();
    const hasFreeformData = Object.keys(positions).length > 0 || Object.keys(sizes).length > 0;
    if (!hasFreeformData) return false;

    const visible = BoardOperations.getVisibleItems(Array.isArray(items) ? items : []);
    const pinnedIds = new Set(ui.getBoardPins());
    const itemsById = new Map(visible.map((item) => [item.id, item]));
    const getSourceRect = (item) => {
        const freePos = positions[item?.id];
        const freeSaved = sizes[item?.id];
        if (freePos && freeSaved && Number.isFinite(freePos.x) && Number.isFinite(freeSaved.w)) {
            return { x: freePos.x, y: freePos.y, w: freeSaved.w, h: freeSaved.h };
        }
        const gridSaved = ui.getGridLayout()[item.id];
        if (gridSaved && Number.isFinite(gridSaved.x)) {
            return { ...gridSaved };
        }
        const metrics = getGridMetrics();
        return { x: metrics.origin + metrics.edgePad, y: metrics.origin + metrics.edgePad, w: 0, h: 0 };
    };
    const { collapsed, expanded } = ui.partitionCanvasItemsByExpansion(visible, 'grid');
    const canvas = document.getElementById('app-canvas');
    ui.packGridBoard(canvas, sortItemsSpatially(collapsed, getSourceRect), sortItemsSpatially(expanded, getSourceRect), {
        pinnedIds,
        layoutMode: 'freeform',
        direction: 'horizontal',
        persistOnly: true,
        animate: false,
        save: true,
        itemsById
    });

    try {
        localStorage.removeItem(FREEFORM_POSITIONS_KEY);
        localStorage.removeItem(FREEFORM_SIZES_KEY);
    } catch {
        /* ignore */
    }
    return true;
}

export function applyDesktopLayoutModeSwitch(ui, canvas) {
    if (!canvas) return;
    writeActiveBoardViewMode('grid');
    canvas.classList.add('view-grid');
    canvas.classList.remove('view-freeform');
    canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
        ui.finalizeDesktopCard(card);
    });
    ui.updateDesktopScrollPolicy(canvas);
    ui.updateBoardCanvasExtents(canvas);
}

export function convertDesktopLayoutForModeChange(ui, _canvas, _fromMode, _toMode, _items) {
    /* legacy no-op — freeform mode removed */
}

export function resolveFreeformSourceRect(ui, item, canvas) {
    const freePos = ui.getFreeformPositions()[item?.id];
    const freeSaved = ui.getFreeformSizes()[item?.id];
    const card = canvas?.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
    if (card) {
        const pos = ui.readNoteRect(card);
        const size = ui.readFreeformCardSize(card);
        return { x: pos.x, y: pos.y, w: size.w, h: size.h };
    }
    if (freePos && freeSaved && Number.isFinite(freePos.x) && Number.isFinite(freeSaved.w)) {
        return { x: freePos.x, y: freePos.y, w: freeSaved.w, h: freeSaved.h };
    }
    const gridSaved = ui.getGridLayout()[item.id];
    if (gridSaved && Number.isFinite(gridSaved.x)) {
        return { ...gridSaved };
    }
    const metrics = getGridMetrics();
    return { x: metrics.origin + metrics.edgePad, y: metrics.origin + metrics.edgePad, w: 0, h: 0 };
}

export function getGridLayout(ui) {
    try {
        return JSON.parse(localStorage.getItem(GRID_LAYOUT_KEY) || '{}');
    } catch {
        return {};
    }
}

export function saveGridLayout(ui, itemId, rect, { updateRemembered = false } = {}) {
    if (!itemId || !rect) return;
    const layout = ui.getGridLayout();
    const prev = layout[itemId] || {};
    const item = ui.resolveBoardItem(itemId);
    layout[itemId] = ui.mergeSpatialLayoutEntry(prev, rect, resolveTileSize(item), { updateRemembered });
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
}

export function saveFiledCabinetLayout(ui, itemId, rect, sortBy) {
    saveFiledCabinetLayoutCore(itemId, rect, sortBy);
}

export function saveCompactBoardLayout(ui, itemId, slot, _sortBy) {
    if (!itemId || !slot) return;
    const small = getSmallRect(readTileSmallFootprint());


    const rect = {
        x: Math.round(slot.x),
        y: Math.round(slot.y),
        w: small.w,
        h: small.h
    };

    const layout = ui.getGridLayout();
    const gridEntry = ui.mergeSpatialLayoutEntry({}, rect, 'small', { updateRemembered: false });
    delete gridEntry.customCompact;
    layout[itemId] = gridEntry;
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
}

export function removeGridLayout(ui, itemId) {
    const layout = ui.getGridLayout();
    if (!layout[itemId]) return;
    delete layout[itemId];
    localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
}

export function getBoardPins(ui) {
    try {
        const raw = JSON.parse(localStorage.getItem(GRID_PINS_KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
    } catch {
        return [];
    }
}

export function getGridPins(ui) {
    return ui.getBoardPins();
}

export function isBoardPinned(ui, itemId) {
    return !!itemId && ui.getBoardPins().includes(itemId);
}

export function isGridPinned(ui, itemId) {
    return ui.isBoardPinned(itemId);
}

export function toggleBoardPin(ui, itemId) {
    if (!itemId) return false;
    const pins = ui.getBoardPins();
    const idx = pins.indexOf(itemId);
    if (idx >= 0) {
        pins.splice(idx, 1);
    } else {
        pins.push(itemId);
    }
    localStorage.setItem(GRID_PINS_KEY, JSON.stringify(pins));
    return idx < 0;
}

export function toggleGridPin(ui, itemId) {
    return ui.toggleBoardPin(itemId);
}

export function getGridBoardBounds(ui, canvas) {
    return getGridBoardBoundsCore(canvas);
}

export function getLiveBoardBounds(ui, canvas) {
    return getLiveBoardBoundsCore(canvas);
}

export function getDesktopBoardPane(ui, canvas) {
    return getDesktopBoardPaneCore(canvas);
}

export function ensureDesktopBoardPane(ui, canvas) {
    return ensureDesktopBoardPaneCore(canvas);
}

export function scheduleBoardCanvasExtents(ui, canvas) {
    scheduleBoardCanvasExtentsCore(canvas, (c) => ui.updateBoardCanvasExtents(c));
}

export function updateBoardCanvasExtents(ui, canvas) {
    updateBoardCanvasExtentsCore(canvas, {
        readCardRect: (card) => readNoteRectCore(card, noteRectHooks(ui, card))
    });
}

export function updateDesktopScrollPolicy(ui, canvas) {
    updateDesktopScrollPolicyCore(canvas);
}

export function applyDesktopSize(ui, card) {
    if (!isDesktopCard(card)) return;
    if (card.dataset.tierResizePreview === '1') return;
    const saved = ui.getGridLayout()[card.dataset.id];
    const item = ui.resolveBoardItem(card.dataset.id);
    let w;
    let h;
    if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
        const tileSize = ui.getCardTileSize(card, item);
        const footprint = readTileSmallFootprint();
        if (isCollapsedSpatialSize(saved.w, saved.h, tileSize)) {
            const small = getSmallRect(footprint);
            w = small.w;
            h = small.h;
        } else {
            const clamped = geoClampSpatialSize(saved.w, saved.h, tileSize);
            w = clamped.w;
            h = clamped.h;
        }
    } else {
        const compact = ui.gridTileRect(
            ui.getCardTileSize(card, item),
            { x: 0, y: 0, w: getGridMetrics().cellW, h: getGridMetrics().cellH },
            saved
        );
        w = compact.w;
        h = compact.h;
    }
    ui.applyFreeformDimensions(card, w, h);
}

export function clampGridResize(ui, w, h, { packW } = {}) {
    const footprint = readTileSmallFootprint();
    const { cellW, canvasGridW } = getGridMetrics();
    const minW = cellW;
    const minH = getGridSnapMinH(footprint);
    const maxCellsW = Math.max(1, geoSpanToCellsW(packW || canvasGridW));

    if (isCollapsedSpatialSize(w, h)) {
        const small = getSmallRect(footprint);
        let wCells = Math.max(1, geoSpanToCellsW(Math.max(minW, small.w)));
        wCells = Math.min(wCells, maxCellsW);
        return {
            w: geoCellsToSpanW(wCells),
            h: small.h
        };
    }

    let wCells = Math.max(1, geoSpanToCellsW(Math.max(minW, w)));
    let hCells = Math.max(1, geoSpanToCellsH(Math.max(minH, h)));
    wCells = Math.min(wCells, maxCellsW);
    return {
        w: geoCellsToSpanW(wCells),
        h: geoCellsToSpanH(hCells)
    };
}

export function computeGridBoardLayout(ui, canvas, actorId, actorRect = null) {
    return computeGridBoardLayoutCore(createGridDeps(ui), canvas, actorId, actorRect);
}

export function clearSnapPanelPreview(ui, panelEl) {
    clearSnapPanelPreviewCore(panelEl);
}

export function applyGridBoardLayout(ui, canvas, layout, opts = {}) {
    return applyGridBoardLayoutCore(createGridDeps(ui), canvas, layout, opts);
}

export function clearGridLayoutPreview(ui, canvas) {
    clearSnapPanelPreviewCore(canvas);
}

export function findDesktopCenterSlot(ui, w, h, canvas, viewMode, { excludeId = null } = {}) {
    const host = canvas || document.getElementById('app-canvas');
    if (!host) return { x: 8, y: 8, w, h };
    const mode = viewMode || readActiveBoardViewMode();

    const { origin, packW, maxH, edgePad } = ui.getGridBoardBounds(host);
    const { viewportH, scrollY } = getGridViewportBounds(host);
    const activeDesktop = DesktopManager.getActiveDesktop();
    let rect = {
        x: origin + Math.max(0, (packW - w) / 2),
        y: origin + scrollY + Math.max(0, (viewportH - h) / 2),
        w,
        h
    };
    rect = ui.snapNoteRect(rect, { maxW: packW, maxH, origin, edgePad });
    const placed = [...host.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`)]
        .filter((c) => c.dataset.id !== excludeId && !c.closest('#file-cabinet'))
        .map((c) => ui.readNoteRect(c));
    if (placed.some((p) => rectsOverlapCore(rect, p))) {
        rect = findNearestGridSlotCore(rect, w, h, placed, { packW, origin, maxH, edgePad });
    }
    return rect;
}

export function updateGridScrollPolicy(ui, canvas, { forcing = false } = {}) {
    if (!canvas?.classList.contains('view-grid')) return;
    canvas.classList.toggle('is-grid-forcing', forcing);
    ui.scheduleBoardCanvasExtents(canvas);
    ui.updateDesktopScrollPolicy(canvas);
}

export function reflowGridBoard(ui, canvas, actorId, opts = {}) {
    reflowGridBoardCore(createGridDeps(ui), canvas, actorId, opts);
}

export function repackBoardLayoutStorage(ui, mode, items, canvas) {
    const resolvedMode = normalizeViewMode(mode);
    const small = getSmallRect(readTileSmallFootprint());
    const sorted = [...(items || [])].sort((a, b) => {
        const aTime = Number(a.created_at || a.updated_at || 0);
        const bTime = Number(b.created_at || b.updated_at || 0);
        return aTime - bTime;
    });
    const bounds = canvas ? ui.getLiveBoardBounds(canvas) : null;
    const metrics = getGridMetrics();
    const origin = bounds?.origin ?? metrics.origin;
    const packW = bounds?.packW ?? Math.max(metrics.canvasGridW, 640);
    const edgePad = bounds?.edgePad ?? metrics.edgePad;

    // Collapse every note to the small tile and lay them out on a strict,
    // zero-gap grid (adjacent tiles, no 8px re-snap) so all rows/columns
    // align with no spaces between them.
    const startX = origin + edgePad;
    const startY = origin + edgePad;
    const colStride = small.w;
    const rowStride = small.h;
    let col = 0;
    let row = 0;

    sorted.forEach((item) => {
        if (!item?.id) return;
        ensureSmallTile(item);

        let x = startX + col * colStride;
        let y = startY + row * rowStride;
        if (col > 0 && x + small.w > startX + packW) {
            col = 0;
            row += 1;
            x = startX;
            y = startY + row * rowStride;
        }

        ui.saveCompactBoardLayout(item.id, { x, y, w: small.w, h: small.h }, resolvedMode);
        col += 1;
    });
}

export function initDesktopCardStack(ui, card, orderIndex = 0) {
    if (!isDesktopCard(card)) return;
    const z = orderIndex + 1;
    card.style.setProperty('z-index', String(z), 'important');
    syncDesktopStackSeq(z);
}

export function raiseDesktopCard(ui, card) {
    if (!isDesktopCard(card)) return;
    raiseDesktopElement(card);
    const frontClass = 'is-grid-front';
    card.classList.add(frontClass);
    card.closest('#app-canvas')?.querySelectorAll(`.mini-card.${frontClass}`).forEach((other) => {
        if (other !== card) other.classList.remove(frontClass);
    });
}

export function snapNotePosition(ui, rect, opts) {
    return snapNotePositionCore(rect, opts);
}

export function snapNoteRect(ui, rect, opts) {
    return snapNoteRectCore(rect, opts);
}

export function readNoteRect(ui, card) {
    return readNoteRectCore(card, noteRectHooks(ui, card));
}

export function applyNoteRect(ui, card, rect, { settling = false } = {}) {
    applyNoteRectCore(card, rect, {
        settling,
        applyDimensions: (c, w, h) => ui.applyFreeformDimensions(c, w, h)
    });
}

export function getCollapsedCategories(ui) {
    try {
        return JSON.parse(localStorage.getItem('matrix_collapsed_categories') || '[]');
    } catch {
        return [];
    }
}

export function isCategoryCollapsed(ui, categoryName) {
    return ui.getCollapsedCategories().includes(categoryName);
}

export function toggleCategoryCollapsed(ui, categoryName) {
    const collapsed = ui.getCollapsedCategories();
    const idx = collapsed.indexOf(categoryName);
    if (idx >= 0) {
        collapsed.splice(idx, 1);
    } else {
        collapsed.push(categoryName);
    }
    localStorage.setItem('matrix_collapsed_categories', JSON.stringify(collapsed));
    return idx < 0;
}
