import { RadioPlayer } from './radioPlayer.js';
import { PALETTES } from './radioVisualizer/palettes.js';
import {
    DEFAULTS,
    readVisualizerPrefs,
    clamp,
    alpha,
    pickColor,
    setGlow,
    beatPulse,
    ampScale,
    shuffleNoRepeat,
    smoothstep,
    rgbaTuple,
    lerpTuple,
    cssRgba
} from './radioVisualizer/settings.js';
import {
    blendedSkyStops,
    dayCycleState
} from './radioVisualizer/sky.js';
import * as vizPrefs from './radioVisualizer/prefs.js';
import * as vizAudio from './radioVisualizer/audioGraph.js';
import { TRAVEL_SPEED } from './radioVisualizer/controls.js';
// Namespace form for the helpers: the facade exposes same-named methods, so a
// bare `setCanvas(...)` inside its own delegation would read confusingly.
import * as vizControls from './radioVisualizer/controls.js';
import * as vizChrome from './radioVisualizer/chrome.js';
import * as vizBackdrop from './radioVisualizer/backdrop.js';
import * as vizPainters from './radioVisualizer/painters.js';
import * as vizScenery from './radioVisualizer/scenery.js';
import * as vizSpaceState from './radioVisualizer/spaceTripState.js';
import * as vizSpaceDraw from './radioVisualizer/spaceTripDraw.js';

