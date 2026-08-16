import { mountFloatChrome } from './desktopFloatChrome.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
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
    resetFileCabinetLayout,
    prepareBoardItems,
    sortBoardLayoutWithFileCabinet
} from './fileCabinet.js';
import { sortBoardItems } from './boardSort.js';
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
    getGridSnapMinH,
    resolveExpandedDefaultRect as geoResolveExpandedDefaultRect,
    isAtOrBelowCompactZone as geoIsAtOrBelowCompactZone,
    inferTileTier as geoInferTileTier,
    resolveCollapsedTierRect as geoResolveCollapsedTierRect,
    clampSpatialSize as geoClampSpatialSize,
    readRememberedSize as geoReadRememberedSize,
    resolveSpatialFallbackRect as geoResolveSpatialFallbackRect
} from './tileGeometry.js';
import { NoteSurface } from './noteSurface.js';
import { BoardOperations } from './boardOperations.js';
import { NotePopoutBridge } from './notePopoutBridge.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import {
    applyItemCardTheme,
    applyCardCategoryBand,
    createCardComponent,
    renderBoardEditorCard,
    refreshBoardChecklistBody,
    refreshBoardEditorCard
} from './noteSurfaceHtml.js';
import { DesktopManager } from './desktopManager.js';
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
    getLiveBoardBounds,
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
    snapNotePosition as snapNotePositionCore,
    snapNoteRect as snapNoteRectCore,
    readNoteRect as readNoteRectCore,
    applyNoteRect as applyNoteRectCore,
    findFirstCanvasSlot as findFirstCanvasSlotCore,
    findNearestGridSlot as findNearestGridSlotCore,
    rectsOverlap as rectsOverlapCore
} from './board/noteGeometry.js';
import {
    computeGridBoardLayout as computeGridBoardLayoutCore,
    applyGridBoardLayout as applyGridBoardLayoutCore,
    reflowGridBoard as reflowGridBoardCore,
    clearSnapPanelPreview,
    computeBoardLayout
} from './board/gridEngine.js';

// Global state for board items lookup
let boardItemsById = new Map();
let activeBoardViewMode = 'grid';

/** How much of the available space the aligned expanded block should cover (tunable). */
const ALIGN_SIZE_FACTOR = 0.8;

function ensureSmallTile(item) {
    if (!NoteSurface.canEditInline() || resolveTileSize(item) === 'small') return;
    NoteSurface.mutateItem(item, (it) => { it.tileSize = 'small'; }, { preserveView: true, skipRerender: true });
    item.tileSize = 'small';
    boardItemsById.set(item.id, item);
}

