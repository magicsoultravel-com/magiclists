// test/noUnusedImports.test.js
// Mirror image of freeIdentifierScan.test.js: that guard catches an extraction
// that *dropped* an import, this one catches an extraction that left the moved
// code's imports behind.
//
// Stale imports are not harmless here: the drawing-board facade kept 23 names
// it no longer touched (resolveNoteColor, HIGHLIGHTER_WIDTH, drawBrushStroke,
// the whole canvasImages drawing set, …) after five session modules had moved
// out, which made it look like the facade still owned rendering and image
// painting. Reading the imports was actively misleading.
//
// The same thing happened again on the board facade: after gridPack, boardState,
// spatial and render moved out, js/ui.js still imported 120 names it no longer
// touched - the whole tile geometry set, the cabinet renderer, the grid engine
// adapters - so the facade looked like it still owned the board.
//
// Scope is deliberately the families a session split has touched so far: the
// magicCanvas / drawing-board one and the board facade one. The rest of the tree
// still carries stale names of its own (js/noteSurface.js is the worst); widen
// this list as those files are touched, do not sweep them in one commit.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parse } = require('acorn');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS_DIR = path.join(ROOT, 'js');

/** Families covered by the session-module splits so far. */
const SCOPE_DIRS = ['drawingBoard', 'ui'];
const SCOPE_PREFIXES = ['drawingBoard', 'canvas', 'noteCanvas', 'flowchart'];
/** Single files a split touched without owning a directory. */
const SCOPE_FILES = ['ui.js'];

function inScope(rel) {
    if (SCOPE_FILES.includes(rel)) return true;
    if (SCOPE_DIRS.some((dir) => rel.startsWith(`${dir}/`))) return true;
    return SCOPE_PREFIXES.some((prefix) => rel.startsWith(prefix) && rel.endsWith('.js'));
}

function listModules(dir, rel = '') {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...listModules(path.join(dir, entry.name), nextRel));
        else if (entry.name.endsWith('.js')) out.push(nextRel);
    }
    return out;
}

function walk(node, visit, parent, key) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visit(node, parent, key);
    for (const name of Object.keys(node)) {
        if (name === 'type' || name === 'start' || name === 'end') continue;
        const value = node[name];
        if (Array.isArray(value)) {
            for (const child of value) walk(child, visit, node, name);
        } else if (value && typeof value === 'object') {
            walk(value, visit, node, name);
        }
    }
}

const IMPORT_SPECIFIERS = new Set(['ImportSpecifier', 'ImportDefaultSpecifier', 'ImportNamespaceSpecifier']);

/** Imported names that are never referenced as a value in the module body. */
function unusedImports(source) {
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
    const imported = new Map();
    const importNodes = new Set();
    for (const node of ast.body) {
        if (node.type !== 'ImportDeclaration') continue;
        importNodes.add(node);
        for (const specifier of node.specifiers) imported.set(specifier.local.name, node.source.value);
    }
    const referenced = new Set();
    walk(ast, (node, parent, key) => {
        if (node.type !== 'Identifier') return;
        if (IMPORT_SPECIFIERS.has(parent?.type)) return;
        if (importNodes.has(parent)) return;
        // `obj.NAME` and `{ NAME: 1 }` are not references to the binding.
        if (parent.type === 'MemberExpression' && key === 'property' && !parent.computed) return;
        if ((parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'MethodDefinition')
            && key === 'key' && !parent.computed && !parent.shorthand) return;
        if (parent.type === 'ExportSpecifier' && key === 'exported') return;
        referenced.add(node.name);
    });
    return [...imported.keys()].filter((name) => !referenced.has(name));
}

describe('drawing-board family · import hygiene', () => {
    it('no module imports a name it never uses', () => {
        const offenders = [];
        for (const rel of listModules(JS_DIR).filter(inScope)) {
            const source = readFileSync(path.join(JS_DIR, rel), 'utf8');
            const unused = unusedImports(source);
            if (unused.length) offenders.push(`js/${rel}: ${unused.join(', ')}`);
        }
        assert.deepEqual(offenders, [], `unused imports left behind by an extraction:\n${offenders.join('\n')}`);
    });

    it('covers the facade and the extracted session modules', () => {
        const covered = listModules(JS_DIR).filter(inScope);
        for (const expected of [
            'drawingBoard.js',
            'drawingBoard/geometry.js',
            'drawingBoard/prefs.js',
            'drawingBoard/history.js',
            'drawingBoard/input.js',
            'drawingBoard/view.js',
            'drawingBoard/document.js',
            'drawingBoard/lifecycle.js',
            'ui.js',
            'ui/boardState.js',
            'ui/gridPack.js',
            'ui/spatial.js',
            'ui/render.js'
        ]) {
            assert.ok(covered.includes(expected), `${expected} should be in the guarded set`);
        }
    });
});
