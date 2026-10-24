// test/drawingBoardLifecycle.test.js
// Guards for js/drawingBoard/lifecycle.js — the session enter/exit seam that
// used to live inside js/drawingBoard.js.
// Bug classes covered here: a mode flag left behind on exit (so the next note
// opened in flowchart mode, or the workspace reopened with a stale noteId), an
// exit path that skips the save flush, and an entry path that forgets to clear
// the gesture-scoped history flags.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as LifecycleSession from '../js/drawingBoard/lifecycle.js';
import { DrawingToolbarChrome } from '../js/drawingToolbarChrome.js';
import { ColorPicker } from '../js/colorPicker.js';
import { DrawingToolbarMenu } from '../js/drawingToolbarMenu.js';
import { CanvasViewport } from '../js/canvasViewport.js';

/** Swap singleton methods for the duration of `fn`, then always restore them. */
async function withStubs(patches, fn) {
    const saved = patches.map(([obj, key]) => [obj, key, obj[key]]);
    for (const [obj, key, value] of patches) obj[key] = value;
    try {
        return await fn();
    } finally {
        for (const [obj, key, value] of saved) obj[key] = value;
    }
}

/** Run `fn` with a minimal `window`/`CustomEvent` pair, collecting events. */
async function withWindow(fn) {
    const events = [];
    const prevWindow = globalThis.window;
    const prevCustomEvent = globalThis.CustomEvent;
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, init) { this.type = type; this.detail = init?.detail; }
    };
    globalThis.window = {
        dispatchEvent: (event) => { events.push(event); return true; },
        addEventListener() {}
    };
    try {
        return await fn(events);
    } finally {
        globalThis.window = prevWindow;
        if (prevCustomEvent === undefined) delete globalThis.CustomEvent;
        else globalThis.CustomEvent = prevCustomEvent;
    }
}

function makeEl() {
    const classes = new Set();
    return {
        classes,
        attrs: {},
        innerHTML: 'stale',
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
        },
        setAttribute(name, value) { this.attrs[name] = value; },
        getAttribute: (name) => this.attrs[name] ?? null
    };
}

/** Board stub: real history object, DOM reduced to observable bits. */
function makeBoard(overrides = {}) {
    const calls = [];
    const record = (name) => (...args) => { calls.push([name, ...args]); };
    return {
        calls,
        active: false,
        docOwner: null,
        doc: null,
        prefs: null,
        activeTool: 'pointer',
        activeStyle: 'pen',
        isNoteCanvasMode: false,
        isFlowchartMode: false,
        flowchartRouting: 'curve',
        flowchartItem: null,
        activeNoteId: null,
        noteCanvasItem: null,
        cropState: null,
        draftStroke: null,
        shapePreview: null,
        resizeHandle: null,
        resizeStart: null,
        hoverHandle: null,
        selectedStrokes: new Set(['a1', 'a2']),
        colorRolloutOpen: true,
        bgColorRolloutOpen: true,
        saveTimer: 42,
        toolbarEl: null,
        brandEl: { textContent: 'magicCanvas', querySelector: () => null },
        brandNotesText: 'magicNotes',
        boardEl: makeEl(),
        canvas: { dataset: {} },
        eraseHistoryPushed: true,
        bgColorHistoryPushed: true,
        history: { count: 0, clear() { this.count += 1; } },
        flushSave: async () => { calls.push(['flushSave']); },
        updateNoteToolbarChrome: () => { calls.push(['updateNoteToolbarChrome']); },
        exitFlowchart: () => { calls.push(['exitFlowchart']); },
        exitNoteCanvas: () => { calls.push(['exitNoteCanvas']); },
        shrinkInfiniteIfNeeded: record('shrinkInfiniteIfNeeded'),
        renderToolbar: record('renderToolbar'),
        updateZoomLevel: record('updateZoomLevel'),
        resize: record('resize'),
        redraw: record('redraw'),
        redrawBackground: record('redrawBackground'),
        bindFlowBendEvents: record('bindFlowBendEvents'),
        ...overrides
    };
}

