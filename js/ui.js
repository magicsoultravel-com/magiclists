import {
    categoryKey,
    isUncategorizedCategory,
    readStoredCategories,
    UNCATEGORIZED_CATEGORY
} from './categories.js';
import { applyCardTheme } from './cardTheme.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor, THEME_DEFAULT_COLOR } from './colorPicker.js';
import {
    contentHasConvertibleText,
    convertChecklistToContent,
    convertContentToChecklist,
    deriveEditorBodyLayout,
    itemToPlainCopyText,
    SOFT_BREAK,
    stepToPlainCopyLine,
    stepsHaveConvertibleText,
    unwrapLineStrike,
    wrapLineAsStruck
} from './noteBodyConversion.js';
import { hasRichMarkup, linkifyPlainUrls, sanitizeHref, sanitizeRichHtml, stripRichText } from './richText.js';
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
    FILE_CABINET_ORDER_KEY,
    FILE_CABINET_FILED_CATEGORIES_KEY,
    getFileCabinetFiledCategories
} from './fileCabinet.js';
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

export {
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
    resolveTileSize
} from './tileGeometry.js';
export { getGridMetrics } from './gridDensity.js';

const UNCATEGORIZED_COLOR = '#64748b';

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

const GRID_LAYOUT_KEY = 'matrix_grid_layout';
const GRID_PINS_KEY = 'matrix_grid_pins';
const GRID_EXPANDED_KEY = 'matrix_grid_expanded_id';
const CARD_ANIM_MS = 300;
const CARD_COMPACT_H = 56;
const DESKTOP_BOARD_PANE_CLASS = 'desktop-board-pane';
const boardExtentsFrames = new WeakMap();

const cardAnimSessions = new WeakMap();

export function cardAnimationsEnabled() {
    return document.documentElement.dataset.cardAnimations !== '0';
}

let boardItemsById = new Map();
let activeBoardViewMode = 'grid';

export function isSnapLayoutMode(mode) {
    return normalizeViewMode(mode) === 'grid';
}

export function isDesktopCard(card) {
    return card?.dataset?.desktop === '1';
}

// Chrome icon trope: stroke-first, currentColor, fill="none" on paths/shapes (see ACTION_ICONS).
// CARD_ICONS 11×12; ACTION_ICONS 12×12.

function paletteIconSvg(size) {
  const body = `<path d="M6 1.8c-2.3 0-4.2 1.7-4.2 3.9 0 1.4.9 2.5 2.1 3.1L4.8 10h2.4l.9-1.2c1.2-.6 2.1-1.7 2.1-3.1C10.2 3.5 8.3 1.8 6 1.8z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><circle cx="4.4" cy="4.8" r="0.75" fill="none" stroke="currentColor" stroke-width="0.85"/><circle cx="6.2" cy="3.8" r="0.65" fill="none" stroke="currentColor" stroke-width="0.85" opacity="0.85"/><circle cx="7.5" cy="5.2" r="0.6" fill="none" stroke="currentColor" stroke-width="0.85" opacity="0.65"/>`;
  return `<svg viewBox="0 0 12 12" width="${size}" height="${size}" focusable="false">${body}</svg>`;
}

export const CARD_ICONS = {
    calendar: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><rect x="1.5" y="2.5" width="9" height="8" rx="0.8" fill="none" stroke="currentColor" stroke-width="1"/><path d="M1.5 5.2h9M4 1.5v1.6M8 1.5v1.6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
    expand: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    collapse: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 7l3-3 3 3" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    hide: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.2 6s1.6-2.8 4.8-2.8S10.8 6 10.8 6 9.2 8.8 6 8.8 1.2 6 1.2 6z" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="6" cy="6" r="1.4" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2 10L10 2" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
    show: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.2 6s1.6-2.8 4.8-2.8S10.8 6 10.8 6 9.2 8.8 6 8.8 1.2 6 1.2 6z" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="6" cy="6" r="1.4" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    edit: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M8.2 1.8l2 2-6.4 6.4H1.8V8.2L8.2 1.8z" fill="none" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>',
    save: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 6.2l2.6 2.6L9.8 3.8" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    color: paletteIconSvg(11),
    delete: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3 3.2h6M4.2 3.2V2.4h3.6v.8M4.4 5v4.2M7.6 5v4.2M3.8 3.2l.5 6.3h3.4l.5-6.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    archive: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 4.4h7.6v5.4H2.2z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M2 4.4h8V3.5H7.5L6.7 2.5H5.3L4.5 3.5H2v.9z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M5 6.2v2.2M7 6.2v2.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    unarchive: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 5.8h7.6v4H2.2z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M2 5.8h8V4.9H7.5L6.7 3.9H5.3L4.5 4.9H2v.9z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M6 3.2V6.4M6 3.2 4.6 4.6M6 3.2 7.4 4.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    bringFront: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><rect x="1.4" y="4.6" width="7.2" height="5.2" rx="0.55" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M3.4 2.4h7.2v5.2" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pin: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><circle cx="6" cy="3.4" r="2.1" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 5.4v4.8M4.6 10.2h2.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    unpin: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><circle cx="6" cy="3.4" r="2.1" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 5.4v4.8M4.6 10.2h2.8M2.2 2.2l7.6 7.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
    resize: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M8.2 8.2 10.6 10.6M8.2 8.2V5.8M8.2 8.2H5.8M3.4 3.4 1 1M3.4 3.4V5.8M3.4 3.4H5.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    copy: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><rect x="3.5" y="3.8" width="5.8" height="6.4" rx="0.6" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M5.2 2.6h4.2a0.8 0.8 0 0 1 0.8 0.8v4.2" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    drag: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><circle cx="4.4" cy="3.1" r="0.85" fill="currentColor"/><circle cx="7.6" cy="3.1" r="0.85" fill="currentColor"/><circle cx="4.4" cy="6" r="0.85" fill="currentColor"/><circle cx="7.6" cy="6" r="0.85" fill="currentColor"/><circle cx="4.4" cy="8.9" r="0.85" fill="currentColor"/><circle cx="7.6" cy="8.9" r="0.85" fill="currentColor"/></svg>',
    star: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M6 1.8 7.4 4.6 10.5 5l-2.2 2.1.5 3.1L6 9.4 3.2 10.2l.5-3.1L1.5 5 4.6 4.6 6 1.8z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    starFilled: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M6 1.8 7.4 4.6 10.5 5l-2.2 2.1.5 3.1L6 9.4 3.2 10.2l.5-3.1L1.5 5 4.6 4.6 6 1.8z" fill="currentColor" stroke="currentColor" stroke-width="0.35" stroke-linejoin="round"/></svg>',
    heart: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M6 10.2S1.5 7.1 1.5 4.4a2.2 2.2 0 0 1 3.8-1.5L6 4.1l.7-.7A2.2 2.2 0 0 1 10.5 4.4C10.5 7.1 6 10.2 6 10.2z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    heartFilled: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M6 10.2S1.5 7.1 1.5 4.4a2.2 2.2 0 0 1 3.8-1.5L6 4.1l.7-.7A2.2 2.2 0 0 1 10.5 4.4C10.5 7.1 6 10.2 6 10.2z" fill="currentColor" stroke="currentColor" stroke-width="0.35" stroke-linejoin="round"/></svg>'
};

export const FORMAT_ICONS = {
    bold: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M3.2 2.2h3.4a2.2 2.2 0 0 1 0 4.4H3.2V2.2zm0 4.2h3.8a2.2 2.2 0 0 1 0 4.4H3.2V6.4z" fill="currentColor"/></svg>',
    italic: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M5.2 2.2h3.6M6.4 2.2 4.4 9.8M3.2 9.8h3.6" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>',
    strike: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 6h7.6M4.2 3.2h4.8a2 2 0 0 1 0 4M4.2 8.8h4.4a2 2 0 0 0 0-4" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    smaller: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><text x="1.5" y="9" font-size="6" fill="currentColor" font-family="system-ui,sans-serif">A</text><path d="M8 8.5l2.5 1.5" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    larger: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><text x="1" y="9.5" font-size="8" fill="currentColor" font-family="system-ui,sans-serif">A</text><path d="M8.5 7.5l2.5 2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    toChecklist: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><rect x="1.8" y="2.4" width="2.2" height="2.2" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><rect x="1.8" y="5.4" width="2.2" height="2.2" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><rect x="1.8" y="8.4" width="2.2" height="2.2" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><path d="M5.2 3.5h5M5.2 6.5h5M5.2 9.5h4" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
    toNotes: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M2.2 3.2h7.6M2.2 6h7.6M2.2 8.8h5.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>'
};

export const ACTION_ICONS = {
    layoutReset: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 2.8h3.2M2.2 2.8V6M2.2 2.8l2.4 2.4M9.8 9.2H6.6M9.8 9.2V5.8M9.8 9.2 7.4 6.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><rect x="4.2" y="4.2" width="3.6" height="3.6" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    collapseAll: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 8.2 6 4.4l3.8 3.8M2.2 4.6 6 0.8l3.8 3.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    expandAll: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 3.8 6 7.6l3.8-3.8M2.2 7.4 6 11.2l3.8-3.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    viewCols: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.6" y="2.2" width="3.6" height="7.6" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.8" y="2.2" width="3.6" height="7.6" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.95"/></svg>',
    viewFree: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.5" y="2" width="3.2" height="2.6" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="7.3" y="2" width="3.2" height="3.8" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="2.8" y="7.2" width="4.4" height="2.8" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    viewGrid: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="1.6" width="3.8" height="3.8" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><rect x="6.8" y="1.6" width="3.8" height="3.8" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><rect x="1.4" y="6.6" width="8.2" height="3.8" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    viewFileCabinet: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="2.2" width="9.2" height="2.2" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><rect x="1.4" y="4.8" width="9.2" height="2.2" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><rect x="1.4" y="7.4" width="9.2" height="2.2" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    category: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="1.4" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.7" y="1.4" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="1.4" y="6.7" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.7" y="6.7" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/></svg>',
    export: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.6v5.8M3.7 5.1 6 7.4 8.3 5.1" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.4h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    import: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 10.4V4.6M3.7 6.9 6 4.6 8.3 6.9" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.4h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    cloud: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.4 8.8h5.4a2.4 2.4 0 0 0 .2-4.8A3 3 0 0 0 3.6 2.6 2.6 2.6 0 0 0 1.2 6.2 2.4 2.4 0 0 0 3.4 8.8z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/></svg>',
    cloudExport: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.8 7.2h4.8a1.8 1.8 0 0 0 .1-3.6A2.2 2.2 0 0 0 3 2.8 1.9 1.9 0 0 0 1.2 5.2 1.8 1.8 0 0 0 2.8 7.2z" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/><path d="M8.8 4.2V8M7.5 5.5 8.8 4.2 10.1 5.5" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    cloudImport: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.8 7.2h4.8a1.8 1.8 0 0 0 .1-3.6A2.2 2.2 0 0 0 3 2.8 1.9 1.9 0 0 0 1.2 5.2 1.8 1.8 0 0 0 2.8 7.2z" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/><path d="M8.8 7.8V4.4M7.5 6.7 8.8 7.8 10.1 6.7" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    logout: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M4.6 2.1H3.1v7.8h1.5" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/><path d="M6.8 6 10 6M10 6 8.4 4.4M10 6 8.4 7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    undo: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.4 5.6H7.2a2.4 2.4 0 1 1 0 4.8H6.6M3.4 5.6 5.1 3.9M3.4 5.6 5.1 7.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    redo: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M8.6 5.6H4.8a2.4 2.4 0 0 0 0 4.8h.6M8.6 5.6 6.9 3.9M8.6 5.6 6.9 7.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sortAlpha: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.8 3.2h3.4M1.8 8.4h3.4M1.8 3.2l3.4 5.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.4 3v6M7.5 4.1l0.9-1.1 0.9 1.1M7.5 7.9l0.9 1.1 0.9-1.1" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sortDate: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><circle cx="4.8" cy="6" r="3.1" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M4.8 4.4V6l1.3 0.9" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.2 3v6M8.3 4.1l0.9-1.1 0.9 1.1M8.3 7.9l0.9 1.1 0.9-1.1" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    desktopBg: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="2.2" width="9.2" height="6.8" rx="0.7" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M2.2 8.4h7.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/><circle cx="4.1" cy="5.4" r="1.1" fill="currentColor" opacity="0.85"/><circle cx="6.6" cy="4.6" r="0.85" fill="currentColor" opacity="0.65"/><circle cx="8.1" cy="6.2" r="0.75" fill="currentColor" opacity="0.5"/></svg>',
    chromeBg: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.3" y="1.8" width="3.6" height="8.4" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="5.5" y="1.8" width="5.2" height="2.4" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="5.5" y="5" width="5.2" height="5.2" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    clockStyle: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 3.2V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    displayOptions: paletteIconSvg(12),
    appTheme: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="3.6" cy="4.2" r="1.5" fill="currentColor" opacity="0.9"/><circle cx="6.8" cy="3.4" r="1.5" fill="currentColor" opacity="0.65"/><circle cx="8.4" cy="6.8" r="1.5" fill="currentColor" opacity="0.45"/><path d="M1.4 10.2h9.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    resetCustomization: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 2.2a3.6 3.6 0 1 0 2.3 6.4L7.2 9.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.1 7.4 7.2 9.5 9.3 7.4" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    radioBrowse: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="6" cy="6" r="4.4" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M2.2 6h7.6M6 2.2v7.6" fill="none" stroke="currentColor" stroke-width="0.75" opacity="0.7"/><ellipse cx="6" cy="6" rx="2.2" ry="4.4" fill="none" stroke="currentColor" stroke-width="0.75" opacity="0.55"/></svg>',
    tvBrowse: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.8" y="2.8" width="8.4" height="5.6" rx="0.8" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M4.2 9.2h3.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    tvSpecial: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="2.2" y="3" width="7.6" height="5.2" rx="0.6" fill="none" stroke="currentColor" stroke-width="0.9"/><circle cx="6" cy="5.6" r="1.1" fill="none" stroke="currentColor" stroke-width="0.75"/><path d="M4.4 9.4h3.2" fill="none" stroke="currentColor" stroke-width="0.75" stroke-linecap="round"/></svg>',
    radioRecents: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 3.4V6l1.8 1.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.8 2.2v1.4h-1.4" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    radioPlay: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M4.2 2.8 9.4 6 4.2 9.2Z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/></svg>',
    radioPause: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.8 2.6v6.8M8.2 2.6v6.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    radioLoading: '<svg class="sidebar-radio__spin-icon" viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.4a4.6 4.6 0 0 1 4.6 4.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    radioSpecial: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 3.5V2.2M6 9.8v-1.3M3.5 6H2.2M9.8 6H8.5M4.2 4.2 3.2 3.2M8.8 8.8l-1-1M7.8 4.2l1-1M4.2 7.8l-1 1" fill="none" stroke="currentColor" stroke-width="0.75" stroke-linecap="round"/></svg>',
    drawingPencil: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M8.4 1.4 10.6 3.6 4.8 9.4 2.2 9.8l.4-2.6 5.8-5.8z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M7.2 2.6 9.4 4.8" fill="none" stroke="currentColor" stroke-width="0.75" stroke-linecap="round"/></svg>',
    drawingExit: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.4 6h6.8M5.2 3.2 2.4 6l2.8 2.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><rect x="7.6" y="2.4" width="2" height="7.2" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    fullscreenEnter: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.4 2.4h2.8M2.4 2.4v2.8M9.6 2.4H6.8M9.6 2.4v2.8M2.4 9.6h2.8M2.4 9.6V6.8M9.6 9.6H6.8M9.6 9.6V6.8" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
    fullscreenExit: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M4.2 4.2H2.8M4.2 4.2V2.8M7.8 4.2h1.4M7.8 4.2V2.8M4.2 7.8H2.8M4.2 7.8v1.4M7.8 7.8h1.4M7.8 7.8v1.4" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>'
};

