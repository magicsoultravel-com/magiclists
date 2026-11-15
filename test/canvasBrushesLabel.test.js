// test/canvasBrushesLabel.test.js
// The painter half of the WYSIWYG contract. What drawFlowchartLabel() puts on
// the canvas has to be the same lines, at the same size, in the same place the
// inline editor showed while typing. Bugs guarded here:
//   1. the painter split text on /\s+/, so every Shift+Enter soft break was
//      collapsed to a space and a 2-line label committed as 1 long line;
//   2. `lines.slice(0, 8)` silently dropped the 9th line and beyond;
//   3. `if (!(w > 8) || !(h > 8)) return;` painted nothing at all for a small
//      shape, so the label vanished with no error;
//   4. connector labels were a single unwrapped line of raw text, newlines and
//      all;
//   5. while the editor was open the committed copy was painted underneath it,
//      doubling every glyph.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { drawFlowchartLabel, drawShapeStroke, drawTextObject } from '../js/canvasBrushes.js';
import { FLOW_LABEL_FONT_STACK, FLOW_LABEL_LINE_HEIGHT } from '../js/flowchartLabel.js';

/**
 * Recording 2D context: 10 units per character, explicit font ascent/descent so
 * the half-leading maths is deterministic. `bounds: false` withholds the font
 * bounds to exercise the 0.8/0.2 em fallback (canvas implementations that do not
 * report them).
 */
function recordingCtx({ bounds = true, ascent = 8, descent = 2 } = {}) {
    const texts = [];
    const stack = [];
    const ops = [];
    const ctx = {
        font: '', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
        lineCap: 'butt', lineJoin: 'miter', textAlign: 'start', textBaseline: 'alphabetic',
        save() {
            stack.push({
                font: this.font, fillStyle: this.fillStyle, textAlign: this.textAlign,
                textBaseline: this.textBaseline
            });
        },
        restore() {
            const prev = stack.pop();
            if (prev) Object.assign(this, prev);
        },
        measureText(text) {
            const m = { width: String(text).length * 10 };
            if (bounds) {
                m.fontBoundingBoxAscent = ascent;
                m.fontBoundingBoxDescent = descent;
            }
            return m;
        },
        fillText(text, x, y) { texts.push({ text, x, y, font: this.font }); },
        beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {},
        strokeRect() {}, fillRect() {}, rect() {}, roundRect() {}, ellipse() {},
        arc() {}, setLineDash() {}, translate(x, y) { ops.push(['translate', x, y]); },
        rotate(rad) { ops.push(['rotate', rad]); }, scale() {}
    };
    return { ctx, texts, ops };
}

const rect = (overrides = {}) => ({
    tool: 'rect', flowchartKind: 'shape', color: '#f8fafc', width: 3, style: 'pen',
    x0: 0, y0: 0, x1: 200, y1: 100,
    ...overrides
});

