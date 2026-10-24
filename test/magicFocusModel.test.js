// test/magicFocusModel.test.js
// Characterization tests for js/magicFocus/model.js — the focus layout model that
// the setup wizard, the renderer and every persisted note go through.
//
// This is the module that decides what a stored `item.focus` blob means. It is
// pure (no DOM, no module state), which makes it the one part of magicFocus that
// can be pinned exhaustively: everything downstream assumes its output is
// *already* valid — zone keys `z0..zn-1`, ratios inside 0.08..0.92, zoom on a
// 10% step, no block placed twice — because nothing re-checks it later.
//
// The two normalisation rules worth remembering:
//   * a block may appear in only one zone; the first zone wins and later
//     duplicates are dropped (silently — the note must still open);
//   * ratios are clamped harder than zoom: a 0 or 1 split leaves a pane with no
//     pixels, so 0.92 is the ceiling no matter what was stored.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
    BLOCKS,
    PRESET_META,
    PRESET_ZONE_COUNTS,
    BLOCK_ICONS,
    clampFocusZoom,
    emptyZoom,
    defaultRatios,
    asBlockList,
    allPlacedBlocks,
    removeBlockFromZones,
    createDefaultFocus,
    normalizeFocus,
    focusIsConfigured,
    blockLabel
} = await import('../js/magicFocus/model.js');

describe('focus model · catalogue', () => {
    it('offers the eight blocks the workspace can host', () => {
        assert.deepEqual(BLOCKS.map((b) => b.id), [
            'text', 'checklist', 'table', 'chart', 'kanban', 'wbs', 'media', 'canvas'
        ]);
    });

    it('gives every block a human label and an icon', () => {
        for (const block of BLOCKS) {
            assert.equal(typeof block.label, 'string');
            assert.match(BLOCK_ICONS[block.id], /^<svg /, `${block.id} has no icon`);
        }
    });

    it('maps every preset to a zone count', () => {
        for (const preset of PRESET_META) {
            assert.equal(typeof PRESET_ZONE_COUNTS[preset.id], 'number', `${preset.id} has no zone count`);
        }
    });

    it('falls back to the raw id for an unknown block', () => {
        assert.equal(blockLabel('wbs'), 'WBS');
        assert.equal(blockLabel('mystery'), 'mystery');
        assert.equal(blockLabel(''), 'Empty');
    });
});

describe('focus model · zoom', () => {
    it('snaps to the 10% step', () => {
        assert.equal(clampFocusZoom(63), 60);
        assert.equal(clampFocusZoom(91), 90);
        assert.equal(clampFocusZoom(105), 110);
    });

    it('clamps to 50..200 and defaults non-numbers to 100', () => {
        assert.equal(clampFocusZoom(10), 50);
        assert.equal(clampFocusZoom(1000), 200);
        assert.equal(clampFocusZoom(NaN), 100);
        assert.equal(clampFocusZoom('nope'), 100);
    });

    it('fills one entry per zone, defaulting missing ones', () => {
        assert.deepEqual(emptyZoom(3), { z0: 100, z1: 100, z2: 100 });
        assert.deepEqual(emptyZoom(2, { z1: 150 }), { z0: 100, z1: 150 });
    });

    it('normalises stored zoom values through the same clamp', () => {
        assert.deepEqual(emptyZoom(2, { z0: 63, z1: 900 }), { z0: 60, z1: 200 });
    });
});

describe('focus model · presets and ratios', () => {
    it('creates two panes for the halves/stack presets and four for the quad', () => {
        assert.equal(Object.keys(createDefaultFocus('split2-v').zones).length, 2);
        assert.equal(Object.keys(createDefaultFocus('split3-cols').zones).length, 3);
        assert.equal(Object.keys(createDefaultFocus('split4-grid').zones).length, 4);
    });

    it('defaults to halves and starts empty', () => {
        const focus = createDefaultFocus();

        assert.equal(focus.preset, 'split2-v');
        assert.equal(focus.version, 1);
        assert.deepEqual(focus.zones, { z0: [], z1: [] });
        assert.deepEqual(focus.zoom, { z0: 100, z1: 100 });
    });

    it('falls back to halves for an unknown preset', () => {
        assert.equal(Object.keys(createDefaultFocus('nope').zones).length, 2);
    });

    it('gives each preset one split per separator', () => {
        for (const preset of PRESET_META.map((p) => p.id)) {
            const ratios = defaultRatios(preset);
            // The quad is two nested splits, not three separators across one row.
            const expected = preset === 'split4-grid' ? 2 : PRESET_ZONE_COUNTS[preset] - 1;
            assert.equal(ratios.length, expected, `${preset} ratio count`);
            for (const r of ratios) assert.ok(r > 0.08 && r < 0.92, `${preset} ratio ${r} out of range`);
        }
    });
});

