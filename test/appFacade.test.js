// test/appFacade.test.js
// Boundary freeze for js/app.js, taken before it is split into js/app/*.
//
// js/app.js owns boot: one class, 61 methods and no exports at all - index.html
// and popout.html load it for the side effect of `new Application()`. Nothing
// can import it in a test, so this suite pins the facade statically: the member
// list, every Function.length, which members are async, and the rule that every
// method except init() is a one-line (this, ...) -> (app, ...) delegate.
//
// Two traps this suite exists to catch, both seen in the ui/ split:
//   * a delegate that recurses, because the session exports a function with the
//     same name as an import it needs (`import { x as xCore }` is the fix);
//   * a blind `this` -> `app` rewrite. setupUndo's guarded history reads
//     this.undoStack off UndoManager, not off the Application, so `this` inside
//     a plain function body must survive verbatim.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('acorn');
const { readFileSync, readdirSync } = require('node:fs');

const FACADE = new URL('../js/app.js', import.meta.url);
const SESSION_DIR = new URL('../js/app/', import.meta.url);

// Function.length and async-ness of every Application member, captured at 2094
// lines (fba2723, the CRLF normalisation commit) - before a single body moved.
const ARITY = {
    constructor: 0, init: 0, setupUndo: 0, setupNotePopoutBridge: 0, handleClaimsStorageSync: 0,
    handlePopoutClaimChanged: 1, refreshPopoutLockedCards: 0, refreshPopoutLockedCard: 1,
    handlePopoutNoteSaved: 2, setupCrossTabSync: 0, refreshBoardFromSync: 2,
    resolveStaleBoardFlushSkipIds: 0, flushPendingNoteHostsForLifecycle: 0, isUserBusyOnCard: 1,
    refreshSidebarAfterSync: 0, applyVisualFromSync: 1, removeItemFromWorkspace: 1, restoreItem: 1,
    refreshPlannerHostsAfterRestore: 1, checkAuthSession: 0, logRepairDiagnostics: 0,
    loadCategoriesStore: 0, applyPendingCategoryAliases: 0, syncDataStore: 0, _syncDataStoreInner: 0,
    updateWorkspaceCounter: 0, renderControlBar: 0, renderQuickActions: 0,
    setupQuickActionsHeaderListeners: 0, renderQuickActionsHeaderIcons: 0, updateFabVisibility: 0,
    onMagicFocusEnter: 0, applyDesktopDockAfterFocusEnter: 0, applyDesktopDockAfterFocusLeave: 0,
    onMagicFocusLeave: 0, exitDrawingForFocus: 0, isDrawingMode: 0, stateWorkspaceMode: 0,
    setupScribbleFab: 0, setupDrawingMode: 0, switchWorkspaceMode: 1, applyWorkspaceMode: 1,
    enterNoteCanvasMode: 1, enterFlowchartMode: 1, exitNoteCanvasMode: 1, executeDataBackupExport: 0,
    executeFullBackupExport: 0, executeExportAllTxt: 0, setupBackupInterface: 0, executeAddCategory: 0,
    executeAddCategoryPrompt: 0, executeLoginPrompt: 0, executeLogout: 0,
    migrateBoardOverlayFromFreeform: 0, toggleBoardOverlay: 0, toggleFileCabinet: 0,
    updateViewToggleState: 0, updateDesktopZoomVisibility: 0, setupLayoutResetButton: 0,
    setupSearchBar: 0, updateLayoutResetVisibility: 0, setupCoreListeners: 0
};

const ASYNC = [
    'init', 'refreshBoardFromSync', 'removeItemFromWorkspace', 'restoreItem', 'refreshPlannerHostsAfterRestore',
    'syncDataStore', '_syncDataStoreInner', 'onMagicFocusLeave', 'exitDrawingForFocus', 'switchWorkspaceMode',
    'applyWorkspaceMode', 'enterNoteCanvasMode', 'enterFlowchartMode', 'exitNoteCanvasMode',
    'executeDataBackupExport', 'executeFullBackupExport', 'toggleBoardOverlay', 'toggleFileCabinet'
];

/** Members that are hand-written orchestration, not delegates. */
const NOT_DELEGATES = new Set(['constructor', 'init']);

/** One-line readers of the shared state seam - no session needed, like ui's getActiveBoardViewMode. */
const STATE_SEAMS = new Set(['isDrawingMode', 'stateWorkspaceMode']);

// Ratchet: bodies still living in the facade while the split lands, one slice
// per commit. Every entry here is a body the facade still owns - when a slice
// moves, this list must shrink in the same commit, and Commit 3 empties it.
const PENDING = new Set([
    'renderControlBar', 'renderQuickActions', 'renderQuickActionsHeaderIcons', 'updateFabVisibility',
    'onMagicFocusEnter', 'applyDesktopDockAfterFocusEnter', 'applyDesktopDockAfterFocusLeave', 'onMagicFocusLeave',
    'exitDrawingForFocus', 'switchWorkspaceMode', 'applyWorkspaceMode', 'enterNoteCanvasMode',
    'enterFlowchartMode', 'exitNoteCanvasMode', 'migrateBoardOverlayFromFreeform', 'toggleBoardOverlay',
    'toggleFileCabinet', 'updateViewToggleState', 'updateDesktopZoomVisibility', 'updateLayoutResetVisibility'
]);

