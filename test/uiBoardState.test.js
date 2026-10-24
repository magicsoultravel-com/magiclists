// test/uiBoardState.test.js
// The state seam behind js/ui.js.
//
// js/ui.js used to close over two module-level bindings: `boardItemsById` (the
// Map render() refills and every mutation writes through) and
// `activeBoardViewMode`. Both are read by methods that are now spread over
// four session modules, so they moved into a leaf module with accessors.
//
// Two details are easy to break and invisible when broken:
//   1. render() *reassigns* the Map after clearing it, so the seam needs a
//      replace-map setter, not just set/delete on a captured reference;
//   2. the facade's `getActiveBoardViewMode()` must read the same binding the
//      spatial layer writes, otherwise `findDesktopCenterSlot` silently packs
//      for a stale mode.
//
// Run with: npm test  (node --test test/)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const state = await import('../js/ui/boardState.js');
const { UI } = await import('../js/ui.js');

beforeEach(() => {
    state.replaceBoardItemsMap(new Map());
    state.writeActiveBoardViewMode('grid');
});

describe('board state · view mode', () => {
    it('starts in grid mode', () => {
        assert.equal(state.readActiveBoardViewMode(), 'grid');
    });

    it('round-trips any mode the caller writes', () => {
        state.writeActiveBoardViewMode('freeform');

        assert.equal(state.readActiveBoardViewMode(), 'freeform');
    });

    it('is the binding the facade exposes', () => {
        state.writeActiveBoardViewMode('freeform');

        assert.equal(UI.getActiveBoardViewMode(), 'freeform');

        state.writeActiveBoardViewMode('grid');
        assert.equal(UI.getActiveBoardViewMode(), 'grid');
    });
});

describe('board state · item lookup', () => {
    const note = { id: 'n1', title: 'first' };

    it('stores items by id and finds them again', () => {
        state.setBoardItem(note);

        assert.equal(state.getBoardItem('n1'), note);
    });

    it('returns null for an unknown or missing id instead of undefined', () => {
        assert.equal(state.getBoardItem('nope'), null);
        assert.equal(state.getBoardItem(null), null);
        assert.equal(state.getBoardItem(undefined), null);
    });

    it('ignores anything without an id', () => {
        state.setBoardItem({ title: 'no id' });
        state.setBoardItem(null);

        assert.equal(state.getBoardItemsMap().size, 0);
    });

    it('keeps one entry per id', () => {
        state.setBoardItem(note);
        state.setBoardItem({ ...note, title: 'edited' });

        assert.equal(state.getBoardItemsMap().size, 1);
        assert.equal(state.getBoardItem('n1').title, 'edited');
    });

    it('clears in place so earlier readers stay valid', () => {
        state.setBoardItem(note);
        const map = state.getBoardItemsMap();

        state.clearBoardItems();

        assert.equal(state.getBoardItemsMap(), map);
        assert.equal(map.size, 0);
    });

    it('replaces the map by identity, which is what render() relies on', () => {
        state.setBoardItem(note);
        const before = state.getBoardItemsMap();
        const next = new Map([['n2', { id: 'n2' }]]);

        state.replaceBoardItemsMap(next);

        assert.equal(state.getBoardItemsMap(), next);
        assert.equal(state.getBoardItem('n1'), null);
        assert.equal(before.has('n1'), true, 'the old map should not be mutated by a replace');
    });

    it('falls back to an empty map when handed something that is not a Map', () => {
        state.replaceBoardItemsMap(null);

        assert.equal(state.getBoardItemsMap().size, 0);
        assert.equal(state.getBoardItem('n1'), null);
    });
});

describe('board state · facade wiring', () => {
    it('feeds resolveBoardItem from the shared lookup', () => {
        const note = { id: 'n9', title: 'wired' };
        state.setBoardItem(note);

        assert.equal(UI.resolveBoardItem('n9'), note);
        assert.equal(UI.resolveBoardItem('missing'), null);
    });

    it('updates the shared lookup through UI.updateBoardItemsMap', () => {
        const note = { id: 'n10' };
        UI.updateBoardItemsMap(note);

        assert.equal(state.getBoardItem('n10'), note);
    });
});
