// test/uiFacade.test.js
// Boundary freeze for js/ui.js, taken before it is split into js/ui/*.
//
// js/ui.js has six importers (dragdrop, app, hamburger, editor, desktopCardManager,
// noteQuickActions) and no test of its own, so the thing worth pinning is not any
// one method but the shape of the object they all reach into: the export list, the
// 121 method names and their Function.length. The length matters because callers
// pass positionally and every extracted method gains a leading `ui` receiver - if a
// default slips out of a delegate, `UI.packGridBoard(canvas, a, b, opts)` silently
// starts dropping `opts`.
//
// This suite is the gate every slice of the split has to pass unchanged.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const facade = await import('../js/ui.js');
const { UI, isDesktopCard } = facade;
const { DesktopManager } = await import('../js/desktopManager.js');

const EXPORTS = [
    'ACTION_ICONS', 'CARD_ICONS', 'DRAWING_ICONS', 'FORMAT_ICONS', 'UI',
    'createNoteId', 'defaultStartDateTimeNow', 'deriveNoteTitle',
    'formatLocalDateTimeParts', 'isDesktopCard', 'normalizeItemForSave',
    'noteHasSavableContent'
];

// Function.length of every board method, captured at 1894 lines.
const ARITY = {
    applyCanvasClasses: 2, applyCollapsedTileClasses: 2, applyDesktopLayoutModeSwitch: 1, applyDesktopSize: 1,
    applyFileCabinetZoneToggle: 2, applyFreeformDimensions: 3, applyGridBoardLayout: 2, applyNoteRect: 2,
    applySpatialToggleRect: 3, applyTileTierRect: 4, applyTileZoneToggle: 2, bindBoardEditorFocusChrome: 1,
    buildCardActionsHtml: 1, clampGridResize: 2, clampNoteToBoardEdges: 2, clearFreeformCustomSize: 1,
    clearGridLayoutPreview: 1, clearSnapPanelPreview: 1, collapseBoardCardIfExpanded: 2,
    collapseBoardCardToSmallFootprint: 2, collapseSnapPanelCard: 2, collapseSpatialAtCurrentPos: 2,
    commitSpatialRect: 3, computeGridBoardLayout: 2, convertDesktopLayoutForModeChange: 4, ensureDesktopBoardPane: 1,
    finalizeDesktopCard: 1, finalizeRender: 3, findDesktopCenterSlot: 4, flushAllInlineEditsFromCanvas: 2,
    flushLayoutFromCanvas: 2, focusPendingBoardField: 1, getActiveBoardViewMode: 0, getActiveCategories: 1,
    getBoardPins: 0, getCardActionsOptions: 1, getCardTileSize: 1, getCollapsedCategories: 0, getDesktopBoardPane: 1,
    getFreeformPositions: 0, getFreeformSizes: 0, getGridBoardBounds: 1, getGridLayout: 0, getGridPins: 0,
    getLiveBoardBounds: 1, getSavedLayoutRect: 2, getViewState: 0, gridBoardRectForCard: 3, gridTileRect: 3,
    initDesktopCardStack: 1, isBoardPinned: 1, isCardActivelyResizing: 1, isCategoryCollapsed: 1, isGridBoardCard: 1,
    isGridMultiCellSize: 2, isGridPinned: 1, isItemLayoutExpanded: 2, isSavedLayoutExpanded: 1,
    isSpatiallyCollapsed: 1, layoutBoard: 3, markNoteCollapsed: 1, mergeSpatialLayoutEntry: 2,
    migrateFreeformLayoutToGrid: 1, packBoardGridRects: 2, packGridBoard: 3, packSortGridBoard: 5,
    partitionCanvasItemsByExpansion: 2, persistRememberedSpatialSize: 3, persistViewSessionForMode: 1,
    prepareBoardItems: 4, prepareCanvas: 1, preserveSavedBoardRect: 1, raiseDesktopCard: 1, readFreeformCardSize: 1,
    readNoteRect: 1, reapplyBoardMetricsOnBoard: 2, reapplySmallFootprintOnBoard: 0, reflowGridBoard: 2,
    removeGridLayout: 1, render: 3, renderCards: 5, renderEmptyState: 4, repackBoardLayoutStorage: 3,
    resetBoardLayout: 2, resolveAlignedExpandedSize: 2, resolveBoardExpandPlacement: 2, resolveBoardExpandRect: 2,
    resolveBoardItem: 1, resolveCardRect: 2, resolveFreeformSourceRect: 2, resolveRememberedSpatialSize: 2,
    resolveSortItemSize: 3, restoreViewSessionForMode: 1, saveCompactBoardLayout: 3, saveFiledCabinetLayout: 3,
    saveFreeformPosition: 3, saveFreeformSize: 3, saveFreeformSizeFromCard: 1, saveGridLayout: 2,
    saveSpatialLayoutFromResize: 3, saveTileLayoutFromCard: 4, scheduleBoardCanvasExtents: 1, setupFreeformChrome: 1,
    snapNotePosition: 2, snapNoteRect: 2, sortBoardLayout: 3, syncBoardPinClass: 1, syncCalendarButtonUI: 2,
    syncCardDraggable: 1, syncSpatialChromeForEditing: 1, syncSpatialCollapseState: 4, syncSpatialToggleButton: 2,
    toggleBoardPin: 1, toggleCategoryCollapsed: 1, toggleGridPin: 1, updateBoardCanvasExtents: 1,
    updateBoardItemsMap: 1, updateDesktopCard: 2, updateDesktopScrollPolicy: 1, updateGridScrollPolicy: 1,
    updateSingleCard: 2,
};

