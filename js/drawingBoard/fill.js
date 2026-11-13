/** @module {"owns":"magicCanvas shape fill - fill-colour pref and selection-first restyling of shape interiors","related":["drawingBoard.js","drawingBoardToolbar.js","drawingBoard/prefs.js","canvasBrushes.js"]} */
import { SHAPE_FILL_TOOLS } from '../canvasBrushes.js';
import { normalizeShapeFill, writePrefs } from './prefs.js';

/** Stored fill for new shapes ('' = outline only). */
export function shapeFillColor(board) {
    return normalizeShapeFill(board?.prefs?.shapeFill);
}

/** True for a closed shape the fill swatch can paint. */
export function isFillableShape(item) {
    return !!item && SHAPE_FILL_TOOLS.includes(item.tool);
}

/**
 * Selected shapes the fill control can restyle. Images, text boxes, plain
 * strokes and connectors have no interior, so they are skipped rather than
 * counted as no-op changes.
 */
export function fillTargets(board) {
    const selected = typeof board?.getSelectedStrokesArray === 'function'
        ? board.getSelectedStrokesArray()
        : Array.from(board?.selectedStrokes || []);
    return selected.filter(isFillableShape);
}

function requestRedraw(board) {
    if (typeof board?.requestRedraw === 'function') board.requestRedraw();
    else if (typeof board?.redraw === 'function') board.redraw();
}

/**
 * Apply a fill to every selected shape. Dry-run first so a no-op (same fill)
 * does not push an undo entry the next Ctrl+Z would burn on nothing.
 * @returns {number} how many shapes changed
 */
export function applyShapeFill(board, fill) {
    const next = normalizeShapeFill(fill);
    const updates = fillTargets(board).filter((target) => normalizeShapeFill(target.fillColor) !== next);
    if (!updates.length) return 0;

    board.pushLayerHistory();
    for (const target of updates) {
        // "No fill" is the absence of the key, not a transparent colour, so a
        // shape never keeps a dead '#00000000' (or an ignored 'none') behind.
        if (next) target.fillColor = next;
        else delete target.fillColor;
    }
    board.scheduleSave();
    requestRedraw(board);
    return updates.length;
}

/**
 * Pick a fill colour: always remembered for future shapes, applied to the
 * current selection when it changes anything.
 * @param {object} board
 * @param {string} fill 6-digit hex, or '' for no fill
 * @param {{rerender?: boolean}} [opts]
 */
export function setShapeFill(board, fill, { rerender = true } = {}) {
    const next = normalizeShapeFill(fill);
    // Written before the dry-run: a fill picked on an already-matching
    // selection still has to seed the next shape the user draws.
    if (board?.prefs) {
        board.prefs.shapeFill = next;
        writePrefs(board.prefs);
    }
    const changed = applyShapeFill(board, next);
    if (rerender && typeof board?.renderToolbar === 'function') board.renderToolbar();
    else if (typeof board?.updateShapeFillChip === 'function') board.updateShapeFillChip(next);
    return changed;
}
