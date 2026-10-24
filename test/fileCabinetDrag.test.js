// test/fileCabinetDrag.test.js
// Characterization tests for js/fileCabinet/drag.js — where a drop lands, what
// the drag ghosts do to the DOM while a note is in flight, and the single piece
// of module state the layer keeps (which drop highlight is currently painted).
//
// Nothing here was tested before: filing correctness was "drag a card and look".
// The two failure modes this pins are the ones users actually hit — a drop
// resolving to the wrong drawer slot, and a highlight that stays stuck because
// the cached highlight key was not reset.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORDER_KEY = 'matrix_file_cabinet_order';

let cabinet = null;
let dispatched = [];

/** Element stand-in with the bits the drag layer touches. */
function makeEl({ tag = 'div', rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }, dataset = {}, classes = [] } = {}) {
    const classSet = new Set(classes);
    const children = [];
    const closers = new Map();
    const el = {
        tagName: String(tag).toUpperCase(),
        dataset: { ...dataset },
        style: { setProperty() {}, removeProperty() {} },
        classList: {
            add: (...names) => names.forEach((n) => classSet.add(n)),
            remove: (...names) => names.forEach((n) => classSet.delete(n)),
            contains: (n) => classSet.has(n),
            toggle: (n, force) => {
                const want = force === undefined ? !classSet.has(n) : !!force;
                if (want) classSet.add(n); else classSet.delete(n);
                return want;
            }
        },
        children,
        parentNode: null,
        isConnected: true,
        setAttribute() {},
        getAttribute: () => null,
        addEventListener() {},
        appendChild(child) {
            child.parentNode = el;
            children.push(child);
            return child;
        },
        insertBefore(node, ref) {
            node.parentNode = el;
            children.splice(Math.max(0, children.indexOf(ref)), 0, node);
            return node;
        },
        remove() { el.isConnected = false; },
        contains: (node) => node === el,
        getBoundingClientRect: () => rect,
        querySelector: (sel) => closers.get(`q:${sel}`) || null,
        querySelectorAll: () => [],
        closest: (sel) => closers.get(sel) || null,
        /** Wire what this element is "inside of", the way closest() would answer. */
        inside(map) {
            Object.entries(map).forEach(([sel, node]) => closers.set(sel, node));
            return el;
        }
    };
    return el;
}

