// test/uiGridPack.test.js
// Characterization suite for js/ui/gridPack.js - the nine layout methods lifted
// out of js/ui.js (isItemLayoutExpanded ... resetBoardLayout) plus the spatial
// sort helper they use.
//
// Why these exist: the packer decides where every sorted or reset note lands and
// it does so without painting - given tiles and bounds it returns rects. That is
// exactly the seam the split created, so the arithmetic can be pinned directly
// instead of through a DOM render. The invariants worth freezing are the ones a
// visual regression hides: collapsed tiles are flush (zero gap), the expanded
// block starts below the collapsed set and never covers it, pinned rects are the
// only obstacles, and `resolveAlignedExpandedSize` always returns a whole number
// of cells.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let store = new Map();
const events = [];

function stubEl() {
    return {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        isConnected: true,
        innerHTML: '',
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
globalThis.CSS = { escape: (value) => String(value) };
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
    dispatchEvent: (event) => {
        events.push(event);
        return true;
    }
};
const canvas = { id: 'app-canvas', querySelector: () => null };
globalThis.document = {
    body: stubEl(),
    documentElement: stubEl(),
    activeElement: null,
    getElementById: (id) => (id === 'app-canvas' ? canvas : null),
    createElement: () => stubEl(),
    addEventListener() {}
};

const pack = await import('../js/ui/gridPack.js');
const { getSmallRect, getLargeDefaultRect } = await import('../js/tileGeometry.js');
const { getGridMetrics } = await import('../js/gridDensity.js');
const { GRID_LAYOUT_KEY, GRID_PINS_KEY } = await import('../js/board/layoutKeys.js');

const SMALL = getSmallRect();
const LARGE = getLargeDefaultRect();
const METRICS = getGridMetrics();

beforeEach(() => {
    store = new Map();
    events.length = 0;
});

/** Minimal facade double: only the methods the packer actually reaches for. */
function makeUi(overrides = {}) {
    const calls = { apply: [], save: [], scroll: [], packBoardGridRects: [] };
    const items = new Map();
    const ui = {
        calls,
        items,
        layoutStore: {},
        getLiveBoardBounds: () => ({ origin: 16, packW: 200, maxH: Infinity, edgePad: 0 }),
        resolveBoardItem: (id) => items.get(id) || null,
        resolveAlignedExpandedSize: (packW, count) => pack.resolveAlignedExpandedSize(ui, packW, count),
        resolveSortItemSize: (item, mode, isExpanded, aligned) => (
            aligned ? { w: aligned.w, h: aligned.h } : { w: SMALL.w, h: SMALL.h }
        ),
        isItemLayoutExpanded: () => false,
        partitionCanvasItemsByExpansion: (items, mode) => pack.partitionCanvasItemsByExpansion(ui, items, mode),
        getBoardPins: () => [],
        packBoardGridRects: (collapsed, expanded, opts) => {
            calls.packBoardGridRects.push({ collapsed, expanded, opts });
            return pack.packBoardGridRects(ui, collapsed, expanded, opts);
        },
        getGridLayout: () => ui.layoutStore,
        getFreeformSizes: () => ({}),
        mergeSpatialLayoutEntry: (prev, rect) => ({ ...prev, ...rect }),
        snapNoteRect: (rect) => ({ ...rect }),
        gridBoardRectForCard: (cardEl, saved) => ({ ...saved }),
        saveGridLayout: (id, rect) => calls.save.push([id, rect]),
        applyGridBoardLayout: (canvasEl, layout) => calls.apply.push(layout),
        updateGridScrollPolicy: () => calls.scroll.push(true),
        ...overrides
    };
    return ui;
}

describe('grid pack · metrics the rects are expressed in', () => {
    it('pins the compact default grid', () => {
        assert.equal(METRICS.cellS, 32);
        assert.equal(METRICS.gap, 1);
        assert.equal(METRICS.strideX, 33);
        assert.equal(METRICS.origin, 2);
        assert.equal(METRICS.edgePad, 1);
    });

    it('pins the two footprints the packer mixes', () => {
        assert.deepEqual(SMALL, { w: 65, h: 32 });
        assert.deepEqual(LARGE, { w: 98, h: 131 });
    });
});

describe('grid pack · sortItemsSpatially', () => {
    const rects = {
        b: { x: 100, y: 0 },
        a: { x: 0, y: 0 },
        d: { x: 0, y: 50 },
        c: { x: 50, y: 0 }
    };
    const order = (items) => items.map((item) => item.id);

    it('sorts row-major: top rows first, then left to right', () => {
        const sorted = pack.sortItemsSpatially([{ id: 'b' }, { id: 'd' }, { id: 'a' }, { id: 'c' }], (item) => rects[item.id]);

        assert.deepEqual(order(sorted), ['a', 'c', 'b', 'd']);
    });

    it('treats a missing rect as the origin instead of throwing', () => {
        const sorted = pack.sortItemsSpatially([{ id: 'b' }, { id: 'ghost' }], (item) => rects[item.id]);

        assert.deepEqual(order(sorted), ['ghost', 'b']);
    });

    it('does not mutate the input array', () => {
        const items = [{ id: 'b' }, { id: 'a' }];
        pack.sortItemsSpatially(items, (item) => rects[item.id]);

        assert.deepEqual(order(items), ['b', 'a']);
    });
});

describe('grid pack · resolveAlignedExpandedSize', () => {
    const ui = makeUi();

    it('returns a whole number of cells so the block never drifts', () => {
        const size = pack.resolveAlignedExpandedSize(ui, 200, 3);

        assert.equal((size.w + METRICS.gap) % METRICS.strideX, 0, 'width is not cell aligned');
        assert.equal(size.w, 131);
        assert.equal(size.cols, 1);
    });

    it('keeps the large-note aspect ratio for the height', () => {
        const size = pack.resolveAlignedExpandedSize(ui, 800, 4);

        assert.equal(size.h, Math.max(METRICS.cellS, Math.round((size.w * LARGE.h) / LARGE.w)));
    });

    it('treats a missing or zero count as one note', () => {
        const one = pack.resolveAlignedExpandedSize(ui, 200, 1);

        assert.deepEqual(pack.resolveAlignedExpandedSize(ui, 200, 0), one);
        assert.deepEqual(pack.resolveAlignedExpandedSize(ui, 200, undefined), one);
    });

    it('adds columns as the page widens, capped by the page width', () => {
        const narrow = pack.resolveAlignedExpandedSize(ui, 200, 9);
        const wide4 = pack.resolveAlignedExpandedSize(ui, 800, 4);
        const wide12 = pack.resolveAlignedExpandedSize(ui, 800, 12);

        assert.equal(narrow.cols, 1);
        assert.equal(wide4.cols, 2);
        assert.equal(wide12.cols, 4);
        assert.ok(wide4.cols * wide4.w + (wide4.cols - 1) * METRICS.gap <= 800);
    });

    it('respects a minimum note width', () => {
        const size = pack.resolveAlignedExpandedSize(ui, 800, 9, 400);

        assert.equal(size.cols, 1);
    });
});

describe('grid pack · partitionCanvasItemsByExpansion', () => {
    it('splits through the facade so expansion rules stay in one place', () => {
        const ui = makeUi({ isItemLayoutExpanded: (item) => item.id === 'b' });
        const parts = pack.partitionCanvasItemsByExpansion(ui, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'grid');

        assert.deepEqual(parts.collapsed.map((i) => i.id), ['a', 'c']);
        assert.deepEqual(parts.expanded.map((i) => i.id), ['b']);
    });

    it('tolerates a missing list', () => {
        const parts = pack.partitionCanvasItemsByExpansion(makeUi(), null, 'grid');

        assert.deepEqual(parts, { collapsed: [], expanded: [] });
    });
});

describe('grid pack · packBoardGridRects · collapsed grid', () => {
    const ui = makeUi();
    const rectOf = (rects, id) => rects.find((r) => r.id === id).rect;

    it('lays collapsed tiles flush on the small footprint stride', () => {
        const rects = pack.packBoardGridRects(ui, [{ id: 'a' }, { id: 'b' }, { id: 'c' }], [], { packW: 200 });

        assert.deepEqual(rects.map((r) => r.id), ['a', 'b', 'c']);
        assert.deepEqual(rectOf(rects, 'a'), { x: 16, y: 16, w: SMALL.w, h: SMALL.h });
        assert.equal(rectOf(rects, 'b').x - rectOf(rects, 'a').x, SMALL.w, 'collapsed tiles are not flush');
        assert.equal(rectOf(rects, 'c').x - rectOf(rects, 'b').x, SMALL.w);
        assert.equal(rectOf(rects, 'b').y, rectOf(rects, 'a').y);
    });

    it('honours origin and edgePad', () => {
        const rects = pack.packBoardGridRects(ui, [{ id: 'a' }], [], { packW: 200, origin: 16, edgePad: 2 });

        assert.deepEqual(rectOf(rects, 'a'), { x: 18, y: 18, w: SMALL.w, h: SMALL.h });
    });

    it('treats the placed list as the only obstacle for collapsed tiles', () => {
        const placed = [{ x: 3, y: 3, w: 34, h: 34 }];
        const rects = pack.packBoardGridRects(ui, [{ id: 'a' }, { id: 'b' }], [], { packW: 200, placed });

        assert.equal(rectOf(rects, 'a').x, 16 + SMALL.w, 'the first free slot was not used');
        assert.equal(rectOf(rects, 'b').x, 16 + SMALL.w * 2);
    });

    it('returns nothing for an empty board', () => {
        assert.deepEqual(pack.packBoardGridRects(ui, [], [], { packW: 200 }), []);
    });
});

describe('grid pack · packBoardGridRects · expanded block', () => {
    const ui = makeUi();
    const overlaps = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

    it('starts below the collapsed block and never covers it', () => {
        const collapsed = [{ id: 'a' }, { id: 'b' }];
        const rects = pack.packBoardGridRects(ui, collapsed, [{ id: 'x', w: 66, h: 66 }], { packW: 200 });
        const lastCollapsed = rects.filter((r) => r.id !== 'x').at(-1).rect;
        const expanded = rects.find((r) => r.id === 'x').rect;

        assert.ok(expanded.y >= lastCollapsed.y + lastCollapsed.h, 'expanded block overlaps the collapsed rows');
        assert.equal(rects.every((r) => r.id === 'x' || !overlaps(expanded, r.rect)), true);
        assert.equal((expanded.w + METRICS.gap) % METRICS.strideX, 0, 'expanded width is not cell aligned');
    });

    it('gives every expanded note the aligned size when one is supplied', () => {
        const alignedSize = { w: 66, h: 66, cols: 2 };
        const rects = pack.packBoardGridRects(ui, [], [{ id: 'x' }, { id: 'y' }, { id: 'z' }], { packW: 200, alignedSize });
        const [x, y, z] = rects.map((r) => r.rect);

        assert.deepEqual([x.w, x.h], [66, 66]);
        assert.deepEqual([y.w, z.h], [66, 66]);
        assert.equal(y.x - x.x, alignedSize.w + METRICS.gap);
        assert.equal(y.y, x.y);
        assert.equal(z.x, x.x, 'the third note should wrap to the next row');
        assert.equal(z.y - x.y, alignedSize.h + METRICS.gap);
    });

    it('keeps the aligned block inside the page width', () => {
        const alignedSize = { w: 66, h: 66, cols: 2 };
        const rects = pack.packBoardGridRects(ui, [], [{ id: 'x' }, { id: 'y' }], { packW: 200, alignedSize });

        for (const { rect } of rects) assert.ok(rect.x + rect.w <= 216, 'an expanded note ran past the page');
    });
});

describe('grid pack · packGridBoard', () => {
    function board() {
        const ui = makeUi();
        ui.items.set('a', { id: 'a', tileSize: 'small' });
        ui.items.set('x', { id: 'x', tileSize: 'large' });
        return ui;
    }

    it('returns the finished layout as a Map keyed by item id', () => {
        const layout = pack.packGridBoard(board(), canvas, [{ id: 'a' }], [{ id: 'x' }]);

        assert.deepEqual([...layout.keys()], ['a', 'x']);
    });

    it('hands the layout to the board and saves the expanded rects', () => {
        const ui = board();
        pack.packGridBoard(ui, canvas, [{ id: 'a' }], [{ id: 'x' }]);

        assert.equal(ui.calls.apply.length, 1);
        assert.deepEqual([...ui.calls.apply[0].keys()], ['a', 'x']);
        assert.deepEqual(ui.calls.save.map(([id]) => id), ['x']);
        assert.equal(ui.calls.scroll.length, 1, 'scroll policy was not refreshed');
    });

    it('persistOnly writes storage and never repaints the board', () => {
        const ui = board();
        pack.packGridBoard(ui, canvas, [{ id: 'a' }], [], { persistOnly: true });
        const stored = JSON.parse(store.get(GRID_LAYOUT_KEY));

        assert.equal(stored.a.x, 16);
        assert.equal(ui.calls.apply.length, 0);
        assert.equal(ui.calls.scroll.length, 0);
    });

    it('alignSize passes one uniform size down for every expanded note', () => {
        const ui = board();
        const seen = [];
        ui.resolveSortItemSize = (item, mode, isExpanded, aligned) => {
            seen.push({ id: item.id, aligned });
            return aligned ? { w: aligned.w, h: aligned.h } : { w: SMALL.w, h: SMALL.h };
        };
        const rect = pack.packGridBoard(ui, canvas, [], [{ id: 'x' }], { alignSize: true }).get('x');

        assert.deepEqual(seen.map((entry) => entry.id), ['x']);
        assert.deepEqual([rect.w, rect.h], [seen[0].aligned.w, seen[0].aligned.h]);
    });

    it('keeps a pinned note on its saved rect and packs around it', () => {
        const ui = board();
        ui.layoutStore = { a: { x: 16, y: 16, w: SMALL.w, h: SMALL.h } };
        const layout = pack.packGridBoard(ui, canvas, [{ id: 'a' }, { id: 'b' }], [], { pinnedIds: new Set(['a']) });

        assert.deepEqual(layout.get('a'), { x: 16, y: 16, w: SMALL.w, h: SMALL.h });
        assert.ok(layout.get('b').x >= 16 + SMALL.w, 'the unpinned tile did not move past the pin');
    });
});

describe('grid pack · packSortGridBoard', () => {
    it('forwards direction and alignSize to packGridBoard', () => {
        const ui = makeUi();
        ui.packGridBoard = (canvasEl, collapsed, expanded, opts) => ui.calls.apply.push(opts);

        pack.packSortGridBoard(ui, canvas, [], [{ id: 'x' }], { direction: 'vertical', alignSize: true }, new Set());

        assert.deepEqual(ui.calls.apply, [{
            pinnedIds: new Set(),
            layoutMode: 'grid',
            direction: 'vertical',
            persistOnly: false,
            animate: true,
            save: true,
            alignSize: true
        }]);
    });
});

describe('grid pack · sortBoardLayout', () => {
    const items = [
        { id: 'a', desktopId: 1, position: 1 },
        { id: 'b', desktopId: 1, position: 2 }
    ];

    it('packs the visible board and asks for a reflow-free repaint', () => {
        const ui = makeUi({ getBoardPins: () => ['a'] });
        const packed = [];
        ui.packSortGridBoard = (canvasEl, collapsed, expanded, sortPrefs, pinnedIds) => {
            packed.push({ collapsed, expanded, sortPrefs, pinnedIds });
        };

        pack.sortBoardLayout(ui, 'grid', items, { direction: 'horizontal' });

        assert.equal(packed.length, 1);
        assert.deepEqual(packed[0].collapsed.map((i) => i.id).sort(), ['a', 'b']);
        assert.deepEqual([...packed[0].pinnedIds], ['a']);
        assert.deepEqual(events.map((e) => [e.type, e.detail]), 
            [['board:visibility_changed', { flushLayout: false, skipGridReflow: true }]]);
    });

    it('stops when the board has no visible notes', () => {
        const ui = makeUi();
        let packed = 0;
        ui.packSortGridBoard = () => { packed += 1; };

        pack.sortBoardLayout(ui, 'grid', [{ id: 'a', desktopId: 3 }], {});

        assert.equal(packed, 0);
        assert.equal(events.length, 0);
    });
});

describe('grid pack · resetBoardLayout', () => {
    const items = [{ id: 'a', desktopId: 1 }, { id: 'b', desktopId: 1 }];

    it('drops the pins, repacks storage and asks for a reflow-free repaint', () => {
        const ui = makeUi({ repackBoardLayoutStorage: (...args) => ui.calls.apply.push(args) });
        store.set(GRID_PINS_KEY, JSON.stringify({ a: true }));

        pack.resetBoardLayout(ui, 'grid', items, { fileCabinetActive: false });

        assert.equal(store.has(GRID_PINS_KEY), false, 'pins survived a reset');
        assert.deepEqual(ui.calls.apply.map(([mode, boardItems]) => [mode, boardItems.map((i) => i.id)]),
            [['grid', ['a', 'b']]]);
        assert.deepEqual(events.map((e) => e.type), ['board:visibility_changed']);
    });

    it('leaves storage to the file cabinet when it owns the layout', () => {
        const ui = makeUi({ repackBoardLayoutStorage: () => ui.calls.apply.push('repack') });

        pack.resetBoardLayout(ui, 'grid', [], { fileCabinetActive: true });

        assert.deepEqual(ui.calls.apply, []);
    });

    it('reads the cabinet flag from storage when the caller omits it', () => {
        const ui = makeUi({ repackBoardLayoutStorage: () => ui.calls.apply.push('repack') });
        store.set('matrix_file_cabinet', 'true');

        pack.resetBoardLayout(ui, 'grid', [], {});

        assert.deepEqual(ui.calls.apply, []);
    });
});
