/** @tool {"label":"Timer","order":4,"mountClass":"tool-mount--timer","defaultSize":{"w":280},"minSize":{"w":220,"h":168}} */
/** @tool-icon <circle cx="6" cy="6.2" r="3.8" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 2.2v1.4M4.2 2.2h3.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/><path d="M6 6.2V4.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/> */
import { ACTION_ICONS } from '../icons.js';

const STORAGE_MODE = 'timer_mode';
const STORAGE_H = 'timer_countdown_h';
const STORAGE_M = 'timer_countdown_m';
const STORAGE_S = 'timer_countdown_s';
const STORAGE_LAPS_OPEN = 'timer_laps_open';
const LAPS_CAP = 50;

const PRESETS = [
    { label: '5m', ms: 5 * 60 * 1000 },
    { label: '15m', ms: 15 * 60 * 1000 },
    { label: '25m', ms: 25 * 60 * 1000 },
    { label: '1h', ms: 60 * 60 * 1000 }
];

function pad2(n) {
    return String(n).padStart(2, '0');
}

function formatStopwatch(ms, showCentis) {
    const totalSec = Math.max(0, ms) / 1000;
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = Math.floor(totalSec % 60);
    const centis = Math.floor((ms % 1000) / 10);

    if (hours > 0) {
        return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }
    if (showCentis) {
        return `${pad2(minutes)}:${pad2(seconds)}.${pad2(centis)}`;
    }
    return `${pad2(minutes)}:${pad2(seconds)}`;
}

