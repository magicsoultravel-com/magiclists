// test/radioVisualizerPrefs.test.js
// The prefs/layout helpers moved out of js/radioVisualizer.js into
// js/radioVisualizer/prefs.js. They take the facade as an explicit `viz`
// argument, so they can be exercised here against a plain object with no
// jsdom: the only DOM surfaces touched are style/querySelector/
// getBoundingClientRect on the fake modal plus window.inner*.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    loadStoredPrefs,
    saveStoredPrefs,
    getLayoutPrefs,
    applyStoredLayout,
    applyStoredSettingsToControls
} from '../js/radioVisualizer/prefs.js';
import { VISUALIZER_PREFS_KEY } from '../js/radioVisualizer/settings.js';

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

function withWindow(size, fn) {
    const had = Object.prototype.hasOwnProperty.call(globalThis, 'window');
    const previous = globalThis.window;
    globalThis.window = { innerWidth: size.width, innerHeight: size.height };
    try {
        return fn();
    } finally {
        if (had) globalThis.window = previous;
        else delete globalThis.window;
    }
}

/** Minimal stand-in for the RadioVisualizer facade. */
function makeHost(overrides = {}) {
    const calls = { setSettings: [], resizeCanvas: 0, syncControlLabels: 0 };
    const host = {
        calls,
        settings: { mode: 'mountains', palette: 'horizon', sensitivity: 1, amplitude: 0.55, travel: 0.55, bpm: 120 },
        settingsOpen: false,
        chromeMinimal: false,
        detailsOpen: true,
        enabled: false,
        modal: null,
        savedDockRect: null,
        _storedLayout: null,
        panelWidth: null,
        canvasHeight: null,
        setSettings(patch, options) {
            calls.setSettings.push([patch, options]);
            Object.assign(host.settings, patch);
        },
        resizeCanvas() {
            calls.resizeCanvas += 1;
        },
        syncControlLabels() {
            calls.syncControlLabels += 1;
        }
    };
    return Object.assign(host, overrides);
}

/** Minimal stand-in for the visualizer modal element. */
function makeModal({
    styles = {},
    rect = { left: 40, top: 50, width: 640, height: 300 },
    canvasHeight = 210
} = {}) {
    const canvas = canvasHeight == null
        ? null
        : { style: {}, getBoundingClientRect: () => ({ height: canvasHeight }) };
    const modal = {
        style: { ...styles },
        getBoundingClientRect: () => rect,
        querySelector: (selector) => (selector === '[data-media-visualizer-canvas]' ? canvas : null)
    };
    modal.canvas = canvas;
    return modal;
}

describe('radio visualizer · prefs persistence', () => {
    it('restores stored settings, ui flags and layout', () => {
        const host = makeHost();
        withStorage((store) => {
            store.set(VISUALIZER_PREFS_KEY, JSON.stringify({
                settings: { mode: 'bars' },
                ui: { settingsOpen: true, chromeMinimal: 'nope', detailsOpen: false },
                layout: { left: 12 }
            }));
            loadStoredPrefs(host);
        });
        assert.deepEqual(host.calls.setSettings, [[{ mode: 'bars' }, { persist: false }]]);
        assert.equal(host.settingsOpen, true);
        assert.equal(host.chromeMinimal, false, 'non-boolean ui value is ignored');
        assert.equal(host.detailsOpen, false);
        assert.deepEqual(host._storedLayout, { left: 12 });
    });

    it('ignores junk stored under the prefs key', () => {
        const host = makeHost();
        withStorage((store) => {
            store.set(VISUALIZER_PREFS_KEY, JSON.stringify({ settings: 'x', ui: [], layout: 7 }));
            loadStoredPrefs(host);
        });
        assert.deepEqual(host.calls.setSettings, []);
        assert.equal(host.detailsOpen, true);
        assert.equal(host._storedLayout, null);
    });

    it('writes a full snapshot of settings, ui, layout and open state', () => {
        const host = makeHost({
            settingsOpen: 1,
            chromeMinimal: 0,
            enabled: 'yes',
            savedDockRect: { left: 5, top: 6, width: 700, canvasHeight: 220 }
        });
        let raw;
        withStorage((store) => {
            saveStoredPrefs(host);
            raw = store.get(VISUALIZER_PREFS_KEY);
        });
        assert.deepEqual(JSON.parse(raw), {
            settings: { mode: 'mountains', palette: 'horizon', sensitivity: 1, amplitude: 0.55, travel: 0.55, bpm: 120 },
            ui: { settingsOpen: true, chromeMinimal: false, detailsOpen: true },
            layout: { left: 5, top: 6, width: 700, canvasHeight: 220 },
            open: true
        });
    });
});

