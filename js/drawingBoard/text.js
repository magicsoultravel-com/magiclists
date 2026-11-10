/** @module {"owns":"magicCanvas text styling - text colour/size prefs and selection-first restyling of shape labels and text boxes","related":["drawingBoard.js","drawingBoardToolbar.js","drawingBoardFlowchart.js","drawingBoardSelection.js","flowchart.js","drawingBoard/prefs.js"]} */
import {
    FLOW_LABEL_MAX,
    FLOW_LABEL_MIN,
    normalizeFlowLabelSize
} from '../flowchart.js';
import {
    TEXT_COLOR_DEFAULT,
    TEXT_SIZE_DEFAULT,
    TEXT_SIZE_MAX,
    TEXT_SIZE_MIN,
    TEXT_SIZE_STEP,
    readTextPrefs,
    writePrefs
} from './prefs.js';

/**
 * Device pixel ratio the canvas is painted at. World coordinates are dpr-scaled,
 * so a CSS-px text size becomes `css * dpr` canvas units on the way in and
 * `canvas / dpr` CSS px on screen.
 */
export function textDpr() {
    const dpr = Number(globalThis.window?.devicePixelRatio);
    return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

/** Stored text style ({ color, size } in CSS px) with defaults applied. */
export function textStyle(board) {
    return readTextPrefs(board?.prefs?.text);
}

/** True when a stroke carries visible label text (shapes and connectors). */
export function hasLabel(item) {
    return !!(item && item.label && String(item.label.text || '').trim());
}

/** True for free-floating text objects (`tool: 'text'`, no flowchart label). */
export function isTextBox(item) {
    return !!(item && item.tool === 'text' && !hasLabel(item));
}

/**
 * Selected items the text controls can restyle. Images and plain strokes have
 * no text, so they are skipped rather than counted as no-op changes.
 */
export function textTargets(board) {
    const selected = typeof board?.getSelectedStrokesArray === 'function'
        ? board.getSelectedStrokesArray()
        : Array.from(board?.selectedStrokes || []);
    return selected.filter((item) => hasLabel(item) || isTextBox(item));
}

/**
 * Canvas-unit size a target gets for a CSS-px request.
 * Labels clamp inside the shape (a 40-unit-tall box cannot hold 72px text), so
 * the same request can produce different results per target — by design.
 */
export function sizeForTarget(target, cssSize, dpr = textDpr()) {
    const canvas = Math.round(Number(cssSize) * dpr);
    if (hasLabel(target)) {
        return Math.min(FLOW_LABEL_MAX, Math.max(FLOW_LABEL_MIN, normalizeFlowLabelSize(canvas)));
    }
    return Math.max(1, canvas);
}

/** Current size of a target in CSS px. */
export function cssSizeOf(target, dpr = textDpr()) {
    if (hasLabel(target)) return normalizeFlowLabelSize(target.label.fontSize) / dpr;
    const stored = Number(target?.fontSize);
    const canvas = Number.isFinite(stored) && stored > 0 ? stored : TEXT_SIZE_DEFAULT * dpr;
    return canvas / dpr;
}

/**
 * Allowed CSS-px range for the current selection. A label-only selection caps at
 * the label painter's ceiling, so "+" never looks dead on a retina canvas.
 */
export function textSizeRange(board, dpr = textDpr()) {
    const targets = textTargets(board);
    const labelOnly = targets.some(hasLabel) && !targets.some(isTextBox);
    const labelCap = Math.max(TEXT_SIZE_MIN, Math.min(TEXT_SIZE_MAX, Math.floor(FLOW_LABEL_MAX / dpr)));
    return { min: TEXT_SIZE_MIN, max: labelOnly ? labelCap : TEXT_SIZE_MAX };
}

/**
 * Value the stepper shows: the shared size when the selection agrees, otherwise
 * the stored pref, clamped into the selection's range.
 */
export function currentTextSize(board) {
    const dpr = textDpr();
    const range = textSizeRange(board, dpr);
    const sizes = textTargets(board).map((item) => Math.round(cssSizeOf(item, dpr)));
    const common = sizes.length && sizes.every((size) => size === sizes[0]) ? sizes[0] : null;
    const raw = common != null ? common : textStyle(board).size;
    return Math.min(range.max, Math.max(range.min, raw));
}

/**
 * Apply a colour and/or CSS-px size to every selected text target.
 * Dry-run first so a no-op (same colour, size already at the label cap) does not
 * push an undo entry the next Ctrl+Z would burn on nothing.
 * @returns {number} how many targets changed
 */
export function applyTextStyle(board, patch = {}) {
    const dpr = textDpr();
    const updates = [];
    for (const target of textTargets(board)) {
        const label = hasLabel(target);
        const next = {};
        if (patch.color) {
            const before = label ? String(target.label.color || '') : String(target.color || '');
            if (before !== patch.color) next.color = patch.color;
        }
        if (patch.size != null) {
            const size = sizeForTarget(target, patch.size, dpr);
            const before = label
                ? normalizeFlowLabelSize(target.label.fontSize)
                : Math.round(Number(target.fontSize) || 0);
            if (size !== before) next.size = size;
        }
        if (Object.keys(next).length) updates.push([target, next]);
    }
    if (!updates.length) return 0;

    board.pushLayerHistory();
    for (const [target, next] of updates) {
        if (next.size != null) {
            if (hasLabel(target)) target.label.fontSize = next.size;
            else target.fontSize = next.size;
        }
        if (next.color != null) {
            if (hasLabel(target)) target.label.color = next.color;
            else target.color = next.color;
        }
    }
    board.scheduleSave();
    requestRedraw(board);
    return updates.length;
}

/**
 * Pick a text colour: always remembered for future text, applied to the current
 * selection when it changes anything.
 * @param {object} board
 * @param {string} colour
 * @param {{rerender?: boolean}} [opts]
 */
export function setTextColor(board, colour, { rerender = true } = {}) {
    const next = String(colour || '').trim() || TEXT_COLOR_DEFAULT;
    // Written before the dry-run: a colour picked on an already-matching
    // selection still has to seed the next text box the user creates.
    if (board?.prefs) {
        board.prefs.text = { ...textStyle(board), color: next };
        writePrefs(board.prefs);
    }
    const changed = applyTextStyle(board, { color: next });
    if (rerender && typeof board?.renderToolbar === 'function') board.renderToolbar();
    else if (typeof board?.updateTextColorChip === 'function') board.updateTextColorChip(next);
    return changed;
}

/** Set the text size (CSS px), clamped into the selection's range. */
export function setTextSize(board, size) {
    const range = textSizeRange(board);
    const next = Math.min(range.max, Math.max(range.min, Math.round(Number(size) || textStyle(board).size)));
    const style = textStyle(board);
    if (board?.prefs && style.size !== next) {
        board.prefs.text = { ...style, size: next };
        writePrefs(board.prefs);
    }
    return applyTextStyle(board, { size: next });
}

/** Step the text size by one increment (+1 / -1) through the stepper. */
export function stepTextSize(board, delta) {
    return setTextSize(board, currentTextSize(board) + Math.sign(delta) * TEXT_SIZE_STEP);
}

function requestRedraw(board) {
    if (typeof board?.requestRedraw === 'function') board.requestRedraw();
    else if (typeof board?.redraw === 'function') board.redraw();
}
