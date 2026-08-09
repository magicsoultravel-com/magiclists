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
    getStepLevel,
    computeStepParentIds,
    stepsToParentOrder,
    stepsFromParentOrder,
    ensureStepsParentOrder,
    assertStepsInvariants,
    toggleStepCompletion,
    toggleGroupCompletion,
    getGroupStepIds,
    addChecklistStep,
    splitChecklistStep,
    deleteChecklistStep,
    mergeChecklistStepIntoPrev,
    indentChecklistSteps,
    outdentChecklistSteps,
    moveChecklistStepBlock,
    partitionChecklistSteps,
    buildVisibleChecklistSteps,
    buildCompletedChecklistRows,
    annotateChecklistTreeGuides
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

// ── H3-B: explicit parentId + order model ───────────────────────────────────

function pstep(id, level, completed = false) {
    return { id, text: id, level, completed };
}

describe('computeStepParentIds (nearest preceding lower level)', () => {
    it('flat list => every root has null parent', () => {
        const m = computeStepParentIds([pstep('a', 0), pstep('b', 0), pstep('c', 0)]);
        assert.deepEqual(['a', 'b', 'c'].map((id) => m.get(id)), [null, null, null]);
    });

    it('nested attaches children to the nearest preceding lower-level step', () => {
        const m = computeStepParentIds([pstep('a', 0), pstep('b', 1), pstep('c', 2), pstep('d', 0)]);
        assert.equal(m.get('a'), null);
        assert.equal(m.get('b'), 'a');
        assert.equal(m.get('c'), 'b');
        assert.equal(m.get('d'), null);
    });

    it('gap [0,3,2] => both high items attach to the level-0 root', () => {
        const m = computeStepParentIds([pstep('a', 0), pstep('b', 3), pstep('c', 2)]);
        assert.equal(m.get('a'), null);
        assert.equal(m.get('b'), 'a');
        assert.equal(m.get('c'), 'a');
    });

    it('first item may be level 3 with a null parent', () => {
        const m = computeStepParentIds([pstep('a', 3), pstep('b', 4)]);
        assert.equal(m.get('a'), null);
        assert.equal(m.get('b'), 'a');
    });
});

describe('stepsToParentOrder / stepsFromParentOrder', () => {
    it('round-trips to an identical projected array and satisfies invariants', () => {
        const steps = [pstep('a', 0), pstep('b', 2), pstep('c', 1), pstep('d', 0)];
        const projected = stepsToParentOrder(steps);
        const back = stepsFromParentOrder(projected);
        assert.deepEqual(
            back.map((s) => [s.id, s.level, s.order, s.parentId]),
            projected.map((s) => [s.id, s.level, s.order, s.parentId])
        );
        assert.deepEqual(assertStepsInvariants(back), []);
    });
});

describe('ensureStepsParentOrder (silent repair)', () => {
    it('fills missing order/parentId on legacy steps', () => {
        const legacy = [{ id: 'a', text: 'A', level: 0 }, { id: 'b', text: 'B', level: 1 }];
        const { steps, added } = ensureStepsParentOrder(legacy);
        assert.ok(added > 0);
        assert.equal(steps[0].order, 0);
        assert.equal(steps[0].parentId, null);
        assert.equal(steps[1].order, 1);
        assert.equal(steps[1].parentId, 'a');
        assert.deepEqual(assertStepsInvariants(steps), []);
    });

    it('is a no-op when every step already satisfies the invariant', () => {
        const steps = stepsToParentOrder([pstep('a', 0), pstep('b', 1)]);
        const { steps: next, added } = ensureStepsParentOrder(steps);
        assert.equal(added, 0);
        assert.deepEqual(next, steps);
    });

    it('canonicalizes a stale parentId to the correct predecessor', () => {
        const steps = [pstep('a', 0), pstep('b', 2), pstep('c', 1)];
        steps[2].parentId = 'b'; // wrong: level-1 c should attach to level-0 a
        const { steps: next, added } = ensureStepsParentOrder(steps);
        assert.ok(added > 0);
        assert.equal(next[2].parentId, 'a');
    });
});

