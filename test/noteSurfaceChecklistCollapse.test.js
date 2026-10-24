// test/noteSurfaceChecklistCollapse.test.js
// Characterization tests for js/noteSurfaceChecklist/collapse.js — the
// localStorage-backed "which groups are collapsed" state, the expand/collapse-all
// toolbar, and the one-second read cache that keeps drag/render hot paths from
// hitting localStorage on every row.
//
// Two behaviours here are easy to break and hard to see in a browser:
//   * reopening a group *deletes* its key instead of storing false, so the JSON
//     blob does not grow a key per group the user ever opened;
//   * the cache is time-based, not write-through, so a mutation is invisible to
//     readers until `invalidateChecklistCache` runs or the TTL expires.
//
// Run with: npm test  (node --test)
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear()
};

const {
    getChecklistCollapsedKeys,
    getChecklistDoneCollapsed,
    isChecklistDoneSectionCollapsed,
    toggleChecklistDoneSection,
    getChecklistCollapsibleKeys,
    checklistGroupsAnyExpanded,
    collapseAllChecklistGroups,
    expandAllChecklistGroups,
    toggleChecklistExpandCollapseAll,
    buildChecklistExpandCollapseAllHtml,
    isChecklistGroupCollapsed,
    expandChecklistAncestorsForStep,
    getCachedChecklistCollapsedKeys,
    invalidateChecklistCache
} = await import('../js/noteSurfaceChecklist/collapse.js');

const COLLAPSED = 'matrix_checklist_collapsed';
const DONE = 'matrix_checklist_done_collapsed';

// item: one parent with one child, plus a leaf.
const item = (over = {}) => ({
    id: 'i1',
    steps: [
        { id: 'p1', text: 'Groceries', level: 0 },
        { id: 'c1', text: 'Milk', level: 1 },
        { id: 'l1', text: 'Call mum', level: 0 }
    ],
    ...over
});

beforeEach(() => {
    localStorage.clear();
    invalidateChecklistCache();
});

describe('checklist collapse · stored state', () => {
    it('starts empty', () => {
        assert.deepEqual(getChecklistCollapsedKeys(), {});
        assert.deepEqual(getChecklistDoneCollapsed(), {});
    });

    it('reads the persisted blob', () => {
        localStorage.setItem(COLLAPSED, JSON.stringify({ 'i1:p1': true }));

        assert.deepEqual(getChecklistCollapsedKeys(), { 'i1:p1': true });
        assert.equal(isChecklistGroupCollapsed('i1', 'p1'), true);
        assert.equal(isChecklistGroupCollapsed('i1', 'c1'), false);
    });

    it('survives a corrupt blob instead of throwing', () => {
        localStorage.setItem(COLLAPSED, '{not json');
        localStorage.setItem(DONE, 'also not json');

        assert.deepEqual(getChecklistCollapsedKeys(), {});
        assert.deepEqual(getChecklistDoneCollapsed(), {});
    });
});

