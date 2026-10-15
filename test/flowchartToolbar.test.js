// test/flowchartToolbar.test.js
// Guards for the flowchart toolbar row: connector stroke color/width, label color,
// and the snap/grid controls.
//
// These are pure string builders (no DOM) so they can be exercised headlessly,
// but the markup is what the user clicks — a missing id or a typo here is a dead
// button with no console error to point at it.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DrawingBoard } from '../js/drawingBoard.js';

/** Build a board with a flowchartItem stub; flowchartToolbarRowHtml only reads
 *  flowchartGrid / flowchartColor / flowchartWidth / flowLabelFontSize / activeTool. */
function makeBoard(overrides = {}) {
    const board = Object.create(DrawingBoard);
    board.activeTool = overrides.activeTool || 'pointer';
    board.flowchartRouting = overrides.routing || 'elbow';
    board.flowLabelTarget = null;
    board.flowchartItem = {
        flowchart: {
            grid: { type: 'dots', size: 24, snap: true, visible: true },
            flowchartColor: overrides.color || '#ff0000',
            flowchartWidth: overrides.width || 4
        }
    };
    board.selectedStrokes = { set: new Set(), clear() {}, add(v) { this.set.add(v); }, size: 0 };
    return board;
}

describe('flowchartToolbarRowHtml', () => {
    it('renders the connector color chip with the diagram color', () => {
        const board = makeBoard({ color: '#ff0000' });
        const html = DrawingBoard.flowchartToolbarRowHtml.call(board);
        const chip = html.match(/id="draw-flow-connector-color"[^>]*style="--chip-color:([^"]+)"/);
        assert.ok(chip, 'connector color chip must be present');
        assert.strictEqual(chip[1], '#ff0000', 'chip must carry the diagram color');
    });

    it('renders the connector width readout with the diagram width', () => {
        const board = makeBoard({ width: 6 });
        const html = DrawingBoard.flowchartToolbarRowHtml.call(board);
        assert.ok(html.includes('id="draw-flow-connector-width"'), 'width readout must be present');
        assert.ok(html.includes('>6px<'), 'readout must show the diagram width');
    });

    it('renders the - / + width buttons either side of the readout', () => {
        const board = makeBoard();
        const html = DrawingBoard.flowchartToolbarRowHtml.call(board);
        assert.ok(html.includes('id="draw-flow-connector-smaller"'), 'smaller button must be present');
        assert.ok(html.includes('id="draw-flow-connector-larger"'), 'larger button must be present');
    });

    it('renders a label color chip next to the text controls', () => {
        const board = makeBoard();
        const html = DrawingBoard.flowchartToolbarRowHtml.call(board);
        assert.ok(html.includes('id="draw-flow-label-color"'), 'label color chip must be present');
        assert.ok(html.includes('id="draw-flow-label-edit"'), 'label text button must be present');
        // Chip comes between the text button and the size stepper.
        const textIdx = html.indexOf('id="draw-flow-label-edit"');
        const colorIdx = html.indexOf('id="draw-flow-label-color"');
        const sizeIdx = html.indexOf('id="draw-flow-label-size"');
        assert.ok(textIdx < colorIdx && colorIdx < sizeIdx,
            'label color must sit between the text button and the size readout');
    });

    it('renders the snap toggle and grid density stepper', () => {
        const board = makeBoard();
        const html = DrawingBoard.flowchartToolbarRowHtml.call(board);
        assert.ok(html.includes('id="draw-flow-snap"'), 'snap toggle must be present');
        assert.ok(html.includes('id="draw-flow-grid-minus"'), 'grid minus must be present');
        assert.ok(html.includes('id="draw-flow-grid-plus"'), 'grid plus must be present');
        assert.ok(html.includes('>24px<'), 'grid size readout must show 24px');
        assert.ok(html.includes('data-flow-tool="connector"'), 'connector tool button must be present');
    });

    it('highlights the connector tool when it is active', () => {
        const board = makeBoard({ activeTool: 'connector' });
        const html = DrawingBoard.flowchartToolbarRowHtml.call(board);
        // class precedes data-flow-tool in the markup.
        const match = html.match(/class="([^"]+)" data-flow-tool="connector"/);
        assert.ok(match, 'connector button markup must be present');
        assert.ok(match[1].includes('active'), 'connector button must be active when selected');
    });

    it('marks the elbow routing button active when routing is elbow', () => {
        const board = makeBoard({ routing: 'elbow' });
        const html = DrawingBoard.flowchartToolbarRowHtml.call(board);
        // class precedes id in the markup.
        const match = html.match(/class="([^"]+)" id="draw-flow-routing"/);
        assert.ok(match, 'routing button markup must be present');
        assert.ok(match[1].includes('active'), 'elbow button must be active');
        assert.ok(html.includes('aria-pressed="true"'), 'elbow must report pressed=true');
    });

    it('marks the snap toggle active when snap is on', () => {
        const board = makeBoard();
        const html = DrawingBoard.flowchartToolbarRowHtml.call(board);
        // class precedes id in the markup.
        const match = html.match(/class="([^"]+)" id="draw-flow-snap"/);
        assert.ok(match, 'snap button markup must be present');
        assert.ok(match[1].includes('active'), 'snap must be active by default');
    });
});

