// test/drawingBoardInput.test.js
// The pointer/keyboard layer moved out of js/drawingBoard.js into
// js/drawingBoard/input.js and now takes the board as an explicit argument, so
// press routing can be exercised against a stub board instead of a live DOM.
//
// These guards pin the ordering rules the monolith had baked in: a press must
// capture the pointer before anything else, an in-flight resize outranks the
// stroke commit, and a gesture that never moved must not push a history entry.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleKeydown, onPointerDown, onPointerUp } from '../js/drawingBoard/input.js';
import { CanvasViewport } from '../js/canvasViewport.js';

function withDocument(activeElement, fn) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
    const previous = globalThis.document;
    globalThis.document = { activeElement };
    try {
        return fn();
    } finally {
        if (had) globalThis.document = previous;
        else delete globalThis.document;
    }
}

function withViewport(patch, fn) {
    const saved = {};
    for (const key of Object.keys(patch)) {
        saved[key] = CanvasViewport[key];
        CanvasViewport[key] = patch[key];
    }
    try {
        return fn();
    } finally {
        Object.assign(CanvasViewport, saved);
    }
}

function makeBoard(overrides = {}) {
    const calls = {
        clientToCanvas: 0, capture: [], release: [], pushLayerHistory: 0,
        eraseAt: [], placeTextBox: [], redraw: 0, requestRedraw: 0,
        setStrokes: [], scheduleSave: 0, undo: 0, redo: 0,
        finishResize: 0, endBoxSelect: 0, finishLassoDrag: 0
    };
    let strokes = overrides.strokes ?? [];
    const board = {
        active: true,
        activeTool: 'brush',
        activeStyle: 'pen',
        selectedStrokes: new Set(),
        isLassoActive: false,
        isFlowchartMode: false,
        draftStroke: null,
        shapePreview: null,
        resizeHandle: null,
        isBoxSelecting: false,
        isDraggingLasso: false,
        penPointerActive: false,
        canvas: {
            setPointerCapture: (id) => calls.capture.push(id),
            releasePointerCapture: (id) => calls.release.push(id)
        },
        clientToCanvas: () => { calls.clientToCanvas += 1; return { x: 10, y: 20 }; },
        expandInfiniteIfNeeded: () => {},
        currentBrush: () => ({ color: '#abcdef', width: 4 }),
        pushLayerHistory: () => { calls.pushLayerHistory += 1; },
        eraseAt: (x, y) => calls.eraseAt.push([x, y]),
        placeTextBox: (x, y) => calls.placeTextBox.push([x, y]),
        redraw: () => { calls.redraw += 1; },
        requestRedraw: () => { calls.requestRedraw += 1; },
        strokes: () => strokes,
        setStrokes: (next) => { calls.setStrokes.push(next); strokes = next; },
        scheduleSave: () => { calls.scheduleSave += 1; },
        undo: () => { calls.undo += 1; },
        redo: () => { calls.redo += 1; },
        finishResize: () => { calls.finishResize += 1; },
        endBoxSelect: () => { calls.endBoxSelect += 1; },
        finishLassoDrag: () => { calls.finishLassoDrag += 1; },
        revertCropGesture: () => false,
        clearCropSession: () => false,
        isFlowConnector: () => false,
        isFlowShape: () => false,
        hitResizeHandle: () => null,
        beginBoxSelect: () => {},
        flowSnapPoint: (x, y) => ({ x, y }),
        ...overrides
    };
    return { board, calls };
}

function pointerEvent(overrides = {}) {
    return {
        button: 0,
        clientX: 5,
        clientY: 6,
        pointerId: 7,
        pointerType: 'mouse',
        pressure: 0.5,
        tiltX: 0,
        tiltY: 0,
        shiftKey: false,
        ...overrides
    };
}

