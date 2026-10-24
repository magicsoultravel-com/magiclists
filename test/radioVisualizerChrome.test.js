// test/radioVisualizerChrome.test.js
// Modal chrome (DOM construction, drag/resize/tap-tempo bindings, dock-rect and
// popout lifecycle) moved out of js/radioVisualizer.js into
// js/radioVisualizer/chrome.js. The module takes the facade as an explicit
// `viz` argument, so these tests drive it through plain-object hosts plus a
// hand-rolled DOM/window stub — no jsdom in this repo.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureModal,
    bindModalDrag,
    bindBpmSnap,
    bindPanelResize,
    openModal,
    closeModal,
    bindSettingsToggle,
    syncChromeMode,
    syncPopoutButtons,
    bindChromeActions,
    saveDockRect,
    restoreDockRect,
    popOut,
    popIn
} from '../js/radioVisualizer/chrome.js';
import { DEFAULTS } from '../js/radioVisualizer/settings.js';
import {
    SCENE_HOLD_MS,
    SEA_HOLD_MS,
    SCENE_TRANSITION_MS,
    TRAVEL_SPEED
} from '../js/radioVisualizer/controls.js';
import { DAY_CYCLE_MS } from '../js/radioVisualizer/sky.js';
import { CARD_ICONS } from '../js/icons.js';

function withGlobal(name, value, fn) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, name);
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    try {
        return fn();
    } finally {
        if (had) Object.defineProperty(globalThis, name, previous);
        else delete globalThis[name];
    }
}

/** Deterministic clock for performance.now() sequences. */
function withPerformance(values, fn) {
    const queue = values.slice();
    return withGlobal('performance', { now: () => (queue.length ? queue.shift() : 0) }, fn);
}

/** Runs rAF callbacks synchronously (tap-tempo pulse uses a rAF pair). */
function withRaf(fn) {
    return withGlobal('requestAnimationFrame', (cb) => {
        cb();
        return 1;
    }, fn);
}

function makeClassList() {
    const set = new Set();
    return {
        add: (...names) => names.forEach((name) => set.add(name)),
        remove: (...names) => names.forEach((name) => set.delete(name)),
        contains: (name) => set.has(name),
        toggle(name, force) {
            const open = force === undefined ? !set.has(name) : !!force;
            if (open) set.add(name);
            else set.delete(name);
            return open;
        },
        values: () => [...set].sort()
    };
}

/** Minimal element stub: listeners, attributes, inline styles, geometry. */
function makeElement(tag = 'div', spec = {}) {
    const listeners = new Map();
    const attributes = new Map();
    const el = {
        tagName: tag,
        listeners,
        attributes,
        style: {},
        hidden: false,
        textContent: '',
        innerHTML: '',
        className: '',
        value: spec.value ?? '',
        children: [],
        rect: { left: 0, top: 0, width: 400, height: 300, ...spec.rect },
        classList: makeClassList(),
        fire(type, event = {}) {
            const payload = {
                type,
                cancelable: false,
                stopped: false,
                defaultPrevented: false,
                stopPropagation() {
                    payload.stopped = true;
                },
                preventDefault() {
                    payload.defaultPrevented = true;
                },
                ...event
            };
            for (const fn of listeners.get(type) || []) fn(payload);
            return payload;
        },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== fn));
        },
        listenerCount: (type) => (listeners.get(type) || []).length,
        setAttribute(name, value) {
            attributes.set(name, String(value));
        },
        getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
        appendChild(child) {
            el.children.push(child);
            child.parentNode = el;
            return child;
        },
        getBoundingClientRect: () => el.rect,
        closest: spec.closest || (() => null),
        contains: (child) => el.children.includes(child),
        setPointerCapture() {},
        focus() {
            el.focused = (el.focused || 0) + 1;
        }
    };
    return el;
}

/** Document stub: createElement() returns elements that answer from `nodes`. */
function makeDocStub({ nodes = {}, lists = {} } = {}) {
    const doc = {
        nodes: new Map(Object.entries(nodes)),
        lists: new Map(Object.entries(lists)),
        appended: [],
        created: [],
        body: makeElement('body')
    };
    doc.body.appendChild = (child) => {
        doc.appended.push(child);
        child.parentNode = doc.body;
        return child;
    };
    doc.createElement = (tag) => {
        const el = makeElement(tag);
        el.ownerDocument = doc;
        el.querySelector = (selector) => doc.nodes.get(selector) || null;
        el.querySelectorAll = (selector) => doc.lists.get(selector) || [];
        doc.created.push(el);
        return el;
    };
    doc.addEventListener = () => {};
    doc.removeEventListener = () => {};
    return doc;
}