/** Chrome + viewport stubs shared by every entry path. */
function entryStubs(mount = { id: 'toolbar-mount' }) {
    const seen = { show: 0, hide: 0, handMode: null, loadedViewport: null };
    return {
        seen,
        patches: [
            [DrawingToolbarChrome, 'show', () => { seen.show += 1; }],
            [DrawingToolbarChrome, 'getToolbarMount', () => mount],
            [DrawingToolbarChrome, 'hide', () => { seen.hide += 1; }],
            [CanvasViewport, 'loadFromDoc', (vp) => { seen.loadedViewport = vp; }],
            [CanvasViewport, 'setHandMode', (on) => { seen.handMode = on; }]
        ]
    };
}

const called = (board, name) => board.calls.filter((c) => c[0] === name).length;

describe('drawingBoard lifecycle — init', () => {
    it('records the app and the brand fallback, then bails out without a canvas', async () => {
        const board = makeBoard({ canvas: null, boardEl: null, brandEl: null });
        const app = { id: 'app' };
        await withWindow(async () => {
            const prevDoc = globalThis.document;
            globalThis.document = { getElementById: () => null };
            try {
                await withStubs([[DrawingToolbarChrome, 'init', () => {}]], () => {
                    LifecycleSession.init(board, app);
                });
            } finally {
                globalThis.document = prevDoc;
            }
        });

        assert.equal(board.app, app);
        assert.equal(board.brandNotesText, 'magicNotes');
        assert.equal(board.ctx, undefined, 'no canvas means no 2d context');
        assert.equal(typeof DrawingToolbarChrome.onCollapse, 'function');
        assert.equal(typeof DrawingToolbarChrome.onExpand, 'function');
    });

    it('wires pointer + viewport listeners when the DOM shell exists', async () => {
        const listeners = [];
        const on = (type, handler) => listeners.push({ type, handler });
        const canvas = { dataset: {}, addEventListener: on, getContext: () => ({ id: 'ctx' }) };
        const viewportEl = { addEventListener: on };
        const board = makeBoard({ canvas, bgCanvas: null, viewportEl, innerEl: {}, textLayer: null });
        const boardEl = makeEl();
        const elements = { 'drawing-board': boardEl, 'drawing-canvas': canvas, 'canvas-viewport': viewportEl };

        await withWindow(async () => {
            const prevDoc = globalThis.document;
            globalThis.document = { getElementById: (id) => elements[id] || null };
            try {
                await withStubs([
                    [DrawingToolbarChrome, 'init', () => {}],
                    [CanvasViewport, 'init', () => {}],
                    [CanvasViewport, 'syncScrollbars', () => {}]
                ], () => {
                    LifecycleSession.init(board, {});
                });
            } finally {
                globalThis.document = prevDoc;
            }
        });

        assert.equal(board.ctx.id, 'ctx');
        const types = listeners.map((l) => l.type);
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'contextmenu', 'dblclick', 'canvas:zoom', 'canvas:pan']) {
            assert.ok(types.includes(type), `expected a ${type} listener`);
        }

        // canvas:zoom must refresh the zoom label, persist the viewport and sync scrollbars.
        board.calls.length = 0;
        board.persistViewport = () => { board.calls.push(['persistViewport']); };
        listeners.find((l) => l.type === 'canvas:zoom').handler();
        assert.equal(called(board, 'updateZoomLevel'), 1);
        assert.equal(called(board, 'persistViewport'), 1);
    });
});

