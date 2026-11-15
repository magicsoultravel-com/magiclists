// test/flowchartLabelLayout.test.js
// The canvas painter and the inline label editor read one layout model
// (js/flowchartLabel.js). These tests pin that model, because every value here
// is a chance for the two sides to drift apart again:
//   - `\n` used to be collapsed to a space by the painter (split on /\s+/), so a
//     Shift+Enter label re-flowed into one long line on commit.
//   - the painter capped labels at 8 lines and bailed out when the box was
//     narrower than 8 units, while the editor happily showed all of it.
//   - the editor's font size had an 11px CSS floor the painter did not have.
//   - the editor inherited `system-ui` from the body; the painter drew Inter.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    FLOW_LABEL_FONT_STACK,
    FLOW_LABEL_LINE_HEIGHT,
    FLOW_LABEL_PAD,
    flowLabelBox,
    flowLabelCanvasLayout,
    flowLabelEditorMetrics,
    flowLabelFirstBaseline,
    flowLabelInitialFontSize,
    flowLabelMaxWidth,
    wrapLabelLines
} from '../js/flowchartLabel.js';
import { FLOW_LABEL_MAX, FLOW_LABEL_MIN } from '../js/flowchart.js';

/** Monospace stub: every character is 10 canvas units wide. */
const measure = (text) => String(text).length * 10;

describe('flowLabelBox', () => {
    it('normalises a shape drawn right-to-left / bottom-to-top', () => {
        const box = flowLabelBox({ tool: 'rect', x0: 200, y0: 100, x1: 0, y1: 0 });
        assert.deepEqual(box, {
            isConnector: false, left: 0, top: 0, w: 200, h: 100, centerX: 100, centerY: 50
        });
    });

    it('anchors a connector on its bend point, not its bounding box', () => {
        const box = flowLabelBox({ tool: 'connector', x0: 0, y0: 0, x1: 0, y1: 200, midX: 40, midY: 90 });
        assert.equal(box.isConnector, true);
        assert.equal(box.centerX, 40);
        assert.equal(box.centerY, 90);
    });

    it('falls back to the bbox centre when a connector has no bend point', () => {
        const box = flowLabelBox({ tool: 'connector', x0: 0, y0: 0, x1: 100, y1: 100 });
        assert.equal(box.centerX, 50);
        assert.equal(box.centerY, 50);
    });

    it('survives a stroke with no coordinates at all', () => {
        const box = flowLabelBox({});
        assert.deepEqual([box.left, box.top, box.w, box.h], [0, 0, 0, 0]);
    });
});

describe('wrapLabelLines', () => {
    it('honours soft breaks instead of collapsing them', () => {
        assert.deepEqual(wrapLabelLines('one\ntwo', 1000, measure), ['one', 'two']);
    });

    it('keeps a blank line, like white-space: pre-wrap', () => {
        assert.deepEqual(wrapLabelLines('a\n\nb', 1000, measure), ['a', '', 'b']);
    });

    it('wraps on the last word that still fits', () => {
        assert.deepEqual(wrapLabelLines('aaa bbb ccc', 70, measure), ['aaa bbb', 'ccc']);
        assert.deepEqual(wrapLabelLines('aaa bbb ccc', 60, measure), ['aaa', 'bbb', 'ccc']);
    });

    it('breaks a word wider than the box, like overflow-wrap: anywhere', () => {
        assert.deepEqual(wrapLabelLines('abcdefghijklm', 50, measure), ['abcde', 'fghij', 'klm']);
    });

    it('flushes the short line before breaking a long word', () => {
        assert.deepEqual(wrapLabelLines('ab cdefghijkl', 50, measure), ['ab', 'cdefg', 'hijkl']);
    });

    it('never wraps an unbounded width (connectors)', () => {
        assert.deepEqual(
            wrapLabelLines('a very long connector label', Infinity, measure),
            ['a very long connector label']
        );
    });

    it('wraps each soft-broken segment independently', () => {
        assert.deepEqual(wrapLabelLines('aaa bbb\nccc ddd', 70, measure), ['aaa bbb', 'ccc ddd']);
    });

    it('keeps empty input empty', () => {
        assert.deepEqual(wrapLabelLines('', 100, measure), []);
        assert.deepEqual(wrapLabelLines(null, 100, measure), []);
    });
});


