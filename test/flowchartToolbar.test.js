// test/flowchartToolbar.test.js
// Guards for the always-on diagram controls in the magicCanvas toolbar: the
// connector tool + routing toggle (row 1) and the shared grid stepper (meta row).
//
// These are pure string builders (no DOM), so they can be exercised headlessly,
// but the markup is what the user clicks — a missing id or a typo here is a dead
// button with no console error to point at it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    flowDiagramRowHtml,
    flowGridControlsHtml,
    stepCanvasGrid
} from '../js/drawingBoardToolbar.js';
import { canvasGrid, renderFlowchartOverlay } from '../js/drawingBoardFlowchart.js';
import { FLOWCHART_GRID_STEPS } from '../js/flowchart.js';

/** Board stub with the shared prefs the string builders read. */
function makeBoard(overrides = {}) {
    const board = {
        activeTool: overrides.activeTool || 'pointer',
        prefs: {
            grid: { size: overrides.gridSize ?? 24, snap: overrides.snap !== false },
            routing: overrides.routing || 'elbow'
        }
    };
    board.canvasGrid = function () { return canvasGrid(this); };
    return board;
}

describe('flowDiagramRowHtml', () => {
    it('renders the connector tool button, inactive unless the tool is armed', () => {
        const idle = flowDiagramRowHtml(makeBoard());
        assert.ok(idle.includes('id="draw-tool-connector"'), 'connector button must be present');
        assert.ok(idle.includes('data-flow-tool="connector"'), 'the binder matches on data-flow-tool');
        assert.ok(idle.includes('aria-pressed="false"'), 'not pressed until the tool is armed');

        const armed = flowDiagramRowHtml(makeBoard({ activeTool: 'connector' }));
        assert.ok(armed.includes('aria-pressed="true"'));
        assert.ok(armed.includes('class="btn btn--compact btn--icon active" data-flow-tool="connector"'));
    });

    it('renders a routing toggle that reflects the stored pref', () => {
        const elbow = flowDiagramRowHtml(makeBoard({ routing: 'elbow' }));
        assert.ok(elbow.includes('id="draw-flow-routing"'));
        assert.ok(elbow.includes('aria-pressed="true"'), 'elbow is the pressed state');
        assert.ok(elbow.includes('Connector routing: elbow'));

        const straight = flowDiagramRowHtml(makeBoard({ routing: 'straight' }));
        assert.ok(straight.includes('id="draw-flow-routing"'), 'the toggle is always rendered');
        assert.ok(straight.includes('aria-pressed="false"'));
        assert.ok(straight.includes('Connector routing: straight'));
    });

    it('falls back to straight routing for an unknown pref', () => {
        assert.ok(flowDiagramRowHtml(makeBoard({ routing: 'zigzag' })).includes('Connector routing: straight'));
    });
});

describe('flowGridControlsHtml', () => {
    it('renders the snap toggle with the shared snap pref', () => {
        const on = flowGridControlsHtml(makeBoard({ snap: true }));
        assert.ok(on.includes('id="draw-flow-snap"'));
        assert.ok(on.includes('aria-pressed="true"'));

        const off = flowGridControlsHtml(makeBoard({ snap: false }));
        assert.ok(off.includes('id="draw-flow-snap"'), 'the toggle stays rendered when snap is off');
        assert.ok(off.includes('aria-pressed="false"'));
    });

    it('treats a missing snap pref as off (strict true)', () => {
        const board = makeBoard();
        delete board.prefs.grid.snap;
        assert.ok(flowGridControlsHtml(board).includes('aria-pressed="false"'));
    });

    it('renders the grid size readout and its stepper buttons', () => {
        const html = flowGridControlsHtml(makeBoard({ gridSize: 16 }));
        assert.ok(html.includes('id="draw-flow-grid-size"'), 'readout must be present');
        assert.ok(html.includes('>16px<'), 'readout must show the grid size');
        assert.ok(html.includes('id="draw-flow-grid-minus"'), 'coarser button must be present');
        assert.ok(html.includes('id="draw-flow-grid-plus"'), 'finer button must be present');
    });
});

describe('stepCanvasGrid', () => {
    /** Board stub that records the persisted patch and the toolbar repaint. */
    function gridBoard(size) {
        const board = makeBoard({ gridSize: size });
        board.persisted = [];
        board.renders = 0;
        board.persistCanvasGrid = function (patch) { this.persisted.push(patch); };
        board.renderToolbar = function () { this.renders += 1; };
        return board;
    }

    it('walks the step list in both directions', () => {
        const up = gridBoard(24);
        stepCanvasGrid(up, 1);
        assert.deepEqual(up.persisted, [{ size: 32 }]);

        const down = gridBoard(24);
        stepCanvasGrid(down, -1);
        assert.deepEqual(down.persisted, [{ size: 16 }]);
    });

    it('clamps at both ends instead of wrapping', () => {
        const top = gridBoard(FLOWCHART_GRID_STEPS[FLOWCHART_GRID_STEPS.length - 1]);
        stepCanvasGrid(top, 1);
        assert.deepEqual(top.persisted, [], 'stepping past the finest size is a no-op');
        assert.equal(top.renders, 0);

        const bottom = gridBoard(FLOWCHART_GRID_STEPS[0]);
        stepCanvasGrid(bottom, -1);
        assert.deepEqual(bottom.persisted, [], 'stepping past the coarsest size is a no-op');
    });

    it('snaps an off-grid size onto the nearest step before stepping', () => {
        const board = gridBoard(15); // between 12 and 16 -> nearest 16
        stepCanvasGrid(board, 1);
        assert.deepEqual(board.persisted, [{ size: 24 }]);
    });

    it('repaints the toolbar so the readout follows the new size', () => {
        const board = gridBoard(12);
        stepCanvasGrid(board, 1);
        assert.equal(board.renders, 1);
        assert.deepEqual(board.persisted, [{ size: 16 }]);
    });
});