describe('radio visualizer · layout prefs', () => {
    it('prefers a saved dock rect and hands back a copy', () => {
        const savedDockRect = { left: 5, top: 6, width: 700, canvasHeight: 220 };
        const layout = getLayoutPrefs(makeHost({ savedDockRect, modal: makeModal() }));
        assert.deepEqual(layout, savedDockRect);
        assert.notEqual(layout, savedDockRect);
    });

    it('falls back to the stored layout without a modal, else {}', () => {
        assert.deepEqual(getLayoutPrefs(makeHost({ _storedLayout: { left: 9 } })), { left: 9 });
        assert.deepEqual(getLayoutPrefs(makeHost()), {});
    });

    it('reads live geometry off the open modal', () => {
        assert.deepEqual(getLayoutPrefs(makeHost({ modal: makeModal() })), {
            left: 40, top: 50, width: 640, canvasHeight: 210
        });

        const positioned = makeModal({ styles: { left: '12px', top: '34px' } });
        assert.deepEqual(
            getLayoutPrefs(makeHost({ modal: positioned, panelWidth: 800, canvasHeight: 240 })),
            { left: 12, top: 34, width: 800, canvasHeight: 240 }
        );

        const noCanvas = makeModal({ canvasHeight: null });
        assert.equal(getLayoutPrefs(makeHost({ modal: noCanvas })).canvasHeight, 200);
    });
});

describe('radio visualizer · layout + control restore', () => {
    it('clamps a restored layout into the viewport', () => {
        const modal = makeModal();
        const host = makeHost({ modal, _storedLayout: { width: 5000, canvasHeight: 10, left: -50, top: 5000 } });
        withWindow({ width: 1200, height: 800 }, () => applyStoredLayout(host, modal));

        assert.equal(modal.style.width, '1100px'); // clamped high
        assert.equal(modal.style.left, '8px'); // clamped to margin
        assert.equal(modal.style.top, '740px'); // 800 - 60
        assert.equal(modal.canvas.style.height, '120px'); // clamped low
        assert.equal(host.panelWidth, 1100);
        assert.equal(host.canvasHeight, 120);
        assert.equal(host.calls.resizeCanvas, 1);
    });

    it('applies defaults and leaves unknown positions alone', () => {
        const modal = makeModal();
        const host = makeHost({ modal, _storedLayout: {} });
        applyStoredLayout(host, modal);

        assert.equal(modal.style.width, '720px');
        assert.equal(modal.style.left, undefined); // no left stored → untouched
        assert.equal(modal.style.top, undefined);
        assert.equal(modal.canvas.style.height, '200px');
        assert.equal(host.calls.resizeCanvas, 1);
    });

    it('no-ops without a stored layout or a modal', () => {
        const noLayout = makeHost({ _storedLayout: null });
        applyStoredLayout(noLayout, makeModal());
        assert.equal(noLayout.calls.resizeCanvas, 0);

        const noModal = makeHost({ _storedLayout: { width: 500 } });
        applyStoredLayout(noModal, null);
        assert.equal(noModal.calls.resizeCanvas, 0);
        assert.equal(noModal.panelWidth, null);
    });

    it('pushes stored settings into the modal controls', () => {
        const elements = new Map([
            ['[data-media-visualizer-mode]', { value: '' }],
            ['[data-media-visualizer-palette]', { value: '' }],
            ['[data-media-visualizer-sensitivity]', { value: '' }],
            ['[data-media-visualizer-amplitude]', { value: '' }],
            ['[data-media-visualizer-travel]', { value: '' }],
            ['[data-media-visualizer-bpm]', { value: '' }]
        ]);
        const modal = { querySelector: (selector) => elements.get(selector) || null };
        const host = makeHost({
            settings: { mode: 'bars', palette: 'ocean', sensitivity: 1.4, amplitude: 0.8, travel: 0.25, bpm: 90 }
        });

        applyStoredSettingsToControls(host, modal);

        assert.equal(elements.get('[data-media-visualizer-mode]').value, 'bars');
        assert.equal(elements.get('[data-media-visualizer-palette]').value, 'ocean');
        assert.equal(elements.get('[data-media-visualizer-sensitivity]').value, '1.4');
        assert.equal(elements.get('[data-media-visualizer-amplitude]').value, '0.8');
        assert.equal(elements.get('[data-media-visualizer-travel]').value, '0.25');
        assert.equal(elements.get('[data-media-visualizer-bpm]').value, '90');
        assert.equal(host.calls.syncControlLabels, 1);
    });

    it('still syncs labels when the controls are missing', () => {
        const host = makeHost();
        applyStoredSettingsToControls(host, { querySelector: () => null });
        assert.equal(host.calls.syncControlLabels, 1);
    });
});
