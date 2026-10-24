/** @module {"owns":"file cabinet facade - the public surface ui.js/shellResize.js/dragdrop.js import, plus the four board-side helpers that compose the split modules", "related":["fileCabinet/order.js","fileCabinet/layout.js","fileCabinet/chrome.js","fileCabinet/transfer.js","fileCabinet/render.js","fileCabinet/categoryRail.js","fileCabinet/drag.js","noteSurface.js","dragdrop.js"], "events":["filecabinet:layout_changed"]} */
import { UNCATEGORIZED_COLOR } from './categories.js';
import { getItemCategoryName } from './focusFilter.js';
import { normalizeViewMode } from './viewSession.js';
import { syncCabinetSplitter } from './shellResize.js';
import { BoardOperations } from './boardOperations.js';

// Only what the helpers at the bottom of this file call. Everything else is a
// pure re-export, kept out of the import list so nothing here pretends to use it.
import {
    getFileCabinetFiledCategories,
    saveFileCabinetFiledCategories,
    appendFileCabinetCategoryOrder,
    removeFromFileCabinetOrder,
    partitionItemsForFileCabinet,
    fileItemToCabinet,
    seedFileCabinetOrderFromItems,
    sortFileCabinetItems
} from './fileCabinet/order.js';

export {
    getFileCabinetOrder,
    saveFileCabinetOrder,
    removeFromFileCabinetOrder,
    addToFileCabinetOrder,
    reorderInCategory,
    getFileCabinetFiledCategories,
    saveFileCabinetFiledCategories,
    isFileCabinetEmptyShelvesCollapsed,
    setFileCabinetEmptyShelvesCollapsed,
    toggleFileCabinetEmptyShelvesCollapsed,
    isFileCabinetCategoryFiled,
    toggleFileCabinetCategoryFiled,
    getFileCabinetCategoryOrder,
    saveFileCabinetCategoryOrder,
    appendFileCabinetCategoryOrder,
    removeCategoryFromFileCabinetLayout,
    applyFileCabinetCategoryOrder,
    persistFileCabinetCategoryOrderFromDom,
    getStoredItemSize,
    isItemInFileCabinetOrder,
    pruneFileCabinetOrderByLayout,
    shouldFileItem,
    isItemFiled,
    partitionItemsForFileCabinet,
    fileItemToCabinet,
    fileAllItemsToCabinet,
    migrateItemsToFileCabinet,
    reconcileFileCabinetOrderWithItems,
    seedFileCabinetOrderFromItems,
    seedFromCurrentLayout,
    applySortToFileCabinetOrder,
    pruneFileCabinetOrder,
    saveFiledCabinetLayout,
    sortFileCabinetItems,
} from './fileCabinet/order.js';
export {
    FILE_CABINET_ORDER_KEY,
    FILE_CABINET_FILED_CATEGORIES_KEY,
    FILE_CABINET_CATEGORY_ORDER_KEY,
    FILE_CABINET_EMPTY_SHELVES_COLLAPSED_KEY,
} from './fileCabinet/order.js';

// Re-exported only: no facade code touches these directly any more.
export {
    getFileCabinetDragMinHeight,
    getFileCabinetContentMinHeight,
    applyFileCabinetStackPositions,
    FILE_CABINET_STACK_OFFSET_Y,
    FILE_CABINET_DRAWER_CARDS_PER_COL,
    DRAG_THRESHOLD
} from './fileCabinet/layout.js';
export {
    getFileCabinetUiScale,
    FILE_CABINET_STACK_OFFSET_X,
    FILE_CABINET_DRAWER_WIDTH,
    FILE_CABINET_DRAWER_MIN_CARDS,
    FILE_CABINET_COL_GAP,
    FILE_CABINET_MIN_HEIGHT,
    FILE_CABINET_REF_HEIGHT,
    FILE_CABINET_MIN_HEIGHT_RATIO
} from './fileCabinet/layout.js';

