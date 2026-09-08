// test/fileCabinetShutSync.test.js
// Regression tests for the cross-tab file-cabinet shut (collapse) sync loop.
//
// Bug: `applyFileCabinetShut` persisted `matrix_file_cabinet_shut = 'true'`
// while re-applying chrome, and the shut decision consulted the mount's
// stale `dataset.shut` alongside localStorage. The #file-cabinet element is
// REUSED across re-renders (ensureFileCabinetMount), so on a cross-tab
// refresh the receiving tab still carried `dataset.shut = 'true'` after the
// other tab had expanded the cabinet — the refresh then wrote "shut" back to
// localStorage, firing a storage event that collapsed the tab that had just
// expanded it. Expand → (400ms) → collapse, every time.
//
// Fix under test: localStorage is the single source of truth for shut state.
// `applyFileCabinetShut` is DOM-only; user-intent sites persist explicitly;
// the open path heals stale shut chrome instead of writing it back.
//
// Run with: npm test  (node --test test/)
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const SHUT_KEY = 'matrix_file_cabinet_shut';
const ACTIVE_KEY = 'matrix_file_cabinet';
const HEIGHT_KEY = 'matrix_file_cabinet_height';

let activeDoc;

/** Minimal Map-backed localStorage stand-in. */
function makeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear()
    };
}

/** Generic fake element covering the surface touched by the shut-chrome code. */
function makeEl(tag = 'div') {
    const classes = new Set();
    const el = {
        tagName: tag,
        dataset: {},
        style: { setProperty() {}, removeProperty() {} },
        classList: {
            add: (...names) => names.forEach((n) => classes.add(n)),
            remove: (...names) => names.forEach((n) => classes.delete(n)),
            contains: (n) => classes.has(n),
            toggle: (n, force) => {
                const want = force === undefined ? !classes.has(n) : !!force;
                if (want) classes.add(n); else classes.delete(n);
                return want;
            }
        },
        children: [],
        innerHTML: '',
        className: '',
        id: '',
        title: '',
        type: '',
        tabIndex: 0,
        offsetHeight: 0,
        clientHeight: 1000,
        isConnected: true,
        firstChild: null,
        previousElementSibling: null,
        nextElementSibling: null,
        setAttribute() {},
        getAttribute: () => null,
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        appendChild(child) { el.children.push(child); return child; },
        insertAdjacentElement() {},
        insertBefore(node) { return node; },
        remove() { el.isConnected = false; },
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        contains: () => false,
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
    };
    return el;
}

/**
 * Build the global stubs the file-cabinet / shell-resize modules touch.
 * Called before the dynamic import, mirroring test/sync.test.js.
 */
function installGlobals({ savedHeight = '220' } = {}) {
    const storage = makeStorage();
    storage.setItem(ACTIVE_KEY, 'true');
    if (savedHeight !== null) storage.setItem(HEIGHT_KEY, savedHeight);

    const mount = makeEl('header');
    const surface = makeEl('div');
    activeDoc = {
        mount,
        surface,
        registry: { 'file-cabinet': mount, 'desktop-surface': surface }
    };

    globalThis.localStorage = storage;
    globalThis.window = {
        innerWidth: 1200,
        innerHeight: 900,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {}
    };
    globalThis.document = {
        body: makeEl('body'),
        // fullscreen.js reads document.documentElement.requestFullscreen at
        // import time — provide the element so the typeof check doesn't throw.
        documentElement: makeEl('html'),
        activeElement: null,
        getElementById: (id) => activeDoc.registry[id] || null,
        createElement: (tag) => makeEl(tag),
        addEventListener() {}
    };
    globalThis.getComputedStyle = () => ({
        paddingTop: '0px',
        paddingBottom: '0px',
        getPropertyValue: () => ''
    });
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, opts = {}) {
            this.type = type;
            this.detail = opts.detail;
        }
    };
    return { storage, mount };
}

/** Chrome left behind by a previous shut cycle in this tab. */
function applyStaleShutChrome(mount) {
    mount.dataset.shut = 'true';
    mount.dataset.fixedHeight = 'true';
    mount.classList.add('is-file-cabinet-shut');
    mount.style.flex = '0 0 auto';
    mount.style.height = '0px';
    mount.style.minHeight = '0px';
    mount.style.maxHeight = 'none';
}

async function loadModules(tag) {
    const fc = await import(`../js/fileCabinet.js?shutsync=${tag}`);
    const sr = await import(`../js/shellResize.js?shutsync=${tag}`);
    return { fc, sr };
}

afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.getComputedStyle;
    delete globalThis.CustomEvent;
    activeDoc = null;
});

