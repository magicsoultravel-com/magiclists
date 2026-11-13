// test/drawingBoardShapeFill.test.js
// Shape fill has three halves that must agree: the stored pref (prefs.js), the
// selection restyler (drawingBoard/fill.js) and the painter (canvasBrushes.js).
// A fill that is stored but never painted, or painted but not undoable, reads
// as a dead control, so each link is pinned here.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShapeFill, PREFS_KEY, readPrefs } from '../js/drawingBoard/prefs.js';
import {
    applyShapeFill,
    fillTargets,
    isFillableShape,
    setShapeFill,
    shapeFillColor
} from '../js/drawingBoard/fill.js';
import {
    DRAG_SHAPE_TOOLS,
    SHAPE_FILL_TOOLS,
    drawShapeStroke
} from '../js/canvasBrushes.js';
import { PALETTE_UNIFIED } from '../js/colorPicker.js';
import {
    SHAPE_FILL_PRESETS,
    bindToolbar,
    renderToolbar,
    shapeFillChipHtml,
    updateShapeFillChip
} from '../js/drawingBoardToolbar.js';

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

/** Board stub exposing only what fill.js touches. */
function makeBoard({ selection = [], shapeFill = '' } = {}) {
    const calls = {
        pushLayerHistory: 0, scheduleSave: 0, requestRedraw: 0, renderToolbar: 0, chips: []
    };
    const board = {
        prefs: { shapeFill },
        selectedStrokes: new Set(selection),
        pushLayerHistory: () => { calls.pushLayerHistory += 1; },
        scheduleSave: () => { calls.scheduleSave += 1; },
        requestRedraw: () => { calls.requestRedraw += 1; },
        renderToolbar: () => { calls.renderToolbar += 1; },
        updateShapeFillChip: (color) => calls.chips.push(color)
    };
    board.getSelectedStrokesArray = () => Array.from(board.selectedStrokes);
    board.shapeFillColor = () => shapeFillColor(board);
    return { board, calls };
}

/**
 * Minimal recording 2D context: enough surface for drawShapeStroke and its
 * shape helpers, plus a fillStyle snapshot on every paint call so a stray
 * fill colour cannot hide behind a later stroke.
 */
function recordingCtx() {
    const ops = [];
    const stack = [];
    const ctx = {
        strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1,
        lineCap: 'butt', lineJoin: 'miter', font: '', textAlign: 'start', textBaseline: 'alphabetic',
        save() {
            stack.push({ fillStyle: this.fillStyle, globalAlpha: this.globalAlpha });
            ops.push(['save']);
        },
        restore() {
            const prev = stack.pop();
            if (prev) {
                this.fillStyle = prev.fillStyle;
                this.globalAlpha = prev.globalAlpha;
            }
            ops.push(['restore']);
        },
        beginPath() { ops.push(['beginPath']); },
        moveTo(x, y) { ops.push(['moveTo', x, y]); },
        lineTo(x, y) { ops.push(['lineTo', x, y]); },
        closePath() { ops.push(['closePath']); },
        stroke() { ops.push(['stroke', this.strokeStyle, this.globalAlpha]); },
        fill() { ops.push(['fill', this.fillStyle, this.globalAlpha]); },
        fillRect(x, y, w, h) { ops.push(['fillRect', this.fillStyle, this.globalAlpha, x, y, w, h]); },
        strokeRect(x, y, w, h) { ops.push(['strokeRect', this.strokeStyle, this.globalAlpha, x, y, w, h]); },
        rect(x, y, w, h) { ops.push(['rect', x, y, w, h]); },
        roundRect(x, y, w, h, r) { ops.push(['roundRect', x, y, w, h, r]); },
        ellipse(...args) { ops.push(['ellipse', ...args]); },
        fillText() {},
        measureText: (text) => ({ width: String(text).length * 8 })
    };
    return { ops, ctx };
}

function shapeStroke(overrides = {}) {
    return {
        tool: 'rect',
        style: 'pen',
        color: '#111111',
        width: 4,
        x0: 10, y0: 20, x1: 60, y1: 80,
        ...overrides
    };
}

