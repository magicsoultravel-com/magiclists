// test/drawingBoardText.test.js
// Guards for the independent text styling cluster: text colour and size are
// stored separately from the brush, applied selection-first, and converted
// between CSS px (the toolbar unit) and canvas units (the painter's unit).
//
// Bugs these catch:
//   - a colour/size pick on a mixed selection disabling the stepper instead of
//     clamping per target (a label caps at 72 canvas units, a text box does not)
//   - a no-op restyle pushing an undo entry that Ctrl+Z burns on nothing
//   - a text box inheriting the *brush* colour/size instead of the text pref
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    TEXT_COLOR_DEFAULT, TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX
} from '../js/drawingBoard/prefs.js';
import {
    hasLabel, isTextBox, textTargets, textStyle, sizeForTarget, cssSizeOf,
    textSizeRange, currentTextSize, applyTextStyle, setTextColor, setTextSize,
    stepTextSize
} from '../js/drawingBoard/text.js';
import { placeTextBox } from '../js/drawingBoardSelection.js';

/** Node has no DOM: install the two globals the modules read. */
function withEnv(fn, { dpr = 1 } = {}) {
    const store = new Map();
    const hadStorage = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const prevStorage = globalThis.localStorage;
    const prevWindow = globalThis.window;
    globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value))
    };
    globalThis.window = { devicePixelRatio: dpr };
    try {
        return fn(store);
    } finally {
        if (hadStorage) globalThis.localStorage = prevStorage;
        else delete globalThis.localStorage;
        if (hadWindow) globalThis.window = prevWindow;
        else delete globalThis.window;
    }
}

/** Board stub: selection + the mutation sinks the session calls. */
function makeBoard({ selection = [], text = null } = {}) {
    const board = {
        prefs: {},
        selectedStrokes: new Set(selection),
        historyPushes: 0,
        saves: 0,
        redraws: 0,
        renders: 0,
        chipColour: null,
        getSelectedStrokesArray() { return Array.from(this.selectedStrokes); },
        pushLayerHistory() { this.historyPushes += 1; },
        scheduleSave() { this.saves += 1; },
        requestRedraw() { this.redraws += 1; },
        renderToolbar() { this.renders += 1; },
        updateTextColorChip(colour) { this.chipColour = colour; }
    };
    if (text) board.prefs.text = text;
    return board;
}

function shapeLabel(text = 'Start', fontSize = 28, color = '') {
    return {
        id: 'shape_' + text, flowchartKind: 'shape', tool: 'rect',
        x0: 0, y0: 0, x1: 200, y1: 100,
        color: '#22c55e', width: 3,
        label: { text, fontSize, color }
    };
}

function connectorLabel(text = 'yes', fontSize = 20, color = '') {
    return {
        id: 'conn_' + text, flowchartKind: 'connector', tool: 'connector',
        x0: 0, y0: 0, x1: 120, y1: 0,
        color: '#f8fafc', width: 2,
        label: { text, fontSize, color }
    };
}

function textBox(text = 'Note', fontSize = 80, color = '#f8fafc') {
    return { id: 'text_1', tool: 'text', x: 0, y: 0, text, fontSize, color };
}

