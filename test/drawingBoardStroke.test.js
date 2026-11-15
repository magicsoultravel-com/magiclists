// test/drawingBoardStroke.test.js
// The colour chip has three jobs that must agree: the stored stroke pref
// (prefs.js), the selection restyler (drawingBoard/stroke.js) and the painters
// in canvasBrushes.js. A border that changes in the pref but not on the canvas —
// or the reverse — reads as a dead picker, so each link is pinned here.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PREFS_KEY } from '../js/drawingBoard/prefs.js';
import {
    applyStrokeColor,
    currentStrokeColor,
    isBorderTarget,
    setStrokeColor,
    strokeColor,
    strokeTargets
} from '../js/drawingBoard/stroke.js';
import { DRAG_SHAPE_TOOLS, drawBrushStroke, drawShapeStroke } from '../js/canvasBrushes.js';
import { colorChipValue, renderToolbar } from '../js/drawingBoardToolbar.js';

function withStorage(fn) {
    const store = new Map();
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const previous = globalThis.localStorage;
    globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value))
    };
    try {
        return fn(store);
    } finally {
        if (had) globalThis.localStorage = previous;
        else delete globalThis.localStorage;
    }
}

/** Board stub exposing only what stroke.js touches. */
function makeBoard({ selection = [], color = '#f8fafc', activeStyle = 'pen', styles } = {}) {
    const calls = {
        pushLayerHistory: 0, scheduleSave: 0, requestRedraw: 0, renderToolbar: 0, chips: []
    };
    const board = {
        prefs: { styles: styles || { pen: { width: 4, color } } },
        activeStyle,
        selectedStrokes: new Set(selection),
        pushLayerHistory: () => { calls.pushLayerHistory += 1; },
        scheduleSave: () => { calls.scheduleSave += 1; },
        requestRedraw: () => { calls.requestRedraw += 1; },
        renderToolbar: () => { calls.renderToolbar += 1; },
        updateColorChip: (value) => calls.chips.push(value)
    };
    board.getSelectedStrokesArray = () => Array.from(board.selectedStrokes);
    return { board, calls };
}

/** Recording 2D context: enough for drawShapeStroke and drawBrushStroke. */
function recordingCtx() {
    const ops = [];
    const stack = [];
    const ctx = {
        strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1,
        lineCap: 'butt', lineJoin: 'miter', font: '', textAlign: 'start', textBaseline: 'alphabetic',
        save() {
            stack.push({ fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, globalAlpha: this.globalAlpha });
            ops.push(['save']);
        },
        restore() {
            const prev = stack.pop();
            if (prev) {
                this.fillStyle = prev.fillStyle;
                this.strokeStyle = prev.strokeStyle;
                this.globalAlpha = prev.globalAlpha;
            }
            ops.push(['restore']);
        },
        beginPath() { ops.push(['beginPath']); },
        moveTo(x, y) { ops.push(['moveTo', x, y]); },
        lineTo(x, y) { ops.push(['lineTo', x, y]); },
        closePath() { ops.push(['closePath']); },
        arc(x, y, r) { ops.push(['arc', this.fillStyle, x, y, r]); },
        stroke() { ops.push(['stroke', this.strokeStyle]); },
        fill() { ops.push(['fill', this.fillStyle]); },
        fillRect(x, y, w, h) { ops.push(['fillRect', this.fillStyle, x, y, w, h]); },
        strokeRect(x, y, w, h) { ops.push(['strokeRect', this.strokeStyle, x, y, w, h]); },
        rect(x, y, w, h) { ops.push(['rect', x, y, w, h]); },
        roundRect(x, y, w, h, r) { ops.push(['roundRect', x, y, w, h, r]); },
        ellipse(...args) { ops.push(['ellipse', ...args]); },
        fillText() {},
        measureText: (text) => ({ width: String(text).length * 8 })
    };
    return { ops, ctx };
}

function shape(overrides = {}) {
    return {
        id: 's1', tool: 'rect', style: 'pen', color: '#111111', width: 4,
        x0: 10, y0: 20, x1: 60, y1: 80,
        ...overrides
    };
}

function freehand(overrides = {}) {
    return {
        id: 'b1', tool: 'brush', style: 'pen', color: '#111111', width: 4,
        points: [{ x: 0, y: 0, p: 0.5 }, { x: 10, y: 0, p: 0.5 }],
        ...overrides
    };
}

