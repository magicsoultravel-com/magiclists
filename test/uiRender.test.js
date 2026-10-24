// test/uiRender.test.js
// Characterization suite for js/ui/render.js - the board render pass lifted out
// of js/ui.js.
//
// The pass itself has to paint, so the assertions are on what reaches the DOM
// double: which classes the canvas gets, what the empty state says, that every
// item ends up with exactly one card on one pane, and that a render with a
// missing canvas touches nothing. That last one matters because render() runs on
// every desktop switch and used to clear the board lookup before checking.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let store = new Map();
let removedListeners = [];

function stubEl(tag = 'div') {
    const classes = new Set();
    const el = {
        tagName: String(tag).toUpperCase(),
        style: { setProperty() {}, removeProperty() {} },
        dataset: {},
        children: [],
        innerHTML: '',
        className: '',
        id: '',
        title: '',
        hidden: false,
        isConnected: true,
        firstChild: null,
        parentNode: null,
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
        classes,
        attributes: {},
        listeners: {},
        setAttribute(name, value) { el.attributes[name] = value; },
        getAttribute: (name) => el.attributes[name] ?? null,
        removeAttribute(name) { delete el.attributes[name]; },
        addEventListener(type, handler) { (el.listeners[type] = el.listeners[type] || []).push(handler); },
        removeEventListener() {},
        appendChild(child) {
            el.children.push(child);
            child.parentNode = el;
            return child;
        },
        insertBefore(child) {
            el.children.push(child);
            return child;
        },
        remove() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        contains: () => false,
        focus() {},
        scrollIntoView() {},
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 400, bottom: 400, width: 400, height: 400 })
    };
    return el;
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
    createElement: (tag) => stubEl(tag),
    addEventListener() {},
    removeEventListener: (type) => removedListeners.push(type)
};
globalThis.requestAnimationFrame = (cb) => {
    cb();
    return 1;
};
globalThis.getComputedStyle = () => ({
    paddingTop: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    paddingRight: '0px',
    getPropertyValue: () => ''
});

const render = await import('../js/ui/render.js');
const { BoardOperations } = await import('../js/boardOperations.js');
const { readStoredCategories } = await import('../js/categories.js');
const { setBoardItem, getBoardItem, getBoardItemsMap, replaceBoardItemsMap } = await import('../js/ui/boardState.js');
const { DesktopManager } = await import('../js/desktopManager.js');

beforeEach(() => {
    store = new Map();
    removedListeners = [];
    replaceBoardItemsMap(new Map());
});

function makeUi(overrides = {}) {
    const calls = { applied: [], saved: [], finalized: 0, stacked: 0, pinned: 0, extents: 0, scroll: 0, raised: 0 };
    const ui = {
        calls,
        getGridBoardBounds: () => ({ origin: 16, packW: 400, maxH: 600, edgePad: 0 }),
        getGridLayout: () => ({}),
        isSavedLayoutExpanded: () => false,
        resolveRememberedSpatialSize: () => ({ w: 98, h: 131 }),
        snapNoteRect: (rect) => ({ ...rect }),
        gridBoardRectForCard: (card, rect) => ({ ...rect }),
        preserveSavedBoardRect: (rect) => ({ ...rect }),
        applyNoteRect: (card, rect) => calls.applied.push([card, rect]),
        saveGridLayout: (id, rect) => calls.saved.push([id, rect]),
        finalizeDesktopCard: () => { calls.finalized += 1; },
        initDesktopCardStack: () => { calls.stacked += 1; },
        syncBoardPinClass: () => { calls.pinned += 1; },
        raiseDesktopCard: () => { calls.raised += 1; },
        isBoardPinned: () => false,
        resolveBoardItem: () => null,
        readNoteRect: () => ({ x: 0, y: 0, w: 65, h: 32 }),
        getCardTileSize: () => 'small',
        getSavedLayoutRect: () => null,
        isSpatiallyCollapsed: () => true,
        resolveCardRect: () => ({ x: 0, y: 0, w: 65, h: 32 }),
        bindBoardEditorFocusChrome: () => {},
        focusPendingBoardField: () => {},
        syncSpatialCollapseState: () => false,
        applyCollapsedTileClasses: () => {},
        getCardActionsOptions: (card) => render.getCardActionsOptions(ui, card),
        syncCalendarButtonUI: (item, btn) => render.syncCalendarButtonUI(ui, item, btn),
        buildCardActionsHtml: (item, isExpanded, options) => render.buildCardActionsHtml(ui, item, isExpanded, options),
        prepareCanvas: (canvas) => render.prepareCanvas(ui, canvas),
        getActiveCategories: (hidden) => render.getActiveCategories(ui, hidden),
        getViewState: () => render.getViewState(ui),
        applyCanvasClasses: (canvas, fcActive) => render.applyCanvasClasses(ui, canvas, fcActive),
        prepareBoardItems: (...args) => render.prepareBoardItems(ui, ...args),
        renderEmptyState: (...args) => render.renderEmptyState(ui, ...args),
        layoutBoard: (...args) => render.layoutBoard(ui, ...args),
        finalizeRender: (...args) => render.finalizeRender(ui, ...args),
        updateBoardCanvasExtents: () => { calls.extents += 1; },
        updateGridScrollPolicy: () => { calls.scroll += 1; },
        ...overrides
    };
    return ui;
}

