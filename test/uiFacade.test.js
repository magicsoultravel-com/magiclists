// test/uiFacade.test.js
// Boundary freeze for js/ui.js, taken before it is split into js/ui/*.
//
// js/ui.js has six importers (dragdrop, app, hamburger, editor, desktopCardManager,
// noteQuickActions) and no test of its own, so the thing worth pinning is not any
// one method but the shape of the object they all reach into: the export list, the
// 121 method names and their Function.length. The length matters because callers
// pass positionally and every extracted method gains a leading `ui` receiver - if a
// default slips out of a delegate, `UI.packGridBoard(canvas, a, b, opts)` silently
// starts dropping `opts`.
//
// This suite is the gate every slice of the split has to pass unchanged.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const facade = await import('../js/ui.js');
const { UI, isDesktopCard } = facade;
const { DesktopManager } = await import('../js/desktopManager.js');

const EXPORTS = [
    'ACTION_ICONS', 'CARD_ICONS', 'DRAWING_ICONS', 'FORMAT_ICONS', 'UI',
    'createNoteId', 'defaultStartDateTimeNow', 'deriveNoteTitle',
    'formatLocalDateTimeParts', 'isDesktopCard', 'normalizeItemForSave',
    'noteHasSavableContent'
];

// Function.length of every board method, captured at 1894 lines.
const ARITY = {
    applyCanvasClasses: 2, applyCollapsedTileClasses: 2, applyDesktopLayoutModeSwitch: 1, applyDesktopSize: 1,
    applyFileCabinetZoneToggle: 2, applyFreeformDimensions: 3, applyGridBoardLayout: 2, applyNoteRect: 2,
    applySpatialToggleRect: 3, applyTileTierRect: 4, applyTileZoneToggle: 2, bindBoardEditorFocusChrome: 1,
    buildCardActionsHtml: 1, clampGridResize: 2, clampNoteToBoardEdges: 2, clearFreeformCustomSize: 1,
    clearGridLayoutPreview: 1, clearSnapPanelPreview: 1, collapseBoardCardIfExpanded: 2,
    collapseBoardCardToSmallFootprint: 2, collapseSnapPanelCard: 2, collapseSpatialAtCurrentPos: 2,
    commitSpatialRect: 3, computeGridBoardLayout: 2, convertDesktopLayoutForModeChange: 4, ensureDesktopBoardPane: 1,
    finalizeDesktopCard: 1, finalizeRender: 3, findDesktopCenterSlot: 4, flushAllInlineEditsFromCanvas: 2,
    flushLayoutFromCanvas: 2, focusPendingBoardField: 1, getActiveBoardViewMode: 0, getActiveCategories: 1,
    getBoardPins: 0, getCardActionsOptions: 1, getCardTileSize: 1, getCollapsedCategories: 0, getDesktopBoardPane: 1,
    getFreeformPositions: 0, getFreeformSizes: 0, getGridBoardBounds: 1, getGridLayout: 0, getGridPins: 0,
    getLiveBoardBounds: 1, getSavedLayoutRect: 2, getViewState: 0, gridBoardRectForCard: 3, gridTileRect: 3,
    initDesktopCardStack: 1, isBoardPinned: 1, isCardActivelyResizing: 1, isCategoryCollapsed: 1, isGridBoardCard: 1,
    isGridMultiCellSize: 2, isGridPinned: 1, isItemLayoutExpanded: 2, isSavedLayoutExpanded: 1,
    isSpatiallyCollapsed: 1, layoutBoard: 3, markNoteCollapsed: 1, mergeSpatialLayoutEntry: 2,
    migrateFreeformLayoutToGrid: 1, packBoardGridRects: 2, packGridBoard: 3, packSortGridBoard: 5,
    partitionCanvasItemsByExpansion: 2, persistRememberedSpatialSize: 3, persistViewSessionForMode: 1,
    prepareBoardItems: 4, prepareCanvas: 1, preserveSavedBoardRect: 1, raiseDesktopCard: 1, readFreeformCardSize: 1,
    readNoteRect: 1, reapplyBoardMetricsOnBoard: 2, reapplySmallFootprintOnBoard: 0, reflowGridBoard: 2,
    removeGridLayout: 1, render: 3, renderCards: 5, renderEmptyState: 4, repackBoardLayoutStorage: 3,
    resetBoardLayout: 2, resolveAlignedExpandedSize: 2, resolveBoardExpandPlacement: 2, resolveBoardExpandRect: 2,
    resolveBoardItem: 1, resolveCardRect: 2, resolveFreeformSourceRect: 2, resolveRememberedSpatialSize: 2,
    resolveSortItemSize: 3, restoreViewSessionForMode: 1, saveCompactBoardLayout: 3, saveFiledCabinetLayout: 3,
    saveFreeformPosition: 3, saveFreeformSize: 3, saveFreeformSizeFromCard: 1, saveGridLayout: 2,
    saveSpatialLayoutFromResize: 3, saveTileLayoutFromCard: 4, scheduleBoardCanvasExtents: 1, setupFreeformChrome: 1,
    snapNotePosition: 2, snapNoteRect: 2, sortBoardLayout: 3, syncBoardPinClass: 1, syncCalendarButtonUI: 2,
    syncCardDraggable: 1, syncSpatialChromeForEditing: 1, syncSpatialCollapseState: 4, syncSpatialToggleButton: 2,
    toggleBoardPin: 1, toggleCategoryCollapsed: 1, toggleGridPin: 1, updateBoardCanvasExtents: 1,
    updateBoardItemsMap: 1, updateDesktopCard: 2, updateDesktopScrollPolicy: 1, updateGridScrollPolicy: 1,
    updateSingleCard: 2,
};

describe('ui facade · public surface', () => {
    it('exports the same twelve names', () => {
        assert.deepEqual(Object.keys(facade).sort(), EXPORTS);
    });

    it('keeps every board method on UI', () => {
        assert.deepEqual(Object.keys(UI).sort(), Object.keys(ARITY).sort());
        assert.equal(Object.keys(UI).length, 121);
    });

    it('keeps every method callable with the same number of leading arguments', () => {
        for (const [name, length] of Object.entries(ARITY)) {
            assert.equal(typeof UI[name], 'function', `${name} is no longer a function`);
            assert.equal(UI[name].length, length, `${name} changed arity - a default moved or the receiver leaked into the signature`);
        }
    });

    it('keeps the state-backed view helpers answering without a canvas', () => {
        const map = new Map();
        globalThis.localStorage = {
            getItem: (k) => (map.has(k) ? map.get(k) : null),
            setItem: (k, v) => map.set(k, String(v)),
            removeItem: (k) => map.delete(k)
        };

        assert.equal(typeof UI.getActiveBoardViewMode(), 'string');
        assert.deepEqual(Object.keys(UI.getViewState()).sort(), ['activeBoardViewMode', 'fileCabinetActive', 'resolvedMode', 'snapLayout']);
        delete globalThis.localStorage;
    });
});

describe('ui facade · isDesktopCard', () => {
    it('compares the card desktop with the active desktop', () => {
        const active = DesktopManager.getActiveDesktop();

        assert.equal(isDesktopCard({ dataset: { desktop: String(active) } }), true);
        assert.equal(isDesktopCard({ dataset: { desktop: String(Number(active) + 1) } }), false);
        assert.equal(isDesktopCard({}), false);
        assert.equal(isDesktopCard(null), false);
    });
});