function makeWindowStub({ innerWidth = 1200, innerHeight = 800 } = {}) {
    const listeners = new Map();
    const win = {
        innerWidth,
        innerHeight,
        listeners,
        closed: false,
        focused: 0,
        fire(type, event = {}) {
            for (const fn of listeners.get(type) || []) fn(event);
        },
        addEventListener(type, fn) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            listeners.set(type, (listeners.get(type) || []).filter((entry) => entry !== fn));
        },
        listenerCount: (type) => (listeners.get(type) || []).length,
        focus() {
            win.focused += 1;
        },
        close() {
            win.closed = true;
            win.closeCalls = (win.closeCalls || 0) + 1;
        }
    };
    return win;
}

/** Modal node whose querySelector answers from a selector → element map. */
function makeModalNode(seed = {}) {
    const modal = makeElement('div');
    const nodes = new Map(Object.entries(seed));
    const lists = new Map();
    modal.querySelector = (selector) => nodes.get(selector) || null;
    modal.querySelectorAll = (selector) => lists.get(selector) || [];
    return { modal, nodes, lists };
}

/** Minimal stand-in for the RadioVisualizer facade. */
function makeHost(overrides = {}) {
    const calls = {
        resizeCanvas: 0,
        drawIdleFrame: 0,
        updateStatus: 0,
        syncControlLabels: 0,
        saveStoredPrefs: 0,
        loadStoredPrefs: 0,
        applyStoredSettingsToControls: 0,
        applyStoredLayout: 0,
        setCanvas: [],
        setMediaElement: [],
        setSettings: [],
        toggle: []
    };
    const host = {
        calls,
        modal: null,
        canvas: null,
        canvasHeight: null,
        panelWidth: null,
        savedDockRect: null,
        settings: { ...DEFAULTS },
        enabled: false,
        analysisLive: false,
        analysisBlocked: false,
        settingsOpen: true,
        detailsOpen: false,
        chromeMinimal: false,
        poppedOut: false,
        _prefsLoaded: false,
        popoutWindow: null,
        popoutDoc: null,
        popoutOnKey: null,
        popoutOnPageHide: null,
        rafId: null,
        tapBpmTimes: [],
        tapBpmLastTime: 0,
        energyHistory: [],
        silenceSince: null,
        mediaElement: null,
        loadStoredPrefs() {
            calls.loadStoredPrefs += 1;
        },
        saveStoredPrefs() {
            calls.saveStoredPrefs += 1;
        },
        setCanvas(el) {
            calls.setCanvas.push(el);
            host.canvas = el;
        },
        setMediaElement(el) {
            calls.setMediaElement.push(el);
            host.mediaElement = el;
        },
        setSettings(patch) {
            calls.setSettings.push(patch);
            Object.assign(host.settings, patch);
        },
        applyStoredSettingsToControls(modal) {
            calls.applyStoredSettingsToControls += 1;
            calls.settingsModal = modal;
        },
        applyStoredLayout(modal) {
            calls.applyStoredLayout += 1;
            calls.layoutModal = modal;
        },
        syncControlLabels() {
            calls.syncControlLabels += 1;
        },
        updateStatus() {
            calls.updateStatus += 1;
        },
        resizeCanvas() {
            calls.resizeCanvas += 1;
        },
        drawIdleFrame() {
            calls.drawIdleFrame += 1;
        },
        toggle(state) {
            calls.toggle.push(state);
            host.enabled = !!state;
        }
    };
    return Object.assign(host, overrides);
}

/** Selector → element seed covering everything ensureModal() looks up. */
function chromeNodes() {
    return {
        '[data-media-visualizer-mode]': makeElement('select', { value: 'mountains' }),
        '[data-media-visualizer-palette]': makeElement('select', { value: 'horizon' }),
        '[data-media-visualizer-sensitivity]': makeElement('input', { value: '1' }),
        '[data-media-visualizer-amplitude]': makeElement('input', { value: '0.55' }),
        '[data-media-visualizer-travel]': makeElement('input', { value: '0.55' }),
        '[data-media-visualizer-bpm]': makeElement('input', { value: '120' }),
        '[data-media-visualizer-bpm-label]': makeElement('span'),
        '[data-media-visualizer-bpm-snap]': makeElement('button'),
        '[data-media-visualizer-details-toggle]': makeElement('button'),
        '[data-media-visualizer-details]': makeElement('div'),
        '[data-media-visualizer-canvas]': makeElement('canvas', { rect: { width: 480, height: 270 } }),
        '[data-media-visualizer-settings]': makeElement('div'),
        '[data-media-visualizer-settings-toggle]': makeElement('button'),
        '[data-media-visualizer-minimize]': makeElement('button'),
        '[data-media-visualizer-expand]': makeElement('button'),
        '[data-media-visualizer-resize]': makeElement('div'),
        '[data-media-visualizer-chrome-overlay]': makeElement('div'),
        '.media-visualizer-modal__title': makeElement('span')
    };
}

function withDom({ doc, win = makeWindowStub() }, fn) {
    return withGlobal('window', win, () => withGlobal('document', doc, () => withGlobal(
        'requestAnimationFrame',
        (cb) => {
            cb();
            return 1;
        },
        fn
    )));
}

