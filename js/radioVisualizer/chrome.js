/** @module {"owns":"visualizer modal chrome: DOM construction, drag/resize/BPM bindings and the popout window lifecycle", "related":["radioVisualizer.js","radioVisualizer/controls.js","radioVisualizer/prefs.js"]} */

import { RadioPlayer } from '../radioPlayer.js';
import { CARD_ICONS, ACTION_ICONS } from '../icons.js';
import { showAppToast } from '../toast.js';
import {
    openBrowserPopup,
    prepareBlankPopoutDocument,
    requestPipWindow,
    shouldUsePipPopout
} from '../popoutWindows.js';
import { registerAppDocument, unregisterAppDocument } from '../appDocuments.js';
import { clamp } from './settings.js';
import { DAY_CYCLE_MS, UNDER_HORIZON_MS } from './sky.js';
import {
    SCENE_HOLD_MS,
    SEA_HOLD_MS,
    SCENE_TRANSITION_MS,
    TRAVEL_SPEED
} from './controls.js';

/**
 * The slice of the RadioVisualizer facade used by the modal chrome. Passed
 * explicitly (rather than imported) so this module never imports the facade —
 * that would close the radioVisualizer.js ↔ radioPlayer.js cycle.
 *
 * @typedef {object} VisualizerHost
 * @property {object|null} modal
 * @property {HTMLCanvasElement|null} canvas
 * @property {number|null} canvasHeight
 * @property {number|null} panelWidth
 * @property {object|null} savedDockRect
 * @property {object} settings
 * @property {boolean} enabled
 * @property {boolean} analysisLive
 * @property {boolean} analysisBlocked
 * @property {boolean} settingsOpen
 * @property {boolean} detailsOpen
 * @property {boolean} chromeMinimal
 * @property {boolean} poppedOut
 * @property {boolean} _prefsLoaded
 * @property {Window|null} popoutWindow
 * @property {Document|null} popoutDoc
 * @property {function|null} popoutOnKey
 * @property {function|null} popoutOnPageHide
 * @property {number|null} rafId
 * @property {number[]} tapBpmTimes
 * @property {number} tapBpmLastTime
 * @property {function(): object} ensureModal
 * @property {function(): void} loadStoredPrefs
 * @property {function(): void} saveStoredPrefs
 * @property {function(HTMLCanvasElement): void} setCanvas
 * @property {function(HTMLAudioElement=): void} setMediaElement
 * @property {function(object, object=): void} setSettings
 * @property {function(object): void} applyStoredSettingsToControls
 * @property {function(object): void} applyStoredLayout
 * @property {function(): void} syncControlLabels
 * @property {function(): void} updateStatus
 * @property {function(): void} resizeCanvas
 * @property {function(): void} drawIdleFrame
 * @property {function(boolean, HTMLAudioElement=): Promise<void>} toggle
 */

const VISUALIZER_POPOUT_NAME = 'magiclists-radio-visualizer';

/** Compact Neon Mountains recipe (full impl is much larger). */
const NEON_MOUNTAINS_RECIPE = `// Neon Mountains — randomizer recipe
const DAY_CYCLE_MS = ${DAY_CYCLE_MS};      // sun/moon/sky (fixed)
const UNDER_HORIZON_MS = ${UNDER_HORIZON_MS}; // pause under left horizon
const SCENE_HOLD_MS = ${SCENE_HOLD_MS};    // land hold @ Travel 1×
const SEA_HOLD_MS = ${SEA_HOLD_MS};        // sea hold @ Travel 1×
const SCENE_TRANSITION_MS = ${SCENE_TRANSITION_MS}; // fade-to-black cut
const TRAVEL_SPEED = ${TRAVEL_SPEED};      // screens/sec @ Travel 1×
const SCENES = ['cactus', 'forest'];       // shuffle, then sea

// Travel slider (0.25–1.25):
//   scrollSpeed  = TRAVEL_SPEED * travel
//   sceneHold    = SCENE_HOLD_MS / travel
//   seaHold      = SEA_HOLD_MS / travel
//   fadeDuration = SCENE_TRANSITION_MS / travel

loop:
  sky  = blend(night → dawn → day → sunset → dusk → night)
  sun  = arc right→left, then ${UNDER_HORIZON_MS / 1000}s under horizon
  moon = same after sun, then under horizon
  land = mountain ridges + cactus|forest decor (scroll left)
  every sceneHold: fade→black→fade into next
  after cactus+forest pass: sea ${SEA_HOLD_MS / 1000}s @ 1×
    sparse encounters: sailboat | ship | surfer
  birds every ~9–23s (V / gull / dart)
`;

