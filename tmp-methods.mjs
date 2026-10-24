import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const file = process.argv[2];
const src = readFileSync(file, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });

const cls = ast.body
    .map((n) => (n.type === 'ExportNamedDeclaration' ? n.declaration : n))
    .find((n) => n && n.type === 'ClassDeclaration');
const methods = cls.body.body.map((m) => ({
    name: m.key.name,
    kind: m.kind,
    node: m
}));
const names = new Set(methods.map((m) => m.name));

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
for (const m of methods) {
    const refs = new Set();
    walk(m.node, (n) => {
        if (n.type === 'MemberExpression' && !n.computed
            && n.object.type === 'ThisExpression' && names.has(n.property.name)
            && n.property.name !== m.name) refs.add(n.property.name);
    });
    // also count `this.X(` inside string templates is not a thing; skip
    const lines = m.node.loc.end.line - m.node.loc.start.line + 1;
    total += lines;
    console.log(`${String(lines).padStart(4)}  ${m.node.loc.start.line.toString().padStart(4)}  ${m.kind.padEnd(6)} ${m.name.padEnd(30)} -> ${[...refs].join(', ')}`);
}
console.log(`--- ${methods.length} members, ${total} lines`);