describe('normalizeShapeFill', () => {
    it('accepts a 6-digit hex and lower-cases it', () => {
        assert.equal(normalizeShapeFill('  #22C55E '), '#22c55e');
    });

    it('treats everything else as outline-only', () => {
        for (const bad of ['', '   ', 'red', '#fff', '#22c55e88', 'rgb(1,2,3)', null, undefined, 42, {}]) {
            assert.equal(normalizeShapeFill(bad), '', `${JSON.stringify(bad)} must normalise to ''`);
        }
    });
});

describe('SHAPE_FILL_TOOLS', () => {
    it('covers every closed drag shape and no open one', () => {
        for (const tool of SHAPE_FILL_TOOLS) {
            assert.ok(DRAG_SHAPE_TOOLS.includes(tool), `${tool} must be a drag shape`);
        }
        for (const open of ['line', 'arrow', 'connector']) {
            assert.equal(SHAPE_FILL_TOOLS.includes(open), false, `${open} has no interior to fill`);
        }
        assert.equal(new Set(SHAPE_FILL_TOOLS).size, SHAPE_FILL_TOOLS.length, 'no duplicates');
        assert.deepEqual(
            [...SHAPE_FILL_TOOLS].sort(),
            DRAG_SHAPE_TOOLS.filter((tool) => !['line', 'arrow', 'connector'].includes(tool)).sort(),
            'the fill set is exactly the drag shapes minus the open ones'
        );
    });

    it('is frozen so the painter and the sessions cannot drift apart', () => {
        assert.equal(Object.isFrozen(SHAPE_FILL_TOOLS), true);
    });

    it('classifies items by tool', () => {
        assert.equal(isFillableShape({ tool: 'star' }), true);
        assert.equal(isFillableShape({ tool: 'arrow' }), false);
        assert.equal(isFillableShape({ points: [] }), false);
        assert.equal(isFillableShape(null), false);
    });
});

describe('fillTargets', () => {
    it('keeps only the selected closed shapes', () => {
        const { board } = makeBoard({
            selection: [
                { id: 'a', tool: 'rect' },
                { id: 'b', tool: 'line' },
                { id: 'c', tool: 'ellipse' },
                { id: 'd', tool: 'connector' },
                { id: 'e', tool: 'brush', points: [] }
            ]
        });
        assert.deepEqual(fillTargets(board).map((item) => item.id), ['a', 'c']);
    });
});

describe('applyShapeFill', () => {
    it('fills the selection in one undoable step', () => {
        const rect = { id: 'a', tool: 'rect', color: '#111111' };
        const { board, calls } = makeBoard({ selection: [rect] });

        assert.equal(applyShapeFill(board, '#22C55E'), 1);
        assert.equal(rect.fillColor, '#22c55e', 'stored normalised');
        assert.equal(rect.color, '#111111', 'the outline colour is untouched');
        assert.equal(calls.pushLayerHistory, 1, 'one entry for the whole gesture');
        assert.equal(calls.scheduleSave, 1);
        assert.equal(calls.requestRedraw, 1);
    });

    it('falls back to board.redraw when the board has no requestRedraw', () => {
        const rect = { id: 'a', tool: 'rect' };
        const { board } = makeBoard({ selection: [rect] });
        delete board.requestRedraw;
        let redraws = 0;
        board.redraw = () => { redraws += 1; };
        applyShapeFill(board, '#22c55e');
        assert.equal(redraws, 1);
    });

    it('removes the key for "No fill" instead of storing a dead colour', () => {
        const rect = { id: 'a', tool: 'rect', fillColor: '#22c55e' };
        const { board } = makeBoard({ selection: [rect] });

        assert.equal(applyShapeFill(board, ''), 1);
        assert.equal('fillColor' in rect, false);
    });

    it('does not push history when nothing changes', () => {
        const rect = { id: 'a', tool: 'rect', fillColor: '#22c55e' };
        const line = { id: 'b', tool: 'line' };
        const { board, calls } = makeBoard({ selection: [rect, line] });

        assert.equal(applyShapeFill(board, '#22C55E'), 0, 'same fill is a no-op');
        assert.equal(applyShapeFill(board, ''), 1, 'clearing still counts');
        assert.equal(calls.pushLayerHistory, 1, 'only the real change pushed history');
    });
});

