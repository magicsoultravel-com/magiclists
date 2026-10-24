// test/fileCabinetLayout.test.js
// Characterization tests for js/fileCabinet/layout.js — the drawer metrics that
// both the render layer and the drag layer measure against.
//
// Why these exist: `fileCabinetStackWidth`/`fileCabinetInsertIndexFromPoint`
// decide where a dragged note lands and how wide a shelf grows. They used to be
// inline in a 2.5k-line file, reachable only through a full DOM render, so a
// wrap/pitch regression showed up as "dropped notes land in the wrong drawer"
// and nowhere else. They are pure arithmetic over the label rect now, which
// means they can be pinned exactly.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getLabelRect } from '../js/tileGeometry.js';

let cabinet = null;
let padding = { left: 0, right: 0 };

function makeStack({ rect = { left: 0, top: 0, width: 400, height: 400 } } = {}) {
    const col = { style: {}, dataset: {} };
    const stack = {
        style: {},
        dataset: {},
        closest: (sel) => (sel === '.file-cabinet-category' ? col : null),
        getBoundingClientRect: () => rect,
        querySelectorAll: () => []
    };
    return { stack, col, rect };
}

function installGlobals() {
    const store = new Map();
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
        removeAttribute() {},
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
    globalThis.window = {
        innerWidth: 1200,
        innerHeight: 900,
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() {}
    };
    globalThis.document = {
        body: stubEl(),
        documentElement: stubEl(),
        activeElement: null,
        getElementById: () => null,
        createElement: () => stubEl(),
        addEventListener() {}
    };
    globalThis.getComputedStyle = () => ({
        paddingTop: '0px',
        paddingBottom: '0px',
        paddingLeft: `${padding.left}px`,
        paddingRight: `${padding.right}px`,
        getPropertyValue: () => ''
    });
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, opts = {}) {
            this.type = type;
            this.detail = opts.detail;
        }
    };
}

async function loadFacade() {
    if (cabinet === null) cabinet = await import('../js/fileCabinet.js');
    return cabinet;
}

const cardW = () => getLabelRect().w;
const cardH = () => getLabelRect().h;
/** Column pitch as layout.js derives it: one card + half the cascade fan. */
const pitch = () => cardW() + Math.round(((8 - 1) * 10 + 0) / 2);

describe('file cabinet layout · cascade geometry', () => {
    it('wraps to a new column every 8 cards', async () => {
        installGlobals();
        const layout = await import('../js/fileCabinet/layout.js');

        const expected = [
            [0, 0, 0], [7, 0, 7], [8, 1, 0], [9, 1, 1], [15, 1, 7], [16, 2, 0]
        ];
        for (const [index, col, slot] of expected) {
            assert.equal(layout.fileCabinetCascadeCol(index), col, `col(${index})`);
            assert.equal(layout.fileCabinetCascadeSlot(index), slot, `slot(${index})`);
        }
    });

    it('caps stack height at one column of cards', async () => {
        installGlobals();
        const layout = await import('../js/fileCabinet/layout.js');

        assert.equal(layout.fileCabinetStackHeight(1), cardH());
        assert.equal(layout.fileCabinetStackHeight(3), cardH() + 2 * 18);
        // 20 cards still render as one 8-card column, so the shelf does not grow
        assert.equal(layout.fileCabinetStackHeight(20), layout.fileCabinetStackHeight(8));
    });

    it('grows stack width when the cascade wraps into a second column', async () => {
        installGlobals();
        const layout = await import('../js/fileCabinet/layout.js');

        assert.equal(layout.fileCabinetStackWidth(1), cardW());
        assert.equal(layout.fileCabinetStackWidth(8), cardW() + 7 * 10);
        assert.equal(layout.fileCabinetStackWidth(9), pitch() + cardW());
        assert.ok(
            layout.fileCabinetStackWidth(9) > layout.fileCabinetStackWidth(8),
            'a wrapped second column has to widen the shelf'
        );
        assert.equal(layout.fileCabinetStackWidth(16), pitch() + cardW() + 7 * 10);
    });
});

describe('file cabinet layout · drawer sizing', () => {
    it('sizes the open drawer to the stack and pads the shelf', async () => {
        installGlobals();
        const layout = await import('../js/fileCabinet/layout.js');
        padding = { left: 12, right: 12 };

        const { stack, col } = makeStack();
        layout.applyOpenDrawerStackDimensions(stack, 2);
        const stackW = cardW() + 10;
        assert.equal(stack.style.width, `${stackW}px`);
        assert.equal(stack.style.minWidth, `${stackW}px`);
        // short stacks still reserve the minimum drawer height
        assert.equal(stack.style.height, `${Math.max(cardH() + 18, cardH() + 3 * 18)}px`);
        // shelf = stack + CSS padding, but never narrower than a drawer
        assert.equal(col.style.width, `${Math.max(stackW + 24, 160)}px`);
        assert.equal(col.style.flexBasis, `${Math.max(stackW + 24, 160)}px`);
        padding = { left: 0, right: 0 };
    });

    it('drops the padding contribution when the stack has no shelf', async () => {
        installGlobals();
        const layout = await import('../js/fileCabinet/layout.js');
        const stack = {
            style: {},
            closest: () => null,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 })
        };

        layout.applyOpenDrawerStackDimensions(stack, 1);
        assert.equal(stack.style.width, `${cardW()}px`);
    });

    it('reads the UI scale and falls back to 1 for junk or a missing mount', async () => {
        installGlobals();
        const layout = await import('../js/fileCabinet/layout.js');

        assert.equal(layout.getFileCabinetUiScale(null), 1);
        assert.equal(layout.getFileCabinetUiScale({}), 1, 'no --file-cabinet-ui-scale → 1');

        globalThis.getComputedStyle = () => ({
            getPropertyValue: (prop) => (prop === '--file-cabinet-ui-scale' ? '0.8' : '')
        });
        assert.equal(layout.getFileCabinetUiScale({}), 0.8);

        globalThis.getComputedStyle = () => ({ getPropertyValue: () => 'not-a-number' });
        assert.equal(layout.getFileCabinetUiScale({}), 1);
    });
});

