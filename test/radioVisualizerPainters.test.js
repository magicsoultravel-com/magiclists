// test/radioVisualizerPainters.test.js
// Backdrop (starfield sky gradient + flat fill) and the nine single-pass mode
// painters extracted from js/radioVisualizer.js into
// js/radioVisualizer/backdrop.js and js/radioVisualizer/painters.js.
//
// The painters are pure canvas work, so a recording 2D-context stub is enough:
// it logs every path/fill/stroke call plus the style in force at the time.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ensureStars, fillBackdrop, drawSkyGradient } from '../js/radioVisualizer/backdrop.js';
import {
    paintNeonSky,
    paintAuroraBands,
    paintBars,
    paintParticles,
    paintWaveform,
    paintWaveformSynth,
    paintRings,
    paintOrb,
    paintSpiral
} from '../js/radioVisualizer/painters.js';
import { DEFAULTS } from '../js/radioVisualizer/settings.js';
import { PALETTES } from '../js/radioVisualizer/palettes.js';

function makeGradient(kind, args) {
    const stops = [];
    return {
        kind,
        args,
        stops,
        gradient: true,
        addColorStop(offset, color) {
            stops.push([offset, color]);
        }
    };
}

/** Recording CanvasRenderingContext2D stub. */
function makeCtx() {
    const calls = [];
    const ctx = {
        calls,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        shadowBlur: 0,
        shadowColor: '',
        saveDepth: 0,
        save() {
            ctx.saveDepth += 1;
            calls.push(['save']);
        },
        restore() {
            ctx.saveDepth -= 1;
            calls.push(['restore']);
        },
        beginPath() {
            calls.push(['beginPath']);
        },
        closePath() {
            calls.push(['closePath']);
        },
        moveTo(x, y) {
            calls.push(['moveTo', x, y]);
        },
        lineTo(x, y) {
            calls.push(['lineTo', x, y]);
        },
        arc(x, y, r) {
            calls.push(['arc', x, y, r]);
        },
        fillRect(x, y, w, h) {
            calls.push(['fillRect', x, y, w, h, ctx.fillStyle, ctx.shadowBlur]);
        },
        fill() {
            calls.push(['fill', ctx.fillStyle, ctx.shadowBlur]);
        },
        stroke() {
            calls.push(['stroke', ctx.strokeStyle, ctx.shadowBlur, ctx.lineWidth]);
        },
        createLinearGradient(...args) {
            return makeGradient('linear', args);
        },
        createRadialGradient(...args) {
            return makeGradient('radial', args);
        },
        count(kind) {
            return calls.filter((call) => call[0] === kind).length;
        },
        of(kind) {
            return calls.filter((call) => call[0] === kind);
        }
    };
    return ctx;
}

/** Host slice the painters read: just `settings` (and `stars` for the backdrop). */
function makeHost(overrides = {}) {
    return {
        settings: { ...DEFAULTS, ...(overrides.settings || {}) },
        stars: overrides.stars ?? null
    };
}

const PALETTE = PALETTES.horizon;
const VALUES = Array.from({ length: 8 }, (_, i) => (i + 1) / 10);

