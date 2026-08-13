import { RadioPlayer } from './radioPlayer.js';

const PALETTES = {
    neon: ['#7dd3fc', '#c084fc', '#f472b6', '#fef08a', '#34d399'],
    sunset: ['#f97316', '#fb7185', '#facc15', '#fda4af', '#fbbf24'],
    aurora: ['#22d3ee', '#34d399', '#a3e635', '#60a5fa', '#c4b5fd'],
    mono: ['#e2e8f0', '#cbd5e1', '#94a3b8', '#f8fafc', '#dbeafe'],
    ocean: ['#38bdf8', '#2dd4bf', '#a5f3fc', '#67e8f9', '#bae6fd'],
    vapor: ['#ff71ce', '#01cdfe', '#05ffa1', '#b967ff', '#fffb96']
};

const DEFAULTS = {
    mode: 'mountains',
    palette: 'neon',
    sensitivity: 1.0,
    amplitude: 0.55,
    density: 1,
    speed: 1,
    glow: 0.65,
    background: 'dark',
    bpm: 120
};

const ENERGY_FLOOR = 0.02;
const ENERGY_SILENCE_MS = 1000;

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
        modal.setAttribute('aria-modal', 'true');
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
                    </div>
                </div>
            </div>
        `;

        const closeBtn = modal.querySelector('[data-media-visualizer-close]');
        closeBtn?.addEventListener('click', () => {
            this.toggle(false);
        });
        modal.addEventListener('click', (event) => {
            if (event.target === modal) {
                this.toggle(false);
            }
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
                palette: paletteEl?.value || 'neon',
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

        document.body.appendChild(modal);
        this.modal = modal;
        return modal;
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

        // Soft horizon glow
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

    drawMountains(ctx, width, height, values, palette, motion = 1) {
        const a = ampScale(this.settings);
        this.drawSkyGradient(ctx, width, height, palette, motion);

        const layers = [
            { y: 0.58, scale: 0.22 * a, alpha: 0.28, color: 4, speed: 0.00012 },
            { y: 0.64, scale: 0.32 * a, alpha: 0.4, color: 1, speed: 0.00022 },
            { y: 0.72, scale: 0.48 * a, alpha: 0.72, color: 0, speed: 0.00038 }
        ];
        const { pulse, phase } = beatPulse(this.settings.bpm);
        const t = Date.now();

        layers.forEach((layer, li) => {
            const pts = Math.max(18, Math.round(values.length * (0.7 + li * 0.15)));
            ctx.beginPath();
            ctx.moveTo(0, height);
            for (let i = 0; i <= pts; i += 1) {
                const x = (i / pts) * width;
                const v = values[i % values.length] || 0;
                const ridge = Math.sin(i * 0.55 + phase * Math.PI * 2 + li)
                    + 0.45 * Math.sin(i * 1.3 - t * layer.speed * 1000);
                const peak = (0.35 + v * this.settings.sensitivity * 0.8 + pulse * 0.15)
                    * layer.scale * height
                    + ridge * 6 * a;
                const y = height * layer.y - peak;
                ctx.lineTo(x, y);
            }
            ctx.lineTo(width, height);
            ctx.closePath();

            const fill = ctx.createLinearGradient(0, height * (layer.y - 0.35), 0, height);
            fill.addColorStop(0, alpha(pickColor(palette, layer.color), layer.alpha));
            fill.addColorStop(0.55, alpha(pickColor(palette, layer.color + 1), layer.alpha * 0.55));
            fill.addColorStop(1, 'rgba(2, 6, 16, 0.92)');
            ctx.fillStyle = fill;
            ctx.fill();

            ctx.strokeStyle = alpha(pickColor(palette, layer.color), 0.55 + pulse * 0.25);
            ctx.lineWidth = 1.2 + li * 0.2;
            ctx.shadowBlur = 10 + this.settings.glow * 14;
            ctx.shadowColor = alpha(pickColor(palette, layer.color), 0.65);
            ctx.beginPath();
            for (let i = 0; i <= pts; i += 1) {
                const x = (i / pts) * width;
                const v = values[i % values.length] || 0;
                const ridge = Math.sin(i * 0.55 + phase * Math.PI * 2 + li)
                    + 0.45 * Math.sin(i * 1.3 - t * layer.speed * 1000);
                const peak = (0.35 + v * this.settings.sensitivity * 0.8 + pulse * 0.15)
                    * layer.scale * height
                    + ridge * 6 * a;
                const y = height * layer.y - peak;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.stroke();
            ctx.shadowBlur = 0;
        });

        // Reflective ground strip
        const ground = ctx.createLinearGradient(0, height * 0.82, 0, height);
        ground.addColorStop(0, alpha(palette[0], 0.12 + motion * 0.08));
        ground.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = ground;
        ctx.fillRect(0, height * 0.82, width, height * 0.18);
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
