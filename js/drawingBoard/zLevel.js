/** @module {"owns":"magicCanvas z-level of the current selection - top/middle/bottom buttons act on selected items only","related":["drawingBoard.js","drawingBoardToolbar.js","canvasZOrder.js","lassoGeometry.js"]} */
import { Z_BOTTOM, Z_MIDDLE, Z_TOP, normalizeZLevel, zLevelOf } from '../canvasZOrder.js';

/** Selected items — strokes, shapes, connectors, texts and images alike. */
function selectedItems(board) {
    if (typeof board?.getSelectedStrokesArray === 'function') return board.getSelectedStrokesArray();
    return Array.from(board?.selectedStrokes || []);
}

/**
 * Selection summary for the layer buttons: how many items, and the level they
 * all agree on (`null` when they disagree). Empty and mixed both render as
 * "nothing pressed", which is exactly the middle layer's own readout.
 *
 * @returns {{ count: number, level: number|null }}
 */
export function selectionState(board) {
    const items = selectedItems(board);
    if (!items.length) return { count: 0, level: null };
    const first = zLevelOf(items[0]);
    const level = items.every((item) => zLevelOf(item) === first) ? first : null;
    return { count: items.length, level };
}

/**
 * Level the whole selection agrees on, or null when it is empty or mixed.
 * `null` is what the toolbar renders as "both buttons off" — the same shape as
 * the colour chip's mixed-selection fallback, but with no pref to fall back to
 * because a level is a property of the item, never a mode.
 *
 * @returns {number|null} -1, 0, 1 or null
 */
export function selectionZLevel(board) {
    return selectionState(board).level;
}

function requestRedraw(board) {
    if (typeof board?.requestRedraw === 'function') board.requestRedraw();
    else if (typeof board?.redraw === 'function') board.redraw();
}

/**
 * Re-level the selection. Dry run first so a no-op (the selection already sits
 * on that level) pushes no undo entry the next Ctrl+Z would burn on nothing.
 *
 * Level 0 deletes the field instead of storing `0`, so a middle-layer document
 * keeps looking exactly like one saved before layers existed.
 *
 * @param {number} level -1 (bottom), 0 (middle) or 1 (top)
 * @returns {number} how many items changed
 */
export function applyZLevel(board, level) {
    const next = normalizeZLevel(level);
    const updates = selectedItems(board).filter((item) => zLevelOf(item) !== next);
    if (!updates.length) return 0;

    board.pushLayerHistory();
    for (const item of updates) {
        if (next === Z_MIDDLE) delete item.zLevel;
        else item.zLevel = next;
    }
    board.scheduleSave();
    requestRedraw(board);
    return updates.length;
}

/**
 * Toolbar action. The pressed button moves the selection to that level; clicking
 * it again drops the selection back to the middle, which is the "leaving both
 * off means middle layer" half of the control.
 *
 * No selection means nothing happens — the buttons render disabled, this guard
 * only stops a stray programmatic call from writing history.
 *
 * @param {number} level 1 (top) or -1 (bottom)
 * @returns {number} how many items changed
 */
export function setZLevel(board, level) {
    const next = normalizeZLevel(level);
    if (next === Z_MIDDLE || !selectedItems(board).length) return 0;
    const target = selectionZLevel(board) === next ? Z_MIDDLE : next;
    const changed = applyZLevel(board, target);
    if (typeof board?.updateLayerControls === 'function') board.updateLayerControls();
    return changed;
}

export { Z_BOTTOM, Z_MIDDLE, Z_TOP };
