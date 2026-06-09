import {
    categoryKey,
    isUncategorizedCategory,
    readStoredCategories,
    UNCATEGORIZED_CATEGORY
} from './categories.js';
import {
    applyFocusToCategories,
    applyFocusToItems,
    focusIncludesUncategorized
} from './focusFilter.js';
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
import { UndoManager } from './undo.js';
import {
    applyViewSessionsFromSnapshot,
    clearExpandedCards,
    clearViewSessionExpanded,
    getExpandedCards,
    getViewSessionsForSnapshot,
    persistViewSession,
    restoreViewSession,
    setExpandedCard,
    setExpandedCardsMap,
    setGridExpandedIdForMode
} from './viewSession.js';

const UNCATEGORIZED_COLOR = '#64748b';

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

export const FREEFORM_DEFAULT_W = 96;
export const FREEFORM_DEFAULT_H = 56;
export const FREEFORM_EXPANDED_W = 196;
export const FREEFORM_MIN_W = 72;
export const FREEFORM_MIN_H = 56;
export const FREEFORM_EXPANDED_DEFAULT_H = 120;

export const COLUMN_GRID_CELL_W = FREEFORM_DEFAULT_W;
export const COLUMN_GRID_CELL_H = FREEFORM_DEFAULT_H;
export const COLUMN_GRID_GAP = 4;
export const COLUMN_MIN_COLS = 2;
export const COLUMN_INNER_PAD = 8;
export const COLUMN_MIN_INNER_W = COLUMN_MIN_COLS * COLUMN_GRID_CELL_W + (COLUMN_MIN_COLS - 1) * COLUMN_GRID_GAP;
export const COLUMN_HEADER_APPROX_H = 40;
export const COLUMN_MIN_CANVAS_H = COLUMN_HEADER_APPROX_H + COLUMN_INNER_PAD + COLUMN_GRID_CELL_H;
export const CANVAS_COL_GAP = 8;
export const CANVAS_GRID_W = COLUMN_MIN_INNER_W + COLUMN_INNER_PAD * 2;
export const COLUMN_STRIDE_X = COLUMN_GRID_CELL_W + COLUMN_GRID_GAP;
export const COLUMN_STRIDE_Y = COLUMN_GRID_CELL_H + COLUMN_GRID_GAP;
export const CANVAS_LAYOUT_ORIGIN = 16;
export const CANVAS_PACK_GAP = COLUMN_GRID_GAP;
const CANVAS_LAYOUT_ORDER_KEY = 'matrix_canvas_layout_order';
const GRID_LAYOUT_KEY = 'matrix_grid_layout';
const GRID_PINS_KEY = 'matrix_grid_pins';
const GRID_EXPANDED_KEY = 'matrix_grid_expanded_id';
const CARD_ANIM_MS = 300;
const CARD_COMPACT_H = 56;

const cardAnimSessions = new WeakMap();

export function cardAnimationsEnabled() {
    return document.documentElement.dataset.cardAnimations !== '0';
}

let freeformStackSeq = 1;
let gridStackSeq = 1;
let boardItemsById = new Map();
let activeBoardViewMode = 'columns';

// Chrome icon trope: stroke-first, currentColor, fill="none" on paths/shapes (see ACTION_ICONS).
// CARD_ICONS 11×12; ACTION_ICONS 12×12. Minimal fills only when semantically needed (e.g. focusMode dot).

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
    drag: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><circle cx="4.4" cy="3.1" r="0.85" fill="currentColor"/><circle cx="7.6" cy="3.1" r="0.85" fill="currentColor"/><circle cx="4.4" cy="6" r="0.85" fill="currentColor"/><circle cx="7.6" cy="6" r="0.85" fill="currentColor"/><circle cx="4.4" cy="8.9" r="0.85" fill="currentColor"/><circle cx="7.6" cy="8.9" r="0.85" fill="currentColor"/></svg>'
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
    viewList: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.2 3.2h7.6M2.2 6h7.6M2.2 8.8h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    viewCols: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.6" y="2.2" width="3.6" height="7.6" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.8" y="2.2" width="3.6" height="7.6" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.95"/></svg>',
    viewFree: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.5" y="2" width="3.2" height="2.6" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="7.3" y="2" width="3.2" height="3.8" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="2.8" y="7.2" width="4.4" height="2.8" rx="0.4" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    viewGrid: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="1.6" width="3.8" height="3.8" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><rect x="6.8" y="1.6" width="3.8" height="3.8" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/><rect x="1.4" y="6.6" width="8.2" height="3.8" rx="0.35" fill="none" stroke="currentColor" stroke-width="0.85"/></svg>',
    category: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="1.4" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.7" y="1.4" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="1.4" y="6.7" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/><rect x="6.7" y="6.7" width="3.9" height="3.9" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.95"/></svg>',
    export: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.6v5.8M3.7 5.1 6 7.4 8.3 5.1" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.4h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    exportCode: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 1.3 7.6 6.8 6 5.9 4.4 6.8Z" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linejoin="round"/><circle cx="6" cy="4.1" r="0.75" fill="none" stroke="currentColor" stroke-width="0.8"/><path d="M4.4 6.8 3.4 8.8M7.6 6.8 8.6 8.8" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/><path d="M5.3 7.4 6 9.4 6.7 7.4" fill="none" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    import: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 10.4V4.6M3.7 6.9 6 4.6 8.3 6.9" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.2 10.4h7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>',
    logout: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M4.6 2.1H3.1v7.8h1.5" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/><path d="M6.8 6 10 6M10 6 8.4 4.4M10 6 8.4 7.6" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    undo: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M3.4 5.6H7.2a2.4 2.4 0 1 1 0 4.8H6.6M3.4 5.6 5.1 3.9M3.4 5.6 5.1 7.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    redo: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M8.6 5.6H4.8a2.4 2.4 0 0 0 0 4.8h.6M8.6 5.6 6.9 3.9M8.6 5.6 6.9 7.3" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sortAlpha: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><path d="M1.8 3.2h3.4M1.8 8.4h3.4M1.8 3.2l3.4 5.2" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/><path d="M8.4 3v6M7.5 4.1l0.9-1.1 0.9 1.1M7.5 7.9l0.9 1.1 0.9-1.1" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    sortDate: '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false"><circle cx="4.8" cy="6" r="3.1" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M4.8 4.4V6l1.3 0.9" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.2 3v6M8.3 4.1l0.9-1.1 0.9 1.1M8.3 7.9l0.9 1.1 0.9-1.1" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    desktopBg: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.4" y="2.2" width="9.2" height="6.8" rx="0.7" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M2.2 8.4h7.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/><circle cx="4.1" cy="5.4" r="1.1" fill="currentColor" opacity="0.85"/><circle cx="6.6" cy="4.6" r="0.85" fill="currentColor" opacity="0.65"/><circle cx="8.1" cy="6.2" r="0.75" fill="currentColor" opacity="0.5"/></svg>',
    chromeBg: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><rect x="1.3" y="1.8" width="3.6" height="8.4" rx="0.5" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="5.5" y="1.8" width="5.2" height="2.4" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.9"/><rect x="5.5" y="5" width="5.2" height="5.2" rx="0.45" fill="none" stroke="currentColor" stroke-width="0.9"/></svg>',
    clockStyle: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="0.9"/><path d="M6 3.2V6l2 1.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    saveView: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.8 2.4h6.4v7.2L6 7.6 2.8 9.6V2.4z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M6 5.2v2.8" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    recallView: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M2.8 2.2h6.4v7.4L6 7.6 2.8 9.6V2.2z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M6 5.2v2.8" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    focusMode: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><circle cx="6" cy="6" r="1.6" fill="currentColor"/></svg>',
    displayOptions: paletteIconSvg(12),
    appTheme: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><circle cx="3.6" cy="4.2" r="1.5" fill="currentColor" opacity="0.9"/><circle cx="6.8" cy="3.4" r="1.5" fill="currentColor" opacity="0.65"/><circle cx="8.4" cy="6.8" r="1.5" fill="currentColor" opacity="0.45"/><path d="M1.4 10.2h9.2" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/></svg>',
    resetCustomization: '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false"><path d="M6 2.2a3.6 3.6 0 1 0 2.3 6.4L7.2 9.8" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.1 7.4 7.2 9.5 9.3 7.4" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>'
};

const SAVED_VIEWS_KEY = 'matrix_saved_views';
const SAVED_VIEWS_SLOTS = 3;

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
        startDateTime
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

