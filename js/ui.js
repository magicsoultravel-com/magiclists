/** @module {"owns":"board render, tile layout, category visibility, desktop canvas", "related":["noteSurface.js","noteQuickActions.js","dragdrop.js","layoutStorage.js","board/gridEngine.js"], "events":["board:visibility_changed","item:selected_for_edit","calendar:items_changed"]} */
import { mountFloatChrome } from './desktopFloatChrome.js';
import {
    categoryKey,
    getCardRenderContext,
    isUncategorizedCategory,
    readStoredCategories,
    UNCATEGORIZED_CATEGORY,
    UNCATEGORIZED_COLOR
} from './categories.js';
import { applyCardTheme } from './cardTheme.js';
import { resolveNoteColor } from './colorPicker.js';
import {
    persistViewSession,
    restoreViewSession,
    normalizeViewMode
} from './viewSession.js';
import {
    ensureFileCabinetMount,
    getFileCabinetOrder,
    getFileCabinetToggleLabels,
    isFileCabinetActive,
    isItemFiled,
    partitionItemsForFileCabinet,
    removeFromFileCabinetOrder,
    renderFileCabinet,
    fileItemToCabinet,
    seedFileCabinetOrderFromItems,
    setFileCabinetActive,
    shouldFileItem,
    applySortToFileCabinetOrder,
    getStoredItemSize,
    FILE_CABINET_ORDER_KEY,
    FILE_CABINET_FILED_CATEGORIES_KEY,
    getFileCabinetFiledCategories,
    applyFileCabinetZoneToggle,
    saveFiledCabinetLayout,
    sortFileCabinetItems,
    resetFileCabinetLayout
} from './fileCabinet.js';
import { sortBoardItems } from './boardSort.js';
import {
    CASCADE_PER_STACK,
    chunkForStacks,
    computeAlignRegion,
    computeCascadeStackRects,
    computeStackBounds,
    computeStackFootprint,
    computeStackRects,
    getExpandedAlignSlots,
    layoutCascadeChunkAnchors,
    slotsToRegionRects
} from './boardSortAlign.js';
import { syncCabinetSplitter } from './shellResize.js';
import { raiseDesktopElement, syncDesktopStackSeq } from './desktopStack.js';
import { readTileSmallFootprint } from './tileFootprint.js';
import { isBoardOverlayEnabled } from './boardOverlay.js';
import { getGridMetrics, cellsToSpanW as gridCellsToSpanW, cellsToSpanH as gridCellsToSpanH } from './gridDensity.js';
import {
    FREEFORM_DEFAULT_W,
    FREEFORM_DEFAULT_H,
    FREEFORM_EXPANDED_W,
    FREEFORM_MIN_W,
    FREEFORM_MIN_H,
    FREEFORM_EXPANDED_DEFAULT_H,
    CANVAS_COL_GAP,
    getCanvasColGap,
    CANVAS_LAYOUT_ORIGIN,
    COLUMN_GRID_GAP,
    TILE_LABEL_H,
    TILE_RESIZE_MIN_W,
    TILE_RESIZE_MIN_H,
    TILE_LARGE_W_CELLS,
    TILE_LARGE_H_CELLS,
    TILE_NOTE_W_CELLS,
    TILE_NOTE_H_CELLS,
    TILE_SIZES,
    DEFAULT_TILE_SIZE,
    LEGACY_TILE_SIZE,
    normalizeTileSize,
    resolveTileSize,
    cellsToSpanW as geoCellsToSpanW,
    cellsToSpanH as geoCellsToSpanH,
    spanToCellsW as geoSpanToCellsW,
    spanToCellsH as geoSpanToCellsH,
    softSnapPx as geoSoftSnapPx,
    getTileDefaultRect as geoGetTileDefaultRect,
    getSmallRect,
    getLargeDefaultRect,
    isCustomTileRect as geoIsCustomTileRect,
    isCollapsedSpatialSize,
    getPackStrideYForRect,
    getGridSnapMinH,
    resolveExpandedDefaultRect as geoResolveExpandedDefaultRect,
    isAtOrBelowCompactZone as geoIsAtOrBelowCompactZone,
    inferTileTier as geoInferTileTier,
    resolveCollapsedTierRect as geoResolveCollapsedTierRect,
    clampSpatialSize as geoClampSpatialSize,
    readRememberedSize as geoReadRememberedSize,
    resolveSpatialFallbackRect as geoResolveSpatialFallbackRect
} from './tileGeometry.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';

import { NoteSurface } from './noteSurface.js';
import { bindNoteQuickActions } from './noteQuickActions.js';

export { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS, DRAWING_ICONS } from './icons.js';
export {
    deriveNoteTitle,
    createNoteId,
    noteHasSavableContent,
    formatLocalDateTimeParts,
    defaultStartDateTimeNow,
    normalizeItemForSave
} from './noteModel.js';
import {
    GRID_LAYOUT_KEY,
    GRID_PINS_KEY,
    FREEFORM_POSITIONS_KEY,
    FREEFORM_SIZES_KEY
} from './board/layoutKeys.js';
import {
    getGridBoardBounds,
    getGridViewportBounds,
    getDesktopBoardPane,
    ensureDesktopBoardPane,
    updateBoardCanvasExtents as updateBoardCanvasExtentsCore,
    scheduleBoardCanvasExtents as scheduleBoardCanvasExtentsCore,
    updateDesktopScrollPolicy,
    DESKTOP_BOARD_PANE_CLASS
} from './board/boardExtents.js';
import {
    clampNoteToBoardEdges as clampNoteToBoardEdgesCore,
    clampManualNoteRect as clampManualNoteRectCore,
    snapNotePosition as snapNotePositionCore,
    snapNoteRect as snapNoteRectCore,
    readNoteRect as readNoteRectCore,
    applyNoteRect as applyNoteRectCore,
    findFirstCanvasSlot as findFirstCanvasSlotCore,
    findFirstCanvasSlotVertical as findFirstCanvasSlotVerticalCore,
    findNearestGridSlot as findNearestGridSlotCore,
    gridColumnStride as gridColumnStrideCore,
    rectsOverlap as rectsOverlapCore
} from './board/noteGeometry.js';
import {
    computeGridBoardLayout as computeGridBoardLayoutCore,
    applyGridBoardLayout as applyGridBoardLayoutCore,
    reflowGridBoard as reflowGridBoardCore,
    clearSnapPanelPreview
} from './board/gridEngine.js';

function ensureSmallTile(item) {
    if (!NoteSurface.canEditInline() || resolveTileSize(item) === 'small') return;
    NoteSurface.mutateItem(item, (it) => { it.tileSize = 'small'; }, { preserveView: true, skipRerender: true });
    item.tileSize = 'small';
    boardItemsById.set(item.id, item);
}

let boardItemsById = new Map();
let activeBoardViewMode = 'grid';

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

function sortItemsSpatially(items, getRect) {
    return [...items].sort((a, b) => {
        const ra = getRect(a) || { x: 0, y: 0 };
        const rb = getRect(b) || { x: 0, y: 0 };
        const ay = Number.isFinite(ra.y) ? ra.y : 0;
        const ax = Number.isFinite(ra.x) ? ra.x : 0;
        const by = Number.isFinite(rb.y) ? rb.y : 0;
        const bx = Number.isFinite(rb.x) ? rb.x : 0;
        return ay - by || ax - bx;
    });
}

export function isSnapLayoutMode(_mode) {
    return true;
}

export function isDesktopCard(card) {
    return card?.dataset?.desktop === '1';
}

