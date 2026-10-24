// test/noteSurfaceChecklistBarrel.test.js
// Boundary tests for js/noteSurfaceChecklist.js after the split into
// js/noteSurfaceChecklist/{rows,collapse,targeting,ops,drag,interactions}.js.
//
// The facade is what nine other modules import, so the contract worth pinning is
// not behaviour (each slice has its own suite) but *identity*: every name is the
// same function object the submodule exports, nothing is wrapped, and the public
// surface did not grow. A wrapper here would be invisible — same name, same
// arity, subtly different behaviour — and would quietly fork the checklist logic
// every caller sees.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const facade = await import('../js/noteSurfaceChecklist.js');

const SLICES = {
    './noteSurfaceChecklist/rows.js': ['buildChecklistRowHtml'],
    './noteSurfaceChecklist/collapse.js': [
        'getChecklistCollapsedKeys', 'getChecklistDoneCollapsed', 'isChecklistDoneSectionCollapsed',
        'toggleChecklistDoneSection', 'getChecklistCollapsibleKeys', 'checklistGroupsAnyExpanded',
        'collapseAllChecklistGroups', 'expandAllChecklistGroups', 'toggleChecklistExpandCollapseAll',
        'buildChecklistExpandCollapseAllHtml', 'expandChecklistAncestorsForStep'
    ],
    './noteSurfaceChecklist/targeting.js': ['getActiveRows'],
    './noteSurfaceChecklist/ops.js': [
        'insertChecklistStep', 'removeChecklistStepAndFocus', 'handleChecklistBackspace',
        'handleChecklistDelete', 'handleChecklistEnter', 'prepareInlineOpSnapshot', 'createStepId'
    ],
    './noteSurfaceChecklist/drag.js': ['attachChecklistDrag'],
    './noteSurfaceChecklist/interactions.js': ['isChecklistInteraction', 'bindChecklistInteractions']
};

const allNames = Object.values(SLICES).flat();

describe('checklist facade · public surface', () => {
    it('exports exactly the pre-split names', () => {
        assert.deepEqual(Object.keys(facade).sort(), [...allNames].sort());
    });

    it('exports nothing that is not a function', () => {
        for (const name of allNames) {
            assert.equal(typeof facade[name], 'function', `${name} is not callable`);
        }
    });

    it('keeps the collapsed-key readers public — the HTML builders depend on them', () => {
        for (const name of ['getChecklistCollapsedKeys', 'getChecklistDoneCollapsed', 'getActiveRows']) {
            assert.equal(typeof facade[name], 'function');
        }
    });
});

describe('checklist facade · identity', () => {
    it('re-exports the submodule bindings, it does not wrap them', async () => {
        for (const [path, names] of Object.entries(SLICES)) {
            const slice = await import(`../js/${path.replace('./', '')}`);

            for (const name of names) {
                assert.equal(facade[name], slice[name], `${name} is wrapped instead of re-exported`);
            }
        }
    });
});

describe('checklist facade · stays a barrel', () => {
    it('holds no code of its own', () => {
        const src = fs.readFileSync(new URL('../js/noteSurfaceChecklist.js', import.meta.url), 'utf8');

        assert.equal(/^(?:export )?(?:function|const|let) /m.test(src), false, 'logic crept back into the facade');
        assert.equal(/^import /m.test(src), false, 'a barrel needs no local imports, only re-exports');
        assert.match(src, /^export \{\n(?: {4}\w+,\n)+ {4}\w+\n\} from '\.\/noteSurfaceChecklist\/\w+\.js';$/m);
    });

    it('points every block at a module that exists', async () => {
        for (const path of Object.keys(SLICES)) {
            await assert.doesNotReject(() => import(`../js/${path.replace('./', '')}`), `${path} is missing`);
        }
    });
});
