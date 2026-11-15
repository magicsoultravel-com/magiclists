/** @module {"owns":"magicCanvas stroke colour - stroke-colour pref and selection-first restyling of shape borders and freehand strokes","related":["drawingBoard.js","drawingBoardToolbar.js","drawingBoard/prefs.js","canvasBrushes.js"]} */
import { DRAG_SHAPE_TOOLS } from '../canvasBrushes.js';
import { writePrefs } from './prefs.js';

/**
 * Stored stroke colour for the active brush style. Shapes and freehand strokes
 * are both seeded from it, so it doubles as the "next border" colour.
 */
export function strokeColor(board) {
    const stored = board?.prefs?.styles?.[board?.activeStyle]?.color;
    return stored ? String(stored) : '';
}

/**
 * True for an item whose outline is painted with `color`: canvasBrushes.js reads
 * `stroke.color` for drag shapes and freehand strokes alike. Text boxes and
 * images are excluded because their colour/pixels belong to the text and image
 * controls, and a shape's `label.color` is never touched — the text picker owns
 * labels, so restyling a border must not drag the label along with it.
 */
export function isBorderTarget(item) {
    if (!item) return false;
    if (item.tool === 'brush') return true;
    return DRAG_SHAPE_TOOLS.includes(item.tool);
}

/** Selected items the colour chip can restyle. */
export function strokeTargets(board) {
    const selected = typeof board?.getSelectedStrokesArray === 'function'
        ? board.getSelectedStrokesArray()
        : Array.from(board?.selectedStrokes || []);
    return selected.filter(isBorderTarget);
}

function requestRedraw(board) {
    if (typeof board?.requestRedraw === 'function') board.requestRedraw();
    else if (typeof board?.redraw === 'function') board.redraw();
}

/** Case-insensitive: '#FF0000' and '#ff0000' are the same paint. */
function sameColor(a, b) {
    return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * Apply a stroke colour to every selected border-bearing item. Dry-run first so
 * a no-op (same colour) does not push an undo entry the next Ctrl+Z would burn
 * on nothing.
 *
 * An empty colour is refused: unlike a fill there is no "no border" state, so
 * writing '' would simply make the shape invisible.
 * @returns {number} how many items changed
 */
export function applyStrokeColor(board, color) {
    const next = String(color || '').trim();
    if (!next) return 0;
    const updates = strokeTargets(board).filter((target) => !sameColor(target.color, next));
    if (!updates.length) return 0;

    board.pushLayerHistory();
    for (const target of updates) target.color = next;
    board.scheduleSave();
    requestRedraw(board);
    return updates.length;
}

/**
 * Pick a stroke colour: always remembered for future strokes, applied to the
 * current selection when it changes anything.
 * @param {object} board
 * @param {string} color hex string from the picker
 * @param {{rerender?: boolean}} [opts]
 */
export function setStrokeColor(board, color, { rerender = true } = {}) {
    const next = String(color || '').trim();
    const style = board?.activeStyle;
    // Written before the dry-run: a colour picked on an already-matching
    // selection still has to seed the next stroke the user draws.
    if (next && style && board?.prefs?.styles?.[style]) {
        board.prefs.styles[style].color = next;
        writePrefs(board.prefs);
    }
    const changed = applyStrokeColor(board, next);
    if (rerender && typeof board?.renderToolbar === 'function') board.renderToolbar();
    else if (typeof board?.updateColorChip === 'function') board.updateColorChip(next);
    return changed;
}

/**
 * Swatch value: the colour the whole selection agrees on, otherwise the stored
 * pref. Mirrors currentTextSize, so the chip never claims a colour the
 * selection does not actually have.
 */
export function currentStrokeColor(board) {
    const colors = strokeTargets(board).map((target) => String(target.color || '').trim().toLowerCase());
    const shared = colors.length && colors.every((color) => color === colors[0]) ? colors[0] : '';
    return shared || strokeColor(board);
}
