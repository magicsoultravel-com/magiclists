// test/noteSurfaceBody.test.js
// Characterization tests for js/noteSurfaceHtml/body.js — the note body rules and
// the rich-text helpers every rendered body goes through.
//
// `resolveNoteBodyVisibility` is the closest thing this file has to a spec: it
// decides whether the content block and the checklist block render, and it has an
// explicit exception (editors always see the checklist so they can add a first
// item). The rich-text helpers are the sanitising boundary between stored text and
// innerHTML.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../js/noteSurfaceHtml/body.js';
const load = () => import(MODULE);
const steps = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, text: `step ${i}` }));

describe('note body · visibility rules', () => {
    it('shows the checklist to editors even when the note has none', async () => {
        const { resolveNoteBodyVisibility } = await load();

        assert.deepEqual(
            resolveNoteBodyVisibility({ content: '', steps: [], editorBodyLayout: 'content' }, { canEdit: true }),
            { showContent: true, showChecklist: true },
            'editors always get the checklist so they can add a first item'
        );
    });

    it('hides empty blocks from readers', async () => {
        const { resolveNoteBodyVisibility } = await load();

        assert.deepEqual(
            resolveNoteBodyVisibility({ content: '   ', steps: [] }, { canEdit: false }),
            { showContent: false, showChecklist: false }
        );
        assert.deepEqual(
            resolveNoteBodyVisibility({ content: 'body', steps: steps(2) }, { canEdit: false }),
            { showContent: true, showChecklist: true }
        );
    });

    it('always shows both blocks in the modal editor', async () => {
        const { resolveNoteBodyVisibility } = await load();

        assert.deepEqual(
            resolveNoteBodyVisibility({ content: '', steps: [] }, { inModalEditor: true }),
            { showContent: true, showChecklist: true }
        );
    });
});

describe('note body · placeholder state', () => {
    // The "Add note…" / "Title…" hints are pure CSS (`::before` + data-placeholder)
    // and used to key off `:empty`, which a leftover <br> or &nbsp; defeats as soon
    // as a field is cleared in place. `is-empty` is the sanitised, render-time
    // answer, and it is also what lets a surface decide *when* the hint shows.
    it('marks a blank content field with is-empty', async () => {
        const { buildNoteContentFieldHtml } = await load();

        for (const blank of ['', '   ', '\u2028']) {
            const html = buildNoteContentFieldHtml({ content: blank }, { canEdit: true });
            assert.match(
                html,
                /class="card-content-preview card-inline-edit is-empty"/,
                `"${JSON.stringify(blank)}" renders nothing, so it must be marked empty`
            );
        }

        const filled = buildNoteContentFieldHtml({ content: 'body text' }, { canEdit: true });
        assert.equal(filled.includes('is-empty'), false, 'a filled field never carries is-empty');
    });

    it('leaves read-only markup free of editor placeholder state', async () => {
        const { buildNoteContentFieldHtml } = await load();

        const readOnly = buildNoteContentFieldHtml({ content: '' }, { canEdit: false });
        assert.equal(readOnly.includes('is-empty'), false, 'readers get no placeholder machinery');
        assert.equal(readOnly.includes('card-inline-edit'), false, 'and no editable field either');
    });

    it('keeps the text field for an empty checklist-only note when a card asks for it', async () => {
        const { resolveNoteBodyVisibility } = await load();
        const checklistOnly = { content: '', steps: steps(2), editorBodyLayout: 'checklist' };

        assert.deepEqual(
            resolveNoteBodyVisibility(checklistOnly, { canEdit: true }),
            { showContent: false, showChecklist: true },
            'the default stays as-is: no empty text row on a checklist-only note'
        );
        assert.deepEqual(
            resolveNoteBodyVisibility(checklistOnly, { canEdit: true, showTextShortcut: true }),
            { showContent: true, showChecklist: true },
            'cards opt in so "Add note…" is available on every note they render'
        );
    });

    it('reports showContent as a boolean even when the layout says checklist', async () => {
        const { resolveNoteBodyVisibility } = await load();

        assert.deepEqual(
            resolveNoteBodyVisibility({ content: 'text', steps: steps(1), editorBodyLayout: 'checklist' }, { canEdit: true }),
            { showContent: true, showChecklist: true },
            'a note that still has text keeps its field; the flag must not leak the string'
        );
    });
});

// These helpers hand off to richText.js, whose sanitiser parses markup through a
// real <template> element (and a TreeWalker for linkification). There is no DOM in
// `node --test` and no jsdom in this project, so only the paths that stay in regex
// land are covered here — the markup round-trip is exercised in the browser, the
// same gap richText.js itself has.
describe('note body · rich text helpers (DOM-free paths)', () => {
    it('short-circuits empty input', async () => {
        const { renderRichHtml, prepareContentForEdit } = await load();

        assert.equal(renderRichHtml(''), '');
        assert.equal(prepareContentForEdit(null), '');
        assert.equal(prepareContentForEdit(undefined), '');
    });

    it('routes tag-looking input through the sanitiser rather than escaping it inline', async () => {
        // Both helpers key off hasRichMarkup() on the *raw* text, so '<b>x</b>' is a
        // sanitiser job — that path needs the DOM stub this project does not have.
        // What stays assertable here is the decision rule itself.
        const { canInlineEditText } = await load();

        assert.equal(canInlineEditText('a < b'), true, 'a stray angle bracket is still plain text');
        assert.equal(canInlineEditText('<b>x</b>'), false);
    });

    it('only allows inline editing of plain text unless rich edit is on', async () => {
        const { canInlineEditText } = await load();

        assert.equal(canInlineEditText('plain'), true);
        assert.equal(canInlineEditText('<strong>bold</strong>'), false);
        assert.equal(canInlineEditText('<strong>bold</strong>', { richEdit: true }), true);
        assert.equal(canInlineEditText(''), true);
    });
});

describe('note body · module boundary', () => {
    it('re-exports the body helpers by identity', async () => {
        const body = await load();
        const facade = await import('../js/noteSurfaceHtml.js');

        for (const name of [
            'resolveNoteBodyVisibility', 'buildNoteBodyHtml', 'buildNoteContentFieldHtml',
            'buildNoteBodyConvertButtonsHtml', 'updateConvertButtons', 'renderRichHtml',
            'canInlineEditText', 'prepareContentForEdit', 'buildNoteBodySection',
            'bindNoteBodySections', 'bindNoteContentSubToggles', 'buildMeetingBodyHtml'
        ]) {
            assert.equal(facade[name], body[name], `${name} is wrapped instead of re-exported`);
        }
        for (const internal of ['growSheetCells', 'appendNoteSideSections', 'resolveNoteTemplate']) {
            assert.equal(facade[internal], undefined, `${internal} leaked into the facade`);
        }
    });
});
