// test/fileCabinetOrder.test.js
// Characterization tests for the file cabinet's ordering and filing decisions.
//
// These ran with zero coverage before: `matrix_file_cabinet_order` (which note
// sits in which drawer, in which position) was only exercised through full DOM
// renders. That made the two things most likely to break during a refactor
// untestable — "an item is listed in exactly one drawer" and "the order object
// is rewritten only when it actually changed" (every extra write fans out to a
// re-render of every drawer).
//
// Run with: npm test  (node --test test/)
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';

const ORDER_KEY = 'matrix_file_cabinet_order';
const FILED_KEY = 'matrix_file_cabinet_filed_categories';
const CATEGORY_ORDER_KEY = 'matrix_file_cabinet_category_order';

let activeDoc;
let cabinet = null;

/** Map-backed localStorage stand-in that counts writes per key. */
function makeStorage() {
    const map = new Map();
    const writes = new Map();
    return {
        map,
        writes,
        writeCount: (key) => writes.get(key) || 0,
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => {
            map.set(k, String(v));
            writes.set(k, (writes.get(k) || 0) + 1);
        },
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
        hidden: false,
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
        appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
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
    const surface = makeEl('div');
    activeDoc = { registry: { 'file-cabinet': mount, 'desktop-surface': surface } };

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
    return storage;
}

/** Import the module once, after the globals its import graph touches exist. */
async function load() {
    if (cabinet === null) cabinet = await import('../js/fileCabinet.js');
    return cabinet;
}

/** UI stand-in: only the layout lookups the sizing helpers use. */
function makeUI(gridLayout = {}, freeform = {}) {
    return {
        getGridLayout: () => gridLayout,
        getFreeformPositions: () => freeform,
        persistRememberedSpatialSize() {}
    };
}

const SMALL = { w: 65, h: 32 }; // label/compact: filed
const LARGE = { w: 98, h: 131 }; // expanded on the board

function readOrder(storage) {
    return JSON.parse(storage.getItem(ORDER_KEY) || '{}');
}

afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.getComputedStyle;
    delete globalThis.CustomEvent;
});

describe('file cabinet order · single drawer per item', () => {
    it('filing an item twice keeps one entry, not two', async () => {
        const storage = installGlobals();
        const fc = await load();
        ['a', 'note-1', 'c'].forEach((id) => fc.addToFileCabinetOrder('Work', id));

        fc.addToFileCabinetOrder('Work', 'note-1');

        assert.deepEqual(readOrder(storage), { Work: ['a', 'note-1', 'c'] },
            're-filing into the same drawer keeps the note where it was');
    });

    it('re-filing into another drawer moves the item instead of copying it', async () => {
        const storage = installGlobals();
        const fc = await load();

        fc.addToFileCabinetOrder('Work', 'note-1');
        fc.addToFileCabinetOrder('Home', 'note-1');

        assert.deepEqual(readOrder(storage), { Home: ['note-1'] }, 'an item lives in exactly one drawer');
    });

    it('falls back to the Uncategorized drawer and ignores an empty id', async () => {
        const storage = installGlobals();
        const fc = await load();

        fc.addToFileCabinetOrder('', 'note-1');
        fc.addToFileCabinetOrder('Work', '');
        fc.addToFileCabinetOrder('Work', null);

        assert.deepEqual(readOrder(storage), { Uncategorized: ['note-1'] });
    });

    it('removing an item drops its drawer once it is empty', async () => {
        const storage = installGlobals();
        const fc = await load();
        fc.addToFileCabinetOrder('Work', 'note-1');
        fc.addToFileCabinetOrder('Home', 'note-2');

        fc.removeFromFileCabinetOrder('note-1');

        assert.deepEqual(readOrder(storage), { Home: ['note-2'] }, 'the emptied Work drawer is gone, not left as []');
    });

    it('removing an id that is not filed writes nothing', async () => {
        const storage = installGlobals();
        const fc = await load();
        fc.addToFileCabinetOrder('Work', 'note-1');
        const writesBefore = storage.writeCount(ORDER_KEY);

        fc.removeFromFileCabinetOrder('note-404');

        assert.equal(storage.writeCount(ORDER_KEY), writesBefore, 'an unrecorded id must not trigger a save');
    });
});

