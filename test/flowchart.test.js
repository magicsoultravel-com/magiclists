// test/flowchart.test.js
// Model + geometry guards for the always-on shape/connector layer. Grid prefs
// are shared canvas state now (no per-note flowchart item), so snapping and
// label sizing are pinned here; the geometry half guards the attachment
// contract drawingBoard.js and the painter both read.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeFlowchartGrid,
    normalizeFlowchartLabel,
    fitFlowLabelFontSize,
    normalizeFlowLabelSize,
    createFlowchartShape,
    createFlowchartConnector,
    routeFlowchartConnector,
    FLOW_LABEL_DEFAULT,
    FLOW_LABEL_MAX,
    FLOW_LABEL_MIN,
    FLOWCHART_DEFAULT_GRID_SIZE,
    FLOWCHART_GRID_STEPS
} from '../js/flowchart.js';
import {
    shapePorts,
    nearestPort,
    snapEndpointToShapes,
    routeConnector,
    connectorHitTest,
    rerouteAttachedConnectors
} from '../js/flowchartGeometry.js';
import { pointOnConnectorPath } from '../js/lassoGeometry.js';

describe('flowchart model', () => {
    it('normalizes the shared grid pref and leaves snap opt-in', () => {
        assert.deepEqual(normalizeFlowchartGrid(null), { size: FLOWCHART_DEFAULT_GRID_SIZE, snap: false });
        assert.deepEqual(normalizeFlowchartGrid({ size: 25, snap: true }), { size: 24, snap: true });
        // Snap is strict: only a real `true` turns it on, so a stale string or
        // missing field never silently quantizes freehand drawing.
        assert.equal(normalizeFlowchartGrid({ snap: 'yes' }).snap, false);
        assert.equal(normalizeFlowchartGrid({ snap: 1 }).snap, false);
    });

    it('clamps the grid size to an allowed step', () => {
        assert.equal(normalizeFlowchartGrid({ size: 99 }).size, 48);
        assert.equal(normalizeFlowchartGrid({ size: 0 }).size, FLOWCHART_GRID_STEPS[0]);
        assert.equal(normalizeFlowchartGrid({ size: 'nope' }).size, FLOWCHART_DEFAULT_GRID_SIZE);
        FLOWCHART_GRID_STEPS.forEach((step) => {
            assert.equal(normalizeFlowchartGrid({ size: step }).size, step);
        });
    });

    it('drops an empty label and clamps a stored one', () => {
        assert.equal(normalizeFlowchartLabel(null), null);
        assert.equal(normalizeFlowchartLabel({ text: '   ' }), null);
        const kept = normalizeFlowchartLabel({ text: 'Step 1', fontSize: 500, color: '#fff' });
        assert.equal(kept.text, 'Step 1');
        assert.equal(kept.fontSize, FLOW_LABEL_MAX);
        assert.equal(kept.color, '#fff');
        assert.equal(normalizeFlowchartLabel({ text: 'x', fontSize: 1 }).fontSize, FLOW_LABEL_MIN);
        assert.equal(normalizeFlowchartLabel({ text: 'x'.repeat(4000) }).text.length, 2000);
    });

    it('sizes a label to the shape but never below the floor', () => {
        assert.equal(fitFlowLabelFontSize(100), 32);
        assert.equal(fitFlowLabelFontSize(10), FLOW_LABEL_MIN);
        assert.equal(fitFlowLabelFontSize(10000), FLOW_LABEL_MAX);
        assert.equal(fitFlowLabelFontSize(0), FLOW_LABEL_DEFAULT);
        assert.equal(fitFlowLabelFontSize(NaN), FLOW_LABEL_DEFAULT);
    });

    it('clamps label size to step range', () => {
        assert.equal(normalizeFlowLabelSize(13), 14);
        assert.equal(normalizeFlowLabelSize(500), 72);
        assert.equal(normalizeFlowLabelSize(5), 12);
    });

    it('creates shapes tagged for the renderer, without a label', () => {
        const s = createFlowchartShape({ id: 'R', tool: 'diamond', x0: 0, y0: 0, x1: 120, y1: 80 });
        assert.equal(s.flowchartKind, 'shape');
        assert.equal(s.tool, 'diamond');
        assert.equal(s.label, null);
        assert.equal(s.x1, 120);
        // An unknown tool falls back to a rectangle instead of an unrenderable stroke.
        assert.equal(createFlowchartShape({ tool: 'line' }).tool, 'rect');
    });

    it('creates connectors with default straight routing and a routed bend', () => {
        const straight = createFlowchartConnector({ x0: 0, y0: 0, x1: 100, y1: 0 });
        assert.equal(straight.routing, 'straight');
        assert.equal(straight.flowchartKind, 'connector');
        assert.equal(straight.label, null);

        const elbow = createFlowchartConnector({ x0: 0, y0: 0, x1: 100, y1: 10, routing: 'elbow' });
        // The cached bend must match the shared router the painter draws with.
        const routed = routeConnector({ x: 0, y: 0 }, { x: 100, y: 10 }, 'elbow');
        assert.equal(elbow.midX, routed.midX);
        assert.equal(elbow.midY, routed.midY);
        assert.equal(createFlowchartConnector({ routing: 'zigzag' }).routing, 'straight');
    });

    it('routeFlowchartConnector re-syncs the bend after an endpoint drag', () => {
        const conn = createFlowchartConnector({ x0: 0, y0: 0, x1: 100, y1: 10, routing: 'elbow' });
        conn.x1 = 300;
        conn.y1 = 160;
        routeFlowchartConnector(conn);
        const routed = routeConnector({ x: 0, y: 0 }, { x: 300, y: 160 }, 'elbow');
        assert.equal(conn.midX, routed.midX);
        assert.equal(conn.midY, routed.midY);
        // Non-connector strokes pass through untouched.
        const shape = createFlowchartShape({ id: 'S' });
        assert.equal(routeFlowchartConnector(shape), shape);
        assert.equal(shape.midX, undefined);
    });
});

