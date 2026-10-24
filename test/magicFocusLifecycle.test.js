// test/magicFocusLifecycle.test.js
// Characterization tests for js/magicFocus/lifecycle.js — the session seam that
// used to live inside js/magicFocus.js.
//
// Bug classes this suite is aimed at, in the order they hurt:
//   * a flag left behind on close (activeItemId, setupDraft, expandedPaneId,
//     sessionSpawn*) — the next note then opens in setup mode or in the wrong pane;
//   * a resolver that outlives its note — `resolveItem()` must answer for the
//     *current* active id, and null after close, or a stale item gets edited;
//   * openSettings mis-routing — a configured note must land on the assign step
//     (rearrange) and an unconfigured one on the preset step (start from scratch).
//
// Run with: npm test  (node --test)
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import * as Lifecycle from '../js/magicFocus/lifecycle.js';

const classListStub = () => {
    const set = new Set();
    return {
        set,
        add: (c) => set.add(c),
        remove: (c) => set.delete(c),
        contains: (c) => set.has(c),
        toggle: (c, on) => (on ? set.add(c) : set.delete(c))
    };
};

const makeFocus = (over = {}) => {
    const calls = [];
    return {
        root: { classList: classListStub(), setAttribute() {} },
        headerEl: null,
        bodyEl: null,
        activeItemId: null,
        setupDraft: null,
        setupStep: 'layout',
        showingSetup: false,
        expandedPaneId: null,
        sessionSpawnBlocks: null,
        sessionSpawnZoom: 100,
        calls,
        isOpen() { return Lifecycle.isOpen(this); },
        resolveItem() { return Lifecycle.resolveItem(this); },
        _clearSessionSpawn() { return Lifecycle._clearSessionSpawn(this); },
        _resolveItems() { return Lifecycle._resolveItems(this); },
        flushPendingEdits() { calls.push('flush'); },
        clearExpandedPane() { calls.push('clearPane'); this.expandedPaneId = null; },
        renderSetup: () => calls.push('renderSetup'),
        _unhostDrawingBoard: async () => calls.push('unhost'),
        _leaveShell: async () => calls.push('leaveShell'),
        _unbindEsc: () => calls.push('unbindEsc'),
        _syncFocusButtons: () => calls.push('syncButtons'),
        syncExitFabVisibility: () => calls.push('exitFab'),
        applyNoteTheme: (v) => calls.push(`theme:${v === null ? 'null' : 'item'}`),
        ...over
    };
};

describe('focus lifecycle · open state', () => {
    it('is closed until an item is active', () => {
        const focus = makeFocus();

        assert.equal(Lifecycle.isOpen(focus), false);
        focus.activeItemId = 'n1';
        assert.equal(Lifecycle.isOpen(focus), true);
    });

    it('is closed while the root is hidden', () => {
        const focus = makeFocus({ activeItemId: 'n1' });
        focus.root.classList.add('is-hidden');

        assert.equal(Lifecycle.isOpen(focus), false);
    });

    it('reports the active item id', () => {
        assert.equal(Lifecycle.getActiveItemId(makeFocus({ activeItemId: 'n7' })), 'n7');
        assert.equal(Lifecycle.getActiveItemId(makeFocus()), null);
    });
});