describe('file cabinet order · positions inside a drawer', () => {
    it('reorders by index', async () => {
        const storage = installGlobals();
        const fc = await load();
        ['a', 'b', 'c'].forEach((id) => fc.addToFileCabinetOrder('Work', id));

        fc.reorderInCategory('Work', 0, 2);

        assert.deepEqual(readOrder(storage).Work, ['b', 'c', 'a']);
    });

    it('ignores out-of-range indexes without saving', async () => {
        const storage = installGlobals();
        const fc = await load();
        ['a', 'b'].forEach((id) => fc.addToFileCabinetOrder('Work', id));
        const writesBefore = storage.writeCount(ORDER_KEY);

        fc.reorderInCategory('Work', 0, 2);
        fc.reorderInCategory('Work', -1, 0);
        fc.reorderInCategory('Missing', 0, 1);

        assert.equal(storage.writeCount(ORDER_KEY), writesBefore);
        assert.deepEqual(readOrder(storage).Work, ['a', 'b']);
    });
});

describe('file cabinet order · category fold and order', () => {
    it('toggles a category between filed and visible, defaulting to Uncategorized', async () => {
        const storage = installGlobals();
        const fc = await load();

        assert.equal(fc.isFileCabinetCategoryFiled(''), false);
        assert.equal(fc.toggleFileCabinetCategoryFiled(''), true);
        assert.deepEqual(JSON.parse(storage.getItem(FILED_KEY)), ['Uncategorized']);
        assert.equal(fc.isFileCabinetCategoryFiled(''), true);

        assert.equal(fc.toggleFileCabinetCategoryFiled(''), false);
        assert.deepEqual(JSON.parse(storage.getItem(FILED_KEY)), []);
    });

    it('applies the saved order, appending categories saved before they existed', async () => {
        installGlobals();
        const fc = await load();

        fc.saveFileCabinetCategoryOrder(['Home', 'Work']);

        assert.deepEqual(
            fc.applyFileCabinetCategoryOrder(['Work', 'Ideas', 'Home']),
            ['Home', 'Work', 'Ideas'],
            'saved order wins, unknown categories keep their incoming order at the end'
        );
        assert.deepEqual(
            fc.applyFileCabinetCategoryOrder(['Ideas', 'Work']),
            ['Work', 'Ideas'],
            'a saved category that no longer exists is dropped, not resurrected'
        );
    });

    it('returns the incoming categories untouched when nothing was saved', async () => {
        installGlobals();
        const fc = await load();

        assert.deepEqual(fc.applyFileCabinetCategoryOrder(['b', 'a']), ['b', 'a']);
        assert.deepEqual(fc.getFileCabinetCategoryOrder(), []);
        assert.equal(globalThis.localStorage.getItem(CATEGORY_ORDER_KEY), null);
    });
});