/** Fixed clock so time-driven geometry is reproducible. */
function withNow(fixed, fn) {
    const realNow = Date.now;
    Date.now = () => fixed;
    try {
        return fn();
    } finally {
        Date.now = realNow;
    }
}
describe('radio visualizer backdrop', () => {
    it('fillBackdrop maps each background setting to its fill colour', () => {
        const cases = [
            ['glass', 'rgba(15, 23, 42, 0.52)'],
            ['midnight', '#040914'],
            ['dark', '#070b12'],
            ['unexpected', '#070b12']
        ];
        for (const [background, expected] of cases) {
            const ctx = makeCtx();
            fillBackdrop(makeHost({ settings: { background } }), ctx, 320, 180);
            const fill = ctx.of('fillRect');
            assert.equal(fill.length, 1);
            assert.equal(fill[0][5], expected, background);
            assert.deepEqual(fill[0].slice(1, 5), [0, 0, 320, 180]);
        }
    });

    it('ensureStars builds a cached starfield sized to the canvas box', () => {
        const host = makeHost();
        const points = ensureStars(host, 420, 200);
        // max(28, round(420 / 14)) === 30
        assert.equal(points.length, 30);
        assert.deepEqual(host.stars, { width: 420, height: 200, points });
        for (const star of points) {
            assert.ok(star.x >= 0 && star.x <= 420, 'x within width');
            assert.ok(star.y >= 0 && star.y <= 200 * 0.62, 'y within upper sky band');
            assert.ok(star.r >= 0.4 && star.r <= 1.8, 'radius range');
            assert.ok(star.tw >= 0 && star.tw <= Math.PI * 2, 'twinkle phase');
            assert.ok(star.sp >= 0.4 && star.sp <= 1.6, 'twinkle speed');
        }
    });

    it('ensureStars floors the count at 28 and reuses the cache for the same box', () => {
        const host = makeHost();
        const first = ensureStars(host, 100, 60);
        assert.equal(first.length, 28);
        assert.equal(ensureStars(host, 100, 60), first, 'cached array is returned');
        const taller = ensureStars(host, 100, 61);
        assert.notEqual(taller, first, 'box change rebuilds the field');
        assert.equal(host.stars.height, 61);
    });

    it('drawSkyGradient paints the gradient, one dot per star and the horizon glow', () => {
        const host = makeHost();
        const ctx = makeCtx();
        const palette = ['#00f0ff', '#ff2bd6'];
        withNow(1_000, () => drawSkyGradient(host, ctx, 300, 150, palette, 0.6));

        const [sky] = ctx.of('fillRect').map((call) => call[5]).filter((style) => style.gradient);
        assert.equal(sky.kind, 'linear');
        assert.deepEqual(sky.args, [0, 0, 0, 150]);
        assert.deepEqual(sky.stops.map(([offset]) => offset), [0, 0.35, 0.62, 1]);
        // palette[3] is missing, so the 0.35 stop falls back to palette[0]
        assert.equal(sky.stops[1][1], 'rgba(0, 240, 255, 0.28)');

        const stars = ensureStars(host, 300, 150);
        assert.equal(ctx.count('arc'), stars.length);
        for (const [, , , r] of ctx.of('arc')) assert.ok(r >= 0.4 && r <= 1.8);

        const radial = ctx.of('fillRect').map((call) => call[5]).filter((style) => style.gradient && style.kind === 'radial');
        assert.equal(radial.length, 1, 'horizon glow is a radial gradient');
        assert.deepEqual(radial[0].args, [150, 108, 8, 150, 108, 165]);
        assert.deepEqual(radial[0].stops.map(([offset]) => offset), [0, 0.45, 1]);
    });

    it('drawSkyGradient uses palette[3] for the upper stop when the palette has one', () => {
        const host = makeHost();
        const ctx = makeCtx();
        withNow(0, () => drawSkyGradient(host, ctx, 300, 150, PALETTE, 0.4));
        const sky = ctx.of('fillRect')[0][5];
        assert.equal(sky.stops[1][1], 'rgba(123, 92, 255, 0.26)');
    });
});


