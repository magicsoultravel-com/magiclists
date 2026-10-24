import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const file = process.argv[2];
const src = readFileSync(file, 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
const unwrap = (n) => (n.type === 'ExportNamedDeclaration' ? n.declaration : n);

const obj = ast.body.map(unwrap).find((n) => n && n.type === 'VariableDeclaration'
    && n.declarations[0].init?.type === 'ObjectExpression'
    && ['MagicFocus', 'Focus'].includes(n.declarations[0].id.name));
const members = obj.declarations[0].init.properties.map((p) => ({
    name: p.key.name,
    node: p,
    isFn: p.value.type === 'FunctionExpression' || p.method
}));
const fnNames = new Set(members.filter((m) => m.isFn).map((m) => m.name));

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
for (const m of members) {
    const refs = new Set();
    walk(m.node.value, (n) => {
        if (n.type === 'MemberExpression' && !n.computed
            && n.object.type === 'ThisExpression' && fnNames.has(n.property.name)
            && n.property.name !== m.name) refs.add(n.property.name);
    });
    const lines = m.node.loc.end.line - m.node.loc.start.line + 1;
    total += lines;
    console.log(`${String(lines).padStart(4)}  ${m.node.loc.start.line.toString().padStart(4)}  ${m.isFn ? 'fn' : 'val'}  ${m.name.padEnd(28)} -> ${[...refs].join(', ')}`);
}
console.log(`--- ${members.length} members (${fnNames.size} functions), ${total} lines`);