describe('mutation ops keep the position model intact', () => {
    it('addChecklistStep appends after an anchor as a sibling', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1)]);
        const { steps, step } = addChecklistStep(base, { afterStepId: 'a', text: 'X', newId: 'x' });
        assert.deepEqual(steps.map((s) => s.id), ['a', 'x', 'b']);
        assert.equal(step.level, 0);
        assert.deepEqual(assertStepsInvariants(steps), []);
    });

    it('addChecklistStep appends at the end when no anchor given', () => {
        const base = stepsToParentOrder([pstep('a', 0)]);
        const { steps } = addChecklistStep(base, { text: 'X', newId: 'x' });
        assert.deepEqual(steps.map((s) => s.id), ['a', 'x']);
        assert.deepEqual(assertStepsInvariants(steps), []);
    });

    it('splitChecklistStep keeps the original as a sibling and adds the second half', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 0)]);
        const { steps, newStep } = splitChecklistStep(base, 'b', 'b1', 'b2', { newId: 'b2' });
        assert.equal(newStep.text, 'b2');
        assert.equal(steps[1].text, 'b1');
        assert.deepEqual(steps.map((s) => s.id), ['a', 'b', 'b2']);
        assert.deepEqual(assertStepsInvariants(steps), []);
    });

    it('splitChecklistStep with afterSubtree inserts after the whole collapsed group', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1), pstep('c', 0)]);
        const { steps } = splitChecklistStep(base, 'a', 'a1', 'a2', { afterSubtree: true, newId: 'a2' });
        assert.deepEqual(steps.map((s) => s.id), ['a', 'b', 'a2', 'c']);
        assert.deepEqual(assertStepsInvariants(steps), []);
    });

    it('deleteChecklistStep re-parents orphaned children', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1), pstep('b2', 2), pstep('c', 0)]);
        const { steps, prevStepId, nextStepId } = deleteChecklistStep(base, 'b');
        assert.deepEqual(steps.map((s) => s.id), ['a', 'b2', 'c']);
        assert.equal(prevStepId, 'a');
        assert.equal(nextStepId, 'c');
        assert.equal(steps.find((s) => s.id === 'b2').parentId, 'a'); // nearest lower ancestor
        assert.deepEqual(assertStepsInvariants(steps), []);
    });

    it('deleteChecklistStep is a no-op for a missing id', () => {
        const base = stepsToParentOrder([pstep('a', 0)]);
        const { steps, prevStepId, nextStepId } = deleteChecklistStep(base, 'nope');
        assert.deepEqual(steps.map((s) => s.id), ['a']);
        assert.equal(prevStepId, null);
        assert.equal(nextStepId, null);
    });

    it('mergeChecklistStepIntoPrev merges text and drops the row', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1)]);
        base[1].text = 'B';
        const { steps, merged } = mergeChecklistStepIntoPrev(base, 1);
        assert.equal(merged, true);
        assert.equal(steps[0].text, 'a\nB');
        assert.deepEqual(steps.map((s) => s.id), ['a']);
        assert.deepEqual(assertStepsInvariants(steps), []);
    });

    it('indentChecklistSteps moves the whole subtree together', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1), pstep('c', 2), pstep('d', 0)]);
        indentChecklistSteps(base, 1);
        assert.deepEqual(base.map(getStepLevel), [0, 2, 3, 0]);
        assert.deepEqual(assertStepsInvariants(base), []);
    });

    it('outdentChecklistSteps moves subtree down one level', () => {
        const base = stepsToParentOrder([pstep('a', 2), pstep('b', 3), pstep('c', 0)]);
        outdentChecklistSteps(base, 0);
        assert.deepEqual(base.map(getStepLevel), [1, 2, 0]);
        assert.deepEqual(assertStepsInvariants(base), []);
    });

    it('toggleStepCompletion flips completion without touching order', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1)]);
        assert.equal(toggleStepCompletion(base, 'a', true), true);
        assert.equal(base[0].completed, true);
        assert.equal(base[1].completed, false);
        assert.deepEqual(base.map((s) => s.id), ['a', 'b']); // order untouched
        assert.deepEqual(assertStepsInvariants(base), []);
    });

    it('toggleGroupCompletion marks all descendants when completing parent', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1), pstep('c', 2), pstep('d', 0)]);
        const affected = toggleGroupCompletion(base, 'a', true);
        assert.deepEqual(affected, ['a', 'b', 'c']); // parent and all descendants
        assert.equal(base[0].completed, true);
        assert.equal(base[1].completed, true);
        assert.equal(base[2].completed, true);
        assert.equal(base[3].completed, false);
        assert.deepEqual(assertStepsInvariants(base), []);
    });

    it('toggleGroupCompletion only marks parent when uncompleting', () => {
        // Parent is already done, children are done too - uncomplete parent only
        const steps = stepsToParentOrder([pstep('a', 0, true), pstep('b', 1, true), pstep('c', 2, true), pstep('d', 0, false)]);
        const affected = toggleGroupCompletion(steps, 'a', false);
        assert.deepEqual(affected, ['a']); // only parent
        assert.equal(steps[0].completed, false);
        assert.equal(steps[1].completed, true); // child stays done
        assert.equal(steps[2].completed, true); // child stays done
        assert.equal(steps[3].completed, false);
        assert.deepEqual(assertStepsInvariants(steps), []);
    });

    it('toggleGroupCompletion works for leaf nodes (no descendants)', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 0), pstep('c', 0)]);
        const affected = toggleGroupCompletion(base, 'a', true);
        assert.deepEqual(affected, ['a']); // only itself
        assert.equal(base[0].completed, true);
        assert.equal(base[1].completed, false);
        assert.equal(base[2].completed, false);
        assert.deepEqual(assertStepsInvariants(base), []);
    });

    it('getGroupStepIds returns all steps in a group', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1), pstep('c', 2), pstep('d', 0)]);
        const ids = getGroupStepIds(base, 'a');
        assert.deepEqual(ids, ['a', 'b', 'c']);
    });

    it('getGroupStepIds returns single element for leaf node', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 0), pstep('c', 0)]);
        const ids = getGroupStepIds(base, 'b');
        assert.deepEqual(ids, ['b']);
    });

    it('getGroupStepIds returns empty array for non-existent step', () => {
        const base = stepsToParentOrder([pstep('a', 0), pstep('b', 1)]);
        const ids = getGroupStepIds(base, 'nonexistent');
        assert.deepEqual(ids, []);
    });
});

