/** @module {"owns":"magicCanvas circular angle dial popover - pointer/keyboard degrees input with preset snapping, shared by the text rotation control","related":["drawingBoardToolbar.js","textAngle.js","popoverPosition.js","drawingBoard.js"]} */
import { normalizeTextAngle, TEXT_ANGLE_PRESETS } from './textAngle.js';
import { positionPopoverBelowAnchor } from './popoverPosition.js';

/** Square the dial is drawn in, in CSS px. */
export const DIAL_SIZE = 168;
/** Distance from the centre to the ring the knob rides on. */
export const DIAL_RADIUS = 60;
/** How close (in degrees) a drag must be to a preset before it snaps. */
export const DIAL_PRESET_SNAP = 3;

/**
 * Point on a circle, measured clockwise from 12 o'clock.
 * Screen space: y grows downwards, so "up" is `cy - radius`.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} deg 0 = up, 90 = right
 * @param {number} radius
 * @returns {{x: number, y: number}}
 */
export function angleToPoint(cx, cy, deg, radius) {
    const rad = (normalizeTextAngle(deg) * Math.PI) / 180;
    return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}

/**
 * Degrees from a circle centre to a pointer, clockwise from 12 o'clock.
 * The inverse of `angleToPoint`, so a knob dropped where the pointer is reports
 * the same number it was drawn at.
 *
 * @param {number} cx
 * @param {number} cy
 * @param {number} x
 * @param {number} y
 * @returns {number} integer 0-359
 */
export function angleFromPointer(cx, cy, x, y) {
    const deg = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
    return normalizeTextAngle(Math.round(deg));
}

/**
 * Pull an angle onto the nearest preset when it is within `tolerance`.
 * A dial with no detents feels mushy at the ends, and users want exact 90s.
 *
 * @param {number} deg
 * @param {number} [tolerance]
 * @returns {number}
 */
export function snapAngle(deg, tolerance = DIAL_PRESET_SNAP) {
    const angle = normalizeTextAngle(deg);
    let best = angle;
    let bestDelta = tolerance + 1;
    for (const preset of TEXT_ANGLE_PRESETS) {
        // Circular distance: 359 is 1 degree away from 0, not 359.
        const raw = Math.abs(angle - preset);
        const delta = Math.min(raw, 360 - raw);
        if (delta <= tolerance && delta < bestDelta) {
            best = preset;
            bestDelta = delta;
        }
    }
    return best;
}

/**
 * Angle a key press asks for, or null when the key is not a dial key.
 * Arrows mirror the dial (right/up = clockwise), Shift takes bigger steps, Home
 * snaps upright and End flips to the opposite side.
 *
 * @param {number} value current degrees
 * @param {string} key
 * @param {boolean} [shiftKey]
 * @returns {number|null}
 */
export function dialValueForKey(value, key, shiftKey = false) {
    const step = shiftKey ? 15 : 1;
    const current = normalizeTextAngle(value);
    switch (key) {
        case 'ArrowRight':
        case 'ArrowUp':
            return normalizeTextAngle(current + step);
        case 'ArrowLeft':
        case 'ArrowDown':
            return normalizeTextAngle(current - step);
        case 'Home':
            return 0;
        case 'End':
            return 180;
        default:
            return null;
    }
}

/** Preset button markup, positioned on the ring. */
function presetButtonsHtml() {
    const centre = DIAL_SIZE / 2;
    return TEXT_ANGLE_PRESETS.map((deg) => {
        const p = angleToPoint(centre, centre, deg, DIAL_RADIUS);
        return '<button type="button" class="angle-dial__preset" data-angle="' + deg + '"'
            + ' style="left:' + p.x.toFixed(2) + 'px;top:' + p.y.toFixed(2) + 'px"'
            + ' title="' + deg + '\u00b0" aria-label="' + deg + ' degrees">'
            + '<span class="angle-dial__dot"></span>'
            + '</button>';
    }).join('');
}

/** Inner markup. The SVG carries the track, hand and knob; the buttons are the presets. */
function popoverHtml() {
    const centre = DIAL_SIZE / 2;
    const knob = angleToPoint(centre, centre, 0, DIAL_RADIUS);
    return '<div class="angle-dial" data-role="dial">'
        + '<svg class="angle-dial__ring" viewBox="0 0 ' + DIAL_SIZE + ' ' + DIAL_SIZE + '" width="' + DIAL_SIZE + '" height="' + DIAL_SIZE + '" aria-hidden="true" focusable="false">'
        + '<circle class="angle-dial__track" cx="' + centre + '" cy="' + centre + '" r="' + DIAL_RADIUS + '"/>'
        + '<line class="angle-dial__hand" data-role="hand" x1="' + centre + '" y1="' + centre + '" x2="' + knob.x + '" y2="' + knob.y + '"/>'
        + '<circle class="angle-dial__knob" data-role="knob" cx="' + knob.x + '" cy="' + knob.y + '" r="7"/>'
        + '<circle class="angle-dial__hub" cx="' + centre + '" cy="' + centre + '" r="2.5"/>'
        + '</svg>'
        + presetButtonsHtml()
        + '</div>'
        + '<div class="angle-dial__foot">'
        + '<output class="angle-dial__readout" data-role="readout" aria-live="polite">0\u00b0</output>'
        + '<span class="angle-dial__hint">\u2190 \u2192 1\u00b0 \u00b7 Shift 15\u00b0</span>'
        + '</div>';
}