describe('flowLabelCanvasLayout', () => {
    const shape = {
        tool: 'rect', x0: 0, y0: 0, x1: 200, y1: 100,
        label: { text: 'Hello there', fontSize: 40 }
    };

    it('centres the block in the shape box', () => {
        const layout = flowLabelCanvasLayout(shape, measure);
        assert.equal(layout.fontSize, 40);
        assert.equal(layout.lineHeight, 40 * FLOW_LABEL_LINE_HEIGHT);
        assert.equal(layout.centerX, 100);
        assert.equal(layout.blockHeight, 48);
        assert.equal(layout.blockTop, 50 - 24);
    });

    it('insets the wrap width by the padding on both sides', () => {
        assert.equal(flowLabelMaxWidth(flowLabelBox(shape)), 200 - FLOW_LABEL_PAD * 2);
    });

    it('stacks soft breaks and grows the block around the same centre', () => {
        const layout = flowLabelCanvasLayout(
            { ...shape, label: { text: 'a\nb\nc', fontSize: 20 } }, measure
        );
        assert.deepEqual(layout.lines, ['a', 'b', 'c']);
        assert.equal(layout.lineHeight, 24);
        assert.equal(layout.blockHeight, 72);
        assert.equal(layout.blockTop, 50 - 36);
    });

    it('never caps the line count', () => {
        const text = Array.from({ length: 12 }, (_, i) => `L${i}`).join('\n');
        const layout = flowLabelCanvasLayout({ ...shape, label: { text, fontSize: 12 } }, measure);
        assert.equal(layout.lines.length, 12, 'the old painter stopped at 8 lines');
    });

    it('still lays out a box too small for its text', () => {
        const tiny = { tool: 'rect', x0: 0, y0: 0, x1: 6, y1: 6, label: { text: 'x', fontSize: 20 } };
        const layout = flowLabelCanvasLayout(tiny, measure);
        assert.ok(layout, 'the old w <= 8 bail dropped the label entirely');
        assert.deepEqual(layout.lines, ['x']);
    });

    it('clamps and snaps the size the same way the editor does', () => {
        assert.equal(flowLabelCanvasLayout({ ...shape, label: { text: 'x', fontSize: 13 } }, measure).fontSize, 14);
        assert.equal(flowLabelCanvasLayout({ ...shape, label: { text: 'x', fontSize: 500 } }, measure).fontSize, FLOW_LABEL_MAX);
        assert.equal(flowLabelCanvasLayout({ ...shape, label: { text: 'x' } }, measure).fontSize, 20);
    });

    it('returns null when there is nothing worth painting', () => {
        assert.equal(flowLabelCanvasLayout({ ...shape, label: null }, measure), null);
        assert.equal(flowLabelCanvasLayout({ ...shape, label: { text: '   ' } }, measure), null);
    });
});

describe('flowLabelFirstBaseline', () => {
    it('applies CSS half-leading around the glyph box', () => {
        // ascent 30 + descent 10 = 40 in a 48 line box: 4 units of leading on top.
        assert.equal(flowLabelFirstBaseline({ blockTop: 26, lineHeight: 48 }, 30, 10), 26 + 4 + 30);
    });
});

describe('flowLabelEditorMetrics', () => {
    it('converts a shape box to CSS px', () => {
        const m = flowLabelEditorMetrics(
            { tool: 'rect', x0: 0, y0: 0, x1: 200, y1: 100, label: { text: 'x', fontSize: 24 } },
            { dpr: 2 }
        );
        assert.equal(m.fontSizeCss, 12);
        assert.equal(m.padCss, FLOW_LABEL_PAD / 2);
        assert.equal(m.left, 0);
        assert.equal(m.top, 0);
        assert.equal(m.width, 100);
        assert.equal(m.height, 50);
        assert.equal(m.lineHeight, FLOW_LABEL_LINE_HEIGHT);
        assert.equal(m.fontFamily, FLOW_LABEL_FONT_STACK);
    });

    it('collapses a connector to the zero-width line the painter centres on', () => {
        const m = flowLabelEditorMetrics(
            { tool: 'connector', x0: 0, y0: 0, x1: 0, y1: 200, midX: 40, midY: 90, label: { text: 'x' } },
            { dpr: 2 }
        );
        assert.equal(m.isConnector, true);
        assert.equal(m.left, 20);
        assert.equal(m.top, 45);
        assert.equal(m.width, 0);
        assert.equal(m.padCss, 0);
    });

    it('takes an explicit size for a label that does not exist yet', () => {
        const m = flowLabelEditorMetrics(
            { tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 100 },
            { dpr: 1, fontSize: 30 }
        );
        assert.equal(m.fontSizeCss, 30);
    });
});

describe('flowLabelInitialFontSize', () => {
    it('keeps a stored size', () => {
        assert.equal(flowLabelInitialFontSize({ tool: 'rect', label: { text: 'x', fontSize: 28 } }), 28);
    });

    it('fits a brand-new shape label to the box', () => {
        assert.equal(flowLabelInitialFontSize({ tool: 'rect', x0: 0, y0: 0, x1: 100, y1: 100 }), 32);
    });

    it('uses the default for a brand-new connector label', () => {
        assert.equal(flowLabelInitialFontSize({ tool: 'connector', x0: 0, y0: 0, x1: 100, y1: 0 }), 20);
    });

    it('never drops below the readable floor', () => {
        assert.equal(flowLabelInitialFontSize({ tool: 'rect', x0: 0, y0: 0, x1: 20, y1: 20 }), FLOW_LABEL_MIN);
    });
});