describe('moveChecklistStepBlock (model-first drag)', () => {
    it('sibling drop reorders the block before the target', () => {
        const steps = stepsToParentOrder([pstep('b', 0), pstep('x', 0), pstep('xc', 1), pstep('a', 0)]);
        // Drop block x as a sibling before 'a' -> visible others = [b, a]; targetIdx of a = 1
        const res = moveChecklistStepBlock(steps, 'x', {
            dropMode: 'sibling',
            insertIndex: 1,
            anchorStepId: null,
            itemId: 'item',
            collapsedKeys: {}
        });
        assert.deepEqual(res.steps.map((s) => s.id), ['b', 'x', 'xc', 'a']);
        assert.equal(res.parentId, null);
        assert.deepEqual(assertStepsInvariants(res.steps), []);
    });

    it('sibling drop to the end appends after the last visible step', () => {
        const steps = stepsToParentOrder([pstep('a', 0), pstep('x', 0), pstep('xc', 1), pstep('b', 0)]);
        const res = moveChecklistStepBlock(steps, 'x', {
            dropMode: 'sibling',
            insertIndex: 99, // beyond end
            anchorStepId: null,
            itemId: 'item',
            collapsedKeys: {}
        });
        assert.deepEqual(res.steps.map((s) => s.id), ['a', 'b', 'x', 'xc']);
        assert.deepEqual(assertStepsInvariants(res.steps), []);
    });

    it('child drop makes the block a child of the anchor and re-levels it', () => {
        const steps = stepsToParentOrder([pstep('b', 0), pstep('x', 0), pstep('xc', 1), pstep('a', 0)]);
        const res = moveChecklistStepBlock(steps, 'x', {
            dropMode: 'child',
            insertIndex: 0,
            anchorStepId: 'b',
            itemId: 'item',
            collapsedKeys: {}
        });
        assert.deepEqual(res.steps.map((s) => s.id), ['b', 'x', 'xc', 'a']);
        assert.equal(res.parentId, 'b');
        assert.equal(res.levelChanged, true);
        assert.equal(res.steps.find((s) => s.id === 'x').level, 1);
        assert.equal(res.steps.find((s) => s.id === 'xc').level, 2);
        assert.deepEqual(assertStepsInvariants(res.steps), []);
    });

    it('keeps done steps appended at the end', () => {
        const steps = stepsToParentOrder([
            pstep('a', 0), pstep('d', 0, true), pstep('x', 0), pstep('xc', 1), pstep('b', 0)
        ]);
        const res = moveChecklistStepBlock(steps, 'x', {
            dropMode: 'sibling', insertIndex: 99, anchorStepId: null, itemId: 'item', collapsedKeys: {}
        });
        assert.deepEqual(res.steps.map((s) => s.id), ['a', 'b', 'x', 'xc', 'd']);
        assert.deepEqual(assertStepsInvariants(res.steps), []);
    });
});

