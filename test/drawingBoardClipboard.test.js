// test/drawingBoardClipboard.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLIP_MIME,
    boardOwnsPasteEvent,
    clipboardWriteState,
    eventHasBoardMime,
    markPasteOwned,
    pasteEventIsOwned,
    peekBoardPasteArmed,
    isTextEditingTarget,
    handleCopyKey,
    handleCutKey,
    handlePasteKey,
    handleDeleteKey,
    handlePasteEvent,
    pastePayload,
    pruneSelection,
    bindBoard,
    resetClipboardSessionForTests
} from '../js/drawingBoardClipboard.js';

// Minimal DOM stub — handlers call showAppToast which needs createElement/body/RAF.
// bindBoard skips listener registration because addEventListener is not defined.
function installDomStub(activeElement = null) {
    const makeEl = () => ({
        className: '', id: '', textContent: '',
        setAttribute() {}, appendChild() {}, remove() {},
        classList: { add() {}, remove() {}, contains: () => false },
        childElementCount: 1
    });
    globalThis.document = { activeElement, body: { appendChild() {} }, createElement: makeEl };
    globalThis.requestAnimationFrame = (fn) => { fn(); };
    globalThis.window = { setTimeout: () => 0 };
}

function makeBoard({ strokes = [], texts = [], images = [], active = true } = {}) {
    const page = { id: 'p1', format: 'a4', background: 'blank', strokes, texts, images };
    return {
        active,
        doc: {
            version: 2,
            canvasMode: 'a4',
            activePageId: 'p1',
            pages: [page],
            infinite: { strokes: [], texts: [], images: [], bounds: { minX: 0, minY: 0, maxX: 3000, maxY: 3000 } }
        },
        selectedStrokes: new Set(),
        historyPushes: 0,
        canvas: null,
        strokes() { return this.doc.pages[0].strokes; },
        setStrokes(s) { this.doc.pages[0].strokes = s; },
        images() { return this.doc.pages[0].images; },
        setImages(i) { this.doc.pages[0].images = i; },
        getSelectedStrokesArray() { return Array.from(this.selectedStrokes); },
        pushLayerHistory() { this.historyPushes += 1; },
        scheduleSave() {},
        redraw() {},
        updateToolbarState() {},
        expandInfiniteIfNeeded() {}
    };
}

function brush(id = 's1') {
    return { id, tool: 'pen', points: [{ x: 10, y: 10 }, { x: 40, y: 40 }], color: '#fff', width: 4 };
}
function shape(id, x0 = 100) {
    return { id, flowchartKind: 'shape', tool: 'rect', x0, y0: 100, x1: x0 + 100, y1: 160, color: '#fff', width: 3, style: 'pen', label: null };
}
function connector(fromId, toId) {
    return {
        id: 'conn_' + fromId + '_' + toId, flowchartKind: 'connector', tool: 'connector', routing: 'straight',
        from: { shapeId: fromId, port: 'e' }, to: { shapeId: toId, port: 'w' },
        x0: 200, y0: 130, x1: 300, y1: 130, color: '#fff', width: 3, style: 'pen', label: null
    };
}
function textItem(id = 't1') {
    return { id, tool: 'text', x: 10, y: 10, text: 'hello', fontSize: 24, color: '#000', fontFamily: 'Inter' };
}
function imageItem(id = 'img1', mediaId = 'media-1') {
    return { id, tool: 'image', mediaId, x: 50, y: 50, width: 100, height: 80, naturalWidth: 200, naturalHeight: 160 };
}

