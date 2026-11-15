/** @module {"owns":"magicCanvas text styling - text colour/size/angle prefs and selection-first restyling of shape labels and text boxes","related":["drawingBoard.js","drawingBoardToolbar.js","drawingBoardFlowchart.js","drawingBoardSelection.js","flowchart.js","textAngle.js","drawingBoard/prefs.js"]} */
import {
    FLOW_LABEL_MAX,
    FLOW_LABEL_MIN,
    normalizeFlowLabelSize
} from '../flowchart.js';
import {
    normalizeTextAngle,
    textAngleOf
} from '../textAngle.js';
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

/** Stored text style ({ color, size, angle } in CSS px / degrees) with defaults applied. */
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
 * Allowed CSS-px range for the current selection. A label selection — or an
 * open label editor, whose label may not exist yet — caps at the label painter's
 * ceiling, so "+" never looks live while the painted size stays clamped.
 */
export function textSizeRange(board, dpr = textDpr()) {
    const targets = textTargets(board);
    const labelOnly = !targets.some(isTextBox)
        && (targets.some(hasLabel) || !!board?.flowLabelTarget);
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
    // An open label editor is the live target: show the size its text is painted
    // at, even when the label does not exist yet (fitted-to-box previews).
    const editing = Number(board?.flowLabelSize);
    const raw = Number.isFinite(editing) && editing > 0
        ? Math.round(editing / dpr)
        : (common != null ? common : textStyle(board).size);
    return Math.min(range.max, Math.max(range.min, raw));
}

/**
 * Value the dial shows: the shared angle when the selection agrees, an open
 * label editor's live angle next (it may not exist as a label yet), else the
 * remembered pref so the next text box starts where the last one was left.
 */
export function currentTextAngle(board) {
    const angles = textTargets(board).map((item) => textAngleOf(item));
    const common = angles.length && angles.every((angle) => angle === angles[0]) ? angles[0] : null;
    const editing = board?.flowLabelAngle;
    if (Number.isFinite(editing)) return normalizeTextAngle(editing);
    if (common != null) return common;
    return textStyle(board).angle;
}

/**
 * Apply a colour, CSS-px size and/or angle to every selected text target.
 * Dry-run first so a no-op (same colour, size already at the label cap, same
 * angle) does not push an undo entry the next Ctrl+Z would burn on nothing.
 *
 * @param {object} board
 * @param {{color?: string, size?: number, angle?: number}} [patch]
 * @param {{history?: boolean}} [opts] `history: false` folds a dial drag into the
 *   one undo entry its first change already pushed.
 * @returns {number} how many targets changed
 */
export function applyTextStyle(board, patch = {}, { history = true } = {}) {
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
        if (patch.angle != null) {
            const angle = normalizeTextAngle(patch.angle);
            if (textAngleOf(target) !== angle) next.angle = angle;
        }
        if (Object.keys(next).length) updates.push([target, next]);
    }
    if (!updates.length) return 0;

    if (history) board.pushLayerHistory();
    for (const [target, next] of updates) {
        if (next.size != null) {
            if (hasLabel(target)) target.label.fontSize = next.size;
            else target.fontSize = next.size;
        }
        if (next.color != null) {
            if (hasLabel(target)) target.label.color = next.color;
            else target.color = next.color;
        }
        if (next.angle != null) {
            // Upright is the stored-absent case (like `zLevel: 0`), so an
            // unrotated document stays byte-identical across a save.
            if (hasLabel(target)) {
                if (next.angle) target.label.angle = next.angle;
                else delete target.label.angle;
            } else if (next.angle) {
                target.angle = next.angle;
            } else {
                delete target.angle;
            }
        }
    }
    board.scheduleSave();
    requestRedraw(board);
    return updates.length;
}

/**
 * Start a dial drag. Held on the board between `setTextAngle` calls so the whole
 * drag costs one undo entry, not one per pointermove.
 */
export function beginTextAngleGesture(board) {
    if (board) board.textAngleHistoryPushed = false;
}

/** End a dial drag; the next gesture starts a fresh undo entry. */
export function endTextAngleGesture(board) {
    if (!board) return;
    board.textAngleHistoryPushed = false;
    // The gesture deferred its pref writes; one here is enough for the whole
    // drag (the doc itself was already saved step by step through scheduleSave).
    if (board.prefs?.text) writePrefs(board.prefs);
}

/**
 * Set the text angle (degrees, clockwise) on the selection and the open editor.
 *
 * The pref is always written so the next text box inherits the angle the user
 * just chose. One undo entry per gesture: the first change in a drag pushes
 * history, the rest reuse it via `beginTextAngleGesture`.
 *
 * @param {object} board
 * @param {number} angle 0-359, wraps
 * @returns {number} how many targets changed
 */
export function setTextAngle(board, angle) {
    const next = normalizeTextAngle(angle);
    const style = textStyle(board);
    const inGesture = board?.textAngleHistoryPushed === true;
    if (board?.prefs && style.angle !== next) {
        board.prefs.text = { ...style, angle: next };
        // A drag changes the angle on every pointermove; persist once at the
        // start and once when the gesture ends instead of per degree.
        if (!inGesture) writePrefs(board.prefs);
    }
    const history = board?.textAngleHistoryPushed !== true;
    const changed = applyTextStyle(board, { angle: next }, { history });
    if (changed && board) board.textAngleHistoryPushed = true;
    // A label being typed has no stored angle yet, so the live DOM needs the
    // same value the painter will use or the preview would jump on blur.
    if (typeof board?.flowRestyleLabelEditor === 'function') board.flowRestyleLabelEditor({ angle: next });
    if (typeof board?.updateTextAngleControl === 'function') board.updateTextAngleControl(next);
    return changed;
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
    // An open editor may show a label that does not exist yet, so `applyTextStyle`
    // has nothing to write: push the colour into the live DOM as well.
    if (typeof board?.flowRestyleLabelEditor === 'function') board.flowRestyleLabelEditor({ color: next });
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
    const changed = applyTextStyle(board, { size: next });
    // Restyle the open editor too: a label being typed has no stored size yet,
    // and its preview must not drift from the size the painter would use.
    if (typeof board?.flowRestyleLabelEditor === 'function') board.flowRestyleLabelEditor({ size: next });
    return changed;
}

/** Step the text size by one increment (+1 / -1) through the stepper. */
export function stepTextSize(board, delta) {
    return setTextSize(board, currentTextSize(board) + Math.sign(delta) * TEXT_SIZE_STEP);
}

function requestRedraw(board) {
    if (typeof board?.requestRedraw === 'function') board.requestRedraw();
    else if (typeof board?.redraw === 'function') board.redraw();
}
