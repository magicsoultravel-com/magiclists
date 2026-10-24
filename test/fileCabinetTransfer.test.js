// test/fileCabinetTransfer.test.js
// Characterization tests for js/fileCabinet/transfer.js — the three ways a note
// crosses between the board and the drawers:
//
//   board -> drawer   fileBoardItemToCabinet  (filing a note, optional re-index)
//   drawer -> board   expandFileCabinetItemToBoard / expandFileCabinetCategoryToBoard
//   drawer -> drawer  moveItemBetweenCategories (drag a tab onto another shelf)
//
// None of these had a test: they were only reachable by dragging a real card in
// a browser, which is why "the note lands in two drawers" and "expanding a
// category leaves half of it filed" were regression-prone.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORDER_KEY = 'matrix_file_cabinet_order';
const FILED_KEY = 'matrix_file_cabinet_filed_categories';

let cabinet = null;
let dispatched = [];
let canvasRect = { left: 0, top: 0, width: 1000, height: 800 };

function makeUI(overrides = {}) {
    const saved = {};
    return {
        saved,
        getGridLayout: () => ({}),
        getFreeformPositions: () => ({}),
        persistRememberedSpatialSize() {},
        getActiveBoardViewMode: () => 'grid',
        readNoteRect: () => ({ x: 10, y: 20, w: 0, h: 0 }),
        resolveBoardExpandRect: () => ({ w: 100, h: 50 }),
        resolveRememberedSpatialSize: () => ({ w: 65, h: 32 }),
        getGridBoardBounds: () => ({ packW: 2000, maxH: 2000, origin: { x: 0, y: 0 }, edgePad: 8 }),
        snapNotePosition: (placed) => placed,
        saveGridLayout(id, rect) { saved[id] = rect; },
        ...overrides
    };
}

function installGlobals(order = {}, filed = []) {
    const store = new Map();
    if (order) store.set(ORDER_KEY, JSON.stringify(order));
    if (filed.length) store.set(FILED_KEY, JSON.stringify(filed));
    dispatched = [];
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
    const stubEl = () => ({
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        isConnected: true,
        setAttribute() {},
        getAttribute: () => null,
        addEventListener() {},
        removeEventListener() {},
        appendChild(child) { return child; },
        remove() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        contains: () => false,
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
    });
    const canvas = stubEl();
    canvas.dataset.desktopZoom = '1';
    canvas.scrollLeft = 0;
    canvas.scrollTop = 0;
    canvas.getBoundingClientRect = () => canvasRect;

    globalThis.window = {
        innerWidth: 1200,
        innerHeight: 900,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent(ev) { dispatched.push(ev); return true; }
    };
    globalThis.document = {
        body: stubEl(),
        documentElement: stubEl(),
        activeElement: null,
        getElementById: (id) => (id === 'app-canvas' ? canvas : null),
        createElement: () => stubEl(),
        addEventListener() {}
    };
    globalThis.getComputedStyle = () => ({
        paddingTop: '0px',
        paddingBottom: '0px',
        paddingLeft: '0px',
        paddingRight: '0px',
        getPropertyValue: () => ''
    });
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, opts = {}) {
            this.type = type;
            this.detail = opts.detail;
        }
    };
    return store;
}

async function load() {
    if (cabinet === null) cabinet = await import('../js/fileCabinet.js');
    return cabinet;
}

const readOrder = () => JSON.parse(globalThis.localStorage.getItem(ORDER_KEY) || '{}');
const visibilityEvents = () => dispatched.filter((ev) => ev.type === 'board:visibility_changed');

describe('file cabinet transfer · drawer to drawer', () => {
    it('moves a tab into another drawer at the requested index', async () => {
        installGlobals({ Office: ['n1', 'n2'], Home: ['n3'] });
        const fc = await load();

        const moved = fc.moveItemBetweenCategories({
            itemId: 'n1', fromCategory: 'Office', toCategory: 'Home', toIndex: 1
        });

        assert.equal(moved, true);
        const order = readOrder();
        assert.deepEqual(order.Home, ['n3', 'n1'], 'inserted at index 1');
        assert.deepEqual(order.Office, ['n2'], 'removed from the source drawer');
    });

    it('clamps an out-of-range index and normalises missing categories', async () => {
        installGlobals({ Uncategorized: ['a', 'b'], Home: ['c'] });
        const fc = await load();

        fc.moveItemBetweenCategories({ itemId: 'a', toCategory: 'Home', toIndex: 99 });
        assert.deepEqual(readOrder().Home, ['c', 'a'], 'index clamps to the end');

        fc.moveItemBetweenCategories({ itemId: 'b', toCategory: 'Home' });
        assert.deepEqual(readOrder().Uncategorized || [], [], 'missing fromCategory means Uncategorized');
    });

    it('reports no move for a no-op or a missing id', async () => {
        installGlobals({ Office: ['n1'] });
        const fc = await load();

        assert.equal(fc.moveItemBetweenCategories({ itemId: 'n1', fromCategory: 'Office', toCategory: 'Office' }), false);
        assert.equal(fc.moveItemBetweenCategories({ itemId: '', fromCategory: 'Office', toCategory: 'Home' }), false);
        assert.deepEqual(readOrder(), { Office: ['n1'] }, 'order untouched');
    });
});