function makeChromeDoc() {
    const nodes = chromeNodes();
    const closeBtns = [makeElement('button'), makeElement('button')];
    const popoutBtns = [makeElement('button'), makeElement('button')];
    const doc = makeDocStub({
        nodes,
        lists: {
            '[data-media-visualizer-close]': closeBtns,
            '[data-media-visualizer-popout]': popoutBtns
        }
    });
    return { doc, win: makeWindowStub(), nodes, closeBtns, popoutBtns };
}

describe('radio visualizer chrome · modal construction', () => {
    it('returns the cached modal without touching prefs or the DOM', () => {
        const modal = makeElement('div');
        const host = makeHost({ modal, _prefsLoaded: true });

        assert.equal(ensureModal(host), modal);
        assert.equal(host.calls.loadStoredPrefs, 0);
    });

    it('builds the dialog markup, wires every control and adopts the canvas', () => {
        const { doc, win, nodes, closeBtns, popoutBtns } = makeChromeDoc();
        const host = makeHost();

        const modal = withDom({ doc, win }, () => ensureModal(host));

        assert.equal(host.modal, modal, 'adopted by the facade');
        assert.equal(modal.tagName, 'div');
        assert.equal(modal.className, 'media-visualizer-modal is-hidden');
        assert.equal(modal.getAttribute('role'), 'dialog');
        assert.equal(modal.getAttribute('aria-modal'), 'false');
        assert.equal(modal.getAttribute('aria-label'), 'Media visualizer');
        assert.equal(doc.appended.at(-1), modal, 'docked into document.body');

        assert.equal(host.calls.loadStoredPrefs, 1);
        assert.equal(host._prefsLoaded, true);
        assert.equal(host.calls.applyStoredSettingsToControls, 1);
        assert.equal(host.calls.applyStoredLayout, 1);
        assert.equal(host.calls.settingsModal, modal);
        assert.deepEqual(host.calls.setCanvas, [nodes['[data-media-visualizer-canvas]']]);

        for (const selector of [
            '[data-media-visualizer-settings-toggle]',
            '[data-media-visualizer-minimize]',
            '[data-media-visualizer-expand]',
            '[data-media-visualizer-bpm-snap]',
            '[data-media-visualizer-details-toggle]'
        ]) {
            assert.equal(nodes[selector].listenerCount('click'), 1, selector);
        }
        assert.equal(nodes['[data-media-visualizer-resize]'].listenerCount('pointerdown'), 1);
        assert.equal(nodes['[data-media-visualizer-mode]'].listenerCount('change'), 1);
        assert.equal(nodes['[data-media-visualizer-travel]'].listenerCount('input'), 1);
        assert.equal(modal.listenerCount('mousedown'), 1, 'header drag');
        assert.equal(win.listenerCount('mousemove'), 1);
        for (const btn of closeBtns) assert.equal(btn.listenerCount('click'), 1);
        for (const btn of popoutBtns) assert.equal(btn.listenerCount('click'), 1);

        // Details panel starts collapsed and the chrome is in docked mode.
        assert.equal(nodes['[data-media-visualizer-details]'].hidden, true);
        assert.equal(nodes['[data-media-visualizer-details-toggle]'].textContent, 'Show randomizer details');
        assert.equal(modal.classList.contains('is-minimal'), false);
        assert.equal(nodes['[data-media-visualizer-chrome-overlay]'].hidden, true);
        assert.equal(nodes['[data-media-visualizer-minimize]'].hidden, false);
        for (const btn of popoutBtns) {
            assert.equal(btn.innerHTML, CARD_ICONS.popout);
            assert.equal(btn.title, 'Pop out');
            assert.equal(btn.getAttribute('aria-label'), 'Pop out');
        }
    });

    it('renders the scene constants and the randomizer recipe in the help panel', () => {
        const { doc, win } = makeChromeDoc();
        const host = makeHost();

        const html = withDom({ doc, win }, () => ensureModal(host).innerHTML);

        assert.match(html, /media-visualizer-modal__recipe/);
        assert.ok(html.includes(`const DAY_CYCLE_MS = ${DAY_CYCLE_MS};`), 'recipe keeps the sky cycle');
        assert.ok(html.includes(`const SCENE_HOLD_MS = ${SCENE_HOLD_MS};`), 'recipe keeps the land hold');
        assert.ok(html.includes(`const TRAVEL_SPEED = ${TRAVEL_SPEED};`), 'recipe keeps the travel scale');
        assert.ok(html.includes(`Day / night cycle: ${DAY_CYCLE_MS / 1000}s (fixed, not tied to Travel)`));
        assert.ok(html.includes(`Cactus / Forest: ~${SCENE_HOLD_MS / 1000}s at 1×`));
        assert.ok(html.includes(`Sea interlude: ~${SEA_HOLD_MS / 1000}s at 1×`));
        assert.ok(html.includes(`Scene handoff: fade to black ~${SCENE_TRANSITION_MS / 1000}s at 1×`));
        for (const icon of [CARD_ICONS.collapse, CARD_ICONS.expand, CARD_ICONS.popout, CARD_ICONS.close]) {
            assert.ok(html.includes(icon), 'chrome icons inlined');
        }
        assert.ok(html.includes('data-media-visualizer-popout'), 'docked + overlay popout buttons');
    });

    it('loads stored prefs once and honours the details pref on rebuild', () => {
        const { doc, win, nodes } = makeChromeDoc();
        const host = makeHost({ detailsOpen: true });

        withDom({ doc, win }, () => ensureModal(host));
        assert.equal(host.calls.loadStoredPrefs, 1);
        assert.equal(nodes['[data-media-visualizer-details]'].hidden, false);
        assert.equal(nodes['[data-media-visualizer-details-toggle]'].textContent, 'Hide randomizer details');

        host.modal = null; // force a rebuild path
        withDom({ doc, win }, () => ensureModal(host));
        assert.equal(host.calls.loadStoredPrefs, 1, '_prefsLoaded survives rebuilds');
    });
});
describe('radio visualizer chrome · chrome state', () => {
    it('toggles the minimal chrome, its overlay and the minimize button', () => {
        const overlay = makeElement('div');
        const minimize = makeElement('button');
        const { modal, lists } = makeModalNode({
            '[data-media-visualizer-chrome-overlay]': overlay,
            '[data-media-visualizer-minimize]': minimize
        });
        const popoutBtns = [makeElement('button'), makeElement('button')];
        lists.set('[data-media-visualizer-popout]', popoutBtns);
        const host = makeHost({ modal, chromeMinimal: true });

        syncChromeMode(host);
        assert.equal(modal.classList.contains('is-minimal'), true);
        assert.equal(overlay.hidden, false);
        assert.equal(minimize.hidden, true);
        assert.equal(popoutBtns[0].title, 'Pop out', 'popout buttons refreshed too');

        host.chromeMinimal = false;
        syncChromeMode(host);
        assert.equal(modal.classList.contains('is-minimal'), false);
        assert.equal(overlay.hidden, true);
        assert.equal(minimize.hidden, false);
    });

    it('no-ops without a modal', () => {
        const host = makeHost();

        syncChromeMode(host);
        syncPopoutButtons(host);

        assert.equal(host.calls.resizeCanvas, 0);
        assert.equal(host.calls.saveStoredPrefs, 0);
    });

    it('flips the popout buttons to "Pop in" while popped out', () => {
        const { modal, lists } = makeModalNode();
        const popoutBtns = [makeElement('button'), makeElement('button')];
        lists.set('[data-media-visualizer-popout]', popoutBtns);
        const host = makeHost({ modal, poppedOut: true });

        syncPopoutButtons(host);

        for (const btn of popoutBtns) {
            assert.equal(btn.innerHTML, CARD_ICONS.popoutExit);
            assert.equal(btn.title, 'Pop in');
            assert.equal(btn.getAttribute('aria-label'), 'Pop in');
            assert.equal(btn.classList.contains('is-active'), true);
        }
    });

    it('collapses the settings panel from the toggle and persists once', () => {
        const toggleBtn = makeElement('button');
        const settingsEl = makeElement('div');
        const { modal } = makeModalNode({
            '[data-media-visualizer-settings-toggle]': toggleBtn,
            '[data-media-visualizer-settings]': settingsEl
        });
        const host = makeHost({ modal, settingsOpen: true });

        bindSettingsToggle(host, modal);
        assert.equal(toggleBtn.getAttribute('aria-expanded'), 'true');
        assert.equal(toggleBtn.getAttribute('aria-label'), 'Hide settings');
        assert.equal(settingsEl.classList.contains('is-collapsed'), false);

        toggleBtn.fire('click');

        assert.equal(host.settingsOpen, false);
        assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false');
        assert.equal(toggleBtn.getAttribute('title'), 'Show settings');
        assert.equal(settingsEl.classList.contains('is-collapsed'), true);
        assert.equal(host.calls.saveStoredPrefs, 1, 'pref write only on the click');
    });

    it('skips the settings toggle when either node is missing', () => {
        const { modal } = makeModalNode();
        const host = makeHost({ modal });

        bindSettingsToggle(host, modal);

        assert.equal(host.calls.saveStoredPrefs, 0);
    });
});

