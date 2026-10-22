// test/sidebarModulePrefs.test.js
// Display Options → Sidebar → Modules: preference normalisation, the
// `<html data-sidebar-hidden>` DOM mirror and the start/stop lifecycle that
// keeps radio/TV/weather idle while a module is hidden.
// Run with: npm test
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    applySidebarModuleVisibilityDom,
    DEFAULT_SIDEBAR_MODULES,
    normalizeSidebarModules,
    readSidebarModules,
    registerSidebarModuleLifecycle,
    resetSidebarModuleLifecycleRegistry,
    sidebarHiddenAttrValue,
    SIDEBAR_MODULES_CHANGED_EVENT,
    SIDEBAR_MODULE_IDS,
    SIDEBAR_MODULE_TOGGLES,
    syncSidebarModuleLifecycle
} from '../js/sidebarModulePrefs.js';

const STORAGE_KEY = 'matrix_display_options';

function installStorage(seed = {}) {
    const store = new Map(Object.entries(seed));
    globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); }
    };
    return store;
}

function installDom() {
    globalThis.window = new EventTarget();
    globalThis.document = { documentElement: { dataset: {} } };
    const events = [];
    globalThis.window.addEventListener(SIDEBAR_MODULES_CHANGED_EVENT, (e) => events.push(e));
    return { events, dataset: globalThis.document.documentElement.dataset };
}

