import { parse } from 'acorn';
import fs from 'node:fs';
const src = fs.readFileSync(process.argv[2], 'utf8');
const ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
const names = new Set();
for (const node of ast.body) {
    if (node.type === 'ExportNamedDeclaration') {
        if (node.declaration) {
            if (node.declaration.id) names.add(node.declaration.id.name);
            (node.declaration.declarations || []).forEach((d) => names.add(d.id.name));
        }
        (node.specifiers || []).forEach((s) => names.add((s.exported || s.local).name));
    }
    if (node.type === 'ExportAllDeclaration') names.add('*');
}
console.log([...names].sort().join('\n'));
