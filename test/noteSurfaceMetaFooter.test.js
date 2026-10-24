// test/noteSurfaceMetaFooter.test.js
// Characterization tests for js/noteSurfaceHtml/metaFooter.js — the footer strip
// that reports size, line count and dates for a note.
//
// `computeNoteSizeKb` serialises a hand-picked payload, so it is the closest
// thing the app has to "how big is this note"; `computeNoteLineCount` counts
// content + checklist steps + sheet cells. Both were only observable by opening
// a note and squinting at the footer.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../js/noteSurfaceHtml/metaFooter.js';
const load = () => import(MODULE);

describe('note meta footer · stats', () => {
    it('counts lines across content, checklist steps and sheet cells', async () => {
        const { computeNoteLineCount } = await load();

        assert.equal(computeNoteLineCount(null), 0);
        assert.equal(computeNoteLineCount({}), 0);
        assert.equal(computeNoteLineCount({ content: 'one' }), 1);
        assert.equal(computeNoteLineCount({ content: 'one\ntwo\nthree' }), 3);
        assert.equal(
            computeNoteLineCount({ content: 'a\nb', steps: [{ text: 'c' }, { text: 'd\ne' }] }),
            5,
            'content lines plus one line per non-empty step line'
        );
        assert.equal(computeNoteLineCount({ content: 'x', steps: [{ text: '' }] }), 1, 'blank steps are skipped');
    });

    it('formats the line label for singular and plural', async () => {
        const { formatNoteLineCount } = await load();

        assert.equal(formatNoteLineCount(1), '1 line');
        assert.equal(formatNoteLineCount(0), '0 lines');
        assert.equal(formatNoteLineCount(7), '7 lines');
    });

    it('reports payload size with a floor label and a rounding switch', async () => {
        const { computeNoteSizeKb } = await load();

        assert.equal(computeNoteSizeKb(null), '0');
        assert.equal(computeNoteSizeKb({ title: 'hi' }), '<0.1', 'tiny notes are not 0.0');

        const big = computeNoteSizeKb({ title: 't', content: 'x'.repeat(20 * 1024) });
        assert.equal(big, '20', 'mid-size notes keep one decimal, then round');
        const huge = computeNoteSizeKb({ title: 't', content: 'x'.repeat(120 * 1024) });
        assert.equal(huge, '120', 'big notes report whole KB');
    });

    it('serialises only the meaningful item fields', async () => {
        const { computeNoteSizeKb } = await load();

        const base = { title: 'same', content: 'body' };
        const noise = { ...base, id: 'n1', x: 12, y: 40, hidden: true, _dirty: true };
        assert.equal(
            computeNoteSizeKb(noise), computeNoteSizeKb(base),
            'positional/id noise does not change the reported size'
        );
        assert.notEqual(
            computeNoteSizeKb({ ...base, steps: [{ text: 'a' }] }), computeNoteSizeKb(base),
            'checklist steps do count'
        );
    });
});

describe('note meta footer · markup', () => {
    it('renders stats, the category dot and the category name', async () => {
        const { buildNoteMetaFooterHtml } = await load();
        const html = buildNoteMetaFooterHtml(
            { content: 'a\nb', updated_at: 1700000000 },
            { targetCatName: 'Office', categoryColor: '#abc' }
        );

        assert.match(html, /class="badge-dot" style="background-color: #abc;" title="Office"/);
        assert.match(html, /<span class="category-name">Office<\/span>/);
        // NB: the '<0.1' floor is emitted raw, so the label can start with '<'
        assert.match(html, /class="editor-note-size" title="Note content size">[^]{0,8}? KB<\/span>/);
        assert.match(html, /class="editor-note-lines" title="Number of lines">2 lines</);
        assert.match(html, /class="editor-modified-date" title="Last modified">/);
    });

    it('omits the category name for uncategorised notes', async () => {
        const { buildNoteMetaFooterHtml } = await load();
        const html = buildNoteMetaFooterHtml({ content: 'a' });

        assert.match(html, /title="Uncategorized"/);
        assert.equal(html.includes('class="category-name"'), false);
        assert.equal(html.includes('editor-created-date'), false, 'no created date on an item without one');
    });

    it('escapes a category name that contains markup', async () => {
        const { buildNoteMetaFooterHtml } = await load();
        const html = buildNoteMetaFooterHtml(
            { content: 'a' },
            { targetCatName: '<img src=x onerror=1>', categoryColor: '#123' }
        );

        assert.equal(html.includes('<img'), false);
        assert.match(html, /&lt;img/);
    });
});

describe('note meta footer · module boundary', () => {
    it('re-exports the stats through the facade by identity', async () => {
        const meta = await load();
        const facade = await import('../js/noteSurfaceHtml.js');

        for (const name of ['buildNoteMetaFooterHtml', 'computeNoteSizeKb', 'computeNoteLineCount', 'formatNoteLineCount']) {
            assert.equal(facade[name], meta[name], `${name} is wrapped instead of re-exported`);
        }
        assert.equal(facade.sheetCellTexts, undefined, 'the sheet helper stays internal');
    });
});
