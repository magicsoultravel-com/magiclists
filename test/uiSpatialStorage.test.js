// test/uiSpatialStorage.test.js
// Characterization suite for the storage half of js/ui/spatial.js - layout
// entries, pins, freeform positions/sizes and the mode switch.
//
// Every one of these methods writes to localStorage, so the failure mode is
// silent: a note keeps its old rect, a pin stops sticking, a reset leaves the
// board half-packed. They used to run only inside a mounted board; here the
// store is a Map and the assertions are on the bytes that get written.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let store = new Map();

function stubEl() {
    return {
        style: { setProperty() {}, removeProperty() {} },
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        isConnected: true,
        setAttribute() {},
        getAttribute: () => null,
        removeAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        appendChild: (child) => child,
        remove() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        contains: () => false,
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
    };
}

globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
};
globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) {
        this.type = type;
        this.detail = opts.detail;
    }
};
globalThis.window = {
    innerWidth: 1200,
    innerHeight: 900,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => true
};
globalThis.document = {
    body: stubEl(),
    documentElement: stubEl(),
    activeElement: null,
    getElementById: () => null,
    createElement: () => stubEl(),
    addEventListener() {}
};
globalThis.requestAnimationFrame = (cb) => {
    cb();
    return 1;
};

const spatial = await import('../js/ui/spatial.js');
const { DesktopManager } = await import('../js/desktopManager.js');
const { getSmallRect } = await import('../js/tileGeometry.js');
const { replaceBoardItemsMap, writeActiveBoardViewMode } = await import('../js/ui/boardState.js');
const {
    FREEFORM_POSITIONS_KEY,
    FREEFORM_SIZES_KEY,
    GRID_LAYOUT_KEY,
    GRID_PINS_KEY
} = await import('../js/board/layoutKeys.js');

const SMALL = getSmallRect();
const ACTIVE_DESKTOP = String(DesktopManager.getActiveDesktop());

beforeEach(() => {
    store = new Map();
    replaceBoardItemsMap(new Map());
    writeActiveBoardViewMode('grid');
});

function makeCard({ desktop = ACTIVE_DESKTOP, id = 'n1', rect = { x: 16, y: 16, w: SMALL.w, h: SMALL.h } } = {}) {
    const classes = new Set();
    return {
        dataset: { desktop, id },
        rect,
        classes,
        style: { setProperty() {}, removeProperty() {} },
        classList: {
            add: (...names) => names.forEach((n) => classes.add(n)),
            remove: (...names) => names.forEach((n) => classes.delete(n)),
            toggle: (name, force) => {
                const want = force === undefined ? !classes.has(name) : !!force;
                if (want) classes.add(name);
                else classes.delete(name);
                return want;
            },
            contains: (name) => classes.has(name)
        },
        setAttribute() {},
        removeAttribute() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        scrollIntoView() {},
        closest: (selector) => (selector === '#app-canvas' ? canvas : null)
    };
}

function makeCanvas({ cards = [], viewGrid = true } = {}) {
    const classes = new Set(viewGrid ? ['view-grid'] : []);
    return {
        dataset: {},
        classes,
        classList: {
            add: (...names) => names.forEach((n) => classes.add(n)),
            remove: (...names) => names.forEach((n) => classes.delete(n)),
            toggle: (name, force) => {
                const want = force === undefined ? !classes.has(name) : !!force;
                if (want) classes.add(name);
                else classes.delete(name);
                return want;
            },
            contains: (name) => classes.has(name)
        },
        querySelector: () => null,
        querySelectorAll: () => cards
    };
}

let canvas = makeCanvas();

