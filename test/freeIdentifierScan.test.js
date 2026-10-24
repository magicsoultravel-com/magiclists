// test/freeIdentifierScan.test.js
// Regression guard: every identifier used in js/**/*.js must resolve to an
// import, a module-local declaration, a parameter, or a known browser/node
// global. The scan is recursive, so extracted modules in feature sub-folders
// (js/board, js/storage, js/radioVisualizer, …) get the same protection as the
// flat entry files.
// Catches the "extraction dropped the import" bug class (e.g. isDragShape,
// createId, showAppToast, RESIZE_HANDLE_*, grow, buildNotesExportPayload).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parse } = require('acorn');

const BROWSER = [
    'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'history', 'location',
    'confirm', 'prompt', 'alert', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame',
    'requestIdleCallback', 'cancelIdleCallback', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver',
    'Image', 'Audio', 'Video', 'FileReader', 'createImageBitmap', 'fetch', 'CustomEvent', 'Event',
    'KeyboardEvent', 'MouseEvent', 'PointerEvent', 'ClipboardItem', 'Blob', 'File', 'URL', 'URLSearchParams',
    'DOMParser', 'ImageData', 'console', 'structuredClone', 'performance', 'crypto', 'queueMicrotask',
    'FormData', 'XMLHttpRequest', 'AbortController', 'AbortSignal', 'Notification', 'matchMedia',
    'devicePixelRatio', 'DragEvent', 'DataTransfer', 'Node', 'Element', 'HTMLElement',
    'CanvasRenderingContext2D', 'screen', 'scrollTo', 'open', 'close', 'stop', 'print',
    'isSecureContext', 'CSS', 'MathJax', 'postMessage', 'HTMLMediaElement', 'HTMLVideoElement', 'NodeFilter',
    'indexedDB', 'SpeechSynthesisUtterance'
];
// Vendor globals injected at runtime by `script.src = …` from js/tools/*, so
// they are never imported. Keep this list to libraries the app actually loads.
const VENDOR = [
    'THREE', // js/tools/globe.js — cdnjs three.js r128
    'L',     // js/tools/map.js — jsdelivr leaflet 1.9.4
    'd3',    // js/tools/globe-tz.js — d3js.org d3 v7
    'topojson' // js/tools/globe-tz.js — unpkg topojson@3
];
const KNOWN = new Set([...Object.getOwnPropertyNames(globalThis), ...BROWSER, ...VENDOR, 'undefined', 'NaN', 'Infinity', 'globalThis', 'arguments']);

/** Recursively list module paths under `dir`, relative to it (POSIX separators). */
function listModules(dir, rel = '') {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        const nextRel = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...listModules(`${dir}/${entry.name}`, nextRel));
        else if (entry.name.endsWith('.js')) out.push(nextRel);
    }
    return out;
}

