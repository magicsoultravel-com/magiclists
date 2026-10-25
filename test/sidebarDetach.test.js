// test/sidebarDetach.test.js
// Detached (floating) sidebar mode: default geometry, width-event propagation,
// docked-width isolation, corner-resize persistence, reattach restore,
// cross-tab storage apply, backup apply, and clamping/normalization.
//
// Run with: npm test  (node --test)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    SIDEBAR_DETACHED_KEY,
    SIDEBAR_DEFAULT_WIDTH,
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_WIDTH_KEY,
    normalizeDetachedGeometry,
    readSidebarDetach,
    writeSidebarDetach
} from '../js/sidebarPrefs.js';
import {
    SIDEBAR_COMPACT_CLASSES,
    SIDEBAR_DETACH_ENABLED,
    SIDEBAR_DETACH_HANDLE_SEL,
    applyDetachedGeometry,
    collapseSidebar,
    detachSidebar,
    initSidebarDetach,
    isDetached,
    isSidebarDetachEnabled,
    readDetachedGeometry,
    reattachSidebar,
    resetDetachedGeometry,
    setSidebarDetachEnabled,
    sidebarDetach
} from '../js/sidebarDetach.js';
import { initShellResize } from '../js/shellResize.js';
import { resetStableBoardLayoutWidth } from '../js/board/boardExtents.js';
import { ToolsManager } from '../js/toolsManager.js';
import * as sidebarModules from '../js/sidebarModules.js';

const SURFACE_RECT = { left: 260, top: 40, width: 1000, height: 700 };
const MARGIN = 8;
const MIN_HEIGHT = 120;

const memory = new Map();
globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => void memory.set(key, String(value)),
    removeItem: (key) => void memory.delete(key),
    clear: () => memory.clear(),
    key: (index) => [...memory.keys()][index] ?? null,
    get length() {
        return memory.size;
    }
};

/**
 * Minimal MutationObserver stand-in with browser semantics for the one case the
 * feedback loop needs: `class` attribute changes are queued and delivered in a
 * single microtask, honouring attributeFilter. Without this the harness cannot
 * reproduce the #side-panel ⇄ tools:desktop_bounds_changed cycle at all, which
 * is why the suite stayed green while the app froze.
 */
const classObservers = new Set();
const classMutationQueue = [];
let classMutationFlushScheduled = false;
let classMutationFlushes = 0;
/** A real browser freezes here; the harness fails the test instead (see below). */
const CLASS_MUTATION_FLUSH_LIMIT = 2000;

function queueClassMutation(target, attributeName) {
    classMutationQueue.push({ target, attributeName, type: 'attributes' });
    if (classMutationFlushScheduled) return;
    classMutationFlushScheduled = true;
    queueMicrotask(() => {
        classMutationFlushScheduled = false;
        classMutationFlushes += 1;
        if (classMutationFlushes > CLASS_MUTATION_FLUSH_LIMIT) {
            // An observer that keeps re-arming itself starves the event loop and
            // cannot be interrupted by the test runner's own timeout, so refuse to
            // keep going: the throw unwinds the cycle and fails the test.
            throw new Error(
                `MutationObserver storm: ${classMutationFlushes} class-mutation batches — feedback loop`
            );
        }
        const pending = classMutationQueue.splice(0, classMutationQueue.length);
        [...classObservers].forEach((record) => {
            const matches = pending.filter((mutation) => mutation.target === record.target
                && (!record.options?.attributeFilter
                    || record.options.attributeFilter.includes(mutation.attributeName)));
            if (matches.length) record.callback(matches, record.observer);
        });
    });
}

class FakeMutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.record = null;
    }

    observe(target, options = {}) {
        this.record = { observer: this, target, options, callback: this.callback };
        classObservers.add(this.record);
    }

    disconnect() {
        if (this.record) classObservers.delete(this.record);
        this.record = null;
    }

    takeRecords() {
        return [];
    }
}

globalThis.MutationObserver = FakeMutationObserver;

function makeClassList(initial = [], onMutate = null) {
    const set = new Set(initial);
    const changed = () => {
        if (onMutate) onMutate();
    };
    return {
        add(...names) {
            let touched = false;
            names.forEach((name) => {
                if (set.has(name)) return;
                set.add(name);
                touched = true;
            });
            if (touched) changed();
        },
        remove(...names) {
            let touched = false;
            names.forEach((name) => {
                if (set.delete(name)) touched = true;
            });
            if (touched) changed();
        },
        contains(name) { return set.has(name); },
        toggle(name, force) {
            const had = set.has(name);
            const next = force === undefined ? !had : force;
            if (next) set.add(name);
            else set.delete(name);
            if (next !== had) changed();
            return next;
        }
    };
}

function makeStyle() {
    const props = new Map();
    return {
        getPropertyValue: (key) => (props.has(key) ? props.get(key) : ''),
        setProperty: (key, value) => void props.set(key, String(value)),
        removeProperty: (key) => void props.delete(key),
        clear: () => props.clear()
    };
}

