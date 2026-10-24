// test/magicFocusRender.test.js
// Characterization tests for js/magicFocus/render.js — painting the workspace.
//
// renderWork is the function every entry path funnels through, and it does four
// things in one pass: clear the expanded pane, release the hosted drawing board,
// write the pane markup, then fill each pane and mount the chrome. The ordering is
// the contract — filling a pane before releasing the board would leave the canvas
// hosted in a DOM node that is about to be replaced.
//
// Element stubs are enough here: `innerHTML` is a plain string field and
// `querySelector` answers from a map, so both the markup and the call order are
// observable without a DOM.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as Render from '../js/magicFocus/render.js';

const focusModel = (zones, over = {}) => ({
    preset: 'split3-cols',
    ratios: [1 / 3, 2 / 3],
    zones,
    zoom: {},
    ...over
});

const makeFocus = (over = {}) => {
    const calls = [];
    const elements = new Map();
    const bodyEl = {
        innerHTML: '',
        querySelector: (sel) => elements.get(sel) || null,
        querySelectorAll: () => []
    };
    return {
        bodyEl,
        headerEl: null,
        expandedPaneId: 'z1',
        sessionSpawnBlocks: null,
        sessionSpawnZoom: 100,
        elements,
        calls,
        _unhostDrawingBoard: async () => calls.push('unhost'),
        _fillPane: async (body, item, blocks, zid) => calls.push(`fill:${zid}:${blocks.join('+')}`),
        _mountSplitters: () => calls.push('splitters'),
        _bindPaneChromeControls: () => calls.push('chrome'),
        _syncPaneExpandButtons: () => calls.push('syncExpand'),
        _renderSpawnWork: async () => calls.push('spawn'),
        renderHeader: () => calls.push('header'),
        ...over
    };
};

describe('focus render · work surface', () => {
    it('does nothing without a body or an item', async () => {
        await Render.renderWork(makeFocus({ bodyEl: null }), { id: 'n1' });
        const focus = makeFocus();
        await Render.renderWork(focus, null);

        assert.deepEqual(focus.calls, []);
    });

    it('clears the expanded pane and releases the board before painting', async () => {
        const focus = makeFocus({ sessionSpawnBlocks: ['text'] });

        await Render.renderWork(focus, { id: 'n1' });

        assert.equal(focus.expandedPaneId, null);
        assert.deepEqual(focus.calls.slice(0, 2), ['unhost', 'spawn']);
    });

    it('draws one pane per zone of the stored preset', async () => {
        const focus = makeFocus();

        await Render.renderWork(focus, { id: 'n1', focus: focusModel({ z0: ['text'], z1: [], z2: ['table'] }) });

        const html = focus.bodyEl.innerHTML;
        assert.equal((html.match(/data-focus-pane="z\d"/g) || []).length, 3);
        assert.equal((html.match(/data-focus-pane-zoom-label/g) || []).length, 3);
        assert.match(html, /data-magic-focus-work/);
    });

    it('marks empty panes and their placeholder message', async () => {
        const empty = { style: {}, innerHTML: '' };
        const focus = makeFocus();
        focus.elements.set('[data-focus-pane-body="z1"]', empty);

        await Render.renderWork(focus, { id: 'n1', focus: focusModel({ z0: ['text'], z1: [], z2: ['table'] }) });

        assert.match(focus.bodyEl.innerHTML, /magic-focus__pane--empty/);
        assert.match(empty.innerHTML, /magic-focus__pane-empty-msg/);
        assert.equal(focus.calls.includes('fill:z1:'), false, 'an empty pane is not filled');
    });

    it('fills the populated panes in zone order', async () => {
        const focus = makeFocus();
        for (const zid of ['z0', 'z1', 'z2']) {
            focus.elements.set(`[data-focus-pane-body="${zid}"]`, { style: {}, innerHTML: '' });
        }

        await Render.renderWork(focus, { id: 'n1', focus: focusModel({ z0: ['text'], z1: [], z2: ['table', 'chart'] }) });

        assert.deepEqual(focus.calls.filter((c) => c.startsWith('fill:')), ['fill:z0:text', 'fill:z2:table+chart']);
    });

    it('mounts splitters, chrome and the header once the panes are filled', async () => {
        const focus = makeFocus();

        await Render.renderWork(focus, { id: 'n1', focus: focusModel({ z0: ['text'], z1: [], z2: [] }) });

        assert.deepEqual(focus.calls.slice(-3), ['splitters', 'chrome', 'header']);
    });
});