describe('drawingBoard lifecycle — activate', () => {
    it('resets note/flowchart state, loads the document and shows the chrome', async () => {
        const board = makeBoard();
        const { seen, patches } = entryStubs();

        await withStubs(patches, () => LifecycleSession.activate(board));

        assert.equal(board.active, true);
        assert.equal(board.docOwner, 'workspace');
        assert.equal(board.history.count, 1, 'history is cleared on entry');
        assert.ok(Array.isArray(board.doc.pages) && board.doc.pages.length > 0, 'a document is loaded');
        assert.equal(board.toolbarEl.id, 'toolbar-mount');
        assert.equal(seen.show, 1);
        assert.equal(seen.handMode, false, 'pointer tool does not start in pan mode');

        // Note / flowchart session state must be cleared, not inherited.
        assert.equal(board.isNoteCanvasMode, false);
        assert.equal(board.activeNoteId, null);
        assert.equal(board.noteCanvasItem, null);
        assert.equal(board.cropState, null);

        assert.equal(board.brandEl.textContent, 'magicCanvas');
        assert.equal(board.boardEl.classList.contains('is-hidden'), false);
        assert.equal(board.boardEl.attrs['aria-hidden'], 'false');
        assert.equal(board.canvas.dataset.tool, board.prefs.activeTool);

        for (const name of ['renderToolbar', 'updateZoomLevel', 'resize', 'redraw']) {
            assert.equal(called(board, name), 1, `${name} runs once on entry`);
        }
        assert.equal(called(board, 'redrawBackground'), 0, 'workspace entry does not repaint the background layer');
    });

    it('starts in pointer mode with the default prefs when storage is unavailable', async () => {
        const board = makeBoard();
        const { seen, patches } = entryStubs();

        await withStubs(patches, () => LifecycleSession.activate(board));

        assert.equal(board.activeTool, 'pointer');
        assert.equal(board.activeStyle, 'pen');
        assert.equal(seen.handMode, false);
    });
});

describe('drawingBoard lifecycle — activateForNote', () => {
    it('ignores items without an id', async () => {
        const board = makeBoard();
        await LifecycleSession.activateForNote(board, {});
        await LifecycleSession.activateForNote(board, null);

        assert.equal(board.active, false);
        assert.equal(board.docOwner, null);
        assert.equal(board.history.count, 0);
    });

    it('enters note canvas mode and normalizes the note canvas document', async () => {
        const board = makeBoard();
        const item = { id: 'note-1', canvas: null };
        const { patches } = entryStubs();

        await withStubs(patches, () => LifecycleSession.activateForNote(board, item));

        assert.equal(board.docOwner, 'note');
        assert.equal(board.isNoteCanvasMode, true);
        assert.equal(board.isFlowchartMode, false);
        assert.equal(board.flowchartItem, null);
        assert.equal(board.activeNoteId, 'note-1');
        assert.equal(board.noteCanvasItem, item);
        assert.ok(Array.isArray(board.doc.pages), 'normalizeNoteCanvas produced a document');
        assert.equal(called(board, 'redrawBackground'), 1, 'note canvas repaints the background layer');
        assert.equal(called(board, 'bindFlowBendEvents'), 0, 'flow bend wiring is flowchart-only');
    });
});

