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

// Any module/stylesheet change invalidates the content hashes stamped into the
// HTML. Restamping here is what keeps a deploy from mixing a new module with a
// stale cached one (GitHub Pages sends Cache-Control: max-age=600).
const needsAssets = staged.some((f) =>
    (f.startsWith('js/') && f.endsWith('.js'))
    || (f.startsWith('css/') && f.endsWith('.css'))
    || f === 'index.html'
    || f === 'popout.html'
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
    if (needsAssets) {
        run('node scripts/build-asset-versions.mjs');
        stageIfExists('index.html');
        stageIfExists('popout.html');
    }
    if (needsAssets || needsArchitecture) {
        // A missing export breaks the whole module graph at link time — the app
        // never evaluates and the boot overlay stays up. Never commit that.
        run('node --experimental-vm-modules scripts/check-module-graph.mjs');
    }
} catch {
    console.error('[pre-commit] Generator/check failed — commit aborted.');
    process.exit(1);
}
