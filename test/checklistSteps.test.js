// Unit tests for js/checklistSteps.js tree-model logic (levels, indent/outdent,
// child-drop level resolution). Run with: npm test  (node --test test/)
//
// These cover the H3-A "flexible indentation" model: the first item may be any
// level 0-4, gaps are allowed, and child-drop / indent/outdent preserve grouping.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizeChecklistLevels,
    canIndentStep,
    collectStepSubtree,
    applySubtreeLevelDelta,
    resolveDropTarget,
    getStepLevel
} from '../js/checklistSteps.js';

function step(id, level, completed = false) {
    return { id, text: id, level, completed };
}

describe('normalizeChecklistLevels (flexible model)', () => {
    it('preserves a first item at any level 0-4 without forcing it to 0', () => {
        const steps = [step('a', 3), step('b', 4), step('c', 0)];
        normalizeChecklistLevels(steps);
        assert.deepEqual(steps.map(getStepLevel), [3, 4, 0]);
    });

    it('preserves level gaps', () => {
        const steps = [step('a', 0), step('b', 3), step('c', 2), step('d', 0)];
        normalizeChecklistLevels(steps);
        assert.deepEqual(steps.map(getStepLevel), [0, 3, 2, 0]);
    });

    it('clamps out-of-range levels to 0-4 without re-shaping the tree', () => {
        const steps = [step('a', -2), step('b', 9)];
        normalizeChecklistLevels(steps);
        assert.deepEqual(steps.map(getStepLevel), [0, 4]);
    });
});

describe('canIndentStep (flexible model)', () => {
    it('allows indenting the first item when below level 4', () => {
        const steps = [step('a', 0), step('b', 1)];
        assert.equal(canIndentStep(steps, 0), true);
    });

    it('allows indenting any item up to level 4 even creating gaps', () => {
        const steps = [step('a', 0), step('b', 2), step('c', 4)];
        assert.equal(canIndentStep(steps, 1), true); // level 2 -> 3, a gap
        assert.equal(canIndentStep(steps, 2), false); // already at cap 4
    });
});

describe('applySubtreeLevelDelta (grouping)', () => {
    it('moves the whole subtree together when indenting a parent', () => {
        const steps = [step('a', 0), step('b', 1), step('c', 2), step('d', 0)];
        applySubtreeLevelDelta(steps, 1, 1); // indent 'b' + its child 'c'
        assert.deepEqual(steps.map(getStepLevel), [0, 2, 3, 0]);
    });

    it('clamps the subtree to level 4', () => {
        const steps = [step('a', 0), step('b', 3), step('c', 4)];
        applySubtreeLevelDelta(steps, 1, 2);
        assert.deepEqual(steps.map(getStepLevel), [0, 4, 4]);
    });

    it('outdenting a parent clamps the root at 0', () => {
        const steps = [step('a', 2), step('b', 3), step('c', 0)];
        applySubtreeLevelDelta(steps, 0, -3);
        assert.deepEqual(steps.map(getStepLevel), [0, 1, 0]);
    });
});

describe('collectStepSubtree', () => {
    it('collects the root and all deeper descendants', () => {
        const steps = [step('a', 0), step('b', 1), step('c', 2), step('d', 0)];
        assert.deepEqual(collectStepSubtree(steps, 1).map((s) => s.id), ['b', 'c']);
    });
});

describe('resolveDropTarget (child + sibling)', () => {
    it('child drop makes the block a child of its new parent and re-levels the subtree', () => {
        const steps = [step('a', 0), step('x', 0), step('x-child', 1), step('b', 0)];
        // Drop 'x' block as a child of 'a': it lands right after 'a'.
        const reordered = [step('a', 0), step('x', 0), step('x-child', 1), step('b', 0)];
        const res = resolveDropTarget(reordered, 'x', { mode: 'child' });
        assert.equal(res.parentId, 'a');
        // x moved under a => level 1, its child becomes level 2.
        assert.deepEqual(reordered.map(getStepLevel), [0, 1, 2, 0]);
    });

    it('sibling drop re-levels to match the adjacent row', () => {
        const steps = [step('a', 0), step('x', 0), step('b', 2)];
        const reordered = [step('a', 0), step('b', 2), step('x', 0)];
        resolveDropTarget(reordered, 'x', { mode: 'sibling' });
        // Dropped as sibling of level-2 'b' -> 'x' snaps to level 2.
        assert.deepEqual(reordered.map(getStepLevel), [0, 2, 2]);
    });

    it('keeping the first item as the first sibling preserves its level', () => {
        const steps = [step('x', 3), step('x-child', 4), step('a', 0)];
        const reordered = [step('x', 3), step('x-child', 4), step('a', 0)];
        resolveDropTarget(reordered, 'x', { mode: 'sibling' });
        // First item of the whole list may stay at level 3 (not forced to 0).
        assert.deepEqual(reordered.map(getStepLevel), [3, 4, 0]);
    });
});