/** @param {VisualizerHost} viz */
export function ensureModal(viz) {
    if (viz.modal) return viz.modal;

    if (!viz._prefsLoaded) {
        viz.loadStoredPrefs();
        viz._prefsLoaded = true;
    }

    const modal = document.createElement('div');
    modal.className = 'media-visualizer-modal is-hidden';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'false');
    modal.setAttribute('aria-label', 'Media visualizer');
    modal.innerHTML = `
        <div class="media-visualizer-modal__dialog">
            <div class="media-visualizer-modal__header tool-panel__header" data-media-visualizer-drag>
                <span class="media-visualizer-modal__icon tool-panel__icon" aria-hidden="true">${ACTION_ICONS.radioVisualizer}</span>
                <span class="media-visualizer-modal__title tool-panel__title">Radio visualizer</span>
                <span class="tool-panel__spacer"></span>
                <div class="media-visualizer-modal__actions tool-panel__actions">
                    <button type="button" class="card-act card-act--collapse media-visualizer-modal__minimize" data-media-visualizer-minimize title="Minimal view" aria-label="Minimal view">${CARD_ICONS.collapse}</button>
                    <button type="button" class="card-act card-act--popout media-visualizer-modal__popout" data-media-visualizer-popout title="Pop out" aria-label="Pop out">${CARD_ICONS.popout}</button>
                    <button type="button" class="card-act media-visualizer-modal__close" data-media-visualizer-close title="Close" aria-label="Close visualizer">${CARD_ICONS.close}</button>
                </div>
            </div>
            <div class="media-visualizer-modal__body">
                <canvas class="media-visualizer-modal__canvas" data-media-visualizer-canvas aria-label="Media visualizer canvas"></canvas>
                <button type="button" class="btn btn--compact btn-icon media-visualizer-modal__settings-toggle" data-media-visualizer-settings-toggle aria-expanded="true" aria-label="Hide settings" title="Hide settings">
                        <svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true">
                            <path d="M2 3.4h8M2 6h8M2 8.6h8" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>
                            <circle cx="4.6" cy="3.4" r="1" fill="none" stroke="currentColor" stroke-width="0.8"/>
                            <circle cx="7.4" cy="6" r="1" fill="none" stroke="currentColor" stroke-width="0.8"/>
                            <circle cx="4.6" cy="8.6" r="1" fill="none" stroke="currentColor" stroke-width="0.8"/>
                        </svg>
                    </button>
                <div class="media-visualizer-modal__settings" data-media-visualizer-settings>
                    <p class="media-visualizer-modal__status" data-media-visualizer-status data-state="pending"></p>
                    <div class="media-visualizer-modal__controls">
                    <label class="media-visualizer-modal__field">
                        <span>Style</span>
                        <select class="form-input radio-special-form__select" data-media-visualizer-mode>
                            <option value="mountains">Neon Mountains</option>
                            <option value="sky">Neon Sky</option>
                            <option value="auroraBands">Aurora Bands</option>
                            <option value="spaceTrip">Space Trip</option>
                            <option value="bars">Bars</option>
                            <option value="waveform">Wave</option>
                            <option value="particles">Particles</option>
                            <option value="rings">Rings</option>
                            <option value="orb">Orb</option>
                            <option value="spiral">Spiral</option>
                        </select>
                    </label>
                    <label class="media-visualizer-modal__field">
                        <span>Palette</span>
                        <select class="form-input radio-special-form__select" data-media-visualizer-palette>
                            <option value="horizon" selected>Horizon</option>
                            <option value="neon">Neon</option>
                            <option value="vapor">Vapor</option>
                            <option value="sunset">Sunset</option>
                            <option value="aurora">Aurora</option>
                            <option value="mono">Mono</option>
                            <option value="ocean">Ocean</option>
                            <option value="dark-ocean">Dark Ocean</option>
                            <option value="night-sky">Night Sky</option>
                        </select>
                    </label>
                    <label class="media-visualizer-modal__field media-visualizer-modal__field--range">
                        <span>Sensitivity</span>
                        <input type="range" min="0.5" max="2.5" step="0.1" value="1.0" data-media-visualizer-sensitivity>
                    </label>
                    <label class="media-visualizer-modal__field media-visualizer-modal__field--range">
                        <span data-media-visualizer-amplitude-label>Amplitude: 0.55</span>
                        <input type="range" min="0.15" max="1.5" step="0.05" value="0.55" data-media-visualizer-amplitude>
                    </label>
                    <label class="media-visualizer-modal__field media-visualizer-modal__field--range">
                        <span data-media-visualizer-travel-label>Travel: 0.55×</span>
                        <input type="range" min="0.25" max="1.25" step="0.05" value="0.55" data-media-visualizer-travel title="Scroll + scenery pace">
                    </label>
                    <label class="media-visualizer-modal__field media-visualizer-modal__field--range media-visualizer-modal__bpm-field">
                        <span class="media-visualizer-modal__bpm-label-row">
                            <span data-media-visualizer-bpm-label>BPM: 120</span>
                            <button type="button" class="btn btn--compact media-visualizer-modal__bpm-snap" data-media-visualizer-bpm-snap title="Tap along with the beat to set BPM" aria-label="Tap along with the beat to set BPM">○</button>
                        </span>
                        <input type="range" min="10" max="200" step="1" value="120" data-media-visualizer-bpm>
                    </label>
                    <button type="button" class="media-visualizer-modal__details-toggle" data-media-visualizer-details-toggle aria-expanded="false" style="margin-top: 0.35rem;">
                        Show randomizer details
                    </button>
                    <div class="media-visualizer-modal__details" data-media-visualizer-details hidden>
                        <div class="media-visualizer-modal__legend" data-media-visualizer-legend>
                            <span class="media-visualizer-modal__legend-title">Neon Mountains randomizer</span>
                            <ul>
                                <li>Day / night cycle: ${DAY_CYCLE_MS / 1000}s (fixed, not tied to Travel)</li>
                                <li>Sky: night → dawn → day → sunset → dusk → night (full vault)</li>
                                <li>Travel slider: scroll speed + scenery hold/fade together</li>
                                <li>Cactus / Forest: ~${SCENE_HOLD_MS / 1000}s at 1× (longer when Travel is slower)</li>
                                <li>Sea interlude: ~${SEA_HOLD_MS / 1000}s at 1×</li>
                                <li>Scene handoff: fade to black ~${SCENE_TRANSITION_MS / 1000}s at 1×</li>
                                <li>Sea encounters (sparse): sailboat, ship, surfer</li>
                                <li>Birds: every ~9–23s (V / gull / dart)</li>
                            </ul>
                        </div>
                        <pre class="media-visualizer-modal__recipe" data-media-visualizer-recipe>${NEON_MOUNTAINS_RECIPE.replace(/</g, '&lt;')}</pre>
                    </div>
                </div>
            </div>
            <div class="media-visualizer-modal__chrome-overlay" data-media-visualizer-chrome-overlay hidden>
                <button type="button" class="card-act card-act--collapse media-visualizer-modal__expand" data-media-visualizer-expand title="Show controls" aria-label="Show controls">${CARD_ICONS.expand}</button>
                <button type="button" class="card-act card-act--popout media-visualizer-modal__popout" data-media-visualizer-popout title="Pop out" aria-label="Pop out">${CARD_ICONS.popout}</button>
                <button type="button" class="card-act media-visualizer-modal__close" data-media-visualizer-close title="Close" aria-label="Close visualizer">${CARD_ICONS.close}</button>
            </div>
            <div class="media-visualizer-modal__resize" data-media-visualizer-resize title="Resize" aria-hidden="true"></div>
        </div>
    `;

    modal.querySelectorAll('[data-media-visualizer-close]').forEach((closeBtn) => {
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            viz.toggle(false);
        });
    });

    const modeEl = modal.querySelector('[data-media-visualizer-mode]');
    const paletteEl = modal.querySelector('[data-media-visualizer-palette]');
    const sensitivityEl = modal.querySelector('[data-media-visualizer-sensitivity]');
    const amplitudeEl = modal.querySelector('[data-media-visualizer-amplitude]');
    const travelEl = modal.querySelector('[data-media-visualizer-travel]');
    const bpmEl = modal.querySelector('[data-media-visualizer-bpm]');
    const detailsToggle = modal.querySelector('[data-media-visualizer-details-toggle]');
    bindBpmSnap(viz, modal);
    bindModalDrag(viz, modal);
    bindSettingsToggle(viz, modal);
    bindChromeActions(viz, modal);
    const detailsEl = modal.querySelector('[data-media-visualizer-details]');
    const canvas = modal.querySelector('[data-media-visualizer-canvas]');
    if (canvas) {
        viz.setCanvas(canvas);
    }

    const syncDetails = () => {
        const open = !!viz.detailsOpen;
        if (detailsEl) {
            detailsEl.hidden = !open;
            detailsEl.classList.toggle('is-open', open);
        }
        if (detailsToggle) {
            detailsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            detailsToggle.textContent = open ? 'Hide randomizer details' : 'Show randomizer details';
        }
        modal.classList.toggle('has-details-open', open);
    };
    detailsToggle?.addEventListener('click', () => {
        viz.detailsOpen = !viz.detailsOpen;
        syncDetails();
        viz.saveStoredPrefs();
    });
    syncDetails();

    const applySettings = () => {
        viz.setSettings({
            mode: modeEl?.value || 'mountains',
            palette: paletteEl?.value || 'horizon',
            sensitivity: sensitivityEl?.value || 1.0,
            amplitude: amplitudeEl?.value || 0.55,
            travel: travelEl?.value || 0.55,
            bpm: bpmEl?.value || 120
        });
    };
    modeEl?.addEventListener('change', applySettings);
    paletteEl?.addEventListener('change', applySettings);
    sensitivityEl?.addEventListener('input', applySettings);
    amplitudeEl?.addEventListener('input', applySettings);
    travelEl?.addEventListener('input', applySettings);
    bpmEl?.addEventListener('input', applySettings);

    bindPanelResize(viz, modal);

    viz.applyStoredSettingsToControls(modal);
    viz.applyStoredLayout(modal);

    const settingsEl = modal.querySelector('[data-media-visualizer-settings]');
    const settingsToggle = modal.querySelector('[data-media-visualizer-settings-toggle]');
    if (settingsEl) settingsEl.classList.toggle('is-collapsed', !viz.settingsOpen);
    if (settingsToggle) {
        settingsToggle.setAttribute('aria-expanded', viz.settingsOpen ? 'true' : 'false');
        settingsToggle.setAttribute('aria-label', viz.settingsOpen ? 'Hide settings' : 'Show settings');
        settingsToggle.setAttribute('title', viz.settingsOpen ? 'Hide settings' : 'Show settings');
    }

    document.body.appendChild(modal);
    viz.modal = modal;
    syncChromeMode(viz);
    return modal;
}