describe('file cabinet order · reconciliation', () => {
    it('moves an item whose category changed and de-duplicates the target drawer', async () => {
        const storage = installGlobals();
        const fc = await load();
        fc.saveFileCabinetOrder({ Work: ['note-1', 'note-2'], Home: ['note-1'] });

        const order = fc.reconcileFileCabinetOrderWithItems([
            { id: 'note-1', categories: ['Home'] },
            { id: 'note-2', categories: ['Work'] }
        ]);

        assert.deepEqual(order, { Work: ['note-2'], Home: ['note-1'] });
        assert.deepEqual(readOrder(storage), order, 'the reconciled order is what gets persisted');
    });

    it('adds a filed item that the drawer order never recorded', async () => {
        const storage = installGlobals();
        const fc = await load();
        fc.saveFileCabinetOrder({ Work: ['note-1'] });

        fc.reconcileFileCabinetOrderWithItems([{ id: 'note-9', categories: ['Work'] }]);

        assert.deepEqual(readOrder(storage).Work, ['note-1', 'note-9']);
    });

    it('prune drops ids that no longer exist and deletes emptied drawers', async () => {
        const storage = installGlobals();
        const fc = await load();
        fc.saveFileCabinetOrder({ Work: ['note-1', 'note-2'], Home: ['note-3'] });

        const changed = fc.pruneFileCabinetOrder(['note-2']);

        assert.equal(changed, true);
        assert.deepEqual(readOrder(storage), { Work: ['note-2'] });
    });

    it('prune reports no change when every id is still live', async () => {
        const storage = installGlobals();
        const fc = await load();
        fc.saveFileCabinetOrder({ Work: ['note-1'] });
        const writesBefore = storage.writeCount(ORDER_KEY);

        assert.equal(fc.pruneFileCabinetOrder(new Set(['note-1'])), false);
        assert.equal(storage.writeCount(ORDER_KEY), writesBefore);
    });
});

describe('file cabinet order · filed vs expanded', () => {
    it('partitions by stored size', async () => {
        installGlobals();
        const fc = await load();
        const ui = makeUI({ 'small-note': SMALL, 'large-note': LARGE });

        const { filed, expanded } = fc.partitionItemsForFileCabinet([
            { id: 'small-note' },
            { id: 'large-note' }
        ], 'grid', ui);

        assert.deepEqual(filed.map((i) => i.id), ['small-note']);
        assert.deepEqual(expanded.map((i) => i.id), ['large-note']);
    });

    it('drawer membership keeps a note filed after it was expanded', async () => {
        installGlobals();
        const fc = await load();
        const ui = makeUI({ 'note-1': LARGE });

        fc.addToFileCabinetOrder('Work', 'note-1');

        assert.equal(fc.shouldFileItem({ id: 'note-1', categories: ['Work'] }, 'grid', ui), true,
            'order membership wins over the current size');
        assert.equal(fc.isItemFiled({ id: 'note-2', categories: ['Work'] }, 'grid', ui), false);

        fc.removeFromFileCabinetOrder('note-1');
        assert.equal(fc.shouldFileItem({ id: 'note-1', categories: ['Work'] }, 'grid', ui), false,
            'once it is out of the drawer an expanded note goes back to the board');
    });

    it('falls back to the tile default size when nothing was stored', async () => {
        installGlobals();
        const fc = await load();
        const ui = makeUI({});

        assert.equal(fc.shouldFileItem({ id: 'note-1', tileSize: 'small' }, 'grid', ui), true);
        assert.equal(fc.shouldFileItem({ id: 'note-2', tileSize: 'large' }, 'grid', ui), false);
    });
});

describe('file cabinet order · sorting', () => {
    it('applySortToFileCabinetOrder sorts each drawer on its own', async () => {
        const storage = installGlobals();
        const fc = await load();
        fc.saveFileCabinetOrder({ Work: ['b', 'a'], Home: ['z'], Ideas: [] });

        fc.applySortToFileCabinetOrder([
            { id: 'a', title: 'Alpha', categories: ['Work'] },
            { id: 'b', title: 'Beta', categories: ['Work'] },
            { id: 'z', title: 'Zulu', categories: ['Home'] }
        ], { field: 'name', dir: 'asc' });

        const order = readOrder(storage);
        assert.deepEqual(order.Work, ['a', 'b']);
        assert.deepEqual(order.Home, ['z']);
        assert.deepEqual(order.Ideas, [], 'a drawer holding no filed items is left alone');
    });

    it('applySortToFileCabinetOrder is a no-op for an empty cabinet', async () => {
        const storage = installGlobals();
        const fc = await load();
        const writesBefore = storage.writeCount(ORDER_KEY);

        fc.applySortToFileCabinetOrder([], { field: 'name', dir: 'asc' });
        fc.applySortToFileCabinetOrder(null, { field: 'name', dir: 'asc' });

        assert.equal(storage.writeCount(ORDER_KEY), writesBefore);
    });
});

