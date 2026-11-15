/** @module {"owns":"magicCanvas text rotation model - typed angle normalisation, text-box pivots and bounds, plus the rotation math hit tests and marquee share","related":["canvasBrushes.js","flowchartLabel.js","lassoGeometry.js","drawingBoardSelection.js","drawingBoard/text.js","drawingBoardFlowchart.js"]} */

/**
 * Text can be reoriented by whole degrees, clockwise, 0-359. The angle lives on
 * the item: `label.angle` for a shape/connector label, `angle` for a free text
 * box. Zero is stored as *absence* (the same rule `zLevel: 0` follows) so a
 * document drawn before rotation existed still saves byte-identically.
 *
 * Deliberately dependency-free: `flowchartLabel.js` reads `normalizeTextAngle`
 * from here, so importing it back would be a cycle.
 */
export const TEXT_ANGLE_DEFAULT = 0;
export const TEXT_ANGLE_MAX = 359;

/** Dots drawn on the dial. Every 45 degrees keeps the ring readable. */
export const TEXT_ANGLE_PRESETS = Object.freeze([0, 45, 90, 135, 180, 225, 270, 315]);

/** Line advance of a text box, mirrored by `.canvas-text-box`'s CSS line-height. */
export const TEXT_BOX_LINE_HEIGHT = 1.25;

/**
 * Coerce anything into an integer 0-359.
 * Wraps rather than clamps (360 -> 0, -45 -> 315) because a dial has no ends:
 * dragging past 359 must continue into 1 instead of sticking.
 *
 * @param {unknown} raw
 * @returns {number} integer degrees, never -0
 */
export function normalizeTextAngle(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return TEXT_ANGLE_DEFAULT;
    const wrapped = ((Math.round(n) % 360) + 360) % 360;
    return wrapped === 0 ? 0 : wrapped;
}

/** True when the item carries a visible rotation (zero is the stored-absent case). */
export function hasTextAngle(item) {
    return textAngleOf(item) !== 0;
}

/**
 * Rotation of a text-bearing item: a label's angle for shapes/connectors, the
 * item's own `angle` for a free text box.
 *
 * @param {object} item shape/connector stroke or text object
 * @returns {number} integer degrees 0-359
 */
export function textAngleOf(item) {
    if (!item) return TEXT_ANGLE_DEFAULT;
    if (item.label) return normalizeTextAngle(item.label.angle);
    return normalizeTextAngle(item.angle);
}

/**
 * Box a text object occupies, in canvas units. Stored `width`/`height` win (the
 * editor measures them on commit); older objects fall back to the historical
 * heuristic so their hit area does not change just because rotation exists.
 *
 * @param {object} item text object (`tool: 'text'`)
 * @returns {{minX: number, minY: number, maxX: number, maxY: number}}
 */
export function textObjectBox(item) {
    const storedFont = Number(item?.fontSize);
    const fontSize = Number.isFinite(storedFont) && storedFont > 0 ? storedFont : 16;
    const storedWidth = Number(item?.width);
    const storedHeight = Number(item?.height);
    const width = Number.isFinite(storedWidth) && storedWidth > 0
        ? storedWidth
        : Math.max(200, String(item?.text || '').length * fontSize * 0.6);
    const height = Number.isFinite(storedHeight) && storedHeight > 0
        ? storedHeight
        : Math.max(60, fontSize * 1.4);
    const x = Number(item?.x) || 0;
    const y = Number(item?.y) || 0;
    return { minX: x, minY: y, maxX: x + width, maxY: y + height };
}

/**
 * Centre a free text box rotates around. Labels pivot on the centre of their own
 * measured box (`flowLabelCentre` in flowchartLabel.js) because that box is
 * already centred in the shape or on the connector bend point.
 *
 * @param {object} item text object (`tool: 'text'`)
 * @returns {{x: number, y: number}}
 */
export function textBoxPivot(item) {
    const box = textObjectBox(item);
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** Degrees -> radians, wrapping through the same 0-359 normalisation. */
export function textAngleRadians(deg) {
    return (normalizeTextAngle(deg) * Math.PI) / 180;
}

/**
 * Rotate a point clockwise around a pivot by `deg` (screen space: y grows down).
 * An angle of 330 gives back a point rotated by 30 the other way, so callers
 * never need a separate inverse helper.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} cx
 * @param {number} cy
 * @param {number} deg
 * @returns {{x: number, y: number}}
 */
export function rotatePointAround(x, y, cx, cy, deg) {
    const angle = normalizeTextAngle(deg);
    if (!angle) return { x, y };
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = x - cx;
    const dy = y - cy;
    return {
        x: cx + dx * cos - dy * sin,
        y: cy + dx * sin + dy * cos
    };
}

/**
 * Axis-aligned bounds of a rect after rotating it about a pivot. Marquee,
 * lasso and crop all want a plain AABB, and the AABB of the rotated rect is the
 * tightest one that contains every painted glyph pixel.
 *
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} rect
 * @param {number} cx
 * @param {number} cy
 * @param {number} deg
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
export function rotatedRectAabb(rect, cx, cy, deg) {
    const angle = normalizeTextAngle(deg);
    if (!angle || !rect) return rect;
    const corners = [
        [rect.minX, rect.minY],
        [rect.maxX, rect.minY],
        [rect.maxX, rect.maxY],
        [rect.minX, rect.maxY]
    ].map(([x, y]) => rotatePointAround(x, y, cx, cy, angle));
    return {
        minX: Math.min(...corners.map((p) => p.x)),
        minY: Math.min(...corners.map((p) => p.y)),
        maxX: Math.max(...corners.map((p) => p.x)),
        maxY: Math.max(...corners.map((p) => p.y))
    };
}

/**
 * Bounds of a text object including its rotation — what selection, marquee,
 * lasso and crop should all agree on.
 *
 * @param {object} item text object (`tool: 'text'`)
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}}
 */
export function textObjectBounds(item) {
    const angle = textAngleOf(item);
    const box = textObjectBox(item);
    if (!angle) return box;
    const pivot = textBoxPivot(item);
    return rotatedRectAabb(box, pivot.x, pivot.y, angle);
}

/**
 * `rotate(...)` fragment the DOM editors append to their transform, or '' at
 * zero so an untouched editor keeps its original transform string.
 *
 * @param {number} deg
 * @returns {string}
 */
export function textRotationCss(deg) {
    const angle = normalizeTextAngle(deg);
    return angle ? `rotate(${angle}deg)` : '';
}