describe('radio visualizer mode painters — bars, particles, waveforms', () => {
    it('paintBars draws one gradient column per bin above the baseline', () => {
        const ctx = makeCtx();
        paintBars(makeHost(), ctx, 320, 180, VALUES, PALETTE, 1);

        const rects = ctx.of('fillRect');
        assert.equal(rects.length, VALUES.length);
        // barWidth 40 → 38px columns with a 1px gutter
        assert.deepEqual(rects.map((rect) => rect[3]), Array(8).fill(38));
        assert.deepEqual(rects.map((rect) => rect[1]), Array.from({ length: 8 }, (_, i) => i * 40 + 1));

        const heights = rects.map((rect) => rect[4]);
        for (let i = 1; i < heights.length; i += 1) {
            assert.ok(heights[i] > heights[i - 1], 'louder bins draw taller');
        }
        // v * 180 * 0.55(sensitivity) * 1.05(motion) * 0.55(amplitude)
        assert.ok(Math.abs(heights[0] - 5.71725) < 1e-9, `first bar ${heights[0]}`);
        // every bar's bottom lands on the 0.78 baseline
        rects.forEach((rect, i) => {
            assert.ok(Math.abs(rect[2] + rect[4] - 140.4) < 1e-9, `bar ${i} baseline`);
        });
        assert.equal(rects[0][5].gradient, true, 'bars are filled with a gradient');
        assert.deepEqual(rects[0][5].stops, [
            [0, 'rgba(0, 240, 255, 0.9)'],
            [1, 'rgba(255, 43, 214, 0.2)']
        ]);
        assert.ok(Math.abs(rects[0][6] - (8 + 0.85 * 18)) < 1e-9, 'glow sets shadowBlur');
        assert.equal(ctx.saveDepth, 0, 'save/restore balanced');
    });

    it('paintBars scales with sensitivity and floors at 4px', () => {
        const tall = makeCtx();
        paintBars(makeHost({ settings: { sensitivity: 2 } }), tall, 320, 180, VALUES, PALETTE, 1);
        const quiet = makeCtx();
        paintBars(makeHost({ settings: { sensitivity: 0.5 } }), quiet, 320, 180, VALUES, PALETTE, 1);
        const tallHeights = tall.of('fillRect').map((rect) => rect[4]);
        const quietHeights = quiet.of('fillRect').map((rect) => rect[4]);
        assert.ok(Math.abs(tallHeights[7] - quietHeights[7] * 4) < 1e-9, 'height is linear in sensitivity');

        const silent = makeCtx();
        paintBars(makeHost({ settings: { sensitivity: 0 } }), silent, 320, 180, VALUES, PALETTE, 1);
        assert.deepEqual(silent.of('fillRect').map((rect) => rect[4]), Array(8).fill(4));

        const negative = makeCtx();
        paintBars(makeHost(), negative, 320, 180, [-0.4, 0, 0.5], PALETTE, 1);
        assert.deepEqual(negative.of('fillRect').map((rect) => rect[4]).slice(0, 2), [4, 4]);
    });

    it('paintParticles draws one dot per bin, pulsing with the beat', () => {
        const ctx = makeCtx();
        withNow(1_000, () => paintParticles(makeHost(), ctx, 320, 180, VALUES, PALETTE, 1));
        const dots = ctx.of('arc');
        assert.equal(dots.length, VALUES.length);
        for (const [, x, y, r] of dots) {
            assert.ok(x >= 10 && x <= 330, 'dot inside the canvas');
            assert.ok(y >= 0 && y <= 180, 'dot vertically in bounds');
            assert.ok(r >= 1.5 && r <= 12, `dot radius ${r}`);
        }
        assert.ok(dots[1][1] > dots[0][1], 'dots are spread across the width');
        assert.equal(ctx.of('fill')[0][1], 'rgba(184, 255, 60, 0.7)', 'palette offset by +2');
        assert.equal(ctx.saveDepth, 0);
    });

    it('paintWaveform rescales 8-bit time-domain samples around the centre line', () => {
        const ctx = makeCtx();
        paintWaveform(makeHost(), ctx, 320, 180, [0, 64, 128, 192, 255], PALETTE, 1);
        const points = [...ctx.of('moveTo'), ...ctx.of('lineTo')];
        assert.equal(points.length, 5);
        assert.deepEqual(points.map((point) => point[1]), [0, 64, 128, 192, 256]);
        // amp = 0.2 * 1 * 1.05 * 0.55
        assert.ok(Math.abs(points[0][2] - (90 - 180 * 0.1155)) < 1e-9);
        assert.ok(Math.abs(points[2][2] - 90) < 1e-9, 'mid sample sits on the centre line');
        assert.ok(points[3][2] > 90 && points[4][2] > points[3][2]);
        assert.equal(ctx.count('stroke'), 1);
        assert.equal(ctx.of('stroke')[0][1], 'rgba(0, 240, 255, 0.78)');
        assert.equal(ctx.saveDepth, 0);
    });

    it('paintWaveformSynth mirrors 0…1 bins around the centre line', () => {
        const ctx = makeCtx();
        paintWaveformSynth(makeHost(), ctx, 320, 180, [0.5, 1, 0], PALETTE, 1);
        const points = [...ctx.of('moveTo'), ...ctx.of('lineTo')];
        assert.equal(points.length, 3);
        assert.ok(Math.abs(points[0][2] - 90) < 1e-9, '0.5 stays centred');
        // ±1 * 180 * 0.16 * 1 * 1.05 * 0.55
        assert.ok(Math.abs(points[1][2] - (90 + 16.632)) < 1e-9);
        assert.ok(Math.abs(points[2][2] - (90 - 16.632)) < 1e-9);
        assert.equal(ctx.count('stroke'), 1);
        assert.equal(ctx.saveDepth, 0);
    });
});