describe('radio visualizer chrome · tap tempo', () => {
    function bpmSetup(hostOverrides = {}) {
        const snap = makeElement('button');
        const slider = makeElement('input', { value: '120' });
        const label = makeElement('span');
        const { modal } = makeModalNode({
            '[data-media-visualizer-bpm-snap]': snap,
            '[data-media-visualizer-bpm]': slider,
            '[data-media-visualizer-bpm-label]': label
        });
        const host = makeHost({ modal, ...hostOverrides });
        withDom({ doc: makeDocStub(), win: makeWindowStub() }, () => bindBpmSnap(host, modal));
        return { snap, slider, label, host };
    }

    it('derives the tempo from a single tap interval', () => {
        const { snap, slider, label, host } = bpmSetup({ settings: { ...DEFAULTS, bpm: 90 } });

        withRaf(() => withPerformance([1000, 1500], () => {
            snap.fire('click'); // first tap only starts the cycle
            assert.equal(host.settings.bpm, 90);
            snap.fire('click'); // +500ms → 120 BPM
        }));

        assert.equal(host.settings.bpm, 120);
        assert.equal(slider.value, '120');
        assert.equal(label.textContent, 'BPM: 120');
        assert.equal(snap.style.transform, '', 'tap pulse resets on the rAF pair');
    });

    it('ignores sub-250ms taps and clamps wild tempos to 200', () => {
        const fast = bpmSetup({ settings: { ...DEFAULTS, bpm: 90 } });
        withRaf(() => withPerformance([1000, 1100], () => {
            fast.snap.fire('click');
            fast.snap.fire('click');
        }));
        assert.equal(fast.host.settings.bpm, 90, 'too fast → not recorded');
        assert.deepEqual(fast.host.tapBpmTimes, []);

        const wild = bpmSetup({ settings: { ...DEFAULTS, bpm: 90 } });
        withRaf(() => withPerformance([1000, 1260], () => {
            wild.snap.fire('click');
            wild.snap.fire('click');
        }));
        assert.equal(wild.host.settings.bpm, 200, '231 BPM → clamped');
        assert.equal(wild.slider.value, '200');
    });

    it('starts a fresh cycle after a >3s gap', () => {
        const { snap, host } = bpmSetup({ settings: { ...DEFAULTS, bpm: 90 } });

        withRaf(() => withPerformance([1000, 1500, 5000], () => {
            snap.fire('click');
            snap.fire('click');
            assert.equal(host.settings.bpm, 120);
            snap.fire('click'); // 3500ms later → reset, no new tempo
        }));

        assert.equal(host.settings.bpm, 120);
        assert.deepEqual(host.tapBpmTimes, []);
        assert.equal(host.tapBpmLastTime, 5000);
    });

    it('does nothing when the tap button is absent', () => {
        const { modal } = makeModalNode();
        const host = makeHost({ modal });

        bindBpmSnap(host, modal);

        assert.equal(host.settings.bpm, DEFAULTS.bpm);
    });
});

