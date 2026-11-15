// test/angleDial.test.js
// The dial is the only way to type an angle, so its maths and its event wiring
// both need guards:
//   1. pointer -> degrees must agree with degrees -> point, or the knob lies;
//   2. presets are a convenience, not a cage: only snap inside the tolerance;
//   3. Escape/outside-click must close it, and the anchor click must be able to
//      toggle it shut instead of closing and instantly re-opening;
//   4. every drag step reports a value, so the editor previews live.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    DIAL_SIZE,
    DIAL_RADIUS,
    DIAL_PRESET_SNAP,
    angleToPoint,
    angleFromPointer,
    snapAngle,
    dialValueForKey,
    openAngleDial,
    closeAngleDial,
    isAngleDialOpen,
    angleDialValue
} from '../js/angleDial.js';
import { TEXT_ANGLE_PRESETS } from '../js/textAngle.js';

const CENTRE = DIAL_SIZE / 2;

describe('dial angle maths', () => {
    it('maps the four compass points to 0/90/180/270', () => {
        const at = (deg) => angleToPoint(0, 0, deg, 10);
        assert.deepEqual(at(0), { x: 0, y: -10 }, '0 degrees is up');
        assert.ok(Math.abs(at(90).x - 10) < 1e-9, 'clockwise: 90 is right');
        assert.ok(Math.abs(at(90).y) < 1e-9);
        assert.ok(Math.abs(at(180).y - 10) < 1e-9);
        assert.ok(Math.abs(at(270).x + 10) < 1e-9);
    });

    it('reads the pointer back as the angle it was drawn at', () => {
        for (const deg of [0, 1, 45, 90, 137, 180, 270, 359]) {
            const p = angleToPoint(CENTRE, CENTRE, deg, DIAL_RADIUS);
            assert.equal(angleFromPointer(CENTRE, CENTRE, p.x, p.y), deg, `round trip ${deg}`);
        }
    });

    it('always reports a whole degree inside 0-359', () => {
        const value = angleFromPointer(0, 0, 3, -4);
        assert.ok(Number.isInteger(value));
        assert.ok(value >= 0 && value < 360);
        assert.equal(angleFromPointer(0, 0, 0, 0), 0, 'a pointer on the hub is upright, not NaN');
    });

    it('snaps to a preset only inside the tolerance', () => {
        assert.equal(snapAngle(91), 90);
        assert.equal(snapAngle(90 - DIAL_PRESET_SNAP), 90, 'the boundary itself snaps');
        assert.equal(snapAngle(90 - DIAL_PRESET_SNAP - 1), 90 - DIAL_PRESET_SNAP - 1);
        assert.equal(snapAngle(44), 45);
        assert.equal(snapAngle(200), 200, 'no preset nearby, no movement');
    });

    it('treats the ring as a circle when snapping across 0', () => {
        assert.equal(snapAngle(1.5), 0, '1.5 degrees is next to the top, not to 359');
        assert.equal(snapAngle(358), 0, 'and 358 snaps to 0, not 315');
        assert.equal(snapAngle(317), 315);
    });
});

describe('dialValueForKey', () => {
    it('steps clockwise with right/up and anticlockwise with left/down', () => {
        assert.equal(dialValueForKey(10, 'ArrowRight'), 11);
        assert.equal(dialValueForKey(10, 'ArrowUp'), 11);
        assert.equal(dialValueForKey(10, 'ArrowLeft'), 9);
        assert.equal(dialValueForKey(10, 'ArrowDown'), 9);
    });

    it('takes 15-degree steps while Shift is held', () => {
        assert.equal(dialValueForKey(10, 'ArrowRight', true), 25);
        assert.equal(dialValueForKey(10, 'ArrowLeft', true), 355, 'and wraps at 0');
    });

    it('wraps at both ends instead of stopping', () => {
        assert.equal(dialValueForKey(359, 'ArrowRight'), 0);
        assert.equal(dialValueForKey(0, 'ArrowLeft'), 359);
    });

    it('snaps upright on Home and flips on End', () => {
        assert.equal(dialValueForKey(123, 'Home'), 0);
        assert.equal(dialValueForKey(123, 'End'), 180);
    });

    it('ignores every other key so the dial never eats typing', () => {
        for (const key of ['a', 'Enter', 'Tab', 'Escape', 'PageUp', ' ']) {
            assert.equal(dialValueForKey(10, key), null, key);
        }
    });
});

