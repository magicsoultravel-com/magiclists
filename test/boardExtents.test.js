// test/boardExtents.test.js
// Validates the sidebar-state-aware board packing width, which prevents the
// "invisible wall" deadband on the right of the desktop board where notes
// could not be placed or expanded.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SIDEBAR_DEFAULT_WIDTH } from '../js/sidebarPrefs.js';
import { getStableBoardLayoutWidth, resetStableBoardLayoutWidth } from '../js/board/boardExtents.js';

const VIEWPORT_W = 1920;

/** Install minimal fake browser globals (window/document/localStorage). */
function installGlobals({ sidebarCollapsed = true, sidebarWidth = null } = {}) {
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
                ? { classList: { contains: (name) => name === 'is-collapsed' && sidebarCollapsed } }
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