function keyEvent(key, { ctrl = true } = {}) {
    return { key, ctrlKey: ctrl, metaKey: false, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
}

function markerEvent(count) {
    const text = `⟦MagicLists canvas⟧ ${count} object(s)`;
    return {
        defaultPrevented: false,
        preventDefault() { this.defaultPrevented = true; },
        clipboardData: { getData: (t) => (t === 'text/plain' ? text : ''), types: ['text/plain'] }
    };
}

function payload(...items) {
    const p = { app: 'magiclists', v: 1, strokes: [], texts: [], images: [] };
    for (const item of items) {
        if (item.tool === 'image') p.images.push(item);
        else if (item.tool === 'text') p.texts.push(item);
        else p.strokes.push(item);
    }
    return p;
}

beforeEach(() => {
    resetClipboardSessionForTests();
    installDomStub(null);
});

describe('eventHasBoardMime', () => {
    it('detects the custom MIME type', () => {
        const e = { clipboardData: { types: ['text/plain', CLIP_MIME] } };
        assert.equal(eventHasBoardMime(e), true);
    });
    it('rejects plain-clipboard events', () => {
        assert.equal(eventHasBoardMime({ clipboardData: { types: ['text/plain'] } }), false);
        assert.equal(eventHasBoardMime({ clipboardData: null }), false);
        assert.equal(eventHasBoardMime({}), false);
    });
});

describe('isTextEditingTarget', () => {
    it('true for inputs, textareas and contentEditable', () => {
        installDomStub({ tagName: 'INPUT' });
        assert.equal(isTextEditingTarget(), true);
        installDomStub({ tagName: 'TEXTAREA' });
        assert.equal(isTextEditingTarget(), true);
        installDomStub({ tagName: 'DIV', isContentEditable: true });
        assert.equal(isTextEditingTarget(), true);
    });
    it('false for body / no focus', () => {
        installDomStub({ tagName: 'BODY', isContentEditable: false });
        assert.equal(isTextEditingTarget(), false);
        installDomStub(null);
        assert.equal(isTextEditingTarget(), false);
    });
});

describe('handlePasteKey arm contract', () => {
    it('arms only when board active and not editing text', () => {
        const b = makeBoard();
        assert.equal(handlePasteKey(b, keyEvent('v')), true);
        assert.equal(peekBoardPasteArmed(), true);
        resetClipboardSessionForTests();
        assert.equal(handlePasteKey(makeBoard({ active: false }), keyEvent('v')), false);
        assert.equal(peekBoardPasteArmed(), false);
        resetClipboardSessionForTests();
        installDomStub({ tagName: 'DIV', isContentEditable: true });
        assert.equal(handlePasteKey(makeBoard(), keyEvent('v')), false);
        assert.equal(peekBoardPasteArmed(), false);
    });
    it('copy does NOT arm (paste arms, copy does not)', () => {
        const b = makeBoard({ strokes: [brush()] });
        b.selectedStrokes.add(b.strokes()[0]);
        handleCopyKey(b, keyEvent('c'));
        assert.equal(peekBoardPasteArmed(), false);
    });
});

describe('handleCopyKey', () => {
    it('serializes a mixed selection, prevents default, stores local payload', () => {
        const b = makeBoard({ strokes: [brush()], texts: [textItem()], images: [imageItem()] });
        for (const item of [...b.strokes(), ...b.doc.pages[0].texts, ...b.images()]) b.selectedStrokes.add(item);
        const e = keyEvent('c');
        assert.equal(handleCopyKey(b, e), true);
        assert.equal(e.defaultPrevented, true);
        assert.equal(b._boardClipboard.strokes.length, 1);
        assert.equal(b._boardClipboard.texts.length, 1);
        assert.equal(b._boardClipboard.images.length, 1);
        assert.ok(Date.now() - b._clipboardTimestamp < 1000);
    });
    it('silent no-op on empty selection (no preventDefault, no payload)', () => {
        const b = makeBoard({ strokes: [brush()] });
        const e = keyEvent('c');
        assert.equal(handleCopyKey(b, e), false);
        assert.equal(e.defaultPrevented, false);
        assert.equal(b._boardClipboard, undefined);
    });
    it('yields to the browser while a text editor is focused', () => {
        const b = makeBoard({ strokes: [brush()] });
        b.selectedStrokes.add(b.strokes()[0]);
        installDomStub({ tagName: 'DIV', isContentEditable: true });
        const e = keyEvent('c');
        assert.equal(handleCopyKey(b, e), false);
        assert.equal(e.defaultPrevented, false);
    });
    it('no-op when board inactive', () => {
        const b = makeBoard({ strokes: [brush()], active: false });
        b.selectedStrokes.add(b.strokes()[0]);
        assert.equal(handleCopyKey(b, keyEvent('c')), false);
    });
});

describe('handleCutKey', () => {
    it('copies then removes selection in ONE history entry', () => {
        const extra = brush('s2');
        const b = makeBoard({ strokes: [brush('s1'), extra] });
        b.selectedStrokes.add(b.strokes()[0]);
        const e = keyEvent('x');
        assert.equal(handleCutKey(b, e), true);
        assert.equal(e.defaultPrevented, true);
        assert.equal(b.historyPushes, 1);
        assert.equal(b.strokes().length, 1);
        assert.equal(b.strokes()[0], extra);
        assert.equal(b.selectedStrokes.size, 0);
        assert.equal(b._boardClipboard.strokes.length, 1);
    });
    it('removes connectors attached to cut shapes (no orphans)', () => {
        const a = shape('shapeA');
        const bst = shape('shapeB', 300);
        const conn = connector('shapeA', 'shapeB');
        const b = makeBoard({ strokes: [a, bst, conn] });
        b.selectedStrokes.add(a);
        handleCutKey(b, keyEvent('x'));
        assert.equal(b.strokes().length, 1, 'shapeB kept, shapeA + attached connector removed');
        assert.equal(b.strokes()[0], bst);
        assert.equal(b.historyPushes, 1);
    });
    it('keeps connectors attached to shapes that were NOT cut', () => {
        const a = shape('shapeA');
        const bst = shape('shapeB', 300);
        const conn = connector('shapeA', 'shapeB');
        const b = makeBoard({ strokes: [a, bst, conn] });
        const unrelated = brush('s9');
        b.strokes().push(unrelated);
        b.selectedStrokes.add(unrelated);
        handleCutKey(b, keyEvent('x'));
        assert.equal(b.strokes().length, 3, 'connector survives — neither attached shape was cut');
    });
    it('silent no-op with empty selection', () => {
        const b = makeBoard();
        const e = keyEvent('x');
        assert.equal(handleCutKey(b, e), false);
        assert.equal(e.defaultPrevented, false);
        assert.equal(b.historyPushes, 0);
    });
});

describe('handleDeleteKey', () => {
    it('deletes selection in one entry and drops connectors on deleted shapes', () => {
        const a = shape('shapeA');
        const bst = shape('shapeB', 300);
        const conn = connector('shapeA', 'shapeB');
        const b = makeBoard({ strokes: [a, bst, conn] });
        b.selectedStrokes.add(a);
        const e = keyEvent('Delete', { ctrl: false });
        assert.equal(handleDeleteKey(b, e), true);
        assert.equal(e.defaultPrevented, true);
        assert.equal(b.historyPushes, 1);
        assert.deepEqual(b.strokes(), [bst]);
        assert.equal(b.selectedStrokes.size, 0);
    });
    it('no-op with empty selection or inactive board', () => {
        const b = makeBoard({ strokes: [brush()] });
        assert.equal(handleDeleteKey(b, keyEvent('Backspace', { ctrl: false })), false);
        assert.equal(b.historyPushes, 0);
        const inactive = makeBoard({ strokes: [brush()], active: false });
        inactive.selectedStrokes.add(inactive.strokes()[0]);
        assert.equal(handleDeleteKey(inactive, keyEvent('Delete', { ctrl: false })), false);
    });
    it('yields to text editors (Backspace must edit text)', () => {
        const b = makeBoard({ strokes: [brush()] });
        b.selectedStrokes.add(b.strokes()[0]);
        installDomStub({ tagName: 'TEXTAREA' });
        assert.equal(handleDeleteKey(b, keyEvent('Backspace', { ctrl: false })), false);
        assert.equal(b.strokes().length, 1);
    });
});

describe('handlePasteEvent', () => {
    it('unarmed plain-text paste is ignored (notes-mode / browser territory)', () => {
        const b = makeBoard({ strokes: [brush()] });
        bindBoard(b);
        const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, clipboardData: { types: ['text/plain'], getData: () => 'just text' } };
        handlePasteEvent(e);
        assert.equal(b.strokes().length, 1);
        assert.equal(b.historyPushes, 0);
        assert.equal(e.defaultPrevented, false);
    });

    it('unarmed board-marker paste is owned (context-menu / programmatic paste)', () => {
        const b = makeBoard({ strokes: [brush()] });
        bindBoard(b);
        const e = markerEvent(1);
        handlePasteEvent(e);
        // Defect 3b: a paste with no keydown arm used to be dropped outright, so the
        // payload fell through to the media catcher. Ownership is marker-based now.
        assert.equal(e.defaultPrevented, true, 'a board copy must never reach the staging dialog');
        assert.equal(pasteEventIsOwned(e), true);
        assert.equal(b.strokes().length, 1, 'no local payload on this tab → nothing to paste');
    });

    it('marker paste: fresh ids, +20 offset, selection replaced, one history entry', () => {
        const src = brush('src1');
        const b = makeBoard({ strokes: [src] });
        bindBoard(b);
        b._boardClipboard = payload(brush('src1'));
        b._clipboardTimestamp = Date.now();
        assert.equal(handlePasteKey(b, keyEvent('v')), true);
        const e = markerEvent(1);
        handlePasteEvent(e);
        assert.equal(e.defaultPrevented, true);
        assert.equal(b.strokes().length, 2);
        assert.equal(b.historyPushes, 1);
        const pasted = b.strokes()[1];
        assert.notEqual(pasted.id, 'src1', 'paste gets a fresh id');
        assert.equal(pasted.points[0].x, 30, '10 + 20 cascade offset');
        assert.equal(pasted.points[0].y, 30);
        assert.equal(b.selectedStrokes.size, 1);
        assert.ok(b.selectedStrokes.has(pasted), 'selection replaced by pasted items');
    });

    it('cascade: second paste +40, copy resets back to +20', () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        const p = payload(brush('src1'));
        b._boardClipboard = p;
        b._clipboardTimestamp = Date.now();
        handlePasteKey(b, keyEvent('v'));
        handlePasteEvent(markerEvent(1));
        handlePasteKey(b, keyEvent('v'));
        handlePasteEvent(markerEvent(1));
        assert.equal(b.strokes().length, 3);
        assert.equal(b.strokes()[1].points[0].x, 30, 'first paste +20');
        assert.equal(b.strokes()[2].points[0].x, 50, 'second paste +40');
        // copy resets the cascade
        b.selectedStrokes.clear();
        b.selectedStrokes.add(b.strokes()[0]);
        handleCopyKey(b, keyEvent('c'));
        handlePasteKey(b, keyEvent('v'));
        handlePasteEvent(markerEvent(1));
        assert.equal(b.strokes()[3].points[0].x, 30, 'after copy, cascade restarts at +20');
    });

    it('re-entrancy: the same event object pastes once', () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        b._boardClipboard = payload(brush('src1'));
        b._clipboardTimestamp = Date.now();
        handlePasteKey(b, keyEvent('v'));
        const e = markerEvent(1);
        handlePasteEvent(e);
        handlePasteEvent(e);            // same instance: second capture listener or re-dispatch
        assert.equal(b.strokes().length, 2);
        assert.equal(b.historyPushes, 1);
    });

    it('each distinct paste event pastes once (one paste action = one event)', () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        b._boardClipboard = payload(brush('src1'));
        b._clipboardTimestamp = Date.now();
        // Deliberate change: ownership no longer rides on the one-shot arm token — a
        // board payload is identified by its own marker, which is what makes menu and
        // unarmed pastes work. Brackets fire exactly one paste event per action, so
        // two events mean two pastes.
        handlePasteKey(b, keyEvent('v'));
        handlePasteEvent(markerEvent(1));
        handlePasteEvent(markerEvent(1));
        assert.equal(b.strokes().length, 3);
        assert.equal(b.historyPushes, 2);
    });

    it('marker count mismatch is rejected (Issue 4 anti-collision)', () => {
        const b = makeBoard({ strokes: [brush()] });
        bindBoard(b);
        b._boardClipboard = payload(brush('x'), brush('y'));   // total 2
        b._clipboardTimestamp = Date.now();
        handlePasteKey(b, keyEvent('v'));
        const e = markerEvent(99);
        handlePasteEvent(e);
        assert.equal(b.strokes().length, 1, 'stale/foreign marker ignored');
        // Owned but not pasted: a wrong paste is worse than a toast, and the payload
        // must still not be handed to the media catcher (that was the bug).
        assert.equal(e.defaultPrevented, true);
        assert.equal(pasteEventIsOwned(e), true);
    });

    it('mismatched marker is not rescued by the same-tab trust window (anti-collision)', () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        b.selectedStrokes.add(b.strokes()[0]);
        handleCopyKey(b, keyEvent('c'));      // writeState pending/failed → trust window open
        handlePasteKey(b, keyEvent('v'));
        const e = markerEvent(99);            // another tab's copy: count does not describe ours
        handlePasteEvent(e);
        assert.equal(b.strokes().length, 1, 'never paste a payload the marker does not describe');
        assert.equal(e.defaultPrevented, true);
    });

    it('custom MIME path: preventDefault + async read falls back to fresh local payload', async () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        b._boardClipboard = payload(brush('src1'));
        b._clipboardTimestamp = Date.now();
        handlePasteKey(b, keyEvent('v'));
        const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, clipboardData: { types: [CLIP_MIME] } };
        handlePasteEvent(e);
        assert.equal(e.defaultPrevented, true, 'board payload must never reach text fields');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(b.strokes().length, 2, 'read rejected in Node → fresh local fallback pastes');
        assert.equal(b.historyPushes, 1);
    });

    it('paste after deactivate is swallowed (in-flight read guard)', async () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        b._boardClipboard = payload(brush('src1'));
        b._clipboardTimestamp = Date.now();
        handlePasteKey(b, keyEvent('v'));
        b.active = false;                                  // user exited during async read
        const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, clipboardData: { types: [CLIP_MIME] } };
        handlePasteEvent(e);
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(b.strokes().length, 1, 'no paste into a deactivated doc');
        assert.equal(b.historyPushes, 0);
    });

    it('plain text paste (no board markers) is left alone', () => {
        const b = makeBoard({ strokes: [brush()] });
        bindBoard(b);
        handlePasteKey(b, keyEvent('v'));
        const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, clipboardData: { types: ['text/plain'], getData: () => 'just text' } };
        handlePasteEvent(e);
        assert.equal(b.strokes().length, 1);
        assert.equal(e.defaultPrevented, false, 'browser/catcher keeps ownership');
    });
});