describe('radio visualizer mode painters — rings, orb, spiral', () => {
    it('paintRings stacks seven concentric rings in the centre', () => {
        const ctx = makeCtx();
        paintRings(makeHost(), ctx, 320, 180, [0, 0, 0, 0, 0, 0, 0], PALETTE, 1);
        const rings = ctx.of('arc');
        assert.equal(rings.length, 7);
        rings.forEach(([, x, y, r], i) => {
            assert.equal(x, 160);
            assert.equal(y, 90);
            // 16 + i * 11 + motion(1) * 6 * amplitude(0.55)
            assert.ok(Math.abs(r - (19.3 + i * 11)) < 1e-9, `ring ${i} radius ${r}`);
        });
        assert.equal(ctx.of('stroke')[0][1], 'rgba(255, 43, 214, 0.35)', 'palette offset by +1');
        assert.equal(ctx.saveDepth, 0);
    });

    it('paintRings grows rings with bin strength and tolerates empty input', () => {
        const loud = makeCtx();
        paintRings(makeHost(), loud, 320, 180, Array(7).fill(1), PALETTE, 1);
        const quiet = makeCtx();
        paintRings(makeHost(), quiet, 320, 180, Array(7).fill(0), PALETTE, 1);
        // strength 1 * sensitivity 1 * amplitude 0.55 → +19.8px
        assert.ok(Math.abs(loud.of('arc')[3][3] - (quiet.of('arc')[3][3] + 19.8)) < 1e-9);

        const empty = makeCtx();
        assert.doesNotThrow(() => paintRings(makeHost(), empty, 320, 180, [], PALETTE, 1));
        assert.equal(empty.of('arc').length, 7, 'rings still render at zero strength');
    });

    it('paintOrb sizes a radial-gradient sphere from the average bin', () => {
        const ctx = makeCtx();
        paintOrb(makeHost(), ctx, 320, 180, Array(8).fill(0.5), PALETTE, 1);
        const [orb] = ctx.of('arc');
        // 180 * (0.14 + 0.5 * 0.4 * 1 * 0.55 + 1 * 0.05)
        assert.ok(Math.abs(orb[3] - 54) < 1e-9, `orb radius ${orb[3]}`);
        assert.equal(orb[1], 160);
        assert.equal(orb[2], 90);

        const grad = ctx.of('fill')[0][1];
        assert.equal(grad.kind, 'radial');
        assert.deepEqual(grad.args, [160, 90, 10.8, 160, 90, 86.4]);
        assert.deepEqual(grad.stops.map(([offset]) => offset), [0, 0.48, 1]);
        assert.equal(ctx.count('fill'), 1);
        assert.equal(ctx.saveDepth, 0);
    });

    it('paintOrb shrinks when the bins are silent', () => {
        const loud = makeCtx();
        paintOrb(makeHost(), loud, 320, 180, Array(8).fill(1), PALETTE, 1);
        const silent = makeCtx();
        paintOrb(makeHost(), silent, 320, 180, Array(8).fill(0), PALETTE, 1);
        assert.ok(loud.of('arc')[0][3] > silent.of('arc')[0][3]);
        // silent orb keeps the 0.14 base radius + the motion term
        assert.ok(Math.abs(silent.of('arc')[0][3] - 34.2) < 1e-9);
    });

    it('paintSpiral traces 150 points that rotate with the clock', () => {
        const ctx = makeCtx();
        withNow(0, () => paintSpiral(makeHost(), ctx, 320, 180, VALUES, PALETTE, 1));
        assert.equal(ctx.count('moveTo'), 1);
        assert.equal(ctx.count('lineTo'), 149);
        const [start] = ctx.of('moveTo');
        // strength 0.1 * 0.55 → radius 8 + 1.21 + 4, angle 0 at t = 0
        assert.ok(Math.abs(start[1] - 173.21) < 1e-9, `start x ${start[1]}`);
        assert.ok(Math.abs(start[2] - 90) < 1e-9);
        assert.equal(ctx.count('stroke'), 1);
        assert.equal(ctx.of('stroke')[0][1], 'rgba(123, 92, 255, 0.8)', 'palette[3] stroke');
        assert.equal(ctx.saveDepth, 0);

        const spun = makeCtx();
        withNow(5_000, () => paintSpiral(makeHost(), spun, 320, 180, VALUES, PALETTE, 1));
        assert.notEqual(spun.of('moveTo')[0][1], start[1], 'clock advances the spiral');
    });
});

