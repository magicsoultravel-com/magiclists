// test/noteSurfaceChecklistInteractions.test.js
// Characterization tests for js/noteSurfaceChecklist/interactions.js — the single
// delegated handler behind a rendered checklist, plus the hit-test that
// dragdrop.js uses to defer to it.
//
// The click handler itself needs a live editor to mean anything (it reads rows,
// moves them between sections and commits mutations). What is pinned here is the
// two things that silently rot:
//
//   1. the binding guard — binding is per item id and idempotent, otherwise every
//      re-render stacks another change/click/keydown set and a single checkbox
//      toggle runs three times;
//   2. the selector list in `isChecklistInteraction` still naming classes that
//      the row/toolbar markup actually emits. These drifted apart once already:
//      drag would steal the pointer from a control that no longer matched.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const { isChecklistInteraction, bindChecklistInteractions } = await import('../js/noteSurfaceChecklist/interactions.js');
const { buildChecklistRowHtml } = await import('../js/noteSurfaceChecklist/rows.js');
const { buildChecklistExpandCollapseAllHtml } = await import('../js/noteSurfaceChecklist/collapse.js');
const { buildExpandedChecklistHtml } = await import('../js/noteSurfaceHtml/checklistMarkup.js');

const item = () => ({
    id: 'i1',
    steps: [
        { id: 'p1', text: 'Groceries', level: 0 },
        { id: 'c1', text: 'Milk', level: 1 }
    ]
});

const stubRoot = () => {
    const listeners = [];
    return {
        dataset: {},
        listeners,
        addEventListener: (type, fn) => listeners.push({ type, fn }),
        querySelector: () => null,
        querySelectorAll: () => []
    };
};

// A target that matches exactly one class from the hit-test list.
const hitOn = (selector) => ({ closest: (sel) => (sel.includes(`.${selector}`) ? { matched: selector } : null) });

describe('checklist interactions · hit test', () => {
    it('is false for a missing or shapeless target', () => {
        assert.equal(isChecklistInteraction(null), false);
        assert.equal(isChecklistInteraction(undefined), false);
    });

    it('recognises every control it claims', () => {
        for (const cls of [
            'step-check', 'step-delete-btn', 'step-collapse-btn', 'grab-handle--step',
            'step-nest-controls', 'step-row-actions', 'expanded-checklist-add-btn',
            'checklist-expand-collapse-all-btn', 'step-text', 'checklist-done-toggle'
        ]) {
            assert.equal(isChecklistInteraction(hitOn(cls)), true, `${cls} is no longer claimed`);
        }
    });

    it('does not swallow clicks on the card around the checklist', () => {
        assert.equal(isChecklistInteraction({ closest: () => null }), false);
    });
});

describe('checklist interactions · hit test matches the markup', () => {
    const rowHtml = buildChecklistRowHtml(item().steps[1], {
        hasKids: true,
        collapseKey: 'i1:c1',
        isCollapsed: false,
        active: item().steps
    });

    it('the row markup still emits the row controls', () => {
        for (const cls of ['step-check', 'step-delete-btn', 'step-collapse-btn', 'grab-handle--step', 'step-nest-controls', 'step-row-actions', 'step-text']) {
            assert.equal(rowHtml.includes(cls), true, `rows.js stopped emitting .${cls} but the hit test still lists it`);
        }
    });

    it('the toolbar markup still emits the add / collapse / done controls', () => {
        // The done section (and its toggle) only renders once something is done.
        const withDone = item();
        withDone.steps.push({ id: 'd1', text: 'Milk bought', level: 0, completed: true });
        const body = buildExpandedChecklistHtml(withDone, true);

        for (const cls of ['expanded-checklist-add-btn', 'checklist-expand-collapse-all-btn', 'checklist-done-toggle']) {
            assert.equal(body.includes(cls), true, `markup stopped emitting .${cls} but the hit test still lists it`);
        }
        assert.match(buildChecklistExpandCollapseAllHtml(item()), /checklist-expand-collapse-all-btn/);
    });
});

describe('checklist interactions · binding guard', () => {
    it('ignores a missing root or item', () => {
        assert.doesNotThrow(() => bindChecklistInteractions(null, item()));
        assert.doesNotThrow(() => bindChecklistInteractions(stubRoot(), null));
    });

    it('binds one change, one click and two keydown handlers', () => {
        const root = stubRoot();

        bindChecklistInteractions(root, item());

        assert.deepEqual(root.listeners.map((l) => l.type), ['change', 'click', 'keydown', 'keydown']);
        assert.equal(root.dataset.checklistInteractionsBound, 'i1');
    });

    it('does not stack handlers when the same item renders again', () => {
        const root = stubRoot();

        bindChecklistInteractions(root, item());
        bindChecklistInteractions(root, item());

        assert.equal(root.listeners.length, 4, 'a stacked bind would toggle each checkbox twice');
    });

    it('rebinds when a different item takes over the root', () => {
        const root = stubRoot();

        bindChecklistInteractions(root, item());
        bindChecklistInteractions(root, { id: 'i2', steps: [] });

        assert.equal(root.dataset.checklistInteractionsBound, 'i2');
        assert.equal(root.listeners.length, 8);
    });
});