describe('focus render · grid and zoom detail', () => {
    it('writes the grid from the layout model onto the work element', async () => {
        const workEl = { style: {} };
        const focus = makeFocus();
        focus.elements.set('[data-magic-focus-work]', workEl);

        await Render.renderWork(focus, {
            id: 'n1',
            focus: focusModel({ z0: [], z1: [], z2: [] }, { preset: 'split2-v', ratios: [0.25] })
        });

        assert.equal(workEl.style.gridTemplateColumns, '0.25fr 0.75fr');
        assert.equal(workEl.style.gridTemplateRows, '1fr');
        assert.equal(workEl.style.gridTemplateAreas, '"z0 z1"');
    });

    it('disables the zoom buttons at the pane bounds', async () => {
        const focus = makeFocus();

        await Render.renderWork(focus, {
            id: 'n1',
            focus: focusModel({ z0: [], z1: [], z2: [] }, { zoom: { z0: 50, z1: 200, z2: 100 } })
        });

        const panes = focus.bodyEl.innerHTML.split('<section').slice(1);
        assert.match(panes[0], /data-focus-pane-zoom-out[^>]*disabled/);
        assert.match(panes[1], /data-focus-pane-zoom-in[^>]*disabled/);
        assert.equal(/data-focus-pane-zoom-in[^>]*disabled/.test(panes[2]), false);
    });

    it('shows each zone its own zoom percentage', async () => {
        const focus = makeFocus();

        await Render.renderWork(focus, {
            id: 'n1',
            focus: focusModel({ z0: [], z1: [], z2: [] }, { zoom: { z0: 60, z1: 130 } })
        });

        const labels = focus.bodyEl.innerHTML.match(/data-focus-pane-zoom-label>(\d+)%/g) || [];
        assert.deepEqual(labels.map((l) => l.match(/(\d+)%/)[1]), ['60', '130', '100']);
    });

    it('marks a pane that hosts the canvas', async () => {
        const focus = makeFocus();

        await Render.renderWork(focus, { id: 'n1', focus: focusModel({ z0: ['canvas'], z1: [], z2: [] }) });

        assert.match(focus.bodyEl.innerHTML, /magic-focus__pane--canvas/);
    });

    it('falls back to the default layout when the note has no focus', async () => {
        const focus = makeFocus();

        await Render.renderWork(focus, { id: 'n1' });

        assert.equal((focus.bodyEl.innerHTML.match(/data-focus-pane="z\d"/g) || []).length, 2);
    });
});

describe('focus render · ephemeral spawn view', () => {
    it('draws a single expanded pane and takes ownership of the expansion', async () => {
        const body = { style: {}, innerHTML: '' };
        const focus = makeFocus({ sessionSpawnBlocks: ['checklist'], sessionSpawnZoom: 130 });
        focus.elements.set('[data-focus-pane-body="z0"]', body);

        await Render._renderSpawnWork(focus, { id: 'n1' });

        const html = focus.bodyEl.innerHTML;
        assert.equal((html.match(/data-focus-pane="z\d"/g) || []).length, 1);
        assert.match(html, /is-focus-spawn/);
        assert.match(html, /is-pane-expanded/);
        assert.match(html, /aria-pressed="true"/);
        assert.match(html, /title="Restore pane"/);
        assert.match(html, /--focus-pane-zoom: 1.3/);
        assert.equal(focus.expandedPaneId, 'z0');
        assert.deepEqual(focus.calls, ['fill:z0:checklist', 'chrome', 'syncExpand', 'header']);
    });

    it('fills an empty spawn pane with the placeholder instead of a body', async () => {
        const body = { style: {}, innerHTML: '' };
        const focus = makeFocus({ sessionSpawnBlocks: null });
        focus.elements.set('[data-focus-pane-body="z0"]', body);

        await Render._renderSpawnWork(focus, { id: 'n1' });

        assert.match(body.innerHTML, /magic-focus__pane-empty-msg/);
        assert.deepEqual(focus.calls, ['chrome', 'syncExpand', 'header']);
    });

    it('uses a single 1fr track', async () => {
        const workEl = { style: {} };
        const focus = makeFocus({ sessionSpawnBlocks: ['text'] });
        focus.elements.set('[data-magic-focus-work]', workEl);

        await Render._renderSpawnWork(focus, { id: 'n1' });

        assert.equal(workEl.style.gridTemplateColumns, '1fr');
        assert.equal(workEl.style.gridTemplateAreas, '"z0"');
    });
});