describe('drawingBoard lifecycle — openNoteFlowchart', () => {
    it('creates the flowchart on first use and forces a snapped dot grid', async () => {
        const board = makeBoard();
        const item = { id: 'note-1' };
        const { patches } = entryStubs();

        await withStubs(patches, () => LifecycleSession.openNoteFlowchart(board, item));

        assert.ok(item.flowchart, 'a flowchart was created lazily');
        assert.equal(item.flowchartHidden, false);
        assert.equal(board.docOwner, 'flowchart');
        assert.equal(board.isFlowchartMode, true);
        assert.equal(board.isNoteCanvasMode, false);
        assert.equal(board.noteCanvasItem, null);
        assert.equal(board.flowchartItem, item);
        assert.equal(board.flowchartRouting, 'straight');
        assert.equal(board.activeNoteId, 'note-1');
        assert.equal(board.activeTool, 'rect', 'new diagrams open with a shape tool');
        assert.equal(board.brandEl.textContent, 'magicCanvas · Flowchart');
        assert.equal(item.flowchart.grid.type, 'dots');
        assert.equal(item.flowchart.grid.snap, true);
        assert.equal(item.flowchart.grid.visible, true);
        assert.equal(board.doc, item.flowchart.doc);
        assert.equal(called(board, 'redrawBackground'), 1);
    });

    it('normalizes an existing malformed flowchart and clamps the grid size', async () => {
        const board = makeBoard();
        const item = { id: 'note-2', flowchart: { version: 1, doc: null, grid: { size: 0, snap: false, visible: false } } };
        const { patches } = entryStubs();

        await withStubs(patches, () => LifecycleSession.openNoteFlowchart(board, item));

        assert.ok(item.flowchart.doc && Array.isArray(item.flowchart.doc.pages));
        assert.equal(item.flowchart.grid.size, 8, 'size 0 snaps to the smallest grid step');
        assert.equal(item.flowchart.grid.snap, true, 'snap is forced on entry');
        assert.equal(item.flowchart.grid.visible, true);
        assert.equal(item.flowchartHidden, undefined, 'an existing flowchart keeps its hidden flag');
    });

    it('falls back to the default grid size when normalization yields no size', async () => {
        const board = makeBoard();
        const item = { id: 'note-3', flowchart: null };
        const { patches } = entryStubs();

        await withStubs(patches, () => LifecycleSession.openNoteFlowchart(board, item));

        assert.equal(item.flowchart.grid.size, 24);
        assert.equal(item.flowchart.grid.type, 'dots');
    });

    it('ignores items without an id', async () => {
        const board = makeBoard();
        await LifecycleSession.openNoteFlowchart(board, {});
        assert.equal(board.active, false);
        assert.equal(board.docOwner, null);
    });
});

describe('drawingBoard lifecycle — exit routing', () => {
    it('exitNoteCanvas is a no-op outside note canvas mode', async () => {
        const board = makeBoard();
        await withWindow(async (events) => {
            LifecycleSession.exitNoteCanvas(board);
            assert.equal(events.length, 0);
        });
    });

    it('exitNoteCanvas re-dispatches the note so the host can return to the note view', async () => {
        const item = { id: 'note-1' };
        const board = makeBoard({ isNoteCanvasMode: true, noteCanvasItem: item });
        await withWindow(async (events) => {
            LifecycleSession.exitNoteCanvas(board);
            assert.equal(events.length, 1);
            assert.equal(events[0].type, 'note:canvas_draw_exited');
            assert.equal(events[0].detail.item, item);
        });
    });

    it('exitFlowchart dispatches only while in flowchart mode', async () => {
        const item = { id: 'flow-1' };
        await withWindow(async (events) => {
            LifecycleSession.exitFlowchart(makeBoard({ isFlowchartMode: false, flowchartItem: item }));
            assert.equal(events.length, 0);
            LifecycleSession.exitFlowchart(makeBoard({ isFlowchartMode: true, flowchartItem: item }));
            assert.equal(events.length, 1);
            assert.equal(events[0].detail.item, item);
        });
    });

    it('exitFromToolbar prefers flowchart mode over note canvas mode', () => {
        const both = makeBoard({ isFlowchartMode: true, isNoteCanvasMode: true });
        LifecycleSession.exitFromToolbar(both);
        assert.deepEqual(both.calls, [['exitFlowchart']]);

        const noteOnly = makeBoard({ isNoteCanvasMode: true });
        LifecycleSession.exitFromToolbar(noteOnly);
        assert.deepEqual(noteOnly.calls, [['exitNoteCanvas']]);

        const idle = makeBoard();
        LifecycleSession.exitFromToolbar(idle);
        assert.deepEqual(idle.calls, [], 'idle boards route nowhere');
    });
});


