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

export const UI = {
    flushAllInlineEditsFromCanvas(canvas, items, opts = {}) {
        return Spatial.flushAllInlineEditsFromCanvas(this, canvas, items, opts);
    },

    getActiveBoardViewMode() {
        return readActiveBoardViewMode();
    },

    persistViewSessionForMode(mode, canvas = document.getElementById('app-canvas')) {
        return Spatial.persistViewSessionForMode(this, mode, canvas);
    },

    restoreViewSessionForMode(mode) { return Spatial.restoreViewSessionForMode(this, mode); },

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

    setupFreeformChrome(card) { return Spatial.setupFreeformChrome(this, card); },

    syncSpatialChromeForEditing(card) { return Spatial.syncSpatialChromeForEditing(this, card); },

    readFreeformCardSize(card) { return Spatial.readFreeformCardSize(this, card); },

    clearFreeformCustomSize(itemId) { return Spatial.clearFreeformCustomSize(this, itemId); },

    applyFreeformDimensions(card, w, h) { return Spatial.applyFreeformDimensions(this, card, w, h); },

    isCardActivelyResizing(card) { return Spatial.isCardActivelyResizing(this, card); },

    finalizeDesktopCard(card, opts = {}) { return Spatial.finalizeDesktopCard(this, card, opts); },

    updateDesktopCard(card, item, opts = {}) { return Spatial.updateDesktopCard(this, card, item, opts); },

    focusPendingBoardField(card) { return Spatial.focusPendingBoardField(this, card); },

    markNoteCollapsed(itemId) { return Spatial.markNoteCollapsed(this, itemId); },

    collapseBoardCardIfExpanded(card, item, hiddenCategories = []) {
        return Spatial.collapseBoardCardIfExpanded(this, card, item, hiddenCategories);
    },

    getFreeformPositions() { return Spatial.getFreeformPositions(this); },

    saveFreeformPosition(itemId, x, y) { return Spatial.saveFreeformPosition(this, itemId, x, y); },

    getFreeformSizes() { return Spatial.getFreeformSizes(this); },

    saveFreeformSize(itemId, w, h, opts = {}) { return Spatial.saveFreeformSize(this, itemId, w, h, opts); },

    saveFreeformSizeFromCard(card) { return Spatial.saveFreeformSizeFromCard(this, card); },

    flushLayoutFromCanvas(canvas, _viewMode) { return Spatial.flushLayoutFromCanvas(this, canvas, _viewMode); },

    migrateFreeformLayoutToGrid(items) { return Spatial.migrateFreeformLayoutToGrid(this, items); },

    applyDesktopLayoutModeSwitch(canvas) { return Spatial.applyDesktopLayoutModeSwitch(this, canvas); },

    convertDesktopLayoutForModeChange(_canvas, _fromMode, _toMode, _items) {
        return Spatial.convertDesktopLayoutForModeChange(this, _canvas, _fromMode, _toMode, _items);
    },

    resolveFreeformSourceRect(item, canvas) { return Spatial.resolveFreeformSourceRect(this, item, canvas); },

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

    getGridLayout() { return Spatial.getGridLayout(this); },

    saveGridLayout(itemId, rect, opts = {}) { return Spatial.saveGridLayout(this, itemId, rect, opts); },

    saveFiledCabinetLayout(itemId, rect, sortBy) { return Spatial.saveFiledCabinetLayout(this, itemId, rect, sortBy); },

    saveCompactBoardLayout(itemId, slot, _sortBy) {
        return Spatial.saveCompactBoardLayout(this, itemId, slot, _sortBy);
    },

    removeGridLayout(itemId) { return Spatial.removeGridLayout(this, itemId); },

    getBoardPins() { return Spatial.getBoardPins(this); },

    getGridPins() { return Spatial.getGridPins(this); },

    isBoardPinned(itemId) { return Spatial.isBoardPinned(this, itemId); },

    isGridPinned(itemId) { return Spatial.isGridPinned(this, itemId); },

    toggleBoardPin(itemId) { return Spatial.toggleBoardPin(this, itemId); },

    toggleGridPin(itemId) { return Spatial.toggleGridPin(this, itemId); },

    getGridBoardBounds(canvas) { return Spatial.getGridBoardBounds(this, canvas); },

    getLiveBoardBounds(canvas) { return Spatial.getLiveBoardBounds(this, canvas); },

    getDesktopBoardPane(canvas) { return Spatial.getDesktopBoardPane(this, canvas); },

    ensureDesktopBoardPane(canvas) { return Spatial.ensureDesktopBoardPane(this, canvas); },

    scheduleBoardCanvasExtents(canvas) { return Spatial.scheduleBoardCanvasExtents(this, canvas); },

    updateBoardCanvasExtents(canvas) { return Spatial.updateBoardCanvasExtents(this, canvas); },

    updateDesktopScrollPolicy(canvas) { return Spatial.updateDesktopScrollPolicy(this, canvas); },

    applyDesktopSize(card) { return Spatial.applyDesktopSize(this, card); },

    clampGridResize(w, h, opts = {}) { return Spatial.clampGridResize(this, w, h, opts); },

    computeGridBoardLayout(canvas, actorId, actorRect = null) {
        return Spatial.computeGridBoardLayout(this, canvas, actorId, actorRect);
    },

    clearSnapPanelPreview(panelEl) { return Spatial.clearSnapPanelPreview(this, panelEl); },

    applyGridBoardLayout(canvas, layout, opts = {}) {
        return Spatial.applyGridBoardLayout(this, canvas, layout, opts);
    },

    clearGridLayoutPreview(canvas) { return Spatial.clearGridLayoutPreview(this, canvas); },

    findDesktopCenterSlot(w, h, canvas, viewMode, opts = {}) {
        return Spatial.findDesktopCenterSlot(this, w, h, canvas, viewMode, opts);
    },

    updateGridScrollPolicy(canvas, opts = {}) { return Spatial.updateGridScrollPolicy(this, canvas, opts); },

    reflowGridBoard(canvas, actorId, opts = {}) { return Spatial.reflowGridBoard(this, canvas, actorId, opts); },

    repackBoardLayoutStorage(mode, items, canvas) {
        return Spatial.repackBoardLayoutStorage(this, mode, items, canvas);
    },

    initDesktopCardStack(card, orderIndex = 0) { return Spatial.initDesktopCardStack(this, card, orderIndex); },

    raiseDesktopCard(card) { return Spatial.raiseDesktopCard(this, card); },

    snapNotePosition(rect, opts) { return Spatial.snapNotePosition(this, rect, opts); },

    snapNoteRect(rect, opts) { return Spatial.snapNoteRect(this, rect, opts); },

    readNoteRect(card) { return Spatial.readNoteRect(this, card); },

    applyNoteRect(card, rect, opts = {}) { return Spatial.applyNoteRect(this, card, rect, opts); },

    getCollapsedCategories() { return Spatial.getCollapsedCategories(this); },

    isCategoryCollapsed(categoryName) { return Spatial.isCategoryCollapsed(this, categoryName); },

    toggleCategoryCollapsed(categoryName) { return Spatial.toggleCategoryCollapsed(this, categoryName); },
};
