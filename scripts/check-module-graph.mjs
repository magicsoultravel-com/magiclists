/**
 * Links the real ES-module graph with V8's own resolver and reports any import
 * that asks for a name its target module does not export.
 *
 * This is the exact failure that produced a permanently stuck boot screen: a
 * module imported `clampSidebarWidth` from `shellResize.js` while the browser
 * had the previous copy of that file cached, so the graph failed to link and
 * `app.js` never evaluated. Nothing catches that at runtime — the page simply
 * stays on #app-boot — so it has to be caught before shipping.
 *
 * Nothing is evaluated (link() only resolves and creates bindings), so modules
 * that touch `document`/`window` at import time are safe to inspect.
 *
 * `import('./x.js')` is resolved lazily by the engine, so link() never sees it;
 * every literal dynamic specifier is resolved separately below.
 *
 * Run: node --experimental-vm-modules scripts/check-module-graph.mjs
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath, pathToFileURL } from 'url';
import { parse } from 'acorn';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');
const SKIP_DIRS = new Set(['node_modules']);

if (typeof vm.SourceTextModule !== 'function') {
    console.error('[modules] vm.SourceTextModule is unavailable — re-run with --experimental-vm-modules');
    process.exit(2);
}

function listModules(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listModules(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

const context = vm.createContext({});
const cache = new Map();
const failures = [];

function getModule(fileUrl) {
    const key = fileUrl.href;
    if (cache.has(key)) return cache.get(key);
    const source = fs.readFileSync(fileURLToPath(fileUrl), 'utf8');
    const module = new vm.SourceTextModule(source, { identifier: key, context });
    cache.set(key, module);
    return module;
}

function link(specifier, referencingModule) {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        throw new Error(`bare specifier "${specifier}" is not supported`);
    }
    const resolved = new URL(specifier, referencingModule.identifier);
    if (!fs.existsSync(fileURLToPath(resolved))) {
        throw new Error(`cannot resolve "${specifier}" from ${relative(referencingModule.identifier)}`);
    }
    return getModule(resolved);
}

function relative(identifier) {
    return path.relative(ROOT, fileURLToPath(identifier)).split(path.sep).join('/');
}

const files = listModules(JS_DIR).sort();
for (const file of files) {
    const module = getModule(pathToFileURL(file));
    if (module.status !== 'unlinked') continue;
    try {
        await module.link(link);
    } catch (error) {
        failures.push({ file: relative(module.identifier), message: error.message });
    }
}

// V8 resolves `import('./x.js')` lazily, so module.link() never sees dynamic
// specifiers: a file that keeps a stale `import('./sibling.js')` after being
// moved into a sub-folder links cleanly and only fails at runtime (that is how
// js/drawingBoard/document.js broke its note-save sync). Resolve every literal
// dynamic specifier ourselves.
function dynamicSpecifiers(source) {
    const specs = [];
    const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', allowAwaitOutsideFunction: true });
    walk(ast, (node) => {
        if (node.type !== 'ImportExpression') return;
        const arg = node.source;
        if (arg && arg.type === 'Literal' && typeof arg.value === 'string') specs.push(arg.value);
    });
    return specs;
}

function walk(node, visit) {
    visit(node);
    for (const key of Object.keys(node)) {
        const value = node[key];
        if (Array.isArray(value)) {
            for (const child of value) {
                if (child && typeof child === 'object' && typeof child.type === 'string') walk(child, visit);
            }
        } else if (value && typeof value === 'object' && typeof value.type === 'string') {
            walk(value, visit);
        }
    }
}

let dynamicCount = 0;
for (const file of files) {
    const identifier = pathToFileURL(file).href;
    let specs;
    try {
        specs = dynamicSpecifiers(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        failures.push({ file: relative(identifier), message: `cannot scan dynamic imports: ${error.message}` });
        continue;
    }
    for (const specifier of specs) {
        dynamicCount += 1;
        if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
            failures.push({ file: relative(identifier), message: `dynamic import of bare specifier "${specifier}" is not supported` });
            continue;
        }
        const resolved = new URL(specifier, identifier);
        if (!fs.existsSync(fileURLToPath(resolved))) {
            failures.push({ file: relative(identifier), message: `cannot resolve dynamic import "${specifier}"` });
        }
    }
}

if (failures.length) {
    console.error(`[modules] ${failures.length} module(s) fail to link:`);
    for (const failure of failures) console.error(`  ${failure.file}\n    ${failure.message}`);
    process.exit(1);
}

console.log(`[modules] ${files.length} modules link cleanly (${dynamicCount} dynamic imports resolved)`);
