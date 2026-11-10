// test/flowchartEditLabel.test.js
// Regression guards for the inline shape/connector label editor.
//
// Bugs these catch (all shipped, all invisible to `node --check` and unit tests):
//   1. flowEditLabel called CanvasViewport.worldToScreen, which does not exist
//      (only screenToWorld). Double-clicking a shape threw a TypeError and the
//      label editor never opened — "edit shape text" was completely dead.
//   2. Position/size math used viewport scale on top of dpr; the text layer is
//      placed by `world / dpr` (see placeTextBox) and zoom is carried by the
//      innerEl CSS transform, so scale was applied twice.
//   3. Label chrome used to live in the toolbar, which meant every label edit
//      re-rendered (and could steal focus from) the whole toolbar. The editor is
//      self-contained now: it must not touch the toolbar at all.
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
     * Inherit the real DrawingBoard so flowCloseLabel / flowEditLabel are the
     * actual implementations; only DOM + persistence sinks are replaced.
     */
    function makeBoard() {
        const appended = [];
        const board = Object.create(DrawingBoard);
        board.flowLabelEl = null;
        board.flowLabelTarget = null;
        // Own prefs object: the suite must not mutate the module-level defaults.
        board.prefs = { ...DrawingBoard.prefs, text: { color: '#f8fafc', size: 40 } };
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
        assert.equal(board.toolbarRenders, undefined, 'label editing must not repaint the toolbar');
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
        // Font size is fitted to the box height (100 world units -> 32) and then
        // divided by dpr, so the editor text is the size the painter will draw.
        assert.equal(parseFloat(el.style.fontSize), 16);
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

    it('is a no-op without a target', () => {
        installEditorDom();
        const board = makeBoard();
        // Nothing under the pointer: the caller passes the miss through and the
        // editor must never open on an empty canvas click.
        DrawingBoard.flowEditLabel.call(board, null);
        assert.equal(board.appended.length, 0);
        assert.equal(board.flowLabelEl, null);
    });

    it('commits typed text as a single undo step', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const shape = { id: 's1', flowchartKind: 'shape', tool: 'rect', x0: 0, y0: 0, x1: 200, y1: 100, label: null };
        DrawingBoard.flowEditLabel.call(board, shape);

        const el = created[0];
        el.innerText = '  Approved  ';
        // Blur is the commit path (Enter commits by calling blur()).
        el.listeners.blur.forEach((fn) => fn());

        assert.equal(shape.label.text, 'Approved', 'text is trimmed, not stored with padding');
        assert.equal(board.historyPushes, 1, 'one label change = one undo entry');
        assert.equal(board.saves, 1, 'the label change schedules a save');
        assert.equal(board.flowLabelEl, null, 'the editor is torn down');
        assert.equal(board.redraws, 1);
    });

    it('clears an existing label in one undo step when committed empty', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100,
            label: { text: 'Old', fontSize: 20, color: '' }
        };
        DrawingBoard.flowEditLabel.call(board, shape);

        const el = created[0];
        el.innerText = '';
        el.listeners.blur.forEach((fn) => fn());

        assert.equal(shape.label, null, 'empty text deletes the label');
        assert.equal(board.historyPushes, 1, 'the delete is a single undo step');
        assert.equal(board.saves, 1);
    });

    it('does not push history when the text is unchanged', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100,
            label: { text: 'Same', fontSize: 20, color: '' }
        };
        DrawingBoard.flowEditLabel.call(board, shape);

        created[0].innerText = 'Same';
        created[0].listeners.blur.forEach((fn) => fn());

        assert.equal(board.historyPushes, undefined, 'an unchanged label must not add an undo entry');
        assert.equal(board.saves, undefined, 'and must not schedule a save');
    });

    it('paints a new label in the text-colour pref and stores it', () => {
        const created = installEditorDom();
        const board = makeBoard();
        board.prefs.text.color = '#38bdf8';
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100, color: '#22c55e', label: null
        };
        DrawingBoard.flowEditLabel.call(board, shape);

        const el = created[0];
        assert.equal(el.style.color, '#38bdf8', 'editor matches the text pref, not the outline');

        el.innerText = 'New';
        el.listeners.blur.forEach((fn) => fn());
        assert.equal(shape.label.color, '#38bdf8', 'the new label keeps the text colour');
    });

    it('never restyles an existing label when only the words change', () => {
        const created = installEditorDom();
        const board = makeBoard();
        board.prefs.text.color = '#38bdf8';
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100, color: '#22c55e',
            label: { text: 'Old', fontSize: 20, color: '#ff0000' }
        };
        DrawingBoard.flowEditLabel.call(board, shape);

        const el = created[0];
        assert.equal(el.style.color, '#ff0000', 'its own colour, not the pref');

        el.innerText = 'Newer';
        el.listeners.blur.forEach((fn) => fn());
        assert.equal(shape.label.color, '#ff0000', 'editing text does not recolour the label');
    });

    it('falls back to the outline colour for a legacy label with no stored colour', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100, color: '#22c55e',
            label: { text: 'Old', fontSize: 20, color: '' }
        };
        DrawingBoard.flowEditLabel.call(board, shape);
        assert.equal(created[0].style.color, '#22c55e', 'matches what the painter draws');

        created[0].innerText = 'Legacy';
        created[0].listeners.blur.forEach((fn) => fn());
        assert.equal(shape.label.color, '', 'still inheriting, never silently stamped');
    });
});

describe('note canvas exit path', () => {
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

    it('exitFromToolbar routes note-canvas mode to exitNoteCanvas', () => {
        installDispatchDom();
        const item = { id: 'n2', canvas: {} };
        const fake = Object.create(DrawingBoard);
        fake.isNoteCanvasMode = true;
        fake.noteCanvasItem = item;
        DrawingBoard.exitFromToolbar.call(fake);
        assert.ok(dispatched, 'note-canvas exit must dispatch');
        assert.equal(dispatched.type, 'note:canvas_draw_exited');
        assert.equal(dispatched.detail.item, item);
    });

    it('exitFromToolbar is inert outside note-canvas', () => {
        installDispatchDom();
        const fake = Object.create(DrawingBoard);
        fake.isNoteCanvasMode = false;
        fake.noteCanvasItem = { id: 'b' };
        DrawingBoard.exitFromToolbar.call(fake);
        assert.equal(dispatched, null);
    });
});