const facadeSource = readFileSync(FACADE, 'utf8');
const facadeAst = parse(facadeSource, { ecmaVersion: 'latest', sourceType: 'module' });
const appClass = facadeAst.body.map((node) => node.declaration || node).find((node) => node.type === 'ClassDeclaration');
const members = appClass.body.body.filter((node) => node.key);
const memberOf = (name) => members.find((node) => (node.key.name || node.key.value) === name);
const memberName = (node) => node.key.name || node.key.value;

function arityOf(fn) {
    let count = 0;
    for (const param of fn.params) {
        if (param.type === 'AssignmentPattern' || param.type === 'RestElement') break;
        count += 1;
    }
    return count;
}

function sessionFiles() {
    return readdirSync(SESSION_DIR).filter((name) => name.endsWith('.js'));
}

function parseSession(name) {
    return parse(readFileSync(new URL(name, SESSION_DIR), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
}

function walk(node, visit) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const child of node) walk(child, visit);
        return;
    }
    if (typeof node.type !== 'string') return;
    visit(node);
    for (const key of Object.keys(node)) {
        if (key === 'type' || key === 'start' || key === 'end') continue;
        walk(node[key], visit);
    }
}

describe('app facade · member surface', () => {
    it('keeps all 62 members on the Application class', () => {
        assert.deepEqual(members.map(memberName).sort(), Object.keys(ARITY).sort());
        assert.equal(members.length, 62);
    });

    it('keeps Function.length of every member - no receiver leaks into a signature', () => {
        for (const [name, length] of Object.entries(ARITY)) {
            const node = memberOf(name);

            assert.equal(typeof node, 'object', `${name} disappeared from Application`);
            assert.equal(arityOf(node.value), length, `${name} changed arity`);
        }
    });

    it('keeps the async members async', () => {
        const actual = members
            .filter((node) => node.kind !== 'constructor' && node.value.async)
            .map(memberName)
            .sort();

        assert.deepEqual(actual, [...ASYNC].sort(), 'a delegate lost its async keyword');
    });
});

describe('app facade · delegates', () => {
    it('is a facade of one-statement delegates, not a home for bodies', () => {
        const offenders = members
            .filter((node) => !NOT_DELEGATES.has(memberName(node)))
            .filter((node) => !STATE_SEAMS.has(memberName(node)))
            .filter((node) => !PENDING.has(memberName(node)))
            .filter((node) => node.value.body.body.length !== 1 || node.value.body.body[0].type !== 'ReturnStatement')
            .map(memberName);

        assert.deepEqual(offenders, [], 'a method body drifted back into the facade');
    });

    it('keeps the pending list honest - it may only shrink', () => {
        const stillBodies = members
            .filter((node) => node.value.body.body.length !== 1 || node.value.body.body[0].type !== 'ReturnStatement')
            .map(memberName)
            .filter((name) => !NOT_DELEGATES.has(name));

        assert.deepEqual([...PENDING].filter((name) => !stillBodies.includes(name)), [],
            'a member moved but its name is still on the pending list');
        assert.deepEqual(stillBodies.filter((name) => !PENDING.has(name)), [],
            'a member grew back into the facade without landing on the pending list');
    });

    it('hands every delegate the Application as the first argument', () => {
        for (const node of members) {
            const name = memberName(node);
            if (NOT_DELEGATES.has(name) || STATE_SEAMS.has(name) || PENDING.has(name)) continue;
            const [call] = [node.value.body.body[0].argument];

            assert.equal(call.type, 'CallExpression', `${name} is not a call`);
            assert.equal(call.callee.type, 'MemberExpression', `${name} does not call a session`);
            assert.equal(call.callee.property.name, name, `${name} forwards to a differently named function`);
            assert.equal(call.arguments[0]?.type, 'ThisExpression', `${name} does not pass the receiver`);
            assert.equal(call.arguments.length, node.value.params.length + 1,
                `${name} does not forward every parameter positionally`);
        }
    });

    it('keeps the two workspace-mode readers on the shared state seam', () => {
        for (const name of STATE_SEAMS) {
            const body = memberOf(name).value.body.body;
            let reads = false;

            assert.equal(body.length, 1, `${name} grew a body - it belongs in drawingMode.js`);
            assert.equal(body[0].type, 'ReturnStatement');
            walk(body[0].argument, (node) => {
                if (node.type === 'MemberExpression' && node.object.type === 'Identifier' && node.object.name === 'AppState') {
                    reads = true;
                }
            });
            assert.ok(reads, `${name} no longer reads AppState.workspaceMode`);
        }
    });

    it('leaves init() and the constructor as hand-written orchestration', () => {
        const init = memberOf('init');
        const constructor = memberOf('constructor');

        assert.ok(init.value.body.body.length > 1, 'init was turned into a delegate - boot order belongs to the facade');
        assert.equal(constructor.kind, 'constructor');
        assert.equal(constructor.value.body.body.length, 2, 'the constructor gained a statement');
        assert.equal(constructor.value.body.body[0].type, 'ExpressionStatement');
        assert.equal(constructor.value.body.body[0].expression.type, 'AssignmentExpression');
        assert.equal(constructor.value.params.length, 0);
    });

    it('declares no module-level state outside AppState', () => {
        const declarations = facadeAst.body
            .map((node) => node.declaration || node)
            .filter((node) => node.type === 'VariableDeclaration')
            .flatMap((node) => node.declarations.map((decl) => decl.id.name));

        assert.deepEqual(declarations, ['CoreApp'], 'state belongs in app/state.js');
    });
});

