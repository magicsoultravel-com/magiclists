/** @module {"owns":"magicCanvas stroke geometry - point thinning, squared distance, pointer pressure","related":["drawingBoard.js","drawingBoardCore.js"]} */
import { THIN_MIN_DIST, THIN_COLLINEAR_EPS } from '../drawingBoardCore.js';

export function dist2(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return dx * dx + dy * dy;
}

/**
 * Drop redundant points from a finished stroke while keeping endpoints and
 * pressure/tilt samples that meaningfully change direction or spacing.
 */
export function thinStrokePoints(points, minDist = THIN_MIN_DIST, collinearEps = THIN_COLLINEAR_EPS) {
    if (!points || points.length <= 2) return points;
    const minDist2 = minDist * minDist;
    const kept = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        const prev = kept[kept.length - 1];
        const cur = points[i];
        const next = points[i + 1];
        if (dist2(prev, cur) < minDist2) continue;
        // Drop if nearly collinear between prev → cur → next
        const ax = cur.x - prev.x;
        const ay = cur.y - prev.y;
        const bx = next.x - cur.x;
        const by = next.y - cur.y;
        const cross = Math.abs(ax * by - ay * bx);
        const lenA = Math.hypot(ax, ay);
        const lenB = Math.hypot(bx, by);
        if (lenA > 0 && lenB > 0 && cross / (lenA * lenB) < collinearEps && dist2(prev, next) < minDist2 * 9) {
            continue;
        }
        kept.push(cur);
    }
    kept.push(points[points.length - 1]);
    return kept;
}

export function readPressure(event) {
    const p = event.pressure;
    if (event.pointerType === 'pen') {
        if (typeof p === 'number' && p > 0) return Math.min(1, p);
        return 0.05;
    }
    if (typeof p === 'number' && p > 0) return Math.min(1, p);
    return 0.5;
}