describe('file cabinet shut state — cross-tab write-back regression', () => {
    it('applyFileCabinetShut applies chrome WITHOUT persisting shut (DOM-only)', async () => {
        installGlobals();
        const { fc } = await loadModules('domonly');
        const storage = globalThis.localStorage;
        const mount = activeDoc.mount;

        fc.applyFileCabinetShut(mount);

        // THE regression: this used to write matrix_file_cabinet_shut = 'true',
        // re-collapsing the cabinet in the tab that had just expanded it.
        assert.equal(storage.getItem(SHUT_KEY), null, 'applyFileCabinetShut must never write storage');
        assert.equal(mount.dataset.shut, 'true', 'chrome (dataset) applied');
        assert.ok(mount.classList.contains('is-file-cabinet-shut'), 'chrome (class) applied');
        assert.equal(mount.style.height, '0px', 'chrome (height) applied');
    });

    it('drawer sync heals stale shut chrome when storage says open — no write-back', async () => {
        installGlobals({ savedHeight: '220' });
        const { fc } = await loadModules('heal-drawer');
        const storage = globalThis.localStorage;
        const mount = activeDoc.mount;

        // Simulate the receiving tab: other tab expanded (shut key removed),
        // this tab's mount still carries the stale shut chrome.
        applyStaleShutChrome(mount);
        assert.equal(storage.getItem(SHUT_KEY), null);

        fc.syncFileCabinetDrawerHeight(mount);

        assert.equal(
            storage.getItem(SHUT_KEY),
            null,
            'refresh must not re-persist shut over a fresher cross-tab expand'
        );
        assert.equal(mount.dataset.shut, undefined, 'stale shut dataset healed');
        assert.ok(!mount.classList.contains('is-file-cabinet-shut'), 'stale shut class healed');
        assert.equal(mount.style.height, '220px', 'remembered height restored');
    });

    it('full refresh path (syncCabinetSplitter) heals stale chrome and restores height', async () => {
        installGlobals({ savedHeight: '220' });
        const { sr } = await loadModules('heal-splitter');
        const storage = globalThis.localStorage;
        const mount = activeDoc.mount;

        applyStaleShutChrome(mount);

        // This is what ui.js render calls on every board render / cross-tab refresh.
        sr.syncCabinetSplitter();

        assert.equal(storage.getItem(SHUT_KEY), null, 'no shut write-back during refresh');
        assert.equal(mount.dataset.shut, undefined, 'stale shut chrome healed');
        assert.equal(mount.style.height, '220px', 'remembered height restored');
        assert.equal(mount.dataset.fixedHeight, 'true', 'fixed-height mode preserved');
    });

    it('storage-shut re-apply stays consistent and does not duplicate writes', async () => {
        installGlobals({ savedHeight: '220' });
        const { fc } = await loadModules('shut-apply');
        const storage = globalThis.localStorage;
        const mount = activeDoc.mount;

        fc.setFileCabinetShut(true);
        fc.syncFileCabinetDrawerHeight(mount);

        assert.equal(storage.getItem(SHUT_KEY), 'true', 'shut state preserved');
        assert.equal(mount.dataset.shut, 'true', 'shut chrome applied');
        assert.equal(mount.style.height, '0px', 'shut chrome pins height to 0');
    });

    it('clearFileCabinetShut clears chrome and storage together', async () => {
        installGlobals({ savedHeight: '220' });
        const { fc } = await loadModules('clear');
        const storage = globalThis.localStorage;
        const mount = activeDoc.mount;

        fc.applyFileCabinetShut(mount);
        fc.setFileCabinetShut(true);
        assert.equal(storage.getItem(SHUT_KEY), 'true');

        const restored = fc.clearFileCabinetShut(mount);

        assert.equal(storage.getItem(SHUT_KEY), null, 'storage cleared on expand');
        assert.equal(mount.dataset.shut, undefined, 'shut chrome cleared');
        assert.equal(restored, 220, 'returns the remembered height to restore');
    });

    it('auto-fit with no remembered height heals chrome without shut write-back', async () => {
        installGlobals({ savedHeight: null });
        const { sr } = await loadModules('fab-restore');
        const storage = globalThis.localStorage;
        const mount = activeDoc.mount;

        // Receiving tab: other tab expanded (shut key removed), this tab never
        // stored a height, mount still carries stale shut chrome.
        applyStaleShutChrome(mount);
        assert.equal(storage.getItem(SHUT_KEY), null);

        // Real refresh entry point (ui.js render → syncCabinetSplitter).
        sr.syncCabinetSplitter();

        assert.equal(storage.getItem(SHUT_KEY), null, 'no shut write-back');
        assert.equal(mount.dataset.shut, undefined, 'chrome healed to open');
        assert.equal(mount.dataset.fixedHeight, undefined, 'stale fixed-height flag dropped');
        assert.ok(parseFloat(mount.style.height) > 0, 'auto-fit height restored');
    });
});
