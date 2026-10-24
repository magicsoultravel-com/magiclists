/** @module {"owns":"radio visualizer backdrop fill + starfield sky gradient", "related":["radioVisualizer.js","radioVisualizer/painters.js","radioVisualizer/settings.js"]} */

import { alpha } from './settings.js';

/**
 * The slice of the RadioVisualizer facade these helpers read and write. Passed
 * explicitly (rather than importing the facade) to avoid the
 * radioVisualizer.js ↔ radioPlayer.js import cycle.
 *
 * @typedef {object} VisualizerHost
 * @property {object} settings
 * @property {{width: number, height: number, points: object[]}|null} stars
 */

const STAR_MIN_COUNT = 28;
const STAR_MAX_Y = 0.62; // stars only fill the upper sky band

/** Cached starfield for the current canvas box. */
export function ensureStars(viz, width, height) {
    if (viz.stars && viz.stars.width === width && viz.stars.height === height) {
        return viz.stars.points;
    }
    const count = Math.max(STAR_MIN_COUNT, Math.round(width / 14));
    const points = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height * STAR_MAX_Y,
        r: 0.4 + Math.random() * 1.4,
        tw: Math.random() * Math.PI * 2,
        sp: 0.4 + Math.random() * 1.2
    }));
    viz.stars = { width, height, points };
    return points;
}

/** Flat backdrop used by the non-scenic modes. */
export function fillBackdrop(viz, ctx, width, height) {
    ctx.fillStyle = viz.settings.background === 'glass'
        ? 'rgba(15, 23, 42, 0.52)'
        : viz.settings.background === 'midnight'
            ? '#040914'
            : '#070b12';
    ctx.fillRect(0, 0, width, height);
}

/** Night sky: vertical gradient, twinkling stars, horizon glow. */
export function drawSkyGradient(viz, ctx, width, height, palette, motion = 0.4) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#040714');
    sky.addColorStop(0.35, alpha(palette[3] || palette[0], 0.22 + motion * 0.1));
    sky.addColorStop(0.62, alpha(palette[1], 0.18));
    sky.addColorStop(1, '#05080f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    const now = Date.now();
    const stars = ensureStars(viz, width, height);
    for (const s of stars) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.002 * s.sp + s.tw));
        ctx.fillStyle = `rgba(226, 232, 240, ${tw * 0.85})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
    }

    const glow = ctx.createRadialGradient(
        width * 0.5,
        height * 0.72,
        8,
        width * 0.5,
        height * 0.72,
        width * 0.55
    );
    glow.addColorStop(0, alpha(palette[0], 0.28 + motion * 0.2));
    glow.addColorStop(0.45, alpha(palette[2], 0.12));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
}