function analyze(src) {
    let ast;
    try {
        ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
    } catch (e) {
        return { parseError: e.message };
    }
    const unresolved = new Set();
    const scopes = [new Set()];
    function pat(s, id) {
        if (!id) return;
        if (id.type === 'Identifier') s.add(id.name);
        else if (id.type === 'ObjectPattern') for (const p of id.properties) {
            if (p.type === 'Property' && p.value.type === 'Identifier') s.add(p.value.name);
            else if (p.type === 'Property' && p.value.type === 'AssignmentPattern' && p.value.left?.type === 'Identifier') s.add(p.value.left.name);
            else if (p.type === 'RestElement' && p.argument.type === 'Identifier') s.add(p.argument.name);
        } else if (id.type === 'ArrayPattern') for (const el of id.elements) pat(s, el);
        else if (id.type === 'AssignmentPattern') pat(s, id.left);
        else if (id.type === 'RestElement') pat(s, id.argument);
    }
    function vars(s, ds) { for (const d of ds) pat(s, d.id); }
    for (const stmt of ast.body) {
        let s = stmt;
        if (s.type === 'ExportNamedDeclaration' || s.type === 'ExportDefaultDeclaration') s = s.declaration;
        if (!s) continue;
        if (s.type === 'ImportDeclaration') for (const sp of s.specifiers) scopes[0].add(sp.local.name);
        else if (s.type === 'VariableDeclaration') vars(scopes[0], s.declarations);
        else if (s.type === 'FunctionDeclaration' && s.id) scopes[0].add(s.id.name);
        else if (s.type === 'ClassDeclaration' && s.id) scopes[0].add(s.id.name);
    }
    const look = (nm) => KNOWN.has(nm) || scopes.some((x) => x.has(nm));
    function enterFn(fn) {
        scopes.push(new Set());
        const s = scopes[scopes.length - 1];
        for (const p of fn.params) pat(s, p);
        if (fn.body.type === 'BlockStatement') {
            for (const st of fn.body.body) {
                if (st.type === 'FunctionDeclaration' && st.id) s.add(st.id.name);
                if (st.type === 'ClassDeclaration' && st.id) s.add(st.id.name);
                if (st.type === 'VariableDeclaration') vars(s, st.declarations);
            }
        }
        walk(fn.body);
        scopes.pop();
    }
    function walk(node) {
        if (!node || typeof node.type !== 'string') return;
        switch (node.type) {
            case 'ExportNamedDeclaration': case 'ExportDefaultDeclaration':
                if (node.declaration) walk(node.declaration); return;
            case 'ImportDeclaration': return;
            case 'FunctionDeclaration': if (node.id) scopes[scopes.length - 1].add(node.id.name); enterFn(node); return;
            case 'FunctionExpression': case 'ArrowFunctionExpression': enterFn(node); return;
            case 'ClassDeclaration': if (node.id) scopes[scopes.length - 1].add(node.id.name); walk(node.body); return;
            case 'ClassBody': for (const m of node.body) {
                if (m.type === 'MethodDefinition') { if (m.computed) walk(m.key); if (m.value) enterFn(m.value); } else walk(m);
            } return;
            case 'Property': if (node.computed) walk(node.key); if (node.value) walk(node.value); return;
            case 'MethodDefinition': if (node.computed) walk(node.key); if (node.value) walk(node.value); return;
            case 'MemberExpression': walk(node.object); if (node.computed) walk(node.property); return;
            case 'CallExpression': case 'NewExpression': walk(node.callee); for (const a of node.arguments) walk(a); return;
            case 'Identifier': if (!look(node.name)) unresolved.add(node.name); return;
            case 'VariableDeclaration':
                for (const d of node.declarations) pat(scopes[scopes.length - 1], d.id);
                for (const d of node.declarations) if (d.init) walk(d.init);
                return;
            case 'BlockStatement':
                scopes.push(new Set());
                for (const st of node.body) {
                    if (st.type === 'FunctionDeclaration' && st.id) scopes[scopes.length - 1].add(st.id.name);
                    if (st.type === 'ClassDeclaration' && st.id) scopes[scopes.length - 1].add(st.id.name);
                }
                for (const st of node.body) walk(st);
                scopes.pop();
                return;
            case 'CatchClause': scopes.push(new Set()); pat(scopes[scopes.length - 1], node.param); walk(node.body); scopes.pop(); return;
            case 'ObjectExpression': for (const p of node.properties) walk(p); return;
            case 'ArrayExpression': for (const el of node.elements) walk(el); return;
            case 'WithStatement': walk(node.object); walk(node.body); return;
            case 'LabeledStatement': walk(node.body); return;
            case 'Literal': case 'ThisExpression': case 'Super': case 'TemplateLiteral':
            case 'EmptyStatement': case 'BreakStatement': case 'ContinueStatement':
            case 'DebuggerStatement': case 'MetaProperty': return;
            case 'TryStatement': walk(node.block); walk(node.handler); walk(node.finalizer); return;
            default:
                for (const k of Object.keys(node)) {
                    if (k === 'loc' || k === 'start' || k === 'end' || k === 'range' || k === 'type') continue;
                    const v = node[k];
                    if (Array.isArray(v)) v.forEach(walk);
                    else if (v && typeof v.type === 'string') walk(v);
                }
        }
    }
    walk(ast);
    return { unresolved };
}

describe('free identifier scan across js modules', () => {
    it('every used identifier resolves (imports, locals, params, globals)', () => {
        const failures = [];
        for (const f of listModules('js').sort()) {
            const r = analyze(readFileSync(`js/${f}`, 'utf8'));
            if (r.parseError) failures.push(`${f}: PARSE ERROR ${r.parseError}`);
            if (r.unresolved?.size) failures.push(`${f}: unresolved -> ${[...r.unresolved].sort().join(', ')}`);
        }
        assert.deepEqual(failures, [], 'missing import / undefined identifier in js modules:\n' + failures.join('\n'));
    });
});
