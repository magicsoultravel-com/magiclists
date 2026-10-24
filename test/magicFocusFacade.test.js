// test/magicFocusFacade.test.js
// Boundary tests for js/magicFocus.js after the split into js/magicFocus/*.
//
// Only `MagicFocus` is imported from outside (app.js, noteQuickActions.js,
// notePlanner*, three lazy `import('./magicFocus.js')` call sites), so what has to
// hold is identity plus two structural rules:
//
//   1. every method is a one-line delegate — no body may drift back into the
//      facade, because a body there is invisible to the session suites;
//   2. the sessions import leaf modules only (model, layout, paneMarkup) and never
//      each other. Cross-session calls go back through `magicFocus.method()`, so
//      the graph stays a star. A session importing a session would work fine until
//      someone added a second edge, then turn into a load-order cycle.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const facade = await import('../js/magicFocus.js');
const { MagicFocus } = facade;

const SUBMODULES = ['model', 'layout', 'paneMarkup', 'setup', 'panes', 'splitters', 'render', 'lifecycle'];
const SESSIONS = { setup: 'SetupSession', panes: 'PaneSession', splitters: 'SplitterSession', render: 'RenderSession', lifecycle: 'LifecycleSession' };
const src = fs.readFileSync(new URL('../js/magicFocus.js', import.meta.url), 'utf8');

describe('focus facade · public surface', () => {
    it('exports the same four names as before the split', () => {
        assert.deepEqual(Object.keys(facade).sort(), ['MagicFocus', 'createDefaultFocus', 'focusIsConfigured', 'normalizeFocus']);
    });

    it('re-exports the model functions rather than wrapping them', async () => {
        const model = await import('../js/magicFocus/model.js');

        for (const name of ['createDefaultFocus', 'normalizeFocus', 'focusIsConfigured']) {
            assert.equal(facade[name], model[name], `${name} is wrapped instead of re-exported`);
        }
    });

    it('keeps the state the session modules read and write', () => {
        for (const field of ['root', 'headerEl', 'bodyEl', 'activeItemId', 'setupDraft', 'setupStep',
            'showingSetup', 'expandedPaneId', 'sessionSpawnBlocks', 'sessionSpawnZoom',
            'drawingHomeParent', 'drawingHosted', '_escHandler', '_exitFab', '_ui', '_app']) {
            assert.equal(field in MagicFocus, true, `${field} disappeared from the instance`);
        }
    });
});

describe('focus facade · delegates', () => {
    it('every method body is a single delegation', () => {
        const methods = src.split('\n').filter((l) => /\{ return \w+Session\.\w+\(this/.test(l));

        assert.equal(methods.length, 50, 'a method body grew past one line');
        for (const line of methods) {
            assert.match(line, /\{ return \w+Session\.\w+\(this(?:[^)]*)\); \},?$/, `not a plain delegate: ${line.trim()}`);
        }
    });

    it('has no logic of its own left', () => {
        assert.equal(/^\s+(?:if|for|while|const|let) /m.test(src), false, 'logic crept back into the facade');
        assert.equal(/=>/.test(src), false, 'a closure in the facade would run outside the tested sessions');
    });

    it('dispatches to the session that owns each method', () => {
        const pairs = [
            ['open', 'LifecycleSession'], ['renderWork', 'RenderSession'], ['renderSetup', 'SetupSession'],
            ['_fillPane', 'PaneSession'], ['_mountSplitters', 'SplitterSession']
        ];

        for (const [method, session] of pairs) {
            assert.match(src, new RegExp(`${method}\\([^)]*\\) \\{ return ${session}\\.${method}\\(this`), `${method} is not delegated to ${session}`);
        }
    });

    it('returns what the session returns (no swallowed promise or value)', async () => {
        const focus = {
            activeItemId: 'n1',
            root: { classList: { contains: () => false } },
            _itemResolver: (id) => ({ id })
        };

        assert.equal(MagicFocus.getActiveItemId.call(focus), 'n1');
        assert.deepEqual(MagicFocus.resolveItem.call(focus), { id: 'n1' });
        assert.equal(MagicFocus.isOpen.call(focus), true);
    });
});

describe('focus facade · module graph', () => {
    it('ships every submodule the facade imports', () => {
        for (const name of SUBMODULES) {
            assert.equal(fs.existsSync(new URL(`../js/magicFocus/${name}.js`, import.meta.url)), true, `${name}.js is missing`);
        }
    });

    it('sessions import leaf modules only — never another session', () => {
        const sessionFiles = Object.keys(SESSIONS);
        for (const name of sessionFiles) {
            const file = new URL(`../js/magicFocus/${name}.js`, import.meta.url);
            const text = fs.readFileSync(file, 'utf8');
            const specifiers = [...text.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
            const local = specifiers.filter((s) => s.startsWith('./'));

            for (const spec of local) {
                const target = path.basename(spec, '.js');
                assert.equal(sessionFiles.includes(target), false, `${name}.js imports the ${target} session (call back through the facade instead)`);
                assert.equal(['model', 'layout', 'paneMarkup'].includes(target), true, `${name}.js imports unexpected sibling ${spec}`);
            }
        }
    });

    it('the facade itself imports nothing but the sessions and the model', () => {
        const specifiers = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);

        for (const spec of specifiers) {
            assert.match(spec, /^\.\/magicFocus\/\w+\.js$/, `unexpected facade import ${spec}`);
        }
    });
});
