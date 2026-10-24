// test/radioVisualizerSpaceTripState.test.js
// Space-trip state extracted from js/radioVisualizer.js into
// js/radioVisualizer/spaceTripState.js: cruise/hyper timing, nebula window,
// spawners, warp geometry, projection and the per-frame update.
//
// Time and randomness are pinned so the schedules and spawn rolls are exact.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SPACE_CRUISE_MS,
    SPACE_HYPER_ENGAGE_MS,
    SPACE_HYPER_TRAVEL_MS,
    SPACE_HYPER_DISENGAGE_MS,
    SPACE_HYPER_CYCLE_MS,
    SPACE_PLANET_TYPES,
    SPACE_NEBULA_START_MS,
    SPACE_NEBULA_END_MS,
    SPACE_EARTH_CRUISE_SPAWN_MS,
    HYPER_WALL_COLORS,
    spawnSpaceStar,
    getSpaceTripCycleIndex,
    getSpaceTripCruiseElapsed,
    isEarthCruise,
    spawnSpaceEarthPlanet,
    spawnSpacePlanet,
    getSpaceTripNebulaStrength,
    ensureNebulaWisps,
    spawnNebulaWisp,
    ensureNebulaBlobs,
    getSpaceTripHyperPhase,
    updateSpaceTripRoll,
    updateSpaceTripDodge,
    ensureSpaceTripWarp,
    respawnTunnelRing,
    respawnTunnelStreak,
    spaceTripProject,
    ensureSpaceTripState,
    updateSpaceTrip
} from '../js/radioVisualizer/spaceTripState.js';
import { DEFAULTS } from '../js/radioVisualizer/settings.js';
import { PALETTES } from '../js/radioVisualizer/palettes.js';

const PALETTE = PALETTES.horizon;
const VALUES = [0.2, 0.4, 0.6, 0.8];

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

/** Bare state slice the pure helpers read. */
function makeState(overrides = {}) {
    return {
        cycleAnchor: 0,
        stars: [],
        planets: [],
        nextPlanetAt: Number.POSITIVE_INFINITY,
        lastFrameTime: null,
        rollAngle: 0,
        rollTarget: 0,
        nextRollAt: Number.POSITIVE_INFINITY,
        tunnelWarp: null,
        nebulaBlobs: null,
        nebulaWisps: null,
        earthSpawnedCycle: -1,
        dodge: { panX: 0, panY: 0, roll: 0, strength: 0 },
        ...overrides
    };
}

