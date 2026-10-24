// test/drawingBoardGeometry.test.js
// The stroke-geometry helpers used to live inside js/drawingBoard.js as private
// functions, where only a full pointer session could reach them. They are pure
// (arrays of points in, arrays of points out), so they now have direct guards:
// thinning must never mutate or drop the endpoints a stroke's identity and
// pressure profile depend on.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dist2, readPressure, thinStrokePoints } from '../js/drawingBoard/geometry.js';
import { THIN_MIN_DIST, THIN_COLLINEAR_EPS } from '../js/drawingBoardCore.js';

function pt(x, y, extra = {}) {
    return { x, y, p: 0.5, tiltX: 0, tiltY: 0, ...extra };
}

describe('dist2', () => {
    it('returns the squared distance, not the euclidean one', () => {
        assert.equal(dist2(pt(0, 0), pt(3, 4)), 25);
    });

    it('is zero for the same point and never negative', () => {
        assert.equal(dist2(pt(7, -2), pt(7, -2)), 0);
        assert.ok(dist2(pt(-5, 0), pt(5, 0)) > 0);
    });
});

describe('thinStrokePoints', () => {
    it('returns short strokes untouched, by reference', () => {
        const two = [pt(0, 0), pt(50, 0)];
        assert.equal(thinStrokePoints(two), two);
        const empty = [];
        assert.equal(thinStrokePoints(empty), empty);
        assert.equal(thinStrokePoints(null), null);
    });

    it('keeps both endpoints and never mutates the input', () => {
        const points = [pt(0, 0), pt(1, 0), pt(2, 0), pt(30, 40)];
        const before = JSON.stringify(points);
        const kept = thinStrokePoints(points, 10);

        assert.equal(kept[0], points[0], 'first point survives by reference');
        assert.equal(kept[kept.length - 1], points[points.length - 1], 'last point survives');
        assert.equal(JSON.stringify(points), before, 'input array is untouched');
    });

    it('drops samples closer together than minDist', () => {
        // 1px apart with a 10px threshold: only the endpoints can survive.
        const points = [pt(0, 0), pt(1, 0), pt(2, 0), pt(3, 0), pt(100, 0)];
        const kept = thinStrokePoints(points, 10);
        assert.deepEqual(kept.map((p) => p.x), [0, 100]);
    });

    it('collapses a straight collinear run but keeps the corner', () => {
        const straight = [pt(0, 0), pt(20, 0), pt(40, 0), pt(60, 0), pt(80, 0), pt(100, 0)];
        const thinned = thinStrokePoints(straight, 20);
        assert.ok(thinned.length < straight.length, 'collinear samples are redundant');
        assert.equal(thinned[0], straight[0]);
        assert.equal(thinned[thinned.length - 1], straight[straight.length - 1]);

        const corner = [pt(0, 0), pt(20, 0), pt(20, 20)];
        const keptCorner = thinStrokePoints(corner, 20);
        assert.deepEqual(keptCorner.map((p) => [p.x, p.y]), [[0, 0], [20, 0], [20, 20]]);
    });

    it('keeps the pressure/tilt payload of every surviving sample', () => {
        const points = [
            pt(0, 0, { p: 0.11, tiltX: -10 }),
            pt(2, 0, { p: 0.42, tiltX: 5 }),
            pt(60, 60, { p: 0.93, tiltY: 25 })
        ];
        const kept = thinStrokePoints(points, THIN_MIN_DIST, THIN_COLLINEAR_EPS);
        for (const p of kept) {
            const source = points.find((q) => q.x === p.x && q.y === p.y);
            assert.deepEqual(p, source, 'thinning must not rebuild point objects');
        }
    });
});

describe('readPressure', () => {
    it('uses a pen\u2019s reported pressure, clamped to 0..1', () => {
        assert.equal(readPressure({ pointerType: 'pen', pressure: 0.37 }), 0.37);
        assert.equal(readPressure({ pointerType: 'pen', pressure: 1.4 }), 1);
    });

    it('falls back to a hairline for a pen that reports no pressure', () => {
        assert.equal(readPressure({ pointerType: 'pen', pressure: 0 }), 0.05);
        assert.equal(readPressure({ pointerType: 'pen' }), 0.05);
    });

    it('uses a mouse\u2019s pressure when given one, else a neutral 0.5', () => {
        assert.equal(readPressure({ pointerType: 'mouse', pressure: 0.8 }), 0.8);
        assert.equal(readPressure({ pointerType: 'mouse', pressure: 0 }), 0.5);
        assert.equal(readPressure({ pointerType: 'touch' }), 0.5);
    });
});