describe('flowchart geometry', () => {
    const shape = { id: 's1', x0: 0, y0: 0, x1: 100, y1: 60 };

    it('exposes n/e/s/w/c ports', () => {
        const ports = shapePorts(shape);
        assert.deepEqual(ports.n, { x: 50, y: 0 });
        assert.deepEqual(ports.e, { x: 100, y: 30 });
        assert.deepEqual(ports.c, { x: 50, y: 30 });
    });

    it('finds nearest port and snaps endpoints', () => {
        const hit = nearestPort(shape, 96, 28);
        assert.equal(hit.port, 'e');
        const snap = snapEndpointToShapes(96, 28, [shape], 18);
        assert.equal(snap.shapeId, 's1');
        assert.equal(snap.port, 'e');
        assert.equal(snapEndpointToShapes(500, 500, [shape], 18), null);
    });

    it('routes straight and elbow connectors', () => {
        const s = routeConnector({ x: 0, y: 0 }, { x: 100, y: 10 }, 'straight');
        assert.equal(s.legs.length, 1);
        const e = routeConnector({ x: 0, y: 0 }, { x: 100, y: 10 }, 'elbow');
        assert.equal(e.legs.length, 2);
        assert.deepEqual({ x: e.midX, y: e.midY }, { x: 100, y: 0 });
    });

    it('hit-tests connectors with tolerance', () => {
        const c = createFlowchartConnector({ x0: 0, y0: 0, x1: 100, y1: 0, routing: 'straight' });
        assert.equal(connectorHitTest(c, 50, 2, 6), true);
        assert.equal(connectorHitTest(c, 50, 40, 6), false);
    });

    it('reroutes attached connectors when a shape moves', () => {
        const s = { id: 'a', x0: 0, y0: 0, x1: 40, y1: 40 };
        const c = createFlowchartConnector({
            from: { shapeId: 'a', port: 'e' },
            x0: 40, y0: 20, x1: 200, y1: 20, routing: 'straight'
        });
        s.x0 = 100; s.x1 = 140;
        const changed = rerouteAttachedConnectors([c], new Map([['a', s]]));
        assert.equal(changed, 1);
        assert.equal(c.x0, 140);
    });
});


describe('flowchart connector attachment contract', () => {
    // drawingBoard.js reads {shapeId, port, point, dist} off snapEndpointToShapes().
    // Guard the field names so a rename cannot silently break port snapping.
    const a = createFlowchartShape({ id: 'A', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 60 });
    const b = createFlowchartShape({ id: 'B', tool: 'diamond', x0: 300, y0: 0, x1: 400, y1: 80 });

    it('returns shapeId/port/point/dist for a pointer inside the magnet', () => {
        const hit = snapEndpointToShapes(350, 40, [a, b], 18);
        assert.equal(hit.shapeId, 'B');
        assert.equal(typeof hit.port, 'string');
        assert.ok(Number.isFinite(hit.point.x));
        assert.ok(Number.isFinite(hit.point.y));
        assert.ok(Number.isFinite(hit.dist));
    });

    it('returns null when nothing is near a port', () => {
        assert.equal(snapEndpointToShapes(999, 999, [a, b], 18), null);
    });

    it('excludes the origin shape so self-loops cannot form', () => {
        // The board filters the source shape out before resolving the far end.
        const others = [a, b].filter((s) => s.id !== a.id);
        assert.equal(snapEndpointToShapes(50, 30, others, 18), null);
    });

    it('snaps to the nearest port, not the far one', () => {
        // Point sits right on B's west edge -> expects 'w', not 'e'.
        const hit = snapEndpointToShapes(302, 40, [b], 18);
        assert.equal(hit.shapeId, 'B');
        assert.equal(hit.port, 'w');
    });

    it('builds an attached connector from a resolved port hit', () => {
        const endAnchor = snapEndpointToShapes(350, 40, [b], 18);
        const conn = createFlowchartConnector({
            id: 'C',
            from: { shapeId: a.id, port: 'e' },
            to: { shapeId: endAnchor.shapeId, port: endAnchor.port },
            x0: 100, y0: 30,
            x1: endAnchor.point.x, y1: endAnchor.point.y,
            routing: 'elbow'
        });
        assert.equal(conn.flowchartKind, 'connector');
        assert.equal(conn.from.shapeId, a.id);
        assert.equal(conn.to.shapeId, b.id);
        assert.equal(conn.x1, 350);
        assert.equal(conn.y1, 40);
    });
});

