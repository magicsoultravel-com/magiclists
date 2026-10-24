/** @module {"owns":"radio visualizer mountain/sea scenery: world seeding, sky, birds, terrain and decor drawing", "related":["radioVisualizer.js","radioVisualizer/backdrop.js","radioVisualizer/controls.js","radioVisualizer/sky.js"]} */

import {
    alpha,
    pickColor,
    beatPulse,
    ampScale,
    smoothstep,
    shuffleNoRepeat,
    clamp,
    rgbaTuple,
    lerpTuple,
    cssRgba
} from './settings.js';
import { blendedSkyStops, dayCycleState } from './sky.js';
import { TRAVEL_SPEED, travelPace, sceneHoldMs, sceneTransitionMs } from './controls.js';
import { ensureStars } from './backdrop.js';

const MOUNTAIN_SCENES = ['cactus', 'forest'];
const FOREST_LEAF = ['#1f4d2e', '#2d6a3e', '#245536', '#3d7a4a', '#4a6b3a'];
const FOREST_TRUNK = '#3b2a1a';
const CACTUS_GREEN = '#4d6b3c';

export function pickNextMountainScene(viz) {
    if (viz.mountainScene === 'sea') {
        viz.mountainSceneQueue = shuffleNoRepeat(MOUNTAIN_SCENES, null);
        return viz.mountainSceneQueue.shift();
    }
    if (!viz.mountainSceneQueue.length) {
        return 'sea';
    }
    return viz.mountainSceneQueue.shift();
}

export function ensureMountainWorld(viz, now = Date.now()) {
    if (viz.mountainCycleStart == null) {
        viz.mountainCycleStart = now;
    }

    // Drop scenes removed from the rotation (e.g. old palm/flatland session state)
    if (
        viz.mountainScene
        && viz.mountainScene !== 'sea'
        && !MOUNTAIN_SCENES.includes(viz.mountainScene)
    ) {
        viz.mountainScene = null;
        viz.sceneTransition = null;
        viz.mountainSceneQueue = [];
    }

    if (!viz.mountainScene) {
        viz.mountainSceneQueue = shuffleNoRepeat(MOUNTAIN_SCENES, null);
        viz.mountainScene = viz.mountainSceneQueue.shift();
        viz.mountainSceneStartedAt = now;
        viz.sceneTransition = null;
    } else if (!viz.sceneTransition) {
        const hold = sceneHoldMs(viz, viz.mountainScene);
        if (now - viz.mountainSceneStartedAt >= hold) {
            const next = pickNextMountainScene(viz);
            viz.sceneTransition = {
                from: viz.mountainScene,
                to: next,
                start: now,
                duration: sceneTransitionMs(viz)
            };
        }
    }

    if (viz.sceneTransition) {
        const u = (now - viz.sceneTransition.start) / viz.sceneTransition.duration;
        if (u >= 1) {
            viz.mountainScene = viz.sceneTransition.to;
            viz.mountainSceneStartedAt = now;
            viz.sceneTransition = null;
        }
    }

    return dayCycleState(now, viz.mountainCycleStart);
}

export function wrapScreenX(viz, worldX, width, parallax = 1) {
    const span = width * 2.2;
    const shifted = worldX - viz.travelScroll * parallax;
    return ((shifted % span) + span) % span - width * 0.15;
}

export function spawnBirds(viz, width, height, now) {
    if (now < viz.nextBirdAt) return;
    const roll = Math.random();
    const count = roll < 0.55 ? 1 : roll < 0.85 ? 2 : 3 + Math.floor(Math.random() * 3);
    const dir = Math.random() < 0.65 ? -1 : 1;
    const baseY = height * (0.08 + Math.random() * 0.34);
    const speed = (0.028 + Math.random() * 0.07) * width;
    const style = Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i += 1) {
        viz.birds.push({
            x: dir > 0 ? -30 - i * (14 + Math.random() * 10) : width + 30 + i * (14 + Math.random() * 10),
            y: baseY + (Math.random() - 0.5) * 22,
            vx: dir * speed * (0.75 + Math.random() * 0.5),
            flap: Math.random() * Math.PI * 2,
            flapRate: 7 + Math.random() * 8,
            size: 2.2 + Math.random() * 3.8,
            style,
            bob: Math.random() * Math.PI * 2
        });
    }
    viz.nextBirdAt = now + 9000 + Math.random() * 14000;
}