describe('isBorderTarget', () => {
    it('accepts every drag shape, including the open ones', () => {
        for (const tool of DRAG_SHAPE_TOOLS) {
            assert.equal(isBorderTarget({ tool }), true, `${tool} is painted with stroke.color`);
        }
        for (const open of ['line', 'arrow', 'connector']) {
            assert.equal(isBorderTarget({ tool: open }), true, `${open} has a border too`);
        }
    });

    it('accepts a freehand stroke', () => {
        assert.equal(isBorderTarget(freehand()), true);
    });

    it('leaves text boxes, images and unknown items to their own controls', () => {
        assert.equal(isBorderTarget({ tool: 'text', color: '#fff' }), false, 'the text picker owns text colour');
        assert.equal(isBorderTarget({ tool: 'image' }), false, 'an image has no stroke to recolour');
        assert.equal(isBorderTarget({ tool: 'nope' }), false);
        assert.equal(isBorderTarget({}), false);
        assert.equal(isBorderTarget(null), false);
        assert.equal(isBorderTarget(undefined), false);
    });

    it('accepts a labelled shape: the border changes, the label does not', () => {
        const node = shape({ flowchartKind: 'shape', label: { text: 'Step', color: '#ffffff' } });
        assert.equal(isBorderTarget(node), true);
        applyStrokeColor(makeBoard({ selection: [node] }).board, '#ff0000');
        assert.equal(node.color, '#ff0000');
        assert.equal(node.label.color, '#ffffff', 'the text picker keeps the label colour');
    });
});

describe('strokeTargets', () => {
    it('filters a mixed selection down to border-bearing items', () => {
        const rect = shape();
        const stroke = freehand();
        const text = { id: 't1', tool: 'text', color: '#ffffff' };
        const image = { id: 'i1', tool: 'image' };
        const { board } = makeBoard({ selection: [rect, text, stroke, image] });
        assert.deepEqual(strokeTargets(board), [rect, stroke]);
    });

    it('reads the selection set when no helper is exposed', () => {
        const rect = shape();
        const board = { selectedStrokes: new Set([rect]) };
        assert.deepEqual(strokeTargets(board), [rect]);
    });

    it('is empty for no board and for an empty selection', () => {
        assert.deepEqual(strokeTargets(null), []);
        assert.deepEqual(strokeTargets(makeBoard().board), []);
    });
});

describe('applyStrokeColor', () => {
    it('recolours every selected border and returns the count', () => {
        const rect = shape();
        const stroke = freehand();
        const { board, calls } = makeBoard({ selection: [rect, stroke] });

        assert.equal(applyStrokeColor(board, '#ff0000'), 2);

        assert.equal(rect.color, '#ff0000');
        assert.equal(stroke.color, '#ff0000');
        assert.equal(calls.pushLayerHistory, 1, 'one undo entry for the whole batch');
        assert.equal(calls.scheduleSave, 1);
        assert.equal(calls.requestRedraw, 1);
    });

    it('treats the same colour in another case as a no-op', () => {
        const rect = shape({ color: '#FF0000' });
        const { board, calls } = makeBoard({ selection: [rect] });

        assert.equal(applyStrokeColor(board, '#ff0000'), 0);
        assert.equal(calls.pushLayerHistory, 0, 'an undo entry the user cannot see is a bug');
        assert.equal(calls.scheduleSave, 0);
    });

    it('only touches the targets that differ', () => {
        const already = shape({ id: 'a', color: '#ff0000' });
        const stale = shape({ id: 'b', color: '#111111' });
        const { board, calls } = makeBoard({ selection: [already, stale] });

        assert.equal(applyStrokeColor(board, '#ff0000'), 1);
        assert.equal(calls.pushLayerHistory, 1);
        assert.equal(stale.color, '#ff0000');
    });

    it('refuses an empty colour: there is no "no border" state', () => {
        const rect = shape();
        const { board, calls } = makeBoard({ selection: [rect] });

        assert.equal(applyStrokeColor(board, ''), 0);
        assert.equal(applyStrokeColor(board, '   '), 0);
        assert.equal(applyStrokeColor(board, null), 0);
        assert.equal(rect.color, '#111111', 'the outline stays visible');
        assert.equal(calls.pushLayerHistory, 0);
    });

    it('skips text boxes and images in a mixed selection', () => {
        const rect = shape();
        const text = { id: 't1', tool: 'text', color: '#ffffff' };
        const { board } = makeBoard({ selection: [rect, text] });

        assert.equal(applyStrokeColor(board, '#22c55e'), 1);
        assert.equal(rect.color, '#22c55e');
        assert.equal(text.color, '#ffffff');
    });
});

