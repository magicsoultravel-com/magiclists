// test/canvasViewportTouchGesture.test.js
// Two fingers on the canvas pan AND pinch-zoom the viewport now that the Hand
// tool is gone, so this file pins the transform itself rather than the DOM:
//
//   * the world point under the OLD midpoint must land under the new midpoint
//     (zoom about the old midpoint, then translate by the midpoint delta — the
//     other order drags the content by the whole pan distance),
//   * a pinch that starts at a zoom limit still moves (ratios accumulate when a
//     step is too small to survive the 1/100 rounding, and are dropped when the
//     zoom is saturated so the limit cannot unwind in one jump),
//   * the gesture owns the pointers until the LAST finger lifts, otherwise the
//     leftover finger falls through to the board and erases,
//   * one canvas:panstart per gesture (the board aborts the first finger's
//     stroke on it) and one canvas:pan at the end (it persists the viewport).
//
// Run with: npm test
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CanvasViewport } from '../js/canvasViewport.js';

// bindEvents() listens on `window`; a shared stub keeps the singleton's
// keydown/keyup wiring observable without a DOM.
const winListeners = new Map();
const prevWindow = globalThis.window;
globalThis.window = {
    addEventListener(type, fn) {
        if (!winListeners.has(type)) winListeners.set(type, []);
        winListeners.get(type).push(fn);
    },
    dispatchEvent: () => true,
    devicePixelRatio: 1
};
after(() => {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
});

function makeViewport({ viewportW = 800, viewportH = 600 } = {}) {
    const listeners = new Map();
    const classes = new Set();
    const events = [];
    const el = {
        clientWidth: viewportW,
        clientHeight: viewportH,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); }
        },
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        dispatchEvent(ev) { events.push(ev); return true; },
        emit(type, e) { for (const fn of listeners.get(type) || []) fn(e); },
        setPointerCapture() {},
        releasePointerCapture() {}
    };
    return { el, events, classes };
}

/** Fresh singleton state + a fresh fake viewport, wired through bindEvents(). */
function setup(opts = {}) {
    winListeners.clear();
    const vp = makeViewport(opts);
    Object.assign(CanvasViewport, {
        scale: opts.scale ?? 1,
        offsetX: opts.offsetX ?? 0,
        offsetY: opts.offsetY ?? 0,
        contentCssW: opts.contentW ?? 5000,
        contentCssH: opts.contentH ?? 5000,
        panning: false,
        panStart: null,
        spaceHeld: false,
        touchPoints: new Map(),
        touchGestureActive: false,
        touchPanIds: null,
        touchPrev: null,
        touchZoomPending: 1,
        innerEl: { style: {} },
        viewportEl: vp.el,
        // Truthy bars short-circuit ensureScrollbars(); null thumbs make
        // syncAxis() a no-op so the maths is what gets asserted.
        scrollBarX: {},
        scrollBarY: {},
        scrollThumbX: null,
        scrollThumbY: null,
        thumbDrag: null
    });
    CanvasViewport.bindEvents();
    return vp;
}

const down = (vp, pointerId, x, y) => vp.el.emit('pointerdown', {
    pointerId, pointerType: 'touch', clientX: x, clientY: y, button: 0, target: null, preventDefault() {}
});
const move = (vp, pointerId, x, y) => vp.el.emit('pointermove', {
    pointerId, pointerType: 'touch', clientX: x, clientY: y, buttons: 1
});
const up = (vp, pointerId, x, y) => vp.el.emit('pointerup', {
    pointerId, pointerType: 'touch', clientX: x, clientY: y
});
const countOf = (events, type) => events.filter((e) => e.type === type).length;
const mouseDown = (vp, extra = {}) => vp.el.emit('pointerdown', {
    pointerId: 90, pointerType: 'mouse', clientX: 100, clientY: 100, button: 0,
    target: null, preventDefault() {}, ...extra
});
const pressKey = (type, code) => {
    for (const fn of winListeners.get(type) || []) fn({ code, repeat: false });
};