/** @param {VisualizerHost} viz */
export function bindModalDrag(viz, modal) {
    let startX, startY, startLeft, startTop;
    let dragging = false;

    const isInteractive = (target) => target?.closest(
        'button, input, select, textarea, a, [role="button"], [data-media-visualizer-resize], [data-media-visualizer-settings-toggle], [data-media-visualizer-details-toggle], [data-media-visualizer-chrome-overlay], .tool-panel__actions'
    );

    const onDragStart = (e) => {
        if (viz.poppedOut) return;
        if (e.button !== undefined && e.button !== 0) return; // left button only
        if (isInteractive(e.target)) return;
        dragging = true;
        startX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
        startY = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
        const rect = modal.getBoundingClientRect();
        startLeft = rect.left;
        startTop = rect.top;
        modal.classList.add('is-dragging');
        if (e.cancelable) e.preventDefault();
    };

    const onDrag = (e) => {
        if (!dragging) return;
        const ownerWin = modal.ownerDocument?.defaultView || window;
        const x = e.clientX ?? e.touches?.[0]?.clientX;
        const y = e.clientY ?? e.touches?.[0]?.clientY;
        if (x === undefined || y === undefined) return;
        const dx = x - startX;
        const dy = y - startY;
        const margin = 8;
        const newLeft = clamp(startLeft + dx, margin, Math.max(margin, ownerWin.innerWidth - 320));
        const newTop = clamp(startTop + dy, margin, Math.max(margin, ownerWin.innerHeight - 60));
        modal.style.left = `${newLeft}px`;
        modal.style.top = `${newTop}px`;
    };

    const onDragEnd = () => {
        if (!dragging) return;
        dragging = false;
        modal.classList.remove('is-dragging');
        viz.saveStoredPrefs();
    };

    modal.addEventListener('mousedown', onDragStart);
    modal.addEventListener('touchstart', onDragStart, { passive: false });
    window.addEventListener('mousemove', onDrag);
    window.addEventListener('touchmove', onDrag, { passive: true });
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchend', onDragEnd);
    window.addEventListener('blur', onDragEnd);
}

