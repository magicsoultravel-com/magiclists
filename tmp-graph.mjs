import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const file = process.argv[2];
const src = readFileSync(file, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

const all = [];
for (const node of ast.body) {
    let decl = null;
    let exported = false;
    if (node.type === 'FunctionDeclaration' || node.type === 'VariableDeclaration') {
        decl = node;
    } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        decl = node.declaration;
        exported = true;
    }
    if (!decl) continue;
    if (decl.type === 'FunctionDeclaration') {
        all.push({ name: decl.id.name, node: decl, exported });
    } else if (decl.type === 'VariableDeclaration') {
        for (const d of decl.declarations) {
            if (d.id.type === 'Identifier') all.push({ name: d.id.name, node: d, exported });
        }
    }
}

const declNames = new Set(all.map((f) => f.name));
const walk = (n, cb) => {
    if (!n || typeof n.type !== 'string') return;
    cb(n);
    for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v)) v.forEach((x) => walk(x, cb));
        else if (v && typeof v.type === 'string') walk(v, cb);
    }
};

let total = 0;
for (const f of all) {
    const refs = new Set();
    walk(f.node, (n) => {
        if (n.type === 'Identifier' && declNames.has(n.name) && n.name !== f.name) refs.add(n.name);
    });
    const lines = f.node.loc.end.line - f.node.loc.start.line + 1;
    total += lines;
    console.log(`${String(lines).padStart(4)}  ${f.exported ? 'EXP' : '   '}  ${f.name.padEnd(38)} -> ${[...refs].join(', ')}`);
}
console.log(`--- ${all.length} decls, ${total} lines`);
