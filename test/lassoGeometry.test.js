// Unit tests for js/lassoGeometry.js.
// Verifies that selection geometry supports brush strokes, shapes, and text objects.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    strokeHasPointInPolygon,
    itemIntersectsRect,
    getStrokesBounds,
    translateStrokes,
    clampStrokesToBounds,
    rectToPolygon,
    resolveBoxSelection,
    boxSelectThresholdWorld,
    itemContainsPoint,
    findTopmostItemAt,
    raiseItemInLayer,
    BOX_SELECT_CLICK_THRESHOLD
} from '../js/lassoGeometry.js';

describe('lassoGeometry', () => {
    it('detects brush stroke points inside a polygon', () => {
        const polygon = rectToPolygon(0, 0, 100, 100);
        const inside = { id: 's1', tool: 'brush', points: [{ x: 50, y: 50 }] };
        const outside = { id: 's2', tool: 'brush', points: [{ x: 150, y: 150 }] };
        assert.equal(strokeHasPointInPolygon(inside, polygon), true);
        assert.equal(strokeHasPointInPolygon(outside, polygon), false);
    });

    it('detects shape bounding boxes intersecting a polygon', () => {
        const polygon = rectToPolygon(0, 0, 100, 100);
        const inside = { id: 'shape1', tool: 'rect', x0: 10, y0: 10, x1: 90, y1: 90 };
        const outside = { id: 'shape2', tool: 'rect', x0: 200, y0: 200, x1: 300, y1: 300 };
        assert.equal(strokeHasPointInPolygon(inside, polygon), true);
        assert.equal(strokeHasPointInPolygon(outside, polygon), false);
    });

    it('detects overlapping shape edges without contained corners', () => {
        // Marquee overlaps middle of a large rect — AABB path must still hit
        const polygon = rectToPolygon(40, 40, 60, 60);
        const shape = { id: 'shape1', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 100 };
        assert.equal(strokeHasPointInPolygon(shape, polygon), true);
        assert.equal(itemIntersectsRect(shape, { minX: 40, minY: 40, maxX: 60, maxY: 60 }), true);
    });

    it('detects text boxes intersecting a polygon', () => {
        const polygon = rectToPolygon(0, 0, 100, 100);
        const inside = { id: 't1', tool: 'text', x: 10, y: 10, text: 'hi', fontSize: 16 };
        const outside = { id: 't2', tool: 'text', x: 200, y: 200, text: 'bye', fontSize: 16 };
        assert.equal(strokeHasPointInPolygon(inside, polygon), true);
        assert.equal(strokeHasPointInPolygon(outside, polygon), false);
    });

    it('detects image boxes intersecting a polygon', () => {
        const polygon = rectToPolygon(0, 0, 100, 100);
        const inside = { id: 'img1', tool: 'image', mediaId: 'm1', x: 10, y: 10, width: 40, height: 30 };
        const outside = { id: 'img2', tool: 'image', mediaId: 'm2', x: 200, y: 200, width: 40, height: 30 };
        assert.equal(strokeHasPointInPolygon(inside, polygon), true);
        assert.equal(strokeHasPointInPolygon(outside, polygon), false);
    });

    it('itemIntersectsRect inflates brush hits by stroke width', () => {
        const rect = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
        const thickNear = { tool: 'brush', width: 20, points: [{ x: 18, y: 5 }] };
        const thinFar = { tool: 'brush', width: 2, points: [{ x: 18, y: 5 }] };
        assert.equal(itemIntersectsRect(thickNear, rect), true);
        assert.equal(itemIntersectsRect(thinFar, rect), false);
    });

    it('computes bounds across mixed item types', () => {
        const items = [
            { tool: 'brush', points: [{ x: 5, y: 5 }, { x: 15, y: 15 }] },
            { tool: 'rect', x0: 20, y0: 20, x1: 40, y1: 40 },
            { tool: 'text', x: 50, y: 50, text: 'x', fontSize: 16 },
            { tool: 'image', mediaId: 'm1', x: 60, y: 10, width: 50, height: 40 }
        ];
        const bounds = getStrokesBounds(items);
        assert.equal(bounds.minX, 5);
        assert.ok(bounds.maxX >= 110);
        assert.equal(bounds.minY, 5);
        assert.ok(bounds.maxY > 50);
    });

    it('translates brush strokes, shapes, text, and images', () => {
        const brush = { tool: 'brush', points: [{ x: 1, y: 2 }] };
        const shape = { tool: 'rect', x0: 10, y0: 10, x1: 20, y1: 20 };
        const text = { tool: 'text', x: 5, y: 5, text: 'hi', fontSize: 16 };
        const image = { tool: 'image', mediaId: 'm1', x: 0, y: 0, width: 40, height: 30 };
        translateStrokes([brush, shape, text, image], 3, 4);
        assert.deepEqual(brush.points, [{ x: 4, y: 6 }]);
        assert.equal(shape.x0, 13);
        assert.equal(shape.y0, 14);
        assert.equal(text.x, 8);
        assert.equal(text.y, 9);
        assert.equal(image.x, 3);
        assert.equal(image.y, 4);
        assert.equal(image.width, 40);
    });

    it('clamps mixed items to page bounds', () => {
        const items = [
            { tool: 'brush', points: [{ x: -10, y: 250 }] },
            { tool: 'rect', x0: -20, y0: 10, x1: 120, y1: 20 },
            { tool: 'text', x: 90, y: 5, text: 'hi', fontSize: 16, width: 20, height: 20 },
            { tool: 'image', mediaId: 'm1', x: 90, y: 5, width: 20, height: 20 }
        ];
        const pageBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        clampStrokesToBounds(items, pageBounds);
        assert.equal(items[0].points[0].x, 0);
        assert.equal(items[0].points[0].y, 100);
        assert.equal(items[1].x0, 0);
        assert.equal(items[2].x, 80);
        assert.equal(items[2].y, 5);
        assert.equal(items[3].x, 80);
        assert.equal(items[3].y, 5);
    });

    it('boxSelectThresholdWorld scales with zoom and DPR', () => {
        assert.equal(boxSelectThresholdWorld(6, 1, 1), 6);
        assert.equal(boxSelectThresholdWorld(6, 1, 2), 12);
        assert.equal(boxSelectThresholdWorld(6, 2, 1), 3);
        assert.equal(boxSelectThresholdWorld(6, 0.5, 2), 24);
    });

    it('resolveBoxSelection treats tiny drags as clicks', () => {
        const half = BOX_SELECT_CLICK_THRESHOLD / 2;
        const result = resolveBoxSelection(50, 60, 50 + half, 60 + half);
        assert.equal(result.kind, 'click');
        assert.deepEqual(result.polygon, rectToPolygon(
            50 - half, 60 - half, 50 + half, 60 + half
        ));
        assert.deepEqual(result.rect, {
            minX: 50 - half,
            minY: 60 - half,
            maxX: 50 + half,
            maxY: 60 + half
        });
    });

    it('resolveBoxSelection builds a drag rect above the click threshold', () => {
        const result = resolveBoxSelection(10, 20, 80, 90);
        assert.equal(result.kind, 'drag');
        assert.equal(result.width, 70);
        assert.equal(result.height, 70);
        assert.deepEqual(result.polygon, rectToPolygon(10, 20, 80, 90));
        assert.deepEqual(result.rect, { minX: 10, minY: 20, maxX: 80, maxY: 90 });
    });

    it('resolveBoxSelection uses a larger world threshold when zoomed out', () => {
        const worldThreshold = boxSelectThresholdWorld(6, 0.5, 2); // 24
        const result = resolveBoxSelection(50, 50, 60, 55, worldThreshold);
        assert.equal(result.kind, 'click');
    });

    it('resolveBoxSelection click polygon can hit-test or leave empty (clear path)', () => {
        const click = resolveBoxSelection(50, 50, 51, 51);
        assert.equal(click.kind, 'click');
        const hit = { id: 's1', tool: 'brush', points: [{ x: 50, y: 50 }] };
        const miss = { id: 's2', tool: 'brush', points: [{ x: 200, y: 200 }] };
        assert.equal(itemIntersectsRect(hit, click.rect), true);
        assert.equal(itemIntersectsRect(miss, click.rect), false);
        assert.equal(strokeHasPointInPolygon(hit, click.polygon), true);
        assert.equal(strokeHasPointInPolygon(miss, click.polygon), false);
    });
});