// The ordering layer lives in js/fileCabinet/order.js and js/fileCabinet.js
// re-exports it. Callers import from the facade, so the re-export has to stay
// *identical* — a wrapper would silently drop the function identity that
// ui.js/dragdrop.js/layoutStorage.js rely on, and re-exporting the module's
// private helpers would widen an API that used to be internal.
describe('file cabinet order · module boundary', () => {
    const PUBLIC = [
        'getFileCabinetOrder', 'saveFileCabinetOrder', 'removeFromFileCabinetOrder',
        'addToFileCabinetOrder', 'reorderInCategory', 'getFileCabinetFiledCategories',
        'saveFileCabinetFiledCategories', 'isFileCabinetEmptyShelvesCollapsed',
        'setFileCabinetEmptyShelvesCollapsed', 'toggleFileCabinetEmptyShelvesCollapsed',
        'isFileCabinetCategoryFiled', 'toggleFileCabinetCategoryFiled',
        'getFileCabinetCategoryOrder', 'saveFileCabinetCategoryOrder',
        'appendFileCabinetCategoryOrder', 'removeCategoryFromFileCabinetLayout',
        'applyFileCabinetCategoryOrder', 'persistFileCabinetCategoryOrderFromDom',
        'getStoredItemSize', 'isItemInFileCabinetOrder', 'pruneFileCabinetOrderByLayout',
        'shouldFileItem', 'isItemFiled', 'partitionItemsForFileCabinet',
        'fileItemToCabinet', 'fileAllItemsToCabinet', 'migrateItemsToFileCabinet',
        'reconcileFileCabinetOrderWithItems',
        'seedFileCabinetOrderFromItems', 'seedFromCurrentLayout',
        'applySortToFileCabinetOrder', 'pruneFileCabinetOrder', 'saveFiledCabinetLayout',
        'sortFileCabinetItems'
    ];
    const NOT_PUBLIC = [
        // private helpers the facade still calls but never exported
        'isCollapsedForFileCabinet', 'isSpatiallyEligibleForFileCabinet',
        'resolveFileCabinetItemPosition', 'sortItemsByFileCabinetOrder'
    ];

    it('re-exports every order function as the very same object', async () => {
        installGlobals();
        const facade = await load();
        const order = await import('../js/fileCabinet/order.js');

        for (const name of PUBLIC) {
            assert.equal(typeof order[name], 'function', `${name} missing from fileCabinet/order.js`);
            assert.equal(facade[name], order[name], `${name} is wrapped instead of re-exported`);
        }
    });

    it('keeps the order module internals out of the facade surface', async () => {
        installGlobals();
        const facade = await load();

        for (const name of NOT_PUBLIC) {
            assert.equal(facade[name], undefined, `${name} leaked into the fileCabinet.js surface`);
        }
    });

    it('shares the four storage keys with the order module', async () => {
        installGlobals();
        const facade = await load();
        const order = await import('../js/fileCabinet/order.js');

        assert.equal(facade.FILE_CABINET_ORDER_KEY, order.FILE_CABINET_ORDER_KEY);
        assert.equal(facade.FILE_CABINET_ORDER_KEY, ORDER_KEY);
        assert.equal(facade.FILE_CABINET_FILED_CATEGORIES_KEY, FILED_KEY);
        assert.equal(facade.FILE_CABINET_CATEGORY_ORDER_KEY, CATEGORY_ORDER_KEY);
        assert.equal(
            facade.FILE_CABINET_EMPTY_SHELVES_COLLAPSED_KEY,
            'matrix_file_cabinet_empty_shelves_collapsed'
        );
    });
});
