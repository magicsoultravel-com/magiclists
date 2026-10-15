/** @module {"owns":"flowchart geometry — shape ports, connector routing, hit-test, reroute", "related":["flowchart.js","lassoGeometry.js","canvasBrushes.js"]} */

export function shapeBounds(shape) {
    if (!shape) return null;
    const x0 = Math.min(shape.x0 ?? 0, shape.x1 ?? 0);
    const x1 = Math.max(shape.x0 ?? 0, shape.x1 ?? 0);
    const y0 = Math.min(shape.y0 ?? 0, shape.y1 ?? 0);
    const y1 = Math.max(shape.y0 ?? 0, shape.y1 ?? 0);
    return { minX: x0, minY: y0, maxX: x1, maxY: y1 };
}

export function shapePorts(shape) {
    const b = shapeBounds(shape);
    if (!b) return null;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    return {
        n: { x: cx, y: b.minY },
        e: { x: b.maxX, y: cy },
        s: { x: cx, y: b.maxY },
        w: { x: b.minX, y: cy },
        c: { x: cx, y: cy }
    };
}
export function nearestPort(shape, x, y) {
    const ports = shapePorts(shape);
    if (!ports) return null;
    let best = 'c';
    let bestD = Infinity;
    for (const key of ['n', 'e', 's', 'w', 'c']) {
        const p = ports[key];
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) { bestD = d; best = key; }
    }
    return { port: best, point: ports[best], dist: bestD };
}

export function portPointFor(shape, port) {
    const ports = shapePorts(shape);
    if (!ports) return null;
    return ports[port] || ports.c;
}

export function snapEndpointToShapes(x, y, shapes, tol) {
    const list = Array.isArray(shapes) ? shapes : [];
    const t = Number(tol) > 0 ? Number(tol) : 18;
    let best = null;
    for (const s of list) {
        if (!s || s.id == null) continue;
        const hit = nearestPort(s, x, y);
        if (!hit) continue;
        if (hit.dist <= t && (!best || hit.dist < best.dist)) {
            best = { shapeId: s.id, port: hit.port, point: hit.point, dist: hit.dist };
        }
    }
    return best;
}

export function routeConnector(fromPt, toPt, routing) {
    const a = { x: fromPt.x, y: fromPt.y };
    const b = { x: toPt.x, y: toPt.y };
    if (routing !== 'elbow') {
        return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, midX: (a.x + b.x) / 2, midY: (a.y + b.y) / 2, legs: [[a, b]] };
    }
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    let mid;
    if (dx >= dy) mid = { x: b.x, y: a.y };
    else mid = { x: a.x, y: b.y };
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y, midX: mid.x, midY: mid.y, legs: [[a, mid], [mid, b]] };
}

function distPointToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    return Math.hypot(px - cx, py - cy);
}

export function connectorLegs(conn) {
    if (!conn) return [];
    const a = { x: conn.x0, y: conn.y0 };
    const b = { x: conn.x1, y: conn.y1 };
    if (conn.routing === 'elbow') {
        const mid = { x: conn.midX ?? b.x, y: conn.midY ?? a.y };
        return [[a, mid], [mid, b]];
    }
    return [[a, b]];
}

export function connectorHitTest(conn, x, y, tol) {
    const t = Number(tol) > 0 ? Number(tol) : 10;
    const legs = connectorLegs(conn);
    for (const [a, b] of legs) {
        if (distPointToSegment(x, y, a.x, a.y, b.x, b.y) <= t) return true;
    }
    return false;
}

export function rerouteAttachedConnectors(connectors, shapesById) {
    const list = Array.isArray(connectors) ? connectors : [];
    let changed = 0;
    for (const c of list) {
        if (!c || c.flowchartKind !== 'connector') continue;
        const fromShape = c.from && c.from.shapeId ? shapesById.get(c.from.shapeId) : null;
        const toShape = c.to && c.to.shapeId ? shapesById.get(c.to.shapeId) : null;
        if (!fromShape && !toShape) continue;
        const a = fromShape ? (portPointFor(fromShape, c.from.port) || { x: c.x0, y: c.y0 }) : { x: c.x0, y: c.y0 };
        const b = toShape ? (portPointFor(toShape, c.to.port) || { x: c.x1, y: c.y1 }) : { x: c.x1, y: c.y1 };
        const routed = routeConnector(a, b, c.routing);
        if (routed.x0 !== c.x0 || routed.y0 !== c.y0 || routed.x1 !== c.x1 || routed.y1 !== c.y1 || routed.midX !== c.midX || routed.midY !== c.midY) {
            c.x0 = routed.x0; c.y0 = routed.y0; c.x1 = routed.x1; c.y1 = routed.y1;
            c.midX = routed.midX; c.midY = routed.midY;
            changed += 1;
        }
    }
    return changed;
}