function installGlobals({ order = {}, elementAt = () => null, elementsAt = () => [], splitter = null, canvas = null } = {}) {
    const store = new Map();
    if (Object.keys(order).length) store.set(ORDER_KEY, JSON.stringify(order));
    dispatched = [];
    const body = makeEl({ tag: 'body' });

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
    globalThis.document = {
        body,
        documentElement: makeEl({ tag: 'html' }),
        activeElement: null,
        elementFromPoint: (x, y) => elementAt(x, y),
        elementsFromPoint: (x, y) => elementsAt(x, y),
        getElementById: (id) => (id === 'shell-splitter-h' ? splitter : id === 'app-canvas' ? canvas : null),
        createElement: (tag) => makeEl({ tag }),
        createComment: (text) => {
            const node = { nodeType: 8, text, parentNode: null, remove() { node.removed = true; node.parentNode = null; } };
            return node;
        },
        querySelectorAll: () => [],
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
    globalThis.CSS = { escape: (s) => String(s) };
    return { body };
}

async function load() {
    if (cabinet === null) cabinet = await import('../js/fileCabinet.js');
    return cabinet;
}

/** The dragged tab: pointer-events is toggled around elementFromPoint probes. */
function makeDraggedCard(id) {
    return Object.assign(makeEl({ dataset: { id } }), { style: { pointerEvents: '' } });
}

describe('file cabinet drag · where a tab drop lands', () => {
    it('resolves a slot inside an open stack from the pointer', async () => {
        installGlobals({ order: { Office: ['n1', 'n2', 'n3'] } });
        await load();
        const drag = await import('../js/fileCabinet/drag.js');

        const stack = makeEl({ dataset: { category: 'Office' }, rect: { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200 } });
        stack.querySelectorAll = () => [makeEl({ dataset: { id: 'n2' } }), makeEl({ dataset: { id: 'n3' } })];
        const mount = makeEl();
        mount.contains = () => true;
        const el = makeEl().inside({ '.file-cabinet-tab-stack': stack });
        installGlobals({ order: { Office: ['n1', 'n2', 'n3'] }, elementAt: () => el });

        // second cascade slot (18px per slot), two tabs left after the dragged one
        const target = drag.resolveFileCabinetDropTarget(4, 40, { card: makeDraggedCard('n1') }, mount);

        assert.equal(target.kind, 'file-cabinet');
        assert.equal(target.targetCategory, 'Office');
        assert.equal(target.targetStack, stack);
        assert.equal(target.insertIndex, 2, 'slot index clamps to the remaining tabs');
        assert.equal(target.isFolded, false);
    });

    it('targets the end of a folded chip, ignoring the dragged note in the count', async () => {
        await load();
        const drag = await import('../js/fileCabinet/drag.js');
        const chip = makeEl({ dataset: { category: 'Home' } });
        const mount = makeEl();
        mount.contains = () => true;
        const el = makeEl().inside({ '.file-cabinet-filed-chip': chip });
        installGlobals({ order: { Home: ['n1', 'n2'] }, elementAt: () => el });

        const target = drag.resolveFileCabinetDropTarget(10, 10, { card: makeDraggedCard('n1') }, mount);

        assert.equal(target.targetCategory, 'Home');
        assert.equal(target.insertIndex, 1, 'a note dragged out of the drawer does not count itself');
        assert.equal(target.targetChip, chip);
        assert.equal(target.isFolded, true);
    });

    it('falls back to a mount-only target over the rail background', async () => {
        const mount = makeEl();
        mount.contains = () => true;
        installGlobals({ elementAt: () => makeEl({ classes: ['file-cabinet-inner'] }) });
        await load();
        const drag = await import('../js/fileCabinet/drag.js');

        const target = drag.resolveFileCabinetDropTarget(10, 10, { card: makeDraggedCard('n1') }, mount);

        assert.equal(target.isMountOnly, true);
        assert.equal(target.targetCategory, null);
    });

    it('prefers the nearest shelf when the pointer is inside the splitter band', async () => {
        await load();
        const drag = await import('../js/fileCabinet/drag.js');
        const col = makeEl({ dataset: { category: 'Office' }, rect: { left: 0, top: 500, right: 100, bottom: 594, width: 100, height: 94 } });
        const mount = makeEl({ rect: { left: 0, top: 600, right: 1200, bottom: 900, width: 1200, height: 300 } });
        mount.querySelectorAll = (sel) => (sel === '.file-cabinet-category' ? [col] : []);
        mount.contains = () => true;
        const splitter = makeEl({ rect: { left: 0, top: 590, right: 1200, bottom: 600, width: 1200, height: 10 } });
        installGlobals({ splitter, elementAt: () => null });

        const target = drag.resolveCrossSurfaceDropTarget(50, 595, { dragKind: 'fc-tab', mount, dragState: { card: makeDraggedCard('n1') } });

        assert.equal(target.kind, 'file-cabinet');
        assert.equal(target.targetCategory, 'Office', 'the splitter band snaps to the nearest shelf');
    });

    it('resolves the board when a tab is dragged out over the canvas', async () => {
        await load();
        const drag = await import('../js/fileCabinet/drag.js');
        const mount = makeEl({ rect: { left: 0, top: 600, right: 1200, bottom: 900, width: 1200, height: 300 } });
        const canvas = makeEl({ rect: { left: 0, top: 0, right: 1200, bottom: 560, width: 1200, height: 560 } });
        installGlobals({ canvas });

        const target = drag.resolveCrossSurfaceDropTarget(400, 200, { dragKind: 'fc-tab', mount, canvas });

        assert.equal(target.kind, 'board');
        assert.equal(target.clientX, 400);
    });

    it('resolves nothing when the pointer is over neither surface', async () => {
        await load();
        const drag = await import('../js/fileCabinet/drag.js');
        const mount = makeEl({ rect: { left: 0, top: 600, right: 1200, bottom: 900, width: 1200, height: 300 } });
        const canvas = makeEl({ rect: { left: 0, top: 0, right: 1200, bottom: 560, width: 1200, height: 560 } });
        installGlobals({ canvas });

        assert.equal(
            drag.resolveCrossSurfaceDropTarget(5000, 5000, { dragKind: 'fc-tab', mount, canvas }),
            null
        );
    });

    it('snaps to a shelf within half a column and gives up past that', async () => {
        await load();
        const drag = await import('../js/fileCabinet/drag.js');
        const col = makeEl({ dataset: { category: 'Office' }, rect: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 } });
        const mount = makeEl();
        mount.querySelectorAll = (sel) => (sel === '.file-cabinet-category' ? [col] : []);

        const near = drag.resolveNearestFileCabinetCategory(150, 50, { card: makeDraggedCard('n1') }, mount);
        assert.equal(near.targetCategory, 'Office');
        assert.equal(near.insertIndex, 0, 'no stack to measure against');
        assert.equal(drag.resolveNearestFileCabinetCategory(500, 500, { card: makeDraggedCard('n1') }, mount), null);
    });
});