function makeEl({ id = '', classes = [], onClassMutation = null } = {}) {
    const el = {
        id,
        isConnected: true,
        offsetWidth: SIDEBAR_DEFAULT_WIDTH,
        offsetHeight: 320,
        innerHTML: '',
        title: '',
        style: makeStyle(),
        dataset: {},
        attrs: {},
        children: [],
        listeners: {},
        classList: makeClassList(classes, onClassMutation),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: el.offsetWidth, height: el.offsetHeight }),
        setAttribute(name, value) { el.attrs[name] = String(value); },
        getAttribute(name) { return el.attrs[name] ?? null; },
        addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
        removeEventListener(type, fn) {
            el.listeners[type] = (el.listeners[type] || []).filter((candidate) => candidate !== fn);
        },
        appendChild(child) { el.children.push(child); child.parentElement = el; return child; },
        insertAdjacentElement(_position, child) { el.children.push(child); child.parentElement = el; return child; },
        querySelector(selector) { return el._querySelector ? el._querySelector(selector) : null; },
        querySelectorAll: () => [],
        closest: () => null,
        setPointerCapture: () => {},
        focus: () => {},
        remove() { el.isConnected = false; }
    };
    return el;
}

function createEnv() {
    const surface = makeEl({ id: 'desktop-surface' });
    surface.getBoundingClientRect = () => SURFACE_RECT;

    const scaleInner = makeEl({ classes: ['side-panel-scale-inner'] });
    const brandRow = makeEl({ classes: ['control-bar-brand', 'is-in-sidebar'] });
    const panel = makeEl({
        id: 'side-panel',
        classes: ['side-panel'],
        onClassMutation: () => queueClassMutation(panel, 'class')
    });
    panel.getBoundingClientRect = () => ({
        left: Number.parseFloat(panel.style.getPropertyValue('left')) || 0,
        top: Number.parseFloat(panel.style.getPropertyValue('top')) || 0,
        width: panel.offsetWidth,
        height: panel.offsetHeight
    });
    panel._querySelector = (selector) => {
        if (selector === '.side-panel-scale-inner') return scaleInner;
        if (selector === '.control-bar-brand') return brandRow;
        if (selector === SIDEBAR_DETACH_HANDLE_SEL) {
            return panel.children.find((child) => child.attrs['data-sidebar-detach-resize']) ?? null;
        }
        return null;
    };

    const toggle = makeEl({ id: 'sidebar-detach-toggle', classes: ['sidebar-detach-toggle'] });
    const collapse = makeEl({ id: 'sidebar-collapse', classes: ['sidebar-collapse'] });
    const byId = {
        'desktop-surface': surface,
        'side-panel': panel,
        'sidebar-detach-toggle': toggle,
        'sidebar-collapse': collapse
    };
    const documentListeners = new Map();
    const doc = {
        body: makeEl({ classes: [] }),
        getElementById: (id) => byId[id] ?? null,
        querySelector: (selector) => {
            if (selector === '[data-sidebar-detach-toggle]') return toggle;
            if (selector === '[data-sidebar-collapse]') return collapse;
            return null;
        },
        createElement: () => makeEl(),
        addEventListener(type, fn) {
            if (!documentListeners.has(type)) documentListeners.set(type, []);
            documentListeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            documentListeners.set(type, (documentListeners.get(type) || []).filter((candidate) => candidate !== fn));
        },
        dispatch(type, event = {}) {
            (documentListeners.get(type) || []).forEach((fn) => fn({ type, ...event }));
        }
    };

    const windowListeners = new Map();
    const win = {
        innerWidth: 1280,
        innerHeight: 800,
        addEventListener(type, fn) {
            if (!windowListeners.has(type)) windowListeners.set(type, []);
            windowListeners.get(type).push(fn);
        },
        removeEventListener(type, fn) {
            windowListeners.set(type, (windowListeners.get(type) || []).filter((candidate) => candidate !== fn));
        },
        dispatchEvent(event) {
            (windowListeners.get(event.type) || []).forEach((fn) => fn(event));
            return true;
        },
        dispatch(type, detail = {}) {
            (windowListeners.get(type) || []).forEach((fn) => fn({ type, ...detail }));
        }
    };

    return { surface, panel, toggle, collapse, brandRow, document: doc, window: win };
}

const env = createEnv();
globalThis.document = env.document;
globalThis.window = env.window;