function formatCountdown(ms) {
    const totalSec = Math.ceil(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    if (hours > 0) {
        return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    }
    return `${pad2(minutes)}:${pad2(seconds)}`;
}

function msFromParts(h, m, s) {
    const hours = Math.max(0, Number(h) || 0);
    const mins = Math.max(0, Math.min(59, Number(m) || 0));
    const secs = Math.max(0, Math.min(59, Number(s) || 0));
    return (hours * 3600 + mins * 60 + secs) * 1000;
}

function partsFromMs(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    return {
        h: Math.floor(totalSec / 3600),
        m: Math.floor((totalSec % 3600) / 60),
        s: totalSec % 60
    };
}

export const Timer = {
    container: null,
    mode: 'stopwatch',
    running: false,
    accumulatedMs: 0,
    segmentStart: 0,
    countdownTotalMs: 0,
    laps: [],
    lastLapTotalMs: 0,
    lapsOpen: false,
    alertFired: false,
    rafId: 0,
    countdownH: 0,
    countdownM: 5,
    countdownS: 0,

    init(mountElement) {
        this.container = mountElement;
        this.loadPrefs();
        this.resetEngine(false);
        this.render();
        this.syncUi();
    },

    loadPrefs() {
        try {
            const mode = localStorage.getItem(STORAGE_MODE);
            if (mode === 'stopwatch' || mode === 'countdown') this.mode = mode;
            this.countdownH = Math.max(0, parseInt(localStorage.getItem(STORAGE_H) || '0', 10) || 0);
            this.countdownM = Math.max(0, parseInt(localStorage.getItem(STORAGE_M) || '5', 10) || 0);
            this.countdownS = Math.max(0, parseInt(localStorage.getItem(STORAGE_S) || '0', 10) || 0);
            this.lapsOpen = localStorage.getItem(STORAGE_LAPS_OPEN) === '1';
        } catch {
            /* ignore */
        }
        this.countdownTotalMs = msFromParts(this.countdownH, this.countdownM, this.countdownS);
    },

    savePrefs() {
        try {
            localStorage.setItem(STORAGE_MODE, this.mode);
            localStorage.setItem(STORAGE_H, String(this.countdownH));
            localStorage.setItem(STORAGE_M, String(this.countdownM));
            localStorage.setItem(STORAGE_S, String(this.countdownS));
            localStorage.setItem(STORAGE_LAPS_OPEN, this.lapsOpen ? '1' : '0');
        } catch {
            /* ignore */
        }
    },

    resetEngine(clearLaps = true) {
        this.stopTick();
        this.running = false;
        this.accumulatedMs = 0;
        this.segmentStart = 0;
        this.lastLapTotalMs = 0;
        this.alertFired = false;
        if (clearLaps) this.laps = [];
        if (this.mode === 'countdown' && !this.countdownTotalMs) {
            this.countdownTotalMs = msFromParts(this.countdownH, this.countdownM, this.countdownS);
        }
    },

    getElapsedMs() {
        if (!this.running) return this.accumulatedMs;
        return this.accumulatedMs + (performance.now() - this.segmentStart);
    },

    getRemainingMs() {
        return Math.max(0, this.countdownTotalMs - this.getElapsedMs());
    },

    render() {
        if (!this.container) return;

        const presetButtons = PRESETS.map((preset) => `
            <button type="button" class="btn btn--compact timer-preset-btn" data-ms="${preset.ms}">${preset.label}</button>
        `).join('');

        this.container.innerHTML = `
            <div class="tool-stack timer-tool-stack">
                <div class="timer-mode-bar toolbar toolbar--spread" role="group" aria-label="Timer mode">
                    <button type="button" class="btn btn--compact timer-mode-btn${this.mode === 'stopwatch' ? ' active' : ''}" data-mode="stopwatch">Stopwatch</button>
                    <button type="button" class="btn btn--compact timer-mode-btn${this.mode === 'countdown' ? ' active' : ''}" data-mode="countdown">Countdown</button>
                </div>

                <div class="timer-readout tool-readout" data-timer-readout role="timer" aria-live="polite">00:00.00</div>

                <div class="timer-controls toolbar toolbar--spread">
                    <button type="button" class="btn btn--icon timer-play-btn" aria-label="Start">${ACTION_ICONS.radioPlay}</button>
                    <button type="button" class="btn btn--icon timer-reset-btn" aria-label="Reset">${ACTION_ICONS.layoutReset}</button>
                    <button type="button" class="btn btn--compact timer-lap-btn is-hidden">Lap</button>
                </div>

                <div class="timer-countdown-setup" data-countdown-setup>
                    <div class="timer-presets">${presetButtons}</div>
                    <div class="timer-duration-grid">
                        <div class="form-group">
                            <label for="timer-h">H</label>
                            <input type="number" id="timer-h" class="form-input timer-duration-input" min="0" max="99" value="${this.countdownH}">
                        </div>
                        <div class="form-group">
                            <label for="timer-m">M</label>
                            <input type="number" id="timer-m" class="form-input timer-duration-input" min="0" max="59" value="${this.countdownM}">
                        </div>
                        <div class="form-group">
                            <label for="timer-s">S</label>
                            <input type="number" id="timer-s" class="form-input timer-duration-input" min="0" max="59" value="${this.countdownS}">
                        </div>
                    </div>
                </div>

                <div class="timer-laps-block" data-laps-block>
                    <div class="collapsable-header" id="timer-laps-header" role="button" tabindex="0" aria-expanded="${this.lapsOpen ? 'true' : 'false'}">
                        <span class="collapsable-heading">
                            <span class="collapsable-toggle${this.lapsOpen ? '' : ' collapsed'}" id="timer-laps-toggle">▼</span>Laps
                        </span>
                    </div>
                    <div class="collapsable-section timer-laps-section${this.lapsOpen ? '' : ' collapsed'}" id="timer-laps-section">
                        <div class="timer-laps" data-timer-laps aria-label="Lap times"></div>
                    </div>
                </div>
            </div>
        `;

        this.bindEvents();
        this.renderLaps();
    },

    bindEvents() {
        this.container.querySelectorAll('.timer-mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
        });

        this.container.querySelector('.timer-play-btn')?.addEventListener('click', () => this.toggleRun());
        this.container.querySelector('.timer-reset-btn')?.addEventListener('click', () => this.reset());
        this.container.querySelector('.timer-lap-btn')?.addEventListener('click', () => this.addLap());

        this.container.querySelectorAll('.timer-preset-btn').forEach((btn) => {
            btn.addEventListener('click', () => this.applyPreset(Number(btn.dataset.ms)));
        });

        ['timer-h', 'timer-m', 'timer-s'].forEach((id) => {
            this.container.querySelector(`#${id}`)?.addEventListener('input', () => this.syncDurationFromInputs());
        });

        const lapsHeader = this.container.querySelector('#timer-laps-header');
        lapsHeader?.addEventListener('click', () => this.toggleLaps());
        lapsHeader?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.toggleLaps();
            }
        });
    },

    setMode(mode) {
        if (mode !== 'stopwatch' && mode !== 'countdown') return;
        if (this.running) return;
        if (this.mode === mode) return;
        this.mode = mode;
        this.resetEngine(true);
        this.savePrefs();
        this.render();
        this.syncUi();
    },

    applyPreset(ms) {
        if (this.running) return;
        const parts = partsFromMs(ms);
        this.countdownH = parts.h;
        this.countdownM = parts.m;
        this.countdownS = parts.s;
        this.countdownTotalMs = ms;
        this.savePrefs();
        this.render();
        this.syncUi();
    },

    syncDurationFromInputs() {
        if (this.running) return;
        const h = this.container.querySelector('#timer-h')?.value;
        const m = this.container.querySelector('#timer-m')?.value;
        const s = this.container.querySelector('#timer-s')?.value;
        this.countdownH = Math.max(0, parseInt(h, 10) || 0);
        this.countdownM = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
        this.countdownS = Math.max(0, Math.min(59, parseInt(s, 10) || 0));
        this.countdownTotalMs = msFromParts(this.countdownH, this.countdownM, this.countdownS);
        this.savePrefs();
        this.syncUi();
    },

    toggleRun() {
        if (this.running) {
            this.pause();
        } else {
            this.start();
        }
    },

    start() {
        if (this.mode === 'countdown') {
            if (!this.countdownTotalMs) {
                this.syncDurationFromInputs();
            }
            if (!this.countdownTotalMs) return;
            if (this.getRemainingMs() <= 0) {
                this.resetEngine(true);
            }
        }

        this.running = true;
        this.segmentStart = performance.now();
        this.alertFired = false;
        this.syncUi();
        this.startTick();
    },

    pause() {
        if (!this.running) return;
        this.accumulatedMs = this.getElapsedMs();
        this.running = false;
        this.segmentStart = 0;
        this.stopTick();
        this.syncUi();
    },

    reset() {
        this.resetEngine(true);
        this.syncUi();
    },

    addLap() {
        if (this.mode !== 'stopwatch') return;
        const elapsed = this.getElapsedMs();
        if (elapsed <= 0) return;

        const lapMs = elapsed - this.lastLapTotalMs;
        this.lastLapTotalMs = elapsed;
        this.laps.unshift({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            index: this.laps.length + 1,
            lapMs,
            totalMs: elapsed
        });
        if (this.laps.length > LAPS_CAP) {
            this.laps = this.laps.slice(0, LAPS_CAP);
        }
        this.laps.forEach((lap, i) => {
            lap.index = this.laps.length - i;
        });
        if (!this.lapsOpen) {
            this.lapsOpen = true;
            this.savePrefs();
            this.updateLapsSection();
        }
        this.renderLaps();
    },

    toggleLaps() {
        this.lapsOpen = !this.lapsOpen;
        this.savePrefs();
        this.updateLapsSection();
    },

    updateLapsSection() {
        const section = this.container?.querySelector('#timer-laps-section');
        const toggle = this.container?.querySelector('#timer-laps-toggle');
        const header = this.container?.querySelector('#timer-laps-header');
        section?.classList.toggle('collapsed', !this.lapsOpen);
        toggle?.classList.toggle('collapsed', !this.lapsOpen);
        header?.classList.toggle('is-expanded', this.lapsOpen);
        header?.setAttribute('aria-expanded', this.lapsOpen ? 'true' : 'false');
    },

    renderLaps() {
        const list = this.container?.querySelector('[data-timer-laps]');
        if (!list) return;

        if (!this.laps.length) {
            list.innerHTML = '<p class="tool-msg timer-laps-empty">No laps yet</p>';
            return;
        }

        list.innerHTML = this.laps.map((lap) => `
            <div class="timer-lap-row">
                <span class="timer-lap-index">#${lap.index}</span>
                <span class="timer-lap-split">${formatStopwatch(lap.lapMs, false)}</span>
                <span class="timer-lap-total">${formatStopwatch(lap.totalMs, false)}</span>
            </div>
        `).join('');
    },

    startTick() {
        this.stopTick();
        const tick = () => {
            this.onTick();
            if (this.running) {
                this.rafId = requestAnimationFrame(tick);
            }
        };
        this.rafId = requestAnimationFrame(tick);
    },

    stopTick() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = 0;
        }
    },

    onTick() {
        if (this.mode === 'countdown') {
            const remaining = this.getRemainingMs();
            if (remaining <= 0) {
                this.accumulatedMs = this.countdownTotalMs;
                this.running = false;
                this.segmentStart = 0;
                this.stopTick();
                if (!this.alertFired) {
                    this.alertFired = true;
                    this.triggerDoneAlert();
                }
            }
        }
        this.syncUi();
    },

    triggerDoneAlert() {
        this.playBeep();
        const readout = this.container?.querySelector('[data-timer-readout]');
        readout?.classList.add('timer-readout--done');
        window.setTimeout(() => {
            readout?.classList.remove('timer-readout--done');
        }, 2400);
    },

    playBeep() {
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            const ctx = new Ctx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.value = 0.07;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.28);
            osc.stop(ctx.currentTime + 0.3);
            window.setTimeout(() => ctx.close?.(), 400);
        } catch {
            /* audio blocked or unavailable */
        }
    },

    syncUi() {
        const readout = this.container?.querySelector('[data-timer-readout]');
        const playBtn = this.container?.querySelector('.timer-play-btn');
        const lapBtn = this.container?.querySelector('.timer-lap-btn');
        const setup = this.container?.querySelector('[data-countdown-setup]');
        const lapsBlock = this.container?.querySelector('[data-laps-block]');
        const modeBtns = this.container?.querySelectorAll('.timer-mode-btn');

        if (readout) {
            if (this.mode === 'stopwatch') {
                readout.textContent = formatStopwatch(this.getElapsedMs(), this.running);
            } else {
                readout.textContent = formatCountdown(this.getRemainingMs());
            }
        }

        if (playBtn) {
            playBtn.innerHTML = this.running ? ACTION_ICONS.radioPause : ACTION_ICONS.radioPlay;
            playBtn.setAttribute('aria-label', this.running ? 'Pause' : 'Start');
        }

        if (lapBtn) {
            const showLap = this.mode === 'stopwatch' && this.getElapsedMs() > 0;
            lapBtn.classList.toggle('is-hidden', !showLap);
        }

        if (setup) {
            const idle = !this.running && this.getElapsedMs() === 0;
            setup.classList.toggle('is-hidden', this.mode !== 'countdown' || !idle);
        }

        if (lapsBlock) {
            lapsBlock.classList.toggle('is-hidden', this.mode !== 'stopwatch');
        }

        modeBtns?.forEach((btn) => {
            btn.disabled = this.running;
            btn.classList.toggle('active', btn.dataset.mode === this.mode);
        });

        this.container?.querySelectorAll('.timer-preset-btn, .timer-duration-input').forEach((el) => {
            el.disabled = this.running;
        });
    },

    destroy() {
        this.stopTick();
        this.container = null;
    }
};