describe('text targets', () => {
    it('recognises labels and text boxes, never images or plain strokes', () => {
        assert.equal(hasLabel(shapeLabel()), true);
        assert.equal(hasLabel(connectorLabel()), true);
        assert.equal(hasLabel(textBox()), false, 'a text object is not a label');
        assert.equal(isTextBox(textBox()), true);
        assert.equal(isTextBox(shapeLabel()), false);
        assert.equal(hasLabel({ id: 'img', tool: 'image', src: 'x.png' }), false);
        assert.equal(isTextBox({ id: 'img', tool: 'image', src: 'x.png' }), false);
        assert.equal(hasLabel({ label: { text: '   ' } }), false, 'blank label text is no label');
    });

    it('skips an image-only selection without touching history or the canvas', () => {
        withEnv(() => {
            const image = { id: 'img', tool: 'image', src: 'x.png', color: '#000000' };
            const board = makeBoard({ selection: [image], text: { color: '#f8fafc', size: 40 } });
            assert.deepEqual(textTargets(board), []);
            assert.equal(applyTextStyle(board, { color: '#ff0000', size: 12 }), 0);
            assert.equal(board.historyPushes, 0, 'nothing changed, nothing to undo');
            assert.equal(board.saves, 0);
            assert.equal(board.redraws, 0);
            assert.equal(image.color, '#000000', 'the image is untouched');
        });
    });

    it('collects every text target in a mixed selection', () => {
        withEnv(() => {
            const board = makeBoard({ selection: [shapeLabel(), textBox(), connectorLabel()] });
            assert.equal(textTargets(board).length, 3);
        });
    });

    it('reads the stored text style and defaults when it is missing', () => {
        withEnv(() => {
            assert.deepEqual(textStyle(makeBoard()), { color: TEXT_COLOR_DEFAULT, size: TEXT_SIZE_DEFAULT });
            assert.deepEqual(
                textStyle(makeBoard({ text: { color: '#abcdef', size: 12 } })),
                { color: '#abcdef', size: 12 }
            );
        });
    });
});

describe('unit conversion', () => {
    it('keeps labels inside their box while text boxes take the full size', () => {
        const label = shapeLabel('Fit', 20);
        assert.equal(sizeForTarget(label, 20, 1), 20);
        // dpr 2: 40 CSS px is 80 canvas units -> clamped to the label ceiling.
        assert.equal(sizeForTarget(label, 40, 2), TEXT_SIZE_MAX);
        assert.equal(sizeForTarget(label, 4, 1), 12, 'labels never go below the readable floor');
        assert.equal(sizeForTarget(textBox(), 40, 2), 80, 'text boxes are not clamped');
        assert.equal(sizeForTarget(textBox(), 40, 1), 40);
    });

    it('reports the current CSS size of each target', () => {
        assert.equal(cssSizeOf(shapeLabel('A', 28), 2), 14, 'canvas units / dpr');
        assert.equal(cssSizeOf(textBox('A', 80), 2), 40);
        assert.equal(cssSizeOf({ tool: 'text', text: 'A' }, 2), TEXT_SIZE_DEFAULT, 'missing size = pref');
    });

    it('caps a label-only selection at the label ceiling for the current dpr', () => {
        withEnv(() => {
            assert.deepEqual(textSizeRange(makeBoard()), { min: 8, max: 72 }, 'no selection: full range');
            const labels = makeBoard({ selection: [shapeLabel()] });
            assert.deepEqual(textSizeRange(labels, 1), { min: 8, max: 72 });
            assert.deepEqual(textSizeRange(labels, 2), { min: 8, max: 36 }, '72 canvas / dpr 2');
            const mixed = makeBoard({ selection: [shapeLabel(), textBox()] });
            assert.equal(textSizeRange(mixed, 2).max, 72, 'a text box keeps the full range open');
        });
    });

    it('shows the shared size for a matching selection, else the pref', () => {
        withEnv(() => {
            const same = makeBoard({ selection: [shapeLabel('A', 28), connectorLabel('b', 28)] });
            same.prefs.text = { color: '#f8fafc', size: 12 };
            assert.equal(currentTextSize(same), 14, 'both are 28 canvas units at dpr 2');

            const mixedSizes = makeBoard({ selection: [shapeLabel('A', 28), connectorLabel('b', 20)] });
            mixedSizes.prefs.text = { color: '#f8fafc', size: 12 };
            assert.equal(currentTextSize(mixedSizes), 12, 'disagreeing sizes fall back to the pref');
        }, { dpr: 2 });
    });

    it('clamps the readout into the selection range instead of showing a dead value', () => {
        withEnv(() => {
            const labels = makeBoard({ selection: [shapeLabel('A', 20), shapeLabel('B', 60)] });
            labels.prefs.text = { color: '#f8fafc', size: 40 };
            assert.equal(currentTextSize(labels), 36, 'pref 40 is past the dpr-2 label ceiling');
        }, { dpr: 2 });
    });
});