function makeUi(overrides = {}) {
    const calls = { saved: [], compact: [], exts: 0, scroll: 0, finalize: [] };
    const items = new Map();
    const ui = {
        calls,
        items,
        getGridLayout: () => spatial.getGridLayout(ui),
        getFreeformPositions: () => spatial.getFreeformPositions(ui),
        getFreeformSizes: () => spatial.getFreeformSizes(ui),
        getBoardPins: () => spatial.getBoardPins(ui),
        saveGridLayout: (...args) => {
            calls.saved.push(args);
            return spatial.saveGridLayout(ui, ...args);
        },
        saveCompactBoardLayout: (...args) => {
            calls.compact.push(args);
            return spatial.saveCompactBoardLayout(ui, ...args);
        },
        saveFreeformPosition: (...args) => spatial.saveFreeformPosition(ui, ...args),
        saveFreeformSize: (...args) => spatial.saveFreeformSize(ui, ...args),
        saveFreeformSizeFromCard: (...args) => spatial.saveFreeformSizeFromCard(ui, ...args),
        mergeSpatialLayoutEntry: (...args) => spatial.mergeSpatialLayoutEntry(ui, ...args),
        resolveBoardItem: (id) => items.get(id) || null,
        isBoardPinned: (id) => spatial.isBoardPinned(ui, id),
        toggleBoardPin: (id) => spatial.toggleBoardPin(ui, id),
        readNoteRect: (card) => ({ ...card.rect }),
        readFreeformCardSize: () => ({ w: 100, h: 80 }),
        snapNoteRect: (rect) => ({ ...rect }),
        getLiveBoardBounds: () => ({ origin: 16, packW: 200, maxH: Infinity, edgePad: 0 }),
        scheduleBoardCanvasExtents: () => { calls.exts += 1; },
        updateBoardCanvasExtents: () => { calls.exts += 1; },
        updateDesktopScrollPolicy: () => { calls.scroll += 1; },
        finalizeDesktopCard: (card, opts) => calls.finalize.push([card, opts]),
        applyFreeformDimensions: () => {},
        getCardTileSize: () => 'large',
        ...overrides
    };
    return ui;
}

describe('spatial storage · grid layout', () => {
    it('answers an empty object for a missing or corrupt entry', () => {
        const ui = makeUi();

        assert.deepEqual(spatial.getGridLayout(ui), {});

        store.set(GRID_LAYOUT_KEY, '{not json');
        assert.deepEqual(spatial.getGridLayout(ui), {});
    });

    it('writes a rounded entry and keeps the previous remembered size', () => {
        const ui = makeUi();
        store.set(GRID_LAYOUT_KEY, JSON.stringify({ n1: { rememberedW: 300, rememberedH: 200 } }));

        spatial.saveGridLayout(ui, 'n1', { x: 16.4, y: 32.6, w: 65, h: 32 });

        assert.deepEqual(JSON.parse(store.get(GRID_LAYOUT_KEY)).n1,
            { w: SMALL.w, h: SMALL.h, x: 16, y: 33, rememberedW: 300, rememberedH: 200 });
    });

    it('remembers an expanded size when asked to', () => {
        const ui = makeUi();

        spatial.saveGridLayout(ui, 'n1', { x: 16, y: 16, w: 200, h: 150 }, { updateRemembered: true });

        const entry = JSON.parse(store.get(GRID_LAYOUT_KEY)).n1;
        assert.deepEqual([entry.rememberedW, entry.rememberedH], [200, 150]);
    });

    it('ignores a save without an id or a rect', () => {
        const ui = makeUi();

        spatial.saveGridLayout(ui, '', { x: 1, y: 1, w: 200, h: 150 });
        spatial.saveGridLayout(ui, 'n1', null);

        assert.equal(store.has(GRID_LAYOUT_KEY), false);
    });

    it('drops an entry on remove and leaves the rest alone', () => {
        const ui = makeUi();
        store.set(GRID_LAYOUT_KEY, JSON.stringify({ n1: { x: 1, y: 2 }, n2: { x: 3, y: 4 } }));

        spatial.removeGridLayout(ui, 'n1');

        assert.deepEqual(JSON.parse(store.get(GRID_LAYOUT_KEY)), { n2: { x: 3, y: 4 } });
    });

    it('saveCompactBoardLayout always writes the small footprint', () => {
        const ui = makeUi();

        spatial.saveCompactBoardLayout(ui, 'n1', { x: 16.2, y: 48.8, w: 999, h: 999 }, 'grid');

        assert.deepEqual(JSON.parse(store.get(GRID_LAYOUT_KEY)).n1, { w: SMALL.w, h: SMALL.h, x: 16, y: 49 });
    });
});