const ENERGY_FLOOR = 0.02;
const ENERGY_SILENCE_MS = 1000;

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
        vizPrefs.loadStoredPrefs(this);
    },

    saveStoredPrefs() {
        vizPrefs.saveStoredPrefs(this);
    },

    getLayoutPrefs() {
        return vizPrefs.getLayoutPrefs(this);
    },

    applyStoredLayout(modal) {
        vizPrefs.applyStoredLayout(this, modal);
    },

    applyStoredSettingsToControls(modal) {
        vizPrefs.applyStoredSettingsToControls(this, modal);
    },

    setCanvas(canvas) {
        vizControls.setCanvas(this, canvas);
    },

    setMediaElement(mediaElement) {
        vizControls.setMediaElement(this, mediaElement);
    },

    setSettings(patch = {}, { persist = true } = {}) {
        vizControls.setSettings(this, patch, { persist });
    },

    travelPace() {
        return vizControls.travelPace(this);
    },

    sceneHoldMs(scene) {
        return vizControls.sceneHoldMs(this, scene);
    },

    sceneTransitionMs() {
        return vizControls.sceneTransitionMs(this);
    },

    syncControlLabels() {
        vizControls.syncControlLabels(this);
    },

    syncBpmLabel() {
        vizControls.syncBpmLabel(this);
    },

    updateStatus() {
        vizControls.updateStatus(this);
    },

    dispatchEnabledChange() {
        vizControls.dispatchEnabledChange(this);
    },

    ensureModal() {
        return vizChrome.ensureModal(this);
    },

    bindModalDrag(modal) {
        vizChrome.bindModalDrag(this, modal);
    },

    bindBpmSnap(modal) {
        vizChrome.bindBpmSnap(this, modal);
    },

    bindPanelResize(modal) {
        vizChrome.bindPanelResize(this, modal);
    },

    openModal(options = {}) {
        return vizChrome.openModal(this, options);
    },

    closeModal() {
        vizChrome.closeModal(this);
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
        return vizAudio.ensureAudioGraph(this, mediaElement);
    },

    hasMediaElementSource() {
        return vizAudio.hasMediaElementSource(this);
    },

    releaseGraph() {
        vizAudio.releaseGraph(this);
    },

    async resumeContext() {
        await vizAudio.resumeContext(this);
    },

    async recoverPoisonedGraph() {
        return vizAudio.recoverPoisonedGraph(this);
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
        return vizBackdrop.ensureStars(this, width, height);
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
        vizChrome.bindSettingsToggle(this, modal);
    },

    syncChromeMode() {
        vizChrome.syncChromeMode(this);
    },

    syncPopoutButtons() {
        vizChrome.syncPopoutButtons(this);
    },

    bindChromeActions(modal) {
        vizChrome.bindChromeActions(this, modal);
    },

    saveDockRect() {
        vizChrome.saveDockRect(this);
    },

    restoreDockRect() {
        vizChrome.restoreDockRect(this);
    },

    async popOut() {
        return vizChrome.popOut(this);
    },

    popIn(options = {}) {
        vizChrome.popIn(this, options);
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
        vizBackdrop.fillBackdrop(this, ctx, width, height);
    },

    drawSkyGradient(ctx, width, height, palette, motion = 0.4) {
        vizBackdrop.drawSkyGradient(this, ctx, width, height, palette, motion);
    },

    pickNextMountainScene() {
        return vizScenery.pickNextMountainScene(this);
    },

    ensureMountainWorld(now = Date.now()) {
        return vizScenery.ensureMountainWorld(this, now);
    },

    wrapScreenX(worldX, width, parallax = 1) {
        return vizScenery.wrapScreenX(this, worldX, width, parallax);
    },

    spawnBirds(width, height, now) {
        vizScenery.spawnBirds(this, width, height, now);
    },

    updateAndDrawBirds(ctx, width, height, now, dt, palette, dayness) {
        vizScenery.updateAndDrawBirds(this, ctx, width, height, now, dt, palette, dayness);
    },

    drawSunMoon(ctx, width, height, palette, cycle, motion) {
        vizScenery.drawSunMoon(this, ctx, width, height, palette, cycle, motion);
    },

    drawMountainSky(ctx, width, height, palette, motion, cycle) {
        vizScenery.drawMountainSky(this, ctx, width, height, palette, motion, cycle);
    },

    ridgeYAt(x, width, height, layer, values, phase, t, a, pulse, scroll = 0) {
        return vizScenery.ridgeYAt(this, x, width, height, layer, values, phase, t, a, pulse, scroll);
    },

    drawCactus(ctx, x, groundY, scale, color, variant = 0) {
        vizScenery.drawCactus(this, ctx, x, groundY, scale, color, variant);
    },

    drawTree(ctx, x, groundY, scale, trunk, leaf) {
        vizScenery.drawTree(this, ctx, x, groundY, scale, trunk, leaf);
    },

    drawScrollingDecor(ctx, width, height, scene, frontLayer, values, phase, t, a, pulse, palette, dayness) {
        vizScenery.drawScrollingDecor(this, ctx, width, height, scene, frontLayer, values, phase, t, a, pulse, palette, dayness);
    },

    drawSailboat(ctx, x, waterY, scale, hullColor, sailColor, t = 0) {
        vizScenery.drawSailboat(this, ctx, x, waterY, scale, hullColor, sailColor, t);
    },

    drawShip(ctx, x, waterY, scale, hullColor, accent) {
        vizScenery.drawShip(this, ctx, x, waterY, scale, hullColor, accent);
    },

    drawSurfer(ctx, x, waterY, scale, boardColor, suitColor) {
        vizScenery.drawSurfer(this, ctx, x, waterY, scale, boardColor, suitColor);
    },

    drawSea(ctx, width, height, values, palette, motion, cycle) {
        vizScenery.drawSea(this, ctx, width, height, values, palette, motion, cycle);
    },

    drawTerrainContent(ctx, width, height, values, palette, motion, cycle, scene, a, now) {
        vizScenery.drawTerrainContent(this, ctx, width, height, values, palette, motion, cycle, scene, a, now);
    },

    drawMountains(ctx, width, height, values, palette, motion = 1) {
        vizScenery.drawMountains(this, ctx, width, height, values, palette, motion);
    },

    drawNeonSky(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintNeonSky(this, ctx, width, height, values, palette, motion);
    },

    drawAuroraBands(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintAuroraBands(this, ctx, width, height, values, palette, motion);
    },

    drawBars(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintBars(this, ctx, width, height, values, palette, motion);
    },

    drawParticles(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintParticles(this, ctx, width, height, values, palette, motion);
    },

    drawWaveform(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintWaveform(this, ctx, width, height, values, palette, motion);
    },

    drawWaveformSynth(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintWaveformSynth(this, ctx, width, height, values, palette, motion);
    },

    drawRings(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintRings(this, ctx, width, height, values, palette, motion);
    },

    drawOrb(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintOrb(this, ctx, width, height, values, palette, motion);
    },

    drawSpiral(ctx, width, height, values, palette, motion = 1) {
        vizPainters.paintSpiral(this, ctx, width, height, values, palette, motion);
    },

    spawnSpaceStar() {
        return vizSpaceState.spawnSpaceStar(this);
    },

    getSpaceTripCycleIndex(now, state) {
        return vizSpaceState.getSpaceTripCycleIndex(this, now, state);
    },

    getSpaceTripCruiseElapsed(now, state) {
        return vizSpaceState.getSpaceTripCruiseElapsed(this, now, state);
    },

    isEarthCruise(now, state) {
        return vizSpaceState.isEarthCruise(this, now, state);
    },

    spawnSpaceEarthPlanet() {
        return vizSpaceState.spawnSpaceEarthPlanet(this);
    },

    spawnSpacePlanet(palette, state, now) {
        return vizSpaceState.spawnSpacePlanet(this, palette, state, now);
    },

    getSpaceTripNebulaStrength(now, state) {
        return vizSpaceState.getSpaceTripNebulaStrength(this, now, state);
    },

    drawSpaceTripNebula(ctx, width, height, cx, cy, state, palette, strength, pulse, motion, now) {
        vizSpaceDraw.drawSpaceTripNebula(this, ctx, width, height, cx, cy, state, palette, strength, pulse, motion, now);
    },

    ensureNebulaWisps(state, palette, count = 36) {
        return vizSpaceState.ensureNebulaWisps(this, state, palette, count);
    },

    spawnNebulaWisp() {
        return vizSpaceState.spawnNebulaWisp(this);
    },

    drawSpaceTripNebulaWisps(ctx, cx, cy, fov, state, palette, strength, pulse, viewPanX, viewPanY) {
        vizSpaceDraw.drawSpaceTripNebulaWisps(this, ctx, cx, cy, fov, state, palette, strength, pulse, viewPanX, viewPanY);
    },

    ensureNebulaBlobs(state, palette) {
        return vizSpaceState.ensureNebulaBlobs(this, state, palette);
    },

    getSpaceTripHyperPhase(now, state) {
        return vizSpaceState.getSpaceTripHyperPhase(this, now, state);
    },

    updateSpaceTripRoll(state, now, dt) {
        vizSpaceState.updateSpaceTripRoll(this, state, now, dt);
    },

    updateSpaceTripDodge(state, dt, fov) {
        vizSpaceState.updateSpaceTripDodge(this, state, dt, fov);
    },

    ensureSpaceTripWarp(state) {
        return vizSpaceState.ensureSpaceTripWarp(this, state);
    },

    respawnTunnelRing(warp, ring) {
        vizSpaceState.respawnTunnelRing(this, warp, ring);
    },

    respawnTunnelStreak(streak) {
        vizSpaceState.respawnTunnelStreak(this, streak);
    },

    spaceTripProject(cx, cy, fov, viewPanX, viewPanY, x, y, z) {
        return vizSpaceState.spaceTripProject(this, cx, cy, fov, viewPanX, viewPanY, x, y, z);
    },

    drawSpaceTripTunnel(ctx, width, height, cx, cy, state, palette, hyperMix, motion, pulse, fov, viewPanX, viewPanY) {
        vizSpaceDraw.drawSpaceTripTunnel(this, ctx, width, height, cx, cy, state, palette, hyperMix, motion, pulse, fov, viewPanX, viewPanY);
    },

    drawSpaceEarth(ctx, sx, sy, pr, fade) {
        vizSpaceDraw.drawSpaceEarth(this, ctx, sx, sy, pr, fade);
    },

    drawSpacePlanet(ctx, sx, sy, pr, planet, palette, fade) {
        vizSpaceDraw.drawSpacePlanet(this, ctx, sx, sy, pr, planet, palette, fade);
    },

    ensureSpaceTripState(width, height) {
        return vizSpaceState.ensureSpaceTripState(this, width, height);
    },

    updateSpaceTrip(dt, motion, values) {
        vizSpaceState.updateSpaceTrip(this, dt, motion, values);
    },

    drawSpaceTrip(ctx, width, height, values, palette, motion = 1) {
        vizSpaceDraw.drawSpaceTrip(this, ctx, width, height, values, palette, motion);
    },
};