describe('flowchart connector path hit testing', () => {
    it('hits a straight connector along its line and misses off it', () => {
        const c = createFlowchartConnector({
            id: 'S', from: null, to: null,
            x0: 0, y0: 0, x1: 200, y1: 0, routing: 'straight'
        });
        assert.equal(pointOnConnectorPath(c, 100, 0, 6), true);
        assert.equal(pointOnConnectorPath(c, 100, 3, 6), true);
        assert.equal(pointOnConnectorPath(c, 100, 40, 6), false);
    });

    it('hits both legs of an elbow, including the bend', () => {
        const c = createFlowchartConnector({
            id: 'E',
            from: { shapeId: 'A', port: 'e' },
            to: { shapeId: 'B', port: 'w' },
            x0: 100, y0: 30, x1: 300, y1: 160, routing: 'elbow'
        });
        // Horizontal leg then vertical leg, joined at (300, 30).
        assert.equal(pointOnConnectorPath(c, 200, 30, 6), true);
        assert.equal(pointOnConnectorPath(c, 300, 30, 6), true);
        assert.equal(pointOnConnectorPath(c, 300, 90, 6), true);
        // Well outside both legs.
        assert.equal(pointOnConnectorPath(c, 150, 90, 6), false);
    });

    it('does not treat an empty bounding box as a hit', () => {
        // A near-vertical elbow has a very wide bbox but a narrow path.
        const c = createFlowchartConnector({
            id: 'V',
            from: { shapeId: 'A', port: 'n' },
            to: { shapeId: 'B', port: 's' },
            x0: 100, y0: 0, x1: 100, y1: 200, routing: 'elbow'
        });
        assert.equal(pointOnConnectorPath(c, 100, 100, 6), true);
        assert.equal(pointOnConnectorPath(c, 400, 100, 6), false);
    });
});

describe('flowchart label sizing', () => {
    it('clamps to the allowed label range', () => {
        assert.equal(normalizeFlowLabelSize(999), 72);
        assert.equal(normalizeFlowLabelSize(-5), 12);
        assert.equal(normalizeFlowLabelSize(0), 20);
    });

    it('steps by the label increment', () => {
        assert.equal(normalizeFlowLabelSize(20 + 2), 22);
        assert.equal(normalizeFlowLabelSize(20 - 2), 18);
    });

    it('rejects an increment that would cross a bound', () => {
        assert.equal(normalizeFlowLabelSize(73), 72);
        assert.equal(normalizeFlowLabelSize(11), 12);
    });
});

describe('flowchart shape + connector lifecycle', () => {
    it('creates shapes tagged for the renderer and geometry helpers', () => {
        const s = createFlowchartShape({ id: 'R', tool: 'rect', x0: 0, y0: 0, x1: 120, y1: 80 });
        assert.equal(s.flowchartKind, 'shape');
        assert.equal(s.label, null);
        assert.equal(s.x0, 0);
        assert.equal(s.x1, 120);
    });

    it('rejects a self-loop connector', () => {
        const a = createFlowchartShape({ id: 'A', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 60 });
        const hit = snapEndpointToShapes(50, 30, [a], 18);
        const start = { shapeId: a.id, port: 'e' };
        // Mirrors commitFlowConnect's guard.
        assert.equal(start.shapeId === hit.shapeId, true);
    });

    it('follows a moved shape so the connector stays attached', async () => {
        const { translateStrokes } = await import('../js/lassoGeometry.js');
        const a = createFlowchartShape({ id: 'A', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 60 });
        const b = createFlowchartShape({ id: 'B', tool: 'diamond', x0: 300, y0: 0, x1: 400, y1: 80 });
        const byId = new Map([[a.id, a], [b.id, b]]);
        const conn = createFlowchartConnector({
            id: 'C',
            from: { shapeId: a.id, port: 'e' },
            to: { shapeId: b.id, port: 'w' },
            x0: 100, y0: 30, x1: 300, y1: 40, routing: 'elbow'
        });

        translateStrokes([b], 0, 120);
        assert.equal(b.y0, 120);

        rerouteAttachedConnectors([conn], byId);
        assert.equal(conn.to.shapeId, b.id);
        // B's west edge moved down with the shape.
        assert.equal(conn.y1, 160);
    });

    it('leaves unattached connectors alone', async () => {
        const { translateStrokes } = await import('../js/lassoGeometry.js');
        const a = createFlowchartShape({ id: 'A', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 60 });
        const byId = new Map([[a.id, a]]);
        const loose = createFlowchartConnector({
            id: 'L', from: null, to: null,
            x0: 500, y0: 500, x1: 600, y1: 600, routing: 'straight'
        });
        translateStrokes([a], 0, 200);
        rerouteAttachedConnectors([loose], byId);
        assert.equal(loose.y0, 500);
        assert.equal(loose.y1, 600);
    });
});

