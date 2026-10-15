// test/flowchartEditLabel.test.js
// Regression guards for the flowchart label editor + exit path.
//
// Bugs these catch (all shipped, all invisible to `node --check` and unit tests):
//   1. flowEditLabel called CanvasViewport.worldToScreen, which does not exist
//      (only screenToWorld). Double-clicking a shape threw a TypeError and the
//      label editor never opened — "edit shape text" was completely dead.
//   2. Position/size math used viewport scale on top of dpr; the text layer is
//      placed by `world / dpr` (see placeTextBox) and zoom is carried by the
//      innerEl CSS transform, so scale was applied twice.
//   3. The back-to-note button called exitNoteCanvas(), which early-returns on
//      !isNoteCanvasMode, so flowchart mode could never be exited.
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DrawingBoard } from '../js/drawingBoard.js';

let dispatched = null;

describe('flowEditLabel', () => {
    afterEach(() => {
        dispatched = null;
        delete globalThis.document;
        delete globalThis.window;
    });

    /** Minimal DOM sufficient for flowEditLabel's editor creation. */
    function installEditorDom() {
        const created = [];
        globalThis.window = {
            devicePixelRatio: 2,
            getSelection: () => ({ removeAllRanges() {}, addRange() {} })
        };
        globalThis.document = {
            createElement(tag) {
                const el = {
                    tagName: tag,
                    style: {},
                    dataset: {},
                    listeners: {},
                    children: [],
                    contentEditable: '',
                    spellcheck: false,
                    textContent: '',
                    className: '',
                    focus() { el.focused = true; },
                    blur() {},
                    remove() {},
                    appendChild(c) { el.children.push(c); },
                    addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); }
                };
                created.push(el);
                return el;
            },
            createRange: () => ({ selectNodeContents() {} })
        };
        return created;
    }

    /**
     * Inherit the real DrawingBoard so flowCloseLabel / flowLabelTargetShape /
     * exitFlowchart are the actual implementations; only DOM + persistence
     * sinks are replaced.
     */
    function makeBoard() {
        const appended = [];
        const board = Object.create(DrawingBoard);
        board.isFlowchartMode = true;
        board.flowLabelEl = null;
        board.flowLabelTarget = null;
        board.selectedStrokes = {
            set: new Set(),
            clear() { this.set.clear(); },
            add(v) { this.set.add(v); }
        };
        board.textLayer = { appendChild(el) { appended.push(el); } };
        board.appended = appended;
        board.renderToolbar = function () { this.toolbarRenders = (this.toolbarRenders || 0) + 1; };
        board.pushLayerHistory = function () { this.historyPushes = (this.historyPushes || 0) + 1; };
        board.scheduleSave = function () { this.saves = (this.saves || 0) + 1; };
        board.redraw = function () { this.redraws = (this.redraws || 0) + 1; };
        return board;
    }

    it('opens an editor instead of throwing on a shape (worldToScreen regression)', () => {
        installEditorDom();
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 100, y0: 50, x1: 300, y1: 150, label: null
        };
        assert.doesNotThrow(
            () => DrawingBoard.flowEditLabel.call(board, shape),
            'flowEditLabel must not reference a nonexistent viewport method'
        );
        assert.equal(board.appended.length, 1, 'editor should be appended to the text layer');
        assert.equal(board.flowLabelTarget, shape, 'editor should latch onto its target');
        assert.ok(board.selectedStrokes.set.has(shape), 'target should be selected');
        assert.equal(board.toolbarRenders, 1);
    });

    it('positions the editor in text-layer space (world / dpr, no viewport scale)', () => {
        const created = installEditorDom(); // dpr = 2
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 100, y0: 50, x1: 300, y1: 150, label: null
        };
        DrawingBoard.flowEditLabel.call(board, shape);
        const el = created[0];

        // Shape centre in world units is (200, 100); text layer is world / dpr.
        // A viewport-scale factor would move this off-centre at non-1x zoom.
        const left = parseFloat(el.style.left);
        const top = parseFloat(el.style.top);
        assert.ok(Number.isFinite(left) && Number.isFinite(top), 'left/top must be finite numbers');
        assert.ok(Math.abs(left - 100) < 60, `left should be near centre-100, got ${left}`);
        assert.ok(Math.abs(top - 50) < 30, `top should be near centre-50, got ${top}`);
        // Font size is world/dpr, floored at 11px so the editor stays legible
        // (same philosophy as placeTextBox's Math.max(16, ...)). Default 20 / 2 = 10,
        // floored to 11. Test "keeps an existing label" asserts the exact /dpr
        // scaling on an unfloored value (24 -> 12).
        assert.equal(parseFloat(el.style.fontSize), 11);
    });

    it('keeps an existing label in the editor', () => {
        installEditorDom();
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'diamond',
            x0: 0, y0: 0, x1: 200, y1: 100,
            label: { text: 'Decide', fontSize: 24, color: '#fff' }
        };
        DrawingBoard.flowEditLabel.call(board, shape);
        assert.equal(board.appended[0].textContent, 'Decide');
        // 24 world / dpr 2 = 12px
        assert.equal(parseFloat(board.appended[0].style.fontSize), 12);
    });

    it('centres a connector label on its bend midpoint', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const conn = {
            id: 'c1', flowchartKind: 'connector', tool: 'connector',
            x0: 100, y0: 100, x1: 500, y1: 100,
            midX: 300, midY: 100, label: null
        };
        DrawingBoard.flowEditLabel.call(board, conn);
        const left = parseFloat(created[0].style.left);
        // midX 300 / dpr 2 = 150, minus half box width.
        assert.ok(left < 150 && left > 0, `connector editor should centre on the bend, got ${left}`);
    });

    it('is a no-op outside flowchart mode', () => {
        installEditorDom();
        const board = makeBoard();
        board.isFlowchartMode = false;
        DrawingBoard.flowEditLabel.call(board, { flowchartKind: 'shape', x0: 0, y0: 0, x1: 10, y1: 10 });
        assert.equal(board.appended.length, 0);
    });
});

