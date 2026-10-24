/** @module {"owns":"radio visualizer sky gradient frames + day/night cycle state", "related":["radioVisualizer.js","radioVisualizer/settings.js"]} */

import { rgbaTuple, smoothstep, lerpTuple, clamp } from './settings.js';

const DAY_CYCLE_MS = 65_000; // independent of travel pace
const UNDER_HORIZON_MS = 5_000;

export function skyPaletteFrames(palette) {
    const p0 = palette[0];
    const p1 = palette[1];
    const p2 = palette[2];
    const p3 = palette[3] || palette[0];
    const p4 = palette[4] || palette[2];
    // Top-of-sky (stop 0) shifts hard per period so the whole vault changes, not just the horizon
    const night = [
        rgbaTuple('#010208', 1),
        rgbaTuple('#07101f', 1),
        rgbaTuple(p3, 0.28),
        rgbaTuple(p0, 0.1),
        rgbaTuple('#000000', 1)
    ];
    return {
        night,
        dawn: [
            rgbaTuple('#3a1048', 1),
            rgbaTuple(p1, 0.88),
            rgbaTuple(p4, 0.82),
            rgbaTuple(p0, 0.65),
            rgbaTuple('#12081c', 1)
        ],
        day: [
            rgbaTuple('#2a1870', 1),
            rgbaTuple(p3, 0.9),
            rgbaTuple(p0, 0.8),
            rgbaTuple(p1, 0.55),
            rgbaTuple('#0a1028', 1)
        ],
        sunset: [
            rgbaTuple('#6b0a3a', 1),
            rgbaTuple('#ff3d6e', 0.98),
            rgbaTuple('#ff9f1c', 0.95),
            rgbaTuple(p4, 0.88),
            rgbaTuple('#1a060e', 1)
        ],
        dusk: [
            rgbaTuple('#22065a', 1),
            rgbaTuple('#9b2cff', 0.92),
            rgbaTuple(p1, 0.78),
            rgbaTuple(p3, 0.45),
            rgbaTuple('#06020f', 1)
        ]
    };
}

export function blendedSkyStops(palette, cycleT) {
    const frames = skyPaletteFrames(palette);
    const keys = [
        { t: 0, name: 'night' },
        { t: 0.08, name: 'dawn' },
        { t: 0.22, name: 'day' },
        { t: 0.42, name: 'day' },
        { t: 0.52, name: 'sunset' },
        { t: 0.62, name: 'dusk' },
        { t: 0.78, name: 'night' },
        { t: 1, name: 'night' }
    ];
    let i = 0;
    while (i < keys.length - 1 && cycleT > keys[i + 1].t) i += 1;
    const a = keys[i];
    const b = keys[i + 1];
    const u = smoothstep(a.t, b.t, cycleT);
    const from = frames[a.name];
    const to = frames[b.name];
    return from.map((stop, idx) => lerpTuple(stop, to[idx], u));
}

export function dayCycleState(now, cycleStart) {
    const elapsed = ((now - cycleStart) % DAY_CYCLE_MS + DAY_CYCLE_MS) % DAY_CYCLE_MS;
    const t = elapsed / DAY_CYCLE_MS; // 0..1
    const underFrac = UNDER_HORIZON_MS / DAY_CYCLE_MS;
    // Sun travels right→left, then sits under the left horizon before the night sky takes over
    const sunTravelEnd = 0.52;
    const sunUnderEnd = sunTravelEnd + underFrac;
    let sunArc = 0;
    let sunness = 0;
    if (t < sunTravelEnd) {
        sunArc = t / sunTravelEnd;
        // Soft near-horizon so sky/sun don't snap off
        sunness = clamp(Math.pow(Math.sin(sunArc * Math.PI), 0.85), 0, 1);
    } else if (t < sunUnderEnd) {
        sunArc = 1;
        sunness = 0;
    }

    // Moon rises after sun is under, sets on the left, then also waits under horizon
    const moonTravelStart = sunUnderEnd;
    const moonTravelEnd = 1 - underFrac;
    let moonArc = 0;
    let moonness = 0;
    if (t >= moonTravelStart && t < moonTravelEnd) {
        moonArc = (t - moonTravelStart) / Math.max(0.001, moonTravelEnd - moonTravelStart);
        moonness = clamp(Math.pow(Math.sin(moonArc * Math.PI), 0.85), 0, 1);
    } else if (t >= moonTravelEnd) {
        moonArc = 1;
        moonness = 0;
    }

    // Dramatic wash strength for late day → night (peaks at sunset, eases through dusk)
    const sunsetness = clamp(1 - Math.abs(t - sunTravelEnd) / 0.1, 0, 1);
    const duskness = clamp(1 - Math.abs(t - (sunTravelEnd + 0.1)) / 0.12, 0, 1);

    const dayness = clamp(sunness, 0, 1);
    let period = 'night';
    if (t < 0.22) period = 'dawn';
    else if (t < sunTravelEnd - 0.06) period = 'day';
    else if (t < sunTravelEnd + 0.06) period = 'sunset';
    else if (t < moonTravelStart + 0.1) period = 'dusk';
    return {
        t, period, dayness, sunness, moonness, sunArc, moonArc, elapsed,
        sunsetness, duskness
    };
}

export { DAY_CYCLE_MS, UNDER_HORIZON_MS };