describe('setShapeFill', () => {
    it('remembers the fill for future shapes and repaints the toolbar', () => {
        withStorage((store) => {
            const rect = { id: 'a', tool: 'rect', fillColor: '#111111' };
            const { board, calls } = makeBoard({ selection: [rect] });

            setShapeFill(board, '#22C55E');

            assert.equal(board.prefs.shapeFill, '#22c55e');
            assert.equal(JSON.parse(store.get(PREFS_KEY)).shapeFill, '#22c55e');
            assert.equal(rect.fillColor, '#22c55e');
            assert.equal(calls.renderToolbar, 1);
            assert.deepEqual(calls.chips, [], 'a full rerender does not also patch the chip');
        });
    });

    it('seeds the pref even when the selection already matches', () => {
        withStorage(() => {
            const rect = { id: 'a', tool: 'rect', fillColor: '#22c55e' };
            const { board, calls } = makeBoard({ selection: [rect] });

            assert.equal(setShapeFill(board, '#22c55e'), 0, 'no undo entry for a no-op');
            assert.equal(board.shapeFillColor(), '#22c55e', 'the next shape still inherits it');
            assert.equal(calls.pushLayerHistory, 0);
        });
    });

    it('patches the chip in place when a rerender is not wanted', () => {
        withStorage(() => {
            const { board, calls } = makeBoard();
            setShapeFill(board, '#22C55E', { rerender: false });
            assert.deepEqual(calls.chips, ['#22c55e']);
            assert.equal(calls.renderToolbar, 0);
        });
    });

    it('never stores a value the painter would reject', () => {
        withStorage((store) => {
            const { board } = makeBoard();
            setShapeFill(board, 'chartreuse');
            assert.equal(board.prefs.shapeFill, '');
            assert.equal(JSON.parse(store.get(PREFS_KEY)).shapeFill, '');
        });
    });
});

describe('shape fill pref plumbing', () => {
    it('shapeFillColor reads the normalised pref', () => {
        assert.equal(shapeFillColor({ prefs: { shapeFill: '#22C55E' } }), '#22c55e');
        assert.equal(shapeFillColor({ prefs: { shapeFill: 'nope' } }), '');
        assert.equal(shapeFillColor(null), '');
    });

    it('readPrefs round-trips a stored fill', () => {
        withStorage((store) => {
            store.set(PREFS_KEY, JSON.stringify({ shapeFill: '#22c55e' }));
            assert.equal(readPrefs().shapeFill, '#22c55e');
        });
    });
});


describe('drawShapeStroke fill pass', () => {
    it('paints the fill under the outline and keeps the stroke colour intact', () => {
        const { ctx, ops } = recordingCtx();
        drawShapeStroke(ctx, shapeStroke({ fillColor: '#22c55e' }));

        const fill = ops.find((op) => op[0] === 'fillRect');
        const outline = ops.find((op) => op[0] === 'strokeRect');
        assert.ok(fill, 'a filled rect must paint a filled interior');
        assert.equal(fill[1], '#22c55e');
        assert.equal(fill[2], 1, 'fill is opaque regardless of the brush alpha');
        assert.ok(outline, 'the outline is still drawn');
        assert.equal(outline[1], '#111111', 'the outline keeps the stroke colour');
        assert.ok(
            ops.indexOf(fill) < ops.indexOf(outline),
            'the fill must land before the outline so the border stays crisp'
        );
        assert.equal(ctx.fillStyle, '', 'the painter leaves the context as it found it, so no fill colour leaks into the next stroke');
    });

    it('keeps the fill opaque on a translucent highlighter stroke', () => {
        const { ctx, ops } = recordingCtx();
        drawShapeStroke(ctx, shapeStroke({ style: 'highlighter', fillColor: '#22c55e' }));

        const fill = ops.find((op) => op[0] === 'fillRect');
        const outline = ops.find((op) => op[0] === 'strokeRect');
        assert.equal(fill[2], 1, 'the swatch reads the same on every brush');
        assert.ok(outline[2] < 1, 'the highlighter outline stays translucent');
    });

    it('leaves an unfilled shape outline-only', () => {
        const { ctx, ops } = recordingCtx();
        drawShapeStroke(ctx, shapeStroke());
        assert.equal(ops.some((op) => op[0] === 'fillRect' || op[0] === 'fill'), false);
    });

    it('ignores a fill the normaliser would have rejected', () => {
        const { ctx, ops } = recordingCtx();
        drawShapeStroke(ctx, shapeStroke({ fillColor: 'rgb(1,2,3)' }));
        assert.equal(ops.some((op) => op[0] === 'fillRect' || op[0] === 'fill'), false);
    });

    it('never fills an open tool, and the arrowhead keeps its own colour', () => {
        const { ctx, ops } = recordingCtx();
        drawShapeStroke(ctx, shapeStroke({ tool: 'arrow', fillColor: '#22c55e' }));

        const fillOps = ops.filter((op) => op[0] === 'fill');
        assert.equal(fillOps.length, 1, 'only the arrowhead is filled');
        assert.equal(fillOps[0][1], '#111111', 'the head must not inherit the fill colour');
    });

    it('fills a polygon shape through the path painter', () => {
        const { ctx, ops } = recordingCtx();
        drawShapeStroke(ctx, shapeStroke({ tool: 'diamond', fillColor: '#22c55e' }));

        const fills = ops.filter((op) => op[0] === 'fill');
        assert.equal(fills.length, 1);
        assert.equal(fills[0][1], '#22c55e');
        assert.ok(ops.some((op) => op[0] === 'closePath'), 'the fill closes its own path');
    });
});