/** @param {VisualizerHost} viz */
export function bindBpmSnap(viz, modal) {
    const bpmSnapBtn = modal.querySelector('[data-media-visualizer-bpm-snap]');
    if (!bpmSnapBtn) return;

    const applyTapBpm = () => {
        const bpmSlider = modal.querySelector('[data-media-visualizer-bpm]');
        const bpmLabel = modal.querySelector('[data-media-visualizer-bpm-label]');
        if (bpmSlider) bpmSlider.value = String(viz.settings.bpm);
        if (bpmLabel) bpmLabel.textContent = `BPM: ${viz.settings.bpm}`;
    };

    bpmSnapBtn.addEventListener('click', () => {
        const now = performance.now();
        const sinceLast = viz.tapBpmLastTime ? now - viz.tapBpmLastTime : 0;

        // First tap or a long gap (>3s) starts a fresh cycle
        if (!viz.tapBpmLastTime || sinceLast > 3000) {
            viz.tapBpmTimes = [];
        } else if (sinceLast >= 250) {
            // Record the interval between this tap and the previous one.
            // Second tap already yields BPM from this single interval;
            // later taps average the last 2-3 consecutive beat intervals.
            viz.tapBpmTimes.push(sinceLast);
            if (viz.tapBpmTimes.length > 3) viz.tapBpmTimes.shift();

            const avgInterval = viz.tapBpmTimes.reduce((a, b) => a + b, 0) / viz.tapBpmTimes.length;
            const bpm = Math.round(60000 / avgInterval);
            viz.settings.bpm = clamp(bpm, 10, 200);
            applyTapBpm();
        }

        viz.tapBpmLastTime = now;

        // Tap pulse feedback — button stays ○, never toggles
        bpmSnapBtn.style.transform = 'scale(0.85)';
        requestAnimationFrame(() => requestAnimationFrame(() => {
            bpmSnapBtn.style.transform = '';
        }));
    });
}

