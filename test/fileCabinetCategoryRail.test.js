// test/fileCabinetCategoryRail.test.js
// Characterization tests for js/fileCabinet/categoryRail.js — the shelf header
// actions (fold / expand / open-all / color / hide / add) and the empty-shelf
// toggle, plus the note-id collection that a shelf drag hands to a desktop.
//
// This is all one delegated `click`/`focusin` handler on the mount, so it used
// to be tested by clicking a rendered rail in a browser only. The harness below
// records the listeners the module registers and fires synthetic events at
// them, which pins "fold writes filed_categories", "open-all empties the drawer"
// and the event names other modules listen for.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORDER_KEY = 'matrix_file_cabinet_order';
const FILED_KEY = 'matrix_file_cabinet_filed_categories';
const EMPTY_COLLAPSED_KEY = 'matrix_file_cabinet_empty_shelves_collapsed';

let cabinet = null;
let dispatched = [];

/** Mount stand-in that records delegated listeners so tests can fire them. */
function makeMount() {
    const listeners = new Map();
    const mount = {
        dataset: {},
        style: { setProperty() {}, removeProperty() {} },
        className: 'file-cabinet',
        classList: classListStub(),
        innerHTML: '',
        children: [],
        isConnected: true,
        addEventListener(type, handler) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type).push(handler);
        },
        removeEventListener() {},
        contains: () => true,
        closest: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
    };
    return { mount, listeners };
}

/** Class list stand-in that remembers what was added, for assertions. */
function classListStub() {
    const classes = new Set();
    return {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, force) => {
            const want = force === undefined ? !classes.has(name) : !!force;
            if (want) classes.add(name); else classes.delete(name);
            return want;
        },
        contains: (name) => classes.has(name)
    };
}

/** Fire the delegated listeners of `type` with a target that answers `closest`. */
function fire(listeners, type, matcher) {
    const event = {
        target: {
            closest(sel) {
                const hit = matcher[sel];
                return hit === undefined ? null : hit;
            }
        },
        preventDefault() { event.defaultPrevented = true; },
        stopPropagation() { event.propagationStopped = true; },
        defaultPrevented: false,
        propagationStopped: false
    };
    for (const handler of listeners.get(type) || []) handler(event);
    return event;
}

