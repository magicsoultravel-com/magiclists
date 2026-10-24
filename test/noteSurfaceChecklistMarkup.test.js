// test/noteSurfaceChecklistMarkup.test.js
// Characterization tests for js/noteSurfaceHtml/checklistMarkup.js — the expanded
// checklist a note shows on the board.
//
// The interesting behaviour is the done section: it has to disappear when there
// is nothing completed, collapse behind a counted toggle when there is, and show
// its count in the toggle label. Those counts are read by users and by the
// done-section collapse state machine, and the markup was untested.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../js/noteSurfaceHtml/checklistMarkup.js';

function installGlobals(collapsed = {}, doneCollapsed = {}) {
    const store = new Map([
        ['matrix_checklist_collapsed', JSON.stringify(collapsed)],
        ['matrix_checklist_done_collapsed', JSON.stringify(doneCollapsed)]
    ]);
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
        clear: () => store.clear()
    };
    return store;
}

async function build(item, canEdit = true, opts = {}) {
    installGlobals(opts.collapsed, opts.doneCollapsed);
    const { buildExpandedChecklistHtml } = await import(MODULE);
    return buildExpandedChecklistHtml(item, canEdit, opts);
}

// steps use `completed`, not `done` — partitionChecklistSteps reads this flag
const step = (id, text, extra = {}) => ({ id, text, completed: false, ...extra });

describe('expanded checklist markup · open steps', () => {
    it('renders one row per open step plus the add button for editors', async () => {
        const html = await build({ id: 'n1', steps: [step('s1', 'first'), step('s2', 'second')] });

        assert.ok(html.startsWith('<div class="expanded-checklist">'));
        assert.match(html, /checklist-expand-collapse-all|checklist/);
        assert.match(html, /expanded-checklist-add-btn/, 'editors can add a step');
        assert.equal(html.includes('first'), true);
        assert.equal(html.includes('second'), true);
        assert.equal(html.includes('checklist-done-toggle'), false, 'nothing done, no done toggle');
    });

    it('hides the add button from readers', async () => {
        const html = await build({ id: 'n1', steps: [step('s1', 'first')] }, false);

        assert.equal(html.includes('expanded-checklist-add-btn'), false);
    });

    it('escapes step text', async () => {
        const html = await build({ id: 'n1', steps: [step('s1', '<img src=x onerror=alert(1)>')] });

        assert.equal(html.includes('<img src=x'), false);
    });
});

describe('expanded checklist markup · done section', () => {
    it('counts completed steps in the toggle label', async () => {
        const steps = [step('s1', 'open'), step('s2', 'done', { completed: true })];
        const html = await build({ id: 'n1', steps });

        assert.match(html, /class="checklist-done-toggle"/);
        assert.match(html, /aria-expanded="true"/);
        assert.match(html, /class="checklist-done-toggle-label">Completed</);
        assert.match(html, /class="checklist-done-divider"/, 'divider only when open steps remain');
    });

    it('shows the collapsed state from storage, with a counted label', async () => {
        const steps = [step('s1', 'open'), step('s2', 'done', { completed: true }), step('s3', 'done2', { completed: true })];
        const html = await build({ id: 'n1', steps }, true, { doneCollapsed: { n1: true } });

        assert.match(html, /aria-expanded="false"/);
        assert.match(html, /Hidden items \(2\)/);
        assert.match(html, /class="checklist-done-section is-hidden"/);
        assert.match(html, /Show 2 completed items/);
    });

    it('uses the singular in the collapsed title for one item', async () => {
        const html = await build(
            { id: 'n1', steps: [step('s1', 'open'), step('s2', 'done', { completed: true })] },
            true,
            { doneCollapsed: { n1: true } }
        );

        assert.match(html, /Show 1 completed item"/);
    });
});

describe('expanded checklist markup · module boundary', () => {
    it('re-exports buildExpandedChecklistHtml by identity', async () => {
        installGlobals();
        const markup = await import(MODULE);
        const facade = await import('../js/noteSurfaceHtml.js');

        assert.equal(facade.buildExpandedChecklistHtml, markup.buildExpandedChecklistHtml);
    });
});
