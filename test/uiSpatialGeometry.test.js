// test/uiSpatialGeometry.test.js
// Characterization suite for the spatial half of js/ui/spatial.js - the rect,
// tier and collapse logic lifted out of js/ui.js.
//
// These methods decide what a note measures after a resize, when a note counts
// as collapsed, and what gets written to the layout store. They used to be
// reachable only through a mounted board, which is why the facade stayed 1894
// lines: nothing could be asserted without a DOM. With the `ui` receiver passed
// in explicitly they run against a double, so the decisions are pinned directly.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let store = new Map();

function stubEl() {
    return {
        style: {},
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
const { getGridMetrics } = await import('../js/gridDensity.js');
const { GRID_LAYOUT_KEY } = await import('../js/board/layoutKeys.js');
const { setBoardItem, replaceBoardItemsMap } = await import('../js/ui/boardState.js');

const SMALL = getSmallRect();
const ACTIVE_DESKTOP = String(DesktopManager.getActiveDesktop());

beforeEach(() => {
    store = new Map();
    replaceBoardItemsMap(new Map());
});

function makeCard({ desktop = ACTIVE_DESKTOP, id = 'n1', classes = [], rect = { x: 10, y: 20, w: SMALL.w, h: SMALL.h } } = {}) {
    const set = new Set(classes);
    const card = {
        dataset: { desktop, id },
        attributes: {},
        rect,
        classList: {
            add: (...names) => names.forEach((n) => set.add(n)),
            remove: (...names) => names.forEach((n) => set.delete(n)),
            toggle: (name, force) => {
                const want = force === undefined ? !set.has(name) : !!force;
                if (want) set.add(name);
                else set.delete(name);
                return want;
            },
            contains: (name) => set.has(name)
        },
        classes: set,
        scrollIntoView() {},
        removeAttribute(name) {
            delete card.attributes[name];
        },
        setAttribute(name, value) {
            card.attributes[name] = value;
        },
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: (selector) => (selector === '#app-canvas' ? canvas : null)
    };
    return card;
}

const canvas = {
    classList: { contains: () => false },
    dataset: {},
    querySelectorAll: () => []
};

function makeUi(overrides = {}) {
    const calls = { noteRect: [], save: [], finalize: [], exts: [], reflow: [], raise: [], toggle: [], remembered: [] };
    const items = new Map();
    const ui = {
        calls,
        items,
        layoutStore: {},
        getGridLayout: () => ui.layoutStore,
        readNoteRect: (card) => ({ ...(card?.rect || ui.fallbackRect) }),
        fallbackRect: { x: 10, y: 20, w: SMALL.w, h: SMALL.h },
        getSavedLayoutRect: (card, item) => {
            const id = item?.id || card?.dataset?.id;
            return id ? (ui.layoutStore[id] || null) : null;
        },
        resolveBoardItem: (id) => items.get(id) || null,
        resolveRememberedSpatialSize: (saved, item) => spatial.resolveRememberedSpatialSize(ui, saved, item),
        persistRememberedSpatialSize: (...args) => {
            calls.remembered.push(args);
            return spatial.persistRememberedSpatialSize(ui, ...args);
        },
        applyNoteRect: (card, rect) => calls.noteRect.push(rect),
        saveGridLayout: (id, rect, opts) => calls.save.push([id, rect, opts]),
        saveTileLayoutFromCard: (card, item, rect, tier) => spatial.saveTileLayoutFromCard(ui, card, item, rect, tier),
        finalizeDesktopCard: (card, opts) => calls.finalize.push(opts || {}),
        scheduleBoardCanvasExtents: (target) => calls.exts.push(target),
        reflowGridBoard: (target, id, opts) => calls.reflow.push([id, opts]),
        raiseDesktopCard: (card) => calls.raise.push(card),
        isSpatiallyCollapsed: (card) => spatial.isSpatiallyCollapsed(ui, card),
        resolveBoardExpandRect: (card, item) => spatial.resolveBoardExpandRect(ui, card, item),
        resolveBoardExpandPlacement: (card, item) => spatial.resolveBoardExpandPlacement(ui, card, item),
        findDesktopCenterSlot: (w, h, target, mode, opts) => ({ x: 100, y: 100, w, h, ...opts }),
        applyCollapsedTileClasses: (card, tileSize) => spatial.applyCollapsedTileClasses(ui, card, tileSize),
        commitSpatialRect: (...args) => spatial.commitSpatialRect(ui, ...args),
        applySpatialToggleRect: (...args) => spatial.applySpatialToggleRect(ui, ...args),
        syncSpatialToggleButton: (card, atSmall) => calls.toggle.push(atSmall),
        collapseSpatialAtCurrentPos: (...args) => spatial.collapseSpatialAtCurrentPos(ui, ...args),
        ...overrides
    };
    return ui;
}

describe('spatial · saved rect lookups', () => {
    it('finds the entry by item id', () => {
        const ui = makeUi();
        ui.layoutStore = { n1: { x: 1, y: 2, w: 100, h: 100 } };

        assert.deepEqual(spatial.getSavedLayoutRect(ui, makeCard(), { id: 'n1' }), { x: 1, y: 2, w: 100, h: 100 });
    });

    it('falls back to the card dataset id', () => {
        const ui = makeUi();
        ui.layoutStore = { n7: { x: 3, y: 4, w: 65, h: 32 } };

        assert.deepEqual(spatial.getSavedLayoutRect(ui, makeCard({ id: 'n7' }), null), { x: 3, y: 4, w: 65, h: 32 });
    });

    it('answers null when there is no id at all', () => {
        const ui = makeUi();

        assert.equal(spatial.getSavedLayoutRect(ui, { dataset: {} }, null), null);
        assert.equal(spatial.getSavedLayoutRect(ui, null, null), null);
    });
});

describe('spatial · remembered sizes', () => {
    it('prefers the size remembered on the layout entry', () => {
        const size = spatial.resolveRememberedSpatialSize(makeUi(), { w: SMALL.w, h: SMALL.h, rememberedW: 200, rememberedH: 150 }, { id: 'n1', tileSize: 'large' });

        assert.deepEqual(size, { w: 200, h: 150 });
    });

    it('falls back to the expanded default when nothing was remembered', () => {
        const size = spatial.resolveRememberedSpatialSize(makeUi(), null, { id: 'n1', tileSize: 'large' });

        assert.deepEqual(size, { w: 196, h: 131 });
    });

    it('keeps the remembered size in storage without touching the rect', () => {
        const ui = makeUi();
        ui.layoutStore = { n1: { x: 1, y: 2 } };

        spatial.persistRememberedSpatialSize(ui, 'n1', 200, 150, 'large');

        assert.deepEqual(JSON.parse(store.get(GRID_LAYOUT_KEY)), { n1: { x: 1, y: 2, rememberedW: 200, rememberedH: 150 } });
    });

    it('does not remember a collapsed size', () => {
        const ui = makeUi();
        ui.layoutStore = { n1: { x: 1, y: 2 } };

        spatial.persistRememberedSpatialSize(ui, 'n1', SMALL.w, SMALL.h, 'large');

        assert.equal(store.has(GRID_LAYOUT_KEY), false);
    });

    it('ignores calls without an id or with numbers that are not finite', () => {
        const ui = makeUi();

        spatial.persistRememberedSpatialSize(ui, '', 200, 150, 'large');
        spatial.persistRememberedSpatialSize(ui, 'n1', NaN, 150, 'large');
        spatial.persistRememberedSpatialSize(ui, 'n1', 200, undefined, 'large');

        assert.equal(store.has(GRID_LAYOUT_KEY), false);
    });
});

describe('spatial · gridTileRect', () => {
    it('collapses a saved small size onto the small footprint', () => {
        const rect = spatial.gridTileRect(makeUi(), 'large', { x: 1, y: 2 }, { x: 1, y: 2, w: SMALL.w, h: SMALL.h });

        assert.deepEqual(rect, { x: 1, y: 2, w: SMALL.w, h: SMALL.h });
    });

    it('keeps a saved expanded size and keeps the base position', () => {
        const rect = spatial.gridTileRect(makeUi(), 'large', { x: 1, y: 2 }, { x: 9, y: 9, w: 200, h: 150 });

        assert.deepEqual(rect, { x: 1, y: 2, w: 200, h: 150 });
    });

    it('uses the tier default when nothing is saved', () => {
        const rect = spatial.gridTileRect(makeUi(), 'large', { x: 1, y: 2 }, null);

        assert.deepEqual(rect, { x: 1, y: 2, w: 98, h: 131 });
    });
});

describe('spatial · isGridMultiCellSize', () => {
    const { cellW } = getGridMetrics();

    it('treats a single cell as single-cell and anything wider or taller as multi-cell', () => {
        assert.equal(spatial.isGridMultiCellSize(makeUi(), cellW, cellW), false);
        assert.equal(spatial.isGridMultiCellSize(makeUi(), SMALL.w, SMALL.h), true);
        assert.equal(spatial.isGridMultiCellSize(makeUi(), cellW, 200), true);
    });
});

describe('spatial · mergeSpatialLayoutEntry', () => {
    it('rounds the rect and keeps the position', () => {
        const entry = spatial.mergeSpatialLayoutEntry(makeUi(), {}, { x: 10.4, y: 20.6, w: 200, h: 150 }, 'large');

        assert.deepEqual(entry, { w: 200, h: 150, x: 10, y: 21 });
    });

    it('never stores a collapsed size - the small footprint wins', () => {
        const entry = spatial.mergeSpatialLayoutEntry(makeUi(), {}, { x: 10, y: 20, w: SMALL.w, h: SMALL.h }, 'large');

        assert.deepEqual(entry, { w: SMALL.w, h: SMALL.h, x: 10, y: 20 });
    });

    it('remembers an expanded size when asked', () => {
        const entry = spatial.mergeSpatialLayoutEntry(makeUi(), { rememberedW: 300, rememberedH: 200 }, { x: 10, y: 20, w: 120, h: 90 }, 'large', { updateRemembered: true });

        assert.deepEqual([entry.rememberedW, entry.rememberedH], [120, 90]);
    });

    it('keeps the previous remembered size when the new rect is collapsed', () => {
        const entry = spatial.mergeSpatialLayoutEntry(makeUi(), { rememberedW: 300, rememberedH: 200 }, { x: 10, y: 20, w: SMALL.w, h: SMALL.h }, 'large');

        assert.deepEqual([entry.rememberedW, entry.rememberedH], [300, 200]);
    });

    it('drops non-finite coordinates instead of writing NaN', () => {
        const entry = spatial.mergeSpatialLayoutEntry(makeUi(), {}, { x: NaN, y: undefined, w: 200, h: 150 }, 'large');

        assert.equal('x' in entry, false);
        assert.equal('y' in entry, false);
    });
});

describe('spatial · collapse state', () => {
    it('marks the card with exactly one tier class', () => {
        const card = makeCard({ classes: ['tile-large'] });
        spatial.applyCollapsedTileClasses(makeUi(), card, 'small');

        assert.equal(card.classes.has('tile-small'), true);
        assert.equal(card.classes.has('tile-large'), false);
    });

    it('treats a missing card as collapsed', () => {
        assert.equal(spatial.isSpatiallyCollapsed(makeUi(), null), true);
    });

    it('reads the collapse state off the rendered rect', () => {
        const ui = makeUi();
        const small = makeCard({ rect: { x: 0, y: 0, w: SMALL.w, h: SMALL.h } });
        const large = makeCard({ rect: { x: 0, y: 0, w: 200, h: 150 } });

        assert.equal(spatial.isSpatiallyCollapsed(ui, small), true);
        assert.equal(spatial.isSpatiallyCollapsed(ui, large), false);
    });

    it('answers isSavedLayoutExpanded from the stored entry', () => {
        const ui = makeUi();
        ui.layoutStore = { opened: { w: 200, h: 150 }, closed: { w: SMALL.w, h: SMALL.h } };

        assert.equal(spatial.isSavedLayoutExpanded(ui, 'opened'), true);
        assert.equal(spatial.isSavedLayoutExpanded(ui, 'closed'), false);
        assert.equal(spatial.isSavedLayoutExpanded(ui, 'missing'), false);
    });

    it('syncs the collapse chrome only on the active desktop', () => {
        const ui = makeUi();
        const foreign = makeCard({ desktop: '9' });
        const live = makeCard();

        assert.equal(spatial.syncSpatialCollapseState(ui, foreign, null, SMALL.w, SMALL.h), false);
        assert.equal(foreign.classes.size, 0);

        assert.equal(spatial.syncSpatialCollapseState(ui, live, null, SMALL.w, SMALL.h), true);
        assert.equal(live.classes.has('note-surface'), true);
        assert.equal(live.classes.has('spatial-at-small'), true);
        assert.equal(live.classes.has('tile-small'), true);
    });
});

describe('spatial · card helpers', () => {
    it('takes the tile size from the item, or from the board lookup', () => {
        const ui = makeUi();
        setBoardItem({ id: 'n2', tileSize: 'large' });

        assert.equal(spatial.getCardTileSize(ui, makeCard({ id: 'n2' })), 'large');
        assert.equal(spatial.getCardTileSize(ui, makeCard({ id: 'n2' }), { id: 'x2', tileSize: 'small' }), 'small');
    });

    it('drops the native draggable attribute', () => {
        const card = makeCard();
        card.setAttribute('draggable', 'true');

        spatial.syncCardDraggable(makeUi(), card);

        assert.equal('draggable' in card.attributes, false);
    });

    it('identifies grid board cards by desktop', () => {
        const ui = makeUi();

        assert.equal(spatial.isGridBoardCard(ui, makeCard()), true);
        assert.equal(spatial.isGridBoardCard(ui, makeCard({ desktop: '9' })), false);
        assert.equal(spatial.isGridBoardCard(ui, null), false);
    });
});

describe('spatial · commit path', () => {
    const smallRect = { x: 10, y: 20, w: SMALL.w, h: SMALL.h };
    const bigRect = { x: 10, y: 20, w: 200, h: 150 };

    it('saves an expanded card as the remembered size', () => {
        const ui = makeUi();
        const card = makeCard();
        spatial.saveTileLayoutFromCard(ui, card, { id: 'n1', tileSize: 'large' }, bigRect, 'large');

        assert.deepEqual(ui.calls.save, [['n1', bigRect, { updateRemembered: true }]]);
    });

    it('does not remember a collapsed card', () => {
        const ui = makeUi();
        spatial.saveTileLayoutFromCard(ui, makeCard(), { id: 'n1', tileSize: 'large' }, smallRect, 'large');

        assert.deepEqual(ui.calls.save, [['n1', smallRect, { updateRemembered: false }]]);
    });

    it('ignores cards on another desktop', () => {
        const ui = makeUi();
        spatial.saveTileLayoutFromCard(ui, makeCard({ desktop: '9' }), { id: 'n1' }, bigRect, 'large');

        assert.deepEqual(ui.calls.save, []);
    });

    it('applies, saves and finalizes a committed rect', () => {
        const ui = makeUi();
        const item = { id: 'n1', tileSize: 'small' };
        const card = makeCard();

        spatial.commitSpatialRect(ui, card, item, bigRect, { tier: 'large', skipSizeReapply: true });

        assert.deepEqual(ui.calls.noteRect, [bigRect]);
        assert.deepEqual(ui.calls.save, [['n1', bigRect, { updateRemembered: true }]]);
        assert.deepEqual(ui.calls.finalize, [{ skipSizeReapply: true }]);
        assert.equal(item.tileSize, 'large', 'the tier should follow the committed rect');
    });

    it('schedules canvas extents only when the caller asks', () => {
        const ui = makeUi();
        const card = makeCard();

        spatial.commitSpatialRect(ui, card, { id: 'n1', tileSize: 'small' }, smallRect, { tier: 'small' });
        assert.deepEqual(ui.calls.exts, []);

        spatial.commitSpatialRect(ui, card, { id: 'n1', tileSize: 'small' }, smallRect, { tier: 'small', scheduleExtents: true });
        assert.deepEqual(ui.calls.exts, [canvas]);
    });

    it('applyTileTierRect pins the requested tier', () => {
        const ui = makeUi();
        spatial.applyTileTierRect(ui, makeCard(), { id: 'n1', tileSize: 'small' }, 'large', bigRect);

        assert.deepEqual(ui.calls.save, [['n1', bigRect, { updateRemembered: true }]]);
    });

    it('applySpatialToggleRect schedules extents and skips the size reapply', () => {
        const ui = makeUi();
        spatial.applySpatialToggleRect(ui, makeCard(), { id: 'n1', tileSize: 'large' }, bigRect);

        assert.deepEqual(ui.calls.exts, [canvas]);
        assert.deepEqual(ui.calls.finalize, [{ skipSizeReapply: true }]);
    });

    it('collapseSpatialAtCurrentPos remembers the old size, then applies the small one', () => {
        const ui = makeUi();
        const card = makeCard({ rect: bigRect });

        spatial.collapseSpatialAtCurrentPos(ui, card, { id: 'n1', tileSize: 'large' });

        assert.deepEqual(ui.calls.remembered, [['n1', 200, 150, 'large']]);
        assert.deepEqual(ui.calls.noteRect, [{ x: 10, y: 20, w: SMALL.w, h: SMALL.h }]);
    });

    it('collapseBoardCardToSmallFootprint refuses to touch a card that is already small', () => {
        const ui = makeUi();
        let remembered = 0;
        ui.persistRememberedSpatialSize = () => { remembered += 1; };

        spatial.collapseBoardCardToSmallFootprint(ui, null, { id: 'n1' });
        spatial.collapseBoardCardToSmallFootprint(ui, makeCard(), null);
        spatial.collapseBoardCardToSmallFootprint(ui, makeCard(), { id: 'n1' });

        assert.equal(remembered, 0);
    });

    it('collapseBoardCardToSmallFootprint collapses an expanded card', () => {
        const ui = makeUi({ isSpatiallyCollapsed: () => false });
        const card = makeCard({ rect: bigRect });

        spatial.collapseBoardCardToSmallFootprint(ui, card, { id: 'n1', tileSize: 'large' });

        assert.deepEqual(ui.calls.noteRect, [{ x: 10, y: 20, w: SMALL.w, h: SMALL.h }]);
    });
});

describe('spatial · applyTileZoneToggle', () => {
    it('expands a collapsed card in place and raises it', () => {
        const ui = makeUi({ isSpatiallyCollapsed: () => true });
        const card = makeCard();

        spatial.applyTileZoneToggle(ui, card, { id: 'n1', tileSize: 'large' });

        assert.equal(ui.calls.raise.length, 1);
        assert.equal(ui.calls.noteRect.length, 1);
        assert.deepEqual(ui.calls.noteRect[0], { x: 10, y: 20, w: 196, h: 131 });
        assert.deepEqual(ui.calls.toggle, [true]);
    });

    it('collapses an expanded card', () => {
        const ui = makeUi({ isSpatiallyCollapsed: () => false });
        const card = makeCard({ rect: { x: 10, y: 20, w: 200, h: 150 } });

        spatial.applyTileZoneToggle(ui, card, { id: 'n1', tileSize: 'large' });

        assert.equal(ui.calls.raise.length, 0);
        assert.deepEqual(ui.calls.noteRect, [{ x: 10, y: 20, w: SMALL.w, h: SMALL.h }]);
        assert.deepEqual(ui.calls.toggle, [false]);
    });
});