function installGlobals({ order = {}, filed = [], emptyCollapsed = null } = {}) {
    const store = new Map();
    if (Object.keys(order).length) store.set(ORDER_KEY, JSON.stringify(order));
    if (filed.length) store.set(FILED_KEY, JSON.stringify(filed));
    if (emptyCollapsed !== null) store.set(EMPTY_COLLAPSED_KEY, String(emptyCollapsed));
    dispatched = [];

    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
    globalThis.window = {
        innerWidth: 1200,
        innerHeight: 900,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent(ev) { dispatched.push(ev); return true; }
    };
    const stubEl = () => ({
        style: { setProperty() {}, removeProperty() {} },
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        innerHTML: '',
        className: '',
        id: '',
        title: '',
        type: '',
        isConnected: true,
        setAttribute() {},
        getAttribute: () => null,
        addEventListener() {},
        appendChild(child) { this.children.push(child); return child; },
        remove() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        contains: () => false,
        getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
    });
    globalThis.document = {
        body: stubEl(),
        documentElement: stubEl(),
        activeElement: null,
        getElementById: () => null,
        createElement: () => stubEl(),
        addEventListener() {},
        querySelectorAll: () => []
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
    globalThis.CSS = { escape: (s) => String(s) };
    return store;
}

async function load() {
    if (cabinet === null) cabinet = await import('../js/fileCabinet.js');
    return cabinet;
}

function makeUI(overrides = {}) {
    const saved = {};
    return {
        saved,
        getGridLayout: () => ({}),
        getFreeformPositions: () => ({}),
        persistRememberedSpatialSize() {},
        getActiveBoardViewMode: () => 'grid',
        resolveRememberedSpatialSize: () => ({ w: 65, h: 32 }),
        getGridBoardBounds: () => ({ packW: 2000, maxH: 2000, origin: { x: 0, y: 0 }, edgePad: 8 }),
        snapNotePosition: (placed) => placed,
        saveGridLayout(id, rect) { saved[id] = rect; },
        ...overrides
    };
}

/**
 * The UI surface buildFileCabinetRolloutStack touches: three calls of its own plus
 * the ones createCardComponent/renderBoardEditorCard make on every card.
 */
function makeRolloutUI() {
    const calls = { applied: [], finalized: 0, toggled: 0, pinned: 0, raised: 0 };
    return makeUI({
        calls,
        applyNoteRect(card, rect) { calls.applied.push({ card, rect }); },
        finalizeDesktopCard() { calls.finalized += 1; },
        syncSpatialToggleButton() { calls.toggled += 1; },
        syncBoardPinClass() { calls.pinned += 1; },
        raiseDesktopCard() { calls.raised += 1; },
        buildCardActionsHtml: () => '',
        getCardActionsOptions: () => ({}),
        bindBoardEditorFocusChrome() {},
        focusPendingBoardField() {}
    });
}

/** A folded rail slot: the chip plus the empty rollout the preview fills. */
function makeSlot(catName) {
    const rollout = {
        innerHTML: '',
        children: [],
        setAttribute() {},
        removeAttribute() {},
        appendChild(child) { this.children.push(child); return child; },
        querySelector: () => null
    };
    const chip = { classList: classListStub() };
    const slot = {
        dataset: { category: catName },
        classList: classListStub(),
        isConnected: true,
        chip,
        rollout,
        contains: () => false,
        querySelector: (sel) => (sel === '.file-cabinet-filed-rollout' ? rollout
            : sel === '.file-cabinet-filed-chip' ? chip
                : null)
    };
    return slot;
}

const eventsOf = (type) => dispatched.filter((ev) => ev.type === type);
const readOrder = () => JSON.parse(globalThis.localStorage.getItem(ORDER_KEY) || '{}');
const readFiled = () => JSON.parse(globalThis.localStorage.getItem(FILED_KEY) || '[]');

describe('file cabinet category rail · header actions', () => {
    const COL = { dataset: { category: 'Office' } };

    it('folds an open shelf into the filed rail', async () => {
        installGlobals({ order: { Office: ['n1'] } });
        const fc = await load();
        const { mount, listeners } = makeMount();
        fc.initFileCabinetCategoryActions(mount, new AbortController().signal);

        const foldBtn = { closest: (sel) => (sel === '.file-cabinet-category' ? COL : null) };
        const event = fire(listeners, 'click', { '.file-cabinet-category-fold-btn': foldBtn });

        assert.deepEqual(readFiled(), ['Office'], 'fold persists the category as filed');
        assert.ok(event.defaultPrevented && event.propagationStopped, 'click is swallowed');
        assert.equal(eventsOf('filecabinet:layout_changed').length, 1);
    });

    it('expands a folded chip back into an open shelf', async () => {
        installGlobals({ order: { Office: ['n1'] }, filed: ['Office'] });
        const fc = await load();
        const { mount, listeners } = makeMount();
        fc.initFileCabinetCategoryActions(mount, new AbortController().signal);

        const chip = { dataset: { category: 'Office' } };
        const expandBtn = { closest: (sel) => (sel === '.file-cabinet-filed-chip' ? chip : null) };
        fire(listeners, 'click', { '.file-cabinet-filed-chip-expand': expandBtn });

        assert.deepEqual(readFiled(), [], 'expand clears the filed flag');
        assert.equal(eventsOf('filecabinet:layout_changed').length, 1);
    });

    it('opens every note in a shelf onto the board', async () => {
        installGlobals({ order: { Office: ['n1', 'n2'] }, filed: ['Office'] });
        const fc = await load();
        const { mount, listeners } = makeMount();
        const UI = makeUI();
        fc.initFileCabinetCategoryActions(mount, new AbortController().signal, UI);

        const openAllBtn = { closest: (sel) => (sel === '.file-cabinet-category, .file-cabinet-filed-chip' ? COL : null) };
        fire(listeners, 'click', { '.file-cabinet-category-open-all-btn': openAllBtn });

        assert.ok(UI.saved.n1 && UI.saved.n2, 'both notes placed back on the board');
        assert.deepEqual(readOrder().Office || [], [], 'drawer emptied');
        assert.equal(eventsOf('board:visibility_changed').length, 1);
    });

    it('toggles the EMPTY group and re-renders', async () => {
        installGlobals({ emptyCollapsed: false });
        const fc = await load();
        const { mount, listeners } = makeMount();
        fc.initFileCabinetCategoryActions(mount, new AbortController().signal);

        fire(listeners, 'click', { '.file-cabinet-empty-shelves__toggle': {} });

        assert.equal(globalThis.localStorage.getItem(EMPTY_COLLAPSED_KEY), 'true');
        assert.equal(eventsOf('filecabinet:layout_changed').length, 1);
    });

    it('asks the app to add a category instead of writing one itself', async () => {
        installGlobals({ order: { Office: ['n1'] } });
        const fc = await load();
        const { mount, listeners } = makeMount();
        fc.initFileCabinetCategoryActions(mount, new AbortController().signal);

        const addBtn = { id: 'add' };
        fire(listeners, 'click', { '.file-cabinet-add-category-btn': addBtn });

        const events = eventsOf('category:add_prompt');
        assert.equal(events.length, 1);
        assert.equal(events[0].detail.anchor, addBtn);
        assert.deepEqual(readOrder(), { Office: ['n1'] }, 'no category is written here');
    });

    it('routes hide and color actions to the app events', async () => {
        installGlobals({ order: { Office: ['n1'] } });
        const fc = await load();
        const { mount, listeners } = makeMount();
        fc.initFileCabinetCategoryActions(mount, new AbortController().signal);

        const btn = { closest: (sel) => (sel === '.file-cabinet-category, .file-cabinet-filed-chip' ? COL : null) };
        fire(listeners, 'click', { '.file-cabinet-category-hide-btn': btn });

        const events = eventsOf('category:hide_requested');
        assert.equal(events.length, 1);
        assert.equal(events[0].detail.name, 'Office');
    });
});

describe('file cabinet category rail · shelf drag note ids', () => {
    it('reads the tab ids off a rendered column', async () => {
        installGlobals({ order: { Office: ['ignored'] } });
        await load(); // globals first: the rail module imports the facade's peers
        const rail = await import('../js/fileCabinet/categoryRail.js');
        const { mount } = makeMount();
        mount.querySelector = () => ({
            querySelectorAll: () => [{ dataset: { id: 'n1' } }, { dataset: { id: '' } }, { dataset: { id: 'n2' } }]
        });

        assert.deepEqual(
            rail.collectFileCabinetCategoryNoteIds(mount, 'Office', [], 1),
            ['n1', 'n2'],
            'open shelf: DOM order, blanks dropped'
        );
    });

    it('falls back to the stored order filtered by desktop for a folded shelf', async () => {
        installGlobals({ order: { Office: ['n1', 'n2', 'gone'] } });
        await load();
        const rail = await import('../js/fileCabinet/categoryRail.js');
        const { mount } = makeMount();
        const items = [
            { id: 'n1', desktopId: 1 },
            { id: 'n2', desktopId: 2 },
            { id: 'other', desktopId: 1 }
        ];

        assert.deepEqual(
            rail.collectFileCabinetCategoryNoteIds(mount, 'Office', items, 1),
            ['n1'],
            'only notes living on the active desktop travel'
        );
        assert.deepEqual(rail.collectFileCabinetCategoryNoteIds(mount, '', items, 1), []);
    });
});

// The rail moved to js/fileCabinet/categoryRail.js; the facade still wires it in
// initFileCabinetDrag, and categoriesOverlay.js renders the rollout through the
// facade. Identity matters for the same reason as the other slices, and the
// ghost/desktop helpers must stay internal.
// The folded-slot hover preview appends exactly this builder's output, so a metric
// that is used here but not imported (fileCabinetStackWidth was) kills the preview
// with a ReferenceError before the rollout ever lands in the DOM.
describe('file cabinet category rail · folded-slot rollout stack', () => {
    it('builds a tab per note and pins the stack to the cascade width', async () => {
        installGlobals();
        await load(); // globals first: the rail module imports the facade's peers
        const rail = await import('../js/fileCabinet/categoryRail.js');
        const layout = await import('../js/fileCabinet/layout.js');
        const UI = makeRolloutUI();
        const calls = UI.calls;
        const items = [
            { id: 'n1', title: 'One', categories: ['Office'], desktopId: 1 },
            { id: 'n2', title: 'Two', categories: ['Office'], desktopId: 1 },
            { id: 'n3', title: 'Three', categories: ['Office'], desktopId: 1 }
        ];

        const stack = rail.buildFileCabinetRolloutStack({
            catName: 'Office',
            items,
            activeCategories: [{ name: 'Office', color: '#abc' }],
            UI
        });

        assert.equal(stack.className, 'file-cabinet-tab-stack');
        assert.equal(stack.dataset.category, 'Office');
        assert.equal(stack.children.length, 3, 'one tab per note in the shelf');
        assert.deepEqual(stack.children.map((tab) => tab.dataset.id), ['n1', 'n2', 'n3']);
        assert.equal(calls.applied.length, 3, 'every tab takes the shelf label footprint');
        assert.equal(calls.toggled, 3, 'every tab gets its spatial toggle');
        for (const { rect } of calls.applied) {
            assert.deepEqual([rect.x, rect.y], [0, 0]);
            assert.ok(rect.w > 0 && rect.h > 0);
        }
        assert.equal(stack.style.width, `${layout.fileCabinetStackWidth(3)}px`, 'the popover hugs the wrapped cascade');
    });
});

// The reported symptom, end to end: pointerover a folded slot has to leave a rendered
// stack in the rollout and mark the slot open. When the builder threw, the listener
// died before any of these classes were applied and hover did nothing.
describe('file cabinet category rail · folded-slot hover preview', () => {
    it('opens the rollout with the shelf notes on pointerover', async () => {
        installGlobals();
        await load();
        const rail = await import('../js/fileCabinet/categoryRail.js');
        const UI = makeRolloutUI();
        const { mount, listeners } = makeMount();
        const slot = makeSlot('Office');
        const items = [
            { id: 'n1', title: 'One', categories: ['Office'], desktopId: 1 },
            { id: 'n2', title: 'Two', categories: ['Office'], desktopId: 1 }
        ];

        rail.initFileCabinetFoldedHoverPreview(mount, () => ({
            byCategory: new Map([['Office', items]]),
            activeCategories: [{ name: 'Office', color: '#abc' }],
            order: {},
            UI
        }), new AbortController().signal);

        fire(listeners, 'pointerover', { '.file-cabinet-filed-slot': slot });

        assert.ok(slot.classList.contains('is-fold-rollout-open'), 'hover opens the folded drawer');
        assert.ok(slot.chip.classList.contains('is-fold-preview-source'), 'the chip it came from is marked');
        assert.ok(mount.classList.contains('is-rollout-active'), 'the cabinet knows a rollout is up');
        assert.equal(slot.rollout.children.length, 1, 'the stack lands in the rollout');
        assert.equal(slot.rollout.children[0].className, 'file-cabinet-tab-stack');
        assert.equal(slot.rollout.children[0].children.length, 2, 'one tab per note in the shelf');
    });
});

describe('file cabinet category rail · module boundary', () => {
    const PUBLIC = [
        'buildFileCabinetRolloutStack', 'initFileCabinetFoldedHoverPreview',
        'initFileCabinetCategoryActions'
    ];
    const NOT_PUBLIC = [
        // private before the split too: only initFileCabinetDrag ever called it
        'initFileCabinetCategoryColumnDrag',
        'readStoredCategoriesFromContext', 'createCategoryChipGhost',
        'collectFileCabinetCategoryNoteIds', 'assignFileCabinetItemsToDesktop'
    ];

    it('re-exports every rail initializer as the very same object', async () => {
        installGlobals();
        const facade = await load();
        const rail = await import('../js/fileCabinet/categoryRail.js');

        for (const name of PUBLIC) {
            assert.equal(typeof rail[name], 'function', `${name} missing from fileCabinet/categoryRail.js`);
            assert.equal(facade[name], rail[name], `${name} is wrapped instead of re-exported`);
        }
    });

    it('keeps the rail internals out of the facade surface', async () => {
        installGlobals();
        const facade = await load();

        for (const name of NOT_PUBLIC) {
            assert.equal(facade[name], undefined, `${name} leaked into the fileCabinet.js surface`);
        }
    });
});