describe('setStrokeColor', () => {
    it('remembers the colour for future strokes and restyles the selection', () => {
        withStorage((store) => {
            const rect = shape();
            const { board, calls } = makeBoard({ selection: [rect] });

            assert.equal(setStrokeColor(board, '#22C55E'), 1);

            assert.equal(board.prefs.styles.pen.color, '#22C55E');
            assert.equal(JSON.parse(store.get(PREFS_KEY)).styles.pen.color, '#22C55E');
            assert.equal(rect.color, '#22C55E');
            assert.equal(calls.renderToolbar, 1);
            assert.equal(calls.chips.length, 0, 'a rerender rebuilds the chip, no patch needed');
        });
    });

    it('seeds the pref even when the selection already matches', () => {
        withStorage(() => {
            const rect = shape({ color: '#ff0000' });
            const { board, calls } = makeBoard({ selection: [rect] });

            assert.equal(setStrokeColor(board, '#ff0000'), 0, 'nothing to restyle');
            assert.equal(board.prefs.styles.pen.color, '#ff0000', 'the next stroke still inherits it');
            assert.equal(calls.pushLayerHistory, 0);
        });
    });

    it('patches the chip in place when a rerender is not wanted', () => {
        withStorage(() => {
            const { board, calls } = makeBoard();

            setStrokeColor(board, '#ff0000', { rerender: false });

            assert.deepEqual(calls.chips, ['#ff0000']);
            assert.equal(calls.renderToolbar, 0);
        });
    });

    it('never overwrites the pref with an empty colour', () => {
        withStorage((store) => {
            const rect = shape();
            const { board } = makeBoard({ selection: [rect] });

            setStrokeColor(board, '');

            assert.equal(board.prefs.styles.pen.color, '#f8fafc');
            assert.equal(store.has(PREFS_KEY), false, 'an empty pick is never persisted');
            assert.equal(rect.color, '#111111');
        });
    });

    it('survives a board without a style pref entry', () => {
        const rect = shape();
        const { board } = makeBoard({ selection: [rect], styles: {} });

        assert.equal(setStrokeColor(board, '#ff0000', { rerender: false }), 1);
        assert.equal(rect.color, '#ff0000');
    });
});

describe('strokeColor', () => {
    it('reads the active style colour', () => {
        const board = { activeStyle: 'pen', prefs: { styles: { pen: { color: '#abcdef' } } } };
        assert.equal(strokeColor(board), '#abcdef');
    });

    it('follows the active style, not always pen', () => {
        const board = {
            activeStyle: 'marker',
            prefs: { styles: { pen: { color: '#111111' }, marker: { color: '#222222' } } }
        };
        assert.equal(strokeColor(board), '#222222');
    });

    it('is empty when nothing is stored', () => {
        assert.equal(strokeColor(null), '');
        assert.equal(strokeColor({ prefs: {} }), '');
        assert.equal(strokeColor({ activeStyle: 'pen', prefs: { styles: {} } }), '');
    });
});

describe('currentStrokeColor', () => {
    it('shows the colour the whole selection agrees on', () => {
        const { board } = makeBoard({
            color: '#f8fafc',
            selection: [shape({ id: 'a', color: '#FF0000' }), shape({ id: 'b', color: '#ff0000' })]
        });
        assert.equal(currentStrokeColor(board), '#ff0000');
    });

    it('falls back to the pref for a mixed selection', () => {
        const { board } = makeBoard({
            color: '#f8fafc',
            selection: [shape({ id: 'a', color: '#ff0000' }), shape({ id: 'b', color: '#00ff00' })]
        });
        assert.equal(currentStrokeColor(board), '#f8fafc');
    });

    it('ignores items the chip cannot restyle', () => {
        const { board } = makeBoard({
            color: '#f8fafc',
            selection: [shape({ color: '#ff0000' }), { id: 't1', tool: 'text', color: '#00ff00' }]
        });
        assert.equal(currentStrokeColor(board), '#ff0000', 'the text box must not break agreement');
    });

    it('falls back to the pref when nothing is selected', () => {
        assert.equal(currentStrokeColor(makeBoard({ color: '#123456' }).board), '#123456');
    });
});