describe('flowchart exit path', () => {
    afterEach(() => {
        dispatched = null;
        delete globalThis.window;
    });

    function installDispatchDom() {
        globalThis.window = {
            dispatchEvent(ev) { dispatched = ev; return true; }
        };
        globalThis.CustomEvent = class CustomEvent {
            constructor(type, opts = {}) { this.type = type; this.detail = opts.detail; }
        };
    }

    it('exitFlowchart dispatches the note-canvas exit event', () => {
        installDispatchDom();
        const item = { id: 'n1', flowchart: {} };
        DrawingBoard.exitFlowchart.call({ isFlowchartMode: true, flowchartItem: item });
        assert.ok(dispatched, 'exitFlowchart should dispatch an event');
        assert.equal(dispatched.type, 'note:canvas_draw_exited');
        assert.equal(dispatched.detail.item, item);
    });

    it('exitFlowchart is inert when not in flowchart mode', () => {
        installDispatchDom();
        DrawingBoard.exitFlowchart.call({ isFlowchartMode: false, flowchartItem: { id: 'n1' } });
        assert.equal(dispatched, null);
    });

    it('exitFlowchart is inert without a bound item', () => {
        installDispatchDom();
        DrawingBoard.exitFlowchart.call({ isFlowchartMode: true, flowchartItem: null });
        assert.equal(dispatched, null);
    });

    it('exitFromToolbar routes flowchart mode to exitFlowchart', () => {
        installDispatchDom();
        const item = { id: 'n1', flowchart: {} };
        // Real method, real guards — calling exitNoteCanvas here would early-return
        // and strand the user in drawing mode.
        const fake = Object.create(DrawingBoard);
        fake.isFlowchartMode = true;
        fake.isNoteCanvasMode = false;
        fake.flowchartItem = item;
        fake.noteCanvasItem = null;
        DrawingBoard.exitFromToolbar.call(fake);
        assert.ok(dispatched, 'flowchart exit must dispatch');
        assert.equal(dispatched.detail.item, item);
    });

    it('exitFromToolbar routes note-canvas mode to exitNoteCanvas', () => {
        installDispatchDom();
        const item = { id: 'n2', canvas: {} };
        const fake = Object.create(DrawingBoard);
        fake.isFlowchartMode = false;
        fake.isNoteCanvasMode = true;
        fake.flowchartItem = null;
        fake.noteCanvasItem = item;
        DrawingBoard.exitFromToolbar.call(fake);
        assert.ok(dispatched, 'note-canvas exit must dispatch');
        assert.equal(dispatched.detail.item, item);
    });

    it('exitFromToolbar is inert in neither mode', () => {
        installDispatchDom();
        const fake = Object.create(DrawingBoard);
        fake.isFlowchartMode = false;
        fake.isNoteCanvasMode = false;
        fake.flowchartItem = { id: 'a' };
        fake.noteCanvasItem = { id: 'b' };
        DrawingBoard.exitFromToolbar.call(fake);
        assert.equal(dispatched, null);
    });
});
