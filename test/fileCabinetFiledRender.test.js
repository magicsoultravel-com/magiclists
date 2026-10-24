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

describe('renderFileCabinet rail structure', () => {
    it('splits the rail into folded chips and an EMPTY group, and leaves the row empty', async () => {
        const { storage, mount } = installGlobals();
        storage.setItem(FILED_KEY, JSON.stringify(['Folded']));
        storage.setItem(ORDER_KEY, JSON.stringify(['Folded', 'EmptyA', 'EmptyB']));
        storage.setItem(EMPTY_COLLAPSED_KEY, 'false');
        const { renderFileCabinet } = await loadFileCabinet('rail-structure');

        const filedItems = [{ id: 'n1', categories: ['Folded'], desktopId: 1, status: 'active' }];
        const activeCategories = [
            { id: 'c1', name: 'Folded', color: '#abc' },
            { id: 'c2', name: 'EmptyA', color: '#def' },
            { id: 'c3', name: 'EmptyB', color: '#123' }
        ];

        renderFileCabinet(mount, filedItems, activeCategories, null, { allItems: filedItems });

        const inner = mount.children[0];
        assert.equal(inner.className, 'file-cabinet-inner');
        const [rail, row] = inner.children;
        assert.equal(rail.className, 'file-cabinet-filed-rail');
        assert.equal(row.className, 'file-cabinet-row');
        assert.equal(row.children.length, 0, 'no open drawers: every note-bearing category is folded');

        const [foldedSlot, emptyGroup, addBtn] = rail.children;
        assert.equal(foldedSlot.dataset.category, 'Folded');
        assert.equal(foldedSlot.children[0].dataset.category, 'Folded');
        assert.match(foldedSlot.children[0].innerHTML, /Folded \(1\)/, 'chip carries the note count');
        assert.equal(addBtn.className, 'file-cabinet-add-category-btn');

        assert.equal(emptyGroup.dataset.emptyShelves, '1');
        const emptyBody = emptyGroup.children[1];
        assert.deepEqual(
            emptyBody.children.map((slot) => slot.dataset.category),
            ['EmptyA', 'EmptyB'],
            'empty shelves are listed in category order'
        );
        assert.ok(emptyBody.children.every((slot) => slot.dataset.emptyShelf === '1'));
    });

    it('publishes the preview context the hover/drag layers read', async () => {
        const { storage, mount } = installGlobals();
        storage.setItem(FILED_KEY, JSON.stringify(['Folded']));
        const { renderFileCabinet } = await loadFileCabinet('preview-context');

        const filedItems = [{ id: 'n1', categories: ['Folded'], desktopId: 1, status: 'active' }];
        const UI = { marker: 'ui' };
        renderFileCabinet(mount, filedItems, [{ name: 'Folded', color: '#abc' }], UI);

        const ctx = mount.__fcPreviewContext;
        assert.deepEqual([...ctx.byCategory.keys()], ['Folded']);
        assert.deepEqual(ctx.byCategory.get('Folded').map((item) => item.id), ['n1']);
        assert.equal(ctx.UI, UI);
        assert.equal(typeof ctx.order, 'object');
    });

    it('shows the empty-cabinet hint and clears the preview context', async () => {
        const { mount } = installGlobals();
        const { renderFileCabinet } = await loadFileCabinet('empty');
        mount.__fcPreviewContext = { stale: true };

        renderFileCabinet(mount, [], [], null);

        assert.match(mount.innerHTML, /file-cabinet-empty/);
        assert.equal(mount.__fcPreviewContext, undefined);
    });
});

// The renderer moved to js/fileCabinet/render.js. prepareBoardItems (still in the
// facade) and ui.js render through the facade, so renderFileCabinet has to be the
// same function object there; the builders it leans on stay internal, because the
// rail markup is an implementation detail of this module.
describe('file cabinet render · module boundary', () => {
    const NOT_PUBLIC = [
        'buildFileCabinetCategoryColumn', 'buildFileCabinetCategoryNames',
        'buildFileCabinetCategoryActionButtons', 'wrapFileCabinetCategoryActions',
        'ensureFileCabinetTabDragHandle', 'FOLD_ICON', 'EXPAND_ICON'
    ];

    it('re-exports renderFileCabinet as the very same object', async () => {
        installGlobals();
        const facade = await loadFileCabinet('render-boundary');
        // no cache-buster: the facade imports this exact instance
        const render = await import('../js/fileCabinet/render.js');

        assert.equal(typeof render.renderFileCabinet, 'function');
        assert.equal(facade.renderFileCabinet, render.renderFileCabinet);
    });

    it('keeps the render internals out of the facade surface', async () => {
        installGlobals();
        const facade = await loadFileCabinet('render-internals');

        for (const name of NOT_PUBLIC) {
            assert.equal(facade[name], undefined, `${name} leaked into the fileCabinet.js surface`);
        }
    });
});
