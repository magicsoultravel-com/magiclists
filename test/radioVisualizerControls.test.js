// test/radioVisualizerControls.test.js
// Settings normalization, scene timing, control labels and status text moved
// out of js/radioVisualizer.js into js/radioVisualizer/controls.js. The helpers
// take the facade as an explicit `viz` argument, so they run here against plain
// objects plus stubbed RadioPlayer/localStorage (no jsdom).
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SCENE_HOLD_MS,
    SEA_HOLD_MS,
    SCENE_TRANSITION_MS,
    setCanvas,
    setMediaElement,
    setSettings,
    travelPace,
    sceneHoldMs,
    sceneTransitionMs,
    syncControlLabels,
    syncBpmLabel,
    updateStatus,
    dispatchEnabledChange
} from '../js/radioVisualizer/controls.js';
import { DEFAULTS, VISUALIZER_PREFS_KEY } from '../js/radioVisualizer/settings.js';
import { RadioPlayer } from '../js/radioPlayer.js';

function withWindow(win, fn) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const previous = globalThis.window;
    globalThis.window = win;
    try {
        return fn();
    } finally {
        if (had) globalThis.window = previous;
        else delete globalThis.window;
    }
}

async function withRadioPlayer(patch, fn) {
    const saved = {};
    for (const [key, value] of Object.entries(patch)) {
        saved[key] = RadioPlayer[key];
        RadioPlayer[key] = value;
    }
    try {
        return await fn();
    } finally {
        Object.assign(RadioPlayer, saved);
    }
}

function withStorage(fn) {
    const store = new Map();
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
    const previous = globalThis.localStorage;
    globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => store.set(key, String(value))
    };
    try {
        return fn(store);
    } finally {
        if (had) globalThis.localStorage = previous;
        else delete globalThis.localStorage;
    }
}

/** A DOM-ish control that counts writes, so "only when different" is provable. */
function control(initial = '') {
    let value = initial;
    return {
        writes: 0,
        get value() {
            return value;
        },
        set value(next) {
            value = next;
            this.writes += 1;
        },
        reset() {
            this.writes = 0;
        }
    };
}

function makeControlsModal() {
    const elements = new Map([
        ['[data-media-visualizer-bpm-label]', { textContent: '' }],
        ['[data-media-visualizer-bpm]', control('')],
        ['[data-media-visualizer-amplitude-label]', { textContent: '' }],
        ['[data-media-visualizer-amplitude]', control('')],
        ['[data-media-visualizer-travel-label]', { textContent: '' }],
        ['[data-media-visualizer-travel]', control('')],
        ['[data-media-visualizer-status]', { textContent: '', dataset: {} }]
    ]);
    const get = (selector) => elements.get(selector);
    return { modal: { querySelector: (selector) => get(selector) || null }, get };
}

/** Minimal stand-in for the RadioVisualizer facade. */
function makeHost(overrides = {}) {
    const calls = { resizeCanvas: 0, drawIdleFrame: 0 };
    const host = {
        calls,
        canvas: null,
        context: null,
        settings: { ...DEFAULTS },
        spaceTrip: null,
        enabled: false,
        modal: null,
        analysisLive: false,
        analysisBlocked: false,
        source: null,
        mediaElement: null,
        resizeCanvas() {
            calls.resizeCanvas += 1;
        },
        drawIdleFrame() {
            calls.drawIdleFrame += 1;
        }
    };
    return Object.assign(host, overrides);
}