describe('drawFlowchartLabel', () => {
    it('paints a soft break as two stacked, centred lines', () => {
        const { ctx, texts } = recordingCtx();
        drawFlowchartLabel(ctx, rect({ label: { text: 'one\ntwo', fontSize: 20 } }));

        assert.deepEqual(texts.map((t) => t.text), ['one', 'two'], 'no collapsing to "one two"');
        assert.equal(texts[0].x, 100, 'centred on the shape');
        assert.equal(texts[1].x, 100);
        assert.equal(
            texts[1].y - texts[0].y,
            20 * FLOW_LABEL_LINE_HEIGHT,
            'line advance matches the editor line box'
        );
    });

    it('paints with the editor font stack at the stored size', () => {
        const { ctx, texts } = recordingCtx();
        drawFlowchartLabel(ctx, rect({ label: { text: 'x', fontSize: 24 } }));
        assert.equal(texts[0].font, '24px ' + FLOW_LABEL_FONT_STACK);
    });

    it('keeps painting past eight lines', () => {
        const { ctx, texts } = recordingCtx();
        const text = Array.from({ length: 12 }, (_, i) => `L${i}`).join('\n');
        drawFlowchartLabel(ctx, rect({ label: { text, fontSize: 12 } }));
        assert.equal(texts.length, 12, 'the old painter stopped at line 8');
        assert.equal(texts[11].text, 'L11');
    });

    it('paints a label in a box too small to be "usable"', () => {
        const { ctx, texts } = recordingCtx();
        drawFlowchartLabel(ctx, rect({ x1: 6, y1: 6, label: { text: 'x', fontSize: 20 } }));
        assert.equal(texts.length, 1, 'the old small-box bail dropped the label entirely');
    });

    it('stacks a connector label on its bend point without wrapping', () => {
        const { ctx, texts } = recordingCtx();
        const conn = {
            tool: 'connector', flowchartKind: 'connector', color: '#f8fafc',
            x0: 0, y0: 0, x1: 0, y1: 200, midX: 40, midY: 100,
            label: { text: 'a\nb', fontSize: 20 }
        };
        drawFlowchartLabel(ctx, conn);
        assert.deepEqual(texts.map((t) => t.text), ['a', 'b']);
        assert.equal(texts[0].x, 40, 'centred on the bend, not the bbox');
        assert.equal(texts[0].x, texts[1].x);
        assert.equal(texts[1].y - texts[0].y, 24, 'two line boxes, stacked');
    });

    it('does not wrap a long connector label', () => {
        const { ctx, texts } = recordingCtx();
        drawFlowchartLabel(ctx, {
            tool: 'connector', color: '#fff', x0: 0, y0: 0, x1: 0, y1: 200,
            midX: 40, midY: 100,
            label: { text: 'a very long connector label that would never fit', fontSize: 20 }
        });
        assert.equal(texts.length, 1);
    });

    it('applies CSS half-leading so the block is optically centred', () => {
        const { ctx, texts } = recordingCtx({ ascent: 30, descent: 10 });
        drawFlowchartLabel(ctx, rect({ label: { text: 'x', fontSize: 40 } }));
        // One 48-unit line box in a 100-unit box: blockTop 26, 4 units of lead,
        // baseline 26 + 4 + 30.
        assert.equal(texts[0].y, 60);
    });

    it('falls back to 0.8 / 0.2 em when the canvas reports no font bounds', () => {
        const { ctx, texts } = recordingCtx({ bounds: false });
        drawFlowchartLabel(ctx, rect({ label: { text: 'x', fontSize: 20 } }));
        // One 24-unit line box in a 100-unit tall box: blockTop 38, glyph box
        // 16 + 4 = 20, 2 units of lead on top.
        assert.equal(texts[0].y, 38 + 2 + 16);
    });

    it('skips the stroke whose editor is open', () => {
        const { ctx, texts } = recordingCtx();
        const shape = rect({ label: { text: 'typing', fontSize: 20 } });
        drawFlowchartLabel(ctx, shape, { skipLabel: shape });
        assert.equal(texts.length, 0, 'the editor is drawing this text');
    });

    it('paints other strokes while one editor is open', () => {
        const { ctx, texts } = recordingCtx();
        const open = rect({ label: { text: 'typing', fontSize: 20 } });
        const other = rect({ x0: 300, x1: 500, label: { text: 'keep', fontSize: 20 } });
        drawFlowchartLabel(ctx, other, { skipLabel: open });
        assert.deepEqual(texts.map((t) => t.text), ['keep']);
    });

    it('paints nothing without text', () => {
        const { ctx, texts } = recordingCtx();
        drawFlowchartLabel(ctx, rect({ label: null }));
        drawFlowchartLabel(ctx, rect({ label: { text: '   ' } }));
        drawFlowchartLabel(ctx, null);
        assert.equal(texts.length, 0);
    });

    it('restores the caller canvas state', () => {
        const { ctx } = recordingCtx();
        ctx.fillStyle = '#123456';
        ctx.font = '9px monospace';
        drawFlowchartLabel(ctx, rect({ label: { text: 'x', fontSize: 20 } }));
        assert.equal(ctx.fillStyle, '#123456');
        assert.equal(ctx.font, '9px monospace');
    });

    it('turns a rotated label about the centre of its box', () => {
        const { ctx, ops, texts } = recordingCtx();
        drawFlowchartLabel(ctx, rect({ label: { text: 'x', fontSize: 20, angle: 90 } }));

        // 0..200 x 0..100 box: centre (100, 50). Translate/rotate/translate back
        // is the canvas sandwich that keeps the fillText coordinates absolute.
        assert.deepEqual(ops, [
            ['translate', 100, 50],
            ['rotate', Math.PI / 2],
            ['translate', -100, -50]
        ]);
        assert.equal(texts[0].x, 100, 'still painted at the box centre');
    });

    it('turns a connector label about its bend point', () => {
        const { ctx, ops } = recordingCtx();
        drawFlowchartLabel(ctx, {
            tool: 'connector', color: '#fff', x0: 0, y0: 0, x1: 0, y1: 200,
            midX: 40, midY: 100,
            label: { text: 'yes', fontSize: 20, angle: 270 }
        });
        assert.deepEqual(ops[0], ['translate', 40, 100]);
        assert.equal(ops[1][0], 'rotate');
        assert.deepEqual(ops[2], ['translate', -40, -100]);
    });

    it('leaves an upright label untransformed', () => {
        const { ctx, ops, texts } = recordingCtx();
        drawFlowchartLabel(ctx, rect({ label: { text: 'x', fontSize: 20 } }));
        assert.deepEqual(ops, [], 'no rotation, no transform ops');
        assert.equal(texts.length, 1);
    });
});

describe('drawShapeStroke label forwarding', () => {
    it('paints the label through the shape path', () => {
        const { ctx, texts } = recordingCtx();
        drawShapeStroke(ctx, rect({ label: { text: 'hi', fontSize: 20 } }));
        assert.deepEqual(texts.map((t) => t.text), ['hi']);
    });

    it('forwards skipLabel to the label painter', () => {
        const { ctx, texts } = recordingCtx();
        const shape = rect({ label: { text: 'hi', fontSize: 20 } });
        drawShapeStroke(ctx, shape, { skipLabel: shape });
        assert.equal(texts.length, 0);
    });
});

describe('drawTextObject rotation', () => {
    const textObj = (overrides = {}) => ({
        tool: 'text', x: 100, y: 50, text: 'Hi', fontSize: 20,
        width: 120, height: 30,
        ...overrides
    });

    it('turns a text box about the centre of its stored block', () => {
        const { ctx, ops, texts } = recordingCtx();
        drawTextObject(ctx, textObj({ angle: 30 }));
        // 100..220 x 50..80: centre (160, 65) — the same point the DOM editor's
        // transform-origin uses.
        assert.deepEqual(ops[0], ['translate', 160, 65]);
        assert.equal(ops[1][0], 'rotate');
        assert.deepEqual(ops[2], ['translate', -160, -65]);
        assert.equal(texts[0].x, 100, 'the words keep their stored origin');
    });

    it('paints upright text with no transform at all', () => {
        const { ctx, ops, texts } = recordingCtx();
        drawTextObject(ctx, textObj());
        assert.deepEqual(ops, []);
        assert.equal(texts.length, 1);
    });
});