describe('focus model · block lists', () => {
    it('accepts an array, a single id, and nothing else', () => {
        assert.deepEqual(asBlockList(['text', 'nope', 'table']), ['text', 'table']);
        assert.deepEqual(asBlockList('table'), ['table']);
        assert.deepEqual(asBlockList('nope'), []);
        assert.deepEqual(asBlockList(null), []);
        assert.deepEqual(asBlockList({}), []);
    });

    it('collects placed blocks without duplicates', () => {
        const placed = allPlacedBlocks({ z0: ['text', 'table'], z1: ['table', 'chart'] });

        assert.deepEqual([...placed].sort(), ['chart', 'table', 'text']);
        assert.equal(allPlacedBlocks(null).size, 0);
    });


describe('focus model · normalising a stored note', () => {
    it('rejects anything that is not an object', () => {
        assert.equal(normalizeFocus(null), null);
        assert.equal(normalizeFocus(undefined), null);
        assert.equal(normalizeFocus('split2-v'), null);
    });

    it('repairs an unknown preset and forces the version', () => {
        const focus = normalizeFocus({ version: 7, preset: 'gone', zones: { z0: ['text'] } });

        assert.equal(focus.preset, 'split2-v');
        assert.equal(focus.version, 1);
        assert.deepEqual(focus.zones.z0, ['text']);
    });

    it('drops zone keys outside the preset', () => {
        const focus = normalizeFocus({ preset: 'split2-v', zones: { z0: ['text'], z5: ['table'] } });

        assert.deepEqual(Object.keys(focus.zones), ['z0', 'z1']);
        assert.deepEqual(focus.zones.z0, ['text']);
    });

    it('clamps stored ratios to 8%-92%', () => {
        const focus = normalizeFocus({ preset: 'split3-cols', ratios: [0, 0.5] });
        const odd = normalizeFocus({ preset: 'split3-cols', ratios: [2, 'x'] });

        assert.deepEqual(focus.ratios, [0.08, 0.5]);
        assert.deepEqual(odd.ratios, [0.92, 0.5]);
    });

    it('falls back to preset ratios when none are stored', () => {
        const focus = normalizeFocus({ preset: 'split3-cols' });

        assert.deepEqual(focus.ratios, defaultRatios('split3-cols'));
    });

    it('lets a block live in exactly one zone — the first one wins', () => {
        const focus = normalizeFocus({
            preset: 'split3-cols',
            zones: { z0: ['text'], z1: ['text', 'table'], z2: ['table'] }
        });

        assert.deepEqual(focus.zones, { z0: ['text'], z1: ['table'], z2: [] });
    });

    it('filters blocks it does not know', () => {
        const focus = normalizeFocus({ preset: 'split2-v', zones: { z0: ['text', 'wormhole'] } });

        assert.deepEqual(focus.zones.z0, ['text']);
    });

    it('normalises the stored zoom', () => {
        const focus = normalizeFocus({ preset: 'split2-v', zoom: { z0: 63 } });

        assert.deepEqual(focus.zoom, { z0: 60, z1: 100 });
    });
});

describe('focus model · configured check', () => {
    it('is false for an empty workspace and for nonsense', () => {
        assert.equal(focusIsConfigured(createDefaultFocus()), false);
        assert.equal(focusIsConfigured(null), false);
    });

    it('is true as soon as any zone holds a block', () => {
        const focus = normalizeFocus({ preset: 'split2-v', zones: { z1: ['chart'] } });

        assert.equal(focusIsConfigured(focus), true);
    });

    it('accepts the raw (unnormalised) blob a note stores', () => {
        assert.equal(focusIsConfigured({ preset: 'split2-v', zones: { z0: ['text'] } }), true);
    });
});

    it('removes a block from every zone', () => {
        const zones = { z0: ['text', 'table'], z1: ['table'] };

        removeBlockFromZones(zones, 'table');

        assert.deepEqual(zones, { z0: ['text'], z1: [] });
        assert.doesNotThrow(() => removeBlockFromZones(null, 'text'));
    });
});
