import { RadioPlayer } from './radioPlayer.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { showAppToast } from './toast.js';
import {
    openBrowserPopup,
    prepareBlankPopoutDocument,
    requestPipWindow,
    shouldUsePipPopout
} from './popoutWindows.js';
import { registerAppDocument, unregisterAppDocument } from './appDocuments.js';

const VISUALIZER_POPOUT_NAME = 'magiclists-radio-visualizer';
const VISUALIZER_PREFS_KEY = 'matrix_radio_visualizer_prefs';

const SPACE_CRUISE_MS = 60_000;
const SPACE_HYPER_ENGAGE_MS = 5_500;
const SPACE_HYPER_TRAVEL_MS = 30_000;
const SPACE_HYPER_DISENGAGE_MS = 5_500;
const SPACE_HYPER_CYCLE_MS = SPACE_CRUISE_MS + SPACE_HYPER_ENGAGE_MS + SPACE_HYPER_TRAVEL_MS + SPACE_HYPER_DISENGAGE_MS;

const PALETTES = {
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

const DEFAULTS = {
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

const ENERGY_FLOOR = 0.02;
const ENERGY_SILENCE_MS = 1000;
const DAY_CYCLE_MS = 65_000; // independent of travel pace
const UNDER_HORIZON_MS = 5_000;
const SCENE_HOLD_MS = 18_000; // at travel = 1
const SEA_HOLD_MS = 60_000; // at travel = 1
const SCENE_TRANSITION_MS = 3_000; // at travel = 1
const MOUNTAIN_SCENES = ['cactus', 'forest'];
const TRAVEL_SPEED = 0.05; // screens/sec at travel = 1
const FOREST_LEAF = ['#1f4d2e', '#2d6a3e', '#245536', '#3d7a4a', '#4a6b3a'];
const FOREST_TRUNK = '#3b2a1a';
const CACTUS_GREEN = '#4d6b3c';

const SPACE_PLANET_TYPES = ['rocky', 'gas', 'ice', 'ringed', 'binary', 'striped', 'cloudy'];
const SPACE_NEBULA_START_MS = 20_000;
const SPACE_NEBULA_FADE_IN_MS = 4_000;
const SPACE_NEBULA_HOLD_MS = 12_000;
const SPACE_NEBULA_FADE_OUT_MS = 4_000;
const SPACE_NEBULA_END_MS = SPACE_NEBULA_START_MS + SPACE_NEBULA_FADE_IN_MS + SPACE_NEBULA_HOLD_MS + SPACE_NEBULA_FADE_OUT_MS;
const SPACE_EARTH_CRUISE_SPAWN_MS = 38_000;
const HYPER_WALL_COLORS = ['#67e8f9', '#38bdf8', '#a78bfa', '#f472b6', '#fb923c', '#facc15', '#34d399', '#818cf8'];

function readVisualizerPrefs() {
    try {
        return JSON.parse(localStorage.getItem(VISUALIZER_PREFS_KEY) || 'null') || {};
    } catch {
        return {};
    }
}

function writeVisualizerPrefs(data) {
    try {
        localStorage.setItem(VISUALIZER_PREFS_KEY, JSON.stringify(data));
    } catch {
        /* ignore quota */
    }
}

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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function alpha(hex, a) {
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

function pickColor(palette, index) {
    return palette[index % palette.length] || palette[0];
}

function setGlow(ctx, palette, glow) {
    ctx.shadowBlur = 8 + (glow || 0.65) * 18;
    ctx.shadowColor = alpha(palette[0], 0.7);
}

function beatPulse(bpm, now = Date.now()) {
    const tempo = clamp(Number(bpm) || 120, 10, 200);
    const phase = ((now * tempo) / 60000) % 1;
    const envelope = Math.pow(1 - phase, 2.4);
    return { phase, pulse: envelope, tempo };
}

function ampScale(settings) {
    return clamp(Number(settings.amplitude) || 0.55, 0.15, 1.5);
}

function shuffleNoRepeat(items, last) {
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

function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function hexToRgb(hex) {
    if (!hex || !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
        return [255, 255, 255];
    }
    const full = hex.length === 4
        ? hex.split('').map((ch, i) => (i === 0 ? ch : ch + ch)).join('')
        : hex;
    const value = parseInt(full.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbaTuple(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return [r, g, b, a];
}

function lerpTuple(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t
    ];
}

function cssRgba(tuple) {
    return `rgba(${Math.round(tuple[0])}, ${Math.round(tuple[1])}, ${Math.round(tuple[2])}, ${tuple[3]})`;
}

function skyPaletteFrames(palette) {
    const p0 = palette[0];
    const p1 = palette[1];
    const p2 = palette[2];
    const p3 = palette[3] || palette[0];
    const p4 = palette[4] || palette[2];
    // Top-of-sky (stop 0) shifts hard per period so the whole vault changes, not just the horizon
    const night = [
        rgbaTuple('#010208', 1),
        rgbaTuple('#07101f', 1),
        rgbaTuple(p3, 0.28),
        rgbaTuple(p0, 0.1),
        rgbaTuple('#000000', 1)
    ];
    return {
        night,
        dawn: [
            rgbaTuple('#3a1048', 1),
            rgbaTuple(p1, 0.88),
            rgbaTuple(p4, 0.82),
            rgbaTuple(p0, 0.65),
            rgbaTuple('#12081c', 1)
        ],
        day: [
            rgbaTuple('#2a1870', 1),
            rgbaTuple(p3, 0.9),
            rgbaTuple(p0, 0.8),
            rgbaTuple(p1, 0.55),
            rgbaTuple('#0a1028', 1)
        ],
        sunset: [
            rgbaTuple('#6b0a3a', 1),
            rgbaTuple('#ff3d6e', 0.98),
            rgbaTuple('#ff9f1c', 0.95),
            rgbaTuple(p4, 0.88),
            rgbaTuple('#1a060e', 1)
        ],
        dusk: [
            rgbaTuple('#22065a', 1),
            rgbaTuple('#9b2cff', 0.92),
            rgbaTuple(p1, 0.78),
            rgbaTuple(p3, 0.45),
            rgbaTuple('#06020f', 1)
        ]
    };
}

function blendedSkyStops(palette, cycleT) {
    const frames = skyPaletteFrames(palette);
    const keys = [
        { t: 0, name: 'night' },
        { t: 0.08, name: 'dawn' },
        { t: 0.22, name: 'day' },
        { t: 0.42, name: 'day' },
        { t: 0.52, name: 'sunset' },
        { t: 0.62, name: 'dusk' },
        { t: 0.78, name: 'night' },
        { t: 1, name: 'night' }
    ];
    let i = 0;
    while (i < keys.length - 1 && cycleT > keys[i + 1].t) i += 1;
    const a = keys[i];
    const b = keys[i + 1];
    const u = smoothstep(a.t, b.t, cycleT);
    const from = frames[a.name];
    const to = frames[b.name];
    return from.map((stop, idx) => lerpTuple(stop, to[idx], u));
}

function dayCycleState(now, cycleStart) {
    const elapsed = ((now - cycleStart) % DAY_CYCLE_MS + DAY_CYCLE_MS) % DAY_CYCLE_MS;
    const t = elapsed / DAY_CYCLE_MS; // 0..1
    const underFrac = UNDER_HORIZON_MS / DAY_CYCLE_MS;
    // Sun travels right→left, then sits under the left horizon before the night sky takes over
    const sunTravelEnd = 0.52;
    const sunUnderEnd = sunTravelEnd + underFrac;
    let sunArc = 0;
    let sunness = 0;
    if (t < sunTravelEnd) {
        sunArc = t / sunTravelEnd;
        // Soft near-horizon so sky/sun don't snap off
        sunness = clamp(Math.pow(Math.sin(sunArc * Math.PI), 0.85), 0, 1);
    } else if (t < sunUnderEnd) {
        sunArc = 1;
        sunness = 0;
    }

    // Moon rises after sun is under, sets on the left, then also waits under horizon
    const moonTravelStart = sunUnderEnd;
    const moonTravelEnd = 1 - underFrac;
    let moonArc = 0;
    let moonness = 0;
    if (t >= moonTravelStart && t < moonTravelEnd) {
        moonArc = (t - moonTravelStart) / Math.max(0.001, moonTravelEnd - moonTravelStart);
        moonness = clamp(Math.pow(Math.sin(moonArc * Math.PI), 0.85), 0, 1);
    } else if (t >= moonTravelEnd) {
        moonArc = 1;
        moonness = 0;
    }

    // Dramatic wash strength for late day → night (peaks at sunset, eases through dusk)
    const sunsetness = clamp(1 - Math.abs(t - sunTravelEnd) / 0.1, 0, 1);
    const duskness = clamp(1 - Math.abs(t - (sunTravelEnd + 0.1)) / 0.12, 0, 1);

    const dayness = clamp(sunness, 0, 1);
    let period = 'night';
    if (t < 0.22) period = 'dawn';
    else if (t < sunTravelEnd - 0.06) period = 'day';
    else if (t < sunTravelEnd + 0.06) period = 'sunset';
    else if (t < moonTravelStart + 0.1) period = 'dusk';
    return {
        t, period, dayness, sunness, moonness, sunArc, moonArc, elapsed,
        sunsetness, duskness
    };
}

export const RadioVisualizer = {
    enabled: false,
    canvas: null,
    context: null,
    audioContext: null,
    analyser: null,
    source: null,
    mediaElement: null,
    modal: null,
    rafId: null,
    settings: { ...DEFAULTS },
    analysisLive: false,
    analysisBlocked: false,
    energyHistory: [],
    silenceSince: null,
    lastPulse: 0,
    stars: null,
    mountainCycleStart: null,
    mountainScene: null,
    mountainSceneQueue: [],
    mountainSceneStartedAt: 0,
    mountainAwaitSea: false,
    birds: [],
    nextBirdAt: 0,
    travelScroll: 0,
    tapBpmTimes: [],
    tapBpmLastTime: 0,
    _mountainLastNow: null,
    _smoothValues: null,
    _smoothMotion: 0.35,
    sceneTransition: null,
    detailsOpen: false,
    settingsOpen: true,
    chromeMinimal: false,
    poppedOut: false,
    popoutWindow: null,
    popoutDoc: null,
    popoutOnKey: null,
    popoutOnPageHide: null,
    savedDockRect: null,
    spaceTrip: null,
    panelWidth: null,
    canvasHeight: 200,
    _storedLayout: null,
    _prefsLoaded: false,

    loadStoredPrefs() {
        const stored = readVisualizerPrefs();
        if (stored.settings && typeof stored.settings === 'object') {
            this.setSettings(stored.settings, { persist: false });
        }
        if (stored.ui && typeof stored.ui === 'object') {
            if (typeof stored.ui.settingsOpen === 'boolean') this.settingsOpen = stored.ui.settingsOpen;
            if (typeof stored.ui.chromeMinimal === 'boolean') this.chromeMinimal = stored.ui.chromeMinimal;
            if (typeof stored.ui.detailsOpen === 'boolean') this.detailsOpen = stored.ui.detailsOpen;
        }
        if (stored.layout && typeof stored.layout === 'object') {
            this._storedLayout = stored.layout;
        }
    },

    saveStoredPrefs() {
        writeVisualizerPrefs({
            settings: { ...this.settings },
            ui: {
                settingsOpen: !!this.settingsOpen,
                chromeMinimal: !!this.chromeMinimal,
                detailsOpen: !!this.detailsOpen
            },
            layout: this.getLayoutPrefs(),
            open: !!this.enabled
        });
    },

    getLayoutPrefs() {
        if (this.savedDockRect) {
            return { ...this.savedDockRect };
        }
        if (!this.modal) {
            return this._storedLayout || {};
        }
        const canvas = this.modal.querySelector('[data-media-visualizer-canvas]');
        const rect = this.modal.getBoundingClientRect();
        const left = Number.parseFloat(this.modal.style.left);
        const top = Number.parseFloat(this.modal.style.top);
        return {
            left: Number.isFinite(left) ? left : rect.left,
            top: Number.isFinite(top) ? top : rect.top,
            width: this.panelWidth || rect.width,
            canvasHeight: this.canvasHeight || canvas?.getBoundingClientRect().height || 200
        };
    },

    applyStoredLayout(modal) {
        const layout = this._storedLayout;
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
        this.panelWidth = width;
        this.canvasHeight = canvasHeight;
        this.resizeCanvas();
    },

    applyStoredSettingsToControls(modal) {
        const modeEl = modal.querySelector('[data-media-visualizer-mode]');
        const paletteEl = modal.querySelector('[data-media-visualizer-palette]');
        const sensitivityEl = modal.querySelector('[data-media-visualizer-sensitivity]');
        const amplitudeEl = modal.querySelector('[data-media-visualizer-amplitude]');
        const travelEl = modal.querySelector('[data-media-visualizer-travel]');
        const bpmEl = modal.querySelector('[data-media-visualizer-bpm]');

        if (modeEl) modeEl.value = this.settings.mode;
        if (paletteEl) paletteEl.value = this.settings.palette;
        if (sensitivityEl) sensitivityEl.value = String(this.settings.sensitivity);
        if (amplitudeEl) amplitudeEl.value = String(this.settings.amplitude);
        if (travelEl) travelEl.value = String(this.settings.travel);
        if (bpmEl) bpmEl.value = String(this.settings.bpm);
        this.syncControlLabels();
    },

    setCanvas(canvas) {
        this.canvas = canvas;
        this.context = canvas?.getContext('2d') || null;
        if (this.canvas) {
            this.resizeCanvas();
            this.drawIdleFrame();
        }
    },

    setMediaElement(mediaElement) {
        this.mediaElement = mediaElement || RadioPlayer?.getAudioElement?.() || RadioPlayer?.audio || null;
        if (this.source && this.source.mediaElement && this.source.mediaElement !== this.mediaElement) {
            this.releaseGraph();
        }
        if (this.canvas) {
            this.drawIdleFrame();
        }
    },

    setSettings(patch = {}, { persist = true } = {}) {
        const prevMode = this.settings.mode;
        this.settings = { ...this.settings, ...patch };
        this.settings.sensitivity = clamp(Number(this.settings.sensitivity) || 1, 0.35, 2.5);
        this.settings.amplitude = clamp(Number(this.settings.amplitude) || 0.55, 0.15, 1.5);
        this.settings.density = clamp(Number(this.settings.density) || 1, 0.3, 2.2);
        this.settings.speed = clamp(Number(this.settings.speed) || 1, 0.35, 2.5);
        this.settings.travel = clamp(Number(this.settings.travel) || 0.55, 0.25, 1.25);
        this.settings.glow = clamp(Number(this.settings.glow) || 0.65, 0, 1.5);
        this.settings.bpm = clamp(Math.round(Number(this.settings.bpm) || 120), 10, 200);
        if (patch.mode && patch.mode !== prevMode) {
            this.spaceTrip = null;
        }
        this.syncControlLabels();
        if (this.canvas && !this.enabled) {
            this.drawIdleFrame();
        }
        if (persist) this.saveStoredPrefs();
    },

    travelPace() {
        return clamp(Number(this.settings.travel) || 0.55, 0.25, 1.25);
    },

    sceneHoldMs(scene) {
        const base = scene === 'sea' ? SEA_HOLD_MS : SCENE_HOLD_MS;
        return base / this.travelPace();
    },

    sceneTransitionMs() {
        return SCENE_TRANSITION_MS / this.travelPace();
    },

    syncControlLabels() {
        const bpmLabel = this.modal?.querySelector('[data-media-visualizer-bpm-label]');
        if (bpmLabel) bpmLabel.textContent = `BPM: ${this.settings.bpm}`;
        const bpmSlider = this.modal?.querySelector('[data-media-visualizer-bpm]');
        if (bpmSlider && Number(bpmSlider.value) !== this.settings.bpm) {
            bpmSlider.value = String(this.settings.bpm);
        }
        const ampLabel = this.modal?.querySelector('[data-media-visualizer-amplitude-label]');
        if (ampLabel) ampLabel.textContent = `Amplitude: ${this.settings.amplitude.toFixed(2)}`;
        const ampSlider = this.modal?.querySelector('[data-media-visualizer-amplitude]');
        if (ampSlider && Number(ampSlider.value) !== this.settings.amplitude) {
            ampSlider.value = String(this.settings.amplitude);
        }
        const travelLabel = this.modal?.querySelector('[data-media-visualizer-travel-label]');
        if (travelLabel) {
            const pace = this.travelPace();
            travelLabel.textContent = `Travel: ${pace.toFixed(2)}×`;
        }
        const travelSlider = this.modal?.querySelector('[data-media-visualizer-travel]');
        if (travelSlider && Number(travelSlider.value) !== this.settings.travel) {
            travelSlider.value = String(this.settings.travel);
        }
    },

    syncBpmLabel() {
        this.syncControlLabels();
    },

    updateStatus() {
        const el = this.modal?.querySelector('[data-media-visualizer-status]');
        if (!el) return;
        if (!this.enabled) {
            el.textContent = '';
            return;
        }
        if (this.analysisLive) {
            el.textContent = 'Live audio';
            el.dataset.state = 'live';
        } else if (this.analysisBlocked || RadioPlayer.analysisAvailable === false) {
            el.textContent = 'This station blocks analysis — match BPM manually';
            el.dataset.state = 'blocked';
        } else {
            el.textContent = 'Listening for audio…';
            el.dataset.state = 'pending';
        }
    },

    dispatchEnabledChange() {
        window.dispatchEvent(new CustomEvent('radio:visualizer_changed', {
            detail: { enabled: this.enabled }
        }));
    },

    ensureModal() {
        if (this.modal) return this.modal;

        if (!this._prefsLoaded) {
            this.loadStoredPrefs();
            this._prefsLoaded = true;
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
                this.toggle(false);
            });
        });

        const modeEl = modal.querySelector('[data-media-visualizer-mode]');
        const paletteEl = modal.querySelector('[data-media-visualizer-palette]');
        const sensitivityEl = modal.querySelector('[data-media-visualizer-sensitivity]');
        const amplitudeEl = modal.querySelector('[data-media-visualizer-amplitude]');
        const travelEl = modal.querySelector('[data-media-visualizer-travel]');
        const bpmEl = modal.querySelector('[data-media-visualizer-bpm]');
        const detailsToggle = modal.querySelector('[data-media-visualizer-details-toggle]');
        this.bindBpmSnap(modal);
        this.bindModalDrag(modal);
        this.bindSettingsToggle(modal);
        this.bindChromeActions(modal);
        const detailsEl = modal.querySelector('[data-media-visualizer-details]');
        const canvas = modal.querySelector('[data-media-visualizer-canvas]');
        if (canvas) {
            this.setCanvas(canvas);
        }

        const syncDetails = () => {
            const open = !!this.detailsOpen;
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
            this.detailsOpen = !this.detailsOpen;
            syncDetails();
            this.saveStoredPrefs();
        });
        syncDetails();

        const applySettings = () => {
            this.setSettings({
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

        this.bindPanelResize(modal);

        this.applyStoredSettingsToControls(modal);
        this.applyStoredLayout(modal);

        const settingsEl = modal.querySelector('[data-media-visualizer-settings]');
        const settingsToggle = modal.querySelector('[data-media-visualizer-settings-toggle]');
        if (settingsEl) settingsEl.classList.toggle('is-collapsed', !this.settingsOpen);
        if (settingsToggle) {
            settingsToggle.setAttribute('aria-expanded', this.settingsOpen ? 'true' : 'false');
            settingsToggle.setAttribute('aria-label', this.settingsOpen ? 'Hide settings' : 'Show settings');
            settingsToggle.setAttribute('title', this.settingsOpen ? 'Hide settings' : 'Show settings');
        }

        document.body.appendChild(modal);
        this.modal = modal;
        this.syncChromeMode();
        return modal;
    },

    bindModalDrag(modal) {
        let startX, startY, startLeft, startTop;
        let dragging = false;

        const isInteractive = (target) => target?.closest(
            'button, input, select, textarea, a, [role="button"], [data-media-visualizer-resize], [data-media-visualizer-settings-toggle], [data-media-visualizer-details-toggle], [data-media-visualizer-chrome-overlay], .tool-panel__actions'
        );

        const onDragStart = (e) => {
            if (this.poppedOut) return;
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
            this.saveStoredPrefs();
        };

        modal.addEventListener('mousedown', onDragStart);
        modal.addEventListener('touchstart', onDragStart, { passive: false });
        window.addEventListener('mousemove', onDrag);
        window.addEventListener('touchmove', onDrag, { passive: true });
        window.addEventListener('mouseup', onDragEnd);
        window.addEventListener('touchend', onDragEnd);
        window.addEventListener('blur', onDragEnd);
    },

    bindBpmSnap(modal) {
        const bpmSnapBtn = modal.querySelector('[data-media-visualizer-bpm-snap]');
        if (!bpmSnapBtn) return;

        const applyTapBpm = () => {
            const bpmSlider = modal.querySelector('[data-media-visualizer-bpm]');
            const bpmLabel = modal.querySelector('[data-media-visualizer-bpm-label]');
            if (bpmSlider) bpmSlider.value = String(this.settings.bpm);
            if (bpmLabel) bpmLabel.textContent = `BPM: ${this.settings.bpm}`;
        };

        bpmSnapBtn.addEventListener('click', () => {
            const now = performance.now();
            const sinceLast = this.tapBpmLastTime ? now - this.tapBpmLastTime : 0;

            // First tap or a long gap (>3s) starts a fresh cycle
            if (!this.tapBpmLastTime || sinceLast > 3000) {
                this.tapBpmTimes = [];
            } else if (sinceLast >= 250) {
                // Record the interval between this tap and the previous one.
                // Second tap already yields BPM from this single interval;
                // later taps average the last 2-3 consecutive beat intervals.
                this.tapBpmTimes.push(sinceLast);
                if (this.tapBpmTimes.length > 3) this.tapBpmTimes.shift();

                const avgInterval = this.tapBpmTimes.reduce((a, b) => a + b, 0) / this.tapBpmTimes.length;
                const bpm = Math.round(60000 / avgInterval);
                this.settings.bpm = clamp(bpm, 10, 200);
                applyTapBpm();
            }

            this.tapBpmLastTime = now;

            // Tap pulse feedback — button stays ○, never toggles
            bpmSnapBtn.style.transform = 'scale(0.85)';
            requestAnimationFrame(() => requestAnimationFrame(() => {
                bpmSnapBtn.style.transform = '';
            }));
        });
    },

    bindPanelResize(modal) {
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
            this.panelWidth = nextW;
            this.canvasHeight = nextH;
            modal.style.width = `${nextW}px`;
            canvas.style.height = `${nextH}px`;
            this.resizeCanvas();
        };

        const onUp = () => {
            if (!dragging) return;
            dragging = false;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            this.saveStoredPrefs();
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
    },

    openModal({ title = 'Radio visualizer', mediaElement = this.mediaElement || RadioPlayer?.getAudioElement?.() } = {}) {
        const modal = this.ensureModal();
        this.setMediaElement(mediaElement);
        const titleEl = modal.querySelector('.media-visualizer-modal__title');
        if (titleEl) titleEl.textContent = title;
        modal.classList.remove('is-hidden');
        modal.setAttribute('aria-label', title);
        const canvas = modal.querySelector('[data-media-visualizer-canvas]');
        if (canvas) this.setCanvas(canvas);
        this.syncControlLabels();
        this.syncChromeMode();
        this.updateStatus();
        return modal;
    },

    closeModal() {
        this.enabled = false;
        if (this.poppedOut) {
            this.popIn();
        }
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.modal) {
            this.modal.classList.add('is-hidden');
        }
        this.analysisLive = false;
        this.analysisBlocked = false;
        this.energyHistory = [];
        this.silenceSince = null;
        this.updateStatus();
        if (this.canvas) {
            this.drawIdleFrame();
        }
        this.saveStoredPrefs();
    },

    async restoreSession() {
        if (this._sessionRestored) return;
        this._sessionRestored = true;
        const stored = readVisualizerPrefs();
        if (!stored.open || this.enabled) return;
        try {
            await this.toggle(true, RadioPlayer?.getAudioElement?.());
        } catch {
            /* ignore restore failures */
        }
    },

    ensureAudioGraph(mediaElement = this.mediaElement || RadioPlayer?.getAudioElement?.()) {
        const audio = mediaElement || RadioPlayer?.getAudioElement?.() || RadioPlayer?.audio;
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!audio || !Ctx) return false;

        // Never attach MediaElementSource to a non-CORS stream — that taints
        // the element (analyser zeroes warning) and breaks later resume.
        if (!RadioPlayer.loadedWithCors || audio.crossOrigin !== 'anonymous') {
            return false;
        }

        if (this.source && this.source.mediaElement && this.source.mediaElement !== audio) {
            this.releaseGraph();
        }

        if (!this.audioContext) {
            this.audioContext = new Ctx();
        }

        if (!this.source) {
            try {
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 2048;
                this.analyser.smoothingTimeConstant = 0.82;
                this.source = this.audioContext.createMediaElementSource(audio);
                this.source.connect(this.analyser);
                this.analyser.connect(this.audioContext.destination);
            } catch {
                this.analyser = null;
                this.source = null;
                return false;
            }
        }

        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }
        return !!this.analyser;
    },

    hasMediaElementSource() {
        return !!this.source;
    },

    releaseGraph() {
        try { this.source?.disconnect(); } catch {}
        try { this.analyser?.disconnect(); } catch {}
        this.source = null;
        this.analyser = null;
        this.mediaElement = null;
        this.analysisLive = false;
    },

    async resumeContext() {
        if (!this.audioContext) return;
        if (this.audioContext.state === 'suspended') {
            try { await this.audioContext.resume(); } catch {}
        }
    },

    async recoverPoisonedGraph() {
        if (!this.source || RadioPlayer.loadedWithCors) return false;
        RadioPlayer.markAnalysisCorsFailed();
        this.analysisBlocked = true;
        this.analysisLive = false;
        const wasEnabled = this.enabled;
        const recovered = await RadioPlayer.resetAudioElementAndPlay();
        this.mediaElement = RadioPlayer.getAudioElement();
        // Graph refs already cleared by reset; stay on BPM-only
        this.releaseGraph();
        this.updateStatus();
        if (wasEnabled) this.start();
        return recovered;
    },

    async toggle(force = null, mediaElement = RadioPlayer?.getAudioElement?.()) {
        const next = typeof force === 'boolean' ? force : !this.enabled;
        this.mediaElement = mediaElement || this.mediaElement || RadioPlayer?.getAudioElement?.() || null;

        if (next) {
            this.openModal({ mediaElement: this.mediaElement });

            let analysisAvailable = false;
            try {
                const result = await RadioPlayer.setAnalysisMode(true);
                analysisAvailable = result?.analysisAvailable === true
                    && RadioPlayer.loadedWithCors;
                this.mediaElement = RadioPlayer.getAudioElement();
            } catch {
                analysisAvailable = false;
            }

            if (!analysisAvailable) {
                this.analysisBlocked = true;
                this.analysisLive = false;
                // If a prior session already attached a tainted source, migrate off it
                if (this.source && !RadioPlayer.loadedWithCors) {
                    await this.recoverPoisonedGraph();
                }
            } else {
                this.analysisBlocked = false;
                this.silenceSince = null;
                this.energyHistory = [];
                this.ensureAudioGraph(this.mediaElement);
                await this.resumeContext();
            }

            this.enabled = true;
            this.updateStatus();
            this.start();
            this.dispatchEnabledChange();
            this.saveStoredPrefs();
            return true;
        }

        this.closeModal();
        try {
            await RadioPlayer.setAnalysisMode(false);
        } catch {}
        // Keep graph alive if CORS-safe so audio continues through Web Audio;
        // only release when not CORS-safe (should not have a source anyway).
        if (this.source && !RadioPlayer.loadedWithCors) {
            await this.recoverPoisonedGraph();
        } else {
            await this.resumeContext();
        }
        this.dispatchEnabledChange();
        return false;
    },

    start() {
        if (!this.enabled) return;
        if (RadioPlayer.loadedWithCors) {
            this.ensureAudioGraph(this.mediaElement || RadioPlayer?.getAudioElement?.());
        }
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.rafId = requestAnimationFrame(this.drawFrame.bind(this));
    },

    stop() {
        this.enabled = false;
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        if (this.canvas) {
            this.drawIdleFrame();
        }
        this.dispatchEnabledChange();
    },

    resizeCanvas() {
        if (!this.canvas || !this.context) return;
        const rect = this.canvas.getBoundingClientRect();
        const width = Math.max(120, Math.round(rect.width || this.canvas.clientWidth || 200));
        const height = Math.max(70, Math.round(rect.height || this.canvas.clientHeight || 90));
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = Math.round(width * dpr);
        this.canvas.height = Math.round(height * dpr);
        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.stars = null;
    },

    ensureStars(width, height) {
        if (this.stars && this.stars.width === width && this.stars.height === height) {
            return this.stars.points;
        }
        const count = Math.max(28, Math.round(width / 14));
        const points = Array.from({ length: count }, () => ({
            x: Math.random() * width,
            y: Math.random() * height * 0.62,
            r: 0.4 + Math.random() * 1.4,
            tw: Math.random() * Math.PI * 2,
            sp: 0.4 + Math.random() * 1.2
        }));
        this.stars = { width, height, points };
        return points;
    },

    sampleEnergy(freq) {
        if (!freq?.length) return 0;
        let total = 0;
        const len = Math.min(freq.length, 512);
        for (let i = 0; i < len; i += 1) total += freq[i];
        return total / len / 255;
    },

    trackEnergy(energy, now = Date.now()) {
        this.energyHistory.push(energy);
        if (this.energyHistory.length > 30) this.energyHistory.shift();
        const avg = this.energyHistory.reduce((a, b) => a + b, 0) / this.energyHistory.length;
        const playing = !!(RadioPlayer.playing || (RadioPlayer.audio && !RadioPlayer.audio.paused));

        if (avg > ENERGY_FLOOR) {
            this.silenceSince = null;
            this.analysisLive = true;
            this.analysisBlocked = false;
            RadioPlayer.analysisAvailable = true;
        } else if (playing) {
            if (this.silenceSince == null) this.silenceSince = now;
            if (now - this.silenceSince >= ENERGY_SILENCE_MS) {
                this.analysisLive = false;
                this.analysisBlocked = true;
                RadioPlayer.analysisAvailable = false;
                // Only treat as CORS poison when a source is attached without a CORS-safe load
                if (this.source && !RadioPlayer.loadedWithCors && !this._recoverScheduled) {
                    RadioPlayer.markAnalysisCorsFailed();
                    this._recoverScheduled = true;
                    this.recoverPoisonedGraph().finally(() => {
                        this._recoverScheduled = false;
                    });
                }
            }
        } else {
            this.silenceSince = null;
            this.analysisLive = false;
        }
        this.updateStatus();
        return avg;
    },

    getMotionStrength(audioEnergy) {
        const { pulse } = beatPulse(this.settings.bpm);
        const a = ampScale(this.settings);
        this.lastPulse = pulse;
        let target;
        if (this.analysisLive) {
            const audio = Math.max(0.08, audioEnergy * this.settings.sensitivity);
            target = clamp((pulse * 0.35 + audio * 0.7) * a, 0, 1.35);
        } else {
            target = clamp((0.14 + pulse * 0.7) * a, 0, 1.1);
        }
        // Ease motion so sky haze / glow don't flicker with every beat
        this._smoothMotion += (target - this._smoothMotion) * 0.08;
        
        return this._smoothMotion;
    },

    bindSettingsToggle(modal) {
        const toggleBtn = modal.querySelector('[data-media-visualizer-settings-toggle]');
        const settingsEl = modal.querySelector('[data-media-visualizer-settings]');
        if (!toggleBtn || !settingsEl) return;

        const sync = () => {
            const open = !!this.settingsOpen;
            toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            toggleBtn.setAttribute('aria-label', open ? 'Hide settings' : 'Show settings');
            toggleBtn.setAttribute('title', open ? 'Hide settings' : 'Show settings');
            settingsEl.classList.toggle('is-collapsed', !open);
        };

        toggleBtn.addEventListener('click', () => {
            this.settingsOpen = !this.settingsOpen;
            sync();
            this.saveStoredPrefs();
        });

        sync();
    },

    syncChromeMode() {
        const modal = this.modal;
        if (!modal) return;

        modal.classList.toggle('is-minimal', !!this.chromeMinimal);

        const overlay = modal.querySelector('[data-media-visualizer-chrome-overlay]');
        if (overlay) {
            overlay.hidden = !this.chromeMinimal;
        }

        const minimizeBtn = modal.querySelector('[data-media-visualizer-minimize]');
        if (minimizeBtn) {
            minimizeBtn.hidden = !!this.chromeMinimal;
        }

        this.syncPopoutButtons();
    },

    syncPopoutButtons() {
        const modal = this.modal;
        if (!modal) return;
        const label = this.poppedOut ? 'Pop in' : 'Pop out';
        const icon = this.poppedOut ? CARD_ICONS.popoutExit : CARD_ICONS.popout;
        modal.querySelectorAll('[data-media-visualizer-popout]').forEach((btn) => {
            btn.innerHTML = icon;
            btn.title = label;
            btn.setAttribute('aria-label', label);
            btn.classList.toggle('is-active', this.poppedOut);
        });
    },

    bindChromeActions(modal) {
        modal.querySelector('[data-media-visualizer-minimize]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.chromeMinimal = true;
            this.settingsOpen = false;
            const settingsEl = modal.querySelector('[data-media-visualizer-settings]');
            const toggleBtn = modal.querySelector('[data-media-visualizer-settings-toggle]');
            if (settingsEl) settingsEl.classList.add('is-collapsed');
            if (toggleBtn) {
                toggleBtn.setAttribute('aria-expanded', 'false');
                toggleBtn.setAttribute('aria-label', 'Show settings');
                toggleBtn.setAttribute('title', 'Show settings');
            }
            this.syncChromeMode();
            this.resizeCanvas();
            this.saveStoredPrefs();
        });

        modal.querySelector('[data-media-visualizer-expand]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.chromeMinimal = false;
            this.syncChromeMode();
            this.resizeCanvas();
            this.saveStoredPrefs();
        });

        modal.querySelectorAll('[data-media-visualizer-popout]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.poppedOut) this.popIn();
                else this.popOut();
            });
        });
    },

    saveDockRect() {
        if (!this.modal || this.poppedOut) return;
        const rect = this.modal.getBoundingClientRect();
        const canvas = this.modal.querySelector('[data-media-visualizer-canvas]');
        this.savedDockRect = {
            left: rect.left,
            top: rect.top,
            width: this.panelWidth || rect.width,
            canvasHeight: this.canvasHeight || canvas?.getBoundingClientRect().height || 200
        };
        this.saveStoredPrefs();
    },

    restoreDockRect() {
        if (!this.modal || !this.savedDockRect) return;
        const { left, top, width, canvasHeight } = this.savedDockRect;
        this.modal.style.left = `${left}px`;
        this.modal.style.top = `${top}px`;
        this.modal.style.width = `${width}px`;
        const canvas = this.modal.querySelector('[data-media-visualizer-canvas]');
        if (canvas && canvasHeight) {
            canvas.style.height = `${canvasHeight}px`;
            this.canvasHeight = canvasHeight;
        }
        this.panelWidth = width;
        this.resizeCanvas();
    },

    async popOut() {
        if (!this.modal || this.poppedOut) {
            try { this.popoutWindow?.focus(); } catch { /* ignore */ }
            return;
        }

        this.saveDockRect();
        const rect = this.modal.getBoundingClientRect();
        const w = Math.max(480, Math.round(rect.width));
        const h = Math.max(320, Math.round(rect.height));

        const onPageHide = () => {
            if (this.poppedOut) this.popIn({ fromExternalClose: true });
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

        popDoc.body.appendChild(this.modal);
        this.modal.classList.add('is-popout-live');
        this.modal.style.left = '0';
        this.modal.style.top = '0';
        this.modal.style.width = '100%';
        this.modal.style.height = '100%';

        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            this.popIn();
        };
        popDoc.addEventListener('keydown', onKey);

        this.poppedOut = true;
        this.popoutWindow = win;
        this.popoutDoc = popDoc;
        this.popoutOnKey = onKey;
        this.popoutOnPageHide = onPageHide;
        this.syncPopoutButtons();
        this.resizeCanvas();

        try { win.focus(); } catch { /* ignore */ }
    },

    popIn({ fromExternalClose = false } = {}) {
        if (!this.modal || !this.poppedOut) return;

        const popDoc = this.popoutDoc;
        if (this.popoutOnKey && popDoc) {
            popDoc.removeEventListener('keydown', this.popoutOnKey);
        }
        if (!fromExternalClose && this.popoutWindow && !this.popoutWindow.closed) {
            try { this.popoutWindow.close(); } catch { /* ignore */ }
        }

        if (popDoc && popDoc !== document) {
            unregisterAppDocument(popDoc);
        }

        this.modal.classList.remove('is-popout-live');
        this.modal.style.left = '';
        this.modal.style.top = '';
        this.modal.style.width = '';
        this.modal.style.height = '';
        document.body.appendChild(this.modal);

        this.poppedOut = false;
        this.popoutWindow = null;
        this.popoutDoc = null;
        this.popoutOnKey = null;
        this.popoutOnPageHide = null;

        this.restoreDockRect();
        this.savedDockRect = null;
        this.syncPopoutButtons();
        this.syncChromeMode();
        this.resizeCanvas();
        this.saveStoredPrefs();
    },

    smoothVizValues(values) {
        if (!Array.isArray(values) || !values.length) return values;
        if (!this._smoothValues || this._smoothValues.length !== values.length) {
            this._smoothValues = values.slice();
            return this._smoothValues;
        }
        for (let i = 0; i < values.length; i += 1) {
            this._smoothValues[i] += (values[i] - this._smoothValues[i]) * 0.14;
        }
        return this._smoothValues;
    },

    synthValues(count, strength) {
        const { phase, pulse } = beatPulse(this.settings.bpm);
        const a = ampScale(this.settings);
        return Array.from({ length: count }, (_, i) => {
            const wave = 0.32 + 0.4 * Math.sin(phase * Math.PI * 2 + i * 0.55);
            return clamp((wave * 0.5 + pulse * 0.55) * strength * a, 0, 1);
        });
    },

    drawIdleFrame() {
        const canvas = this.canvas;
        const ctx = this.context;
        if (!canvas || !ctx) return;
        const width = canvas.clientWidth || 200;
        const height = canvas.clientHeight || 90;
        const palette = PALETTES[this.settings.palette] || PALETTES.neon;
        const values = this.synthValues(36, 0.55);
        ctx.clearRect(0, 0, width, height);
        if (this.settings.mode === 'spaceTrip') {
            this.drawSpaceTrip(ctx, width, height, values, palette, 0.35);
            return;
        }
        this.drawMountains(ctx, width, height, values, palette, 0.35);
    },

    drawFrame() {
        const canvas = this.canvas;
        const ctx = this.context;
        if (!canvas || !ctx || !this.enabled) return;

        if (this.audioContext?.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }

        const width = canvas.clientWidth || 200;
        const height = canvas.clientHeight || 90;
        const analyser = this.analyser;
        const palette = PALETTES[this.settings.palette] || PALETTES.neon;
        ctx.clearRect(0, 0, width, height);

        const binCount = Math.max(16, Math.round(32 * this.settings.density));
        let values;
        let timeDomain = null;
        let audioEnergy = 0;

        if (analyser) {
            const freq = new Uint8Array(analyser.frequencyBinCount);
            const time = new Uint8Array(analyser.fftSize);
            analyser.getByteFrequencyData(freq);
            analyser.getByteTimeDomainData(time);
            timeDomain = time;
            audioEnergy = this.sampleEnergy(freq);
            this.trackEnergy(audioEnergy);

            if (this.analysisLive) {
                values = Array.from({ length: binCount }, (_, i) => {
                    const start = Math.floor((i / binCount) * freq.length);
                    const end = Math.floor(((i + 1) / binCount) * freq.length);
                    let total = 0;
                    let count = 0;
                    for (let j = start; j < end; j += 1) {
                        total += freq[j] || 0;
                        count += 1;
                    }
                    return count ? total / count / 255 : 0;
                });
            } else {
                values = null;
            }
        } else {
            this.analysisLive = false;
            this.analysisBlocked = true;
            this.updateStatus();
            values = null;
        }

        const motion = this.getMotionStrength(audioEnergy);
        if (!values) {
            values = this.synthValues(binCount, motion);
        }
        const drawValues = this.settings.mode === 'mountains'
            ? this.smoothVizValues(values)
            : values;

        switch (this.settings.mode) {
            case 'sky':
                this.drawNeonSky(ctx, width, height, values, palette, motion);
                break;
            case 'mountains':
                this.drawMountains(ctx, width, height, drawValues, palette, motion);
                break;
            case 'auroraBands':
                this.drawAuroraBands(ctx, width, height, values, palette, motion);
                break;
            case 'waveform':
                this.fillBackdrop(ctx, width, height);
                if (this.analysisLive && timeDomain) {
                    this.drawWaveform(ctx, width, height, timeDomain, palette, motion);
                } else {
                    this.drawWaveformSynth(ctx, width, height, values, palette, motion);
                }
                break;
            case 'particles':
                this.fillBackdrop(ctx, width, height);
                this.drawParticles(ctx, width, height, values, palette, motion);
                break;
            case 'rings':
                this.fillBackdrop(ctx, width, height);
                this.drawRings(ctx, width, height, values, palette, motion);
                break;
            case 'orb':
                this.fillBackdrop(ctx, width, height);
                this.drawOrb(ctx, width, height, values, palette, motion);
                break;
            case 'spiral':
                this.fillBackdrop(ctx, width, height);
                this.drawSpiral(ctx, width, height, values, palette, motion);
                break;
            case 'spaceTrip':
                this.drawSpaceTrip(ctx, width, height, values, palette, motion);
                break;
            case 'bars':
            default:
                this.fillBackdrop(ctx, width, height);
                this.drawBars(ctx, width, height, values, palette, motion);
                break;
        }

        this.rafId = requestAnimationFrame(this.drawFrame.bind(this));
    },

    fillBackdrop(ctx, width, height) {
        ctx.fillStyle = this.settings.background === 'glass'
            ? 'rgba(15, 23, 42, 0.52)'
            : this.settings.background === 'midnight'
                ? '#040914'
                : '#070b12';
        ctx.fillRect(0, 0, width, height);
    },

    drawSkyGradient(ctx, width, height, palette, motion = 0.4) {
        const sky = ctx.createLinearGradient(0, 0, 0, height);
        sky.addColorStop(0, '#040714');
        sky.addColorStop(0.35, alpha(palette[3] || palette[0], 0.22 + motion * 0.1));
        sky.addColorStop(0.62, alpha(palette[1], 0.18));
        sky.addColorStop(1, '#05080f');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, width, height);

        const now = Date.now();
        const stars = this.ensureStars(width, height);
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
    },

    pickNextMountainScene() {
        if (this.mountainScene === 'sea') {
            this.mountainSceneQueue = shuffleNoRepeat(MOUNTAIN_SCENES, null);
            return this.mountainSceneQueue.shift();
        }
        if (!this.mountainSceneQueue.length) {
            return 'sea';
        }
        return this.mountainSceneQueue.shift();
    },

    ensureMountainWorld(now = Date.now()) {
        if (this.mountainCycleStart == null) {
            this.mountainCycleStart = now;
        }

        // Drop scenes removed from the rotation (e.g. old palm/flatland session state)
        if (
            this.mountainScene
            && this.mountainScene !== 'sea'
            && !MOUNTAIN_SCENES.includes(this.mountainScene)
        ) {
            this.mountainScene = null;
            this.sceneTransition = null;
            this.mountainSceneQueue = [];
        }

        if (!this.mountainScene) {
            this.mountainSceneQueue = shuffleNoRepeat(MOUNTAIN_SCENES, null);
            this.mountainScene = this.mountainSceneQueue.shift();
            this.mountainSceneStartedAt = now;
            this.sceneTransition = null;
        } else if (!this.sceneTransition) {
            const hold = this.sceneHoldMs(this.mountainScene);
            if (now - this.mountainSceneStartedAt >= hold) {
                const next = this.pickNextMountainScene();
                this.sceneTransition = {
                    from: this.mountainScene,
                    to: next,
                    start: now,
                    duration: this.sceneTransitionMs()
                };
            }
        }

        if (this.sceneTransition) {
            const u = (now - this.sceneTransition.start) / this.sceneTransition.duration;
            if (u >= 1) {
                this.mountainScene = this.sceneTransition.to;
                this.mountainSceneStartedAt = now;
                this.sceneTransition = null;
            }
        }

        return dayCycleState(now, this.mountainCycleStart);
    },

    wrapScreenX(worldX, width, parallax = 1) {
        const span = width * 2.2;
        const shifted = worldX - this.travelScroll * parallax;
        return ((shifted % span) + span) % span - width * 0.15;
    },

    spawnBirds(width, height, now) {
        if (now < this.nextBirdAt) return;
        const roll = Math.random();
        const count = roll < 0.55 ? 1 : roll < 0.85 ? 2 : 3 + Math.floor(Math.random() * 3);
        const dir = Math.random() < 0.65 ? -1 : 1;
        const baseY = height * (0.08 + Math.random() * 0.34);
        const speed = (0.028 + Math.random() * 0.07) * width;
        const style = Math.floor(Math.random() * 3);
        for (let i = 0; i < count; i += 1) {
            this.birds.push({
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
        this.nextBirdAt = now + 9000 + Math.random() * 14000;
    },

    updateAndDrawBirds(ctx, width, height, now, dt, palette, dayness) {
        this.spawnBirds(width, height, now);
        const inkMix = smoothstep(0.35, 0.7, dayness);
        const ink = cssRgba(lerpTuple(
            rgbaTuple(palette[0], 0.85),
            rgbaTuple(palette[3] || '#111827', 0.8),
            inkMix
        ));
        this.birds = this.birds.filter((b) => b.x > -50 && b.x < width + 50);
        for (const b of this.birds) {
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
    },

    drawSunMoon(ctx, width, height, palette, cycle, motion) {
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
            ctx.shadowBlur = 28 + this.settings.glow * 28;
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
            ctx.shadowBlur = 16 + this.settings.glow * 14;
            ctx.shadowColor = alpha(palette[0], 0.7 * moonness);
            ctx.beginPath();
            ctx.arc(mx, my, r, 0, Math.PI * 2);
            ctx.arc(mx + r * 0.35, my - r * 0.1, r * 0.85, 0, Math.PI * 2, true);
            ctx.fill('evenodd');
            ctx.shadowBlur = 0;
        }
    },

    drawMountainSky(ctx, width, height, palette, motion, cycle) {
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
            const stars = this.ensureStars(width, height);
            for (const s of stars) {
                const tw = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.0012 * s.sp + s.tw));
                const sx = this.wrapScreenX(s.x + width * 0.2, width, 0.15);
                ctx.fillStyle = alpha(palette[Math.floor(s.tw) % palette.length], tw * 0.9 * starFade);
                ctx.beginPath();
                ctx.arc(sx, s.y, s.r * (0.8 + tw * 0.35), 0, Math.PI * 2);
                ctx.fill();
            }
        }

        this.drawSunMoon(ctx, width, height, palette, cycle, motion);

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
    },

    ridgeYAt(x, width, height, layer, values, phase, t, a, pulse, scroll = 0) {
        const pts = 48;
        const world = (x + scroll * (0.35 + layer.li * 0.25)) / width * pts;
        const i0 = Math.floor(world);
        const frac = world - i0;
        const softPulse = pulse * pulse; // damp BPM snap on ridges
        const sample = (idx) => {
            const v = values[Math.abs(idx) % values.length] || 0;
            const ridge = Math.sin(idx * 0.55 + phase * Math.PI * 2 + layer.li)
                + 0.45 * Math.sin(idx * 1.3 - t * layer.speed * 1000);
            const peak = (0.35 + v * this.settings.sensitivity * 0.55 + softPulse * 0.06)
                * layer.scale * height
                + ridge * 6 * a;
            return height * layer.y - peak;
        };
        return sample(i0) * (1 - frac) + sample(i0 + 1) * frac;
    },

    drawCactus(ctx, x, groundY, scale, color, variant = 0) {
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
    },

    drawTree(ctx, x, groundY, scale, trunk, leaf) {
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
    },

    drawScrollingDecor(ctx, width, height, scene, frontLayer, values, phase, t, a, pulse, palette, dayness) {
        const cactusBase = 0.86 + dayness * 0.08;
        const trunk = alpha(FOREST_TRUNK, 0.95);
        const scroll = this.travelScroll;
        const span = width * 2.2;

        if (scene === 'cactus') {
            const step = width * 0.34;
            for (let world = -width; world < span + width; world += step) {
                // Irregular gaps — most slots empty so they don't march in pairs
                const dens = Math.sin(world * 0.037 + 0.6) * Math.sin(world * 0.013 + 2.4);
                if (dens < 0.28) continue;
                const jitter = Math.sin(world * 0.09) * step * 0.35;
                const x = this.wrapScreenX(world + jitter, width, 1);
                if (x < -30 || x > width + 30) continue;
                const y = this.ridgeYAt(x, width, height, frontLayer, values, phase, t, a, pulse, scroll);
                const variant = Math.floor((Math.abs(Math.sin(world * 0.071 + 1.3)) * 5));
                const scale = 0.4 + Math.abs(Math.sin(world * 0.029)) * 0.55
                    + (variant === 3 ? -0.08 : 0)
                    + (variant === 0 ? 0.12 : 0);
                const tint = 0.92 + Math.sin(world * 0.05) * 0.06;
                const cactusColor = alpha(CACTUS_GREEN, cactusBase * tint);
                this.drawCactus(ctx, x, y + 1, scale, cactusColor, variant);
            }
        } else if (scene === 'forest') {
            const step = width * 0.045;
            for (let world = -width; world < span + width; world += step) {
                const x = this.wrapScreenX(world, width, 1);
                if (x < -40 || x > width + 40) continue;
                const dens = Math.sin(world * 0.11) + Math.sin(world * 0.07 + 1.7);
                if (dens < -0.35) continue;
                const cluster = 2 + Math.floor((Math.sin(world * 0.19) + 1) * 2);
                for (let c = 0; c < cluster; c += 1) {
                    const ox = x + (c - cluster / 2) * 7 + Math.sin(world + c) * 3;
                    const y = this.ridgeYAt(ox, width, height, frontLayer, values, phase, t, a, pulse, scroll);
                    const leaf = alpha(FOREST_LEAF[(c + Math.floor(Math.abs(world) / 40)) % FOREST_LEAF.length], 0.92);
                    this.drawTree(ctx, ox, y + 1, 0.5 + (c % 4) * 0.18 + Math.abs(Math.sin(world)) * 0.15, trunk, leaf);
                }
            }
        }
    },

    drawSailboat(ctx, x, waterY, scale, hullColor, sailColor, t = 0) {
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
    },

    drawShip(ctx, x, waterY, scale, hullColor, accent) {
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
    },

    drawSurfer(ctx, x, waterY, scale, boardColor, suitColor) {
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
    },

    drawSea(ctx, width, height, values, palette, motion, cycle) {
        const a = ampScale(this.settings);
        const { pulse } = beatPulse(this.settings.bpm);
        const t = Date.now() * 0.001;
        const scroll = this.travelScroll;

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
                    + v * 10 * a * this.settings.sensitivity
                    + pulse * 3;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = alpha(pickColor(palette, band), 0.35 + motion * 0.2 + pulse * 0.15);
            ctx.lineWidth = 1.6 + band * 0.25;
            ctx.shadowBlur = 10 + this.settings.glow * 10;
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
            const x = this.wrapScreenX(world + Math.sin(world * 0.02) * 30, width, 0.42);
            if (x < -50 || x > width + 50) continue;
            const bob = Math.sin(t * 0.85 + world * 0.01) * 5.5
                + Math.sin(t * 0.37 + world * 0.02) * 2.5;
            const waterY = waterTop + 10 + bob;
            const roll = Math.sin(world * 0.031 + 4.2) * 0.5 + 0.5;

            if (roll < 0.48) {
                const sail = alpha(pickColor(palette, Math.floor(world / step) % palette.length), 0.8);
                this.drawSailboat(ctx, x, waterY, 0.7 + seed * 0.35, alpha('#0f172a', 0.92), sail, t);
            } else if (roll < 0.76) {
                this.drawShip(ctx, x, waterY + 1, 0.7 + seed * 0.35, alpha('#0b1220', 0.95), alpha(palette[0], 0.75));
            } else {
                this.drawSurfer(
                    ctx, x, waterY + 2, 0.85 + seed * 0.25,
                    alpha(palette[2], 0.85),
                    alpha('#1e293b', 0.9)
                );
            }
        }

        for (let i = 0; i < 18; i += 1) {
            const fx = this.wrapScreenX(i * width * 0.14 + Math.sin(i) * 20, width, 1.1);
            const fy = waterTop + 16 + (i % 5) * 12 + Math.sin(t * 2 + i + scroll * 0.05) * 4;
            ctx.fillStyle = alpha(palette[i % palette.length], 0.35);
            ctx.beginPath();
            ctx.arc(fx, fy, 1.2 + (i % 3) * 0.6, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    drawTerrainContent(ctx, width, height, values, palette, motion, cycle, scene, a, now) {
        if (scene === 'sea') {
            this.drawSea(ctx, width, height, values, palette, motion, cycle);
            return;
        }

        const layers = [
            { y: 0.58, scale: 0.22 * a, alpha: 0.28, color: 4, speed: 0.00012, li: 0 },
            { y: 0.64, scale: 0.32 * a, alpha: 0.4, color: 1, speed: 0.00022, li: 1 },
            { y: 0.72, scale: 0.48 * a, alpha: 0.72, color: 0, speed: 0.00038, li: 2 }
        ];
        const { pulse, phase } = beatPulse(this.settings.bpm);
        const t = now;
        const scroll = this.travelScroll;

        layers.forEach((layer) => {
            const pts = Math.max(22, Math.round(values.length * (0.8 + layer.li * 0.15)));
            ctx.beginPath();
            ctx.moveTo(0, height);
            for (let i = 0; i <= pts; i += 1) {
                const x = (i / pts) * width;
                const y = this.ridgeYAt(x, width, height, layer, values, phase, t, a, pulse, scroll);
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
            ctx.shadowBlur = 14 + this.settings.glow * 16;
            ctx.shadowColor = alpha(pickColor(palette, layer.color), 0.75);
            ctx.beginPath();
            for (let i = 0; i <= pts; i += 1) {
                const x = (i / pts) * width;
                const y = this.ridgeYAt(x, width, height, layer, values, phase, t, a, pulse, scroll);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            if (layer.li === 2) {
                this.drawScrollingDecor(
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
    },

    drawMountains(ctx, width, height, values, palette, motion = 1) {
        const a = ampScale(this.settings);
        const now = Date.now();
        if (this._mountainLastNow == null) this._mountainLastNow = now;
        const dt = clamp((now - this._mountainLastNow) / 1000, 0.008, 0.05);
        this._mountainLastNow = now;

        // Travel progressing right → world scrolls left (Travel slider = journey pace)
        this.travelScroll += width * TRAVEL_SPEED * this.travelPace() * dt;

        const cycle = this.ensureMountainWorld(now);
        this.drawMountainSky(ctx, width, height, palette, motion, cycle);
        this.updateAndDrawBirds(ctx, width, height, now, dt, palette, cycle.dayness);

        if (this.sceneTransition) {
            const u = clamp(
                (now - this.sceneTransition.start) / this.sceneTransition.duration,
                0,
                1
            );
            // Hold full black through the mid cut so scenery swap never flashes
            let black;
            if (u < 0.4) black = smoothstep(0, 0.4, u);
            else if (u < 0.6) black = 1;
            else black = 1 - smoothstep(0.6, 1, u);
            const scene = u < 0.5 ? this.sceneTransition.from : this.sceneTransition.to;
            this.drawTerrainContent(
                ctx, width, height, values, palette, motion, cycle,
                scene, a, now
            );
            ctx.fillStyle = `rgba(0,0,0,${black})`;
            ctx.fillRect(0, 0, width, height);
            return;
        }

        this.drawTerrainContent(
            ctx, width, height, values, palette, motion, cycle,
            this.mountainScene, a, now
        );
    },

    drawNeonSky(ctx, width, height, values, palette, motion = 1) {
        const a = ampScale(this.settings);
        this.drawSkyGradient(ctx, width, height, palette, motion);
        const { pulse, phase } = beatPulse(this.settings.bpm);
        const t = Date.now() * 0.001 * this.settings.speed;

        // Drifting aurora curtains
        for (let band = 0; band < 4; band += 1) {
            ctx.beginPath();
            const baseY = height * (0.18 + band * 0.1);
            for (let x = 0; x <= width; x += 6) {
                const n = Math.sin(x * 0.012 + t * (0.6 + band * 0.2) + phase * Math.PI * 2)
                    + 0.5 * Math.sin(x * 0.03 - t + band);
                const v = values[Math.floor((x / width) * values.length) % values.length] || 0;
                const y = baseY + n * (10 + motion * 14) * a + v * 18 * a * this.settings.sensitivity;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = alpha(pickColor(palette, band), 0.28 + pulse * 0.25);
            ctx.lineWidth = 2.2 + band * 0.4;
            ctx.shadowBlur = 16 + this.settings.glow * 20;
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
                - (8 + Math.sin(i * 0.7 + t) * 6 + v * 22 * a) * this.settings.sensitivity;
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
                - (8 + Math.sin(i * 0.7 + t) * 6 + v * 22 * a) * this.settings.sensitivity;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
    },

    drawAuroraBands(ctx, width, height, values, palette, motion = 1) {
        const a = ampScale(this.settings);
        this.drawSkyGradient(ctx, width, height, palette, motion);
        const { pulse, phase } = beatPulse(this.settings.bpm);
        const t = Date.now() * 0.001;

        for (let i = 0; i < 6; i += 1) {
            const v = values[i % values.length] || 0.2;
            ctx.beginPath();
            for (let x = 0; x <= width; x += 4) {
                const wobble = Math.sin(x * 0.02 + t * (0.8 + i * 0.15) + i + phase * 4);
                const y = height * (0.2 + i * 0.09)
                    + wobble * (12 + motion * 16) * a
                    + v * 28 * a * this.settings.sensitivity;
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
    },

    drawBars(ctx, width, height, values, palette, motion = 1) {
        ctx.save();
        setGlow(ctx, palette, this.settings.glow);
        const barWidth = width / values.length;
        const base = height * 0.78;
        const a = ampScale(this.settings);
        const beatBoost = 0.7 + motion * 0.35;
        for (let i = 0; i < values.length; i += 1) {
            const v = Math.max(0, values[i]);
            const heightValue = Math.max(4, v * height * 0.55 * this.settings.sensitivity * beatBoost * a);
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
    },

    drawParticles(ctx, width, height, values, palette, motion = 1) {
        ctx.save();
        setGlow(ctx, palette, this.settings.glow);
        const { pulse } = beatPulse(this.settings.bpm);
        const a = ampScale(this.settings);
        for (let i = 0; i < values.length; i += 1) {
            const strength = (values[i] || 0) * this.settings.sensitivity * (0.55 + motion * 0.4) * a;
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
    },

    drawWaveform(ctx, width, height, values, palette, motion = 1) {
        ctx.save();
        setGlow(ctx, palette, this.settings.glow);
        const a = ampScale(this.settings);
        ctx.beginPath();
        const step = width / values.length;
        const amp = 0.2 * this.settings.sensitivity * (0.75 + motion * 0.3) * a;
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
    },

    drawWaveformSynth(ctx, width, height, values, palette, motion = 1) {
        ctx.save();
        setGlow(ctx, palette, this.settings.glow);
        const a = ampScale(this.settings);
        ctx.beginPath();
        const step = width / values.length;
        for (let i = 0; i < values.length; i += 1) {
            const norm = (values[i] - 0.5) * 2;
            const x = i * step;
            const y = height / 2 + norm * height * 0.16 * this.settings.sensitivity * (0.75 + motion * 0.3) * a;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = alpha(palette[0], 0.78);
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.restore();
    },

    drawRings(ctx, width, height, values, palette, motion = 1) {
        ctx.save();
        setGlow(ctx, palette, this.settings.glow);
        const a = ampScale(this.settings);
        const cx = width / 2;
        const cy = height / 2;
        for (let i = 0; i < 7; i += 1) {
            const strength = (values[i % values.length] || 0) * this.settings.sensitivity * a;
            const radius = 16 + i * 11 + strength * 36 + motion * 6 * a;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = alpha(pickColor(palette, i + 1), 0.35 + strength * 0.4);
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }
        ctx.restore();
    },

    drawOrb(ctx, width, height, values, palette, motion = 1) {
        ctx.save();
        setGlow(ctx, palette, this.settings.glow);
        const a = ampScale(this.settings);
        const cx = width / 2;
        const cy = height / 2;
        const avg = values.reduce((sum, value) => sum + (value || 0), 0) / Math.max(1, values.length);
        const radius = Math.min(width, height) * (0.14 + avg * 0.4 * this.settings.sensitivity * a + motion * 0.05);
        const grad = ctx.createRadialGradient(cx, cy, radius * 0.2, cx, cy, radius * 1.6);
        grad.addColorStop(0, alpha(palette[0], 0.86));
        grad.addColorStop(0.48, alpha(palette[1], 0.45));
        grad.addColorStop(1, alpha(palette[2], 0.02));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    },

    drawSpiral(ctx, width, height, values, palette, motion = 1) {
        ctx.save();
        setGlow(ctx, palette, this.settings.glow);
        const a = ampScale(this.settings);
        const cx = width / 2;
        const cy = height / 2;
        const { pulse } = beatPulse(this.settings.bpm);
        ctx.beginPath();
        for (let i = 0; i < 150; i += 1) {
            const angle = i * 0.42 + Date.now() * 0.0008 * this.settings.speed * (0.7 + pulse + motion * 0.25);
            const strength = (values[i % values.length] || 0.2) * this.settings.sensitivity * a;
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
    },

    spawnSpaceStar() {
        const roll = Math.random();
        const kind = roll < 0.14 ? 'trail' : roll < 0.32 ? 'bright' : roll < 0.62 ? 'normal' : 'dim';
        return {
            x: (Math.random() - 0.5) * 2.6,
            y: (Math.random() - 0.5) * 2.6,
            z: Math.random() * 1.85 + 0.06,
            hue: Math.random(),
            tw: Math.random() * Math.PI * 2,
            kind,
            colorIdx: Math.floor(Math.random() * 6),
            sizeMul: 0.55 + Math.random() * 1.6,
            history: kind === 'trail' ? [] : null
        };
    },

    getSpaceTripCycleIndex(now, state) {
        return Math.floor((now - (state.cycleAnchor || now)) / SPACE_HYPER_CYCLE_MS);
    },

    getSpaceTripCruiseElapsed(now, state) {
        const elapsed = (now - (state.cycleAnchor || now)) % SPACE_HYPER_CYCLE_MS;
        return elapsed < SPACE_CRUISE_MS ? elapsed : -1;
    },

    isEarthCruise(now, state) {
        return this.getSpaceTripCycleIndex(now, state) % 2 === 1;
    },

    spawnSpaceEarthPlanet() {
        return {
            x: (Math.random() - 0.5) * 0.06,
            y: (Math.random() - 0.5) * 0.05,
            z: 2.15 + Math.random() * 0.45,
            radius: 0.072 + Math.random() * 0.038,
            colorIdx: 0,
            type: 'earth',
            sizeClass: 'headOn',
            spin: Math.random() * Math.PI * 2,
            seed: Math.random(),
            dodgeDir: Math.random() < 0.5 ? -1 : 1
        };
    },

    spawnSpacePlanet(palette, state, now) {
        const type = SPACE_PLANET_TYPES[Math.floor(Math.random() * SPACE_PLANET_TYPES.length)];
        const roll = Math.random();
        const earthCruise = this.isEarthCruise(now, state);
        let sizeClass = 'medium';
        if (roll < 0.22) sizeClass = 'small';
        else if (roll < 0.52) sizeClass = 'medium';
        else if (roll < 0.76) sizeClass = 'large';
        else if (!earthCruise) sizeClass = 'headOn';
        else sizeClass = 'large';

        const headOn = sizeClass === 'headOn';
        const x = headOn ? (Math.random() - 0.5) * 0.12 : (Math.random() - 0.5) * 1.15;
        const y = headOn ? (Math.random() - 0.5) * 0.1 : (Math.random() - 0.5) * 0.75;
        const z = headOn ? 2.2 + Math.random() * 0.75 : 3.2 + Math.random() * 1.6;

        let radius;
        if (sizeClass === 'small') radius = 0.012 + Math.random() * 0.016;
        else if (sizeClass === 'medium') radius = 0.02 + Math.random() * 0.028;
        else if (sizeClass === 'large') radius = 0.042 + Math.random() * 0.05;
        else radius = 0.062 + Math.random() * 0.072;

        return {
            x,
            y,
            z,
            radius,
            colorIdx: Math.floor(Math.random() * palette.length),
            type,
            sizeClass,
            spin: Math.random() * Math.PI * 2,
            seed: Math.random(),
            dodgeDir: headOn ? (Math.random() < 0.5 ? -1 : 1) : 0
        };
    },

    getSpaceTripNebulaStrength(now, state) {
        const hyper = this.getSpaceTripHyperPhase(now, state);
        if (hyper.mode !== 'cruise') return 0;

        const cruiseElapsed = (now - (state.cycleAnchor || now)) % SPACE_HYPER_CYCLE_MS;
        if (cruiseElapsed < SPACE_NEBULA_START_MS || cruiseElapsed > SPACE_NEBULA_END_MS) return 0;

        const fadeInEnd = SPACE_NEBULA_START_MS + SPACE_NEBULA_FADE_IN_MS;
        const fadeOutStart = SPACE_NEBULA_END_MS - SPACE_NEBULA_FADE_OUT_MS;

        if (cruiseElapsed < fadeInEnd) {
            return smoothstep(SPACE_NEBULA_START_MS, fadeInEnd, cruiseElapsed);
        }
        if (cruiseElapsed > fadeOutStart) {
            return 1 - smoothstep(fadeOutStart, SPACE_NEBULA_END_MS, cruiseElapsed);
        }
        return 1;
    },

    drawSpaceTripNebula(ctx, width, height, cx, cy, state, palette, strength, pulse, motion, now) {
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

        const blobs = this.ensureNebulaBlobs(state, palette);
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
    },

    ensureNebulaWisps(state, palette, count = 36) {
        if (state.nebulaWisps?.length) return state.nebulaWisps;
        state.nebulaWisps = Array.from({ length: count }, (_, i) => ({
            x: (Math.random() - 0.5) * 2.2,
            y: (Math.random() - 0.5) * 1.6,
            z: Math.random() * 1.4 + 0.12,
            ang: Math.random() * Math.PI * 2,
            size: 0.012 + Math.random() * 0.028,
            aspect: 1.8 + Math.random() * 2.8,
            colorIdx: i + 2,
            alpha: 0.12 + Math.random() * 0.18
        }));
        return state.nebulaWisps;
    },

    spawnNebulaWisp() {
        return {
            x: (Math.random() - 0.5) * 2.2,
            y: (Math.random() - 0.5) * 1.6,
            z: 1.1 + Math.random() * 0.75,
            ang: Math.random() * Math.PI * 2,
            size: 0.012 + Math.random() * 0.028,
            aspect: 1.8 + Math.random() * 2.8,
            colorIdx: Math.floor(Math.random() * 6),
            alpha: 0.12 + Math.random() * 0.18
        };
    },

    drawSpaceTripNebulaWisps(ctx, cx, cy, fov, state, palette, strength, pulse, viewPanX, viewPanY) {
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
    },

    ensureNebulaBlobs(state, palette) {
        if (state.nebulaBlobs?.length) return state.nebulaBlobs;
        state.nebulaBlobs = Array.from({ length: 7 }, (_, i) => ({
            ox: (Math.random() - 0.5) * 1.6,
            oy: (Math.random() - 0.5) * 1.2,
            r: 0.55 + Math.random() * 0.55,
            a: 0.18 + Math.random() * 0.22,
            sp: 0.6 + Math.random() * 1.4,
            color: pickColor(palette, i + 1)
        }));
        return state.nebulaBlobs;
    },

    getSpaceTripHyperPhase(now, state) {
        const elapsed = (now - (state.cycleAnchor || now)) % SPACE_HYPER_CYCLE_MS;
        const cruiseEnd = SPACE_CRUISE_MS;
        const engageEnd = cruiseEnd + SPACE_HYPER_ENGAGE_MS;
        const travelEnd = engageEnd + SPACE_HYPER_TRAVEL_MS;
        const disengageEnd = travelEnd + SPACE_HYPER_DISENGAGE_MS;

        if (elapsed < cruiseEnd) {
            return { mode: 'cruise', mix: 0, speedMul: 1 };
        }
        if (elapsed < engageEnd) {
            const t = (elapsed - cruiseEnd) / SPACE_HYPER_ENGAGE_MS;
            const ease = smoothstep(0, 1, t);
            return { mode: 'engage', mix: ease, speedMul: 1 + ease * 2.5 };
        }
        if (elapsed < travelEnd) {
            return { mode: 'hyper', mix: 1, speedMul: 4.5 };
        }
        if (elapsed < disengageEnd) {
            const t = (elapsed - travelEnd) / SPACE_HYPER_DISENGAGE_MS;
            const ease = 1 - smoothstep(0, 1, t);
            return { mode: 'disengage', mix: ease, speedMul: 1 + ease * 2.5 };
        }
        return { mode: 'cruise', mix: 0, speedMul: 1 };
    },

    updateSpaceTripRoll(state, now, dt) {
        const dodging = (state.dodge?.strength || 0) > 0.08;
        if (!dodging && (!state.nextRollAt || now >= state.nextRollAt)) {
            state.rollTarget = (Math.random() - 0.5) * 0.14;
            state.nextRollAt = now + 4000 + Math.random() * 7000;
        }
        if (!dodging) {
            state.rollAngle += (state.rollTarget - state.rollAngle) * Math.min(1, dt * 1.8);
            state.rollAngle += Math.sin(now * 0.0007) * 0.002;
        }
    },

    updateSpaceTripDodge(state, dt, fov) {
        let threat = null;
        for (const planet of state.planets) {
            const isClosePass = planet.type === 'earth' || planet.sizeClass === 'headOn';
            if (!isClosePass) continue;
            const centered = Math.abs(planet.x) < 0.28 && Math.abs(planet.y) < 0.22;
            if (planet.z < 0.42 && planet.z > 0.008 && centered) {
                if (!threat || planet.z < threat.z) threat = planet;
            }
        }

        if (!state.dodge) {
            state.dodge = { panX: 0, panY: 0, roll: 0, strength: 0 };
        }
        const dodge = state.dodge;

        if (threat && threat.z < 0.36) {
            const urgency = smoothstep(0.36, 0.07, threat.z);
            if (!threat.dodgeDir) threat.dodgeDir = Math.random() < 0.5 ? -1 : 1;
            const dir = threat.dodgeDir;
            dodge.targetPanX = dir * fov * (0.28 + urgency * 0.72);
            dodge.targetPanY = -fov * (0.04 + urgency * 0.14);
            dodge.targetRoll = dir * (0.18 + urgency * 0.42);
            dodge.strength = urgency;
        } else {
            dodge.targetPanX = 0;
            dodge.targetPanY = 0;
            dodge.targetRoll = 0;
            dodge.strength = 0;
        }

        const snapIn = threat ? Math.min(1, dt * 9) : Math.min(1, dt * 2.2);
        dodge.panX += ((dodge.targetPanX || 0) - dodge.panX) * snapIn;
        dodge.panY += ((dodge.targetPanY || 0) - dodge.panY) * snapIn;
        dodge.roll += ((dodge.targetRoll || 0) - dodge.roll) * snapIn;
    },

    ensureSpaceTripWarp(state) {
        if (state.tunnelWarp?.rings?.length) return state.tunnelWarp;

        const ringCount = 20;
        const streakCount = 80;
        state.tunnelWarp = {
            rings: Array.from({ length: ringCount }, (_, i) => ({
                z: 0.04 + (i / ringCount) * 0.96,
                drift: Math.random() * Math.PI * 2,
                colorIdx: i % HYPER_WALL_COLORS.length
            })),
            streaks: Array.from({ length: streakCount }, (_, i) => ({
                ang: (i / streakCount) * Math.PI * 2 + Math.random() * 0.15,
                radial: 0.38 + Math.random() * 0.12,
                z: Math.random() * 1.1 + 0.1,
                len: 0.07 + Math.random() * 0.16,
                colorIdx: i % HYPER_WALL_COLORS.length
            }))
        };
        return state.tunnelWarp;
    },

    respawnTunnelRing(warp, ring) {
        const maxZ = warp.rings.reduce((max, r) => Math.max(max, r.z), 0);
        ring.z = maxZ + 0.048 + Math.random() * 0.02;
        ring.drift = Math.random() * Math.PI * 2;
        ring.colorIdx = Math.floor(Math.random() * HYPER_WALL_COLORS.length);
    },

    respawnTunnelStreak(streak) {
        streak.ang = Math.random() * Math.PI * 2;
        streak.radial = 0.38 + Math.random() * 0.12;
        streak.z = 0.85 + Math.random() * 0.35;
        streak.len = 0.07 + Math.random() * 0.16;
        streak.colorIdx = Math.floor(Math.random() * HYPER_WALL_COLORS.length);
    },

    spaceTripProject(cx, cy, fov, viewPanX, viewPanY, x, y, z) {
        const invZ = 1 / Math.max(z, 0.02);
        return {
            sx: cx + viewPanX + x * fov * invZ,
            sy: cy + viewPanY + y * fov * invZ,
            invZ
        };
    },

    drawSpaceTripTunnel(ctx, width, height, cx, cy, state, palette, hyperMix, motion, pulse, fov, viewPanX, viewPanY) {
        if (hyperMix <= 0.01) return;

        const warp = this.ensureSpaceTripWarp(state);
        const now = Date.now();
        const px = cx + viewPanX;
        const py = cy + viewPanY;
        const project = (x, y, z) => this.spaceTripProject(cx, cy, fov, viewPanX, viewPanY, x, y, z);
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
    },

    drawSpaceEarth(ctx, sx, sy, pr, fade) {
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
    },

    drawSpacePlanet(ctx, sx, sy, pr, planet, palette, fade) {
        const bodyColor = pickColor(palette, planet.colorIdx);
        const atmColor = pickColor(palette, planet.colorIdx + 2);
        const accent = pickColor(palette, planet.colorIdx + 1);
        const type = planet.type || 'rocky';

        ctx.save();

        if (type === 'earth') {
            this.drawSpaceEarth(ctx, sx, sy, pr, fade);
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
    },

    ensureSpaceTripState(width, height) {
        const density = clamp(Number(this.settings.density) || 1, 0.3, 2.2);
        const targetCount = Math.max(160, Math.round(280 * density));

        if (!this.spaceTrip || this.spaceTrip.width !== width || this.spaceTrip.height !== height) {
            const stars = Array.from({ length: targetCount }, () => this.spawnSpaceStar());
            const now = Date.now();
            this.spaceTrip = {
                width,
                height,
                stars,
                planets: [],
                nextPlanetAt: now + 8000 + Math.random() * 10000,
                lastFrameTime: null,
                cycleAnchor: now,
                rollAngle: 0,
                rollTarget: 0,
                nextRollAt: now + 3000,
                tunnelWarp: null,
                nebulaBlobs: null,
                nebulaWisps: null,
                earthSpawnedCycle: -1,
                dodge: { panX: 0, panY: 0, roll: 0, strength: 0 }
            };
            return this.spaceTrip;
        }

        while (this.spaceTrip.stars.length < targetCount) {
            this.spaceTrip.stars.push(this.spawnSpaceStar());
        }
        while (this.spaceTrip.stars.length > targetCount) {
            this.spaceTrip.stars.pop();
        }
        return this.spaceTrip;
    },

    updateSpaceTrip(dt, motion, values) {
        const state = this.spaceTrip;
        if (!state) return;

        const now = Date.now();
        const { pulse } = beatPulse(this.settings.bpm, now);
        const a = ampScale(this.settings);
        const avg = values?.length
            ? values.reduce((sum, value) => sum + (value || 0), 0) / values.length
            : 0.3;
        const hyper = this.getSpaceTripHyperPhase(now, state);
        const warpBoost = 1 + avg * this.settings.sensitivity * 0.8 * a + pulse * 0.15 + motion * 0.08;
        const speed = this.travelPace() * this.settings.speed * 0.45 * warpBoost * hyper.speedMul * dt;
        const fov = Math.min(state.width || 640, state.height || 480) * 0.55;

        this.updateSpaceTripDodge(state, dt, fov);
        this.updateSpaceTripRoll(state, now, dt);

        const warp = this.ensureSpaceTripWarp(state);
        for (const ring of warp.rings) {
            ring.z -= speed;
            if (ring.z <= 0.02) this.respawnTunnelRing(warp, ring);
        }
        for (const streak of warp.streaks) {
            streak.z -= speed;
            if (streak.z <= 0.02) this.respawnTunnelStreak(streak);
        }

        const nebulaStrength = this.getSpaceTripNebulaStrength(now, state);
        if (nebulaStrength > 0) {
            const palette = PALETTES[this.settings.palette] || PALETTES.horizon;
            for (const wisp of this.ensureNebulaWisps(state, palette)) {
                wisp.z -= speed;
                if (wisp.z <= 0.02) {
                    const respawn = this.spawnNebulaWisp();
                    Object.assign(wisp, respawn);
                }
            }
        }

        for (const star of state.stars) {
            if (star.history) {
                star.history.unshift({ x: star.x, y: star.y, z: star.z });
                if (star.history.length > 6) star.history.pop();
            }
            star.z -= speed;
            if (star.z <= 0.02) {
                const respawn = this.spawnSpaceStar();
                star.x = respawn.x;
                star.y = respawn.y;
                star.z = respawn.z;
                star.hue = respawn.hue;
                star.tw = respawn.tw;
                star.kind = respawn.kind;
                star.colorIdx = respawn.colorIdx;
                star.sizeMul = respawn.sizeMul;
                star.history = respawn.history;
            }
        }

        if (hyper.mix < 0.85) {
            const cycleIndex = this.getSpaceTripCycleIndex(now, state);
            const cruiseElapsed = this.getSpaceTripCruiseElapsed(now, state);

            if (this.isEarthCruise(now, state) && cruiseElapsed >= 0) {
                if (state.earthSpawnedCycle !== cycleIndex && cruiseElapsed >= SPACE_EARTH_CRUISE_SPAWN_MS) {
                    const hasEarth = state.planets.some((planet) => planet.type === 'earth');
                    if (!hasEarth) {
                        state.planets.push(this.spawnSpaceEarthPlanet());
                    }
                    state.earthSpawnedCycle = cycleIndex;
                }
            }

            for (let i = state.planets.length - 1; i >= 0; i -= 1) {
                const planet = state.planets[i];
                const planetSpeed = planet.type === 'earth' || planet.sizeClass === 'headOn'
                    ? speed * 1.05
                    : speed * 0.9;
                planet.z -= planetSpeed;
                if (planet.z < 0.006) state.planets.splice(i, 1);
            }

            if (now >= state.nextPlanetAt) {
                const palette = PALETTES[this.settings.palette] || PALETTES.horizon;
                state.planets.push(this.spawnSpacePlanet(palette, state, now));
                state.nextPlanetAt = now + (8000 + Math.random() * 10000) / this.travelPace();
            }
        } else if (state.planets.length) {
            state.planets.length = 0;
        }

        state.lastHyper = hyper;
        state.lastFrameTime = now;
    },

    drawSpaceTrip(ctx, width, height, values, palette, motion = 1) {
        const cx = width / 2;
        const cy = height / 2;
        const fov = Math.min(width, height) * 0.55;
        const now = Date.now();
        const { pulse } = beatPulse(this.settings.bpm, now);
        const a = ampScale(this.settings);

        const state = this.ensureSpaceTripState(width, height);
        const dt = state.lastFrameTime
            ? Math.min(0.05, (now - state.lastFrameTime) / 1000)
            : 0.016;
        this.updateSpaceTrip(dt, motion, values);

        const hyper = state.lastHyper || this.getSpaceTripHyperPhase(now, state);
        const hyperMix = hyper.mix;

        ctx.fillStyle = '#010204';
        ctx.fillRect(0, 0, width, height);

        const nebulaStrength = this.getSpaceTripNebulaStrength(now, state);

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
            this.drawSpaceTripNebula(ctx, width, height, cx, cy, state, palette, nebulaStrength, pulse, motion, now);
            this.ensureNebulaWisps(state, palette);
        }

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((state.rollAngle || 0) + (state.dodge?.roll || 0));
        ctx.translate(-cx, -cy);

        const viewPanX = state.dodge?.panX || 0;
        const viewPanY = state.dodge?.panY || 0;

        if (nebulaStrength > 0.01) {
            this.drawSpaceTripNebulaWisps(ctx, cx, cy, fov, state, palette, nebulaStrength, pulse, viewPanX, viewPanY);
        }

        if (hyperMix < 0.35) {
            setGlow(ctx, palette, this.settings.glow * 0.75);
        } else {
            ctx.shadowBlur = 0;
        }

        const avg = values?.length
            ? values.reduce((sum, value) => sum + (value || 0), 0) / values.length
            : 0.3;
        const streakMul = (0.4 + avg * this.settings.sensitivity * a + pulse * 0.3) * this.settings.amplitude;
        const travelStep = this.travelPace() * 0.02 * (hyper.speedMul || 1);
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
            this.drawSpaceTripTunnel(ctx, width, height, cx, cy, state, palette, hyperMix, motion, pulse, fov, viewPanX, viewPanY);
        }

        for (const star of state.stars) {
            const { sx, sy, invZ } = projectStar(star.x, star.y, star.z);
            if (sx < -32 || sx > width + 32 || sy < -32 || sy > height + 32) continue;

            const kindMul = star.kind === 'bright' ? 1.55 : star.kind === 'trail' ? 1.25 : star.kind === 'dim' ? 0.55 : 1;
            const twinkle = 0.5 + 0.5 * Math.sin(now * 0.003 * this.settings.speed + star.tw);
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

                this.drawSpacePlanet(ctx, sx, sy, pr, planet, palette, fade);
            }
        }

        ctx.restore();
    }
};
