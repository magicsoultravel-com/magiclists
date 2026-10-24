// test/magicFocusPaneMarkup.test.js
// Characterization tests for js/magicFocus/paneMarkup.js — the body markup for one
// focus pane, and the preset glyphs the setup step shows.
//
// Two things matter here beyond "it renders":
//   * every planner pane wraps its renderer output in a `data-focus-*-only`
//     marker. That marker is what tells the shared planner renderers to show only
//     that sub-view inside focus, so a missing marker means a pane that renders
//     the whole planner (table *and* chart *and* kanban) inside one cell;
//   * the renderers are loaded with dynamic `import()` on purpose, so focus never
//     pulls plannerUi/noteAttachmentsUi into the boot graph. Those specifiers have
//     to stay resolvable from the submodule's depth — a stale './x.js' links fine
//     and only fails when a pane is actually opened.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const {
    buildChecklistPaneHtml,
    buildTablePaneHtml,
    buildChartPaneHtml,
    buildKanbanPaneHtml,
    buildWbsPaneHtml,
    buildMediaPaneHtml,
    presetGlyphHtml
} = await import('../js/magicFocus/paneMarkup.js');
const { normalizePlanner } = await import('../js/planner.js');

const item = (over = {}) => ({ id: 'n1', steps: [], planner: null, attachments: [], ...over });
const step = (id, text, over = {}) => ({ id, text, level: 0, completed: false, parentId: null, order: 0, ...over });
// A planner is only valid once it has a sheet; `normalizePlanner` returns null otherwise.
const planner = () => normalizePlanner({
    version: 2,
    sheet: { rows: 3, cols: 6, cells: { '0:0': { v: 'Kickoff' } }, colWidths: [90, 72, 108, 108, 44, 80] }
});

describe('focus pane markup · checklist', () => {
    it('renders the expanded checklist with its steps', () => {
        const html = buildChecklistPaneHtml(item({ steps: [step('s1', 'Buy milk')] }));

        assert.match(html, /class="expanded-checklist"/);
        assert.match(html, /Buy milk/);
    });

    it('creates the step list when the note has none', () => {
        const note = { id: 'n1' };

        assert.doesNotThrow(() => buildChecklistPaneHtml(note));
        assert.deepEqual(note.steps, []);
    });
});

describe('focus pane markup · planner panes', () => {
    for (const [name, build, marker, empty] of [
        ['table', buildTablePaneHtml, 'data-focus-table-only', 'No planner table'],
        ['chart', buildChartPaneHtml, 'data-focus-chart-only', 'No planner chart'],
        ['kanban', buildKanbanPaneHtml, 'data-focus-kanban-only', 'No planner kanban'],
        ['wbs', buildWbsPaneHtml, 'data-focus-wbs-only', 'No planner WBS']
    ]) {
        it(`${name}: empty state when the note has no planner`, async () => {
            const html = await build(item());

            assert.equal(html, `<p class="magic-focus__empty">${empty}</p>`);
        });

        it(`${name}: wraps the renderer output in its -only marker`, async () => {
            const html = await build(item({ planner: planner() }));

            assert.match(html, /data-note-planner/);
            assert.equal(html.includes(marker), true, `the ${marker} marker is what keeps the pane single-view`);
            assert.ok(html.length > 60);
        });
    }

    it('normalises a stored planner before rendering it', async () => {
        const note = item({
            planner: { version: 2, sheet: { rows: 3, cols: 6, cells: { '0:0': { v: 'Raw' } }, colWidths: [90, 72, 108, 108, 44, 80] } }
        });

        const html = await buildTablePaneHtml(note);

        assert.match(html, /Raw/);
        assert.equal(typeof note.planner.sheet, 'object', 'the pane writes the normalised planner back');
    });

    it('forces the chart and kanban sub-views open inside focus', async () => {
        const base = planner();
        const collapsed = { ...base, chartCollapsed: true, kanbanCollapsed: true };

        assert.doesNotThrow(() => buildChartPaneHtml(item({ planner: collapsed })));
        assert.doesNotThrow(() => buildKanbanPaneHtml(item({ planner: collapsed })));
        assert.equal(collapsed.chartCollapsed, true, 'the caller object is not mutated');
    });
});

describe('focus pane markup · media', () => {
    it('renders the media sub-shell with the add call to action when empty', async () => {
        const html = await buildMediaPaneHtml(item());

        assert.match(html, /data-focus-media-sub/);
        assert.match(html, /data-focus-media-toggle/);
        assert.match(html, /data-focus-media-add/);
        assert.match(html, /No media yet/);
    });

    it('drops the empty state once the note has attachments', async () => {
        const html = await buildMediaPaneHtml(item({
            attachments: [{ mediaId: 'a1' }]
        }));

        assert.equal(/No media yet/.test(html), false);
        assert.match(html, /data-note-attachments/);
    });
});

describe('focus pane markup · preset glyphs', () => {
    it('draws a glyph per known preset', () => {
        for (const id of ['split2-v', 'split2-h', 'split3-cols', 'split3-rows', 'split3-1over2', 'split3-2over1', 'split4-grid']) {
            assert.match(presetGlyphHtml(id), /^<svg class="magic-focus__preset-glyph"/, `${id} has no glyph`);
        }
    });

    it('falls back to the halves glyph for an unknown preset', () => {
        assert.equal(presetGlyphHtml('mystery'), presetGlyphHtml('split2-v'));
    });
});