/**
 * renderFlowchartOverlay draws port dots whenever the connector tool is
 * selected — not only while a drag is in flight. Guard against the slop of
 * keying the highlight off a selected connector object instead.
 */
describe('renderFlowchartOverlay port highlights', () => {
    function makeBoard({ activeTool = 'pointer', flowConnect = null, shapes = [] } = {}) {
        const board = Object.create(DrawingBoard);
        board.isFlowchartMode = true;
        board.activeTool = activeTool;
        board.flowConnect = flowConnect;
        board.flowchartItem = {
            flowchart: {
                grid: { type: 'dots', size: 24, snap: true, visible: true },
                flowchartColor: '#f8fafc',
                flowchartWidth: 3
            }
        };
        // Stub strokes() so flowchartShapes() returns the given shapes.
        board.strokes = () => shapes;
        // Minimal 2D context: record beginPath/arc/fill/stroke calls.
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
        board._calls = calls;
        return board;
    }

    it('does nothing when not in flowchart mode', () => {
        const board = makeBoard();
        board.isFlowchartMode = false;
        assert.doesNotThrow(() => DrawingBoard.renderFlowchartOverlay.call(board));
        assert.equal(board._calls.length, 0);
    });

    it('does nothing when the connector tool is not active and no drag is in flight', () => {
        const board = makeBoard({ activeTool: 'rect', shapes: [{ id: 's1', flowchartKind: 'shape', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 100 }] });
        DrawingBoard.renderFlowchartOverlay.call(board);
        // The early-return guard still does save()/restore() — what must NOT
        // happen is any arc (port dot) or path (rubber band) being painted.
        assert.equal(board._calls.length, 2, 'only the save()/restore() guard should run');
        assert.equal(board._calls.filter((c) => c === 'arc').length, 0, 'no port dots for a plain shape tool');
        assert.equal(board._calls.filter((c) => c === 'dash').length, 0, 'no rubber band for a plain shape tool');
    });

    it('paints a port dot on every shape when the connector tool is selected', () => {
        const shapes = [
            { id: 's1', flowchartKind: 'shape', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 100 },
            { id: 's2', flowchartKind: 'shape', tool: 'diamond', x0: 200, y0: 0, x1: 300, y1: 100 }
        ];
        const board = makeBoard({ activeTool: 'connector', shapes });
        DrawingBoard.renderFlowchartOverlay.call(board);
        // 4 ports per shape x 2 shapes = 8 arcs (beginPath+arc+fill+stroke each).
        const arcs = board._calls.filter((c) => c === 'arc');
        assert.equal(arcs.length, 8, 'every port on every shape must be highlighted');
    });

    it('does not paint when the connector tool is selected but there are no shapes', () => {
        const board = makeBoard({ activeTool: 'connector', shapes: [] });
        DrawingBoard.renderFlowchartOverlay.call(board);
        assert.equal(board._calls.length, 0, 'no shapes -> nothing to highlight');
    });

    it('still paints the live rubber band when a drag is in flight', () => {
        const shapes = [{ id: 's1', flowchartKind: 'shape', tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 100 }];
        const board = makeBoard({
            activeTool: 'connector',
            flowConnect: { x: 50, y: 50, from: null, hover: null, fromPt: { x: 50, y: 50 } },
            shapes
        });
        DrawingBoard.renderFlowchartOverlay.call(board);
        // Ports on the 3 remaining shapes (s1 skipped as the anchor) + the rubber band.
        const arcs = board._calls.filter((c) => c === 'arc');
        assert.ok(arcs.length >= 4, 'drag overlay must still paint ports');
        assert.ok(board._calls.includes('dash'), 'rubber band must be dashed');
    });
});
