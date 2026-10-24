// test/noteSurfaceCard.test.js
// Characterization tests for js/noteSurfaceHtml/card.js — the two paint helpers
// that run on every card, plus the boundary that keeps the card API on the facade.
//
// `applyCardCategoryBand` is where the "left band colour" contract lives: CSS owns
// the band via `--card-category-color`, and the helper has to *remove* the legacy
// inline border-left-color or old cards keep a stale stripe after a re-colour.
// That was a real bug once; it is pinned here so it cannot come back.
//
// Run with: npm test  (node --test test/)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const MODULE = '../js/noteSurfaceHtml/card.js';
const { UNCATEGORIZED_COLOR } = await import('../js/categories.js');

function makeEl() {
    const props = new Map();
    const removed = [];
    const el = {
        style: {
            setProperty: (k, v) => props.set(k, v),
            removeProperty: (k) => { removed.push(k); props.delete(k); },
            getPropertyValue: (k) => props.get(k) || ''
        },
        props,
        removed,
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        querySelector: () => null,
        querySelectorAll: () => [],
        closest: () => null,
        setAttribute() {},
        addEventListener() {},
        appendChild(child) { return child; }
    };
    return el;
}

describe('note card · category band', () => {
    it('paints the band through the css variable', async () => {
        const { applyCardCategoryBand } = await import(MODULE);
        const card = makeEl();

        applyCardCategoryBand(card, '#abc');

        assert.equal(card.props.get('--card-category-color'), '#abc');
    });

    it('falls back to the uncategorised colour', async () => {
        const { applyCardCategoryBand } = await import(MODULE);
        const card = makeEl();

        applyCardCategoryBand(card, '');

        assert.equal(card.props.get('--card-category-color'), UNCATEGORIZED_COLOR);
    });

    it('clears the legacy inline left border so no stale stripe survives', async () => {
        const { applyCardCategoryBand } = await import(MODULE);
        const card = makeEl();

        applyCardCategoryBand(card, '#abc');

        assert.deepEqual(card.removed, ['border-left-color']);
        assert.equal(card.style.borderLeftColor, undefined, 'the band is CSS-owned');
    });

    it('tolerates a missing card', async () => {
        const { applyCardCategoryBand } = await import(MODULE);

        assert.doesNotThrow(() => applyCardCategoryBand(null, '#abc'));
    });
});

describe('note card · theme edges', () => {
    it('paints the neutral edge and hands the shell to the theme helper', async () => {
        const { applyItemCardTheme } = await import(MODULE);
        const card = makeEl();
        const classes = new Set();
        const shell = {
            id: 'shell-el',
            dataset: {},
            style: { setProperty() {}, removeProperty() {} },
            classList: {
                add: (...n) => n.forEach((c) => classes.add(c)),
                remove: (...n) => n.forEach((c) => classes.delete(c)),
                toggle() {},
                contains: (c) => classes.has(c)
            },
            setAttribute() {},
            removeAttribute() {},
            closest: () => null,
            querySelector: () => null,
            querySelectorAll: () => [],
            getAttribute: () => null
        };
        card.querySelector = (sel) => (sel === '.editor-note-shell' ? shell : null);

        applyItemCardTheme(card, { backgroundColor: '#ff0000' });

        assert.equal(card.style.borderTopColor, 'rgba(255,255,255,0.15)');
        assert.equal(card.style.borderRightColor, 'rgba(255,255,255,0.15)');
        assert.equal(card.style.borderBottomColor, 'rgba(255,255,255,0.15)');
        assert.ok(classes.has('has-custom-bg'), 'the shell receives the resolved note colour');
    });

    it('does not require a shell element', async () => {
        const { applyItemCardTheme } = await import(MODULE);
        const card = makeEl();

        assert.doesNotThrow(() => applyItemCardTheme(card, {}));
    });
});

describe('note card · module boundary', () => {
    it('re-exports the card API by identity', async () => {
        const card = await import(MODULE);
        const facade = await import('../js/noteSurfaceHtml.js');

        for (const name of [
            'applyItemCardTheme', 'applyCardCategoryBand', 'createCardComponent',
            'renderBoardEditorCard', 'refreshBoardChecklistBody', 'refreshBoardEditorCard',
            'refreshNoteBody'
        ]) {
            assert.equal(facade[name], card[name], `${name} is wrapped instead of re-exported`);
        }
    });

    it('keeps the facade a barrel: every export comes from a sibling module', async () => {
        const fs = await import('node:fs');
        const src = fs.readFileSync(new URL('../js/noteSurfaceHtml.js', import.meta.url), 'utf8');

        assert.equal(/^(?:export )?(?:function|const) /m.test(src), false, 'no code lives in the facade any more');
        assert.equal(/\.js';/.test(src), true);
    });
});