/** Fresh DOM for the same page — persisted storage is left untouched. */
function resetPanelDom() {
    const { panel } = env;
    // Fresh DOM: strip every detach/compact class and re-arm the tray controls —
    // the idempotent bind guards live on the elements, so a reload must clear them.
    panel.classList.remove(
        'is-detached',
        'is-detached--sized',
        'is-detached-dragging',
        'is-collapsed',
        ...SIDEBAR_COMPACT_CLASSES
    );
    ['--sidebar-width', '--sidebar-ui-scale', 'left', 'top', 'height', 'width'].forEach((prop) => {
        panel.style.removeProperty(prop);
    });
    panel.offsetWidth = SIDEBAR_DEFAULT_WIDTH;
    panel.offsetHeight = 320;
    panel.children.length = 0;

    env.collapse.listeners.click = [];
    env.collapse.dataset = {};
    env.collapse.innerHTML = '';
    env.collapse.title = '';
    env.collapse.attrs = {};

    env.document.body.classList.remove(
        'is-sidebar-detached',
        'is-sidebar-detaching',
        'is-sidebar-detached-dragging',
        'is-sidebar-detached-resizing'
    );
}

function resetEnv() {
    memory.clear();
    // Drop observers before touching the DOM: resetPanelDom mutates classes and
    // would otherwise queue records for the next test.
    [...classObservers].forEach((record) => record.observer?.disconnect?.());
    classObservers.clear();
    classMutationQueue.length = 0;
    classMutationFlushes = 0;
    ToolsManager._desktopBoundsWatcher?.disconnect?.();
    delete ToolsManager._desktopBoundsWatcher;
    resetStableBoardLayoutWidth();
    resetPanelDom();
    // Every test but the kill-switch block runs an enabled build.
    setSidebarDetachEnabled(true);
    env.toggle.hidden = false;
    env.toggle.style.display = '';
    delete env.toggle.attrs['aria-hidden'];
    delete env.toggle.attrs.tabindex;
}

/** Let queued microtasks and the coalesced setTimeout(0) broadcasts run. */
function flushFrame() {
    return new Promise((resolve) => setTimeout(resolve, 5));
}

/** Count tools:desktop_bounds_changed dispatches for the duration of a test. */
function countBoundsBroadcasts({ limit = 200 } = {}) {
    const counter = { count: 0, restore: () => {} };
    const original = env.window.dispatchEvent;
    env.window.dispatchEvent = (event) => {
        if (event?.type === 'tools:desktop_bounds_changed') {
            counter.count += 1;
            if (counter.count > limit) {
                counter.restore();
                throw new Error(
                    `tools:desktop_bounds_changed storm (>${limit}) — feedback loop`
                );
            }
        }
        return original(event);
    };
    counter.restore = () => { env.window.dispatchEvent = original; };
    return counter;
}

/** Seed the docked width, then boot the shell + detach modules in app order. */
function boot({ dockedWidth = null } = {}) {
    if (dockedWidth != null) memory.set(SIDEBAR_WIDTH_KEY, String(dockedWidth));
    initShellResize();
    initSidebarDetach();
    return env.panel;
}

/** Simulate a page reload: same localStorage, fresh DOM, same init order. */
function reload() {
    resetPanelDom();
    initShellResize();
    initSidebarDetach();
    return env.panel;
}

beforeEach(() => resetEnv());

describe('sidebarDetach · detach defaults', () => {
    it('opens at the 220px default width, auto height, top-left of the board surface', () => {
        const panel = boot({ dockedWidth: 400 });
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '400px');

        assert.equal(detachSidebar(), true);
        assert.equal(isDetached(), true);
        assert.ok(panel.classList.contains('is-detached'));

        assert.equal(panel.style.getPropertyValue('--sidebar-width'), `${SIDEBAR_DEFAULT_WIDTH}px`);
        assert.equal(panel.style.getPropertyValue('--sidebar-ui-scale'), '1');
        assert.equal(panel.style.getPropertyValue('height'), '');
        assert.equal(panel.classList.contains('is-detached--sized'), false);
        assert.equal(panel.style.getPropertyValue('left'), `${SURFACE_RECT.left + MARGIN}px`);
        assert.equal(panel.style.getPropertyValue('top'), `${SURFACE_RECT.top + MARGIN}px`);
        assert.ok(env.document.body.classList.contains('is-sidebar-detached'));

        const stored = readSidebarDetach();
        assert.equal(stored.detached, true);
        assert.equal(stored.geometry.width, SIDEBAR_DEFAULT_WIDTH);
        assert.equal(stored.geometry.height, null);
    });

    it('drops a stale collapsed class so the panel is visible when floating', () => {
        const panel = boot({ dockedWidth: 400 });
        panel.classList.add('is-collapsed');
        detachSidebar();
        assert.equal(panel.classList.contains('is-collapsed'), false);
        assert.equal(isDetached(), true);
    });

    it('is idempotent and reattach no-ops when already docked', () => {
        boot({ dockedWidth: 400 });
        assert.equal(reattachSidebar(), false);
        assert.equal(detachSidebar(), true);
        assert.equal(detachSidebar(), false);
    });
});

