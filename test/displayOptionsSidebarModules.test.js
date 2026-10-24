// test/displayOptionsSidebarModules.test.js
// Display Options → Sidebar → Modules: modal rendering plus the one end-to-end
// `applyDisplayOptions` → `<html data-sidebar-hidden>` assertion. Toggle
// normalization and the setOptions merge are covered in
// test/sidebarModulePrefs.test.js.
// Run with: npm test
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const STORAGE_KEY = 'matrix_display_options';
const store = new Map();

function installEnv() {
    globalThis.localStorage = {
        getItem: (key) => (store.has(key) ? store.get(key) : null),
        setItem: (key, value) => { store.set(key, String(value)); },
        removeItem: (key) => { store.delete(key); },
        clear: () => { store.clear(); }
    };
    globalThis.window = globalThis;
    globalThis.document = {
        documentElement: {
            dataset: {},
            style: { setProperty() {}, removeProperty() {} }
        },
        body: {
            classList: { add() {}, remove() {}, contains() { return false; } },
            dataset: {},
            appendChild() {}
        },
        head: { appendChild() {}, querySelector: () => null },
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementById: () => null,
        createElement: () => ({
            dataset: {},
            style: {},
            classList: { add() {}, remove() {} },
            setAttribute() {},
            appendChild() {}
        }),
        addEventListener() {}
    };
    globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail;
        }
    };
}

installEnv();

const { DisplayOptions, applyDisplayOptions, readDisplayOptions } = await import('../js/displayOptions.js');

/** Pull the rendered checkbox tag for one module id out of the modal HTML. */
function moduleInputTag(html, id) {
    const match = html.match(new RegExp(`<input[^>]*id="display-opt-module-${id}"[^>]*>`));
    assert.ok(match, `missing checkbox for ${id}`);
    return match[0];
}

describe('display options → sidebar modules', () => {
    beforeEach(() => {
        store.clear();
        document.documentElement.dataset = {};
    });

    afterEach(() => {
        store.clear();
        document.documentElement.dataset = {};
    });

    it('renders a checked toggle for every module by default', () => {
        const html = DisplayOptions.buildModalHtml();
        for (const id of ['radio', 'tv', 'weather', 'links', 'history', 'stats']) {
            assert.ok(moduleInputTag(html, id).includes('checked'), `${id} should be checked`);
        }
    });

    it('renders disabled modules unchecked on reopen', () => {
        store.set(STORAGE_KEY, JSON.stringify({ sidebarModules: { tv: false, stats: false } }));
        const html = DisplayOptions.buildModalHtml();
        assert.ok(!moduleInputTag(html, 'tv').includes('checked'), 'tv should be unchecked');
        assert.ok(!moduleInputTag(html, 'stats').includes('checked'), 'stats should be unchecked');
        assert.ok(moduleInputTag(html, 'radio').includes('checked'), 'radio should stay checked');
    });

    it('mirrors the hidden set onto the html element when options apply', () => {
        store.set(STORAGE_KEY, JSON.stringify({ sidebarModules: { weather: false } }));
        applyDisplayOptions(readDisplayOptions());
        assert.equal(document.documentElement.dataset.sidebarHidden || '', 'weather');
    });
});
