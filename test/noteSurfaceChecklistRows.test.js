// test/noteSurfaceChecklistRows.test.js
// Characterization tests for js/noteSurfaceChecklist/rows.js — the single row
// builder every checklist surface renders through (board card, inline editor,
// popout, done section, ghosts).
//
// The interesting part is not the happy path, it is the *variants*. Five
// independent flags (canEdit, richEdit, isGhost, isDoneSection, hasKids) each
// strip or add controls, and getting one wrong is how a checklist row ends up
// with a delete button inside a read-only preview or a drag handle on a ghost
// placeholder that has no step id to drag.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildChecklistRowHtml } from '../js/noteSurfaceChecklist/rows.js';

const step = (over = {}) => ({ id: 'step_1', text: 'Buy milk', completed: false, level: 0, ...over });
const row = (over = {}, opts = {}) => buildChecklistRowHtml(step(over), opts);

describe('checklist row · structure', () => {
    it('renders one display row carrying the step id and level', () => {
        const html = row();

        assert.match(html, /class="step-row step-row--display"/);
        assert.match(html, /data-step-id="step_1"/);
        assert.match(html, /data-level="0"/);
    });

    it('clamps the level to the supported 0-4 range', () => {
        assert.match(row({ level: 9 }), /data-level="4"/);
        assert.match(row({ level: -3 }), /data-level="0"/);
        assert.match(row({ level: '2' }), /data-level="2"/);
    });

    it('marks completed rows and checks the box', () => {
        const html = row({ completed: true });

        assert.match(html, /step-row--done/);
        assert.match(html, /<input type="checkbox" class="step-check" checked>/);
        assert.match(html, /step-text[^"]*completed/);
    });

    it('leaves the box unchecked for an open step', () => {
        assert.equal(/class="step-check" checked/.test(row()), false);
    });

    it('always renders the leading gutter and the actions column', () => {
        const html = row();

        assert.match(html, /class="step-row-leading"/);
        assert.match(html, /class="step-row-actions"/);
    });
});

describe('checklist row · editable text', () => {
    it('makes short plain text contenteditable', () => {
        const html = row({ text: 'Buy milk' });

        assert.match(html, /contenteditable="plaintext-only"/);
        assert.match(html, /data-field="step-text"/);
        assert.match(html, /data-step-id="step_1"/);
        assert.equal(/rich-text--edit/.test(html), false);
    });

    it('switches to rich editing when asked', () => {
        // Markup-free text takes the rich branch without needing a DOM; text that
        // contains tags is sanitised through a real <template>, so that half of
        // the branch is only reachable in the browser.
        const html = row({ text: 'Buy milk' }, { richEdit: true });

        assert.match(html, /contenteditable="true"/);
        assert.match(html, /rich-text rich-text--edit/);
    });

    it('falls back to a static span when editing is off', () => {
        const html = row({}, { canEdit: false });

        assert.equal(/contenteditable/.test(html), false);
        assert.match(html, /<span class="step-text/);
    });
});


describe('checklist row · collapse control', () => {
    it('renders a chevron for parent steps, pointing the way the state says', () => {
        const open = row({}, { hasKids: true, collapseKey: 'item:step_1', isCollapsed: false });
        const shut = row({}, { hasKids: true, collapseKey: 'item:step_1', isCollapsed: true });

        assert.match(open, /class="step-collapse-btn" data-collapse-key="item:step_1"/);
        assert.match(open, /Collapse group/);
        assert.match(shut, /Expand group/);
        assert.notEqual(open, shut, 'the two states must not render the same chevron');
    });

    it('renders a spacer instead of a chevron for leaves', () => {
        const html = row();

        assert.match(html, /class="step-collapse-spacer"/);
        assert.equal(/step-collapse-btn/.test(html), false);
    });

    it('escapes the collapse key', () => {
        const html = row({}, { hasKids: true, collapseKey: 'a"b<c>' });

        assert.match(html, /data-collapse-key="a&quot;b&lt;c&gt;"/);
    });
});

describe('checklist row · controls follow canEdit', () => {
    it('gives editors a drag handle and the copy/delete/nest actions', () => {
        const html = row();

        assert.match(html, /grab-handle grab-handle--step"/);
        assert.match(html, /step-copy-btn/);
        assert.match(html, /step-delete-btn/);
        assert.match(html, /step-indent-btn/);
        assert.match(html, /step-outdent-btn/);
    });

    it('disables outdent at the top level and indent at the deepest level', () => {
        assert.match(row({ level: 0 }), /class="card-act step-outdent-btn"[^>]*disabled/);
        assert.match(row({ level: 4 }), /class="card-act step-indent-btn"[^>]*disabled/);
        const active = [{ id: 'step_1', level: 1 }];
        assert.equal(/step-indent-btn"[^>]*disabled/.test(row({ level: 1 }, { active })), false);
        assert.match(row({ level: 1 }), /step-indent-btn"[^>]*disabled/, 'without a row list there is nothing to indent into');
    });

    it('strips every action for readers', () => {
        const html = row({}, { canEdit: false });

        for (const cls of ['grab-handle--step"', 'step-copy-btn', 'step-delete-btn', 'step-indent-btn', 'step-outdent-btn']) {
            assert.equal(new RegExp(cls).test(html), false, `${cls} leaked into a read-only row`);
        }
        assert.match(html, /class="step-row-actions"/);
    });
});
