// test/textAngle.test.js
// The one rotation model every side of the feature reads: the painter, the DOM
// editors, hit-testing and the marquee. Bugs these catch:
//   1. an angle that clamps at 359 instead of wrapping, so dragging past the top
//      of the dial sticks;
//   2. a pivot that is not the centre the editors rotate about, so the canvas
//      preview jumps on commit;
//   3. an upright box reporting a rotated AABB (or worse, NaN), which would make
//      every old, untouched text box select a little differently.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    TEXT_ANGLE_DEFAULT,
    TEXT_ANGLE_MAX,
    TEXT_ANGLE_PRESETS,
    TEXT_BOX_LINE_HEIGHT,
    normalizeTextAngle,
    hasTextAngle,
    textAngleOf,
    textObjectBox,
    textBoxPivot,
    textAngleRadians,
    rotatePointAround,
    rotatedRectAabb,
    textObjectBounds,
    textRotationCss
} from '../js/textAngle.js';
import { flowLabelCentre } from '../js/flowchartLabel.js';

/** Text object with a stored block, so the pivot is exact rather than heuristic. */
function textBox(overrides = {}) {
    return {
        id: 'text-1',
        tool: 'text',
        x: 100,
        y: 50,
        text: 'Hi',
        fontSize: 20,
        width: 120,
        height: 30,
        ...overrides
    };
}

describe('normalizeTextAngle', () => {
    it('wraps instead of clamping, in both directions', () => {
        assert.equal(normalizeTextAngle(0), 0);
        assert.equal(normalizeTextAngle(90), 90);
        assert.equal(normalizeTextAngle(TEXT_ANGLE_MAX), 359);
        assert.equal(normalizeTextAngle(360), 0, 'a full turn is upright again');
        assert.equal(normalizeTextAngle(400), 40);
        assert.equal(normalizeTextAngle(-45), 315, 'negative degrees wrap forwards');
        assert.equal(normalizeTextAngle(-450), 270);
    });

    it('rounds to whole degrees and never returns -0 or NaN', () => {
        assert.equal(normalizeTextAngle(45.4), 45);
        assert.equal(normalizeTextAngle(45.6), 46);
        assert.equal(normalizeTextAngle(-0.2), 0);
        assert.equal(normalizeTextAngle(359.7), 0);
        assert.equal(normalizeTextAngle(null), TEXT_ANGLE_DEFAULT);
        assert.equal(normalizeTextAngle(undefined), TEXT_ANGLE_DEFAULT);
        assert.equal(normalizeTextAngle('sideways'), TEXT_ANGLE_DEFAULT);
        assert.equal(normalizeTextAngle(NaN), TEXT_ANGLE_DEFAULT);
        assert.equal(normalizeTextAngle(Infinity), TEXT_ANGLE_DEFAULT);
        assert.ok(!Object.is(normalizeTextAngle(360), -0), 'zero is +0, so strict equality holds');
    });
});

describe('textAngleOf', () => {
    it('reads a text box angle and a label angle from their own fields', () => {
        assert.equal(textAngleOf(textBox()), 0, 'absent means upright');
        assert.equal(textAngleOf(textBox({ angle: 30 })), 30);
        assert.equal(textAngleOf({ tool: 'rect', label: { text: 'x', angle: 90 } }), 90);
        assert.equal(textAngleOf({ tool: 'rect', label: { text: 'x' } }), 0);
        assert.equal(textAngleOf(null), 0);
    });

    it('prefers the label angle over a stray item-level angle', () => {
        const shape = { tool: 'rect', angle: 45, label: { text: 'x', angle: 12 } };
        assert.equal(textAngleOf(shape), 12);
    });

    it('wraps a stored value that is out of range', () => {
        assert.equal(textAngleOf(textBox({ angle: 720 })), 0);
        assert.equal(textAngleOf(textBox({ angle: -90 })), 270);
    });

    it('reports whether anything is actually rotated', () => {
        assert.equal(hasTextAngle(textBox()), false);
        assert.equal(hasTextAngle(textBox({ angle: 0 })), false);
        assert.equal(hasTextAngle(textBox({ angle: 1 })), true);
    });
});