/* ---------------------------------------------------------------------------
 * DOM wiring. Node has no DOM, so this is a hand-rolled stub of exactly the
 * surface the popover touches: one created element, its four named parts, the
 * eight preset buttons and document-level listeners.
 * ------------------------------------------------------------------------- */

function fakeNode(rect = null) {
    const node = {
        tagName: 'div',
        attributes: {},
        dataset: {},
        style: {},
        textContent: '',
        className: '',
        children: [],
        listeners: new Map(),
        focused: false,
        removed: false,
        classList: {
            toggles: [],
            toggle(name, on) { this.toggles.push([name, on]); }
        },
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
        },
        addEventListener(type, fn) {
            if (!this.listeners.has(type)) this.listeners.set(type, []);
            this.listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            const list = this.listeners.get(type) || [];
            this.listeners.set(type, list.filter((entry) => entry !== fn));
        },
        fire(type, event = {}) {
            for (const fn of [...(this.listeners.get(type) || [])]) {
                fn({ preventDefault() {}, stopPropagation() {}, ...event, target: event.target || this });
            }
        },
        contains(candidate) { return candidate === this || this.children.includes(candidate); },
        remove() { this.removed = true; },
        focus() { this.focused = true; },
        getBoundingClientRect() {
            const r = rect || { left: 0, top: 0, width: 0, height: 0 };
            return { ...r, right: r.left + r.width, bottom: r.top + r.height };
        }
    };
    return node;
}

/** The popover the module builds: one root with four named parts and 8 presets. */
function makePopover() {
    const root = fakeNode();
    const dial = fakeNode({ left: 100, top: 100, width: DIAL_SIZE, height: DIAL_SIZE });
    const parts = {
        dial,
        hand: fakeNode(),
        knob: fakeNode(),
        readout: fakeNode()
    };
    const presets = TEXT_ANGLE_PRESETS.map((deg) => {
        const btn = fakeNode();
        btn.dataset.angle = String(deg);
        return btn;
    });
    const selectors = {
        '[data-role="dial"]': parts.dial,
        '[data-role="hand"]': parts.hand,
        '[data-role="knob"]': parts.knob,
        '[data-role="readout"]': parts.readout
    };
    root.querySelector = (selector) => selectors[selector] || null;
    root.querySelectorAll = (selector) => (selector === '.angle-dial__preset' ? presets : []);
    root.contains = (candidate) => candidate === root
        || Object.values(parts).includes(candidate)
        || presets.includes(candidate);
    root.parts = { ...parts, presets };
    return root;
}

let dom = null;

function installDom() {
    const created = [];
    const doc = fakeNode();
    const body = fakeNode();
    body.appendChild = (child) => { body.children.push(child); created.push(child); };
    doc.body = body;
    doc.defaultView = { innerWidth: 1200, innerHeight: 900 };
    doc.createElement = () => makePopover();
    globalThis.document = doc;
    dom = { doc, body, created };
    return dom;
}

function removeDom() {
    delete globalThis.document;
    dom = null;
}

/** Pointer position for a dial angle, in client coordinates of the stub dial. */
function pointerAt(deg, radius = DIAL_RADIUS) {
    const rect = { left: 100, top: 100, width: DIAL_SIZE, height: DIAL_SIZE };
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const p = angleToPoint(cx, cy, deg, radius);
    return { clientX: p.x, clientY: p.y };
}