describe('space trip timing', () => {
    it('keeps the cruise/hyper schedule in one cycle constant', () => {
        assert.equal(SPACE_CRUISE_MS, 60_000);
        assert.equal(SPACE_HYPER_ENGAGE_MS, 5500);
        assert.equal(SPACE_HYPER_TRAVEL_MS, 30_000);
        assert.equal(SPACE_HYPER_DISENGAGE_MS, 5500);
        assert.equal(SPACE_HYPER_CYCLE_MS, 101_000);
        assert.equal(
            SPACE_HYPER_CYCLE_MS,
            SPACE_CRUISE_MS + SPACE_HYPER_ENGAGE_MS + SPACE_HYPER_TRAVEL_MS + SPACE_HYPER_DISENGAGE_MS
        );
        assert.equal(SPACE_NEBULA_START_MS, 20_000);
        assert.equal(SPACE_NEBULA_END_MS, 40_000);
        assert.equal(SPACE_EARTH_CRUISE_SPAWN_MS, 38_000);
        assert.deepEqual(SPACE_PLANET_TYPES, ['rocky', 'gas', 'ice', 'ringed', 'binary', 'striped', 'cloudy']);
        assert.equal(HYPER_WALL_COLORS.length, 8);
    });

    it('derives the cycle index and cruise window from the anchor', () => {
        const viz = makeHost();
        const state = makeState({ cycleAnchor: 1000 });

        assert.equal(getSpaceTripCycleIndex(viz, 1000, state), 0);
        assert.equal(getSpaceTripCycleIndex(viz, 1000 + SPACE_HYPER_CYCLE_MS - 1, state), 0);
        assert.equal(getSpaceTripCycleIndex(viz, 1000 + SPACE_HYPER_CYCLE_MS, state), 1);
        assert.equal(getSpaceTripCycleIndex(viz, 1000, makeState()), 0, 'missing anchor falls back to now');

        assert.equal(getSpaceTripCruiseElapsed(viz, 1000 + 30_000, state), 30_000);
        assert.equal(getSpaceTripCruiseElapsed(viz, 1000 + SPACE_CRUISE_MS, state), -1, 'past cruise');
        assert.equal(getSpaceTripCruiseElapsed(viz, 1000 + SPACE_HYPER_CYCLE_MS + 5000, state), 5000);
    });

    it('alternates earth cruises on odd cycles', () => {
        const viz = makeHost();
        const anchor = 1000; // truthy anchor; 0 would fall back to `now`
        const state = makeState({ cycleAnchor: anchor });
        assert.equal(isEarthCruise(viz, anchor + 10_000, state), false);
        assert.equal(isEarthCruise(viz, anchor + SPACE_HYPER_CYCLE_MS + 10_000, state), true);
        assert.equal(isEarthCruise(viz, anchor + SPACE_HYPER_CYCLE_MS * 2 + 10_000, state), false);
    });

    it('ramps hyper mix through engage, travel and disengage', () => {
        const viz = makeHost();
        const anchor = 1000;
        const state = makeState({ cycleAnchor: anchor });

        assert.deepEqual(getSpaceTripHyperPhase(viz, anchor + 10_000, state), { mode: 'cruise', mix: 0, speedMul: 1 });

        const halfEngage = getSpaceTripHyperPhase(viz, anchor + 60_000 + 2750, state);
        assert.equal(halfEngage.mode, 'engage');
        assert.ok(Math.abs(halfEngage.mix - 0.5) < 1e-9);
        assert.ok(Math.abs(halfEngage.speedMul - 2.25) < 1e-9);

        assert.deepEqual(getSpaceTripHyperPhase(viz, anchor + 80_000, state), { mode: 'hyper', mix: 1, speedMul: 4.5 });

        const disengaging = getSpaceTripHyperPhase(viz, anchor + 98_000, state);
        assert.equal(disengaging.mode, 'disengage');
        assert.ok(disengaging.mix > 0 && disengaging.mix < 1);
        assert.ok(disengaging.speedMul > 1 && disengaging.speedMul < 3.5);

        assert.deepEqual(
            getSpaceTripHyperPhase(viz, anchor + SPACE_HYPER_CYCLE_MS, state),
            { mode: 'cruise', mix: 0, speedMul: 1 }
        );
    });

    it('opens the nebula only in the cruise window', () => {
        const viz = makeHost();
        const anchor = 1000;
        const state = makeState({ cycleAnchor: anchor });
        const at = (elapsed) => getSpaceTripNebulaStrength(viz, anchor + elapsed, state);

        assert.equal(at(19_000), 0);
        assert.equal(at(20_000), 0);
        assert.ok(Math.abs(at(22_000) - 0.5) < 1e-9, 'halfway through the fade-in');
        assert.equal(at(30_000), 1);
        assert.ok(at(38_000) > 0, 'still fading out');
        assert.equal(at(40_000), 0);
        assert.equal(at(70_000), 0, 'no nebula during hyper');
    });
});



