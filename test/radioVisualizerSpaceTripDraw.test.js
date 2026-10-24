// test/radioVisualizerSpaceTripDraw.test.js
// Space-trip drawing extracted from js/radioVisualizer.js into
// js/radioVisualizer/spaceTripDraw.js: nebula washes, tunnel walls, the earth
// and planet sprites, and the per-frame composition.
//
// Drawing is checked with a recording 2D-context stub; time and randomness are
// pinned so the frame composition is reproducible.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    drawSpaceTripNebula,
    drawSpaceTripNebulaWisps,
    drawSpaceTripTunnel,
    drawSpaceEarth,
    drawSpacePlanet,
    drawSpaceTrip
} from '../js/radioVisualizer/spaceTripDraw.js';
import { ensureSpaceTripState } from '../js/radioVisualizer/spaceTripState.js';
import { DEFAULTS } from '../js/radioVisualizer/settings.js';
import { PALETTES } from '../js/radioVisualizer/palettes.js';

const PALETTE = PALETTES.horizon;
const VALUES = [0.2, 0.4, 0.6, 0.8];

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
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
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
        quadraticCurveTo(cx, cy, x, y) {
            calls.push(['quadraticCurveTo', cx, cy, x, y]);
        },
        arc(x, y, r, start = 0, end = 0, ccw = false) {
            calls.push(['arc', x, y, r, start, end, ccw]);
        },
        ellipse(x, y, rx, ry, rot = 0, start = 0, end = 0) {
            calls.push(['ellipse', x, y, rx, ry, rot, start, end]);
        },
        rect(x, y, w, h) {
            calls.push(['rect', x, y, w, h]);
        },
        translate(x, y) {
            calls.push(['translate', x, y]);
        },
        rotate(angle) {
            calls.push(['rotate', angle]);
        },
        scale(x, y) {
            calls.push(['scale', x, y]);
        },
        clip() {
            calls.push(['clip']);
        },
        fillRect(x, y, w, h) {
            calls.push(['fillRect', x, y, w, h, ctx.fillStyle, ctx.shadowBlur]);
        },
        fill(rule) {
            calls.push(['fill', ctx.fillStyle, ctx.shadowBlur, rule]);
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

function makeHost(overrides = {}) {
    return {
        settings: { ...DEFAULTS, ...(overrides.settings || {}) },
        spaceTrip: overrides.spaceTrip ?? null
    };
}

function withNow(fixed, fn) {
    const realNow = Date.now;
    Date.now = () => fixed;
    try {
        return fn();
    } finally {
        Date.now = realNow;
    }
}

/** Deterministic Math.random: the sequence is replayed, then the last value repeats. */
function withRandom(sequence, fn) {
    const realRandom = Math.random;
    let index = 0;
    const seq = Array.isArray(sequence) ? sequence : [sequence];
    Math.random = () => {
        const value = seq[Math.min(index, seq.length - 1)];
        index += 1;
        return value;
    };
    try {
        return fn();
    } finally {
        Math.random = realRandom;
    }
}

describe('space trip nebula', () => {
    it('skips the nebula wash when the window is closed', () => {
        const ctx = makeCtx();
        drawSpaceTripNebula(makeHost(), ctx, 800, 600, 400, 300, null, PALETTE, 0, 0, 0.5, 1000);
        assert.equal(ctx.calls.length, 0, 'no state, no drawing');

        drawSpaceTripNebula(makeHost(), ctx, 800, 600, 400, 300, { nebulaBlobs: null }, PALETTE, 0.005, 0, 0.5, 1000);
        assert.equal(ctx.calls.length, 0, 'strength below the threshold');
    });

    it('layers the wash, seven blobs and sixteen light pools', () => {
        const state = { nebulaBlobs: null };
        const ctx = makeCtx();
        withRandom(0.5, () => drawSpaceTripNebula(makeHost(), ctx, 800, 600, 400, 300, state, PALETTE, 1, 0.3, 0.5, 1000));

        assert.equal(state.nebulaBlobs.length, 7, 'blob geometry cached on state');
        assert.equal(ctx.count('fillRect'), 25, '2 base washes + 7 blobs + 16 light pools');
        const wash = ctx.of('fillRect')[1][5];
        assert.equal(wash.kind, 'radial');
        assert.equal(wash.stops.at(-1)[1], 'rgba(0,0,0,0)');
        assert.ok(wash.stops.slice(0, 3).every(([, color]) => color.startsWith('rgba(')), 'translucent palette stops');
        assert.deepEqual(ctx.of('fillRect').map((call) => call[2]), Array(25).fill(0), 'full-canvas overlays');
        assert.equal(ctx.saveDepth, 0);
        assert.equal(ctx.globalCompositeOperation, 'lighter');
    });

    it('projects nebula wisps and skips ones behind the camera', () => {
        const viz = makeHost();
        const state = {
            nebulaWisps: [
                { x: 0, y: 0, z: 0.05, ang: 0.4, size: 0.02, aspect: 2.5, colorIdx: 2, alpha: 0.2 },
                { x: 0.3, y: 0.2, z: 0.01, ang: 0, size: 0.02, aspect: 2.5, colorIdx: 3, alpha: 0.2 }
            ]
        };
        const ctx = makeCtx();
        drawSpaceTripNebulaWisps(viz, ctx, 400, 300, 300, state, PALETTE, 1, 0.25, 10, -6);

        assert.equal(ctx.count('ellipse'), 1, 'only the wisp in front of the camera');
        assert.equal(ctx.count('fill'), 1);
        const wisp = ctx.of('ellipse')[0];
        assert.equal(wisp[1], 410, 'panned centre');
        assert.equal(wisp[2], 294);
        assert.ok(Math.abs(wisp[3] - 300) < 1e-9, 'aspect widens the ellipse');
        assert.ok(Math.abs(wisp[4] - 98.4) < 1e-9);
        assert.equal(ctx.saveDepth, 0);

        const empty = makeCtx();
        drawSpaceTripNebulaWisps(viz, empty, 400, 300, 300, { nebulaWisps: [] }, PALETTE, 1, 0.25, 0, 0);
        assert.equal(empty.calls.length, 0);
    });
});

describe('space trip tunnel', () => {
    it('stays dark before the hyper mix opens up', () => {
        const viz = makeHost();
        const ctx = makeCtx();
        drawSpaceTripTunnel(viz, ctx, 800, 600, 400, 300, { tunnelWarp: null }, PALETTE, 0.01, 0.5, 0, 330, 0, 0);
        assert.equal(ctx.calls.length, 0);
        assert.equal(viz.spaceTrip, null, 'no warp allocated while idle');
    });

    it('draws the bloom, wall segments, ring ellipses and streaks', () => {
        const viz = makeHost();
        const state = { tunnelWarp: null };
        const ctx = makeCtx();
        withNow(1000, () => withRandom(0.5, () => drawSpaceTripTunnel(
            viz, ctx, 800, 600, 400, 300, state, PALETTE, 1, 0.5, 0.2, 330, 5, -4
        )));

        assert.ok(state.tunnelWarp.rings.length === 20 && state.tunnelWarp.streaks.length === 80);
        assert.equal(ctx.globalAlpha, 1);
        assert.equal(ctx.of('fillRect')[0][5].stops.at(-1)[1], 'rgba(0,0,0,0)', 'bloom is a radial gradient');
        assert.equal(ctx.count('ellipse'), 40, 'two outlines per ring');
        assert.ok(ctx.count('stroke') > 600, `wall lattice + streaks (${ctx.count('stroke')})`);
        assert.ok(ctx.of('stroke').some((call) => call[1].startsWith('rgba(255, 255, 255, ')), 'bright streak cores');
        assert.equal(ctx.saveDepth, 0);
        assert.equal(viz.spaceTrip, null, 'warp stays on the draw state, not the host');
    });
});

describe('space trip planet sprites', () => {
    it('paints the earth with continents, clouds and atmosphere', () => {
        const ctx = makeCtx();
        drawSpaceEarth(makeHost(), ctx, 400, 300, 50, 1);

        assert.equal(ctx.count('arc'), 3, 'atmosphere, body and the clip circle');
        assert.equal(ctx.count('clip'), 1, 'continents are clipped to the globe');
        assert.equal(ctx.count('ellipse'), 14, '4 continents x 2 tones + 6 cloud bands');
        assert.equal(ctx.count('fill'), 16);
        assert.ok(ctx.of('fill').some((call) => call[1] === 'rgba(21, 128, 61, 0.88)'), 'land green');
        assert.ok(ctx.of('fill').some((call) => call[1] === 'rgba(248, 250, 252, 0.28)'), 'cloud white');
        assert.equal(ctx.saveDepth, 0);
        assert.equal(ctx.of('fill')[0][1].stops.at(-1)[1], 'rgba(0,0,0,0)', 'atmosphere fades out');
    });

    it('routes earth through the globe sprite', () => {
        const ctx = makeCtx();
        drawSpacePlanet(makeHost(), ctx, 200, 200, 40, { type: 'earth', colorIdx: 0 }, PALETTE, 1);
        assert.equal(ctx.count('ellipse'), 14);
        assert.equal(ctx.saveDepth, 0);
    });

    it('draws every sampled planet archetype', () => {
        const base = { colorIdx: 1, seed: 0, spin: 0 };
        const run = (type) => {
            const ctx = makeCtx();
            drawSpacePlanet(makeHost(), ctx, 200, 200, 40, { ...base, type, sizeClass: 'medium' }, PALETTE, 1);
            assert.equal(ctx.saveDepth, 0, `${type} balances save/restore`);
            return ctx;
        };

        const binary = run('binary');
        assert.equal(binary.count('arc'), 2);
        assert.equal(binary.count('fill'), 2, 'two suns, no shared body');

        const rocky = run('rocky');
        assert.equal(rocky.count('arc'), 5, 'body + four craters');
        assert.equal(rocky.count('stroke'), 4, 'crater rims');
        assert.ok(rocky.of('stroke').every((call) => call[1].startsWith('rgba(0, 0, 0, 0.25')));

        const gas = run('gas');
        assert.equal(gas.count('clip'), 1);
        assert.equal(gas.count('fillRect'), 7, 'seven latitude bands');

        const striped = run('striped');
        assert.equal(striped.count('clip'), 1);
        assert.equal(striped.count('fillRect'), 5, 'five vertical bands');

        const cloudy = run('cloudy');
        assert.equal(cloudy.count('ellipse'), 5);

        const ice = run('ice');
        assert.equal(ice.count('ellipse'), 1);
        assert.ok(ice.of('fill').some((call) => typeof call[1] === 'string'
            && call[1].startsWith('rgba(226, 232, 240, 0.35')));

        const ringed = run('ringed');
        assert.equal(ringed.count('ellipse'), 2, 'two ring outlines');
        assert.equal(ringed.count('stroke'), 2);
        assert.ok(ringed.of('ellipse').every((call) => Math.abs(call[5] + 0.32) < 1e-12), 'rings share the tilt');
    });
});


describe('space trip frame composition', () => {
    it('composes the dark cruise frame with stars and roll', () => {
        const viz = makeHost();
        const ctx = makeCtx();
        withNow(20_000, () => withRandom(0.5, () => drawSpaceTrip(viz, ctx, 800, 600, VALUES, PALETTE, 0.5)));

        assert.equal(ctx.of('fillRect')[0][5], '#010204', 'space backdrop first');
        assert.ok(
            ctx.of('fillRect').some((call) => call[5].gradient
                && call[5].stops.at(-1)[1] === 'rgba(0,0,0,0.45)'),
            'edge vignette outside the nebula window'
        );
        assert.equal(ctx.count('rotate'), 1, 'cockpit roll applied once');
        assert.ok(Math.abs(ctx.of('rotate')[0][1]) <= 0.21, 'roll stays inside the cockpit budget');
        assert.ok(ctx.count('arc') >= 200, `star sprites drawn (${ctx.count('arc')})`);
        assert.ok(ctx.count('stroke') > 100, 'star streaks drawn');
        assert.equal(ctx.saveDepth, 0);
        assert.equal(viz.spaceTrip.width, 800);
        assert.equal(viz.spaceTrip.lastFrameTime, 20_000);
        assert.equal(viz.spaceTrip.stars.length, 280);
    });

    it('washes the frame and projects wisps inside the nebula window', () => {
        const viz = makeHost();
        const state = withNow(10_000, () => withRandom(0.5, () => ensureSpaceTripState(viz, 800, 600)));
        const ctx = makeCtx();
        withNow(32_000, () => withRandom(0.5, () => drawSpaceTrip(viz, ctx, 800, 600, VALUES, PALETTE, 0.5)));

        assert.ok(
            !ctx.of('fillRect').some((call) => call[5].gradient
                && call[5].stops.at(-1)[1] === 'rgba(0,0,0,0.45)'),
            'no vignette while the nebula is open'
        );
        assert.ok(ctx.count('fillRect') >= 26, 'base fill + nebula washes');
        assert.equal(state.nebulaWisps.length, 36, 'wisps created for the fly-through');
        assert.ok(ctx.count('ellipse') >= 30, 'most wisps are in front of the camera');
        assert.equal(ctx.saveDepth, 0);
    });

    it('jumps to the tunnel during hyper and sweeps planets', () => {
        const viz = makeHost();
        const state = withNow(10_000, () => withRandom(0.5, () => ensureSpaceTripState(viz, 800, 600)));
        state.planets.push({
            type: 'ringed',
            sizeClass: 'medium',
            x: 0,
            y: 0,
            z: 0.8,
            radius: 0.08,
            colorIdx: 1,
            seed: 0.3,
            spin: 0
        });
        const ctx = makeCtx();
        withNow(80_000, () => withRandom(0.5, () => drawSpaceTrip(viz, ctx, 800, 600, VALUES, PALETTE, 0.5)));

        assert.equal(state.lastHyper.mode, 'hyper');
        assert.equal(state.planets.length, 0, 'traffic cleared before the jump');
        assert.equal(ctx.count('ellipse'), 40, 'only the 20 tunnel rings (2 outlines each)');
        assert.equal(ctx.count('arc'), 0, 'stars fade out of hyper');
        assert.equal(ctx.saveDepth, 0);
    });

    it('draws approaching planets with their planet sprite', () => {
        const viz = makeHost();
        const state = withNow(10_000, () => withRandom(0.5, () => ensureSpaceTripState(viz, 800, 600)));
        state.planets.push({
            type: 'ringed',
            sizeClass: 'medium',
            x: 0,
            y: 0,
            z: 0.8,
            radius: 0.08,
            colorIdx: 1,
            seed: 0.3,
            spin: 0
        });
        state.nextPlanetAt = Number.POSITIVE_INFINITY;
        const ctx = makeCtx();
        withNow(10_100, () => withRandom(0.5, () => drawSpaceTrip(viz, ctx, 800, 600, VALUES, PALETTE, 1)));

        assert.equal(state.planets.length, 1, 'planet still approaching');
        const rings = ctx.of('ellipse').filter((call) => Math.abs(call[5] + 0.32) < 1e-12);
        assert.equal(rings.length, 2, 'ringed planet sprite drawn');
        assert.ok(rings[0][3] > 50 && rings[0][3] < 65, `ring radius ${rings[0][3]}`);
        assert.ok(Math.abs(rings[0][1] - 400) < 1e-9 && Math.abs(rings[1][1] - 400) < 1e-9, 'rings centred on the planet');
        assert.ok(Math.abs(rings[0][3] / rings[1][3] - 1.75 / 1.45) < 1e-3, 'inner ring sits closer to the body');
        assert.equal(ctx.saveDepth, 0);
    });
});


