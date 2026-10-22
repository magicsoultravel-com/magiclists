// test/displayOptionsSidebarModules.test.js
// Display Options → Sidebar → Modules: modal rendering, partial-toggle merging
// and the `<html data-sidebar-hidden>` mirror produced by applyDisplayOptions.
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

function hiddenTokens() {
    return document.documentElement.dataset.sidebarHidden || '';
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
        assert.equal(hiddenTokens(), 'weather');
    });

    it('merges partial toggles and persists the complete map', () => {
        store.set(STORAGE_KEY, JSON.stringify({ sidebarModules: { tv: false } }));

        DisplayOptions.setOptions({ sidebarModules: { radio: false } });

        const persisted = JSON.parse(store.get(STORAGE_KEY)).sidebarModules;
        assert.deepEqual(persisted, {
            radio: false,
            tv: false,
            weather: true,
            links: true,
            history: true,
            stats: true
        });
        assert.equal(hiddenTokens(), 'radio tv');
    });

    it('drops the token again when a module is re-enabled', () => {
        store.set(STORAGE_KEY, JSON.stringify({ sidebarModules: { radio: false, tv: false } }));
        applyDisplayOptions(readDisplayOptions());
        assert.equal(hiddenTokens(), 'radio tv');

        DisplayOptions.setOptions({ sidebarModules: { tv: true } });
        assert.equal(hiddenTokens(), 'radio');

        DisplayOptions.setOptions({ sidebarModules: { radio: true } });
        assert.equal(hiddenTokens(), '');
    });
});
