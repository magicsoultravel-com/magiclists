/**
 * Pre-commit hook — regenerates architecture map and tools registry when relevant
 * files are staged, then re-stages generated outputs.
 */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

function run(cmd) {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function stagedFiles() {
    try {
        return execSync('git diff --cached --name-only -z', { cwd: ROOT })
            .toString('utf8')
            .split('\0')
            .map((s) => s.trim())
            .filter(Boolean);
    } catch {
        return [];
    }
}

function stageIfExists(relPath) {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) return;
    execSync(`git add -- ${JSON.stringify(relPath)}`, { cwd: ROOT, stdio: 'inherit' });
}

const staged = stagedFiles();
if (!staged.length) process.exit(0);

const needsArchitecture = staged.some((f) =>
    f.startsWith('css/')
    || f === 'index.html'
    || (f.startsWith('js/') && f.endsWith('.js'))
    || f.startsWith('.cursor/rules/')
);

const needsTools = staged.some((f) =>
    f.startsWith('js/tools/') && f.endsWith('.js') && !f.endsWith('registry.js')
);

try {
    if (needsArchitecture) {
        run('node scripts/build-architecture-map.mjs');
        stageIfExists('.cursor/rules/magiclists-architecture.mdc');
    }
    if (needsTools) {
        run('node scripts/build-tools-list.mjs');
        stageIfExists('js/tools/registry.js');
        stageIfExists('api/tools-list.json');
        stageIfExists('api/code-manifest.json');
    }
} catch {
    console.error('[pre-commit] Generator failed — commit aborted.');
    process.exit(1);
}