describe('file cabinet drag · ghosts and highlight state', () => {
    it('lifts a board card onto the body and restores it into its slot', async () => {
        const { body } = installGlobals();
        await load();
        const drag = await import('../js/fileCabinet/drag.js');

        const container = makeEl();
        const card = makeEl({ rect: { left: 90, top: 90, right: 155, bottom: 122, width: 65, height: 32 } });
        container.appendChild(card);

        const state = drag.beginBoardFilingGhost(card, 100, 100);

        assert.equal(card.parentNode, body, 'card is lifted out of the canvas');
        assert.equal(card.style.position, 'fixed');
        assert.ok(card.classList.contains('spatial-at-small'), 'ghost shrinks to the label footprint');
        assert.equal(card.style.pointerEvents, 'none', 'ghost must not eat elementFromPoint');
        assert.equal(state.parent, container);

        drag.moveBoardFilingGhost(card, state, 400, 300);
        assert.equal(card.style.left, `${400 - state.offsetX}px`);
        assert.equal(card.style.top, `${300 - state.offsetY}px`);

        drag.endBoardFilingGhost(card, state);

        assert.equal(card.parentNode, container, 'card is put back where it came from');
        assert.equal(card.style.position, '');
        assert.equal(card.style.zIndex, '');
        assert.equal(card.classList.contains('spatial-at-small'), false);
    });

    it('keeps the collapsed size when the drop asks for it', async () => {
        installGlobals();
        await load();
        const drag = await import('../js/fileCabinet/drag.js');
        const container = makeEl();
        const card = makeEl();
        container.appendChild(card);

        const state = drag.beginBoardFilingGhost(card, 100, 100);
        drag.endBoardFilingGhost(card, state, { keepCollapsed: true });

        assert.ok(card.classList.contains('spatial-at-small'), 'filed cards stay small');
    });

    it('paints one drop highlight at a time and clears the cached key', async () => {
        installGlobals();
        await load();
        const drag = await import('../js/fileCabinet/drag.js');

        const chip = makeEl({ dataset: { category: 'Office' } });
        const mount = makeEl();
        // the layer clears old paint by querying the mount for the highlight class
        mount.querySelectorAll = (sel) => (sel === '.is-file-cabinet-drop-target'
            ? [chip].filter((el) => el.classList.contains('is-file-cabinet-drop-target'))
            : []);
        const canvas = makeEl({ tag: 'canvas' });
        // getElementById('app-canvas') is what the board target paints on
        globalThis.document.getElementById = (id) => (id === 'app-canvas' ? canvas : null);

        drag.applyFileCabinetDropHighlight(mount, { kind: 'file-cabinet', targetChip: chip, targetCategory: 'Office' });
        assert.ok(chip.classList.contains('is-file-cabinet-drop-target'));

        // same target again: cached key means no re-paint (idempotent)
        drag.applyFileCabinetDropHighlight(mount, { kind: 'file-cabinet', targetChip: chip, targetCategory: 'Office' });
        assert.ok(chip.classList.contains('is-file-cabinet-drop-target'));

        drag.applyFileCabinetDropHighlight(mount, { kind: 'board' });
        assert.ok(canvas.classList.contains('is-file-cabinet-board-drop-target'));
        assert.equal(chip.classList.contains('is-file-cabinet-drop-target'), false, 'old chip unpainted');

        drag.clearFileCabinetSurfaceHighlights(mount);
        assert.equal(canvas.classList.contains('is-file-cabinet-board-drop-target'), false);

        // after clearing, the *same* target must paint again — this is the state reset
        drag.applyFileCabinetDropHighlight(mount, { kind: 'file-cabinet', targetChip: chip, targetCategory: 'Office' });
        assert.ok(chip.classList.contains('is-file-cabinet-drop-target'), 'cached highlight key was reset');
    });
});

// The drag layer moved to js/fileCabinet/drag.js. dragdrop.js imports nine
// functions from the facade to run board-side filing, so they have to be the
// same objects; the 17 internal helpers (ghosts, previews, markers, targeting
// internals) must stay off the facade or that surface silently doubles.
describe('file cabinet drag · module boundary', () => {
    const PUBLIC = [
        'beginBoardFilingGhost', 'moveBoardFilingGhost', 'endBoardFilingGhost',
        'clearFileCabinetFilingPreview', 'previewFileCabinetTabDrop',
        'resolveCrossSurfaceDropTarget', 'clearFileCabinetSurfaceHighlights',
        'applyFileCabinetDropHighlight', 'initFileCabinetDrag'
    ];
    const NOT_PUBLIC = [
        'snapshotStackTabs', 'restoreStackPreview', 'beginFileCabinetDragGhost',
        'endFileCabinetDragGhost', 'getFileCabinetHitRect',
        'updateStackPreviewDimensions', 'applyStackPreviewPositions',
        'resolveFileCabinetDropTarget', 'resolveNearestFileCabinetCategory',
        'clearFileCabinetDropTargets', 'clearFileCabinetInsertMarker',
        'ensureFileCabinetInsertMarker', 'setFileCabinetDropTarget',
        'autoScrollFileCabinetInner', 'updateFileCabinetCategoryCount',
        'flashFileCabinetDropRejected', 'resetDraggedTabStyles'
    ];

    it('re-exports every drag entry point as the very same object', async () => {
        installGlobals();
        const facade = await load();
        const drag = await import('../js/fileCabinet/drag.js');

        for (const name of PUBLIC) {
            assert.equal(typeof drag[name], 'function', `${name} missing from fileCabinet/drag.js`);
            assert.equal(facade[name], drag[name], `${name} is wrapped instead of re-exported`);
        }
    });

    it('keeps the drag internals out of the facade surface', async () => {
        installGlobals();
        const facade = await load();

        for (const name of NOT_PUBLIC) {
            assert.equal(facade[name], undefined, `${name} leaked into the fileCabinet.js surface`);
        }
    });
});