let state = null;

/** True while the dial is on screen. */
export function isAngleDialOpen() {
    return !!state;
}

/** Current degrees the open dial shows, or null when closed. */
export function angleDialValue() {
    return state ? state.value : null;
}

/**
 * Open the dial under a toolbar button. Closing the previous one first keeps
 * the "one popover at a time" rule every other rollout follows.
 *
 * @param {object} [opts]
 * @param {HTMLElement} [opts.anchor] button the popover hangs from
 * @param {number} [opts.value] starting degrees
 * @param {() => void} [opts.onGestureStart] fires once per drag/preset press, before the first change
 * @param {(deg: number) => void} [opts.onChange] live drag/keyboard updates
 * @param {() => void} [opts.onClose]
 * @returns {object|null} session (null when there is no DOM to attach to)
 */
export function openAngleDial({ anchor = null, value = 0, onGestureStart = null, onChange = null, onClose = null } = {}) {
    closeAngleDial();
    const doc = globalThis.document;
    if (!doc?.body) return null;

    const el = doc.createElement('div');
    el.className = 'angle-dial-popover';
    el.tabIndex = -1;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Text angle');
    el.innerHTML = popoverHtml();
    doc.body.appendChild(el);

    const session = {
        el,
        doc,
        anchor,
        value: normalizeTextAngle(value),
        onGestureStart,
        onChange,
        onClose,
        listeners: [],
        stopDrag: null,
        setValue: null
    };
    state = session;

    const dial = el.querySelector('[data-role="dial"]');
    const hand = el.querySelector('[data-role="hand"]');
    const knob = el.querySelector('[data-role="knob"]');
    const readout = el.querySelector('[data-role="readout"]');
    const presets = Array.from(el.querySelectorAll('.angle-dial__preset'));

    const bind = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        session.listeners.push(() => target.removeEventListener(type, handler, options));
    };

    const render = () => {
        const centre = DIAL_SIZE / 2;
        const point = angleToPoint(centre, centre, session.value, DIAL_RADIUS);
        hand?.setAttribute('x2', String(point.x));
        hand?.setAttribute('y2', String(point.y));
        knob?.setAttribute('cx', String(point.x));
        knob?.setAttribute('cy', String(point.y));
        if (readout) readout.textContent = session.value + '\u00b0';
        el.setAttribute('aria-label', 'Text angle ' + session.value + ' degrees');
        for (const btn of presets) {
            const on = Number(btn.dataset.angle) === session.value;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
    };

    const setValue = (deg, { snap = false } = {}) => {
        const next = snap ? snapAngle(deg) : normalizeTextAngle(deg);
        const changed = next !== session.value;
        session.value = next;
        render();
        if (changed && typeof session.onChange === 'function') session.onChange(next);
    };
    session.setValue = setValue;

    const angleAtPointer = (event) => {
        const rect = dial.getBoundingClientRect();
        return angleFromPointer(
            rect.left + rect.width / 2,
            rect.top + rect.height / 2,
            event.clientX,
            event.clientY
        );
    };

    let dragging = false;
    const onPointerMove = (event) => {
        if (!dragging) return;
        event.preventDefault?.();
        // Snap while dragging only: typed/arrow-key values stay exact.
        setValue(angleAtPointer(event), { snap: true });
    };
    const endDrag = () => {
        if (!dragging) return;
        dragging = false;
        doc.removeEventListener('pointermove', onPointerMove);
        doc.removeEventListener('pointerup', endDrag);
    };
    session.stopDrag = endDrag;

    bind(dial, 'pointerdown', (event) => {
        if (event.button != null && event.button !== 0) return;
        event.preventDefault();
        dragging = true;
        el.focus?.();
        // New gesture: the board opens a fresh undo entry for the whole drag.
        if (typeof session.onGestureStart === 'function') session.onGestureStart();
        setValue(angleAtPointer(event), { snap: true });
        doc.addEventListener('pointermove', onPointerMove);
        doc.addEventListener('pointerup', endDrag);
    });

    for (const btn of presets) {
        bind(btn, 'click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (typeof session.onGestureStart === 'function') session.onGestureStart();
            setValue(Number(btn.dataset.angle) || 0);
        });
    }

    bind(doc, 'keydown', (event) => {
        if (event.defaultPrevented) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeAngleDial();
            return;
        }
        const next = dialValueForKey(session.value, event.key, event.shiftKey);
        if (next == null) return;
        event.preventDefault();
        setValue(next);
    }, true);

    bind(doc, 'pointerdown', (event) => {
        const target = event.target;
        // The anchor is excluded so its own click handler can toggle us shut;
        // closing here would make the following click re-open immediately.
        if (el.contains?.(target)) return;
        if (anchor?.contains?.(target)) return;
        closeAngleDial();
    }, true);

    if (anchor) positionPopoverBelowAnchor(el, anchor);
    render();
    el.focus?.();
    return session;
}

/** Tear the dial down and fire `onClose`. Safe to call when already closed. */
export function closeAngleDial() {
    const session = state;
    if (!session) return;
    state = null;
    session.stopDrag?.();
    for (const off of session.listeners.splice(0)) off();
    session.el.remove?.();
    if (typeof session.onClose === 'function') session.onClose();
}
