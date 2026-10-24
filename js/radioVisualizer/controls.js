/** @module {"owns":"visualizer settings normalization, scene timing, control labels and status text", "related":["radioVisualizer.js","radioVisualizer/prefs.js","radioVisualizer/audioGraph.js"]} */

import { RadioPlayer } from '../radioPlayer.js';
import { clamp } from './settings.js';
import * as vizPrefs from './prefs.js';
import { releaseGraph } from './audioGraph.js';

export const SCENE_HOLD_MS = 18_000; // at travel = 1
export const SEA_HOLD_MS = 60_000; // at travel = 1
export const SCENE_TRANSITION_MS = 3_000; // at travel = 1
export const TRAVEL_SPEED = 0.05; // screens/sec at travel = 1

/**
 * The slice of the RadioVisualizer facade these helpers read and write. Passed
 * explicitly (rather than importing the facade) to avoid the
 * radioVisualizer.js ↔ radioPlayer.js import cycle.
 *
 * @typedef {object} VisualizerHost
 * @property {HTMLCanvasElement|null} canvas
 * @property {CanvasRenderingContext2D|null} context
 * @property {object} settings
 * @property {object|null} spaceTrip
 * @property {boolean} enabled
 * @property {object|null} modal
 * @property {boolean} analysisLive
 * @property {boolean} analysisBlocked
 * @property {object|null} source
 * @property {HTMLAudioElement|null} mediaElement
 * @property {function(): void} resizeCanvas
 * @property {function(): void} drawIdleFrame
 */

/** @param {VisualizerHost} viz */
export function setCanvas(viz, canvas) {
    viz.canvas = canvas;
    viz.context = canvas?.getContext('2d') || null;
    if (viz.canvas) {
        viz.resizeCanvas();
        viz.drawIdleFrame();
    }
}

/** @param {VisualizerHost} viz */
export function setMediaElement(viz, mediaElement) {
    viz.mediaElement = mediaElement || RadioPlayer?.getAudioElement?.() || RadioPlayer?.audio || null;
    if (viz.source && viz.source.mediaElement && viz.source.mediaElement !== viz.mediaElement) {
        releaseGraph(viz);
    }
    if (viz.canvas) {
        viz.drawIdleFrame();
    }
}

/** @param {VisualizerHost} viz */
export function setSettings(viz, patch = {}, { persist = true } = {}) {
    const prevMode = viz.settings.mode;
    viz.settings = { ...viz.settings, ...patch };
    viz.settings.sensitivity = clamp(Number(viz.settings.sensitivity) || 1, 0.35, 2.5);
    viz.settings.amplitude = clamp(Number(viz.settings.amplitude) || 0.55, 0.15, 1.5);
    viz.settings.density = clamp(Number(viz.settings.density) || 1, 0.3, 2.2);
    viz.settings.speed = clamp(Number(viz.settings.speed) || 1, 0.35, 2.5);
    viz.settings.travel = clamp(Number(viz.settings.travel) || 0.55, 0.25, 1.25);
    viz.settings.glow = clamp(Number(viz.settings.glow) || 0.65, 0, 1.5);
    viz.settings.bpm = clamp(Math.round(Number(viz.settings.bpm) || 120), 10, 200);
    if (patch.mode && patch.mode !== prevMode) {
        viz.spaceTrip = null;
    }
    syncControlLabels(viz);
    if (viz.canvas && !viz.enabled) {
        viz.drawIdleFrame();
    }
    if (persist) vizPrefs.saveStoredPrefs(viz);
}

/** @param {VisualizerHost} viz */
export function travelPace(viz) {
    return clamp(Number(viz.settings.travel) || 0.55, 0.25, 1.25);
}

/** @param {VisualizerHost} viz */
export function sceneHoldMs(viz, scene) {
    const base = scene === 'sea' ? SEA_HOLD_MS : SCENE_HOLD_MS;
    return base / travelPace(viz);
}

/** @param {VisualizerHost} viz */
export function sceneTransitionMs(viz) {
    return SCENE_TRANSITION_MS / travelPace(viz);
}

/** @param {VisualizerHost} viz */
export function syncControlLabels(viz) {
    const bpmLabel = viz.modal?.querySelector('[data-media-visualizer-bpm-label]');
    if (bpmLabel) bpmLabel.textContent = `BPM: ${viz.settings.bpm}`;
    const bpmSlider = viz.modal?.querySelector('[data-media-visualizer-bpm]');
    if (bpmSlider && Number(bpmSlider.value) !== viz.settings.bpm) {
        bpmSlider.value = String(viz.settings.bpm);
    }
    const ampLabel = viz.modal?.querySelector('[data-media-visualizer-amplitude-label]');
    if (ampLabel) ampLabel.textContent = `Amplitude: ${viz.settings.amplitude.toFixed(2)}`;
    const ampSlider = viz.modal?.querySelector('[data-media-visualizer-amplitude]');
    if (ampSlider && Number(ampSlider.value) !== viz.settings.amplitude) {
        ampSlider.value = String(viz.settings.amplitude);
    }
    const travelLabel = viz.modal?.querySelector('[data-media-visualizer-travel-label]');
    if (travelLabel) {
        const pace = travelPace(viz);
        travelLabel.textContent = `Travel: ${pace.toFixed(2)}×`;
    }
    const travelSlider = viz.modal?.querySelector('[data-media-visualizer-travel]');
    if (travelSlider && Number(travelSlider.value) !== viz.settings.travel) {
        travelSlider.value = String(viz.settings.travel);
    }
}

/** @param {VisualizerHost} viz */
export function syncBpmLabel(viz) {
    syncControlLabels(viz);
}

/** @param {VisualizerHost} viz */
export function updateStatus(viz) {
    const el = viz.modal?.querySelector('[data-media-visualizer-status]');
    if (!el) return;
    if (!viz.enabled) {
        el.textContent = '';
        return;
    }
    if (viz.analysisLive) {
        el.textContent = 'Live audio';
        el.dataset.state = 'live';
    } else if (viz.analysisBlocked || RadioPlayer.analysisAvailable === false) {
        el.textContent = 'This station blocks analysis — match BPM manually';
        el.dataset.state = 'blocked';
    } else {
        el.textContent = 'Listening for audio…';
        el.dataset.state = 'pending';
    }
}

/** @param {VisualizerHost} viz */
export function dispatchEnabledChange(viz) {
    window.dispatchEvent(new CustomEvent('radio:visualizer_changed', {
        detail: { enabled: viz.enabled }
    }));
}