export const DRAWING_ICONS = {
    pen: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M8.8 1.2 10.8 3.2 4.6 9.4 2.2 9.8l.4-2.4 6.2-6.2z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    marker: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.4 8.8h7.2M3.2 8.8l4-5.6 2.4 2.4-4 5.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    highlighter: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2 9.2h8M3.6 9.2l3.2-6 2.4 2.4-3.2 6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    pencil: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M7.6 1.6 10.4 4.4 4.2 10.6 1.8 10.8l.2-2.4 5.6-6.8z" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/></svg>',
    spray: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="4" cy="5" r="1.2" fill="currentColor" opacity="0.7"/><circle cx="6.5" cy="4" r="0.9" fill="currentColor" opacity="0.5"/><circle cx="8" cy="6.5" r="1" fill="currentColor" opacity="0.6"/><path d="M2 10h8" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    calligraphy: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3 9.2c2-5 5-7 7-7" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
    brush: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M8.2 1.8c.8.8.8 2 0 2.8L4.8 8l-2.6.4.4-2.6 3.4-3.4c.8-.8 2-.8 2.8 0z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    eraser: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.4 7.6 6.4 3.6l3.2 3.2-4 4H2.4z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/><path d="M5.6 10.8h4.8" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
    shapes: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.8" y="4.2" width="4.2" height="4.2" rx="0.3" fill="none" stroke="currentColor" stroke-width="0.85"/><circle cx="8.2" cy="4.8" r="2.1" fill="none" stroke="currentColor" stroke-width="0.85"/><path d="M7.2 9.2 9.6 7.2 10.8 9.8" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    line: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 9.8 9.8 2.2" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2 6h6.2M6.8 3.4 10 6l-3.2 2.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    rect: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="2.2" y="3.2" width="7.6" height="5.6" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    rounded_rect: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="2.2" y="3.4" width="7.6" height="5.4" rx="1.6" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    ellipse: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><ellipse cx="6" cy="6" rx="4" ry="2.8" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    triangle: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 2.4 10.2 9.6H1.8Z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    diamond: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.8 10.2 6 6 10.2 1.8 6Z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.6 7.4 4.8 10.8 5.1 8.2 7.2 9 10.6 6 8.9 3 10.6 3.8 7.2 1.2 5.1 4.6 4.8Z" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/></svg>',
    chevron: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.4 2.4 7.8 6 2.4 9.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    trapezoid: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.2 3.2h5.6L10.2 8.8H1.8Z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    parallelogram: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.6 3.2h6.6L9 8.8H2.4Z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/></svg>',
    cube: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.4 5.2V9.2h5.2V5.2M2.4 5.2l2.6-2 5.2 2M7.6 3.2V7.2l2.6 2V5.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/></svg>',
    pyramid: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.8 10.2 9H1.8ZM6 1.8 1.8 9M6 1.8 10.2 9" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/></svg>',
    cylinder: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><ellipse cx="6" cy="3.6" rx="3.6" ry="1.2" fill="none" stroke="currentColor" stroke-width="0.85"/><path d="M2.4 3.6V8.4M9.6 3.6V8.4" fill="none" stroke="currentColor" stroke-width="0.85"/><ellipse cx="6" cy="8.4" rx="3.6" ry="1.2" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    sphere: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="0.85"/><ellipse cx="6" cy="6" rx="4" ry="1.5" fill="none" stroke="currentColor" stroke-width="0.75"/><path d="M6 2v8" fill="none" stroke="currentColor" stroke-width="0.75"/></svg>',
    text: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.2 2.8h5.6M6 2.8V9.6M4.4 9.6h3.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>',
    grid: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 2.2v7.6h7.6M4.8 2.2v7.6M7.4 2.2v7.6M2.2 4.8h7.6M2.2 7.4h7.6" fill="none" stroke="currentColor" stroke-width="0.75"/></svg>',
    dots: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="3" cy="3" r="0.7" fill="currentColor"/><circle cx="6" cy="3" r="0.7" fill="currentColor"/><circle cx="9" cy="3" r="0.7" fill="currentColor"/><circle cx="3" cy="6" r="0.7" fill="currentColor"/><circle cx="6" cy="6" r="0.7" fill="currentColor"/><circle cx="9" cy="6" r="0.7" fill="currentColor"/><circle cx="3" cy="9" r="0.7" fill="currentColor"/><circle cx="6" cy="9" r="0.7" fill="currentColor"/><circle cx="9" cy="9" r="0.7" fill="currentColor"/></svg>',
    graph: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2 2v8h8M4 2v8M6 2v8M8 2v8M2 4h8M2 6h8M2 8h8" fill="none" stroke="currentColor" stroke-width="0.55"/><path d="M2 2v8h8" fill="none" stroke="currentColor" stroke-width="0.95"/></svg>',
    coarse: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M1.8 1.8v8.4h8.4M6 1.8v8.4M1.8 6h8.4" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    isometric: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M1.5 10 6 2.5 10.5 10M3 7.5h6" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/></svg>',
    ruled: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M1.8 3.6h8.4M1.8 6h8.4M1.8 8.4h8.4" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    hex: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.8 9.6 3.8v4L6 9.8 2.4 7.8v-4Z" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linejoin="round"/></svg>',
    notebook: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.6 1.8v8.4M2.2 4h7.6M2.2 6h7.6M2.2 8h7.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    staff: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 3.2c.6-1 1.4-1.4 2.2-1.2-.4 2.2.2 4.2 1.6 5.6M1.8 4.8h8M1.8 6h8M1.8 7.2h8M1.8 8.4h8" fill="none" stroke="currentColor" stroke-width="0.75" stroke-linecap="round"/></svg>',
    blank: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="2.4" y="2.4" width="7.2" height="7.2" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.85" stroke-dasharray="1.6 1.2"/></svg>',
    pagePrev: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M7 2.4 3.4 6 7 9.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pageNext: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M5 2.4 8.6 6 5 9.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    pageAdd: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="2.4" y="2" width="7.2" height="8" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 4.4v3.2M4.4 6h3.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    zoomIn: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="5.2" cy="5.2" r="3.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M7.6 7.6 10 10M5.2 3.6v3.2M3.6 5.2h3.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    zoomOut: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="5.2" cy="5.2" r="3.2" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M7.6 7.6 10 10M3.6 5.2h3.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    exportPng: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="2" y="2.4" width="8" height="6.4" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M4.4 7.2 5.8 5.6 7.2 7.2M2 10h8" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

export function itemHasCategory(item) {
    const name = item?.categories?.[0];
    return typeof name === 'string' && name.trim() !== '';
}

export function deriveNoteTitle({ title = '', content = '', steps = [] } = {}) {
    const trimmedTitle = stripRichText(title).trim();
    if (trimmedTitle) return trimmedTitle;

    const contentLine = stripRichText(content)
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
    if (contentLine) return contentLine.slice(0, 72);

    for (const step of steps || []) {
        const text = stripRichText(step?.text || '').trim();
        if (!text) continue;
        const label = text.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
        return (label || text).slice(0, 72);
    }

    return 'Untitled';
}

export function createNoteId() {
    return `item_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function noteHasSavableContent({ title = '', content = '', steps = [] } = {}) {
    if (stripRichText(title).trim()) return true;
    if (stripRichText(content).trim()) return true;
    return (steps || []).some((step) => stripRichText(step?.text || '').trim());
}

export function formatLocalDateTimeParts(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    return {
        date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        time: `${pad(date.getHours())}:${pad(date.getMinutes())}`
    };
}

export function defaultStartDateTimeNow() {
    const { date, time } = formatLocalDateTimeParts();
    return `${date}T${time}`;
}

export function normalizeItemForSave(item, { preserveEmptySteps = false } = {}) {
    if (!item) return item;

    const content = String(item.content || '');
    const allSteps = item.steps || [];
    const steps = preserveEmptySteps
        ? [...allSteps]
        : allSteps.filter((step) => stripRichText(step?.text || '').trim());
    const hasTitle = stripRichText(item.title || '').trim();
    const startDateTime = String(item.startDateTime || '').trim()
        ? item.startDateTime
        : defaultStartDateTimeNow();

    return {
        ...item,
        steps,
        type: steps.length > 0 ? 'checklist' : 'note',
        title: hasTitle ? item.title : deriveNoteTitle({ content, steps }),
        startDateTime,
        tileSize: normalizeTileSize(item.tileSize)
    };
}

export function getStepLevel(step) {
    const n = Number(step?.level);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(4, Math.floor(n));
}

export function partitionChecklistSteps(steps) {
    const active = [];
    const done = [];
    (steps || []).forEach(step => {
        if (step.completed) done.push(step);
        else active.push(step);
    });
    return { active, done };
}

export function reorderStepsByCompletion(steps) {
    if (!steps?.length) return;
    const { active, done } = partitionChecklistSteps(steps);
    steps.splice(0, steps.length, ...active, ...done);
}

export function moveStepOnCompletionChange(steps, step, completed) {
    step.completed = completed;
    if (completed) {
        step.text = wrapLineAsStruck(step.text || '');
    } else {
        step.text = unwrapLineStrike(step.text || '');
    }
    reorderStepsByCompletion(steps);
}

export function collectStepSubtree(steps, startIndex) {
    if (!steps?.length || startIndex < 0 || startIndex >= steps.length) return [];
    const rootLevel = getStepLevel(steps[startIndex]);
    const subtree = [steps[startIndex]];
    for (let i = startIndex + 1; i < steps.length; i++) {
        if (getStepLevel(steps[i]) <= rootLevel) break;
        subtree.push(steps[i]);
    }
    return subtree;
}

export function collectStepSubtreeIds(steps, startIndex) {
    return collectStepSubtree(steps, startIndex).map((step) => step.id);
}

export function findStepParentIndex(steps, index) {
    const level = getStepLevel(steps[index]);
    if (level <= 0) return -1;
    for (let i = index - 1; i >= 0; i--) {
        if (getStepLevel(steps[i]) < level) return i;
    }
    return -1;
}

export function applySubtreeLevelDelta(steps, startIndex, delta) {
    const subtree = collectStepSubtree(steps, startIndex);
    if (!subtree.length || !delta) return;
    const rootLevel = getStepLevel(subtree[0]);
    let effectiveDelta = delta;
    if (delta < 0 && rootLevel + delta < 0) {
        effectiveDelta = -rootLevel;
    }
    for (const step of subtree) {
        step.level = Math.max(0, Math.min(4, getStepLevel(step) + effectiveDelta));
    }
}

export function normalizeChecklistLevels(steps) {
    if (!steps?.length) return;
    for (let i = 0; i < steps.length; i++) {
        const maxLevel = i === 0 ? 0 : getStepLevel(steps[i - 1]) + 1;
        const current = getStepLevel(steps[i]);
        steps[i].level = Math.max(0, Math.min(4, Math.min(current, maxLevel)));
    }
}

export function previewDropTargetLevel(rows, insertIndex, dropMode, getLevel = getStepRowLevel) {
    if (insertIndex <= 0) return 0;
    if (dropMode === 'child') {
        const parent = rows[insertIndex - 1];
        return parent ? Math.min(4, getLevel(parent) + 1) : 0;
    }
    const next = rows[insertIndex];
    if (next) return getLevel(next);
    const prev = rows[insertIndex - 1];
    return prev ? getLevel(prev) : 0;
}

export function resolveDropTarget(steps, blockRootId, { mode = 'sibling' } = {}) {
    const blockStartIndex = steps.findIndex((step) => step.id === blockRootId);
    if (blockStartIndex < 0) return null;
    const subtree = collectStepSubtree(steps, blockStartIndex);
    const oldRootLevel = getStepLevel(subtree[0]);
    let newRootLevel = oldRootLevel;

    if (mode === 'child' && blockStartIndex > 0) {
        const parent = steps[blockStartIndex - 1];
        newRootLevel = Math.min(4, getStepLevel(parent) + 1);
    } else if (blockStartIndex === 0) {
        newRootLevel = 0;
    } else {
        const nextIndex = blockStartIndex + subtree.length;
        newRootLevel = nextIndex < steps.length
            ? getStepLevel(steps[nextIndex])
            : getStepLevel(steps[blockStartIndex - 1]);
    }

    const delta = newRootLevel - oldRootLevel;
    if (delta) applySubtreeLevelDelta(steps, blockStartIndex, delta);

    const parentId = mode === 'child' && blockStartIndex > 0
        ? steps[blockStartIndex - 1].id
        : null;
    return { parentId };
}

export function computeChecklistInsertBounds(steps, startIndex) {
    const blockLevel = getStepLevel(steps[startIndex]);
    const subtree = collectStepSubtree(steps, startIndex);
    const parentIdx = findStepParentIndex(steps, startIndex);

    let minIndex = 0;
    if (parentIdx >= 0) minIndex = parentIdx + 1;

    let maxIndex = steps.length;
    for (let i = startIndex + subtree.length; i < steps.length; i++) {
        if (getStepLevel(steps[i]) < blockLevel) {
            maxIndex = i;
            break;
        }
    }

    return { minIndex, maxIndex, blockLevel, subtreeIds: subtree.map((step) => step.id) };
}

export function computeVisibleInsertBounds(activeSteps, startIndex, visibleIds, blockIds) {
    const { minIndex, maxIndex, subtreeIds } = computeChecklistInsertBounds(activeSteps, startIndex);
    const blockIdSet = new Set(blockIds || subtreeIds);
    const others = visibleIds.filter((id) => !blockIdSet.has(id));

    let minAmongOthers = 0;
    if (minIndex > 0) {
        const parentId = activeSteps[minIndex - 1]?.id;
        const parentPos = others.indexOf(parentId);
        minAmongOthers = parentPos >= 0 ? parentPos + 1 : 0;
    }

    let maxAmongOthers = others.length;
    if (maxIndex < activeSteps.length) {
        const boundaryId = activeSteps[maxIndex]?.id;
        const boundaryPos = others.indexOf(boundaryId);
        maxAmongOthers = boundaryPos >= 0 ? boundaryPos : others.length;
    }

    return { minAmongOthers, maxAmongOthers, subtreeIds: subtreeIds || [...blockIdSet], others };
}

export function resolvePointerDropTarget(clientY, visibleRows, blockRows, { bounds = null, isSingleLeaf = false } = {}) {
    const blockSet = new Set(blockRows);
    const others = visibleRows.filter((row) => !blockSet.has(row));
    let insertIndex = others.length;
    let dropMode = 'sibling';

    for (let i = 0; i < others.length; i++) {
        const box = others[i].getBoundingClientRect();
        const midY = box.top + box.height / 2;

        if (clientY < box.top) {
            insertIndex = i;
            if (i > 0 && getStepRowLevel(others[i - 1]) < getStepRowLevel(others[i])) {
                dropMode = 'child';
            } else {
                dropMode = 'sibling';
            }
            break;
        }
        if (clientY <= midY) {
            insertIndex = i;
            dropMode = 'sibling';
            break;
        }
        if (clientY <= box.bottom) {
            insertIndex = i + 1;
            dropMode = 'child';
            break;
        }
    }

    if (bounds && !isSingleLeaf) {
        insertIndex = Math.max(bounds.minAmongOthers, Math.min(bounds.maxAmongOthers, insertIndex));
        if (dropMode === 'child' && insertIndex > 0 && insertIndex <= others.length) {
            const parentRow = others[insertIndex - 1];
            if (!parentRow) dropMode = 'sibling';
        }
    }

    const targetLevel = previewDropTargetLevel(others, insertIndex, dropMode);
    return { insertIndex, dropMode, others, targetLevel };
}

export function getStepRowLevel(row) {
    const n = Number(row?.dataset?.level);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(4, Math.floor(n));
}

export function collectDomRowBlock(rows, row) {
    const idx = rows.indexOf(row);
    if (idx < 0) return [row];
    const level = getStepRowLevel(row);
    const block = [row];
    for (let i = idx + 1; i < rows.length; i++) {
        if (getStepRowLevel(rows[i]) <= level) break;
        block.push(rows[i]);
    }
    return block;
}

function findParentRowIndex(rows, rowIndex) {
    const level = getStepRowLevel(rows[rowIndex]);
    if (level <= 0) return -1;
    for (let i = rowIndex - 1; i >= 0; i--) {
        if (getStepRowLevel(rows[i]) < level) return i;
    }
    return -1;
}

export function clampChecklistInsertIndex(allRows, block, insertIndexInOthers, bounds = null) {
    if (bounds) {
        return Math.max(bounds.minAmongOthers, Math.min(bounds.maxAmongOthers, insertIndexInOthers));
    }

    const others = allRows.filter((row) => !block.includes(row));
    const firstIdx = allRows.indexOf(block[0]);
    if (firstIdx < 0) return insertIndexInOthers;

    const blockLevel = getStepRowLevel(block[0]);
    const parentIdx = findParentRowIndex(allRows, firstIdx);
    let minIndex = 0;
    if (parentIdx >= 0) {
        const parentRow = allRows[parentIdx];
        const parentInOthers = others.indexOf(parentRow);
        minIndex = parentInOthers >= 0 ? parentInOthers + 1 : 0;
    }

    let maxIndex = others.length;
    for (let i = firstIdx + block.length; i < allRows.length; i++) {
        if (getStepRowLevel(allRows[i]) < blockLevel) {
            const boundaryInOthers = others.indexOf(allRows[i]);
            maxIndex = boundaryInOthers >= 0 ? boundaryInOthers : others.length;
            break;
        }
    }

    return Math.max(minIndex, Math.min(maxIndex, insertIndexInOthers));
}

export function reorderActiveStepsFromDomOrder(activeSteps, visibleOrderIds, itemId, collapsedKeys = {}) {
    const stepById = new Map(activeSteps.map((step) => [step.id, step]));
    const visibleSet = new Set(visibleOrderIds);
    const placed = new Set();
    const result = [];

    for (const id of visibleOrderIds) {
        const step = stepById.get(id);
        if (!step || placed.has(id)) continue;
        result.push(step);
        placed.add(id);

        const idx = activeSteps.findIndex((s) => s.id === id);
        const collapseKey = `${itemId}:${id}`;
        if (idx < 0 || !collapsedKeys[collapseKey] || !stepHasDescendants(activeSteps, idx)) continue;

        const rootLevel = getStepLevel(step);
        for (let i = idx + 1; i < activeSteps.length; i++) {
            const child = activeSteps[i];
            const level = getStepLevel(child);
            if (level <= rootLevel) break;
            if (visibleSet.has(child.id) || placed.has(child.id)) continue;
            result.push(child);
            placed.add(child.id);
        }
    }

    for (const step of activeSteps) {
        if (!placed.has(step.id)) result.push(step);
    }

    return result;
}

export function stepHasDescendants(steps, index) {
    const level = getStepLevel(steps[index]);
    for (let i = index + 1; i < steps.length; i++) {
        const nextLevel = getStepLevel(steps[i]);
        if (nextLevel <= level) return false;
        if (nextLevel > level) return true;
    }
    return false;
}

export function levelListHasDescendants(levels, index) {
    const level = levels[index];
    for (let i = index + 1; i < levels.length; i++) {
        if (levels[i] <= level) return false;
        if (levels[i] > level) return true;
    }
    return false;
}

export function checklistHasIndentations(steps) {
    return (steps || []).some((step) => getStepLevel(step) > 0);
}

export function buildVisibleChecklistSteps(steps, itemId, collapsedKeys = {}) {
    const visible = [];
    let suppressBelow = -1;

    (steps || []).forEach((step, index) => {
        const level = getStepLevel(step);
        if (suppressBelow >= 0 && level > suppressBelow) return;

        suppressBelow = -1;
        const hasKids = stepHasDescendants(steps, index);
        const collapseKey = `${itemId}:${step.id}`;
        const isCollapsed = !!collapsedKeys[collapseKey];

        visible.push({ step, hasKids, isCollapsed, collapseKey });
        if (hasKids && isCollapsed) suppressBelow = level;
    });

    return visible;
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

const MATRIX_DATABASE_KEY = 'matrix_database';

function utf16Bytes(str) {
    return (str?.length ?? 0) * 2;
}

export function getLocalStorageKeyBytes(key) {
    const value = localStorage.getItem(key);
    if (value === null) return 0;
    return utf16Bytes(key) + utf16Bytes(value);
}

/** UTF-16 estimate of all keys on this origin — cheap O(n) scan, no network. */
export function getLocalStorageUsedBytes() {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const value = localStorage.getItem(key);
        chars += key.length + (value?.length ?? 0);
    }
    return chars * 2;
}

export function getStorageBreakdown() {
    let notes = 0;
    let matrix = 0;
    let app = 0;

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;

        if (key === MATRIX_DATABASE_KEY) {
            const raw = localStorage.getItem(key);
            if (!raw) continue;
            try {
                const db = JSON.parse(raw);
                notes += utf16Bytes(JSON.stringify(db.items ?? []));
                matrix += utf16Bytes(key) + utf16Bytes(JSON.stringify({ auth: db.auth, settings: db.settings }));
            } catch {
                matrix += getLocalStorageKeyBytes(key);
            }
            continue;
        }

        if (key.startsWith('matrix_')) {
            matrix += getLocalStorageKeyBytes(key);
            continue;
        }

        app += getLocalStorageKeyBytes(key);
    }

    const total = notes + matrix + app;
    return { notes, matrix, app, total };
}

export function formatStorageSize(bytes) {
    if (!bytes) return '0 KB';
    const kb = bytes / 1024;
    if (kb < 0.1) return '<0.1 KB';
    if (kb < 10) return `${kb.toFixed(1)} KB`;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    const mb = kb / 1024;
    return mb < 10 ? `${mb.toFixed(1)} MB` : `${Math.round(mb)} MB`;
}

export function attachAutoGrow(textarea, { maxHeight = 120 } = {}) {
    if (!textarea) return;
    textarea.classList.add('input-grow');
    const grow = () => {
        textarea.style.height = 'auto';
        textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    };
    textarea.addEventListener('input', grow);
    grow();
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
            this.emitItemMutation(
                { ...item, hiddenFromBoard: true },
                { beforeItem: this.snapshotItem(item) }
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
            this.emitItemMutation(
                { ...item, hiddenFromBoard: false },
                { beforeItem: this.snapshotItem(item) }
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
        const beforeItem = this.snapshotItem(item);
        const willHide = !this.isHiddenFromCalendar(item);
        const updated = { ...item, hideFromCalendar: willHide };
        item.hideFromCalendar = willHide;

        const ids = this.getLocalCalendarHiddenIds().filter(id => id !== item.id);
        if (willHide && !localStorage.getItem('admin_token')) ids.push(item.id);
        localStorage.setItem('matrix_calendar_hidden_ids', JSON.stringify(ids));

        if (localStorage.getItem('admin_token')) {
            this.emitItemMutation(updated, { beforeItem });
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
            this.commitFocusedInlineField(card, item);
            if (card.dataset.pendingFocusStepId) return;
            const shell = card.querySelector('.editor-note-shell');
            if (!shell) return;
            const beforeItem = this.snapshotItem(item);
            this.syncItemBodyFromDom(shell, item);
            if (JSON.stringify(beforeItem) !== JSON.stringify(this.snapshotItem(item))) {
                this.emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
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

    snapshotItem(item) {
        return JSON.parse(JSON.stringify(item));
    },

    emitItemMutation(item, { preserveView = false, beforeItem = null, skipRerender = false } = {}) {
        const preserveEmptySteps = preserveView && skipRerender;
        const normalized = normalizeItemForSave(item, { preserveEmptySteps });
        Object.assign(item, normalized);
        const normalizedBefore = beforeItem
            ? normalizeItemForSave(beforeItem, { preserveEmptySteps })
            : null;
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: { item: normalized, preserveView, beforeItem: normalizedBefore, skipRerender }
        }));
    },

    prepareInlineOpSnapshot(root, item, localOnly = false) {
        const shell = root.closest('.editor-note-shell') || root;
        this.syncItemBodyFromDom(shell, item);
        if (localOnly) return null;
        return this.snapshotItem(item);
    },

    ensureChecklistStepFromRow(row, item) {
        const stepId = row?.dataset?.stepId;
        if (!stepId || !item) return null;
        if (!item.steps) item.steps = [];
        let step = item.steps.find((s) => s.id === stepId);
        if (!step) {
            step = this.createBlankChecklistStep();
            step.id = stepId;
            step.level = Number(row.dataset.level) || 0;
            step.completed = row.classList.contains('step-row--done');
            const prevRow = this.findAdjacentChecklistStepRow(row, 'prev');
            const prevId = prevRow?.dataset?.stepId;
            if (prevId) {
                const idx = item.steps.findIndex((s) => s.id === prevId);
                item.steps.splice(idx >= 0 ? idx + 1 : item.steps.length, 0, step);
            } else {
                item.steps.unshift(step);
            }
            if (item.type !== 'checklist') item.type = 'checklist';
        }
        const textEl = row.querySelector('[data-field="step-text"]');
        if (textEl) this.syncInlineFieldToItem(textEl, step);
        return step;
    },

    expandChecklistAncestorsForStep(item, stepId) {
        const steps = item?.steps || [];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return;
        const collapsed = this.getChecklistCollapsedKeys();
        let changed = false;
        let childLevel = getStepLevel(steps[idx]);
        for (let i = idx - 1; i >= 0 && childLevel > 0; i--) {
            const level = getStepLevel(steps[i]);
            if (level < childLevel) {
                const key = `${item.id}:${steps[i].id}`;
                if (collapsed[key]) {
                    delete collapsed[key];
                    changed = true;
                }
                childLevel = level;
            }
        }
        if (changed) {
            localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
        }
    },

    commitInlineChecklistOp(item, beforeItem, { localOnly = false } = {}) {
        if (localOnly || !beforeItem) return;
        const preserveEmptySteps = true;
        const afterNorm = normalizeItemForSave(item, { preserveEmptySteps });
        const beforeNorm = normalizeItemForSave(beforeItem, { preserveEmptySteps });
        if (JSON.stringify(beforeNorm) === JSON.stringify(afterNorm)) return;
        Object.assign(item, afterNorm);
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: {
                item: afterNorm,
                preserveView: true,
                beforeItem: beforeNorm,
                skipRerender: true,
                mergeKey: `${afterNorm.id}:struct`,
                mergeWindow: false
            }
        }));
    },

    commitInlineTextOp(item, beforeItem, { localOnly = false } = {}) {
        if (localOnly || !beforeItem) return;
        const preserveEmptySteps = true;
        const afterNorm = normalizeItemForSave(item, { preserveEmptySteps });
        const beforeNorm = normalizeItemForSave(beforeItem, { preserveEmptySteps });
        if (JSON.stringify(beforeNorm) === JSON.stringify(afterNorm)) return;
        Object.assign(item, afterNorm);
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: {
                item: afterNorm,
                preserveView: true,
                beforeItem: beforeNorm,
                skipRerender: true,
                mergeKey: `${afterNorm.id}:text`,
                mergeWindow: true
            }
        }));
    },

    mutateItem(item, mutator, { preserveView = false, skipRerender = false, localOnly = false } = {}) {
        const beforeItem = this.snapshotItem(item);
        mutator(item);
        if (!localOnly) {
            this.emitItemMutation(item, { preserveView, beforeItem, skipRerender });
        }
    },

    syncInlineFieldToItem(el, item) {
        const field = el.dataset.field;
        if (el.classList.contains('rich-text--edit')) {
            const val = sanitizeRichHtml(linkifyPlainUrls(el.innerHTML));
            if (field === 'title') item.title = val;
            else if (field === 'content') item.content = val;
            else if (field === 'step-text') {
                const step = item.steps?.find(s => s.id === el.dataset.stepId);
                if (step) step.text = val;
            }
            return;
        }
        if (field === 'title') {
            item.title = el.textContent.trim();
        } else if (field === 'content') {
            item.content = el.textContent;
        } else if (field === 'step-text') {
            const step = item.steps?.find(s => s.id === el.dataset.stepId);
            if (step) step.text = el.textContent;
        }
    },

    renderRichHtml(str) {
        if (!str) return '';
        const prepared = String(str).replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
        if (hasRichMarkup(prepared)) return sanitizeRichHtml(prepared);
        return sanitizeRichHtml(this.escapeHTML(prepared));
    },

    prepareContentForEdit(content) {
        const prepared = String(content || '').replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
        if (hasRichMarkup(prepared)) return sanitizeRichHtml(prepared);
        return sanitizeRichHtml(this.escapeHTML(prepared));
    },

    tryOpenRichEditLink(e, host) {
        if (!host?.classList?.contains('rich-text--edit')) return false;
        const anchor = e.target.closest?.('a[href]');
        if (!anchor || !host.contains(anchor)) return false;
        const href = sanitizeHref(anchor.getAttribute('href'));
        if (!href) return false;
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
    },

    resolveEditorBodyLayoutUnchecked(item) {
        return deriveEditorBodyLayout(item);
    },

    syncItemBodyFromDom(root, item) {
        root?.querySelectorAll('.card-inline-edit').forEach((el) => {
            const field = el.dataset.field;
            if (field === 'title' || field === 'content' || field === 'step-text') {
                this.syncInlineFieldToItem(el, item);
            }
        });
    },

    insertTextAtCaret(el, text) {
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return;
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    },

    canInlineEditText(text, { richEdit = false } = {}) {
        if (richEdit) return true;
        return !hasRichMarkup(text);
    },

    commitFocusedInlineField(card, item) {
        const active = document.activeElement;
        if (!active || !card.contains(active) || !active.classList.contains('card-inline-edit')) return;
        this.mutateItem(item, () => {
            this.syncInlineFieldToItem(active, item);
        }, { preserveView: true, skipRerender: true });
        active.dataset.skipBlurSave = '1';
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
        return this.resolveExpandedDefaultRect(resolveTileSize(item), null);
    },

    resolveBoardExpandRect(card, item) {
        const saved = this.getSavedLayoutRect(card, item);
        const tileSize = resolveTileSize(item);
        const remembered = geoReadRememberedSize(saved);
        const size = remembered
            ? remembered
            : this.resolveExpandedDefaultRect(tileSize, null);
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

    isCustomTileRect(w, h, tileSize = LEGACY_TILE_SIZE) {
        return geoIsCustomTileRect(w, h, tileSize);
    },

    getTileDefaultRect(tileSize) {
        return geoGetTileDefaultRect(tileSize);
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
        if (!isDesktopCard(card)) return;
        card.classList.remove('expanded');
        card.classList.add('note-surface');
        card.classList.toggle('spatial-at-small', this.isSpatiallyCollapsed(card));
        const resolvedItem = item || this.resolveBoardItem(card?.dataset?.id);
        const tier = geoInferTileTier(w, h, resolveTileSize(resolvedItem));
        this.applyCollapsedTileClasses(card, tier);
    },

    syncSpatialToggleButton(card) {
        if (!isDesktopCard(card)) return;
        const toggleBtn = card.querySelector('.card-act--toggle');
        if (!toggleBtn) return;
        const atSmall = this.isSpatiallyCollapsed(card);
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

    resolveExpandedDefaultRect(tileSize, saved = null) {
        return geoResolveExpandedDefaultRect(tileSize, saved);
    },

    isAtOrBelowCompactZone(w, h, tileSize = LEGACY_TILE_SIZE) {
        return geoIsAtOrBelowCompactZone(w, h, tileSize);
    },

    usesTileTierBoard(card) {
        return isDesktopCard(card);
    },

    softSnapPx(value) {
        return geoSoftSnapPx(value);
    },

    inferCollapsedTileTier(w, h, prevTier = LEGACY_TILE_SIZE) {
        return geoInferTileTier(w, h, prevTier);
    },

    resolveCollapsedTierRect(w, h, prevTier = LEGACY_TILE_SIZE) {
        return geoResolveCollapsedTierRect(w, h, prevTier);
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
            if (isDesktopCard(card)) {
                this.applyCollapsedTileClasses(card, normalized);
            } else {
                const activeCategories = readStoredCategories();
                const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);
                const previewItem = { ...item, tileSize: normalized };
                this.renderCollapsedCard(card, previewItem, activeCategories, targetCatName, categoryColor);
            }
            resizeState.previewTier = normalized;
            card.dataset.tierResizePreview = '1';
            card.classList.add('is-tier-resizing');
        }

        this.applyTierResizeBox(card, rect);
        if (isDesktopCard(card)) {
            this.syncSpatialCollapseState(card, item, rect.w, rect.h);
        }
    },

    revertTierResizePreview(card, item, resizeState) {
        if (!card || !item || !resizeState) return;
        delete card.dataset.tierResizePreview;
        card.classList.remove('is-tier-resizing');

        if (isDesktopCard(card)) {
            this.applyCollapsedTileClasses(card, resizeState.startTier);
        } else {
            const activeCategories = readStoredCategories();
            const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);
            const restoreItem = { ...item, tileSize: resizeState.startTier };
            this.renderCollapsedCard(card, restoreItem, activeCategories, targetCatName, categoryColor);
        }
        this.applyTierResizeBox(card, resizeState.startRect);

        if (isDesktopCard(card)) {
            this.finalizeDesktopCard(card);
        }
    },

    commitTierResize(card, item, resizeState) {
        if (!card || !item || !resizeState) return resizeState?.previewTier || resolveTileSize(item);
        delete card.dataset.tierResizePreview;
        card.classList.remove('is-tier-resizing');

        const finalTier = normalizeTileSize(resizeState.previewTier);
        if (finalTier !== resolveTileSize(item) && this.canEditInline()) {
            this.mutateItem(item, (it) => {
                it.tileSize = finalTier;
            }, { preserveView: true, skipRerender: true });
            item.tileSize = finalTier;
            boardItemsById.set(item.id, item);
        }
        return finalTier;
    },

    processCollapsedTierResizeMove(card, item, resizeState, rect, { maxW = Infinity, axis = 'se' } = {}) {
        const resolved = this.resolveCollapsedTierRect(rect.w, rect.h, resizeState.previewTier);
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
        const activeCategories = readStoredCategories();
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);
        this.cancelCardAnimation(card);
        card.classList.remove('expanded', 'card-state-changing', 'card-animating');
        if (isDesktopCard(card)) {
            this.finalizeDesktopCard(card);
        } else {
            this.renderCollapsedCard(card, item, activeCategories, targetCatName, categoryColor);
        }
    },

    collapseLegacyExpandedTile(card, item, ctx = {}) {
        if (!card?.classList.contains('expanded')) return false;

        this.collapseSnapPanelCard(card, item);

        const labelRect = this.resolveCardRect(card, item, { mode: 'small' });
        this.applyTileTierRect(card, item, 'small', labelRect, ctx);

        return true;
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

        if (this.canEditInline() && normalizedTier !== resolveTileSize(item)) {
            this.mutateItem(item, (it) => {
                it.tileSize = normalizedTier;
            }, { preserveView: true, skipRerender: true });
            item.tileSize = normalizedTier;
            boardItemsById.set(item.id, item);
        }

        if (!isDesktopCard(card)) {
            const activeCategories = ctx.activeCategories ?? readStoredCategories();
            const renderCtx = ctx.targetCatName != null
                ? { targetCatName: ctx.targetCatName, categoryColor: ctx.categoryColor }
                : this.getCardRenderContext(item, activeCategories);
            this.renderCollapsedCard(
                card,
                item,
                activeCategories,
                renderCtx.targetCatName,
                renderCtx.categoryColor
            );
        }

        this.applyNoteRect(card, rect, { settling: false });
        this.saveTileLayoutFromCard(card, item, rect, normalizedTier);

        if (!isDesktopCard(card)) return;
        this.finalizeDesktopCard(card);
        const canvas = card.closest('#app-canvas');
        if (ctx.scheduleExtents) {
            this.scheduleBoardCanvasExtents(canvas);
        }
        if (ctx.deferReflow) return;
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
        this.commitSpatialRect(card, item, rect, { ...ctx, scheduleExtents: true });
    },

    collapseSpatialAtCurrentPos(card, item, ctx = {}) {
        const pos = this.readNoteRect(card);
        this.persistRememberedSpatialSize(item.id, pos.w, pos.h, resolveTileSize(item));
        const small = getSmallRect(readTileSmallFootprint());
        this.applySpatialToggleRect(card, item, { x: pos.x, y: pos.y, w: small.w, h: small.h }, { deferReflow: true, ...ctx });
    },

    collapseBoardCardToSmallFootprint(card, item, ctx = {}) {
        if (!card || !item?.id || isFileCabinetActive() || this.isSpatiallyCollapsed(card)) return;
        this.collapseSpatialAtCurrentPos(card, item, ctx);
    },

    applyTileZoneToggle(card, item, ctx = {}) {
        if (!isDesktopCard(card) && this.collapseLegacyExpandedTile(card, item, ctx)) return;

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
            if (this.canEditInline() && resolveTileSize(item) !== 'small') {
                this.mutateItem(item, (it) => { it.tileSize = 'small'; }, { preserveView: true, skipRerender: true });
                item.tileSize = 'small';
                boardItemsById.set(item.id, item);
            }
            this.saveTileLayoutFromCard(card, item, next, 'small');
            this.finalizeDesktopCard(card);
        });
        this.updateBoardCanvasMinHeight(canvas);
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

        this.updateBoardCanvasMinHeight(canvas);
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
            const expandedMin = this.resolveExpandedDefaultRect(tileSize, savedRect);
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
            const clamped = geoClampSpatialSize(saved.w, saved.h, tileSize);
            return { ...base, w: clamped.w, h: clamped.h };
        }
        const defaults = this.getTileDefaultRect(tileSize);
        return { ...base, w: defaults.w, h: defaults.h };
    },

    syncCardDraggable(card) {
        const hasSession = !!localStorage.getItem('admin_token');
        if (!hasSession || isDesktopCard(card) || card.classList.contains('expanded')) {
            card.removeAttribute('draggable');
            return;
        }
        card.setAttribute('draggable', 'true');
    },

    isGridBoardCard(card) {
        return isDesktopCard(card) && isSnapLayoutMode(activeBoardViewMode);
    },

    freeformDragZoneClass(card) {
        return isDesktopCard(card) ? ' card-drag-zone' : '';
    },

    createBlankChecklistStep() {
        return {
            id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            text: '',
            completed: false,
            level: 0,
            startDateTime: '',
            endDateTime: ''
        };
    },

    updateSingleCard(canvas, item, hiddenCategories = []) {
        if (!canvas || !item?.id) return false;
        const card = canvas.querySelector(`.mini-card[data-id="${item.id}"]`);
        if (!card) return false;

        let activeCategories = readStoredCategories()
            .filter((cat) => !hiddenCategories.includes(cat.name));
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        if (isDesktopCard(card)) {
            this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
        } else if (card.classList.contains('expanded')) {
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
        } else {
            this.renderCollapsedCard(card, item, activeCategories, targetCatName, categoryColor);
        }
        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;

        if (isDesktopCard(card)) {
            this.finalizeDesktopCard(card);
        }

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
                const card = this.createCardComponent(item, activeCategories, { desktop: true });
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

    buildNoteQuickActionsHtml(item, {
        surface = 'board',
        isExpanded = false,
        pinned = false,
        showDrag = false,
        showArchive = false,
        spatialTile = false,
        tileSize = LEGACY_TILE_SIZE,
        tileW = 0,
        tileH = 0
    } = {}) {
        const isModal = surface === 'modal';
        let expandTitle;
        let lastIcon;
        if (isModal) {
            expandTitle = 'Show on board';
            lastIcon = CARD_ICONS.collapse;
        } else if (spatialTile) {
            const atSmall = isCollapsedSpatialSize(tileW, tileH, tileSize);
            if (isFileCabinetActive()) {
                const labels = getFileCabinetToggleLabels(atSmall, atSmall);
                expandTitle = labels.title;
                lastIcon = labels.iconKey === 'expand' ? CARD_ICONS.expand : CARD_ICONS.collapse;
            } else {
                expandTitle = atSmall ? 'Expand' : 'Collapse to small';
                lastIcon = atSmall ? CARD_ICONS.expand : CARD_ICONS.collapse;
            }
        } else {
            expandTitle = isExpanded ? 'Collapse note' : 'Expand note';
            lastIcon = isExpanded ? CARD_ICONS.collapse : CARD_ICONS.expand;
        }
        const lastClass = isModal ? 'card-act--close' : 'card-act--toggle';
        const lastId = isModal ? ' id="modal-close-btn"' : '';
        const pinTitle = pinned ? 'Unpin (unlock drag)' : 'Pin position (locks drag)';
        const pinBtn = `<button type="button" class="card-act card-act--pin${pinned ? ' is-active' : ''}" title="${pinTitle}" aria-label="${pinTitle}" aria-pressed="${pinned ? 'true' : 'false'}">${pinned ? CARD_ICONS.unpin : CARD_ICONS.pin}</button>`;
        const calHidden = this.isHiddenFromCalendar(item);
        const calTitle = calHidden
            ? 'Hidden from calendar — click to show'
            : 'Shown on calendar — click to hide';
        const calBtn = `<button type="button" class="card-act card-act--cal${calHidden ? ' is-off' : ' is-on'}" title="${this.escapeAttr(calTitle)}" aria-label="${this.escapeAttr(calTitle)}">${CARD_ICONS.calendar}</button>`;
        const showDragIcon = isModal ? true : (showDrag && !pinned);
        const dragBtn = showDragIcon
            ? `<button type="button" class="card-act card-act--drag${isModal ? ' card-act--decorative' : ''}" title="Drag to move" aria-label="Drag to move"${isModal ? ' tabindex="-1" aria-hidden="true"' : ''}>${CARD_ICONS.drag}</button>`
            : '';
        let actionCount = 7;
        if (showDragIcon) actionCount += 1;
        if (showArchive) actionCount += 1;
        const archiveBtn = showArchive
            ? `<button type="button" id="modal-archive-btn" class="card-act card-act--archive" title="Archive note" aria-label="Archive note">${CARD_ICONS.delete}</button>`
            : '';
        const actionsHtml = `<div class="card-actions${isModal ? ' modal-card-actions' : ''}" data-action-count="${actionCount}" data-surface="${surface}">
            ${calBtn}
            <button type="button" class="card-act card-act--copy" title="Copy note as text" aria-label="Copy note as text">${CARD_ICONS.copy}</button>
            ${pinBtn}
            <button type="button" class="card-act card-act--color" title="Note color" aria-label="Note color" aria-haspopup="dialog">${CARD_ICONS.color}</button>
            <button type="button" class="card-act card-act--hide" title="Hide from board" aria-label="Hide from board">${CARD_ICONS.hide}</button>
            <button type="button" class="card-act card-act--edit" title="Edit note" aria-label="Edit note">${CARD_ICONS.edit}</button>
            ${dragBtn}
            <button type="button" class="card-act ${lastClass}"${lastId} title="${expandTitle}" aria-label="${expandTitle}">${lastIcon}</button>
        </div>`;
        return isModal ? `${archiveBtn}${actionsHtml}` : actionsHtml;
    },

    buildCardActionsHtml(item, isExpanded = false, options = {}) {
        return this.buildNoteQuickActionsHtml(item, { surface: 'board', isExpanded, ...options });
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

    async copyPlainTextToClipboard(text) {
        const value = String(text ?? '');
        if (!value) return false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch { /* fallback below */ }
        try {
            const ta = document.createElement('textarea');
            ta.value = value;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(ta);
            return ok;
        } catch {
            return false;
        }
    },

    flashCopyFeedback(btn, message = 'Copied!', { failed = false } = {}) {
        if (!btn) return;
        if (btn.dataset.copyFlashTimer) {
            clearTimeout(Number(btn.dataset.copyFlashTimer));
            delete btn.dataset.copyFlashTimer;
        }

        const row = btn.closest('.step-row--display');
        const prevTitle = btn.getAttribute('title');
        const prevLabel = btn.getAttribute('aria-label');
        const prevHtml = btn.innerHTML;
        const isCopyBtn = btn.classList.contains('step-copy-btn') || btn.classList.contains('card-act--copy');

        btn.classList.remove('is-copy-flashed', 'is-copy-flash-failed');
        row?.classList.remove('is-copy-row-flashed');
        btn.classList.add(failed ? 'is-copy-flash-failed' : 'is-copy-flashed');
        if (!failed) row?.classList.add('is-copy-row-flashed');

        if (isCopyBtn && !failed) btn.innerHTML = CARD_ICONS.save;
        btn.setAttribute('title', message);
        btn.setAttribute('aria-label', message);

        btn.dataset.copyFlashTimer = String(window.setTimeout(() => {
            btn.classList.remove('is-copy-flashed', 'is-copy-flash-failed');
            row?.classList.remove('is-copy-row-flashed');
            if (isCopyBtn && !failed) btn.innerHTML = prevHtml;
            if (prevTitle != null) btn.setAttribute('title', prevTitle);
            else btn.removeAttribute('title');
            if (prevLabel != null) btn.setAttribute('aria-label', prevLabel);
            else btn.removeAttribute('aria-label');
            delete btn.dataset.copyFlashTimer;
        }, 1400));
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
            const { w, h } = this.readNoteRect(card);
            opts.tileSize = this.getCardTileSize(card, item);
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
            this.commitFocusedInlineField(card, item);
            const shell = card.querySelector('.editor-note-shell');
            if (shell) this.syncItemBodyFromDom(shell, item);
            const ok = await this.copyPlainTextToClipboard(itemToPlainCopyText(item));
            if (ok) this.flashCopyFeedback(copyBtn);
            else this.flashCopyFeedback(copyBtn, 'Copy failed', { failed: true });
        });

        const toolbar = card.querySelector('.note-editor-toolbar');
        toolbar?.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            this.commitFocusedInlineField(card, item);
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
                if (isDesktopCard(card)) {
                    delete card.dataset.skipExpand;
                } else {
                    const isExpanded = card.classList.contains('expanded');
                    if (!isExpanded && consumeSkipExpand()) return;
                    if (card.dataset.skipExpand) delete card.dataset.skipExpand;
                }
                if (ctx) this.toggleCardExpanded(card, item, { ...ctx, fromToolbar: true });
            });
        }

        this.attachCardActionButton(colorBtn, () => {
            this.commitFocusedInlineField(card, item);
            if (isDesktopCard(card)) this.raiseDesktopCard(card);
            if (!localStorage.getItem('admin_token')) return;
            ColorPicker.open({
                anchor: colorBtn,
                presets: PALETTE_NOTE,
                value: resolveNoteColor(item.backgroundColor),
                align: 'end',
                onSelect: (color) => {
                    this.mutateItem(item, (it) => {
                        it.backgroundColor = color || THEME_DEFAULT_COLOR;
                    }, { preserveView: true, skipRerender: true });
                    this.applyItemCardTheme(card, item);
                }
            });
        });

        this.attachCardActionButton(hideBtn, () => {
            this.commitFocusedInlineField(card, item);
            this.hideFromBoard(item);
        });

        this.attachCardActionButton(editBtn, () => {
            this.commitFocusedInlineField(card, item);
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
                this.commitFocusedInlineField(card, item);
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
            const ok = await this.copyPlainTextToClipboard(itemToPlainCopyText(data));
            if (ok) this.flashCopyFeedback(copyBtn);
            else this.flashCopyFeedback(copyBtn, 'Copy failed', { failed: true });
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
            if (titleEl) this.focusInlineEdit(titleEl, 'end');
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
    finalizeDesktopCard(card) {
        if (!isDesktopCard(card)) return;
        const item = this.resolveBoardItem(card.dataset.id);
        this.setupFreeformChrome(card);
        if (isSnapLayoutMode(activeBoardViewMode)) {
            this.applyDesktopSize(card);
        } else {
            this.applyFreeformSize(card);
        }
        const { w, h } = this.readNoteRect(card);
        this.syncSpatialCollapseState(card, item, w, h);
        this.syncSpatialChromeForEditing(card);
        this.syncSpatialToggleButton(card);
    },

    getCardRenderContext(item, activeCategories) {
        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';
        return { targetCatName, categoryColor };
    },

    updateDesktopCard(card, item, { expanded, dimensions = null, deferReflow = false } = {}) {
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

        if (snapLayout && canvas && !deferReflow) {
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, item.id, { animate: true });
            });
        }
    },

    usesAnimPixelLock(card) {
        return isDesktopCard(card);
    },

    lockCardAnimationDimensions(card, w, h) {
        card.style.setProperty('width', `${w}px`, 'important');
        card.style.setProperty('height', `${h}px`, 'important');
        card.style.setProperty('min-height', `${h}px`, 'important');
        card.style.setProperty('max-height', `${h}px`, 'important');
    },

    measureExpandedCardHeight(card, widthPx) {
        const cap = Math.min(Math.round(window.innerHeight * 0.72), 680);
        const prev = {
            width: card.style.width,
            height: card.style.height,
            minHeight: card.style.minHeight,
            maxHeight: card.style.maxHeight,
            overflow: card.style.overflow
        };
        card.style.setProperty('width', `${widthPx}px`, 'important');
        card.style.setProperty('height', 'auto', 'important');
        card.style.setProperty('min-height', '0', 'important');
        card.style.setProperty('max-height', `${cap}px`, 'important');
        card.style.overflow = 'hidden';
        const measured = Math.max(CARD_COMPACT_H, Math.ceil(card.scrollHeight));
        if (prev.width) card.style.setProperty('width', prev.width, 'important');
        else card.style.removeProperty('width');
        if (prev.height) card.style.setProperty('height', prev.height, 'important');
        else card.style.removeProperty('height');
        if (prev.minHeight) card.style.setProperty('min-height', prev.minHeight, 'important');
        else card.style.removeProperty('min-height');
        if (prev.maxHeight) card.style.setProperty('max-height', prev.maxHeight, 'important');
        else card.style.removeProperty('max-height');
        card.style.overflow = prev.overflow || '';
        return Math.min(measured, cap);
    },

    resolveAnimCompactWidth(card) {
        const id = card.dataset?.id;
        const item = this.resolveBoardItem(id);
        const tileSize = this.getCardTileSize(card, item);
        const tileDefaultW = this.getTileDefaultRect(tileSize).w;
        if (isDesktopCard(card) && id) {
            if (isSnapLayoutMode(activeBoardViewMode)) {
                const saved = this.getGridLayout()[id];
                if (saved && Number.isFinite(saved.w)) return saved.w;
            } else {
                const saved = this.getFreeformSizes()[id];
                if (saved && Number.isFinite(saved.w)) return saved.w;
            }
            return tileDefaultW;
        }
        return Math.round(this.readNoteRect(card).w) || tileDefaultW;
    },

    resolveAnimExpandedWidth(card, item) {
        const id = card.dataset?.id || item?.id;
        const tileSize = this.getCardTileSize(card, item);
        if (isDesktopCard(card) && id) {
            if (isSnapLayoutMode(activeBoardViewMode)) {
                const saved = this.getGridLayout()[id];
                if (saved && Number.isFinite(saved.w)) return saved.w;
                return geoResolveExpandedDefaultRect(tileSize).w;
            }
            const saved = this.getFreeformSizes()[id];
            return geoResolveExpandedDefaultRect(tileSize, saved).w;
        }
        return Math.round(this.readNoteRect(card).w) || FREEFORM_EXPANDED_W;
    },

    resolveAnimCompactHeight(card) {
        const item = this.resolveBoardItem(card.dataset?.id);
        const tileSize = this.getCardTileSize(card, item);
        const tileDefaultH = this.getTileDefaultRect(tileSize).h;
        if (isDesktopCard(card) && isSnapLayoutMode(activeBoardViewMode)) {
            const saved = this.getGridLayout()[card.dataset.id];
            const compact = this.gridTileRect(
                tileSize,
                { x: 0, y: 0, w: getGridMetrics().cellW, h: getGridMetrics().cellH },
                saved
            );
            return compact.h;
        }
        if (isDesktopCard(card)) {
            const saved = this.getFreeformSizes()[card.dataset.id];
            if (saved && Number.isFinite(saved.h)) return saved.h;
            return tileDefaultH;
        }
        return tileDefaultH;
    },

    measureAnimTargetSize(card, item) {
        const w = this.resolveAnimExpandedWidth(card, item);
        const id = item?.id || card.dataset?.id;
        const tileSize = this.getCardTileSize(card, item);
        let h;

        if (isDesktopCard(card)) {
            if (isSnapLayoutMode(activeBoardViewMode)) {
                const saved = this.getGridLayout()[id];
                h = saved && Number.isFinite(saved.h)
                    ? saved.h
                    : geoResolveExpandedDefaultRect(tileSize).h;
            } else {
                const saved = this.getFreeformSizes()[id];
                h = geoResolveExpandedDefaultRect(tileSize, saved).h;
            }
        } else {
            h = this.measureExpandedCardHeight(card, w);
        }

        return { w, h };
    },

    isCardAnimating(card) {
        return !!card?.classList.contains('card-animating');
    },

    cancelCardAnimation(card) {
        if (!card) return;
        const session = cardAnimSessions.get(card);
        if (session) {
            if (session.transitionCleanup) session.transitionCleanup();
            cardAnimSessions.delete(card);
        }
        this.cleanupCardAnimation(card);
    },

    cleanupCardAnimation(card) {
        if (!card) return;
        card.classList.remove('card-state-changing', 'card-animating');
        card.style.removeProperty('--card-anim-duration');
        card.style.removeProperty('overflow');
        card.style.removeProperty('transition');
    },

    waitCardTransition(card, { properties = ['width', 'height'], timeoutMs = CARD_ANIM_MS + 80 } = {}) {
        return new Promise((resolve) => {
            let finished = false;
            const propSet = new Set(properties);
            const finish = () => {
                if (finished) return;
                finished = true;
                card.removeEventListener('transitionend', onEnd);
                clearTimeout(timer);
                const session = cardAnimSessions.get(card);
                if (session?.transitionCleanup === finish) {
                    session.transitionCleanup = null;
                }
                resolve();
            };
            const onEnd = (e) => {
                if (e.target !== card) return;
                if (!propSet.has(e.propertyName)) return;
                finish();
            };
            card.addEventListener('transitionend', onEnd);
            const timer = setTimeout(finish, timeoutMs);
            const session = cardAnimSessions.get(card) || {};
            session.transitionCleanup = finish;
            cardAnimSessions.set(card, session);
        });
    },

    applyCardExpandCollapse(card, item, expanded, activeCategories, targetCatName, categoryColor, options = {}) {
        if (options.skipAnimation) {
            this.cancelCardAnimation(card);
        }

        const animate = cardAnimationsEnabled() && !options.skipAnimation;

        const finishExpand = () => {
            this.cleanupCardAnimation(card);
        };

        const finishCollapse = () => {
            card.classList.remove('expanded');
            this.renderCollapsedCard(card, item, activeCategories, targetCatName, categoryColor);
            this.cleanupCardAnimation(card);
        };

        if (expanded) {
            if (!animate) {
                card.classList.remove('compact', 'tile-label', 'tile-compact', 'tile-note', 'tile-small', 'tile-large');
                card.classList.add('expanded');
                this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
                finishExpand();
                return;
            }

            const compactW = this.resolveAnimCompactWidth(card);
            const compactH = Math.round(this.readNoteRect(card).h) || this.resolveAnimCompactHeight(card);

            card.classList.add('card-animating', 'card-state-changing');
            card.style.setProperty('--card-anim-duration', `${CARD_ANIM_MS}ms`);
            card.style.overflow = 'hidden';

            this.lockCardAnimationDimensions(card, compactW, compactH);

            card.classList.remove('compact', 'tile-label', 'tile-compact', 'tile-note', 'tile-small', 'tile-large');
            card.classList.add('expanded');
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);

            this.lockCardAnimationDimensions(card, compactW, compactH);

            const target = this.measureAnimTargetSize(card, item);

            void card.offsetHeight;
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    this.lockCardAnimationDimensions(card, target.w, target.h);

                    void this.waitCardTransition(card).then(() => {
                        finishExpand();
                    });
                });
            });
            return;
        }

        if (!animate) {
            finishCollapse();
            return;
        }

        const expandedRect = this.readNoteRect(card);
        const expandedW = Math.round(expandedRect.w) || this.resolveAnimExpandedWidth(card, item);
        const expandedH = Math.round(expandedRect.h) || this.measureAnimTargetSize(card, item).h;
        const compactW = this.resolveAnimCompactWidth(card);
        const compactH = this.resolveAnimCompactHeight(card);

        card.classList.add('card-animating', 'card-state-changing');
        card.style.setProperty('--card-anim-duration', `${CARD_ANIM_MS}ms`);
        card.style.overflow = 'hidden';
        this.lockCardAnimationDimensions(card, expandedW, expandedH);

        void card.offsetHeight;
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.lockCardAnimationDimensions(card, compactW, compactH);
                void this.waitCardTransition(card).then(() => {
                    finishCollapse();
                });
            });
        });
    },

    toggleCardExpanded(card, item, ctx) {
        if (this.isCardAnimating(card)) return;

        if (this.usesTileTierBoard(card)) {
            this.applyTileZoneToggle(card, item, ctx);
            return;
        }

        const willExpand = !card.classList.contains('expanded');

        setExpandedCard(activeBoardViewMode, item.id, willExpand);

        this.applyCardExpandCollapse(
            card,
            item,
            willExpand,
            ctx.activeCategories,
            ctx.targetCatName,
            ctx.categoryColor
        );
        window.dispatchEvent(new CustomEvent('board:cards_reflowed'));
    },

    createCardComponent(item, activeCategories, { desktop = false, freeform = false, gridBoard = false } = {}) {
        const card = document.createElement('div');
        card.classList.add('mini-card');

        card.dataset.id = item.id;
        if (desktop || freeform || gridBoard) card.dataset.desktop = '1';

        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';

        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;

        if (desktop || freeform || gridBoard) {
            card.classList.remove('expanded');
            this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
        } else {
            const isExpanded = getExpandedCards(activeBoardViewMode)[item.id] === true;
            if (isExpanded) {
                card.classList.remove('compact', 'tile-label', 'tile-compact', 'tile-note', 'tile-small', 'tile-large');
                card.classList.add('expanded');
                this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
            } else {
                card.classList.remove('expanded');
                this.renderCollapsedCard(card, item, activeCategories, targetCatName, categoryColor);
            }
        }

        if (isDesktopCard(card)) {
            card.addEventListener('mousedown', () => this.raiseDesktopCard(card), true);
        }

        this.syncCardDraggable(card);
        this.syncBoardPinClass(card);
        return card;
    },

    formatCreatedDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(Number(timestamp) * 1000);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    formatNoteListDate(item) {
        const ts = Number(item?.updated_at || item?.created_at || 0);
        if (!ts) return '—';
        const d = new Date(ts * 1000);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    buildNoteBodyConvertButtonsHtml(item) {
        const canToChecklist = contentHasConvertibleText(item?.content);
        const canToContent = stepsHaveConvertibleText(item?.steps);
        return `
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="format-btn card-act editor-convert-btn" data-convert="to-checklist" title="Move content into checklist items" aria-label="To checklist"${canToChecklist ? '' : ' disabled'}>${FORMAT_ICONS.toChecklist}</button>
            <button type="button" class="format-btn card-act editor-convert-btn" data-convert="to-content" title="Move checklist into note content" aria-label="To notes"${canToContent ? '' : ' disabled'}>${FORMAT_ICONS.toNotes}</button>
        `;
    },

    updateConvertButtons(shell, item) {
        if (!shell || !item) return;
        const toChecklist = shell.querySelector('[data-convert="to-checklist"]');
        const toContent = shell.querySelector('[data-convert="to-content"]');
        if (toChecklist) toChecklist.disabled = !contentHasConvertibleText(item.content);
        if (toContent) toContent.disabled = !stepsHaveConvertibleText(item.steps);
    },

    buildNoteBodyHtml(item, { canEdit = false, inModalEditor = false, richEdit = false } = {}) {
        let html = '';
        const layout = item.editorBodyLayout || 'both';
        const hasContent = stripRichText(item.content || '').trim();

        let showContent;
        let showChecklist;
        if (inModalEditor) {
            showContent = true;
            showChecklist = true;
        } else if (canEdit) {
            showContent = layout !== 'checklist'
                && (hasContent || layout === 'both' || layout === 'content');
            showChecklist = layout !== 'content'
                && (layout === 'both' || layout === 'checklist' || (item.steps && item.steps.length > 0));
        } else {
            showContent = !!hasContent;
            showChecklist = item.type === 'checklist' && item.steps && item.steps.length > 0;
        }

        if (showContent) {
            const content = item.content || '';
            const rich = hasRichMarkup(content) || content.includes('\u2028');
            if (canEdit && (richEdit || this.canInlineEditText(content, { richEdit }))) {
                const inner = richEdit ? this.prepareContentForEdit(content) : this.escapeHTML(content.replace(/\u2028/g, '\n'));
                const ce = richEdit ? 'true' : 'plaintext-only';
                const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
                html += `<div class="card-content-preview card-inline-edit${richClasses}" contenteditable="${ce}" spellcheck="false" data-field="content" data-placeholder="Add note…">${inner}</div>`;
            } else {
                const richClass = rich ? ' rich-text' : '';
                html += `<div class="card-content-preview${richClass}">${this.renderRichHtml(content)}</div>`;
            }
        }

        if (showChecklist) {
            if (!item.steps) item.steps = [];
            html += this.buildExpandedChecklistHtml(item, canEdit, { richEdit });
        }
        return html;
    },

    escapeQuotes(str) {
        return str ? str.replace(/"/g, '&quot;') : '';
    },

    buildNoteTitleHtml(item, canEdit, { richEdit = false } = {}) {
        const fullTitle = item.title || '';
        const titleAttr = this.escapeAttr(stripRichText(fullTitle));
        const rich = hasRichMarkup(fullTitle);

        if (canEdit && (richEdit || this.canInlineEditText(fullTitle, { richEdit }))) {
            const inner = richEdit ? sanitizeRichHtml(fullTitle) : this.escapeHTML(fullTitle);
            const ce = richEdit ? 'true' : 'plaintext-only';
            const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
            return `<div class="mini-card-title card-inline-edit${richClasses}" contenteditable="${ce}" spellcheck="false" data-field="title" data-placeholder="Title…">${inner}</div>`;
        }

        const richClass = rich ? ' rich-text' : '';
        return `<div class="mini-card-title${richClass}" title="${titleAttr}">${this.renderRichHtml(fullTitle)}</div>`;
    },

    buildNoteFormatPanelHtml(item = null) {
        return `
            <div class="editor-panel editor-panel--format">
                <div class="collapsable-header" id="format-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Formatting</span>
                </div>
                <div class="collapsable-section collapsed" id="format-section">
                    <div class="format-toolbar">
                        <button type="button" class="format-btn card-act" data-format-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold">${FORMAT_ICONS.bold}</button>
                        <button type="button" class="format-btn card-act" data-format-cmd="italic" title="Italic (Ctrl+I)" aria-label="Italic">${FORMAT_ICONS.italic}</button>
                        <button type="button" class="format-btn card-act" data-format-cmd="strikeThrough" title="Strikethrough (Ctrl+Shift+S)" aria-label="Strikethrough">${FORMAT_ICONS.strike}</button>
                        <span class="format-toolbar-sep" aria-hidden="true"></span>
                        <button type="button" class="format-btn card-act" data-zoom="down" title="Smaller text" aria-label="Smaller text">${FORMAT_ICONS.smaller}</button>
                        <input type="text" id="format-zoom-input" class="format-zoom-input" inputmode="numeric" title="Text size (100 = default)" aria-label="Text size" value="100">
                        <button type="button" class="format-btn card-act" data-zoom="up" title="Larger text" aria-label="Larger text">${FORMAT_ICONS.larger}</button>
                        <button type="button" class="format-btn card-act" data-zoom="reset" title="Reset text size" aria-label="Reset text size">${ACTION_ICONS.layoutReset}</button>
                        ${item ? this.buildNoteBodyConvertButtonsHtml(item) : ''}
                    </div>
                </div>
            </div>
        `;
    },

    buildNoteMetaFooterHtml(item, { targetCatName = '', categoryColor = UNCATEGORIZED_COLOR } = {}) {
        const createdLabel = this.formatCreatedDate(item.created_at);
        const sizeLabel = computeNoteSizeKb(item);
        const lineLabel = formatNoteLineCount(computeNoteLineCount(item));
        const createdHtml = createdLabel
            ? `<span class="editor-created-date" title="Created">Created ${createdLabel}</span>`
            : '';
        const sizeHtml = `<span class="editor-note-size" title="Note content size">${sizeLabel} KB</span>`;
        const lineHtml = `<span class="editor-note-lines" title="Number of lines">${lineLabel}</span>`;
        const statsHtml = `${sizeHtml}${lineHtml}${createdHtml}`;

        return `
            <div class="editor-meta-row editor-meta-row--footer editor-meta-row--inline">
                <span class="editor-meta-badges">
                    <span class="badge-dot" style="background-color: ${categoryColor};" title="${this.escapeAttr(targetCatName || 'Uncategorized')}"></span>
                    ${targetCatName ? `<span class="category-name">${this.escapeHTML(targetCatName)}</span>` : ''}
                </span>
                <span class="editor-meta-stats">
                    ${statsHtml}
                </span>
            </div>
        `;
    },

    updateNoteMetaStats(shell, item) {
        if (!shell || !item) return;
        const draft = { ...item };
        this.syncItemBodyFromDom(shell, draft);
        const sizeEl = shell.querySelector('.editor-note-size');
        const linesEl = shell.querySelector('.editor-note-lines');
        if (sizeEl) sizeEl.textContent = `${computeNoteSizeKb(draft)} KB`;
        if (linesEl) linesEl.textContent = formatNoteLineCount(computeNoteLineCount(draft));
    },

    buildNoteConfigPanelHtml(item, { categoryOptionsHtml = '', startParts = {}, endParts = {} } = {}) {
        return `
            <div class="editor-panel editor-panel--config">
                <div class="collapsable-header" id="config-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Configuration</span>
                </div>
                <div class="collapsable-section collapsed" id="config-section">
                    <div class="form-row-grid form-row-grid--2">
                        <div class="form-group form-group--compact">
                            <label>Visibility</label>
                            <select id="edit-visibility" class="form-input">
                                <option value="private" ${item.visibility === 'private' ? 'selected' : ''}>Private</option>
                                <option value="public" ${item.visibility === 'public' ? 'selected' : ''}>Public</option>
                            </select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Start</label>
                            <div class="datetime-input-row">
                                <input type="date" id="edit-start-date" class="form-input" value="${startParts.date || ''}">
                                <input type="time" id="edit-start-time" class="form-input form-input--optional-time" value="${startParts.time || ''}" step="60" title="Optional — leave blank for date only">
                            </div>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>End</label>
                            <div class="datetime-input-row">
                                <input type="date" id="edit-end-date" class="form-input" value="${endParts.date || ''}">
                                <input type="time" id="edit-end-time" class="form-input form-input--optional-time" value="${endParts.time || ''}" step="60" title="Optional — leave blank for date only">
                            </div>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Category</label>
                            <select id="edit-category" class="form-input">${categoryOptionsHtml}</select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Status</label>
                            <select id="edit-status" class="form-input">
                                <option value="active" ${item.status === 'active' ? 'selected' : ''}>Active</option>
                                <option value="archived" ${item.status === 'archived' ? 'selected' : ''}>Archived</option>
                                <option value="completed" ${item.status === 'completed' ? 'selected' : ''}>Done</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    buildNoteEditorShell(item, {
        canEdit = false,
        inModalEditor = false,
        showConfig = false,
        showFormat = false,
        richEdit = false,
        toolbarHtml = '',
        toolbarDragZone = '',
        footerDragZone = '',
        targetCatName = '',
        categoryColor = UNCATEGORIZED_COLOR,
        categoryOptionsHtml = '',
        startParts = {},
        endParts = {},
        bodyId = ''
    } = {}) {
        const titleHtml = this.buildNoteTitleHtml(item, canEdit, { richEdit });
        const bodyHtml = this.buildNoteBodyHtml(item, {
            canEdit,
            inModalEditor,
            richEdit
        });
        const formatHtml = showFormat ? this.buildNoteFormatPanelHtml(item) : '';
        const configHtml = showConfig
            ? this.buildNoteConfigPanelHtml(item, { categoryOptionsHtml, startParts, endParts })
            : '';
        const metaHtml = this.buildNoteMetaFooterHtml(item, {
            targetCatName,
            categoryColor
        });
        const bodyIdAttr = bodyId ? ` id="${bodyId}"` : '';

        const toplineDragZone = toolbarDragZone || footerDragZone || '';
        const toplineHtml = `
                <div class="editor-note-topline${toplineDragZone}">
                    <div class="editor-note-header">
                        ${titleHtml}
                    </div>
                    ${toolbarHtml ? `<div class="note-editor-toolbar${toolbarDragZone}">${toolbarHtml}</div>` : ''}
                </div>`;

        return `
            <div class="editor-note-shell note-surface">
                ${toplineHtml}
                ${formatHtml}
                ${configHtml}
                <div class="card-body editor-note-body"${bodyIdAttr}>
                    ${bodyHtml}
                </div>
                <div class="${footerDragZone ? `editor-meta-wrap${footerDragZone}` : 'editor-meta-wrap'}">
                    ${metaHtml}
                </div>
            </div>
        `;
    },

    markNoteExpanded(itemId) {
        if (!itemId) return;
        setExpandedCard(activeBoardViewMode, itemId, true);
    },

    markNoteCollapsed(itemId) {
        if (!itemId) return;
        setExpandedCard(activeBoardViewMode, itemId, false);
    },

    collapseBoardCardIfExpanded(card, item, hiddenCategories = []) {
        if (!card || !item?.id) return;

        if (isDesktopCard(card)) {
            if (!this.isSpatiallyCollapsed(card)) {
                this.collapseBoardCardToSmallFootprint(card, item);
            }
            return;
        }

        if (!card.classList.contains('expanded')) return;

        let activeCategories = readStoredCategories()
            .filter((cat) => !hiddenCategories.includes(cat.name));
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);
        this.applyCardExpandCollapse(card, item, false, activeCategories, targetCatName, categoryColor);
    },

    revealNoteOnBoard(item) {
        if (!item?.id) return;
        window.dispatchEvent(new CustomEvent('editor:reveal_on_board', { detail: item }));
    },

    captureDesktopRestoreContext(card) {
        if (!isDesktopCard(card)) return null;
        const mode = activeBoardViewMode;
        if (isSnapLayoutMode(mode)) {
            return {
                viewMode: 'grid',
                rect: this.readNoteRect(card),
                size: this.readFreeformCardSize(card)
            };
        }
        return {
            viewMode: 'freeform',
            position: {
                x: parseFloat(card.style.left) || 0,
                y: parseFloat(card.style.top) || 0
            },
            size: this.readFreeformCardSize(card)
        };
    },

    getPreferredDesktopViewMode() {
        const preferred = localStorage.getItem('matrix_desktop_layout')
            || localStorage.getItem('matrix_preferred_view');
        if (preferred === 'freeform' || preferred === 'grid') return preferred;
        return 'grid';
    },

    findDesktopCenterSlot(w, h, canvas, viewMode, { excludeId = null } = {}) {
        const host = canvas || document.getElementById('app-canvas');
        if (viewMode === 'grid') {
            const { origin, packW, viewportH } = this.getGridViewportBounds(host);
            let rect = {
                x: origin + Math.max(0, (packW - w) / 2),
                y: origin + Math.max(0, (viewportH - h) / 2),
                w,
                h
            };
            rect = this.snapNoteRect(rect, { maxW: packW, maxH: origin + viewportH });
            const placed = [...(host?.querySelectorAll('.mini-card[data-desktop="1"]') || [])]
                .filter((c) => c.dataset.id !== excludeId)
                .map((c) => this.readNoteRect(c));
            if (placed.some((p) => this.rectsOverlap(rect, p))) {
                rect = this.findNearestGridSlot(rect, rect.w, rect.h, placed, {
                    packW,
                    origin,
                    maxH: origin + viewportH
                });
            }
            return rect;
        }

        const zoom = parseFloat(host?.dataset?.desktopZoom) || 1;
        const pad = 8;
        const cw = (host?.clientWidth || window.innerWidth) / zoom;
        const ch = (host?.clientHeight || window.innerHeight) / zoom;
        return {
            x: Math.max(pad, (cw - w) / 2),
            y: Math.max(pad, (ch - h) / 2),
            w,
            h
        };
    },

    resolveNoteDesktopPlacement(itemId, { restoreContext = null, modalGeometry = null } = {}) {
        const gridW = modalGeometry?.w || this.cellsToSpanW(2);
        const gridH = modalGeometry?.h || this.cellsToSpanH(2);
        const ffW = modalGeometry?.w || FREEFORM_EXPANDED_W;
        const ffH = modalGeometry?.h || FREEFORM_EXPANDED_DEFAULT_H;
        const canvas = document.getElementById('app-canvas');

        if (restoreContext?.viewMode === 'grid' && restoreContext.rect) {
            return {
                viewMode: 'grid',
                rect: {
                    ...restoreContext.rect,
                    w: modalGeometry?.w ?? restoreContext.rect.w,
                    h: modalGeometry?.h ?? restoreContext.rect.h
                }
            };
        }
        if (restoreContext?.viewMode === 'freeform' && restoreContext.position) {
            return {
                viewMode: 'freeform',
                position: { ...restoreContext.position },
                size: {
                    w: modalGeometry?.w ?? restoreContext.size?.w ?? ffW,
                    h: modalGeometry?.h ?? restoreContext.size?.h ?? ffH
                }
            };
        }

        const gridSaved = this.getGridLayout()[itemId];
        if (gridSaved && Number.isFinite(gridSaved.x) && Number.isFinite(gridSaved.w)) {
            return {
                viewMode: 'grid',
                rect: {
                    ...gridSaved,
                    w: modalGeometry?.w ?? gridSaved.w,
                    h: modalGeometry?.h ?? gridSaved.h
                }
            };
        }

        const ffPos = this.getFreeformPositions()[itemId];
        if (ffPos && Number.isFinite(ffPos.x)) {
            const ffSize = this.getFreeformSizes()[itemId];
            return {
                viewMode: 'freeform',
                position: { x: ffPos.x, y: ffPos.y },
                size: {
                    w: modalGeometry?.w ?? ffSize?.w ?? ffW,
                    h: modalGeometry?.h ?? ffSize?.h ?? ffH
                }
            };
        }

        const viewMode = this.getPreferredDesktopViewMode();
        if (viewMode === 'grid') {
            return {
                viewMode: 'grid',
                rect: this.findDesktopCenterSlot(gridW, gridH, canvas, 'grid', { excludeId: itemId })
            };
        }
        const center = this.findDesktopCenterSlot(ffW, ffH, canvas, 'freeform');
        return {
            viewMode: 'freeform',
            position: { x: center.x, y: center.y },
            size: { w: center.w, h: center.h }
        };
    },

    prepareDesktopPlacementBeforeRender(itemId, placement) {
        if (!itemId || !placement?.viewMode) return;
        setExpandedCard(placement.viewMode, itemId, true);
        if (placement.viewMode === 'grid') {
            if (placement.rect) {
                this.saveGridLayout(itemId, placement.rect);
            }
            return;
        }
        if (placement.viewMode === 'freeform') {
            if (placement.position) {
                this.saveFreeformPosition(itemId, placement.position.x, placement.position.y);
            }
            if (placement.size) {
                this.saveFreeformSize(itemId, placement.size.w, placement.size.h);
            }
        }
    },

    finishNoteDesktopReactivation(item, placement) {
        if (!item?.id || !placement?.viewMode) return;
        const canvas = document.getElementById('app-canvas');
        const card = canvas?.querySelector(`.mini-card[data-id="${CSS.escape(item.id)}"]`);
        if (!card) return;

        if (placement.viewMode === 'grid' && placement.rect) {
            this.applyNoteRect(card, placement.rect);
            this.updateDesktopCard(card, item, {
                expanded: true,
                dimensions: { w: placement.rect.w, h: placement.rect.h }
            });
            this.raiseGridBoardCard(card);
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, item.id, { animate: true });
                this.squeezeGridBoardToViewport(canvas, { animate: true });
                card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
            return;
        }

        if (placement.viewMode === 'freeform') {
            if (placement.position) {
                card.style.left = `${placement.position.x}px`;
                card.style.top = `${placement.position.y}px`;
                this.saveFreeformPosition(item.id, placement.position.x, placement.position.y);
            }
            this.updateDesktopCard(card, item, {
                expanded: true,
                dimensions: placement.size || null
            });
            this.raiseFreeformCard(card);
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    },

    bindCollapsable(headerId, sectionId, startCollapsed = false) {
        const header = document.getElementById(headerId);
        const section = document.getElementById(sectionId);
        if (!header || !section) return;

        const toggle = header.querySelector('.collapsable-toggle');
        if (startCollapsed) {
            section.classList.add('collapsed');
            toggle?.classList.add('collapsed');
        }

        header.addEventListener('click', () => {
            section.classList.toggle('collapsed');
            toggle?.classList.toggle('collapsed');
        });
    },

    getEditorZoom() {
        const stored = parseFloat(localStorage.getItem(EDITOR_ZOOM_KEY));
        if (!Number.isFinite(stored)) return 1;
        return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, stored));
    },

    zoomToDisplay(zoom) {
        return Math.round(zoom * 100);
    },

    displayToZoom(display) {
        const n = parseInt(String(display).trim(), 10);
        if (!Number.isFinite(n)) return 1;
        const zoom = n / 100;
        return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, zoom));
    },

    syncZoomInput(shell, zoom) {
        const input = shell?.querySelector('#format-zoom-input')
            || document.getElementById('format-zoom-input');
        if (input) input.value = String(this.zoomToDisplay(zoom));
    },

    setEditorZoom(shell, zoom) {
        const clamped = Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, zoom));
        localStorage.setItem(EDITOR_ZOOM_KEY, String(clamped));
        shell?.style?.setProperty('--editor-zoom', String(clamped));
        this.syncZoomInput(shell, clamped);
        return clamped;
    },

    applyZoomFromInput(shell) {
        const input = shell?.querySelector('#format-zoom-input')
            || document.getElementById('format-zoom-input');
        if (!input) return this.getEditorZoom();
        return this.setEditorZoom(shell, this.displayToZoom(input.value));
    },

    applyFormatCommand(cmd) {
        const el = document.activeElement;
        if (!el?.classList?.contains('rich-text--edit')) return false;
        document.execCommand(cmd, false, null);
        return true;
    },

    bindBodyConvertBar(shell, item, {
        refresh = () => {},
        localOnly = false,
        onChange = () => {}
    } = {}) {
        if (!shell || shell.dataset.convertBound) return;
        shell.dataset.convertBound = '1';

        shell.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-convert]');
            if (!btn || !shell.contains(btn) || btn.disabled) return;
            e.preventDefault();
            e.stopPropagation();

            const action = btn.dataset.convert;
            this.syncItemBodyFromDom(shell, item);
            Object.assign(item, normalizeItemForSave(item));

            const applyMutate = (mutator, { persist = !localOnly } = {}) => {
                if (persist) {
                    this.mutateItem(item, mutator, { preserveView: true, skipRerender: true, localOnly });
                } else {
                    mutator(item);
                }
            };

            const syncAndNormalize = (it) => {
                this.syncItemBodyFromDom(shell, it);
                Object.assign(it, normalizeItemForSave(it));
            };

            if (action === 'to-checklist') {
                if (!contentHasConvertibleText(item.content)) return;
                applyMutate((it) => {
                    syncAndNormalize(it);
                    convertContentToChecklist(it, () => this.createBlankChecklistStep());
                    Object.assign(it, normalizeItemForSave(it));
                });
            } else if (action === 'to-content') {
                if (!stepsHaveConvertibleText(item.steps)) return;
                applyMutate((it) => {
                    syncAndNormalize(it);
                    convertChecklistToContent(it);
                    Object.assign(it, normalizeItemForSave(it));
                });
            } else {
                return;
            }

            refresh();
            this.updateConvertButtons(shell, item);
            if (localOnly) onChange();

            const body = shell.querySelector('.editor-note-body');
            requestAnimationFrame(() => {
                if (action === 'to-checklist') {
                    const first = body?.querySelector('[data-field="step-text"].card-inline-edit');
                    if (first) this.focusInlineEdit(first, 'start');
                } else if (action === 'to-content') {
                    const content = body?.querySelector('[data-field="content"].card-inline-edit');
                    if (content) this.focusInlineEdit(content, 'start');
                }
            });
        });
    },

    bindFormatPanel(shell, { onChange = () => {} } = {}) {
        if (!shell) return;
        this.bindCollapsable('format-section-header', 'format-section', true);
        this.setEditorZoom(shell, this.getEditorZoom());

        shell.querySelectorAll('[data-format-cmd]').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.applyFormatCommand(btn.dataset.formatCmd)) onChange();
            });
        });

        shell.querySelectorAll('[data-zoom]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = btn.dataset.zoom;
                const current = this.getEditorZoom();
                if (action === 'reset') this.setEditorZoom(shell, 1);
                else if (action === 'up') this.setEditorZoom(shell, current + EDITOR_ZOOM_STEP);
                else if (action === 'down') this.setEditorZoom(shell, current - EDITOR_ZOOM_STEP);
            });
        });

        const zoomInput = shell.querySelector('#format-zoom-input')
            || document.getElementById('format-zoom-input');
        if (zoomInput) {
            const commitZoomInput = () => {
                this.applyZoomFromInput(shell);
            };
            zoomInput.addEventListener('change', commitZoomInput);
            zoomInput.addEventListener('blur', commitZoomInput);
            zoomInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitZoomInput();
                    zoomInput.blur();
                }
            });
        }
    },

    bindNoteEditorShell(root, item, {
        showConfig = false,
        showFormat = false,
        richEdit = false,
        localOnly = false,
        refresh = () => {},
        onChange = () => {},
        onConfigChange = () => {},
        onStatusChange = () => {},
        bindDateDefaults = null,
        stopMousedownPropagation = false
    } = {}) {
        const shell = root?.querySelector?.('.editor-note-shell') || root;
        if (!shell || !item) return;

        const interactionOptions = {
            refresh,
            localOnly,
            onChange,
            stopMousedownPropagation,
            richEdit
        };
        const header = shell.querySelector('.editor-note-header');
        const body = shell.querySelector('.editor-note-body');
        if (header) this.attachNoteBodyInteractions(header, item, interactionOptions);
        if (body) this.attachNoteBodyInteractions(body, item, interactionOptions);

        if (stopMousedownPropagation && !shell.dataset.shellBubbleBound) {
            shell.dataset.shellBubbleBound = '1';
            shell.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target.closest('.card-act--drag')) return;
                if (!e.target.closest(
                    '.card-inline-edit, .step-check, .step-text, input, textarea, button, a, '
                    + '.card-act, .grab-handle--step, .expanded-checklist-add-btn, '
                    + '.checklist-done-toggle, .step-collapse-btn, .step-delete-btn, '
                    + '.step-indent-btn, .step-outdent-btn, .checklist-expand-collapse-all-btn'
                )) return;
                e.stopPropagation();
            });
        }

        shell.querySelectorAll('.card-inline-edit').forEach((el) => {
            el.addEventListener('input', () => this.updateNoteMetaStats(shell, item));
        });

        if (localOnly && onChange) {
            shell.querySelectorAll('.card-inline-edit').forEach((el) => {
                el.addEventListener('input', onChange);
            });
        }

        if (showFormat) {
            this.bindFormatPanel(shell, { onChange });
            this.bindBodyConvertBar(shell, item, { refresh, localOnly, onChange });
            this.updateConvertButtons(shell, item);
        }

        if (!showConfig) return;

        ['edit-visibility', 'edit-status', 'edit-category', 'edit-start-date', 'edit-start-time', 'edit-end-date', 'edit-end-time'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', onConfigChange);
            el.addEventListener('change', () => {
                onConfigChange();
                if (id === 'edit-status' && onStatusChange) onStatusChange();
            });
        });

        if (bindDateDefaults) {
            bindDateDefaults('edit-start-date', 'edit-start-time');
            bindDateDefaults('edit-end-date', 'edit-end-time');
        }
        this.bindCollapsable('config-section-header', 'config-section', true);
    },

    renderCollapsedCard(card, item, activeCategories, targetCatName, categoryColor) {
        this.renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
    },

    canEditInline() {
        return !!localStorage.getItem('admin_token');
    },

    buildExpandedChecklistHtml(item, canEdit, { richEdit = false } = {}) {
        const collapsedKeys = this.getChecklistCollapsedKeys();
        const { active, done } = partitionChecklistSteps(item.steps);
        let html = '<div class="expanded-checklist">';
        html += this.buildChecklistExpandCollapseAllHtml(item);

        const renderRowHtml = (step, { hasKids = false, isCollapsed = false, collapseKey = '', isDoneSection = false } = {}) => {
            const level = getStepLevel(step);
            const collapseControl = !isDoneSection && hasKids
                ? `<button type="button" class="step-collapse-btn" data-collapse-key="${this.escapeAttr(collapseKey)}" title="${isCollapsed ? 'Expand group' : 'Collapse group'}" aria-label="${isCollapsed ? 'Expand group' : 'Collapse group'}">${isCollapsed ? '▶' : '▼'}</button>`
                : '<span class="step-collapse-spacer" aria-hidden="true"></span>';
            const dragHandle = !canEdit
                ? ''
                : isDoneSection
                    ? '<span class="grab-handle grab-handle--step grab-handle--spacer" aria-hidden="true">⋮⋮</span>'
                    : '<span class="grab-handle grab-handle--step" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>';
            const nestControls = canEdit ? `
                    <button type="button" class="card-act step-outdent-btn" title="Outdent" aria-label="Outdent"${level === 0 ? ' disabled' : ''}>‹</button>
                    <button type="button" class="card-act step-indent-btn" title="Indent" aria-label="Indent"${level >= 4 ? ' disabled' : ''}>›</button>` : '';
            const copyBtn = canEdit
                ? `<button type="button" class="card-act step-copy-btn" title="Copy item" aria-label="Copy item">${CARD_ICONS.copy}</button>`
                : '';
            const deleteBtn = canEdit
                ? `<button type="button" class="card-act card-act--danger step-delete-btn" title="Remove item" aria-label="Remove item">${CARD_ICONS.close}</button>`
                : '';
            const stepText = step.text || '';
            const stepRich = hasRichMarkup(stepText);
            let textHtml;
            if (canEdit && (richEdit || this.canInlineEditText(stepText, { richEdit }))) {
                const inner = richEdit ? sanitizeRichHtml(stepText) : this.escapeHTML(stepText);
                const ce = richEdit ? 'true' : 'plaintext-only';
                const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
                textHtml = `<span class="step-text card-inline-edit${richClasses} ${step.completed ? 'completed' : ''}" contenteditable="${ce}" spellcheck="false" data-field="step-text" data-step-id="${step.id}">${inner}</span>`;
            } else {
                const richClass = stepRich ? ' rich-text' : '';
                textHtml = `<span class="step-text${richClass} ${step.completed ? 'completed' : ''}">${this.renderRichHtml(stepText)}</span>`;
            }
            return `
                <div class="step-row step-row--display${step.completed ? ' step-row--done' : ''}" data-step-id="${step.id}" data-level="${level}" style="padding-left:${level * 0.45}rem">
                    <div class="step-row-leading">
                        ${collapseControl}
                        ${dragHandle}
                        <input type="checkbox" class="step-check" ${step.completed ? 'checked' : ''}>
                    </div>
                    ${textHtml}
                    <div class="step-row-actions">
                        ${copyBtn}
                        ${canEdit ? `<span class="step-nest-controls">${nestControls}</span>` : ''}
                        ${deleteBtn}
                    </div>
                </div>
            `;
        };

        buildVisibleChecklistSteps(active, item.id, collapsedKeys)
            .forEach((row) => { html += renderRowHtml(row.step, row); });

        if (canEdit) {
            html += `<button type="button" class="card-act expanded-checklist-add-btn" title="Add checklist item" aria-label="Add checklist item">+</button>`;
        }

        if (done.length > 0) {
            const doneCollapsed = this.isChecklistDoneSectionCollapsed(item.id);
            const toggleTitle = doneCollapsed
                ? `Show ${done.length} completed item${done.length === 1 ? '' : 's'}`
                : 'Collapse completed items';
            const toggleIcon = doneCollapsed ? '▶' : '▼';
            const toggleLabel = doneCollapsed
                ? `Hidden items (${done.length})`
                : 'Completed';
            html += `<button type="button" class="checklist-done-toggle" title="${this.escapeAttr(toggleTitle)}" aria-expanded="${doneCollapsed ? 'false' : 'true'}" aria-label="${this.escapeAttr(toggleTitle)}">
                <span class="checklist-done-toggle-icon" aria-hidden="true">${toggleIcon}</span>
                <span class="checklist-done-toggle-label">${this.escapeHTML(toggleLabel)}</span>
            </button>`;
            if (!doneCollapsed && active.length > 0) {
                html += '<div class="checklist-done-divider" role="separator" aria-hidden="true"></div>';
            }
            html += `<div class="checklist-done-section${doneCollapsed ? ' is-hidden' : ''}">`;
            done.forEach((step) => { html += renderRowHtml(step, { isDoneSection: true }); });
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    renderBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor) {
        const canEdit = this.canEditInline();
        const dotColor = targetCatName ? categoryColor : UNCATEGORIZED_COLOR;
        const dragZone = this.freeformDragZoneClass(card);

        card.classList.remove('expanded');
        card.innerHTML = this.buildNoteEditorShell(item, {
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
        this.bindNoteEditorShell(card, item, {
            richEdit: canEdit,
            refresh: () => this.refreshBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor),
            stopMousedownPropagation: true
        });
        this.bindBoardEditorFocusChrome(card);
        this.finalizeDesktopCard(card);
        this.syncCardDraggable(card);
        this.syncBoardPinClass(card);
        this.focusPendingBoardField(card);
    },

    renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor) {
        card.classList.add('expanded');
        const canEdit = this.canEditInline();
        const dotColor = targetCatName ? categoryColor : UNCATEGORIZED_COLOR;
        const dragZone = this.freeformDragZoneClass(card);

        card.innerHTML = this.buildNoteEditorShell(item, {
            canEdit,
            richEdit: canEdit,
            toolbarHtml: this.buildCardActionsHtml(item, true, this.getCardActionsOptions(card)),
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
        this.bindNoteEditorShell(card, item, {
            richEdit: canEdit,
            refresh: () => this.refreshExpandedCard(card, item, activeCategories, targetCatName, categoryColor),
            stopMousedownPropagation: false
        });
        this.syncCardDraggable(card);
        this.syncBoardPinClass(card);
        this.focusPendingBoardField(card);
    },

    refreshBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor) {
        const shell = card.querySelector('.editor-note-shell');
        if (shell && !card.dataset.pendingFocusStepId) {
            this.syncItemBodyFromDom(shell, item);
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
            this.focusPendingChecklistStep(card);
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
            if (el) this.focusInlineEdit(el, 'start');
        });
    },

    refreshExpandedCard(card, item, activeCategories, targetCatName, categoryColor) {
        const shell = card.querySelector('.editor-note-shell');
        // Skip DOM→item sync while a checklist row op is in flight — stale DOM would undo splits/merges.
        if (shell && !card.dataset.pendingFocusStepId) {
            this.syncItemBodyFromDom(shell, item);
        }
        const body = card.querySelector('.editor-note-body') || card.querySelector('.card-body');
        const scrollTop = body?.scrollTop ?? 0;
        const pendingFocusStepId = card.dataset.pendingFocusStepId;
        const pendingFocusEdge = card.dataset.pendingFocusEdge;
        const pendingFocusPlainOffset = card.dataset.pendingFocusPlainOffset;
        if (isDesktopCard(card)) {
            this.refreshBoardEditorCard(card, item, activeCategories, targetCatName, categoryColor);
            return;
        }
        this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
        const newBody = card.querySelector('.editor-note-body') || card.querySelector('.card-body');
        if (newBody) newBody.scrollTop = scrollTop;
        if (pendingFocusStepId) {
            card.dataset.pendingFocusStepId = pendingFocusStepId;
            if (pendingFocusEdge) card.dataset.pendingFocusEdge = pendingFocusEdge;
            if (pendingFocusPlainOffset != null) {
                card.dataset.pendingFocusPlainOffset = pendingFocusPlainOffset;
            }
            this.focusPendingChecklistStep(card);
        }
    },

    splitInlineEditAtCaret(el) {
        const rich = el.classList.contains('rich-text--edit');
        const readFull = () => (rich
            ? sanitizeRichHtml(linkifyPlainUrls(el.innerHTML))
            : (el.textContent || ''));

        const sel = window.getSelection();
        if (!sel?.rangeCount) {
            const full = readFull();
            return { before: full, after: '' };
        }

        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) {
            const full = readFull();
            return { before: full, after: '' };
        }

        const measureRange = range.cloneRange();
        measureRange.selectNodeContents(el);
        measureRange.setEnd(range.startContainer, range.startOffset);
        const plainOffset = measureRange.toString().length;

        if (!rich) {
            const full = el.textContent || '';
            return {
                before: full.slice(0, plainOffset),
                after: full.slice(plainOffset)
            };
        }

        const fullHtml = readFull();
        const fullPlain = stripRichText(fullHtml);
        if (plainOffset <= 0) {
            return { before: '', after: fullHtml };
        }
        if (plainOffset >= fullPlain.length) {
            return { before: fullHtml, after: '' };
        }

        const beforeRange = range.cloneRange();
        beforeRange.selectNodeContents(el);
        beforeRange.setEnd(range.startContainer, range.startOffset);

        const afterRange = range.cloneRange();
        afterRange.selectNodeContents(el);
        afterRange.setStart(range.endContainer, range.endOffset);

        const htmlFromFragment = (frag) => {
            const div = document.createElement('div');
            div.appendChild(frag);
            return div.innerHTML;
        };
        return {
            before: sanitizeRichHtml(linkifyPlainUrls(htmlFromFragment(beforeRange.cloneContents()))),
            after: sanitizeRichHtml(linkifyPlainUrls(htmlFromFragment(afterRange.cloneContents())))
        };
    },

    caretAtEdge(el, edge) {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return false;
        const probe = range.cloneRange();
        probe.selectNodeContents(el);
        if (edge === 'start') {
            probe.setEnd(range.startContainer, range.startOffset);
            return probe.toString().length === 0;
        }
        probe.setStart(range.endContainer, range.endOffset);
        return probe.toString().length === 0;
    },

    caretAtPlainEdge(el, edge) {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return false;

        const measureRange = range.cloneRange();
        measureRange.selectNodeContents(el);
        measureRange.setEnd(range.startContainer, range.startOffset);
        const plainOffset = measureRange.toString().length;

        const rich = el.classList.contains('rich-text--edit');
        const fullPlain = rich
            ? stripRichText(sanitizeRichHtml(linkifyPlainUrls(el.innerHTML)))
            : (el.textContent || '');

        if (edge === 'start') return plainOffset <= 0;
        return plainOffset >= fullPlain.length;
    },

    findAdjacentChecklistStepRow(row, direction) {
        if (!row) return null;
        let sibling = direction === 'next' ? row.nextElementSibling : row.previousElementSibling;
        while (sibling) {
            if (sibling.classList?.contains('step-row--display')) return sibling;
            sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
        }
        return null;
    },

    getAdjacentChecklistStep(item, row, direction) {
        const stepId = row?.dataset?.stepId;
        if (!stepId) return null;
        const steps = item.steps || [];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return null;
        if (direction === 'prev') {
            return idx > 0 ? steps[idx - 1] : null;
        }
        return idx < steps.length - 1 ? steps[idx + 1] : null;
    },

    focusInlineEdit(el, edge = 'end') {
        if (!el) return;
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(edge === 'start');
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    },

    setCaretAtPlainOffset(el, offset) {
        if (!el) return;
        el.focus();
        const target = Math.max(0, Number(offset) || 0);
        const range = document.createRange();
        const sel = window.getSelection();
        let remaining = target;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            const len = node.textContent.length;
            if (remaining <= len) {
                range.setStart(node, remaining);
                range.collapse(true);
                sel?.removeAllRanges();
                sel?.addRange(range);
                return;
            }
            remaining -= len;
            node = walker.nextNode();
        }
        range.selectNodeContents(el);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
    },

    scheduleChecklistStepFocus(root, stepId, { edge = 'start', plainOffset = null } = {}) {
        const host = root.closest('.mini-card') || root;
        host.dataset.pendingFocusStepId = stepId;
        host.dataset.pendingFocusEdge = edge;
        if (plainOffset != null) {
            host.dataset.pendingFocusPlainOffset = String(plainOffset);
        } else {
            delete host.dataset.pendingFocusPlainOffset;
        }
    },

    getInlineEditSequence(root) {
        const fields = [];
        const title = root.querySelector('[data-field="title"].card-inline-edit');
        const content = root.querySelector('[data-field="content"].card-inline-edit');
        if (title) fields.push(title);
        if (content) fields.push(content);
        root.querySelectorAll('[data-field="step-text"].card-inline-edit').forEach((el) => fields.push(el));
        return fields;
    },

    handleInlineEditArrowNav(e, root, fieldEl) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
        const sequenceRoot = fieldEl.closest('.editor-note-shell') || root;
        const fields = this.getInlineEditSequence(sequenceRoot);
        const idx = fields.indexOf(fieldEl);
        if (idx < 0) return false;

        if (e.key === 'ArrowDown' && this.caretAtEdge(fieldEl, 'end') && idx < fields.length - 1) {
            e.preventDefault();
            this.focusInlineEdit(fields[idx + 1], 'start');
            return true;
        }
        if (e.key === 'ArrowUp' && this.caretAtEdge(fieldEl, 'start') && idx > 0) {
            e.preventDefault();
            this.focusInlineEdit(fields[idx - 1], 'end');
            return true;
        }
        return false;
    },

    insertChecklistStep(root, item, refresh, applyMutate, { afterStepId = null, initialText = '' } = {}) {
        const newStep = this.createBlankChecklistStep();
        newStep.text = initialText ?? '';
        applyMutate((it) => {
            if (it.type !== 'checklist') it.type = 'checklist';
            if (!it.steps) it.steps = [];
            if (afterStepId) {
                const idx = it.steps.findIndex((s) => s.id === afterStepId);
                if (idx >= 0) {
                    newStep.level = getStepLevel(it.steps[idx]);
                    it.steps.splice(idx + 1, 0, newStep);
                } else {
                    it.steps.push(newStep);
                }
            } else {
                it.steps.push(newStep);
            }
            reorderStepsByCompletion(it.steps);
        }, { persist: false });

        const host = root.closest('.mini-card') || root;
        this.scheduleChecklistStepFocus(root, newStep.id, { edge: 'start' });
        refresh();
        this.focusPendingChecklistStep(host);
    },

    focusPendingChecklistStep(root) {
        const focusNewStep = () => {
            const pendingId = root.dataset.pendingFocusStepId;
            if (!pendingId) return false;
            const newEl = root.querySelector(
                `[data-field="step-text"].card-inline-edit[data-step-id="${pendingId}"]`
            );
            if (!newEl) return false;
            const edge = root.dataset.pendingFocusEdge || 'start';
            const plainOffset = root.dataset.pendingFocusPlainOffset;
            delete root.dataset.pendingFocusStepId;
            delete root.dataset.pendingFocusEdge;
            delete root.dataset.pendingFocusPlainOffset;
            if (plainOffset != null && plainOffset !== '') {
                this.setCaretAtPlainOffset(newEl, Number(plainOffset));
            } else {
                this.focusInlineEdit(newEl, edge);
            }
            return true;
        };

        requestAnimationFrame(() => {
            if (!focusNewStep()) requestAnimationFrame(() => focusNewStep());
        });
    },

    removeChecklistStepAndFocus(root, item, refresh, applyMutate, {
        stepId,
        focusStepId,
        focusEdge = 'start',
        plainOffset = null
    } = {}) {
        applyMutate((it) => {
            it.steps = (it.steps || []).filter((s) => s.id !== stepId);
            if (!it.steps.length) it.type = 'note';
        }, { persist: false });
        this.scheduleChecklistStepFocus(root, focusStepId, { edge: focusEdge, plainOffset });
        refresh();
        this.focusPendingChecklistStep(root.closest('.mini-card') || root);
    },

    handleChecklistBackspace(root, item, el, refresh, { applyMutate, localOnly = false } = {}) {
        const sel = window.getSelection();
        if (!sel?.isCollapsed) return false;
        if (!this.caretAtPlainEdge(el, 'start')) return false;

        el.dataset.skipBlurSave = '1';
        this.syncInlineFieldToItem(el, item);
        const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);

        const stepId = el.dataset.stepId;
        const steps = item.steps || [];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return false;

        const current = steps[idx];
        const empty = !stripRichText(current.text || '').trim();
        const row = el.closest('.step-row--display');

        if (empty) {
            if (steps.length <= 1) return true;
            const prevRow = this.findAdjacentChecklistStepRow(row, 'prev');
            const nextRow = this.findAdjacentChecklistStepRow(row, 'next');
            const focusStepId = prevRow?.dataset.stepId || nextRow?.dataset.stepId;
            if (!focusStepId) return true;
            this.removeChecklistStepAndFocus(root, item, refresh, applyMutate, {
                stepId,
                focusStepId,
                focusEdge: prevRow ? 'end' : 'start'
            });
            this.commitInlineChecklistOp(item, beforeItem, { localOnly });
            return true;
        }

        const prev = this.getAdjacentChecklistStep(item, row, 'prev');
        if (!prev || prev.completed !== current.completed) return false;

        const joinAt = stripRichText(prev.text || '').length;
        const merged = `${prev.text || ''}${current.text || ''}`;
        const rich = el.classList.contains('rich-text--edit');

        applyMutate((it) => {
            const p = it.steps?.find((s) => s.id === prev.id);
            const c = it.steps?.find((s) => s.id === stepId);
            if (!p || !c) return;
            p.text = rich ? sanitizeRichHtml(linkifyPlainUrls(merged)) : merged;
            it.steps = it.steps.filter((s) => s.id !== stepId);
        }, { persist: false });

        this.scheduleChecklistStepFocus(root, prev.id, { plainOffset: joinAt });
        refresh();
        this.focusPendingChecklistStep(root.closest('.mini-card') || root);
        this.commitInlineChecklistOp(item, beforeItem, { localOnly });
        return true;
    },

    handleChecklistDelete(root, item, el, refresh, { applyMutate, localOnly = false } = {}) {
        const sel = window.getSelection();
        if (!sel?.isCollapsed) return false;
        if (!this.caretAtPlainEdge(el, 'end')) return false;

        el.dataset.skipBlurSave = '1';
        this.syncInlineFieldToItem(el, item);
        const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);

        const stepId = el.dataset.stepId;
        const steps = item.steps || [];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return false;

        const current = steps[idx];
        const row = el.closest('.step-row--display');
        const next = this.getAdjacentChecklistStep(item, row, 'next');
        if (!next || next.completed !== current.completed) return false;

        const nextEmpty = !stripRichText(next.text || '').trim();
        const rich = el.classList.contains('rich-text--edit');

        if (nextEmpty) {
            applyMutate((it) => {
                it.steps = (it.steps || []).filter((s) => s.id !== next.id);
            }, { persist: false });
            this.scheduleChecklistStepFocus(root, stepId, { edge: 'end' });
            refresh();
            this.focusPendingChecklistStep(root.closest('.mini-card') || root);
            this.commitInlineChecklistOp(item, beforeItem, { localOnly });
            return true;
        }

        const joinAt = stripRichText(current.text || '').length;
        const merged = `${current.text || ''}${next.text || ''}`;

        applyMutate((it) => {
            const cur = it.steps?.find((s) => s.id === stepId);
            if (!cur) return;
            cur.text = rich ? sanitizeRichHtml(linkifyPlainUrls(merged)) : merged;
            it.steps = it.steps.filter((s) => s.id !== next.id);
        }, { persist: false });

        this.scheduleChecklistStepFocus(root, stepId, { plainOffset: joinAt });
        refresh();
        this.focusPendingChecklistStep(root.closest('.mini-card') || root);
        this.commitInlineChecklistOp(item, beforeItem, { localOnly });
        return true;
    },

    handleChecklistEnter(root, item, el, refresh, { applyMutate, localOnly = false } = {}) {
        el.dataset.skipBlurSave = '1';
        const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
        const stepId = el.dataset.stepId;
        const { before, after } = this.splitInlineEditAtCaret(el);
        applyMutate((it) => {
            const step = it.steps?.find((s) => s.id === stepId);
            if (step) step.text = before ?? '';
        }, { persist: false });
        this.insertChecklistStep(root, item, refresh, applyMutate, {
            afterStepId: stepId,
            initialText: after
        });
        this.commitInlineChecklistOp(item, beforeItem, { localOnly });
    },

    attachNoteBodyInteractions(root, item, {
        refresh = () => {},
        localOnly = false,
        onChange = () => {},
        stopMousedownPropagation = false,
        richEdit = false
    } = {}) {
        const applyMutate = (mutator, { persist = !localOnly } = {}) => {
            if (persist) {
                this.mutateItem(item, mutator, { preserveView: true, skipRerender: true, localOnly });
                if (localOnly) onChange();
            } else {
                mutator(item);
            }
        };

        if (this.canEditInline() || localOnly) {
            if (!root.dataset.noteInteractionsBound) {
                root.dataset.noteInteractionsBound = '1';
                root.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    const active = document.activeElement;
                    if (!active?.classList?.contains('card-inline-edit') || !root.contains(active)) return;
                    if (active === e.target || active.contains(e.target)) return;
                    applyMutate(() => this.syncInlineFieldToItem(active, item));
                    active.dataset.skipBlurSave = '1';
                }, true);
            }

            root.querySelectorAll('.card-inline-edit').forEach((el) => {
                el.addEventListener('click', (e) => {
                    if (this.tryOpenRichEditLink(e, el)) return;
                    e.stopPropagation();
                    if (document.activeElement !== el) {
                        this.focusInlineEdit(el, 'end');
                    }
                });
                el.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    if (el.classList.contains('rich-text--edit') && e.target.closest('a[href]')) {
                        e.preventDefault();
                    }
                    if (stopMousedownPropagation) {
                        e.stopPropagation();
                    }
                    if (document.activeElement !== el) {
                        this.focusInlineEdit(el, 'end');
                    }
                });
                el.addEventListener('focus', () => {
                    const card = root.closest('.mini-card');
                    if (isDesktopCard(card)) this.raiseDesktopCard(card);
                });
                if (el.classList.contains('rich-text--edit')) {
                    el.addEventListener('paste', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const beforePaste = this.prepareInlineOpSnapshot(root, item, localOnly);
                        const plain = e.clipboardData?.getData('text/plain') || '';
                        if (plain) {
                            document.execCommand('insertText', false, plain);
                        } else {
                            const html = e.clipboardData?.getData('text/html') || '';
                            if (html) document.execCommand('insertHTML', false, sanitizeRichHtml(html));
                        }
                        this.syncInlineFieldToItem(el, item);
                        this.commitInlineTextOp(item, beforePaste, { localOnly });
                        if (localOnly) onChange();
                    });
                }
                el.addEventListener('keydown', (e) => {
                    if (el.classList.contains('rich-text--edit')) {
                        const mod = e.ctrlKey || e.metaKey;
                        if (mod && e.key === 'b') {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('bold');
                            if (localOnly) onChange();
                            return;
                        }
                        if (mod && e.key === 'i') {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('italic');
                            if (localOnly) onChange();
                            return;
                        }
                        if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('strikeThrough');
                            if (localOnly) onChange();
                            return;
                        }
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (localOnly) {
                            document.execCommand('undo');
                        } else {
                            UndoManager.undo();
                        }
                        return;
                    }
                    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!localOnly) UndoManager.redo();
                        return;
                    }
                    if (el.dataset.field === 'content' && e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (el.classList.contains('rich-text--edit')) {
                            document.execCommand('insertLineBreak');
                        } else {
                            this.insertTextAtCaret(el, e.shiftKey ? SOFT_BREAK : '\n');
                        }
                        if (localOnly) onChange();
                        return;
                    }
                    if (el.dataset.field === 'step-text' && e.key === 'Enter') {
                        if (e.shiftKey) {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('insertLineBreak');
                            return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleChecklistEnter(root, item, el, refresh, { applyMutate, localOnly });
                        return;
                    }
                    if (el.dataset.field === 'step-text' && e.key === 'Backspace') {
                        if (this.handleChecklistBackspace(root, item, el, refresh, { applyMutate, localOnly })) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        return;
                    }
                    if (el.dataset.field === 'step-text' && e.key === 'Delete') {
                        if (this.handleChecklistDelete(root, item, el, refresh, { applyMutate, localOnly })) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        return;
                    }
                    if (!this.handleInlineEditArrowNav(e, root, el)) e.stopPropagation();
                });
                el.addEventListener('blur', () => {
                    if (el.dataset.skipBlurSave) {
                        delete el.dataset.skipBlurSave;
                        return;
                    }
                    applyMutate(() => this.syncInlineFieldToItem(el, item));
                });
            });
        }

        if (root.querySelector('.expanded-checklist') && !root.dataset.checklistInteractionsBound) {
            root.dataset.checklistInteractionsBound = '1';
            if (!item.steps) item.steps = [];

            root.querySelector('.expanded-checklist-add-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.insertChecklistStep(root, item, refresh, applyMutate);
            });

            root.querySelectorAll('.step-row--display').forEach((row) => {
                const checkbox = row.querySelector('.step-check');
                const stepId = row.dataset.stepId;
                checkbox?.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                });
                checkbox?.addEventListener('change', (e) => {
                    e.stopPropagation();
                    this.ensureChecklistStepFromRow(row, item);
                    const step = item.steps?.find((s) => s.id === stepId);
                    if (!step) return;
                    row.classList.add('step-row--animating');
                    applyMutate((it) => {
                        const s = it.steps.find((st) => st.id === stepId);
                        if (!s) return;
                        moveStepOnCompletionChange(it.steps, s, checkbox.checked);
                    });
                    refresh();
                });
            });

            root.querySelectorAll('.step-indent-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId) return;
                    this.ensureChecklistStepFromRow(row, item);
                    const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
                    applyMutate((it) => {
                        const activeSteps = it.steps.filter((step) => !step.completed);
                        const idx = activeSteps.findIndex((s) => s.id === stepId);
                        if (idx < 0) return;
                        if (getStepLevel(activeSteps[idx]) >= 4) return;
                        applySubtreeLevelDelta(activeSteps, idx, +1);
                        normalizeChecklistLevels(activeSteps);
                        const doneSteps = it.steps.filter((step) => step.completed);
                        it.steps = [...activeSteps, ...doneSteps];
                    }, { persist: false });
                    this.expandChecklistAncestorsForStep(item, stepId);
                    const host = root.closest('.mini-card') || root;
                    this.scheduleChecklistStepFocus(root, stepId, { edge: 'start' });
                    refresh();
                    this.focusPendingChecklistStep(host);
                    this.commitInlineChecklistOp(item, beforeItem, { localOnly });
                });
            });

            root.querySelectorAll('.step-outdent-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId) return;
                    this.ensureChecklistStepFromRow(row, item);
                    const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
                    applyMutate((it) => {
                        const activeSteps = it.steps.filter((step) => !step.completed);
                        const idx = activeSteps.findIndex((s) => s.id === stepId);
                        if (idx < 0) return;
                        if (getStepLevel(activeSteps[idx]) <= 0) return;
                        applySubtreeLevelDelta(activeSteps, idx, -1);
                        normalizeChecklistLevels(activeSteps);
                        const doneSteps = it.steps.filter((step) => step.completed);
                        it.steps = [...activeSteps, ...doneSteps];
                    }, { persist: false });
                    this.expandChecklistAncestorsForStep(item, stepId);
                    const host = root.closest('.mini-card') || root;
                    this.scheduleChecklistStepFocus(root, stepId, { edge: 'start' });
                    refresh();
                    this.focusPendingChecklistStep(host);
                    this.commitInlineChecklistOp(item, beforeItem, { localOnly });
                });
            });

            root.querySelectorAll('.step-collapse-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const key = btn.dataset.collapseKey;
                    if (!key) return;
                    const collapsed = this.getChecklistCollapsedKeys();
                    collapsed[key] = !collapsed[key];
                    if (!collapsed[key]) delete collapsed[key];
                    localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
                    refresh();
                });
            });

            root.querySelectorAll('.checklist-done-toggle').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleChecklistDoneSection(item.id);
                    refresh();
                });
            });

            root.querySelector('.checklist-expand-collapse-all-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleChecklistExpandCollapseAll(item);
                refresh();
            });

            root.querySelectorAll('.step-delete-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId || !item.steps) return;
                    if (!item.steps.some((s) => s.id === stepId)) return;
                    applyMutate((it) => {
                        it.steps = it.steps.filter((s) => s.id !== stepId);
                        if (!it.steps.length) it.type = 'note';
                    }, { persist: false });
                    refresh();
                    this.commitInlineChecklistOp(item, beforeItem, { localOnly });
                });
            });

            root.querySelectorAll('.step-copy-btn').forEach((btn) => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const shell = root.closest('.editor-note-shell') || root;
                    this.syncItemBodyFromDom(shell, item);
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    const step = item.steps?.find((s) => s.id === stepId);
                    if (!step) return;
                    const ok = await this.copyPlainTextToClipboard(stepToPlainCopyLine(step));
                    if (ok) this.flashCopyFeedback(btn);
                    else this.flashCopyFeedback(btn, 'Copy failed', { failed: true });
                });
            });

            if (this.canEditInline() || localOnly) {
                this.attachChecklistDrag(root, item, applyMutate, refresh, localOnly);
            }
        }
    },

    attachChecklistDrag(root, item, applyMutate, refresh, localOnly = false) {
        if (!root.querySelector('.expanded-checklist')) return;
        if (root.dataset.checklistDragBound) return;
        root.dataset.checklistDragBound = '1';

        const DRAG_THRESHOLD = 4;
        let activeDrag = null;

        const getList = () => root.querySelector('.expanded-checklist');
        const getActiveRows = () => [...(getList()?.querySelectorAll('.step-row--display:not(.step-row--done)') || [])];

        const getDoneAnchor = (activeList) => activeList.querySelector('.checklist-done-toggle')
            || activeList.querySelector('.checklist-done-section')
            || activeList.querySelector('.step-row--done');

        const buildDomBlockFromIds = (rows, ids) => {
            const idSet = new Set(ids);
            return rows.filter((row) => idSet.has(row.dataset.stepId));
        };

        const syncDomBlock = () => {
            if (!activeDrag) return;
            const rows = getActiveRows();
            activeDrag.block = buildDomBlockFromIds(rows, activeDrag.blockStepIds);
        };

        const updateDropIndicator = (activeList, ref, { mode, targetLevel = 0 } = {}) => {
            let indicator = activeList.querySelector('.checklist-drop-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'checklist-drop-indicator';
                indicator.setAttribute('aria-hidden', 'true');
                activeList.appendChild(indicator);
            }
            if (!ref) {
                indicator.classList.remove('is-visible');
                indicator.style.marginLeft = '';
                return;
            }
            indicator.classList.add('is-visible');
            indicator.style.marginLeft = `${targetLevel * 0.45}rem`;
            activeList.insertBefore(indicator, ref);
        };

        const hideDropIndicator = () => {
            const indicator = getList()?.querySelector('.checklist-drop-indicator');
            if (!indicator) return;
            indicator.classList.remove('is-visible');
            indicator.style.marginLeft = '';
        };

        const reorderAt = (clientY) => {
            const block = activeDrag?.block;
            const activeList = getList();
            if (!block?.length || !activeList?.contains(block[0])) return;

            const allRows = getActiveRows();
            const { insertIndex, dropMode, others, targetLevel } = resolvePointerDropTarget(
                clientY,
                allRows,
                block,
                { bounds: activeDrag.bounds, isSingleLeaf: activeDrag.isSingleLeaf }
            );
            activeDrag.dropMode = dropMode;
            activeDrag.insertIndex = insertIndex;
            activeDrag.targetLevel = targetLevel;

            const ref = others[insertIndex] || getDoneAnchor(activeList);
            block.forEach((node) => {
                activeList.insertBefore(node, ref);
            });
            updateDropIndicator(activeList, ref, { mode: dropMode, targetLevel });
        };

        const finishDrag = () => {
            if (!activeDrag) return;
            const { block, moved, blockStepIds, dropMode } = activeDrag;
            const blockRootId = blockStepIds[0];
            block.forEach((r) => r.classList.remove('is-dragging'));
            hideDropIndicator();
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (moved) {
                const shell = root.closest('.editor-note-shell') || root;
                this.syncItemBodyFromDom(shell, item);
                const collapsedKeys = this.getChecklistCollapsedKeys();
                const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
                let parentIdToExpand = null;
                applyMutate((it) => {
                    const activeSteps = it.steps.filter((step) => !step.completed);
                    const doneSteps = it.steps.filter((step) => step.completed);
                    const visibleOrderIds = getActiveRows().map((r) => r.dataset.stepId);
                    const reordered = reorderActiveStepsFromDomOrder(
                        activeSteps,
                        visibleOrderIds,
                        item.id,
                        collapsedKeys
                    );
                    const dropResult = resolveDropTarget(reordered, blockRootId, { mode: dropMode || 'sibling' });
                    parentIdToExpand = dropResult?.parentId || null;
                    normalizeChecklistLevels(reordered);
                    it.steps = [...reordered, ...doneSteps];
                }, { persist: false });
                this.expandChecklistAncestorsForStep(item, blockRootId);
                if (parentIdToExpand) {
                    this.expandChecklistAncestorsForStep(item, parentIdToExpand);
                }
                refresh();
                this.commitInlineChecklistOp(item, beforeItem, { localOnly });
            }
            activeDrag = null;
        };

        const onMove = (e) => {
            if (!activeDrag) return;
            if (!activeDrag.moved) {
                const dx = Math.abs(e.clientX - activeDrag.startX);
                const dy = Math.abs(e.clientY - activeDrag.startY);
                if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
                activeDrag.moved = true;
                syncDomBlock();
                activeDrag.block.forEach((r) => r.classList.add('is-dragging'));
            }
            e.preventDefault();
            syncDomBlock();
            reorderAt(e.clientY);
        };

        const onUp = () => finishDrag();

        root.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const handle = e.target.closest('.grab-handle--step');
            if (!handle || !root.contains(handle)) return;
            const row = handle.closest('.step-row--display:not(.step-row--done)');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();

            const stepId = row.dataset.stepId;
            const activeSteps = (item.steps || []).filter((step) => !step.completed);
            const stepIndex = activeSteps.findIndex((step) => step.id === stepId);
            if (stepIndex < 0) return;

            const visibleIds = getActiveRows().map((r) => r.dataset.stepId);
            const { subtreeIds, minAmongOthers, maxAmongOthers } = computeVisibleInsertBounds(
                activeSteps,
                stepIndex,
                visibleIds
            );
            const isSingleLeaf = subtreeIds.length === 1
                || !stepHasDescendants(activeSteps, stepIndex);
            const rows = getActiveRows();
            const block = buildDomBlockFromIds(rows, subtreeIds);
            const othersCount = visibleIds.filter((id) => !subtreeIds.includes(id)).length;

            activeDrag = {
                row,
                block,
                blockStepIds: subtreeIds,
                isSingleLeaf,
                bounds: isSingleLeaf
                    ? { minAmongOthers: 0, maxAmongOthers: othersCount }
                    : { minAmongOthers, maxAmongOthers },
                dropMode: 'sibling',
                insertIndex: 0,
                targetLevel: 0,
                startX: e.clientX,
                startY: e.clientY,
                moved: false
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }, true);
    },

    getChecklistCollapsedKeys() {
        try {
            return JSON.parse(localStorage.getItem('matrix_checklist_collapsed') || '{}');
        } catch {
            return {};
        }
    },

    getChecklistDoneCollapsed() {
        try {
            return JSON.parse(localStorage.getItem('matrix_checklist_done_collapsed') || '{}');
        } catch {
            return {};
        }
    },

    isChecklistDoneSectionCollapsed(itemId) {
        return !!this.getChecklistDoneCollapsed()[itemId];
    },

    toggleChecklistDoneSection(itemId) {
        const collapsed = this.getChecklistDoneCollapsed();
        collapsed[itemId] = !collapsed[itemId];
        if (!collapsed[itemId]) delete collapsed[itemId];
        localStorage.setItem('matrix_checklist_done_collapsed', JSON.stringify(collapsed));
    },

    getChecklistCollapsibleKeys(item) {
        if (!item?.id) return [];
        const { active } = partitionChecklistSteps(item.steps || []);
        const keys = [];
        active.forEach((step, index) => {
            if (!stepHasDescendants(active, index)) return;
            keys.push(`${item.id}:${step.id}`);
        });
        return keys;
    },

    checklistGroupsAnyExpanded(item) {
        const collapsed = this.getChecklistCollapsedKeys();
        return this.getChecklistCollapsibleKeys(item).some((key) => !collapsed[key]);
    },

    collapseAllChecklistGroups(item) {
        const collapsed = this.getChecklistCollapsedKeys();
        this.getChecklistCollapsibleKeys(item).forEach((key) => {
            collapsed[key] = true;
        });
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
    },

    expandAllChecklistGroups(item) {
        const collapsed = this.getChecklistCollapsedKeys();
        this.getChecklistCollapsibleKeys(item).forEach((key) => {
            delete collapsed[key];
        });
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
    },

    toggleChecklistExpandCollapseAll(item) {
        if (this.checklistGroupsAnyExpanded(item)) {
            this.collapseAllChecklistGroups(item);
        } else {
            this.expandAllChecklistGroups(item);
        }
    },

    buildChecklistExpandCollapseAllHtml(item) {
        if (!item?.id || !checklistHasIndentations(item.steps)) return '';
        if (this.getChecklistCollapsibleKeys(item).length === 0) return '';
        const anyExpanded = this.checklistGroupsAnyExpanded(item);
        const label = anyExpanded ? 'Collapse all checklist groups' : 'Expand all checklist groups';
        const icon = anyExpanded ? ACTION_ICONS.collapseAll : ACTION_ICONS.expandAll;
        return `<div class="checklist-toolbar">
            <button type="button" class="card-act checklist-expand-collapse-all-btn" title="${this.escapeAttr(label)}" aria-label="${this.escapeAttr(label)}">${icon}</button>
        </div>`;
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

    updateBoardCanvasMinHeight(canvas) {
        this.updateBoardCanvasExtents(canvas);
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
        const maxCellsW = Math.max(1, this.spanToCellsW(packW || canvasGridW));

        if (isCollapsedSpatialSize(w, h)) {
            const small = getSmallRect(footprint);
            let wCells = Math.max(1, this.spanToCellsW(Math.max(minW, small.w)));
            wCells = Math.min(wCells, maxCellsW);
            return {
                w: this.cellsToSpanW(wCells),
                h: small.h
            };
        }

        let wCells = Math.max(1, this.spanToCellsW(Math.max(minW, w)));
        let hCells = Math.max(1, this.spanToCellsH(Math.max(minH, h)));
        wCells = Math.min(wCells, maxCellsW);
        return {
            w: this.cellsToSpanW(wCells),
            h: this.cellsToSpanH(hCells)
        };
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
        let candidate = snapRect({ ...rect, x: rect.x + metrics.strideX });
        if (candidate.x + candidate.w <= origin + pad + packW + 1
            && !placed.some((p) => this.rectsOverlap(candidate, p))) {
            return candidate;
        }
        const blocker = placed.find((p) => this.rectsOverlap(rect, p));
        if (blocker) {
            candidate = snapRect({
                x: rect.x,
                y: blocker.y - rect.h - COLUMN_GRID_GAP,
                w: rect.w,
                h: rect.h
            });
            if (candidate.y >= origin + pad - 1
                && !placed.some((p) => this.rectsOverlap(candidate, p))) {
                return candidate;
            }
            candidate = snapRect({
                x: rect.x,
                y: blocker.y + blocker.h + COLUMN_GRID_GAP,
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
        this.updateBoardCanvasExtents(canvas);
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
        return { origin, packW, viewportH, edgePad };
    },

    squeezeGridBoardToViewport(canvas, { animate = true, footprintPack = false } = {}) {
        if (!canvas?.classList.contains('view-grid')) return;
        const { origin, packW, viewportH, edgePad } = this.getGridViewportBounds(canvas);
        const { cellH } = getGridMetrics();
        const bottomLimit = origin + viewportH;
        const cards = [...canvas.querySelectorAll('.mini-card[data-desktop="1"]')];
        const pinnedIds = new Set(this.getBoardPins());
        const placed = [];
        const layout = new Map();
        const snapOpts = { packW, origin, edgePad, maxH: bottomLimit + cellH };

        const rectForSqueeze = (card, isExpanded) => {
            let rect = this.gridBoardRectForCard(card, this.readNoteRect(card), isExpanded);
            if (footprintPack && isCollapsedSpatialSize(rect.w, rect.h, resolveTileSize(this.resolveBoardItem(card?.dataset?.id)))) {
                const small = getSmallRect(readTileSmallFootprint());
                rect = { ...rect, w: small.w, h: small.h };
            }
            return rect;
        };

        cards.forEach((card) => {
            const id = card.dataset.id;
            if (!id || !pinnedIds.has(id)) return;
            const isExpanded = this.isSavedLayoutExpanded(id);
            const rect = this.snapNoteRect(
                rectForSqueeze(card, isExpanded),
                { maxW: packW, maxH: snapOpts.maxH, origin, edgePad }
            );
            layout.set(id, rect);
            placed.push({ ...rect });
        });

        const unpinned = cards
            .filter((card) => {
                const id = card.dataset.id;
                return id && !pinnedIds.has(id);
            })
            .map((card) => {
                const id = card.dataset.id;
                const isExpanded = this.isSavedLayoutExpanded(id);
                const rect = rectForSqueeze(card, isExpanded);
                return { id, card, rect };
            })
            .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

        unpinned.forEach(({ id, rect }) => {
            let preferred = { ...rect };
            if (preferred.y + preferred.h > bottomLimit + 2) {
                preferred = { ...preferred, y: origin + edgePad };
            }
            let snapped = this.snapNoteRect(preferred, { maxW: packW, maxH: snapOpts.maxH, origin, edgePad });
            if (placed.some((p) => this.rectsOverlap(snapped, p))) {
                snapped = this.findNearestGridSlot(preferred, snapped.w, snapped.h, placed, snapOpts);
            }
            if (placed.some((p) => this.rectsOverlap(snapped, p))) {
                snapped = this.pushGridCardRect(snapped, placed, snapOpts);
            }
            layout.set(id, snapped);
            placed.push({ ...snapped });
        });

        this.applyGridBoardLayout(canvas, layout, { animate, save: true });
        this.updateGridScrollPolicy(canvas, { forcing: false });
    },

    updateGridScrollPolicy(canvas, { forcing = false } = {}) {
        if (!canvas?.classList.contains('view-grid')) return;
        canvas.classList.toggle('is-grid-forcing', forcing);
        this.updateBoardCanvasExtents(canvas);
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
        this.squeezeGridBoardToViewport(canvas, { animate });
    },

    repackGridBoardFromOrigin(canvas, { animate = true, items = [] } = {}) {
        if (!canvas?.classList.contains('view-grid')) return;
        const { origin, packW, maxH } = this.getGridBoardBounds(canvas);
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
            let slot = this.findFirstCanvasSlot(small.w, small.h, placed, packW + origin * 2, { origin });
            slot = this.snapNoteRect(
                { ...slot, w: small.w, h: small.h },
                { maxW: packW, maxH, origin }
            );
            layout.set(id, slot);
            placed.push(slot);
        });
        this.applyGridBoardLayout(canvas, layout, { animate, save: true });
        this.squeezeGridBoardToViewport(canvas, { animate, footprintPack: true });
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
            if (this.canEditInline() && resolveTileSize(item) !== 'small') {
                this.mutateItem(item, (it) => { it.tileSize = 'small'; }, { preserveView: true, skipRerender: true });
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

    findFirstCanvasSlot(w, h, placed, canvasW, { origin = CANVAS_LAYOUT_ORIGIN, edgePad } = {}) {
        const metrics = getGridMetrics();
        const pad = edgePad ?? metrics.edgePad;
        const packW = Math.max(metrics.canvasGridW, canvasW - origin * 2 - pad * 2);
        const xOrigin = origin + pad;
        const yOrigin = origin + pad;
        const rowStride = metrics.strideX;
        const yStride = getPackStrideYForRect(w, h);
        let y = yOrigin;
        let guard = 0;
        while (guard < 800) {
            let x = xOrigin;
            while (x + w <= origin + pad + packW + 1) {
                const candidate = this.snapNoteRect({
                    x: this.snapCanvasCoord(x, origin, metrics.strideX),
                    y: this.snapCanvasCoord(y, origin, yStride),
                    w,
                    h
                }, { maxW: packW, origin, edgePad: pad });
                if (!placed.some((p) => this.rectsOverlap(candidate, p, metrics.gap))) {
                    return candidate;
                }
                x += rowStride;
            }
            y += yStride;
            guard += 1;
        }
        return { x: xOrigin, y: yOrigin, w, h };
    },

    snapGridCoord(value, stride) {
        const step = stride ?? getGridMetrics().strideX;
        return Math.max(0, Math.round(value / step) * step);
    },

    cellsToSpanW(cells) {
        return geoCellsToSpanW(cells);
    },

    cellsToSpanH(cells) {
        return geoCellsToSpanH(cells);
    },

    spanToCellsW(span) {
        return geoSpanToCellsW(span);
    },

    spanToCellsH(span) {
        return geoSpanToCellsH(span);
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
        const footprint = readTileSmallFootprint();
        const w = Math.max(FREEFORM_MIN_W, Math.round(rect.w));
        const h = Math.max(FREEFORM_MIN_H, Math.round(rect.h));
        const atSmall = isCollapsedSpatialSize(w, h);
        const yStride = atSmall ? getPackStrideYForRect(w, h, footprint) : metrics.strideY;
        let x = this.snapGridCoord(rect.x, metrics.strideX);
        let y = atSmall
            ? this.snapCanvasCoord(rect.y, origin, yStride)
            : this.snapGridCoord(rect.y, yStride);
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
            const yStride = getPackStrideYForRect(small.w, small.h, footprint);
            const snapped = {
                x: this.snapCanvasCoord(rect.x, origin, metrics.strideX),
                y: this.snapCanvasCoord(rect.y, origin, yStride),
                w: small.w,
                h: small.h
            };
            return this.snapNotePosition(snapped, { maxW, maxH, origin, edgePad: pad });
        }

        const wCells = Math.max(1, this.spanToCellsW(rect.w));
        const hCells = Math.max(1, this.spanToCellsH(rect.h));
        let w = this.cellsToSpanW(wCells);
        let h = this.cellsToSpanH(hCells);
        if (maxW < Infinity) {
            const maxCells = Math.max(1, this.spanToCellsW(maxW));
            w = this.cellsToSpanW(Math.min(wCells, maxCells));
        }
        if (maxH < Infinity) {
            const maxCells = Math.max(1, this.spanToCellsH(maxH));
            h = this.cellsToSpanH(Math.min(hCells, maxCells));
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
        const activelyResizing = this.isCardActivelyResizing(card);
        const footprint = readTileSmallFootprint();
        const small = getSmallRect(footprint);
        let w = hasInlineW ? styleW : null;
        let h = hasInlineH ? styleH : null;
        if (w == null) {
            const offsetW = card.offsetWidth || 0;
            if (card.classList?.contains('spatial-at-small') && !activelyResizing
                && !(offsetW > small.w + 2)) {
                w = small.w;
            } else {
                w = offsetW || FREEFORM_DEFAULT_W;
            }
        }
        if (h == null) {
            const offsetH = card.offsetHeight || 0;
            if (card.classList?.contains('spatial-at-small') && !activelyResizing
                && !(offsetH > small.h + 2)) {
                h = small.h;
            } else {
                h = offsetH || FREEFORM_DEFAULT_H;
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

    rectsOverlap(a, b, gap = COLUMN_GRID_GAP) {
        return !(
            a.x + a.w + gap <= b.x
            || b.x + b.w + gap <= a.x
            || a.y + a.h + gap <= b.y
            || b.y + b.h + gap <= a.y
        );
    },

    initFreeformCardStack(card, orderIndex = 0) {
        this.initDesktopCardStack(card, orderIndex);
    },

    raiseFreeformCard(card) {
        this.raiseDesktopCard(card);
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
    },

    escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    escapeAttr(str) {
        return this.escapeHTML(str).replace(/"/g, '&quot;');
    }
};
