// test/drawingBoardClipboardPng.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    CLIP_MIME,
    clipboardWriteState,
    renderSelectionPng,
    resetClipboardSessionForTests,
    writePortableClipboard
} from '../js/drawingBoardClipboard.js';
import { CanvasViewport } from '../js/canvasViewport.js';

function makeCtxProxy() {
    return new Proxy({}, {
        get(t, k) {
            if (k === 'canvas') return { width: 0, height: 0 };
            if (k === 'measureText') return () => ({ width: 10 });
            if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
            if (typeof k === 'string' && k in t) return t[k];
            const fn = () => undefined;
            t[k] = fn;
            return fn;
        },
        set(t, k, v) { t[k] = v; return true; }
    });
}

function makeCanvasStub(blob) {
    return {
        width: 0, height: 0,
        getContext() { if (!this._ctx) this._ctx = makeCtxProxy(); return this._ctx; },
        toBlob(cb) { cb(blob); }
    };
}

const PNG_BLOB = { type: 'image/png' };
function payloadOf() {
    return {
        strokes: [{ id: 's', tool: 'pen', points: [{ x: 10, y: 10 }, { x: 40, y: 40 }], color: '#000', width: 4 }],
        texts: [{ id: 't', tool: 'text', x: 10, y: 10, text: 'hi', fontSize: 24, color: '#000' }]
    };
}

function installCanvas(blob = PNG_BLOB) {
    let canvasStub = null;
    globalThis.document = { createElement: () => { canvasStub = makeCanvasStub(blob); return canvasStub; } };
    globalThis.window = { devicePixelRatio: 1 };
    globalThis.__canvasStub = () => canvasStub;
}

function installWrite({ failOnCustom = false, failAll = false } = {}) {
    const calls = [];
    globalThis.ClipboardItem = class {
        constructor(map) { this.map = map; }
        get types() { return Object.keys(this.map); }
    };
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: {
            clipboard: {
                async write(items) {
                    const kinds = Object.keys((items && items[0] && items[0].map) || {});
                    calls.push(kinds);
                    if (failAll) throw new Error('everything unsupported');
                    if (failOnCustom && kinds.includes(CLIP_MIME)) throw new Error('custom unsupported');
                }
            }
        }
    });
    return calls;
}

beforeEach(() => { CanvasViewport.scale = 2; resetClipboardSessionForTests(); });
afterEach(() => {
    CanvasViewport.scale = 1;
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.__canvasStub;
    delete globalThis.ClipboardItem;
    delete globalThis.navigator;
});

describe('renderSelectionPng', () => {
    it('returns null when there is no DOM/canvas', async () => {
        globalThis.document = undefined;
        const out = await renderSelectionPng({}, payloadOf());
        assert.equal(out, null);
    });

    it('renders a png blob sized to the selection, images included without throwing', async () => {
        installCanvas(PNG_BLOB);
        const p = payloadOf();
        p.images = [{ id: 'i', tool: 'image', mediaId: 'm', x: 0, y: 0, width: 10, height: 10 }];
        const out = await renderSelectionPng({}, p);
        assert.ok(out);
        assert.equal(out.type, 'image/png');
        assert.ok(globalThis.__canvasStub().width > 0, 'canvas sized to selection bounds');
        assert.ok(globalThis.__canvasStub().height > 0);
    });
});

describe('writePortableClipboard', () => {
    it('writes one composite item with custom MIME, image/png and text/plain', async () => {
        installCanvas(PNG_BLOB);
        const calls = installWrite();
        await writePortableClipboard({}, payloadOf());
        assert.equal(calls.length, 1, 'exactly one write');
        assert.ok(calls[0].includes(CLIP_MIME), 'editable objects');
        assert.ok(calls[0].includes('image/png'), 'portable picture');
        assert.ok(calls[0].includes('text/plain'), 'marker sentinel');
    });

    it('keeps the marker when the composite write is rejected (custom web types refused)', async () => {
        installCanvas(PNG_BLOB);
        const calls = installWrite({ failOnCustom: true });
        await writePortableClipboard({}, payloadOf());
        assert.ok(calls.length >= 2, 'composite attempt, then narrower entries');
        // Defect 2: dropping to png-only made the clipboard unrecognisable at paste
        // time, so copies were staged in the media library. The marker must survive.
        assert.deepEqual(calls[calls.length - 1], ['text/plain', 'image/png'], 'marker + picture, no custom MIME');
        assert.equal(clipboardWriteState(), 'done');
    });

    it('keeps the marker when png rendering is unavailable and custom is rejected', async () => {
        globalThis.document = undefined;            // no canvas → png is null
        const calls = installWrite({ failOnCustom: true });
        await writePortableClipboard({}, payloadOf());
        assert.deepEqual(calls[calls.length - 1], ['text/plain'], 'marker alone is still a board copy');
        assert.equal(clipboardWriteState(), 'done');
    });

    it('records writeState failed only when every representation is refused', async () => {
        installCanvas(PNG_BLOB);
        const calls = installWrite({ failAll: true });
        await writePortableClipboard({}, payloadOf());
        assert.deepEqual(calls[calls.length - 1], ['image/png'], 'last rung is the plain picture');
        assert.equal(calls.length, 5, 'one attempt per rung');
        assert.equal(clipboardWriteState(), 'failed');
    });

    it('no-ops safely when the clipboard write API is unavailable', async () => {
        installCanvas(PNG_BLOB);
        Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
        await writePortableClipboard({}, payloadOf()); // must not throw
        assert.equal(clipboardWriteState(), 'failed');
    });
});

