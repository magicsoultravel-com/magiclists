// Prove a session extraction was verbatim: every exported function in the new
// module must match the object-literal method it came from, after only the two
// documented rewrites (de-indent 4, `this` -> `focus`).
import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const [, , oldPath, newPath] = process.argv;
const read = (p) => readFileSync(p, 'utf8');
const parse = (src) => acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

const oldSrc = read(oldPath);
const newSrc = read(newPath);
const oldAst = parse(oldSrc);
const newAst = parse(newSrc);
const oldLines = oldSrc.split('\n');
const newLines = newSrc.split('\n');

const unwrap = (n) => (n && n.type === 'ExportNamedDeclaration' ? n.declaration : n);
const obj = oldAst.body.map(unwrap).find((n) => n && n.type === 'VariableDeclaration'
    && n.declarations[0].id.name === 'MagicFocus').declarations[0].init;
const oldMethods = new Map(obj.properties.filter((p) => p.value.type === 'FunctionExpression')
    .map((p) => [p.key.name, p.value]));

const bodyText = (node, lines) => lines.slice(node.body.loc.start.line, node.body.loc.end.line - 1);

const normalize = (lines) => lines
    .map((l) => (l.startsWith('    ') ? l.slice(4) : l))
    .map((l) => l.replace(/\bthis\b/g, 'focus'))
    .filter((l) => l.trim() !== '')
    .join('\n');

const newFns = newAst.body.map(unwrap).filter((n) => n && n.type === 'FunctionDeclaration');
const names = process.argv[4] ? process.argv[4].split(',') : newFns.map((f) => f.id.name);

let bad = [];
for (const name of names) {
    const nf = newFns.find((f) => f.id.name === name);
    const om = oldMethods.get(name);
    if (!nf || !om) { bad.push(`${name} (missing)`); continue; }
    // old: method body -> de-indent 4, `this` -> `focus`; new: already in that shape
    const oldBody = oldLines.slice(om.body.loc.start.line, om.body.loc.end.line - 1)
        .map((l) => (l.startsWith('    ') ? l.slice(4) : l))
        .map((l) => l.replace(/\bthis\b/g, 'SELF'))
        .filter((l) => l.trim() !== '').join('\n');
    const newBody = newLines.slice(nf.body.loc.start.line, nf.body.loc.end.line - 1)
        .map((l) => l.replace(/\bmagicFocus\b/g, 'SELF'))
        .filter((l) => l.trim() !== '').join('\n');
    if (oldBody !== newBody) bad.push(name);
}
console.log(`${names.length - bad.length}/${names.length} identical`, bad.length ? `| MISMATCH: ${bad.join(', ')}` : '| zero mismatches');
process.exit(bad.length ? 1 : 0);