describe('boardOwnsPasteEvent', () => {
    it('owns the custom MIME type', () => {
        bindBoard(makeBoard());
        assert.equal(boardOwnsPasteEvent({ clipboardData: { types: [CLIP_MIME] } }), true);
    });

    it('owns the text marker even without an arm (menu paste)', () => {
        bindBoard(makeBoard());
        assert.equal(boardOwnsPasteEvent(markerEvent(1)), true);
    });

    it('leaves ordinary file / text pastes to the media catcher', () => {
        bindBoard(makeBoard());
        assert.equal(boardOwnsPasteEvent({ clipboardData: { types: ['image/png'], getData: () => '' } }), false);
        assert.equal(boardOwnsPasteEvent({ clipboardData: { types: ['text/plain'], getData: () => 'hello' } }), false);
        assert.equal(boardOwnsPasteEvent({}), false);
    });

    it('owns nothing while the board is inactive', () => {
        bindBoard(makeBoard({ active: false }));
        assert.equal(boardOwnsPasteEvent({ clipboardData: { types: [CLIP_MIME] } }), false);
        assert.equal(boardOwnsPasteEvent(markerEvent(1)), false);
    });

    it('leaves the clipboard to a focused text editor', () => {
        bindBoard(makeBoard());
        installDomStub({ tagName: 'TEXTAREA' });
        assert.equal(boardOwnsPasteEvent({ clipboardData: { types: [CLIP_MIME] } }), false);
        assert.equal(boardOwnsPasteEvent(markerEvent(1)), false);
    });

    it('armed paste with writeState idle (no copy this session) is not owned', () => {
        const b = makeBoard({ strokes: [brush()] });
        bindBoard(b);
        handlePasteKey(b, keyEvent('v'));
        assert.equal(clipboardWriteState(), 'idle');
        assert.equal(boardOwnsPasteEvent({ clipboardData: { types: ['text/plain'], getData: () => 'typed' } }), false);
    });

    it('owns an armed artefact-less paste while the OS write is unconfirmed (fast Ctrl+C followed by Ctrl+V)', () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        b.selectedStrokes.add(b.strokes()[0]);
        handleCopyKey(b, keyEvent('c'));      // write starts → pending (failed in Node)
        handlePasteKey(b, keyEvent('v'));
        const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, clipboardData: { types: ['text/html'], getData: () => '' } };
        assert.equal(boardOwnsPasteEvent(e), true, 'the OS clipboard cannot hold this copy yet');
        handlePasteEvent(e);
        assert.equal(e.defaultPrevented, true);
        assert.equal(b.strokes().length, 2, 'local payload pasted without clipboard.read');
    });

    it('stops trusting the local payload after the 3s window (an external copy wins)', () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        b.selectedStrokes.add(b.strokes()[0]);
        handleCopyKey(b, keyEvent('c'));
        b._clipboardTimestamp = Date.now() - 4000;   // old enough that the copy is on the OS clipboard
        handlePasteKey(b, keyEvent('v'));
        const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, clipboardData: { types: ['text/plain'], getData: () => 'typed elsewhere' } };
        assert.equal(boardOwnsPasteEvent(e), false);
        handlePasteEvent(e);
        assert.equal(e.defaultPrevented, false);
        assert.equal(b.strokes().length, 1);
    });

    it('markPasteOwned is idempotent and keyed by event object', () => {
        const a = markerEvent(1);
        const other = markerEvent(1);
        markPasteOwned(a);
        markPasteOwned(a);
        assert.equal(pasteEventIsOwned(a), true);
        assert.equal(pasteEventIsOwned(other), false);
        assert.equal(pasteEventIsOwned(null), false);
    });
});

