// test/canvasZOrder.test.js
// The z-level rule has exactly one implementation (js/canvasZOrder.js) and four
// consumers: the board painter, the note preview renderer, the clipboard bitmap
// and click hit-testing. If they disagree, a click selects the item that is not
// visually on top — the bug this file exists to prevent.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    Z_BOTTOM, Z_MIDDLE, Z_TOP, Z_LEVELS,
    normalizeZLevel, zLevelOf, orderedItems
} from '../js/canvasZOrder.js';

describe('z-level constants and normalisation', () => {
    it('keeps the three levels apart', () => {
        assert.deepEqual(Z_LEVELS, [Z_BOTTOM, Z_MIDDLE, Z_TOP]);
        assert.equal(Z_BOTTOM, -1);
        assert.equal(Z_MIDDLE, 0);
        assert.equal(Z_TOP, 1);
    });

    it('maps anything unexpected onto the middle layer', () => {
        assert.equal(normalizeZLevel(1), Z_TOP);
        assert.equal(normalizeZLevel(-1), Z_BOTTOM);
        assert.equal(normalizeZLevel(0), Z_MIDDLE);
        assert.equal(normalizeZLevel(undefined), Z_MIDDLE);
        assert.equal(normalizeZLevel(null), Z_MIDDLE);
        assert.equal(normalizeZLevel(''), Z_MIDDLE);
        assert.equal(normalizeZLevel('nope'), Z_MIDDLE);
        assert.equal(normalizeZLevel(NaN), Z_MIDDLE);
        assert.equal(normalizeZLevel(7), Z_MIDDLE, 'out-of-range values never invent a fourth layer');
        assert.equal(normalizeZLevel(-4), Z_MIDDLE);
        assert.equal(normalizeZLevel(1.7), Z_TOP, 'fractions truncate, they do not round into a neighbour');
    });

    it('reads the level off an item, missing field means middle', () => {
        assert.equal(zLevelOf({}), Z_MIDDLE);
        assert.equal(zLevelOf({ zLevel: 1 }), Z_TOP);
        assert.equal(zLevelOf({ zLevel: -1 }), Z_BOTTOM);
        assert.equal(zLevelOf({ zLevel: 0 }), Z_MIDDLE);
        assert.equal(zLevelOf(null), Z_MIDDLE);
        assert.equal(zLevelOf(undefined), Z_MIDDLE);
    });
});

describe('orderedItems', () => {
    const img = { id: 'img' };
    const s1 = { id: 's1' };
    const s2 = { id: 's2' };
    const txt = { id: 'txt' };

    const ids = (layers) => orderedItems(layers).map((entry) => entry.item.id);
    const kinds = (layers) => orderedItems(layers).map((entry) => entry.kind);

    it('keeps the historic images → strokes → texts order when no level is set', () => {
        const layers = { images: [img], strokes: [s1, s2], texts: [txt] };
        assert.deepEqual(kinds(layers), ['images', 'strokes', 'strokes', 'texts']);
        assert.deepEqual(ids(layers), ['img', 's1', 's2', 'txt']);
    });

    it('tolerates missing or non-array layer lists', () => {
        assert.deepEqual(orderedItems(), []);
        assert.deepEqual(orderedItems({}), []);
        assert.deepEqual(ids({ strokes: null, texts: [txt] }), ['txt']);
    });

    it('sorts levels ascending, then kind, then array index', () => {
        const layers = {
            images: [{ id: 'imgTop', zLevel: Z_TOP }, img],
            strokes: [{ ...s1, zLevel: Z_BOTTOM }, s2],
            texts: [txt]
        };
        // bottom stroke → middle image → middle stroke → middle text → top image
        assert.deepEqual(ids(layers), ['s1', 'img', 's2', 'txt', 'imgTop']);
    });

    it('lets a raised item cross the kind ladder', () => {
        const raisedStroke = { ...s1, zLevel: Z_TOP };
        assert.deepEqual(ids({ images: [img], strokes: [raisedStroke], texts: [txt] }), ['img', 'txt', 's1']);
    });

    it('lets a sunk item fall under everything, including images', () => {
        const sunkText = { ...txt, zLevel: Z_BOTTOM };
        assert.deepEqual(ids({ images: [img], strokes: [s1], texts: [sunkText] }), ['txt', 'img', 's1']);
    });

    it('preserves array order inside one level', () => {
        const a = { id: 'a', zLevel: Z_TOP };
        const b = { id: 'b', zLevel: Z_TOP };
        assert.deepEqual(ids({ strokes: [a, b] }), ['a', 'b']);
        assert.deepEqual(ids({ strokes: [b, a] }), ['b', 'a']);
    });

    it('does not mutate the input arrays', () => {
        const strokes = [{ ...s1, zLevel: Z_TOP }, s2];
        const before = strokes.slice();
        orderedItems({ strokes });
        assert.deepEqual(strokes, before);
    });

    it('returns every item exactly once', () => {
        const layers = {
            images: [{ id: 'i1', zLevel: Z_TOP }, { id: 'i2', zLevel: Z_BOTTOM }],
            strokes: [{ id: 's1' }, { id: 's2', zLevel: Z_TOP }],
            texts: [{ id: 't1', zLevel: Z_BOTTOM }, { id: 't2' }]
        };
        const got = ids(layers).sort();
        assert.deepEqual(got, ['i1', 'i2', 's1', 's2', 't1', 't2']);
    });
});