describe('shape fill picker chrome', () => {
    it('offers a full 4x4 grid whose last tile is "No fill"', () => {
        assert.equal(SHAPE_FILL_PRESETS.length, 16, 'the picker grid has exactly 16 slots');
        const last = SHAPE_FILL_PRESETS[SHAPE_FILL_PRESETS.length - 1];
        assert.deepEqual(last, { value: '', label: 'No fill' });
        for (const preset of SHAPE_FILL_PRESETS.slice(0, -1)) {
            assert.match(preset.value, /^#[0-9a-f]{6}$/i, `${preset.value} must be a hex swatch`);
        }
        const values = SHAPE_FILL_PRESETS.map((preset) => preset.value);
        assert.equal(new Set(values).size, values.length, 'no duplicate swatches');
        assert.ok(values.includes('#ffffff'), 'white stays pickable for diagram boxes');
        assert.equal(values.includes('#121214'), false, 'the near-black duplicate makes room for "No fill"');
        assert.ok(PALETTE_UNIFIED.length >= 16, 'the palette still seeds the picker');
    });

    it('renders an outline-only chip when the pref is empty', () => {
        const html = shapeFillChipHtml({ prefs: { shapeFill: '' } });
        assert.ok(html.includes('id="draw-shape-fill-btn"'));
        assert.ok(html.includes('drawing-shape-fill-chip--none'), 'the empty state is visible');
        assert.ok(html.includes('No fill'));
        assert.ok(html.includes('aria-expanded="false"'), 'the picker anchor starts collapsed');
        assert.ok(html.includes('background:transparent'));
    });

    it('renders the stored hex when a fill is set', () => {
        const html = shapeFillChipHtml({ prefs: { shapeFill: '#22C55E' } });
        assert.ok(html.includes('background:#22c55e'));
        assert.equal(html.includes('drawing-shape-fill-chip--none'), false);
        assert.ok(html.includes('Shape fill — #22c55e'), 'the tooltip names the colour');
    });

    it('prefers the board helper over the raw pref', () => {
        const board = {
            prefs: { shapeFill: '' },
            shapeFillColor: () => '#f97316'
        };
        assert.ok(shapeFillChipHtml(board).includes('background:#f97316'));
    });
});

describe('updateShapeFillChip', () => {
    function makeToolbarEl() {
        const classes = new Set();
        const chip = {
            style: {},
            classList: {
                toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
                has: (name) => classes.has(name)
            }
        };
        const btn = { style: { setProperty(key, value) { this[key] = value; } }, title: '' };
        return {
            chip,
            btn,
            classes,
            querySelector(sel) {
                if (sel === '.drawing-shape-fill-chip') return chip;
                if (sel === '#draw-shape-fill-btn') return btn;
                return null;
            }
        };
    }

    it('paints the picked colour and clears the none marker', () => {
        const toolbarEl = makeToolbarEl();

        updateShapeFillChip({ toolbarEl }, '#22C55E');

        assert.equal(toolbarEl.chip.style.background, '#22c55e');
        assert.equal(toolbarEl.classes.has('drawing-shape-fill-chip--none'), false);
        assert.equal(toolbarEl.btn.style['--chip-color'], '#22c55e');
        assert.equal(toolbarEl.btn.title, 'Shape fill — #22c55e');
    });

    it('restores the none marker for "No fill"', () => {
        const toolbarEl = makeToolbarEl();
        updateShapeFillChip({ toolbarEl }, '#22c55e');
        updateShapeFillChip({ toolbarEl }, '');

        assert.equal(toolbarEl.chip.style.background, 'transparent');
        assert.equal(toolbarEl.classes.has('drawing-shape-fill-chip--none'), true);
        assert.equal(toolbarEl.btn.style['--chip-color'], 'transparent');
        assert.equal(toolbarEl.btn.title, 'Shape fill — No fill');
    });

    it('survives a toolbar that is not rendered yet', () => {
        assert.doesNotThrow(() => updateShapeFillChip({}, '#22c55e'));
        assert.doesNotThrow(() => updateShapeFillChip({ toolbarEl: { querySelector: () => null } }, '#22c55e'));
    });
});


/**
 * The toolbar is one HTML string per render, so a missing id or a row that
 * swallowed a control is a dead button with no console error. These guards
 * render the real string against a stub board and check the three-row layout
 * and the split brush button the fill swatch sits next to.
 */
function renderBoard(overrides = {}) {
    const board = {
        toolbarEl: { innerHTML: '' },
        activeTool: overrides.activeTool || 'pointer',
        activeStyle: overrides.activeStyle || 'pen',
        isLassoActive: false,
        isNoteCanvasMode: false,
        doc: { pages: [{ id: 'p1' }], activePageId: 'p1', canvasMode: 'a4' },
        prefs: {
            routing: 'straight',
            grid: { size: 24, snap: true },
            shapeFill: overrides.shapeFill || '',
            text: { color: '#f8fafc', size: 40 }
        },
        history: { canUndo: true, canRedo: false },
        currentBrush: () => ({ color: '#f8fafc', width: 4 }),
        pageBackgroundSwatch: () => '#ffffff',
        canvasGrid: () => ({ size: 24, snap: true }),
        textStyle: () => ({ color: '#f8fafc', size: 40 }),
        currentTextSize: () => 40,
        shapeFillColor: () => normalizeShapeFill(overrides.shapeFill),
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

describe('toolbar layout', () => {
    function rows(html) {
        return html.split(/<div class="drawing-toolbar-row/).slice(1);
    }

    it('renders exactly three rows in the documented order', () => {
        const body = rows(renderBoard());
        assert.equal(body.length, 3, 'three balanced rows, no more');
        assert.match(body[0], /^"/, 'the brush row is the base row');
        assert.match(body[1], /^ drawing-toolbar-row--canvas"/, 'canvas objects + view sit in the middle row');
        assert.match(body[2], /^ drawing-toolbar-row--meta"/, 'page meta stays last');
    });

    it('keeps the brush, shapes, fill and connector controls in the first row', () => {
        const first = rows(renderBoard())[0];
        for (const id of ['draw-brush-tool', 'draw-menu-pointer', 'draw-brush-smaller', 'draw-eraser',
            'draw-color-btn', 'draw-menu-shapes', 'draw-shape-fill-btn', 'draw-tool-connector', 'draw-flow-routing']) {
            assert.ok(first.includes(`id="${id}"`), `${id} belongs to the brush row`);
        }
    });
});


describe('toolbar layout rows 2 and 3', () => {
    const rowsOf = (html) => html.split(/<div class="drawing-toolbar-row/).slice(1);

    it('puts objects, text, view and history in the middle row', () => {
        const middle = rowsOf(renderBoard())[1];
        for (const id of ['draw-insert-image', 'draw-crop', 'draw-lasso', 'draw-fullscreen',
            'draw-text-tool', 'draw-text-color-btn', 'draw-pan', 'draw-zoom-in', 'draw-zoom-out',
            'draw-undo', 'draw-redo', 'draw-clear']) {
            assert.ok(middle.includes(`id="${id}"`), `${id} belongs to the canvas row`);
        }
    });

    it('puts page controls and the exit affordances in the last row', () => {
        const last = rowsOf(renderBoard())[2];
        for (const id of ['draw-menu-format', 'draw-menu-background', 'draw-bg-color-btn',
            'draw-page-prev', 'draw-page-next', 'draw-page-add', 'draw-flow-snap',
            'draw-flow-grid-minus', 'draw-flow-grid-plus', 'draw-toolbar-hide', 'draw-exit-drawing']) {
            assert.ok(last.includes(`id="${id}"`), `${id} belongs to the meta row`);
        }
    });

    it('does not leave a leading divider at the start of a row', () => {
        const body = rowsOf(renderBoard());
        for (const [index, row] of [body[1], body[2]].entries()) {
            const firstChild = row.slice(row.indexOf('>') + 1).trimStart();
            assert.equal(
                firstChild.startsWith('<span class="format-toolbar-sep"'),
                false,
                `row ${index + 2} must open with a control, not a divider`
            );
        }
    });
});

describe('split brush button', () => {
    it('wraps the brush tool and its chevron in one split control', () => {
        const html = renderBoard({ activeTool: 'brush', activeStyle: 'marker' });
        const split = html.match(/<span class="drawing-brush-split"[\s\S]*?<span class="drawing-brush-size"/);
        assert.ok(split, 'both halves live inside one group');
        assert.ok(split[0].includes('id="draw-brush-tool"'), 'the tool half arms the brush in one click');
        assert.ok(split[0].includes('id="draw-menu-pointer"'), 'the chevron half keeps the style menu');
        assert.ok(split[0].includes('drawing-brush-split__tool active'), 'the tool half lights up while armed');
        assert.ok(split[0].includes('Marker'), 'the active brush style is named in the tooltip');
    });

    it('leaves the brush half unlit for the pointer tool', () => {
        const html = renderBoard({ activeTool: 'pointer' });
        assert.ok(html.includes('id="draw-brush-tool"'));
        assert.equal(html.includes('drawing-brush-split__tool active'), false);
        assert.ok(html.includes('aria-pressed="false"'), 'a menu-only brush is not pressed');
    });
});

describe('fill swatch in the rendered toolbar', () => {
    it('renders the no-fill state until a fill is picked', () => {
        const none = renderBoard();
        assert.ok(none.includes('drawing-shape-fill-chip--none'));
        assert.ok(none.includes('Shape fill — No fill'));
    });

    it('renders the stored fill', () => {
        const filled = renderBoard({ shapeFill: '#22c55e' });
        assert.ok(filled.includes('background:#22c55e'));
        assert.equal(filled.includes('drawing-shape-fill-chip--none'), false);
    });
});


describe('toolbar bindings for the new controls', () => {
    function bindingBoard() {
        const handlers = new Map();
        const board = {
            toolbarEl: {
                querySelector: (sel) => {
                    if (sel === '#draw-fullscreen') return null;
                    return { addEventListener: (type, fn) => handlers.set(`${sel}:${type}`, fn) };
                },
                querySelectorAll: () => []
            },
            activeTool: 'pointer',
            activeStyle: 'marker',
            prefs: { routing: 'straight' },
            selectedStrokes: new Set(),
            setStyle: (style) => { board.lastStyle = style; },
            setTool: (tool) => { board.lastTool = tool; },
            openShapeFillPicker: (anchor) => { board.fillAnchor = anchor; }
        };
        return { board, handlers };
    }

    const click = { stopPropagation() {}, currentTarget: { id: 'anchor' } };

    it('arms the remembered brush style on a single click, and toggles off', () => {
        const { board, handlers } = bindingBoard();
        bindToolbar(board);

        const handler = handlers.get('#draw-brush-tool:click');
        assert.ok(handler, 'the tool half must be bound');

        handler(click);
        assert.equal(board.lastStyle, 'marker', 'one click arms the active style');

        board.activeTool = 'brush';
        handler(click);
        assert.equal(board.lastTool, 'pointer', 'clicking again returns to the pointer');
    });

    it('opens the fill picker from the swatch without arming a tool', () => {
        const { board, handlers } = bindingBoard();
        bindToolbar(board);

        const handler = handlers.get('#draw-shape-fill-btn:click');
        assert.ok(handler, 'the fill swatch must be bound');

        handler(click);
        assert.equal(board.fillAnchor, click.currentTarget);
        assert.equal(board.lastTool, undefined, 'picking a fill never changes the tool');
        assert.equal(board.lastStyle, undefined, 'picking a fill never changes the brush');
    });
});