describe('render · view state', () => {
    it('reports grid mode and no file cabinet by default', () => {
        const ui = makeUi();

        assert.deepEqual(render.getViewState(ui), {
            resolvedMode: 'grid',
            snapLayout: true,
            fileCabinetActive: false,
            activeBoardViewMode: 'grid'
        });
    });

    it('follows the stored file cabinet flag', () => {
        const ui = makeUi();
        store.set('matrix_file_cabinet', 'true');

        assert.equal(render.getViewState(ui).fileCabinetActive, true);
    });

    it('stamps the canvas with the grid class and the cabinet flag', () => {
        const ui = makeUi();
        const canvas = stubEl();
        canvas.className = 'stale';
        canvas.dataset.focusActive = '1';

        render.applyCanvasClasses(ui, canvas, true);

        assert.equal(canvas.className, 'view-grid');
        assert.equal(canvas.classes.has('file-cabinet-bottom'), true);
        assert.equal('focusActive' in canvas.dataset, false);
    });
});

describe('render · prepareCanvas', () => {
    it('drops the previous board and any checklist drag listeners', () => {
        const ui = makeUi();
        const root = stubEl();
        root._checklistDragData = {
            onMove: () => {},
            onUp: () => {}
        };
        const canvas = stubEl();
        canvas.innerHTML = '<div>old</div>';
        canvas.querySelectorAll = (selector) => (selector === '[data-checklistdrag-bound]' ? [root] : []);

        render.prepareCanvas(ui, canvas);

        assert.equal(canvas.innerHTML, '');
        assert.deepEqual(removedListeners, ['pointermove', 'pointerup', 'pointercancel']);
        assert.equal('_checklistDragData' in root, false);
    });
});

describe('render · categories', () => {
    it('drops the categories the caller hides', () => {
        const ui = makeUi();
        const stored = readStoredCategories();
        const hidden = [stored[0].name];

        const active = render.getActiveCategories(ui, hidden);

        assert.equal(active.some((cat) => cat.name === stored[0].name), false);
        assert.equal(active.length, stored.length - 1);
    });
});

describe('render · renderEmptyState', () => {
    const ui = makeUi();

    it('leaves the canvas alone while the file cabinet still shows notes', () => {
        const canvas = stubEl();
        canvas.innerHTML = 'untouched';

        render.renderEmptyState(ui, canvas, true, [{ id: 'a' }], [{ id: 'a' }]);

        assert.equal(canvas.innerHTML, 'untouched');
    });

    it('asks for a note when every item is hidden from this desktop', () => {
        const canvas = stubEl();
        const hidden = { id: 'a', desktopId: 9 };

        render.renderEmptyState(ui, canvas, false, [], [hidden]);

        assert.match(canvas.innerHTML, /Add new note/);
    });

    it('shows the clean-workspace message for a truly empty board', () => {
        const canvas = stubEl();

        render.renderEmptyState(ui, canvas, false, [], []);

        assert.match(canvas.innerHTML, /Workspace clean/);
    });
});

describe('render · render', () => {
    it('touches nothing without a canvas', () => {
        const ui = makeUi();
        setBoardItem({ id: 'keep' });

        render.render(ui, null, [{ id: 'a', desktopId: 1 }], 'grid');

        assert.equal(getBoardItem('keep').id, 'keep', 'the board lookup was cleared for a null canvas');
    });

    it('paints the empty state and leaves the lookup empty for an empty board', () => {
        const ui = makeUi();
        const canvas = stubEl();

        render.render(ui, canvas, [], 'grid');

        assert.equal(getBoardItemsMap().size, 0);
        assert.match(canvas.innerHTML, /Workspace clean/);
        assert.equal(ui.calls.extents, 0, 'nothing was laid out, so no extents pass should run');
    });

    it('lays out and finalizes a non-empty board', () => {
        const ui = makeUi();
        const canvas = stubEl();
        const items = [{ id: 'a', desktopId: 1, title: 'A' }];

        render.render(ui, canvas, items, 'grid');

        assert.equal(getBoardItem('a').title, 'A');
        assert.equal(ui.calls.applied.length, 1);
        assert.equal(ui.calls.extents, 1);
    });
});

