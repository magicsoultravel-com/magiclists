/**
 * @module {"owns":"site-wide UI transition helpers — Smooth morph, FC fly/expand, chrome visibility", "related":["displayOptions.js","fileCabinet.js","magicFocus.js","app.js"]}
 *
 * Invariant: never leave both `is-hidden` (or hardClass) and `ui-morph-hidden` on the
 * same element. Callers must use setChromeVisible — do not toggle morph classes directly.
 * cancelAll() clears morph/fly state then applies the intended final hard state.
 */

import { isBoardOverlayEnabled } from './boardOverlay.js';

export const UI_TRANSITION_MS = 180;
export const UI_TRANSITION_EASING = 'cubic-bezier(0.2, 0, 0, 1)';

const MORPH_CLASS = 'ui-morph-hidden';
const FLY_CLASS = 'ui-transition-fly';
const FC_PENDING_CLASS = 'ui-fc-expand-pending';
const FC_BODY_CLASS = 'is-fc-transitioning';
const FOCUS_MORPH_BODY = 'is-focus-morphing';

/** @type {WeakMap<Element, { gen: number, visible: boolean, hardClass: string, timer: number|null }>} */
const chromeState = new WeakMap();

let flyOverlay = null;
let flyTimer = null;
let fcGen = 0;
let morphTimer = null;
let morphResolve = null;

export function prefersReducedMotion() {
    try {
        return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
    } catch {
        return false;
    }
}

export function isUiTransitionsEnabled() {
    if (prefersReducedMotion()) return false;
    return document.documentElement.dataset.uiTransitions !== 'off';
}

function clearMorphTimer() {
    if (morphTimer != null) {
        window.clearTimeout(morphTimer);
        morphTimer = null;
    }
    if (morphResolve) {
        morphResolve();
        morphResolve = null;
    }
}

function waitMs(ms) {
    return new Promise((resolve) => {
        clearMorphTimer();
        morphResolve = resolve;
        morphTimer = window.setTimeout(() => {
            morphTimer = null;
            morphResolve = null;
            resolve();
        }, ms);
    });
}

function forceReflow(el) {
    void el?.offsetWidth;
}

/**
 * Snap chrome to hard visible/hidden without animation.
 * @param {Element} el
 * @param {boolean} visible
 * @param {string} [hardClass='is-hidden']
 */
function applyHardChrome(el, visible, hardClass = 'is-hidden') {
    if (!el) return;
    el.classList.remove(MORPH_CLASS);
    el.classList.toggle(hardClass, !visible);
    if (visible) {
        el.style.removeProperty('opacity');
        el.style.removeProperty('visibility');
        el.style.removeProperty('pointer-events');
        el.style.removeProperty('transition');
    }
}

/**
 * Morph-aware show/hide for FAB, dock, and similar chrome.
 * Re-entrant: cancels the previous transition on the same element.
 * @param {Element|null|undefined} el
 * @param {boolean} visible
 * @param {{ hardClass?: string, instant?: boolean }} [opts]
 */
export function setChromeVisible(el, visible, opts = {}) {
    if (!el) return;
    const hardClass = opts.hardClass || 'is-hidden';
    const prev = chromeState.get(el) || { gen: 0, visible: !el.classList.contains(hardClass), hardClass, timer: null };
    if (prev.timer != null) {
        window.clearTimeout(prev.timer);
        prev.timer = null;
    }
    const gen = (prev.gen || 0) + 1;
    const next = { gen, visible: !!visible, hardClass, timer: null };
    chromeState.set(el, next);

    const instant = opts.instant === true || !isUiTransitionsEnabled();
    if (instant) {
        applyHardChrome(el, visible, hardClass);
        return;
    }

    if (visible) {
        // Hard-show first so display is not none, start faded, then fade in.
        el.classList.remove(hardClass);
        el.classList.add(MORPH_CLASS);
        forceReflow(el);
        el.classList.remove(MORPH_CLASS);
        return;
    }

    // Fade out then hard-hide.
    el.classList.remove(hardClass);
    el.classList.add(MORPH_CLASS);
    next.timer = window.setTimeout(() => {
        const cur = chromeState.get(el);
        if (!cur || cur.gen !== gen) return;
        applyHardChrome(el, false, hardClass);
        cur.timer = null;
    }, UI_TRANSITION_MS);
}