describe('space trip spawners', () => {
    it('rolls star kinds, positions and trails', () => {
        const viz = makeHost();
        const trail = withRandom(0, () => spawnSpaceStar(viz));
        assert.deepEqual(trail, {
            x: -1.3,
            y: -1.3,
            z: 0.06,
            hue: 0,
            tw: 0,
            kind: 'trail',
            colorIdx: 0,
            sizeMul: 0.55,
            history: []
        });

        const normal = withRandom(0.5, () => spawnSpaceStar(viz));
        assert.equal(normal.kind, 'normal');
        assert.equal(normal.x, 0);
        assert.equal(normal.y, 0);
        assert.equal(normal.z, 0.06 + 0.5 * 1.85);
        assert.equal(normal.colorIdx, 3);
        assert.equal(normal.sizeMul, 1.35);
        assert.equal(normal.history, null);

        assert.equal(withRandom(0.2, () => spawnSpaceStar(viz)).kind, 'bright');
        assert.equal(withRandom(0.9, () => spawnSpaceStar(viz)).kind, 'dim');
    });

    it('spawns a head-on earth with a dodge direction', () => {
        const planet = withRandom(0.25, () => spawnSpaceEarthPlanet(makeHost()));
        assert.equal(planet.type, 'earth');
        assert.equal(planet.sizeClass, 'headOn');
        assert.equal(planet.colorIdx, 0);
        assert.equal(planet.x, -0.015);
        assert.equal(planet.y, -0.0125);
        assert.ok(planet.z >= 2.15 && planet.z <= 2.6);
        assert.ok(Math.abs(planet.radius - 0.0815) < 1e-9);
        assert.equal(planet.dodgeDir, -1);
    });

    it('rolls planet type, size class and radius', () => {
        const state = makeState({ cycleAnchor: 1000 });
        const small = withRandom(0, () => spawnSpacePlanet(makeHost(), PALETTE, state, 1000));
        assert.equal(small.type, 'rocky');
        assert.equal(small.sizeClass, 'small');
        assert.equal(small.x, -0.575);
        assert.equal(small.y, -0.375);
        assert.equal(small.z, 3.2);
        assert.equal(small.radius, 0.012);
        assert.equal(small.dodgeDir, 0, 'only head-on planets dodge');

        const headOn = withRandom(
            [0, 0.9, 0, 0, 0, 0, 0, 0, 0, 0.25],
            () => spawnSpacePlanet(makeHost(), PALETTE, state, 1000)
        );
        assert.equal(headOn.sizeClass, 'headOn');
        assert.equal(headOn.x, -0.06);
        assert.equal(headOn.y, -0.05);
        assert.equal(headOn.z, 2.2);
        assert.equal(headOn.radius, 0.062);
        assert.equal(headOn.dodgeDir, -1);
    });

    it('downgrades head-on traffic to large during an earth cruise', () => {
        const state = makeState({ cycleAnchor: 1000 });
        const cruising = withRandom(
            [0, 0.9, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
            () => spawnSpacePlanet(makeHost(), PALETTE, state, 1000 + SPACE_HYPER_CYCLE_MS + 1000)
        );
        assert.equal(cruising.sizeClass, 'large');
        assert.equal(cruising.x, 0);
        assert.equal(cruising.y, 0);
        assert.equal(cruising.z, 4);
        assert.equal(cruising.radius, 0.067);
        assert.equal(cruising.dodgeDir, 0);
    });

    it('builds cached nebula wisps and blobs', () => {
        const state = makeState();
        const wisps = ensureNebulaWisps(makeHost(), state, PALETTE);
        assert.equal(wisps.length, 36);
        assert.equal(wisps[0].colorIdx, 2);
        assert.equal(wisps[35].colorIdx, 37);
        assert.ok(wisps.every((wisp) => wisp.alpha >= 0.12 && wisp.alpha <= 0.3));
        assert.ok(wisps.every((wisp) => wisp.aspect >= 1.8 && wisp.aspect <= 4.6));
        assert.equal(ensureNebulaWisps(makeHost(), state, PALETTE), wisps, 'cached');

        assert.equal(ensureNebulaWisps(makeHost(), makeState(), PALETTE, 5).length, 5);

        const wisp = withRandom(0.5, () => spawnNebulaWisp(makeHost()));
        assert.equal(wisp.z, 1.1 + 0.5 * 0.75);
        assert.equal(wisp.colorIdx, 3);
        assert.ok(Math.abs(wisp.size - 0.026) < 1e-12);

        const blobs = ensureNebulaBlobs(makeHost(), state, PALETTE);
        assert.equal(blobs.length, 7);
        assert.equal(blobs[0].color, PALETTE[1]);
        assert.equal(ensureNebulaBlobs(makeHost(), state, PALETTE), blobs, 'cached');
    });
});


describe('space trip warp and projection', () => {
    it('seeds 20 tunnel rings and 80 streaks once', () => {
        const state = makeState();
        const warp = withRandom(0.5, () => ensureSpaceTripWarp(makeHost(), state));

        assert.equal(warp.rings.length, 20);
        assert.equal(warp.streaks.length, 80);
        assert.equal(warp.rings[0].z, 0.04);
        assert.ok(Math.abs(warp.rings[19].z - 0.952) < 1e-12, 'ring 19 sits at 4% + 95% of the span');
        assert.equal(warp.rings[3].colorIdx, 3);
        assert.equal(warp.streaks[9].colorIdx, 1);
        assert.ok(warp.streaks.every((streak) => streak.radial >= 0.38 && streak.radial <= 0.5));
        assert.ok(warp.streaks.every((streak) => streak.len >= 0.07 && streak.len <= 0.23));
        assert.equal(ensureSpaceTripWarp(makeHost(), state), warp, 'cached');
    });

    it('recycles rings past the farthest ring', () => {
        const state = makeState();
        const warp = ensureSpaceTripWarp(makeHost(), state);
        const ring = warp.rings[0];
        withRandom(0.5, () => respawnTunnelRing(makeHost(), warp, ring));

        assert.ok(Math.abs(ring.z - 1.01) < 1e-12);
        assert.ok(Math.abs(ring.drift - Math.PI) < 1e-12);
        assert.equal(ring.colorIdx, 4);
        assert.equal(Math.max(...warp.rings.map((r) => r.z)), ring.z, 'sent to the back of the tunnel');
    });

    it('recycles streaks at the far wall', () => {
        const state = makeState();
        const warp = ensureSpaceTripWarp(makeHost(), state);
        const streak = warp.streaks[0];
        withRandom(0.25, () => respawnTunnelStreak(makeHost(), streak));

        assert.ok(Math.abs(streak.ang - Math.PI / 2) < 1e-12);
        assert.ok(Math.abs(streak.radial - 0.41) < 1e-12);
        assert.ok(Math.abs(streak.z - 0.9375) < 1e-12);
        assert.ok(Math.abs(streak.len - 0.11) < 1e-12);
        assert.equal(streak.colorIdx, 2);
    });

    it('projects through the focal plane with a floor on z', () => {
        const viz = makeHost();
        assert.deepEqual(spaceTripProject(viz, 400, 300, 300, 10, 20, 0.5, -0.25, 1), {
            sx: 560,
            sy: 245,
            invZ: 1
        });

        const near = spaceTripProject(viz, 400, 300, 300, 0, 0, 0.5, -0.25, 0.02);
        assert.equal(near.invZ, 50);
        assert.equal(near.sx, 400 + 0.5 * 300 * 50);

        const clipped = spaceTripProject(viz, 400, 300, 300, 0, 0, 0, 0, 0);
        assert.equal(clipped.invZ, 50, 'z clamps to 0.02');
        assert.equal(clipped.sx, 400);
        assert.equal(clipped.sy, 300);
    });
});

describe('space trip state lifecycle', () => {
    it('seeds the state for the canvas box', () => {
        const viz = makeHost();
        const state = withNow(50_000, () => withRandom(0.5, () => ensureSpaceTripState(viz, 800, 600)));

        assert.equal(viz.spaceTrip, state);
        assert.equal(state.width, 800);
        assert.equal(state.height, 600);
        assert.equal(state.stars.length, 280);
        assert.equal(state.cycleAnchor, 50_000);
        assert.equal(state.nextPlanetAt, 63_000, 'first planet 8-18s out');
        assert.equal(state.nextRollAt, 53_000);
        assert.equal(state.lastFrameTime, null);
        assert.equal(state.earthSpawnedCycle, -1);
        assert.equal(state.tunnelWarp, null);
        assert.deepEqual(state.dodge, { panX: 0, panY: 0, roll: 0, strength: 0 });
    });

    it('keeps the state for the same box and tracks the density setting', () => {
        const viz = makeHost({ settings: { density: 2 } });
        const state = withNow(1000, () => ensureSpaceTripState(viz, 800, 600));
        assert.equal(state.stars.length, 560);

        assert.equal(ensureSpaceTripState(viz, 800, 600), state, 'same canvas reuses state');
        viz.settings.density = 0.5;
        assert.equal(ensureSpaceTripState(viz, 800, 600).stars.length, 160, 'density floor of 160 stars');

        const resized = ensureSpaceTripState(viz, 640, 480);
        assert.notEqual(resized, state, 'resize reseeds');
        assert.equal(resized.width, 640);
        assert.equal(resized.height, 480);
    });

    it('advances stars, rings and streaks at one shared speed', () => {
        const viz = makeHost();
        const state = withNow(50_000, () => ensureSpaceTripState(viz, 800, 600));
        const warp = ensureSpaceTripWarp(viz, state);
        for (const star of state.stars) star.z = 1.5;
        const starZ = state.stars[0].z;
        const ringZ = warp.rings[0].z;

        withNow(50_000, () => withRandom(0.5, () => updateSpaceTrip(viz, 0.016, 0.5, VALUES)));

        const starDelta = starZ - state.stars[0].z;
        const ringDelta = ringZ - warp.rings[0].z;
        assert.ok(starDelta > 0, 'stars fly toward the camera');
        assert.ok(Math.abs(starDelta - ringDelta) < 1e-12, 'one frame speed for every layer');
        assert.equal(state.lastFrameTime, 50_000);
        assert.deepEqual(state.lastHyper, { mode: 'cruise', mix: 0, speedMul: 1 });
        assert.equal(state.planets.length, 0, 'no planet before nextPlanetAt');
    });

    it('clears planetary traffic during hyper travel', () => {
        const viz = makeHost();
        const state = makeState({
            cycleAnchor: 1000,
            nextPlanetAt: 0,
            planets: [
                { type: 'rocky', sizeClass: 'small', z: 2.5, x: 0, y: 0, radius: 0.02 },
                { type: 'earth', sizeClass: 'headOn', z: 2.4, x: 0, y: 0, radius: 0.09, dodgeDir: 1 }
            ]
        });
        viz.spaceTrip = state;

        withNow(1000 + 70_000, () => withRandom(0.5, () => updateSpaceTrip(viz, 0.016, 0.5, VALUES)));

        assert.equal(state.planets.length, 0, 'planets swept before the jump');
        assert.equal(state.lastHyper.mode, 'hyper');
        assert.ok(state.tunnelWarp, 'warp geometry is always available');
    });
});


describe('space trip dodge and roll', () => {
    it('steers the camera away from a close pass and relaxes afterwards', () => {
        const viz = makeHost();
        const state = makeState({
            planets: [{ type: 'earth', sizeClass: 'headOn', x: 0.05, y: 0.02, z: 0.2, dodgeDir: 1 }]
        });

        updateSpaceTripDodge(viz, state, 0.016, 300);
        const dodge = state.dodge;
        assert.ok(dodge.strength > 0.4 && dodge.strength < 0.7, `urgency ${dodge.strength}`);
        assert.ok(dodge.targetPanX > 0, 'slides away from the ship');
        assert.ok(Math.abs(dodge.targetPanX - 300 * (0.28 + 0.72 * dodge.strength)) < 1e-9);
        assert.ok(dodge.targetPanY < 0, 'lifts the view');
        assert.ok(dodge.targetRoll > 0, 'banks into the dodge');
        assert.ok(dodge.panX > 0 && dodge.panX < dodge.targetPanX, 'eases toward the target');

        const panX = dodge.panX;
        state.planets = [];
        updateSpaceTripDodge(viz, state, 0.016, 300);
        assert.equal(dodge.strength, 0);
        assert.equal(dodge.targetPanX, 0);
        assert.ok(dodge.panX > 0 && dodge.panX < panX, 'recentres gently');

        const far = makeState({ planets: [{ type: 'rocky', sizeClass: 'headOn', x: 0, y: 0, z: 0.9 }] });
        updateSpaceTripDodge(viz, far, 0.016, 300);
        assert.equal(far.dodge.strength, 0, 'far planets are not threats');

        const lateral = makeState({ planets: [{ type: 'earth', sizeClass: 'headOn', x: 0.6, y: 0, z: 0.2 }] });
        updateSpaceTripDodge(viz, lateral, 0.016, 300);
        assert.equal(lateral.dodge.strength, 0, 'wide passes are not threats');

        const tiny = makeState({ planets: [{ type: 'rocky', sizeClass: 'small', x: 0, y: 0, z: 0.2 }] });
        updateSpaceTripDodge(viz, tiny, 0.016, 300);
        assert.equal(tiny.dodge.strength, 0, 'only close passes and earths trigger a dodge');
    });

    it('rolls on a timer and freezes mid-dodge', () => {
        const viz = makeHost();
        const state = makeState({ nextRollAt: 0 });
        withRandom(0, () => updateSpaceTripRoll(viz, state, 5000, 0.1));

        assert.ok(Math.abs(state.rollTarget + 0.07) < 1e-12);
        assert.equal(state.nextRollAt, 9000);
        assert.ok(state.rollAngle < 0 && state.rollAngle > -0.07, 'eases toward the target');

        const easing = state.rollAngle;
        withRandom(0.9, () => updateSpaceTripRoll(viz, state, 5001, 0.1));
        assert.equal(state.rollTarget, -0.07, 'target frozen until the timer');
        assert.notEqual(state.rollAngle, easing, 'still drifting');

        const dodging = makeState({
            nextRollAt: 0,
            rollAngle: 0.03,
            rollTarget: 0.03,
            dodge: { panX: 0, panY: 0, roll: 0, strength: 0.5 }
        });
        withRandom(0, () => updateSpaceTripRoll(viz, dodging, 60_000, 0.1));
        assert.equal(dodging.nextRollAt, 0, 'timer paused mid-dodge');
        assert.equal(dodging.rollAngle, 0.03);
    });
});
