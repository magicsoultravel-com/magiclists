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
import { DesktopManager, isDesktopCard } from './desktopManager.js';
export { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS, DRAWING_ICONS } from './icons.js';
export {
    deriveNoteTitle,
    createNoteId,
    noteHasSavableContent,
    formatLocalDateTimeParts,
    defaultStartDateTimeNow,
    normalizeItemForSave
} from './noteModel.js';
export { isDesktopCard };
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
import * as GridPack from './ui/gridPack.js';
import {
    clearBoardItems,
    getBoardItem,
    readActiveBoardViewMode,
    replaceBoardItemsMap,
    setBoardItem,
    writeActiveBoardViewMode
} from './ui/boardState.js';
import * as Spatial from './ui/spatial.js';

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

export const UI = {
    flushAllInlineEditsFromCanvas(canvas, items, { forceFlush = false, skipItemId = null, skipItemIds = null } = {}) {
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
    },

    getActiveBoardViewMode() {
        return readActiveBoardViewMode();
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

    resolveBoardItem(itemId) { return Spatial.resolveBoardItem(this, itemId); },

    getSavedLayoutRect(card, item) { return Spatial.getSavedLayoutRect(this, card, item); },

    resolveRememberedSpatialSize(saved, item) { return Spatial.resolveRememberedSpatialSize(this, saved, item); },

    resolveBoardExpandRect(card, item) { return Spatial.resolveBoardExpandRect(this, card, item); },

    resolveBoardExpandPlacement(card, item) { return Spatial.resolveBoardExpandPlacement(this, card, item); },

    mergeSpatialLayoutEntry(prev, rect, tileSize = LEGACY_TILE_SIZE, opts = {}) {
        return Spatial.mergeSpatialLayoutEntry(this, prev, rect, tileSize, opts);
    },

    persistRememberedSpatialSize(itemId, w, h, tileSize = LEGACY_TILE_SIZE) {
        return Spatial.persistRememberedSpatialSize(this, itemId, w, h, tileSize);
    },

    resolveCardRect(card, item, opts = {}) { return Spatial.resolveCardRect(this, card, item, opts); },

    isGridMultiCellSize(w, h) { return Spatial.isGridMultiCellSize(this, w, h); },

    getCardTileSize(card, item = null) { return Spatial.getCardTileSize(this, card, item); },

    applyCollapsedTileClasses(card, tileSize) { return Spatial.applyCollapsedTileClasses(this, card, tileSize); },

    isSpatiallyCollapsed(card) { return Spatial.isSpatiallyCollapsed(this, card); },

    isSavedLayoutExpanded(itemId, footprint = readTileSmallFootprint()) {
        return Spatial.isSavedLayoutExpanded(this, itemId, footprint);
    },

    syncSpatialCollapseState(card, item, w, h) { return Spatial.syncSpatialCollapseState(this, card, item, w, h); },

    syncSpatialToggleButton(card, atSmall) { return Spatial.syncSpatialToggleButton(this, card, atSmall); },

    bindBoardEditorFocusChrome(card) { return Spatial.bindBoardEditorFocusChrome(this, card); },

    saveTileLayoutFromCard(card, item, rect, tileSize) {
        return Spatial.saveTileLayoutFromCard(this, card, item, rect, tileSize);
    },

    saveSpatialLayoutFromResize(card, item, tileSize) {
        return Spatial.saveSpatialLayoutFromResize(this, card, item, tileSize);
    },

    collapseSnapPanelCard(card, item) { return Spatial.collapseSnapPanelCard(this, card, item); },

    commitSpatialRect(card, item, rect, ctx = {}) { return Spatial.commitSpatialRect(this, card, item, rect, ctx); },

    applyTileTierRect(card, item, nextTier, rect, ctx = {}) {
        return Spatial.applyTileTierRect(this, card, item, nextTier, rect, ctx);
    },

    applySpatialToggleRect(card, item, rect, ctx = {}) {
        return Spatial.applySpatialToggleRect(this, card, item, rect, ctx);
    },

    collapseSpatialAtCurrentPos(card, item, ctx = {}) {
        return Spatial.collapseSpatialAtCurrentPos(this, card, item, ctx);
    },

    collapseBoardCardToSmallFootprint(card, item, ctx = {}) {
        return Spatial.collapseBoardCardToSmallFootprint(this, card, item, ctx);
    },

    applyTileZoneToggle(card, item, ctx = {}) { return Spatial.applyTileZoneToggle(this, card, item, ctx); },

    applyFileCabinetZoneToggle(card, item, ctx = {}) {
        return Spatial.applyFileCabinetZoneToggle(this, card, item, ctx);
    },

    reapplySmallFootprintOnBoard() { return Spatial.reapplySmallFootprintOnBoard(this); },

    reapplyBoardMetricsOnBoard(prevMetrics, nextMetrics) {
        return Spatial.reapplyBoardMetricsOnBoard(this, prevMetrics, nextMetrics);
    },

    clampNoteToBoardEdges(rect, opts) { return Spatial.clampNoteToBoardEdges(this, rect, opts); },

    preserveSavedBoardRect(rect) { return Spatial.preserveSavedBoardRect(this, rect); },

    gridBoardRectForCard(card, savedRect, isExpanded, itemId = null) {
        return Spatial.gridBoardRectForCard(this, card, savedRect, isExpanded, itemId);
    },

    gridTileRect(tileSize, base, saved) { return Spatial.gridTileRect(this, tileSize, base, saved); },

    syncCardDraggable(card) { return Spatial.syncCardDraggable(this, card); },

    isGridBoardCard(card) { return Spatial.isGridBoardCard(this, card); },

    updateSingleCard(canvas, item, hiddenCategories = []) {
        return Spatial.updateSingleCard(this, canvas, item, hiddenCategories);
    },

    updateBoardItemsMap(item) {
        return Spatial.updateBoardItemsMap(item);
    },

    render(canvas, items, viewMode, hiddenCategories = [], renderOptions = {}) {
        if (!canvas) return;
        // Clear stale map references before destroying DOM elements
        clearBoardItems();
        this.prepareCanvas(canvas);
         
        const safeItems = Array.isArray(items) ? items : [];
        const visibleItems = BoardOperations.getVisibleItems(safeItems);
        replaceBoardItemsMap(new Map(visibleItems.map((item) => [item.id, item])));

        const activeCategories = this.getActiveCategories(hiddenCategories);
         
        const { resolvedMode, fileCabinetActive } = this.getViewState();
        this.applyCanvasClasses(canvas, fileCabinetActive);

        // Always refresh FC for the active desktop before empty-state.
        // FC lives outside #app-canvas; skipping this left the previous desktop's tabs.
        const { boardItems } = this.prepareBoardItems(
            visibleItems,
            fileCabinetActive,
            resolvedMode,
            activeCategories,
            safeItems
        );

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

    prepareBoardItems(visibleItems, fileCabinetActive, resolvedMode, activeCategories, allItems = null) {
        let boardItems = visibleItems;
        let fileCabinetMount = null;
         
        if (fileCabinetActive) {
            const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, resolvedMode, this);
            seedFileCabinetOrderFromItems(filed);
            fileCabinetMount = ensureFileCabinetMount(true);
            renderFileCabinet(fileCabinetMount, filed, activeCategories, this, {
                allItems: allItems || visibleItems
            });
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

        // Bento-only push; skip when Allow-overlap or spatially collapsed.
        if (canvas?.classList.contains('view-grid') && isBoardOverlayEnabled()) {
            const rect = this.readNoteRect(card);
            if (!isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(item))) {
                requestAnimationFrame(() => {
                    this.reflowGridBoard(canvas, item.id, { animate: true });
                });
            }
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
        this.packGridBoard(canvas, GridPack.sortItemsSpatially(collapsed, getSourceRect), GridPack.sortItemsSpatially(expanded, getSourceRect), {
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
        writeActiveBoardViewMode('grid');
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

    isItemLayoutExpanded(item, mode) { return GridPack.isItemLayoutExpanded(this, item, mode); },

    resolveSortItemSize(item, mode, isExpanded, alignedSize = null) {
        return GridPack.resolveSortItemSize(this, item, mode, isExpanded, alignedSize);
    },

    resolveAlignedExpandedSize(packW, count, minNoteW = getLargeDefaultRect().w) {
        return GridPack.resolveAlignedExpandedSize(this, packW, count, minNoteW);
    },

    partitionCanvasItemsByExpansion(items, mode) {
        return GridPack.partitionCanvasItemsByExpansion(this, items, mode);
    },

    packGridBoard(canvas, collapsedItems, expandedItems, opts = {}) {
        return GridPack.packGridBoard(this, canvas, collapsedItems, expandedItems, opts);
    },

    packBoardGridRects(collapsedItems, expandedItems, opts = {}) {
        return GridPack.packBoardGridRects(this, collapsedItems, expandedItems, opts);
    },

    packSortGridBoard(canvas, collapsedItems, expandedItems, sortPrefs, pinnedIds) {
        return GridPack.packSortGridBoard(this, canvas, collapsedItems, expandedItems, sortPrefs, pinnedIds);
    },

    sortBoardLayout(viewMode, items, sortPrefs, opts = {}) {
        return GridPack.sortBoardLayout(this, viewMode, items, sortPrefs, opts);
    },

    resetBoardLayout(sortBy, items, opts = {}) { return GridPack.resetBoardLayout(this, sortBy, items, opts); },

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
        const mode = viewMode || readActiveBoardViewMode();

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
            Spatial.ensureSmallTile(item);

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