/**
 * Crossfade groups of elements around a synchronous mutate step.
 * @param {{ hide?: Element[], show?: Element[], mutate?: () => void|Promise<void>, duration?: number }} opts
 */
export async function morphElements(opts = {}) {
    const hide = (opts.hide || []).filter(Boolean);
    const show = (opts.show || []).filter(Boolean);
    const duration = opts.duration ?? UI_TRANSITION_MS;

    if (!isUiTransitionsEnabled()) {
        await opts.mutate?.();
        return;
    }

    document.body.classList.add(FOCUS_MORPH_BODY);

    hide.forEach((el) => {
        el.classList.remove(MORPH_CLASS);
        forceReflow(el);
        el.classList.add(MORPH_CLASS);
    });

    if (hide.length) await waitMs(duration);

    await opts.mutate?.();

    show.forEach((el) => {
        el.classList.add(MORPH_CLASS);
        forceReflow(el);
        el.classList.remove(MORPH_CLASS);
    });

    if (show.length) await waitMs(duration);

    document.body.classList.remove(FOCUS_MORPH_BODY);
    // Leave `hide` elements with MORPH_CLASS so the caller can hard-hide
    // before the next paint (avoids a one-frame flash). Clear it on show.
    show.forEach((el) => el.classList.remove(MORPH_CLASS));
}

function removeFlyOverlay() {
    if (flyTimer != null) {
        window.clearTimeout(flyTimer);
        flyTimer = null;
    }
    flyOverlay?.remove();
    flyOverlay = null;
}

/**
 * @param {{ fromRect: DOMRect|object, toRect: DOMRect|object, className?: string }} opts
 * @returns {Promise<void>}
 */