describe('ui facade · public surface', () => {
    it('exports the same twelve names', () => {
        assert.deepEqual(Object.keys(facade).sort(), EXPORTS);
    });

    it('keeps every board method on UI', () => {
        assert.deepEqual(Object.keys(UI).sort(), Object.keys(ARITY).sort());
        assert.equal(Object.keys(UI).length, 121);
    });

    it('keeps every method callable with the same number of leading arguments', () => {
        for (const [name, length] of Object.entries(ARITY)) {
            assert.equal(typeof UI[name], 'function', `${name} is no longer a function`);
            assert.equal(UI[name].length, length, `${name} changed arity - a default moved or the receiver leaked into the signature`);
        }
    });

    it('keeps the state-backed view helpers answering without a canvas', () => {
        const map = new Map();
        globalThis.localStorage = {
            getItem: (k) => (map.has(k) ? map.get(k) : null),
            setItem: (k, v) => map.set(k, String(v)),
            removeItem: (k) => map.delete(k)
        };

        assert.equal(typeof UI.getActiveBoardViewMode(), 'string');
        assert.deepEqual(Object.keys(UI.getViewState()).sort(), ['activeBoardViewMode', 'fileCabinetActive', 'resolvedMode', 'snapLayout']);
        delete globalThis.localStorage;
    });
});