function updateBoardItemsMap(item) {
    if (item?.id) {
        boardItemsById.set(item.id, item);
    }
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

export function isDesktopCard(card) {
    // A card is a "desktop card" if it's on the active desktop
    // This allows spatial behavior (drag, resize, etc.) to work on any active desktop
    const cardDesktop = card?.dataset?.desktop;
    const activeDesktop = DesktopManager.getActiveDesktop();
    return cardDesktop === String(activeDesktop);
}

export const UI = {
    flushAllInlineEditsFromCanvas(canvas, items, { forceFlush = false, skipItemId = null } = {}) {
        if (!canvas || !Array.isArray(items)) return;
        const byId = new Map(items.map((item) => [item.id, item]));
        const activeDesktop = DesktopManager.getActiveDesktop();
        canvas.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`).forEach((card) => {
            const item = byId.get(card.dataset.id);
            if (!item) return;
            // While the modal editor owns this note, its board card DOM is stale.
            // Flushing it would overwrite the modal's saved content with old HTML.
            if (skipItemId && item.id === skipItemId) return;
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
        return this.getGridLayout()[id] || null;
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
        const layout = this.getGridLayout();
        const prev = layout[itemId] || {};
        layout[itemId] = {
            ...prev,
            rememberedW: Math.round(clamped.w),
            rememberedH: Math.round(clamped.h)
        };
        localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
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

    saveTileLayoutFromCard(card, item, rect, tileSize) {
        const id = item?.id || card.dataset.id;
        if (!id || !isDesktopCard(card)) return;
        const updateRemembered = !isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item));
        this.saveGridLayout(id, rect, { updateRemembered });
    },

    saveSpatialLayoutFromResize(card, item, tileSize) {
        if (!card || !item) return;
        const rect = this.readNoteRect(card);
        this.saveTileLayoutFromCard(card, item, rect, tileSize || resolveTileSize(item));
    },

    collapseSnapPanelCard(card, item) {
        this.finalizeDesktopCard(card);
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
            // Only reflow on expand, never on collapse — collapsing must not rearrange neighbors
            if (!isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item))) {
                const reflowOpts = { animate: true };
                if (ctx.actorRect) reflowOpts.actorRect = ctx.actorRect;
                requestAnimationFrame(() => this.reflowGridBoard(canvas, item.id, reflowOpts));
            }
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
            // Use resolveBoardExpandRect to keep the current position and restore remembered size,
            // instead of resolveBoardExpandPlacement which placed the card at the viewport center.
            const rect = this.resolveBoardExpandRect(card, item);
            this.applySpatialToggleRect(card, item, rect, { ...ctx, actorRect: rect });
            this.raiseDesktopCard(card);
            requestAnimationFrame(() => {
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
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
        const activeDesktop = DesktopManager.getActiveDesktop();
        canvas.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`).forEach((card) => {
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
        requestAnimationFrame(() => this.reflowGridBoard(canvas, null, { animate: true }));
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
            rect = this.snapNoteRect(rect, { maxW: packW, maxH, origin, edgePad });
            this.applyNoteRect(card, rect, { settling: false });
            this.saveTileLayoutFromCard(card, item, rect, this.getCardTileSize(card, item));
            this.finalizeDesktopCard(card);
        });

        this.scheduleBoardCanvasExtents(canvas);
        requestAnimationFrame(() => this.reflowGridBoard(canvas, null, { animate: true }));
        if (isFileCabinetActive()) {
            window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
        }
    },

    clampNoteToBoardEdges(rect, opts) {
        return clampNoteToBoardEdgesCore(rect, opts);
    },

    // Preserve a saved card's position VERBATIM — never clamp to packW/maxH.
    // This allows cards saved beyond the visible width to overflow naturally,
    // producing a horizontal scrollbar on zoom-in instead of being forced
    // back inside the (shrinking) packing width.
    preserveSavedBoardRect(rect) {
        if (!rect) return rect;
        return {
            x: Math.max(0, rect.x),
            y: Math.max(0, rect.y),
            w: rect.w,
            h: rect.h
        };
    },

    gridBoardRectForCard(card, savedRect, isExpanded, itemId = null) {
        // 1. Safely resolve the ID whether a card exists or the ID is passed directly
        const id = itemId || card?.dataset?.id;
        
        // 2. Safely resolve the base rect
        const base = savedRect && Number.isFinite(savedRect.x) && Number.isFinite(savedRect.w)
            ? { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h }
            : (card ? this.readNoteRect(card) : { x: 0, y: 0, w: 0, h: 0 });

        if (isExpanded) {
            const item = this.resolveBoardItem(id);
            const tileSize = this.getCardTileSize(card, item);
            const expandedMin = geoResolveExpandedDefaultRect(tileSize, savedRect);
            if (base.w >= expandedMin.w && base.h >= expandedMin.h) return base;
            return {
                ...base,
                w: expandedMin.w,
                h: expandedMin.h
            };
        }
        
        const item = this.resolveBoardItem(id);
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
        return isDesktopCard(card);
    },

    updateSingleCard(canvas, item, hiddenCategories = []) {
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

        renderBoardEditorCard(this, card, item, activeCategories, targetCatName, categoryColor);
        applyItemCardTheme(card, item);
        applyCardCategoryBand(card, categoryColor);
        this.finalizeDesktopCard(card);

        // Restore canvas scroll position after full re-render
        canvas.scrollTop = canvasScrollTop;
        canvas.scrollLeft = canvasScrollLeft;

        return true;
    },

    updateBoardItemsMap(item) {
        updateBoardItemsMap(item);
    },

    render(canvas, items, viewMode, hiddenCategories = [], renderOptions = {}) {
        if (!canvas) return;
        // Clear stale map references before destroying DOM elements
        boardItemsById.clear();
        this.prepareCanvas(canvas);
         
        const safeItems = Array.isArray(items) ? items : [];
        const visibleItems = BoardOperations.getVisibleItems(safeItems);
        boardItemsById = new Map(visibleItems.map((item) => [item.id, item]));

        const activeCategories = this.getActiveCategories(hiddenCategories);
         
        const { resolvedMode, fileCabinetActive } = this.getViewState();
        this.applyCanvasClasses(canvas, fileCabinetActive);

        // Always refresh FC for the active desktop before empty-state.
        // FC lives outside #app-canvas; skipping this left the previous desktop's tabs.
        const { boardItems } = this.prepareBoardItems(visibleItems, fileCabinetActive, resolvedMode, activeCategories);

        if (boardItems.length === 0) {
            this.renderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems);
            return;
        }

        const { boardPane } = this.layoutBoard(canvas, boardItems, activeCategories);
        this.finalizeRender(canvas, boardPane, renderOptions);
    },

    prepareCanvas(canvas) {
        // Clean up document-level event listeners from checklist drag operations
        // before wiping the DOM to prevent memory leaks and orphaned handlers
        canvas.querySelectorAll('[data-checklistdrag-bound]').forEach((root) => {
            if (root._checklistDragData) {
                const { onMove, onUp } = root._checklistDragData;
                if (onMove) document.removeEventListener('pointermove', onMove);
                if (onUp) {
                    document.removeEventListener('pointerup', onUp);
                    document.removeEventListener('pointercancel', onUp);
                }
                document.body.classList.remove('is-checklist-dragging');
                delete root._checklistDragData;
            }
        });
        canvas.innerHTML = '';
    },

    getActiveCategories(hiddenCategories) {
        let activeCategories = readStoredCategories();
        return activeCategories.filter(cat => !hiddenCategories.includes(cat.name));
    },

    getViewState() {
        const resolvedMode = 'grid';
        const snapLayout = true;
        const fileCabinetActive = isFileCabinetActive();
        const activeBoardViewMode = 'grid';
        return { resolvedMode, snapLayout, fileCabinetActive, activeBoardViewMode };
    },

    applyCanvasClasses(canvas, fileCabinetActive) {
        canvas.className = 'view-grid';
        if (fileCabinetActive) canvas.classList.add('file-cabinet-bottom');
        delete canvas.dataset.focusActive;
    },

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
    },

    renderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems) {
        if (fileCabinetActive && visibleItems.length > 0) {
            return;
        }
        const hiddenCount = safeItems.length - BoardOperations.getVisibleItems(safeItems).length;
        if (safeItems.length > 0 && hiddenCount === safeItems.length) {
            canvas.innerHTML = `<div class="system-status-msg">Add new note</div>`;
        } else {
            canvas.innerHTML = `<div class="system-status-msg">Workspace clean. Click "+ New" to commit an entity.</div>`;
        }
    },

    layoutBoard(canvas, boardItems, activeCategories) {
        const bounds = this.getGridBoardBounds(canvas);
        const boardPane = document.createElement('div');
        boardPane.className = DESKTOP_BOARD_PANE_CLASS;
        canvas.appendChild(boardPane);

        // Compute layout using pure function
        const { layout, placed, placedById } = computeBoardLayout(this, boardItems, bounds, {
            getLayout: () => this.getGridLayout(),
            isExpanded: (id) => this.isSavedLayoutExpanded(id),
            resolveSpatialSize: (card, item) => this.resolveRememberedSpatialSize(card, item),
            getTileDefaultRect: geoGetTileDefaultRect,
            resolveTileSize,
            findSlot: findFirstCanvasSlotCore,
            snapRect: (rect, opts) => this.snapNoteRect(
                this.gridBoardRectForCard(null, rect, this.isSavedLayoutExpanded(opts.itemId), opts.itemId),
                opts
            ),
            clampRect: (rect) => this.preserveSavedBoardRect(rect)
        });

        // Apply layout to DOM — look up by id, never by list index.
        // `placed` is spatially sorted; `boardItems` is not, so zipping them
        // would swap every card the moment the item list order diverged
        // (e.g. dragging a note in from the File Cabinet).
        boardItems.forEach((item, index) => {
            const card = createCardComponent(this, item, activeCategories);
            const rect = placedById.get(item.id) ?? placed[index];
            const saved = layout[item.id];

            this.applyNoteRect(card, rect, { settling: false });
            if (!saved) {
                this.saveGridLayout(item.id, rect);
            }

            card.removeAttribute('draggable');
            this.finalizeDesktopCard(card);
            this.initDesktopCardStack(card, index);
            this.syncBoardPinClass(card);
            boardPane.appendChild(card);
        });

        return { layout, placed, boardPane };
    },

    renderCards(boardItems, activeCategories, layout, placed, boardPane) {
        // This is handled in layoutBoard now
    },

    finalizeRender(canvas, boardPane, renderOptions) {
        this.updateBoardCanvasExtents(canvas);
        // Cards are already placed at their saved positions by layoutBoard.
        // Do NOT run the push-resolution reflow here: with actorId=null it
        // re-packs every card and re-saves, clobbering the user's saved
        // positions on every reload. Only update scroll policy (non-destructive).
        if (!renderOptions.skipGridReflow && !isBoardOverlayEnabled()) {
            this.updateGridScrollPolicy(canvas, { forcing: false });
        }
    },

    buildCardActionsHtml(item, isExpanded = false, options = {}) {
        return NoteSurface.buildNoteQuickActionsHtml(item, {
            surface: 'board',
            isExpanded,
            calHidden: BoardOperations.isHiddenFromCalendar(item),
            poppedOut: NotePopoutBridge.isPoppedOut(item?.id),
            ...options
        });
    },

    syncCalendarButtonUI(item, btn) {
        if (!btn || !item) return;
        const hidden = BoardOperations.isHiddenFromCalendar(item);
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

        const canvas = card.closest('#app-canvas');

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else {
            this.applyDesktopSize(card);
        }

        this.finalizeDesktopCard(card);

        if (canvas) {
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, item.id, { animate: true });
            });
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
        const activeDesktop = DesktopManager.getActiveDesktop();
        canvas.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`).forEach((card) => {
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

        const visible = BoardOperations.getVisibleItems(Array.isArray(items) ? items : []);
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

    resolveSortItemSize(item, mode, isExpanded, alignedSize = null) {
        const tileSize = resolveTileSize(item);
        const saved = getStoredItemSize(item.id, mode, this);
        if (isExpanded) {
            if (alignedSize) return { w: alignedSize.w, h: alignedSize.h };
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

    /**
     * Compute one uniform size for every expanded note so the expanded block
     * fills the page as a symmetric grid. The number of columns adapts to how
     * many expanded notes there are (2 → split screen, 4 → 2×2, 9 → 3×3, …)
     * while each note stays above a usable minimum width and fits packW.
     * Returns a cell-aligned size (plus the column count) so the grid can be
     * placed deterministically without grid-snap drift.
     */
    resolveAlignedExpandedSize(packW, count, minNoteW = getLargeDefaultRect().w) {
        const metrics = getGridMetrics();
        const gap = metrics.gap;
        const n = Math.max(1, Number(count) || 1);
        const availW = Math.max(metrics.columnMinInnerW, packW * ALIGN_SIZE_FACTOR);

        let cols = Math.ceil(Math.sqrt(n));
        const maxCols = Math.max(1, Math.floor((availW + gap) / (minNoteW + gap)));
        cols = Math.max(1, Math.min(cols, maxCols));

        const maxSpan = Math.floor((availW - (cols - 1) * gap) / cols);
        const cellsPer = Math.max(1, Math.floor((maxSpan + gap) / (metrics.cellW + gap)));
        const w = gridCellsToSpanW(cellsPer);
        const large = getLargeDefaultRect();
        const h = Math.max(metrics.cellS, Math.round((w * large.h) / large.w));
        return { w, h, cols };
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

    packGridBoard(canvas, collapsedItems, expandedItems, {
        pinnedIds = new Set(),
        layoutMode = 'grid',
        direction = 'horizontal',
        persistOnly = false,
        animate = true,
        save = true,
        itemsById = null,
        alignSize = false
    } = {}) {
        const { origin, packW, maxH, edgePad } = this.getLiveBoardBounds(canvas);
        const dir = direction === 'vertical' ? 'vertical' : 'horizontal';
        const placed = [];
        const layout = new Map();
        const snapBounds = { maxW: packW, maxH, origin, edgePad };
        const resolveItem = (id) => (itemsById?.get(id) ?? this.resolveBoardItem(id));

        // When "Align size" is on, every expanded note shares one uniform size
        // computed to fill the page as a symmetric grid (see resolveAlignedExpandedSize).
        const alignedExpandedSize = alignSize
            ? this.resolveAlignedExpandedSize(packW, expandedItems.length)
            : null;
        const expandedSizeFor = (item, isExp) => this.resolveSortItemSize(item, layoutMode, isExp, alignedExpandedSize);

        pinnedIds.forEach((id) => {
            const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
            const saved = this.getGridLayout()[id];
            if (!saved || !Number.isFinite(saved.x)) return;
            const item = resolveItem(id);
            const isExp = this.isItemLayoutExpanded(item, layoutMode);
            const rect = this.snapNoteRect(
                card
                    ? this.gridBoardRectForCard(card, saved, isExp)
                    : { ...saved, ...expandedSizeFor(item, isExp) },
                snapBounds
            );
            layout.set(id, rect);
            placed.push({ ...rect });
        });

        const unpinnedCollapsed = collapsedItems.filter((item) => !pinnedIds.has(item.id));
        const unpinnedExpanded = expandedItems.filter((item) => !pinnedIds.has(item.id));

        // Unified layout: collapsed notes form a tight zero-gap grid, then the
        // expanded notes fill their own block after them (never covering them).
        // With Align size ON, expanded notes share one uniform size (alignedSize);
        // otherwise each keeps its real {w,h}.
        const collapsedSizeForSet = unpinnedCollapsed.map((item) => ({ id: item.id }));
        const expandedSizeForSet = unpinnedExpanded.map((item) => ({
            id: item.id,
            ...expandedSizeFor(item, this.isItemLayoutExpanded(item, layoutMode))
        }));

        const packedBoardRects = this.packBoardGridRects(collapsedSizeForSet, expandedSizeForSet, {
            alignedSize: alignSize && alignedExpandedSize ? alignedExpandedSize : null,
            placed,
            origin,
            packW,
            maxH,
            edgePad,
            direction: dir
        });
        packedBoardRects.forEach(({ id, rect }) => layout.set(id, rect));

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

    /**
     * Unified board-layout packer used whenever the board is re-arranged by
     * sort/reset. Collapsed notes are placed on a strict zero-gap compact grid
     * (adjacent tiles, rows and columns) so they read as one solid block in
     * both horizontal and vertical sort directions. Expanded notes are placed
     * in their own block after the collapsed set (below for horizontal, right
     * for vertical) so they never cover collapsed notes:
     *  - alignedSize provided → every expanded note gets that uniform size.
     *  - alignedSize null      → each expanded note keeps its real {w,h}.
     * Positions are computed directly on tile strides (no grid-snap drift).
     *
     * @param {Array} collapsedItems
     * @param {Array<{id:string,w:number,h:number}>} expandedItems
     * @param {{w:number,h:number,cols:number}|null} alignedSize
     * @param {{placed?:Array<{x,y,w,h}>, origin?:number, packW:number, maxH?:number, edgePad?:number, direction?:string}} opts
     * @returns {Array<{id:string, rect:{x,y,w,h}}>}
     */
    packBoardGridRects(collapsedItems, expandedItems, {
        alignedSize = null,
        placed = [],
        origin = CANVAS_LAYOUT_ORIGIN,
        packW,
        maxH = Infinity,
        edgePad = 0,
        direction = 'horizontal'
    } = {}) {
        const metrics = getGridMetrics();
        const gap = metrics.gap;
        const startX = origin + edgePad;
        const startY = origin + edgePad;
        const small = getSmallRect(readTileSmallFootprint());
        const rects = [];
        const collapsedRects = [];
        // Pinned rects are the only obstacles for the collapsed grid: collapsed
        // tiles sit edge-to-edge (zero gap) and would falsely self-overlap under
        // rectsOverlap, so they are never checked against each other.
        const pinnedRects = placed.slice();
        const allPlaced = [...pinnedRects];

        // --- collapsed: strict zero-gap compact grid -------------------------
        const maxCols = Math.max(1, Math.floor(packW / small.w));
        let col = 0;
        let row = 0;
        (collapsedItems || []).forEach((item) => {
            let guard = 0;
            while (guard < 100000) {
                const candidate = {
                    x: startX + col * small.w,
                    y: startY + row * small.h,
                    w: small.w,
                    h: small.h
                };
                if (!pinnedRects.some((p) => rectsOverlapCore(candidate, p, gap))) {
                    collapsedRects.push(candidate);
                    rects.push({ id: item.id, rect: candidate });
                    allPlaced.push({ ...candidate });
                    col += 1;
                    break;
                }
                col += 1;
                if (col >= maxCols) {
                    col = 0;
                    row += 1;
                }
                guard += 1;
            }
        });

        const collapsedBottom = collapsedRects.length
            ? collapsedRects.reduce((m, r) => Math.max(m, r.y + r.h), startY)
            : startY;
        const collapsedRight = collapsedRects.length
            ? collapsedRects.reduce((m, r) => Math.max(m, r.x + r.w), startX)
            : startX;
        const dir = direction === 'vertical' ? 'vertical' : 'horizontal';

        // Expanded block always starts below the collapsed set (left-aligned)
        // regardless of sort direction — direction only affects internal ordering.
        // The block is given a small inset for visual separation from the borders.
        const exStartX = startX + edgePad;
        const exStartY = collapsedBottom + gap + edgePad * 2;

        // --- expanded: own block after the collapsed set ----------------------
        if (alignedSize) {
            const { w, h } = alignedSize;
            const colStride = w + gap;
            const rowStride = h + gap;
            // Cap columns at the computed grid width (which already fits ~80% of
            // the available space) rather than letting it fill packW edge-to-edge.
            const exMaxCols = Math.max(1, alignedSize.cols);
            let ec = 0;
            let er = 0;
            (expandedItems || []).forEach((item) => {
                let guard = 0;
                while (guard < 20000) {
                    const candidate = {
                        x: exStartX + ec * colStride,
                        y: exStartY + er * rowStride,
                        w,
                        h
                    };
                    if (candidate.x + candidate.w <= startX + packW + 1
                        && !allPlaced.some((p) => rectsOverlapCore(candidate, p, gap))) {
                        rects.push({ id: item.id, rect: candidate });
                        allPlaced.push({ ...candidate });
                        ec += 1;
                        if (ec >= exMaxCols) {
                            ec = 0;
                            er += 1;
                        }
                        break;
                    }
                    ec += 1;
                    if (ec >= exMaxCols) {
                        ec = 0;
                        er += 1;
                    }
                    guard += 1;
                }
            });
        } else {
            (expandedItems || []).forEach((item) => {
                const slot = findFirstCanvasSlotCore(item.w, item.h, allPlaced, packW + origin * 2, {
                    origin,
                    edgePad,
                    xMin: exStartX,
                    yMin: exStartY,
                    maxH,
                    direction: dir
                });
                rects.push({ id: item.id, rect: slot });
                allPlaced.push({ ...slot });
            });
        }

        return rects;
    },

    packSortGridBoard(canvas, collapsedItems, expandedItems, sortPrefs, pinnedIds) {
        const direction = sortPrefs.direction === 'vertical' ? 'vertical' : 'horizontal';
        this.packGridBoard(canvas, collapsedItems, expandedItems, {
            pinnedIds,
            layoutMode: 'grid',
            direction,
            persistOnly: false,
            animate: true,
            save: true,
            alignSize: sortPrefs.alignSize === true
        });
    },

    sortBoardLayout(viewMode, items, sortPrefs, { fileCabinetActive } = {}) {
        const visibleItems = BoardOperations.getVisibleItems(items || []);
        if (!visibleItems.length) return;

        const mode = normalizeViewMode(viewMode);
        const canvas = document.getElementById('app-canvas');
        if (!canvas) return;

        const canvasItems = sortBoardLayoutWithFileCabinet(visibleItems, mode, sortPrefs, this);

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

        this.packSortGridBoard(canvas, sortedCollapsed, sortedExpanded, sortPrefs, pinnedIds);

        window.dispatchEvent(new CustomEvent('board:visibility_changed', {
            detail: { flushLayout: false, skipGridReflow: true }
        }));
    },

    resetBoardLayout(sortBy, items, { fileCabinetActive } = {}) {
        const visibleItems = BoardOperations.getVisibleItems(items || []);
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

    getLiveBoardBounds(canvas) {
        return getLiveBoardBounds(canvas);
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

        const { origin, packW, maxH, edgePad } = this.getGridBoardBounds(host);
        const { viewportH, scrollY } = getGridViewportBounds(host);
        const activeDesktop = DesktopManager.getActiveDesktop();
        let rect = {
            x: origin + Math.max(0, (packW - w) / 2),
            y: origin + scrollY + Math.max(0, (viewportH - h) / 2),
            w,
            h
        };
        rect = this.snapNoteRect(rect, { maxW: packW, maxH, origin, edgePad });
        const placed = [...host.querySelectorAll(`.mini-card[data-desktop="${activeDesktop}"]`)]
            .filter((c) => c.dataset.id !== excludeId && !c.closest('#file-cabinet'))
            .map((c) => this.readNoteRect(c));
        if (placed.some((p) => rectsOverlapCore(rect, p))) {
            rect = findNearestGridSlotCore(rect, w, h, placed, { packW, origin, maxH, edgePad });
        }
        return rect;
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
        const bounds = canvas ? this.getLiveBoardBounds(canvas) : null;
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

            this.saveCompactBoardLayout(item.id, { x, y, w: small.w, h: small.h }, resolvedMode);
            col += 1;
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
