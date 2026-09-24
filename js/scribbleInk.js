/** @module {"owns":"shared scribble palette, width, and stroke-hit erase helpers", "related":["noteAttachmentsUi.js","quickScribble.js","canvasBrushes.js"]} */

export const SCRIBBLE_COLOR_CUSTOM_DEFAULT = '#ffaa00';
export const SCRIBBLE_COLOR_CUSTOM_INDEX = 3;
/** Mutable palette: three neon slots + one custom (index 3). */
export const SCRIBBLE_COLORS = ['#ff00ff', '#00ffff', '#00ff00', SCRIBBLE_COLOR_CUSTOM_DEFAULT];

export const SCRIBBLE_WIDTH_MIN = 1;
export const SCRIBBLE_WIDTH_MAX = 48;
export const SCRIBBLE_WIDTH_DEFAULT = 6;

/**
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeScribbleHex(value) {
    const v = String(value || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
    if (/^[0-9a-fA-F]{6}$/.test(v)) return `#${v.toLowerCase()}`;
    return '';
}

/**
 * @param {unknown} index
 * @returns {number}
 */
export function normalizeScribbleColorIndex(index) {
    const n = Number(index);
    const len = SCRIBBLE_COLORS.length;
    if (!len) return 0;
    if (!Number.isFinite(n)) return 0;
    return ((Math.round(n) % len) + len) % len;
}

/**
 * @param {unknown} hex
 * @returns {string} active custom color
 */
export function setScribbleCustomColor(hex) {
    const next = normalizeScribbleHex(hex) || SCRIBBLE_COLOR_CUSTOM_DEFAULT;
    SCRIBBLE_COLORS[SCRIBBLE_COLOR_CUSTOM_INDEX] = next;
    return next;
}

/**
 * @param {unknown} index
 * @returns {string}
 */
export function getScribbleColor(index) {
    return SCRIBBLE_COLORS[normalizeScribbleColorIndex(index)];
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function clampScribbleWidth(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return SCRIBBLE_WIDTH_DEFAULT;
    return Math.min(SCRIBBLE_WIDTH_MAX, Math.max(SCRIBBLE_WIDTH_MIN, Math.round(n)));
}

/**
 * @param {unknown} current
 * @param {number} delta
 * @returns {number}
 */
export function stepScribbleWidth(current, delta) {
    const step = Number(delta);
    return clampScribbleWidth(clampScribbleWidth(current) + (Number.isFinite(step) ? step : 0));
}

/**
 * Hit-test a stroke against a point in the same coordinate space as stroke.points.
 * Optional scaleX/scaleY map normalized points into layout/viewport space.
 * @param {{ points?: Array<{x?: number, y?: number}>, width?: number }|null|undefined} stroke
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {{ scaleX?: number, scaleY?: number }} [opts]
 * @returns {boolean}
 */
export function scribbleStrokeHitsPoint(stroke, x, y, radius, opts = {}) {
    const pts = stroke?.points;
    if (!Array.isArray(pts) || !pts.length) return false;
    const sx = Number(opts.scaleX);
    const sy = Number(opts.scaleY);
    const scaleX = Number.isFinite(sx) && sx > 0 ? sx : 1;
    const scaleY = Number.isFinite(sy) && sy > 0 ? sy : 1;
    const half = (Number(stroke.width) || SCRIBBLE_WIDTH_DEFAULT) * 0.5;
    const r = (Number(radius) || 0) + half;
    if (!(r > 0)) return false;
    return pts.some((pt) => {
        const px = (Number(pt?.x) || 0) * scaleX;
        const py = (Number(pt?.y) || 0) * scaleY;
        return Math.hypot(px - x, py - y) <= r;
    });
}

/**
 * Drop strokes that pass under the eraser tip.
 * @param {Array<{ points?: Array<{x?: number, y?: number}>, width?: number }>} strokes
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {{ scaleX?: number, scaleY?: number }} [opts]
 * @returns {typeof strokes}
 */
export function eraseScribbleStrokesAt(strokes, x, y, radius, opts = {}) {
    if (!Array.isArray(strokes) || !strokes.length) return Array.isArray(strokes) ? strokes : [];
    return strokes.filter((stroke) => !scribbleStrokeHitsPoint(stroke, x, y, radius, opts));
}
