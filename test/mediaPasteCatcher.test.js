// test/mediaPasteCatcher.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MediaPasteCatcher, shouldYieldBoardPaste } from '../js/mediaPasteCatcher.js';
import {
    CLIP_MIME,
    bindBoard,
    handleCopyKey,
    handlePasteKey,
    markPasteOwned,
    pasteEventIsOwned,
    resetClipboardSessionForTests
} from '../js/drawingBoardClipboard.js';

/** Capture-phase paste listeners registered on the stub document, in order. */
let pasteListeners = [];

function installDomStub(activeElement = null) {
    pasteListeners = [];
    const makeEl = () => ({
        className: '', id: '', textContent: '',
        setAttribute() {}, appendChild() {}, remove() {},
        classList: { add() {}, remove() {}, contains: () => false },
        childElementCount: 0
    });
    globalThis.document = {
        activeElement,
        body: { appendChild() {} },
        createElement: makeEl,
        getElementById: () => null,
        querySelector: () => null,
        addEventListener(type, fn) { if (type === 'paste') pasteListeners.push(fn); },
        removeEventListener() {}
    };
    globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    globalThis.requestAnimationFrame = (fn) => { fn(); };
    globalThis.window = { setTimeout: () => 0 };
}

function makeBoard({ active = true } = {}) {
    return {
        active,
        doc: { version: 2, canvasMode: 'a4', activePageId: 'p1', pages: [{ id: 'p1', strokes: [], texts: [], images: [] }] },
        selectedStrokes: new Set(),
        canvas: null,
        strokes() { return this.doc.pages[0].strokes; },
        setStrokes(s) { this.doc.pages[0].strokes = s; },
        images() { return this.doc.pages[0].images; },
        setImages(i) { this.doc.pages[0].images = i; },
        getSelectedStrokesArray() { return Array.from(this.selectedStrokes); },
        pushLayerHistory() {},
        scheduleSave() {},
        redraw() {},
        updateToolbarState() {},
        expandInfiniteIfNeeded() {}
    };
}

const MARKER = '\u27e6MagicLists canvas\u27e7 1 object(s)';

function clipboardEvent({ types = [], text = '', files = [] } = {}) {
    const calls = { preventDefault: 0, stopPropagation: 0, stopImmediatePropagation: 0 };
    return {
        defaultPrevented: false,
        calls,
        preventDefault() { calls.preventDefault += 1; this.defaultPrevented = true; },
        stopPropagation() { calls.stopPropagation += 1; },
        stopImmediatePropagation() { calls.stopImmediatePropagation += 1; },
        clipboardData: { types, files, items: [], getData: (t) => (t === 'text/plain' ? text : '') }
    };
}

/** Exactly what the board puts on the clipboard: custom MIME + marker + png. */
function boardPasteEvent() {
    return clipboardEvent({
        types: [CLIP_MIME, 'text/plain', 'image/png'],
        text: MARKER,
        files: [{ type: 'image/png', name: 'canvas.png' }]
    });
}

/** Ordinary screenshot paste: one image file and nothing of ours. */
function imageFileEvent() {
    return clipboardEvent({ types: ['image/png'], files: [{ type: 'image/png', name: 'photo.png' }] });
}

function plainImageEvent() {
    return clipboardEvent({ types: ['image/png'] });
}

beforeEach(() => {
    resetClipboardSessionForTests();
    installDomStub();
});

describe('shouldYieldBoardPaste', () => {
    it('yields for a custom-MIME paste while the board is active', () => {
        bindBoard(makeBoard());
        assert.equal(shouldYieldBoardPaste(clipboardEvent({ types: [CLIP_MIME] })), true);
    });

    it('yields for the text marker with no arm at all (context-menu paste)', () => {
        bindBoard(makeBoard());
        assert.equal(shouldYieldBoardPaste(clipboardEvent({ types: ['text/plain'], text: MARKER })), true);
    });

    it('yields for an event the board already handled', () => {
        bindBoard(makeBoard());
        const e = plainImageEvent();
        assert.equal(shouldYieldBoardPaste(e), false);
        markPasteOwned(e);
        assert.equal(pasteEventIsOwned(e), true);
        assert.equal(shouldYieldBoardPaste(e), true, 'marked event is never staged even without board markers');
    });

    it('leaves ordinary image pastes to the media catcher', () => {
        bindBoard(makeBoard());
        assert.equal(shouldYieldBoardPaste(imageFileEvent()), false);
        assert.equal(shouldYieldBoardPaste(plainImageEvent()), false);
    });

    it('never yields when the board is not active (notes mode)', () => {
        bindBoard(makeBoard({ active: false }));
        assert.equal(shouldYieldBoardPaste(boardPasteEvent()), false);
    });

    it('never yields while a text editor has focus', () => {
        bindBoard(makeBoard());
        installDomStub({ tagName: 'TEXTAREA' });
        assert.equal(shouldYieldBoardPaste(boardPasteEvent()), false);
    });

    it('is exposed on the MediaPasteCatcher facade', () => {
        assert.equal(MediaPasteCatcher.shouldYieldBoardPaste, shouldYieldBoardPaste);
    });
});

describe('listener order (board static-imports first, catcher in App.init)', () => {
    it('a board copy is never staged, and only the board touches the event', () => {
        bindBoard(makeBoard());
        MediaPasteCatcher.init();
        assert.equal(pasteListeners.length, 2, 'both capture listeners registered');
        const e = boardPasteEvent();
        for (const fn of pasteListeners) fn(e);   // real dispatch order
        assert.equal(e.calls.preventDefault, 1, 'prevented exactly once (by the board)');
        assert.equal(e.calls.stopPropagation, 0, 'the catcher yielded instead of staging');
        assert.equal(e.calls.stopImmediatePropagation, 1);
    });

    it('an ordinary image paste still reaches the media catcher', () => {
        bindBoard(makeBoard());
        MediaPasteCatcher.init();
        const e = imageFileEvent();
        for (const fn of pasteListeners) fn(e);
        assert.equal(e.calls.stopPropagation, 1, 'catcher handled it (staging path)');
    });

    it('a board copy made on this tab is never staged even with the clipboard read failing', async () => {
        const b = makeBoard();
        bindBoard(b);
        MediaPasteCatcher.init();
        const stroke = { id: 's1', tool: 'pen', points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], color: '#fff', width: 3 };
        b.doc.pages[0].strokes.push(stroke);
        b.selectedStrokes.add(stroke);
        handleCopyKey(b, { key: 'c', ctrlKey: true, preventDefault() {} });
        handlePasteKey(b, { key: 'v', ctrlKey: true, preventDefault() {} });
        const e = boardPasteEvent();
        for (const fn of pasteListeners) fn(e);
        assert.equal(e.calls.stopPropagation, 0, 'board payload never enters staging');
        assert.equal(b.doc.pages[0].strokes.length, 2, 'local payload pasted on the board');
        await new Promise((r) => setTimeout(r, 20));
        assert.equal(e.calls.stopPropagation, 0, 'still not staged after the async read settles');
    });
});