describe('clipboard write state', () => {
    it('idle until a copy, pending on the copy tick, failed when the write cannot land', async () => {
        const b = makeBoard({ strokes: [brush('src1')] });
        bindBoard(b);
        b.selectedStrokes.add(b.strokes()[0]);
        assert.equal(clipboardWriteState(), 'idle', 'rule 3 must be off before any copy');
        handleCopyKey(b, keyEvent('c'));
        assert.equal(clipboardWriteState(), 'pending', 'set synchronously so the same-tick paste sees it');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(clipboardWriteState(), 'failed', 'Node exposes no navigator.clipboard.write');
    });
});

describe('pastePayload connector + content rules', () => {
    it('remaps pasted shape ids in connector ends (no link back to originals)', () => {
        // Board lost shapeA (copied elsewhere); shapeB lives on canvas.
        const liveB = shape('shapeB', 300);
        const b = makeBoard({ strokes: [liveB] });
        const p = payload(shape('shapeA'), connector('shapeA', 'shapeB'));
        pastePayload(b, p);
        assert.equal(b.strokes().length, 3);
        const pastedShape = b.strokes().find((s) => s.flowchartKind === 'shape' && s.id !== 'shapeB');
        const conn = b.strokes().find((s) => s.flowchartKind === 'connector');
        assert.ok(pastedShape && pastedShape.id !== 'shapeA', 'shape pasted with fresh id');
        assert.equal(conn.from.shapeId, pastedShape.id, 'from.end follows the pasted copy');
        assert.equal(conn.to.shapeId, 'shapeB', 'to.end keeps the live original reference');
    });

    it('drops connectors when BOTH ends dangle', () => {
        const b = makeBoard({ strokes: [] });
        pastePayload(b, payload(connector('ghostA', 'ghostB')));
        assert.equal(b.strokes().length, 0, 'both-ends-dangling connector dropped');
        assert.equal(b.historyPushes, 0, 'nothing pasted → no empty undo entry');
    });

    it('keeps connectors copied alone when both ends reference live shapes', () => {
        const a = shape('shapeA');
        const bst = shape('shapeB', 300);
        const b = makeBoard({ strokes: [a, bst] });
        pastePayload(b, payload(connector('shapeA', 'shapeB')));
        assert.equal(b.strokes().length, 3);
        const conn = b.strokes()[2];
        assert.equal(conn.from.shapeId, 'shapeA');
        assert.equal(conn.to.shapeId, 'shapeB');
    });

    it('image-only payload pastes with fresh id and mediaId preserved (Gap 4 + issue guard)', () => {
        const b = makeBoard();
        pastePayload(b, payload(imageItem('imgSrc', 'media-99')));
        assert.equal(b.images().length, 1);
        const pasted = b.images()[0];
        assert.notEqual(pasted.id, 'imgSrc');
        assert.equal(pasted.mediaId, 'media-99', 'mediaId is never remapped');
        assert.equal(b.selectedStrokes.has(pasted), true);
    });

    it('text-only payload pastes (hasContent guard covers all three layers)', () => {
        const b = makeBoard();
        pastePayload(b, payload(textItem('tSrc')));
        assert.equal(b.doc.pages[0].texts.length, 1);
        assert.equal(b.historyPushes, 1);
    });

    it('empty payload is a no-op (no history entry)', () => {
        const b = makeBoard({ strokes: [brush()] });
        pastePayload(b, payload());
        assert.equal(b.strokes().length, 1);
        assert.equal(b.historyPushes, 0);
    });
});

describe('pruneSelection (undo ghost fix, Flaw 4)', () => {
    it('re-points selection to restored objects by id', () => {
        const b = makeBoard({ strokes: [brush('s1')] });
        const stale = { ...brush('s1') };                  // same id, different identity (post-clone)
        b.selectedStrokes.add(stale);
        pruneSelection(b);
        assert.equal(b.selectedStrokes.size, 1);
        assert.ok(b.selectedStrokes.has(b.strokes()[0]), 'selection points at the live object');
    });
    it('drops items whose ids no longer exist', () => {
        const b = makeBoard({ strokes: [brush('alive')] });
        b.selectedStrokes.add({ id: 'deleted' });
        b.selectedStrokes.add(b.strokes()[0]);
        pruneSelection(b);
        assert.equal(b.selectedStrokes.size, 1);
        assert.ok(b.selectedStrokes.has(b.strokes()[0]));
    });
});