describe('render · layoutBoard', () => {
    const items = [
        { id: 'a', desktopId: 1, title: 'A' },
        { id: 'b', desktopId: 1, title: 'B' }
    ];

    it('creates one pane with one card per item', () => {
        const ui = makeUi();
        const canvas = stubEl();

        const { boardPane } = render.layoutBoard(ui, canvas, items, []);

        assert.equal(canvas.children.length, 1);
        assert.equal(canvas.children[0], boardPane);
        assert.equal(boardPane.children.length, 2);
        assert.deepEqual(boardPane.children.map((card) => card.dataset.id), ['a', 'b']);
    });

    it('places, saves, finalizes and stacks every card', () => {
        const ui = makeUi();

        render.layoutBoard(ui, stubEl(), items, []);

        assert.equal(ui.calls.applied.length, 2);
        assert.deepEqual(ui.calls.saved.map(([id]) => id), ['a', 'b'], 'an unsaved rect should be persisted');
        assert.equal(ui.calls.stacked, 2, 'every card joins the stack exactly once');
        assert.ok(ui.calls.finalized >= 2, 'every card is finalized');
        assert.ok(ui.calls.pinned >= 2, 'every card is told about its pin state');
    });

    it('does not re-save a rect that is already stored', () => {
        const ui = makeUi({ getGridLayout: () => ({ a: { x: 16, y: 16, w: 65, h: 32 } }) });
        ui.isSavedLayoutExpanded = () => true;

        render.layoutBoard(ui, stubEl(), [items[0]], []);

        assert.deepEqual(ui.calls.saved, []);
    });
});

describe('render · finalizeRender', () => {
    it('always refreshes the canvas extents', () => {
        const ui = makeUi();

        render.finalizeRender(ui, stubEl(), stubEl(), {});

        assert.equal(ui.calls.extents, 1);
        assert.equal(ui.calls.scroll, 1);
    });

    it('skips the reflow-free scroll policy when the caller asks', () => {
        const ui = makeUi();

        render.finalizeRender(ui, stubEl(), stubEl(), { skipGridReflow: true });

        assert.equal(ui.calls.extents, 1);
        assert.equal(ui.calls.scroll, 0);
    });
});

describe('render · prepareBoardItems', () => {
    it('hands the visible items straight back when the cabinet is closed', () => {
        const ui = makeUi();
        const items = [{ id: 'a', desktopId: 1 }];

        const result = render.prepareBoardItems(ui, items, false, 'grid', [], items);

        assert.equal(result.boardItems, items);
        assert.equal(result.fileCabinetMount, null);
    });
});

describe('render · card action helpers', () => {
    it('syncCalendarButtonUI marks a hidden note as off', () => {
        const ui = makeUi();
        const btn = stubEl('button');

        render.syncCalendarButtonUI(ui, { id: 'a', hideFromCalendar: true }, btn);

        assert.equal(btn.classes.has('is-off'), true);
        assert.equal(btn.classes.has('is-on'), false);
        assert.match(btn.title, /click to show/);
    });

    it('syncCalendarButtonUI marks a shown note as on', () => {
        const ui = makeUi();
        const btn = stubEl('button');

        render.syncCalendarButtonUI(ui, { id: 'a' }, btn);

        assert.equal(btn.classes.has('is-on'), true);
        assert.match(btn.title, /click to hide/);
    });

    it('getCardActionsOptions only offers dragging on a live card with a session', () => {
        const ui = makeUi();
        const card = { dataset: { id: 'a', desktop: '9' } };

        assert.equal(render.getCardActionsOptions(ui, card).showDrag, false);

        store.set('admin_token', 'token');
        const live = { dataset: { id: 'a', desktop: String(DesktopManager.getActiveDesktop()) } };
        const opts = render.getCardActionsOptions(ui, live);

        assert.equal(opts.showDrag, true);
        assert.equal(opts.pinned, false);
        assert.equal(opts.spatialTile, true);
    });

    it('renderCards is a no-op left behind by the layout split', () => {
        assert.equal(render.renderCards(makeUi(), [], [], {}, [], stubEl()), undefined);
    });
});
