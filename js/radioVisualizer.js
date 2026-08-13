import { RadioPlayer } from './radioPlayer.js';

const PALETTES = {
    neon: ['#7dd3fc', '#c084fc', '#f472b6', '#fef08a', '#34d399'],
    horizon: ['#00f0ff', '#ff2bd6', '#b8ff3c', '#7b5cff', '#ff9f1c'],
    sunset: ['#f97316', '#fb7185', '#facc15', '#fda4af', '#fbbf24'],
    aurora: ['#22d3ee', '#34d399', '#a3e635', '#60a5fa', '#c4b5fd'],
    mono: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#f8fafc', '#dbeafe'],
    ocean: ['#38bdf8', '#2dd4bf', '#a5f3fc', '#67e8f9', '#bae6fd'],
    vapor: ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96']
};

const DEFAULTS = {
    mode: 'mountains',
    palette: 'horizon',
    sensitivity: 1.0,
    amplitude: 0.55,
    density: 1,
    speed: 1,
    glow: 0.85,
    background: 'dark',
    bpm: 120
};

const ENERGY_FLOOR = 0.02;
const ENERGY_SILENCE_MS = 1000;
const DAY_CYCLE_MS = 60_000;
const SCENE_HOLD_MS = 18_000;
const SEA_HOLD_MS = 60_000;
const SCENE_TRANSITION_MS = 2_800;
const MOUNTAIN_SCENES = ['cactus', 'forest'];
const TRAVEL_SPEED = 0.085; // screens per second (progressing right → world scrolls left)
const FOREST_LEAF = ['#1f4d2e', '#2d6a3e', '#245536', '#3d7a4a', '#4a6b3a'];
const FOREST_TRUNK = '#3b2a1a';
const CACTUS_GREEN = '#4d6b3c';

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

function bellWrap(t, center, width) {
    const d = Math.min(Math.abs(t - center), 1 - Math.abs(t - center));
    const x = clamp(1 - d / width, 0, 1);
    return x * x * (3 - 2 * x);
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
    return {
        night: [
            rgbaTuple('#02010c', 1),
            rgbaTuple(p3, 0.55),
            rgbaTuple(p0, 0.28),
            rgbaTuple(p0, 0.12),
            rgbaTuple('#03040c', 1)
        ],
        dawn: [
            rgbaTuple('#1a0538', 1),
            rgbaTuple(p1, 0.9),
            rgbaTuple(p4, 0.85),
            rgbaTuple(p0, 0.7),
            rgbaTuple('#0a0618', 1)
        ],
        day: [
            rgbaTuple('#12003a', 1),
            rgbaTuple(p3, 0.85),
            rgbaTuple(p0, 0.75),
            rgbaTuple(p1, 0.55),
            rgbaTuple('#050816', 1)
        ],
        dusk: [
            rgbaTuple('#2a0060', 1),
            rgbaTuple(p3, 0.95),
            rgbaTuple(p1, 0.9),
            rgbaTuple(p4, 0.75),
            rgbaTuple('#080414', 1)
        ]
    };
}