describe('drawingBoard lifecycle — deactivate', () => {
    it('is a no-op for an already idle board', async () => {
        const board = makeBoard({ active: false, docOwner: null });
        await LifecycleSession.deactivate(board);
        assert.equal(called(board, 'flushSave'), 0);
        assert.equal(board.selectedStrokes.size, 2, 'teardown did not run');
    });

    it('flushes the save, tears down the chrome and clears every session flag', async () => {
        const board = makeBoard({ active: true, docOwner: 'note', isNoteCanvasMode: true, textLayer: makeEl() });
        const textLayer = board.textLayer;
        const { seen, patches } = entryStubs();
        const closed = { color: 0, menu: 0, hand: null };
        const timer = setTimeout(() => {}, 0);

        await withStubs([
            ...patches,
            [ColorPicker, 'close', () => { closed.color += 1; }],
            [DrawingToolbarMenu, 'close', () => { closed.menu += 1; }],
            [CanvasViewport, 'setHandMode', (on) => { closed.hand = on; }]
        ], async () => {
            board.saveTimer = timer;
            await LifecycleSession.deactivate(board);
        });

        assert.equal(board.active, false);
        assert.equal(called(board, 'flushSave'), 1, 'the pending save is flushed before teardown');
        assert.equal(board.saveTimer, null);
        assert.equal(closed.color, 1);
        assert.equal(closed.menu, 1);
        assert.equal(seen.hide, 1, 'the floating chrome is hidden');
        assert.equal(closed.hand, false, 'hand mode is released');
        assert.equal(board.colorRolloutOpen, false);
        assert.equal(board.bgColorRolloutOpen, false);
        assert.equal(board.brandEl.textContent, 'magicNotes');
        assert.equal(board.boardEl.classList.contains('is-hidden'), true);
        assert.equal(board.boardEl.attrs['aria-hidden'], 'true');
        assert.equal(textLayer.innerHTML, '', 'the text layer is emptied');
        assert.equal(board.toolbarEl, null);
        assert.equal(board.draftStroke, null);
        assert.equal(board.shapePreview, null);
        assert.equal(board.resizeHandle, null);
        assert.equal(board.resizeStart, null);
        assert.equal(board.cropState, null);
        assert.equal(board.hoverHandle, null);
        assert.equal(board.selectedStrokes.size, 0);
        assert.equal(board.isNoteCanvasMode, false);
        assert.equal(board.isFlowchartMode, false);
        assert.equal(board.activeNoteId, null);
        assert.equal(board.noteCanvasItem, null);
        assert.equal(board.flowchartItem, null);
        assert.equal(board.doc, null);
        assert.equal(board.docOwner, null);
        assert.equal(board.history.count, 1);
        assert.equal(board.eraseHistoryPushed, false, 'gesture history flags must not leak');
        assert.equal(board.bgColorHistoryPushed, false);
        assert.equal(called(board, 'updateNoteToolbarChrome'), 1);

        clearTimeout(timer);
    });

    it('tolerates a board that never mounted the text layer', async () => {
        const board = makeBoard({ active: true, textLayer: null });
        const { patches } = entryStubs();
        const closed = { color: 0, menu: 0 };
        await withStubs([
            ...patches,
            [ColorPicker, 'close', () => { closed.color += 1; }],
            [DrawingToolbarMenu, 'close', () => { closed.menu += 1; }]
        ], () => LifecycleSession.deactivate(board));

        assert.equal(board.docOwner, null);
        assert.equal(called(board, 'flushSave'), 1);
    });
});

describe('drawingBoard lifecycle — hideToolbar', () => {
    it('collapses the floating chrome', async () => {
        const board = makeBoard();
        let collapsed = 0;
        await withStubs([[DrawingToolbarChrome, 'collapse', () => { collapsed += 1; }]], () => {
            LifecycleSession.hideToolbar(board);
        });
        assert.equal(collapsed, 1);
    });
});