/** @param {VisualizerHost} viz */
export function bindPanelResize(viz, modal) {
    const handle = modal.querySelector('[data-media-visualizer-resize]');
    const canvas = modal.querySelector('[data-media-visualizer-canvas]');
    if (!handle || !canvas) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    const onMove = (event) => {
        if (!dragging) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        const nextW = clamp(startW + dx, 320, Math.min(window.innerWidth - 16, 1100));
        const nextH = clamp(startH + dy, 120, Math.min(window.innerHeight * 0.7, 560));
        viz.panelWidth = nextW;
        viz.canvasHeight = nextH;
        modal.style.width = `${nextW}px`;
        canvas.style.height = `${nextH}px`;
        viz.resizeCanvas();
    };

    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        viz.saveStoredPrefs();
    };

    handle.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        event.stopPropagation();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startW = modal.getBoundingClientRect().width;
        startH = canvas.getBoundingClientRect().height;
        handle.setPointerCapture?.(event.pointerId);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });
}

/** @param {VisualizerHost} viz */
export function openModal(viz, { title = 'Radio visualizer', mediaElement = viz.mediaElement || RadioPlayer?.getAudioElement?.() } = {}) {
    const modal = ensureModal(viz);
    viz.setMediaElement(mediaElement);
    const titleEl = modal.querySelector('.media-visualizer-modal__title');
    if (titleEl) titleEl.textContent = title;
    modal.classList.remove('is-hidden');
    modal.setAttribute('aria-label', title);
    const canvas = modal.querySelector('[data-media-visualizer-canvas]');
    if (canvas) viz.setCanvas(canvas);
    viz.syncControlLabels();
    syncChromeMode(viz);
    viz.updateStatus();
    return modal;
}

