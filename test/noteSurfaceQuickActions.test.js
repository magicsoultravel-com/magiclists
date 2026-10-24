// test/noteSurfaceQuickActions.test.js
// Characterization tests for js/noteSurfaceHtml/quickActions.js — the toolbar
// every board card, modal editor and popout window renders.
//
// The string is a contract with noteQuickActions.js (which binds by class), so
// the assertions here are about which button classes exist on which surface —
// a missing `card-act--planner` is a feature that silently stops opening.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../js/noteSurfaceHtml/quickActions.js';
const board = (item = {}, opts = {}) => import(MODULE).then((m) => m.buildNoteQuickActionsHtml(item, opts));

const has = (html, cls) => html.includes(`card-act--${cls}`);

describe('note quick actions · board surface', () => {
    it('renders the full board toolbar with a toggle, not a close button', async () => {
        const html = await board({ id: 'n1' });

        assert.match(html, /class="card-actions" data-action-count="13" data-surface="board"/);
        for (const cls of ['popout', 'draw', 'planner', 'flowchart', 'cal', 'emoji', 'copy',
            'note-package', 'pin', 'color', 'attach', 'hide', 'edit', 'toggle']) {
            assert.ok(has(html, cls), `board toolbar is missing ${cls}`);
        }
        assert.match(html, /class="card-act card-act--toggle" title="Expand note"/);
        assert.equal(has(html, 'close'), false, 'no modal close button on the board');
        assert.equal(html.includes('modal-card-actions'), false);
    });

    it('follows the expanded state and the spatial tile size', async () => {
        assert.match(await board({}, { isExpanded: true }), /title="Collapse note"/);

        const small = await board({}, { spatialTile: true, tileW: 65, tileH: 32 });
        assert.match(small, /class="card-act card-act--toggle" title="Expand"/);

        const large = await board({}, { spatialTile: true, tileW: 196, tileH: 131 });
        assert.match(large, /title="Collapse to small"/);
    });

    it('adds a drag handle only when the card is draggable and unpinned', async () => {
        const draggable = await board({}, { showDrag: true });
        assert.ok(has(draggable, 'drag'));
        assert.match(draggable, /data-action-count="14"/);

        const pinned = await board({}, { showDrag: true, pinned: true });
        assert.equal(has(pinned, 'drag'), false, 'a pinned card cannot be dragged');
        assert.match(pinned, /card-act--pin is-active" title="Unpin position \(locks drag\)" aria-label="Unpin position \(locks drag\)" aria-pressed="true"/);
    });

    it('counts attachments into the attach button', async () => {
        const none = await board({ id: 'n1' });
        assert.match(none, /class="card-act card-act--attach" title="Attach media" aria-label="Attach media" aria-pressed="false"/);

        const two = await board({ id: 'n1', attachments: [{ mediaId: 'm1' }, { mediaId: 'm2' }, { mediaId: 'm1' }] });
        assert.match(two, /class="card-act card-act--attach is-active" title="Attach media \(2\)"/, 'duplicates collapse');
        assert.match(two, /aria-pressed="true"/);
    });
});

describe('note quick actions · modal and popout surfaces', () => {
    it('swaps the toggle for a close button in the modal editor', async () => {
        const html = await board({ id: 'n1' }, { surface: 'modal', showArchive: true });

        assert.match(html, /data-surface="modal"/);
        assert.ok(html.includes('modal-card-actions'));
        assert.match(html, /class="card-act card-act--close" id="modal-close-btn" title="Show on board"/);
        assert.match(html, /id="modal-archive-btn"/, 'archive button precedes the toolbar');
        assert.equal(has(html, 'pin'), false, 'a modal card has no pinned position');
        assert.ok(has(html, 'drag'), 'modal notes are draggable onto the board');
    });

    it('drops the board-only actions inside a popout window', async () => {
        const html = await board({ id: 'n1' }, { surface: 'popout' });

        assert.match(html, /data-surface="popout" data-action-count|data-action-count="8" data-surface="popout"/);
        for (const cls of ['popout', 'draw', 'planner', 'flowchart', 'pin', 'hide', 'edit', 'drag', 'toggle']) {
            assert.equal(has(html, cls), false, `popout toolbar should not render ${cls}`);
        }
        assert.ok(has(html, 'window-size'), 'popout collapses its own window instead');
        assert.ok(has(html, 'emoji') && has(html, 'copy') && has(html, 'attach'));
    });

    it('marks a popped-out board note with the pop-in action', async () => {
        const html = await board({ id: 'n1' }, { poppedOut: true });

        assert.match(html, /class="card-act card-act--popin" title="Pop in \(return note to board\)"/);
        assert.match(html, /data-action-count="14"/, 'the pop-in button counts');
        assert.match(html, /card-act--popout is-active" data-note-id="n1" title="Focus popout window"/);
    });
});

// The toolbar moved to js/noteSurfaceHtml/quickActions.js. noteSurface.js and
// magicFocus.js render through the facade, so the function has to be the same
// object there — a wrapper would silently drop the surface options.
describe('note quick actions · module boundary', () => {
    it('re-exports buildNoteQuickActionsHtml as the very same object', async () => {
        const quick = await import(MODULE);
        const facade = await import('../js/noteSurfaceHtml.js');

        assert.equal(typeof quick.buildNoteQuickActionsHtml, 'function');
        assert.equal(facade.buildNoteQuickActionsHtml, quick.buildNoteQuickActionsHtml);
    });
});
