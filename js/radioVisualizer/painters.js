/** @module {"owns":"radio visualizer single-pass mode painters (sky, aurora, bars, particles, waveforms, rings, orb, spiral)", "related":["radioVisualizer.js","radioVisualizer/backdrop.js","radioVisualizer/settings.js"]} */

import { alpha, pickColor, setGlow, beatPulse, ampScale } from './settings.js';
import { drawSkyGradient } from './backdrop.js';

/**
 * The slice of the RadioVisualizer facade these painters read. Passed
 * explicitly (rather than importing the facade) so this module stays a leaf.
 *
 * @typedef {object} VisualizerHost
 * @property {object} settings
 */

/** Sky mode: aurora curtains, sun/moon orb, far ridge silhouette. */
export function paintNeonSky(viz, ctx, width, height, values, palette, motion = 1) {
    const a = ampScale(viz.settings);
    drawSkyGradient(viz, ctx, width, height, palette, motion);
    const { pulse, phase } = beatPulse(viz.settings.bpm);
    const t = Date.now() * 0.001 * viz.settings.speed;

    // Drifting aurora curtains
    for (let band = 0; band < 4; band += 1) {
        ctx.beginPath();
        const baseY = height * (0.18 + band * 0.1);
        for (let x = 0; x <= width; x += 6) {
            const n = Math.sin(x * 0.012 + t * (0.6 + band * 0.2) + phase * Math.PI * 2)
                + 0.5 * Math.sin(x * 0.03 - t + band);
            const v = values[Math.floor((x / width) * values.length) % values.length] || 0;
            const y = baseY + n * (10 + motion * 14) * a + v * 18 * a * viz.settings.sensitivity;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = alpha(pickColor(palette, band), 0.28 + pulse * 0.25);
        ctx.lineWidth = 2.2 + band * 0.4;
        ctx.shadowBlur = 16 + viz.settings.glow * 20;
        ctx.shadowColor = alpha(pickColor(palette, band), 0.7);
        ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Sun / moon orb
    const cx = width * (0.72 + Math.sin(phase * Math.PI * 2) * 0.02);
    const cy = height * 0.28;
    const radius = Math.min(width, height) * (0.08 + motion * 0.04 * a);
    const orb = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 2.2);
    orb.addColorStop(0, alpha(palette[0], 0.9));
    orb.addColorStop(0.35, alpha(palette[2], 0.35));
    orb.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Far mountain silhouette
    ctx.beginPath();
    ctx.moveTo(0, height);
    const pts = 28;
    for (let i = 0; i <= pts; i += 1) {
        const x = (i / pts) * width;
        const v = values[i % values.length] || 0;
        const y = height * 0.78
            - (8 + Math.sin(i * 0.7 + t) * 6 + v * 22 * a) * viz.settings.sensitivity;
        ctx.lineTo(x, y);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    const sil = ctx.createLinearGradient(0, height * 0.55, 0, height);
    sil.addColorStop(0, alpha(palette[1], 0.45));
    sil.addColorStop(1, '#02040a');
    ctx.fillStyle = sil;
    ctx.fill();
    ctx.strokeStyle = alpha(palette[0], 0.55 + pulse * 0.3);
    ctx.lineWidth = 1.4;
    ctx.shadowBlur = 12;
    ctx.shadowColor = alpha(palette[0], 0.6);
    ctx.beginPath();
    for (let i = 0; i <= pts; i += 1) {
        const x = (i / pts) * width;
        const v = values[i % values.length] || 0;
        const y = height * 0.78
            - (8 + Math.sin(i * 0.7 + t) * 6 + v * 22 * a) * viz.settings.sensitivity;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
}

/** Aurora mode: six horizontal curtains with per-band gradients. */
export function paintAuroraBands(viz, ctx, width, height, values, palette, motion = 1) {
    const a = ampScale(viz.settings);
    drawSkyGradient(viz, ctx, width, height, palette, motion);
    const { pulse, phase } = beatPulse(viz.settings.bpm);
    const t = Date.now() * 0.001;

    for (let i = 0; i < 6; i += 1) {
        const v = values[i % values.length] || 0.2;
        ctx.beginPath();
        for (let x = 0; x <= width; x += 4) {
            const wobble = Math.sin(x * 0.02 + t * (0.8 + i * 0.15) + i + phase * 4);
            const y = height * (0.2 + i * 0.09)
                + wobble * (12 + motion * 16) * a
                + v * 28 * a * viz.settings.sensitivity;
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, alpha(pickColor(palette, i), 0.05));
        grad.addColorStop(0.5, alpha(pickColor(palette, i + 1), 0.45 + pulse * 0.25));
        grad.addColorStop(1, alpha(pickColor(palette, i + 2), 0.05));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3 + v * 6 * a;
        ctx.shadowBlur = 18;
        ctx.shadowColor = alpha(pickColor(palette, i), 0.55);
        ctx.stroke();
    }
    ctx.shadowBlur = 0;
}

/** Bars mode: one gradient column per frequency bin. */
export function paintBars(viz, ctx, width, height, values, palette, motion = 1) {
    ctx.save();
    setGlow(ctx, palette, viz.settings.glow);
    const barWidth = width / values.length;
    const base = height * 0.78;
    const a = ampScale(viz.settings);
    const beatBoost = 0.7 + motion * 0.35;
    for (let i = 0; i < values.length; i += 1) {
        const v = Math.max(0, values[i]);
        const heightValue = Math.max(4, v * height * 0.55 * viz.settings.sensitivity * beatBoost * a);
        const x = i * barWidth + 1;
        const y = base - heightValue;
        const w = Math.max(2, barWidth - 2);
        const grad = ctx.createLinearGradient(0, y, 0, base);
        grad.addColorStop(0, alpha(pickColor(palette, i), 0.9));
        grad.addColorStop(1, alpha(pickColor(palette, i + 1), 0.2));
        ctx.fillStyle = grad;
        ctx.fillRect(x, y, w, heightValue);
    }
    ctx.restore();
}
/** Particles mode: one glowing dot per bin, bobbing with the beat. */
export function paintParticles(viz, ctx, width, height, values, palette, motion = 1) {
    ctx.save();
    setGlow(ctx, palette, viz.settings.glow);
    const { pulse } = beatPulse(viz.settings.bpm);
    const a = ampScale(viz.settings);
    for (let i = 0; i < values.length; i += 1) {
        const strength = (values[i] || 0) * viz.settings.sensitivity * (0.55 + motion * 0.4) * a;
        const x = (i / values.length) * width + 10;
        const y = height * 0.5
            + Math.sin((i + Date.now() * 0.004 * (0.6 + pulse)) * 0.7) * (12 + motion * 8) * a;
        const size = 1.5 + strength * 6 + pulse * 2 * a;
        ctx.fillStyle = alpha(pickColor(palette, i + 2), 0.7);
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

/** Waveform mode: 8-bit time-domain samples around the centre line. */
export function paintWaveform(viz, ctx, width, height, values, palette, motion = 1) {
    ctx.save();
    setGlow(ctx, palette, viz.settings.glow);
    const a = ampScale(viz.settings);
    ctx.beginPath();
    const step = width / values.length;
    const amp = 0.2 * viz.settings.sensitivity * (0.75 + motion * 0.3) * a;
    for (let i = 0; i < values.length; i += 1) {
        const norm = (values[i] - 128) / 128;
        const x = i * step;
        const y = height / 2 + norm * height * amp;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = alpha(palette[0], 0.78);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
}

/** Waveform mode fallback: synthesized 0…1 bins mirrored around the centre. */
export function paintWaveformSynth(viz, ctx, width, height, values, palette, motion = 1) {
    ctx.save();
    setGlow(ctx, palette, viz.settings.glow);
    const a = ampScale(viz.settings);
    ctx.beginPath();
    const step = width / values.length;
    for (let i = 0; i < values.length; i += 1) {
        const norm = (values[i] - 0.5) * 2;
        const x = i * step;
        const y = height / 2 + norm * height * 0.16 * viz.settings.sensitivity * (0.75 + motion * 0.3) * a;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = alpha(palette[0], 0.78);
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.restore();
}

/** Rings mode: seven concentric rings pulsing with their bin. */
export function paintRings(viz, ctx, width, height, values, palette, motion = 1) {
    ctx.save();
    setGlow(ctx, palette, viz.settings.glow);
    const a = ampScale(viz.settings);
    const cx = width / 2;
    const cy = height / 2;
    for (let i = 0; i < 7; i += 1) {
        const strength = (values[i % values.length] || 0) * viz.settings.sensitivity * a;
        const radius = 16 + i * 11 + strength * 36 + motion * 6 * a;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = alpha(pickColor(palette, i + 1), 0.35 + strength * 0.4);
        ctx.lineWidth = 1.2;
        ctx.stroke();
    }
    ctx.restore();
}

/** Orb mode: single radial-gradient sphere sized by average energy. */
export function paintOrb(viz, ctx, width, height, values, palette, motion = 1) {
    ctx.save();
    setGlow(ctx, palette, viz.settings.glow);
    const a = ampScale(viz.settings);
    const cx = width / 2;
    const cy = height / 2;
    const avg = values.reduce((sum, value) => sum + (value || 0), 0) / Math.max(1, values.length);
    const radius = Math.min(width, height) * (0.14 + avg * 0.4 * viz.settings.sensitivity * a + motion * 0.05);
    const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.6);
    grad.addColorStop(0, alpha(palette[0], 0.86));
    grad.addColorStop(0.48, alpha(palette[1], 0.45));
    grad.addColorStop(1, alpha(palette[2], 0.02));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** Spiral mode: 150-point rotating spiral. */
export function paintSpiral(viz, ctx, width, height, values, palette, motion = 1) {
    ctx.save();
    setGlow(ctx, palette, viz.settings.glow);
    const a = ampScale(viz.settings);
    const cx = width / 2;
    const cy = height / 2;
    const { pulse } = beatPulse(viz.settings.bpm);
    ctx.beginPath();
    for (let i = 0; i < 150; i += 1) {
        const angle = i * 0.42 + Date.now() * 0.0008 * viz.settings.speed * (0.7 + pulse + motion * 0.25);
        const strength = (values[i % values.length] || 0.2) * viz.settings.sensitivity * a;
        const radius = 8 + i * 1.05 + strength * 22 + motion * 4;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = alpha(palette[3], 0.8);
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
}