import { isFileCabinetActive, ensureFileCabinetMount } from './fileCabinet/chrome.js';
export { isFileCabinetActive, ensureFileCabinetMount };
export { syncFileCabinetDrawerHeight } from './fileCabinet/chrome.js';
export {
    setFileCabinetActive,
    isFileCabinetShut,
    setFileCabinetShut,
    readFileCabinetHeight,
    writeFileCabinetHeight,
    applyFileCabinetShut,
    clearFileCabinetShut,
    FILE_CABINET_KEY,
    FILE_CABINET_HEIGHT_KEY,
    FILE_CABINET_SHUT_KEY,
    FILE_CABINET_BOARD_MIN_HEIGHT,
    FILE_CABINET_SHUT_SNAP_PX
} from './fileCabinet/chrome.js';

import { captureClientRect, dispatchBoardVisibility } from './fileCabinet/transfer.js';
export {
    moveItemBetweenCategories,
    expandFileCabinetItemToBoard,
    expandFileCabinetCategoryToBoard
} from './fileCabinet/transfer.js';
export {
    fileBoardItemToCabinet
} from './fileCabinet/transfer.js';

import { renderFileCabinet } from './fileCabinet/render.js';

export {
    initFileCabinetFoldedHoverPreview,
    initFileCabinetCategoryActions,
    buildFileCabinetRolloutStack
} from './fileCabinet/categoryRail.js';
export {
    beginBoardFilingGhost,
    moveBoardFilingGhost,
    endBoardFilingGhost,
    clearFileCabinetFilingPreview,
    previewFileCabinetTabDrop,
    resolveCrossSurfaceDropTarget,
    clearFileCabinetSurfaceHighlights,
    applyFileCabinetDropHighlight,
    initFileCabinetDrag
} from './fileCabinet/drag.js';
export {
    renderFileCabinet
};

/** Mark a category as filed (collapsed) on the rail; used when adding empty cats. */
export function seedCategoryAsFiled(name) {
    const cat = String(name || '').trim();
    if (!cat) return;
    appendFileCabinetCategoryOrder(cat);
    const filed = getFileCabinetFiledCategories();
    if (filed.includes(cat)) return;
    saveFileCabinetFiledCategories([...filed, cat]);
}

/** Patch category color in place — avoids full board/FC re-render. */
export function applyCategoryColorLive(catName, color, items = []) {
    const clean = color && String(color).trim() ? String(color).trim() : UNCATEGORIZED_COLOR;
    const catSel = `.file-cabinet-category[data-category="${CSS.escape(catName)}"], .file-cabinet-filed-slot[data-category="${CSS.escape(catName)}"]`;
    document.querySelectorAll(catSel).forEach((el) => {
        el.style.setProperty('--card-category-color', clean);
        el.style.setProperty('--file-cabinet-category-color', clean);
        el.querySelector('.file-cabinet-category-dot')?.style.setProperty('background', clean);
    });

    document.querySelectorAll(`.mini-card[data-file-cabinet-category="${CSS.escape(catName)}"]`).forEach((card) => {
        card.style.setProperty('--card-category-color', clean);
    });

    const matchIds = new Set(
        (items || []).filter((item) => getItemCategoryName(item) === catName).map((item) => item.id)
    );
    if (!matchIds.size) return;

    document.querySelectorAll('.mini-card[data-id]').forEach((card) => {
        if (!matchIds.has(card.dataset.id)) return;
        card.style.setProperty('--card-category-color', clean);
        card.querySelector('.badge-dot')?.style.setProperty('background-color', clean);
    });
}


export function getFileCabinetToggleLabels(inFileCabinetStrip, atLabel) {
    if (inFileCabinetStrip || atLabel) {
        return { title: 'Open below', iconKey: 'expand' };
    }
    return { title: 'File away', iconKey: 'collapse' };
}

/**
 * Applies file cabinet zone toggle - moves item to/from file cabinet
 * @param {HTMLElement} card - The card element
 * @param {Object} item - The item
 * @param {Object} ctx - Context options
 * @param {Object} UI - The UI object with helper methods
 */