export function updateAndDrawBirds(viz, ctx, width, height, now, dt, palette, dayness) {
    spawnBirds(viz, width, height, now);
    const inkMix = smoothstep(0.35, 0.7, dayness);
    const ink = cssRgba(lerpTuple(
        rgbaTuple(palette[0], 0.85),
        rgbaTuple(palette[3] || '#111827', 0.8),
        inkMix
    ));
    viz.birds = viz.birds.filter((b) => b.x > -50 && b.x < width + 50);
    for (const b of viz.birds) {
        b.x += b.vx * dt;
        b.flap += dt * b.flapRate;
        b.bob += dt * 2.2;
        const y = b.y + Math.sin(b.bob) * 2.5;
        const wing = Math.sin(b.flap) * b.size * (0.7 + b.style * 0.15);
        ctx.strokeStyle = ink;
        ctx.fillStyle = ink;
        ctx.lineWidth = 1.1 + b.size * 0.08;
        ctx.beginPath();
        if (b.style === 1) {
            ctx.moveTo(b.x - b.size * 1.5, y + wing * 0.15);
            ctx.quadraticCurveTo(b.x - b.size * 0.2, y - wing * 1.15, b.x, y);
            ctx.quadraticCurveTo(b.x + b.size * 0.2, y - wing * 1.15, b.x + b.size * 1.5, y + wing * 0.15);
            ctx.stroke();
        } else if (b.style === 2) {
            ctx.moveTo(b.x - b.size, y);
            ctx.lineTo(b.x, y - wing * 0.6);
            ctx.lineTo(b.x + b.size * 1.2, y);
            ctx.lineTo(b.x, y + wing * 0.25);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.moveTo(b.x - b.size, y + wing * 0.25);
            ctx.quadraticCurveTo(b.x, y - wing, b.x + b.size, y + wing * 0.25);
            ctx.stroke();
        }
    }
}

