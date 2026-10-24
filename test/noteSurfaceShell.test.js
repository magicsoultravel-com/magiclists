// test/noteSurfaceShell.test.js
// Characterization tests for js/noteSurfaceHtml/shell.js — the editable title,
// the formatting panel and the configuration panel.
//
// These are pure string builders (for plain-text titles and content) so they can
// be pinned without a DOM: the title's editable/read-only split, the format panel
// exposing the inline commands, and the config panel marking the active template.
// buildNoteEditorShell itself composes the body, which parses markup through the
// DOM, so it stays a browser-only path.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../js/noteSurfaceHtml/shell.js';
const load = () => import(MODULE);
const item = (extra = {}) => ({ id: 'n1', title: 'Plain title', content: 'a', steps: [], noteTemplate: '', ...extra });

describe('note shell · title', () => {
    it('makes the title inline-editable for editors', async () => {
        const { buildNoteTitleHtml } = await load();
        const html = buildNoteTitleHtml(item(), true);

        assert.match(html, /class="mini-card-title card-inline-edit" contenteditable="plaintext-only"/);
        assert.match(html, /data-field="title" data-placeholder="Title…"/);
        assert.match(html, />Plain title</);
    });

    it('renders a read-only title with the full text as a tooltip for readers', async () => {
        const { buildNoteTitleHtml } = await load();
        const html = buildNoteTitleHtml(item(), false);

        assert.match(html, /class="mini-card-title" title="Plain title"/);
        assert.equal(html.includes('contenteditable'), false);
    });
});

describe('note shell · formatting panel', () => {
    it('starts collapsed and exposes the inline format commands', async () => {
        const { buildNoteFormatPanelHtml } = await load();
        const html = buildNoteFormatPanelHtml(item());

        assert.match(html, /class="editor-panel editor-panel--format"/);
        assert.match(html, /class="collapsable-section collapsed" id="format-section"/);
        for (const cmd of ['bold', 'italic', 'underline', 'strikeThrough']) {
            assert.ok(html.includes(`data-format-cmd="${cmd}"`), `format panel is missing ${cmd}`);
        }
        assert.match(html, /title="Bold \(Ctrl\+B\)"/);
    });
});

describe('note shell · config panel', () => {
    it('marks the active template and passes category options through', async () => {
        const { buildNoteConfigPanelHtml } = await load();
        const html = buildNoteConfigPanelHtml(item({ noteTemplate: 'sheet' }), {
            categoryOptionsHtml: '<option value="Office">Office</option>',
            startParts: { date: '2024-01-01', time: '09:30' },
            endParts: {}
        });

        assert.match(html, /class="editor-panel editor-panel--config"/);
        assert.match(html, /<option value="default" >Note \/ Checklist<\/option>/);
        assert.match(html, /<option value="sheet" selected>Sheet<\/option>/);
        assert.match(html, /<option value="meeting" >Meeting<\/option>/);
        assert.match(html, /<option value="Office">Office<\/option>/, 'category options are injected verbatim');
        assert.match(html, /id="edit-start-date" class="form-input" value="2024-01-01"/);
        assert.match(html, /id="edit-start-time"[^>]*value="09:30"/, 'optional time reaches the panel');
    });

    it('defaults to the plain note template', async () => {
        const { buildNoteConfigPanelHtml } = await load();
        const html = buildNoteConfigPanelHtml(item());

        assert.match(html, /<option value="default" selected>Note \/ Checklist<\/option>/);
        assert.equal(/#123;|undefined/.test(html), false, 'no undefined leaks into the markup');
    });
});

describe('note shell · module boundary', () => {
    it('re-exports the shell builders by identity', async () => {
        const shell = await load();
        const facade = await import('../js/noteSurfaceHtml.js');

        for (const name of ['buildNoteTitleHtml', 'buildNoteFormatPanelHtml', 'buildNoteConfigPanelHtml', 'buildNoteEditorShell', 'bindCollapsable', 'flashCopyFeedback']) {
            assert.equal(facade[name], shell[name], `${name} is wrapped instead of re-exported`);
        }
    });
});
