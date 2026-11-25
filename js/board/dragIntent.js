/** @module {"owns":"the press-intent decision for board cards - resize, immediate move, deferred long-press move, or nothing", "related":["dragdrop.js","noteSurfaceHtml/card.js"]} */

/**
 * How long a finger must rest on a card header/gutter before it becomes a move
 * instead of a board scroll. Roughly matches the platform long-press feel while
 * staying short enough that a deliberate "hold and move" feels responsive.
 */
export const LONG_PRESS_MS = 400;

/**
 * Movement allowed (in px) during the hold before the press is treated as a
 * scroll gesture and the pending drag is dropped.
 */
export const LONG_PRESS_SLOP = 10;

export const PRESS_INTENT = {
    NONE: 'none',
    RESIZE: 'resize',
    DRAG: 'drag',
    LONG_PRESS: 'long-press'
};

/**
 * Decide what a press on a board card means.
 *
 * The board used to answer this inside a `mousedown` handler, which touch
 * devices only ever deliver once a tap has already resolved, so nothing could
 * follow a finger. The decision itself is pure -- it only consumes facts the
 * caller gathered from the DOM -- so it can be tested without a browser.
 *
 * Ordering matters and mirrors the historical `mousedown` guard chain:
 *  1. A resize handle always resizes (even over note text), unless pinned.
 *  2. Text/step-grab targets belong to the inline editor -- pressing there
 *     edits, it never moves the card.
 *  3. Only explicit drag surfaces (grip, header/gutter drag zones) move a card.
 *  4. Pinned cards and scrollbar grips are inert.
 *  5. Touch defers: the header/gutter keeps `touch-action: pan-y` so a swipe
 *     still scrolls the board, which means the press has to prove it is a hold
 *     before it can claim the pointer. The grip is an explicit "move me"
 *     affordance, so it starts at once -- same as a mouse press.
 *
 * @param {object} [facts]
 * @param {'mouse'|'pen'|'touch'|string} [facts.pointerType='mouse']
 * @param {string|null} [facts.resizeAxis] - `.ff-resize` axis when the press landed on one.
 * @param {boolean} [facts.pinned=false]
 * @param {boolean} [facts.yieldsToEditor=false] - press belongs to note text / a checklist step.
 * @param {boolean} [facts.dragSurface=false] - press landed on a drag zone or the grip.
 * @param {boolean} [facts.grip=false] - press landed on the explicit grip handle.
 * @param {boolean} [facts.overStepGrab=false]
 * @param {boolean} [facts.overScrollbarGrip=false]
 * @returns {{ kind: 'none' } | { kind: 'resize', axis: string } | { kind: 'drag' } | { kind: 'long-press', holdMs: number, slop: number }}
 */
export function resolvePressIntent({
    pointerType = 'mouse',
    resizeAxis = null,
    pinned = false,
    yieldsToEditor = false,
    dragSurface = false,
    grip = false,
    overStepGrab = false,
    overScrollbarGrip = false
} = {}) {
    if (resizeAxis) {
        return pinned ? { kind: PRESS_INTENT.NONE } : { kind: PRESS_INTENT.RESIZE, axis: resizeAxis };
    }
    if (yieldsToEditor) return { kind: PRESS_INTENT.NONE };
    if (overStepGrab) return { kind: PRESS_INTENT.NONE };
    if (!dragSurface && !grip) return { kind: PRESS_INTENT.NONE };
    if (pinned) return { kind: PRESS_INTENT.NONE };
    if (overScrollbarGrip) return { kind: PRESS_INTENT.NONE };

    if (pointerType === 'touch' && !grip) {
        return { kind: PRESS_INTENT.LONG_PRESS, holdMs: LONG_PRESS_MS, slop: LONG_PRESS_SLOP };
    }
    return { kind: PRESS_INTENT.DRAG };
}

/**
 * Whether a pending long press should be abandoned because the finger moved far
 * enough to be a scroll (or drag along the scroll axis).
 *
 * @param {{x: number, y: number}} origin
 * @param {{x: number, y: number}} point
 * @param {number} [slop=LONG_PRESS_SLOP]
 * @returns {boolean}
 */
export function longPressCancelled(origin, point, slop = LONG_PRESS_SLOP) {
    if (!origin || !point) return false;
    const dx = Math.abs((point.x ?? 0) - (origin.x ?? 0));
    const dy = Math.abs((point.y ?? 0) - (origin.y ?? 0));
    return Math.max(dx, dy) > slop;
}