export function drawSunMoon(viz, ctx, width, height, palette, cycle, motion) {
    const { sunness, moonness, sunArc, moonArc, dayness } = cycle;

    if (sunness > 0.02) {
        // Right → left across the sky
        const sx = width * (0.88 - sunArc * 0.76);
        const sy = height * (0.55 - Math.sin(sunArc * Math.PI) * 0.42);
        const r = Math.min(width, height) * (0.055 + sunness * 0.035 + motion * 0.012);

        for (let i = 3; i >= 1; i -= 1) {
            const bloom = ctx.createRadialGradient(sx, sy, r * 0.15, sx, sy, r * (1.6 + i * 1.1));
            bloom.addColorStop(0, alpha(palette[i % palette.length], 0.28 * sunness / i));
            bloom.addColorStop(0.45, alpha(palette[(i + 2) % palette.length], 0.12 * sunness / i));
            bloom.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = bloom;
            ctx.beginPath();
            ctx.arc(sx, sy, r * (1.6 + i * 1.1), 0, Math.PI * 2);
            ctx.fill();
        }

        const core = ctx.createRadialGradient(sx, sy, r * 0.1, sx, sy, r);
        core.addColorStop(0, alpha('#fff7ad', 0.98 * sunness));
        core.addColorStop(0.45, alpha(palette[0], 0.9 * sunness));
        core.addColorStop(1, alpha(palette[1], 0.55 * sunness));
        ctx.fillStyle = core;
        ctx.shadowBlur = 28 + viz.settings.glow * 28;
        ctx.shadowColor = alpha(palette[1], 0.85 * sunness);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        const rayFade = smoothstep(0.28, 0.5, sunness) * (1 - smoothstep(0.72, 0.95, dayness));
        if (rayFade > 0.02) {
            ctx.save();
            ctx.globalAlpha = (0.08 + (1 - Math.abs(dayness - 0.55)) * 0.22) * rayFade;
            for (let i = 0; i < 9; i += 1) {
                const ang = -Math.PI / 2 + (i - 4) * 0.12;
                const grad = ctx.createLinearGradient(
                    sx, sy,
                    sx + Math.cos(ang) * width * 0.6,
                    sy + Math.sin(ang) * height * 0.75
                );
                grad.addColorStop(0, alpha(palette[i % palette.length], 0.7));
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                ctx.strokeStyle = grad;
                ctx.lineWidth = 2.2;
                ctx.beginPath();
                ctx.moveTo(sx, sy);
                ctx.lineTo(sx + Math.cos(ang) * width * 0.6, sy + Math.sin(ang) * height * 0.75);
                ctx.stroke();
            }
            ctx.restore();
        }
    }

    if (moonness > 0.02) {
        const mx = width * (0.9 - moonArc * 0.72);
        const my = height * (0.5 - Math.sin(moonArc * Math.PI) * 0.38);
        const r = Math.min(width, height) * (0.045 + moonness * 0.03);
        const halo = ctx.createRadialGradient(mx, my, r * 0.2, mx, my, r * 3.2);
        halo.addColorStop(0, alpha(palette[0], 0.45 * moonness));
        halo.addColorStop(0.4, alpha(palette[3], 0.22 * moonness));
        halo.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(mx, my, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = alpha(palette[0], 0.55 * moonness);
        ctx.shadowBlur = 16 + viz.settings.glow * 14;
        ctx.shadowColor = alpha(palette[0], 0.7 * moonness);
        ctx.beginPath();
        ctx.arc(mx, my, r, 0, Math.PI * 2);
        ctx.arc(mx + r * 0.35, my - r * 0.1, r * 0.85, 0, Math.PI * 2, true);
        ctx.fill('evenodd');
        ctx.shadowBlur = 0;
    }
}

export function drawMountainSky(viz, ctx, width, height, palette, motion, cycle) {
    const { dayness, t: cycleT, sunsetness = 0, duskness = 0 } = cycle;
    const stops = blendedSkyStops(palette, cycleT);
    // Push color changes higher into the vault (was bunched near horizon)
    const stopPos = [0, 0.18, 0.4, 0.68, 1];
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    stops.forEach((tuple, idx) => {
        sky.addColorStop(stopPos[idx], cssRgba(tuple));
    });
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    // Full-sky sunset / dusk washes so the upper half actually shifts
    if (sunsetness > 0.02) {
        const wash = ctx.createLinearGradient(0, 0, 0, height);
        wash.addColorStop(0, alpha('#ff2bd6', 0.22 * sunsetness));
        wash.addColorStop(0.35, alpha('#ff6b35', 0.4 * sunsetness));
        wash.addColorStop(0.7, alpha('#ff9f1c', 0.28 * sunsetness));
        wash.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, width, height);
    }
    if (duskness > 0.02) {
        const wash = ctx.createLinearGradient(0, 0, 0, height);
        wash.addColorStop(0, alpha('#5b21b6', 0.28 * duskness));
        wash.addColorStop(0.4, alpha(palette[1], 0.22 * duskness));
        wash.addColorStop(1, alpha('#02010a', 0.35 * duskness));
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, width, height);
    }

    for (let i = 0; i < 3; i += 1) {
        const y = height * (0.14 + i * 0.18);
        const haze = ctx.createLinearGradient(0, y - 22, 0, y + 22);
        haze.addColorStop(0, 'rgba(0,0,0,0)');
        haze.addColorStop(0.5, alpha(
            palette[i % palette.length],
            0.07 + motion * 0.04 + dayness * 0.04 + sunsetness * 0.1
        ));
        haze.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = haze;
        ctx.fillRect(0, y - 22, width, 44);
    }

    const starFade = clamp(1 - smoothstep(0.05, 0.55, dayness), 0, 1);
    if (starFade > 0.02) {
        const now = Date.now();
        const stars = ensureStars(viz, width, height);
        for (const s of stars) {
            const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.0012 * s.sp + s.tw));
            const sx = wrapScreenX(viz, s.x + width * 0.2, width, 0.15);
            ctx.fillStyle = alpha(palette[Math.floor(s.tw) % palette.length], tw * 0.9 * starFade);
            ctx.beginPath();
            ctx.arc(sx, s.y, s.r * (0.8 + tw * 0.35), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    drawSunMoon(viz, ctx, width, height, palette, cycle, motion);

    const glow = ctx.createRadialGradient(
        width * 0.5,
        height * 0.82,
        4,
        width * 0.5,
        height * 0.82,
        width * 0.75
    );
    const horizonDay = cssRgba(lerpTuple(
        rgbaTuple(palette[0], 0.22 + motion * 0.12),
        rgbaTuple(palette[1], 0.26 + motion * 0.14),
        smoothstep(0.05, 0.7, dayness)
    ));
    const horizonHot = cssRgba(lerpTuple(
        rgbaTuple('#ff9f1c', 0.45 * sunsetness),
        rgbaTuple('#ff2bd6', 0.35 * sunsetness + 0.2 * duskness),
        0.45
    ));
    glow.addColorStop(0, sunsetness > 0.05 || duskness > 0.05 ? horizonHot : horizonDay);
    glow.addColorStop(0.4, alpha(palette[2], 0.1 + dayness * 0.06 + sunsetness * 0.18));
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height);
}

