// test/magicFocusSetup.test.js
// Characterization tests for js/magicFocus/setup.js — the two-step wizard that
// builds a focus layout before anything is committed to the note.
//
// The interesting property is that setup edits a *draft*: `focus.setupDraft` is a
// pending layout that the note never sees until Apply calls NoteSurface.mutateItem.
// So every assertion here is about the draft → markup direction, which is the half
// that runs headless (a settable `innerHTML` plus a `querySelector` that answers
// null is enough for the whole render path).
//
// Two failure modes this suite exists for:
//   * routing — an assign step with no draft must fall back to the layout step
//     rather than render an empty zone grid;
//   * double-booking — a block already in a zone must render as placed and
//     non-draggable, or the wizard lets the user drag it into a second zone and
//     the model then silently drops it (first zone wins).
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import * as Setup from '../js/magicFocus/setup.js';
import { PRESET_META, BLOCKS, createDefaultFocus } from '../js/magicFocus/model.js';

/** A focus instance wired the way the facade wires it: methods dispatch back here. */
function makeFocus(over = {}) {
    const bodyEl = {
        innerHTML: '',
        style: {},
        querySelector: () => null,
        querySelectorAll: () => []
    };
    const focus = {
        bodyEl,
        setupStep: 'layout',
        setupDraft: null,
        showingSetup: true,
        ...over
    };
    focus.renderSetup = (item) => Setup.renderSetup(focus, item);
    focus._renderLayoutStep = (item) => Setup._renderLayoutStep(focus, item);
    focus._renderAssignStep = (item) => Setup._renderAssignStep(focus, item);
    focus._resetFocusConfig = (item) => Setup._resetFocusConfig(focus, item);
    focus._bindLayoutStepEvents = (item) => Setup._bindLayoutStepEvents(focus, item);
    focus._bindAssignStepEvents = (item) => Setup._bindAssignStepEvents(focus, item);
    focus.renderWork = () => {};
    focus.close = () => {};
    focus.resolveItem = () => null;
    return focus;
}

const note = () => ({ id: 'n1', steps: [], focus: null });

describe('focus setup · routing', () => {
    it('does nothing when the shell is not mounted', () => {
        const focus = makeFocus({ bodyEl: null });

        assert.doesNotThrow(() => Setup.renderSetup(focus, note()));
    });

    it('opens on the preset step by default', () => {
        const focus = makeFocus();

        focus.renderSetup(note());

        assert.match(focus.bodyEl.innerHTML, /magic-focus__setup--layout/);
        assert.match(focus.bodyEl.innerHTML, /data-focus-preset/);
    });

    it('opens the assign step when a draft is being edited', () => {
        const focus = makeFocus({ setupStep: 'assign', setupDraft: createDefaultFocus() });

        focus.renderSetup(note());

        assert.match(focus.bodyEl.innerHTML, /magic-focus__setup--assign/);
    });

    it('falls back to the preset step when the draft vanished', () => {
        const focus = makeFocus({ setupStep: 'assign', setupDraft: null });

        focus._renderAssignStep(note());

        assert.equal(focus.setupStep, 'layout');
        assert.match(focus.bodyEl.innerHTML, /magic-focus__setup--layout/);
    });
});

