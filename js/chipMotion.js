/** @module {"owns":"collapse-to-chip geometry, motion timings and reduced-motion policy", "related":["toolPanelChrome.js","drawingToolbarChrome.js"]} */

/**
 * Collapse-to-chip geometry.
 *
 * The token's top-left corner IS the panel's top-left corner. Anchoring both
 * rectangles at a shared origin makes collapse → expand a positional no-op and
 * lets the panel grow straight out of the token with a plain scale transform —
 * no chip-width arithmetic, and no overhang for the wider
 * `.tool-chip--readout` variant.
 *
 * Expansion is clamp-only: near a viewport edge the panel slides inward so it
 * stays usable, but the anchor never flips to the opposite corner. A flip would
 * break the visual link back to the token that was just clicked.
 */
export const CHIP_ANCHOR_INSET = 0;
export const CHIP_MOTION_MS = 160;
export const CHIP_ENTER_MS = 90;
export const CHIP_MOTION_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Local clamp so this module stays dependency-free (mirrors the chrome helper). */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

/**
 * Token origin for a panel — the exact inverse of
 * `resolveExpandedPanelOrigin` when the panel is not clamped.
 *
 * @param {number} panelLeft  panel offsetLeft
 * @param {number} panelTop   panel offsetTop
 * @param {number} [inset]    visual inset between token and panel corner
 * @returns {{ x: number, y: number }}
 */
export function chipOriginForPanel(panelLeft, panelTop, inset = CHIP_ANCHOR_INSET) {
    return {
        x: (Number(panelLeft) || 0) + inset,
        y: (Number(panelTop) || 0) + inset
    };
}

/**
 * Panel position that lands the panel's top-left on the token's top-left,
 * clamped into `bounds` (never flipped).
 *
 * @param {object} rect
 * @param {number} rect.chipX
 * @param {number} rect.chipY
 * @param {number} rect.panelWidth
 * @param {number} rect.panelHeight
 * @param {{left:number,top:number,right:number,bottom:number}} rect.bounds
 * @param {number} [rect.inset]
 * @returns {{ x: number, y: number }}
 */
export function resolveExpandedPanelOrigin({ chipX, chipY, panelWidth, panelHeight, bounds, inset = CHIP_ANCHOR_INSET }) {
    const w = Math.max(0, Number(panelWidth) || 0);
    const h = Math.max(0, Number(panelHeight) || 0);
    const left = Number(bounds?.left) || 0;
    const top = Number(bounds?.top) || 0;
    const right = Number.isFinite(bounds?.right) ? bounds.right : Infinity;
    const bottom = Number.isFinite(bounds?.bottom) ? bounds.bottom : Infinity;
    return {
        x: clamp((Number(chipX) || 0) - inset, left, Math.max(left, right - w)),
        y: clamp((Number(chipY) || 0) - inset, top, Math.max(top, bottom - h))
    };
}

/**
 * Non-uniform scale factors that map the panel rect exactly onto the token
 * rect. Matching both axes is what lets the first/last animation frame line up
 * with the token without a hand-off pop.
 *
 * @param {number} panelWidth
 * @param {number} panelHeight
 * @param {number} chipWidth
 * @param {number} chipHeight
 * @returns {{ sx: number, sy: number }}
 */
export function chipScaleForPanel(panelWidth, panelHeight, chipWidth, chipHeight) {
    const pw = Math.max(1, Number(panelWidth) || 0);
    const ph = Math.max(1, Number(panelHeight) || 0);
    return {
        sx: Math.max(0.01, (Number(chipWidth) || 0) / pw),
        sy: Math.max(0.01, (Number(chipHeight) || 0) / ph)
    };
}

/**
 * True when the OS/browser asks for reduced motion. Fails open to `false`
 * (animate) so a missing matchMedia only costs the transition, not the swap.
 *
 * @param {Window|undefined} [win]
 * @returns {boolean}
 */
export function prefersReducedMotion(win = globalThis.window) {
    try {
        return !!win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    } catch {
        return false;
    }
}

/**
 * Whether the collapse/expand morph can run on `el`: WAAPI support and no
 * reduced-motion preference. Callers still apply the geometry when this is
 * false — only the animation is skipped.
 *
 * @param {Element|null|undefined} el
 * @param {Window|undefined} [win]
 * @returns {boolean}
 */
export function canAnimateElement(el, win = globalThis.window) {
    return typeof el?.animate === 'function' && !prefersReducedMotion(win);
}