describe('checklist collapse · done section', () => {
    it('is open by default', () => {
        assert.equal(isChecklistDoneSectionCollapsed('i1'), false);
    });

    it('toggles closed and back', () => {
        toggleChecklistDoneSection('i1');
        assert.equal(isChecklistDoneSectionCollapsed('i1'), true);

        toggleChecklistDoneSection('i1');
        assert.equal(isChecklistDoneSectionCollapsed('i1'), false);
    });

    it('deletes the key when reopening so the blob stays small', () => {
        toggleChecklistDoneSection('i1');
        toggleChecklistDoneSection('i1');

        assert.deepEqual(getChecklistDoneCollapsed(), {});
    });

    it('keys per item', () => {
        toggleChecklistDoneSection('i1');

        assert.equal(isChecklistDoneSectionCollapsed('i1'), true);
        assert.equal(isChecklistDoneSectionCollapsed('i2'), false);
    });

describe('checklist collapse · collapsible groups', () => {
    it('lists only steps that have children', () => {
        assert.deepEqual(getChecklistCollapsibleKeys(item()), ['i1:p1']);
    });

    it('covers completed groups too', () => {
        const done = item({
            steps: [
                { id: 'p2', text: 'Done parent', level: 0, completed: true },
                { id: 'c2', text: 'Done child', level: 1, completed: true }
            ]
        });

        assert.ok(getChecklistCollapsibleKeys(done).includes('i1:p2'));
    });

    it('returns nothing without an item id', () => {
        assert.deepEqual(getChecklistCollapsibleKeys({ steps: [] }), []);
        assert.deepEqual(getChecklistCollapsibleKeys(null), []);
    });

    it('is "any expanded" only while at least one group is open', () => {
        assert.equal(checklistGroupsAnyExpanded(item()), true);

        collapseAllChecklistGroups(item());
        assert.equal(checklistGroupsAnyExpanded(item()), false);

        expandAllChecklistGroups(item());
        assert.equal(checklistGroupsAnyExpanded(item()), true);
    });

    it('collapse-all writes every collapsible key', () => {
        collapseAllChecklistGroups(item());

        assert.deepEqual(getChecklistCollapsedKeys(), { 'i1:p1': true });
        assert.equal(isChecklistGroupCollapsed('i1', 'p1'), true);
    });

    it('expand-all clears them again', () => {
        collapseAllChecklistGroups(item());
        expandAllChecklistGroups(item());

        assert.deepEqual(getChecklistCollapsedKeys(), {});
    });

    it('the toolbar toggle flips whichever way the surface currently is', () => {
        toggleChecklistExpandCollapseAll(item());
        assert.equal(checklistGroupsAnyExpanded(item()), false);

        toggleChecklistExpandCollapseAll(item());
        assert.equal(checklistGroupsAnyExpanded(item()), true);
    });

    it('re-expands the ancestors of a deep step', () => {
        localStorage.setItem(COLLAPSED, JSON.stringify({ 'i1:ancestor_0': true, 'i1:ancestor_1': true }));
        const deep = item({ steps: [{ id: 'deep', text: 'deep', level: 2 }] });

        expandChecklistAncestorsForStep(deep, 'deep');

        assert.deepEqual(getChecklistCollapsedKeys(), {});
    });
});

describe('checklist collapse · toolbar markup', () => {
    it('renders nothing when the checklist has no groups', () => {
        const flat = { id: 'i1', steps: [{ id: 'l1', text: 'flat', level: 0 }] };

        assert.equal(buildChecklistExpandCollapseAllHtml(flat), '');
        assert.equal(buildChecklistExpandCollapseAllHtml(null), '');
    });

    it('offers "collapse all" while a group is open', () => {
        const html = buildChecklistExpandCollapseAllHtml(item());

        assert.match(html, /checklist-expand-collapse-all-btn/);
        assert.match(html, /title="Collapse all checklist groups"/);
    });

    it('offers "expand all" once every group is shut', () => {
        collapseAllChecklistGroups(item());

        assert.match(buildChecklistExpandCollapseAllHtml(item()), /title="Expand all checklist groups"/);
    });
});

describe('checklist collapse · read cache', () => {
    it('serves the same parse within the TTL even after a write', () => {
        const first = getCachedChecklistCollapsedKeys();
        localStorage.setItem(COLLAPSED, JSON.stringify({ 'i1:p1': true }));

        assert.equal(getCachedChecklistCollapsedKeys(), first, 'the cache is not write-through');
        assert.deepEqual(getCachedChecklistCollapsedKeys(), {});
    });

    it('rereads after invalidation', () => {
        getCachedChecklistCollapsedKeys();
        localStorage.setItem(COLLAPSED, JSON.stringify({ 'i1:p1': true }));

        invalidateChecklistCache();

        assert.deepEqual(getCachedChecklistCollapsedKeys(), { 'i1:p1': true });
    });
});

});