describe('ui facade · structure after the split', () => {
    const fs = createRequire(import.meta.url);
    const { parse } = fs('acorn');
    const { readFileSync } = fs('node:fs');

    const source = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
    const uiObject = ast.body
        .filter((node) => node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration')
        .map((node) => node.declaration.declarations[0])
        .find((decl) => decl.id.name === 'UI').init;
    const properties = uiObject.properties.filter((p) => p.type === 'Property');
    const bodyOf = (name) => properties.find((p) => p.key.name === name).value.body.body;

    it('is a facade of one-statement delegates, not a home for bodies', () => {
        const offenders = properties
            .filter((p) => p.value.body.body.length !== 1 || p.value.body.body[0].type !== 'ReturnStatement')
            .map((p) => p.key.name);

        assert.deepEqual(offenders, [], 'a method body drifted back into the facade');
    });

    it('hands every delegate its receiver as the first argument', () => {
        for (const property of properties) {
            const name = property.key.name;
            if (name === 'getActiveBoardViewMode' || name === 'updateBoardItemsMap') continue;
            const [call] = [bodyOf(name)[0].argument];

            assert.equal(call.type, 'CallExpression', `${name} is not a call`);
            assert.equal(call.arguments[0]?.type, 'ThisExpression', `${name} does not pass the receiver`);
        }
    });

    it('keeps the two state methods reading the shared seam', () => {
        assert.equal(bodyOf('getActiveBoardViewMode')[0].argument.type, 'CallExpression');
        assert.match(source, /getActiveBoardViewMode\(\) \{\n\s+return readActiveBoardViewMode\(\);/);
        assert.match(source, /updateBoardItemsMap\(item\) \{\n\s+return Spatial\.updateBoardItemsMap\(item\);/);
    });

    it('declares no module-level state of its own', () => {
        const stateful = ast.body.filter((node) => node.type === 'VariableDeclaration' && node.kind !== 'const');
        const rawState = ast.body.filter((node) => node.type === 'VariableDeclaration'
            && node.declarations.some((decl) => decl.init?.type === 'NewExpression' || decl.init?.type === 'ObjectExpression'));

        assert.deepEqual(stateful, [], 'a `let` came back to the facade - state belongs in ui/boardState.js');
        assert.deepEqual(rawState, [], 'the facade declares a value that should live in a session module');
    });
});

describe('ui sessions · import graph', () => {
    const fs = createRequire(import.meta.url);
    const { parse } = fs('acorn');
    const { readFileSync, readdirSync } = fs('node:fs');

    const dir = new URL('../js/ui/', import.meta.url);
    const modules = readdirSync(dir).filter((name) => name.endsWith('.js'));

    /** Leaf modules: pure state or pure arithmetic, importable by any session. */
    const LEAVES = new Set(['boardState.js']);
    /** The only allowed edge between two session modules, and why. */
    const SIBLING_EDGES = new Set(['spatial.js -> gridPack.js']);

    it('never imports the facade (no cycles) and only uses the one allowed sibling edge', () => {
        const offenders = [];
        const edges = [];

        for (const name of modules) {
            const source = readFileSync(new URL(name, dir), 'utf8');
            const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
            for (const node of ast.body) {
                if (node.type !== 'ImportDeclaration') continue;
                const from = node.source.value;
                if (from === '../ui.js') offenders.push(`${name} imports the facade`);
                if (!from.startsWith('./')) continue;
                const target = from.replace('./', '');
                if (!modules.includes(target) || LEAVES.has(target)) continue;
                edges.push(`${name} -> ${target}`);
            }
        }

        assert.deepEqual(offenders, [], 'a session imported the facade, which makes a load-order cycle');
        assert.deepEqual(edges.filter((edge) => !SIBLING_EDGES.has(edge)), [],
            'a session grew an import of another session - route the call through UI instead');
    });

    it('leaves state ownership to boardState.js alone', () => {
        const owners = modules.filter((name) => {
            const source = readFileSync(new URL(name, dir), 'utf8');
            const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
            return ast.body.some((node) => node.type === 'VariableDeclaration' && node.kind !== 'const');
        });

        assert.deepEqual(owners, ['boardState.js']);
    });
});

describe('ui facade · isDesktopCard', () => {
    it('compares the card desktop with the active desktop', () => {
        const active = DesktopManager.getActiveDesktop();

        assert.equal(isDesktopCard({ dataset: { desktop: String(active) } }), true);
        assert.equal(isDesktopCard({ dataset: { desktop: String(Number(active) + 1) } }), false);
        assert.equal(isDesktopCard({}), false);
        assert.equal(isDesktopCard(null), false);
    });
});

describe('ui sessions · wrappers', () => {
    const fs = createRequire(import.meta.url);
    const { parse } = fs('acorn');
    const { readFileSync, readdirSync } = fs('node:fs');

    const dir = new URL('../js/ui/', import.meta.url);
    const modules = readdirSync(dir).filter((name) => name.endsWith('.js'));
    const parseModule = (name) => parse(readFileSync(new URL(name, dir), 'utf8'), {
        ecmaVersion: 'latest',
        sourceType: 'module'
    });

    function declaredFunctions(ast) {
        return ast.body
            .map((node) => node.declaration || node)
            .filter((node) => node.type === 'FunctionDeclaration' && node.id)
            .map((node) => node.id.name);
    }

    function importedLocals(ast) {
        return ast.body
            .filter((node) => node.type === 'ImportDeclaration')
            .flatMap((node) => node.specifiers.map((spec) => spec.local.name));
    }

    function selfCalls(decl) {
        const hits = [];
        const walk = (node) => {
            if (!node || typeof node !== 'object') return;
            if (Array.isArray(node)) {
                node.forEach(walk);
                return;
            }
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === decl.id.name) {
                hits.push(decl.id.name);
            }
            for (const key of Object.keys(node)) {
                if (key === 'type' || key === 'start' || key === 'end') continue;
                walk(node[key]);
            }
        };
        walk(decl.body);
        return hits;
    }

    it('never declares a function under the name of a module it imports from', () => {
        const offenders = [];
        for (const name of modules) {
            const ast = parseModule(name);
            const imported = new Set(importedLocals(ast));
            for (const fn of declaredFunctions(ast)) {
                if (imported.has(fn)) offenders.push(`${name}: ${fn}`);
            }
        }

        assert.deepEqual(offenders, [],
            'an import needs an alias (`x as xCore`) when the session exports a function of that name');
    });

    it('never calls itself - a moved wrapper must forward to the aliased import', () => {
        const offenders = [];
        for (const name of modules) {
            for (const node of parseModule(name).body) {
                const decl = node.declaration || node;
                if (decl.type !== 'FunctionDeclaration' || !decl.id) continue;
                if (selfCalls(decl).length) offenders.push(`${name}: ${decl.id.name}`);
            }
        }

        assert.deepEqual(offenders, [],
            'the method used to resolve that name to the import; inside a module of the same name it recurses');
    });
});
