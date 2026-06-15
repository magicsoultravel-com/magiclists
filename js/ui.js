import {
    categoryKey,
    isUncategorizedCategory,
    readStoredCategories,
    UNCATEGORIZED_CATEGORY
} from './categories.js';
import { applyCardTheme } from './cardTheme.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor, THEME_DEFAULT_COLOR } from './colorPicker.js';
import {
    itemToPlainCopyText
} from './noteBodyConversion.js';
import { stripRichText } from './richText.js';
import {
    clearExpandedCards,
    clearViewSessionExpanded,
    getExpandedCards,
    persistViewSession,
    restoreViewSession,
    setExpandedCard,
    setExpandedCardsMap,
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
    getFileCabinetFiledCategories
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
import { copyPlainTextToClipboard } from './clipboard.js';

import { NoteSurface } from './noteSurface.js';

export { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS, DRAWING_ICONS } from './icons.js';
export {
    deriveNoteTitle,
    createNoteId,
    noteHasSavableContent,
    formatLocalDateTimeParts,
    defaultStartDateTimeNow,
    normalizeItemForSave
} from './noteModel.js';

const UNCATEGORIZED_COLOR = '#64748b';

const GRID_LAYOUT_KEY = 'matrix_grid_layout';
const GRID_PINS_KEY = 'matrix_grid_pins';
const GRID_EXPANDED_KEY = 'matrix_grid_expanded_id';
const DESKTOP_BOARD_PANE_CLASS = 'desktop-board-pane';
const boardExtentsFrames = new WeakMap();

let boardItemsById = new Map();
let activeBoardViewMode = 'grid';

export function isSnapLayoutMode(mode) {
    return normalizeViewMode(mode) === 'grid';
}

export function isDesktopCard(card) {
    return card?.dataset?.desktop === '1';
}

export function computeNoteSizeKb(item) {
    if (!item) return '0';
    const payload = {
        title: item.title || '',
        content: item.content || '',
        steps: item.steps || [],
        type: item.type || 'note',
        categories: item.categories || []
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (bytes === 0) return '0';
    const kb = bytes / 1024;
    if (kb < 0.1) return '<0.1';
    return kb < 10 ? kb.toFixed(1) : String(Math.round(kb));
}

export function computeNoteLineCount(item) {
    if (!item) return 0;
    let count = 0;
    const countText = (text) => {
        const plain = stripRichText(text || '');
        if (!plain) return;
        count += plain.split(/\r?\n/).length;
    };
    countText(item.content);
    for (const step of item.steps || []) countText(step.text);
    return count;
}

export function formatNoteLineCount(n) {
    return n === 1 ? '1 line' : `${n} lines`;
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

    readExpandedCardsForMode(mode = activeBoardViewMode) {
        return getExpandedCards(mode);
    },


    isCardExpanded(card, item) {
        if (isDesktopCard(card)) {
            return !this.isSpatiallyCollapsed(card);
        }
        if (card?.classList.contains('expanded')) return true;
        return getExpandedCards(activeBoardViewMode)[item?.id] === true;
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
            localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
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
        card.classList.remove('compact', 'tile-label', 'tile-compact', 'tile-note', 'tile-small', 'tile-large');
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
        card.classList.remove('expanded');
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
                card.classList.add('is-editing-inline');
                this.syncSpatialChromeForEditing(card);
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
        card.classList.remove('expanded', 'card-state-changing', 'card-animating');
        this.finalizeDesktopCard(card);
    },

    saveTileLayoutFromCard(card, item, rect, tileSize) {
        const id = item?.id || card.dataset.id;
        if (!id || !isDesktopCard(card)) return;
        const updateRemembered = !isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item));
        if (isSnapLayoutMode(activeBoardViewMode)) {
            this.saveGridLayout(id, rect, { updateRemembered });
        } else {
            this.saveFreeformSize(id, rect.w, rect.h, { updateRemembered });
            this.saveFreeformPosition(id, rect.x, rect.y);
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
        if (isSnapLayoutMode(activeBoardViewMode) && canvas?.classList.contains('view-grid')) {
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
                this.raiseGridBoardCard(card);
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
        const inFileCabinet = !!card.closest('#file-cabinet');

        if (inFileCabinet) {
            removeFromFileCabinetOrder(item.id);
            let rect = this.resolveBoardExpandRect(card, item);
            const savedGrid = this.getGridLayout()[item.id];
            const savedPos = this.getFreeformPositions()[item.id];
            const x = savedGrid?.x ?? savedPos?.x ?? 8;
            const y = savedGrid?.y ?? savedPos?.y ?? 8;
            rect = { x, y, w: rect.w, h: rect.h };
            if (isSnapLayoutMode(activeBoardViewMode)) {
                this.saveGridLayout(item.id, rect, { updateRemembered: true });
            } else {
                this.saveFreeformSize(item.id, rect.w, rect.h, { updateRemembered: true });
                this.saveFreeformPosition(item.id, x, y);
            }
        } else {
            const pos = this.readNoteRect(card);
            fileItemToCabinet(item, activeBoardViewMode, this, {
                x: pos.x ?? 8,
                y: pos.y ?? 8,
                rememberW: pos.w,
                rememberH: pos.h
            });
        }

        window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
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
            if (NoteSurface.canEditInline() && resolveTileSize(item) !== 'small') {
                NoteSurface.mutateItem(item, (it) => { it.tileSize = 'small'; }, { preserveView: true, skipRerender: true });
                item.tileSize = 'small';
                boardItemsById.set(item.id, item);
            }
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

    clampNoteToBoardEdges(rect, { packW, maxH, origin, edgePad } = {}) {
        const metrics = getGridMetrics();
        const o = origin ?? metrics.origin;
        const pad = edgePad ?? metrics.edgePad;
        const minX = o + pad;
        const minY = o + pad;
        const rightLimit = o + pad + (packW ?? 0);
        const bottomLimit = (maxH ?? Infinity) - pad;
        let { x, y, w, h } = rect;
        x = Math.max(minX, x);
        y = Math.max(minY, y);
        if (Number.isFinite(rightLimit) && x + w > rightLimit) {
            x = Math.max(minX, rightLimit - w);
        }
        if (Number.isFinite(bottomLimit) && y + h > bottomLimit) {
            y = Math.max(minY, bottomLimit - h);
        }
        return { x, y, w, h };
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
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;
        this.finalizeDesktopCard(card);

        return true;
    },

    render(canvas, items, viewMode, hiddenCategories = [], renderOptions = {}) {
        if (!canvas) return;
        canvas.innerHTML = '';

        const safeItems = Array.isArray(items) ? items : [];
        const visibleItems = this.getVisibleItems(safeItems);
        boardItemsById = new Map(visibleItems.map((item) => [item.id, item]));

        let activeCategories = readStoredCategories();
        activeCategories = activeCategories.filter(cat => !hiddenCategories.includes(cat.name));

        const resolvedMode = normalizeViewMode(viewMode);
        const snapLayout = isSnapLayoutMode(resolvedMode);
        const fileCabinetActive = isFileCabinetActive();
        activeBoardViewMode = resolvedMode;
        canvas.className = snapLayout ? 'view-grid' : 'view-freeform';
        if (fileCabinetActive) canvas.classList.add('file-cabinet-bottom');
        delete canvas.dataset.focusActive;

        let boardItems = visibleItems;
        if (fileCabinetActive) {
            const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, resolvedMode, this);
            seedFileCabinetOrderFromItems(filed);
            const mount = ensureFileCabinetMount(true);
            renderFileCabinet(mount, filed, activeCategories, this);
            syncCabinetSplitter();
            boardItems = expanded;
        } else {
            ensureFileCabinetMount(false);
            syncCabinetSplitter();
        }

        if (boardItems.length === 0) {
            if (fileCabinetActive && visibleItems.length > 0) {
                return;
            }
            const hiddenCount = safeItems.length - this.getVisibleItems(safeItems).length;
            if (safeItems.length > 0 && hiddenCount === safeItems.length) {
                canvas.innerHTML = `<div class="system-status-msg">All objects are hidden. Use the footer to restore them.</div>`;
            } else {
                canvas.innerHTML = `<div class="system-status-msg">Workspace clean. Click "+ New" to commit an entity.</div>`;
            }
            return;
        }

        const layout = snapLayout ? this.getGridLayout() : null;
        const positions = snapLayout ? null : this.getFreeformPositions();
        const placed = [];
        const bounds = snapLayout ? this.getGridBoardBounds(canvas) : null;
        const metrics = getGridMetrics();
        let autoX = metrics.origin + metrics.edgePad;
        let autoY = metrics.origin + metrics.edgePad;
        const cardStep = metrics.strideX + metrics.gap;
        const rowStep = metrics.strideY + metrics.gap;
        const boardPane = document.createElement('div');
        boardPane.className = DESKTOP_BOARD_PANE_CLASS;
        canvas.appendChild(boardPane);

        [...boardItems]
            .sort((a, b) => {
                const aTime = Number(a.created_at || a.updated_at || 0);
                const bTime = Number(b.created_at || b.updated_at || 0);
                return aTime - bTime;
            })
            .forEach((item, index) => {
                const card = this.createCardComponent(item, activeCategories);
                const isLayoutExpanded = this.isSavedLayoutExpanded(item.id);

                if (snapLayout) {
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
                        rect = this.findFirstCanvasSlot(w, h, placed, packW + origin * 2, { origin, edgePad });
                    }

                    this.applyNoteRect(card, rect, { settling: false });
                    if (!saved) {
                        this.saveGridLayout(item.id, rect);
                    }
                    placed.push(rect);
                } else {
                    const saved = positions[item.id];
                    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                        card.style.left = `${saved.x}px`;
                        card.style.top = `${saved.y}px`;
                    } else {
                        card.style.left = `${autoX}px`;
                        card.style.top = `${autoY}px`;
                        autoX += cardStep;
                        if (autoX > Math.max(canvas.clientWidth, 320) - cardStep) {
                            autoX = metrics.origin + metrics.edgePad;
                            autoY += rowStep;
                        }
                    }
                    this.applyFreeformSize(card);
                }

                card.removeAttribute('draggable');
                this.finalizeDesktopCard(card);
                this.initDesktopCardStack(card, index);
                this.syncBoardPinClass(card);
                boardPane.appendChild(card);
            });

        this.updateBoardCanvasExtents(canvas);
        if (snapLayout && !renderOptions.skipGridReflow) {
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, null, { animate: false });
            });
        }
    },


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

    attachCardActionButton(btn, handler) {
        if (!btn) return;
        let handledByMouse = false;
        btn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            handledByMouse = true;
            handler(e);
        });
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (handledByMouse) {
                handledByMouse = false;
                return;
            }
            handler(e);
        });
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

    attachCardActions(card, item, ctx) {
        const actions = card.querySelector('.card-actions');
        if (!actions) return;

        const copyBtn = actions.querySelector('.card-act--copy');
        const pinBtn = actions.querySelector('.card-act--pin');
        const dragBtn = actions.querySelector('.card-act--drag');
        const toggleBtn = actions.querySelector('.card-act--toggle');
        const colorBtn = actions.querySelector('.card-act--color');
        const hideBtn = actions.querySelector('.card-act--hide');
        const editBtn = actions.querySelector('.card-act--edit');
        const calBtn = actions.querySelector('.card-act--cal');

        const consumeSkipExpand = () => {
            if (card.dataset.skipExpand) {
                delete card.dataset.skipExpand;
                return true;
            }
            return false;
        };

        this.attachCardActionButton(copyBtn, async () => {
            NoteSurface.commitFocusedInlineField(card, item);
            const shell = card.querySelector('.editor-note-shell');
            if (shell) NoteSurface.syncItemBodyFromDom(shell, item);
            const ok = await copyPlainTextToClipboard(itemToPlainCopyText(item));
            if (ok) NoteSurface.flashCopyFeedback(copyBtn);
            else NoteSurface.flashCopyFeedback(copyBtn, 'Copy failed', { failed: true });
        });

        const toolbar = card.querySelector('.note-editor-toolbar');
        toolbar?.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            NoteSurface.commitFocusedInlineField(card, item);
        }, true);

        this.attachCardActionButton(pinBtn, () => {
            const pinned = this.toggleBoardPin(item.id);
            this.syncBoardPinClass(card);
            pinBtn.classList.toggle('is-active', pinned);
            pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
            const pinTitle = pinned ? 'Unpin (unlock drag)' : 'Pin position (locks drag)';
            pinBtn.setAttribute('title', pinTitle);
            pinBtn.setAttribute('aria-label', pinTitle);
            pinBtn.innerHTML = pinned ? CARD_ICONS.unpin : CARD_ICONS.pin;
            if (dragBtn) dragBtn.classList.toggle('is-hidden', pinned);
        });

        if (toggleBtn) {
            toggleBtn.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
            });
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                delete card.dataset.skipExpand;
                if (ctx) this.toggleCardExpanded(card, item, { ...ctx, fromToolbar: true });
            });
        }

        this.attachCardActionButton(colorBtn, () => {
            NoteSurface.commitFocusedInlineField(card, item);
            if (isDesktopCard(card)) this.raiseDesktopCard(card);
            if (!localStorage.getItem('admin_token')) return;
            ColorPicker.open({
                anchor: colorBtn,
                presets: PALETTE_NOTE,
                value: resolveNoteColor(item.backgroundColor),
                align: 'end',
                onSelect: (color) => {
                    NoteSurface.mutateItem(item, (it) => {
                        it.backgroundColor = color || THEME_DEFAULT_COLOR;
                    }, { preserveView: true, skipRerender: true });
                    this.applyItemCardTheme(card, item);
                }
            });
        });

        this.attachCardActionButton(hideBtn, () => {
            NoteSurface.commitFocusedInlineField(card, item);
            this.hideFromBoard(item);
        });

        this.attachCardActionButton(editBtn, () => {
            NoteSurface.commitFocusedInlineField(card, item);
            if (isDesktopCard(card)) this.raiseDesktopCard(card);
            if (consumeSkipExpand()) return;
            if (!localStorage.getItem('admin_token')) return;
            window.dispatchEvent(new CustomEvent('item:selected_for_edit', {
                detail: { item, sourceCard: card }
            }));
        });

        if (calBtn) {
            this.syncCalendarButtonUI(item, calBtn);
            this.attachCardActionButton(calBtn, () => {
                NoteSurface.commitFocusedInlineField(card, item);
                this.toggleCardCalendar(item, calBtn);
            });
        }
    },

    attachModalQuickActions(toolbarMount, item, editor) {
        if (!toolbarMount || !item || !editor) return;

        const archiveBtn = toolbarMount.querySelector('.card-act--archive');
        const actions = toolbarMount.querySelector('.card-actions');
        if (!actions) return;

        const copyBtn = actions.querySelector('.card-act--copy');
        const pinBtn = actions.querySelector('.card-act--pin');
        const colorBtn = actions.querySelector('.card-act--color');
        const hideBtn = actions.querySelector('.card-act--hide');
        const editBtn = actions.querySelector('.card-act--edit');
        const calBtn = actions.querySelector('.card-act--cal');
        const closeBtn = actions.querySelector('.card-act--close');

        editor.archiveBtn = archiveBtn;
        editor.colorBtn = colorBtn;
        editor.calendarToggleBtn = calBtn;

        if (archiveBtn) {
            this.attachCardActionButton(archiveBtn, () => editor.emitArchiveAction());
        }

        const commitAndClose = () => editor.commitAndClose();

        if (closeBtn) {
            closeBtn.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
            });
            closeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                commitAndClose();
            });
        }

        this.attachCardActionButton(copyBtn, async () => {
            editor.syncActiveItemFromDom();
            const data = editor.collectFormData();
            const ok = await copyPlainTextToClipboard(itemToPlainCopyText(data));
            if (ok) NoteSurface.flashCopyFeedback(copyBtn);
            else NoteSurface.flashCopyFeedback(copyBtn, 'Copy failed', { failed: true });
        });

        this.attachCardActionButton(pinBtn, () => {
            const pinned = this.toggleBoardPin(item.id);
            pinBtn.classList.toggle('is-active', pinned);
            pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
            const pinTitle = pinned ? 'Unpin (unlock drag)' : 'Pin position (locks drag)';
            pinBtn.setAttribute('title', pinTitle);
            pinBtn.setAttribute('aria-label', pinTitle);
            pinBtn.innerHTML = pinned ? CARD_ICONS.unpin : CARD_ICONS.pin;
            const dragBtn = actions.querySelector('.card-act--drag');
            if (dragBtn) dragBtn.classList.toggle('is-hidden', pinned);
        });

        this.attachCardActionButton(colorBtn, () => editor.openColorPicker());

        this.attachCardActionButton(hideBtn, () => {
            editor.syncActiveItemFromDom();
            const data = editor.collectFormData();
            Object.assign(item, data);
            this.hideFromBoard(item);
        });

        this.attachCardActionButton(editBtn, () => {
            const titleEl = editor.mountZone?.querySelector('[data-field="title"]');
            if (titleEl) NoteSurface.focusInlineEdit(titleEl, 'end');
        });

        if (calBtn) {
            this.syncCalendarButtonUI(item, calBtn);
            this.attachCardActionButton(calBtn, () => {
                editor.syncActiveItemFromDom();
                this.toggleCardCalendar(item, calBtn);
                editor.activeItem.hideFromCalendar = item.hideFromCalendar;
                editor.markInteracted();
                editor.triggerAutoSave();
            });
        }
    },

    applyItemCardTheme(card, item) {
        const color = resolveNoteColor(item.backgroundColor);
        card.style.backgroundColor = color;
        card.style.borderColor = 'rgba(255,255,255,0.15)';
        applyCardTheme(card, color);
    },

    setupFreeformChrome(card) {
        const shell = card.querySelector('.editor-note-shell');

        let chrome = card.querySelector('.ff-chrome');
        if (!chrome) {
            chrome = document.createElement('div');
            chrome.className = 'ff-chrome';
        }

        let resizeLayer = card.querySelector('.ff-resize-layer');
        if (!resizeLayer) {
            resizeLayer = document.createElement('div');
            resizeLayer.className = 'ff-resize-layer';
            resizeLayer.setAttribute('aria-hidden', 'true');
        }

        if (shell) {
            card.insertBefore(chrome, shell);
            card.insertBefore(resizeLayer, shell);
        } else {
            if (!chrome.parentNode) card.appendChild(chrome);
            if (!resizeLayer.parentNode) card.appendChild(resizeLayer);
        }

        chrome.querySelectorAll('.ff-resize').forEach((handle) => {
            resizeLayer.appendChild(handle);
        });
        if (!chrome.querySelector('.ff-drag-gutter--edge')) {
            const gutter = document.createElement('span');
            gutter.className = 'ff-drag-gutter ff-drag-gutter--edge';
            gutter.title = 'Drag to move';
            chrome.insertBefore(gutter, chrome.firstChild);
        }
        if (!chrome.querySelector('.ff-drag-gutter--top')) {
            const topGutter = document.createElement('span');
            topGutter.className = 'ff-drag-gutter ff-drag-gutter--top';
            topGutter.title = 'Drag to move';
            chrome.appendChild(topGutter);
        }
        if (!resizeLayer.querySelector('.ff-resize-se')) {
            resizeLayer.insertAdjacentHTML('beforeend', `
                <span class="ff-resize ff-resize-n" data-axis="n" aria-hidden="true"></span>
                <span class="ff-resize ff-resize-s" data-axis="s" aria-hidden="true"></span>
                <span class="ff-resize ff-resize-e" data-axis="e" aria-hidden="true"></span>
                <span class="ff-resize ff-resize-w" data-axis="w" aria-hidden="true"></span>
                <span class="ff-resize ff-resize-nw" data-axis="nw" aria-hidden="true"></span>
                <span class="ff-resize ff-resize-ne" data-axis="ne" aria-hidden="true"></span>
                <span class="ff-resize ff-resize-sw" data-axis="sw" aria-hidden="true"></span>
                <span class="ff-resize ff-resize-se" data-axis="se" aria-hidden="true"></span>
            `);
        }
    },

    syncSpatialChromeForEditing(card) {
        if (!card?.querySelector?.('.ff-chrome')) return;
        const layer = card.querySelector('.ff-resize-layer');
        const gutters = card.querySelectorAll('.ff-drag-gutter');
        let disableChrome = false;
        if (isDesktopCard(card)) {
            disableChrome = card.classList.contains('is-editing-inline');
        } else {
            const expanded = card.classList.contains('expanded');
            card.classList.toggle('is-editing-inline', expanded);
            disableChrome = expanded;
            if (expanded) {
                const shell = card.querySelector('.editor-note-shell');
                if (shell) card.appendChild(shell);
            }
        }
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
        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
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
            if (isSnapLayoutMode(activeBoardViewMode)) {
                this.applyDesktopSize(card);
            } else {
                this.applyFreeformSize(card);
            }
        }
        const { w, h } = this.readNoteRect(card);
        const atSmall = this.syncSpatialCollapseState(card, item, w, h);
        this.syncSpatialChromeForEditing(card);
        this.syncSpatialToggleButton(card, atSmall);
    },

    getCardRenderContext(item, activeCategories) {
        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';
        return { targetCatName, categoryColor };
    },

    updateDesktopCard(card, item, { expanded, dimensions = null } = {}) {
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

    toggleCardExpanded(card, item, ctx) {
        this.applyTileZoneToggle(card, item, ctx);
    },

    createCardComponent(item, activeCategories) {
        const card = document.createElement('div');
        card.classList.add('mini-card');
        card.dataset.id = item.id;
        card.dataset.desktop = '1';

        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';

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

        card.classList.remove('expanded');
        card.innerHTML = NoteSurface.buildNoteEditorShell(item, {
            canEdit,
            richEdit: canEdit,
            toolbarHtml: this.buildCardActionsHtml(item, false, this.getCardActionsOptions(card)),
            toolbarDragZone: dragZone,
            footerDragZone: dragZone,
            targetCatName,
            categoryColor: dotColor
        });

        this.attachCardActions(card, item, {
            activeCategories,
            targetCatName,
            categoryColor
        });
        NoteSurface.bindNoteEditorShell(card, item, {
            richEdit: canEdit,
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
        const shell = card.querySelector('.editor-note-shell');
        if (shell && !card.dataset.pendingFocusStepId) {
            NoteSurface.syncItemBodyFromDom(shell, item);
        }
        const body = card.querySelector('.editor-note-body');
        const scrollTop = body?.scrollTop ?? 0;
        const pendingFocusStepId = card.dataset.pendingFocusStepId;
        const pendingFocusEdge = card.dataset.pendingFocusEdge;
        const pendingFocusPlainOffset = card.dataset.pendingFocusPlainOffset;
        this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
        const newBody = card.querySelector('.editor-note-body');
        if (newBody) newBody.scrollTop = scrollTop;
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
        setExpandedCard('grid', itemId, false);
        setExpandedCard('freeform', itemId, false);
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
            localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
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

    captureDesktopRestoreContext(card) {
        if (!card || !isDesktopCard(card)) return null;
        return {
            viewMode: activeBoardViewMode,
            rect: this.readNoteRect(card),
            size: this.readFreeformCardSize(card)
        };
    },

    getFreeformPositions() {
        try {
            return JSON.parse(localStorage.getItem('matrix_freeform_positions') || '{}');
        } catch {
            return {};
        }
    },

    saveFreeformPosition(itemId, x, y) {
        const positions = this.getFreeformPositions();
        positions[itemId] = { x: Math.round(x), y: Math.round(y) };
        localStorage.setItem('matrix_freeform_positions', JSON.stringify(positions));
    },

    getFreeformSizes() {
        try {
            return JSON.parse(localStorage.getItem('matrix_freeform_sizes') || '{}');
        } catch {
            return {};
        }
    },

    saveFreeformSize(itemId, w, h, { updateRemembered = false } = {}) {
        const sizes = this.getFreeformSizes();
        const prev = sizes[itemId] || {};
        const item = this.resolveBoardItem(itemId);
        sizes[itemId] = this.mergeSpatialLayoutEntry(prev, { w, h }, resolveTileSize(item), { updateRemembered });
        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
    },

    saveFreeformSizeFromCard(card) {
        if (!isDesktopCard(card)) return;
        const { w, h } = this.readFreeformCardSize(card);
        this.saveFreeformSize(card.dataset.id, w, h, {
            updateRemembered: !isCollapsedSpatialSize(w, h, resolveTileSize(this.resolveBoardItem(card.dataset.id)))
        });
    },

    flushLayoutFromCanvas(canvas, viewMode) {
        if (!canvas) return;
        if (viewMode === 'grid') {
            canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
                const id = card.dataset.id;
                if (!id) return;
                this.saveGridLayout(id, this.readNoteRect(card));
            });
            return;
        }
        if (viewMode === 'freeform') {
            canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
                const id = card.dataset.id;
                if (!id) return;
                this.saveFreeformPosition(
                    id,
                    parseFloat(card.style.left) || 0,
                    parseFloat(card.style.top) || 0
                );
                this.saveFreeformSizeFromCard(card);
            });
        }
    },

    applyDesktopLayoutModeSwitch(canvas, mode) {
        if (!canvas) return;
        const resolvedMode = normalizeViewMode(mode);
        activeBoardViewMode = resolvedMode;
        const snapLayout = isSnapLayoutMode(resolvedMode);
        canvas.classList.toggle('view-grid', snapLayout);
        canvas.classList.toggle('view-freeform', !snapLayout);
        canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((card) => {
            this.finalizeDesktopCard(card);
        });
        this.updateDesktopScrollPolicy(canvas);
        this.updateBoardCanvasExtents(canvas);
    },

    convertDesktopLayoutForModeChange(canvas, fromMode, toMode, items) {
        if (!canvas || fromMode === toMode) return;
        const visible = this.getVisibleItems(Array.isArray(items) ? items : []);
        const ids = new Set(visible.map((item) => item.id));

        if (toMode === 'freeform') {
            const footprint = readTileSmallFootprint();
            const small = getSmallRect(footprint);
            visible.forEach((item) => {
                const gridSaved = fromMode === 'grid' ? this.getGridLayout()[item.id] : null;
                if (
                    fromMode === 'grid'
                    && gridSaved
                    && Number.isFinite(gridSaved.x)
                    && Number.isFinite(gridSaved.y)
                    && isCollapsedSpatialSize(gridSaved.w, gridSaved.h, resolveTileSize(item))
                ) {
                    this.saveCompactBoardLayout(item.id, {
                        x: gridSaved.x,
                        y: gridSaved.y,
                        w: small.w,
                        h: small.h
                    }, toMode);
                    return;
                }

                const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
                if (!card) {
                    if (gridSaved) {
                        let w = gridSaved.w;
                        let h = gridSaved.h;
                        if (isCollapsedSpatialSize(w, h, resolveTileSize(item))) {
                            w = small.w;
                            h = small.h;
                        }
                        this.saveFreeformPosition(item.id, gridSaved.x, gridSaved.y);
                        const sizes = this.getFreeformSizes();
                        const prev = sizes[item.id] || {};
                        sizes[item.id] = this.mergeSpatialLayoutEntry(
                            prev,
                            { w, h },
                            resolveTileSize(item),
                            {
                                updateRemembered: !isCollapsedSpatialSize(w, h, resolveTileSize(item)),
                                rememberedW: gridSaved.rememberedW,
                                rememberedH: gridSaved.rememberedH
                            }
                        );
                        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
                    }
                    return;
                }
                const rect = this.readNoteRect(card);
                let w;
                let h;
                if (gridSaved && Number.isFinite(gridSaved.w) && Number.isFinite(gridSaved.h)) {
                    w = gridSaved.w;
                    h = gridSaved.h;
                } else {
                    const size = this.readFreeformCardSize(card);
                    w = size.w;
                    h = size.h;
                }
                if (isCollapsedSpatialSize(w, h, resolveTileSize(item))) {
                    w = small.w;
                    h = small.h;
                }
                const x = gridSaved?.x ?? rect.x;
                const y = gridSaved?.y ?? rect.y;
                this.saveFreeformPosition(item.id, x, y);
                const sizes = this.getFreeformSizes();
                const prev = sizes[item.id] || {};
                sizes[item.id] = this.mergeSpatialLayoutEntry(
                    prev,
                    { w, h },
                    resolveTileSize(item),
                    {
                        updateRemembered: !isCollapsedSpatialSize(w, h, resolveTileSize(item)),
                        rememberedW: gridSaved?.rememberedW ?? prev.rememberedW,
                        rememberedH: gridSaved?.rememberedH ?? prev.rememberedH
                    }
                );
                localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
            });
            return;
        }

        if (toMode === 'grid') {
            const footprint = readTileSmallFootprint();
            const small = getSmallRect(footprint);
            const gridLayout = this.getGridLayout();
            const freeformPositions = this.getFreeformPositions();
            const placed = [];
            const { origin, packW, maxH } = this.getGridBoardBounds(canvas);

            visible.forEach((item) => {
                const freeSaved = this.getFreeformSizes()[item.id];
                const freePos = freeformPositions[item.id];
                if (
                    fromMode === 'freeform'
                    && freeSaved
                    && Number.isFinite(freeSaved.w)
                    && freePos
                    && Number.isFinite(freePos.x)
                    && Number.isFinite(freePos.y)
                    && isCollapsedSpatialSize(freeSaved.w, freeSaved.h, resolveTileSize(item))
                ) {
                    const slot = this.snapNoteRect(
                        { x: freePos.x, y: freePos.y, w: small.w, h: small.h },
                        { maxW: packW, maxH, origin }
                    );
                    this.saveCompactBoardLayout(item.id, slot, toMode);
                    placed.push(slot);
                    return;
                }

                const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
                const saved = gridLayout[item.id];
                const tileSize = resolveTileSize(item);
                let w;
                let h;
                let x;
                let y;

                if (card) {
                    const pos = this.readNoteRect(card);
                    const size = this.readFreeformCardSize(card);
                    x = pos.x;
                    y = pos.y;
                    w = size.w;
                    h = size.h;
                } else if (freeSaved && Number.isFinite(freeSaved.w) && Number.isFinite(freeSaved.h)) {
                    w = freeSaved.w;
                    h = freeSaved.h;
                    if (freeformPositions[item.id]) {
                        x = freeformPositions[item.id].x;
                        y = freeformPositions[item.id].y;
                    } else {
                        const slot = this.snapNoteRect(
                            this.findFirstCanvasSlot(w, h, placed, packW + origin * 2, { origin }),
                            { maxW: packW, maxH }
                        );
                        this.saveGridLayout(item.id, slot);
                        placed.push(slot);
                        return;
                    }
                } else if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
                    const clamped = geoClampSpatialSize(saved.w, saved.h, tileSize);
                    w = clamped.w;
                    h = clamped.h;
                    if (freeformPositions[item.id]) {
                        x = freeformPositions[item.id].x;
                        y = freeformPositions[item.id].y;
                    } else {
                        const slot = this.snapNoteRect(
                            this.findFirstCanvasSlot(w, h, placed, packW + origin * 2, { origin }),
                            { maxW: packW, maxH }
                        );
                        this.saveGridLayout(item.id, slot);
                        placed.push(slot);
                        return;
                    }
                } else {
                    const tileDefaults = geoGetTileDefaultRect(tileSize);
                    w = tileDefaults.w;
                    h = tileDefaults.h;
                    const slot = this.snapNoteRect(
                        this.findFirstCanvasSlot(w, h, placed, packW + origin * 2, { origin }),
                        { maxW: packW, maxH }
                    );
                    this.saveGridLayout(item.id, slot);
                    placed.push(slot);
                    return;
                }

                let rect = this.snapNoteRect({ x, y, w, h }, { maxW: packW, maxH });
                rect = this.snapNotePosition(rect, { maxW: packW, maxH, origin });
                const gridPrev = gridLayout[item.id] || (freeSaved ? { ...freeSaved } : {});
                const layoutStore = this.getGridLayout();
                layoutStore[item.id] = this.mergeSpatialLayoutEntry(
                    gridPrev,
                    rect,
                    resolveTileSize(item),
                    {
                        updateRemembered: !isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item)),
                        rememberedW: freeSaved?.rememberedW ?? gridPrev.rememberedW,
                        rememberedH: freeSaved?.rememberedH ?? gridPrev.rememberedH
                    }
                );
                localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layoutStore));
                placed.push(rect);
            });

            const layout = this.computeGridBoardLayout(canvas, null);
            layout.forEach((rect, id) => {
                if (!ids.has(id)) return;
                this.saveGridLayout(id, rect);
            });
        }
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

    findFirstCanvasSlotVertical(w, h, placed, canvasW, { origin = CANVAS_LAYOUT_ORIGIN, edgePad, xMin, yMin, maxH } = {}) {
        const metrics = getGridMetrics();
        const pad = edgePad ?? metrics.edgePad;
        const packW = Math.max(metrics.canvasGridW, canvasW - origin * 2 - pad * 2);
        const xOrigin = Math.max(origin + pad, xMin ?? origin + pad);
        const yOrigin = Math.max(origin + pad, yMin ?? origin + pad);
        const colStride = this.gridColumnStride(w, h, metrics);
        const yStride = getPackStrideYForRect(w, h);
        const bottomLimit = (maxH ?? origin + metrics.strideY * 40) + 1;
        let x = xOrigin;
        let guard = 0;
        while (guard < 800) {
            let y = yOrigin;
            while (y + h <= bottomLimit) {
                const candidate = this.snapNoteRect(
                    { x, y, w, h },
                    { maxW: packW, origin, edgePad: pad, maxH }
                );
                if (!placed.some((p) => this.rectsOverlap(candidate, p, metrics.gap))) {
                    return candidate;
                }
                y += yStride;
            }
            x += colStride;
            guard += 1;
        }
        return { x: xOrigin, y: yOrigin, w, h };
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
            const colStride = this.gridColumnStride(small.w, small.h, metrics);
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
            let slot = this.clampManualNoteRect(raw, { maxW: canvasW, maxH: viewportBottom });
            if (placed.some((p) => this.rectsOverlap(slot, p, metrics.gap))) {
                const near = this.findFreeformSortSlot(slot.w, slot.h, placed, canvasW, {
                    startX: slot.x,
                    startY: slot.y,
                    direction: 'horizontal'
                });
                slot = { ...near, w: slot.w, h: slot.h };
            }
            this.saveFreeformPosition(item.id, slot.x, slot.y);
            this.saveFreeformSize(item.id, slot.w, slot.h, { updateRemembered: true });
            const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(item.id)}"]`);
            if (card) this.applyNoteRect(card, slot, { settling: true });
            placed.push({ ...slot });
        });
    },

    packSortGridBoard(canvas, collapsedItems, expandedItems, sortPrefs, pinnedIds) {
        const { origin, packW, maxH, edgePad } = this.getGridBoardBounds(canvas);
        const metrics = getGridMetrics();
        const direction = sortPrefs.direction === 'vertical' ? 'vertical' : 'horizontal';
        const placed = [];
        const layout = new Map();
        const snapBounds = { maxW: packW, maxH, origin, edgePad };
        const canvasW = packW + origin * 2;

        pinnedIds.forEach((id) => {
            const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
            const saved = this.getGridLayout()[id];
            if (!saved || !Number.isFinite(saved.x)) return;
            const item = this.resolveBoardItem(id);
            const isExp = this.isItemLayoutExpanded(item, 'grid');
            const rect = this.snapNoteRect(
                card
                    ? this.gridBoardRectForCard(card, saved, isExp)
                    : { ...saved, ...this.resolveSortItemSize(item, 'grid', isExp) },
                snapBounds
            );
            layout.set(id, rect);
            placed.push({ ...rect });
        });

        const packGroup = (items, { startX, startY } = {}) => {
            const yMin = startY ?? yStart;
            const xMin = direction === 'vertical' ? (startX ?? origin + edgePad) : undefined;
            items.forEach((item) => {
                if (!item?.id || pinnedIds.has(item.id)) return;
                const isExp = this.isItemLayoutExpanded(item, 'grid');
                const { w, h } = this.resolveSortItemSize(item, 'grid', isExp);
                const slotOpts = { origin, edgePad, yMin, xMin, maxH };
                let slot = direction === 'vertical'
                    ? this.findFirstCanvasSlotVertical(w, h, placed, canvasW, slotOpts)
                    : this.findFirstCanvasSlot(w, h, placed, canvasW, slotOpts);
                slot = this.snapNoteRect(slot, snapBounds);
                layout.set(item.id, slot);
                placed.push({ ...slot });
            });
        };

        const yStart = origin + edgePad;
        const unpinnedCollapsed = collapsedItems.filter((item) => !pinnedIds.has(item.id));
        const unpinnedExpanded = expandedItems.filter((item) => !pinnedIds.has(item.id));
        packGroup(collapsedItems, { startY: yStart });

        const collapsedRects = unpinnedCollapsed
            .map((item) => layout.get(item.id))
            .filter((rect) => rect && Number.isFinite(rect.x));
        const hasExpandedGap = unpinnedCollapsed.length && unpinnedExpanded.length;
        const expandedAnchor = this.computeExpandedAlignAnchor(
            direction,
            hasExpandedGap ? collapsedRects : [],
            { origin, edgePad, packW, yStart, metrics }
        );

        if (unpinnedExpanded.length) {
            const viewport = this.getGridViewportBounds(canvas);
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
                direction
            });
        }
        this.applyGridBoardLayout(canvas, layout, { animate: true, save: true });
        if (unpinnedExpanded.length) {
            unpinnedExpanded.forEach((item) => {
                const rect = layout.get(item.id);
                if (rect) this.saveGridLayout(item.id, rect, { updateRemembered: true });
            });
        }
        this.updateGridScrollPolicy(canvas, { forcing: false });
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
        const sample = this.resolveSortItemSize(unpinned[0], 'freeform', false);
        const slotFootprint = computeStackFootprint(CASCADE_PER_STACK, sample.w, sample.h);
        const footprints = chunks.map((chunk) => {
            const { w, h } = this.resolveSortItemSize(chunk[0], 'freeform', false);
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
            if (!placed.some((p) => this.rectsOverlap(candidate, p, metrics.gap))) {
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
            const sizes = chunk.map((item) => this.resolveSortItemSize(item, 'freeform', false));
            const rects = computeStackRects(sizes, anchor.x, anchor.y);

            chunk.forEach((item, itemIndex) => {
                const slot = rects[itemIndex];
                if (!slot) return;
                this.saveFreeformPosition(item.id, slot.x, slot.y);
                this.saveFreeformSize(item.id, slot.w, slot.h, { updateRemembered: false });
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

        const sizes = unpinned.map((item) => this.resolveSortItemSize(item, 'freeform', true));
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
        if (stackBounds.w > 0 && placed.some((p) => this.rectsOverlap(stackBounds, p, metrics.gap))) {
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
            this.saveFreeformPosition(item.id, slot.x, slot.y);
            this.saveFreeformSize(item.id, slot.w, slot.h, { updateRemembered: true });
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
            const pos = this.getFreeformPositions()[id];
            const sizes = this.getFreeformSizes()[id];
            if (pos && sizes && Number.isFinite(pos.x) && Number.isFinite(sizes.w)) {
                placed.push({ x: pos.x, y: pos.y, w: sizes.w, h: sizes.h });
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
            const viewport = this.getGridViewportBounds(canvas);

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
                const isExp = this.isItemLayoutExpanded(item, 'freeform');
                const { w, h } = this.resolveSortItemSize(item, 'freeform', isExp);
                const slot = this.findFreeformSortSlot(w, h, placed, canvasW, {
                    startX: cursor.x,
                    startY: cursor.y,
                    direction
                });
                this.saveFreeformPosition(item.id, slot.x, slot.y);
                this.saveFreeformSize(item.id, slot.w, slot.h, {
                    updateRemembered: isExp
                });
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
            const viewport = this.getGridViewportBounds(canvas);
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

        const mode = normalizeViewMode(viewMode);
        const snapLayout = isSnapLayoutMode(mode);
        const canvas = document.getElementById('app-canvas');
        if (!canvas) return;

        const fcActive = fileCabinetActive ?? isFileCabinetActive();
        let canvasItems = visibleItems;

        if (fcActive) {
            const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, mode, this);
            applySortToFileCabinetOrder(filed, sortPrefs);
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

        if (snapLayout) {
            this.packSortGridBoard(canvas, sortedCollapsed, sortedExpanded, sortPrefs, pinnedIds);
        } else {
            this.packSortFreeformBoard(canvas, sortedCollapsed, sortedExpanded, sortPrefs, pinnedIds);
        }

        window.dispatchEvent(new CustomEvent('board:visibility_changed', {
            detail: { flushLayout: false, skipGridReflow: true }
        }));
    },

    resetBoardLayout(sortBy, items, { fileCabinetActive } = {}) {
        const visibleItems = this.getVisibleItems(items || []);
        const mode = normalizeViewMode(sortBy);
        clearViewSessionExpanded('grid');
        clearViewSessionExpanded('freeform');

        const boardItems = visibleItems;

        const fcActive = fileCabinetActive ?? isFileCabinetActive();

        if (fcActive) {
            const { expanded } = partitionItemsForFileCabinet(boardItems, mode, this);
            expanded.forEach((item) => {
                const savedGrid = this.getGridLayout()[item.id];
                const savedPos = this.getFreeformPositions()[item.id];
                fileItemToCabinet(item, mode, this, {
                    x: savedGrid?.x ?? savedPos?.x ?? 8,
                    y: savedGrid?.y ?? savedPos?.y ?? 8
                });
            });
            window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
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
        if (!itemId || !rect) return;
        const mode = normalizeViewMode(sortBy);
        const entry = {
            w: Math.round(rect.w),
            h: Math.round(rect.h)
        };
        if (Number.isFinite(rect.x)) entry.x = Math.round(rect.x);
        if (Number.isFinite(rect.y)) entry.y = Math.round(rect.y);

        if (isSnapLayoutMode(mode)) {
            const layout = this.getGridLayout();
            const prev = layout[itemId] || {};
            layout[itemId] = { ...prev, ...entry };
            delete layout[itemId].rememberedW;
            delete layout[itemId].rememberedH;
            localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(layout));
        } else {
            const sizes = this.getFreeformSizes();
            const prev = sizes[itemId] || {};
            sizes[itemId] = { ...prev, ...entry };
            delete sizes[itemId].rememberedW;
            delete sizes[itemId].rememberedH;
            localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
            if (Number.isFinite(rect.x) && Number.isFinite(rect.y)) {
                this.saveFreeformPosition(itemId, rect.x, rect.y);
            }
        }
    },

    saveCompactBoardLayout(itemId, slot, sortBy) {
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

        const sizes = this.getFreeformSizes();
        const ffEntry = this.mergeSpatialLayoutEntry({}, { w: rect.w, h: rect.h }, 'small', { updateRemembered: false });
        delete ffEntry.customCompact;
        sizes[itemId] = ffEntry;
        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
        this.saveFreeformPosition(itemId, rect.x, rect.y);
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
        const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
        const { origin, edgePad, canvasGridW, columnMinInnerW } = getGridMetrics();
        const rawW = Math.max((canvas?.clientWidth || 320) / zoom, canvasGridW + origin * 2);
        const packW = Math.max(columnMinInnerW, rawW - origin * 2 - edgePad * 2);
        const maxH = Math.max(
            (canvas?.scrollHeight || 0) / zoom,
            (canvas?.clientHeight || 0) / zoom,
            typeof window !== 'undefined' ? window.innerHeight / zoom : 800
        );
        return { origin, edgePad, packW, maxH, canvasW: rawW };
    },

    getDesktopBoardPane(canvas) {
        return canvas?.querySelector(`:scope > .${DESKTOP_BOARD_PANE_CLASS}`) ?? null;
    },

    ensureDesktopBoardPane(canvas) {
        if (!canvas) return null;
        let pane = this.getDesktopBoardPane(canvas);
        if (pane) return pane;
        pane = document.createElement('div');
        pane.className = DESKTOP_BOARD_PANE_CLASS;
        const cards = [...canvas.querySelectorAll(':scope > .mini-card[data-desktop="1"]')];
        canvas.appendChild(pane);
        cards.forEach((card) => pane.appendChild(card));
        return pane;
    },

    scheduleBoardCanvasExtents(canvas) {
        if (!canvas) return;
        if (boardExtentsFrames.has(canvas)) return;
        const frame = requestAnimationFrame(() => {
            boardExtentsFrames.delete(canvas);
            this.updateBoardCanvasExtents(canvas);
        });
        boardExtentsFrames.set(canvas, frame);
    },

    updateGridCanvasMinHeight(canvas, placed, origin = CANVAS_LAYOUT_ORIGIN) {
        if (!canvas) return;
        const pane = this.ensureDesktopBoardPane(canvas);
        if (!pane) return;
        const bottom = placed.reduce((m, r) => Math.max(m, r.y + r.h), 0);
        pane.style.minHeight = `${bottom + origin + getCanvasColGap()}px`;
    },

    updateBoardCanvasExtents(canvas) {
        if (!canvas) return;
        const isSpatial = canvas.classList.contains('view-grid') || canvas.classList.contains('view-freeform');
        if (!isSpatial) return;

        canvas.style.minHeight = '';
        canvas.style.minWidth = '';

        const cards = canvas.querySelectorAll('.mini-card[data-desktop="1"]');
        const pane = this.getDesktopBoardPane(canvas);
        if (!cards.length) {
            if (pane) {
                pane.style.minHeight = '';
                pane.style.minWidth = '';
            }
            return;
        }

        const boardPane = pane || this.ensureDesktopBoardPane(canvas);
        if (!boardPane) return;

        const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
        const origin = canvas.classList.contains('view-grid')
            ? this.getGridBoardBounds(canvas).origin
            : CANVAS_LAYOUT_ORIGIN;
        const placed = [...cards].map((c) => this.readNoteRect(c));
        const bottom = placed.reduce((m, r) => Math.max(m, r.y + r.h), 0);
        const right = placed.reduce((m, r) => Math.max(m, r.x + r.w), 0);
        boardPane.style.minHeight = `${bottom + origin + getCanvasColGap()}px`;
        const viewportW = (canvas.clientWidth || 320) / zoom;
        boardPane.style.minWidth = `${Math.max(viewportW, right + origin + getCanvasColGap())}px`;
        this.updateDesktopScrollPolicy(canvas);
    },

    updateDesktopScrollPolicy(canvas) {
        if (!canvas?.classList.contains('view-grid') && !canvas?.classList.contains('view-freeform')) return;
        canvas.style.overflow = 'auto';
        canvas.style.overflowY = '';
        canvas.style.overflowX = '';
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

    gridColumnStride(w, h, metrics = getGridMetrics()) {
        if (isCollapsedSpatialSize(w, h)) {
            return w + metrics.gap;
        }
        const wCells = Math.max(1, geoSpanToCellsW(w));
        return geoCellsToSpanW(wCells) + metrics.gap;
    },

    gridRowStride(w, h, metrics = getGridMetrics()) {
        if (isCollapsedSpatialSize(w, h)) {
            return h + metrics.gap;
        }
        const hCells = Math.max(1, geoSpanToCellsH(h));
        return geoCellsToSpanH(hCells) + metrics.gap;
    },

    snapPackCoord(value, origin, pad, packStride) {
        const anchor = origin + pad;
        const rel = Math.max(0, value - anchor);
        const step = packStride || getGridMetrics().strideX;
        return anchor + Math.round(rel / step) * step;
    },

    findNearestGridSlot(preferred, w, h, placed, { packW, origin = CANVAS_LAYOUT_ORIGIN, maxH = Infinity, edgePad } = {}) {
        const metrics = getGridMetrics();
        const pad = edgePad ?? metrics.edgePad;
        const bounds = { maxW: packW, maxH };
        const snapped = this.snapNoteRect({ x: preferred.x, y: preferred.y, w, h }, { ...bounds, origin, edgePad: pad });
        if (!placed.some((p) => this.rectsOverlap(snapped, p))) return snapped;

        const prefX = snapped.x;
        const prefY = snapped.y;
        const candidates = [];
        const minX = origin + pad;
        const minY = origin + pad;
        const maxRight = origin + pad + packW;
        const maxBottom = maxH - pad;

        for (let ring = 0; ring <= 32; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                    const x = prefX + dx * metrics.strideX;
                    const y = prefY + dy * metrics.strideY;
                    const c = this.snapNoteRect({ x, y, w, h }, { ...bounds, origin, edgePad: pad });
                    if (c.x < minX - 1) continue;
                    if (c.x + c.w > maxRight + 1) continue;
                    if (c.y < minY - 1) continue;
                    if (c.y + c.h > maxBottom + 1) continue;
                    candidates.push({ rect: c, dist: Math.abs(c.x - prefX) + Math.abs(c.y - prefY) });
                }
            }
        }
        candidates.sort((a, b) => a.dist - b.dist || a.rect.y - b.rect.y || a.rect.x - b.rect.x);
        for (const { rect } of candidates) {
            if (!placed.some((p) => this.rectsOverlap(rect, p))) return rect;
        }
        return snapped;
    },

    pushGridCardRect(rect, placed, { packW, origin, maxH, edgePad }) {
        const metrics = getGridMetrics();
        const pad = edgePad ?? metrics.edgePad;
        const snapRect = (r) => this.snapNoteRect(r, { maxW: packW, maxH, origin, edgePad: pad });
        const colStride = this.gridColumnStride(rect.w, rect.h, metrics);
        let candidate = snapRect({ ...rect, x: rect.x + colStride });
        if (candidate.x + candidate.w <= origin + pad + packW + 1
            && !placed.some((p) => this.rectsOverlap(candidate, p))) {
            return candidate;
        }
        const blocker = placed.find((p) => this.rectsOverlap(rect, p));
        if (blocker) {
            candidate = snapRect({
                x: rect.x,
                y: blocker.y - rect.h - metrics.gap,
                w: rect.w,
                h: rect.h
            });
            if (candidate.y >= origin + pad - 1
                && !placed.some((p) => this.rectsOverlap(candidate, p))) {
                return candidate;
            }
            candidate = snapRect({
                x: rect.x,
                y: blocker.y + blocker.h + metrics.gap,
                w: rect.w,
                h: rect.h
            });
            if (!placed.some((p) => this.rectsOverlap(candidate, p))) return candidate;
        }
        return this.findNearestGridSlot(rect, rect.w, rect.h, placed, { packW, origin, maxH, edgePad: pad });
    },

    resolveGridPushLayout({ cardEntries, actorId, actorRect, pinnedIds, packW, origin, maxH, edgePad }) {
        const pad = edgePad ?? getGridMetrics().edgePad;
        const layout = new Map();
        const placed = [];
        const snapOpts = { packW, origin, maxH, edgePad: pad };
        const snapBounds = { maxW: packW, maxH, origin, edgePad: pad };

        cardEntries.forEach(({ id, rect }) => {
            if (!id || !pinnedIds.has(id)) return;
            const snapped = this.snapNoteRect(rect, snapBounds);
            layout.set(id, snapped);
            placed.push({ ...snapped });
        });

        if (actorId && actorRect) {
            const snapped = this.findNearestGridSlot(actorRect, actorRect.w, actorRect.h, placed, snapOpts);
            layout.set(actorId, snapped);
            placed.push({ ...snapped });
        }

        const others = cardEntries
            .filter(({ id }) => id && id !== actorId && !pinnedIds.has(id))
            .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

        others.forEach(({ id, rect }) => {
            let snapped = this.snapNoteRect(rect, snapBounds);
            if (placed.some((p) => this.rectsOverlap(snapped, p))) {
                snapped = this.pushGridCardRect(snapped, placed, snapOpts);
            }
            layout.set(id, snapped);
            placed.push({ ...snapped });
        });

        return layout;
    },

    computeSnapPanelLayout({
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
        const pinnedIds = new Set(this.getBoardPins());

        const cardEntries = cards.map((card) => {
            const id = card.dataset.id;
            const isExpanded = isCardExpanded(id, card);
            const saved = getSavedRect(id);
            const source = id === actorId && actorRect ? actorRect : (saved || this.readNoteRect(card));
            const rect = rectForCard(card, source, isExpanded);
            return { id, card, rect };
        });

        let resolvedActor = null;
        if (actorId && actorRect) {
            resolvedActor = this.snapNotePosition(actorRect, {
                maxW: packW,
                maxH: limitH,
                origin,
                edgePad
            });
        }

        return this.resolveGridPushLayout({
            cardEntries,
            actorId,
            actorRect: resolvedActor,
            pinnedIds,
            packW,
            origin,
            maxH: limitH,
            edgePad
        });
    },

    computeGridBoardLayout(canvas, actorId, actorRect = null, { maxH } = {}) {
        if (!canvas?.classList.contains('view-grid')) return new Map();
        const { origin, packW, maxH: boardMaxH, edgePad } = this.getGridBoardBounds(canvas);
        return this.computeSnapPanelLayout({
            panelEl: canvas,
            cardSelector: '.mini-card[data-desktop="1"]',
            getSavedRect: (id) => this.getGridLayout()[id],
            rectForCard: (card, saved, isExpanded) => this.gridBoardRectForCard(card, saved, isExpanded),
            isCardExpanded: (id) => this.isSavedLayoutExpanded(id),
            actorId,
            actorRect,
            bounds: { origin, packW, maxH: maxH ?? boardMaxH, edgePad }
        });
    },

    clearSnapPanelPreview(panelEl) {
        panelEl?.querySelectorAll('.mini-card.layout-preview').forEach((c) => {
            c.classList.remove('layout-preview');
        });
    },

    applyGridBoardLayout(canvas, layout, { animate = true, save = true, preview = false } = {}) {
        if (!canvas || !layout?.size) return [];
        const { origin } = this.getGridBoardBounds(canvas);
        const placed = [];
        layout.forEach((rect, id) => {
            const card = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
            if (!card) return;
            this.applyNoteRect(card, rect, { settling: animate });
            card.classList.toggle('layout-preview', preview);
            if (save) {
                this.saveGridLayout(id, rect);
            }
            this.finalizeDesktopCard(card);
            placed.push(rect);
        });
        this.scheduleBoardCanvasExtents(canvas);
        if (animate && !preview) {
            window.setTimeout(() => {
                canvas.querySelectorAll('.mini-card.layout-settling').forEach((c) => {
                    c.classList.remove('layout-settling');
                });
            }, 160);
        }
        return placed;
    },

    clearGridLayoutPreview(canvas) {
        this.clearSnapPanelPreview(canvas);
    },

    getGridViewportBounds(canvas) {
        const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
        const pad = 24;
        const { origin, packW, edgePad } = this.getGridBoardBounds(canvas);
        const viewportH = Math.max(200, (canvas.clientHeight || 400) / zoom - pad);
        const scrollY = (canvas?.scrollTop || 0) / zoom;
        const viewportBottom = origin + scrollY + viewportH;
        return { origin, packW, viewportH, edgePad, scrollY, viewportBottom };
    },

    findDesktopCenterSlot(w, h, canvas, viewMode, { excludeId = null } = {}) {
        const host = canvas || document.getElementById('app-canvas');
        if (!host) return { x: 8, y: 8, w, h };
        const mode = viewMode || activeBoardViewMode;

        if (isSnapLayoutMode(mode)) {
            const { origin, packW, maxH, edgePad } = this.getGridBoardBounds(host);
            const { viewportH, scrollY } = this.getGridViewportBounds(host);
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
            if (placed.some((p) => this.rectsOverlap(rect, p))) {
                rect = this.findNearestGridSlot(rect, w, h, placed, { packW, origin, maxH, edgePad });
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

    reflowGridBoard(canvas, actorId, { animate = true, actorRect: explicitActorRect = null } = {}) {
        if (!canvas?.classList.contains('view-grid')) return;
        let actorRect = explicitActorRect;
        if (!actorRect && actorId) {
            const actorCard = canvas.querySelector(
                `.mini-card[data-desktop="1"][data-id="${CSS.escape(actorId)}"]`
            );
            if (actorCard) actorRect = this.readNoteRect(actorCard);
        }
        const layout = this.computeGridBoardLayout(canvas, actorId, actorRect);
        this.applyGridBoardLayout(canvas, layout, { animate, save: true });
    },

    repackGridBoardFromOrigin(canvas, { animate = true, items = [] } = {}) {
        if (!canvas?.classList.contains('view-grid')) return;
        const { origin, packW, maxH, edgePad } = this.getGridBoardBounds(canvas);
        const small = getSmallRect(readTileSmallFootprint());
        const byId = new Map((items || []).map((item) => [item.id, item]));
        const cards = [...canvas.querySelectorAll('.mini-card[data-desktop="1"]')].sort((a, b) => {
            const itemA = byId.get(a.dataset.id) || this.resolveBoardItem(a.dataset.id);
            const itemB = byId.get(b.dataset.id) || this.resolveBoardItem(b.dataset.id);
            const aTime = Number(itemA?.created_at || itemA?.updated_at || 0);
            const bTime = Number(itemB?.created_at || itemB?.updated_at || 0);
            return aTime - bTime;
        });
        const placed = [];
        const layout = new Map();
        cards.forEach((card) => {
            const id = card.dataset.id;
            if (!id) return;
            let slot = this.findFirstCanvasSlot(small.w, small.h, placed, packW + origin * 2, { origin, edgePad });
            slot = this.snapNoteRect(
                { ...slot, w: small.w, h: small.h },
                { maxW: packW, maxH, origin, edgePad }
            );
            layout.set(id, slot);
            placed.push(slot);
        });
        this.applyGridBoardLayout(canvas, layout, { animate, save: true });
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
            if (NoteSurface.canEditInline() && resolveTileSize(item) !== 'small') {
                NoteSurface.mutateItem(item, (it) => { it.tileSize = 'small'; }, { preserveView: true, skipRerender: true });
                item.tileSize = 'small';
                boardItemsById.set(item.id, item);
            }
            let slot = this.findFirstCanvasSlot(small.w, small.h, placed, packW + origin * 2, { origin, edgePad });
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

    initGridBoardCardStack(card, orderIndex = 0) {
        this.initDesktopCardStack(card, orderIndex);
    },

    raiseDesktopCard(card) {
        if (!isDesktopCard(card)) return;
        raiseDesktopElement(card);
        const frontClass = isSnapLayoutMode(activeBoardViewMode) ? 'is-grid-front' : 'is-freeform-front';
        card.classList.add(frontClass);
        card.closest('#app-canvas')?.querySelectorAll(`.mini-card.${frontClass}`).forEach((other) => {
            if (other !== card) other.classList.remove(frontClass);
        });
    },

    raiseGridBoardCard(card) {
        this.raiseDesktopCard(card);
    },

    snapCanvasCoord(value, origin = CANVAS_LAYOUT_ORIGIN, stride) {
        const step = stride ?? getGridMetrics().strideX;
        return origin + this.snapGridCoord(Math.max(0, value - origin), step);
    },

    findFirstCanvasSlot(w, h, placed, canvasW, { origin = CANVAS_LAYOUT_ORIGIN, edgePad, yMin } = {}) {
        const metrics = getGridMetrics();
        const pad = edgePad ?? metrics.edgePad;
        const packW = Math.max(metrics.canvasGridW, canvasW - origin * 2 - pad * 2);
        const xOrigin = origin + pad;
        const yOrigin = Math.max(origin + pad, yMin ?? origin + pad);
        const rowStride = this.gridColumnStride(w, h, metrics);
        const yStride = getPackStrideYForRect(w, h);
        let y = yOrigin;
        while (true) {
            let x = xOrigin;
            while (x + w <= origin + pad + packW + 1) {
                const candidate = this.snapNoteRect(
                    { x, y, w, h },
                    { maxW: packW, origin, edgePad: pad }
                );
                if (!placed.some((p) => this.rectsOverlap(candidate, p, metrics.gap))) {
                    return candidate;
                }
                x += rowStride;
            }
            y += yStride;
        }
    },

    snapGridCoord(value, stride) {
        const step = stride ?? getGridMetrics().strideX;
        return Math.max(0, Math.round(value / step) * step);
    },

    clampManualNoteRect(rect, { maxW = Infinity, maxH = Infinity } = {}) {
        let w = Math.max(FREEFORM_MIN_W, Math.round(rect.w));
        let h = Math.max(FREEFORM_MIN_H, Math.round(rect.h));
        if (maxW < Infinity) w = Math.min(w, maxW);
        if (maxH < Infinity) h = Math.min(h, maxH);
        let x = Math.max(0, Math.round(rect.x));
        let y = Math.max(0, Math.round(rect.y));
        if (maxW < Infinity && x + w > maxW) x = Math.max(0, maxW - w);
        if (maxH < Infinity && y + h > maxH) y = Math.max(0, maxH - h);
        return { x, y, w, h };
    },

    snapNotePosition(rect, { maxW = Infinity, maxH = Infinity, origin = CANVAS_LAYOUT_ORIGIN, edgePad } = {}) {
        const metrics = getGridMetrics();
        const pad = edgePad ?? metrics.edgePad;
        const w = Math.max(FREEFORM_MIN_W, Math.round(rect.w));
        const h = Math.max(FREEFORM_MIN_H, Math.round(rect.h));
        const atSmall = isCollapsedSpatialSize(w, h);
        let x;
        let y;
        if (atSmall) {
            const xPack = this.gridColumnStride(w, h, metrics);
            const yPack = this.gridRowStride(w, h, metrics);
            x = this.snapPackCoord(rect.x, origin, pad, xPack);
            y = this.snapPackCoord(rect.y, origin, pad, yPack);
        } else {
            x = this.snapGridCoord(rect.x, metrics.strideX);
            y = this.snapGridCoord(rect.y, metrics.strideY);
        }
        const minX = origin + pad;
        const minY = origin + pad;
        x = Math.max(minX, x);
        y = Math.max(minY, y);
        if (maxW < Infinity) {
            const rightLimit = origin + pad + maxW;
            if (x + w > rightLimit + 1) {
                x = Math.max(minX, rightLimit - w);
            }
        }
        if (maxH < Infinity) {
            const bottomLimit = maxH - pad;
            if (y + h > bottomLimit + 1) {
                y = Math.max(minY, bottomLimit - h);
            }
        }
        return { x, y, w, h };
    },

    snapNoteRect(rect, { maxW = Infinity, maxH = Infinity, origin = CANVAS_LAYOUT_ORIGIN, edgePad } = {}) {
        const metrics = getGridMetrics();
        const pad = edgePad ?? metrics.edgePad;
        const footprint = readTileSmallFootprint();
        if (isCollapsedSpatialSize(rect.w, rect.h)) {
            const small = getSmallRect(footprint);
            const xPack = this.gridColumnStride(small.w, small.h, metrics);
            const yPack = this.gridRowStride(small.w, small.h, metrics);
            const snapped = {
                x: this.snapPackCoord(rect.x, origin, pad, xPack),
                y: this.snapPackCoord(rect.y, origin, pad, yPack),
                w: small.w,
                h: small.h
            };
            return this.snapNotePosition(snapped, { maxW, maxH, origin, edgePad: pad });
        }

        const wCells = Math.max(1, geoSpanToCellsW(rect.w));
        const hCells = Math.max(1, geoSpanToCellsH(rect.h));
        let w = geoCellsToSpanW(wCells);
        let h = geoCellsToSpanH(hCells);
        if (maxW < Infinity) {
            const maxCells = Math.max(1, geoSpanToCellsW(maxW));
            w = geoCellsToSpanW(Math.min(wCells, maxCells));
        }
        if (maxH < Infinity) {
            const maxCells = Math.max(1, geoSpanToCellsH(maxH));
            h = geoCellsToSpanH(Math.min(hCells, maxCells));
        }
        const snapped = {
            x: this.snapGridCoord(rect.x, metrics.strideX),
            y: this.snapGridCoord(rect.y, metrics.strideY),
            w: Math.max(FREEFORM_MIN_W, w),
            h: Math.max(FREEFORM_MIN_H, h)
        };
        return this.snapNotePosition(snapped, { maxW, maxH, origin, edgePad: pad });
    },

    readNoteRect(card) {
        const styleW = parseFloat(card.style.width);
        const styleH = parseFloat(card.style.height);
        const hasInlineW = Number.isFinite(styleW) && styleW > 0;
        const hasInlineH = Number.isFinite(styleH) && styleH > 0;
        const offsetW = card.offsetWidth || 0;
        const offsetH = card.offsetHeight || 0;

        let w = hasInlineW ? styleW : (offsetW || FREEFORM_DEFAULT_W);
        let h = hasInlineH ? styleH : (offsetH || FREEFORM_DEFAULT_H);

        if (isDesktopCard(card) && !this.isCardActivelyResizing(card)) {
            const item = this.resolveBoardItem(card?.dataset?.id);
            const tileSize = resolveTileSize(item);
            if (isCollapsedSpatialSize(w, h, tileSize)) {
                const small = getSmallRect(readTileSmallFootprint());
                w = small.w;
                h = small.h;
            }
        }

        return {
            x: parseFloat(card.style.left) || 0,
            y: parseFloat(card.style.top) || 0,
            w,
            h
        };
    },

    applyNoteRect(card, rect, { settling = false } = {}) {
        card.style.position = 'absolute';
        card.style.left = `${rect.x}px`;
        card.style.top = `${rect.y}px`;
        this.applyFreeformDimensions(card, rect.w, rect.h);
        card.classList.toggle('layout-settling', settling);
    },

    rectsOverlap(a, b, gap) {
        const g = gap ?? getGridMetrics().gap;
        return !(
            a.x + a.w + g <= b.x
            || b.x + b.w + g <= a.x
            || a.y + a.h + g <= b.y
            || b.y + b.h + g <= a.y
        );
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