export function ridgeYAt(viz, x, width, height, layer, values, phase, t, a, pulse, scroll = 0) {
    const pts = 48;
    const world = (x + scroll * (0.35 + layer.li * 0.25)) / width * pts;
    const i0 = Math.floor(world);
    const frac = world - i0;
    const softPulse = pulse * pulse; // damp BPM snap on ridges
    const sample = (idx) => {
        const v = values[Math.abs(idx) % values.length] || 0;
        const ridge = Math.sin(idx * 0.55 + phase * Math.PI * 2 + layer.li)
            + 0.45 * Math.sin(idx * 1.3 - t * layer.speed * 1000);
        const peak = (0.35 + v * viz.settings.sensitivity * 0.55 + softPulse * 0.06)
            * layer.scale * height
            + ridge * 6 * a;
        return height * layer.y - peak;
    };
    return sample(i0) * (1 - frac) + sample(i0 + 1) * frac;
}

export function drawCactus(viz, ctx, x, groundY, scale, color, variant = 0) {
    ctx.save();
    ctx.translate(x, groundY);
    ctx.scale(scale, scale);
    ctx.fillStyle = color;
    const v = ((variant % 5) + 5) % 5;
    if (v === 0) {
        // Tall column, no arms
        ctx.fillRect(-2.2, -26, 4.4, 26);
    } else if (v === 1) {
        // Left arm only
        ctx.fillRect(-2.5, -22, 5, 22);
        ctx.fillRect(-11, -15, 9, 3);
        ctx.fillRect(-11, -15, 3, 9);
    } else if (v === 2) {
        // Right arm only
        ctx.fillRect(-2.5, -22, 5, 22);
        ctx.fillRect(2.5, -13, 9, 3);
        ctx.fillRect(8.5, -13, 3, 8);
    } else if (v === 3) {
        // Short stubby
        ctx.fillRect(-3, -14, 6, 14);
        ctx.fillRect(-8, -9, 5, 2.5);
        ctx.fillRect(-8, -9, 2.5, 5);
    } else {
        // Classic two-arm (occasional)
        ctx.fillRect(-2.5, -22, 5, 22);
        ctx.fillRect(-10, -16, 8, 3);
        ctx.fillRect(-10, -16, 3, 8);
        ctx.fillRect(2.5, -12, 8, 3);
        ctx.fillRect(7.5, -12, 3, 7);
    }
    ctx.restore();
}

