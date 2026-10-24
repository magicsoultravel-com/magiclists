/** @module {"owns":"radio visualizer settings/ui/layout persistence", "related":["radioVisualizer.js","radioVisualizer/settings.js"]} */

import { readVisualizerPrefs, writeVisualizerPrefs, clamp } from './settings.js';

/**
 * The slice of the RadioVisualizer facade these helpers read and write. Passed
 * explicitly (rather than importing the facade) to avoid the
 * radioVisualizer.js ↔ radioPlayer.js import cycle.
 *
 * @typedef {object} VisualizerHost
 * @property {object} settings
 * @property {boolean} settingsOpen
 * @property {boolean} chromeMinimal
 * @property {boolean} detailsOpen
 * @property {boolean} enabled
 * @property {object|null} modal
 * @property {object|null} savedDockRect
 * @property {object|null} _storedLayout
 * @property {number|null} panelWidth
 * @property {number|null} canvasHeight
 * @property {function(object, object=): void} setSettings
 * @property {function(): void} resizeCanvas
 * @property {function(): void} syncControlLabels
 */

/** @param {VisualizerHost} viz */
export function loadStoredPrefs(viz) {
    const stored = readVisualizerPrefs();
    if (stored.settings && typeof stored.settings === 'object') {
        viz.setSettings(stored.settings, { persist: false });
    }
    if (stored.ui && typeof stored.ui === 'object') {
        if (typeof stored.ui.settingsOpen === 'boolean') viz.settingsOpen = stored.ui.settingsOpen;
        if (typeof stored.ui.chromeMinimal === 'boolean') viz.chromeMinimal = stored.ui.chromeMinimal;
        if (typeof stored.ui.detailsOpen === 'boolean') viz.detailsOpen = stored.ui.detailsOpen;
    }
    if (stored.layout && typeof stored.layout === 'object') {
        viz._storedLayout = stored.layout;
    }
}

/** @param {VisualizerHost} viz */
export function saveStoredPrefs(viz) {
    writeVisualizerPrefs({
        settings: { ...viz.settings },
        ui: {
            settingsOpen: !!viz.settingsOpen,
            chromeMinimal: !!viz.chromeMinimal,
            detailsOpen: !!viz.detailsOpen
        },
        layout: getLayoutPrefs(viz),
        open: !!viz.enabled
    });
}

/** @param {VisualizerHost} viz */
export function getLayoutPrefs(viz) {
    if (viz.savedDockRect) {
        return { ...viz.savedDockRect };
    }
    if (!viz.modal) {
        return viz._storedLayout || {};
    }
    const canvas = viz.modal.querySelector('[data-media-visualizer-canvas]');
    const rect = viz.modal.getBoundingClientRect();
    const left = Number.parseFloat(viz.modal.style.left);
    const top = Number.parseFloat(viz.modal.style.top);
    return {
        left: Number.isFinite(left) ? left : rect.left,
        top: Number.isFinite(top) ? top : rect.top,
        width: viz.panelWidth || rect.width,
        canvasHeight: viz.canvasHeight || canvas?.getBoundingClientRect().height || 200
    };
}

/** @param {VisualizerHost} viz @param {object} modal */
export function applyStoredLayout(viz, modal) {
    const layout = viz._storedLayout;
    if (!layout || !modal) return;

    const canvas = modal.querySelector('[data-media-visualizer-canvas]');
    const width = clamp(Number(layout.width) || 720, 320, 1100);
    const canvasHeight = clamp(Number(layout.canvasHeight) || 200, 120, 560);
    const margin = 8;
    const leftRaw = Number(layout.left);
    const topRaw = Number(layout.top);
    const left = Number.isFinite(leftRaw)
        ? clamp(leftRaw, margin, Math.max(margin, window.innerWidth - 320))
        : null;
    const top = Number.isFinite(topRaw)
        ? clamp(topRaw, margin, Math.max(margin, window.innerHeight - 60))
        : null;

    modal.style.width = `${width}px`;
    if (left != null) modal.style.left = `${left}px`;
    if (top != null) modal.style.top = `${top}px`;
    if (canvas) canvas.style.height = `${canvasHeight}px`;
    viz.panelWidth = width;
    viz.canvasHeight = canvasHeight;
    viz.resizeCanvas();
}

/** @param {VisualizerHost} viz @param {object} modal */
export function applyStoredSettingsToControls(viz, modal) {
    const modeEl = modal.querySelector('[data-media-visualizer-mode]');
    const paletteEl = modal.querySelector('[data-media-visualizer-palette]');
    const sensitivityEl = modal.querySelector('[data-media-visualizer-sensitivity]');
    const amplitudeEl = modal.querySelector('[data-media-visualizer-amplitude]');
    const travelEl = modal.querySelector('[data-media-visualizer-travel]');
    const bpmEl = modal.querySelector('[data-media-visualizer-bpm]');

    if (modeEl) modeEl.value = viz.settings.mode;
    if (paletteEl) paletteEl.value = viz.settings.palette;
    if (sensitivityEl) sensitivityEl.value = String(viz.settings.sensitivity);
    if (amplitudeEl) amplitudeEl.value = String(viz.settings.amplitude);
    if (travelEl) travelEl.value = String(viz.settings.travel);
    if (bpmEl) bpmEl.value = String(viz.settings.bpm);
    viz.syncControlLabels();
}
