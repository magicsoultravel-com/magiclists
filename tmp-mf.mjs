// Temporary extraction tool for the magicFocus split (deleted before the final commit).
// Moves object-literal methods / top-level functions / consts of js/magicFocus.js into
// a session module: de-indent, `this` -> `focus`, one-line delegate left behind.
import { readFileSync, writeFileSync } from 'node:fs';
import * as acorn from 'acorn';

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const facadePath = spec.facade || 'js/magicFocus.js';
const src = readFileSync(facadePath, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
const srcLines = src.split('\n');
const unwrap = (n) => (n && n.type === 'ExportNamedDeclaration' ? n.declaration : n);

const objDecl = ast.body.map(unwrap).find((n) => n && n.type === 'VariableDeclaration');
const magicFocus = ast.body.map(unwrap).find((n) => n && n.type === 'VariableDeclaration'
    && n.declarations[0].id.name === 'MagicFocus');
const obj = magicFocus.declarations[0].init;
const members = new Map(obj.properties.map((p) => [p.key.name, p]));

const span = (node) => ({ start: node.loc.start.line - 1, end: node.loc.end.line - 1 });
const textOf = (node) => srcLines.slice(span(node).start, span(node).end + 1);

// ---- parameter handling ------------------------------------------------------
function paramsOf(fnNode) {
    const params = fnNode.params;
    if (params.length === 0) return { decl: '', args: '' };
    if (params.length === 1 && params[0].type === 'AssignmentPattern'
        && params[0].left.type === 'ObjectPattern') {
        // `{ a = 1 } = {}` -> keep the default, name the binding
        const right = srcLines.slice(span(params[0].right).start, span(params[0].right).end + 1).join('\n');
        return { decl: `opts = ${right}`, args: 'opts' };
    }
    if (params.length === 1 && params[0].type === 'ObjectPattern') {
        return { decl: 'opts', args: 'opts' };
    }
    const decl = srcLines.slice(span(params[0]).start, span(params[params.length - 1]).end + 1).join('\n');
    const args = params.map((p) => (p.type === 'AssignmentPattern' || p.type === 'RestElement'
        ? src.slice(p.start, p.end).replace(/\s*=[\s\S]*$/, '')
        : p.type === 'Identifier' ? p.name : src.slice(p.start, p.end))).join(', ');
    return { decl, args };
}

// ---- build the session module -----------------------------------------------
const out = [spec.doc, ''];
if (spec.imports?.length) out.push(...spec.imports, '');

const movedNames = [];
for (const name of spec.consts || []) {
    const decl = ast.body.map(unwrap).find((n) => n && n.type === 'VariableDeclaration'
        && n.declarations.some((d) => d.id.name === name));
    const decls = decl.declarations.filter((d) => d.id.name === name);
    const node = decls[0];
    const startLine = decl.loc.start.line - 1;
    const endLine = decl.loc.end.line - 1;
    let chunk = srcLines.slice(startLine, endLine + 1);
    chunk = chunk.map((l, i) => (i === 0 ? l.replace(/^const /, 'export const ') : l));
    out.push(chunk.join('\n'), '');
    movedNames.push({ kind: 'const', name, startLine, endLine, node });
}

for (const name of spec.functions || []) {
    const node = ast.body.map((n) => n.declaration || n).find((n) => n && n.type === 'FunctionDeclaration' && n.id.name === name);
    const { start, end } = span(node);
    let chunk = srcLines.slice(start, end + 1);
    chunk[0] = chunk[0].replace(/^(async )?function /, (_m, a) => `export ${a || ''}function `);
    out.push(chunk.join('\n').replace(/import\(\'\\.\//g, "import('../"), '');
    movedNames.push({ kind: 'function', name, startLine: start, endLine: end, node });
}

const delegates = new Map();
for (const name of spec.methods || []) {
    const prop = members.get(name);
    if (!prop) throw new Error(`no method ${name}`);
    const { start, end } = span(prop);
    const isAsync = prop.value.async;
    const { decl, args } = paramsOf(prop.value);
    const bodyStart = prop.value.body.loc.start.line - 1;
    const bodyEnd = prop.value.body.loc.end.line - 1;
    const body = srcLines.slice(bodyStart + 1, bodyEnd).map((l) => {
        const deindented = l.startsWith('    ') ? l.slice(4) : l;
        return deindented.replace(/\bthis\b/g, 'focus');
    });
    const head = `export ${isAsync ? 'async ' : ''}function ${name}(${decl ? `focus, ${decl}` : 'focus'}) {`;
    out.push(head, ...body, '}', '');
    const sig = `(${decl})`;
    const callArgs = args ? `, ${args}` : '';
    delegates.set(name, `    ${isAsync ? 'async ' : ''}${name}${sig} { return ${spec.session}.${name}(this${callArgs}); },`);
    movedNames.push({ kind: 'method', name, startLine: start, endLine: end, prop });
}

writeFileSync(spec.target, out.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n'));

// ---- facade surgery: swap methods for delegates, drop moved decls -----------
const removeLines = new Set();
for (const m of movedNames) {
    if (m.kind === 'method') {
        for (let i = m.startLine; i <= m.endLine; i++) removeLines.add(i);
        // trailing comma lives on the closing line for methods
    } else {
        for (let i = m.startLine; i <= m.endLine; i++) removeLines.add(i);
    }
}
const replacements = new Map();
for (const m of movedNames) {
    if (m.kind === 'method') replacements.set(m.startLine, delegates.get(m.name));
}

const facadeOut = [];
for (let i = 0; i < srcLines.length; i++) {
    if (replacements.has(i)) {
        facadeOut.push(replacements.get(i));
        continue;
    }
    if (removeLines.has(i)) continue;
    facadeOut.push(srcLines[i]);
}
let text = facadeOut.join('\n').replace(/\n{3,}/g, '\n\n');
writeFileSync(facadePath, text);
console.log(JSON.stringify({ target: spec.target, methods: (spec.methods || []).length,
    consts: (spec.consts || []).length, functions: (spec.functions || []).length,
    facadeLines: text.split('\n').length }));