describe('two-finger touch transform', () => {
    it('keeps the world point under the fingers when panning and pinching at once', () => {
        const vp = setup();
        down(vp, 1, 100, 300);
        down(vp, 2, 200, 300);
        // Old midpoint (150,300) with the fingers 100px apart.
        move(vp, 2, 400, 300); // new midpoint (250,300), 300px apart → 3x

        assert.equal(CanvasViewport.scale, 3, 'distance tripled');
        assert.equal(150 * CanvasViewport.scale + CanvasViewport.offsetX, 250,
            'the content point that sat under the old midpoint is under the new one');
        assert.equal(300 * CanvasViewport.scale + CanvasViewport.offsetY, 300,
            'the vertical midpoint did not move, so neither does the anchor');
        // One event at the start, one at the end — never per move.
        assert.equal(countOf(vp.events, 'canvas:panstart'), 1);
        assert.equal(countOf(vp.events, 'canvas:pan'), 0, 'still panning, nothing persisted yet');
    });

    it('zooms symmetrically about a stationary midpoint', () => {
        const vp = setup();
        down(vp, 1, 300, 300);
        down(vp, 2, 500, 300);
        move(vp, 1, 250, 300);
        move(vp, 2, 550, 300);

        assert.equal(CanvasViewport.scale, 1.5);
        assert.equal(400 * CanvasViewport.scale + CanvasViewport.offsetX, 400,
            'midpoint 400 is the pivot, so it stays put');
    });

    it('accumulates sub-step pinch ratios at the minimum zoom', () => {
        // clampZoom rounds to 1/100, so a 1% spread at scale 0.1 rounds straight
        // back to 0.1. Without the accumulator the canvas would be stuck.
        const vp = setup({ scale: 0.1 });
        down(vp, 1, 100, 300);
        down(vp, 2, 200, 300);
        for (let i = 1; i <= 20; i += 1) move(vp, 2, 200 + i, 300);

        assert.ok(CanvasViewport.scale > 0.1, 'zooming in from the limit must work');
        // 1/100 rounding is a tenth of the value down here, and it rounds up, so
        // the 1.2x spread can land above the ideal 0.12 — but nowhere near the
        // 0.4 the pre-accumulator code would have jumped to.
        assert.ok(CanvasViewport.scale < 0.2, `stayed near the spread (got ${CanvasViewport.scale})`);
    });

    it('banks no phantom zoom when the spread saturates at the maximum', () => {
        const vp = setup({ scale: 4 });
        down(vp, 1, 100, 300);
        down(vp, 2, 200, 300);
        move(vp, 2, 300, 300); // 2x spread, but the scale is already capped at 4

        assert.equal(CanvasViewport.scale, 4, 'the cap holds');

        move(vp, 2, 200, 300); // pinch back in by half
        assert.equal(CanvasViewport.scale, 2, 'the first pinch-in is not swallowed by a banked 2x');
    });

    it('keeps the gesture alive while a single leftover finger remains', () => {
        const vp = setup();
        down(vp, 1, 100, 300);
        down(vp, 2, 200, 300);
        move(vp, 2, 400, 300);
        const { scale, offsetX, offsetY } = CanvasViewport;

        up(vp, 1, 100, 300);
        assert.equal(CanvasViewport.panning, true, 'the leftover finger must not reach the board');
        assert.equal(CanvasViewport.touchPanIds, null, 'the broken pair drives nothing');

        move(vp, 2, 600, 500);
        assert.equal(CanvasViewport.scale, scale, 'a single finger never zooms');
        assert.equal(CanvasViewport.offsetX, offsetX, 'and never pans');
        assert.equal(CanvasViewport.offsetY, offsetY);

        up(vp, 2, 600, 500);
        assert.equal(CanvasViewport.panning, false);
        assert.equal(vp.classes.has('is-panning'), false);
        assert.equal(countOf(vp.events, 'canvas:pan'), 1, 'the viewport is persisted once, at the end');
    });

    it('starts one gesture per pair and ignores a third finger', () => {
        const vp = setup();
        down(vp, 1, 100, 300);
        down(vp, 2, 200, 300);
        down(vp, 3, 700, 300);
        assert.equal(countOf(vp.events, 'canvas:panstart'), 1, 'a third finger starts nothing');
        assert.equal(CanvasViewport.touchPanIds.length, 2, 'the first pair stays in charge');

        move(vp, 3, 750, 300);
        assert.equal(CanvasViewport.scale, 1, 'the extra finger is not part of the maths');

        up(vp, 1, 100, 300);
        up(vp, 2, 200, 300);
        up(vp, 3, 750, 300);
        assert.equal(CanvasViewport.panning, false, 'the last finger still ends it');

        down(vp, 4, 100, 300);
        down(vp, 5, 200, 300);
        assert.equal(countOf(vp.events, 'canvas:panstart'), 2, 'a new pair is a new gesture');
        up(vp, 4, 100, 300);
        up(vp, 5, 200, 300);
    });

    it('ignores a touch that starts on a scrollbar', () => {
        const vp = setup();
        vp.el.emit('pointerdown', {
            pointerId: 7, pointerType: 'touch', clientX: 10, clientY: 10, button: 0,
            target: { closest: () => ({ id: 'bar' }) }, preventDefault() {}
        });
        assert.equal(CanvasViewport.panning, false);
        assert.equal(CanvasViewport.touchPoints.size, 0, 'the scrollbar keeps owning that finger');
    });
});

describe('mouse pan paths survive the touch rework', () => {
    it('still pans with the middle button', () => {
        const vp = setup();
        mouseDown(vp, { button: 1 });
        assert.equal(CanvasViewport.panning, true);

        vp.el.emit('pointermove', { pointerId: 90, pointerType: 'mouse', clientX: 60, clientY: 80 });
        assert.equal(CanvasViewport.offsetX, -40);
        assert.equal(CanvasViewport.offsetY, -20);

        vp.el.emit('pointerup', { pointerId: 90, pointerType: 'mouse', clientX: 60, clientY: 80 });
        assert.equal(CanvasViewport.panning, false);
        assert.equal(countOf(vp.events, 'canvas:pan'), 1);
    });

    it('still pans with Space + left drag', () => {
        const vp = setup();
        pressKey('keydown', 'Space');
        assert.equal(CanvasViewport.spaceHeld, true);

        mouseDown(vp);
        assert.equal(CanvasViewport.panning, true, 'Space turns a left drag into a pan');

        vp.el.emit('pointermove', { pointerId: 90, pointerType: 'mouse', clientX: 70, clientY: 100 });
        assert.equal(CanvasViewport.offsetX, -30);

        pressKey('keyup', 'Space');
        assert.equal(CanvasViewport.spaceHeld, false);
        assert.equal(CanvasViewport.panning, false, 'releasing Space ends the pan');
    });
});