describe('colorChipValue', () => {
    it('prefers the board helper so the chip mirrors the selection', () => {
        const board = { currentStrokeColor: () => '#ff0000', currentBrush: () => ({ color: '#00ff00' }) };
        assert.equal(colorChipValue(board), '#ff0000');
    });

    it('falls back to the brush colour for boards without the helper', () => {
        const board = { currentBrush: () => ({ color: '#abcdef' }) };
        assert.equal(colorChipValue(board), '#abcdef');
    });

    it('is empty rather than throwing on a bare board', () => {
        assert.equal(colorChipValue({}), '');
    });
});

/**
 * The chip is rebuilt as one HTML string per render, so a wiring mistake shows
 * up as a swatch that lies rather than as an exception. Render the real toolbar
 * against a stub board and read the chip back out.
 */
function renderBoard(overrides = {}) {
    const board = {
        toolbarEl: { innerHTML: '' },
        activeTool: 'pointer',
        activeStyle: 'pen',
        isLassoActive: false,
        isNoteCanvasMode: false,
        doc: { pages: [{ id: 'p1' }], activePageId: 'p1', canvasMode: 'a4' },
        prefs: { routing: 'straight', grid: { size: 24, snap: true }, shapeFill: '', text: { color: '#f8fafc', size: 40 } },
        history: { canUndo: true, canRedo: false },
        currentBrush: () => ({ color: '#f8fafc', width: 4 }),
        currentStrokeColor: () => '#ff0000',
        pageBackgroundSwatch: () => '#ffffff',
        canvasGrid: () => ({ size: 24, snap: true }),
        textStyle: () => ({ color: '#f8fafc', size: 40 }),
        currentTextSize: () => 40,
        shapeFillColor: () => '',
        pointerTriggerIcon: () => '<svg></svg>',
        shapeTriggerIcon: () => '<svg></svg>',
        typeTriggerIcon: () => '<svg></svg>',
        formatTriggerLabel: () => 'A4',
        pageLabel: () => '1 / 1',
        bindToolbar: () => {},
        updateZoomLevel: () => {},
        updateToolEcho: () => {},
        updateNoteToolbarChrome: () => {},
        updateBrushSizeControls: () => {},
        updateTextSizeControls: () => {},
        ...overrides
    };
    renderToolbar(board);
    return board.toolbarEl.innerHTML;
}

describe('toolbar chip wiring', () => {
    it('paints the chip with the colour of the selected border', () => {
        const html = renderBoard();
        assert.ok(html.includes('id="draw-color-btn"'), 'the chip is still the picker anchor');
        assert.ok(html.includes('--chip-color:#ff0000'), 'the selection colour reaches the chip');
        assert.ok(html.includes('background:#ff0000'), 'and the swatch itself');
        assert.ok(html.includes('Color — brush and shape border'), 'the tooltip names both jobs');
    });

    it('falls back to the brush colour when the selection has no shared border', () => {
        const html = renderBoard({ currentStrokeColor: undefined, currentBrush: () => ({ color: '#abcdef', width: 4 }) });
        assert.ok(html.includes('background:#abcdef'));
        assert.equal(html.includes('#ff0000'), false);
    });
});

describe('painters use the restyled colour', () => {
    it('paints a shape outline with the new border colour', () => {
        const rect = shape();
        const { board } = makeBoard({ selection: [rect] });
        applyStrokeColor(board, '#ff0000');

        const { ctx, ops } = recordingCtx();
        drawShapeStroke(ctx, rect);

        const outline = ops.find((op) => op[0] === 'strokeRect');
        assert.ok(outline, 'a rect still paints an outline');
        assert.equal(outline[1], '#ff0000', 'the painter reads stroke.color, not a cached pref');
    });

    it('paints a freehand stroke with the new colour', () => {
        const stroke = freehand();
        const { board } = makeBoard({ selection: [stroke] });
        applyStrokeColor(board, '#22c55e');

        const { ctx, ops } = recordingCtx();
        drawBrushStroke(ctx, stroke);

        const painted = ops.find((op) => op[0] === 'arc' || op[0] === 'stroke');
        assert.ok(painted, 'the brush still paints');
        assert.equal(painted[1], '#22c55e');
        assert.equal(ctx.strokeStyle, '', 'the painter restores the context, so the colour cannot leak');
    });
});