export function applyFileCabinetZoneToggle(card, item, ctx = {}, UI) {
    if (!UI) return;
    const inFileCabinet = !!card.closest('#file-cabinet');
    let transition = null;

    if (inFileCabinet) {
        const sourceRect = captureClientRect(card);
        removeFromFileCabinetOrder(item.id);
        let rect = UI.resolveBoardExpandRect(card, item);
        const savedGrid = UI.getGridLayout()[item.id];
        const savedPos = UI.getFreeformPositions()[item.id];
        const x = savedGrid?.x ?? savedPos?.x ?? 8;
        const y = savedGrid?.y ?? savedPos?.y ?? 8;
        rect = { x, y, w: rect.w, h: rect.h };
        UI.saveGridLayout(item.id, rect, { updateRemembered: true });
        if (sourceRect && item?.id) {
            transition = { kind: 'fc-expand', itemId: item.id, sourceRect };
        }
    } else {
        const pos = UI.readNoteRect(card);
        fileItemToCabinet(item, UI.activeBoardViewMode, UI, {
            x: pos.x ?? 8,
            y: pos.y ?? 8,
            rememberW: pos.w,
            rememberH: pos.h
        });
    }

    dispatchBoardVisibility({ flushLayout: false, transition });
}

/**
 * Resets file cabinet layout for items
 * @param {string} sortBy - The sort mode
 * @param {Array} items - Items to reset
 * @param {Object} UI - The UI object
 */
export function resetFileCabinetLayout(sortBy, items, UI) {
    const visibleItems = BoardOperations.getVisibleItems(items || []);
    const mode = normalizeViewMode(sortBy);

    const boardItems = visibleItems;
    const { expanded } = partitionItemsForFileCabinet(boardItems, mode, UI);
    expanded.forEach((item) => {
        const savedGrid = UI.getGridLayout()[item.id];
        const savedPos = UI.getFreeformPositions()[item.id];
        fileItemToCabinet(item, mode, UI, {
            x: savedGrid?.x ?? savedPos?.x ?? 8,
            y: savedGrid?.y ?? savedPos?.y ?? 8
        });
    });
    window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
}
/**
 * Prepares board items for rendering, handling file cabinet partitioning
 * @param {Array} visibleItems - Items to prepare
 * @param {boolean} fileCabinetActive - Whether file cabinet is active
 * @param {string} resolvedMode - The current view mode
 * @param {Array} activeCategories - Active categories
 * @param {Object} UI - The UI object (for passing to partitionItemsForFileCabinet)
 * @returns {Object} Object with boardItems and fileCabinetMount
 */
export function prepareBoardItems(visibleItems, fileCabinetActive, resolvedMode, activeCategories, UI, allItems = null) {
    let boardItems = visibleItems;
    let fileCabinetMount = null;
    
    if (fileCabinetActive) {
        const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, resolvedMode, UI);
        seedFileCabinetOrderFromItems(filed);
        fileCabinetMount = ensureFileCabinetMount(true);
        renderFileCabinet(fileCabinetMount, filed, activeCategories, UI, {
            allItems: allItems || visibleItems
        });
        syncCabinetSplitter();
        boardItems = expanded;
    } else {
        ensureFileCabinetMount(false);
        syncCabinetSplitter();
    }
    
    return { boardItems, fileCabinetMount };
}
/**
 * Orchestrates file cabinet sorting for board layout.
 * Partitions items into filed/expanded, sorts filed items, and returns expanded items for board.
 * @param {Array} visibleItems - Items to sort
 * @param {string} mode - Layout mode ('grid' or 'freeform')
 * @param {Object} sortPrefs - Sorting preferences
 * @param {Object} UI - UI context (this)
 * @returns {Array} Expanded items for the board
 */
export function sortBoardLayoutWithFileCabinet(visibleItems, mode, sortPrefs, UI) {
    if (!visibleItems?.length) return [];
    
    const fcActive = isFileCabinetActive();
    if (!fcActive) return visibleItems;
    
    const { filed, expanded } = partitionItemsForFileCabinet(visibleItems, mode, UI);
    sortFileCabinetItems(filed, sortPrefs);
    return expanded;
}