describe('file cabinet layout · insert index from pointer', () => {
    it('maps a 2D point onto the cascade slot and clamps to the tab count', async () => {
        installGlobals();
        const layout = await import('../js/fileCabinet/layout.js');
        const { stack, rect } = makeStack();

        assert.equal(layout.fileCabinetInsertIndexFromPoint(stack, rect.left, rect.top, 3), 0);
        // second slot down in the first column
        assert.equal(layout.fileCabinetInsertIndexFromPoint(stack, rect.left + 2, rect.top + 18, 5), 1);
        // past the end of a single column still clamps to the tab count
        assert.equal(layout.fileCabinetInsertIndexFromPoint(stack, rect.left + pitch() + 2, rect.top + 36, 3), 3);
        // negative drags clamp to the first slot instead of going negative
        assert.equal(layout.fileCabinetInsertIndexFromPoint(stack, rect.left - 50, rect.top - 50, 3), 0);
    });
});

// js/fileCabinet/layout.js now owns the drawer metrics and js/fileCabinet.js
// re-exports them. Consumers (render.js, drag.js, ui.js) measure through the
// facade, so the re-export has to hand back the same function objects: a
// wrapper would be a new identity and a second call site to keep in sync.
describe('file cabinet layout · module boundary', () => {
    const PUBLIC = [
        'getFileCabinetDragMinHeight', 'getFileCabinetUiScale',
        'getFileCabinetContentMinHeight', 'applyFileCabinetStackPositions'
    ];
    const PUBLIC_CONSTS = [
        'FILE_CABINET_STACK_OFFSET_Y', 'FILE_CABINET_STACK_OFFSET_X',
        'FILE_CABINET_DRAWER_WIDTH', 'FILE_CABINET_DRAWER_MIN_CARDS',
        'FILE_CABINET_DRAWER_CARDS_PER_COL', 'FILE_CABINET_COL_GAP',
        'FILE_CABINET_MIN_HEIGHT', 'FILE_CABINET_REF_HEIGHT',
        'FILE_CABINET_MIN_HEIGHT_RATIO', 'DRAG_THRESHOLD'
    ];
    const NOT_PUBLIC = [
        // geometry the layout module keeps to itself
        'collapsedTabWidth', 'fileCabinetCascadeWidth', 'fileCabinetCascadeHeight',
        'fileCabinetCascadeCol', 'fileCabinetCascadeSlot', 'fileCabinetStackPitch',
        'fileCabinetTabLeft', 'fileCabinetTabTop', 'fileCabinetStackHeight',
        'fileCabinetStackWidth', 'fileCabinetCategoryPadX',
        'applyOpenDrawerStackDimensions', 'fileCabinetDrawerMinHeight',
        'fileCabinetInsertIndexFromPoint'
    ];

    it('re-exports every layout function as the very same object', async () => {
        installGlobals();
        const facade = await loadFacade();
        const layout = await import('../js/fileCabinet/layout.js');

        for (const name of PUBLIC) {
            assert.equal(typeof layout[name], 'function', `${name} missing from fileCabinet/layout.js`);
            assert.equal(facade[name], layout[name], `${name} is wrapped instead of re-exported`);
        }
    });

    it('shares the drawer constants instead of duplicating them', async () => {
        installGlobals();
        const facade = await loadFacade();
        const layout = await import('../js/fileCabinet/layout.js');

        for (const name of PUBLIC_CONSTS) {
            assert.equal(facade[name], layout[name], `${name} drifted from the layout module`);
        }
        assert.equal(layout.FILE_CABINET_DRAWER_CARDS_PER_COL, 8);
        assert.equal(layout.DRAG_THRESHOLD, 4);
        assert.equal(layout.getFileCabinetDragMinHeight(), 110);
    });

    it('keeps the layout internals out of the facade surface', async () => {
        installGlobals();
        const facade = await loadFacade();

        for (const name of NOT_PUBLIC) {
            assert.equal(facade[name], undefined, `${name} leaked into the fileCabinet.js surface`);
        }
    });

    it('keeps the label-rect lookup single-sourced', async () => {
        installGlobals();
        const layout = await import('../js/fileCabinet/layout.js');

        assert.equal(layout.fileCabinetStackWidth(1), getLabelRect().w);
        assert.equal(layout.fileCabinetStackHeight(1), getLabelRect().h);
    });
});