describe('sidebarDetach · storage boundary', () => {
    it('never writes the docked width while detached or resized', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();
        applyDetachedGeometry({ width: 300, height: 420 });

        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '300px');
        assert.equal(memory.get(SIDEBAR_WIDTH_KEY), '400');
        assert.equal(readDetachedGeometry().width, 300);
    });

    it('clears persisted detach state on reattach but keeps the docked width', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();
        applyDetachedGeometry({ width: 300, height: 420 });

        assert.equal(reattachSidebar(), true);
        assert.equal(isDetached(), false);
        assert.equal(panel.classList.contains('is-detached--sized'), false);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '400px');
        assert.equal(panel.style.getPropertyValue('left'), '');
        assert.equal(panel.style.getPropertyValue('top'), '');
        assert.equal(panel.style.getPropertyValue('height'), '');
        assert.equal(env.document.body.classList.contains('is-sidebar-detached'), false);
        assert.equal(memory.has(SIDEBAR_DETACHED_KEY), false);
        assert.equal(memory.get(SIDEBAR_WIDTH_KEY), '400');
    });
});

describe('sidebarDetach · reflow events', () => {
    it('fires sidebar:width_changed on detach, detached resize and reattach', () => {
        boot({ dockedWidth: 400 });
        let count = 0;
        const onWidthChanged = () => { count += 1; };
        env.window.addEventListener('sidebar:width_changed', onWidthChanged);

        detachSidebar();
        const afterDetach = count;
        assert.ok(afterDetach >= 1, 'detach reflows modules');

        applyDetachedGeometry({ width: 260, height: 300 });
        const afterResize = count;
        assert.ok(afterResize > afterDetach, 'detached resize reflows modules');

        reattachSidebar();
        assert.ok(count > afterResize, 'reattach reflows modules');
        env.window.removeEventListener('sidebar:width_changed', onWidthChanged);
    });
});

describe('sidebarDetach · corner resize', () => {
    function pointerEvent(target, x, y) {
        return {
            clientX: x,
            clientY: y,
            pointerId: 1,
            button: 0,
            target,
            currentTarget: target,
            preventDefault: () => {},
            stopPropagation: () => {}
        };
    }

    it('resizes from the SE handle and persists the geometry', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();

        const handle = panel.children.find((child) => child.attrs['data-sidebar-detach-resize'] === 'se');
        assert.ok(handle, 'SE handle is mounted');

        handle.listeners.pointerdown[0](pointerEvent(handle, 500, 400));
        env.document.dispatch('pointermove', pointerEvent(handle, 560, 450));
        env.document.dispatch('pointerup', pointerEvent(handle, 560, 450));

        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '280px');
        assert.equal(panel.style.getPropertyValue('height'), '370px');
        assert.ok(panel.classList.contains('is-detached--sized'));

        const stored = readSidebarDetach();
        assert.equal(stored.detached, true);
        assert.equal(stored.geometry.width, 280);
        assert.equal(stored.geometry.height, 370);
        assert.equal(stored.geometry.x, SURFACE_RECT.left + MARGIN);
        assert.equal(stored.geometry.y, SURFACE_RECT.top + MARGIN);
        assert.equal(memory.get(SIDEBAR_WIDTH_KEY), '400');
    });

    it('anchors the opposite corner when resizing from the NW handle', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();
        applyDetachedGeometry({ width: 300, height: 400, x: 500, y: 300 });

        const handle = panel.children.find((child) => child.attrs['data-sidebar-detach-resize'] === 'nw');
        assert.ok(handle, 'NW handle is mounted');

        // Shrink by 40x40: the SE edge (left+width / top+height) must not move.
        handle.listeners.pointerdown[0](pointerEvent(handle, 500, 300));
        env.document.dispatch('pointermove', pointerEvent(handle, 540, 340));
        env.document.dispatch('pointerup', pointerEvent(handle, 540, 340));

        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '260px');
        assert.equal(panel.style.getPropertyValue('height'), '360px');
        assert.equal(panel.style.getPropertyValue('left'), '540px');
        assert.equal(panel.style.getPropertyValue('top'), '340px');
    });
});

describe('sidebarDetach · external state application', () => {
    it('applies a cross-tab storage event in both directions', () => {
        const panel = boot({ dockedWidth: 400 });

        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({
            detached: true,
            geometry: { width: 260, height: 340, x: 300, y: 60 }
        }));
        env.window.dispatch('storage', { key: SIDEBAR_DETACHED_KEY });

        assert.equal(isDetached(), true);
        assert.ok(panel.classList.contains('is-detached'));
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '260px');
        assert.equal(panel.style.getPropertyValue('height'), '340px');
        assert.equal(panel.style.getPropertyValue('left'), '300px');
        assert.equal(panel.style.getPropertyValue('top'), '60px');

        memory.delete(SIDEBAR_DETACHED_KEY);
        env.window.dispatch('storage', { key: SIDEBAR_DETACHED_KEY });

        assert.equal(isDetached(), false);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '400px');
    });

    it('ignores storage events for unrelated keys', () => {
        const panel = boot({ dockedWidth: 400 });
        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({ detached: true, geometry: null }));
        env.window.dispatch('storage', { key: 'matrix_sidebar_width' });
        assert.equal(isDetached(), false);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '400px');
    });

    it('applies a restored backup state through applyStoredState()', () => {
        const panel = boot({ dockedWidth: 400 });
        assert.equal(isDetached(), false);

        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({ detached: true, geometry: null }));
        sidebarDetach.applyStoredState();

        assert.equal(isDetached(), true);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), `${SIDEBAR_DEFAULT_WIDTH}px`);
        assert.equal(panel.style.getPropertyValue('height'), '');
    });
});