describe('radio visualizer chrome · drag + resize', () => {
    it('drags the docked modal within the viewport and persists on release', () => {
        const { modal } = makeModalNode();
        modal.rect = { left: 100, top: 100, width: 400, height: 300 };
        const win = makeWindowStub({ innerWidth: 1200, innerHeight: 800 });
        const host = makeHost({ modal });

        withDom({ doc: makeDocStub(), win }, () => {
            bindModalDrag(host, modal);

            modal.fire('mousedown', {
                button: 0,
                clientX: 150,
                clientY: 150,
                target: { closest: () => null }
            });
            assert.equal(modal.classList.contains('is-dragging'), true);

            win.fire('mousemove', { clientX: 1200, clientY: -100 });
            assert.equal(modal.style.left, '880px', 'clamped to viewport width - 320');
            assert.equal(modal.style.top, '8px', 'clamped to the top margin');

            win.fire('mouseup');
            assert.equal(modal.classList.contains('is-dragging'), false);
        });

        assert.equal(host.calls.saveStoredPrefs, 1);
    });

    it('ignores drags that start on interactive chrome or while popped out', () => {
        const { modal } = makeModalNode();
        modal.rect = { left: 100, top: 100, width: 400, height: 300 };
        const win = makeWindowStub();
        const host = makeHost({ modal });

        withDom({ doc: makeDocStub(), win }, () => {
            bindModalDrag(host, modal);

            modal.fire('mousedown', {
                button: 0,
                clientX: 10,
                clientY: 10,
                target: { closest: () => ({ tagName: 'button' }) }
            });
            win.fire('mousemove', { clientX: 900, clientY: 400 });
            assert.equal(modal.style.left, undefined, 'interactive target');

            host.poppedOut = true;
            modal.fire('mousedown', {
                button: 0,
                clientX: 10,
                clientY: 10,
                target: { closest: () => null }
            });
            win.fire('mousemove', { clientX: 900, clientY: 400 });
            assert.equal(modal.style.left, undefined, 'popped out');
        });
    });
});