describe('renderFlowchartOverlay', () => {
    /** Minimal 2D context: records the draw calls the overlay makes. */
    function overlayBoard(overrides = {}) {
        const board = makeBoard(overrides);
        board.strokes = () => overrides.shapes || [];
        board.flowchartShapes = function () { return this.strokes().filter((s) => s && s.flowchartKind === 'shape'); };
        board.flowConnect = overrides.flowConnect || null;
        board.currentBrush = () => ({ color: '#abcdef', width: 4 });
        board.getSelectedStrokesArray = () => overrides.selection || [];
        const calls = [];
        board.ctx = {
            save() { calls.push('save'); },
            restore() { calls.push('restore'); },
            lineWidth: 0,
            setLineDash() { calls.push('dash'); },
            beginPath() { calls.push('beginPath'); },
            moveTo() { calls.push('moveTo'); },
            lineTo() { calls.push('lineTo'); },
            arc() { calls.push('arc'); },
            fill() { calls.push('fill'); },
            stroke() { calls.push('stroke'); },
            set strokeStyle(v) { calls.push('strokeStyle=' + v); },
            set fillStyle(v) { calls.push('fillStyle=' + v); }
        };
        board.calls = calls;
        return board;
    }

    const rect = (id, tool, x0, y0, x1, y1) => ({ id, flowchartKind: 'shape', tool, x0, y0, x1, y1 });

    it('paints nothing when the page has no shapes', () => {
        const board = overlayBoard({ activeTool: 'connector', shapes: [] });
        renderFlowchartOverlay(board);
        assert.equal(board.calls.length, 0, 'no shapes -> nothing to highlight');
    });

    it('paints no ports for a plain shape tool', () => {
        const board = overlayBoard({ activeTool: 'rect', shapes: [rect('s1', 'rect', 0, 0, 100, 100)] });
        renderFlowchartOverlay(board);
        assert.equal(board.calls.filter((c) => c === 'arc').length, 0, 'port dots are connector-tool chrome');
        assert.equal(board.calls.filter((c) => c === 'dash').length, 0, 'no rubber band');
    });

    it('paints a port dot on every shape when the connector tool is armed', () => {
        const board = overlayBoard({
            activeTool: 'connector',
            shapes: [rect('s1', 'rect', 0, 0, 100, 100), rect('s2', 'diamond', 200, 0, 300, 100)]
        });
        renderFlowchartOverlay(board);
        // 4 ports per shape x 2 shapes = 8 arcs.
        assert.equal(board.calls.filter((c) => c === 'arc').length, 8,
            'every port on every shape must be highlighted');
    });

    it('paints candidate ports and a dashed rubber band during a drag', () => {
        const board = overlayBoard({
            activeTool: 'connector',
            flowConnect: { x: 50, y: 50, from: null, hover: null, fromPt: { x: 50, y: 50 } },
            shapes: [rect('s1', 'rect', 0, 0, 100, 100)]
        });
        renderFlowchartOverlay(board);
        assert.ok(board.calls.filter((c) => c === 'arc').length >= 4, 'drag overlay must paint ports');
        assert.ok(board.calls.includes('dash'), 'rubber band must be dashed');
    });

    it('routes the rubber band through the bend when an elbow target is hovered', () => {
        const board = overlayBoard({
            activeTool: 'connector',
            routing: 'elbow',
            flowConnect: {
                x: 200, y: 150,
                from: { shapeId: 's1', port: 'e' },
                fromPt: { x: 100, y: 150 },
                hover: { shapeId: 's2', port: 'w', x: 200, y: 150 }
            },
            shapes: [rect('s2', 'rect', 200, 100, 300, 200)]
        });
        renderFlowchartOverlay(board);
        // Anchor -> bend -> target: two segments instead of one straight line.
        assert.equal(board.calls.filter((c) => c === 'lineTo').length, 2);
    });

    it('draws no rubber band when no drag is in flight', () => {
        const board = overlayBoard({
            activeTool: 'connector',
            flowConnect: null,
            shapes: [rect('s1', 'rect', 0, 0, 100, 100)]
        });
        renderFlowchartOverlay(board);
        assert.equal(board.calls.filter((c) => c === 'dash').length, 0);
        assert.equal(board.calls.filter((c) => c === 'lineTo').length, 0);
    });
});