describe('file cabinet transfer · board note into a drawer', () => {
    it('re-indexes the note inside the drawer it was dropped on', async () => {
        installGlobals({ Office: ['a1', 'a2', 'a3'] });
        const fc = await load();
        const UI = makeUI();
        const item = { id: 'a1', categories: ['Office'] };

        const filed = fc.fileBoardItemToCabinet({ item, UI, targetCategory: 'Office', insertIndex: 2 });

        assert.equal(filed, true);
        assert.deepEqual(readOrder().Office, ['a2', 'a3', 'a1'], 'dropped at slot 2, not duplicated');
        const layout = JSON.parse(globalThis.localStorage.getItem('matrix_grid_layout'));
        assert.equal(layout.a1.x, 8, 'label-size position remembered');
        assert.equal(layout.a1.y, 8);
    });

    it('switches the category on drop and announces one visibility change', async () => {
        installGlobals({ Office: ['a1'] });
        const fc = await load();
        const UI = makeUI();
        const item = { id: 'a1', categories: ['Office'] };

        fc.fileBoardItemToCabinet({ item, UI, targetCategory: 'Home' });

        assert.deepEqual(item.categories, ['Home'], 'live item category updated before the render');
        const order = readOrder();
        assert.deepEqual(order.Home, ['a1']);
        assert.ok(!order.Office || order.Office.length === 0, 'not left behind in the old drawer');
        assert.equal(visibilityEvents().length, 1, 'exactly one board:visibility_changed');
    });
});

describe('file cabinet transfer · drawer note back onto the board', () => {
    it('drops the note at the pointer and unfiles it', async () => {
        installGlobals({ Office: ['a1', 'a2'] });
        const fc = await load();
        const UI = makeUI();

        const expanded = fc.expandFileCabinetItemToBoard({ item: { id: 'a1' }, dropX: 300, dropY: 200, UI });

        assert.equal(expanded, true);
        // no card lifted -> the remembered (label) footprint centres on the drop
        assert.deepEqual(UI.saved.a1, { x: 267.5, y: 184, w: 65, h: 32 });
        assert.deepEqual(readOrder().Office, ['a2'], 'only the expanded note left the drawer');
        const events = visibilityEvents();
        assert.equal(events.length, 1);
        assert.equal(events[0].detail.flushLayout, false);
    });

    it('carries the source rect into the expand transition when lifted from a card', async () => {
        installGlobals({ Office: ['a1'] });
        const fc = await load();
        const UI = makeUI();
        const card = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 65, height: 32, x: 10, y: 20 }) };

        fc.expandFileCabinetItemToBoard({ item: { id: 'a1' }, dropX: 100, dropY: 100, UI, card });

        const events = visibilityEvents();
        assert.equal(events.length, 1);
        const transition = events[0].detail.transition;
        assert.equal(transition.kind, 'fc-expand');
        assert.equal(transition.itemId, 'a1');
        assert.equal(transition.sourceRect.width, 65);
    });

    it('expands a whole category with a single visibility change', async () => {
        installGlobals({ Office: ['a1', 'a2'] }, ['Office']);
        const fc = await load();
        const UI = makeUI();

        const expanded = fc.expandFileCabinetCategoryToBoard('Office', UI);

        assert.equal(expanded, true);
        assert.ok(UI.saved.a1 && UI.saved.a2, 'both notes placed on the board');
        assert.deepEqual(readOrder().Office || [], [], 'drawer emptied');
        assert.equal(visibilityEvents().length, 1, 'silent per-note expands, one category event');
        assert.deepEqual(
            JSON.parse(globalThis.localStorage.getItem(FILED_KEY) || '[]'),
            [],
            'the category is no longer marked filed'
        );
    });

    it('reports no expand for an empty drawer', async () => {
        installGlobals({ Office: [] });
        const fc = await load();

        assert.equal(fc.expandFileCabinetCategoryToBoard('Office', makeUI()), false);
        assert.equal(visibilityEvents().length, 0);
    });
});

// The cross-surface transfers now live in js/fileCabinet/transfer.js and the
// facade re-exports them. dragdrop.js drives filing/expanding through the
// facade, so the four public transfers have to be the same function objects;
// the three DOM/event helpers they need internally must stay internal or the
// public surface of fileCabinet.js silently widens.
describe('file cabinet transfer · module boundary', () => {
    const PUBLIC = [
        'moveItemBetweenCategories', 'expandFileCabinetItemToBoard',
        'expandFileCabinetCategoryToBoard', 'fileBoardItemToCabinet'
    ];
    const NOT_PUBLIC = [
        'captureClientRect', 'clientToCanvasBoardPoint', 'dispatchBoardVisibility'
    ];

    it('re-exports every transfer function as the very same object', async () => {
        installGlobals();
        const facade = await load();
        const transfer = await import('../js/fileCabinet/transfer.js');

        for (const name of PUBLIC) {
            assert.equal(typeof transfer[name], 'function', `${name} missing from fileCabinet/transfer.js`);
            assert.equal(facade[name], transfer[name], `${name} is wrapped instead of re-exported`);
        }
    });

    it('keeps the transfer internals out of the facade surface', async () => {
        installGlobals();
        const facade = await load();

        for (const name of NOT_PUBLIC) {
            assert.equal(facade[name], undefined, `${name} leaked into the fileCabinet.js surface`);
        }
    });
});