describe('radio visualizer · canvas + media wiring', () => {
    it('stores the canvas and its 2d context, then sizes and paints', () => {
        const context = { name: 'ctx' };
        const canvas = { getContext: (kind) => (kind === '2d' ? context : null) };
        const host = makeHost();

        setCanvas(host, canvas);

        assert.equal(host.canvas, canvas);
        assert.equal(host.context, context);
        assert.equal(host.calls.resizeCanvas, 1);
        assert.equal(host.calls.drawIdleFrame, 1);
    });

    it('keeps a null context when getContext fails, and no-ops on null', () => {
        const canvas = { getContext: () => null };
        const host = makeHost();
        setCanvas(host, canvas);
        assert.equal(host.context, null);
        assert.equal(host.calls.drawIdleFrame, 1, 'canvas present → still paints');

        const empty = makeHost();
        setCanvas(empty, null);
        assert.equal(empty.canvas, null);
        assert.equal(empty.context, null);
        assert.equal(empty.calls.resizeCanvas, 0);
        assert.equal(empty.calls.drawIdleFrame, 0);
    });

    it('prefers the given element, then RadioPlayer fallbacks', async () => {
        const direct = { id: 'direct' };
        const fromGetter = { id: 'getter' };
        const host = makeHost();
        await withRadioPlayer({ getAudioElement: () => fromGetter, audio: { id: 'prop' } }, async () => {
            setMediaElement(host, direct);
            assert.equal(host.mediaElement, direct);
            setMediaElement(host, null);
            assert.equal(host.mediaElement, fromGetter);
        });

        const propOnly = makeHost();
        await withRadioPlayer({ getAudioElement: () => null, audio: { id: 'prop' } }, async () => {
            setMediaElement(propOnly);
            assert.deepEqual(propOnly.mediaElement, { id: 'prop' });
        });
    });

    it('paints the idle frame when a canvas is attached', async () => {
        const host = makeHost({ canvas: { tag: 'canvas' } });
        await withRadioPlayer({ getAudioElement: () => null, audio: null }, async () => {
            setMediaElement(host, { id: 'audio' });
        });
        assert.equal(host.calls.drawIdleFrame, 1);
    });

    it('releases a stale graph when the media element changes', async () => {
        const staleSource = { mediaElement: { id: 'old' }, disconnect() {} };
        const host = makeHost({ source: staleSource, mediaElement: { id: 'old' } });
        await withRadioPlayer({ getAudioElement: () => null, audio: null }, async () => {
            setMediaElement(host, { id: 'new' });
        });
        assert.equal(host.source, null, 'stale source released');
        // Quirk locked in: releaseGraph() nulls mediaElement, so the element
        // that was just handed in is not retained.
        assert.equal(host.mediaElement, null);
    });
});

describe('radio visualizer · settings normalization', () => {
    it('clamps every numeric setting into range', () => {
        const host = makeHost();
        setSettings(host, {
            sensitivity: 99,
            amplitude: -5,
            density: 0,
            speed: 'nope',
            travel: 9,
            glow: 2,
            bpm: 500
        }, { persist: false });

        assert.equal(host.settings.sensitivity, 2.5);
        assert.equal(host.settings.amplitude, 0.15);
        assert.equal(host.settings.density, 1, '0 is falsy → falls back to 1');
        assert.equal(host.settings.speed, 1, 'NaN is falsy → falls back to 1');
        assert.equal(host.settings.travel, 1.25);
        assert.equal(host.settings.glow, 1.5);
        assert.equal(host.settings.bpm, 200);
        assert.equal(host.settings.mode, DEFAULTS.mode, 'untouched keys survive');
        assert.equal(host.settings.palette, DEFAULTS.palette);
    });

    it('clears the space trip only on a real mode change', () => {
        const host = makeHost({ spaceTrip: { startedAt: 1 } });
        setSettings(host, { mode: DEFAULTS.mode }, { persist: false });
        assert.deepEqual(host.spaceTrip, { startedAt: 1 });

        setSettings(host, { mode: 'bars' }, { persist: false });
        assert.equal(host.spaceTrip, null);
        assert.equal(host.settings.mode, 'bars');
    });

    it('repaints labels and the idle frame only while closed', () => {
        const { modal, get } = makeControlsModal();
        const host = makeHost({ modal, canvas: {} });
        setSettings(host, { bpm: 150, amplitude: 0.8 }, { persist: false });
        assert.equal(get('[data-media-visualizer-bpm-label]').textContent, 'BPM: 150');
        assert.equal(get('[data-media-visualizer-amplitude-label]').textContent, 'Amplitude: 0.80');
        assert.equal(host.calls.drawIdleFrame, 1);

        const running = makeHost({ modal, canvas: {}, enabled: true });
        setSettings(running, { bpm: 90 }, { persist: false });
        assert.equal(running.calls.drawIdleFrame, 0, 'live render loop owns the canvas');
    });

    it('persists by default but not when asked to skip', () => {
        withStorage((store) => {
            setSettings(makeHost(), { bpm: 150 });
            assert.equal(JSON.parse(store.get(VISUALIZER_PREFS_KEY)).settings.bpm, 150);

            store.clear();
            setSettings(makeHost(), { bpm: 150 }, { persist: false });
            assert.equal(store.has(VISUALIZER_PREFS_KEY), false);
        });
    });
});
describe('radio visualizer · scene timing', () => {
    it('derives travel pace from the clamped travel setting', () => {
        assert.equal(travelPace(makeHost()), 0.55);
        assert.equal(travelPace(makeHost({ settings: { ...DEFAULTS, travel: 1.25 } })), 1.25);
        assert.equal(travelPace(makeHost({ settings: { ...DEFAULTS, travel: 0 } })), 0.55, '0 is falsy → base pace');
        assert.equal(travelPace(makeHost({ settings: { ...DEFAULTS, travel: 99 } })), 1.25);
    });

    it('scales land/sea holds and transitions by travel pace', () => {
        const base = makeHost({ settings: { ...DEFAULTS, travel: 1 } });
        assert.equal(sceneHoldMs(base, 'cactus'), SCENE_HOLD_MS);
        assert.equal(sceneHoldMs(base, 'forest'), SCENE_HOLD_MS);
        assert.equal(sceneHoldMs(base, 'sea'), SEA_HOLD_MS);
        assert.equal(sceneTransitionMs(base), SCENE_TRANSITION_MS);

        const slow = makeHost({ settings: { ...DEFAULTS, travel: 0.25 } });
        assert.equal(sceneHoldMs(slow, 'cactus'), SCENE_HOLD_MS / 0.25);
        assert.equal(sceneTransitionMs(slow), SCENE_TRANSITION_MS / 0.25);
    });
});