describe('done-section tree preservation (completed groups keep hierarchy)', () => {
    it('partition keeps a completed group contiguous and in authored order', () => {
        const steps = stepsToParentOrder([
            pstep('group', 0, true), pstep('child1', 1, true), pstep('grandchild', 2, true),
            pstep('child2', 1, true), pstep('open', 0, false)
        ]);
        const { active, done } = partitionChecklistSteps(steps);
        assert.deepEqual(done.map((s) => s.id), ['group', 'child1', 'grandchild', 'child2']);
        assert.deepEqual(active.map((s) => s.id), ['open']);
    });

    it('buildVisibleChecklistSteps exposes done parents with hasKids + collapse keys', () => {
        const done = stepsToParentOrder([
            pstep('group', 0, true), pstep('child1', 1, true), pstep('grandchild', 2, true), pstep('child2', 1, true)
        ]);
        const rows = buildVisibleChecklistSteps(done, 'item', {});
        assert.deepEqual(rows.map((r) => r.step.id), ['group', 'child1', 'grandchild', 'child2']);
        assert.equal(rows[0].hasKids, true);
        assert.equal(rows[0].collapseKey, 'item:group');
        assert.equal(rows[1].hasKids, true);
        assert.equal(rows[2].hasKids, false);
        assert.equal(rows[3].hasKids, false);
    });

    it('a collapsed done parent hides its completed descendants', () => {
        const done = stepsToParentOrder([
            pstep('group', 0, true), pstep('child1', 1, true), pstep('grandchild', 2, true), pstep('child2', 1, true)
        ]);
        const visible = buildVisibleChecklistSteps(done, 'item', { 'item:group': true });
        assert.deepEqual(visible.map((r) => r.step.id), ['group']);
        // Collapsing a child group hides only its own subtree, parent stays visible.
        const partial = buildVisibleChecklistSteps(done, 'item', { 'item:child1': true });
        assert.deepEqual(partial.map((r) => r.step.id), ['group', 'child1', 'child2']);
    });

    it('annotateChecklistTreeGuides draws the same hierarchy for done rows', () => {
        const done = stepsToParentOrder([
            pstep('group', 0, true), pstep('child1', 1, true), pstep('grandchild', 2, true), pstep('child2', 1, true)
        ]);
        const rows = annotateChecklistTreeGuides(buildVisibleChecklistSteps(done, 'item', {}));
        assert.deepEqual(rows[0].treeGuides, []);
        assert.deepEqual(rows[1].treeGuides.map((g) => g.role), ['start']);
        assert.deepEqual(rows[2].treeGuides.map((g) => g.role), ['through', 'solo']);
        assert.deepEqual(rows[3].treeGuides.map((g) => g.role), ['end']);
    });
});

