/** @module {"owns":"radio visualizer space-trip state: constants, spawners, nebula/warp/tunnel setup and the per-frame update", "related":["radioVisualizer.js","radioVisualizer/spaceTripDraw.js","radioVisualizer/controls.js"]} */

import { alpha, clamp, pickColor, smoothstep, beatPulse, ampScale } from './settings.js';
import { PALETTES } from './palettes.js';
import { travelPace } from './controls.js';

export const SPACE_CRUISE_MS = 60_000;
export const SPACE_HYPER_ENGAGE_MS = 5_500;
export const SPACE_HYPER_TRAVEL_MS = 30_000;
export const SPACE_HYPER_DISENGAGE_MS = 5_500;
export const SPACE_HYPER_CYCLE_MS = SPACE_CRUISE_MS + SPACE_HYPER_ENGAGE_MS + SPACE_HYPER_TRAVEL_MS + SPACE_HYPER_DISENGAGE_MS;

export const SPACE_PLANET_TYPES = ['rocky', 'gas', 'ice', 'ringed', 'binary', 'striped', 'cloudy'];
export const SPACE_NEBULA_START_MS = 20_000;
export const SPACE_NEBULA_FADE_IN_MS = 4_000;
export const SPACE_NEBULA_HOLD_MS = 12_000;
export const SPACE_NEBULA_FADE_OUT_MS = 4_000;
export const SPACE_NEBULA_END_MS = SPACE_NEBULA_START_MS + SPACE_NEBULA_FADE_IN_MS + SPACE_NEBULA_HOLD_MS + SPACE_NEBULA_FADE_OUT_MS;
export const SPACE_EARTH_CRUISE_SPAWN_MS = 38_000;
export const HYPER_WALL_COLORS = ['#67e8f9', '#38bdf8', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#34d399', '#818cf8'];

export function spawnSpaceStar(viz) {
    const roll = Math.random();
    const kind = roll < 0.14 ? 'trail' : roll < 0.32 ? 'bright' : roll < 0.62 ? 'normal' : 'dim';
    return {
        x: (Math.random() - 0.5) * 2.6,
        y: (Math.random() - 0.5) * 2.6,
        z: Math.random() * 1.85 + 0.06,
        hue: Math.random(),
        tw: Math.random() * Math.PI * 2,
        kind,
        colorIdx: Math.floor(Math.random() * 6),
        sizeMul: 0.55 + Math.random() * 1.6,
        history: kind === 'trail' ? [] : null
    };
}

export function getSpaceTripCycleIndex(viz, now, state) {
    return Math.floor((now - (state.cycleAnchor || now)) / SPACE_HYPER_CYCLE_MS);
}

export function getSpaceTripCruiseElapsed(viz, now, state) {
    const elapsed = (now - (state.cycleAnchor || now)) % SPACE_HYPER_CYCLE_MS;
    return elapsed < SPACE_CRUISE_MS ? elapsed : -1;
}

export function isEarthCruise(viz, now, state) {
    return getSpaceTripCycleIndex(viz, now, state) % 2 === 1;
}

export function spawnSpaceEarthPlanet(viz) {
    return {
        x: (Math.random() - 0.5) * 0.06,
        y: (Math.random() - 0.5) * 0.05,
        z: 2.15 + Math.random() * 0.45,
        radius: 0.072 + Math.random() * 0.038,
        colorIdx: 0,
        type: 'earth',
        sizeClass: 'headOn',
        spin: Math.random() * Math.PI * 2,
        seed: Math.random(),
        dodgeDir: Math.random() < 0.5 ? -1 : 1
    };
}

export function spawnSpacePlanet(viz, palette, state, now) {
    const type = SPACE_PLANET_TYPES[Math.floor(Math.random() * SPACE_PLANET_TYPES.length)];
    const roll = Math.random();
    const earthCruise = isEarthCruise(viz, now, state);
    let sizeClass = 'medium';
    if (roll < 0.22) sizeClass = 'small';
    else if (roll < 0.52) sizeClass = 'medium';
    else if (roll < 0.76) sizeClass = 'large';
    else if (!earthCruise) sizeClass = 'headOn';
    else sizeClass = 'large';

    const headOn = sizeClass === 'headOn';
    const x = headOn ? (Math.random() - 0.5) * 0.12 : (Math.random() - 0.5) * 1.15;
    const y = headOn ? (Math.random() - 0.5) * 0.1 : (Math.random() - 0.5) * 0.75;
    const z = headOn ? 2.2 + Math.random() * 0.75 : 3.2 + Math.random() * 1.6;

    let radius;
    if (sizeClass === 'small') radius = 0.012 + Math.random() * 0.016;
    else if (sizeClass === 'medium') radius = 0.02 + Math.random() * 0.028;
    else if (sizeClass === 'large') radius = 0.042 + Math.random() * 0.05;
    else radius = 0.062 + Math.random() * 0.072;

    return {
        x,
        y,
        z,
        radius,
        colorIdx: Math.floor(Math.random() * palette.length),
        type,
        sizeClass,
        spin: Math.random() * Math.PI * 2,
        seed: Math.random(),
        dodgeDir: headOn ? (Math.random() < 0.5 ? -1 : 1) : 0
    };
}

export function getSpaceTripNebulaStrength(viz, now, state) {
    const hyper = getSpaceTripHyperPhase(viz, now, state);
    if (hyper.mode !== 'cruise') return 0;

    const cruiseElapsed = (now - (state.cycleAnchor || now)) % SPACE_HYPER_CYCLE_MS;
    if (cruiseElapsed < SPACE_NEBULA_START_MS || cruiseElapsed > SPACE_NEBULA_END_MS) return 0;

    const fadeInEnd = SPACE_NEBULA_START_MS + SPACE_NEBULA_FADE_IN_MS;
    const fadeOutStart = SPACE_NEBULA_END_MS - SPACE_NEBULA_FADE_OUT_MS;

    if (cruiseElapsed < fadeInEnd) {
        return smoothstep(SPACE_NEBULA_START_MS, fadeInEnd, cruiseElapsed);
    }
    if (cruiseElapsed > fadeOutStart) {
        return 1 - smoothstep(fadeOutStart, SPACE_NEBULA_END_MS, cruiseElapsed);
    }
    return 1;
}

export function ensureNebulaWisps(viz, state, palette, count = 36) {
    if (state.nebulaWisps?.length) return state.nebulaWisps;
    state.nebulaWisps = Array.from({ length: count }, (_, i) => ({
        x: (Math.random() - 0.5) * 2.2,
        y: (Math.random() - 0.5) * 1.6,
        z: Math.random() * 1.4 + 0.12,
        ang: Math.random() * Math.PI * 2,
        size: 0.012 + Math.random() * 0.028,
        aspect: 1.8 + Math.random() * 2.8,
        colorIdx: i + 2,
        alpha: 0.12 + Math.random() * 0.18
    }));
    return state.nebulaWisps;
}

export function spawnNebulaWisp(viz) {
    return {
        x: (Math.random() - 0.5) * 2.2,
        y: (Math.random() - 0.5) * 1.6,
        z: 1.1 + Math.random() * 0.75,
        ang: Math.random() * Math.PI * 2,
        size: 0.012 + Math.random() * 0.028,
        aspect: 1.8 + Math.random() * 2.8,
        colorIdx: Math.floor(Math.random() * 6),
        alpha: 0.12 + Math.random() * 0.18
    };
}

export function ensureNebulaBlobs(viz, state, palette) {
    if (state.nebulaBlobs?.length) return state.nebulaBlobs;
    state.nebulaBlobs = Array.from({ length: 7 }, (_, i) => ({
        ox: (Math.random() - 0.5) * 1.6,
        oy: (Math.random() - 0.5) * 1.2,
        r: 0.55 + Math.random() * 0.55,
        a: 0.18 + Math.random() * 0.22,
        sp: 0.6 + Math.random() * 1.4,
        color: pickColor(palette, i + 1)
    }));
    return state.nebulaBlobs;
}

export function getSpaceTripHyperPhase(viz, now, state) {
    const elapsed = (now - (state.cycleAnchor || now)) % SPACE_HYPER_CYCLE_MS;
    const cruiseEnd = SPACE_CRUISE_MS;
    const engageEnd = cruiseEnd + SPACE_HYPER_ENGAGE_MS;
    const travelEnd = engageEnd + SPACE_HYPER_TRAVEL_MS;
    const disengageEnd = travelEnd + SPACE_HYPER_DISENGAGE_MS;

    if (elapsed < cruiseEnd) {
        return { mode: 'cruise', mix: 0, speedMul: 1 };
    }
    if (elapsed < engageEnd) {
        const t = (elapsed - cruiseEnd) / SPACE_HYPER_ENGAGE_MS;
        const ease = smoothstep(0, 1, t);
        return { mode: 'engage', mix: ease, speedMul: 1 + ease * 2.5 };
    }
    if (elapsed < travelEnd) {
        return { mode: 'hyper', mix: 1, speedMul: 4.5 };
    }
    if (elapsed < disengageEnd) {
        const t = (elapsed - travelEnd) / SPACE_HYPER_DISENGAGE_MS;
        const ease = 1 - smoothstep(0, 1, t);
        return { mode: 'disengage', mix: ease, speedMul: 1 + ease * 2.5 };
    }
    return { mode: 'cruise', mix: 0, speedMul: 1 };
}

export function updateSpaceTripRoll(viz, state, now, dt) {
    const dodging = (state.dodge?.strength || 0) > 0.08;
    if (!dodging && (!state.nextRollAt || now >= state.nextRollAt)) {
        state.rollTarget = (Math.random() - 0.5) * 0.14;
        state.nextRollAt = now + 4000 + Math.random() * 7000;
    }
    if (!dodging) {
        state.rollAngle += (state.rollTarget - state.rollAngle) * Math.min(1, dt * 1.8);
        state.rollAngle += Math.sin(now * 0.0007) * 0.002;
    }
}

export function updateSpaceTripDodge(viz, state, dt, fov) {
    let threat = null;
    for (const planet of state.planets) {
        const isClosePass = planet.type === 'earth' || planet.sizeClass === 'headOn';
        if (!isClosePass) continue;
        const centered = Math.abs(planet.x) < 0.28 && Math.abs(planet.y) < 0.22;
        if (planet.z < 0.42 && planet.z > 0.008 && centered) {
            if (!threat || planet.z < threat.z) threat = planet;
        }
    }

    if (!state.dodge) {
        state.dodge = { panX: 0, panY: 0, roll: 0, strength: 0 };
    }
    const dodge = state.dodge;

    if (threat && threat.z < 0.36) {
        const urgency = smoothstep(0.36, 0.07, threat.z);
        if (!threat.dodgeDir) threat.dodgeDir = Math.random() < 0.5 ? -1 : 1;
        const dir = threat.dodgeDir;
        dodge.targetPanX = dir * fov * (0.28 + urgency * 0.72);
        dodge.targetPanY = -fov * (0.04 + urgency * 0.14);
        dodge.targetRoll = dir * (0.18 + urgency * 0.42);
        dodge.strength = urgency;
    } else {
        dodge.targetPanX = 0;
        dodge.targetPanY = 0;
        dodge.targetRoll = 0;
        dodge.strength = 0;
    }

    const snapIn = threat ? Math.min(1, dt * 9) : Math.min(1, dt * 2.2);
    dodge.panX += ((dodge.targetPanX || 0) - dodge.panX) * snapIn;
    dodge.panY += ((dodge.targetPanY || 0) - dodge.panY) * snapIn;
    dodge.roll += ((dodge.targetRoll || 0) - dodge.roll) * snapIn;
}

export function ensureSpaceTripWarp(viz, state) {
    if (state.tunnelWarp?.rings?.length) return state.tunnelWarp;

    const ringCount = 20;
    const streakCount = 80;
    state.tunnelWarp = {
        rings: Array.from({ length: ringCount }, (_, i) => ({
            z: 0.04 + (i / ringCount) * 0.96,
            drift: Math.random() * Math.PI * 2,
            colorIdx: i % HYPER_WALL_COLORS.length
        })),
        streaks: Array.from({ length: streakCount }, (_, i) => ({
            ang: (i / streakCount) * Math.PI * 2 + Math.random() * 0.15,
            radial: 0.38 + Math.random() * 0.12,
            z: Math.random() * 1.1 + 0.1,
            len: 0.07 + Math.random() * 0.16,
            colorIdx: i % HYPER_WALL_COLORS.length
        }))
    };
    return state.tunnelWarp;
}

export function respawnTunnelRing(viz, warp, ring) {
    const maxZ = warp.rings.reduce((max, r) => Math.max(max, r.z), 0);
    ring.z = maxZ + 0.048 + Math.random() * 0.02;
    ring.drift = Math.random() * Math.PI * 2;
    ring.colorIdx = Math.floor(Math.random() * HYPER_WALL_COLORS.length);
}

export function respawnTunnelStreak(viz, streak) {
    streak.ang = Math.random() * Math.PI * 2;
    streak.radial = 0.38 + Math.random() * 0.12;
    streak.z = 0.85 + Math.random() * 0.35;
    streak.len = 0.07 + Math.random() * 0.16;
    streak.colorIdx = Math.floor(Math.random() * HYPER_WALL_COLORS.length);
}

export function spaceTripProject(viz, cx, cy, fov, viewPanX, viewPanY, x, y, z) {
    const invZ = 1 / Math.max(z, 0.02);
    return {
        sx: cx + viewPanX + x * fov * invZ,
        sy: cy + viewPanY + y * fov * invZ,
        invZ
    };
}

export function ensureSpaceTripState(viz, width, height) {
    const density = clamp(Number(viz.settings.density) || 1, 0.3, 2.2);
    const targetCount = Math.max(160, Math.round(280 * density));

    if (!viz.spaceTrip || viz.spaceTrip.width !== width || viz.spaceTrip.height !== height) {
        const stars = Array.from({ length: targetCount }, () => spawnSpaceStar(viz));
        const now = Date.now();
        viz.spaceTrip = {
            width,
            height,
            stars,
            planets: [],
            nextPlanetAt: now + 8000 + Math.random() * 10000,
            lastFrameTime: null,
            cycleAnchor: now,
            rollAngle: 0,
            rollTarget: 0,
            nextRollAt: now + 3000,
            tunnelWarp: null,
            nebulaBlobs: null,
            nebulaWisps: null,
            earthSpawnedCycle: -1,
            dodge: { panX: 0, panY: 0, roll: 0, strength: 0 }
        };
        return viz.spaceTrip;
    }

    while (viz.spaceTrip.stars.length < targetCount) {
        viz.spaceTrip.stars.push(spawnSpaceStar(viz));
    }
    while (viz.spaceTrip.stars.length > targetCount) {
        viz.spaceTrip.stars.pop();
    }
    return viz.spaceTrip;
}

export function updateSpaceTrip(viz, dt, motion, values) {
    const state = viz.spaceTrip;
    if (!state) return;

    const now = Date.now();
    const { pulse } = beatPulse(viz.settings.bpm, now);
    const a = ampScale(viz.settings);
    const avg = values?.length
        ? values.reduce((sum, value) => sum + (value || 0), 0) / values.length
        : 0.3;
    const hyper = getSpaceTripHyperPhase(viz, now, state);
    const warpBoost = 1 + avg * viz.settings.sensitivity * 0.8 * a + pulse * 0.15 + motion * 0.08;
    const speed = travelPace(viz) * viz.settings.speed * 0.45 * warpBoost * hyper.speedMul * dt;
    const fov = Math.min(state.width || 640, state.height || 480) * 0.55;

    updateSpaceTripDodge(viz, state, dt, fov);
    updateSpaceTripRoll(viz, state, now, dt);

    const warp = ensureSpaceTripWarp(viz, state);
    for (const ring of warp.rings) {
        ring.z -= speed;
        if (ring.z <= 0.02) respawnTunnelRing(viz, warp, ring);
    }
    for (const streak of warp.streaks) {
        streak.z -= speed;
        if (streak.z <= 0.02) respawnTunnelStreak(viz, streak);
    }

    const nebulaStrength = getSpaceTripNebulaStrength(viz, now, state);
    if (nebulaStrength > 0) {
        const palette = PALETTES[viz.settings.palette] || PALETTES.horizon;
        for (const wisp of ensureNebulaWisps(viz, state, palette)) {
            wisp.z -= speed;
            if (wisp.z <= 0.02) {
                const respawn = spawnNebulaWisp(viz);
                Object.assign(wisp, respawn);
            }
        }
    }

    for (const star of state.stars) {
        if (star.history) {
            star.history.unshift({ x: star.x, y: star.y, z: star.z });
            if (star.history.length > 6) star.history.pop();
        }
        star.z -= speed;
        if (star.z <= 0.02) {
            const respawn = spawnSpaceStar(viz);
            star.x = respawn.x;
            star.y = respawn.y;
            star.z = respawn.z;
            star.hue = respawn.hue;
            star.tw = respawn.tw;
            star.kind = respawn.kind;
            star.colorIdx = respawn.colorIdx;
            star.sizeMul = respawn.sizeMul;
            star.history = respawn.history;
        }
    }

    if (hyper.mix < 0.85) {
        const cycleIndex = getSpaceTripCycleIndex(viz, now, state);
        const cruiseElapsed = getSpaceTripCruiseElapsed(viz, now, state);

        if (isEarthCruise(viz, now, state) && cruiseElapsed >= 0) {
            if (state.earthSpawnedCycle !== cycleIndex && cruiseElapsed >= SPACE_EARTH_CRUISE_SPAWN_MS) {
                const hasEarth = state.planets.some((planet) => planet.type === 'earth');
                if (!hasEarth) {
                    state.planets.push(spawnSpaceEarthPlanet(viz));
                }
                state.earthSpawnedCycle = cycleIndex;
            }
        }

        for (let i = state.planets.length - 1; i >= 0; i -= 1) {
            const planet = state.planets[i];
            const planetSpeed = planet.type === 'earth' || planet.sizeClass === 'headOn'
                ? speed * 1.05
                : speed * 0.9;
            planet.z -= planetSpeed;
            if (planet.z < 0.006) state.planets.splice(i, 1);
        }

        if (now >= state.nextPlanetAt) {
            const palette = PALETTES[viz.settings.palette] || PALETTES.horizon;
            state.planets.push(spawnSpacePlanet(viz, palette, state, now));
            state.nextPlanetAt = now + (8000 + Math.random() * 10000) / travelPace(viz);
        }
    } else if (state.planets.length) {
        state.planets.length = 0;
    }

    state.lastHyper = hyper;
    state.lastFrameTime = now;
}
