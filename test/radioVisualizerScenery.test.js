// test/radioVisualizerScenery.test.js
// Mountain/sea scenery extracted from js/radioVisualizer.js into
// js/radioVisualizer/scenery.js: world sequencing, sky + birds, ridges,
// scrolling decor, vessels and the sea.
//
// Drawing is checked with a recording 2D-context stub; time and randomness are
// pinned so scene picks and geometry are reproducible.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    pickNextMountainScene,
    ensureMountainWorld,
    wrapScreenX,
    spawnBirds,
    updateAndDrawBirds,
    drawSunMoon,
    drawMountainSky,
    ridgeYAt,
    drawCactus,
    drawTree,
    drawScrollingDecor,
    drawSailboat,
    drawShip,
    drawSurfer,
    drawSea,
    drawTerrainContent,
    drawMountains
} from '../js/radioVisualizer/scenery.js';
import { DEFAULTS } from '../js/radioVisualizer/settings.js';
import { PALETTES } from '../js/radioVisualizer/palettes.js';

const PALETTE = PALETTES.horizon;
const VALUES = Array.from({ length: 8 }, (_, i) => (i + 1) / 10);

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
        ellipse(x, y, rx, ry) {
            calls.push(['ellipse', x, y, rx, ry]);
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
        clearRect(x, y, w, h) {
            calls.push(['clearRect', x, y, w, h]);
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

/** Host slice the scenery reads. */
function makeHost(overrides = {}) {
    return {
        settings: { ...DEFAULTS, ...(overrides.settings || {}) },
        travelScroll: 0,
        mountainCycleStart: null,
        mountainScene: null,
        mountainSceneQueue: [],
        mountainSceneStartedAt: 0,
        sceneTransition: null,
        birds: [],
        nextBirdAt: 0,
        stars: null,
        _mountainLastNow: null,
        ...(overrides.host || {})
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

describe('scenery world sequencing', () => {
    it('seeds a fresh scene rotation after the sea scene', () => {
        const viz = makeHost({ host: { mountainScene: 'sea' } });
        const next = withRandom(0, () => pickNextMountainScene(viz));

        assert.deepEqual([...viz.mountainSceneQueue], ['cactus']);
        assert.equal(next, 'forest');
        assert.notEqual(next, 'sea');
    });

    it('falls back to the sea once the rotation is spent', () => {
        const viz = makeHost({ host: { mountainScene: 'cactus' } });
        assert.equal(pickNextMountainScene(viz), 'sea');

        const queued = makeHost({ host: { mountainScene: 'cactus', mountainSceneQueue: ['forest'] } });
        assert.equal(pickNextMountainScene(queued), 'forest');
        assert.equal(queued.mountainSceneQueue.length, 0);
    });

    it('seeds the world and reports the day cycle', () => {
        const viz = makeHost();
        const cycle = withRandom(0, () => ensureMountainWorld(viz, 1000));

        assert.equal(viz.mountainCycleStart, 1000);
        assert.equal(viz.mountainScene, 'forest');
        assert.equal(viz.mountainSceneStartedAt, 1000);
        assert.equal(viz.sceneTransition, null);
        assert.equal(typeof cycle.dayness, 'number');
        assert.ok(cycle.dayness >= 0 && cycle.dayness <= 1);
        assert.ok(Number.isFinite(cycle.t));
    });

    it('drops a scene left over from an older rotation', () => {
        const viz = makeHost({
            host: {
                mountainScene: 'palm',
                mountainSceneQueue: ['cactus'],
                sceneTransition: { from: 'palm', to: 'sea', start: 0, duration: 1 }
            }
        });
        withRandom(0, () => ensureMountainWorld(viz, 500));

        assert.equal(viz.mountainScene, 'forest');
        assert.deepEqual([...viz.mountainSceneQueue], ['cactus']);
        assert.equal(viz.sceneTransition, null);
        assert.equal(viz.mountainSceneStartedAt, 500);
    });

    it('holds a scene for its hold window, then fades through a transition', () => {
        const viz = makeHost({
            settings: { travel: 1 },
            host: { mountainScene: 'cactus', mountainSceneStartedAt: 0, mountainCycleStart: 0 }
        });

        withRandom(0, () => ensureMountainWorld(viz, 18_000 - 1));
        assert.equal(viz.sceneTransition, null, 'still inside the 18s hold');

        withRandom(0, () => ensureMountainWorld(viz, 18_000));
        assert.deepEqual(
            {
                from: viz.sceneTransition.from,
                to: viz.sceneTransition.to,
                start: viz.sceneTransition.start,
                duration: viz.sceneTransition.duration
            },
            { from: 'cactus', to: 'sea', start: 18_000, duration: 3000 }
        );

        withRandom(0, () => ensureMountainWorld(viz, 21_000));
        assert.equal(viz.mountainScene, 'sea');
        assert.equal(viz.mountainSceneStartedAt, 21_000);
        assert.equal(viz.sceneTransition, null);
    });

    it('scales the hold window with the travel pace', () => {
        const slow = makeHost({
            settings: { travel: 0.5 },
            host: { mountainScene: 'cactus', mountainSceneStartedAt: 0 }
        });
        withRandom(0, () => ensureMountainWorld(slow, 30_000));
        assert.equal(slow.sceneTransition, null, '30s is inside 18s / 0.5');

        withRandom(0, () => ensureMountainWorld(slow, 36_000));
        assert.ok(slow.sceneTransition, '36s clears the slower hold');
    });

    it('wraps world x into the parallax band and follows the scroll', () => {
        const viz = makeHost();
        assert.equal(wrapScreenX(viz, 0, 1000), -150);
        assert.equal(wrapScreenX(viz, 1100, 1000), 950);
        assert.equal(wrapScreenX(viz, 2200, 1000), -150);

        viz.travelScroll = 100;
        assert.equal(wrapScreenX(viz, 0, 1000, 2), 1850);
        for (const x of [0, 500, 1000, 1500, 2200]) {
            const wrapped = wrapScreenX(viz, x, 1000);
            assert.ok(wrapped > -151 && wrapped < 2051, `wrapped ${wrapped} stays in band`);
        }
    });
});



describe('scenery sky and birds', () => {
    it('spawns a flock only after the cooldown', () => {
        const viz = makeHost({ host: { nextBirdAt: 5000 } });
        withRandom(0, () => spawnBirds(viz, 800, 600, 4999));
        assert.equal(viz.birds.length, 0);

        withRandom(0, () => spawnBirds(viz, 800, 600, 5000));
        assert.equal(viz.birds.length, 1);
        assert.equal(viz.birds[0].x, 830);
        assert.ok(viz.birds[0].vx < 0, 'dir roll 0 flies left');
        assert.equal(viz.nextBirdAt, 14_000);
        assert.equal(viz.birds[0].style, 0);
        assert.ok(viz.birds[0].y >= 600 * 0.08 - 11);
    });

    it('advances, draws and prunes birds', () => {
        const viz = makeHost({
            host: {
                nextBirdAt: Number.POSITIVE_INFINITY,
                birds: [
                    { x: 100, y: 60, vx: 10, flap: 0, flapRate: 10, size: 3, style: 0, bob: 0 },
                    { x: 200, y: 90, vx: -8, flap: 0, flapRate: 6, size: 4, style: 1, bob: 0 },
                    { x: 300, y: 30, vx: 4, flap: 0, flapRate: 8, size: 5, style: 2, bob: 0 },
                    { x: -60, y: 30, vx: 4, flap: 0, flapRate: 8, size: 5, style: 2, bob: 0 }
                ]
            }
        });
        const ctx = makeCtx();
        updateAndDrawBirds(viz, ctx, 800, 600, 1000, 0.5, PALETTE, 0.6);

        assert.equal(viz.birds.length, 3, 'offscreen bird pruned');
        assert.equal(viz.birds[0].x, 105);
        assert.ok(Math.abs(viz.birds[0].flap - 5) < 1e-9);
        assert.ok(Math.abs(viz.birds[1].flap - 3) < 1e-9);
        assert.equal(ctx.count('beginPath'), 3);
        assert.equal(ctx.count('stroke'), 2, 'two stroke-style birds');
        assert.equal(ctx.count('fill'), 1, 'one filled bird');
        assert.equal(ctx.count('quadraticCurveTo'), 3);
        assert.match(ctx.of('stroke')[0][1], /^rgba\(\d+, \d+, \d+, 0\.\d+\)$/, 'ink colour from palette');
        assert.equal(ctx.saveDepth, 0);
    });

    it('draws a glowing sun by day and a moon by night', () => {
        const dayCtx = makeCtx();
        drawSunMoon(makeHost(), dayCtx, 800, 600, PALETTE, {
            sunness: 1,
            moonness: 0,
            sunArc: 0.5,
            moonArc: 0,
            dayness: 0.5
        }, 0.4);
        const core = dayCtx.of('fill').at(-1);
        assert.ok(core[1].gradient, 'sun core uses a radial gradient');
        assert.ok(core[1].stops.some(([, color]) => color === 'rgba(255, 247, 173, 0.98)'));
        assert.ok(core[2] > 0, 'sun glows');
        assert.equal(dayCtx.shadowBlur, 0, 'glow reset afterwards');

        const nightCtx = makeCtx();
        drawSunMoon(makeHost(), nightCtx, 800, 600, PALETTE, {
            sunness: 0,
            moonness: 1,
            sunArc: 0,
            moonArc: 0.5,
            dayness: 0
        }, 0.4);
        const moon = nightCtx.of('fill').at(-1);
        assert.equal(moon[3], 'evenodd');
        assert.equal(nightCtx.count('arc'), 3, 'halo plus two moon arcs');

        const quietCtx = makeCtx();
        drawSunMoon(makeHost(), quietCtx, 800, 600, PALETTE, {
            sunness: 0,
            moonness: 0,
            sunArc: 0,
            moonArc: 0,
            dayness: 0.5
        }, 0.4);
        assert.equal(quietCtx.calls.length, 0, 'nothing to draw between sun and moon');
    });
});


describe('scenery sky gradient', () => {
    it('paints the sky gradient, sunset wash and night stars', () => {
        const viz = makeHost();
        const ctx = makeCtx();
        withNow(1000, () => drawMountainSky(viz, ctx, 800, 600, PALETTE, 0.4, {
            dayness: 0,
            t: 0.25,
            sunsetness: 0.5,
            duskness: 0.2
        }));

        const first = ctx.of('fillRect')[0];
        assert.equal(first[3], 800);
        assert.equal(first[4], 600);
        assert.equal(first[5].stops.length, 5);
        assert.deepEqual(first[5].stops.map(([offset]) => offset), [0, 0.18, 0.4, 0.68, 1]);
        assert.ok(
            ctx.of('fillRect').some((call) => call[5].gradient
                && call[5].stops.some(([, color]) => color === 'rgba(255, 43, 214, 0.11)')),
            'sunset wash present'
        );
        assert.ok(
            ctx.of('fillRect').some((call) => call[5].gradient
                && call[5].stops.some(([, color]) => color.startsWith('rgba(91, 33, 182'))),
            'dusk wash present'
        );

        assert.ok(viz.stars?.points?.length > 0, 'star field seeded');
        assert.equal(viz.stars.width, 800);
        assert.ok(ctx.count('arc') > 10, 'stars drawn at night');
        assert.equal(ctx.saveDepth, 0);
    });
});
describe('scenery ridges and decor', () => {
    const LAYER = { y: 0.7, scale: 0.5, li: 1, speed: 0.0002 };

    it('raises the ridge with louder values and slides with the scroll', () => {
        const viz = makeHost();
        const loud = ridgeYAt(viz, 123, 800, 600, LAYER, [1, 1, 1, 1], 0, 0, 0.6, 0, 0);
        const quiet = ridgeYAt(viz, 123, 800, 600, LAYER, [0, 0, 0, 0], 0, 0, 0.6, 0, 0);
        assert.ok(loud < quiet, 'louder values lift the ridge');

        const scrolled = ridgeYAt(viz, 123, 800, 600, LAYER, [0.5, 0.5, 0.5, 0.5], 0, 0, 0.6, 0, 400);
        const stuck = ridgeYAt(viz, 123, 800, 600, LAYER, [0.5, 0.5, 0.5, 0.5], 0, 0, 0.6, 0, 0);
        assert.ok(Math.abs(scrolled - stuck) > 1e-6, 'scroll shifts the sampled terrain');

        const sensitive = makeHost({ settings: { sensitivity: 2 } });
        const picked = ridgeYAt(sensitive, 123, 800, 600, LAYER, [1, 1, 1, 1], 0, 0, 0.6, 0, 0);
        assert.ok(picked < loud, 'sensitivity deepens the peaks');
        assert.ok(Number.isFinite(ridgeYAt(viz, 0, 800, 600, LAYER, [], 0, 0, 1, 0, 0)), 'empty values still resolve');
    });

    it('draws cacti and trees with variant geometry', () => {
        const ctx = makeCtx();
        drawCactus(makeHost(), ctx, 100, 300, 1.2, 'rgba(1, 2, 3, 1)', 0);
        assert.equal(ctx.count('fillRect'), 1, 'single column variant');
        assert.deepEqual(ctx.of('translate')[0], ['translate', 100, 300]);
        assert.deepEqual(ctx.of('scale')[0], ['scale', 1.2, 1.2]);
        assert.equal(ctx.fillStyle, 'rgba(1, 2, 3, 1)');
        assert.equal(ctx.saveDepth, 0);

        const armed = makeCtx();
        drawCactus(makeHost(), armed, 10, 20, 1, '#fff', 1);
        assert.equal(armed.count('fillRect'), 3, 'left arm variant');

        const classic = makeCtx();
        drawCactus(makeHost(), classic, 10, 20, 1, '#fff', 4);
        assert.equal(classic.count('fillRect'), 5, 'two-arm variant');

        const wrapped = makeCtx();
        drawCactus(makeHost(), wrapped, 10, 20, 1, '#fff', -1);
        assert.equal(wrapped.count('fillRect'), 5, 'negative variant wraps');

        const tree = makeCtx();
        drawTree(makeHost(), tree, 50, 400, 0.8, '#3b2a1a', '#2d6a3e');
        assert.equal(tree.count('fillRect'), 1, 'trunk');
        assert.equal(tree.of('fillRect')[0][5], '#3b2a1a');
        assert.equal(tree.count('fill'), 2, 'two leafy tiers');
        assert.deepEqual(tree.of('fill').map((call) => call[1]), ['#2d6a3e', '#2d6a3e']);
        assert.equal(tree.count('closePath'), 2);
        assert.equal(tree.saveDepth, 0);
    });

    it('scatters scrolling decor per scene and ignores unknown scenes', () => {
        const cactus = makeCtx();
        const viz = makeHost({ host: { travelScroll: 120 } });
        drawScrollingDecor(viz, cactus, 800, 600, 'cactus', LAYER, VALUES, 0, 1000, 0.6, 0, PALETTE, 0.4);
        assert.ok(cactus.count('fillRect') > 0, 'cacti drawn');
        assert.match(cactus.fillStyle, /^rgba\(77, 107, 60, 0\.\d+\)$/, 'cactus green tint');

        const forest = makeCtx();
        drawScrollingDecor(viz, forest, 800, 600, 'forest', LAYER, VALUES, 0, 1000, 0.6, 0, PALETTE, 0.4);
        assert.ok(forest.of('fillRect').some((call) => call[5] === 'rgba(59, 42, 26, 0.95)'), 'trunks use the forest brown');
        assert.ok(forest.count('fill') > 0, 'leaf tiers drawn');

        const none = makeCtx();
        drawScrollingDecor(viz, none, 800, 600, 'palm', LAYER, VALUES, 0, 1000, 0.6, 0, PALETTE, 0.4);
        assert.equal(none.calls.length, 0, 'unknown scene draws nothing');
    });
});

describe('scenery sea and terrain composition', () => {
    it('draws sailboat, ship and surfer with clean transforms', () => {
        const boat = makeCtx();
        drawSailboat(makeHost(), boat, 120, 380, 1.1, 'rgba(15, 23, 42, 0.92)', 'rgba(244, 114, 182, 0.8)', 1.2);
        assert.equal(boat.saveDepth, 0);
        assert.equal(boat.shadowBlur, 0, 'sail glow cleared');
        assert.equal(boat.count('fill'), 2, 'hull + mainsail');
        assert.equal(boat.count('stroke'), 2, 'mast + wake');
        assert.ok(boat.of('fill').some((call) => call[1] === 'rgba(244, 114, 182, 0.8)'));
        assert.equal(boat.count('rotate'), 1, 'heels with the wind');
        assert.deepEqual(boat.of('translate')[0], ['translate', 120, 380]);

        const ship = makeCtx();
        drawShip(makeHost(), ship, 200, 400, 0.9, 'rgba(11, 18, 32, 0.95)', 'rgba(125, 211, 252, 0.75)');
        assert.equal(ship.saveDepth, 0);
        assert.equal(ship.count('fill'), 1, 'hull');
        assert.equal(ship.count('fillRect'), 4, 'cabin + three lights');
        assert.equal(ship.shadowBlur, 0, 'light glow cleared');

        const surfer = makeCtx();
        drawSurfer(makeHost(), surfer, 300, 420, 1, 'rgba(167, 139, 250, 0.85)', 'rgba(30, 41, 59, 0.9)');
        assert.equal(surfer.saveDepth, 0);
        assert.equal(surfer.count('fill'), 2, 'board + head');
        assert.equal(surfer.count('fillRect'), 1, 'torso');
        assert.equal(surfer.count('stroke'), 1, 'arms');
    });

    it('paints the sea surface, wave bands and encounter sparkle', () => {
        const viz = makeHost({ host: { travelScroll: 240 } });
        const ctx = makeCtx();
        withNow(9000, () => drawSea(viz, ctx, 800, 600, VALUES, PALETTE, 0.6, { dayness: 0.5 }));

        const land = ctx.of('fill').find((call) => call[1].gradient && call[1].stops.length === 2);
        assert.ok(land, 'shore mass filled');
        const water = ctx.of('fillRect').find((call) => call[5].gradient
            && call[5].stops.some(([, color]) => color === '#020617'));
        assert.ok(water, 'water gradient painted');
        assert.equal(water[3], 800);
        assert.ok(Math.abs(water[4] - 276) < 1e-6, 'water spans from 54% height to the floor');
        assert.ok(ctx.count('stroke') >= 6, 'five wave bands + horizon line');
        assert.ok(ctx.count('arc') >= 18, 'sparkles drawn');
        assert.equal(ctx.saveDepth, 0);
        assert.equal(ctx.shadowBlur, 0);
    });

    it('routes sea scenes to water and land scenes to ridges', () => {
        const sea = makeCtx();
        drawTerrainContent(makeHost(), sea, 800, 600, VALUES, PALETTE, 0.6, { dayness: 0.4 }, 'sea', 0.6, 1000);
        assert.ok(sea.of('fillRect').some((call) => call[5].gradient
            && call[5].stops.some(([, color]) => color === '#020617')), 'sea path taken');

        const land = makeCtx();
        drawTerrainContent(makeHost(), land, 800, 600, VALUES, PALETTE, 0.6, { dayness: 0.4 }, 'cactus', 0.6, 1000);
        assert.equal(land.count('fill'), 3, 'three ridge layers');
        assert.equal(land.count('stroke'), 3, 'three ridge outlines');
        assert.ok(land.of('fillRect').some((call) => call[3] === 800 && Math.abs(call[4] - 600 * 0.18) < 1e-6), 'ground glow');
        assert.ok(land.count('fillRect') > 3, 'cacti scattered on the front ridge');
        assert.equal(land.saveDepth, 0);
    });

    it('advances the travel scroll and seeds the scene on first frame', () => {
        const viz = makeHost();
        const ctx = makeCtx();
        withNow(1000, () => withRandom(0, () => drawMountains(viz, ctx, 800, 600, VALUES, PALETTE, 1)));

        assert.ok(Math.abs(viz.travelScroll - 0.176) < 1e-9, `scroll ${viz.travelScroll}`);
        assert.equal(viz.mountainCycleStart, 1000);
        assert.equal(viz.mountainScene, 'forest');
        assert.equal(viz._mountainLastNow, 1000);
        assert.ok(ctx.of('fillRect').length >= 3, 'sky, ground glow and terrain painted');
        assert.ok(ctx.count('fill') >= 3, 'ridges filled');
        assert.equal(ctx.saveDepth, 0);
    });

    it('holds the screen black through the middle of a scene cut', () => {
        const viz = makeHost({
            host: {
                mountainCycleStart: 0,
                mountainScene: 'cactus',
                mountainSceneStartedAt: 0,
                sceneTransition: { from: 'cactus', to: 'sea', start: 700, duration: 600 }
            }
        });
        const ctx = makeCtx();
        withNow(1000, () => drawMountains(viz, ctx, 800, 600, VALUES, PALETTE, 1));

        const overlay = ctx.of('fillRect').at(-1);
        assert.equal(overlay[5], 'rgba(0,0,0,1)', 'full black at the cut');
        assert.equal(overlay[3], 800);
        assert.equal(overlay[4], 600);
        assert.ok(ctx.of('fillRect').some((call) => call[5].gradient
            && call[5].stops.some(([, color]) => color === '#020617')), 'outgoing sea scene still rendered under the fade');
    });
});