describe('onPointerDown', () => {
    it('ignores presses while the board is inactive or on a non-primary button', () => {
        const { board, calls } = makeBoard({ active: false });
        onPointerDown(board, pointerEvent());
        assert.equal(calls.clientToCanvas, 0);
        assert.deepEqual(calls.capture, []);

        const live = makeBoard();
        onPointerDown(live.board, pointerEvent({ button: 2 }));
        assert.equal(live.calls.clientToCanvas, 0);
        assert.deepEqual(live.calls.capture, []);
    });

    it('yields to viewport panning', () => {
        withViewport({ panning: true }, () => {
            const { board, calls } = makeBoard();
            onPointerDown(board, pointerEvent());
            assert.equal(calls.clientToCanvas, 0);
            assert.deepEqual(calls.capture, []);
        });
    });

    it('captures the pointer before routing the press', () => {
        const { board, calls } = makeBoard();
        onPointerDown(board, pointerEvent({ pointerId: 42 }));
        assert.deepEqual(calls.capture, [42]);
    });

    it('seeds a draft stroke with the canvas-space point and the brush payload', () => {
        const { board, calls } = makeBoard();
        onPointerDown(board, pointerEvent({ pressure: 0.4 }));

        assert.equal(calls.pushLayerHistory, 1);
        assert.ok(board.draftStroke, 'a brush press must open a draft stroke');
        assert.equal(board.draftStroke.tool, 'brush');
        assert.equal(board.draftStroke.style, 'pen');
        assert.equal(board.draftStroke.color, '#abcdef');
        assert.equal(board.draftStroke.width, 4);
        assert.deepEqual(board.draftStroke.points, [{ x: 10, y: 20, p: 0.4, tiltX: 0, tiltY: 0 }]);
    });

    it('erases on press for the eraser tool without opening a draft stroke', () => {
        const { board, calls } = makeBoard({ activeTool: 'eraser' });
        onPointerDown(board, pointerEvent());

        assert.deepEqual(calls.eraseAt, [[10, 20]]);
        assert.equal(calls.redraw, 1);
        assert.equal(board.draftStroke, null);
        assert.equal(board.eraseHistoryPushed, false);
    });

    it('places a text box for the text tool', () => {
        const { board, calls } = makeBoard({ activeTool: 'text' });
        onPointerDown(board, pointerEvent());
        assert.deepEqual(calls.placeTextBox, [[10, 20]]);
    });

    it('lets the pen take the pointer and ignores touch while it is down', () => {
        const { board } = makeBoard();
        onPointerDown(board, pointerEvent({ pointerType: 'pen' }));
        assert.equal(board.penPointerActive, true);

        const touch = makeBoard({ penPointerActive: true });
        onPointerDown(touch.board, pointerEvent({ pointerType: 'touch' }));
        assert.equal(touch.calls.clientToCanvas, 0, 'a palm touch must not move the stroke');
    });
});

