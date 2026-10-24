// test/moduleGraph.test.js
// Guards the whole ES-module graph against the failure that made the site show
// "Loading workspace…" forever: a module importing a name its target no longer
// (or never) exports. Browsers treat that as a link-time SyntaxError, so app.js
// never evaluates, #app-boot is never removed, and nothing is logged as a
// recoverable error.
//
// The check runs in a child process because vm.SourceTextModule needs
// --experimental-vm-modules; nothing is evaluated, only linked.
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHECKER = path.join(ROOT, 'scripts', 'check-module-graph.mjs');

// The check spawns a child process, so link once and share the output.
let linkedGraph = null;

function linkGraph() {
    if (linkedGraph === null) {
        linkedGraph = execFileSync(
            process.execPath,
            ['--experimental-vm-modules', '--no-warnings', CHECKER],
            { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }
        );
    }
    return linkedGraph;
}

describe('module graph · link check', () => {
    it('every named import resolves to a real export', () => {
        let output = '';
        try {
            output = linkGraph();
        } catch (error) {
            assert.fail(`module graph fails to link:\n${error.stdout || ''}${error.stderr || ''}`);
        }
        assert.match(output, /modules link cleanly/);
    });

    it('covers the boot entry point and the detach chain', () => {
        const output = linkGraph();
        const count = Number(output.match(/(\d+) modules link cleanly/)?.[1] ?? 0);
        assert.ok(count > 100, `expected the full graph to be linked, saw ${count} modules`);
    });
});
