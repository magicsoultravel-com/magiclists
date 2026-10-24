/** @module {"owns":"lightbox zoom/rotation/doodle coordinate math for note media preview", "related":["noteAttachmentsUi.js","scribbleInk.js"]} */
import {
    SCRIBBLE_COLORS,
    SCRIBBLE_COLOR_CUSTOM_INDEX,
    SCRIBBLE_WIDTH_MIN,
    SCRIBBLE_WIDTH_MAX,
    SCRIBBLE_WIDTH_DEFAULT,
    normalizeScribbleColorIndex,
    clampScribbleWidth,
    stepScribbleWidth,
    eraseScribbleStrokesAt
} from '../scribbleInk.js';

export const LIGHTBOX_ZOOM_MIN = 1;
export const LIGHTBOX_ZOOM_MAX = 5;

/**
 * Snap a rotation to the nearest 90-degree step in [0, 360).
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeLightboxRotation(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const stepped = Math.round(n / 90) * 90;
    return ((stepped % 360) + 360) % 360;
}

/**
 * Step preview rotation left (-1) or right (+1) by 90 degrees.
 * @param {unknown} current
 * @param {number} dir
 * @returns {number}
 */
export function rotateLightboxStep(current, dir) {
    const base = normalizeLightboxRotation(current);
    const step = dir >= 0 ? 90 : -90;
    return normalizeLightboxRotation(base + step);
}

/**
 * Clamp a lightbox zoom factor to the supported range.
 * @param {unknown} value
 * @returns {number}
 */
export function clampLightboxZoom(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return LIGHTBOX_ZOOM_MIN;
    return Math.min(LIGHTBOX_ZOOM_MAX, Math.max(LIGHTBOX_ZOOM_MIN, Math.round(n * 100) / 100));
}

/**
 * Next zoom factor for a wheel delta (scroll up zooms in).
 * @param {unknown} current
 * @param {unknown} deltaY
 * @param {unknown} [deltaMode]
 * @returns {number}
 */
export function nextLightboxZoom(current, deltaY, deltaMode = 0) {
    const base = clampLightboxZoom(current);
    let dy = Number(deltaY);
    if (!Number.isFinite(dy) || dy === 0) return base;
    if (Number(deltaMode) === 1) dy *= 16;
    // Exponential factor feels smooth for both notched wheels (~100/detent)
    // and high-frequency trackpads (small deltas).
    const factor = Math.exp(-dy * 0.0018);
    return clampLightboxZoom(base * factor);
}

/**
 * Cursor-anchored pan adjustment so the point under the cursor stays put.
 * @param {{ panX: number, panY: number, cursorX: number, cursorY: number, prevZoom: number, nextZoom: number }} args
 * @returns {{ panX: number, panY: number }}
 */
export function anchorLightboxPan({ panX = 0, panY = 0, cursorX = 0, cursorY = 0, prevZoom = 1, nextZoom = 1 } = {}) {
    const z0 = clampLightboxZoom(prevZoom);
    const z1 = clampLightboxZoom(nextZoom);
    if (z0 <= 0 || z1 === z0) return { panX: Number(panX) || 0, panY: Number(panY) || 0 };
    const ratio = z1 / z0;
    return {
        panX: (Number(panX) || 0) + (Number(cursorX) || 0) * (1 - ratio),
        panY: (Number(panY) || 0) + (Number(cursorY) || 0) * (1 - ratio)
    };
}

/**
 * Fit-scale so a rotated image stays fully visible inside its frame.
 * Only shrinks (never upscales); 0/180 always fit like the base layout.
 * @param {unknown} rotation
 * @param {unknown} imgW
 * @param {unknown} imgH
 * @param {unknown} frameW
 * @param {unknown} frameH
 * @returns {number}
 */