describe('ghost parents (completed children of open parents)', () => {
    it('emits a ghost parent above a completed child and keeps the tree', () => {
        const steps = stepsToParentOrder([
            pstep('groc', 0, false), pstep('bread', 1, true), pstep('open', 0, false)
        ]);
        const rows = buildCompletedChecklistRows(steps, 'item', {});
        assert.deepEqual(rows.map((r) => r.step.id), ['groc', 'bread']);
        assert.deepEqual(rows.map((r) => r.isGhost), [true, false]);
        // The ghost parent groups the completed child below it.
        assert.equal(rows[0].hasKids, true);
        assert.equal(rows[1].hasKids, false);
    });

    it('replaces the ghost with the real parent once it is completed (join)', () => {
        // Child completed first...
        const steps = stepsToParentOrder([pstep('groc', 0, false), pstep('bread', 1, true)]);
        let rows = buildCompletedChecklistRows(steps, 'item', {});
        assert.deepEqual(rows.map((r) => [r.step.id, r.isGhost]), [['groc', true], ['bread', false]]);
        // ...then the parent is completed too -> the ghost becomes the real row.
        steps[0].completed = true;
        rows = buildCompletedChecklistRows(steps, 'item', {});
        assert.deepEqual(rows.map((r) => [r.step.id, r.isGhost]), [['groc', false], ['bread', false]]);
        // They now form one parent-children group in the Completed section.
        assert.equal(rows[0].hasKids, true);
    });

    it('chains ghosts for a completed grandchild under open parent + grandparent', () => {
        const steps = stepsToParentOrder([
            pstep('top', 0, false), pstep('mid', 1, false), pstep('leaf', 2, true)
        ]);
        const rows = buildCompletedChecklistRows(steps, 'item', {});
        assert.deepEqual(rows.map((r) => r.step.id), ['top', 'mid', 'leaf']);
        assert.deepEqual(rows.map((r) => r.isGhost), [true, true, false]);
    });

    it('skips ghosts when the parent is already completed', () => {
        const steps = stepsToParentOrder([
            pstep('groc', 0, true), pstep('bread', 1, true), pstep('open', 0, false)
        ]);
        const rows = buildCompletedChecklistRows(steps, 'item', {});
        assert.deepEqual(rows.map((r) => [r.step.id, r.isGhost]), [['groc', false], ['bread', false]]);
    });

    it('collapsing a ghost parent hides its completed children', () => {
        const steps = stepsToParentOrder([
            pstep('groc', 0, false), pstep('bread', 1, true), pstep('milk', 1, true)
        ]);
        const visible = buildCompletedChecklistRows(steps, 'item', { 'item:groc': true });
        assert.deepEqual(visible.map((r) => r.step.id), ['groc']);
        assert.deepEqual(visible.map((r) => r.isGhost), [true]);
    });

    it('gives each open parent its own ghost even with sibling groups between', () => {
        const steps = stepsToParentOrder([
            pstep('a', 0, false), pstep('a1', 1, true), pstep('b', 0, false), pstep('b1', 1, true)
        ]);
        const rows = buildCompletedChecklistRows(steps, 'item', {});
        assert.deepEqual(rows.map((r) => [r.step.id, r.isGhost]), [
            ['a', true], ['a1', false], ['b', true], ['b1', false]
        ]);
    });

    it('never mutates the model: steps are untouched and ghosts are derived only', () => {
        const steps = stepsToParentOrder([pstep('groc', 0, false), pstep('bread', 1, true)]);
        const before = JSON.parse(JSON.stringify(steps));
        buildCompletedChecklistRows(steps, 'item', {});
        assert.deepEqual(JSON.parse(JSON.stringify(steps)), before);
    });
});

describe('fuzz: random mutations never break the position model', () => {
    function mulberry32(seed) {
        return function () {
            seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    it('invariants hold through a seeded random sequence of every op', () => {
        const rand = mulberry32(42);
        let steps = stepsToParentOrder([pstep('a', 0), pstep('b', 1), pstep('c', 0), pstep('d', 2), pstep('e', 0)]);
        const pickId = () => steps[Math.floor(rand() * steps.length)]?.id || null;
        for (let iter = 0; iter < 400; iter++) {
            const op = Math.floor(rand() * 7);
            if (op === 0) {
                const r = addChecklistStep(steps, { afterStepId: pickId(), newId: `n${iter}` });
                steps = r.steps;
            } else if (op === 1 && steps.length > 1) {
                const r = splitChecklistStep(steps, pickId(), 'b', 'a', { newId: `s${iter}` });
                steps = r.steps;
            } else if (op === 2 && steps.length > 1) {
                const r = deleteChecklistStep(steps, pickId());
                steps = r.steps;
            } else if (op === 3 && steps.length > 1) {
                const idx = Math.max(1, Math.floor(rand() * steps.length));
                const r = mergeChecklistStepIntoPrev(steps, idx);
                steps = r.steps;
            } else if (op === 4 && steps.length) {
                indentChecklistSteps(steps, Math.floor(rand() * steps.length));
            } else if (op === 5 && steps.length) {
                outdentChecklistSteps(steps, Math.floor(rand() * steps.length));
            } else if (op === 6 && steps.length) {
                const bid = pickId();
                if (bid) {
                    const r = moveChecklistStepBlock(steps, bid, {
                        dropMode: rand() < 0.5 ? 'sibling' : 'child',
                        insertIndex: Math.floor(rand() * (steps.length + 1)),
                        anchorStepId: rand() < 0.5 ? pickId() : null,
                        itemId: 'item',
                        collapsedKeys: {}
                    });
                    steps = r.steps;
                }
            }
            const issues = assertStepsInvariants(steps);
            assert.deepEqual(issues, [], `iteration ${iter} op ${op}: ${issues.join('; ')}`);
        }
        assert.ok(steps.length > 0);
    });
});
