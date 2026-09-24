// test/fileCabinetFiledRender.test.js
// Regression: renderFileCabinet must not write matrix_file_cabinet_filed_categories.
//
// Bug: empty-shelf toSeed + ensureEmptyCategoriesStartFiled mutated fold state on
// every render (reload / desktop:changed). Switching desktops collapsed open drawers.
//
// Fix under test: renderers only read fold state; EMPTY is display-only.
//
// Run with: npm test  (node --test test/)
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const FILED_KEY = 'matrix_file_cabinet_filed_categories';
const ORDER_KEY = 'matrix_file_cabinet_category_order';
const EMPTY_COLLAPSED_KEY = 'matrix_file_cabinet_empty_shelves_collapsed';

let activeDoc;

function makeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear()
    };
}

function makeEl(tag = 'div') {
    const classes = new Set();
    const el = {
        tagName: String(tag).toUpperCase(),
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
        hidden: false,
        tabIndex: 0,
        offsetHeight: 220,
        clientHeight: 220,
        isConnected: true,
        firstChild: null,
        parentNode: null,
        previousElementSibling: null,
        nextElementSibling: null,
        setAttribute() {},
        getAttribute: () => null,
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        appendChild(child) {
            child.parentNode = el;
            el.children.push(child);
            return child;
        },
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

function installGlobals() {
    const storage = makeStorage();
    const mount = makeEl('header');
    mount.id = 'file-cabinet';
    activeDoc = {
        mount,
        registry: { 'file-cabinet': mount }
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
        documentElement: makeEl('html'),
        activeElement: null,
        getElementById: (id) => activeDoc.registry[id] || null,
        createElement: (tag) => makeEl(tag),
        addEventListener() {},
        querySelector: () => null,
        querySelectorAll: () => []
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
    globalThis.CSS = { escape: (s) => String(s) };
    return { storage, mount };
}

async function loadFileCabinet(tag) {
    return import(`../js/fileCabinet.js?filedRender=${tag}`);
}

afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.getComputedStyle;
    delete globalThis.CustomEvent;
    delete globalThis.CSS;
    activeDoc = null;
});

describe('renderFileCabinet fold-state idempotence', () => {
    it('leaves matrix_file_cabinet_filed_categories unchanged across two identical renders', async () => {
        const { storage, mount } = installGlobals();
        // User-expanded drawer (not in filed) that has notes only on another desktop
        // used to be force-filed by ensureEmptyCategoriesStartFiled. Empty cats used
        // to be force-filed by the toSeed block. Seed a stable filed list without them.
        const seededFiled = JSON.stringify(['FoldedWithNotes']);
        storage.setItem(FILED_KEY, seededFiled);
        storage.setItem(ORDER_KEY, JSON.stringify(['FoldedWithNotes', 'EmptyCat', 'OtherDesktopCat']));
        storage.setItem(EMPTY_COLLAPSED_KEY, 'true');

        const { renderFileCabinet } = await loadFileCabinet('idempotent');

        const filedItems = [
            { id: 'n1', categories: ['FoldedWithNotes'], desktopId: 1, status: 'active' }
        ];
        const activeCategories = [
            { id: 'c1', name: 'FoldedWithNotes', color: '#abc' },
            { id: 'c2', name: 'EmptyCat', color: '#def' },
            { id: 'c3', name: 'OtherDesktopCat', color: '#123' }
        ];
        const allItems = [
            ...filedItems,
            { id: 'n2', categories: ['OtherDesktopCat'], desktopId: 2, status: 'active' }
        ];

        const before = storage.getItem(FILED_KEY);
        renderFileCabinet(mount, filedItems, activeCategories, null, { allItems });
        renderFileCabinet(mount, filedItems, activeCategories, null, { allItems });
        const after = storage.getItem(FILED_KEY);

        assert.equal(after, before);
        assert.equal(after, seededFiled);
    });
});
