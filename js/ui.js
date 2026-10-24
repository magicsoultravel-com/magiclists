/** @module {"owns":"the board facade - the one handle six modules import; hold the shared state seam and one-line delegates into ui/*","related":["ui/boardState.js","ui/gridPack.js","ui/spatial.js","ui/render.js"]} */
import { LEGACY_TILE_SIZE, getLargeDefaultRect } from './tileGeometry.js';
import { readTileSmallFootprint } from './tileFootprint.js';
import { readActiveBoardViewMode } from './ui/boardState.js';
import * as GridPack from './ui/gridPack.js';
import * as Render from './ui/render.js';
import * as Spatial from './ui/spatial.js';

export { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS, DRAWING_ICONS } from './icons.js';
export {
    deriveNoteTitle,
    createNoteId,
    noteHasSavableContent,
    formatLocalDateTimeParts,
    defaultStartDateTimeNow,
    normalizeItemForSave
} from './noteModel.js';
export { isDesktopCard } from './desktopManager.js';

/**
 * Every method below is a delegate. The board sessions take the receiver as
 * their first argument (`Spatial.commitSpatialRect(this, ...)`), which is what
 * lets them be unit-tested against a double instead of a mounted board - see
 * test/uiSpatialGeometry.test.js. Nothing here may grow a body again: a body in
 * the facade is invisible to the session suites and untestable.
 *
 * Cross-session calls also come back through here: a moved body that used to
 * call `this.foo()` now calls `ui.foo()`, landing on the delegate and reaching
 * whichever session owns `foo`. The sessions therefore never import each other
 * (the one exception is spatial -> gridPack for the pure sortItemsSpatially
 * helper), so the graph stays a star and no load-order cycle can appear.
 */
export const UI = {
    // ---- State (ui/boardState.js) ----
    getActiveBoardViewMode() {
        return readActiveBoardViewMode();
    },
    updateBoardItemsMap(item) {
        return Spatial.updateBoardItemsMap(item);
    },

    // ---- Grid pack (ui/gridPack.js) ----
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

    // ---- Render (ui/render.js) ----
    render(canvas, items, viewMode, hiddenCategories = [], renderOptions = {}) {
        return Render.render(this, canvas, items, viewMode, hiddenCategories, renderOptions);
    },
    prepareCanvas(canvas) { return Render.prepareCanvas(this, canvas); },
    getActiveCategories(hiddenCategories) { return Render.getActiveCategories(this, hiddenCategories); },
    getViewState() { return Render.getViewState(this); },
    applyCanvasClasses(canvas, fileCabinetActive) {
        return Render.applyCanvasClasses(this, canvas, fileCabinetActive);
    },
    prepareBoardItems(visibleItems, fileCabinetActive, resolvedMode, activeCategories, allItems = null) {
        return Render.prepareBoardItems(this, visibleItems, fileCabinetActive, resolvedMode, activeCategories, allItems);
    },
    renderEmptyState(canvas, fileCabinetActive, visibleItems, safeItems) {
        return Render.renderEmptyState(this, canvas, fileCabinetActive, visibleItems, safeItems);
    },
    layoutBoard(canvas, boardItems, activeCategories) {
        return Render.layoutBoard(this, canvas, boardItems, activeCategories);
    },
    renderCards(boardItems, activeCategories, layout, placed, boardPane) {
        return Render.renderCards(this, boardItems, activeCategories, layout, placed, boardPane);
    },
    finalizeRender(canvas, boardPane, renderOptions) {
        return Render.finalizeRender(this, canvas, boardPane, renderOptions);
    },
    buildCardActionsHtml(item, isExpanded = false, options = {}) {
        return Render.buildCardActionsHtml(this, item, isExpanded, options);
    },
    syncCalendarButtonUI(item, btn) { return Render.syncCalendarButtonUI(this, item, btn); },
    getCardActionsOptions(card) { return Render.getCardActionsOptions(this, card); },
    syncBoardPinClass(card) { return Render.syncBoardPinClass(this, card); },

    // ---- Spatial (ui/spatial.js) ----
    flushAllInlineEditsFromCanvas(canvas, items, opts = {}) {
        return Spatial.flushAllInlineEditsFromCanvas(this, canvas, items, opts);
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