describe('textObjectBox', () => {
    it('uses the stored block the editor measured', () => {
        assert.deepEqual(textObjectBox(textBox()), { minX: 100, minY: 50, maxX: 220, maxY: 80 });
    });

    it('falls back to the historical heuristic for legacy objects', () => {
        // Same numbers lassoGeometry.getTextBounds always produced: a 200x60
        // minimum box, else 0.6em per character and 1.4 lines.
        assert.deepEqual(
            textObjectBox({ tool: 'text', x: 0, y: 0, text: 'abcd', fontSize: 20 }),
            { minX: 0, minY: 0, maxX: 200, maxY: 60 }
        );
        const long = 'x'.repeat(40);
        assert.deepEqual(
            textObjectBox({ tool: 'text', x: 10, y: 20, text: long, fontSize: 10 }),
            { minX: 10, minY: 20, maxX: 10 + 40 * 10 * 0.6, maxY: 20 + 60 }
        );
    });

    it('ignores a zero-sized stored block rather than collapsing the hit area', () => {
        const box = textObjectBox(textBox({ width: 0, height: 0 }));
        assert.equal(box.maxX - box.minX, 200);
        assert.equal(box.maxY - box.minY, 60);
    });
});

describe('pivots', () => {
    it('pivots a text box on the centre of its own block', () => {
        assert.deepEqual(textBoxPivot(textBox()), { x: 160, y: 65 });
    });

    it('pivots a label on the centre of its box, i.e. the shape middle', () => {
        const shape = { tool: 'rect', x0: 0, y0: 0, x1: 200, y1: 100, label: { text: 'x' } };
        assert.deepEqual(flowLabelCentre(shape), { x: 100, y: 50 });
    });

    it('pivots a connector label on its bend point', () => {
        const conn = { tool: 'connector', x0: 0, y0: 0, x1: 0, y1: 200, midX: 40, midY: 100 };
        assert.deepEqual(flowLabelCentre(conn), { x: 40, y: 100 });
    });
});

describe('rotation math', () => {
    it('converts degrees to radians through the same normalisation', () => {
        assert.equal(textAngleRadians(0), 0);
        assert.equal(textAngleRadians(180), Math.PI);
        assert.equal(textAngleRadians(360), 0);
    });

    it('rotates clockwise in screen space', () => {
        // 90 degrees clockwise takes "one step right of the pivot" to "one below".
        const p = rotatePointAround(110, 100, 100, 100, 90);
        assert.ok(Math.abs(p.x - 100) < 1e-9);
        assert.ok(Math.abs(p.y - 110) < 1e-9);
    });

    it('leaves points alone at zero and is its own inverse at 330/30', () => {
        assert.deepEqual(rotatePointAround(3, 4, 0, 0, 0), { x: 3, y: 4 });
        const once = rotatePointAround(10, 0, 0, 0, 30);
        const back = rotatePointAround(once.x, once.y, 0, 0, 330);
        assert.ok(Math.abs(back.x - 10) < 1e-9);
        assert.ok(Math.abs(back.y) < 1e-9);
    });
});

describe('bounds', () => {
    it('returns the rect itself when upright, so nothing new is allocated', () => {
        const box = textObjectBox(textBox());
        assert.equal(rotatedRectAabb(box, 160, 65, 0), box);
        assert.deepEqual(textObjectBounds(textBox()), box);
    });

    it('grows a quarter-turned box to its rotated AABB', () => {
        const bounds = textObjectBounds(textBox({ angle: 90 }));
        // 120x30 about (160, 65): width becomes the old height and vice versa.
        assert.ok(Math.abs((bounds.maxX - bounds.minX) - 30) < 1e-9);
        assert.ok(Math.abs((bounds.maxY - bounds.minY) - 120) < 1e-9);
        assert.ok(Math.abs((bounds.minX + bounds.maxX) / 2 - 160) < 1e-9, 'centre is unchanged');
        assert.ok(Math.abs((bounds.minY + bounds.maxY) / 2 - 65) < 1e-9);
    });

    it('is symmetric for 45 degrees', () => {
        const bounds = rotatedRectAabb({ minX: -10, minY: -10, maxX: 10, maxY: 10 }, 0, 0, 45);
        const span = Math.sqrt(2) * 20;
        assert.ok(Math.abs((bounds.maxX - bounds.minX) - span) < 1e-9);
        assert.ok(Math.abs((bounds.maxY - bounds.minY) - span) < 1e-9);
    });
});

describe('css helpers', () => {
    it('emits nothing at zero so an untouched element keeps its transform', () => {
        assert.equal(textRotationCss(0), '');
        assert.equal(textRotationCss(360), '');
        assert.equal(textRotationCss(90), 'rotate(90deg)');
        assert.equal(textRotationCss(-90), 'rotate(270deg)');
    });

    it('mirrors the painter line advance and exposes the preset ring', () => {
        assert.equal(TEXT_BOX_LINE_HEIGHT, 1.25);
        assert.deepEqual([...TEXT_ANGLE_PRESETS], [0, 45, 90, 135, 180, 225, 270, 315]);
    });
});