/** @param {VisualizerHost} viz */
export function closeModal(viz) {
    viz.enabled = false;
    if (viz.poppedOut) {
        popIn(viz);
    }
    if (viz.rafId) {
        cancelAnimationFrame(viz.rafId);
        viz.rafId = null;
    }
    if (viz.modal) {
        viz.modal.classList.add('is-hidden');
    }
    viz.analysisLive = false;
    viz.analysisBlocked = false;
    viz.energyHistory = [];
    viz.silenceSince = null;
    viz.updateStatus();
    if (viz.canvas) {
        viz.drawIdleFrame();
    }
    viz.saveStoredPrefs();
}

/** @param {VisualizerHost} viz */
export function bindSettingsToggle(viz, modal) {
    const toggleBtn = modal.querySelector('[data-media-visualizer-settings-toggle]');
    const settingsEl = modal.querySelector('[data-media-visualizer-settings]');
    if (!toggleBtn || !settingsEl) return;

    const sync = () => {
        const open = !!viz.settingsOpen;
        toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        toggleBtn.setAttribute('aria-label', open ? 'Hide settings' : 'Show settings');
        toggleBtn.setAttribute('title', open ? 'Hide settings' : 'Show settings');
        settingsEl.classList.toggle('is-collapsed', !open);
    };

    toggleBtn.addEventListener('click', () => {
        viz.settingsOpen = !viz.settingsOpen;
        sync();
        viz.saveStoredPrefs();
    });

    sync();
}

/** @param {VisualizerHost} viz */
export function syncChromeMode(viz) {
    const modal = viz.modal;
    if (!modal) return;

    modal.classList.toggle('is-minimal', !!viz.chromeMinimal);

    const overlay = modal.querySelector('[data-media-visualizer-chrome-overlay]');
    if (overlay) {
        overlay.hidden = !viz.chromeMinimal;
    }

    const minimizeBtn = modal.querySelector('[data-media-visualizer-minimize]');
    if (minimizeBtn) {
        minimizeBtn.hidden = !!viz.chromeMinimal;
    }

    syncPopoutButtons(viz);
}

/** @param {VisualizerHost} viz */
export function syncPopoutButtons(viz) {
    const modal = viz.modal;
    if (!modal) return;
    const label = viz.poppedOut ? 'Pop in' : 'Pop out';
    const icon = viz.poppedOut ? CARD_ICONS.popoutExit : CARD_ICONS.popout;
    modal.querySelectorAll('[data-media-visualizer-popout]').forEach((btn) => {
        btn.innerHTML = icon;
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.classList.toggle('is-active', viz.poppedOut);
    });
}

/** @param {VisualizerHost} viz */
export function bindChromeActions(viz, modal) {
    modal.querySelector('[data-media-visualizer-minimize]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        viz.chromeMinimal = true;
        viz.settingsOpen = false;
        const settingsEl = modal.querySelector('[data-media-visualizer-settings]');
        const toggleBtn = modal.querySelector('[data-media-visualizer-settings-toggle]');
        if (settingsEl) settingsEl.classList.add('is-collapsed');
        if (toggleBtn) {
            toggleBtn.setAttribute('aria-expanded', 'false');
            toggleBtn.setAttribute('aria-label', 'Show settings');
            toggleBtn.setAttribute('title', 'Show settings');
        }
        syncChromeMode(viz);
        viz.resizeCanvas();
        viz.saveStoredPrefs();
    });

    modal.querySelector('[data-media-visualizer-expand]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        viz.chromeMinimal = false;
        syncChromeMode(viz);
        viz.resizeCanvas();
        viz.saveStoredPrefs();
    });

    modal.querySelectorAll('[data-media-visualizer-popout]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (viz.poppedOut) popIn(viz);
            else popOut(viz);
        });
    });
}