describe('focus lifecycle · item resolution', () => {
    it('resolves through the injected resolver only', () => {
        const focus = makeFocus({ activeItemId: 'n1' });

        assert.equal(Lifecycle.resolveItem(focus), null, 'no resolver means no item, never a guess');

        Lifecycle.setItemResolver(focus, (id) => ({ id, title: 'Live' }));
        assert.deepEqual(Lifecycle.resolveItem(focus), { id: 'n1', title: 'Live' });
    });

    it('follows the current active id', () => {
        const focus = makeFocus({ activeItemId: 'n1' });
        Lifecycle.setItemResolver(focus, (id) => ({ id }));

        focus.activeItemId = 'n2';

        assert.equal(Lifecycle.resolveItem(focus).id, 'n2');
    });

    it('prefers the app item list and falls back to the window hook', () => {
        const prevWindow = globalThis.window;
        globalThis.window = { __magicFocusItems: () => [{ id: 'n1' }, { id: 'n2' }] };
        try {
            const fromApp = makeFocus({ activeItemId: 'n1', _app: { getItems: () => [{ id: 'n1', src: 'app' }] } });
            assert.equal(Lifecycle.getLiveItem(fromApp).src, 'app');

            const fromWindow = makeFocus({ activeItemId: 'n2' });
            assert.equal(Lifecycle.getLiveItem(fromWindow).id, 'n2');
        } finally {
            globalThis.window = prevWindow;
        }
    });


describe('focus lifecycle · settings entry', () => {
    it('does nothing when the item cannot be resolved', async () => {
        const focus = makeFocus();

        await Lifecycle.openSettings(focus);

        assert.deepEqual(focus.calls, []);
    });

    it('starts a configured note on the assign step with its layout as the draft', async () => {
        const focus = makeFocus({ activeItemId: 'n1' });
        Lifecycle.setItemResolver(focus, () => ({
            id: 'n1',
            focus: { preset: 'split3-cols', ratios: [1 / 3, 2 / 3], zones: { z0: ['text'], z1: [], z2: [] }, zoom: {} }
        }));

        await Lifecycle.openSettings(focus);

        assert.equal(focus.setupStep, 'assign');
        assert.equal(focus.setupDraft.preset, 'split3-cols');
        assert.equal(focus.showingSetup, true);
        assert.deepEqual(focus.calls, ['clearPane', 'unhost', 'renderSetup']);
    });

    it('starts an unconfigured note on the preset step with no draft', async () => {
        const focus = makeFocus({ activeItemId: 'n1', setupStep: 'assign' });
        Lifecycle.setItemResolver(focus, () => ({ id: 'n1', focus: null }));

        await Lifecycle.openSettings(focus);

        assert.equal(focus.setupStep, 'layout');
        assert.equal(focus.setupDraft, null);
    });

    it('clears an in-flight spawn preview before setting up', async () => {
        const focus = makeFocus({ activeItemId: 'n1', sessionSpawnBlocks: ['text'], sessionSpawnZoom: 150 });
        Lifecycle.setItemResolver(focus, () => ({ id: 'n1' }));

        await Lifecycle.openSettings(focus);

        assert.equal(focus.sessionSpawnBlocks, null);
        assert.equal(focus.sessionSpawnZoom, 100);
    });
});

describe('focus lifecycle · closing', () => {
    let prevDocument;
    let prevWindow;

    beforeEach(() => {
        prevDocument = globalThis.document;
        prevWindow = globalThis.window;
        // uiTransitions reads documentElement.dataset; 'off' keeps close() on the
        // non-morph path, which is the state reset this suite cares about.
        globalThis.document = {
            documentElement: { dataset: { uiTransitions: 'off' } },
            body: { classList: classListStub() },
            getElementById: () => null
        };
        globalThis.window = { setTimeout: (fn) => fn(), matchMedia: () => ({ matches: true }) };
    });

    afterEach(() => {
        globalThis.document = prevDocument;
        globalThis.window = prevWindow;
    });

    it('leaves no session state behind', async () => {
        const focus = makeFocus({
            activeItemId: 'n1',
            showingSetup: true,
            expandedPaneId: 'z1',
            setupDraft: { preset: 'split2-v' },
            setupStep: 'assign',
            sessionSpawnBlocks: ['text']
        });

        await Lifecycle.close(focus);

        assert.equal(focus.activeItemId, null);
        assert.equal(focus.showingSetup, false);
        assert.equal(focus.expandedPaneId, null);
        assert.equal(focus.setupDraft, null);
        assert.equal(focus.setupStep, 'layout');
        assert.equal(focus.sessionSpawnBlocks, null);
    });

    it('flushes pending edits before tearing anything down', async () => {
        const focus = makeFocus({ activeItemId: 'n1' });

        await Lifecycle.close(focus);

        assert.equal(focus.calls[0], 'flush');
    });

    it('hides the root, releases the board and re-syncs the board chrome', async () => {
        const focus = makeFocus({ activeItemId: 'n1', headerEl: null, bodyEl: null });

        await Lifecycle.close(focus);

        assert.equal(focus.root.classList.contains('is-hidden'), true);
        assert.deepEqual(focus.calls.slice(1), ['unhost', 'theme:null', 'leaveShell', 'unbindEsc', 'syncButtons', 'exitFab']);
    });

    it('is idempotent: closing a closed workspace resets nothing that matters', async () => {
        const focus = makeFocus();

        await assert.doesNotReject(() => Lifecycle.close(focus));
        assert.equal(focus.activeItemId, null);
        assert.equal(focus.root.classList.contains('is-hidden'), true);
    });
});

    it('returns null rather than throwing when nothing can resolve', () => {
        assert.equal(Lifecycle.getLiveItem(makeFocus({ activeItemId: 'n1' })), null);
    });
});
