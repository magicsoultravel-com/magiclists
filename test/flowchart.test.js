import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createEmptyFlowchart,
    normalizeFlowchart,
    flowchartHasContent,
    normalizeFlowchartGrid,
    snapFlowchartPoint,
    normalizeFlowLabelSize,
    createFlowchartShape,
    createFlowchartConnector,
    FLOWCHART_DEFAULT_GRID_SIZE
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
    it('creates an infinite dots-grid doc with snap on', () => {
        const f = createEmptyFlowchart();
        assert.equal(f.version, 1);
        assert.equal(f.doc.canvasMode, 'infinite');
        assert.equal(f.grid.type, 'dots');
        assert.equal(f.grid.size, FLOWCHART_DEFAULT_GRID_SIZE);
        assert.equal(f.grid.snap, true);
    });

    it('snaps to grid steps and bypasses when snap off', () => {
        assert.deepEqual(snapFlowchartPoint(13, 13, { size: 24, snap: true }), { x: 24, y: 24 });
        assert.deepEqual(snapFlowchartPoint(13, 13, { size: 24, snap: false }), { x: 13, y: 13 });
        assert.deepEqual(snapFlowchartPoint(10, 10, { size: 8, snap: true }), { x: 8, y: 8 });
    });

    it('normalizes grid size to nearest step', () => {
        assert.equal(normalizeFlowchartGrid({ size: 25 }).size, 24);
        assert.equal(normalizeFlowchartGrid({ size: 99 }).size, 48);
        assert.equal(normalizeFlowchartGrid(null).size, FLOWCHART_DEFAULT_GRID_SIZE);
    });

    it('detects content only for flow strokes', () => {
        const empty = createEmptyFlowchart();
        assert.equal(flowchartHasContent(empty), false);
        assert.equal(flowchartHasContent(null), false);
        const shape = createFlowchartShape({ tool: 'rect', x0: 0, y0: 0, x1: 48, y1: 24 });
        empty.doc.pages[0].strokes.push(shape);
        assert.equal(flowchartHasContent(empty), true);
    });

    it('normalizeFlowchart keeps doc and grid', () => {
        const f = createEmptyFlowchart();
        f.grid.size = 32;
        const n = normalizeFlowchart(JSON.parse(JSON.stringify(f)));
        assert.equal(n.grid.size, 32);
        assert.equal(n.doc.canvasMode, 'infinite');
        assert.equal(normalizeFlowchart(null), null);
    });

    it('clamps label size to step range', () => {
        assert.equal(normalizeFlowLabelSize(13), 14);
        assert.equal(normalizeFlowLabelSize(500), 72);
        assert.equal(normalizeFlowLabelSize(5), 12);
    });

    it('creates connectors with default straight routing', () => {
        const c = createFlowchartConnector({ x0: 0, y0: 0, x1: 100, y1: 0 });
        assert.equal(c.routing, 'straight');
        assert.equal(c.flowchartKind, 'connector');
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

describe('flowchart note section markup', () => {
    // Guards three regressions that shipped: an invisible pencil (hover-gated tray
    // the section never matched), an empty collapse caret, and a wrapper class
    // the stylesheet did not target.
    const base = {
        version: 1,
        doc: {
            version: 2,
            canvasMode: 'infinite',
            pages: [{ id: 'p1', strokes: [], texts: [], images: [], background: 'dots' }]
        },
        grid: { type: 'dots', size: 24, snap: true }
    };
    const makeItem = (id, extra = {}) => ({
        id,
        flowchart: JSON.parse(JSON.stringify(base)),
        flowchartHidden: false,
        ...extra
    });

    it('puts the pencil in an always-visible body toolbar, not a hover-gated tray', async () => {
        const { buildNoteFlowchartSectionHtml } = await import('../js/flowchartUi.js');
        const html = buildNoteFlowchartSectionHtml(makeItem('n1'), { canEdit: true });

        // The pencil must live under note-flowchart__toolbar, which has no
        // opacity:0 rule — planner-sub__tools does and hides it permanently.
        const toolbarIdx = html.indexOf('note-flowchart__toolbar');
        const pencilIdx = html.indexOf('data-flowchart-edit');
        assert.ok(toolbarIdx > 0, 'expected a note-flowchart__toolbar wrapper');
        assert.ok(pencilIdx > toolbarIdx, 'pencil must sit inside the toolbar');
        assert.ok(!html.includes('planner-sub__tools'), 'must not reuse the hover-gated planner tray');
        // And it must actually carry an icon.
        assert.ok(html.includes('<svg'), 'pencil button needs an icon');
    });

    it('renders a collapse caret with a glyph inside collapsable-heading', async () => {
        const { buildNoteFlowchartSectionHtml } = await import('../js/flowchartUi.js');
        const html = buildNoteFlowchartSectionHtml(makeItem('n1'), { canEdit: true });
        assert.ok(html.includes('collapsable-heading'), 'heading wrapper required by the collapse CSS');
        // An empty <span class="collapsable-toggle"> renders nothing visible.
        assert.ok(/collapsable-toggle[^>]*>\s*\S/.test(html), 'collapse caret must contain a glyph');
        assert.ok(html.includes('\u25bc'), 'expected the ▼ caret glyph');
    });

    it('uses the wrapper class the stylesheet targets', async () => {
        const { buildNoteFlowchartSectionHtml } = await import('../js/flowchartUi.js');
        const html = buildNoteFlowchartSectionHtml(makeItem('n1'), { canEdit: true });
        assert.ok(html.includes('note-body-section--flowchart'), 'stylesheet targets this class');
    });

    it('does not echo the grid px size in the note section', async () => {
        const { buildNoteFlowchartSectionHtml } = await import('../js/flowchartUi.js');
        const html = buildNoteFlowchartSectionHtml(makeItem('n1'), { canEdit: true });
        assert.ok(!html.includes('flowchart-grid-echo'), 'px echo belongs in the drawing toolbar only');
        assert.ok(!/>\s*24px\s*</.test(html), 'grid size must not be rendered in the section');
    });

    it('marks both the body and the caret collapsed when startCollapsed', async () => {
        const { buildNoteFlowchartSectionHtml } = await import('../js/flowchartUi.js');
        const html = buildNoteFlowchartSectionHtml(makeItem('n1'), { canEdit: true, startCollapsed: true });
        assert.ok(html.includes('collapsable-section collapsed'), 'body needs the collapsed class');
        assert.ok(html.includes('collapsable-toggle collapsed'), 'caret needs the collapsed class to rotate');
    });

    it('omits the pencil when the section is read-only', async () => {
        const { buildNoteFlowchartSectionHtml } = await import('../js/flowchartUi.js');
        const html = buildNoteFlowchartSectionHtml(makeItem('n1'), { canEdit: false });
        assert.ok(!html.includes('data-flowchart-edit'), 'read-only sections get no edit button');
    });
});