/** @param {VisualizerHost} viz */
export function saveDockRect(viz) {
    if (!viz.modal || viz.poppedOut) return;
    const rect = viz.modal.getBoundingClientRect();
    const canvas = viz.modal.querySelector('[data-media-visualizer-canvas]');
    viz.savedDockRect = {
        left: rect.left,
        top: rect.top,
        width: viz.panelWidth || rect.width,
        canvasHeight: viz.canvasHeight || canvas?.getBoundingClientRect().height || 200
    };
    viz.saveStoredPrefs();
}

/** @param {VisualizerHost} viz */
export function restoreDockRect(viz) {
    if (!viz.modal || !viz.savedDockRect) return;
    const { left, top, width, canvasHeight } = viz.savedDockRect;
    viz.modal.style.left = `${left}px`;
    viz.modal.style.top = `${top}px`;
    viz.modal.style.width = `${width}px`;
    const canvas = viz.modal.querySelector('[data-media-visualizer-canvas]');
    if (canvas && canvasHeight) {
        canvas.style.height = `${canvasHeight}px`;
        viz.canvasHeight = canvasHeight;
    }
    viz.panelWidth = width;
    viz.resizeCanvas();
}

/** @param {VisualizerHost} viz */
export async function popOut(viz) {
    if (!viz.modal || viz.poppedOut) {
        try { viz.popoutWindow?.focus(); } catch { /* ignore */ }
        return;
    }

    saveDockRect(viz);
    const rect = viz.modal.getBoundingClientRect();
    const w = Math.max(480, Math.round(rect.width));
    const h = Math.max(320, Math.round(rect.height));

    const onPageHide = () => {
        if (viz.poppedOut) popIn(viz, { fromExternalClose: true });
    };

    let win = null;

    if (shouldUsePipPopout()) {
        win = await requestPipWindow({
            width: w,
            height: h,
            owner: { type: 'visualizer', id: 'radio' },
            onPageHide
        });
    }

    if (!win) {
        win = openBrowserPopup('about:blank', VISUALIZER_POPOUT_NAME, w, h);
        if (!win) {
            showAppToast('Could not open visualizer popout window');
            return;
        }
        win.addEventListener('pagehide', onPageHide);
        prepareBlankPopoutDocument(win, 'media-visualizer-popout-body');
    }

    const popDoc = win.document;
    registerAppDocument(popDoc);

    popDoc.body.appendChild(viz.modal);
    viz.modal.classList.add('is-popout-live');
    viz.modal.style.left = '0';
    viz.modal.style.top = '0';
    viz.modal.style.width = '100%';
    viz.modal.style.height = '100%';

    const onKey = (e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        popIn(viz);
    };
    popDoc.addEventListener('keydown', onKey);

    viz.poppedOut = true;
    viz.popoutWindow = win;
    viz.popoutDoc = popDoc;
    viz.popoutOnKey = onKey;
    viz.popoutOnPageHide = onPageHide;
    syncPopoutButtons(viz);
    viz.resizeCanvas();

    try { win.focus(); } catch { /* ignore */ }
}

/** @param {VisualizerHost} viz */
export function popIn(viz, { fromExternalClose = false } = {}) {
    if (!viz.modal || !viz.poppedOut) return;

    const popDoc = viz.popoutDoc;
    if (viz.popoutOnKey && popDoc) {
        popDoc.removeEventListener('keydown', viz.popoutOnKey);
    }
    if (!fromExternalClose && viz.popoutWindow && !viz.popoutWindow.closed) {
        try { viz.popoutWindow.close(); } catch { /* ignore */ }
    }

    if (popDoc && popDoc !== document) {
        unregisterAppDocument(popDoc);
    }

    viz.modal.classList.remove('is-popout-live');
    viz.modal.style.left = '';
    viz.modal.style.top = '';
    viz.modal.style.width = '';
    viz.modal.style.height = '';
    document.body.appendChild(viz.modal);

    viz.poppedOut = false;
    viz.popoutWindow = null;
    viz.popoutDoc = null;
    viz.popoutOnKey = null;
    viz.popoutOnPageHide = null;

    restoreDockRect(viz);
    viz.savedDockRect = null;
    syncPopoutButtons(viz);
    syncChromeMode(viz);
    viz.resizeCanvas();
    viz.saveStoredPrefs();
}