export function reorderActiveStepsPreservingSubtrees(activeSteps, visibleRootIdsInOrder) {
    const used = new Set();
    const result = [];

    const appendSubtree = (stepId) => {
        const idx = activeSteps.findIndex((s) => s.id === stepId);
        if (idx < 0) return;
        for (const step of collectStepSubtree(activeSteps, idx)) {
            if (used.has(step.id)) continue;
            result.push(step);
            used.add(step.id);
        }
    };

    for (const id of visibleRootIdsInOrder) {
        appendSubtree(id);
    }

    for (const step of activeSteps) {
        if (!used.has(step.id)) result.push(step);
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

    captureScrollState(canvas) {
        if (!canvas) return null;
        return {
            canvasScrollTop: canvas.scrollTop,
            cardBodies: [...canvas.querySelectorAll('.mini-card[data-id]')].map((card) => ({
                id: card.dataset.id,
                scrollTop: (card.querySelector('.editor-note-body') || card.querySelector('.card-body'))?.scrollTop ?? 0
            }))
        };
    },

    restoreScrollState(canvas, state) {
        if (!canvas || !state) return;
        canvas.scrollTop = state.canvasScrollTop ?? 0;
        state.cardBodies?.forEach(({ id, scrollTop }) => {
            const card = canvas.querySelector(`.mini-card[data-id="${id}"]`);
            const body = card?.querySelector('.editor-note-body') || card?.querySelector('.card-body');
            if (body) body.scrollTop = scrollTop;
        });
    },

    getActiveBoardViewMode() {
        return activeBoardViewMode;
    },

    persistViewSessionForMode(mode, canvas = document.getElementById('app-canvas')) {
        persistViewSession(mode, {
            canvas,
            flushLayout: (c, m) => this.flushLayoutFromCanvas(c, m),
            captureScroll: (c) => this.captureScrollState(c)
        });
    },

    restoreViewSessionForMode(mode) {
        return restoreViewSession(mode);
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
        if (card?.dataset?.gridBoard === '1') {
            return this.isGridBoardCardExpanded(item?.id, card);
        }
        if (card?.classList.contains('expanded')) return true;
        return getExpandedCards(activeBoardViewMode)[item?.id] === true;
    },

    resolveBoardItem(itemId) {
        if (!itemId) return null;
        return boardItemsById.get(itemId) || null;
    },

    getGridExpandedId() {
        try {
            const id = localStorage.getItem(GRID_EXPANDED_KEY);
            return id && id !== 'null' ? id : null;
        } catch {
            return null;
        }
    },

    setGridExpandedId(itemId) {
        setGridExpandedIdForMode('grid', itemId);
    },

    isGridBoardCardExpanded(itemId, card = null) {
        if (!itemId) return false;
        if (getExpandedCards('grid')[itemId] === true) return true;
        if (this.getGridExpandedId() === itemId) return true;
        return !!card?.classList.contains('expanded');
    },

    isGridMultiCellSize(w, h) {
        return w > COLUMN_GRID_CELL_W + 2 || h > COLUMN_GRID_CELL_H + 2;
    },

    shouldSnapPanelExpand(w, h) {
        return w >= this.cellsToSpanW(2) && h >= this.cellsToSpanH(2);
    },

    shouldSnapPanelCollapse(w, h) {
        return w < this.cellsToSpanW(2) || h < this.cellsToSpanH(2);
    },

    collapseSnapPanelCard(card, item) {
        const activeCategories = readStoredCategories();
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);
        if (card.dataset.gridBoard === '1') {
            setExpandedCard('grid', item.id, false);
            if (this.getGridExpandedId() === item.id) this.setGridExpandedId(null);
        } else if (card.dataset.columnNote === '1') {
            setExpandedCard('columns', item.id, false);
        }
        this.cancelCardAnimation(card);
        card.classList.remove('expanded', 'card-state-changing', 'card-animating');
        card.classList.add('compact');
        this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor);
        if (card.dataset.gridBoard === '1') {
            this.finalizeGridBoardCard(card);
        } else if (card.dataset.columnNote === '1') {
            const cat = card.dataset.category || targetCatName;
            this.finalizeColumnNote(card, cat);
        }
    },

    gridBoardRectForCard(card, savedRect, isExpanded) {
        const base = savedRect && Number.isFinite(savedRect.x) && Number.isFinite(savedRect.w)
            ? { x: savedRect.x, y: savedRect.y, w: savedRect.w, h: savedRect.h }
            : this.readNoteRect(card);
        if (isExpanded) {
            if (base.w >= this.cellsToSpanW(2) && base.h >= this.cellsToSpanH(2)) return base;
            return {
                ...base,
                w: this.cellsToSpanW(2),
                h: this.cellsToSpanH(2)
            };
        }
        return this.gridCompactRect(base, savedRect);
    },

    columnNoteRectForCard(card, savedRect, isExpanded) {
        return this.gridBoardRectForCard(card, savedRect, isExpanded);
    },

    gridCompactRect(base, saved) {
        const source = saved && Number.isFinite(saved.w) ? saved : base;
        if (source?.customCompact && this.isGridMultiCellSize(source.w, source.h)) {
            return { ...base, w: source.w, h: source.h };
        }
        return {
            ...base,
            w: COLUMN_GRID_CELL_W,
            h: COLUMN_GRID_CELL_H
        };
    },

    syncCardDraggable(card) {
        const hasSession = !!localStorage.getItem('admin_token');
        const isFreeform = card.dataset.freeform === '1';
        const isGridBoard = card.dataset.gridBoard === '1';
        const isColumnLayout = card.dataset.columnNote === '1' || card.dataset.columnsFloat === '1';
        if (!hasSession || isFreeform || isGridBoard || isColumnLayout || card.classList.contains('expanded')) {
            card.removeAttribute('draggable');
            return;
        }
        card.setAttribute('draggable', 'true');
    },

    isGridBoardCard(card) {
        return card?.dataset?.gridBoard === '1';
    },

    freeformDragZoneClass(card) {
        if (card.dataset.columnNote === '1' || card.dataset.columnsFloat === '1') {
            return ' card-drag-zone';
        }
        return (card.dataset.freeform === '1' || card.dataset.gridBoard === '1') ? ' card-drag-zone' : '';
    },

    buildNoteSizeHtml(item) {
        const kb = computeNoteSizeKb(item);
        return `<span class="note-size" title="Note content size">${kb} KB</span>`;
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

    updateSingleCard(canvas, item, hiddenCategories = [], focusCategories = []) {
        if (!canvas || !item?.id) return false;
        const card = canvas.querySelector(`.mini-card[data-id="${item.id}"]`);
        if (!card) return false;

        const scrollState = this.captureScrollState(canvas);
        let activeCategories = readStoredCategories()
            .filter((cat) => !hiddenCategories.includes(cat.name));
        activeCategories = applyFocusToCategories(activeCategories, focusCategories);
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        if (card.classList.contains('expanded')) {
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
        } else {
            this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor);
        }
        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;

        if (card.dataset.columnNote === '1') {
            this.finalizeColumnNote(card, card.dataset.category || targetCatName);
            const notesEl = card.closest('.column-notes');
            if (notesEl) requestAnimationFrame(() => this.autoArrangeColumnNotes(notesEl, { animate: false }));
        } else if (card.dataset.columnsFloat === '1') {
            this.finalizeColumnsFloat(card);
        } else if (card.dataset.gridBoard === '1') {
            this.finalizeGridBoardCard(card);
        }

        this.restoreScrollState(canvas, scrollState);
        return true;
    },

    render(canvas, items, viewMode, hiddenCategories = [], focusCategories = []) {
        if (!canvas) return;
        const scrollState = this.captureScrollState(canvas);
        canvas.innerHTML = '';

        const safeItems = Array.isArray(items) ? items : [];
        let visibleItems = this.getVisibleItems(safeItems);
        const focusActive = Array.isArray(focusCategories) && focusCategories.length > 0;
        visibleItems = applyFocusToItems(visibleItems, focusCategories);
        boardItemsById = new Map(visibleItems.map((item) => [item.id, item]));

        let activeCategories = readStoredCategories();
        activeCategories = activeCategories.filter(cat => !hiddenCategories.includes(cat.name));
        activeCategories = applyFocusToCategories(activeCategories, focusCategories);

        const resolvedMode = viewMode === 'freeform'
            ? 'freeform'
            : viewMode === 'grid'
                ? 'grid'
                : 'columns';
        activeBoardViewMode = resolvedMode;
        canvas.className = resolvedMode === 'freeform'
            ? 'view-freeform'
            : resolvedMode === 'grid'
                ? 'view-grid'
                : 'view-columns';
        if (focusActive) canvas.dataset.focusActive = '1';
        else delete canvas.dataset.focusActive;

        if (visibleItems.length === 0) {
            const hiddenCount = safeItems.length - this.getVisibleItems(safeItems).length;
            if (focusActive && this.getVisibleItems(safeItems).length > 0) {
                canvas.innerHTML = `<div class="system-status-msg">Focus active — no notes in the selected categories on the desktop. Use the sidebar to open any note, or reset focus.</div>`;
            } else if (safeItems.length > 0 && hiddenCount === safeItems.length) {
                canvas.innerHTML = `<div class="system-status-msg">All objects are hidden. Use the footer to restore them.</div>`;
            } else {
                canvas.innerHTML = `<div class="system-status-msg">Workspace clean. Click "+ New" to commit an entity.</div>`;
            }
            return;
        }

        if (resolvedMode === 'columns') {
            this.migrateColumnsFloatLayouts();

            activeCategories.forEach(catObj => {
                const categoryName = typeof catObj === 'string' ? catObj : catObj.name;
                const catColor = catObj.color || '#64748b';

                const columnItems = visibleItems
                    .filter(item => {
                        if (!itemHasCategory(item)) return false;
                        return item.categories.some(cat => String(cat).toLowerCase() === String(categoryName).toLowerCase());
                    })
                    .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));

                canvas.appendChild(this.createColumnStructure(categoryName, catColor, columnItems, activeCategories));
            });

            const uncatItems = visibleItems
                .filter((item) => !itemHasCategory(item))
                .sort((a, b) => Number(a.created_at || 0) - Number(b.created_at || 0));
            const showUncategorizedColumn = focusActive
                ? focusIncludesUncategorized(focusCategories)
                : uncatItems.length > 0;
            if (showUncategorizedColumn) {
                canvas.appendChild(this.createColumnStructure(
                    UNCATEGORIZED_CATEGORY,
                    UNCATEGORIZED_COLOR,
                    uncatItems,
                    activeCategories
                ));
            }

            const columnsForOrder = [...activeCategories];
            if (showUncategorizedColumn) {
                columnsForOrder.push({ name: UNCATEGORIZED_CATEGORY, color: UNCATEGORIZED_COLOR });
            }
            this.syncCanvasLayoutOrder(columnsForOrder, visibleItems);
            this.layoutColumnView(canvas, { animate: false });
        } else if (resolvedMode === 'grid') {
            const layout = this.getGridLayout();
            const placed = [];
            const { origin, packW, maxH } = this.getGridBoardBounds(canvas);
            const gridExpandedId = this.getGridExpandedId();
            const gridExpandedMap = getExpandedCards('grid');

            [...visibleItems]
                .sort((a, b) => {
                    const aTime = Number(a.created_at || a.updated_at || 0);
                    const bTime = Number(b.created_at || b.updated_at || 0);
                    return aTime - bTime;
                })
                .forEach((item, index) => {
                    const card = this.createCardComponent(item, activeCategories, { gridBoard: true });
                    const isExpanded = gridExpandedMap[item.id] === true || gridExpandedId === item.id;
                    const saved = layout[item.id];
                    let rect;

                    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.w)) {
                        rect = this.snapNoteRect(
                            this.gridBoardRectForCard(card, saved, isExpanded),
                            { maxW: packW, maxH }
                        );
                    } else {
                        const w = isExpanded ? this.cellsToSpanW(2) : COLUMN_GRID_CELL_W;
                        const h = isExpanded ? this.cellsToSpanH(2) : COLUMN_GRID_CELL_H;
                        rect = this.findFirstCanvasSlot(w, h, placed, packW + origin * 2, { origin });
                    }

                    this.applyNoteRect(card, rect, { settling: false });
                    this.saveGridLayout(item.id, rect);
                    placed.push(rect);
                    this.finalizeGridBoardCard(card);
                    this.initGridBoardCardStack(card, index);
                    this.syncBoardPinClass(card);
                    card.removeAttribute('draggable');
                    canvas.appendChild(card);
                });

            this.updateGridCanvasMinHeight(canvas, placed, origin);
        } else if (resolvedMode === 'freeform') {
            const positions = this.getFreeformPositions();
            let autoX = 8;
            let autoY = 8;
            const cardStep = 104;
            const rowStep = 72;

            [...visibleItems]
                .sort((a, b) => {
                    const aTime = Number(a.created_at || a.updated_at || 0);
                    const bTime = Number(b.created_at || b.updated_at || 0);
                    return aTime - bTime;
                })
                .forEach((item, index) => {
                    const card = this.createCardComponent(item, activeCategories, { freeform: true });
                    const saved = positions[item.id];
                    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                        card.style.left = `${saved.x}px`;
                        card.style.top = `${saved.y}px`;
                    } else {
                        card.style.left = `${autoX}px`;
                        card.style.top = `${autoY}px`;
                        autoX += cardStep;
                        if (autoX > Math.max(canvas.clientWidth, 320) - cardStep) {
                            autoX = 8;
                            autoY += rowStep;
                        }
                    }
                    card.removeAttribute('draggable');
                    this.applyFreeformSize(card);
                    this.initFreeformCardStack(card, index);
                    this.syncBoardPinClass(card);
                    canvas.appendChild(card);
                });
        }

        this.restoreScrollState(canvas, scrollState);
    },

    createColumnStructure(categoryName, catColor, columnItems, activeCategories) {
        const colWrapper = document.createElement('div');
        colWrapper.classList.add('canvas-column');
        colWrapper.dataset.category = categoryName;
        colWrapper.style.borderTop = `3px solid ${catColor}`;

        const isCollapsed = this.isCategoryCollapsed(categoryName);
        if (isCollapsed) colWrapper.classList.add('is-collapsed');

        const hideControl = isUncategorizedCategory(categoryName)
            ? ''
            : '<span class="column-hide-btn" title="Hide this category">×</span>';
        colWrapper.innerHTML = `
            <div class="column-header" data-category="${this.escapeAttr(categoryName)}" style="color: ${catColor};">
                <span class="grab-handle grab-handle--col" title="Drag to reposition category">⋮⋮</span>
                <span class="column-title">${this.escapeHTML(categoryName)} (${columnItems.length})</span>
                <span class="column-header-actions">
                    <button type="button" class="column-resize-btn" title="Resize category" aria-label="Resize category" aria-pressed="false">${CARD_ICONS.resize}</button>
                    <button type="button" class="column-collapse-btn" title="${isCollapsed ? 'Expand category' : 'Collapse category'}" aria-label="${isCollapsed ? 'Expand category' : 'Collapse category'}">${isCollapsed ? '▶' : '▼'}</button>
                    ${hideControl}
                </span>
            </div>
        `;

        this.setupColumnResizeChrome(colWrapper);
        this.applySavedColumnSize(colWrapper);

        const resizeBtn = colWrapper.querySelector('.column-resize-btn');
        resizeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const active = colWrapper.classList.toggle('is-column-resize-active');
            resizeBtn.classList.toggle('active', active);
            resizeBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
            resizeBtn.title = active ? 'Done resizing' : 'Resize category';
            resizeBtn.setAttribute('aria-label', resizeBtn.title);
            document.getElementById('app-canvas')?.querySelectorAll('.canvas-column.is-column-resize-active').forEach((other) => {
                if (other === colWrapper) return;
                other.classList.remove('is-column-resize-active');
                const btn = other.querySelector('.column-resize-btn');
                if (btn) {
                    btn.classList.remove('active');
                    btn.setAttribute('aria-pressed', 'false');
                    btn.title = 'Resize category';
                    btn.setAttribute('aria-label', btn.title);
                }
            });
        });

        const collapseBtn = colWrapper.querySelector('.column-collapse-btn');
        collapseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const nowCollapsed = this.toggleCategoryCollapsed(categoryName);
            colWrapper.classList.toggle('is-collapsed', nowCollapsed);
            collapseBtn.textContent = nowCollapsed ? '▶' : '▼';
            collapseBtn.title = nowCollapsed ? 'Expand category' : 'Collapse category';
            collapseBtn.setAttribute('aria-label', collapseBtn.title);
            const notesEl = colWrapper.querySelector('.column-notes');
            if (!nowCollapsed && notesEl) {
                const itemIds = [...notesEl.querySelectorAll('.mini-card')]
                    .map((c) => c.dataset.id)
                    .filter(Boolean);
                this.autoPackColumnNotes(notesEl, itemIds, categoryName);
                this.autoArrangeColumnNotes(notesEl, { animate: true });
            } else {
                this.resizeColumnToFit(colWrapper, { animate: true });
            }
            const canvas = document.getElementById('app-canvas');
            if (canvas?.classList.contains('view-columns')) {
                this.reflowCanvasFromOrderEntry(
                    canvas,
                    { type: 'category', name: categoryName },
                    { animate: true }
                );
            }
        });

        const hideBtn = colWrapper.querySelector('.column-hide-btn');
        if (hideBtn) {
            hideBtn.addEventListener('mouseenter', () => { hideBtn.style.opacity = '1'; });
            hideBtn.addEventListener('mouseleave', () => { hideBtn.style.opacity = '0.6'; });
            hideBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                let currentHidden = JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]');
                if (!currentHidden.includes(categoryName)) {
                    currentHidden.push(categoryName);
                    localStorage.setItem('matrix_hidden_categories', JSON.stringify(currentHidden));
                    window.location.reload();
                }
            });
        }

        const notesHost = document.createElement('div');
        notesHost.className = 'column-notes';
        notesHost.dataset.category = categoryName;

        columnItems.forEach(item => {
            const card = this.createCardComponent(item, activeCategories, {
                columnNote: true,
                categoryName: isUncategorizedCategory(categoryName) ? '' : categoryName
            });
            this.finalizeColumnNote(card, categoryName);
            notesHost.appendChild(card);
        });

        if (!isCollapsed && columnItems.length === 0) {
            const slot = document.createElement('div');
            slot.className = 'column-empty-slot';
            slot.setAttribute('aria-hidden', 'true');
            notesHost.appendChild(slot);
        }

        colWrapper.appendChild(notesHost);
        if (!isCollapsed) {
            requestAnimationFrame(() => this.resizeColumnToFit(colWrapper, { animate: false }));
        }
        return colWrapper;
    },

    buildCategoryDragHandleHtml(card) {
        if (card?.dataset?.columnNote !== '1') return '';
        const loggedIn = !!localStorage.getItem('admin_token');
        const title = loggedIn ? 'Drag to another category' : 'Login to move between categories';
        return `<span class="grab-handle grab-handle--note-cat" draggable="${loggedIn ? 'true' : 'false'}" title="${this.escapeAttr(title)}" aria-label="${this.escapeAttr(title)}">⋮⋮</span>`;
    },

    migrateColumnsFloatLayouts() {
        let floatPos;
        let floatSizes;
        try {
            floatPos = JSON.parse(localStorage.getItem('matrix_columns_float_positions') || '{}');
            floatSizes = JSON.parse(localStorage.getItem('matrix_columns_float_sizes') || '{}');
        } catch {
            return;
        }
        const posIds = Object.keys(floatPos || {});
        const sizeIds = Object.keys(floatSizes || {});
        if (posIds.length === 0 && sizeIds.length === 0) return;

        const layout = this.getColumnNoteLayout();
        const cat = UNCATEGORIZED_CATEGORY;
        if (!layout[cat]) layout[cat] = {};
        const allIds = new Set([...posIds, ...sizeIds]);
        allIds.forEach((id) => {
            const pos = floatPos[id];
            const size = floatSizes[id];
            if (!layout[cat][id]) {
                layout[cat][id] = {
                    x: pos?.x ?? 0,
                    y: pos?.y ?? 0,
                    w: size?.w ?? FREEFORM_DEFAULT_W,
                    h: size?.h ?? FREEFORM_DEFAULT_H
                };
            }
        });
        localStorage.setItem('matrix_column_note_layout', JSON.stringify(layout));
        localStorage.removeItem('matrix_columns_float_positions');
        localStorage.removeItem('matrix_columns_float_sizes');
    },

    buildNoteQuickActionsHtml(item, {
        surface = 'board',
        isExpanded = false,
        pinned = false,
        showDrag = false,
        showArchive = false
    } = {}) {
        const isModal = surface === 'modal';
        const expandTitle = isModal
            ? 'Show on board'
            : (isExpanded ? 'Collapse note' : 'Expand note');
        const lastIcon = isModal || isExpanded ? CARD_ICONS.collapse : CARD_ICONS.expand;
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
            ${dragBtn}
            <button type="button" class="card-act card-act--copy" title="Copy note as text" aria-label="Copy note as text">${CARD_ICONS.copy}</button>
            ${pinBtn}
            <button type="button" class="card-act card-act--color" title="Note color" aria-label="Note color" aria-haspopup="dialog">${CARD_ICONS.color}</button>
            <button type="button" class="card-act card-act--hide" title="Hide from board" aria-label="Hide from board">${CARD_ICONS.hide}</button>
            <button type="button" class="card-act card-act--edit" title="Edit note" aria-label="Edit note">${CARD_ICONS.edit}</button>
            ${calBtn}
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
        const spatial = card?.dataset?.freeform === '1'
            || card?.dataset?.gridBoard === '1'
            || card?.dataset?.columnNote === '1'
            || card?.dataset?.columnsFloat === '1';
        return {
            pinned: this.isBoardPinned(card?.dataset?.id),
            showDrag: hasSession && spatial
        };
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
                const isExpanded = card.classList.contains('expanded');
                if (!isExpanded && consumeSkipExpand()) return;
                if (card.dataset.skipExpand) delete card.dataset.skipExpand;
                if (ctx) this.toggleCardExpanded(card, item, ctx);
            });
        }

        this.attachCardActionButton(colorBtn, () => {
            this.commitFocusedInlineField(card, item);
            if (card.dataset.freeform === '1') this.raiseFreeformCard(card);
            if (card.dataset.gridBoard === '1') this.raiseGridBoardCard(card);
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
            if (card.dataset.freeform === '1') this.raiseFreeformCard(card);
            if (card.dataset.gridBoard === '1') this.raiseGridBoardCard(card);
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

        const commitAndClose = () => editor.closeAndSave({ revealOnBoard: !editor.preserveBoardCollapse });

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

    setupColumnResizeChrome(columnEl) {
        if (!columnEl?.classList.contains('canvas-column')) return;
        let chrome = columnEl.querySelector('.column-chrome');
        if (!chrome) {
            chrome = document.createElement('div');
            chrome.className = 'column-chrome';
            columnEl.appendChild(chrome);
        }
        if (!chrome.querySelector('.col-resize-se')) {
            chrome.insertAdjacentHTML('beforeend', `
                <span class="col-resize col-resize-e" data-axis="e" title="Resize width"></span>
                <span class="col-resize col-resize-s" data-axis="s" title="Resize height"></span>
                <span class="col-resize col-resize-se" data-axis="se" title="Resize"></span>
            `);
        }
    },

    setupFreeformChrome(card) {
        let chrome = card.querySelector('.ff-chrome');
        if (!chrome) {
            chrome = document.createElement('div');
            chrome.className = 'ff-chrome';
            card.appendChild(chrome);
        }
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
        if (!chrome.querySelector('.ff-resize-se')) {
            chrome.insertAdjacentHTML('beforeend', `
                <span class="ff-resize ff-resize-n" data-axis="n" title="Resize"></span>
                <span class="ff-resize ff-resize-s" data-axis="s" title="Resize"></span>
                <span class="ff-resize ff-resize-e" data-axis="e" title="Resize"></span>
                <span class="ff-resize ff-resize-w" data-axis="w" title="Resize"></span>
                <span class="ff-resize ff-resize-nw" data-axis="nw" title="Resize"></span>
                <span class="ff-resize ff-resize-ne" data-axis="ne" title="Resize"></span>
                <span class="ff-resize ff-resize-sw" data-axis="sw" title="Resize"></span>
                <span class="ff-resize ff-resize-se" data-axis="se" title="Resize"></span>
            `);
        }
    },

    readFreeformCardSize(card) {
        const rect = card.getBoundingClientRect();
        return {
            w: Math.round(rect.width) || FREEFORM_DEFAULT_W,
            h: Math.round(rect.height) || FREEFORM_DEFAULT_H
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
        card.style.setProperty('min-height', `${h}px`, 'important');
        card.style.setProperty('max-height', `${h}px`, 'important');
    },

    applyFreeformSize(card) {
        if (card.dataset.freeform !== '1') return;
        const saved = this.getFreeformSizes()[card.dataset.id];
        const isExpanded = card.classList.contains('expanded');
        let w;
        let h;
        if (isExpanded) {
            w = saved?.w ?? FREEFORM_EXPANDED_W;
            h = saved?.h ?? FREEFORM_EXPANDED_DEFAULT_H;
        } else {
            w = FREEFORM_DEFAULT_W;
            h = FREEFORM_DEFAULT_H;
        }
        this.applyFreeformDimensions(card, w, h);
    },

    finalizeFreeformCard(card) {
        if (card.dataset.freeform !== '1') return;
        this.setupFreeformChrome(card);
        this.applyFreeformSize(card);
    },

    getCardRenderContext(item, activeCategories) {
        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';
        return { targetCatName, categoryColor };
    },

    updateGridBoardCard(card, item, { expanded, dimensions = null, deferReflow = false } = {}) {
        if (card.dataset.gridBoard !== '1') return;

        const canvas = card.closest('#app-canvas');
        if (expanded && canvas) {
            canvas.querySelectorAll('.mini-card[data-grid-board="1"].expanded').forEach((other) => {
                if (other === card) return;
                const otherItem = this.resolveBoardItem(other.dataset.id);
                if (otherItem) {
                    this.updateGridBoardCard(other, otherItem, { expanded: false, deferReflow: true });
                }
            });
            setExpandedCardsMap('grid', { [item.id]: true });
            this.setGridExpandedId(item.id);
        } else if (!expanded) {
            setExpandedCard('grid', item.id, false);
            if (this.getGridExpandedId() === item.id) {
                this.setGridExpandedId(null);
            }
        }

        const activeCategories = readStoredCategories();
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        this.applyCardExpandCollapse(
            card,
            item,
            expanded,
            activeCategories,
            targetCatName,
            categoryColor,
            { skipGridReflow: true, skipAnimation: dimensions != null }
        );

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else if (!expanded || !cardAnimationsEnabled()) {
            this.applyGridBoardSize(card);
        }

        if (!expanded) {
            const pos = this.readNoteRect(card);
            const saved = this.getGridLayout()[item.id];
            const compact = this.gridCompactRect(pos, saved);
            const compactRect = {
                x: pos.x,
                y: pos.y,
                w: compact.w,
                h: compact.h
            };
            this.applyNoteRect(card, compactRect, { settling: false });
            this.saveGridLayout(item.id, compactRect, {
                customCompact: this.isGridMultiCellSize(compactRect.w, compactRect.h)
            });
        }

        if (canvas?.classList.contains('view-grid') && !deferReflow) {
            this.finalizeGridBoardCard(card);
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, item.id, { animate: true });
            });
        }
    },

    updateFreeformCard(card, item, { expanded, dimensions = null } = {}) {
        if (card.dataset.freeform !== '1') return;
        setExpandedCard('freeform', item.id, expanded);

        const activeCategories = readStoredCategories();
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        this.applyCardExpandCollapse(card, item, expanded, activeCategories, targetCatName, categoryColor, {
            skipAnimation: dimensions != null
        });

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else if (expanded && !cardAnimationsEnabled()) {
            this.applyFreeformSize(card);
        }
    },

    usesAnimPixelLock(card) {
        return card.dataset.freeform === '1'
            || card.dataset.gridBoard === '1'
            || card.dataset.columnNote === '1'
            || card.dataset.columnsFloat === '1';
    },

    isListLayoutCard(card) {
        const canvas = card.closest('#app-canvas');
        return !!canvas?.classList.contains('view-list') && !this.usesAnimPixelLock(card);
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
        if (card.dataset.freeform === '1') return FREEFORM_DEFAULT_W;
        if (card.dataset.columnsFloat === '1') return FREEFORM_DEFAULT_W;
        if (card.dataset.gridBoard === '1' && id) {
            const saved = this.getGridLayout()[id];
            if (saved?.customCompact && this.isGridMultiCellSize(saved.w, saved.h)) {
                return saved.w;
            }
            return COLUMN_GRID_CELL_W;
        }
        if (card.dataset.columnNote === '1' && id) {
            const cat = card.dataset.category;
            const saved = cat ? this.getColumnNoteLayout()[cat]?.[id] : null;
            if (saved?.customCompact && this.isGridMultiCellSize(saved.w, saved.h)) {
                return saved.w;
            }
            return COLUMN_GRID_CELL_W;
        }
        if (this.isListLayoutCard(card)) return FREEFORM_DEFAULT_W;
        return Math.round(card.getBoundingClientRect().width) || FREEFORM_DEFAULT_W;
    },

    resolveAnimExpandedWidth(card, item) {
        const id = card.dataset?.id || item?.id;
        if (card.dataset.freeform === '1' && id) {
            const saved = this.getFreeformSizes()[id];
            return saved?.w ?? FREEFORM_EXPANDED_W;
        }
        if (card.dataset.columnsFloat === '1' && id) {
            const saved = this.getColumnsFloatSizes()[id];
            return saved?.w ?? FREEFORM_EXPANDED_W;
        }
        if (card.dataset.gridBoard === '1' && id) {
            const saved = this.getGridLayout()[id];
            if (saved && Number.isFinite(saved.w)) return saved.w;
            return this.cellsToSpanW(2);
        }
        if (card.dataset.columnNote === '1' && id) {
            const cat = card.dataset.category;
            const saved = cat ? this.getColumnNoteLayout()[cat]?.[id] : null;
            if (saved?.w) return saved.w;
            return this.cellsToSpanW(COLUMN_MIN_COLS);
        }
        if (this.isListLayoutCard(card)) return FREEFORM_EXPANDED_W;
        return Math.round(card.getBoundingClientRect().width) || FREEFORM_EXPANDED_W;
    },

    resolveAnimCompactHeight(card) {
        if (card.dataset.gridBoard === '1') {
            const saved = this.getGridLayout()[card.dataset.id];
            const compact = this.gridCompactRect(
                { x: 0, y: 0, w: COLUMN_GRID_CELL_W, h: COLUMN_GRID_CELL_H },
                saved
            );
            return compact.h;
        }
        if (card.dataset.columnNote === '1') {
            const cat = card.dataset.category;
            const saved = cat ? this.getColumnNoteLayout()[cat]?.[card.dataset.id] : null;
            const compact = this.gridCompactRect(
                { x: 0, y: 0, w: COLUMN_GRID_CELL_W, h: COLUMN_GRID_CELL_H },
                saved
            );
            return compact.h;
        }
        if (card.dataset.freeform === '1' || card.dataset.columnsFloat === '1') return FREEFORM_DEFAULT_H;
        if (this.isListLayoutCard(card)) return CARD_COMPACT_H;
        return CARD_COMPACT_H;
    },

    measureAnimTargetSize(card, item) {
        const w = this.resolveAnimExpandedWidth(card, item);
        const id = item?.id || card.dataset?.id;
        let h;

        if (card.dataset.freeform === '1') {
            const saved = this.getFreeformSizes()[id];
            h = saved?.h ?? FREEFORM_EXPANDED_DEFAULT_H;
        } else if (card.dataset.columnsFloat === '1') {
            const saved = this.getColumnsFloatSizes()[id];
            h = saved?.h ?? FREEFORM_EXPANDED_DEFAULT_H;
        } else if (card.dataset.gridBoard === '1') {
            const saved = this.getGridLayout()[id];
            h = saved && Number.isFinite(saved.h) ? saved.h : this.cellsToSpanH(2);
        } else if (card.dataset.columnNote === '1') {
            const cat = card.dataset.category;
            const saved = cat ? this.getColumnNoteLayout()[cat]?.[id] : null;
            h = saved?.h ?? this.cellsToSpanH(2);
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

        const isFreeform = card.dataset.freeform === '1';
        const isGridBoard = card.dataset.gridBoard === '1';
        const animate = cardAnimationsEnabled() && !options.skipAnimation;

        const clearListAnimDimensions = () => {
            if (!this.isListLayoutCard(card)) return;
            card.style.removeProperty('width');
            card.style.removeProperty('height');
            card.style.removeProperty('min-height');
            card.style.removeProperty('max-height');
        };

        const reflowColumnNote = () => {
            if (card.dataset.columnNote !== '1') return;
            const notesEl = card.closest('.column-notes');
            if (!notesEl) return;
            const cat = card.dataset.category || targetCatName;
            this.finalizeColumnNote(card, cat);
            requestAnimationFrame(() => {
                this.autoArrangeColumnNotes(notesEl, { animate: true });
                const canvas = document.getElementById('app-canvas');
                if (canvas?.classList.contains('view-columns') && cat) {
                    this.reflowCanvasFromOrderEntry(canvas, { type: 'category', name: cat }, { animate: true });
                }
            });
        };

        const reflowColumnsFloat = () => {
            if (card.dataset.columnsFloat !== '1') return;
            const canvas = document.getElementById('app-canvas');
            if (!canvas?.classList.contains('view-columns')) return;
            this.finalizeColumnsFloat(card);
            requestAnimationFrame(() => {
                this.reflowCanvasFromOrderEntry(canvas, { type: 'float', id: card.dataset.id }, { animate: true });
            });
        };

        const reflowGridBoard = () => {
            if (options.skipGridReflow) return;
            if (card.dataset.gridBoard !== '1') return;
            const canvas = document.getElementById('app-canvas');
            if (!canvas?.classList.contains('view-grid')) return;
            this.finalizeGridBoardCard(card);
            requestAnimationFrame(() => {
                this.reflowGridBoard(canvas, card.dataset.id, { animate: true });
            });
        };

        const finishExpand = () => {
            if (isFreeform) this.applyFreeformSize(card);
            if (isGridBoard) this.applyGridBoardSize(card);
            clearListAnimDimensions();
            reflowColumnNote();
            reflowColumnsFloat();
            reflowGridBoard();
            this.cleanupCardAnimation(card);
        };

        const finishCollapse = () => {
            card.classList.remove('expanded');
            card.classList.add('compact');
            this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor);
            if (isFreeform) this.applyFreeformSize(card);
            if (isGridBoard) {
                this.applyGridBoardSize(card);
                reflowGridBoard();
            }
            clearListAnimDimensions();
            reflowColumnNote();
            reflowColumnsFloat();
            this.cleanupCardAnimation(card);
        };

        if (expanded) {
            if (!animate) {
                card.classList.remove('compact');
                card.classList.add('expanded');
                this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
                finishExpand();
                return;
            }

            const compactW = this.resolveAnimCompactWidth(card);
            const compactH = Math.round(card.getBoundingClientRect().height) || this.resolveAnimCompactHeight(card);

            card.classList.add('card-animating', 'card-state-changing');
            card.style.setProperty('--card-anim-duration', `${CARD_ANIM_MS}ms`);
            card.style.overflow = 'hidden';

            this.lockCardAnimationDimensions(card, compactW, compactH);

            card.classList.remove('compact');
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

        const expandedW = Math.round(card.getBoundingClientRect().width) || this.resolveAnimExpandedWidth(card, item);
        const expandedH = Math.round(card.getBoundingClientRect().height) || this.measureAnimTargetSize(card, item).h;
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

    updateColumnsFloatCard(card, item, { expanded, dimensions = null } = {}) {
        if (card.dataset.columnsFloat !== '1') return;
        setExpandedCard('columns', item.id, expanded);

        const activeCategories = readStoredCategories();
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        this.applyCardExpandCollapse(card, item, expanded, activeCategories, targetCatName, categoryColor, {
            skipAnimation: dimensions != null
        });

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else if (expanded) {
            this.finalizeColumnsFloat(card);
        }
    },

    updateColumnNoteCard(card, item, { expanded, dimensions = null, deferReflow = false } = {}) {
        if (card.dataset.columnNote !== '1') return;

        const columnNotes = card.closest('.column-notes');
        const canvas = card.closest('#app-canvas');
        const activeCategories = readStoredCategories();
        const { targetCatName, categoryColor } = this.getCardRenderContext(item, activeCategories);

        if (expanded && columnNotes) {
            columnNotes.querySelectorAll('.mini-card[data-column-note="1"].expanded').forEach((other) => {
                if (other === card) return;
                const otherItem = this.resolveBoardItem(other.dataset.id);
                if (otherItem) {
                    this.updateColumnNoteCard(other, otherItem, { expanded: false, deferReflow: true });
                }
            });
        }

        setExpandedCard('columns', item.id, expanded);

        this.applyCardExpandCollapse(card, item, expanded, activeCategories, targetCatName, categoryColor, {
            skipAnimation: dimensions != null
        });

        if (dimensions) {
            this.applyFreeformDimensions(card, dimensions.w, dimensions.h);
        } else if (!expanded) {
            const pos = this.readNoteRect(card);
            const cat = card.dataset.category || targetCatName;
            const saved = cat ? this.getColumnNoteLayout()[cat]?.[item.id] : null;
            const compact = this.gridCompactRect(pos, saved);
            const compactRect = { x: pos.x, y: pos.y, w: compact.w, h: compact.h };
            this.applyNoteRect(card, compactRect, { settling: false });
            if (cat) {
                this.saveColumnNoteLayout(cat, item.id, compactRect, {
                    customCompact: this.isGridMultiCellSize(compactRect.w, compactRect.h)
                });
            }
        }

        if (dimensions) {
            const cat = card.dataset.category || targetCatName;
            if (cat) {
                this.saveColumnNoteLayout(cat, item.id, this.readNoteRect(card));
            }
        }

        if (columnNotes && canvas?.classList.contains('view-columns') && !deferReflow) {
            const cat = card.dataset.category || targetCatName;
            this.finalizeColumnNote(card, cat);
            requestAnimationFrame(() => {
                this.reflowColumnNotesPanel(columnNotes, item.id, { animate: true });
            });
        }
    },

    toggleCardExpanded(card, item, ctx) {
        if (this.isCardAnimating(card)) return;

        const willExpand = !card.classList.contains('expanded');

        if (card.dataset.freeform === '1') {
            this.updateFreeformCard(card, item, { expanded: willExpand });
            return;
        }

        if (card.dataset.gridBoard === '1') {
            this.updateGridBoardCard(card, item, { expanded: willExpand });
            return;
        }

        if (card.dataset.columnNote === '1') {
            this.updateColumnNoteCard(card, item, { expanded: willExpand });
            return;
        }

        if (card.dataset.columnsFloat === '1') {
            this.updateColumnsFloatCard(card, item, { expanded: willExpand });
            return;
        }

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

    createCardComponent(item, activeCategories, { freeform = false, gridBoard = false, columnNote = false, columnsFloat = false, categoryName = '' } = {}) {
        const card = document.createElement('div');
        card.classList.add('mini-card');
        card.classList.add('compact');
        
        card.dataset.id = item.id;
        if (freeform) card.dataset.freeform = '1';
        if (gridBoard) card.dataset.gridBoard = '1';
        if (columnNote) {
            card.dataset.columnNote = '1';
            if (categoryName) card.dataset.category = categoryName;
        }
        if (columnsFloat) card.dataset.columnsFloat = '1';

        const targetCatName = (item.categories && item.categories.length > 0) ? item.categories[0] : '';
        const matchedCat = activeCategories.find(c => c.name?.toLowerCase() === targetCatName.toLowerCase());
        const categoryColor = matchedCat ? matchedCat.color : '#64748b';

        this.applyItemCardTheme(card, item);
        card.style.borderLeftColor = categoryColor;

        const isExpanded = gridBoard
            ? this.isGridBoardCardExpanded(item.id, card)
            : getExpandedCards(activeBoardViewMode)[item.id] === true;

        if (isExpanded) {
            card.classList.remove('compact');
            card.classList.add('expanded');
            this.renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor);
        } else {
            card.classList.add('compact');
            card.classList.remove('expanded');
            this.renderCompactCard(card, item, activeCategories, targetCatName, categoryColor);
        }

        if (freeform) {
            card.addEventListener('mousedown', () => this.raiseFreeformCard(card), true);
        }

        if (gridBoard) {
            card.addEventListener('mousedown', () => this.raiseGridBoardCard(card), true);
        }

        if (columnNote && !card.classList.contains('expanded')) {
            card.dataset.hasCatDrag = '1';
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

    buildNoteMetaFooterHtml(item, { mode = 'inline', targetCatName = '', categoryColor = UNCATEGORIZED_COLOR } = {}) {
        const createdLabel = this.formatCreatedDate(item.created_at);
        const sizeLabel = computeNoteSizeKb(item);
        const lineLabel = formatNoteLineCount(computeNoteLineCount(item));
        const createdHtml = createdLabel
            ? `<span class="editor-created-date" title="Created">Created ${createdLabel}</span>`
            : '';
        const sizeHtml = `<span class="editor-note-size" title="Note content size">${sizeLabel} KB</span>`;
        const lineHtml = `<span class="editor-note-lines" title="Number of lines">${lineLabel}</span>`;
        const statsHtml = `${lineHtml}${createdHtml}${sizeHtml}`;

        if (mode === 'inline') {
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
        }

        return `
            <div class="editor-meta-row editor-meta-row--footer">
                <span class="editor-meta-stats">${statsHtml}</span>
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
        metaMode = 'inline',
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
            mode: metaMode,
            targetCatName,
            categoryColor
        });
        const bodyIdAttr = bodyId ? ` id="${bodyId}"` : '';

        return `
            <div class="editor-note-shell note-surface">
                ${toolbarHtml ? `<div class="note-editor-toolbar${toolbarDragZone}">${toolbarHtml}</div>` : ''}
                <div class="editor-note-header${toolbarDragZone || ''}">
                    ${titleHtml}
                </div>
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

    hasAnyBoardCardsExpanded() {
        const mode = activeBoardViewMode;
        const expanded = getExpandedCards(mode);
        if (Object.keys(expanded).some((id) => expanded[id])) return true;
        if (mode === 'grid' && this.getGridExpandedId()) return true;
        const canvas = document.getElementById('app-canvas');
        return !!canvas?.querySelector('.mini-card.expanded');
    },

    expandAllCards() {
        const mode = activeBoardViewMode;
        const map = {};
        boardItemsById.forEach((_item, id) => {
            map[id] = true;
        });
        setExpandedCardsMap(mode, map);
        if (mode === 'grid') {
            this.setGridExpandedId(null);
        }
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    collapseAllCards() {
        clearExpandedCards(activeBoardViewMode);
        if (activeBoardViewMode === 'grid') {
            this.setGridExpandedId(null);
        }
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    toggleCollapseAllCards() {
        if (this.hasAnyBoardCardsExpanded()) {
            this.collapseAllCards();
        } else {
            this.expandAllCards();
        }
    },

    syncCollapseAllButton() {
        const btn = document.getElementById('btn-collapse-all');
        if (!btn || btn.classList.contains('is-hidden')) return;
        const anyExpanded = this.hasAnyBoardCardsExpanded();
        btn.innerHTML = anyExpanded ? ACTION_ICONS.collapseAll : ACTION_ICONS.expandAll;
        const label = anyExpanded ? 'Collapse all notes' : 'Expand all notes';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    },

    revealNoteOnBoard(item) {
        if (!item?.id) return;
        window.dispatchEvent(new CustomEvent('editor:reveal_on_board', { detail: item }));
    },

    captureDesktopRestoreContext(card) {
        if (!card) return null;
        if (card.dataset.gridBoard === '1') {
            return {
                viewMode: 'grid',
                rect: this.readNoteRect(card),
                size: this.readFreeformCardSize(card)
            };
        }
        if (card.dataset.freeform === '1') {
            return {
                viewMode: 'freeform',
                position: {
                    x: parseFloat(card.style.left) || 0,
                    y: parseFloat(card.style.top) || 0
                },
                size: this.readFreeformCardSize(card)
            };
        }
        return null;
    },

    getPreferredDesktopViewMode() {
        const preferred = localStorage.getItem('matrix_preferred_view');
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
            const placed = [...(host?.querySelectorAll('.mini-card[data-grid-board="1"]') || [])]
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
            this.setGridExpandedId(itemId);
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
            this.finalizeGridBoardCard(card);
            this.updateGridBoardCard(card, item, {
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
            this.updateFreeformCard(card, item, {
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

    renderCompactCard(card, item, activeCategories, targetCatName, categoryColor) {
        card.classList.remove('note-surface');
        const dotColor = targetCatName ? categoryColor : UNCATEGORIZED_COLOR;
        const isExpanded = false;
        const dragZone = this.freeformDragZoneClass(card);
        const catDragHandle = this.buildCategoryDragHandleHtml(card);
        card.innerHTML = `
            <div class="card-header${dragZone}">
                ${catDragHandle}
                ${this.buildNoteTitleHtml(item, false)}
                ${this.buildCardActionsHtml(item, isExpanded, this.getCardActionsOptions(card))}
            </div>
            <div class="mini-card-meta compact${dragZone}">
                <span class="badge-dot" style="background-color: ${dotColor};" title="${this.escapeAttr(targetCatName || 'Uncategorized')}"></span>
                ${targetCatName ? `<span class="category-name">${this.escapeHTML(targetCatName)}</span>` : ''}
            </div>
        `;

        this.attachCardActions(card, item, {
            activeCategories,
            targetCatName,
            categoryColor
        });
        this.finalizeFreeformCard(card);
        this.finalizeGridBoardCard(card);
        if (card.dataset.columnNote === '1') {
            this.finalizeColumnNote(card, card.dataset.category || targetCatName);
        }
        if (card.dataset.columnsFloat === '1') {
            this.finalizeColumnsFloat(card);
        }
        this.syncCardDraggable(card);
        this.syncBoardPinClass(card);
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

    renderExpandedCard(card, item, activeCategories, targetCatName, categoryColor) {
        const canEdit = this.canEditInline();
        const dotColor = targetCatName ? categoryColor : UNCATEGORIZED_COLOR;
        const dragZone = this.freeformDragZoneClass(card);

        const catDragHandle = this.buildCategoryDragHandleHtml(card);
        card.innerHTML = this.buildNoteEditorShell(item, {
            canEdit,
            richEdit: canEdit,
            toolbarHtml: `${catDragHandle}${this.buildCardActionsHtml(item, true, this.getCardActionsOptions(card))}`,
            toolbarDragZone: dragZone,
            footerDragZone: dragZone,
            metaMode: 'inline',
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
            stopMousedownPropagation: this.isColumnLayoutCard(card)
        });
        this.finalizeFreeformCard(card);
        this.finalizeGridBoardCard(card);
        if (card.dataset.columnNote === '1') {
            this.finalizeColumnNote(card, card.dataset.category || targetCatName);
        }
        if (card.dataset.columnsFloat === '1') {
            this.finalizeColumnsFloat(card);
        }
        this.syncCardDraggable(card);
        this.syncBoardPinClass(card);
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
                });
                el.addEventListener('mousedown', (e) => {
                    if (el.classList.contains('rich-text--edit') && e.target.closest('a[href]')) {
                        e.preventDefault();
                    }
                    if (stopMousedownPropagation) {
                        e.stopPropagation();
                    }
                });
                el.addEventListener('focus', () => {
                    const card = root.closest('.mini-card');
                    if (card?.dataset.freeform === '1') this.raiseFreeformCard(card);
                    if (card?.dataset.gridBoard === '1') this.raiseGridBoardCard(card);
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

        if (root.querySelector('.expanded-checklist')) {
            if (!item.steps) item.steps = [];

            root.querySelector('.expanded-checklist-add-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.insertChecklistStep(root, item, refresh, applyMutate);
            });

            root.querySelectorAll('.step-row--display').forEach((row) => {
                const checkbox = row.querySelector('.step-check');
                const stepId = row.dataset.stepId;
                checkbox?.addEventListener('change', (e) => {
                    e.stopPropagation();
                    if (!item.steps.find(s => s.id === stepId)) return;
                    row.classList.add('step-row--animating');
                    applyMutate((it) => {
                        const s = it.steps.find(st => st.id === stepId);
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
                        const step = it.steps.find((s) => s.id === stepId);
                        if (!step) return;
                        step.level = Math.min(4, getStepLevel(step) + 1);
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
                        const step = it.steps.find((s) => s.id === stepId);
                        if (!step) return;
                        step.level = Math.max(0, getStepLevel(step) - 1);
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
                this.attachChecklistDrag(root, item, applyMutate, refresh);
            }
        }
    },

    attachChecklistDrag(root, item, applyMutate, refresh) {
        if (!root.querySelector('.expanded-checklist')) return;
        if (root.dataset.checklistDragBound) return;
        root.dataset.checklistDragBound = '1';

        const DRAG_THRESHOLD = 4;
        let activeDrag = null;

        const getList = () => root.querySelector('.expanded-checklist');
        const getActiveRows = () => [...(getList()?.querySelectorAll('.step-row--display:not(.step-row--done)') || [])];

        const reorderAt = (clientY) => {
            const draggedRow = activeDrag?.row;
            const activeList = getList();
            if (!draggedRow || !activeList?.contains(draggedRow)) return;

            const siblings = getActiveRows().filter((row) => row !== draggedRow);
            const nextSibling = siblings.find((sibling) => {
                const box = sibling.getBoundingClientRect();
                return clientY <= box.top + box.height / 2;
            });
            if (nextSibling) activeList.insertBefore(draggedRow, nextSibling);
            else {
                const doneAnchor = activeList.querySelector('.checklist-done-toggle')
                    || activeList.querySelector('.checklist-done-section')
                    || activeList.querySelector('.step-row--done');
                if (doneAnchor) activeList.insertBefore(draggedRow, doneAnchor);
                else activeList.appendChild(draggedRow);
            }
        };

        const finishDrag = () => {
            if (!activeDrag) return;
            const { row, moved } = activeDrag;
            row.classList.remove('is-dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (moved) {
                const shell = root.closest('.editor-note-shell') || root;
                this.syncItemBodyFromDom(shell, item);
                applyMutate((it) => {
                    const activeSteps = it.steps.filter((step) => !step.completed);
                    const doneSteps = it.steps.filter((step) => step.completed);
                    const visibleRootIds = getActiveRows().map((r) => r.dataset.stepId);
                    it.steps = [
                        ...reorderActiveStepsPreservingSubtrees(activeSteps, visibleRootIds),
                        ...doneSteps
                    ];
                });
                refresh();
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
                activeDrag.row.classList.add('is-dragging');
            }
            e.preventDefault();
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
            activeDrag = {
                row,
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

    saveFreeformSize(itemId, w, h) {
        const sizes = this.getFreeformSizes();
        sizes[itemId] = {
            w: Math.round(Math.max(FREEFORM_MIN_W, w)),
            h: Math.round(Math.max(FREEFORM_MIN_H, h))
        };
        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(sizes));
    },

    saveFreeformSizeFromCard(card) {
        if (card.dataset.freeform !== '1') return;
        const { w, h } = this.readFreeformCardSize(card);
        this.saveFreeformSize(card.dataset.id, w, h);
    },

    flushLayoutFromCanvas(canvas, viewMode) {
        if (!canvas) return;
        if (viewMode === 'grid') {
            canvas.querySelectorAll('.mini-card[data-grid-board="1"]').forEach((card) => {
                const id = card.dataset.id;
                if (!id) return;
                this.saveGridLayout(id, this.readNoteRect(card));
            });
            return;
        }
        if (viewMode === 'freeform') {
            canvas.querySelectorAll('.mini-card[data-freeform="1"]').forEach((card) => {
                const id = card.dataset.id;
                if (!id) return;
                this.saveFreeformPosition(
                    id,
                    parseFloat(card.style.left) || 0,
                    parseFloat(card.style.top) || 0
                );
                if (card.classList.contains('expanded')) {
                    this.saveFreeformSizeFromCard(card);
                }
            });
            return;
        }

        canvas.querySelectorAll('.canvas-column').forEach((col) => {
            const cat = col.dataset.category;
            if (!cat) return;
            this.saveColumnPosition(cat, parseFloat(col.style.left) || 0, parseFloat(col.style.top) || 0);
            const rect = this.readColumnCanvasRect(col);
            if (rect.w && rect.h) this.saveColumnSize(cat, rect.w, rect.h);
        });

        canvas.querySelectorAll('.mini-card[data-column-note="1"], .mini-card[data-columns-float="1"]').forEach((card) => {
            const id = card.dataset.id;
            if (!id) return;
            const rect = this.readNoteRect(card);
            if (card.dataset.columnsFloat === '1') {
                this.saveColumnsFloatPosition(id, rect.x, rect.y);
                if (card.classList.contains('expanded')) {
                    this.saveColumnsFloatSize(id, rect.w, rect.h);
                }
                return;
            }
            const cat = card.dataset.category;
            if (cat) this.saveColumnNoteLayout(cat, id, rect);
        });
    },

    captureViewSnapshot(viewMode, focusCategories = []) {
        const canvas = document.getElementById('app-canvas');
        this.persistViewSessionForMode(viewMode, canvas);
        let collapsedCategories = [];
        try {
            collapsedCategories = JSON.parse(localStorage.getItem('matrix_collapsed_categories') || '[]');
        } catch {
            collapsedCategories = [];
        }
        return {
            version: 3,
            savedAt: Date.now(),
            viewMode,
            focusCategories: Array.isArray(focusCategories) ? [...focusCategories] : [],
            scroll: this.captureScrollState(canvas),
            freeformPositions: this.getFreeformPositions(),
            freeformSizes: this.getFreeformSizes(),
            columnPositions: this.getColumnPositions(),
            columnSizes: this.getColumnSizes(),
            columnNoteLayout: this.getColumnNoteLayout(),
            columnsFloatPositions: this.getColumnsFloatPositions(),
            columnsFloatSizes: this.getColumnsFloatSizes(),
            gridLayout: this.getGridLayout(),
            gridPins: this.getGridPins(),
            gridExpandedId: this.getGridExpandedId(),
            expandedCards: getExpandedCards(viewMode),
            collapsedCategories,
            viewSessions: getViewSessionsForSnapshot()
        };
    },

    migrateLegacySavedView() {
        try {
            const legacy = localStorage.getItem('matrix_saved_view');
            if (!legacy || localStorage.getItem(SAVED_VIEWS_KEY)) return;
            const parsed = JSON.parse(legacy);
            if (!parsed) return;
            const store = {
                version: 2,
                slots: Array.from({ length: SAVED_VIEWS_SLOTS }, (_, id) => ({
                    id,
                    savedAt: null,
                    label: `View ${id + 1}`,
                    snapshot: null
                }))
            };
            store.slots[0] = {
                id: 0,
                savedAt: parsed.savedAt || Date.now(),
                label: 'View 1',
                snapshot: { ...parsed, version: 2, focusCategories: parsed.focusCategories || [] }
            };
            localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(store));
            localStorage.removeItem('matrix_saved_view');
        } catch {
            /* ignore */
        }
    },

    getSavedViewsStore() {
        this.migrateLegacySavedView();
        try {
            const raw = localStorage.getItem(SAVED_VIEWS_KEY);
            if (!raw) {
                return {
                    version: 2,
                    slots: Array.from({ length: SAVED_VIEWS_SLOTS }, (_, id) => ({
                        id,
                        savedAt: null,
                        label: `View ${id + 1}`,
                        snapshot: null
                    }))
                };
            }
            const parsed = JSON.parse(raw);
            if (!parsed?.slots?.length) throw new Error('invalid');
            while (parsed.slots.length < SAVED_VIEWS_SLOTS) {
                parsed.slots.push({
                    id: parsed.slots.length,
                    savedAt: null,
                    label: `View ${parsed.slots.length + 1}`,
                    snapshot: null
                });
            }
            return parsed;
        } catch {
            return {
                version: 2,
                slots: Array.from({ length: SAVED_VIEWS_SLOTS }, (_, id) => ({
                    id,
                    savedAt: null,
                    label: `View ${id + 1}`,
                    snapshot: null
                }))
            };
        }
    },

    saveViewSnapshotToSlot(slotIndex, viewMode, focusCategories = []) {
        const snapshot = this.captureViewSnapshot(viewMode, focusCategories);
        const store = this.getSavedViewsStore();
        const idx = Math.max(0, Math.min(SAVED_VIEWS_SLOTS - 1, slotIndex));
        store.slots[idx] = {
            id: idx,
            savedAt: snapshot.savedAt,
            label: `View ${idx + 1}`,
            snapshot
        };
        localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(store));
        return snapshot;
    },

    getSavedViewSlot(slotIndex) {
        const store = this.getSavedViewsStore();
        const idx = Math.max(0, Math.min(SAVED_VIEWS_SLOTS - 1, slotIndex));
        return store.slots[idx]?.snapshot || null;
    },

    hasAnySavedViewSlot() {
        return this.getSavedViewsStore().slots.some((slot) => slot?.snapshot);
    },

    getSavedViewSnapshot(slotIndex = 0) {
        return this.getSavedViewSlot(slotIndex);
    },

    hasSavedViewSnapshot() {
        return this.hasAnySavedViewSlot();
    },

    applyViewSnapshot(snapshot) {
        if (!snapshot || (snapshot.version !== 1 && snapshot.version !== 2 && snapshot.version !== 3)) return false;
        localStorage.setItem('matrix_freeform_positions', JSON.stringify(snapshot.freeformPositions || {}));
        localStorage.setItem('matrix_freeform_sizes', JSON.stringify(snapshot.freeformSizes || {}));
        localStorage.setItem('matrix_column_positions', JSON.stringify(snapshot.columnPositions || {}));
        localStorage.setItem('matrix_column_sizes', JSON.stringify(snapshot.columnSizes || {}));
        localStorage.setItem('matrix_column_note_layout', JSON.stringify(snapshot.columnNoteLayout || {}));
        localStorage.setItem('matrix_columns_float_positions', JSON.stringify(snapshot.columnsFloatPositions || {}));
        localStorage.setItem('matrix_columns_float_sizes', JSON.stringify(snapshot.columnsFloatSizes || {}));
        localStorage.setItem(GRID_LAYOUT_KEY, JSON.stringify(snapshot.gridLayout || {}));
        localStorage.setItem(GRID_PINS_KEY, JSON.stringify(snapshot.gridPins || []));
        if (snapshot.version >= 3 && snapshot.viewSessions) {
            applyViewSessionsFromSnapshot(snapshot.viewSessions);
        } else {
            if (snapshot.gridExpandedId) {
                localStorage.setItem(GRID_EXPANDED_KEY, snapshot.gridExpandedId);
            } else {
                localStorage.removeItem(GRID_EXPANDED_KEY);
            }
            localStorage.setItem('matrix_expanded_cards', JSON.stringify(snapshot.expandedCards || {}));
        }
        localStorage.setItem('matrix_collapsed_categories', JSON.stringify(snapshot.collapsedCategories || []));
        return true;
    },

    restoreSavedViewSnapshot(slotIndex = 0) {
        const snapshot = this.getSavedViewSlot(slotIndex);
        if (!snapshot) return null;
        this.applyViewSnapshot(snapshot);
        return snapshot;
    },

    resetFreeformLayout() {
        localStorage.removeItem('matrix_freeform_positions');
        localStorage.removeItem('matrix_freeform_sizes');
        clearViewSessionExpanded('freeform');
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    resetColumnsLayout() {
        localStorage.removeItem('matrix_column_positions');
        localStorage.removeItem('matrix_column_sizes');
        localStorage.removeItem('matrix_column_note_layout');
        localStorage.removeItem('matrix_columns_float_positions');
        localStorage.removeItem('matrix_columns_float_sizes');
        localStorage.removeItem('matrix_canvas_layout_order');
        clearViewSessionExpanded('columns');
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    resetGridLayout() {
        localStorage.removeItem(GRID_LAYOUT_KEY);
        localStorage.removeItem(GRID_PINS_KEY);
        clearViewSessionExpanded('grid');
        this.setGridExpandedId(null);
        window.dispatchEvent(new CustomEvent('board:visibility_changed'));
    },

    getGridLayout() {
        try {
            return JSON.parse(localStorage.getItem(GRID_LAYOUT_KEY) || '{}');
        } catch {
            return {};
        }
    },

    saveGridLayout(itemId, rect, { customCompact = false } = {}) {
        if (!itemId || !rect) return;
        const layout = this.getGridLayout();
        const entry = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.w),
            h: Math.round(rect.h)
        };
        if (customCompact) entry.customCompact = true;
        layout[itemId] = entry;
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
        const zoom = parseFloat(canvas?.dataset?.desktopZoom) || 1;
        const rawW = Math.max((canvas?.clientWidth || 320) / zoom, CANVAS_GRID_W + CANVAS_LAYOUT_ORIGIN * 2);
        const origin = CANVAS_LAYOUT_ORIGIN;
        const packW = Math.max(COLUMN_MIN_INNER_W, rawW - origin * 2);
        const maxH = Math.max(
            (canvas?.scrollHeight || 0) / zoom,
            (canvas?.clientHeight || 0) / zoom,
            typeof window !== 'undefined' ? window.innerHeight / zoom : 800
        );
        return { origin, packW, maxH, canvasW: rawW };
    },

    updateGridCanvasMinHeight(canvas, placed, origin = CANVAS_LAYOUT_ORIGIN) {
        if (!canvas) return;
        const bottom = placed.reduce((m, r) => Math.max(m, r.y + r.h), 0);
        canvas.style.minHeight = `${bottom + origin + CANVAS_COL_GAP}px`;
    },

    applyGridBoardSize(card) {
        if (card.dataset.gridBoard !== '1') return;
        const isExpanded = card.classList.contains('expanded');
        const saved = this.getGridLayout()[card.dataset.id];
        let w;
        let h;
        if (!isExpanded) {
            const compact = this.gridCompactRect(
                { x: 0, y: 0, w: COLUMN_GRID_CELL_W, h: COLUMN_GRID_CELL_H },
                saved
            );
            w = compact.w;
            h = compact.h;
        } else if (saved && Number.isFinite(saved.w) && Number.isFinite(saved.h)) {
            w = saved.w;
            h = saved.h;
        } else {
            w = this.cellsToSpanW(2);
            h = this.cellsToSpanH(2);
        }
        this.applyFreeformDimensions(card, w, h);
    },

    finalizeGridBoardCard(card) {
        if (card.dataset.gridBoard !== '1') return;
        this.setupFreeformChrome(card);
        this.applyGridBoardSize(card);
    },

    clampGridResize(w, h, { packW } = {}) {
        const minW = COLUMN_GRID_CELL_W;
        const minH = COLUMN_GRID_CELL_H;
        const maxCellsW = Math.max(1, this.spanToCellsW(packW || CANVAS_GRID_W));
        let wCells = Math.max(1, this.spanToCellsW(Math.max(minW, w)));
        let hCells = Math.max(1, this.spanToCellsH(Math.max(minH, h)));
        wCells = Math.min(wCells, maxCellsW);
        return {
            w: this.cellsToSpanW(wCells),
            h: this.cellsToSpanH(hCells)
        };
    },

    findNearestGridSlot(preferred, w, h, placed, { packW, origin = CANVAS_LAYOUT_ORIGIN, maxH = Infinity } = {}) {
        const bounds = { maxW: packW, maxH };
        const snapped = this.snapNoteRect({ x: preferred.x, y: preferred.y, w, h }, bounds);
        if (!placed.some((p) => this.rectsOverlap(snapped, p))) return snapped;

        const prefX = snapped.x;
        const prefY = snapped.y;
        const candidates = [];

        for (let ring = 0; ring <= 32; ring++) {
            for (let dy = -ring; dy <= ring; dy++) {
                for (let dx = -ring; dx <= ring; dx++) {
                    if (ring > 0 && Math.abs(dx) !== ring && Math.abs(dy) !== ring) continue;
                    const x = prefX + dx * COLUMN_STRIDE_X;
                    const y = prefY + dy * COLUMN_STRIDE_Y;
                    const c = this.snapNoteRect({ x, y, w, h }, bounds);
                    if (c.x < origin - 1) continue;
                    if (c.x + c.w > origin + packW + 1) continue;
                    if (c.y < origin - 1) continue;
                    candidates.push({ rect: c, dist: Math.abs(c.x - prefX) + Math.abs(c.y - prefY) });
                }
            }
        }
        candidates.sort((a, b) => a.dist - b.dist);
        for (const { rect } of candidates) {
            if (!placed.some((p) => this.rectsOverlap(rect, p))) return rect;
        }
        return snapped;
    },

    pushGridCardRect(rect, placed, { packW, origin, maxH }) {
        const snapRect = (r) => this.snapNoteRect(r, { maxW: packW, maxH });
        let candidate = snapRect({ ...rect, x: rect.x + COLUMN_STRIDE_X });
        if (candidate.x + candidate.w <= origin + packW + 1
            && !placed.some((p) => this.rectsOverlap(candidate, p))) {
            return candidate;
        }
        const blocker = placed.find((p) => this.rectsOverlap(rect, p));
        if (blocker) {
            candidate = snapRect({
                x: rect.x,
                y: blocker.y + blocker.h + COLUMN_GRID_GAP,
                w: rect.w,
                h: rect.h
            });
            if (!placed.some((p) => this.rectsOverlap(candidate, p))) return candidate;
        }
        return this.findNearestGridSlot(rect, rect.w, rect.h, placed, { packW, origin, maxH });
    },

    resolveGridPushLayout({ cardEntries, actorId, actorRect, pinnedIds, packW, origin, maxH }) {
        const layout = new Map();
        const placed = [];
        const snapOpts = { packW, origin, maxH };

        cardEntries.forEach(({ id, rect }) => {
            if (!id || !pinnedIds.has(id)) return;
            const snapped = this.snapNoteRect(rect, { maxW: packW, maxH });
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
            let snapped = this.snapNoteRect(rect, { maxW: packW, maxH });
            if (placed.some((p) => this.rectsOverlap(snapped, p))) {
                snapped = this.pushGridCardRect(snapped, placed, snapOpts);
            }
            layout.set(id, snapped);
            placed.push({ ...snapped });
        });

        return layout;
    },

    getColumnNotesSnapBounds(columnNotesEl) {
        return {
            origin: 0,
            packW: this.getColumnNotesInnerWidth(columnNotesEl),
            maxH: this.getColumnNotesMaxHeight(columnNotesEl)
        };
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
            const entry = cardEntries.find((e) => e.id === actorId);
            const isExpanded = entry ? isCardExpanded(actorId, entry.card) : false;
            const sized = rectForCard(entry?.card, actorRect, isExpanded);
            resolvedActor = this.snapNoteRect(sized, { maxW: packW, maxH: limitH });
        }

        return this.resolveGridPushLayout({
            cardEntries,
            actorId,
            actorRect: resolvedActor,
            pinnedIds,
            packW,
            origin,
            maxH: limitH
        });
    },

    computeGridBoardLayout(canvas, actorId, actorRect = null, { maxH } = {}) {
        if (!canvas?.classList.contains('view-grid')) return new Map();
        const { origin, packW, maxH: boardMaxH } = this.getGridBoardBounds(canvas);
        return this.computeSnapPanelLayout({
            panelEl: canvas,
            cardSelector: '.mini-card[data-grid-board="1"]',
            getSavedRect: (id) => this.getGridLayout()[id],
            rectForCard: (card, saved, isExpanded) => this.gridBoardRectForCard(card, saved, isExpanded),
            isCardExpanded: (id, card) => this.isGridBoardCardExpanded(id, card),
            actorId,
            actorRect,
            bounds: { origin, packW, maxH: maxH ?? boardMaxH }
        });
    },

    computeColumnNotesLayout(columnNotesEl, actorId, actorRect = null) {
        if (!columnNotesEl) return new Map();
        const categoryName = columnNotesEl.dataset.category;
        const bounds = this.getColumnNotesSnapBounds(columnNotesEl);
        return this.computeSnapPanelLayout({
            panelEl: columnNotesEl,
            cardSelector: '.mini-card[data-column-note="1"]',
            getSavedRect: (id) => (categoryName ? this.getColumnNoteLayout()[categoryName]?.[id] : null),
            rectForCard: (card, saved, isExpanded) => this.columnNoteRectForCard(card, saved, isExpanded),
            isCardExpanded: (id, card) => getExpandedCards('columns')[id] === true || card.classList.contains('expanded'),
            actorId,
            actorRect,
            bounds
        });
    },

    clearSnapPanelPreview(panelEl) {
        panelEl?.querySelectorAll('.mini-card.layout-preview').forEach((c) => {
            c.classList.remove('layout-preview');
        });
    },

    applyColumnNotesLayout(columnNotesEl, layout, { animate = true, save = true, preview = false } = {}) {
        if (!columnNotesEl || !layout?.size) return [];
        const categoryName = columnNotesEl.dataset.category;
        const placed = [];
        layout.forEach((rect, id) => {
            const card = columnNotesEl.querySelector(`.mini-card[data-column-note="1"][data-id="${CSS.escape(id)}"]`);
            if (!card) return;
            this.applyNoteRect(card, rect, { settling: animate });
            card.classList.toggle('layout-preview', preview);
            if (save && categoryName) {
                this.saveColumnNoteLayout(categoryName, id, rect, {
                    customCompact: card.classList.contains('compact')
                        && this.isGridMultiCellSize(rect.w, rect.h)
                });
            }
            placed.push(rect);
        });
        const bottom = placed.reduce((m, r) => Math.max(m, r.y + r.h), 0);
        columnNotesEl.style.minHeight = `${bottom + COLUMN_GRID_GAP}px`;
        const column = columnNotesEl.closest('.canvas-column');
        if (column) this.resizeColumnToFit(column, { animate });
        if (animate && !preview) {
            window.setTimeout(() => {
                columnNotesEl.querySelectorAll('.mini-card.layout-settling').forEach((c) => {
                    c.classList.remove('layout-settling');
                });
            }, 160);
        }
        return placed;
    },

    reflowColumnNotesPanel(columnNotesEl, actorId, { animate = true } = {}) {
        if (!columnNotesEl) return;
        const layout = this.computeColumnNotesLayout(columnNotesEl, actorId);
        this.applyColumnNotesLayout(columnNotesEl, layout, { animate, save: true });
    },

    applyGridBoardLayout(canvas, layout, { animate = true, save = true, preview = false } = {}) {
        if (!canvas || !layout?.size) return [];
        const { origin } = this.getGridBoardBounds(canvas);
        const placed = [];
        layout.forEach((rect, id) => {
            const card = canvas.querySelector(`.mini-card[data-grid-board="1"][data-id="${CSS.escape(id)}"]`);
            if (!card) return;
            this.applyNoteRect(card, rect, { settling: animate });
            card.classList.toggle('layout-preview', preview);
            if (save) {
                this.saveGridLayout(id, rect, {
                    customCompact: !card.classList.contains('expanded')
                        && this.isGridMultiCellSize(rect.w, rect.h)
                });
            }
            placed.push(rect);
        });
        this.updateGridCanvasMinHeight(canvas, placed, origin);
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
        const { origin, packW } = this.getGridBoardBounds(canvas);
        const viewportH = Math.max(200, (canvas.clientHeight || 400) / zoom - pad);
        return { origin, packW, viewportH };
    },

    squeezeGridBoardToViewport(canvas, { animate = true } = {}) {
        if (!canvas?.classList.contains('view-grid')) return;
        const { origin, packW, viewportH } = this.getGridViewportBounds(canvas);
        const bottomLimit = origin + viewportH;
        const cards = [...canvas.querySelectorAll('.mini-card[data-grid-board="1"]')];
        const pinnedIds = new Set(this.getBoardPins());
        const placed = [];
        const layout = new Map();
        const snapOpts = { packW, origin, maxH: bottomLimit + COLUMN_GRID_CELL_H };

        cards.forEach((card) => {
            const id = card.dataset.id;
            if (!id || !pinnedIds.has(id)) return;
            const isExpanded = this.isGridBoardCardExpanded(id, card);
            const rect = this.snapNoteRect(
                this.gridBoardRectForCard(card, this.readNoteRect(card), isExpanded),
                { maxW: packW, maxH: snapOpts.maxH }
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
                const isExpanded = this.isGridBoardCardExpanded(id, card);
                const rect = this.gridBoardRectForCard(card, this.readNoteRect(card), isExpanded);
                return { id, card, rect };
            })
            .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);

        unpinned.forEach(({ id, rect }) => {
            let preferred = { ...rect };
            if (preferred.y + preferred.h > bottomLimit + 2) {
                preferred = { ...preferred, y: origin };
            }
            let snapped = this.snapNoteRect(preferred, { maxW: packW, maxH: snapOpts.maxH });
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
        if (forcing) {
            canvas.style.overflowY = 'auto';
            return;
        }
        const { origin, viewportH } = this.getGridViewportBounds(canvas);
        const bottomLimit = origin + viewportH;
        const cards = canvas.querySelectorAll('.mini-card[data-grid-board="1"]');
        let contentBottom = origin;
        cards.forEach((card) => {
            const rect = this.readNoteRect(card);
            contentBottom = Math.max(contentBottom, rect.y + rect.h);
        });
        const fits = contentBottom <= bottomLimit + 4;
        canvas.style.overflowY = fits ? 'hidden' : 'auto';
        if (fits) {
            const placed = [...cards].map((c) => this.readNoteRect(c));
            this.updateGridCanvasMinHeight(canvas, placed, origin);
        }
    },

    reflowGridBoard(canvas, actorId, { animate = true } = {}) {
        if (!canvas?.classList.contains('view-grid')) return;
        const layout = this.computeGridBoardLayout(canvas, actorId);
        this.applyGridBoardLayout(canvas, layout, { animate, save: true });
        this.squeezeGridBoardToViewport(canvas, { animate });
    },

    initGridBoardCardStack(card, orderIndex = 0) {
        if (card.dataset.gridBoard !== '1') return;
        const z = orderIndex + 1;
        card.style.setProperty('z-index', String(z), 'important');
        if (z >= gridStackSeq) gridStackSeq = z + 1;
    },

    raiseLayoutCard(card) {
        if (!card) return;
        gridStackSeq += 1;
        card.style.setProperty('z-index', String(gridStackSeq), 'important');
        if (card.dataset.gridBoard === '1') {
            card.classList.add('is-grid-front');
            card.closest('#app-canvas')?.querySelectorAll('.mini-card.is-grid-front').forEach((other) => {
                if (other !== card) other.classList.remove('is-grid-front');
            });
            return;
        }
        if (card.dataset.columnNote === '1') {
            card.classList.add('is-column-front');
            card.closest('.column-notes')?.querySelectorAll('.mini-card.is-column-front').forEach((other) => {
                if (other !== card) other.classList.remove('is-column-front');
            });
        }
    },

    raiseGridBoardCard(card) {
        if (!card || card.dataset.gridBoard !== '1') return;
        this.raiseLayoutCard(card);
    },

    getCanvasLayoutOrder() {
        try {
            const raw = JSON.parse(localStorage.getItem(CANVAS_LAYOUT_ORDER_KEY) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch {
            return [];
        }
    },

    saveCanvasLayoutOrder(order) {
        localStorage.setItem(CANVAS_LAYOUT_ORDER_KEY, JSON.stringify(order));
    },

    appendToCanvasOrder(entry) {
        const order = this.getCanvasLayoutOrder();
        const exists = order.some((e) => {
            if (entry.type === 'category' && e.type === 'category') {
                return String(e.name).toLowerCase() === String(entry.name).toLowerCase();
            }
            if (entry.type === 'float' && e.type === 'float') return e.id === entry.id;
            return false;
        });
        if (!exists) {
            order.push(entry);
            this.saveCanvasLayoutOrder(order);
        }
    },

    getCanvasOrderIndex(entry) {
        return this.getCanvasLayoutOrder().findIndex((e) => {
            if (entry.type === 'category' && e.type === 'category') {
                return String(e.name).toLowerCase() === String(entry.name).toLowerCase();
            }
            if (entry.type === 'float' && e.type === 'float') return e.id === entry.id;
            return false;
        });
    },

    buildInitialCanvasOrder(activeCategories, visibleItems) {
        const events = [];
        activeCategories.forEach((catObj, idx) => {
            const name = typeof catObj === 'string' ? catObj : catObj.name;
            const inCat = visibleItems.filter((item) => {
                if (!itemHasCategory(item)) return false;
                return String(item.categories[0]).toLowerCase() === String(name).toLowerCase();
            });
            const ts = inCat.length
                ? Math.min(...inCat.map((item) => Number(item.created_at || 0)))
                : 1e15 + idx;
            events.push({ type: 'category', name, ts, tie: idx });
        });
        const uncatItems = visibleItems.filter((item) => !itemHasCategory(item));
        if (uncatItems.length > 0) {
            const ts = Math.min(...uncatItems.map((item) => Number(item.created_at || 0)));
            events.push({ type: 'category', name: UNCATEGORIZED_CATEGORY, ts, tie: 9999 });
        }
        events.sort((a, b) => a.ts - b.ts || a.tie - b.tie);
        return events.map(({ type, name }) => ({ type, name }));
    },

    syncCanvasLayoutOrder(activeCategories, visibleItems) {
        let order = this.getCanvasLayoutOrder().map((entry) => {
            if (entry.type === 'float') return { type: 'category', name: UNCATEGORIZED_CATEGORY };
            return entry;
        });
        const visibleCatNames = new Set(
            activeCategories.map((c) => (typeof c === 'string' ? c : c.name))
        );
        const hasUncat = visibleItems.some((item) => !itemHasCategory(item));
        if (hasUncat) visibleCatNames.add(UNCATEGORIZED_CATEGORY);

        const seen = new Set();
        order = order.filter((entry) => {
            if (entry.type !== 'category') return false;
            const key = categoryKey(entry.name);
            if (seen.has(key)) return false;
            if (!visibleCatNames.has(entry.name)) return false;
            seen.add(key);
            return true;
        });

        activeCategories.forEach((catObj) => {
            const name = typeof catObj === 'string' ? catObj : catObj.name;
            if (!order.some((e) => e.type === 'category' && categoryKey(e.name) === categoryKey(name))) {
                order.push({ type: 'category', name });
            }
        });

        if (hasUncat && !order.some((e) => isUncategorizedCategory(e.name))) {
            order.push({ type: 'category', name: UNCATEGORIZED_CATEGORY });
        }

        if (order.length === 0) {
            order = this.buildInitialCanvasOrder(activeCategories, visibleItems);
        }

        this.saveCanvasLayoutOrder(order);
        return order;
    },

    getCanvasElementForOrderEntry(canvas, entry) {
        if (!canvas || !entry) return null;
        if (entry.type === 'category') {
            return [...canvas.querySelectorAll('.canvas-column')].find(
                (col) => col.dataset.category?.toLowerCase() === String(entry.name).toLowerCase()
            ) || null;
        }
        if (entry.type === 'float') {
            return canvas.querySelector(`.canvas-column[data-category="${UNCATEGORIZED_CATEGORY}"]`)
                || canvas.querySelector(`.mini-card[data-columns-float="1"][data-id="${entry.id}"]`);
        }
        return null;
    },

    measureCanvasOrderEntry(el) {
        if (!el) return { w: CANVAS_GRID_W, h: 200 };
        if (el.classList.contains('canvas-column')) {
            return {
                w: el.offsetWidth || CANVAS_GRID_W,
                h: el.offsetHeight || COLUMN_HEADER_APPROX_H + COLUMN_GRID_CELL_H
            };
        }
        const rect = this.readNoteRect(el);
        return { w: rect.w, h: rect.h };
    },

    snapCanvasCoord(value, origin = CANVAS_LAYOUT_ORIGIN, stride = COLUMN_STRIDE_X) {
        return origin + this.snapGridCoord(Math.max(0, value - origin), stride);
    },

    getCanvasPackBounds(canvas) {
        const canvasW = Math.max(canvas?.clientWidth || 320, CANVAS_GRID_W + CANVAS_LAYOUT_ORIGIN * 2);
        return {
            origin: CANVAS_LAYOUT_ORIGIN,
            packW: canvasW - CANVAS_LAYOUT_ORIGIN * 2,
            canvasW
        };
    },

    findFirstCanvasSlot(w, h, placed, canvasW, { origin = CANVAS_LAYOUT_ORIGIN } = {}) {
        const packW = Math.max(CANVAS_GRID_W, canvasW - origin * 2);
        const xOrigin = origin + (w <= COLUMN_GRID_CELL_W + 1 ? COLUMN_INNER_PAD : 0);
        const rowStride = w <= COLUMN_GRID_CELL_W + 1 ? COLUMN_STRIDE_X : CANVAS_GRID_W;
        let y = origin;
        let guard = 0;
        while (guard < 800) {
            let x = xOrigin;
            while (x + w <= origin + packW + 1) {
                const candidate = {
                    x: this.snapCanvasCoord(x, origin, COLUMN_STRIDE_X),
                    y: this.snapCanvasCoord(y, origin, COLUMN_STRIDE_Y),
                    w,
                    h
                };
                if (!placed.some((p) => this.rectsOverlap(candidate, p, CANVAS_PACK_GAP))) {
                    return candidate;
                }
                x += rowStride;
            }
            y += COLUMN_STRIDE_Y;
            guard += 1;
        }
        return { x: xOrigin, y: origin, w, h };
    },

    applyCanvasOrderEntryPosition(el, entry, rect, { animate = false, snap = true } = {}) {
        if (!el || !entry) return;
        if (entry.type === 'category') {
            el.style.position = 'absolute';
            el.style.left = `${rect.x}px`;
            el.style.top = `${rect.y}px`;
            el.classList.toggle('layout-settling', animate);
            if (entry.name) this.saveColumnPosition(entry.name, rect.x, rect.y);
            return;
        }
        if (entry.type === 'float') {
            const maxW = el.closest('#app-canvas')?.clientWidth || window.innerWidth;
            const maxH = Math.max(
                el.closest('#app-canvas')?.scrollHeight || 0,
                window.innerHeight
            );
            const finalRect = snap
                ? this.snapNoteRect(rect, { maxW, maxH })
                : this.clampManualNoteRect(rect, { maxW, maxH });
            this.applyNoteRect(el, finalRect, { settling: animate });
            if (el.dataset.id) {
                this.saveColumnsFloatPosition(el.dataset.id, finalRect.x, finalRect.y);
                if (el.classList.contains('expanded')) {
                    this.saveColumnsFloatSize(el.dataset.id, finalRect.w, finalRect.h);
                }
            }
        }
    },

    layoutColumnInners(canvas, { animate = false } = {}) {
        if (!canvas) return;
        [...canvas.querySelectorAll('.canvas-column')].forEach((col) => {
            col.style.position = 'absolute';
            const cat = col.dataset.category;
            const notesEl = col.querySelector('.column-notes');
            if (!notesEl || !cat) return;
            if (col.classList.contains('is-collapsed')) {
                this.resizeColumnToFit(col, { animate });
                return;
            }
            const itemIds = [...notesEl.querySelectorAll('.mini-card')]
                .map((c) => c.dataset.id)
                .filter(Boolean);
            this.autoPackColumnNotes(notesEl, itemIds, cat);
            this.autoArrangeColumnNotes(notesEl, { animate });
        });
    },

    packCanvasInOrder(canvas, { animate = false, fromIndex = 0, pinned = null } = {}) {
        if (!canvas) return;
        const order = this.getCanvasLayoutOrder();
        if (!order.length) return;

        this.layoutColumnInners(canvas, { animate: false });

        const { packW, canvasW, origin } = this.getCanvasPackBounds(canvas);
        const placed = [];

        order.forEach((entry, index) => {
            const el = this.getCanvasElementForOrderEntry(canvas, entry);
            if (!el) return;

            const { w, h } = this.measureCanvasOrderEntry(el);
            let rect;

            const savedPos = this.getSavedCanvasPosition(entry);
            let snap = false;

            if (pinned && pinned.index === index && pinned.rect) {
                rect = { x: pinned.rect.x, y: pinned.rect.y, w, h };
            } else if (savedPos) {
                rect = { x: savedPos.x, y: savedPos.y, w, h };
            } else if (index < fromIndex) {
                rect = {
                    x: parseFloat(el.style.left) || origin,
                    y: parseFloat(el.style.top) || origin,
                    w,
                    h
                };
            } else {
                rect = this.findFirstCanvasSlot(w, h, placed, packW + origin * 2, { origin });
                snap = true;
            }

            this.applyCanvasOrderEntryPosition(el, entry, rect, { animate, snap });
            placed.push(rect);
        });

        const maxBottom = placed.reduce((m, r) => Math.max(m, r.y + r.h), 0);
        canvas.style.minHeight = `${maxBottom + origin + CANVAS_COL_GAP}px`;

        if (animate) {
            setTimeout(() => {
                canvas.querySelectorAll('.layout-settling').forEach((node) => {
                    node.classList.remove('layout-settling');
                });
            }, 140);
        }
    },

    layoutColumnView(canvas, { animate = false, fromIndex = 0, pinned = null } = {}) {
        if (!canvas) return;
        this.layoutColumnInners(canvas, { animate: false });
        requestAnimationFrame(() => {
            this.packCanvasInOrder(canvas, { animate, fromIndex, pinned });
        });
    },

    reflowCanvasFromOrderEntry(canvas, entry, { animate = true } = {}) {
        if (!canvas) return;
        const index = this.getCanvasOrderIndex(entry);
        if (index < 0) {
            this.layoutColumnView(canvas, { animate });
            return;
        }
        const el = this.getCanvasElementForOrderEntry(canvas, entry);
        if (!el) return;
        const { w, h } = this.measureCanvasOrderEntry(el);
        const rect = {
            x: parseFloat(el.style.left) || 0,
            y: parseFloat(el.style.top) || 0,
            w,
            h
        };
        this.layoutColumnView(canvas, {
            animate,
            fromIndex: index + 1,
            pinned: { index, rect }
        });
    },

    layoutColumnViewAfterRender(canvas, options = {}) {
        this.layoutColumnView(canvas, options);
    },

    snapGridCoord(value, stride = COLUMN_STRIDE_X) {
        return Math.max(0, Math.round(value / stride) * stride);
    },

    cellsToSpanW(cells) {
        const n = Math.max(1, cells);
        return n * COLUMN_GRID_CELL_W + (n - 1) * COLUMN_GRID_GAP;
    },

    cellsToSpanH(cells) {
        const n = Math.max(1, cells);
        return n * COLUMN_GRID_CELL_H + (n - 1) * COLUMN_GRID_GAP;
    },

    spanToCellsW(span) {
        return Math.max(1, Math.round((span + COLUMN_GRID_GAP) / COLUMN_STRIDE_X));
    },

    spanToCellsH(span) {
        return Math.max(1, Math.round((span + COLUMN_GRID_GAP) / COLUMN_STRIDE_Y));
    },

    getSavedCanvasPosition(entry) {
        if (!entry) return null;
        if (entry.type === 'category') {
            const pos = this.getColumnPositions()[entry.name];
            if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                return { x: pos.x, y: pos.y };
            }
        }
        if (entry.type === 'float') {
            const pos = this.getColumnsFloatPositions()[entry.id];
            if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
                return { x: pos.x, y: pos.y };
            }
        }
        return null;
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

    snapNoteRect(rect, { maxW = Infinity, maxH = Infinity } = {}) {
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
        return {
            x: this.snapGridCoord(rect.x, COLUMN_STRIDE_X),
            y: this.snapGridCoord(rect.y, COLUMN_STRIDE_Y),
            w: Math.max(FREEFORM_MIN_W, w),
            h: Math.max(FREEFORM_MIN_H, h)
        };
    },

    getColumnPositions() {
        try {
            return JSON.parse(localStorage.getItem('matrix_column_positions') || '{}');
        } catch {
            return {};
        }
    },

    saveColumnPosition(categoryName, x, y) {
        const positions = this.getColumnPositions();
        positions[categoryName] = { x: Math.round(x), y: Math.round(y) };
        localStorage.setItem('matrix_column_positions', JSON.stringify(positions));
    },

    getColumnSizes() {
        try {
            return JSON.parse(localStorage.getItem('matrix_column_sizes') || '{}');
        } catch {
            return {};
        }
    },

    saveColumnSize(categoryName, w, h) {
        const sizes = this.getColumnSizes();
        sizes[categoryName] = { w: Math.round(w), h: Math.round(h) };
        localStorage.setItem('matrix_column_sizes', JSON.stringify(sizes));
    },

    applyColumnCanvasSize(columnEl, w, h, { animate = false } = {}) {
        if (!columnEl) return;
        const collapsed = columnEl.classList.contains('is-collapsed');
        const colW = Math.max(CANVAS_GRID_W, Math.round(w));
        const colH = Math.max(COLUMN_MIN_CANVAS_H, Math.round(h));
        columnEl.style.width = `${colW}px`;
        columnEl.style.minHeight = `${colH}px`;
        if (collapsed) {
            columnEl.style.height = `${colH}px`;
        } else {
            columnEl.style.height = '';
        }
        const notesEl = columnEl.querySelector('.column-notes');
        if (notesEl && !collapsed) {
            const chromePad = 6;
            const notesH = Math.max(COLUMN_GRID_CELL_H, colH - COLUMN_HEADER_APPROX_H - COLUMN_INNER_PAD - chromePad);
            notesEl.style.minHeight = `${notesH}px`;
        }
        columnEl.classList.toggle('layout-settling', animate);
    },

    applySavedColumnSize(columnEl) {
        const cat = columnEl?.dataset.category;
        if (!cat) return;
        const saved = this.getColumnSizes()[cat];
        if (saved?.w && saved?.h) {
            this.applyColumnCanvasSize(columnEl, saved.w, saved.h);
        }
    },

    readColumnCanvasRect(columnEl) {
        if (!columnEl) return { x: 0, y: 0, w: CANVAS_GRID_W, h: COLUMN_MIN_CANVAS_H };
        return {
            x: parseFloat(columnEl.style.left) || 0,
            y: parseFloat(columnEl.style.top) || 0,
            w: columnEl.offsetWidth || CANVAS_GRID_W,
            h: columnEl.offsetHeight || parseFloat(columnEl.style.minHeight) || COLUMN_MIN_CANVAS_H
        };
    },

    getCanvasEntryRect(canvas, entry) {
        const el = this.getCanvasElementForOrderEntry(canvas, entry);
        if (!el) return null;
        if (entry.type === 'category') return this.readColumnCanvasRect(el);
        return this.readNoteRect(el);
    },

    pushOverlappingCanvasItems(canvas, pinnedEntry, { animate = true } = {}) {
        if (!canvas || !pinnedEntry) return;
        const order = this.getCanvasLayoutOrder();
        const pinnedIndex = this.getCanvasOrderIndex(pinnedEntry);
        if (pinnedIndex < 0) return;

        const pinnedRect = this.getCanvasEntryRect(canvas, pinnedEntry);
        if (!pinnedRect) return;

        const { origin } = this.getCanvasPackBounds(canvas);
        const canvasPackW = Math.max(canvas.clientWidth, CANVAS_GRID_W + origin * 2);
        const placed = [{ ...pinnedRect }];

        order.forEach((entry, index) => {
            if (index === pinnedIndex) return;
            const el = this.getCanvasElementForOrderEntry(canvas, entry);
            if (!el) return;

            let rect = this.getCanvasEntryRect(canvas, entry);
            if (!rect) return;

            const blocked = placed.some((p) => this.rectsOverlap(rect, p, CANVAS_PACK_GAP));
            if (!blocked) {
                placed.push({ ...rect });
                return;
            }

            const slot = this.findFirstCanvasSlot(rect.w, rect.h, placed, canvasPackW, { origin });
            rect = { x: slot.x, y: slot.y, w: rect.w, h: rect.h };
            this.applyCanvasOrderEntryPosition(el, entry, rect, {
                animate,
                snap: entry.type === 'float'
            });
            placed.push({ ...rect });
        });

        const maxBottom = placed.reduce((m, r) => Math.max(m, r.y + r.h), 0);
        canvas.style.minHeight = `${maxBottom + origin + CANVAS_COL_GAP}px`;
    },

    getColumnNoteLayout() {
        try {
            return JSON.parse(localStorage.getItem('matrix_column_note_layout') || '{}');
        } catch {
            return {};
        }
    },

    saveColumnNoteLayout(categoryName, itemId, rect, { customCompact = false } = {}) {
        const all = this.getColumnNoteLayout();
        if (!all[categoryName]) all[categoryName] = {};
        const entry = {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.w),
            h: Math.round(rect.h)
        };
        if (customCompact) entry.customCompact = true;
        all[categoryName][itemId] = entry;
        localStorage.setItem('matrix_column_note_layout', JSON.stringify(all));
    },

    removeColumnNoteLayout(itemId, categoryName = null) {
        const all = this.getColumnNoteLayout();
        if (categoryName) {
            if (all[categoryName]) delete all[categoryName][itemId];
        } else {
            Object.keys(all).forEach((cat) => delete all[cat][itemId]);
        }
        localStorage.setItem('matrix_column_note_layout', JSON.stringify(all));
    },

    getColumnsFloatPositions() {
        try {
            return JSON.parse(localStorage.getItem('matrix_columns_float_positions') || '{}');
        } catch {
            return {};
        }
    },

    saveColumnsFloatPosition(itemId, x, y) {
        const positions = this.getColumnsFloatPositions();
        positions[itemId] = { x: Math.round(x), y: Math.round(y) };
        localStorage.setItem('matrix_columns_float_positions', JSON.stringify(positions));
    },

    getColumnsFloatSizes() {
        try {
            return JSON.parse(localStorage.getItem('matrix_columns_float_sizes') || '{}');
        } catch {
            return {};
        }
    },

    saveColumnsFloatSize(itemId, w, h) {
        const sizes = this.getColumnsFloatSizes();
        sizes[itemId] = {
            w: Math.round(Math.max(FREEFORM_MIN_W, w)),
            h: Math.round(Math.max(FREEFORM_MIN_H, h))
        };
        localStorage.setItem('matrix_columns_float_sizes', JSON.stringify(sizes));
    },

    readNoteRect(card) {
        return {
            x: parseFloat(card.style.left) || 0,
            y: parseFloat(card.style.top) || 0,
            w: parseFloat(card.style.width) || card.offsetWidth || FREEFORM_DEFAULT_W,
            h: parseFloat(card.style.height) || card.offsetHeight || FREEFORM_DEFAULT_H
        };
    },

    applyNoteRect(card, rect, { settling = false } = {}) {
        card.style.position = 'absolute';
        card.style.left = `${rect.x}px`;
        card.style.top = `${rect.y}px`;
        this.applyFreeformDimensions(card, rect.w, rect.h);
        card.classList.toggle('layout-settling', settling);
    },

    getColumnNotesInnerWidth(columnNotesEl) {
        const column = columnNotesEl?.closest('.canvas-column');
        const w = column?.offsetWidth || CANVAS_GRID_W;
        return Math.max(COLUMN_MIN_INNER_W, w - COLUMN_INNER_PAD * 2);
    },

    getColumnNotesMaxHeight(columnNotesEl) {
        const column = columnNotesEl?.closest('.canvas-column');
        const cat = column?.dataset.category;
        const manual = cat ? this.getColumnSizes()[cat] : null;
        if (manual?.h) {
            const inner = manual.h - COLUMN_HEADER_APPROX_H - COLUMN_INNER_PAD - 6;
            return Math.max(this.cellsToSpanH(2), inner);
        }
        const canvas = columnNotesEl?.closest('#app-canvas');
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        const canvasH = canvas?.clientHeight || vh;
        return Math.max(this.cellsToSpanH(2), canvasH - COLUMN_HEADER_APPROX_H - 24);
    },

    rectsOverlap(a, b, gap = COLUMN_GRID_GAP) {
        return !(
            a.x + a.w + gap <= b.x
            || b.x + b.w + gap <= a.x
            || a.y + a.h + gap <= b.y
            || b.y + b.h + gap <= a.y
        );
    },

    autoPackColumnNotes(columnNotesEl, itemIds, categoryName) {
        const innerW = this.getColumnNotesInnerWidth(columnNotesEl);
        const saved = this.getColumnNoteLayout()[categoryName] || {};
        const expandedCards = getExpandedCards('columns');
        let rowX = 0;
        let rowY = 0;
        let rowMaxH = COLUMN_GRID_CELL_H;

        itemIds.forEach((itemId) => {
            const card = columnNotesEl.querySelector(`.mini-card[data-id="${itemId}"]`);
            if (!card) return;
            const isExpanded = expandedCards[itemId] === true || card.classList.contains('expanded');
            let rect = saved[itemId];

            if (rect && Number.isFinite(rect.x) && Number.isFinite(rect.w)) {
                this.applyNoteRect(card, rect);
                return;
            }

            if (isExpanded) {
                const w = Math.min(innerW, this.cellsToSpanW(COLUMN_MIN_COLS));
                const h = this.cellsToSpanH(2);
                if (rowX > 0) {
                    rowY += rowMaxH + COLUMN_GRID_GAP;
                    rowX = 0;
                    rowMaxH = COLUMN_GRID_CELL_H;
                }
                rect = { x: 0, y: rowY, w, h };
                rowY += h + COLUMN_GRID_GAP;
                rowMaxH = COLUMN_GRID_CELL_H;
                rowX = 0;
            } else {
                const w = COLUMN_GRID_CELL_W;
                const h = COLUMN_GRID_CELL_H;
                if (rowX + w > innerW + 1) {
                    rowY += rowMaxH + COLUMN_GRID_GAP;
                    rowX = 0;
                    rowMaxH = COLUMN_GRID_CELL_H;
                }
                rect = { x: rowX, y: rowY, w, h };
                rowX += w + COLUMN_GRID_GAP;
                rowMaxH = Math.max(rowMaxH, h);
            }
            this.applyNoteRect(card, rect);
        });
    },

    autoArrangeColumnNotes(columnNotesEl, { animate = false } = {}) {
        if (!columnNotesEl) return;
        const cards = [...columnNotesEl.querySelectorAll('.mini-card[data-column-note="1"]')];
        if (cards.length === 0) {
            const collapsed = columnNotesEl.closest('.canvas-column')?.classList.contains('is-collapsed');
            columnNotesEl.querySelector('.column-empty-slot')?.remove();
            if (!collapsed) {
                const slot = document.createElement('div');
                slot.className = 'column-empty-slot';
                slot.setAttribute('aria-hidden', 'true');
                columnNotesEl.appendChild(slot);
            }
            columnNotesEl.style.minHeight = collapsed ? '0' : `${COLUMN_GRID_CELL_H}px`;
            const column = columnNotesEl.closest('.canvas-column');
            if (column) this.resizeColumnToFit(column, { animate });
            return;
        }
        columnNotesEl.querySelector('.column-empty-slot')?.remove();
        this.reflowColumnNotesPanel(columnNotesEl, null, { animate });
    },

    resizeColumnToFit(columnEl, { animate = false } = {}) {
        if (!columnEl) return;
        const collapsed = columnEl.classList.contains('is-collapsed');
        const cat = columnEl.dataset.category;
        const manual = cat ? this.getColumnSizes()[cat] : null;
        const notesEl = columnEl.querySelector('.column-notes');
        let innerW = COLUMN_MIN_INNER_W;
        let contentH = 0;

        if (!collapsed && notesEl) {
            const cards = [...notesEl.querySelectorAll('.mini-card')];
            innerW = cards.reduce((max, card) => {
                const r = this.readNoteRect(card);
                return Math.max(max, r.x + r.w);
            }, COLUMN_MIN_INNER_W);
            contentH = cards.reduce((max, card) => {
                const r = this.readNoteRect(card);
                return Math.max(max, r.y + r.h);
            }, 0);
            if (cards.length === 0) contentH = COLUMN_GRID_CELL_H;
            contentH = Math.max(contentH + COLUMN_GRID_GAP, parseFloat(notesEl.style.minHeight) || 0, notesEl.offsetHeight);
        } else if (notesEl) {
            notesEl.style.minHeight = '0';
        }

        const contentColW = Math.max(CANVAS_GRID_W, innerW + COLUMN_INNER_PAD * 2);
        const contentColH = COLUMN_HEADER_APPROX_H + contentH + COLUMN_INNER_PAD;
        const colW = manual?.w ? Math.max(manual.w, contentColW) : contentColW;
        const colH = manual?.h ? Math.max(manual.h, collapsed ? COLUMN_HEADER_APPROX_H + COLUMN_INNER_PAD : contentColH) : contentColH;

        if (manual?.w || manual?.h) {
            this.applyColumnCanvasSize(columnEl, colW, colH, { animate });
            return;
        }

        columnEl.style.width = `${colW}px`;
        columnEl.style.minHeight = `${colH}px`;
        columnEl.style.height = collapsed ? `${colH}px` : '';
        if (notesEl && !collapsed) {
            const notesH = Math.max(COLUMN_GRID_CELL_H, colH - COLUMN_HEADER_APPROX_H - COLUMN_INNER_PAD - 6);
            notesEl.style.minHeight = `${notesH}px`;
        }
        if (animate) columnEl.classList.add('layout-settling');
        else columnEl.classList.remove('layout-settling');
    },

    autoArrangeCanvasColumns(canvas, { animate = false } = {}) {
        if (!canvas) return;
        const columns = [...canvas.querySelectorAll('.canvas-column')];
        if (!columns.length) return;

        const canvasW = Math.max(canvas.clientWidth, 320);
        const sorted = columns
            .map((col) => {
                const x = parseFloat(col.style.left) || 0;
                const y = parseFloat(col.style.top) || 0;
                return { col, x, y, w: col.offsetWidth, h: col.offsetHeight };
            })
            .sort((a, b) => a.y - b.y || a.x - b.x);

        const placed = [];
        sorted.forEach(({ col, x, y, w, h }) => {
            let nx = this.snapGridCoord(x, CANVAS_GRID_W);
            let ny = this.snapGridCoord(y, CANVAS_GRID_W);
            let guard = 0;
            let box = { x: nx, y: ny, w, h };
            while (placed.some((p) => this.rectsOverlap(box, p, CANVAS_COL_GAP)) && guard < 100) {
                const blocker = placed.find((p) => this.rectsOverlap(box, p, CANVAS_COL_GAP));
                if (!blocker) break;
                if (nx + w + CANVAS_COL_GAP + w <= canvasW) {
                    nx = blocker.x + blocker.w + CANVAS_COL_GAP;
                } else {
                    nx = 0;
                    ny = blocker.y + blocker.h + CANVAS_COL_GAP;
                }
                box = { x: nx, y: ny, w, h };
                guard += 1;
            }
            col.style.position = 'absolute';
            col.style.left = `${nx}px`;
            col.style.top = `${ny}px`;
            col.classList.toggle('layout-settling', animate);
            placed.push(box);
            const cat = col.dataset.category;
            if (cat) this.saveColumnPosition(cat, nx, ny);
        });

        const maxBottom = placed.reduce((m, b) => Math.max(m, b.y + b.h), 0);
        canvas.style.minHeight = `${maxBottom + CANVAS_COL_GAP}px`;
    },

    finalizeColumnNote(card, categoryName) {
        if (card.dataset.columnNote !== '1') return;
        card.style.position = 'absolute';
        this.setupFreeformChrome(card);
        const saved = this.getColumnNoteLayout()[categoryName]?.[card.dataset.id];
        const isExpanded = card.classList.contains('expanded');
        if (!isExpanded) {
            const compact = this.gridCompactRect(
                { x: 0, y: 0, w: COLUMN_GRID_CELL_W, h: COLUMN_GRID_CELL_H },
                saved
            );
            this.applyFreeformDimensions(card, compact.w, compact.h);
        } else if (saved?.w && saved?.h) {
            this.applyFreeformDimensions(card, saved.w, saved.h);
        } else {
            const innerW = this.cellsToSpanW(COLUMN_MIN_COLS);
            this.applyFreeformDimensions(card, innerW, this.cellsToSpanH(2));
        }
    },

    finalizeColumnsFloat(card) {
        if (card.dataset.columnsFloat !== '1') return;
        card.style.position = 'absolute';
        this.setupFreeformChrome(card);
        const saved = this.getColumnsFloatSizes()[card.dataset.id];
        const isExpanded = card.classList.contains('expanded');
        if (isExpanded) {
            const w = saved?.w ?? FREEFORM_EXPANDED_W;
            const h = saved?.h ?? FREEFORM_EXPANDED_DEFAULT_H;
            this.applyFreeformDimensions(card, w, h);
        } else {
            this.applyFreeformDimensions(card, FREEFORM_DEFAULT_W, FREEFORM_DEFAULT_H);
        }
    },

    isColumnLayoutCard(card) {
        return card?.dataset?.columnNote === '1' || card?.dataset?.columnsFloat === '1';
    },

    columnDragZoneClass(card) {
        if (card.dataset.columnNote === '1' || card.dataset.columnsFloat === '1') {
            return ' card-drag-zone';
        }
        return this.freeformDragZoneClass(card);
    },

    initFreeformCardStack(card, orderIndex = 0) {
        if (card.dataset.freeform !== '1') return;
        const z = orderIndex + 1;
        card.style.setProperty('z-index', String(z), 'important');
        if (z >= freeformStackSeq) freeformStackSeq = z + 1;
    },

    raiseFreeformCard(card) {
        if (!card || card.dataset.freeform !== '1') return;
        freeformStackSeq += 1;
        card.style.setProperty('z-index', String(freeformStackSeq), 'important');
        card.classList.add('is-freeform-front');
        card.closest('#app-canvas')?.querySelectorAll('.mini-card.is-freeform-front').forEach((other) => {
            if (other !== card) other.classList.remove('is-freeform-front');
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
    },

    escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },

    escapeAttr(str) {
        return this.escapeHTML(str).replace(/"/g, '&quot;');
    }
};