// Click hit-testing + per-layer z-order (click-to-front).
// Paint order is images → strokes → texts; within a layer, the last entry is on
// top. A click picks the topmost object and raises it within its own layer.
describe('lassoGeometry click hit-testing and z-order', () => {
    const image = { id: 'img1', tool: 'image', mediaId: 'm1', x: 0, y: 0, width: 100, height: 100 };
    const stroke = { id: 's1', tool: 'brush', width: 4, points: [{ x: 50, y: 50 }] };
    const shape = { id: 'sh1', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 100 };
    const text = { id: 't1', tool: 'text', x: 10, y: 10, text: 'hi', fontSize: 16, width: 40, height: 20 };

    it('itemContainsPoint hits images, brush points, shapes and text boxes', () => {
        assert.equal(itemContainsPoint(image, 50, 50), true);
        assert.equal(itemContainsPoint(image, 150, 50), false);

        assert.equal(itemContainsPoint(stroke, 51, 50), true);
        assert.equal(itemContainsPoint(stroke, 60, 50), false);
        assert.equal(itemContainsPoint(stroke, 60, 50, 12), true);

        assert.equal(itemContainsPoint(shape, 90, 10), true);
        assert.equal(itemContainsPoint(shape, 110, 10), false);

        assert.equal(itemContainsPoint(text, 20, 15), true);
        assert.equal(itemContainsPoint(text, 20, 60), false);

        assert.equal(itemContainsPoint(null, 0, 0), false);
    });

    it('findTopmostItemAt walks texts, then strokes, then images', () => {
        const layers = { images: [image], strokes: [stroke], texts: [text] };
        // Inside the text box (and the image) → text wins.
        assert.equal(findTopmostItemAt(30, 20, layers), text);
        // On the brush point, outside the text box → stroke beats image.
        assert.equal(findTopmostItemAt(50, 50, layers), stroke);
        // Image only.
        assert.equal(findTopmostItemAt(95, 95, layers), image);
        // Nothing.
        assert.equal(findTopmostItemAt(500, 500, layers), null);
    });

    it('findTopmostItemAt prefers the last painted item inside a layer', () => {
        const under = { ...image, id: 'under' };
        const over = { ...image, id: 'over' };
        assert.equal(findTopmostItemAt(50, 50, { images: [under, over] }), over);
        assert.equal(findTopmostItemAt(50, 50, { images: [over, under] }), under);
    });

    it('raiseItemInLayer moves an item to the end of its own layer', () => {
        const a = { id: 'a' };
        const b = { id: 'b' };
        const c = { id: 'c' };
        const images = [a, b, c];
        const strokes = [{ id: 'x' }];

        const raised = raiseItemInLayer(a, { images, strokes, texts: [] });
        assert.equal(raised.kind, 'images');
        assert.deepEqual(raised.items.map((i) => i.id), ['b', 'c', 'a']);
        // Source array is untouched so callers can snapshot history first.
        assert.deepEqual(images.map((i) => i.id), ['a', 'b', 'c']);
    });

    it('raiseItemInLayer targets the layer that owns the item', () => {
        const img = { id: 'i1' };
        const st1 = { id: 's1' };
        const st2 = { id: 's2' };
        const raised = raiseItemInLayer(st1, { images: [img], strokes: [st1, st2], texts: [] });
        assert.equal(raised.kind, 'strokes');
        assert.deepEqual(raised.items.map((i) => i.id), ['s2', 's1']);
    });

    it('raiseItemInLayer is a no-op for top items and unknown items', () => {
        const a = { id: 'a' };
        const b = { id: 'b' };
        assert.equal(raiseItemInLayer(b, { images: [a, b] }), null);
        assert.equal(raiseItemInLayer({ id: 'nope' }, { images: [a, b] }), null);
        assert.equal(raiseItemInLayer(null, { images: [a, b] }), null);
    });
});

