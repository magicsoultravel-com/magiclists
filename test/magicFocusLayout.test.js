// test/magicFocusLayout.test.js
// Characterization tests for js/magicFocus/layout.js — the preset-to-grid
// translation. Every layout question in the workspace reduces to one call:
// `layoutForFocus(item.focus)` returns the CSS grid strings and the splitter
// descriptors the renderer then mounts.
//
// Three contracts live here, and all three are pure functions of the stored blob:
//   * `areas` names every zone exactly once, so a zone can never be orphaned or
//     drawn twice — a wrong area string silently hides a pane;
//   * `splitters` carries one handle per separator, in the ratio order the drag
//     code expects, with `ratioIndex` pointing back into `focus.ratios`;
//   * the geometry clamps at 8%/92%, the same ceiling `normalizeFocus` applies,
//     applied again here because layout can be asked for a raw ratio.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { frPair, frTriple, layoutForFocus } = await import('../js/magicFocus/layout.js');
const { createDefaultFocus, PRESET_META } = await import('../js/magicFocus/model.js');

const areasOf = (layout) => (layout.areas.match(/z\d/g) || []);

describe('focus layout · fr helpers', () => {
    it('splits the remainder so the pair always sums to one', () => {
        assert.equal(frPair(0.5), '0.5fr 0.5fr');
        assert.equal(frPair(0.3), '0.3fr 0.7fr');
    });

    const tracks = (spec) => spec.split(' ').map((t) => Number(t.replace('fr', '')));

    it('clamps the split to 8%-92%', () => {
        assert.equal(frPair(0), '0.08fr 0.92fr');

        const [a, b] = tracks(frPair(1));
        assert.equal(a, 0.92);
        assert.ok(Math.abs(b - 0.08) < 1e-9, `remainder drifted to ${b}`);
    });

    it('builds a three-track grid from two ratios', () => {
        const parts = tracks(frTriple(1 / 3, 2 / 3));

        assert.equal(parts.length, 3);
        parts.forEach((p) => assert.ok(Math.abs(p - 1 / 3) < 1e-9, `track ${p} is not a third`));
        assert.ok(Math.abs(parts.reduce((x, y) => x + y, 0) - 1) < 1e-9);
    });
});

describe('focus layout · every preset draws every zone once', () => {
    for (const preset of PRESET_META.map((p) => p.id)) {
        it(`${preset}: areas, tracks and handles agree with the model`, () => {
            const focus = createDefaultFocus(preset);
            const layout = layoutForFocus(focus);
            const zoneCount = Object.keys(focus.zones).length;
            const areaZones = areasOf(layout);
            const unique = new Set(areaZones);

            assert.equal(unique.size, zoneCount, 'a zone is missing or duplicated in `areas`');
            assert.deepEqual([...unique].sort(), Object.keys(focus.zones).sort());

            const colTracks = layout.columns.split(' ').length;
            const rowTracks = layout.rows.split(' ').length;
            assert.equal(areaZones.length, colTracks * rowTracks, 'area grid does not match the track counts');
            assert.equal(layout.splitters.length, zoneCount === 4 ? 2 : zoneCount - 1);
        });
    }
});

describe('focus layout · splitter descriptors', () => {
    it('points each handle at its ratio and names the axis', () => {
        const layout = layoutForFocus(createDefaultFocus('split3-cols'));

        assert.deepEqual(layout.splitters.map((s) => s.type), ['col', 'col']);
        assert.deepEqual(layout.splitters.map((s) => s.ratioIndex), [0, 1]);
        assert.deepEqual(layout.splitters.map((s) => s.pos), [1 / 3, 2 / 3]);
    });

    it('tags the half-width handle in the 1-over-2 and 2-over-1 presets', () => {
        const over = layoutForFocus(createDefaultFocus('split3-1over2'));
        const under = layoutForFocus(createDefaultFocus('split3-2over1'));

        assert.equal(over.splitters[1].band, 'bottom');
        assert.equal(under.splitters[1].band, 'top');
    });

    it('uses the stored ratios rather than the defaults', () => {
        const layout = layoutForFocus({
            preset: 'split2-v',
            ratios: [0.25],
            zones: { z0: [], z1: [] }
        });

        assert.equal(layout.columns, '0.25fr 0.75fr');
        assert.equal(layout.splitters[0].pos, 0.25);
    });
});

describe('focus layout · degenerate input', () => {
    it('falls back to the default layout when the blob is unusable', () => {
        const layout = layoutForFocus(null);

        assert.deepEqual(areasOf(layout), ['z0', 'z1']);
        assert.equal(layout.columns, '0.5fr 0.5fr');
        assert.equal(layout.rows, '1fr');
    });

    it('never returns an empty handle list for a split preset', () => {
        for (const preset of PRESET_META.map((p) => p.id)) {
            assert.ok(layoutForFocus({ preset }).splitters.length > 0, `${preset} has no splitter`);
        }
    });
});
