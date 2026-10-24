/** @module {"owns":"radio visualizer settings defaults, prefs storage, colour + timing math", "related":["radioVisualizer.js","radioVisualizer/palettes.js"]} */

export const VISUALIZER_PREFS_KEY = 'matrix_radio_visualizer_prefs';

export const DEFAULTS = {
    mode: 'mountains',
    palette: 'horizon',
    sensitivity: 1.0,
    amplitude: 0.55,
    density: 1,
    speed: 1,
    travel: 0.55, // journey pace: scroll + scenery timing (1 = base)
    glow: 0.85,
    background: 'dark',
    bpm: 120
};

/** Raw prefs blob. Callers merge over DEFAULTS; a corrupt value yields {}. */
export function readVisualizerPrefs() {
    try {
        return JSON.parse(localStorage.getItem(VISUALIZER_PREFS_KEY) || 'null') || {};
    } catch {
        return {};
    }
}

export function writeVisualizerPrefs(data) {
    try {
        localStorage.setItem(VISUALIZER_PREFS_KEY, JSON.stringify(data));
    } catch {
        /* ignore quota */
    }
}

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function alpha(hex, a) {
    if (!hex || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
        return `rgba(255,255,255,${a})`;
    }
    const full = hex.length === 4
        ? hex.split('').map((ch, i) => (i === 0 ? ch : ch + ch)).join('')
        : hex;
    const value = parseInt(full.slice(1), 16);
    const r = (value >> 16) & 255;
    const g = (value >> 8) & 255;
    const b = value & 255;
    return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function pickColor(palette, index) {
    return palette[index % palette.length] || palette[0];
}

export function setGlow(ctx, palette, glow) {
    ctx.shadowBlur = 8 + (glow || 0.65) * 18;
    ctx.shadowColor = alpha(palette[0], 0.7);
}

export function beatPulse(bpm, now = Date.now()) {
    const tempo = clamp(Number(bpm) || 120, 10, 200);
    const phase = ((now * tempo) / 60000) % 1;
    const envelope = Math.pow(1 - phase, 2.4);
    return { phase, pulse: envelope, tempo };
}

export function ampScale(settings) {
    return clamp(Number(settings.amplitude) || 0.55, 0.15, 1.5);
}

export function shuffleNoRepeat(items, last) {
    const pool = [...items];
    for (let i = pool.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    if (pool.length > 1 && last && pool[0] === last) {
        const swap = pool.findIndex((v, idx) => idx > 0 && v !== last);
        if (swap > 0) [pool[0], pool[swap]] = [pool[swap], pool[0]];
    }
    return pool;
}

export function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

export function hexToRgb(hex) {
    if (!hex || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
        return [255, 255, 255];
    }
    const full = hex.length === 4
        ? hex.split('').map((ch, i) => (i === 0 ? ch : ch + ch)).join('')
        : hex;
    const value = parseInt(full.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbaTuple(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return [r, g, b, a];
}

export function lerpTuple(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t
    ];
}

export function cssRgba(tuple) {
    return `rgba(${Math.round(tuple[0])}, ${Math.round(tuple[1])}, ${Math.round(tuple[2])}, ${tuple[3]})`;
}
