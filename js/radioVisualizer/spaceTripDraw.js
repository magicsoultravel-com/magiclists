/** @module {"owns":"radio visualizer space-trip drawing: nebula, tunnel, planets and frame composition", "related":["radioVisualizer.js","radioVisualizer/spaceTripState.js"]} */

import { alpha, clamp, pickColor, setGlow, beatPulse, ampScale } from './settings.js';
import { travelPace } from './controls.js';
import {
    HYPER_WALL_COLORS,
    ensureNebulaBlobs,
    ensureNebulaWisps,
    ensureSpaceTripState,
    ensureSpaceTripWarp,
    getSpaceTripHyperPhase,
    getSpaceTripNebulaStrength,
    spaceTripProject,
    updateSpaceTrip
} from './spaceTripState.js';

export function drawSpaceTripNebula(viz, ctx, width, height, cx, cy, state, palette, strength, pulse, motion, now) {
    if (strength <= 0.01 || !state) return;

    const pulseLight = 0.55 + pulse * 0.45 + motion * 0.2;
    const w = width;
    const h = height;
    const span = Math.hypot(w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    ctx.fillStyle = alpha(pickColor(palette, 2), strength * 0.04 * pulseLight);
    ctx.fillRect(0, 0, w, h);

    const wash = ctx.createRadialGradient(cx, cy, span * 0.02, cx, cy, span * 0.72);
    wash.addColorStop(0, alpha(pickColor(palette, 1), strength * 0.14 * pulseLight));
    wash.addColorStop(0.35, alpha(pickColor(palette, 3), strength * 0.1 * pulseLight));
    wash.addColorStop(0.72, alpha(pickColor(palette, 0), strength * 0.06 * pulseLight));
    wash.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);

    const blobs = ensureNebulaBlobs(viz, state, palette);
    for (const blob of blobs) {
        const bx = cx + blob.ox * w * 0.72 * strength;
        const by = cy + blob.oy * h * 0.68 * strength;
        const br = blob.r * span * (0.62 + strength * 0.42);
        const flicker = 0.65 + 0.35 * Math.sin(now * 0.002 * blob.sp + pulse * Math.PI * 2);
        const grad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        grad.addColorStop(0, alpha(blob.color, strength * blob.a * flicker * pulseLight * 1.2));
        grad.addColorStop(0.4, alpha(blob.color, strength * blob.a * 0.55 * flicker));
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    for (let i = 0; i < 16; i += 1) {
        const lx = cx + Math.sin(now * 0.0015 + i * 1.3) * w * 0.38;
        const ly = cy + Math.cos(now * 0.0012 + i * 0.9) * h * 0.32;
        const lr = 28 + Math.sin(now * 0.004 + i) * 22;
        const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
        lg.addColorStop(0, alpha(pickColor(palette, i + 1), strength * 0.42 * pulseLight));
        lg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, w, h);
    }

    ctx.restore();
}