describe('app sessions · structure', () => {
    const sessions = sessionFiles();

    /** The only session-to-session edge allowed: everyone reads AppState. */
    const SHARED_STATE = 'state.js';

    it('never imports the facade, and never imports another session', () => {
        const offenders = [];

        assert.ok(sessions.includes(SHARED_STATE), 'app/state.js is missing');
        for (const name of sessions) {
            for (const node of parseSession(name).body) {
                if (node.type !== 'ImportDeclaration') continue;
                const from = node.source.value;
                if (from === '../app.js' || from === './app.js') offenders.push(`${name} imports the facade`);
                if (!from.startsWith('./') || from === './' + SHARED_STATE) continue;
                offenders.push(`${name} imports ${from} - route the call through the app receiver`);
            }
        }

        assert.deepEqual(offenders, [], 'a session grew an edge that makes a load-order cycle');
    });

    it('resolves every app.<name> to a real member', () => {
        const offenders = [];

        for (const name of sessions) {
            walk(parseSession(name), (node) => {
                if (node.type !== 'MemberExpression' || node.object.type !== 'Identifier' || node.object.name !== 'app') return;
                if (node.computed) {
                    offenders.push(`${name}: app[computed]`);
                    return;
                }
                const property = node.property.name;
                if (property.startsWith('_')) return; // constructor-owned instance field
                if (property in ARITY) return;
                offenders.push(`${name}: app.${property}`);
            });
        }

        assert.deepEqual([...new Set(offenders)].sort(), [], 'a session calls a method the facade does not expose');
    });

    it('keeps every dynamic import inside the session reachable from js/app/', () => {
        const offenders = [];

        for (const name of sessions) {
            const source = readFileSync(new URL(name, SESSION_DIR), 'utf8');
            for (const match of source.matchAll(/import\(\s*'(\.\/[^']+)'\s*\)/g)) {
                offenders.push(`${name}: ${match[1]}`);
            }
        }

        assert.deepEqual(offenders, [],
            'a moved body kept a js/-relative specifier - it must climb one level (../)');
    });

    it('exports nothing but functions, and each of them is a member', () => {
        const offenders = [];

        for (const name of sessions) {
            const ast = parseSession(name);
            for (const node of ast.body) {
                if (node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'FunctionDeclaration') {
                    if (!(node.declaration.id.name in ARITY)) offenders.push(`${name}: ${node.declaration.id.name}`);
                    continue;
                }
                if (node.type === 'ExportNamedDeclaration' && node.declaration) continue; // AppState
                if (node.type === 'ExportNamedDeclaration') offenders.push(`${name}: re-export`);
            }
        }

        assert.deepEqual(offenders, [], 'a session exports something the facade cannot reach');
    });
});

describe('app sessions · wrappers', () => {
    function importedLocals(ast) {
        return ast.body
            .filter((node) => node.type === 'ImportDeclaration')
            .flatMap((node) => node.specifiers.map((spec) => spec.local.name));
    }

    function declaredFunctions(ast) {
        return ast.body
            .map((node) => node.declaration || node)
            .filter((node) => node.type === 'FunctionDeclaration' && node.id)
            .map((node) => node.id.name);
    }

    function selfCalls(decl) {
        const hits = [];

        walk(decl.body, (node) => {
            if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === decl.id.name) {
                hits.push(decl.id.name);
            }
        });
        return hits;
    }

    it('never declares a function under the name of a module it imports from', () => {
        const offenders = [];
        for (const name of sessionFiles()) {
            const ast = parseSession(name);
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
        for (const name of sessionFiles()) {
            for (const node of parseSession(name).body) {
                const decl = node.declaration || node;
                if (decl.type !== 'FunctionDeclaration' || !decl.id) continue;
                if (selfCalls(decl).length) offenders.push(`${name}: ${decl.id.name}`);
            }
        }

        assert.deepEqual(offenders, [],
            'the method used to resolve that name to the import; inside a module of the same name it recurses');
    });
});