describe('radio visualizer mode painters — sky and aurora', () => {
    it('paintNeonSky layers gradient sky, curtains, an orb and a ridge silhouette', () => {
        const host = makeHost();
        const ctx = makeCtx();
        withNow(1_000, () => paintNeonSky(host, ctx, 320, 180, VALUES, PALETTE, 1));

        // backdrop: vertical sky gradient + horizon glow
        assert.equal(ctx.count('fillRect'), 2);
        assert.ok(ctx.of('fillRect').every((call) => call[5].gradient));

        // 28 stars (width / 14, floored at 28) plus the orb
        const stars = ensureStars(host, 320, 180);
        assert.equal(stars.length, 28);
        assert.equal(ctx.count('arc'), stars.length + 1);
        const orb = ctx.of('arc').at(-1);
        // bpm 120 at t = 1000ms → phase 0 → cx = 320 * 0.72, radius 180 * 0.102
        assert.ok(Math.abs(orb[1] - 230.4) < 1e-9, `orb x ${orb[1]}`);
        assert.ok(Math.abs(orb[2] - 50.4) < 1e-9);
        assert.ok(Math.abs(orb[3] - 40.392) < 1e-9);

        // 4 aurora curtains plus the ridge outline
        const strokes = ctx.of('stroke');
        assert.equal(strokes.length, 5);
        // phase 0 → pulse 1 → 0.28 + 0.25
        assert.equal(strokes[0][1], 'rgba(0, 240, 255, 0.53)');
        assert.ok(Math.abs(strokes[0][2] - (16 + 0.85 * 20)) < 1e-9, 'curtain glow');
        // 0.55 + pulse * 0.3 — compare so float dust can't fail the string match
        assert.ok(strokes[4][1].startsWith('rgba(0, 240, 255, 0.85'), 'ridge uses palette[0] at full pulse');

        const ridge = ctx.of('fill')
            .map((call) => call[1])
            .filter((style) => style && style.gradient)
            .at(-1);
        assert.equal(ridge.kind, 'linear');
        assert.deepEqual(ridge.stops, [
            [0, 'rgba(255, 43, 214, 0.45)'],
            [1, '#02040a']
        ]);
        assert.equal(ctx.shadowBlur, 0, 'glow is reset before returning');
    });

    it('paintNeonSky reuses the cached starfield between frames', () => {
        const host = makeHost();
        const first = makeCtx();
        withNow(1_000, () => paintNeonSky(host, first, 320, 180, VALUES, PALETTE, 1));
        const starCount = host.stars.points.length;
        const second = makeCtx();
        withNow(1_050, () => paintNeonSky(host, second, 320, 180, VALUES, PALETTE, 1));
        assert.equal(host.stars.points.length, starCount, 'no rebuild for the same box');
        assert.equal(second.count('arc'), starCount + 1);
    });

    it('paintAuroraBands draws six gradient curtains over the sky', () => {
        const ctx = makeCtx();
        withNow(1_000, () => paintAuroraBands(makeHost(), ctx, 320, 180, VALUES, PALETTE, 1));

        const strokes = ctx.of('stroke');
        assert.equal(strokes.length, 6);
        const curtains = strokes.map((call) => call[1]).filter((style) => style && style.gradient);
        assert.equal(curtains.length, 6, 'each curtain strokes its own gradient');
        assert.deepEqual(curtains[0].args, [0, 0, 320, 0]);
        assert.deepEqual(curtains[0].stops.map(([offset]) => offset), [0, 0.5, 1]);
        // phase 0 → pulse 1 → 0.45 + 0.25 at the midpoint stop
        assert.equal(curtains[0].stops[1][1], 'rgba(255, 43, 214, 0.7)');
        // lineWidth = 3 + v * 6 * amplitude, v = values[0] = 0.1
        assert.ok(Math.abs(strokes[0][3] - 3.33) < 1e-9, `curtain width ${strokes[0][3]}`);
        assert.equal(strokes[0][2], 18, 'curtain glow');
        assert.equal(ctx.shadowBlur, 0);
    });

    it('paintAuroraBands keeps curtains vertically in bounds for a flat signal', () => {
        const ctx = makeCtx();
        withNow(0, () => paintAuroraBands(makeHost(), ctx, 400, 200, Array(16).fill(0), PALETTE, 1));
        const points = [...ctx.of('moveTo'), ...ctx.of('lineTo')];
        assert.ok(points.length > 0);
        for (const [, x, y] of points) {
            assert.ok(x >= 0 && x <= 400, `x ${x}`);
            assert.ok(y > -200 && y < 400, `y ${y}`);
        }
    });
});
