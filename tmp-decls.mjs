import { readFileSync } from 'node:fs';
import * as acorn from 'acorn';

const src = readFileSync(process.argv[2], 'utf8');
const ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
for (const node of ast.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (!decl) continue;
    const kind = decl.type;
    let name = '';
    if (kind === 'FunctionDeclaration') name = decl.id.name;
    else if (kind === 'VariableDeclaration') name = decl.declarations.map((d) => d.id.name).join(',');
    console.log(`${decl.loc.start.line.toString().padStart(4)}-${decl.loc.end.line.toString().padStart(4)}  ${(node.type === 'ExportNamedDeclaration' ? 'EXP ' : '    ')}${kind.padEnd(22)} ${name}`);
}