describe('sidebar module preferences', () => {
    beforeEach(() => {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.localStorage;
        resetSidebarModuleLifecycleRegistry();
    });

    afterEach(() => {
        delete globalThis.window;
        delete globalThis.document;
        delete globalThis.localStorage;
        resetSidebarModuleLifecycleRegistry();
    });

    it('toggles every known module and only known ids', () => {
        assert.deepEqual(SIDEBAR_MODULE_IDS, ['radio', 'tv', 'weather', 'links', 'history', 'stats']);
        assert.deepEqual(SIDEBAR_MODULE_TOGGLES.map((t) => t.id), SIDEBAR_MODULE_IDS);
        assert.deepEqual({ ...DEFAULT_SIDEBAR_MODULES }, {
            radio: true, tv: true, weather: true, links: true, history: true, stats: true
        });
    });

    it('defaults missing/unknown keys to enabled (no migration for old blobs)', () => {
        assert.deepEqual(normalizeSidebarModules(undefined), { ...DEFAULT_SIDEBAR_MODULES });
        assert.deepEqual(normalizeSidebarModules(null), { ...DEFAULT_SIDEBAR_MODULES });
        assert.deepEqual(normalizeSidebarModules('nope'), { ...DEFAULT_SIDEBAR_MODULES });
        assert.deepEqual(normalizeSidebarModules({ radio: false, bogus: false }), {
            ...DEFAULT_SIDEBAR_MODULES,
            radio: false
        });
    });

    it('only the literal false disables a module', () => {
        for (const value of [0, '', null, 'false', undefined]) {
            assert.equal(normalizeSidebarModules({ tv: value }).tv, true, `value ${String(value)}`);
        }
        assert.equal(normalizeSidebarModules({ tv: false }).tv, false);
    });

    it('builds a space-delimited token list for the CSS ~= selector', () => {
        assert.equal(sidebarHiddenAttrValue({ ...DEFAULT_SIDEBAR_MODULES }), '');
        assert.equal(
            sidebarHiddenAttrValue({ ...DEFAULT_SIDEBAR_MODULES, radio: false, stats: false }),
            'radio stats'
        );
        // JSON would break `~=`; make sure no brackets/quotes leak in.
        assert.ok(!/[{}"[\]\\]/.test(sidebarHiddenAttrValue({ radio: false, tv: false })));
    });


    it('reads the flags out of the shared matrix_display_options blob', () => {
        installStorage({ [STORAGE_KEY]: JSON.stringify({ showLineCount: true, sidebarModules: { tv: false } }) });
        const modules = readSidebarModules();
        assert.equal(modules.tv, false);
        assert.equal(modules.radio, true);
        assert.equal(modules.weather, true);
    });

    it('falls back to all-enabled when storage is empty or corrupt', () => {
        installStorage();
        assert.deepEqual(readSidebarModules(), { ...DEFAULT_SIDEBAR_MODULES });

        installStorage({ [STORAGE_KEY]: '{not json' });
        assert.deepEqual(readSidebarModules(), { ...DEFAULT_SIDEBAR_MODULES });
    });

    it('mirrors visibility onto <html> and notifies listeners', () => {
        installStorage();
        const { events, dataset } = installDom();

        applySidebarModuleVisibilityDom({ ...DEFAULT_SIDEBAR_MODULES, radio: false });
        assert.equal(dataset.sidebarHidden, 'radio');
        assert.equal(events.length, 1);
        assert.equal(events[0].type, SIDEBAR_MODULES_CHANGED_EVENT);
        assert.equal(events[0].detail.modules.radio, false);

        applySidebarModuleVisibilityDom({ ...DEFAULT_SIDEBAR_MODULES });
        assert.equal(dataset.sidebarHidden, '');
        assert.equal(events.length, 2);
    });
});

describe('sidebar module lifecycle', () => {
    beforeEach(() => {
        delete globalThis.localStorage;
        resetSidebarModuleLifecycleRegistry();
    });

    afterEach(() => {
        delete globalThis.localStorage;
        resetSidebarModuleLifecycleRegistry();
    });

    const allEnabled = (overrides = {}) => ({ ...DEFAULT_SIDEBAR_MODULES, ...overrides });

    it('starts modules that become enabled and stops modules that become disabled', () => {
        const calls = [];
        registerSidebarModuleLifecycle('radio', {
            start: () => calls.push('start'),
            stop: () => calls.push('stop'),
            /* Booted enabled, so the module is already running. */
            started: true
        });

        syncSidebarModuleLifecycle(allEnabled({ radio: false }));
        assert.deepEqual(calls, ['stop']);

        syncSidebarModuleLifecycle(allEnabled());
        assert.deepEqual(calls, ['stop', 'start']);

        syncSidebarModuleLifecycle(allEnabled());
        assert.deepEqual(calls, ['stop', 'start'], 'no-op when the state does not change');
    });

    it('treats the boot state as already started (no duplicate boot work)', () => {
        const calls = [];
        registerSidebarModuleLifecycle('weather', {
            start: () => calls.push('start'),
            stop: () => calls.push('stop'),
            started: true
        });

        syncSidebarModuleLifecycle(allEnabled());
        assert.deepEqual(calls, []);

        syncSidebarModuleLifecycle(allEnabled({ weather: false }));
        assert.deepEqual(calls, ['stop']);
    });

    it('starts a module that was disabled at boot when it is enabled later', () => {
        const calls = [];
        registerSidebarModuleLifecycle('tv', {
            start: () => calls.push('start'),
            stop: () => calls.push('stop'),
            started: false
        });

        syncSidebarModuleLifecycle(allEnabled());
        assert.deepEqual(calls, ['start']);
    });

    it('isolates a throwing hook so other modules still sync', () => {
        const calls = [];
        const warn = console.warn;
        console.warn = () => {};
        try {
            registerSidebarModuleLifecycle('radio', {
                start: () => { throw new Error('boom'); },
                started: false
            });
            registerSidebarModuleLifecycle('tv', {
                start: () => calls.push('tv-start'),
                started: false
            });

            syncSidebarModuleLifecycle(allEnabled());
            assert.deepEqual(calls, ['tv-start']);
        } finally {
            console.warn = warn;
        }
    });

    it('does not restart a module whose start hook re-enters the sync', () => {
        let starts = 0;
        let stops = 0;
        registerSidebarModuleLifecycle('stats', {
            start: () => {
                starts += 1;
                syncSidebarModuleLifecycle(allEnabled());
            },
            stop: () => { stops += 1; }
        });

        syncSidebarModuleLifecycle(allEnabled());
        assert.equal(starts, 1);
        assert.equal(stops, 0);
    });
});

describe('sidebar module wiring (source guards)', () => {
    const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

    it('every module root in index.html is tagged with data-module-id', () => {
        const html = read('index.html');
        for (const id of SIDEBAR_MODULE_IDS) {
            assert.ok(
                new RegExp(`id="sidebar-[a-z-]*${id}[a-z-]*"[^>]*data-module-id="${id}"`).test(html),
                `missing data-module-id="${id}" on its sidebar root`
            );
        }
    });

    it('css hides disabled modules through the html attribute', () => {
        const css = read('css/shell-sidebar.css');
        for (const id of SIDEBAR_MODULE_IDS) {
            assert.ok(
                css.includes(`html[data-sidebar-hidden~="${id}"] [data-module-id="${id}"]`),
                `missing hide rule for ${id}`
            );
        }
    });

    it('display options persists and applies the module map', () => {
        const src = read('js/displayOptions.js');
        assert.ok(src.includes('sidebarModules: normalizeSidebarModules(raw.sidebarModules)'));
        assert.ok(src.includes('applySidebarModuleVisibilityDom(options.sidebarModules)'));
        assert.ok(src.includes('display-opt-module-'));
        assert.ok(src.includes('SIDEBAR_MODULES_CHANGED_EVENT'));
    });

    it('app.js only activates heavy modules that are enabled, and registers lifecycles', () => {
        const src = read('js/app.js');
        assert.ok(src.includes("if (isModuleOn('radio')) SidebarRadio.init(); else SidebarRadio.initShell();"));
        assert.ok(src.includes("if (isModuleOn('tv')) SidebarTv.init(); else SidebarTv.initShell();"));
        assert.ok(src.includes("if (isModuleOn('weather')) SidebarWeather.init(); else SidebarWeather.initShell();"));
        for (const id of SIDEBAR_MODULE_IDS) {
            assert.ok(src.includes(`registerSidebarModuleLifecycle('${id}'`), `no lifecycle for ${id}`);
        }
        assert.ok(src.includes('syncSidebarModuleLifecycle(e.detail?.modules)'));
    });

    it('deactivate stops players and polling, activate is idempotent', () => {
        const radio = read('js/sidebarRadio.js');
        assert.ok(radio.includes('RadioPlayer.stop();'));
        assert.ok(radio.includes('if (!this.root || this.active) return;'));
        assert.ok(radio.includes('bootActivated'));

        const tv = read('js/sidebarTv.js');
        assert.ok(tv.includes('TvPlayer.stop().catch(() => {});'));
        assert.ok(tv.includes('if (!this.root || this.active) return;'));

        const weather = read('js/sidebarWeather.js');
        assert.ok(weather.includes('WeatherApi.stopPolling();'));
        assert.ok(weather.includes('if (!this.root || this.active) return;'));
    });

    it('pull-based modules bail out of rendering while hidden', () => {
        assert.ok(read('js/sidebarLinks.js').includes("if (!isSidebarModuleEnabled('links')) return;"));
        assert.ok(read('js/sidebarStats.js').includes("if (!isSidebarModuleEnabled('stats')) return;"));
        assert.ok(read('js/sidebarHistory.js').includes("if (!isSidebarModuleEnabled('history')) return;"));
    });
});