export function drawSpaceTripNebulaWisps(viz, ctx, cx, cy, fov, state, palette, strength, pulse, viewPanX, viewPanY) {
    if (strength <= 0.01 || !state.nebulaWisps?.length) return;

    const pulseLight = 0.55 + pulse * 0.45;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const wisp of state.nebulaWisps) {
        if (wisp.z < 0.025) continue;
        const invZ = 1 / Math.max(wisp.z, 0.02);
        const sx = cx + viewPanX + wisp.x * fov * invZ;
        const sy = cy + viewPanY + wisp.y * fov * invZ;
        const baseR = wisp.size * fov * invZ;
        if (baseR < 0.4) continue;

        const approach = clamp((1.4 - wisp.z) / 1.2, 0, 1);
        const a = wisp.alpha * strength * pulseLight * (0.25 + approach * 0.75);
        const col = pickColor(palette, wisp.colorIdx);
        ctx.fillStyle = alpha(col, a);
        ctx.beginPath();
        ctx.ellipse(sx, sy, baseR * wisp.aspect, baseR * 0.82, wisp.ang, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
}

export function drawSpaceTripTunnel(viz, ctx, width, height, cx, cy, state, palette, hyperMix, motion, pulse, fov, viewPanX, viewPanY) {
    if (hyperMix <= 0.01) return;

    const warp = ensureSpaceTripWarp(viz, state);
    const now = Date.now();
    const px = cx + viewPanX;
    const py = cy + viewPanY;
    const project = (x, y, z) => spaceTripProject(viz, cx, cy, fov, viewPanX, viewPanY, x, y, z);
    const wall = 0.48;
    const wallY = 0.86;
    const segments = 24;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = hyperMix;
    ctx.shadowBlur = 0;

    const bloomR = fov * (0.18 + hyperMix * 0.22);
    const bloom = ctx.createRadialGradient(px, py, 0, px, py, bloomR);
    bloom.addColorStop(0, alpha('#f8fafc', 0.06 + hyperMix * 0.22 + pulse * 0.1));
    bloom.addColorStop(0.25, alpha('#7dd3fc', 0.08 + hyperMix * 0.14));
    bloom.addColorStop(0.55, alpha('#6366f1', 0.04 + hyperMix * 0.06));
    bloom.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = bloom;
    ctx.fillRect(0, 0, width, height);

    const sortedRings = [...warp.rings].sort((a, b) => b.z - a.z);

    for (let ri = 0; ri < sortedRings.length - 1; ri += 1) {
        const rFar = sortedRings[ri];
        const rNear = sortedRings[ri + 1];
        const twist = rFar.drift + now * 0.000015;
        const depthFade = clamp((1 - rNear.z * 0.65) * (0.45 + pulse * 0.35 + motion * 0.15), 0.06, 1);

        for (let s = 0; s < segments; s += 1) {
            const ang = (s / segments) * Math.PI * 2 + twist;
            const cos = Math.cos(ang);
            const sin = Math.sin(ang);
            const pFar = project(cos * wall, sin * wall * wallY, rFar.z);
            const pNear = project(cos * wall, sin * wall * wallY, rNear.z);

            const col = HYPER_WALL_COLORS[(s + ri) % HYPER_WALL_COLORS.length];
            ctx.strokeStyle = alpha(col, depthFade * (0.18 + hyperMix * 0.42));
            ctx.lineWidth = 0.6 + pNear.invZ * 0.35;
            ctx.beginPath();
            ctx.moveTo(pFar.sx, pFar.sy);
            ctx.lineTo(pNear.sx, pNear.sy);
            ctx.stroke();
        }

        if (ri % 2 === 0) {
            for (let s = 0; s < 6; s += 1) {
                const ang = (s / 6) * Math.PI * 2 + twist * 1.1;
                const cos = Math.cos(ang);
                const sin = Math.sin(ang);
                const pCenter = project(0, 0, rFar.z);
                const pEdge = project(cos * wall * 0.92, sin * wall * wallY * 0.92, rFar.z);
                ctx.strokeStyle = alpha('#e0f2fe', depthFade * hyperMix * 0.12);
                ctx.lineWidth = 0.5;
                ctx.beginPath();
                ctx.moveTo(pCenter.sx, pCenter.sy);
                ctx.lineTo(pEdge.sx, pEdge.sy);
                ctx.stroke();
            }
        }
    }

    for (const ring of sortedRings) {
        const invZ = 1 / Math.max(ring.z, 0.02);
        const rx = fov * invZ * wall;
        const ry = fov * invZ * wall * wallY;
        const twist = ring.drift + now * 0.000015;
        const ringFade = clamp((1 - ring.z * 0.55) * (0.35 + pulse * 0.4), 0.08, 0.95);
        const col = HYPER_WALL_COLORS[ring.colorIdx % HYPER_WALL_COLORS.length];

        ctx.strokeStyle = alpha(col, ringFade * (0.25 + hyperMix * 0.45));
        ctx.lineWidth = 0.8 + invZ * 0.55;
        ctx.beginPath();
        ctx.ellipse(px, py, rx, ry, twist * 0.08, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = alpha('#f0f9ff', ringFade * hyperMix * 0.15);
        ctx.lineWidth = 0.4 + invZ * 0.2;
        ctx.beginPath();
        ctx.ellipse(px, py, rx * 0.98, ry * 0.98, twist * 0.08, 0, Math.PI * 2);
        ctx.stroke();
    }

    for (const streak of warp.streaks) {
        const cos = Math.cos(streak.ang);
        const sin = Math.sin(streak.ang);
        const r = streak.radial;
        const zNear = streak.z;
        const zFar = streak.z + streak.len;
        const pNear = project(cos * r, sin * r * wallY, zNear);
        const pFar = project(cos * r, sin * r * wallY, zFar);
        const streakFade = clamp(pNear.invZ * 0.12, 0.08, 1) * hyperMix;
        const col = HYPER_WALL_COLORS[streak.colorIdx % HYPER_WALL_COLORS.length];

        ctx.strokeStyle = alpha(col, streakFade * (0.35 + pulse * 0.25));
        ctx.lineWidth = 0.5 + pNear.invZ * 0.55;
        ctx.beginPath();
        ctx.moveTo(pFar.sx, pFar.sy);
        ctx.lineTo(pNear.sx, pNear.sy);
        ctx.stroke();

        if (hyperMix > 0.65) {
            const pCore = project(cos * r * 0.08, sin * r * wallY * 0.08, zNear);
            ctx.strokeStyle = alpha('#ffffff', streakFade * 0.28);
            ctx.lineWidth = 0.35 + pNear.invZ * 0.3;
            ctx.beginPath();
            ctx.moveTo(pCore.sx, pCore.sy);
            ctx.lineTo(pNear.sx, pNear.sy);
            ctx.stroke();
        }
    }

    ctx.restore();
}

export function drawSpaceEarth(viz, ctx, sx, sy, pr, fade) {
    const ocean = '#1d4ed8';
    const land = '#15803d';
    const landHi = '#22c55e';
    const cloud = '#f8fafc';
    const atm = '#7dd3fc';

    const atmGrad = ctx.createRadialGradient(sx, sy, pr * 0.85, sx, sy, pr * 1.18);
    atmGrad.addColorStop(0, alpha(atm, 0.05 * fade));
    atmGrad.addColorStop(0.55, alpha(atm, 0.22 * fade));
    atmGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = atmGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, pr * 1.18, 0, Math.PI * 2);
    ctx.fill();

    const bodyGrad = ctx.createRadialGradient(
        sx - pr * 0.22,
        sy - pr * 0.24,
        pr * 0.08,
        sx,
        sy,
        pr
    );
    bodyGrad.addColorStop(0, alpha('#60a5fa', fade));
    bodyGrad.addColorStop(0.55, alpha(ocean, fade));
    bodyGrad.addColorStop(1, alpha('#0f172a', 0.85 * fade));
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.arc(sx, sy, pr, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(sx, sy, pr, 0, Math.PI * 2);
    ctx.clip();

    const continents = [
        { ox: -0.22, oy: -0.08, rx: 0.28, ry: 0.22, rot: -0.3 },
        { ox: 0.18, oy: 0.12, rx: 0.22, ry: 0.18, rot: 0.5 },
        { ox: -0.05, oy: 0.28, rx: 0.18, ry: 0.12, rot: 0.1 },
        { ox: 0.32, oy: -0.18, rx: 0.14, ry: 0.1, rot: -0.6 }
    ];
    for (const c of continents) {
        ctx.fillStyle = alpha(land, 0.88 * fade);
        ctx.beginPath();
        ctx.ellipse(
            sx + c.ox * pr,
            sy + c.oy * pr,
            c.rx * pr,
            c.ry * pr,
            c.rot,
            0,
            Math.PI * 2
        );
        ctx.fill();
        ctx.fillStyle = alpha(landHi, 0.35 * fade);
        ctx.beginPath();
        ctx.ellipse(
            sx + c.ox * pr - pr * 0.04,
            sy + c.oy * pr - pr * 0.04,
            c.rx * pr * 0.55,
            c.ry * pr * 0.5,
            c.rot,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    for (let i = 0; i < 6; i += 1) {
        const ang = i * 1.4 + pr * 0.002;
        ctx.fillStyle = alpha(cloud, 0.28 * fade);
        ctx.beginPath();
        ctx.ellipse(
            sx + Math.cos(ang) * pr * 0.35,
            sy + Math.sin(ang) * pr * 0.25,
            pr * 0.22,
            pr * 0.08,
            ang * 0.5,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }
    ctx.restore();
}

export function drawSpacePlanet(viz, ctx, sx, sy, pr, planet, palette, fade) {
    const bodyColor = pickColor(palette, planet.colorIdx);
    const atmColor = pickColor(palette, planet.colorIdx + 2);
    const accent = pickColor(palette, planet.colorIdx + 1);
    const type = planet.type || 'rocky';

    ctx.save();

    if (type === 'earth') {
        drawSpaceEarth(viz, ctx, sx, sy, pr, fade);
        ctx.restore();
        return;
    }

    if (type === 'binary') {
        const sep = pr * 0.55;
        const r1 = pr * 0.62;
        const r2 = pr * 0.48;
        for (const [ox, r, col] of [[-sep, r1, bodyColor], [sep, r2, accent]]) {
            const g = ctx.createRadialGradient(ox + sx - r * 0.2, sy - r * 0.2, r * 0.1, ox + sx, sy, r);
            g.addColorStop(0, alpha(atmColor, 0.85 * fade));
            g.addColorStop(1, alpha(col, 0.75 * fade));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(sx + ox, sy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
        return;
    }

    const grad = ctx.createRadialGradient(
        sx - pr * 0.28,
        sy - pr * 0.28,
        pr * 0.06,
        sx,
        sy,
        pr
    );
    grad.addColorStop(0, alpha(atmColor, 0.9 * fade));
    grad.addColorStop(0.55, alpha(bodyColor, 0.88 * fade));
    grad.addColorStop(1, alpha(bodyColor, 0.2 * fade));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, pr, 0, Math.PI * 2);
    ctx.fill();

    if (type === 'gas') {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, pr, 0, Math.PI * 2);
        ctx.clip();
        for (let i = -3; i <= 3; i += 1) {
            const bandY = sy + i * pr * 0.22;
            ctx.fillStyle = alpha(pickColor(palette, planet.colorIdx + i + 3), 0.35 * fade);
            ctx.fillRect(sx - pr, bandY - pr * 0.08, pr * 2, pr * 0.16);
        }
        ctx.restore();
    } else if (type === 'rocky') {
        const craters = 4 + Math.floor(planet.seed * 4);
        for (let i = 0; i < craters; i += 1) {
            const ang = planet.seed * 12.9898 + i * 2.399;
            const dist = pr * (0.15 + (Math.sin(ang) * 0.5 + 0.5) * 0.55);
            const cx = sx + Math.cos(ang) * dist;
            const cy = sy + Math.sin(ang) * dist * 0.85;
            const cr = pr * (0.08 + (Math.sin(ang * 2) * 0.5 + 0.5) * 0.12);
            ctx.fillStyle = alpha(bodyColor, 0.45 * fade);
            ctx.beginPath();
            ctx.arc(cx, cy, cr, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = alpha('#000', 0.25 * fade);
            ctx.lineWidth = Math.max(0.5, cr * 0.15);
            ctx.stroke();
        }
    } else if (type === 'ice') {
        ctx.fillStyle = alpha('#e2e8f0', 0.35 * fade);
        ctx.beginPath();
        ctx.ellipse(sx - pr * 0.15, sy - pr * 0.2, pr * 0.35, pr * 0.18, -0.4, 0, Math.PI * 2);
        ctx.fill();
    } else if (type === 'striped') {
        ctx.save();
        ctx.beginPath();
        ctx.arc(sx, sy, pr, 0, Math.PI * 2);
        ctx.clip();
        for (let i = 0; i < 5; i += 1) {
            const x = sx - pr + (i / 4) * pr * 2;
            ctx.fillStyle = alpha(pickColor(palette, planet.colorIdx + i), 0.28 * fade);
            ctx.fillRect(x - pr * 0.12, sy - pr, pr * 0.24, pr * 2);
        }
        ctx.restore();
    } else if (type === 'cloudy') {
        for (let i = 0; i < 5; i += 1) {
            const ang = planet.spin + i * 1.3;
            const ox = Math.cos(ang) * pr * 0.35;
            const oy = Math.sin(ang) * pr * 0.25;
            ctx.fillStyle = alpha(accent, 0.22 * fade);
            ctx.beginPath();
            ctx.ellipse(sx + ox, sy + oy, pr * 0.38, pr * 0.22, ang, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    if (type === 'ringed') {
        ctx.strokeStyle = alpha(accent, 0.55 * fade);
        ctx.lineWidth = Math.max(1, pr * 0.06);
        ctx.beginPath();
        ctx.ellipse(sx, sy, pr * 1.75, pr * 0.34, -0.32, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = alpha(atmColor, 0.3 * fade);
        ctx.lineWidth = Math.max(0.5, pr * 0.04);
        ctx.beginPath();
        ctx.ellipse(sx, sy, pr * 1.45, pr * 0.28, -0.32, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.restore();
}

export function drawSpaceTrip(viz, ctx, width, height, values, palette, motion = 1) {
    const cx = width / 2;
    const cy = height / 2;
    const fov = Math.min(width, height) * 0.55;
    const now = Date.now();
    const { pulse } = beatPulse(viz.settings.bpm, now);
    const a = ampScale(viz.settings);

    const state = ensureSpaceTripState(viz, width, height);
    const dt = state.lastFrameTime
        ? Math.min(0.05, (now - state.lastFrameTime) / 1000)
        : 0.016;
    updateSpaceTrip(viz, dt, motion, values);

    const hyper = state.lastHyper || getSpaceTripHyperPhase(viz, now, state);
    const hyperMix = hyper.mix;

    ctx.fillStyle = '#010204';
    ctx.fillRect(0, 0, width, height);

    const nebulaStrength = getSpaceTripNebulaStrength(viz, now, state);

    if (nebulaStrength < 0.15) {
        const edgeVig = ctx.createRadialGradient(
            cx,
            cy,
            Math.max(width, height) * 0.5,
            cx,
            cy,
            Math.max(width, height) * 0.95
        );
        edgeVig.addColorStop(0, 'rgba(0,0,0,0)');
        edgeVig.addColorStop(1, 'rgba(0,0,0,0.45)');
        ctx.fillStyle = edgeVig;
        ctx.fillRect(0, 0, width, height);
    }

    if (nebulaStrength > 0.01) {
        drawSpaceTripNebula(viz, ctx, width, height, cx, cy, state, palette, nebulaStrength, pulse, motion, now);
        ensureNebulaWisps(viz, state, palette);
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((state.rollAngle || 0) + (state.dodge?.roll || 0));
    ctx.translate(-cx, -cy);

    const viewPanX = state.dodge?.panX || 0;
    const viewPanY = state.dodge?.panY || 0;

    if (nebulaStrength > 0.01) {
        drawSpaceTripNebulaWisps(viz, ctx, cx, cy, fov, state, palette, nebulaStrength, pulse, viewPanX, viewPanY);
    }

    if (hyperMix < 0.35) {
        setGlow(ctx, palette, viz.settings.glow * 0.75);
    } else {
        ctx.shadowBlur = 0;
    }

    const avg = values?.length
        ? values.reduce((sum, value) => sum + (value || 0), 0) / values.length
        : 0.3;
    const streakMul = (0.4 + avg * viz.settings.sensitivity * a + pulse * 0.3) * viz.settings.amplitude;
    const travelStep = travelPace(viz) * 0.02 * (hyper.speedMul || 1);
    const starFade = 1 - hyperMix * 0.92;

    const projectStar = (x, y, z) => {
        const invZ = 1 / Math.max(z, 0.02);
        return {
            sx: cx + viewPanX + x * fov * invZ,
            sy: cy + viewPanY + y * fov * invZ,
            invZ
        };
    };

    if (hyperMix > 0.01) {
        drawSpaceTripTunnel(viz, ctx, width, height, cx, cy, state, palette, hyperMix, motion, pulse, fov, viewPanX, viewPanY);
    }

    for (const star of state.stars) {
        const { sx, sy, invZ } = projectStar(star.x, star.y, star.z);
        if (sx < -32 || sx > width + 32 || sy < -32 || sy > height + 32) continue;

        const kindMul = star.kind === 'bright' ? 1.55 : star.kind === 'trail' ? 1.25 : star.kind === 'dim' ? 0.55 : 1;
        const twinkle = 0.5 + 0.5 * Math.sin(now * 0.003 * viz.settings.speed + star.tw);
        const brightness = clamp(
            (0.32 + twinkle * 0.48 + pulse * 0.28 + motion * 0.18) * invZ * 0.42 * starFade * kindMul,
            0.06,
            1
        );
        const size = (0.45 + brightness * 2.1) * Math.min(invZ * 0.16, 2.8) * (star.sizeMul || 1);
        const color = pickColor(palette, star.colorIdx ?? Math.floor(star.hue * palette.length));
        const warm = star.kind === 'bright' ? '#fef9c3' : color;

        if (star.history?.length > 1 && starFade > 0.08) {
            for (let h = star.history.length - 1; h >= 0; h -= 1) {
                const pt = star.history[h];
                const proj = projectStar(pt.x, pt.y, pt.z);
                const trailA = brightness * (0.08 + (1 - h / star.history.length) * 0.35);
                ctx.strokeStyle = alpha(warm, trailA);
                ctx.lineWidth = Math.max(0.35, size * 0.35);
                if (h < star.history.length - 1) {
                    const next = star.history[h + 1];
                    const nextProj = projectStar(next.x, next.y, next.z);
                    ctx.beginPath();
                    ctx.moveTo(nextProj.sx, nextProj.sy);
                    ctx.lineTo(proj.sx, proj.sy);
                    ctx.stroke();
                }
            }
        }

        const prevZ = star.z + travelStep * (star.kind === 'trail' ? 1.8 : 1) * (1 + hyperMix * 12);
        const prev = projectStar(star.x, star.y, prevZ);
        const streakBoost = star.kind === 'trail' ? 10 : star.kind === 'bright' ? 6 : 4;
        const hyperStreak = 1 + hyperMix * 16;
        const streakLen = size * streakMul * streakBoost * hyperStreak;

        if (streakLen > 1 || invZ > 0.35) {
            ctx.strokeStyle = alpha(warm, brightness);
            ctx.lineWidth = Math.max(0.45, size * (star.kind === 'trail' ? 0.65 : 0.48));
            ctx.beginPath();
            ctx.moveTo(prev.sx, prev.sy);
            ctx.lineTo(sx, sy);
            ctx.stroke();
        }

        if (starFade > 0.08) {
            if (star.kind === 'bright') {
                ctx.fillStyle = alpha(warm, brightness * 0.35);
                ctx.beginPath();
                ctx.arc(sx, sy, Math.max(0.8, size * 1.8), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = alpha(warm, brightness);
            ctx.beginPath();
            ctx.arc(sx, sy, Math.max(0.4, size), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    if (hyperMix < 0.92) {
        for (const planet of state.planets) {
            if (planet.z < 0.008) continue;

            const invZ = 1 / Math.max(planet.z, 0.02);
            const sx = cx + viewPanX + planet.x * fov * invZ;
            const sy = cy + viewPanY + planet.y * fov * invZ;
            const isClosePass = planet.type === 'earth' || planet.sizeClass === 'headOn';
            const maxR = isClosePass
                ? Math.max(width, height) * 1.4
                : planet.sizeClass === 'large'
                    ? Math.min(width, height) * 0.18
                    : planet.sizeClass === 'small'
                        ? Math.min(width, height) * 0.06
                        : Math.min(width, height) * 0.11;
            const pr = Math.min(planet.radius * fov * invZ, maxR);

            if (!isClosePass && pr < 1.2) continue;
            if (isClosePass && pr < 0.5 && planet.z > 0.4) continue;

            const approachFade = planet.z > 1.05
                ? clamp((1.65 - planet.z) / 0.6, 0, 1)
                : 1;
            const fade = approachFade * (1 - hyperMix);
            if (fade <= 0.02) continue;

            drawSpacePlanet(viz, ctx, sx, sy, pr, planet, palette, fade);
        }
    }

    ctx.restore();
}