describe('applyTextStyle', () => {
    it('clamps each target independently across a mixed selection', () => {
        withEnv(() => {
            const label = shapeLabel('A', 20);
            const box = textBox('B', 20);
            const board = makeBoard({ selection: [label, box] });
            assert.equal(applyTextStyle(board, { size: 40 }), 2);
            assert.equal(label.label.fontSize, 72, 'label caps at the painter ceiling');
            assert.equal(box.fontSize, 80, 'text box follows the CSS request');
            assert.equal(board.historyPushes, 1, 'one gesture = one undo entry');
            assert.equal(board.saves, 1);
            assert.equal(board.redraws, 1);
        }, { dpr: 2 });
    });

    it('does nothing (no history, no redraw) when the request is already satisfied', () => {
        withEnv(() => {
            const label = shapeLabel('A', 72);
            const board = makeBoard({ selection: [label] });
            assert.equal(applyTextStyle(board, { size: 40 }), 0, '40 CSS px is still the 72 cap');
            assert.equal(board.historyPushes, 0);
            assert.equal(board.redraws, 0);
            assert.equal(label.label.fontSize, 72);
        }, { dpr: 2 });
    });

    it('restyles the label colour without touching the shape outline', () => {
        withEnv(() => {
            const label = shapeLabel('A');
            const board = makeBoard({ selection: [label] });
            assert.equal(applyTextStyle(board, { color: '#ff0000' }), 1);
            assert.equal(label.label.color, '#ff0000');
            assert.equal(label.color, '#22c55e', 'the box outline keeps its own colour');
        });
    });

    it('restyles text boxes through their own colour and size fields', () => {
        withEnv(() => {
            const box = textBox('A', 80, '#f8fafc');
            const board = makeBoard({ selection: [box] });
            assert.equal(applyTextStyle(board, { color: '#00ff00', size: 20 }), 1);
            assert.equal(box.color, '#00ff00');
            assert.equal(box.fontSize, 20);
        });
    });
});


describe('setTextColor', () => {
    it('remembers the colour even when the selection already matches', () => {
        withEnv(() => {
            const label = shapeLabel('A', 20, '#ff0000');
            const board = makeBoard({ selection: [label] });
            board.prefs.text = { color: '#f8fafc', size: 40 };
            assert.equal(setTextColor(board, '#ff0000', { rerender: false }), 0);
            assert.equal(board.prefs.text.color, '#ff0000', 'pref tracks the last pick');
            assert.equal(board.historyPushes, 0, 'no undo entry for a no-op');
            assert.equal(board.chipColour, '#ff0000', 'the chip follows the pick');
        });
    });

    it('stamps the colour on a legacy label that only inherited the outline colour', () => {
        withEnv(() => {
            const label = shapeLabel('A', 20, '');
            const board = makeBoard({ selection: [label] });
            board.prefs.text = { color: TEXT_COLOR_DEFAULT, size: 40 };
            assert.equal(setTextColor(board, TEXT_COLOR_DEFAULT, { rerender: false }), 1);
            assert.equal(label.label.color, TEXT_COLOR_DEFAULT, 'now explicit, not inherited');
            assert.equal(board.historyPushes, 1);
        });
    });

    it('repaints the toolbar when not asked to skip the rerender', () => {
        withEnv(() => {
            const board = makeBoard();
            setTextColor(board, '#123456');
            assert.equal(board.renders, 1);
            assert.equal(board.prefs.text.color, '#123456');
        });
    });
});