function blendedSkyStops(palette, cycleT) {
    const frames = skyPaletteFrames(palette);
    const keys = [
        { t: 0, name: 'night' },
        { t: 0.12, name: 'dawn' },
        { t: 0.37, name: 'day' },
        { t: 0.62, name: 'dusk' },
        { t: 0.87, name: 'night' },
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
    const sunness = bellWrap(t, 0.3, 0.34);
    const moonness = bellWrap(t, 0.82, 0.36);
    const dayness = clamp(sunness * 1.05, 0, 1);
    let period = 'night';
    if (t < 0.25) period = 'dawn';
    else if (t < 0.5) period = 'day';
    else if (t < 0.75) period = 'dusk';
    // Arc across the sky during their visible halves (right → left uses 1 - arc in draw)
    const sunArc = smoothstep(0, 0.55, t);
    const moonArc = t >= 0.45
        ? smoothstep(0.45, 1, t)
        : smoothstep(0, 0.2, t) * 0.15;
    return { t, period, dayness, sunness, moonness, sunArc, moonArc, elapsed };
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
    _mountainLastNow: null,
    sceneTransition: null,
    panelWidth: null,
    canvasHeight: 200,

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

    setSettings(patch = {}) {
        this.settings = { ...this.settings, ...patch };
        this.settings.sensitivity = clamp(Number(this.settings.sensitivity) || 1, 0.35, 2.5);
        this.settings.amplitude = clamp(Number(this.settings.amplitude) || 0.55, 0.15, 1.5);
        this.settings.density = clamp(Number(this.settings.density) || 1, 0.3, 2.2);
        this.settings.speed = clamp(Number(this.settings.speed) || 1, 0.35, 2.5);
        this.settings.glow = clamp(Number(this.settings.glow) || 0.65, 0, 1.5);
        this.settings.bpm = clamp(Math.round(Number(this.settings.bpm) || 120), 10, 200);
        this.syncControlLabels();
        if (this.canvas && !this.enabled) {
            this.drawIdleFrame();
        }
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

        const modal = document.createElement('div');
        modal.className = 'media-visualizer-modal is-hidden';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'false');
        modal.setAttribute('aria-label', 'Media visualizer');
        modal.innerHTML = `
            <div class="media-visualizer-modal__dialog">
                <div class="media-visualizer-modal__header">
                    <span class="media-visualizer-modal__title">Radio visualizer</span>
                    <button type="button" class="card-act media-visualizer-modal__close" data-media-visualizer-close aria-label="Close visualizer">×</button>
                </div>
                <div class="media-visualizer-modal__body">
                    <canvas class="media-visualizer-modal__canvas" data-media-visualizer-canvas aria-label="Media visualizer canvas"></canvas>
                    <p class="media-visualizer-modal__status" data-media-visualizer-status data-state="pending"></p>
                    <div class="media-visualizer-modal__controls">
                        <label class="media-visualizer-modal__field">
                            <span>Style</span>
                            <select class="form-input radio-special-form__select" data-media-visualizer-mode>
                                <option value="mountains">Neon Mountains</option>
                                <option value="sky">Neon Sky</option>
                                <option value="auroraBands">Aurora Bands</option>
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
                            <span data-media-visualizer-bpm-label>BPM: 120</span>
                            <input type="range" min="10" max="200" step="1" value="120" data-media-visualizer-bpm>
                        </label>
                        <div class="media-visualizer-modal__legend" data-media-visualizer-legend>
                            <span class="media-visualizer-modal__legend-title">Neon Mountains randomizer</span>
                            <ul>
                                <li>Day / night cycle: ${DAY_CYCLE_MS / 1000}s (smooth blend)</li>
                                <li>Cactus / Forest scenes: ~${SCENE_HOLD_MS / 1000}s each (shuffle, no immediate repeat)</li>
                                <li>Sea interlude: ${SEA_HOLD_MS / 1000}s after a cactus+forest pass</li>
                                <li>Scene crossfade: ~${SCENE_TRANSITION_MS / 1000}s</li>
                                <li>Sea encounters (sparse): sailboat, ship, surfer, rogue wave</li>
                                <li>Birds: every ~9–23s (V / gull / dart)</li>
                                <li>Travel scroll: continuous rightward journey</li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div class="media-visualizer-modal__resize" data-media-visualizer-resize title="Resize" aria-hidden="true"></div>
            </div>
        `;

        const closeBtn = modal.querySelector('[data-media-visualizer-close]');
        closeBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle(false);
        });

        const modeEl = modal.querySelector('[data-media-visualizer-mode]');
        const paletteEl = modal.querySelector('[data-media-visualizer-palette]');
        const sensitivityEl = modal.querySelector('[data-media-visualizer-sensitivity]');
        const amplitudeEl = modal.querySelector('[data-media-visualizer-amplitude]');
        const bpmEl = modal.querySelector('[data-media-visualizer-bpm]');
        const canvas = modal.querySelector('[data-media-visualizer-canvas]');
        if (canvas) {
            this.setCanvas(canvas);
        }

        const applySettings = () => {
            this.setSettings({
                mode: modeEl?.value || 'mountains',
                palette: paletteEl?.value || 'horizon',
                sensitivity: sensitivityEl?.value || 1.0,
                amplitude: amplitudeEl?.value || 0.55,
                bpm: bpmEl?.value || 120
            });
        };
        modeEl?.addEventListener('change', applySettings);
        paletteEl?.addEventListener('change', applySettings);
        sensitivityEl?.addEventListener('input', applySettings);
        amplitudeEl?.addEventListener('input', applySettings);
        bpmEl?.addEventListener('input', applySettings);

        this.bindPanelResize(modal);

        document.body.appendChild(modal);
        this.modal = modal;
        return modal;
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
        this.updateStatus();
        return modal;
    },

    closeModal() {
        this.enabled = false;
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
        if (this.analysisLive) {
            const audio = Math.max(0.08, audioEnergy * this.settings.sensitivity);
            return clamp((pulse * 0.35 + audio * 0.7) * a, 0, 1.35);
        }
        return clamp((0.14 + pulse * 0.7) * a, 0, 1.1);
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
                values = this.synthValues(binCount, this.getMotionStrength(audioEnergy));
            }
        } else {
            this.analysisLive = false;
            this.analysisBlocked = true;
            this.updateStatus();
            values = this.synthValues(binCount, this.getMotionStrength(0));
        }

        const motion = this.getMotionStrength(audioEnergy);

        switch (this.settings.mode) {
            case 'sky':
                this.drawNeonSky(ctx, width, height, values, palette, motion);
                break;
            case 'mountains':
                this.drawMountains(ctx, width, height, values, palette, motion);
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

        if (!this.mountainScene) {
            this.mountainSceneQueue = shuffleNoRepeat(MOUNTAIN_SCENES, null);
            this.mountainScene = this.mountainSceneQueue.shift();
            this.mountainSceneStartedAt = now;
            this.sceneTransition = null;
        } else if (!this.sceneTransition) {
            const hold = this.mountainScene === 'sea' ? SEA_HOLD_MS : SCENE_HOLD_MS;
            if (now - this.mountainSceneStartedAt >= hold) {
                const next = this.pickNextMountainScene();
                this.sceneTransition = {
                    from: this.mountainScene,
                    to: next,
                    start: now,
                    duration: SCENE_TRANSITION_MS
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
        const ink = dayness > 0.5
            ? alpha(palette[3] || '#111827', 0.8)
            : alpha(palette[0], 0.85);
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

            if (sunness > 0.35 && dayness < 0.85) {
                ctx.save();
                ctx.globalAlpha = 0.1 + (1 - Math.abs(dayness - 0.55)) * 0.28 * sunness;
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
        const { dayness, t: cycleT } = cycle;
        const stops = blendedSkyStops(palette, cycleT);
        const stopPos = [0, 0.28, 0.55, 0.78, 1];
        const sky = ctx.createLinearGradient(0, 0, 0, height);
        stops.forEach((tuple, idx) => {
            sky.addColorStop(stopPos[idx], cssRgba(tuple));
        });
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, width, height);

        for (let i = 0; i < 3; i += 1) {
            const y = height * (0.18 + i * 0.16);
            const haze = ctx.createLinearGradient(0, y - 18, 0, y + 18);
            haze.addColorStop(0, 'rgba(0,0,0,0)');
            haze.addColorStop(0.5, alpha(palette[i % palette.length], 0.1 + motion * 0.08 + dayness * 0.06));
            haze.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = haze;
            ctx.fillRect(0, y - 18, width, 36);
        }

        const starFade = clamp(1 - dayness * 1.05, 0, 1);
        if (starFade > 0.02) {
            const now = Date.now();
            const stars = this.ensureStars(width, height);
            for (const s of stars) {
                const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.002 * s.sp + s.tw));
                const sx = this.wrapScreenX(s.x + width * 0.2, width, 0.15);
                ctx.fillStyle = alpha(palette[Math.floor(s.tw) % palette.length], tw * 0.95 * starFade);
                ctx.beginPath();
                ctx.arc(sx, s.y, s.r * (0.8 + tw * 0.4), 0, Math.PI * 2);
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
            width * 0.7
        );
        const horizonColor = cssRgba(lerpTuple(
            rgbaTuple(palette[0], 0.28 + motion * 0.18),
            rgbaTuple(palette[1], 0.28 + motion * 0.18),
            dayness
        ));
        glow.addColorStop(0, horizonColor);
        glow.addColorStop(0.45, alpha(palette[2], 0.14));
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(0, 0, width, height);
    },

    ridgeYAt(x, width, height, layer, values, phase, t, a, pulse, scroll = 0) {
        const pts = 48;
        const world = (x + scroll * (0.35 + layer.li * 0.25)) / width * pts;
        const i0 = Math.floor(world);
        const frac = world - i0;
        const sample = (idx) => {
            const v = values[Math.abs(idx) % values.length] || 0;
            const ridge = Math.sin(idx * 0.55 + phase * Math.PI * 2 + layer.li)
                + 0.45 * Math.sin(idx * 1.3 - t * layer.speed * 1000);
            const peak = (0.35 + v * this.settings.sensitivity * 0.8 + pulse * 0.15)
                * layer.scale * height
                + ridge * 6 * a;
            return height * layer.y - peak;
        };
        return sample(i0) * (1 - frac) + sample(i0 + 1) * frac;
    },

    drawCactus(ctx, x, groundY, scale, color) {
        ctx.save();
        ctx.translate(x, groundY);
        ctx.scale(scale, scale);
        ctx.fillStyle = color;
        ctx.fillRect(-2.5, -22, 5, 22);
        ctx.fillRect(-10, -16, 8, 3);
        ctx.fillRect(-10, -16, 3, 8);
        ctx.fillRect(2.5, -12, 8, 3);
        ctx.fillRect(7.5, -12, 3, 7);
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
        const cactusColor = alpha(CACTUS_GREEN, 0.88 + dayness * 0.08);
        const trunk = alpha(FOREST_TRUNK, 0.95);
        const scroll = this.travelScroll;
        const span = width * 2.2;

        if (scene === 'cactus') {
            const step = width * 0.16;
            for (let world = -width; world < span + width; world += step) {
                const x = this.wrapScreenX(world, width, 1);
                if (x < -30 || x > width + 30) continue;
                const jitter = Math.sin(world * 0.03) * 10;
                const y = this.ridgeYAt(x, width, height, frontLayer, values, phase, t, a, pulse, scroll);
                const scale = 0.65 + (Math.abs(Math.sin(world * 0.02)) * 0.35);
                this.drawCactus(ctx, x + jitter * 0.2, y + 1, scale, cactusColor);
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

    drawSailboat(ctx, x, waterY, scale, hullColor, sailColor) {
        ctx.save();
        ctx.translate(x, waterY);
        ctx.scale(scale, scale);
        ctx.shadowBlur = 8;
        ctx.shadowColor = sailColor;
        ctx.fillStyle = hullColor;
        ctx.beginPath();
        ctx.moveTo(-14, 0);
        ctx.quadraticCurveTo(-10, 6, 0, 7);
        ctx.quadraticCurveTo(10, 6, 12, 0);
        ctx.lineTo(-14, 0);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = alpha('#e2e8f0', 0.85);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(0, -28);
        ctx.stroke();
        ctx.fillStyle = sailColor;
        ctx.beginPath();
        ctx.moveTo(1, -26);
        ctx.lineTo(1, -4);
        ctx.lineTo(14, -8);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(-1, -22);
        ctx.lineTo(-1, -6);
        ctx.lineTo(-11, -9);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = alpha(sailColor, 0.45);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(-14, 3);
        ctx.quadraticCurveTo(-22, 5, -28, 2);
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

    drawRogueWave(ctx, x, waterTop, width, height, palette, t, strength) {
        const crest = waterTop + 6;
        const amp = (18 + strength * 28) * (0.85 + 0.15 * Math.sin(t * 3));
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(x - 70, height);
        ctx.lineTo(x - 70, crest + 20);
        for (let i = 0; i <= 24; i += 1) {
            const u = i / 24;
            const px = x - 70 + u * 140;
            const arch = Math.sin(u * Math.PI);
            const y = crest + 18 - arch * amp + Math.sin(t * 4 + u * 6) * 2;
            ctx.lineTo(px, y);
        }
        ctx.lineTo(x + 70, height);
        ctx.closePath();
        const foam = ctx.createLinearGradient(0, crest - amp, 0, height);
        foam.addColorStop(0, alpha(palette[0], 0.55));
        foam.addColorStop(0.35, alpha(palette[3], 0.4));
        foam.addColorStop(1, alpha('#020617', 0.2));
        ctx.fillStyle = foam;
        ctx.fill();
        ctx.strokeStyle = alpha('#e0f2fe', 0.65);
        ctx.lineWidth = 2;
        ctx.shadowBlur = 14;
        ctx.shadowColor = alpha(palette[0], 0.7);
        ctx.beginPath();
        for (let i = 0; i <= 24; i += 1) {
            const u = i / 24;
            const px = x - 70 + u * 140;
            const arch = Math.sin(u * Math.PI);
            const y = crest + 18 - arch * amp + Math.sin(t * 4 + u * 6) * 2;
            if (i === 0) ctx.moveTo(px, y);
            else ctx.lineTo(px, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
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

        // Sparse sea encounters: mostly empty, mix of sailboat / ship / surfer / rogue wave
        const span = width * 2.4;
        const step = width * 1.45;
        for (let world = 0; world < span + width; world += step) {
            const seed = Math.sin(world * 0.017 + 1.3) * 0.5 + 0.5;
            if (seed < 0.78) continue;
            const x = this.wrapScreenX(world + Math.sin(world * 0.02) * 30, width, 0.9);
            if (x < -50 || x > width + 50) continue;
            const bob = Math.sin(t * 1.5 + world * 0.01) * 2;
            const waterY = waterTop + 9 + bob;
            const roll = Math.sin(world * 0.031 + 4.2) * 0.5 + 0.5;

            if (roll < 0.42) {
                const sail = alpha(pickColor(palette, Math.floor(world / step) % palette.length), 0.8);
                this.drawSailboat(ctx, x, waterY, 0.65 + seed * 0.35, alpha('#0f172a', 0.92), sail);
            } else if (roll < 0.68) {
                this.drawShip(ctx, x, waterY + 1, 0.7 + seed * 0.35, alpha('#0b1220', 0.95), alpha(palette[0], 0.75));
            } else if (roll < 0.86) {
                this.drawSurfer(
                    ctx, x, waterY + 2, 0.85 + seed * 0.25,
                    alpha(palette[2], 0.85),
                    alpha('#1e293b', 0.9)
                );
            } else {
                this.drawRogueWave(ctx, x, waterTop, width, height, palette, t, seed);
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
            const nightMul = 0.7 + cycle.dayness * 0.3;
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

        // Travel progressing right → world scrolls left
        let travelBoost = 1;
        if (this.sceneTransition) {
            // Ease through the cut with a brief speed pulse
            const u = clamp((now - this.sceneTransition.start) / this.sceneTransition.duration, 0, 1);
            travelBoost = 1 + Math.sin(u * Math.PI) * 0.55;
        }
        this.travelScroll += width * TRAVEL_SPEED * this.settings.speed * dt * travelBoost;

        const cycle = this.ensureMountainWorld(now);
        this.drawMountainSky(ctx, width, height, palette, motion, cycle);
        this.updateAndDrawBirds(ctx, width, height, now, dt, palette, cycle.dayness);

        if (this.sceneTransition) {
            const u = smoothstep(
                0,
                1,
                (now - this.sceneTransition.start) / this.sceneTransition.duration
            );
            ctx.save();
            ctx.globalAlpha = 1 - u;
            this.drawTerrainContent(
                ctx, width, height, values, palette, motion, cycle,
                this.sceneTransition.from, a, now
            );
            ctx.restore();
            ctx.save();
            ctx.globalAlpha = u;
            this.drawTerrainContent(
                ctx, width, height, values, palette, motion, cycle,
                this.sceneTransition.to, a, now
            );
            ctx.restore();
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
    }
};