describe('sidebarDetach · clamping and normalization', () => {
    it('clamps undersized width/height requests up to the floors', () => {
        boot({ dockedWidth: 400 });
        detachSidebar();

        const applied = applyDetachedGeometry({ width: 5, height: 5 });
        assert.equal(applied.width, SIDEBAR_MIN_WIDTH);
        assert.equal(applied.height, MIN_HEIGHT);
        assert.equal(env.panel.style.getPropertyValue('--sidebar-width'), `${SIDEBAR_MIN_WIDTH}px`);
        assert.equal(env.panel.style.getPropertyValue('height'), `${MIN_HEIGHT}px`);
    });

    it('clamps drag/resize positions inside the board surface', () => {
        boot({ dockedWidth: 400 });
        detachSidebar();

        const applied = applyDetachedGeometry({ width: 240, height: 200, x: -5000, y: 9000 });
        assert.equal(applied.x, SURFACE_RECT.left + MARGIN);
        assert.equal(
            applied.y,
            SURFACE_RECT.top + SURFACE_RECT.height - MARGIN - 200
        );
    });

    it('clamps a requested width to the same bounds as the docked splitter', () => {
        boot({ dockedWidth: 400 });
        detachSidebar();

        const applied = applyDetachedGeometry({ width: 5000, height: null });
        // viewport 1280 → max(min(640, 1280 - 280)) = 640
        assert.equal(applied.width, 640);
        assert.equal(applied.height, null);
        assert.equal(env.panel.classList.contains('is-detached--sized'), false);
    });

    it('normalizes malformed stored state', () => {
        memory.set(SIDEBAR_DETACHED_KEY, '{not json');
        assert.deepEqual(readSidebarDetach(), {
            detached: false,
            geometry: { width: null, height: null, x: null, y: null }
        });

        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({
            detached: 'yes',
            geometry: { width: -20, height: 'tall', x: Number.NaN, y: 12 }
        }));
        const parsed = readSidebarDetach();
        assert.equal(parsed.detached, false);
        assert.equal(parsed.geometry.width, null);
        assert.equal(parsed.geometry.height, null);
        assert.equal(parsed.geometry.x, null);
        assert.equal(parsed.geometry.y, 12);

        assert.deepEqual(normalizeDetachedGeometry(null), {
            width: null, height: null, x: null, y: null
        });
    });

    it('treats zero/negative geometry as auto rather than clamping to a minimum', () => {
        boot({ dockedWidth: 400 });
        detachSidebar();

        const applied = applyDetachedGeometry({ width: 0, height: 0 });
        assert.equal(applied.width, SIDEBAR_DEFAULT_WIDTH);
        assert.equal(applied.height, null);
    });
});

describe('sidebarDetach · nav-toggle reattach ownership', () => {
    it('reattaches on the capture-phase nav toggle click before hamburger collapses', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();

        // Capture handler runs on document; hamburger's own click handler would
        // then collapse the (already docked) panel.
        env.document.dispatch('click', {
            target: { closest: (selector) => (selector.includes('#nav-panel-toggle') ? {} : null) }
        });

        assert.equal(isDetached(), false);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '400px');
        assert.equal(memory.has(SIDEBAR_DETACHED_KEY), false);
    });

    it('leaves unrelated clicks alone', () => {
        boot({ dockedWidth: 400 });
        detachSidebar();
        env.document.dispatch('click', { target: { closest: () => null } });
        assert.equal(isDetached(), true);
    });
});

describe('sidebarDetach · toggle button wiring', () => {
    it('toggles detach/attach and keeps aria-pressed in sync', () => {
        const panel = boot({ dockedWidth: 400 });
        const click = env.toggle.listeners.click?.[0];
        assert.ok(click, 'detach button click handler is bound');

        click({ preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(isDetached(), true);
        assert.equal(env.toggle.attrs['aria-pressed'], 'true');
        assert.equal(env.toggle.title, 'Reattach sidebar');

        click({ preventDefault: () => {}, stopPropagation: () => {} });
        assert.equal(isDetached(), false);
        assert.equal(env.toggle.attrs['aria-pressed'], 'false');
        assert.equal(env.toggle.title, 'Detach sidebar');
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '400px');
    });

    it('restores a persisted detach at boot', () => {
        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({
            detached: true,
            geometry: { width: 260, height: null, x: 400, y: 120 }
        }));
        const panel = boot({ dockedWidth: 400 });

        assert.equal(isDetached(), true);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '260px');
        assert.equal(panel.style.getPropertyValue('left'), '400px');
        assert.equal(panel.style.getPropertyValue('top'), '120px');
        assert.equal(panel.style.getPropertyValue('height'), '');
        assert.equal(env.toggle.attrs['aria-pressed'], 'true');
    });
});