describe('spatial storage · pins', () => {
    it('reads an empty pin list when storage holds nothing usable', () => {
        const ui = makeUi();

        assert.deepEqual(spatial.getBoardPins(ui), []);

        store.set(GRID_PINS_KEY, '{"n1":true}');
        assert.deepEqual(spatial.getBoardPins(ui), []);
    });

    it('adds then removes a pin and reports which way it went', () => {
        const ui = makeUi();

        assert.equal(spatial.toggleBoardPin(ui, 'n1'), true);
        assert.deepEqual(JSON.parse(store.get(GRID_PINS_KEY)), ['n1']);
        assert.equal(spatial.isBoardPinned(ui, 'n1'), true);

        assert.equal(spatial.toggleBoardPin(ui, 'n1'), false);
        assert.deepEqual(JSON.parse(store.get(GRID_PINS_KEY)), []);
        assert.equal(spatial.isBoardPinned(ui, 'n1'), false);
    });

    it('ignores a toggle without an id', () => {
        const ui = makeUi();

        assert.equal(spatial.toggleBoardPin(ui, ''), false);
        assert.equal(store.has(GRID_PINS_KEY), false);
        assert.equal(spatial.isBoardPinned(ui, null), false);
    });

    it('keeps the old grid pin aliases routed to the board pins', () => {
        const ui = makeUi();

        spatial.toggleBoardPin(ui, 'n1');

        assert.equal(spatial.isGridPinned(ui, 'n1'), true);
        assert.deepEqual(spatial.getGridPins(ui), ['n1']);
        assert.equal(spatial.toggleGridPin(ui, 'n1'), false);
    });
});

describe('spatial storage · freeform positions and sizes', () => {
    it('answers empty objects for missing or corrupt entries', () => {
        const ui = makeUi();

        assert.deepEqual(spatial.getFreeformPositions(ui), {});
        assert.deepEqual(spatial.getFreeformSizes(ui), {});

        store.set(FREEFORM_POSITIONS_KEY, '[]');
        assert.deepEqual(spatial.getFreeformPositions(ui), []);
    });

    it('rounds a freeform position', () => {
        const ui = makeUi();

        spatial.saveFreeformPosition(ui, 'n1', 10.6, 20.2);

        assert.deepEqual(JSON.parse(store.get(FREEFORM_POSITIONS_KEY)).n1, { x: 11, y: 20 });
    });

    it('merges a freeform size into the existing entry', () => {
        const ui = makeUi();
        store.set(FREEFORM_SIZES_KEY, JSON.stringify({ n1: { rememberedW: 300, rememberedH: 200 } }));

        spatial.saveFreeformSize(ui, 'n1', 200, 150);

        const entry = JSON.parse(store.get(FREEFORM_SIZES_KEY)).n1;
        assert.deepEqual([entry.w, entry.h, entry.rememberedW, entry.rememberedH], [200, 150, 300, 200]);
    });

    it('remembers the size only when the caller asks', () => {
        const ui = makeUi();

        spatial.saveFreeformSize(ui, 'n1', 200, 150, { updateRemembered: true });

        const entry = JSON.parse(store.get(FREEFORM_SIZES_KEY)).n1;
        assert.deepEqual([entry.rememberedW, entry.rememberedH], [200, 150]);
    });

    it('reads the size off the card and skips a card from another desktop', () => {
        const ui = makeUi();

        spatial.saveFreeformSizeFromCard(ui, makeCard({ id: 'n1' }));
        spatial.saveFreeformSizeFromCard(ui, makeCard({ id: 'n9', desktop: '9' }));

        assert.deepEqual(Object.keys(JSON.parse(store.get(FREEFORM_SIZES_KEY))), ['n1']);
    });
});

describe('spatial storage · flushing the canvas', () => {
    it('saves every card of the active desktop', () => {
        const ui = makeUi();
        const cards = [makeCard({ id: 'a' }), makeCard({ id: 'b' })];

        spatial.flushLayoutFromCanvas(ui, makeCanvas({ cards }), 'grid');

        assert.deepEqual(ui.calls.saved.map(([id]) => id), ['a', 'b']);
    });

    it('does nothing without a canvas', () => {
        const ui = makeUi();

        spatial.flushLayoutFromCanvas(ui, null, 'grid');

        assert.deepEqual(ui.calls.saved, []);
    });
});

