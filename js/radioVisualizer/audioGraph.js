/** @module {"owns":"radio visualizer Web Audio analyser graph lifecycle", "related":["radioVisualizer.js","radioPlayer.js"]} */

import { RadioPlayer } from '../radioPlayer.js';

/**
 * The slice of the RadioVisualizer facade these helpers read and write. Passed
 * explicitly (rather than importing the facade) to avoid the
 * radioVisualizer.js ↔ radioPlayer.js import cycle.
 *
 * @typedef {object} VisualizerHost
 * @property {AudioContext|null} audioContext
 * @property {AnalyserNode|null} analyser
 * @property {MediaElementAudioSourceNode|null} source
 * @property {HTMLAudioElement|null} mediaElement
 * @property {boolean} analysisLive
 * @property {boolean} analysisBlocked
 * @property {boolean} enabled
 * @property {function(): void} updateStatus
 * @property {function(): void} start
 */

/** @param {VisualizerHost} viz */
export function ensureAudioGraph(viz, mediaElement = viz.mediaElement || RadioPlayer?.getAudioElement?.()) {
    const audio = mediaElement || RadioPlayer?.getAudioElement?.() || RadioPlayer?.audio;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!audio || !Ctx) return false;

    // Never attach MediaElementSource to a non-CORS stream — that taints
    // the element (analyser zeroes warning) and breaks later resume.
    if (!RadioPlayer.loadedWithCors || audio.crossOrigin !== 'anonymous') {
        return false;
    }

    if (viz.source && viz.source.mediaElement && viz.source.mediaElement !== audio) {
        releaseGraph(viz);
    }

    if (!viz.audioContext) {
        viz.audioContext = new Ctx();
    }

    if (!viz.source) {
        try {
            viz.analyser = viz.audioContext.createAnalyser();
            viz.analyser.fftSize = 2048;
            viz.analyser.smoothingTimeConstant = 0.82;
            viz.source = viz.audioContext.createMediaElementSource(audio);
            viz.source.connect(viz.analyser);
            viz.analyser.connect(viz.audioContext.destination);
        } catch {
            viz.analyser = null;
            viz.source = null;
            return false;
        }
    }

    if (viz.audioContext.state === 'suspended') {
        viz.audioContext.resume().catch(() => {});
    }
    return !!viz.analyser;
}

/** @param {VisualizerHost} viz */
export function hasMediaElementSource(viz) {
    return !!viz.source;
}

/** @param {VisualizerHost} viz */
export function releaseGraph(viz) {
    try { viz.source?.disconnect(); } catch {}
    try { viz.analyser?.disconnect(); } catch {}
    viz.source = null;
    viz.analyser = null;
    viz.mediaElement = null;
    viz.analysisLive = false;
}

/** @param {VisualizerHost} viz */
export async function resumeContext(viz) {
    if (!viz.audioContext) return;
    if (viz.audioContext.state === 'suspended') {
        try { await viz.audioContext.resume(); } catch {}
    }
}

/** @param {VisualizerHost} viz */
export async function recoverPoisonedGraph(viz) {
    if (!viz.source || RadioPlayer.loadedWithCors) return false;
    RadioPlayer.markAnalysisCorsFailed();
    viz.analysisBlocked = true;
    viz.analysisLive = false;
    const wasEnabled = viz.enabled;
    const recovered = await RadioPlayer.resetAudioElementAndPlay();
    viz.mediaElement = RadioPlayer.getAudioElement();
    // Graph refs already cleared by reset; stay on BPM-only
    releaseGraph(viz);
    viz.updateStatus();
    if (wasEnabled) viz.start();
    return recovered;
}