describe('radio visualizer chrome · panel resize', () => {
    it('resizes the panel from the corner handle, clamps and repaints', () => {
        const handle = makeElement('div');
        const canvas = makeElement('canvas', { rect: { height: 300 } });
        const { modal } = makeModalNode({
            '[data-media-visualizer-resize]': handle,
            '[data-media-visualizer-canvas]': canvas
        });
        modal.rect = { left: 0, top: 0, width: 400, height: 300 };
        const win = makeWindowStub({ innerWidth: 1200, innerHeight: 800 });
        const host = makeHost({ modal });

        withDom({ doc: makeDocStub(), win }, () => {
            bindPanelResize(host, modal);

            handle.fire('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 });
            win.fire('pointermove', { clientX: 500, clientY: 500 });

            assert.equal(host.panelWidth, 800);
            assert.equal(host.canvasHeight, 560, 'clamped to 70% of the viewport height');
            assert.equal(modal.style.width, '800px');
            assert.equal(canvas.style.height, '560px');
            assert.equal(host.calls.resizeCanvas, 1);
            assert.equal(host.calls.saveStoredPrefs, 0, 'not persisted mid-drag');

            win.fire('pointerup');
            assert.equal(win.listenerCount('pointermove'), 0, 'drag listeners released');
        });

        assert.equal(host.calls.saveStoredPrefs, 1);
    });

    it('clamps to the 320px minimum width', () => {
        const handle = makeElement('div');
        const canvas = makeElement('canvas', { rect: { height: 300 } });
        const { modal } = makeModalNode({
            '[data-media-visualizer-resize]': handle,
            '[data-media-visualizer-canvas]': canvas
        });
        modal.rect = { left: 0, top: 0, width: 400, height: 300 };
        const win = makeWindowStub();
        const host = makeHost({ modal });

        withDom({ doc: makeDocStub(), win }, () => {
            bindPanelResize(host, modal);
            handle.fire('pointerdown', { clientX: 400, clientY: 300, pointerId: 1 });
            win.fire('pointermove', { clientX: -900, clientY: -900 });
        });

        assert.equal(host.panelWidth, 320);
        assert.equal(host.canvasHeight, 120);
    });

    it('skips resizing without a handle or a canvas', () => {
        const { modal } = makeModalNode();
        const host = makeHost({ modal });

        bindPanelResize(host, modal);

        assert.equal(host.calls.resizeCanvas, 0);
        assert.equal(host.calls.saveStoredPrefs, 0);
    });
});

describe('radio visualizer chrome · chrome actions', () => {
    function actionsSetup(hostOverrides = {}) {
        const minimize = makeElement('button');
        const expand = makeElement('button');
        const settingsEl = makeElement('div');
        const toggleBtn = makeElement('button');
        const overlay = makeElement('div');
        const { modal, lists } = makeModalNode({
            '[data-media-visualizer-minimize]': minimize,
            '[data-media-visualizer-expand]': expand,
            '[data-media-visualizer-settings]': settingsEl,
            '[data-media-visualizer-settings-toggle]': toggleBtn,
            '[data-media-visualizer-chrome-overlay]': overlay
        });
        const popoutBtns = [makeElement('button'), makeElement('button')];
        lists.set('[data-media-visualizer-popout]', popoutBtns);
        const host = makeHost({ modal, ...hostOverrides });
        bindChromeActions(host, modal);
        return { modal, minimize, expand, settingsEl, toggleBtn, overlay, popoutBtns, host };
    }

    it('minimizes to the slim chrome bar and persists', () => {
        const { minimize, settingsEl, toggleBtn, host } = actionsSetup({ settingsOpen: true });

        const event = minimize.fire('click');

        assert.equal(event.stopped, true, 'does not bubble to the drag handler');
        assert.equal(host.chromeMinimal, true);
        assert.equal(host.settingsOpen, false);
        assert.equal(settingsEl.classList.contains('is-collapsed'), true);
        assert.equal(toggleBtn.getAttribute('aria-expanded'), 'false');
        assert.equal(toggleBtn.getAttribute('aria-label'), 'Show settings');
        assert.equal(toggleBtn.getAttribute('title'), 'Show settings');
        assert.equal(host.calls.resizeCanvas, 1);
        assert.equal(host.calls.saveStoredPrefs, 1);
    });

    it('expands back to the full chrome', () => {
        const { expand, modal, overlay, host } = actionsSetup({ chromeMinimal: true });

        expand.fire('click');

        assert.equal(host.chromeMinimal, false);
        assert.equal(modal.classList.contains('is-minimal'), false);
        assert.equal(overlay.hidden, true);
        assert.equal(host.calls.resizeCanvas, 1);
        assert.equal(host.calls.saveStoredPrefs, 1);
    });

    it('closes through both dialog close buttons', () => {
        const { doc, win, closeBtns } = makeChromeDoc();
        const host = makeHost();

        withDom({ doc, win }, () => ensureModal(host));
        const event = closeBtns[0].fire('click');
        closeBtns[1].fire('click');

        assert.equal(event.stopped, true);
        assert.deepEqual(host.calls.toggle, [false, false]);
    });

    it('docks the modal again from the popout button while popped out', () => {
        const { popoutBtns, modal, host } = actionsSetup({ poppedOut: true });
        const doc = makeDocStub();

        withDom({ doc, win: makeWindowStub() }, () => popoutBtns[1].fire('click'));

        assert.equal(host.poppedOut, false);
        assert.equal(doc.appended.at(-1), modal, 're-docked into the main document');
        assert.equal(host.calls.saveStoredPrefs, 1);
        assert.equal(host.calls.resizeCanvas, 1);
    });
});

describe('radio visualizer chrome · open + close', () => {
    it('reveals the modal, wires the title/canvas and refreshes the labels', () => {
        const title = makeElement('span');
        const canvas = makeElement('canvas');
        const { modal } = makeModalNode({
            '.media-visualizer-modal__title': title,
            '[data-media-visualizer-canvas]': canvas
        });
        modal.className = 'media-visualizer-modal is-hidden';
        const host = makeHost({ modal, _prefsLoaded: true });
        const media = { id: 'audio' };

        const opened = withDom({ doc: makeDocStub(), win: makeWindowStub() }, () =>
            openModal(host, { title: 'Radio', mediaElement: media })
        );

        assert.equal(opened, modal);
        assert.equal(modal.classList.contains('is-hidden'), false);
        assert.equal(modal.getAttribute('aria-label'), 'Radio');
        assert.equal(title.textContent, 'Radio');
        assert.deepEqual(host.calls.setMediaElement, [media]);
        assert.deepEqual(host.calls.setCanvas, [canvas]);
        assert.equal(host.calls.syncControlLabels, 1);
        assert.equal(host.calls.updateStatus, 1);
    });

    it('defaults the title and reuses the current media element', () => {
        const { modal, nodes } = makeModalNode({ '.media-visualizer-modal__title': makeElement('span') });
        const media = { id: 'current' };
        const host = makeHost({ modal, mediaElement: media, _prefsLoaded: true });

        openModal(host);

        assert.equal(host.calls.setMediaElement[0], media);
        assert.equal(nodes.get('.media-visualizer-modal__title').textContent, 'Radio visualizer');
        assert.equal(modal.getAttribute('aria-label'), 'Radio visualizer');
    });

    it('tears the session down and repaints the idle frame', () => {
        const { modal } = makeModalNode();
        modal.className = 'media-visualizer-modal';
        const cancelled = [];
        const host = makeHost({
            modal,
            enabled: true,
            rafId: 42,
            analysisLive: true,
            analysisBlocked: true,
            energyHistory: [{ value: 1 }],
            silenceSince: 123,
            canvas: {}
        });

        withDom({ doc: makeDocStub(), win: makeWindowStub() }, () =>
            withGlobal('cancelAnimationFrame', (id) => cancelled.push(id), () => closeModal(host))
        );

        assert.equal(host.enabled, false);
        assert.equal(host.rafId, null);
        assert.deepEqual(cancelled, [42]);
        assert.equal(modal.classList.contains('is-hidden'), true);
        assert.equal(host.analysisLive, false);
        assert.equal(host.analysisBlocked, false);
        assert.deepEqual(host.energyHistory, []);
        assert.equal(host.silenceSince, null);
        assert.equal(host.calls.updateStatus, 1);
        assert.equal(host.calls.drawIdleFrame, 1);
        assert.equal(host.calls.saveStoredPrefs, 1);
    });

    it('pops in before hiding when closed while popped out', () => {
        const { modal } = makeModalNode();
        const popWin = makeWindowStub();
        const host = makeHost({ modal, poppedOut: true, popoutWindow: popWin, canvas: {} });
        const doc = makeDocStub();

        withDom({ doc, win: makeWindowStub() }, () => closeModal(host));

        assert.equal(popWin.closeCalls, 1, 'popout window closed');
        assert.equal(host.poppedOut, false);
        assert.equal(doc.appended.at(-1), modal, 'modal re-docked');
        assert.equal(modal.classList.contains('is-hidden'), true);
    });
});

describe('radio visualizer chrome · dock rect', () => {
    it('captures the docked geometry from the prefs and persists', () => {
        const { modal } = makeModalNode();
        modal.rect = { left: 40, top: 60, width: 500, height: 400 };
        const host = makeHost({ modal, panelWidth: 520, canvasHeight: 260 });

        saveDockRect(host);

        assert.deepEqual(host.savedDockRect, { left: 40, top: 60, width: 520, canvasHeight: 260 });
        assert.equal(host.calls.saveStoredPrefs, 1);
    });

    it('falls back to the measured box when the prefs are empty', () => {
        const canvas = makeElement('canvas', { rect: { height: 222 } });
        const { modal } = makeModalNode({ '[data-media-visualizer-canvas]': canvas });
        modal.rect = { left: 10, top: 20, width: 640, height: 500 };
        const host = makeHost({ modal, panelWidth: 0, canvasHeight: 0 });

        saveDockRect(host);

        assert.deepEqual(host.savedDockRect, { left: 10, top: 20, width: 640, canvasHeight: 222 });
    });

    it('skips the snapshot while popped out or without a modal', () => {
        const { modal } = makeModalNode();
        const host = makeHost({ modal, poppedOut: true, savedDockRect: null });

        saveDockRect(host);
        assert.equal(host.savedDockRect, null);
        assert.equal(host.calls.saveStoredPrefs, 0);

        const empty = makeHost();
        saveDockRect(empty);
        assert.equal(empty.savedDockRect, null);
        assert.equal(empty.calls.saveStoredPrefs, 0);
    });

    it('restores the saved dock box and resizes the canvas', () => {
        const canvas = makeElement('canvas');
        const { modal } = makeModalNode({ '[data-media-visualizer-canvas]': canvas });
        const host = makeHost({ modal, savedDockRect: { left: 12, top: 34, width: 700, canvasHeight: 300 } });

        restoreDockRect(host);

        assert.equal(modal.style.left, '12px');
        assert.equal(modal.style.top, '34px');
        assert.equal(modal.style.width, '700px');
        assert.equal(canvas.style.height, '300px');
        assert.equal(host.canvasHeight, 300);
        assert.equal(host.panelWidth, 700);
        assert.equal(host.calls.resizeCanvas, 1);

        const bare = makeHost({ modal });
        restoreDockRect(bare);
        assert.equal(bare.calls.resizeCanvas, 0, 'nothing saved means no-op');
    });
});

describe('radio visualizer chrome · popout lifecycle', () => {
    it('focuses the existing popout window instead of opening another', async () => {
        const win = makeWindowStub();
        const host = makeHost({ poppedOut: true, popoutWindow: win });

        await popOut(host);

        assert.equal(win.focused, 1);
        assert.equal(host.calls.saveStoredPrefs, 0, 'no dock snapshot while popped out');
    });

    it('no-ops without a modal or a window', async () => {
        const host = makeHost();

        await popOut(host);

        assert.equal(host.poppedOut, false);
        assert.equal(host.popoutWindow, null);
        assert.equal(host.calls.saveStoredPrefs, 0);
    });

    it('re-docks the modal, closes the window and restores the dock box', () => {
        const canvas = makeElement('canvas', { rect: { height: 250 } });
        const { modal } = makeModalNode({
            '[data-media-visualizer-canvas]': canvas,
            '[data-media-visualizer-chrome-overlay]': makeElement('div'),
            '[data-media-visualizer-minimize]': makeElement('button')
        });
        modal.style.left = '400px';
        const popWin = makeWindowStub();
        const popDoc = makeElement('document');
        const onKey = () => {};
        popDoc.addEventListener('keydown', onKey);
        const host = makeHost({
            modal,
            poppedOut: true,
            popoutWindow: popWin,
            popoutDoc: popDoc,
            popoutOnKey: onKey,
            popoutOnPageHide: onKey,
            savedDockRect: { left: 20, top: 30, width: 480, canvasHeight: 200 }
        });
        const doc = makeDocStub();

        withDom({ doc, win: makeWindowStub() }, () => popIn(host));

        assert.equal(popWin.closeCalls, 1, 'popout window closed');
        assert.equal(popDoc.listenerCount('keydown'), 0, 'Escape handler removed');
        assert.equal(host.poppedOut, false);
        assert.equal(host.popoutWindow, null);
        assert.equal(host.popoutDoc, null);
        assert.equal(host.popoutOnKey, null);
        assert.equal(host.popoutOnPageHide, null);
        assert.equal(doc.appended.at(-1), modal, 'modal adopted by the main body');
        assert.equal(modal.style.left, '20px', 'saved dock box restored');
        assert.equal(modal.style.top, '30px');
        assert.equal(modal.style.width, '480px');
        assert.equal(canvas.style.height, '200px');
        assert.equal(host.savedDockRect, null, 'snapshot consumed');
        assert.equal(host.calls.resizeCanvas, 2, 'restoreDockRect + the pop-in refresh');
        assert.equal(host.calls.saveStoredPrefs, 1);
    });

    it('keeps an externally closed window alone but still re-docks', () => {
        const { modal } = makeModalNode();
        const popWin = makeWindowStub();
        popWin.closed = true;
        const host = makeHost({ modal, poppedOut: true, popoutWindow: popWin });

        withDom({ doc: makeDocStub(), win: makeWindowStub() }, () =>
            popIn(host, { fromExternalClose: true })
        );

        assert.equal(popWin.closeCalls, undefined, 'pagehide already closed it');
        assert.equal(host.poppedOut, false);
        assert.equal(host.calls.saveStoredPrefs, 1);
    });

    it('no-ops when the modal was never popped out', () => {
        const host = makeHost({ modal: makeElement('div') });

        popIn(host);

        assert.equal(host.calls.saveStoredPrefs, 0);
        assert.equal(host.calls.resizeCanvas, 0);
    });
});

