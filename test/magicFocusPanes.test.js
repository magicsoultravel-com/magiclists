// test/magicFocusPanes.test.js
// Characterization tests for js/magicFocus/panes.js — pane chrome, per-pane zoom,
// expand/restore, and the refresh hooks the planner calls back into.
//
// This module is almost entirely DOM-driven, so the suite drives it with hand-built
// element stubs (a settable `style`, a `classList` recorder, `querySelector` that
// answers from a map) instead of a DOM. That is enough to pin the behaviour that
// actually breaks:
//   * zoom clamping goes through clampFocusZoom, so 63 becomes 60% and the +/-
//     buttons disable exactly at the 50/200 bounds;
//   * expand state lives in `expandedPaneId` *and* in the DOM; the two must move
//     together or a re-render restores the wrong pane;
//   * every refresh path is guarded by isOpen()/showingSetup, so a background
//     planner update cannot repaint a closed focus workspace.
//
// Run with: npm test  (node --test)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as Panes from '../js/magicFocus/panes.js';

// `_applyPaneZoom` escapes the zone id; Node has no CSS global.
if (!globalThis.CSS) globalThis.CSS = { escape: (value) => String(value) };

const paneStub = () => {
    const props = new Map();
    const children = new Map();
    return {
        props,
        style: { setProperty: (k, v) => props.set(k, v) },
        children,
        querySelector: (sel) => children.get(sel) || null,
        addEventListener() {}
    };
};

const workStub = (panes = []) => ({
    classes: new Set(),
    classList: {
        add(c) { this.owner.classes.add(c); },
        remove(c) { this.owner.classes.delete(c); },
        toggle(c, on) { if (on) this.owner.classes.add(c); else this.owner.classes.delete(c); },
        contains: () => false
    },
    owner: null,
    querySelectorAll: (sel) => (sel.includes('.is-expanded')
        ? panes.filter((p) => p.classes?.has('is-expanded'))
        : panes)
});

const makeWork = (panes) => {
    const work = workStub(panes);
    work.classList.owner = work;
    return work;
};

const makeFocus = (over = {}) => {
    const calls = [];
    const focus = {
        bodyEl: { querySelector: () => null },
        expandedPaneId: null,
        sessionSpawnBlocks: null,
        sessionSpawnZoom: 100,
        showingSetup: false,
        isOpen: () => true,
        resolveItem: () => null,
        _syncPaneExpandButtons: () => calls.push('syncExpand'),
        _refitHostedCanvas: () => calls.push('refit'),
        _applyPaneZoom: (zoneId, pct) => calls.push(`zoom:${zoneId}:${pct}`),
        _fillPane: async () => calls.push('fillPane'),
        calls,
        ...over
    };
    return focus;
};

describe('focus panes · per-pane zoom', () => {
    it('writes the clamped zoom, its label, and the button bounds', () => {
        const pane = paneStub();
        const label = { textContent: '' };
        const out = { disabled: false };
        const inBtn = { disabled: false };
        pane.children.set('[data-focus-pane-zoom-label]', label);
        pane.children.set('[data-focus-pane-zoom-out]', out);
        pane.children.set('[data-focus-pane-zoom-in]', inBtn);
        const focus = makeFocus({ bodyEl: { querySelector: () => pane } });

        Panes._applyPaneZoom(focus, 'z1', 63);

        assert.equal(pane.props.get('--focus-pane-zoom'), '0.6');
        assert.equal(label.textContent, '60%');
        assert.equal(out.disabled, false);
        assert.equal(inBtn.disabled, false);
    });

    it('disables the buttons exactly at the bounds', () => {
        const low = paneStub();
        low.children.set('[data-focus-pane-zoom-out]', { disabled: false });
        Panes._applyPaneZoom(makeFocus({ bodyEl: { querySelector: () => low } }), 'z0', 10);
        assert.equal(low.props.get('--focus-pane-zoom'), '0.5');
        assert.equal(low.children.get('[data-focus-pane-zoom-out]').disabled, true);

        const high = paneStub();
        high.children.set('[data-focus-pane-zoom-in]', { disabled: false });
        Panes._applyPaneZoom(makeFocus({ bodyEl: { querySelector: () => high } }), 'z0', 900);
        assert.equal(high.props.get('--focus-pane-zoom'), '2');
        assert.equal(high.children.get('[data-focus-pane-zoom-in]').disabled, true);
    });

    it('does nothing when the pane is not on the page', () => {
        assert.doesNotThrow(() => Panes._applyPaneZoom(makeFocus(), 'z9', 120));
    });

    it('nudges a spawn-preview zoom without touching the note', () => {
        const focus = makeFocus({ sessionSpawnBlocks: ['text'], sessionSpawnZoom: 190 });

        Panes._nudgePaneZoom(focus, 'z0', 20);

        assert.equal(focus.sessionSpawnZoom, 200, 'clamped at the ceiling');
        assert.ok(focus.calls.includes('zoom:z0:200'));
        assert.ok(focus.calls.includes('refit'));
    });

    it('ignores a nudge without a zone', () => {
        const focus = makeFocus({ sessionSpawnBlocks: ['text'] });

        Panes._nudgePaneZoom(focus, null, 10);

        assert.equal(focus.calls.length, 0);
    });
});


