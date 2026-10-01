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

    it('flushes Focus edits before close teardown and pane rebuild', () => {
        const source = readFileSync(join(HERE, '../js/magicFocus.js'), 'utf8');
        assert.match(source, /flushPendingEdits\s*\(/);
        assert.match(source, /flushDesktopAutoSave\(shell,\s*item,\s*\{\s*mergeWindow:\s*false\s*\}\)/);
        assert.match(source, /async close\(\)\s*\{[\s\S]*?this\.flushPendingEdits\(\);/);
        assert.match(source, /async _fillPane[\s\S]*?flushDesktopAutoSave\(pane,\s*live,\s*\{\s*mergeWindow:\s*false\s*\}\)/);
        assert.match(source, /Editor\.persistNote\(\{\s*force:\s*true,\s*normalize:\s*true\s*\}\)/);
        assert.match(source, /Editor\.close\(\)/);
    });
});

describe('multi-host board flush skip contract', () => {
    it('app lifecycle and overlay/FC flushes use a shared skip id set', () => {
        const app = readFileSync(join(HERE, '../js/app.js'), 'utf8');
        assert.match(app, /resolveStaleBoardFlushSkipIds\s*\(/);
        assert.match(app, /flushPendingNoteHostsForLifecycle\s*\(/);
        assert.match(app, /listPoppedOutNoteIds\s*\(/);
        assert.match(app, /skipItemIds:\s*this\.resolveStaleBoardFlushSkipIds\(\)/);
        assert.match(app, /MagicFocus\.flushPendingEdits\(\)/);
        // Busy guards treat Focus as editing
        assert.match(app, /MagicFocus\.isOpen\(\)\s*&&\s*MagicFocus\.getActiveItemId\(\)\s*===\s*noteId/);
        const sync = readFileSync(join(HERE, '../js/sync.js'), 'utf8');
        assert.match(sync, /hasAttribute\('data-magic-focus'\)/);
        const ui = readFileSync(join(HERE, '../js/ui.js'), 'utf8');
        assert.match(ui, /skipItemIds\s*=\s*null/);
        const boardOps = readFileSync(join(HERE, '../js/boardOperations.js'), 'utf8');
        assert.doesNotMatch(boardOps, /flushAllInlineEditsFromCanvas/);
    });
});