describe('sidebarDetach · compact strip collapse', () => {
    /** Fire the tray control the way a real click would (from the button itself). */
    const clickCollapse = () => {
        const handlers = (env.collapse.listeners.click || []).slice();
        handlers.forEach((handler) => handler({ preventDefault: () => {}, stopPropagation: () => {} }));
        return handlers.length;
    };

    it('collapses the floating sidebar to the brand-row strip and expands it back', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();
        applyDetachedGeometry({ width: 300, height: 420 });
        assert.equal(panel.style.getPropertyValue('height'), '420px');

        assert.equal(clickCollapse(), 1, 'exactly one listener owns the tray control');
        assert.equal(panel.classList.contains('is-compact'), true);
        assert.equal(panel.classList.contains('is-detached'), true, 'the strip is still the floating panel');
        assert.equal(panel.classList.contains('is-detached--sized'), false);
        assert.equal(panel.style.getPropertyValue('height'), '', 'strip is auto-height');

        clickCollapse();
        assert.equal(panel.classList.contains('is-compact'), false);
        assert.equal(panel.style.getPropertyValue('height'), '420px');
        assert.equal(readDetachedGeometry().height, 420, 'the pre-collapse height comes back');
        assert.equal(readSidebarDetach().geometry.height, 420, 'and is persisted again');
    });

    it('binds exactly one listener no matter how often init runs (double-bind regression)', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();
        initSidebarDetach();
        initSidebarDetach();

        assert.equal(env.collapse.listeners.click.length, 1);
        clickCollapse();
        // Two listeners on the same element would collapse and immediately expand
        // again — the exact bug this regression test exists for.
        assert.equal(panel.classList.contains('is-compact'), true, 'one click must not toggle twice');
    });

    it('flips the tray control into an expand affordance while compact', () => {
        boot({ dockedWidth: 400 });
        detachSidebar();
        assert.equal(env.collapse.title, 'Collapse sidebar');
        assert.equal(env.collapse.attrs['aria-expanded'], 'true');

        clickCollapse();
        assert.equal(env.collapse.title, 'Expand sidebar');
        assert.equal(env.collapse.attrs['aria-label'], 'Expand sidebar');
        assert.equal(env.collapse.attrs['aria-expanded'], 'false');
        assert.match(env.collapse.innerHTML, /M6 2\.2v7\.6/, 'maximize glyph replaces minimize');
    });

    it('is a no-op while docked so the docked panel cannot lose its modules', () => {
        const panel = boot({ dockedWidth: 400 });
        assert.equal(collapseSidebar(), false);
        assert.equal(panel.classList.contains('is-compact'), false);

        clickCollapse();
        assert.equal(panel.classList.contains('is-compact'), false);
        assert.equal(env.collapse.title, 'Collapse sidebar');
    });

    it('reattaching drops the strip so the docked panel comes back expanded', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();
        assert.equal(collapseSidebar(), true);
        assert.equal(panel.classList.contains('is-compact'), true);

        reattachSidebar();
        assert.equal(isDetached(), false);
        assert.equal(panel.classList.contains('is-compact'), false);
        assert.equal(env.collapse.title, 'Collapse sidebar');
    });

    it('starts expanded again on the next detach', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();
        collapseSidebar();
        reattachSidebar();
        detachSidebar();

        assert.equal(panel.classList.contains('is-compact'), false);
        assert.equal(panel.style.getPropertyValue('height'), '');
    });

    it('does not resurrect a discarded height when expanding again', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar();
        applyDetachedGeometry({ width: 300, height: 420 });
        collapseSidebar();

        resetDetachedGeometry(); // double-click on the brand row while compact
        collapseSidebar(); // expand again

        assert.equal(panel.classList.contains('is-compact'), false);
        assert.equal(panel.style.getPropertyValue('height'), '');
        assert.equal(panel.classList.contains('is-detached--sized'), false);
    });

    it('keeps a single owner: the modules registry no longer exports a competing collapse', () => {
        // The original bug was two binders on one element (sidebarDetach +
        // sidebarModules), each guarded by a DIFFERENT dataset key, so both
        // attached: one click toggled the strip on and straight back off.
        assert.equal(typeof sidebarModules.bindSidebarCollapse, 'undefined');
        assert.equal(typeof sidebarModules.collapseSidebar, 'undefined');
        assert.equal(typeof sidebarModules.isSidebarCompact, 'undefined');
        assert.equal(typeof sidebarModules.setSidebarCompact, 'undefined');
    });
});

