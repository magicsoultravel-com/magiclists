/** @tool {"label":"Timer","order":4,"mountClass":"tool-mount--timer","defaultSize":{"w":220},"minSize":{"w":200,"h":168}} */
/** @tool-icon <circle cx="6" cy="6.2" r="3.8" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M6 2.2v1.4M4.2 2.2h3.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/><path d="M6 6.2V4.6" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round"/> */
import { ACTION_ICONS } from '../icons.js';

const STORAGE_MODE = 'timer_mode';
const STORAGE_H = 'timer_countdown_h';
const STORAGE_M = 'timer_countdown_m';
const STORAGE_S = 'timer_countdown_s';
const STORAGE_LAPS_OPEN = 'timer_laps_open';
const STORAGE_SESSION = 'timer_session';
const LAPS_CAP = 50;
const SESSION_SAVE_MS = 1000;

function pad2(n) {
    return String(n).padStart(2, '0');
}

function pad3(n) {
    return String(n).padStart(3, '0');
}

function formatStopwatch(ms) {
    const msVal = Math.max(0, Math.floor(ms));
    const hours = Math.floor(msVal / 3600000);
    const minutes = Math.floor((msVal % 3600000) / 60000);
    const seconds = Math.floor((msVal % 60000) / 1000);
    const millis = msVal % 1000;

    if (hours > 0) {
        return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
    }
    return `${pad2(minutes)}:${pad2(seconds)}.${pad3(millis)}`;
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

function formatChipTime(ms, mode) {
    const totalSec = mode === 'countdown'
        ? Math.ceil(Math.max(0, ms) / 1000)
        : Math.floor(Math.max(0, ms) / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    if (hours > 0) {
        return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
    }
    return `${pad2(minutes)}:${pad2(seconds)}`;
}

function msFromParts(h, m, s) {
    const hours = Math.max(0, Number(h) || 0);
    const mins = Math.max(0, Math.min(59, Number(m) || 0));
    const secs = Math.max(0, Math.min(59, Number(s) || 0));
    return (hours * 3600 + mins * 60 + secs) * 1000;
}

function defaultStopwatchState() {
    return {
        accumulatedMs: 0,
        running: false,
        segmentStart: 0,
        lastLapTotalMs: 0,
        laps: []
    };
}

function defaultCountdownState(h = 0, m = 5, s = 0) {
    return {
        h,
        m,
        s,
        totalMs: msFromParts(h, m, s),
        accumulatedMs: 0,
        running: false,
        segmentStart: 0,
        alertFired: false
    };
}

export const Timer = {
    container: null,
    chipApi: null,
    mode: 'stopwatch',
    stopwatch: defaultStopwatchState(),
    countdown: defaultCountdownState(),
    lapsOpen: false,
    rafId: 0,
    sessionSaveTimer: null,
    pendingExpiredAlert: false,
    onPageHide: null,
    onVisibilityChange: null,

    init(mountElement, chipApi = null) {
        this.container = mountElement;
        this.chipApi = chipApi;
        this.loadPrefs();
        const restored = this.loadSession();
        if (!restored) {
            this.initDefaultState();
        }
        this.bindPageLeave();
        this.render();
        this.syncUi();
        if (this.isActiveRunning()) {
            this.startTick();
        }
        if (this.pendingExpiredAlert) {
            this.pendingExpiredAlert = false;
            this.triggerDoneAlert();
        }
    },

    initDefaultState() {
        const h = this.countdownH ?? 0;
        const m = this.countdownM ?? 5;
        const s = this.countdownS ?? 0;
        this.stopwatch = defaultStopwatchState();
        this.countdown = defaultCountdownState(h, m, s);
        this.syncCountdownPrefsFromState();
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
    },

    syncCountdownPrefsFromState() {
        this.countdownH = this.countdown.h;
        this.countdownM = this.countdown.m;
        this.countdownS = this.countdown.s;
    },

    savePrefs() {
        try {
            localStorage.setItem(STORAGE_MODE, this.mode);
            localStorage.setItem(STORAGE_H, String(this.countdown.h));
            localStorage.setItem(STORAGE_M, String(this.countdown.m));
            localStorage.setItem(STORAGE_S, String(this.countdown.s));
            localStorage.setItem(STORAGE_LAPS_OPEN, this.lapsOpen ? '1' : '0');
        } catch {
            /* ignore */
        }
    },

    getActiveState() {
        return this.mode === 'stopwatch' ? this.stopwatch : this.countdown;
    },

    isActiveRunning() {
        return this.getActiveState().running;
    },

    isAnyRunning() {
        return this.stopwatch.running || this.countdown.running;
    },

    getStopwatchElapsedMs() {
        const sw = this.stopwatch;
        if (!sw.running) return sw.accumulatedMs;
        return sw.accumulatedMs + (performance.now() - sw.segmentStart);
    },

    getCountdownElapsedMs() {
        const cd = this.countdown;
        if (!cd.running) return cd.accumulatedMs;
        return cd.accumulatedMs + (performance.now() - cd.segmentStart);
    },

    getCountdownRemainingMs() {
        return Math.max(0, this.countdown.totalMs - this.getCountdownElapsedMs());
    },

    isCountdownIdle() {
        return !this.countdown.running && this.countdown.accumulatedMs === 0;
    },

    foldStopwatch() {
        const sw = this.stopwatch;
        if (!sw.running) return;
        sw.accumulatedMs = this.getStopwatchElapsedMs();
        sw.running = false;
        sw.segmentStart = 0;
        if (this.mode === 'stopwatch') {
            this.stopTick();
        }
    },

    foldCountdown() {
        const cd = this.countdown;
        if (!cd.running) return;
        cd.accumulatedMs = this.getCountdownElapsedMs();
        cd.running = false;
        cd.segmentStart = 0;
        if (this.mode === 'countdown') {
            this.stopTick();
        }
    },

    saveSession() {
        try {
            const sw = this.stopwatch;
            const cd = this.countdown;
            const swElapsed = sw.running ? this.getStopwatchElapsedMs() : sw.accumulatedMs;
            const cdElapsed = cd.running ? this.getCountdownElapsedMs() : cd.accumulatedMs;
            const cdRemaining = Math.max(0, cd.totalMs - cdElapsed);
            const hasStopwatch = swElapsed > 0 || sw.laps.length > 0;
            const hasCountdown = cd.totalMs > 0 && (cdElapsed > 0 || cd.running || !this.isCountdownIdle());

            if (!hasStopwatch && !hasCountdown) {
                localStorage.removeItem(STORAGE_SESSION);
                return;
            }

            const blob = {
                activeMode: this.mode,
                stopwatch: {
                    accumulatedMs: swElapsed,
                    running: false,
                    lastLapTotalMs: sw.lastLapTotalMs,
                    laps: sw.laps.slice(0, LAPS_CAP)
                },
                countdown: {
                    countdownTotalMs: cd.totalMs,
                    h: cd.h,
                    m: cd.m,
                    s: cd.s,
                    accumulatedMs: cd.running ? Math.max(0, cd.totalMs - cdRemaining) : cd.accumulatedMs,
                    running: cd.running,
                    endAt: cd.running ? Date.now() + cdRemaining : null,
                    alertFired: cd.alertFired
                }
            };

            localStorage.setItem(STORAGE_SESSION, JSON.stringify(blob));
        } catch {
            /* ignore */
        }
    },

    scheduleSaveSession() {
        if (this.sessionSaveTimer) return;
        this.sessionSaveTimer = window.setTimeout(() => {
            this.sessionSaveTimer = null;
            this.saveSession();
        }, SESSION_SAVE_MS);
    },

    loadSession() {
        try {
            const raw = localStorage.getItem(STORAGE_SESSION);
            if (!raw) return false;

            const data = JSON.parse(raw);
            if (!data || typeof data !== 'object') return false;

            if (data.activeMode === 'stopwatch' || data.activeMode === 'countdown') {
                this.mode = data.activeMode;
            }

            if (data.stopwatch && typeof data.stopwatch === 'object') {
                const sw = data.stopwatch;
                this.stopwatch = {
                    accumulatedMs: Math.max(0, Number(sw.accumulatedMs) || 0),
                    running: false,
                    segmentStart: 0,
                    lastLapTotalMs: Math.max(0, Number(sw.lastLapTotalMs) || 0),
                    laps: Array.isArray(sw.laps) ? sw.laps.slice(0, LAPS_CAP) : []
                };
            }

            if (data.countdown && typeof data.countdown === 'object') {
                const cd = data.countdown;
                const h = Math.max(0, parseInt(cd.h, 10) || 0);
                const m = Math.max(0, Math.min(59, parseInt(cd.m, 10) || 0));
                const s = Math.max(0, Math.min(59, parseInt(cd.s, 10) || 0));
                const totalMs = Math.max(0, Number(cd.countdownTotalMs) || msFromParts(h, m, s));

                this.countdown = {
                    h,
                    m,
                    s,
                    totalMs,
                    accumulatedMs: 0,
                    running: false,
                    segmentStart: 0,
                    alertFired: !!cd.alertFired
                };

                if (cd.running && cd.endAt) {
                    const remaining = Number(cd.endAt) - Date.now();
                    if (remaining <= 0) {
                        this.countdown.accumulatedMs = totalMs;
                        this.countdown.alertFired = false;
                        this.pendingExpiredAlert = true;
                    } else {
                        this.countdown.accumulatedMs = totalMs - remaining;
                        this.countdown.running = true;
                        this.countdown.segmentStart = performance.now();
                    }
                } else {
                    this.countdown.accumulatedMs = Math.max(0, Number(cd.accumulatedMs) || 0);
                }
            }

            this.syncCountdownPrefsFromState();
            return true;
        } catch {
            return false;
        }
    },

    bindPageLeave() {
        this.onPageHide = () => this.handlePageLeave();
        this.onVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                this.handlePageLeave();
            }
        };
        window.addEventListener('pagehide', this.onPageHide);
        document.addEventListener('visibilitychange', this.onVisibilityChange);
    },

    unbindPageLeave() {
        if (this.onPageHide) {
            window.removeEventListener('pagehide', this.onPageHide);
            this.onPageHide = null;
        }
        if (this.onVisibilityChange) {
            document.removeEventListener('visibilitychange', this.onVisibilityChange);
            this.onVisibilityChange = null;
        }
    },

    handlePageLeave() {
        if (this.stopwatch.running) {
            this.foldStopwatch();
        }
        this.saveSession();
    },

    render() {
        if (!this.container) return;

        this.container.innerHTML = `
            <div class="tool-stack timer-tool-stack">
                <div class="timer-mode-bar toolbar" role="group" aria-label="Timer mode">
                    <button type="button" class="btn btn--icon timer-mode-btn${this.mode === 'stopwatch' ? ' active' : ''}" data-mode="stopwatch" aria-label="Stopwatch" title="Stopwatch">${ACTION_ICONS.radioRecents}</button>
                    <button type="button" class="btn btn--icon timer-mode-btn${this.mode === 'countdown' ? ' active' : ''}" data-mode="countdown" aria-label="Countdown" title="Countdown">${ACTION_ICONS.clockStyle}</button>
                </div>

                <div class="timer-readout tool-readout" data-timer-readout role="timer" aria-live="polite">00:00.000</div>

                <div class="timer-controls toolbar toolbar--spread">
                    <button type="button" class="btn btn--icon timer-play-btn" aria-label="Start">${ACTION_ICONS.radioPlay}</button>
                    <button type="button" class="btn btn--icon timer-reset-btn" aria-label="Reset">${ACTION_ICONS.layoutReset}</button>
                    <button type="button" class="btn btn--compact timer-lap-btn is-hidden">Lap</button>
                </div>

                <div class="timer-countdown-setup" data-countdown-setup>
                    <div class="timer-duration-row">
                        <label for="timer-h">H</label>
                        <input type="number" id="timer-h" class="form-input timer-duration-input" min="0" max="99" value="${this.countdown.h}">
                        <label for="timer-m">M</label>
                        <input type="number" id="timer-m" class="form-input timer-duration-input" min="0" max="59" value="${this.countdown.m}">
                        <label for="timer-s">S</label>
                        <input type="number" id="timer-s" class="form-input timer-duration-input" min="0" max="59" value="${this.countdown.s}">
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
        if (this.isActiveRunning()) return;
        if (this.mode === mode) return;

        if (this.mode === 'countdown' && this.isCountdownIdle()) {
            this.syncDurationFromInputs();
        }

        this.mode = mode;
        this.savePrefs();
        this.saveSession();
        this.render();
        this.syncUi();
        if (this.isActiveRunning()) {
            this.startTick();
        }
    },

    syncDurationFromInputs() {
        if (this.countdown.running) return;
        const h = this.container?.querySelector('#timer-h')?.value;
        const m = this.container?.querySelector('#timer-m')?.value;
        const s = this.container?.querySelector('#timer-s')?.value;
        this.countdown.h = Math.max(0, parseInt(h, 10) || 0);
        this.countdown.m = Math.max(0, Math.min(59, parseInt(m, 10) || 0));
        this.countdown.s = Math.max(0, Math.min(59, parseInt(s, 10) || 0));
        this.countdown.totalMs = msFromParts(this.countdown.h, this.countdown.m, this.countdown.s);
        this.syncCountdownPrefsFromState();
        this.savePrefs();
        this.saveSession();
        this.syncUi();
    },

    toggleRun() {
        if (this.isActiveRunning()) {
            this.pause();
        } else {
            this.start();
        }
    },

    start() {
        if (this.mode === 'countdown') {
            if (!this.countdown.totalMs) {
                this.syncDurationFromInputs();
            }
            if (!this.countdown.totalMs) return;
            if (this.getCountdownRemainingMs() <= 0) {
                this.resetCountdownState();
            }
            this.countdown.running = true;
            this.countdown.segmentStart = performance.now();
            this.countdown.alertFired = false;
        } else {
            this.stopwatch.running = true;
            this.stopwatch.segmentStart = performance.now();
        }

        this.syncUi();
        this.startTick();
        this.saveSession();
    },

    pause() {
        if (this.mode === 'stopwatch') {
            if (!this.stopwatch.running) return;
            this.foldStopwatch();
        } else {
            if (!this.countdown.running) return;
            this.foldCountdown();
        }
        this.syncUi();
        this.saveSession();
    },

    reset() {
        if (this.mode === 'stopwatch') {
            this.stopwatch = defaultStopwatchState();
        } else {
            this.resetCountdownState();
        }
        this.stopTick();
        this.renderLaps();
        this.saveSession();
        this.syncUi();
    },

    resetCountdownState() {
        if (this.container) {
            this.syncDurationFromInputs();
        }
        this.countdown.accumulatedMs = 0;
        this.countdown.running = false;
        this.countdown.segmentStart = 0;
        this.countdown.alertFired = false;
    },

    addLap() {
        if (this.mode !== 'stopwatch') return;
        const elapsed = this.getStopwatchElapsedMs();
        if (elapsed <= 0) return;

        const sw = this.stopwatch;
        const lapMs = elapsed - sw.lastLapTotalMs;
        sw.lastLapTotalMs = elapsed;
        sw.laps.unshift({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            index: sw.laps.length + 1,
            lapMs,
            totalMs: elapsed
        });
        if (sw.laps.length > LAPS_CAP) {
            sw.laps = sw.laps.slice(0, LAPS_CAP);
        }
        sw.laps.forEach((lap, i) => {
            lap.index = sw.laps.length - i;
        });
        if (!this.lapsOpen) {
            this.lapsOpen = true;
            this.savePrefs();
            this.updateLapsSection();
        }
        this.renderLaps();
        this.saveSession();
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

        if (!this.stopwatch.laps.length) {
            list.innerHTML = '<p class="tool-msg timer-laps-empty">No laps yet</p>';
            return;
        }

        list.innerHTML = this.stopwatch.laps.map((lap) => `
            <div class="timer-lap-row">
                <span class="timer-lap-index">#${lap.index}</span>
                <span class="timer-lap-split">${formatStopwatch(lap.lapMs)}</span>
                <span class="timer-lap-total">${formatStopwatch(lap.totalMs)}</span>
            </div>
        `).join('');
    },

    startTick() {
        this.stopTick();
        const tick = () => {
            this.onTick();
            if (this.isAnyRunning()) {
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
        if (this.countdown.running) {
            const remaining = this.getCountdownRemainingMs();
            if (remaining <= 0) {
                this.countdown.accumulatedMs = this.countdown.totalMs;
                this.countdown.running = false;
                this.countdown.segmentStart = 0;
                if (!this.countdown.alertFired) {
                    this.countdown.alertFired = true;
                    this.triggerDoneAlert();
                }
                if (!this.stopwatch.running) {
                    this.stopTick();
                }
                this.saveSession();
            } else {
                this.scheduleSaveSession();
            }
        } else if (this.stopwatch.running) {
            this.scheduleSaveSession();
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
                readout.textContent = formatStopwatch(this.getStopwatchElapsedMs());
            } else {
                readout.textContent = formatCountdown(this.getCountdownRemainingMs());
            }
        }

        if (playBtn) {
            playBtn.innerHTML = this.isActiveRunning() ? ACTION_ICONS.radioPause : ACTION_ICONS.radioPlay;
            playBtn.setAttribute('aria-label', this.isActiveRunning() ? 'Pause' : 'Start');
        }

        if (lapBtn) {
            const showLap = this.mode === 'stopwatch' && this.getStopwatchElapsedMs() > 0;
            lapBtn.classList.toggle('is-hidden', !showLap);
        }

        if (setup) {
            setup.classList.toggle('is-hidden', this.mode !== 'countdown' || !this.isCountdownIdle());
        }

        if (lapsBlock) {
            lapsBlock.classList.toggle('is-hidden', this.mode !== 'stopwatch');
        }

        modeBtns?.forEach((btn) => {
            btn.disabled = this.isActiveRunning();
            btn.classList.toggle('active', btn.dataset.mode === this.mode);
        });

        this.container?.querySelectorAll('.timer-duration-input').forEach((el) => {
            el.disabled = this.countdown.running;
        });

        this.chipApi?.updateChipReadout?.(this.getChipTimeLabel());
    },

    getChipTimeLabel() {
        if (this.mode === 'stopwatch') {
            return formatChipTime(this.getStopwatchElapsedMs(), 'stopwatch');
        }
        const ms = this.isCountdownIdle() ? this.countdown.totalMs : this.getCountdownRemainingMs();
        return formatChipTime(ms, 'countdown');
    },

    destroy() {
        this.stopTick();
        if (this.sessionSaveTimer) {
            clearTimeout(this.sessionSaveTimer);
            this.sessionSaveTimer = null;
        }
        this.unbindPageLeave();
        this.saveSession();
        this.chipApi?.updateChipReadout?.('');
        this.chipApi = null;
        this.container = null;
    }
};
