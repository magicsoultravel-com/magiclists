// test/drawingBoardZLevel.test.js
// The z-level buttons act on the current selection and nothing else: no pref,
// no "staged" level for the next stroke. That makes three things easy to break
// silently — the buttons working with an empty selection, a click that changes
// nothing still writing history, and the pressed/disabled readout going stale
// after the selection changes. All three are pinned here.
//
// Run with: npm test
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    Z_BOTTOM, Z_MIDDLE, Z_TOP,
    applyZLevel, selectionState, selectionZLevel, setZLevel
} from '../js/drawingBoard/zLevel.js';
import {
    layerControlsHtml, updateLayerControls, refreshSelectionControls
} from '../js/drawingBoardToolbar.js';

/** Board stub: selection + the four side effects a level change is allowed. */
function makeBoard(items = []) {
    const board = {
        selectedStrokes: new Set(items),
        layerPushes: 0,
        saves: 0,
        redraws: 0,
        controlRefreshes: 0
    };
    board.getSelectedStrokesArray = function () { return Array.from(this.selectedStrokes); };
    board.pushLayerHistory = function () { this.layerPushes += 1; };
    board.scheduleSave = function () { this.saves += 1; };
    board.requestRedraw = function () { this.redraws += 1; };
    board.updateLayerControls = function () { this.controlRefreshes += 1; };
    return board;
}

/** Minimal element: only what updateLayerControls touches. */
function fakeButton() {
    const pressed = new Set();
    return {
        disabled: false,
        attrs: {},
        classList: {
            toggle(name, on) { if (on) pressed.add(name); else pressed.delete(name); },
            contains(name) { return pressed.has(name); }
        },
        setAttribute(name, value) { this.attrs[name] = String(value); },
        getAttribute(name) { return this.attrs[name]; }
    };
}

/** Toolbar stub holding one layer group with its two buttons. */
function fakeToolbar() {
    const top = fakeButton();
    const bottom = fakeButton();
    const group = {
        attrs: {},
        setAttribute(name, value) { this.attrs[name] = String(value); },
        getAttribute(name) { return this.attrs[name]; },
        querySelector(selector) {
            if (selector === '#draw-layer-top') return top;
            if (selector === '#draw-layer-bottom') return bottom;
            return null;
        }
    };
    return {
        top,
        bottom,
        group,
        querySelector(selector) {
            return selector === '#draw-layer-group' ? group : null;
        }
    };
}

describe('selectionState / selectionZLevel', () => {
    it('reports an empty selection without inventing a level', () => {
        assert.deepEqual(selectionState(makeBoard()), { count: 0, level: null });
        assert.equal(selectionZLevel(makeBoard()), null);
    });

    it('reads middle for items that never got a level', () => {
        assert.deepEqual(selectionState(makeBoard([{}, {}])), { count: 2, level: Z_MIDDLE });
    });

    it('agrees on a shared level across kinds', () => {
        const board = makeBoard([{ zLevel: Z_TOP }, { zLevel: Z_TOP }, { zLevel: Z_TOP }]);
        assert.deepEqual(selectionState(board), { count: 3, level: Z_TOP });
        assert.equal(selectionZLevel(board), Z_TOP);
    });

    it('reports null when the selection is mixed', () => {
        const board = makeBoard([{ zLevel: Z_TOP }, {}]);
        assert.deepEqual(selectionState(board), { count: 2, level: null });
    });
});


describe('applyZLevel', () => {
    it('does nothing without a selection', () => {
        const board = makeBoard();
        assert.equal(applyZLevel(board, Z_TOP), 0);
        assert.equal(board.layerPushes, 0);
        assert.equal(board.saves, 0);
    });

    it('is a no-op when the selection already sits on that level', () => {
        const board = makeBoard([{ zLevel: Z_TOP }]);
        assert.equal(applyZLevel(board, Z_TOP), 0);
        assert.equal(board.layerPushes, 0, 'a click that changes nothing must not consume an undo step');
        assert.equal(board.saves, 0);
    });

    it('re-levels strokes, texts and images together in one undo step', () => {
        const stroke = { id: 's' };
        const text = { id: 't' };
        const image = { id: 'i' };
        const board = makeBoard([stroke, text, image]);

        assert.equal(applyZLevel(board, Z_TOP), 3);
        assert.equal(stroke.zLevel, Z_TOP);
        assert.equal(text.zLevel, Z_TOP);
        assert.equal(image.zLevel, Z_TOP);
        assert.equal(board.layerPushes, 1, 'one selection change = one history entry');
        assert.equal(board.saves, 1);
        assert.equal(board.redraws, 1);
        assert.deepEqual(Array.from(board.selectedStrokes), [stroke, text, image], 'the selection survives the change');
    });

    it('drops the field again when the selection returns to the middle', () => {
        const stroke = { id: 's', zLevel: Z_BOTTOM };
        const board = makeBoard([stroke]);

        assert.equal(applyZLevel(board, Z_MIDDLE), 1);
        assert.equal(Object.prototype.hasOwnProperty.call(stroke, 'zLevel'), false,
            'middle is stored as "no field" so an untouched document saves unchanged');
        assert.equal(selectionZLevel(board), Z_MIDDLE);
    });

    it('leaves unselected items alone', () => {
        const picked = { id: 'picked' };
        const other = { id: 'other', zLevel: Z_BOTTOM };
        const board = makeBoard([picked]);

        applyZLevel(board, Z_TOP);
        assert.equal(picked.zLevel, Z_TOP);
        assert.equal(other.zLevel, Z_BOTTOM);
    });

    it('normalises junk input instead of writing it through', () => {
        const item = { id: 's' };
        const board = makeBoard([item]);
        applyZLevel(board, '1');
        assert.equal(item.zLevel, Z_TOP);
        applyZLevel(board, 42);
        assert.equal(Object.prototype.hasOwnProperty.call(item, 'zLevel'), false);
    });
});