describe('onPointerUp', () => {
    it('commits a draft stroke through the document and clears it', () => {
        const { board, calls } = makeBoard();
        board.draftStroke = {
            tool: 'brush',
            style: 'pen',
            points: [{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 40, y: 40 }]
        };

        onPointerUp(board, pointerEvent());

        assert.equal(calls.setStrokes.length, 1);
        assert.equal(calls.setStrokes[0][0].tool, 'brush');
        assert.equal(calls.scheduleSave, 1);
        assert.equal(board.draftStroke, null);
        assert.equal(calls.redraw, 1);
        assert.deepEqual(calls.release, [7]);
    });

    it('keeps a shape that was dragged but drops one that was only clicked', () => {
        const dragged = makeBoard();
        dragged.board.shapePreview = { tool: 'line', x0: 0, y0: 0, x1: 30, y1: 40 };
        onPointerUp(dragged.board, pointerEvent());
        assert.equal(dragged.calls.pushLayerHistory, 1);
        assert.equal(dragged.calls.setStrokes[0][0].tool, 'line');
        assert.equal(dragged.board.shapePreview, null);

        const clicked = makeBoard();
        clicked.board.shapePreview = { tool: 'line', x0: 0, y0: 0, x1: 1, y1: 1 };
        onPointerUp(clicked.board, pointerEvent());
        assert.equal(clicked.calls.pushLayerHistory, 0);
        assert.deepEqual(clicked.calls.setStrokes, []);
        assert.equal(clicked.board.shapePreview, null);
    });

    it('finishes an in-flight resize before looking at strokes', () => {
        const { board, calls } = makeBoard();
        board.resizeHandle = 'se';
        board.draftStroke = { points: [{ x: 1, y: 1 }] };

        onPointerUp(board, pointerEvent());

        assert.equal(calls.finishResize, 1);
        assert.deepEqual(calls.setStrokes, []);
        assert.equal(calls.redraw, 1);
    });

    it('finishes a marquee selection and a lasso drag', () => {
        const marquee = makeBoard();
        marquee.board.isBoxSelecting = true;
        onPointerUp(marquee.board, pointerEvent());
        assert.equal(marquee.calls.endBoxSelect, 1);

        const lasso = makeBoard();
        lasso.board.isDraggingLasso = true;
        onPointerUp(lasso.board, pointerEvent());
        assert.equal(lasso.calls.finishLassoDrag, 1);
    });

    it('survives a pointer capture the browser already dropped', () => {
        const { board } = makeBoard({
            canvas: {
                setPointerCapture: () => {},
                releasePointerCapture: () => { throw new Error('no capture'); }
            }
        });
        assert.doesNotThrow(() => onPointerUp(board, pointerEvent()));
    });

    it('clears the pen flag on pen-up', () => {
        const { board } = makeBoard({ penPointerActive: true });
        onPointerUp(board, pointerEvent({ pointerType: 'pen' }));
        assert.equal(board.penPointerActive, false);
    });
});

describe('handleKeydown', () => {
    it('returns false while the board is inactive or the chord is already claimed', () => {
        withDocument(null, () => {
            const { board, calls } = makeBoard({ active: false });
            assert.equal(handleKeydown(board, { key: 'z', ctrlKey: true }), false);
            assert.equal(calls.undo, 0);

            const live = makeBoard();
            assert.equal(handleKeydown(live.board, { key: 'z', ctrlKey: true, defaultPrevented: true }), false);
            assert.equal(live.calls.undo, 0);
        });
    });

    it('maps Ctrl+Z / Ctrl+Shift+Z onto the board history', () => {
        withDocument(null, () => {
            const { board, calls } = makeBoard();
            let prevented = 0;
            const ev = { key: 'z', ctrlKey: true, preventDefault: () => { prevented += 1; } };

            assert.equal(handleKeydown(board, ev), true);
            assert.equal(calls.undo, 1);
            assert.equal(prevented, 1);

            assert.equal(handleKeydown(board, {
                key: 'z', ctrlKey: true, shiftKey: true, preventDefault: () => {}
            }), true);
            assert.equal(calls.redo, 1);
        });
    });

    it('leaves history alone while a text field has focus', () => {
        withDocument({ tagName: 'INPUT' }, () => {
            const { board, calls } = makeBoard();
            assert.equal(handleKeydown(board, { key: 'z', ctrlKey: true }), false);
            assert.equal(calls.undo, 0);
        });
    });

    it('clears the selection on the first Escape and leaves marquee mode on the second', () => {
        withDocument(null, () => {
            const { board, calls } = makeBoard();
            board.selectedStrokes.add({ id: 's1' });
            board.isLassoActive = true;

            assert.equal(handleKeydown(board, { key: 'Escape' }), true);
            assert.equal(board.selectedStrokes.size, 0);
            assert.equal(board.isLassoActive, true, 'selection clears before marquee mode ends');
            assert.equal(calls.redraw, 1);

            let cleared = 0;
            board.clearLassoSelection = () => { cleared += 1; };
            assert.equal(handleKeydown(board, { key: 'Escape' }), true);
            assert.equal(cleared, 1);
        });
    });

    it('ignores unrelated keys', () => {
        withDocument(null, () => {
            const { board } = makeBoard();
            assert.equal(handleKeydown(board, { key: 'q' }), false);
        });
    });
});