describe('dial popover behaviour', () => {
    beforeEach(() => {
        installDom();
    });

    afterEach(() => {
        closeAngleDial();
        removeDom();
    });

    it('opens below its anchor, normalised and focused', () => {
        const anchor = fakeNode({ left: 10, top: 10, width: 24, height: 24 });
        anchor.ownerDocument = dom.doc;
        const session = openAngleDial({ anchor, value: 400 });

        const el = session.el;
        assert.equal(dom.body.children.includes(el), true, 'the popover lives on body, not in the toolbar');
        assert.equal(el.removed, false);
        assert.equal(el.focused, true, 'focus lands in the dial so the arrows work');
        assert.equal(parseFloat(el.style.top), 42, 'below the anchor: 10 + 24 + 8');
        assert.equal(parseFloat(el.style.left), 34, 'right-aligned to the anchor');
        assert.equal(session.value, 40, '400 wraps to 40');
        assert.equal(el.getAttribute('role'), 'dialog');
        assert.equal(el.parts.readout.textContent, '40\u00b0');
        assert.equal(isAngleDialOpen(), true);
        assert.equal(angleDialValue(), 40);
    });

    it('reports a preset click once, exactly, and starts a gesture', () => {
        const changes = [];
        let gestures = 0;
        openAngleDial({
            value: 10,
            onGestureStart: () => { gestures += 1; },
            onChange: (deg) => changes.push(deg)
        });

        const preset = dom.created[0].parts.presets[2]; // 90 degrees
        preset.fire('click');

        assert.deepEqual(changes, [90], 'a preset is exact: no snapping needed');
        assert.equal(gestures, 1, 'one undo entry for the click');
        assert.equal(dom.created[0].parts.readout.textContent, '90\u00b0');
    });

    it('tracks a drag step by step and stops when the pointer is released', () => {
        const changes = [];
        let gestures = 0;
        const session = openAngleDial({
            value: 0,
            onGestureStart: () => { gestures += 1; },
            onChange: (deg) => changes.push(deg)
        });
        const dial = session.el.parts.dial;

        dial.fire('pointerdown', { button: 0, ...pointerAt(90) });
        assert.deepEqual(changes, [90], 'pressing on the ring jumps there immediately');

        dom.doc.fire('pointermove', pointerAt(180));
        dom.doc.fire('pointermove', pointerAt(270));
        assert.deepEqual(changes, [90, 180, 270]);

        dom.doc.fire('pointerup', {});
        dom.doc.fire('pointermove', pointerAt(0));
        assert.deepEqual(changes, [90, 180, 270], 'a released drag ignores further moves');
        assert.equal(gestures, 1, 'the whole drag is a single gesture');
    });

    it('snaps near a preset while dragging but not in between', () => {
        const changes = [];
        const session = openAngleDial({ value: 0, onChange: (deg) => changes.push(deg) });
        session.el.parts.dial.fire('pointerdown', { button: 0, ...pointerAt(92) });
        assert.deepEqual(changes, [90], '2 degrees off the preset snaps');

        dom.doc.fire('pointermove', pointerAt(120));
        assert.deepEqual(changes, [90, 120], 'nowhere near a preset stays exact');
        dom.doc.fire('pointerup', {});
    });

    it('steps with the arrow keys and closes on Escape', () => {
        const changes = [];
        let closed = 0;
        const session = openAngleDial({
            value: 10,
            onChange: (deg) => changes.push(deg),
            onClose: () => { closed += 1; }
        });

        dom.doc.fire('keydown', { key: 'ArrowRight' });
        dom.doc.fire('keydown', { key: 'ArrowRight', shiftKey: true });
        dom.doc.fire('keydown', { key: 'Home' });
        assert.deepEqual(changes, [11, 26, 0], 'arrows are exact, Home snaps upright');
        assert.equal(session.el.parts.readout.textContent, '0\u00b0');

        dom.doc.fire('keydown', { key: 'Escape' });
        assert.equal(closed, 1);
        assert.equal(isAngleDialOpen(), false);
        assert.equal(session.el.removed, true, 'the popover leaves the DOM');
    });

    it('closes on an outside press but not on itself or its anchor', () => {
        const anchor = fakeNode({ left: 10, top: 10, width: 24, height: 24 });
        anchor.ownerDocument = dom.doc;
        const session = openAngleDial({ anchor, value: 45 });

        dom.doc.fire('pointerdown', { target: session.el.parts.knob });
        assert.equal(isAngleDialOpen(), true, 'a press inside the dial must not close it');

        dom.doc.fire('pointerdown', { target: anchor });
        assert.equal(isAngleDialOpen(), true, 'the anchor toggles it shut through its own click');

        const elsewhere = fakeNode();
        dom.doc.fire('pointerdown', { target: elsewhere });
        assert.equal(isAngleDialOpen(), false, 'a press anywhere else closes it');
    });

    it('replaces an open dial instead of stacking a second one', () => {
        let firstClosed = 0;
        openAngleDial({ value: 10, onClose: () => { firstClosed += 1; } });
        openAngleDial({ value: 20 });

        assert.equal(firstClosed, 1);
        assert.equal(dom.body.children.length, 2, 'two popovers were built, only one is live');
        assert.equal(angleDialValue(), 20);
    });

    it('returns null without a document to attach to', () => {
        removeDom();
        assert.equal(openAngleDial({ value: 10 }), null);
        assert.equal(isAngleDialOpen(), false);
    });
});
