// test/drawingBoardPrefs.test.js
// js/drawingBoard/prefs.js owns matrix_drawing_prefs: the brush styles, the
// active tool and the active style. Anything that throws in here used to take
// the whole board down at import time (the prefs are read while the DrawingBoard
// literal is being built), so a corrupt or hostile localStorage payload must
// always resolve to usable defaults.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PREFS_KEY, readPrefs, writePrefs } from '../js/drawingBoard/prefs.js';
import { BRUSH_STYLES, DRAG_SHAPE_TOOLS } from '../js/canvasBrushes.js';
import { DEFAULT_WIDTH, HIGHLIGHTER_WIDTH } from '../js/drawingBoardCore.js';

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

describe('drawing board prefs', () => {
    it('uses the documented storage key', () => {
        assert.equal(PREFS_KEY, 'matrix_drawing_prefs');
    });

    it('returns defaults when nothing is stored', () => {
        withStorage(() => {
            const prefs = readPrefs();
            assert.equal(prefs.activeStyle, 'pen');
            assert.equal(prefs.activeTool, 'pointer');
            assert.deepEqual(Object.keys(prefs.styles).sort(), [...BRUSH_STYLES].sort());
            assert.equal(prefs.styles.pen.width, DEFAULT_WIDTH);
            assert.equal(prefs.styles.highlighter.width, HIGHLIGHTER_WIDTH);
            assert.equal(prefs.styles.pen.color, '#f8fafc');
        });
    });

    it('round-trips a written payload', () => {
        withStorage((store) => {
            writePrefs({
                activeStyle: 'marker',
                activeTool: 'line',
                styles: { pen: { width: 7, color: '#ff0000' } }
            });
            assert.ok(store.has(PREFS_KEY), 'writePrefs must use PREFS_KEY');

            const prefs = readPrefs();
            assert.equal(prefs.activeStyle, 'marker');
            assert.equal(prefs.activeTool, 'line');
            assert.equal(prefs.styles.pen.width, 7);
            assert.equal(prefs.styles.pen.color, '#ff0000');
            // Styles missing from the payload still get their defaults.
            assert.equal(prefs.styles.pencil.width, DEFAULT_WIDTH);
        });
    });

    it('rejects unknown styles and tools instead of trusting storage', () => {
        withStorage((store) => {
            store.set(PREFS_KEY, JSON.stringify({ activeStyle: 'laser', activeTool: 'teleport' }));
            const prefs = readPrefs();
            assert.equal(prefs.activeStyle, 'pen');
            assert.equal(prefs.activeTool, 'pointer');
        });
    });

    it('accepts every drag-shape tool as an active tool', () => {
        withStorage((store) => {
            for (const tool of DRAG_SHAPE_TOOLS) {
                store.set(PREFS_KEY, JSON.stringify({ activeTool: tool }));
                assert.equal(readPrefs().activeTool, tool);
            }
        });
    });

    it('ignores non-finite widths rather than propagating NaN into the brush', () => {
        withStorage((store) => {
            store.set(PREFS_KEY, JSON.stringify({ styles: { pen: { width: 'thick', color: '#123456' } } }));
            const prefs = readPrefs();
            assert.equal(prefs.styles.pen.width, DEFAULT_WIDTH);
            assert.equal(prefs.styles.pen.color, '#123456');
        });
    });

    it('survives malformed JSON without throwing', () => {
        withStorage((store) => {
            store.set(PREFS_KEY, '{not json');
            const prefs = readPrefs();
            assert.equal(prefs.activeTool, 'pointer');
            assert.equal(prefs.styles.pen.width, DEFAULT_WIDTH);
        });
    });
});