export function flyFromTo(opts) {
    const { fromRect, toRect } = opts;
    if (!fromRect || !toRect || !isUiTransitionsEnabled()) return Promise.resolve();

    removeFlyOverlay();
    const el = document.createElement('div');
    el.className = `${FLY_CLASS}${opts.className ? ` ${opts.className}` : ''}`;
    el.setAttribute('aria-hidden', 'true');
    const fw = Math.max(1, fromRect.width || fromRect.w || 1);
    const fh = Math.max(1, fromRect.height || fromRect.h || 1);
    const tw = Math.max(1, toRect.width || toRect.w || 1);
    const th = Math.max(1, toRect.height || toRect.h || 1);
    const fx = fromRect.left ?? fromRect.x ?? 0;
    const fy = fromRect.top ?? fromRect.y ?? 0;
    const tx = toRect.left ?? toRect.x ?? 0;
    const ty = toRect.top ?? toRect.y ?? 0;

    el.style.width = `${fw}px`;
    el.style.height = `${fh}px`;
    el.style.transform = `translate(${fx}px, ${fy}px)`;
    document.body.appendChild(el);
    flyOverlay = el;
    forceReflow(el);

    const sx = tw / fw;
    const sy = th / fh;
    el.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`;
    el.style.transformOrigin = '0 0';

    return new Promise((resolve) => {
        flyTimer = window.setTimeout(() => {
            flyTimer = null;
            removeFlyOverlay();
            resolve();
        }, UI_TRANSITION_MS);
    });
}

/**
 * Mark FC expand in flight. Always advances fcGen for cancel safety;
 * body chrome only when Smooth fly is enabled.
 * @param {string} itemId
 */
export function beginFcExpandTransition(itemId) {
    if (!itemId) return;
    fcGen += 1;
    if (!isUiTransitionsEnabled()) return;
    document.body.classList.add(FC_BODY_CLASS);
    document.body.dataset.fcTransitionId = itemId;
}

export function clearFcExpandTransition() {
    document.body.classList.remove(FC_BODY_CLASS);
    delete document.body.dataset.fcTransitionId;
    document.querySelectorAll(`.${FC_PENDING_CLASS}`).forEach((el) => {
        el.classList.remove(FC_PENDING_CLASS);
    });
}

/**
 * Bento-only neighbor push after FC expand. Allow-overlap leaves neighbors alone.
 * @param {{ itemId: string, UI: object, actorRect?: object|null, gen: number }} opts
 */
function scheduleFcExpandPushIfBento({ itemId, UI, actorRect = null, gen }) {
    if (!itemId || !UI || !isBoardOverlayEnabled()) return;
    const canvas = document.getElementById('app-canvas');
    if (!canvas?.classList.contains('view-grid')) return;
    const card = canvas.querySelector(`.mini-card[data-id="${CSS.escape(itemId)}"]`);
    if (!card) return;
    const resolvedRect = actorRect || UI.readNoteRect?.(card);
    requestAnimationFrame(() => {
        if (fcGen !== gen || !card.isConnected) return;
        UI.reflowGridBoard?.(canvas, itemId, {
            animate: true,
            ...(resolvedRect ? { actorRect: resolvedRect } : {})
        });
    });
}

/**
 * Post-render FC expand: hide flash → fly small → expand with layout-settling.
 * UI.render must already have completed at full size.
 * When Smooth is off, skip the fly and still schedule bento push if needed.
 * @param {{ itemId: string, sourceRect: object, UI: object }} opts
 */
export async function runFcExpandAfterRender({ itemId, sourceRect, UI }) {
    const gen = fcGen;
    const clear = () => {
        if (fcGen === gen) clearFcExpandTransition();
    };

    if (!itemId || !UI) {
        clear();
        return;
    }

    if (!isUiTransitionsEnabled()) {
        scheduleFcExpandPushIfBento({ itemId, UI, gen });
        clear();
        return;
    }

    const canvas = document.getElementById('app-canvas');
    const card = canvas?.querySelector(`.mini-card[data-id="${CSS.escape(itemId)}"]`);
    if (!card || !sourceRect) {
        scheduleFcExpandPushIfBento({ itemId, UI, gen });
        clear();
        return;
    }

    card.classList.add(FC_PENDING_CLASS);

    const full = UI.readNoteRect(card);
    let small;
    try {
        const { getSmallRect } = await import('./tileGeometry.js');
        const { readTileSmallFootprint } = await import('./tileFootprint.js');
        small = getSmallRect(readTileSmallFootprint());
    } catch {
        small = { w: Math.min(full.w, 80), h: Math.min(full.h, 32) };
    }

    const smallRect = { x: full.x, y: full.y, w: small.w, h: small.h };
    UI.applyNoteRect(card, smallRect, { settling: false });
    UI.finalizeDesktopCard?.(card);
    forceReflow(card);

    const targetBox = card.getBoundingClientRect();

    await flyFromTo({ fromRect: sourceRect, toRect: targetBox });
    if (fcGen !== gen || !card.isConnected) {
        clear();
        return;
    }

    card.classList.remove(FC_PENDING_CLASS);
    UI.applyNoteRect(card, full, { settling: true });
    UI.finalizeDesktopCard?.(card);

    window.setTimeout(() => {
        card.classList.remove('layout-settling');
    }, 160);

    scheduleFcExpandPushIfBento({ itemId, UI, actorRect: full, gen });
    clear();
}

/**
 * Cancel all in-flight transitions instantly; snap to final hard state.
 */
export function cancelAll() {
    clearMorphTimer();
    removeFlyOverlay();
    fcGen += 1;
    clearFcExpandTransition();
    document.body.classList.remove(FOCUS_MORPH_BODY);

    document.querySelectorAll(`.${MORPH_CLASS}`).forEach((el) => {
        const state = chromeState.get(el);
        const hardClass = state?.hardClass || 'is-hidden';
        const wantVisible = state ? state.visible : true;
        if (state?.timer != null) {
            window.clearTimeout(state.timer);
            state.timer = null;
        }
        applyHardChrome(el, wantVisible, hardClass);
    });
}