describe('radio visualizer · labels + status', () => {
    it('writes labels and syncs sliders that disagree', () => {
        const { modal, get } = makeControlsModal();
        const host = makeHost({ modal });

        syncControlLabels(host);

        assert.equal(get('[data-media-visualizer-bpm-label]').textContent, 'BPM: 120');
        assert.equal(get('[data-media-visualizer-amplitude-label]').textContent, 'Amplitude: 0.55');
        assert.equal(get('[data-media-visualizer-travel-label]').textContent, 'Travel: 0.55×');
        assert.equal(get('[data-media-visualizer-bpm]').value, '120');
        assert.equal(get('[data-media-visualizer-amplitude]').value, '0.55');
        assert.equal(get('[data-media-visualizer-travel]').value, '0.55');
    });

    it('leaves sliders alone when they already match', () => {
        const { modal, get } = makeControlsModal();
        get('[data-media-visualizer-bpm]').value = '120';
        get('[data-media-visualizer-amplitude]').value = '0.55';
        get('[data-media-visualizer-travel]').value = '0.55';
        for (const selector of ['bpm', 'amplitude', 'travel']) {
            get(`[data-media-visualizer-${selector}]`).reset();
        }

        syncControlLabels(makeHost({ modal }));

        assert.equal(get('[data-media-visualizer-bpm]').writes, 0);
        assert.equal(get('[data-media-visualizer-amplitude]').writes, 0);
        assert.equal(get('[data-media-visualizer-travel]').writes, 0);
    });

    it('tolerates a missing modal, and syncBpmLabel delegates', () => {
        const bare = makeHost();
        syncControlLabels(bare);
        syncBpmLabel(bare);

        const { modal, get } = makeControlsModal();
        get('[data-media-visualizer-bpm-label]').textContent = 'stale';
        syncBpmLabel(makeHost({ modal }));
        assert.equal(get('[data-media-visualizer-bpm-label]').textContent, 'BPM: 120');
    });

    it('reports status for each state', async () => {
        const { modal, get } = makeControlsModal();
        const status = get('[data-media-visualizer-status]');
        const withStatus = (over) => makeHost({ modal, ...over });

        // RadioPlayer starts with analysisAvailable === false (unknown until a
        // station loads), so pin it true here to isolate viz.analysisBlocked.
        await withRadioPlayer({ analysisAvailable: true }, async () => {
            updateStatus(makeHost()); // no modal → silent
            assert.equal(status.textContent, '');

            updateStatus(withStatus({ enabled: false }));
            assert.equal(status.textContent, '');
            assert.equal(status.dataset.state, undefined);

            updateStatus(withStatus({ enabled: true, analysisLive: true }));
            assert.equal(status.textContent, 'Live audio');
            assert.equal(status.dataset.state, 'live');

            updateStatus(withStatus({ enabled: true, analysisBlocked: true }));
            assert.equal(status.textContent, 'This station blocks analysis — match BPM manually');
            assert.equal(status.dataset.state, 'blocked');

            updateStatus(withStatus({ enabled: true }));
            assert.equal(status.textContent, 'Listening for audio…');
            assert.equal(status.dataset.state, 'pending');
        });
    });

    it('treats RadioPlayer.analysisAvailable === false as blocked', async () => {
        const { modal, get } = makeControlsModal();
        await withRadioPlayer({ analysisAvailable: false }, async () => {
            updateStatus(makeHost({ modal, enabled: true }));
        });
        assert.equal(get('[data-media-visualizer-status]').dataset.state, 'blocked');

        const { modal: other, get: getOther } = makeControlsModal();
        await withRadioPlayer({ analysisAvailable: true }, async () => {
            updateStatus(makeHost({ modal: other, enabled: true }));
        });
        assert.equal(getOther('[data-media-visualizer-status]').dataset.state, 'pending');
    });

    it('dispatches the enabled change on window', () => {
        const events = [];
        withWindow({ dispatchEvent: (event) => events.push(event) }, () => {
            dispatchEnabledChange(makeHost({ enabled: true }));
        });
        assert.equal(events.length, 1);
        assert.equal(events[0].type, 'radio:visualizer_changed');
        assert.deepEqual(events[0].detail, { enabled: true });
    });
});

