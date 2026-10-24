/** @module {"owns":"radio visualizer colour palettes", "related":["radioVisualizer.js","radioVisualizer/settings.js"]} */

/**
 * Named colour ramps. Index order is meaningful: 0 is the dominant accent,
 * 1–2 drive secondary glow, 3–4 highlight secondary scenery.
 */
export const PALETTES = {
    neon: ['#7dd3fc', '#c084fc', '#f472b6', '#fef08a', '#34d399'],
    horizon: ['#00f0ff', '#ff2bd6', '#b8ff3c', '#7b5cff', '#ff9f1c'],
    sunset: ['#f97316', '#fb7185', '#facc15', '#fda4af', '#fbbf24'],
    aurora: ['#22d3ee', '#34d399', '#a3e635', '#60a5fa', '#c4b5fd'],
    mono: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#f8fafc', '#dbeafe'],
    ocean: ['#38bdf8', '#2dd4bf', '#a5f3fc', '#67e8f9', '#bae6fd'],
    vapor: ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96'],
    'dark-ocean': ['#0ea5e9', '#0c4a6e', '#155e75', '#22d3ee', '#082f49'],
    'night-sky': ['#818cf8', '#1e1b4b', '#312e81', '#c4b5fd', '#0b1026']
};