describe('focus setup · preset step', () => {
    it('offers one button per preset, with a glyph and a label', () => {
        const focus = makeFocus();

        focus._renderLayoutStep(note());

        const html = focus.bodyEl.innerHTML;
        for (const preset of PRESET_META) {
            assert.equal(html.includes(`data-focus-preset="${preset.id}"`), true, `${preset.id} missing`);
        }
        assert.equal((html.match(/magic-focus__preset-glyph/g) || []).length, PRESET_META.length);
        assert.match(html, /data-focus-setup-reset/);
        assert.match(html, /data-focus-setup-cancel/);
    });

    it('marks the draft preset as active', () => {
        const focus = makeFocus({ setupDraft: { preset: 'split3-cols' } });

        focus._renderLayoutStep(note());

        const active = focus.bodyEl.innerHTML.match(/magic-focus__preset is-active"[^>]*data-focus-preset="(\w[\w-]*)"/);
        assert.equal(active?.[1], 'split3-cols');
    });
});


describe('focus setup · assign step', () => {
    const draft = () => ({
        preset: 'split3-cols',
        ratios: [1 / 3, 2 / 3],
        zones: { z0: ['text'], z1: [], z2: [] },
        zoom: { z0: 100, z1: 100, z2: 100 }
    });

    it('renders one slot per zone of the chosen preset', () => {
        const focus = makeFocus({ setupStep: 'assign', setupDraft: draft() });

        focus._renderAssignStep(note());

        const html = focus.bodyEl.innerHTML;
        assert.equal((html.match(/data-focus-zone="z\d"/g) || []).length, 3);
        assert.match(html, /data-focus-setup-apply/);
        assert.match(html, /data-focus-setup-back/);
        assert.match(html, /data-focus-setup-cancel/);
        assert.match(html, /data-focus-change-layout/);
    });

    it('lists every block in the palette', () => {
        const focus = makeFocus({ setupStep: 'assign', setupDraft: draft() });

        focus._renderAssignStep(note());

        const html = focus.bodyEl.innerHTML;
        for (const block of BLOCKS) {
            assert.equal(html.includes(`data-focus-tile="${block.id}"`), true, `${block.id} missing from the palette`);
        }
    });

    it('marks a placed block as placed and non-draggable', () => {
        const focus = makeFocus({ setupStep: 'assign', setupDraft: draft() });

        focus._renderAssignStep(note());

        const html = focus.bodyEl.innerHTML;
        const placedTile = html.match(/<div class="magic-focus__tile is-placed"[^>]*data-focus-tile="text"/);
        assert.ok(placedTile, 'the placed block keeps its palette tile');
        assert.match(placedTile[0], /draggable="false"/);
        assert.match(html, /data-focus-tile="text" data-from-zone="z0"/);
    });

    it('labels an empty zone with its letter placeholder', () => {
        const focus = makeFocus({ setupStep: 'assign', setupDraft: draft() });

        focus._renderAssignStep(note());

        const html = focus.bodyEl.innerHTML;
        assert.match(html, /magic-focus__zone-placeholder">B</);
        assert.match(html, /magic-focus__zone-placeholder">C</);
        assert.equal(/magic-focus__zone-placeholder">A</.test(html), false, 'z0 holds a block');
    });

    it('marks zones that hold a block', () => {
        const focus = makeFocus({ setupStep: 'assign', setupDraft: draft() });

        focus._renderAssignStep(note());

        const html = focus.bodyEl.innerHTML;
        assert.equal((html.match(/data-focus-zone="z\d"/g) || []).length, 3);
        assert.match(html, /magic-focus__zone-slot has-block" data-focus-zone="z0"/);
        assert.match(html, /magic-focus__zone-slot" data-focus-zone="z1"/);
    });
});

describe('focus setup · binding', () => {
    it('wires a click handler onto every preset button', () => {
        const bound = [];
        const buttons = PRESET_META.map((preset) => ({
            addEventListener: (type) => bound.push({ preset: preset.id, type }),
            getAttribute: () => preset.id
        }));
        const focus = makeFocus();
        focus.bodyEl.querySelectorAll = (sel) => (sel === '[data-focus-preset]' ? buttons : []);

        focus._renderLayoutStep(note());

        assert.equal(bound.length, PRESET_META.length);
        assert.equal(bound.every((b) => b.type === 'click'), true);
    });

    it('survives a shell whose controls are all absent', () => {
        const focus = makeFocus({ setupStep: 'assign', setupDraft: createDefaultFocus() });
        focus.root = { querySelector: () => null, querySelectorAll: () => [] };

        assert.doesNotThrow(() => focus._renderAssignStep(note()));
    });
});