describe('setZLevel (toolbar action)', () => {
    it('sends the selection to the pressed level and back to the middle on a second press', () => {
        const item = { id: 's' };
        const board = makeBoard([item]);

        assert.equal(setZLevel(board, Z_TOP), 1);
        assert.equal(item.zLevel, Z_TOP);

        assert.equal(setZLevel(board, Z_TOP), 1);
        assert.equal(item.zLevel, undefined, 'the pressed button is a toggle back to the middle');
        assert.equal(board.layerPushes, 2);
    });

    it('switches sides in one click', () => {
        const item = { id: 's', zLevel: Z_TOP };
        const board = makeBoard([item]);
        assert.equal(setZLevel(board, Z_BOTTOM), 1);
        assert.equal(item.zLevel, Z_BOTTOM);
    });

    it('unifies a mixed selection on the pressed level', () => {
        const up = { id: 'up', zLevel: Z_TOP };
        const mid = { id: 'mid' };
        const board = makeBoard([up, mid]);

        assert.equal(selectionZLevel(board), null);
        assert.equal(setZLevel(board, Z_TOP), 1, 'only the item that was not already on top changes');
        assert.equal(up.zLevel, Z_TOP);
        assert.equal(mid.zLevel, Z_TOP);
        assert.equal(selectionZLevel(board), Z_TOP);
    });

    it('is inert with nothing selected', () => {
        const board = makeBoard();
        assert.equal(setZLevel(board, Z_TOP), 0);
        assert.equal(setZLevel(board, Z_BOTTOM), 0);
        assert.equal(board.layerPushes, 0);
    });

    it('refreshes the button readout after the change', () => {
        const board = makeBoard([{ id: 's' }]);
        setZLevel(board, Z_TOP);
        assert.equal(board.controlRefreshes, 1);
    });
});

describe('layerControlsHtml', () => {
    it('renders both buttons disabled with nothing selected', () => {
        const html = layerControlsHtml(makeBoard());
        assert.ok(html.includes('id="draw-layer-group"'));
        assert.ok(html.includes('id="draw-layer-top"'));
        assert.ok(html.includes('id="draw-layer-bottom"'));
        assert.ok(html.includes('Layer — select an item first'), 'the tooltip explains the greyed-out state');
        assert.equal((html.match(/ disabled/g) || []).length, 2, 'both buttons are disabled');
        assert.ok(!html.includes('active'), 'nothing is pressed');
    });

    it('enables both buttons and presses the shared level', () => {
        const top = layerControlsHtml(makeBoard([{ zLevel: Z_TOP }]));
        assert.ok(!top.includes(' disabled'));
        assert.equal((top.match(/aria-pressed="true"/g) || []).length, 1);
        assert.ok(top.includes('class="btn btn--compact btn--icon active" id="draw-layer-top"'));

        const bottom = layerControlsHtml(makeBoard([{ zLevel: Z_BOTTOM }]));
        assert.ok(bottom.includes('class="btn btn--compact btn--icon active" id="draw-layer-bottom"'));
    });

    it('presses neither button for a middle-layer or mixed selection', () => {
        [makeBoard([{}]), makeBoard([{ zLevel: Z_TOP }, {}])].forEach((board) => {
            const html = layerControlsHtml(board);
            assert.ok(!html.includes(' active'), 'middle and mixed both read as "not on a side"');
            assert.ok(!html.includes(' disabled'), 'but the buttons stay usable');
        });
    });
});

describe('updateLayerControls', () => {
    it('flips the live buttons when the selection comes and goes', () => {
        const item = { id: 's' };
        const board = makeBoard();
        const toolbar = fakeToolbar();
        board.toolbarEl = toolbar;

        updateLayerControls(board);
        assert.equal(toolbar.top.disabled, true);
        assert.equal(toolbar.bottom.disabled, true);
        assert.equal(toolbar.group.getAttribute('title'), 'Layer — select an item first');

        board.selectedStrokes.add(item);
        setZLevel(board, Z_BOTTOM);
        updateLayerControls(board);
        assert.equal(toolbar.top.disabled, false);
        assert.equal(toolbar.bottom.disabled, false);
        assert.equal(toolbar.bottom.getAttribute('aria-pressed'), 'true');
        assert.equal(toolbar.top.getAttribute('aria-pressed'), 'false');
        assert.ok(toolbar.bottom.classList.contains('active'));
        assert.ok(!toolbar.top.classList.contains('active'));

        // What Escape / a marquee miss does: selection clears, buttons grey out.
        board.selectedStrokes.clear();
        updateLayerControls(board);
        assert.equal(toolbar.top.disabled, true);
        assert.equal(toolbar.bottom.disabled, true);
        assert.equal(toolbar.bottom.getAttribute('aria-pressed'), 'false');
        assert.ok(!toolbar.bottom.classList.contains('active'));
    });

    it('survives a toolbar that is not mounted yet', () => {
        const board = makeBoard();
        updateLayerControls(board);
        board.toolbarEl = { querySelector: () => null };
        updateLayerControls(board);
    });
});

describe('refreshSelectionControls', () => {
    it('refreshes the text readout and the layer buttons in one call', () => {
        const board = makeBoard();
        board.toolbarEl = fakeToolbar();
        board.currentTextSize = () => 40;
        board.textSizeRange = () => ({ min: 8, max: 72 });

        refreshSelectionControls(board);
        assert.equal(board.toolbarEl.top.disabled, true, 'layer buttons follow the empty selection');
    });
});