export function drawTree(viz, ctx, x, groundY, scale, trunk, leaf) {
    ctx.save();
    ctx.translate(x, groundY);
    ctx.scale(scale, scale);
    ctx.fillStyle = trunk;
    ctx.fillRect(-1.5, -14, 3, 14);
    ctx.fillStyle = leaf;
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.lineTo(9, -12);
    ctx.lineTo(-9, -12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -34);
    ctx.lineTo(7, -18);
    ctx.lineTo(-7, -18);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

export function drawScrollingDecor(viz, ctx, width, height, scene, frontLayer, values, phase, t, a, pulse, palette, dayness) {
    const cactusBase = 0.86 + dayness * 0.08;
    const trunk = alpha(FOREST_TRUNK, 0.95);
    const scroll = viz.travelScroll;
    const span = width * 2.2;

    if (scene === 'cactus') {
        const step = width * 0.34;
        for (let world = -width; world < span + width; world += step) {
            // Irregular gaps — most slots empty so they don't march in pairs
            const dens = Math.sin(world * 0.037 + 0.6) * Math.sin(world * 0.013 + 2.4);
            if (dens < 0.28) continue;
            const jitter = Math.sin(world * 0.09) * step * 0.35;
            const x = wrapScreenX(viz, world + jitter, width, 1);
            if (x < -30 || x > width + 30) continue;
            const y = ridgeYAt(viz, x, width, height, frontLayer, values, phase, t, a, pulse, scroll);
            const variant = Math.floor((Math.abs(Math.sin(world * 0.071 + 1.3)) * 5));
            const scale = 0.4 + Math.abs(Math.sin(world * 0.029)) * 0.55
                + (variant === 3 ? -0.08 : 0)
                + (variant === 0 ? 0.12 : 0);
            const tint = 0.92 + Math.sin(world * 0.05) * 0.06;
            const cactusColor = alpha(CACTUS_GREEN, cactusBase * tint);
            drawCactus(viz, ctx, x, y + 1, scale, cactusColor, variant);
        }
    } else if (scene === 'forest') {
        const step = width * 0.045;
        for (let world = -width; world < span + width; world += step) {
            const x = wrapScreenX(viz, world, width, 1);
            if (x < -40 || x > width + 40) continue;
            const dens = Math.sin(world * 0.11) + Math.sin(world * 0.07 + 1.7);
            if (dens < -0.35) continue;
            const cluster = 2 + Math.floor((Math.sin(world * 0.19) + 1) * 2);
            for (let c = 0; c < cluster; c += 1) {
                const ox = x + (c - cluster / 2) * 7 + Math.sin(world + c) * 3;
                const y = ridgeYAt(viz, ox, width, height, frontLayer, values, phase, t, a, pulse, scroll);
                const leaf = alpha(FOREST_LEAF[(c + Math.floor(Math.abs(world) / 40)) % FOREST_LEAF.length], 0.92);
                drawTree(viz, ctx, ox, y + 1, 0.5 + (c % 4) * 0.18 + Math.abs(Math.sin(world)) * 0.15, trunk, leaf);
            }
        }
    }
}

export function drawSailboat(viz, ctx, x, waterY, scale, hullColor, sailColor, t = 0) {
    const wind = Math.sin(t * 1.05) * 0.55 + Math.sin(t * 0.33 + 1.2) * 0.35;
    const heel = wind * 0.05;
    ctx.save();
    ctx.translate(x, waterY);
    ctx.rotate(heel);
    ctx.scale(scale, scale);
    ctx.shadowBlur = 8;
    ctx.shadowColor = sailColor;

    // Long shallow hull
    ctx.fillStyle = hullColor;
    ctx.beginPath();
    ctx.moveTo(-20, -2);
    ctx.lineTo(15, -2);
    ctx.lineTo(19, 0);
    ctx.lineTo(14, 4.5);
    ctx.lineTo(-14, 4.5);
    ctx.lineTo(-20, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = alpha('#1e293b', 0.55);
    ctx.fillRect(-8, -5, 11, 3);

    // Mast
    ctx.strokeStyle = alpha('#e2e8f0', 0.9);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-1, -2);
    ctx.lineTo(-1 + wind * 1.2, -32);
    ctx.stroke();

    // Single mainsail — belly fills with the wind
    const mastTipX = -1 + wind * 1.2;
    const belly = 5 + wind * 7;
    ctx.fillStyle = sailColor;
    ctx.beginPath();
    ctx.moveTo(mastTipX, -30);
    ctx.quadraticCurveTo(mastTipX + belly, -17, -1, -3);
    ctx.quadraticCurveTo(8 + wind * 5, -10, 15 + wind * 6, -14);
    ctx.quadraticCurveTo(mastTipX + belly * 0.55, -22, mastTipX, -30);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.strokeStyle = alpha(sailColor, 0.4);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-20, 2);
    ctx.quadraticCurveTo(-28, 4, -34, 1);
    ctx.stroke();
    ctx.restore();
}