describe('spatial storage · markNoteCollapsed', () => {
    it('rewrites both the grid entry and the freeform size to the small footprint', () => {
        const ui = makeUi();
        ui.items.set('n1', { id: 'n1', tileSize: 'large' });
        store.set(GRID_LAYOUT_KEY, JSON.stringify({ n1: { x: 16, y: 16, w: 300, h: 200, rememberedW: 300, rememberedH: 200 } }));
        store.set(FREEFORM_SIZES_KEY, JSON.stringify({ n1: { w: 300, h: 200, rememberedW: 300, rememberedH: 200 } }));
        store.set(FREEFORM_POSITIONS_KEY, JSON.stringify({ n1: { x: 40, y: 50 } }));

        spatial.markNoteCollapsed(ui, 'n1');

        const grid = JSON.parse(store.get(GRID_LAYOUT_KEY)).n1;
        const sizes = JSON.parse(store.get(FREEFORM_SIZES_KEY)).n1;
        assert.deepEqual([grid.w, grid.h, grid.rememberedW], [SMALL.w, SMALL.h, 300]);
        assert.deepEqual([sizes.w, sizes.h], [SMALL.w, SMALL.h]);
        assert.deepEqual(JSON.parse(store.get(FREEFORM_POSITIONS_KEY)).n1, { x: 40, y: 50 });
    });

    it('writes nothing for an id that has no stored layout', () => {
        const ui = makeUi();

        spatial.markNoteCollapsed(ui, 'ghost');

        assert.equal(store.has(GRID_LAYOUT_KEY), false);
        assert.equal(store.has(FREEFORM_SIZES_KEY), false);
    });
});

describe('spatial storage · mode switch and scroll policy', () => {
    it('applyDesktopLayoutModeSwitch pins the view mode to grid and finalizes every card', () => {
        const ui = makeUi();
        const cards = [makeCard({ id: 'a' })];
        const host = makeCanvas({ cards, viewGrid: false });

        spatial.applyDesktopLayoutModeSwitch(ui, host);

        assert.equal(host.classes.has('view-grid'), true);
        assert.equal(host.classes.has('view-freeform'), false);
        assert.equal(ui.calls.finalize.length, 1);
    });

    it('updateGridScrollPolicy is a no-op outside grid view', () => {
        const ui = makeUi();
        const host = makeCanvas({ viewGrid: false });

        spatial.updateGridScrollPolicy(ui, host, { forcing: true });

        assert.equal(ui.calls.exts, 0);
    });

    it('updateGridScrollPolicy refreshes extents and the desktop policy in grid view', () => {
        const ui = makeUi();
        const host = makeCanvas();

        spatial.updateGridScrollPolicy(ui, host, { forcing: true });

        assert.equal(host.classes.has('is-grid-forcing'), true);
        assert.equal(ui.calls.exts, 1);
        assert.equal(ui.calls.scroll, 1);
    });
});

describe('spatial storage · repackBoardLayoutStorage', () => {
    it('lays every note out flush on the small stride', () => {
        const ui = makeUi();
        const items = [{ id: 'a', created_at: 1 }, { id: 'b', created_at: 2 }, { id: 'c', created_at: 3 }];

        spatial.repackBoardLayoutStorage(ui, 'grid', items, null);

        assert.deepEqual(ui.calls.compact.map(([id]) => id), ['a', 'b', 'c']);
        assert.deepEqual(ui.calls.compact.map(([, slot]) => slot.x), [3, 3 + SMALL.w, 3 + SMALL.w * 2]);
        assert.deepEqual(ui.calls.compact[0][1], { x: 3, y: 3, w: SMALL.w, h: SMALL.h });
    });

    it('wraps to the next row when the row is full', () => {
        const ui = makeUi({ getLiveBoardBounds: () => ({ origin: 16, packW: SMALL.w * 2, maxH: Infinity, edgePad: 0 }) });
        const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

        spatial.repackBoardLayoutStorage(ui, 'grid', items, makeCanvas());

        assert.deepEqual(ui.calls.compact.map(([, slot]) => [slot.x, slot.y]),
            [[16, 16], [16 + SMALL.w, 16], [16, 16 + SMALL.h]]);
    });

    it('skips items without an id', () => {
        const ui = makeUi();

        spatial.repackBoardLayoutStorage(ui, 'grid', [{ id: 'a' }, {}], null);

        assert.equal(ui.calls.compact.length, 1);
    });
});
