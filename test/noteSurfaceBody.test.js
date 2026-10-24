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
