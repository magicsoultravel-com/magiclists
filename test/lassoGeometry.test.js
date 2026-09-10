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
    getPageBounds
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

    it('computes bounds across mixed item types', () => {
        const items = [
            { tool: 'brush', points: [{ x: 5, y: 5 }, { x: 15, y: 15 }] },
            { tool: 'rect', x0: 20, y0: 20, x1: 40, y1: 40 },
            { tool: 'text', x: 50, y: 50, text: 'x', fontSize: 16 }
        ];
        const bounds = getStrokesBounds(items);
        assert.equal(bounds.minX, 5);
        assert.ok(bounds.maxX > 50);
        assert.equal(bounds.minY, 5);
        assert.ok(bounds.maxY > 50);
    });

    it('translates brush strokes, shapes, and text', () => {
        const brush = { tool: 'brush', points: [{ x: 1, y: 2 }] };
        const shape = { tool: 'rect', x0: 10, y0: 10, x1: 20, y1: 20 };
        const text = { tool: 'text', x: 5, y: 5, text: 'hi', fontSize: 16 };
        translateStrokes([brush, shape, text], 3, 4);
        assert.deepEqual(brush.points, [{ x: 4, y: 6 }]);
        assert.equal(shape.x0, 13);
        assert.equal(shape.y0, 14);
        assert.equal(text.x, 8);
        assert.equal(text.y, 9);
    });

    it('clamps mixed items to page bounds', () => {
        const items = [
            { tool: 'brush', points: [{ x: -10, y: 250 }] },
            { tool: 'rect', x0: -20, y0: 10, x1: 120, y1: 20 },
            { tool: 'text', x: 90, y: 5, text: 'hi', fontSize: 16, width: 20, height: 20 }
        ];
        const pageBounds = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
        clampStrokesToBounds(items, pageBounds);
        assert.equal(items[0].points[0].x, 0);
        assert.equal(items[0].points[0].y, 100);
        assert.equal(items[1].x0, 0);
        assert.equal(items[2].x, 80); // 90 + 20 width would exceed 100, so x clamped to maxX - width
        assert.equal(items[2].y, 5);  // 5 + 20 height fits inside 100
    });
});
