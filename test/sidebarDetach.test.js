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
    readSidebarDetach
} from '../js/sidebarPrefs.js';
import {
    SIDEBAR_DETACH_HANDLE_SEL,
    applyDetachedGeometry,
    detachSidebar,
    initSidebarDetach,
    isDetached,
    readDetachedGeometry,
    reattachSidebar,
    sidebarDetach
} from '../js/sidebarDetach.js';
import { initShellResize } from '../js/shellResize.js';
import { resetStableBoardLayoutWidth } from '../js/board/boardExtents.js';

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

function makeClassList(initial = []) {
    const set = new Set(initial);
    return {
        add(...names) { names.forEach((name) => set.add(name)); },
        remove(...names) { names.forEach((name) => set.delete(name)); },
        contains(name) { return set.has(name); },
        toggle(name, force) {
            const next = force === undefined ? !set.has(name) : force;
            if (next) set.add(name);
            else set.delete(name);
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

function makeEl({ id = '', classes = [] } = {}) {
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
        classList: makeClassList(classes),
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
    const panel = makeEl({ id: 'side-panel', classes: ['side-panel'] });
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
    const byId = {
        'desktop-surface': surface,
        'side-panel': panel,
        'sidebar-detach-toggle': toggle
    };
    const documentListeners = new Map();
    const doc = {
        body: makeEl({ classes: [] }),
        getElementById: (id) => byId[id] ?? null,
        querySelector: (selector) => (selector === '[data-sidebar-detach-toggle]' ? toggle : null),
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

    return { surface, panel, toggle, brandRow, document: doc, window: win };
}

const env = createEnv();
globalThis.document = env.document;
globalThis.window = env.window;

function resetEnv() {
    memory.clear();
    resetStableBoardLayoutWidth();

    const { panel } = env;
    panel.classList.remove('is-detached', 'is-detached--sized', 'is-detached-dragging', 'is-collapsed');
    ['--sidebar-width', '--sidebar-ui-scale', 'left', 'top', 'height', 'width'].forEach((prop) => {
        panel.style.removeProperty(prop);
    });
    panel.offsetWidth = SIDEBAR_DEFAULT_WIDTH;
    panel.offsetHeight = 320;
    panel.children.length = 0;

    env.document.body.classList.remove(
        'is-sidebar-detached',
        'is-sidebar-detaching',
        'is-sidebar-detached-dragging',
        'is-sidebar-detached-resizing'
    );
}

/** Seed the docked width, then boot the shell + detach modules in app order. */
function boot({ dockedWidth = null } = {}) {
    if (dockedWidth != null) memory.set(SIDEBAR_WIDTH_KEY, String(dockedWidth));
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