export const UI = {
    getLocalHiddenIds() {
        try {
            return JSON.parse(localStorage.getItem('matrix_hidden_board_ids') || '[]');
        } catch {
            return [];
        }
    },

    isHiddenFromBoard(item) {
        if (item.hiddenFromBoard) return true;
        return this.getLocalHiddenIds().includes(item.id);
    },

    isArchived(item) {
        return item?.status === 'archived';
    },

    hideFromBoard(item) {
        if (localStorage.getItem('admin_token')) {
            NoteSurface.emitItemMutation(
                { ...item, hiddenFromBoard: true },
                { beforeItem: NoteSurface.snapshotItem(item) }
            );
            return;
        }
        const ids = this.getLocalHiddenIds();
        if (!ids.includes(item.id)) ids.push(item.id);
        localStorage.setItem('matrix_hidden_board_ids', JSON.stringify(ids));
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    unhideFromBoard(item) {
        const ids = this.getLocalHiddenIds().filter(id => id !== item.id);
        localStorage.setItem('matrix_hidden_board_ids', JSON.stringify(ids));
        if (localStorage.getItem('admin_token')) {
            NoteSurface.emitItemMutation(
                { ...item, hiddenFromBoard: false },
                { beforeItem: NoteSurface.snapshotItem(item) }
            );
            return;
        }
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    getLocalCalendarHiddenIds() {
        try {
            return JSON.parse(localStorage.getItem('matrix_calendar_hidden_ids') || '[]');
        } catch {
            return [];
        }
    },

    isHiddenFromCalendar(item) {
        if (item.hideFromCalendar) return true;
        return this.getLocalCalendarHiddenIds().includes(item.id);
    },

    toggleCardCalendar(item, btn) {
        const beforeItem = NoteSurface.snapshotItem(item);
        const willHide = !this.isHiddenFromCalendar(item);
        const updated = { ...item, hideFromCalendar: willHide };
        item.hideFromCalendar = willHide;

        const ids = this.getLocalCalendarHiddenIds().filter(id => id !== item.id);
        if (willHide && !localStorage.getItem('admin_token')) ids.push(item.id);
        localStorage.setItem('matrix_calendar_hidden_ids', JSON.stringify(ids));

        if (localStorage.getItem('admin_token')) {
            NoteSurface.emitItemMutation(updated, { beforeItem });
        }

        window.dispatchEvent(new CustomEvent('calendar:items_changed', { detail: updated }));

        if (btn) {
            btn.title = willHide ? 'Hidden from calendar — click to show' : 'Shown on calendar — click to hide';
            btn.classList.toggle('is-off', willHide);
            btn.classList.toggle('is-on', !willHide);
        }
    },

    getVisibleItems(items) {
        return items.filter((item) => !this.isHiddenFromBoard(item) && !this.isArchived(item));
    },

    flushAllInlineEditsFromCanvas(canvas, items) {
        if (!canvas || !Array.isArray(items)) return;
        const byId = new Map(items.map((item) => [item.id, item]));
        canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
            const item = byId.get(card.dataset.id);
            if (!item) return;
            NoteSurface.commitFocusedInlineField(card, item);
            if (card.dataset.pendingFocusStepId) return;
            const shell = card.querySelector('.editor-note-shell');
            if (!shell) return;
            const beforeItem = NoteSurface.snapshotItem(item);
            NoteSurface.syncItemBodyFromDom(shell, item);
            if (JSON.stringify(beforeItem) !== JSON.stringify(NoteSurface.snapshotItem(item))) {
                NoteSurface.emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
            }
        });
    },

    getActiveBoardViewMode() {
        return activeBoardViewMode;
    },

    persistViewSessionForMode(mode, canvas = document.getElementById('app-canvas')) {
        persistViewSession(mode, {
            canvas,
            flushLayout: (c, m) => this.flushLayoutFromCanvas(c, m)
        });
    },

    restoreViewSessionForMode(mode) {
        restoreViewSession(mode);
    },

    resolveBoardItem(itemId) {
        if (!itemId) return null;
        return boardItemsById.get(itemId) || null;
    },

    getSavedLayoutRect(card, item) {
        const id = item?.id || card?.dataset?.id;
        if (!id) return null;
        if (isSnapLayoutMode(activeBoardViewMode)) {
            return this.getGridLayout()[id] || null;
        }
        return this.getFreeformSizes()[id] || null;
    },

    resolveRememberedSpatialSize(saved, item) {
        const remembered = geoReadRememberedSize(saved);
        if (remembered) return remembered;
        return geoResolveExpandedDefaultRect(resolveTileSize(item), null);
    },

    resolveBoardExpandRect(card, item) {
        const saved = this.getSavedLayoutRect(card, item);
        const tileSize = resolveTileSize(item);
        const remembered = geoReadRememberedSize(saved);
        const size = remembered
            ? remembered
            : geoResolveExpandedDefaultRect(tileSize, null);
        const pos = this.readNoteRect(card);
        return { x: pos.x, y: pos.y, w: size.w, h: size.h };
    },

    resolveBoardExpandPlacement(card, item) {
        const sizeRect = this.resolveBoardExpandRect(card, item);
        if (!isSnapLayoutMode(activeBoardViewMode)) return sizeRect;
        const canvas = card.closest('#app-canvas');
        return this.findDesktopCenterSlot(sizeRect.w, sizeRect.h, canvas, 'grid', {
            excludeId: item.id
        });
    },

    mergeSpatialLayoutEntry(prev, rect, tileSize = LEGACY_TILE_SIZE, {
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
    },

    persistRememberedSpatialSize(itemId, w, h, tileSize = LEGACY_TILE_SIZE) {
        if (!itemId || !Number.isFinite(w) || !Number.isFinite(h)) return;
        if (isCollapsedSpatialSize(w, h, tileSize)) return;
        const clamped = geoClampSpatialSize(w, h, tileSize);
        if (isSnapLayoutMode(activeBoardViewMode)) {
            const layout = this.getGridLayout();
            const prev = layout[itemId] || {};
            layout[itemId] = {
                ...prev,
                rememberedW: Math.round(clamped.w),
                rememberedH: Math.round(clamped.h)
            };
            localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
        } else {
            const sizes = this.getFreeformSizes();
            const prev = sizes[itemId] || {};
            sizes[itemId] = {
                ...prev,
                rememberedW: Math.round(clamped.w),
                rememberedH: Math.round(clamped.h)
            };
            localStorage.setItem(FREEFORM_SIZES_KEY, JSON.stringify(sizes));
        }
    },

    resolveCardRect(card, item, { mode } = {}) {
        const pos = card ? this.readNoteRect(card) : { x: 0, y: 0, w: 0, h: 0 };
        const saved = this.getSavedLayoutRect(card, item);
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
                : this.resolveRememberedSpatialSize(saved, item);
            return { x: pos.x, y: pos.y, w: size.w, h: size.h };
        }
        if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
            const size = geoClampSpatialSize(saved.w, saved.h, resolveTileSize(item));
            return { x: pos.x, y: pos.y, w: size.w, h: size.h };
        }
        const fallback = geoResolveSpatialFallbackRect(resolveTileSize(item));
        return { x: pos.x, y: pos.y, w: fallback.w, h: fallback.h };
    },

    isGridMultiCellSize(w, h) {
        const { cellW } = getGridMetrics();
        return w > cellW + 2 || h > cellW + 2;
    },

    getCardTileSize(card, item = null) {
        const resolved = item || this.resolveBoardItem(card?.dataset?.id);
        return resolveTileSize(resolved);
    },

    applyCollapsedTileClasses(card, tileSize) {
        card.classList.remove('tile-small', 'tile-large');
        const size = normalizeTileSize(tileSize);
        card.classList.add(size === 'small' ? 'tile-small' : 'tile-large');
    },

    isSpatiallyCollapsed(card) {
        if (!card) return true;
        const { w, h } = this.readNoteRect(card);
        const item = this.resolveBoardItem(card?.dataset?.id);
        return isCollapsedSpatialSize(w, h, resolveTileSize(item));
    },

    isSavedLayoutExpanded(itemId, footprint = readTileSmallFootprint()) {
        const saved = this.getGridLayout()[itemId];
        if (!saved || !Number.isFinite(saved.w) || !Number.isFinite(saved.h)) return false;
        const item = this.resolveBoardItem(itemId);
        return !isCollapsedSpatialSize(saved.w, saved.h, resolveTileSize(item), footprint);
    },

    syncSpatialCollapseState(card, item, w, h) {
        if (!isDesktopCard(card)) return false;
        card.classList.add('note-surface');
        const atSmall = this.isSpatiallyCollapsed(card);
        card.classList.toggle('spatial-at-small', atSmall);
        const resolvedItem = item || this.resolveBoardItem(card?.dataset?.id);
        const tier = geoInferTileTier(w, h, resolveTileSize(resolvedItem));
        this.applyCollapsedTileClasses(card, tier);
        return atSmall;
    },

    syncSpatialToggleButton(card, atSmall) {
        if (!isDesktopCard(card)) return;
        const toggleBtn = card.querySelector('.card-act--toggle');
        if (!toggleBtn) return;
        if (atSmall === undefined) atSmall = this.isSpatiallyCollapsed(card);
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
    },

    bindBoardEditorFocusChrome(card) {
        if (!isDesktopCard(card) || card.dataset.boardEditorFocusBound) return;
        card.dataset.boardEditorFocusBound = '1';
        card.addEventListener('focusin', (e) => {
            if (e.target.closest('.editor-note-shell .card-inline-edit')) {
                requestAnimationFrame(() => {
                    card.classList.add('is-editing-inline');
                    this.syncSpatialChromeForEditing(card);
                });
            }
        });
        card.addEventListener('focusout', () => {
            requestAnimationFrame(() => {
                if (!card.querySelector('.editor-note-shell .card-inline-edit:focus')) {
                    card.classList.remove('is-editing-inline');
                    this.syncSpatialChromeForEditing(card);
                }
            });
        });
    },

    createTierResizeSession(card, item) {
        const rect = this.readNoteRect(card);
        const startTier = this.getCardTileSize(card, item);
        return {
            startTier,
            previewTier: startTier,
            startRect: { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
        };
    },

    applyTierResizeBox(card, rect) {
        card.style.left = `${rect.x}px`;
        card.style.top = `${rect.y}px`;
        this.applyFreeformDimensions(card, rect.w, rect.h);
    },

    applyTierResizePreview(card, item, rect, tier, resizeState) {
        if (!card || !item || !resizeState) return;
        const normalized = normalizeTileSize(tier);
        card.classList.add('is-tier-resizing');
        card.dataset.tierResizePreview = '1';

        if (resizeState.previewTier !== normalized) {
            this.applyCollapsedTileClasses(card, normalized);
            resizeState.previewTier = normalized;
            card.dataset.tierResizePreview = '1';
            card.classList.add('is-tier-resizing');
        }

        this.applyTierResizeBox(card, rect);
        this.syncSpatialCollapseState(card, item, rect.w, rect.h);
    },

    revertTierResizePreview(card, item, resizeState) {
        if (!card || !item || !resizeState) return;
        delete card.dataset.tierResizePreview;
        card.classList.remove('is-tier-resizing');

        this.applyCollapsedTileClasses(card, resizeState.startTier);
        this.applyTierResizeBox(card, resizeState.startRect);
        this.finalizeDesktopCard(card);
    },

    commitTierResize(card, item, resizeState) {
        if (!card || !item || !resizeState) return resizeState?.previewTier || resolveTileSize(item);
        delete card.dataset.tierResizePreview;
        card.classList.remove('is-tier-resizing');

        const finalTier = normalizeTileSize(resizeState.previewTier);
        if (finalTier !== resolveTileSize(item) && NoteSurface.canEditInline()) {
            NoteSurface.mutateItem(item, (it) => {
                it.tileSize = finalTier;
            }, { preserveView: true, skipRerender: true });
            item.tileSize = finalTier;
            boardItemsById.set(item.id, item);
        }
        return finalTier;
    },

    processCollapsedTierResizeMove(card, item, resizeState, rect, { maxW = Infinity, axis = 'se' } = {}) {
        const resolved = geoResolveCollapsedTierRect(rect.w, rect.h, resizeState.previewTier);
        let finalW = resolved.w;
        let finalH = resolved.h;
        let finalX = rect.x;
        let finalY = rect.y;

        if (axis.includes('w') && rect.w !== finalW) {
            finalX = rect.x + (rect.w - finalW);
        }
        if (axis.includes('n') && rect.h !== finalH) {
            finalY = rect.y + (rect.h - finalH);
        }

        if (Number.isFinite(maxW) && finalX + finalW > maxW) {
            if (rect.w > resolved.w) {
                finalX = Math.max(0, maxW - finalW);
            } else {
                finalW = Math.max(getGridMetrics().cellW, maxW - finalX);
            }
        }

        const finalRect = { x: finalX, y: finalY, w: finalW, h: finalH };
        this.applyTierResizePreview(card, item, finalRect, resolved.tier, resizeState);
        return { ...finalRect, tier: resolved.tier };
    },

    collapseSnapPanelCard(card, item) {
        this.finalizeDesktopCard(card);
    },

    saveTileLayoutFromCard(card, item, rect, tileSize) {
        const id = item?.id || card.dataset.id;
        if (!id || !isDesktopCard(card)) return;
        const updateRemembered = !isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item));
        if (isSnapLayoutMode(activeBoardViewMode)) {
            this.saveGridLayout(id, rect, { updateRemembered });
        }
    },

    saveSpatialLayoutFromResize(card, item, tileSize) {
        if (!card || !item) return;
        const rect = this.readNoteRect(card);
        this.saveTileLayoutFromCard(card, item, rect, tileSize || resolveTileSize(item));
    },

    commitSpatialRect(card, item, rect, ctx = {}) {
        const tier = ctx.tier ?? (isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item)) ? 'small' : 'large');
        const normalizedTier = normalizeTileSize(tier);

        if (NoteSurface.canEditInline() && normalizedTier !== resolveTileSize(item)) {
            NoteSurface.mutateItem(item, (it) => {
                it.tileSize = normalizedTier;
            }, { preserveView: true, skipRerender: true });
            item.tileSize = normalizedTier;
            boardItemsById.set(item.id, item);
        }

        this.applyNoteRect(card, rect, { settling: false });
        this.saveTileLayoutFromCard(card, item, rect, normalizedTier);
        this.finalizeDesktopCard(card, { skipSizeReapply: !!ctx.skipSizeReapply });
        const canvas = card.closest('#app-canvas');
        if (ctx.scheduleExtents) {
            this.scheduleBoardCanvasExtents(canvas);
        }
        if (canvas?.classList.contains('view-grid') && !isBoardOverlayEnabled()) {
            const reflowOpts = { animate: true };
            if (ctx.actorRect) reflowOpts.actorRect = ctx.actorRect;
            requestAnimationFrame(() => this.reflowGridBoard(canvas, item.id, reflowOpts));
        }
    },

    applyTileTierRect(card, item, nextTier, rect, ctx = {}) {
        this.commitSpatialRect(card, item, rect, { ...ctx, tier: nextTier });
    },

    applySpatialToggleRect(card, item, rect, ctx = {}) {
        this.commitSpatialRect(card, item, rect, { ...ctx, scheduleExtents: true, skipSizeReapply: true });
    },

    collapseSpatialAtCurrentPos(card, item, ctx = {}) {
        const pos = this.readNoteRect(card);
        this.persistRememberedSpatialSize(item.id, pos.w, pos.h, resolveTileSize(item));
        const small = getSmallRect(readTileSmallFootprint());
        this.applySpatialToggleRect(card, item, { x: pos.x, y: pos.y, w: small.w, h: small.h }, ctx);
    },

    collapseBoardCardToSmallFootprint(card, item, ctx = {}) {
        if (!card || !item?.id || isFileCabinetActive() || this.isSpatiallyCollapsed(card)) return;
        this.collapseSpatialAtCurrentPos(card, item, ctx);
    },

    applyTileZoneToggle(card, item, ctx = {}) {
        if (isFileCabinetActive()) {
            this.applyFileCabinetZoneToggle(card, item, ctx);
            return;
        }

        if (this.isSpatiallyCollapsed(card)) {
            removeFromFileCabinetOrder(item.id);
            const rect = this.resolveBoardExpandPlacement(card, item);
            this.applySpatialToggleRect(card, item, rect, { ...ctx, actorRect: rect });
            if (isSnapLayoutMode(activeBoardViewMode)) {
                this.raiseDesktopCard(card);
                requestAnimationFrame(() => {
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                });
            }
        } else {
            this.collapseSpatialAtCurrentPos(card, item, ctx);
        }
        const atSmall = this.isSpatiallyCollapsed(card);
        this.syncSpatialToggleButton(card, atSmall);
    },

    applyFileCabinetZoneToggle(card, item, ctx = {}) {
        applyFileCabinetZoneToggle(card, item, ctx, this);
    },

    reapplySmallFootprintOnBoard() {
        const canvas = document.getElementById('app-canvas');
        if (!canvas) return;
        const footprint = readTileSmallFootprint();
        const smallRect = getSmallRect(footprint);
        canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
            if (card.closest('#file-cabinet')) return;
            const item = this.resolveBoardItem(card.dataset.id);
            if (!item) return;
            const rect = this.readNoteRect(card);
            const wasSmall = isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item))
                || resolveTileSize(item) === 'small';
            if (!wasSmall) return;
            const next = { x: rect.x, y: rect.y, w: smallRect.w, h: smallRect.h };
            this.applyNoteRect(card, next, { settling: false });
            ensureSmallTile(item);
            this.saveTileLayoutFromCard(card, item, next, 'small');
            this.finalizeDesktopCard(card);
        });
        this.scheduleBoardCanvasExtents(canvas);
        if (isSnapLayoutMode(activeBoardViewMode)) {
            requestAnimationFrame(() => this.reflowGridBoard(canvas, null, { animate: true }));
        }
        if (isFileCabinetActive()) {
            window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
        }
    },

    reapplyBoardMetricsOnBoard(prevMetrics, nextMetrics) {
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
            const item = this.resolveBoardItem(card.dataset.id);
            if (!item) return;
            let rect = migrateRect(this.readNoteRect(card));
            const { packW, maxH, origin, edgePad } = this.getGridBoardBounds(canvas);
            if (isSnapLayoutMode(activeBoardViewMode)) {
                rect = this.snapNoteRect(rect, { maxW: packW, maxH, origin, edgePad });
            } else {
                rect = this.clampNoteToBoardEdges(rect, { packW, maxH, origin, edgePad });
            }
            this.applyNoteRect(card, rect, { settling: false });
            this.saveTileLayoutFromCard(card, item, rect, this.getCardTileSize(card, item));
            this.finalizeDesktopCard(card);
        });

        this.scheduleBoardCanvasExtents(canvas);
        if (isSnapLayoutMode(activeBoardViewMode)) {
            requestAnimationFrame(() => this.reflowGridBoard(canvas, null, { animate: true }));
        }
        if (isFileCabinetActive()) {
            window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
        }
    },

    clampNoteToBoardEdges(rect, opts) {
        return clampNoteToBoardEdgesCore(rect, opts);
    },

    gridBoardRectForCard(card, savedRect, isExpanded) {
        const base = savedRect && Number.isFinite(savedRect.x) && Number.isFinite(savedRect.w)
            ? { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h }
            : this.readNoteRect(card);
        if (isExpanded) {
            const item = this.resolveBoardItem(card.dataset.id);
            const tileSize = this.getCardTileSize(card, item);
            const expandedMin = geoResolveExpandedDefaultRect(tileSize, savedRect);
            if (base.w >= expandedMin.w && base.h >= expandedMin.h) return base;
            return {
                ...base,
                w: expandedMin.w,
                h: expandedMin.h
            };
        }
        const item = this.resolveBoardItem(card.dataset.id);
        return this.gridTileRect(this.getCardTileSize(card, item), base, savedRect);
    },

    gridTileRect(tileSize, base, saved) {
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
    },

    syncCardDraggable(card) {
        card.removeAttribute('draggable');
    },

    isGridBoardCard(card) {
        return isDesktopCard(card) && isSnapLayoutMode(activeBoardViewMode);
    },

    updateSingleCard(canvas, item, hiddenCategories = []) {
        if (!canvas || !item?.id) return false;
        const card = canvas.querySelector(`.mini-card[data-id="${item.id}"]`);
        if (!card) return false;

        let activeCategories = readStoredCategories()
            .filter((cat) => !hiddenCategories.includes(cat.name));
        const { targetCatName, categoryColor } = getCardRenderContext(item, activeCategories);

        this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;
        this.finalizeDesktopCard(card);

        return true;
    },

    render(canvas, items, viewMode, hiddenCategories = [], renderOptions = {}) {
        if (!canvas) return;
        this.prepareCanvas(canvas);
         
        const safeItems = Array.isArray(items) ? items : [];
        const visibleItems = this.getVisibleItems(safeItems);
        boardItemsById = new Map(visibleItems.map((item) => [item.id, item]));

        const activeCategories = this.getActiveCategories(hiddenCategories);
         
        const { resolvedMode, snapLayout, fileCabinetActive, activeBoardViewMode } = this.getViewState();
        this.applyCanvasClasses(canvas, fileCabinetActive);
         
        if (this.shouldRenderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems)) {
            this.renderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems);
            return;
        }

        const { boardItems, fileCabinetMount } = this.prepareBoardItems(visibleItems, fileCabinetActive, resolvedMode, activeCategories);
         
        if (boardItems.length === 0) {
            this.renderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems);
            return;
        }

        const { layout, placed, boardPane } = this.layoutBoard(canvas, boardItems, activeCategories);
        this.renderCards(boardItems, activeCategories, layout, placed, boardPane);
         this.finalizeRender(canvas, boardPane, renderOptions);
     },

     prepareCanvas(canvas) {
         canvas.innerHTML = '';
     },

    getActiveCategories(hiddenCategories) {
        let activeCategories = readStoredCategories();
        return activeCategories.filter(cat => !hiddenCategories.includes(cat.name));
    }

    getViewState() {
        const resolvedMode = 'grid';
        const snapLayout = true;
        const fileCabinetActive = isFileCabinetActive();
        const activeBoardViewMode = 'grid';
        return { resolvedMode, snapLayout, fileCabinetActive, activeBoardViewMode };
    }

    applyCanvasClasses(canvas, fileCabinetActive) {
        canvas.className = 'view-grid';
        if (fileCabinetActive) canvas.classList.add('file-cabinet-bottom');
        delete canvas.dataset.focusActive;
    }

    shouldRenderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems) {
        return false; // Will be handled in renderEmptyState
    }

    prepareBoardItems(visibleItems, fileCabinetActive, resolvedMode, activeCategories) {
        let boardItems = visibleItems;
        let fileCabinetMount = null;
         
        if (fileCabinetActive) {
            const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, resolvedMode, this);
            seedFileCabinetOrderFromItems(filed);
            fileCabinetMount = ensureFileCabinetMount(true);
            renderFileCabinet(fileCabinetMount, filed, activeCategories, this);
            syncCabinetSplitter();
            boardItems = expanded;
        } else {
            ensureFileCabinetMount(false);
            syncCabinetSplitter();
        }
         
        return { boardItems, fileCabinetMount };
    }

    renderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems) {
        if (fileCabinetActive && visibleItems.length > 0) {
            return;
        }
        const hiddenCount = safeItems.length - this.getVisibleItems(safeItems).length;
        if (safeItems.length > 0 && hiddenCount === safeItems.length) {
            canvas.innerHTML = `<div class="system-status-msg">All objects are hidden. Use the footer to restore them.</div>`;
        } else {
            canvas.innerHTML = `<div class="system-status-msg">Workspace clean. Click "+ New" to commit an entity.</div>`;
        }
    }

    layoutBoard(canvas, boardItems, activeCategories) {
        const layout = this.getGridLayout();
        const placed = [];
        const bounds = this.getGridBoardBounds(canvas);
        const boardPane = document.createElement('div');
        boardPane.className = DESKTOP_BOARD_PANE_CLASS;
        canvas.appendChild(boardPane);

        [...boardItems]
            .sort((a, b) => {
                const sa = layout[a.id];
                const sb = layout[b.id];
                const ay = sa?.y ?? Number.POSITIVE_INFINITY;
                const ax = sa?.x ?? Number.POSITIVE_INFINITY;
                const by = sb?.y ?? Number.POSITIVE_INFINITY;
                const bx = sb?.x ?? Number.POSITIVE_INFINITY;
                return ay - by || ax - bx;
            })
            .forEach((item, index) => {
                const card = this.createCardComponent(item, activeCategories);
                const isLayoutExpanded = this.isSavedLayoutExpanded(item.id);

                const { origin, packW, maxH, edgePad } = bounds;
                const saved = layout[item.id];
                let rect;

                if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.w)) {
                    rect = this.snapNoteRect(
                        this.gridBoardRectForCard(card, saved, isLayoutExpanded),
                        { maxW: packW, maxH, origin, edgePad }
                    );
                } else {
                    const tileDefaults = geoGetTileDefaultRect(resolveTileSize(item));
                    let w;
                    let h;
                    if (isLayoutExpanded) {
                        const target = this.resolveRememberedSpatialSize(null, item);
                        w = target.w;
                        h = target.h;
                    } else {
                        w = tileDefaults.w;
                        h = tileDefaults.h;
                    }
                    rect = findFirstCanvasSlotCore(w, h, placed, packW + origin * 2, { origin, edgePad });
                }

                this.applyNoteRect(card, rect, { settling: false });
                if (!saved) {
                    this.saveGridLayout(item.id, rect);
                }
                placed.push(rect);

                card.removeAttribute('draggable');
                this.finalizeDesktopCard(card);
                this.initDesktopCardStack(card, index);
                this.syncBoardPinClass(card);
                boardPane.appendChild(card);
            });

        return { layout, placed, boardPane };
    }

    renderCards(boardItems, activeCategories, layout, placed, boardPane) {
        // This is handled in layoutBoard now
    }

    finalizeRender(canvas, boardPane, renderOptions) {
        this.updateBoardCanvasExtents(canvas);
        if (!renderOptions.skipGridReflow && !isBoardOverlayEnabled()) {
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, null, { animate: false });
            });
        }
    }


    buildCardActionsHtml(item, isExpanded = false, options = {}) {
        return NoteSurface.buildNoteQuickActionsHtml(item, {
            surface: 'board',
            isExpanded,
            calHidden: this.isHiddenFromCalendar(item),
            ...options
        });
    },

    syncCalendarButtonUI(item, btn) {
        if (!btn || !item) return;
        const hidden = this.isHiddenFromCalendar(item);
        btn.innerHTML = CARD_ICONS.calendar;
        const title = hidden
            ? 'Hidden from calendar — click to show'
            : 'Shown on calendar — click to hide';
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.classList.toggle('is-off', hidden);
        btn.classList.toggle('is-on', !hidden);
    },

    getCardActionsOptions(card) {
        const hasSession = !!localStorage.getItem('admin_token');
        const spatial = isDesktopCard(card);
        const opts = {
            pinned: this.isBoardPinned(card?.dataset?.id),
            showDrag: hasSession && spatial
        };
        if (spatial && card) {
            opts.spatialTile = true;
            const item = this.resolveBoardItem(card.dataset.id);
            let { w, h } = this.readNoteRect(card);
            opts.tileSize = this.getCardTileSize(card, item);
            if (!(w > 0 && h > 0)) {
                const saved = this.getSavedLayoutRect(card, item);
                w = saved?.w ?? 0;
                h = saved?.h ?? 0;
            }
            opts.tileW = w;
            opts.tileH = h;
        }
        return opts;
    },

    syncBoardPinClass(card) {
        if (!card?.dataset?.id) return;
        card.classList.toggle('is-board-pinned', this.isBoardPinned(card.dataset.id));
    },

    applyItemCardTheme(card, item) {
        const color = resolveNoteColor(item.backgroundColor);
        card.style.backgroundColor = color;
        card.style.borderColor = 'rgba(255,255,255,0.15)';
        applyCardTheme(card, color);
    },

    setupFreeformChrome(card) {
        const shell = card.querySelector('.editor-note-shell');
        mountFloatChrome(card, {
            resizable: true,
            mode: 'note',
            insertBefore: shell
        });
    },

    syncSpatialChromeForEditing(card) {
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
    },

    readFreeformCardSize(card) {
        const { w, h } = this.readNoteRect(card);
        return {
            w: Math.round(w) || FREEFORM_DEFAULT_W,
            h: Math.round(h) || FREEFORM_DEFAULT_H
        };
    },

    clearFreeformCustomSize(itemId) {
        const sizes = this.getFreeformSizes();
        if (!sizes[itemId]) return;
        delete sizes[itemId];
        localStorage.setItem(FREEFORM_SIZES_KEY, JSON.stringify(sizes));
    },

    applyFreeformDimensions(card, w, h) {
        card.style.setProperty('width', `${w}px`, 'important');
        card.style.setProperty('height', `${h}px`, 'important');
        card.style.setProperty('min-width', `${w}px`, 'important');
        card.style.setProperty('max-width', `${w}px`, 'important');
        card.style.setProperty('min-height', `${h}px`, 'important');
        card.style.setProperty('max-height', `${h}px`, 'important');
    },

    isCardActivelyResizing(card) {
        if (!card) return false;
        return card.classList.contains('is-tier-resizing')
            || card.classList.contains('is-freeform-resizing')
            || card.classList.contains('is-grid-resizing');
    },

    applyFreeformSize(card) {
        if (!isDesktopCard(card) || isSnapLayoutMode(activeBoardViewMode)) return;
        if (card.dataset.tierResizePreview === '1') return;
        const saved = this.getFreeformSizes()[card.dataset.id];
        const item = this.resolveBoardItem(card.dataset.id);
        const tileSize = this.getCardTileSize(card, item);
        let w;
        let h;
        if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
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
            const defaults = geoGetTileDefaultRect(tileSize);
            w = defaults.w;
            h = defaults.h;
        }
        this.applyFreeformDimensions(card, w, h);
    },

    /** Canonical desktop card finalizer — syncs collapse classes, chrome, saved size, toggle label. */
    finalizeDesktopCard(card, { skipSizeReapply = false } = {}) {
        if (!isDesktopCard(card)) return;
        const item = this.resolveBoardItem(card.dataset.id);
        this.setupFreeformChrome(card);
        if (!skipSizeReapply) {
            this.applyDesktopSize(card);
        }
        const { w, h } = this.readNoteRect(card);
        const atSmall = this.syncSpatialCollapseState(card, item, w, h);
        this.syncSpatialChromeForEditing(card);
        this.syncSpatialToggleButton(card, atSmall);
    },

    updateDesktopCard(card, item, { dimensions = null } = {}) {
        if (!isDesktopCard(card)) return;

        const snapLayout = isSnapLayoutMode(activeBoardViewMode);
        const canvas = card.closest('#app-canvas');

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else if (snapLayout) {
            this.applyDesktopSize(card);
        } else {
            this.applyFreeformSize(card);
        }

        this.finalizeDesktopCard(card);

        if (snapLayout && canvas) {
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, item.id, { animate: true });
            });
        }
    },

    createCardComponent(item, activeCategories) {
        const card = document.createElement('div');
        card.classList.add('mini-card');
        card.dataset.id = item.id;
        card.dataset.desktop = '1';

        const { targetCatName, categoryColor } = getCardRenderContext(item, activeCategories);

        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;
        this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
        card.addEventListener('mousedown', () => this.raiseDesktopCard(card), true);
        this.syncBoardPinClass(card);
        return card;
    },



    renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor) {
        const canEdit = NoteSurface.canEditInline();
        const dotColor = targetCatName ? categoryColor : UNCATEGORIZED_COLOR;
        const dragZone = ' card-drag-zone';

        card.innerHTML = NoteSurface.buildNoteEditorShell(item, {
            canEdit,
            richEdit: true,
            toolbarHtml: this.buildCardActionsHtml(item, false, this.getCardActionsOptions(card)),
            toplineDragZone: dragZone,
            footerDragZone: dragZone,
            targetCatName,
            categoryColor: dotColor
        });

        bindNoteQuickActions(card, item, {
            surface: 'board',
            ui: this,
            card,
            ctx: {
                activeCategories,
                targetCatName,
                categoryColor
            }
        });
        NoteSurface.bindNoteEditorShell(card, item, {
            richEdit: true,
            refresh: () => this.refreshBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor),
            stopMousedownPropagation: true,
            onRaiseCard: (c) => this.raiseDesktopCard(c)
        });
        this.bindBoardEditorFocusChrome(card);
        this.finalizeDesktopCard(card);
        this.syncBoardPinClass(card);
        this.focusPendingBoardField(card);
    },

    refreshBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor) {
        const body = card.querySelector('.editor-note-body');
        const focusState = body ? NoteSurface.captureNoteBodyFocusState(body) : null;
        const shell = card.querySelector('.editor-note-shell');
        if (shell && !card.dataset.pendingFocusStepId) {
            NoteSurface.syncItemBodyFromDom(shell, item);
        }
        const pendingFocusStepId = card.dataset.pendingFocusStepId;
        const pendingFocusEdge = card.dataset.pendingFocusEdge;
        const pendingFocusPlainOffset = card.dataset.pendingFocusPlainOffset;
        this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
        const newBody = card.querySelector('.editor-note-body');
        if (newBody && focusState) {
            NoteSurface.restoreNoteBodyFocusState(newBody, card, focusState);
        }
        if (pendingFocusStepId) {
            card.dataset.pendingFocusStepId = pendingFocusStepId;
            if (pendingFocusEdge) card.dataset.pendingFocusEdge = pendingFocusEdge;
            if (pendingFocusPlainOffset != null) {
                card.dataset.pendingFocusPlainOffset = pendingFocusPlainOffset;
            }
            NoteSurface.focusPendingChecklistStep(card);
        }
    },

    focusPendingBoardField(card) {
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
    },

    markNoteCollapsed(itemId) {
        if (!itemId) return;
        const small = getSmallRect(readTileSmallFootprint());
        const item = this.resolveBoardItem(itemId);
        const tileSize = resolveTileSize(item);
        const grid = this.getGridLayout();
        if (grid[itemId]) {
            const prev = grid[itemId];
            grid[itemId] = this.mergeSpatialLayoutEntry(prev, {
                x: prev.x,
                y: prev.y,
                w: small.w,
                h: small.h
            }, tileSize, { updateRemembered: false });
            localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(grid));
        }
        const sizes = this.getFreeformSizes();
        if (sizes[itemId]) {
            const prev = sizes[itemId];
            sizes[itemId] = this.mergeSpatialLayoutEntry(prev, { w: small.w, h: small.h }, tileSize, { updateRemembered: false });
            localStorage.setItem(FREEFORM_SIZES_KEY, JSON.stringify(sizes));
            const pos = this.getFreeformPositions()[itemId];
            if (pos) this.saveFreeformPosition(itemId, pos.x, pos.y);
        }
    },

    collapseBoardCardIfExpanded(card, item, hiddenCategories = []) {
        if (!card || !item?.id) return;
        if (!this.isSpatiallyCollapsed(card)) {
            this.collapseBoardCardToSmallFootprint(card, item);
        }
    },

    getFreeformPositions() {
        try {
            return JSON.parse(localStorage.getItem(FREEFORM_POSITIONS_KEY) || '{}');
        } catch {
            return {};
        }
    },

    saveFreeformPosition(itemId, x, y) {
        const positions = this.getFreeformPositions();
        positions[itemId] = { x: Math.round(x), y: Math.round(y) };
        localStorage.setItem(FREEFORM_POSITIONS_KEY, JSON.stringify(positions));
    },

    getFreeformSizes() {
        try {
            return JSON.parse(localStorage.getItem(FREEFORM_SIZES_KEY) || '{}');
        } catch {
            return {};
        }
    },

    saveFreeformSize(itemId, w, h, { updateRemembered = false } = {}) {
        const sizes = this.getFreeformSizes();
        const prev = sizes[itemId] || {};
        const item = this.resolveBoardItem(itemId);
        sizes[itemId] = this.mergeSpatialLayoutEntry(prev, { w, h }, resolveTileSize(item), { updateRemembered });
        localStorage.setItem(FREEFORM_SIZES_KEY, JSON.stringify(sizes));
    },

    saveFreeformSizeFromCard(card) {
        if (!isDesktopCard(card)) return;
        const { w, h } = this.readFreeformCardSize(card);
        this.saveFreeformSize(card.dataset.id, w, h, {
            updateRemembered: !isCollapsedSpatialSize(w, h, resolveTileSize(this.resolveBoardItem(card.dataset.id)))
        });
    },

    flushLayoutFromCanvas(canvas, _viewMode) {
        if (!canvas) return;
        canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
            const id = card.dataset.id;
            if (!id) return;
            this.saveGridLayout(id, this.readNoteRect(card));
        });
    },

    migrateFreeformLayoutToGrid(items) {
        const positions = this.getFreeformPositions();
        const sizes = this.getFreeformSizes();
        const hasFreeformData = Object.keys(positions).length > 0 || Object.keys(sizes).length > 0;
        if (!hasFreeformData) return false;

        const visible = this.getVisibleItems(Array.isArray(items) ? items : []);
        const pinnedIds = new Set(this.getBoardPins());
        const itemsById = new Map(visible.map((item) => [item.id, item]));
        const getSourceRect = (item) => {
            const freePos = positions[item?.id];
            const freeSaved = sizes[item?.id];
            if (freePos && freeSaved && Number.isFinite(freePos.x) && Number.isFinite(freeSaved.w)) {
                return { x: freePos.x, y: freePos.y, w: freeSaved.w, h: freeSaved.h };
            }
            const gridSaved = this.getGridLayout()[item.id];
            if (gridSaved && Number.isFinite(gridSaved.x)) {
                return { ...gridSaved };
            }
            const metrics = getGridMetrics();
            return { x: metrics.origin + metrics.edgePad, y: metrics.origin + metrics.edgePad, w: 0, h: 0 };
        };
        const { collapsed, expanded } = this.partitionCanvasItemsByExpansion(visible, 'grid');
        const canvas = document.getElementById('app-canvas');
        this.packGridBoard(canvas, sortItemsSpatially(collapsed, getSourceRect), sortItemsSpatially(expanded, getSourceRect), {
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
    },

    resnapBoardPositions(canvas, { reflow = false } = {}) {
        if (!canvas) return;
        const cards = canvas.querySelectorAll('.mini-card[data-desktop="1"]');
        const bounds = this.getGridBoardBounds(canvas);
        const { packW, maxH, origin, edgePad } = bounds;
        cards.forEach((card) => {
            const id = card.dataset.id;
            if (!id) return;
            const live = this.readNoteRect(card);
            const snapped = this.snapNotePosition(live, { maxW: packW, maxH, origin, edgePad });
            const delta = Math.abs(snapped.x - live.x) + Math.abs(snapped.y - live.y);
            if (delta < 1) return;
            this.applyNoteRect(card, snapped, { settling: true });
            this.saveGridLayout(id, snapped);
        });
        if (reflow && !isBoardOverlayEnabled()) {
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, null, { animate: true });
            });
        } else {
            this.updateBoardCanvasExtents(canvas);
        }
    },

    applyDesktopLayoutModeSwitch(canvas) {
        if (!canvas) return;
        activeBoardViewMode = 'grid';
        canvas.classList.add('view-grid');
        canvas.classList.remove('view-freeform');
        canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
            this.finalizeDesktopCard(card);
        });
        this.updateDesktopScrollPolicy(canvas);
        this.updateBoardCanvasExtents(canvas);
    },

    convertDesktopLayoutForModeChange(_canvas, _fromMode, _toMode, _items) {
        /* legacy no-op — freeform mode removed */
    },

    resolveFreeformSourceRect(item, canvas) {
        const freePos = this.getFreeformPositions()[item?.id];
        const freeSaved = this.getFreeformSizes()[item?.id];
        const card = canvas?.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
        if (card) {
            const pos = this.readNoteRect(card);
            const size = this.readFreeformCardSize(card);
            return { x: pos.x, y: pos.y, w: size.w, h: size.h };
        }
        if (freePos && freeSaved && Number.isFinite(freePos.x) && Number.isFinite(freeSaved.w)) {
            return { x: freePos.x, y: freePos.y, w: freeSaved.w, h: freeSaved.h };
        }
        const gridSaved = this.getGridLayout()[item.id];
        if (gridSaved && Number.isFinite(gridSaved.x)) {
            return { ...gridSaved };
        }
        const metrics = getGridMetrics();
        return { x: metrics.origin + metrics.edgePad, y: metrics.origin + metrics.edgePad, w: 0, h: 0 };
    },

    isItemLayoutExpanded(item, mode) {
        if (!item?.id) return false;
        const tileSize = resolveTileSize(item);
        const saved = getStoredItemSize(item.id, mode, this);
        if (!saved || !Number.isFinite(saved.w) || !Number.isFinite(saved.h)) return false;
        return !isCollapsedSpatialSize(saved.w, saved.h, tileSize);
    },

    resolveSortItemSize(item, mode, isExpanded) {
        const tileSize = resolveTileSize(item);
        const saved = getStoredItemSize(item.id, mode, this);
        if (isExpanded) {
            if (saved && Number.isFinite(saved.w) && !isCollapsedSpatialSize(saved.w, saved.h, tileSize)) {
                return { w: saved.w, h: saved.h };
            }
            const target = this.resolveRememberedSpatialSize(saved, item);
            return { w: target.w, h: target.h };
        }
        if (saved && Number.isFinite(saved.w) && isCollapsedSpatialSize(saved.w, saved.h, tileSize)) {
            const small = getSmallRect(readTileSmallFootprint());
            return { w: small.w, h: small.h };
        }
        const small = getSmallRect(readTileSmallFootprint());
        return { w: small.w, h: small.h };
    },

    partitionCanvasItemsByExpansion(items, mode) {
        const collapsed = [];
        const expanded = [];
        (items || []).forEach((item) => {
            if (this.isItemLayoutExpanded(item, mode)) expanded.push(item);
            else collapsed.push(item);
        });
        return { collapsed, expanded };
    },

    computeExpandedAlignAnchor(direction, collapsedRects, {
        origin,
        edgePad,
        packW,
        yStart,
        metrics = getGridMetrics()
    } = {}) {
        const small = getSmallRect(readTileSmallFootprint());
        const minX = origin + edgePad;
        const minY = yStart;

        if (direction === 'vertical') {
            const colStride = gridColumnStrideCore(small.w, small.h, metrics);
            const right = collapsedRects.length
                ? collapsedRects.reduce((max, rect) => Math.max(max, rect.x + rect.w), minX)
                : minX;
            const startX = right + metrics.gap + colStride;
            const regionW = Math.max(metrics.strideX, packW - (startX - minX));
            return { startX, startY: minY, regionW };
        }

        const rowStride = getPackStrideYForRect(small.w, small.h);
        const bottom = collapsedRects.length
            ? collapsedRects.reduce((max, rect) => Math.max(max, rect.y + rect.h), minY)
            : minY;
        return {
            startX: minX,
            startY: bottom + metrics.gap + rowStride,
            regionW: packW
        };
    },

    packExpandedAlignGrid(canvas, expandedItems, pinnedIds, {
        placed,
        layout,
        anchor,
        bounds,
        metrics,
        direction = 'horizontal'
    }) {
        const { origin, packW, viewportBottom, edgePad } = bounds;
        const unpinned = expandedItems.filter((item) => item?.id && !pinnedIds.has(item.id));
        if (!unpinned.length) return;

        const slots = getExpandedAlignSlots(unpinned.length, direction);
        const region = computeAlignRegion({
            packW,
            startX: anchor.startX,
            startY: anchor.startY,
            regionW: anchor.regionW,
            viewportBottom,
            origin,
            edgePad,
            metrics
        });
        const rects = slotsToRegionRects(slots, region, { gap: metrics.gap });

        unpinned.forEach((item, index) => {
            const rect = rects[index];
            if (!rect) return;
            layout.set(item.id, rect);
            placed.push({ ...rect });
        });
    },

    packExpandedAlignFreeform(canvas, expandedItems, pinnedIds, {
        placed,
        anchor,
        bounds,
        metrics,
        direction = 'horizontal'
    }) {
        const { packW, origin, edgePad, viewportBottom } = bounds;
        const canvasW = Math.max(canvas?.clientWidth || 320, packW + origin * 2);
        const unpinned = expandedItems.filter((item) => item?.id && !pinnedIds.has(item.id));
        if (!unpinned.length) return;

        const slots = getExpandedAlignSlots(unpinned.length, direction);
        const region = computeAlignRegion({
            packW,
            startX: anchor.startX,
            startY: anchor.startY,
            regionW: anchor.regionW,
            viewportBottom,
            origin,
            edgePad,
            metrics
        });
        const rects = slotsToRegionRects(slots, region, { gap: metrics.gap });

        unpinned.forEach((item, index) => {
            const raw = rects[index];
            if (!raw) return;
            const slot = clampManualNoteRectCore(raw, { maxW: canvasW, maxH: viewportBottom });
            this.saveGridLayout(item.id, slot, { updateRemembered: true });
            const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
            if (card) this.applyNoteRect(card, slot, { settling: true });
            placed.push({ ...slot });
        });
    },

    packGridBoard(canvas, collapsedItems, expandedItems, {
        pinnedIds = new Set(),
        layoutMode = 'grid',
        direction = 'horizontal',
        persistOnly = false,
        animate = true,
        save = true,
        itemsById = null
    } = {}) {
        const { origin, packW, maxH, edgePad } = this.getGridBoardBounds(canvas);
        const metrics = getGridMetrics();
        const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
        const placed = [];
        const layout = new Map();
        const snapBounds = { maxW: packW, maxH, origin, edgePad };
        const canvasW = packW + origin * 2;
        const resolveItem = (id) => (itemsById?.get(id) ?? this.resolveBoardItem(id));

        pinnedIds.forEach((id) => {
            const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
            const saved = this.getGridLayout()[id];
            if (!saved || !Number.isFinite(saved.x)) return;
            const item = resolveItem(id);
            const isExp = this.isItemLayoutExpanded(item, layoutMode);
            const rect = this.snapNoteRect(
                card
                    ? this.gridBoardRectForCard(card, saved, isExp)
                    : { ...saved, ...this.resolveSortItemSize(item, layoutMode, isExp) },
                snapBounds
            );
            layout.set(id, rect);
            placed.push({ ...rect });
        });

        const yStart = origin + edgePad;
        const packGroup = (items, { startX, startY } = {}) => {
            const yMin = startY ?? yStart;
            const xMin = dir === 'vertical' ? (startX ?? origin + edgePad) : undefined;
            items.forEach((item) => {
                if (!item?.id || pinnedIds.has(item.id)) return;
                const isExp = this.isItemLayoutExpanded(item, layoutMode);
                const { w, h } = this.resolveSortItemSize(item, layoutMode, isExp);
                const slotOpts = { origin, edgePad, yMin, xMin, maxH };
                let slot = dir === 'vertical'
                    ? findFirstCanvasSlotVerticalCore(w, h, placed, canvasW, slotOpts)
                    : findFirstCanvasSlotCore(w, h, placed, canvasW, slotOpts);
                slot = this.snapNoteRect(slot, snapBounds);
                layout.set(item.id, slot);
                placed.push({ ...slot });
            });
        };

        const unpinnedCollapsed = collapsedItems.filter((item) => !pinnedIds.has(item.id));
        const unpinnedExpanded = expandedItems.filter((item) => !pinnedIds.has(item.id));
        packGroup(collapsedItems, { startY: yStart });

        const collapsedRects = unpinnedCollapsed
            .map((item) => layout.get(item.id))
            .filter((rect) => rect && Number.isFinite(rect.x));
        const hasExpandedGap = unpinnedCollapsed.length && unpinnedExpanded.length;
        const expandedAnchor = this.computeExpandedAlignAnchor(
            dir,
            hasExpandedGap ? collapsedRects : [],
            { origin, edgePad, packW, yStart, metrics }
        );

        if (unpinnedExpanded.length) {
            const viewport = getGridViewportBounds(canvas);
            this.packExpandedAlignGrid(canvas, expandedItems, pinnedIds, {
                placed,
                layout,
                anchor: expandedAnchor,
                bounds: {
                    origin,
                    packW,
                    viewportBottom: viewport.viewportBottom,
                    edgePad
                },
                metrics,
                direction: dir
            });
        }

        if (persistOnly) {
            if (!save) return layout;
            const layoutStore = this.getGridLayout();
            layout.forEach((rect, id) => {
                const item = resolveItem(id);
                const isExp = item && this.isItemLayoutExpanded(item, layoutMode);
                const freeSaved = layoutMode === 'freeform' ? this.getFreeformSizes()[id] : null;
                const gridPrev = layoutStore[id] || {};
                layoutStore[id] = this.mergeSpatialLayoutEntry(
                    gridPrev,
                    rect,
                    resolveTileSize(item),
                    {
                        updateRemembered: isExp,
                        rememberedW: freeSaved?.rememberedW ?? gridPrev.rememberedW,
                        rememberedH: freeSaved?.rememberedH ?? gridPrev.rememberedH
                    }
                );
            });
            localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layoutStore));
            return layout;
        }

        this.applyGridBoardLayout(canvas, layout, { animate, save });
        if (unpinnedExpanded.length) {
            unpinnedExpanded.forEach((item) => {
                const rect = layout.get(item.id);
                if (rect) this.saveGridLayout(item.id, rect, { updateRemembered: true });
            });
        }
        this.updateGridScrollPolicy(canvas, { forcing: false });
        return layout;
    },

    packSortGridBoard(canvas, collapsedItems, expandedItems, sortPrefs, pinnedIds) {
        const direction = sortPrefs.direction === 'vertical' ? 'vertical' : 'horizontal';
        this.packGridBoard(canvas, collapsedItems, expandedItems, {
            pinnedIds,
            layoutMode: 'grid',
            direction,
            persistOnly: false,
            animate: true,
            save: true
        });
    },

    getCascadeZIndexBase(canvas, pinnedIds) {
        let maxZ = 0;
        canvas?.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
            const id = card.dataset.id;
            if (!id || !pinnedIds?.has(id)) return;
            const z = parseInt(card.style.zIndex, 10);
            if (Number.isFinite(z)) maxZ = Math.max(maxZ, z);
        });
        return maxZ;
    },

    assignCascadeCardZ(card, zOrder) {
        if (!card || !zOrder) return;
        this.initDesktopCardStack(card, zOrder.next);
        zOrder.next += 1;
    },

    packCollapsedCascadeFreeform(canvas, collapsedItems, pinnedIds, {
        placed,
        direction,
        minCoord,
        metrics,
        canvasW,
        zOrder
    }) {
        const unpinned = collapsedItems.filter((item) => item?.id && !pinnedIds.has(item.id));
        if (!unpinned.length) return;

        const chunks = chunkForStacks(unpinned);
        const sample = this.resolveSortItemSize(unpinned[0], 'grid', false);
        const slotFootprint = computeStackFootprint(CASCADE_PER_STACK, sample.w, sample.h);
        const footprints = chunks.map((chunk) => {
            const { w, h } = this.resolveSortItemSize(chunk[0], 'grid', false);
            return computeStackFootprint(chunk.length, w, h);
        });
        let anchors = layoutCascadeChunkAnchors(
            footprints,
            direction,
            { x: minCoord, y: minCoord },
            metrics.gap,
            slotFootprint
        );

        anchors = anchors.map((anchor, stackIndex) => {
            const fp = footprints[stackIndex];
            const candidate = { x: anchor.x, y: anchor.y, w: fp.w, h: fp.h };
            if (!placed.some((p) => rectsOverlapCore(candidate, p, metrics.gap))) {
                return anchor;
            }
            const near = this.findFreeformSortSlot(fp.w, fp.h, placed, canvasW, {
                startX: anchor.x,
                startY: anchor.y,
                direction
            });
            return { x: near.x, y: near.y };
        });

        chunks.forEach((chunk, stackIndex) => {
            const anchor = anchors[stackIndex];
            const fp = footprints[stackIndex];
            const sizes = chunk.map((item) => this.resolveSortItemSize(item, 'grid', false));
            const rects = computeStackRects(sizes, anchor.x, anchor.y);

            chunk.forEach((item, itemIndex) => {
                const slot = rects[itemIndex];
                if (!slot) return;
                this.saveGridLayout(item.id, slot, { updateRemembered: false });
                const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
                if (card) {
                    this.applyNoteRect(card, slot, { settling: true });
                    this.assignCascadeCardZ(card, zOrder);
                }
            });

            placed.push({ x: anchor.x, y: anchor.y, w: fp.w, h: fp.h });
        });
    },

    packExpandedCascadeFreeform(canvas, expandedItems, pinnedIds, {
        placed,
        anchor,
        bounds,
        metrics,
        zOrder
    }) {
        const { packW, origin, edgePad, viewportBottom } = bounds;
        const canvasW = Math.max(canvas?.clientWidth || 320, packW + origin * 2);
        const unpinned = expandedItems.filter((item) => item?.id && !pinnedIds.has(item.id));
        if (!unpinned.length) return;

        const sizes = unpinned.map((item) => this.resolveSortItemSize(item, 'grid', true));
        const region = computeAlignRegion({
            packW,
            startX: anchor.startX,
            startY: anchor.startY,
            regionW: anchor.regionW,
            viewportBottom,
            origin,
            edgePad,
            metrics
        });
        let rects = computeCascadeStackRects(sizes, region);

        const nudgeStack = (deltaX, deltaY) => {
            if (!deltaX && !deltaY) return;
            rects = rects.map((rect) => ({
                ...rect,
                x: rect.x + deltaX,
                y: rect.y + deltaY
            }));
        };

        let stackBounds = computeStackBounds(rects);
        if (stackBounds.w > 0 && placed.some((p) => rectsOverlapCore(stackBounds, p, metrics.gap))) {
            const near = this.findFreeformSortSlot(stackBounds.w, stackBounds.h, placed, canvasW, {
                startX: stackBounds.x,
                startY: stackBounds.y,
                direction: 'horizontal'
            });
            nudgeStack(near.x - stackBounds.x, near.y - stackBounds.y);
            stackBounds = computeStackBounds(rects);
        }

        const minX = metrics.origin + metrics.edgePad;
        const minY = minX;
        const rightLimit = canvasW - metrics.edgePad;
        const bottomLimit = viewportBottom - metrics.edgePad;
        if (stackBounds.x < minX) nudgeStack(minX - stackBounds.x, 0);
        if (stackBounds.y < minY) nudgeStack(0, minY - stackBounds.y);
        stackBounds = computeStackBounds(rects);
        if (stackBounds.x + stackBounds.w > rightLimit) {
            nudgeStack(rightLimit - (stackBounds.x + stackBounds.w), 0);
        }
        if (stackBounds.y + stackBounds.h > bottomLimit) {
            nudgeStack(0, bottomLimit - (stackBounds.y + stackBounds.h));
        }

        unpinned.forEach((item, index) => {
            const slot = rects[index];
            if (!slot) return;
            this.saveGridLayout(item.id, slot, { updateRemembered: true });
            const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
            if (card) {
                this.applyNoteRect(card, slot, { settling: true });
                this.assignCascadeCardZ(card, zOrder);
            }
        });

        stackBounds = computeStackBounds(rects);
        if (stackBounds.w > 0) {
            placed.push({
                x: stackBounds.x,
                y: stackBounds.y,
                w: stackBounds.w,
                h: stackBounds.h
            });
        }
    },

    packSortFreeformBoard(canvas, collapsedItems, expandedItems, sortPrefs, pinnedIds) {
        const metrics = getGridMetrics();
        const direction = sortPrefs.direction === 'vertical' ? 'vertical' : 'horizontal';
        const canvasW = Math.max(canvas.clientWidth || 320, 320);
        const minCoord = metrics.origin + metrics.edgePad;
        const placed = [];

        pinnedIds.forEach((id) => {
            const saved = this.getGridLayout()[id];
            if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.w)) {
                placed.push({ x: saved.x, y: saved.y, w: saved.w, h: saved.h });
            }
        });

        const unpinnedCollapsed = collapsedItems.filter((item) => !pinnedIds.has(item.id));
        const unpinnedExpanded = expandedItems.filter((item) => !pinnedIds.has(item.id));
        const { origin, packW, edgePad } = this.getGridBoardBounds(canvas);

        if (sortPrefs.cascade) {
            const zOrder = { next: this.getCascadeZIndexBase(canvas, pinnedIds) };
            this.packCollapsedCascadeFreeform(canvas, collapsedItems, pinnedIds, {
                placed,
                direction,
                minCoord,
                metrics,
                canvasW,
                zOrder
            });

            const collapsedRects = unpinnedCollapsed
                .map((item) => {
                    const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
                    if (!card) return null;
                    return this.readNoteRect(card);
                })
                .filter((rect) => rect && Number.isFinite(rect.x));
            const hasExpandedGap = unpinnedCollapsed.length && unpinnedExpanded.length;
            const expandedAnchor = this.computeExpandedAlignAnchor(
                direction,
                hasExpandedGap ? collapsedRects : [],
                { origin, edgePad, packW, yStart: minCoord, metrics }
            );
            const viewport = getGridViewportBounds(canvas);

            this.packExpandedCascadeFreeform(canvas, expandedItems, pinnedIds, {
                placed,
                anchor: expandedAnchor,
                bounds: { packW, origin, edgePad, viewportBottom: viewport.viewportBottom },
                metrics,
                zOrder
            });
            this.updateBoardCanvasExtents(canvas);
            return;
        }

        const packGroup = (items, startPos) => {
            let cursor = { x: startPos?.x ?? minCoord, y: startPos?.y ?? minCoord };
            items.forEach((item) => {
                if (!item?.id || pinnedIds.has(item.id)) return;
                const isExp = this.isItemLayoutExpanded(item, 'grid');
                const { w, h } = this.resolveSortItemSize(item, 'grid', isExp);
                const slot = this.findFreeformSortSlot(w, h, placed, canvasW, {
                    startX: cursor.x,
                    startY: cursor.y,
                    direction
                });
                this.saveGridLayout(item.id, slot, { updateRemembered: isExp });
                const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
                if (card) {
                    this.applyNoteRect(card, slot, { settling: true });
                }
                placed.push({ ...slot });
                if (direction === 'vertical') {
                    cursor = { x: slot.x, y: slot.y + metrics.strideY + metrics.gap };
                } else {
                    cursor = { x: slot.x + metrics.strideX + metrics.gap, y: slot.y };
                }
            });
            return placed;
        };

        packGroup(collapsedItems, { x: minCoord, y: minCoord });

        const collapsedRects = unpinnedCollapsed
            .map((item) => {
                const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
                if (!card) return null;
                return this.readNoteRect(card);
            })
            .filter((rect) => rect && Number.isFinite(rect.x));
        const hasExpandedGap = unpinnedCollapsed.length && unpinnedExpanded.length;
        const expandedAnchor = this.computeExpandedAlignAnchor(
            direction,
            hasExpandedGap ? collapsedRects : [],
            { origin, edgePad, packW, yStart: minCoord, metrics }
        );

        if (unpinnedExpanded.length) {
            const viewport = getGridViewportBounds(canvas);
            this.packExpandedAlignFreeform(canvas, expandedItems, pinnedIds, {
                placed,
                anchor: expandedAnchor,
                bounds: { packW, origin, edgePad, viewportBottom: viewport.viewportBottom },
                metrics,
                direction
            });
        }
        this.updateBoardCanvasExtents(canvas);
    },

    sortBoardLayout(viewMode, items, sortPrefs, { fileCabinetActive } = {}) {
        const visibleItems = this.getVisibleItems(items || []);
        if (!visibleItems.length) return;

        const mode = 'grid';
        const snapLayout = true;
        const canvas = document.getElementById('app-canvas');
        if (!canvas) return;

        const fcActive = fileCabinetActive ?? isFileCabinetActive();
        let canvasItems = visibleItems;

        if (fcActive) {
            const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, mode, this);
            sortFileCabinetItems(filed, sortPrefs);
            canvasItems = expanded;
        }

        if (!canvasItems.length) {
            window.dispatchEvent(new CustomEvent('board:visibility_changed', {
                detail: { flushLayout: false, skipGridReflow: true }
            }));
            return;
        }

        const { collapsed, expanded } = this.partitionCanvasItemsByExpansion(canvasItems, mode);
        const sortedCollapsed = sortBoardItems(collapsed, sortPrefs);
        const sortedExpanded = sortBoardItems(expanded, sortPrefs);
        const pinnedIds = new Set(this.getBoardPins());

        if (isBoardOverlayEnabled() && sortPrefs.cascade) {
            this.packSortFreeformBoard(canvas, sortedCollapsed, sortedExpanded, sortPrefs, pinnedIds);
        } else {
            this.packSortGridBoard(canvas, sortedCollapsed, sortedExpanded, sortPrefs, pinnedIds);
        }

        window.dispatchEvent(new CustomEvent('board:visibility_changed', {
            detail: { flushLayout: false, skipGridReflow: true }
        }));
    },

    resetBoardLayout(sortBy, items, { fileCabinetActive } = {}) {
        const visibleItems = this.getVisibleItems(items || []);
        const mode = normalizeViewMode(sortBy);

        const boardItems = visibleItems;

        const fcActive = fileCabinetActive ?? isFileCabinetActive();

        if (fcActive) {
            resetFileCabinetLayout(sortBy, items, this);
            return;
        }

        if (mode === 'grid') {
            try {
                localStorage.removeItem(GRID_PINS_KEY);
            } catch {
                /* ignore */
            }
        }

        const canvas = document.getElementById('app-canvas');
        this.repackBoardLayoutStorage(mode, boardItems, canvas);
        window.dispatchEvent(new CustomEvent('board:visibility_changed', {
            detail: { flushLayout: false, skipGridReflow: true }
        }));
    },

    getGridLayout() {
        try {
            return JSON.parse(localStorage.getItem(GRID_LAYOUT_KEY) || '{}');
        } catch {
            return {};
        }
    },

    saveGridLayout(itemId, rect, { updateRemembered = false } = {}) {
        if (!itemId || !rect) return;
        const layout = this.getGridLayout();
        const prev = layout[itemId] || {};
        const item = this.resolveBoardItem(itemId);
        layout[itemId] = this.mergeSpatialLayoutEntry(prev, rect, resolveTileSize(item), { updateRemembered });
        localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
    },

    saveFiledCabinetLayout(itemId, rect, sortBy) {
        saveFiledCabinetLayout(itemId, rect, sortBy);
    },

    saveCompactBoardLayout(itemId, slot, _sortBy) {
        if (!itemId || !slot) return;
        const small = getSmallRect(readTileSmallFootprint());
        const rect = {
            x: Math.round(slot.x),
            y: Math.round(slot.y),
            w: small.w,
            h: small.h
        };

        const layout = this.getGridLayout();
        const gridEntry = this.mergeSpatialLayoutEntry({}, rect, 'small', { updateRemembered: false });
        delete gridEntry.customCompact;
        layout[itemId] = gridEntry;
        localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
    },

    removeGridLayout(itemId) {
        const layout = this.getGridLayout();
        if (!layout[itemId]) return;
        delete layout[itemId];
        localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
    },

    getBoardPins() {
        try {
            const raw = JSON.parse(localStorage.getItem(GRID_PINS_KEY) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch {
            return [];
        }
    },

    getGridPins() {
        return this.getBoardPins();
    },

    isBoardPinned(itemId) {
        return !!itemId && this.getBoardPins().includes(itemId);
    },

    isGridPinned(itemId) {
        return this.isBoardPinned(itemId);
    },

    toggleBoardPin(itemId) {
        if (!itemId) return false;
        const pins = this.getBoardPins();
        const idx = pins.indexOf(itemId);
        if (idx >= 0) {
            pins.splice(idx, 1);
        } else {
            pins.push(itemId);
        }
        localStorage.setItem(GRID_PINS_KEY, JSON.stringify(pins));
        return idx < 0;
    },

    toggleGridPin(itemId) {
        return this.toggleBoardPin(itemId);
    },

    getGridBoardBounds(canvas) {
        return getGridBoardBounds(canvas);
    },

    getDesktopBoardPane(canvas) {
        return getDesktopBoardPane(canvas);
    },

    ensureDesktopBoardPane(canvas) {
        return ensureDesktopBoardPane(canvas);
    },

    scheduleBoardCanvasExtents(canvas) {
        scheduleBoardCanvasExtentsCore(canvas, (c) => this.updateBoardCanvasExtents(c));
    },

    updateBoardCanvasExtents(canvas) {
        updateBoardCanvasExtentsCore(canvas, {
            readCardRect: (card) => readNoteRectCore(card, noteRectHooks(this, card))
        });
    },

    updateDesktopScrollPolicy(canvas) {
        updateDesktopScrollPolicy(canvas);
    },

    applyDesktopSize(card) {
        if (!isDesktopCard(card)) return;
        if (card.dataset.tierResizePreview === '1') return;
        const saved = this.getGridLayout()[card.dataset.id];
        const item = this.resolveBoardItem(card.dataset.id);
        let w;
        let h;
        if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
            const tileSize = this.getCardTileSize(card, item);
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
            const compact = this.gridTileRect(
                this.getCardTileSize(card, item),
                { x: 0, y: 0, w: getGridMetrics().cellW, h: getGridMetrics().cellH },
                saved
            );
            w = compact.w;
            h = compact.h;
        }
        this.applyFreeformDimensions(card, w, h);
    },

    clampGridResize(w, h, { packW } = {}) {
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
    },

    computeGridBoardLayout(canvas, actorId, actorRect = null) {
        return computeGridBoardLayoutCore(createGridDeps(this), canvas, actorId, actorRect);
    },

    clearSnapPanelPreview(panelEl) {
        clearSnapPanelPreview(panelEl);
    },

    applyGridBoardLayout(canvas, layout, opts = {}) {
        return applyGridBoardLayoutCore(createGridDeps(this), canvas, layout, opts);
    },

    clearGridLayoutPreview(canvas) {
        clearSnapPanelPreview(canvas);
    },

    findDesktopCenterSlot(w, h, canvas, viewMode, { excludeId = null } = {}) {
        const host = canvas || document.getElementById('app-canvas');
        if (!host) return { x: 8, y: 8, w, h };
        const mode = viewMode || activeBoardViewMode;

        if (isSnapLayoutMode(mode)) {
            const { origin, packW, maxH, edgePad } = this.getGridBoardBounds(host);
            const { viewportH, scrollY } = getGridViewportBounds(host);
            let rect = {
                x: origin + Math.max(0, (packW - w) / 2),
                y: origin + scrollY + Math.max(0, (viewportH - h) / 2),
                w,
                h
            };
            rect = this.snapNoteRect(rect, { maxW: packW, maxH, origin, edgePad });
            const placed = [...host.querySelectorAll('.mini-card[data-desktop="1"]')]
                .filter((c) => c.dataset.id !== excludeId && !c.closest('#file-cabinet'))
                .map((c) => this.readNoteRect(c));
            if (placed.some((p) => rectsOverlapCore(rect, p))) {
                rect = findNearestGridSlotCore(rect, w, h, placed, { packW, origin, maxH, edgePad });
            }
            return rect;
        }

        const zoom = parseFloat(host.dataset?.desktopZoom) || 1;
        const pad = 8;
        const cw = (host.clientWidth || window.innerWidth) / zoom;
        const ch = (host.clientHeight || window.innerHeight) / zoom;
        const scrollLeft = (host.scrollLeft || 0) / zoom;
        const scrollTop = (host.scrollTop || 0) / zoom;
        return {
            x: scrollLeft + Math.max(pad, (cw - w) / 2),
            y: scrollTop + Math.max(pad, (ch - h) / 2),
            w,
            h
        };
    },

    updateGridScrollPolicy(canvas, { forcing = false } = {}) {
        if (!canvas?.classList.contains('view-grid')) return;
        canvas.classList.toggle('is-grid-forcing', forcing);
        this.scheduleBoardCanvasExtents(canvas);
        this.updateDesktopScrollPolicy(canvas);
    },

    reflowGridBoard(canvas, actorId, opts = {}) {
        reflowGridBoardCore(createGridDeps(this), canvas, actorId, opts);
    },

    repackBoardLayoutStorage(mode, items, canvas) {
        const resolvedMode = normalizeViewMode(mode);
        const small = getSmallRect(readTileSmallFootprint());
        const sorted = [...(items || [])].sort((a, b) => {
            const aTime = Number(a.created_at || a.updated_at || 0);
            const bTime = Number(b.created_at || b.updated_at || 0);
            return aTime - bTime;
        });
        const bounds = canvas ? this.getGridBoardBounds(canvas) : null;
        const metrics = getGridMetrics();
        const origin = bounds?.origin ?? metrics.origin;
        const packW = bounds?.packW ?? Math.max(metrics.canvasGridW, 640);
        const maxH = bounds?.maxH ?? origin + metrics.strideY * 40;
        const edgePad = bounds?.edgePad ?? metrics.edgePad;
        const placed = [];

        sorted.forEach((item) => {
            if (!item?.id) return;
            ensureSmallTile(item);
            let slot = findFirstCanvasSlotCore(small.w, small.h, placed, packW + origin * 2, { origin, edgePad });
            slot = this.snapNoteRect(
                { ...slot, w: small.w, h: small.h },
                { maxW: packW, maxH, origin, edgePad }
            );
            placed.push(slot);
            this.saveCompactBoardLayout(item.id, slot, resolvedMode);
        });
    },

    initDesktopCardStack(card, orderIndex = 0) {
        if (!isDesktopCard(card)) return;
        const z = orderIndex + 1;
        card.style.setProperty('z-index', String(z), 'important');
        syncDesktopStackSeq(z);
    },

    raiseDesktopCard(card) {
        if (!isDesktopCard(card)) return;
        raiseDesktopElement(card);
        const frontClass = 'is-grid-front';
        card.classList.add(frontClass);
        card.closest('#app-canvas')?.querySelectorAll(`.mini-card.${frontClass}`).forEach((other) => {
            if (other !== card) other.classList.remove(frontClass);
        });
    },

    snapNotePosition(rect, opts) {
        return snapNotePositionCore(rect, opts);
    },

    snapNoteRect(rect, opts) {
        return snapNoteRectCore(rect, opts);
    },

    readNoteRect(card) {
        return readNoteRectCore(card, noteRectHooks(this, card));
    },

    applyNoteRect(card, rect, { settling = false } = {}) {
        applyNoteRectCore(card, rect, {
            settling,
            applyDimensions: (c, w, h) => this.applyFreeformDimensions(c, w, h)
        });
    },

    getCollapsedCategories() {
        try {
            return JSON.parse(localStorage.getItem('matrix_collapsed_categories') || '[]');
        } catch {
            return [];
        }
    },

    isCategoryCollapsed(categoryName) {
        return this.getCollapsedCategories().includes(categoryName);
    },

    toggleCategoryCollapsed(categoryName) {
        const collapsed = this.getCollapsedCategories();
        const idx = collapsed.indexOf(categoryName);
        if (idx >= 0) {
            collapsed.splice(idx, 1);
        } else {
            collapsed.push(categoryName);
        }
        localStorage.setItem('matrix_collapsed_categories', JSON.stringify(collapsed));
        return idx < 0;
    }
};
