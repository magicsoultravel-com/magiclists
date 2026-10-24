/** @module {"owns":"spatial card geometry and chrome - rect resolution, expansion tiers, collapse/expand commits, the resize and toggle wiring, and the per-card update path; talks to storage through the facade and to the board lookup through boardState","related":["ui.js","ui/gridPack.js","ui/render.js","ui/boardState.js"]} */
import { getGridBoardBounds } from '../board/boardExtents.js';
import { GRID_LAYOUT_KEY } from '../board/layoutKeys.js';
import { clampNoteToBoardEdges as clampNoteToBoardEdgesCore } from '../board/noteGeometry.js';
import { isBoardOverlayEnabled } from '../boardOverlay.js';
import { getCardRenderContext, readStoredCategories } from '../categories.js';
import { DesktopManager, isDesktopCard } from '../desktopManager.js';
import { getFileCabinetToggleLabels, isFileCabinetActive, removeFromFileCabinetOrder } from '../fileCabinet.js';
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
    LEGACY_TILE_SIZE,
    clampSpatialSize as geoClampSpatialSize,
    getSmallRect,
    getTileDefaultRect as geoGetTileDefaultRect,
    inferTileTier as geoInferTileTier,
    isCollapsedSpatialSize,
    normalizeTileSize,
    readRememberedSize as geoReadRememberedSize,
    resolveExpandedDefaultRect as geoResolveExpandedDefaultRect,
    resolveSpatialFallbackRect as geoResolveSpatialFallbackRect,
    resolveTileSize
} from '../tileGeometry.js';
import { getBoardItem, setBoardItem } from './boardState.js';

export function ensureSmallTile(item) {
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
    applyFileCabinetZoneToggle(card, item, ctx, ui);
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