describe('sidebarDetach · reload with a persisted detach', () => {
    it('restores the floating panel geometry across a reload', () => {
        boot({ dockedWidth: 400 });
        detachSidebar();
        applyDetachedGeometry({
            width: 300,
            height: 420,
            x: SURFACE_RECT.left + 40,
            y: SURFACE_RECT.top + 60
        });

        // What the corner-resize handle commits on pointerup, then a reload.
        writeSidebarDetach(true, readDetachedGeometry());

        const panel = reload();

        assert.equal(isDetached(), true);
        assert.ok(panel.classList.contains('is-detached'));
        assert.ok(panel.classList.contains('is-detached--sized'));
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '300px');
        assert.equal(panel.style.getPropertyValue('height'), '420px');
        assert.equal(panel.style.getPropertyValue('left'), `${SURFACE_RECT.left + 40}px`);
        assert.equal(panel.style.getPropertyValue('top'), `${SURFACE_RECT.top + 60}px`);
        assert.equal(env.document.body.classList.contains('is-sidebar-detached'), true);
        assert.equal(memory.get(SIDEBAR_WIDTH_KEY), '400');
    });

    it('ignores hostile persisted geometry instead of propagating it', () => {
        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({
            detached: true,
            geometry: { width: 'NaN', height: '9999px', x: null, y: {} }
        }));
        const panel = boot({ dockedWidth: 400 });

        assert.equal(isDetached(), true);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), `${SIDEBAR_DEFAULT_WIDTH}px`);
        assert.equal(panel.style.getPropertyValue('height'), '');
        assert.equal(panel.style.getPropertyValue('left'), `${SURFACE_RECT.left + MARGIN}px`);
        assert.equal(panel.style.getPropertyValue('top'), `${SURFACE_RECT.top + MARGIN}px`);
        assert.equal(readSidebarDetach().geometry.height, null);
    });

    it('boots docked when the persisted payload is corrupt JSON', () => {
        memory.set(SIDEBAR_DETACHED_KEY, '{"detached":true,');
        const panel = boot({ dockedWidth: 400 });

        assert.equal(isDetached(), false);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '400px');
    });

    it('keeps working when storage rejects the write (quota full)', () => {
        const panel = boot({ dockedWidth: 400 });
        const originalSetItem = globalThis.localStorage.setItem;
        const originalWarn = console.warn;
        globalThis.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
        console.warn = () => {};
        try {
            assert.equal(detachSidebar(), true);
        } finally {
            globalThis.localStorage.setItem = originalSetItem;
            console.warn = originalWarn;
        }

        assert.equal(isDetached(), true);
        assert.ok(panel.classList.contains('is-detached'));
        assert.equal(memory.has(SIDEBAR_DETACHED_KEY), false);
    });
});

describe('sidebarDetach · kill-switch build', () => {
    beforeEach(() => {
        setSidebarDetachEnabled(false);
        env.toggle.listeners = {};
    });

    it('records the build-time default in SIDEBAR_DETACH_ENABLED', () => {
        assert.equal(SIDEBAR_DETACH_ENABLED, true, 'detached mode is enabled in this build');
    });

    it('binds nothing, hides the toggle, and drops a persisted detached state', () => {
        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({
            detached: true,
            geometry: { width: 320, height: null, x: 10, y: 20 }
        }));

        const panel = boot({ dockedWidth: 400 });

        assert.equal(isSidebarDetachEnabled(), false);
        assert.equal(initSidebarDetach(), null);
        assert.equal(isDetached(), false);
        assert.equal(memory.has(SIDEBAR_DETACHED_KEY), false);
        assert.equal(env.toggle.hidden, true);
        assert.equal(env.toggle.style.display, 'none');
        assert.equal((env.toggle.listeners.click || []).length, 0);
        assert.equal(panel.style.getPropertyValue('left'), '');
        assert.equal(panel.style.getPropertyValue('height'), '');
    });

    it('keeps the boundaries listener unbound so a broadcast cannot re-clamp', () => {
        const panel = boot({ dockedWidth: 400 });

        env.window.dispatch('tools:desktop_bounds_changed');

        assert.equal(isDetached(), false);
        assert.equal(panel.style.getPropertyValue('left'), '');
        assert.equal(panel.style.getPropertyValue('height'), '');
    });

    it('boots docked (never enters the loop) when a detached state was persisted', () => {
        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({ detached: true, geometry: { width: 300 } }));

        const panel = boot({ dockedWidth: 400 });

        assert.equal(panel.classList.contains('is-detached'), false);
        assert.equal(panel.classList.contains('is-detached--sized'), false);
        assert.equal(globalThis.document.body.classList.contains('is-sidebar-detached'), false);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '400px');
    });

    it('re-enabling restores the normal bindings on the next init', () => {
        boot({ dockedWidth: 400 });
        setSidebarDetachEnabled(true);

        assert.equal(initSidebarDetach(), sidebarDetach);
        assert.equal(detachSidebar(), true);
        assert.equal(isDetached(), true);
    });
});