describe('text size stepping', () => {
    it('steps the pref when nothing is selected (new text only)', () => {
        withEnv(() => {
            const board = makeBoard();
            board.prefs.text = { color: '#f8fafc', size: 40 };
            assert.equal(stepTextSize(board, 1), 0, 'no selection: nothing to restyle');
            assert.equal(board.prefs.text.size, 44);
            assert.equal(board.historyPushes, 0);
            assert.equal(stepTextSize(board, -1), 0);
            assert.equal(board.prefs.text.size, 40);
        });
    });

    it('steps a selected text box and stops at the range ends', () => {
        withEnv(() => {
            const box = textBox('A', 80);
            const board = makeBoard({ selection: [box] });
            board.prefs.text = { color: '#f8fafc', size: 40 };
            assert.equal(stepTextSize(board, 1), 1);
            assert.equal(box.fontSize, 88);
            assert.equal(board.prefs.text.size, 44);

            setTextSize(board, 8);
            assert.equal(box.fontSize, 16, '8 CSS px at dpr 2');
            assert.equal(stepTextSize(board, -1), 0, 'already at the floor');
            assert.equal(box.fontSize, 16);
        }, { dpr: 2 });
    });

    it('leaves a label at the cap instead of thrashing it', () => {
        withEnv(() => {
            const label = shapeLabel('A', 72);
            const board = makeBoard({ selection: [label] });
            board.prefs.text = { color: '#f8fafc', size: 36 };
            assert.equal(stepTextSize(board, 1), 0);
            assert.equal(label.label.fontSize, 72);
            assert.equal(board.historyPushes, 0);
        }, { dpr: 2 });
    });
});


describe('placeTextBox', () => {
    /** Minimal DOM for placeTextBox's contentEditable overlay. */
    function installDom(dpr = 2) {
        const created = [];
        globalThis.window = { devicePixelRatio: dpr };
        globalThis.document = {
            createElement(tag) {
                const el = {
                    tagName: tag,
                    style: {},
                    dataset: {},
                    listeners: {},
                    className: '',
                    contentEditable: '',
                    innerText: '',
                    focus() { el.focused = true; },
                    remove() { el.removed = true; },
                    addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); }
                };
                created.push(el);
                return el;
            }
        };
        return created;
    }

    afterEach(() => {
        delete globalThis.document;
        delete globalThis.window;
    });

    function textBoard(text) {
        const appended = [];
        const board = {
            doc: { pages: [{ id: 'p1', texts: [] }], activePageId: 'p1' },
            prefs: { text },
            textLayer: { appendChild(el) { appended.push(el); } },
            historyPushes: 0,
            saves: 0,
            redraws: 0,
            pushLayerHistory() { this.historyPushes += 1; },
            scheduleSave() { this.saves += 1; },
            redraw() { this.redraws += 1; }
        };
        board.appended = appended;
        return board;
    }

    it('uses the stored text style, not the brush, for a new text box', () => {
        const created = installDom(2);
        const board = textBoard({ color: '#ff0000', size: 28 });
        placeTextBox(board, 100, 50);

        const el = created[0];
        assert.equal(el.style.fontSize, '28px', 'the editor is laid out in CSS px');
        assert.equal(el.style.color, '#ff0000');
        assert.equal(parseFloat(el.style.left), 50, 'text layer is world / dpr');

        el.innerText = 'Hello';
        el.listeners.blur[0]();

        const stored = board.doc.pages[0].texts[0];
        assert.equal(stored.fontSize, 56, 'canvas units = CSS px * dpr');
        assert.equal(stored.color, '#ff0000');
        assert.equal(board.historyPushes, 1);
        assert.equal(board.saves, 1);
    });

    it('defaults to 40 CSS px when no text style is stored', () => {
        const created = installDom(2);
        const board = textBoard(undefined);
        placeTextBox(board, 0, 0);
        assert.equal(created[0].style.fontSize, TEXT_SIZE_DEFAULT + 'px');

        created[0].innerText = 'Note';
        created[0].listeners.blur[0]();
        assert.equal(board.doc.pages[0].texts[0].fontSize, TEXT_SIZE_DEFAULT * 2);
        assert.equal(board.doc.pages[0].texts[0].color, TEXT_COLOR_DEFAULT);
    });

    it('stores nothing when the box is committed empty', () => {
        const created = installDom(1);
        const board = textBoard({ color: '#fff', size: 12 });
        placeTextBox(board, 0, 0);
        created[0].innerText = '   ';
        created[0].listeners.blur[0]();
        assert.deepEqual(board.doc.pages[0].texts, []);
        assert.equal(board.historyPushes, 0);
    });
});

