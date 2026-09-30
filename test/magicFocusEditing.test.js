import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { hasRichMarkup } from '../js/richText.js';
import {
    buildNoteContentFieldHtml,
    buildExpandedChecklistHtml,
    canInlineEditText
} from '../js/noteSurfaceHtml.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL_TEXT = 'ship it see https://example.com/docs page';

function step(id, text) {
    return { id, text, completed: false, level: 0, parentId: null, order: 0 };
}

describe('hasRichMarkup determinism', () => {
    it('returns the same result for URL text across repeated calls', () => {
        const first = hasRichMarkup(URL_TEXT);
        assert.equal(first, true);
        for (let i = 0; i < 10; i += 1) {
            assert.equal(hasRichMarkup(URL_TEXT), first);
        }
    });

    it('treats plain text as non-rich and tagged text as rich on every call', () => {
        for (let i = 0; i < 5; i += 1) {
            assert.equal(hasRichMarkup('no links here'), false);
            assert.equal(hasRichMarkup('a <b>bold</b> word'), true);
        }
    });
});

describe('focus text field editability', () => {
    it('renders URL text as an editable rich field (richEdit: true)', () => {
        const html = buildNoteContentFieldHtml({ content: URL_TEXT }, { canEdit: true, richEdit: true });
        const tag = html.match(/<div[^>]*data-field="content"[^>]*>/);
        assert.ok(tag, 'content field element should render');
        assert.match(tag[0], /contenteditable="true"/);
        assert.match(tag[0], /rich-text--edit/);
    });

    it('stays editable across repeated renders (no stateful flip)', () => {
        for (let i = 0; i < 10; i += 1) {
            const html = buildNoteContentFieldHtml({ content: URL_TEXT }, { canEdit: true, richEdit: true });
            assert.match(html, /contenteditable="true"/);
        }
    });

    it('documents the read-only trap when richEdit is false', () => {
        // canInlineEditText only tolerates plain text, so non-rich surfaces could
        // never edit URL content — the reason Focus must mirror the board.
        assert.equal(canInlineEditText(URL_TEXT, { richEdit: false }), false);
        assert.equal(canInlineEditText(URL_TEXT, { richEdit: true }), true);
    });
});

describe('focus checklist row editability', () => {
    it('renders URL steps as editable rows (richEdit: true)', () => {
        const item = { id: 'note-1', steps: [step('s1', URL_TEXT)] };
        const html = buildExpandedChecklistHtml(item, true, { richEdit: true });
        const span = html.match(/<span[^>]*data-step-id="s1"[^>]*>/);
        assert.ok(span, 'step row should render');
        assert.match(span[0], /contenteditable="true"/);
    });

    it('keeps every row editable across repeated renders', () => {
        const item = { id: 'note-1', steps: [step('s1', URL_TEXT), step('s2', 'plain step')] };
        for (let i = 0; i < 10; i += 1) {
            const html = buildExpandedChecklistHtml(item, true, { richEdit: true });
            for (const id of ['s1', 's2']) {
                const span = html.match(new RegExp(`<span[^>]*data-step-id="${id}"[^>]*>`));
                assert.ok(span, `step ${id} should render`);
                assert.match(span[0], /contenteditable="true"/);
            }
        }
    });

    it('documents the read-only trap for URL steps when richEdit is false', () => {
        const item = { id: 'note-1', steps: [step('s1', URL_TEXT)] };
        const html = buildExpandedChecklistHtml(item, true, { richEdit: false });
        assert.doesNotMatch(html, /contenteditable/);
    });
});

describe('magic focus source contract', () => {
    it('never downgrades note fields to non-rich editing', () => {
        const source = readFileSync(join(HERE, '../js/magicFocus.js'), 'utf8');
        assert.doesNotMatch(source, /richEdit:\s*false/);
        assert.match(source, /buildNoteContentFieldHtml\(item,\s*\{\s*canEdit:\s*true,\s*richEdit:\s*true\s*\}\)/);
        assert.match(source, /buildExpandedChecklistHtml\(item,\s*true,\s*\{\s*richEdit:\s*true\s*\}\)/);
    });

    it('wires a checklist refresh callback and a surgical planner refresh', () => {
        const source = readFileSync(join(HERE, '../js/magicFocus.js'), 'utf8');
        assert.match(source, /refresh:\s*\(\)\s*=>\s*this\.refreshChecklistPane\(body\)/);
        assert.match(source, /refreshPlannerDerivedViews\(live\)/);
    });
});