export function lightboxFitScaleForRotation(rotation, imgW, imgH, frameW, frameH) {
    const rot = normalizeLightboxRotation(rotation);
    const w = Number(imgW);
    const h = Number(imgH);
    const fw = Number(frameW);
    const fh = Number(frameH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
    if (!Number.isFinite(fw) || !Number.isFinite(fh) || fw <= 0 || fh <= 0) return 1;
    if (rot !== 90 && rot !== 270) return 1;
    // After a 90/270 CSS rotate the layout box is unchanged, so the visual
    // footprint becomes h×w. Scale it to fit the frame it already fit in.
    const scale = Math.min(fw / h, fh / w, 1);
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    return Math.round(scale * 1000) / 1000;
}

/**
 * Whether the current view can be panned (zoomed, rotated, or fit-shrunk
 * view where drag reveals clipped edges is handled by scroll fallback).
 * @param {unknown} zoom
 * @param {unknown} rotation
 * @returns {boolean}
 */
export function lightboxCanPan(zoom, rotation) {
    return clampLightboxZoom(zoom) > LIGHTBOX_ZOOM_MIN + 1e-9
        || normalizeLightboxRotation(rotation) !== 0;
}

/** Shared scribble palette (3 neon + mutable custom). */
export const LIGHTBOX_DOODLE_COLORS = SCRIBBLE_COLORS;
export const LIGHTBOX_DOODLE_CUSTOM_INDEX = SCRIBBLE_COLOR_CUSTOM_INDEX;
/** @deprecated Prefer LIGHTBOX_DOODLE_WIDTH_DEFAULT; kept for callers that used relative width. */
export const LIGHTBOX_DOODLE_WIDTH = 0.006;
export const LIGHTBOX_DOODLE_WIDTH_MIN = SCRIBBLE_WIDTH_MIN;
export const LIGHTBOX_DOODLE_WIDTH_MAX = SCRIBBLE_WIDTH_MAX;
export const LIGHTBOX_DOODLE_WIDTH_DEFAULT = SCRIBBLE_WIDTH_DEFAULT;

/**
 * Clamp a lightbox doodle pen width (px) to the supported range.
 * @param {unknown} value
 * @returns {number}
 */
export function clampLightboxDoodleWidth(value) {
    return clampScribbleWidth(value);
}

/**
 * Step the doodle pen width by delta px (clamped).
 * @param {unknown} current
 * @param {number} delta
 * @returns {number}
 */
export function stepLightboxDoodleWidth(current, delta) {
    return stepScribbleWidth(current, delta);
}

/**
 * Pick a doodle color index, wrapping around the scribble palette.
 * @param {unknown} index
 * @returns {number}
 */
export function normalizeLightboxDoodleColor(index) {
    return normalizeScribbleColorIndex(index);
}

/**
 * Re-export stroke-hit erase for tests / site-wide scribble.
 * @param {Array<{ points?: Array<{x?: number, y?: number}>, width?: number }>} strokes
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {{ scaleX?: number, scaleY?: number }} [opts]
 */
export function eraseLightboxDoodlesAt(strokes, x, y, radius, opts = {}) {
    return eraseScribbleStrokesAt(strokes, x, y, radius, opts);
}

/**
 * Clamp a pointer position to normalized image coordinates (0..1).
 * @param {unknown} x
 * @param {unknown} y
 * @returns {{ x: number, y: number }}
 */
export function normalizeLightboxDoodlePoint(x, y) {
    const nx = Number(x);
    const ny = Number(y);
    const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    return { x: clamp01(nx), y: clamp01(ny) };
}

/**
 * Convert a normalized doodle point back to CSS pixels inside the unrotated
 * image layout box (forward map; inverse is below).
 * @param {{ x: number, y: number }} point
 * @param {number} layoutW
 * @param {number} layoutH
 * @returns {{ x: number, y: number }}
 */
export function lightboxDoodleToLayout(point, layoutW, layoutH) {
    const px = Number(point?.x);
    const py = Number(point?.y);
    const w = Number(layoutW);
    const h = Number(layoutH);
    return {
        x: (Number.isFinite(px) ? px : 0) * (Number.isFinite(w) ? w : 0),
        y: (Number.isFinite(py) ? py : 0) * (Number.isFinite(h) ? h : 0)
    };
}

/**
 * Inverse of CSS `rotate(deg)` about the layout-box center, mapping a point
 * in the rotated visual frame back to the unrotated layout box. Rotation is
 * snapped to 90-degree steps (the only states the preview supports).
 * @param {number} x point x in visual (rotated) coordinates
 * @param {number} y point y in visual (rotated) coordinates
 * @param {number} layoutW unrotated layout width
 * @param {number} layoutH unrotated layout height
 * @param {unknown} rotation preview rotation in degrees
 * @returns {{ x: number, y: number }}
 */
export function lightboxDoodleFromVisual(x, y, layoutW, layoutH, rotation) {
    const rot = normalizeLightboxRotation(rotation);
    const w = Number(layoutW);
    const h = Number(layoutH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { x: 0, y: 0 };
    // For 90/270 the visual footprint is h×w centered on the same center.
    const vw = (rot === 90 || rot === 270) ? h : w;
    const vh = (rot === 90 || rot === 270) ? w : h;
    const cx = (Number(x) || 0) - vw / 2;
    const cy = (Number(y) || 0) - vh / 2;
    const rad = (rot * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    // Inverse rotation by -rot: lx = cx*cos + cy*sin, ly = -cx*sin + cy*cos.
    return {
        x: w / 2 + cx * cos + cy * sin,
        y: h / 2 - cx * sin + cy * cos
    };
}

/**
 * Forward map: unrotated layout-box point to the rotated visual frame.
 * Used to paint preview strokes so ink sits exactly on the pixels.
 * @param {number} x point x in layout coordinates
 * @param {number} y point y in layout coordinates
 * @param {number} layoutW unrotated layout width
 * @param {number} layoutH unrotated layout height
 * @param {unknown} rotation preview rotation in degrees
 * @returns {{ x: number, y: number }}
 */
export function lightboxDoodleToVisual(x, y, layoutW, layoutH, rotation) {
    const rot = normalizeLightboxRotation(rotation);
    const w = Number(layoutW);
    const h = Number(layoutH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { x: 0, y: 0 };
    const rad = (rot * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const lx = (Number(x) || 0) - w / 2;
    const ly = (Number(y) || 0) - h / 2;
    const vw = (rot === 90 || rot === 270) ? h : w;
    const vh = (rot === 90 || rot === 270) ? w : h;
    return {
        x: vw / 2 + lx * cos - ly * sin,
        y: vh / 2 + lx * sin + ly * cos
    };
}
