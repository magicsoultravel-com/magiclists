// test/noteSurfaceChecklistTargeting.test.js
// Characterization tests for js/noteSurfaceChecklist/targeting.js — the read-only
// queries that answer "which rows are actually on screen right now".
//
// Everything that moves a step (drag, keyboard, done→active) trusts these rows to
// match what the user can see, so the two filters matter: a collapsed group's
// children are still in the DOM but must not be targets, and neither must rows
// inside a collapsed done section. Ghosts have no step id and drop out first.
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

const { getActiveRows, isCollapsedGroupRow } = await import('../js/noteSurfaceChecklist/targeting.js');

const row = (dataset = {}, classes = []) => ({
    dataset,
    classList: { contains: (c) => classes.includes(c) }
});
const rootOf = (rows) => ({ querySelectorAll: () => rows });

beforeEach(() => localStorage.clear());

describe('checklist targeting · ghost and id filtering', () => {
    it('returns nothing without a root', () => {
        assert.deepEqual(getActiveRows(null), []);
    });

    it('keeps rows that carry a step id', () => {
        const a = row({ stepId: 'a', itemId: 'i1', level: '0' });
        const b = row({ stepId: 'b', itemId: 'i1', level: '0' });

        assert.deepEqual(getActiveRows(rootOf([a, b])), [a, b]);
    });

    it('drops ghost rows, which have no step id to target', () => {
        const real = row({ stepId: 'a', itemId: 'i1' });
        const ghost = row({ ghostStep: '1', itemId: 'i1' });

        assert.deepEqual(getActiveRows(rootOf([real, ghost])), [real]);
    });
});

describe('checklist targeting · collapsed groups', () => {
    it('hides the children of a collapsed group', () => {
        const parent = row({ stepId: 'p', itemId: 'i1', level: '0' }, ['step-row--display']);
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify({ 'i1:p': true }));

        assert.deepEqual(getActiveRows(rootOf([parent])), []);
    });

    it('leaves a group visible while it is open', () => {
        const parent = row({ stepId: 'p', itemId: 'i1', level: '0' });
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify({ 'i1:p': false }));

        assert.deepEqual(getActiveRows(rootOf([parent])), [parent]);
    });

    it('ignores a key belonging to another item', () => {
        const parent = row({ stepId: 'p', itemId: 'i2', level: '0' });
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify({ 'i1:p': true }));

        assert.deepEqual(getActiveRows(rootOf([parent])), [parent]);
    });
});

describe('checklist targeting · collapsed done section', () => {
    it('hides done rows while the done section is shut', () => {
        const done = row({ stepId: 'd', itemId: 'i1' }, ['step-row--done']);
        localStorage.setItem('matrix_checklist_done_collapsed', JSON.stringify({ i1: true }));

        assert.deepEqual(getActiveRows(rootOf([done])), []);
    });

    it('shows them again once the section is open', () => {
        const done = row({ stepId: 'd', itemId: 'i1' }, ['step-row--done']);

        assert.deepEqual(getActiveRows(rootOf([done])), [done]);
    });

    it('does not let a shut done section hide open rows', () => {
        const open = row({ stepId: 'o', itemId: 'i1' });
        localStorage.setItem('matrix_checklist_done_collapsed', JSON.stringify({ i1: true }));

        assert.deepEqual(getActiveRows(rootOf([open])), [open]);
    });
});

describe('checklist targeting · collapse key lookup', () => {
    it('needs both ids to resolve a key', () => {
        const collapsed = { 'i1:p': true };

        assert.equal(isCollapsedGroupRow(row({ itemId: 'i1', stepId: 'p' }), collapsed), true);
        assert.equal(isCollapsedGroupRow(row({ itemId: 'i1' }), collapsed), false);
        assert.equal(isCollapsedGroupRow(row({ stepId: 'p' }), collapsed), false);
        assert.equal(isCollapsedGroupRow(row({ itemId: 'i2', stepId: 'p' }), collapsed), false);
    });

    it('treats a falsy entry as open', () => {
        assert.equal(isCollapsedGroupRow(row({ itemId: 'i1', stepId: 'p' }), { 'i1:p': false }), false);
    });
});
