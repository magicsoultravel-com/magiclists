// test/boardExtents.test.js
// Validates the sidebar-state-aware board packing width, which prevents the
// "invisible wall" deadband on the right of the desktop board where notes
// could not be placed or expanded.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SIDEBAR_DEFAULT_WIDTH } from '../js/sidebarPrefs.js';
import {
    getLiveBoardBounds,
    getStableBoardLayoutWidth,
    readVisibleBoardBox,
    resetStableBoardLayoutWidth
} from '../js/board/boardExtents.js';

const VIEWPORT_W = 1920;

/** Install minimal fake browser globals (window/document/localStorage). */
function installGlobals({ sidebarCollapsed = true, sidebarWidth = null, sidebarDetached = false } = {}) {
    const store = new Map();
    if (sidebarWidth != null) store.set('matrix_sidebar_width', String(sidebarWidth));

    globalThis.window = { innerWidth: VIEWPORT_W };
    globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value)),
        removeItem: (key) => store.delete(key)
    };
    globalThis.document = {
        getElementById: (id) =>
            id === 'side-panel'
                ? {
                    classList: {
                        contains: (name) =>
                            (name === 'is-collapsed' && sidebarCollapsed)
                            || (name === 'is-detached' && sidebarDetached)
                    }
                }
                : null
    };
}

beforeEach(() => {
    resetStableBoardLayoutWidth();
});

afterEach(() => {
    globalThis.window = undefined;
    globalThis.document = undefined;
    globalThis.localStorage = undefined;
    resetStableBoardLayoutWidth();
});

describe('board packing width (no invisible wall on the right)', () => {
    it('uses the FULL viewport width when the sidebar is collapsed (0px)', () => {
        installGlobals({ sidebarCollapsed: true });
        assert.equal(getStableBoardLayoutWidth(), VIEWPORT_W);
    });

    it('subtracts the default sidebar width when the sidebar is expanded', () => {
        installGlobals({ sidebarCollapsed: false });
        assert.equal(getStableBoardLayoutWidth(), VIEWPORT_W - SIDEBAR_DEFAULT_WIDTH);
    });

    it('subtracts a persisted custom sidebar width when expanded', () => {
        installGlobals({ sidebarCollapsed: false, sidebarWidth: 300 });
        assert.equal(getStableBoardLayoutWidth(), VIEWPORT_W - 300);
    });

    it('uses the FULL viewport width when the sidebar is detached (floating, 0px in flow)', () => {
        installGlobals({ sidebarCollapsed: false, sidebarDetached: true, sidebarWidth: 300 });
        assert.equal(getStableBoardLayoutWidth(), VIEWPORT_W);
    });

    it('caches the stable width and refreshes it after invalidating', () => {
        installGlobals({ sidebarCollapsed: false });
        assert.equal(getStableBoardLayoutWidth(), VIEWPORT_W - SIDEBAR_DEFAULT_WIDTH);
        // Simulate toggling the sidebar collapsed, then reset (as the shell
        // does on collapse/expand), so placement follows the visible edge.
        installGlobals({ sidebarCollapsed: true });
        assert.equal(getStableBoardLayoutWidth(), VIEWPORT_W - SIDEBAR_DEFAULT_WIDTH); // stale cache
        resetStableBoardLayoutWidth();
        assert.equal(getStableBoardLayoutWidth(), VIEWPORT_W); // wall gone
    });

    it('never shrinks below the 320px safety floor', () => {
        installGlobals({ sidebarCollapsed: false, sidebarWidth: 9999 });
        assert.equal(getStableBoardLayoutWidth(), 320);
    });
});

const rect = (left, top, width, height) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
});

/**
 * Install globals plus a canvas/surface pair so the visible-box measurement can
 * be exercised at every zoom level. `canvasRect` null means "no layout engine".
 */
function installBoardGlobals({
    sidebarCollapsed = true,
    canvasRect = null,
    surfaceRect = null,
    offsetWidth = 0,
    clientWidth = 0,
    clientHeight = 0,
    zoom = 1
} = {}) {
    installGlobals({ sidebarCollapsed });
    const panel = {
        classList: { contains: (name) => name === 'is-collapsed' && sidebarCollapsed }
    };
    const surface = surfaceRect ? { getBoundingClientRect: () => surfaceRect } : null;
    globalThis.document = {
        getElementById: (id) => {
            if (id === 'side-panel') return panel;
            if (id === 'desktop-surface') return surface;
            return null;
        }
    };
    return {
        dataset: { desktopZoom: String(zoom) },
        offsetWidth,
        clientWidth,
        clientHeight,
        getBoundingClientRect: () => canvasRect,
        querySelectorAll: () => []
    };
}

describe('visible board box (zoom, clipping, page height)', () => {
    it('divides the on-screen box by the real transform scale', () => {
        for (const zoom of [0.5, 1, 2]) {
            resetStableBoardLayoutWidth();
            const canvas = installBoardGlobals({
                canvasRect: rect(0, 0, 1000 * zoom, 700 * zoom),
                offsetWidth: 1000,
                surfaceRect: rect(0, 0, 4000, 4000),
                zoom
            });

            const box = readVisibleBoardBox(canvas);

            assert.equal(box.width, 1000, `width at zoom ${zoom}`);
            assert.equal(box.height, 700, `height at zoom ${zoom}`);
            assert.equal(box.scale, zoom);
        }
    });

    it('clips the canvas to the surface so packing never targets hidden overflow', () => {
        const canvas = installBoardGlobals({
            canvasRect: rect(0, 0, 1600, 700),
            offsetWidth: 1600,
            surfaceRect: rect(0, 0, 1200, 700)
        });

        assert.equal(readVisibleBoardBox(canvas).width, 1200);

        const bounds = getLiveBoardBounds(canvas);

        assert.equal(bounds.viewportW, 1200);
        assert.equal(bounds.packW, 1200 - bounds.origin * 2 - bounds.edgePad * 2);
    });

    it('uses the visible height as the page height instead of the window height', () => {
        const canvas = installBoardGlobals({
            canvasRect: rect(0, 0, 1000, 700),
            offsetWidth: 1000,
            // File cabinet open: only 400px of board is actually on screen.
            surfaceRect: rect(0, 0, 1200, 400),
            clientHeight: 700
        });

        const bounds = getLiveBoardBounds(canvas);

        assert.equal(bounds.viewportH, 400, 'window.innerHeight must not inflate the page');
        assert.ok(bounds.maxH >= bounds.viewportH);
    });

    it('falls back to the element box when there is no layout engine', () => {
        const canvas = installBoardGlobals({ clientWidth: 900, clientHeight: 600 });

        const bounds = getLiveBoardBounds(canvas);

        assert.equal(bounds.viewportW, 900);
        assert.equal(bounds.viewportH, 600);
        assert.equal(bounds.packW, 900 - bounds.origin * 2 - bounds.edgePad * 2);
    });
});