describe('focus panes · expand and restore', () => {
    const paneWith = (id, classes = new Set()) => ({
        classes,
        getAttribute: () => id,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
        },
        querySelector: () => null
    });

    it('expands one pane and marks the workspace', () => {
        const panes = [paneWith('z0'), paneWith('z1')];
        const work = makeWork(panes);
        const focus = makeFocus({ bodyEl: { querySelector: () => work } });

        Panes.setExpandedPane(focus, 'z1');

        assert.equal(focus.expandedPaneId, 'z1');
        assert.equal(work.classes.has('is-pane-expanded'), true);
        assert.equal(panes[0].classes.has('is-expanded'), false);
        assert.equal(panes[1].classes.has('is-expanded'), true);
        assert.deepEqual(focus.calls, ['syncExpand', 'refit']);
    });

    it('refuses to expand without a workspace or a zone', () => {
        const focus = makeFocus();

        Panes.setExpandedPane(focus, 'z0');
        assert.equal(focus.expandedPaneId, null);

        const withWork = makeFocus({ bodyEl: { querySelector: () => makeWork([]) } });
        Panes.setExpandedPane(withWork, null);
        assert.equal(withWork.expandedPaneId, null);
    });

    it('restores every pane and clears the state', () => {
        const pane = paneWith('z0', new Set(['is-expanded']));
        const work = makeWork([pane]);
        const focus = makeFocus({ bodyEl: { querySelector: () => work }, expandedPaneId: 'z0' });

        Panes.clearExpandedPane(focus);

        assert.equal(focus.expandedPaneId, null);
        assert.equal(work.classes.has('is-pane-expanded'), false);
        assert.equal(pane.classes.has('is-expanded'), false);
        assert.deepEqual(focus.calls, ['syncExpand', 'refit']);
    });

    it('still clears the flag when the workspace is gone', () => {
        const focus = makeFocus({ expandedPaneId: 'z0' });

        Panes.clearExpandedPane(focus);

        assert.equal(focus.expandedPaneId, null);
    });

    it('paints the expand buttons from the current state', () => {
        const button = () => ({
            innerHTML: '',
            title: '',
            attrs: {},
            setAttribute(k, v) { this.attrs[k] = v; }
        });
        const expandedBtn = button();
        const collapsedBtn = button();
        const panes = [
            { getAttribute: () => 'z0', querySelector: () => expandedBtn },
            { getAttribute: () => 'z1', querySelector: () => collapsedBtn },
            { getAttribute: () => 'z2', querySelector: () => null }
        ];
        const work = makeWork(panes);
        const focus = makeFocus({ bodyEl: { querySelector: () => work }, expandedPaneId: 'z0' });

        Panes._syncPaneExpandButtons(focus);

        assert.equal(expandedBtn.title, 'Restore pane');
        assert.equal(expandedBtn.attrs['aria-pressed'], 'true');
        assert.equal(collapsedBtn.title, 'Expand pane');
        assert.equal(collapsedBtn.attrs['aria-pressed'], 'false');
        assert.notEqual(expandedBtn.innerHTML, collapsedBtn.innerHTML, 'the glyph follows the state');
    });

    it('does nothing without a workspace', () => {
        assert.doesNotThrow(() => Panes._syncPaneExpandButtons(makeFocus()));
    });
});

describe('focus panes · refresh guards', () => {
    it('does not repaint the checklist pane while focus is closed', () => {
        const item = { id: 'n1', focus: { preset: 'split2-v', zones: { z0: ['checklist'] } } };
        const focus = makeFocus({ isOpen: () => false });

        Panes.refreshChecklistPane(focus, item);

        assert.deepEqual(focus.calls, []);
    });

    it('skips planner refresh while the setup wizard is open', async () => {
        const item = { id: 'n1', focus: { preset: 'split2-v', zones: { z0: ['table'] } } };
        const focus = makeFocus({ showingSetup: true });

        await Panes.refreshPlannerPanes(focus, item);

        assert.deepEqual(focus.calls, []);
    });

    it('skips planner refresh for a note with no item', async () => {
        const focus = makeFocus();

        await Panes.refreshPlannerPanes(focus, null);

        assert.deepEqual(focus.calls, []);
    });
});