export function drawShip(viz, ctx, x, waterY, scale, hullColor, accent) {
    ctx.save();
    ctx.translate(x, waterY);
    ctx.scale(scale, scale);
    ctx.fillStyle = hullColor;
    ctx.beginPath();
    ctx.moveTo(-28, 0);
    ctx.lineTo(-22, 8);
    ctx.lineTo(24, 8);
    ctx.lineTo(30, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = alpha('#1e293b', 0.95);
    ctx.fillRect(-12, -10, 26, 10);
    ctx.fillStyle = accent;
    ctx.shadowBlur = 8;
    ctx.shadowColor = accent;
    ctx.fillRect(-8, -14, 4, 4);
    ctx.fillRect(2, -14, 4, 4);
    ctx.fillRect(12, -14, 4, 4);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = alpha(accent, 0.4);
    ctx.beginPath();
    ctx.moveTo(-28, 4);
    ctx.quadraticCurveTo(-40, 7, -48, 3);
    ctx.stroke();
    ctx.restore();
}

export function drawSurfer(viz, ctx, x, waterY, scale, boardColor, suitColor) {
    ctx.save();
    ctx.translate(x, waterY);
    ctx.scale(scale, scale);
    ctx.fillStyle = boardColor;
    ctx.beginPath();
    ctx.ellipse(0, 2, 12, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = suitColor;
    ctx.beginPath();
    ctx.arc(0, -6, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-1.2, -4, 2.4, 6);
    ctx.strokeStyle = suitColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-1, -1);
    ctx.lineTo(-5, -5);
    ctx.moveTo(1, -1);
    ctx.lineTo(5, -4);
    ctx.stroke();
    ctx.restore();
}

export function drawSea(viz, ctx, width, height, values, palette, motion, cycle) {
    const a = ampScale(viz.settings);
    const { pulse } = beatPulse(viz.settings.bpm);
    const t = Date.now() * 0.001;
    const scroll = viz.travelScroll;

    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let i = 0; i <= 40; i += 1) {
        const x = (i / 40) * width;
        const n = Math.sin((i + scroll * 0.02) * 0.4) * 8 * a;
        ctx.lineTo(x, height * 0.52 + n);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    const land = ctx.createLinearGradient(0, height * 0.4, 0, height * 0.7);
    land.addColorStop(0, alpha(palette[3], 0.45));
    land.addColorStop(1, alpha(palette[1], 0.25));
    ctx.fillStyle = land;
    ctx.fill();

    const waterTop = height * 0.54;
    const water = ctx.createLinearGradient(0, waterTop, 0, height);
    water.addColorStop(0, alpha(palette[0], 0.55 + cycle.dayness * 0.2));
    water.addColorStop(0.4, alpha(palette[3], 0.45));
    water.addColorStop(1, '#020617');
    ctx.fillStyle = water;
    ctx.fillRect(0, waterTop, width, height - waterTop);

    for (let band = 0; band < 5; band += 1) {
        ctx.beginPath();
        const base = waterTop + 10 + band * (height * 0.07);
        for (let x = 0; x <= width; x += 4) {
            const v = values[Math.floor((x / width) * values.length) % values.length] || 0;
            const y = base
                + Math.sin(x * 0.02 + scroll * 0.08 + band + t * (1.2 + band * 0.15)) * (4 + band)
                + Math.sin(x * 0.05 - scroll * 0.12 + t) * 3
                + v * 10 * a * viz.settings.sensitivity
                + pulse * 3;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = alpha(pickColor(palette, band), 0.35 + motion * 0.2 + pulse * 0.15);
        ctx.lineWidth = 1.6 + band * 0.25;
        ctx.shadowBlur = 10 + viz.settings.glow * 10;
        ctx.shadowColor = alpha(pickColor(palette, band), 0.65);
        ctx.stroke();
    }
    ctx.shadowBlur = 0;

    ctx.strokeStyle = alpha(palette[0], 0.55 + pulse * 0.25);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, waterTop);
    ctx.lineTo(width, waterTop);
    ctx.stroke();

    // Sparse sea encounters: sailboat / ship / surfer
    const span = width * 2.4;
    const step = width * 1.45;
    for (let world = 0; world < span + width; world += step) {
        const seed = Math.sin(world * 0.017 + 1.3) * 0.5 + 0.5;
        if (seed < 0.78) continue;
        const x = wrapScreenX(viz, world + Math.sin(world * 0.02) * 30, width, 0.42);
        if (x < -50 || x > width + 50) continue;
        const bob = Math.sin(t * 0.85 + world * 0.01) * 5.5
            + Math.sin(t * 0.37 + world * 0.02) * 2.5;
        const waterY = waterTop + 10 + bob;
        const roll = Math.sin(world * 0.031 + 4.2) * 0.5 + 0.5;

        if (roll < 0.48) {
            const sail = alpha(pickColor(palette, Math.floor(world / step) % palette.length), 0.8);
            drawSailboat(viz, ctx, x, waterY, 0.7 + seed * 0.35, alpha('#0f172a', 0.92), sail, t);
        } else if (roll < 0.76) {
            drawShip(viz, ctx, x, waterY + 1, 0.7 + seed * 0.35, alpha('#0b1220', 0.95), alpha(palette[0], 0.75));
        } else {
            drawSurfer(viz,
                ctx, x, waterY + 2, 0.85 + seed * 0.25,
                alpha(palette[2], 0.85),
                alpha('#1e293b', 0.9)
            );
        }
    }

    for (let i = 0; i < 18; i += 1) {
        const fx = wrapScreenX(viz, i * width * 0.14 + Math.sin(i) * 20, width, 1.1);
        const fy = waterTop + 16 + (i % 5) * 12 + Math.sin(t * 2 + i + scroll * 0.05) * 4;
        ctx.fillStyle = alpha(palette[i % palette.length], 0.35);
        ctx.beginPath();
        ctx.arc(fx, fy, 1.2 + (i % 3) * 0.6, 0, Math.PI * 2);
        ctx.fill();
    }
}

export function drawTerrainContent(viz, ctx, width, height, values, palette, motion, cycle, scene, a, now) {
    if (scene === 'sea') {
        drawSea(viz, ctx, width, height, values, palette, motion, cycle);
        return;
    }

    const layers = [
        { y: 0.58, scale: 0.22 * a, alpha: 0.28, color: 4, speed: 0.00012, li: 0 },
        { y: 0.64, scale: 0.32 * a, alpha: 0.4, color: 1, speed: 0.00022, li: 1 },
        { y: 0.72, scale: 0.48 * a, alpha: 0.72, color: 0, speed: 0.00038, li: 2 }
    ];
    const { pulse, phase } = beatPulse(viz.settings.bpm);
    const t = now;
    const scroll = viz.travelScroll;

    layers.forEach((layer) => {
        const pts = Math.max(22, Math.round(values.length * (0.8 + layer.li * 0.15)));
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let i = 0; i <= pts; i += 1) {
            const x = (i / pts) * width;
            const y = ridgeYAt(viz, x, width, height, layer, values, phase, t, a, pulse, scroll);
            ctx.lineTo(x, y);
        }
        ctx.lineTo(width, height);
        ctx.closePath();

        const fill = ctx.createLinearGradient(0, height * (layer.y - 0.35), 0, height);
        const nightMul = 0.72 + smoothstep(0.05, 0.7, cycle.dayness) * 0.28;
        fill.addColorStop(0, alpha(pickColor(palette, layer.color), layer.alpha * nightMul));
        fill.addColorStop(0.55, alpha(pickColor(palette, layer.color + 1), layer.alpha * 0.55 * nightMul));
        fill.addColorStop(1, 'rgba(2, 6, 16, 0.92)');
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.strokeStyle = alpha(pickColor(palette, layer.color), 0.6 + pulse * 0.3);
        ctx.lineWidth = 1.3 + layer.li * 0.25;
        ctx.shadowBlur = 14 + viz.settings.glow * 16;
        ctx.shadowColor = alpha(pickColor(palette, layer.color), 0.75);
        ctx.beginPath();
        for (let i = 0; i <= pts; i += 1) {
            const x = (i / pts) * width;
            const y = ridgeYAt(viz, x, width, height, layer, values, phase, t, a, pulse, scroll);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        if (layer.li === 2) {
            drawScrollingDecor(viz,
                ctx, width, height, scene, layer,
                values, phase, t, a, pulse, palette, cycle.dayness
            );
        }
    });

    const ground = ctx.createLinearGradient(0, height * 0.82, 0, height);
    ground.addColorStop(0, alpha(palette[0], 0.14 + motion * 0.1));
    ground.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ground;
    ctx.fillRect(0, height * 0.82, width, height * 0.18);
}

export function drawMountains(viz, ctx, width, height, values, palette, motion = 1) {
    const a = ampScale(viz.settings);
    const now = Date.now();
    if (viz._mountainLastNow == null) viz._mountainLastNow = now;
    const dt = clamp((now - viz._mountainLastNow) / 1000, 0.008, 0.05);
    viz._mountainLastNow = now;

    // Travel progressing right → world scrolls left (Travel slider = journey pace)
    viz.travelScroll += width * TRAVEL_SPEED * travelPace(viz) * dt;

    const cycle = ensureMountainWorld(viz, now);
    drawMountainSky(viz, ctx, width, height, palette, motion, cycle);
    updateAndDrawBirds(viz, ctx, width, height, now, dt, palette, cycle.dayness);

    if (viz.sceneTransition) {
        const u = clamp(
            (now - viz.sceneTransition.start) / viz.sceneTransition.duration,
            0,
            1
        );
        // Hold full black through the mid cut so scenery swap never flashes
        let black;
        if (u < 0.4) black = smoothstep(0, 0.4, u);
        else if (u < 0.6) black = 1;
        else black = 1 - smoothstep(0.6, 1, u);
        const scene = u < 0.5 ? viz.sceneTransition.from : viz.sceneTransition.to;
        drawTerrainContent(viz,
            ctx, width, height, values, palette, motion, cycle,
            scene, a, now
        );
        ctx.fillStyle = `rgba(0,0,0,${black})`;
        ctx.fillRect(0, 0, width, height);
        return;
    }

    drawTerrainContent(viz,
        ctx, width, height, values, palette, motion, cycle,
        viz.mountainScene, a, now
    );
}