describe('sidebarDetach · bounds feedback loop (regression)', () => {
    // #side-panel class mutation -> toolsManager broadcasts
    // tools:desktop_bounds_changed -> sidebarDetach re-clamps -> writes back to
    // #side-panel. A MutationObserver cycle like this runs in the microtask queue
    // and never throws: the tab froze with a silent console. These tests fail by
    // timeout (or by an unbounded counter) if the loop comes back.

    it('detach terminates and the bounds broadcast stays bounded', { timeout: 2000 }, async () => {
        const panel = boot({ dockedWidth: 400 });
        ToolsManager.bindDesktopBoundsWatcher();
        await flushFrame();
        const counter = countBoundsBroadcasts();
        try {
            assert.equal(detachSidebar(), true);
            await flushFrame();
            await flushFrame();
        } finally {
            counter.restore();
        }

        assert.equal(isDetached(), true);
        assert.ok(panel.classList.contains('is-detached'));
        assert.ok(counter.count <= 3, `expected a bounded broadcast count, saw ${counter.count}`);
    });

    it('a handler rewriting a non-dock class cannot re-arm the broadcast', { timeout: 2000 }, async () => {
        boot({ dockedWidth: 400 });
        ToolsManager.bindDesktopBoundsWatcher();
        await flushFrame();
        const counter = countBoundsBroadcasts();
        let flips = 0;
        const flip = () => {
            flips += 1;
            // The old loop in one line: answer the broadcast with a class write.
            env.panel.classList.toggle('is-detached--sized', flips % 2 === 0);
        };
        env.window.addEventListener('tools:desktop_bounds_changed', flip);
        try {
            detachSidebar({ geometry: { width: 320, height: 400 } });
            await flushFrame();
            await flushFrame();
        } finally {
            env.window.removeEventListener('tools:desktop_bounds_changed', flip);
            counter.restore();
        }

        assert.equal(isDetached(), true);
        assert.ok(counter.count <= 3, `broadcasts ran away: ${counter.count}`);
        assert.ok(flips <= 4, `handler kept being re-armed: ${flips}`);
    });

    it('boots with a persisted detached state without hanging', { timeout: 2000 }, async () => {
        memory.set(SIDEBAR_DETACHED_KEY, JSON.stringify({
            detached: true,
            geometry: { width: 300, height: null, x: 20, y: 30 }
        }));
        ToolsManager.bindDesktopBoundsWatcher();
        const counter = countBoundsBroadcasts();
        let panel;
        try {
            panel = reload();
            await flushFrame();
            await flushFrame();
        } finally {
            counter.restore();
        }

        assert.equal(isDetached(), true);
        assert.equal(panel.style.getPropertyValue('--sidebar-width'), '300px');
        assert.ok(counter.count <= 4, `broadcasts ran away during boot: ${counter.count}`);
    });

    it('re-applying the current geometry writes nothing (the terminator)', () => {
        const panel = boot({ dockedWidth: 400 });
        detachSidebar({ geometry: { width: 320, height: 420 } });

        const writes = [];
        const { setProperty, removeProperty } = panel.style;
        const { add, remove } = panel.classList;
        panel.style.setProperty = (key, value) => {
            if (['height', 'left', 'top'].includes(key)) writes.push(`set ${key}=${value}`);
            return setProperty(key, value);
        };
        panel.style.removeProperty = (key) => {
            if (['height', 'left', 'top'].includes(key)) writes.push(`remove ${key}`);
            return removeProperty(key);
        };
        panel.classList.add = (...names) => { writes.push(`add ${names.join(',')}`); return add(...names); };
        panel.classList.remove = (...names) => { writes.push(`remove ${names.join(',')}`); return remove(...names); };
        try {
            applyDetachedGeometry(readDetachedGeometry());
            applyDetachedGeometry(readDetachedGeometry());
        } finally {
            panel.style.setProperty = setProperty;
            panel.style.removeProperty = removeProperty;
            panel.classList.add = add;
            panel.classList.remove = remove;
        }

        assert.deepEqual(writes, [], 'a re-clamp of unchanged geometry must not touch the DOM');
    });

    it('does not rebroadcast sidebar:width_changed for an unchanged width', () => {
        boot({ dockedWidth: 400 });
        detachSidebar({ geometry: { width: 320 } });
        let events = 0;
        const onWidth = () => { events += 1; };
        env.window.addEventListener('sidebar:width_changed', onWidth);
        try {
            applyDetachedGeometry(readDetachedGeometry());
            applyDetachedGeometry(readDetachedGeometry());
        } finally {
            env.window.removeEventListener('sidebar:width_changed', onWidth);
        }

        assert.equal(events, 0);
    });
});
