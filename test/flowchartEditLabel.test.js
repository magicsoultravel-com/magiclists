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
        assert.equal(board.toolbarRenders, undefined,
            'label editing must not re-render the whole toolbar (that steals focus mid-typing)');
    });

    it('refreshes the selection controls so the text stepper drives the editor', () => {
        installEditorDom();
        const board = makeBoard();
        board.refreshSelectionControls = function () { this.controlRefreshes = (this.controlRefreshes || 0) + 1; };
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100, label: null
        };
        DrawingBoard.flowEditLabel.call(board, shape);
        assert.equal(board.controlRefreshes, 1, 'open refreshes once');
        assert.equal(board.toolbarRenders, undefined, 'but never the whole toolbar');

        board.appended[0].innerText = 'Done';
        board.appended[0].listeners.blur.forEach((fn) => fn());
        assert.equal(board.controlRefreshes, 2, 'commit refreshes again (the label now exists)');
    });

    it('styles the editor exactly like the painter', () => {
        const created = installEditorDom(); // dpr = 2
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100, label: null
        };
        DrawingBoard.flowEditLabel.call(board, shape);
        const el = created[0];

        // The editor used to inherit system-ui from the body while the painter
        // drew Inter: every preview re-wrapped on commit.
        assert.equal(el.style.fontFamily, 'Inter, system-ui, sans-serif');
        assert.equal(el.style.lineHeight, '1.2', 'same line advance as the painter');
        // Shape box: 200x100 world -> 100x50 CSS px, 6 world units of padding -> 3px.
        assert.equal(el.style.left, '0px');
        assert.equal(el.style.top, '0px');
        assert.equal(el.style.width, '100px');
        assert.equal(el.style.height, '50px');
        assert.equal(el.style.padding, '3px');
        assert.equal(el.style.display, 'flex');
        assert.equal(el.style.whiteSpace, 'pre-wrap');
        assert.equal(el.style.overflowWrap, 'anywhere');
        // No clipping in either state (WYSIWYG overflow).
        assert.equal(el.style.overflow, 'visible');
        // No min-width/min-height cheat: the box is the box the painter fills.
        assert.equal(el.style.minWidth, undefined);
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
        const el = created[0];
        // width 0 at midX 300 / dpr 2 = 150: centred text overflows both ways,
        // the DOM twin of ctx.textAlign = 'center' at centerX.
        assert.equal(el.style.left, '150px');
        assert.equal(el.style.width, '0px');
        assert.equal(el.style.transform, 'translateY(-50%)', 'block centred on the bend line');
        assert.equal(el.style.whiteSpace, 'pre', 'connectors do not wrap, they honour Shift+Enter');
        assert.equal(el.style.textAlign, 'center');
    });

    it('keeps the size a stepper applies while the editor is open', () => {
        const created = installEditorDom(); // dpr = 2
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100, label: null
        };
        DrawingBoard.flowEditLabel.call(board, shape);
        const el = created[0];
        const openingSize = parseFloat(el.style.fontSize);

        // The label does not exist yet, so applyTextStyle has nothing to write:
        // the editor restyle is the only place this size can live.
        const applied = DrawingBoard.flowRestyleLabelEditor.call(board, { size: 24 });
        assert.equal(applied, 1);
        assert.equal(parseFloat(el.style.fontSize), 24, 'editor preview follows the stepper');
        assert.equal(board.flowLabelSize, 48, 'pending size is held in canvas units');

        el.innerText = 'Sized';
        el.listeners.blur.forEach((fn) => fn());
        assert.equal(shape.label.fontSize, 48, 'commit writes the size the user saw, not the opening one');
        assert.notEqual(shape.label.fontSize, openingSize * 2);
        assert.equal(board.flowLabelSize, null, 'pending size is cleared on commit');
    });

    it('a stepper size change alone is not an extra undo step', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100,
            // 40 canvas units = the 20px the stepper below asks for, already
            // written by applyTextStyle in the real flow.
            label: { text: 'Same', fontSize: 40, color: '' }
        };
        DrawingBoard.flowEditLabel.call(board, shape);
        DrawingBoard.flowRestyleLabelEditor.call(board, { size: 20 });
        created[0].innerText = 'Same';
        created[0].listeners.blur.forEach((fn) => fn());
        assert.equal(board.historyPushes, undefined, 'unchanged text + unchanged size = no undo entry');
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

    it('turns a shape editor in place about the box centre', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100,
            label: { text: 'Tilt', fontSize: 20, color: '', angle: 45 }
        };
        DrawingBoard.flowEditLabel.call(board, shape);

        // Default transform-origin (50% 50%) is the shape box centre: the same
        // point drawFlowchartLabel rotates the committed label about.
        const el = created[0];
        assert.equal(el.style.transform, 'rotate(45deg)');
        assert.equal(el.style.width, '100px', 'the box, padding and centring are unchanged');
        assert.equal(el.style.display, 'flex');
    });

    it('keeps the connector centring translate when it rotates', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const conn = {
            id: 'c1', flowchartKind: 'connector', tool: 'connector',
            x0: 0, y0: 0, x1: 400, y1: 0, midX: 200, midY: 0,
            label: { text: 'yes', fontSize: 20, color: '', angle: 90 }
        };
        DrawingBoard.flowEditLabel.call(board, conn);
        // translateY first (block centred on the bend line), then the turn, so
        // the rotation happens about that centred block, not the raw element.
        assert.equal(created[0].style.transform, 'translateY(-50%) rotate(90deg)');
    });

    it('gives a brand-new label the remembered angle and commits it', () => {
        const created = installEditorDom();
        const board = makeBoard();
        board.prefs.text = { color: '#f8fafc', size: 40, angle: 30 };
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100, label: null
        };
        DrawingBoard.flowEditLabel.call(board, shape);

        const el = created[0];
        assert.equal(el.style.transform, 'rotate(30deg)', 'a new label starts at the dial angle');
        assert.equal(board.flowLabelAngle, 30);

        el.innerText = 'New';
        el.listeners.blur.forEach((fn) => fn());
        assert.equal(shape.label.angle, 30);
        assert.equal(board.flowLabelAngle, null, 'the live angle is cleared on commit');
    });

    it('never rotates an existing upright label just because the pref changed', () => {
        const created = installEditorDom();
        const board = makeBoard();
        board.prefs.text = { color: '#f8fafc', size: 40, angle: 30 };
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100,
            label: { text: 'Old', fontSize: 20, color: '' }
        };
        DrawingBoard.flowEditLabel.call(board, shape);

        const el = created[0];
        assert.equal(el.style.transform, '', 'editing the words does not turn the label');

        el.innerText = 'Newer';
        el.listeners.blur.forEach((fn) => fn());
        assert.equal('angle' in shape.label, false, 'still upright, still stored-absent');
    });

    it('turns an open editor and commits the angle the user dragged to', () => {
        const created = installEditorDom();
        const board = makeBoard();
        const shape = {
            id: 's1', flowchartKind: 'shape', tool: 'rect',
            x0: 0, y0: 0, x1: 200, y1: 100, label: null
        };
        DrawingBoard.flowEditLabel.call(board, shape);
        const el = created[0];

        assert.equal(DrawingBoard.flowRestyleLabelEditor.call(board, { angle: 120 }), 1);
        assert.equal(el.style.transform, 'rotate(120deg)');
        assert.equal(board.flowLabelAngle, 120);
        assert.equal(DrawingBoard.flowRestyleLabelEditor.call(board, { angle: 120 }), 0,
            'the same angle again is not a change');

        el.innerText = 'Turned';
        el.listeners.blur.forEach((fn) => fn());
        assert.equal(shape.label.angle, 120, 'the commit writes the angle the editor showed');
        assert.equal(board.historyPushes, 1, 'one undo entry for the committed edit');
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
