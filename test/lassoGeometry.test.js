// Unit tests for js/lassoGeometry.js.
// Verifies that selection geometry supports brush strokes, shapes, and text objects.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    strokeHasPointInPolygon,
    getStrokesBounds,
    translateStrokes,
    clampStrokesToBounds,
    rectToPolygon,
    resolveBoxSelection,
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

    it('resolveBoxSelection treats tiny drags as clicks', () => {
        const half = BOX_SELECT_CLICK_THRESHOLD / 2;
        const result = resolveBoxSelection(50, 60, 50 + half, 60 + half);
        assert.equal(result.kind, 'click');
        assert.deepEqual(result.polygon, rectToPolygon(
            50 - half, 60 - half, 50 + half, 60 + half
        ));
    });

    it('resolveBoxSelection builds a drag rect above the click threshold', () => {
        const result = resolveBoxSelection(10, 20, 80, 90);
        assert.equal(result.kind, 'drag');
        assert.equal(result.width, 70);
        assert.equal(result.height, 70);
        assert.deepEqual(result.polygon, rectToPolygon(10, 20, 80, 90));
    });

    it('resolveBoxSelection click polygon can hit-test or leave empty (clear path)', () => {
        const click = resolveBoxSelection(50, 50, 51, 51);
        assert.equal(click.kind, 'click');
        const hit = { id: 's1', tool: 'brush', points: [{ x: 50, y: 50 }] };
        const miss = { id: 's2', tool: 'brush', points: [{ x: 200, y: 200 }] };
        assert.equal(strokeHasPointInPolygon(hit, click.polygon), true);
        assert.equal(strokeHasPointInPolygon(miss, click.polygon), false);
    });
});
