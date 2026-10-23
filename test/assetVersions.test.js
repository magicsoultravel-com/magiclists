// test/assetVersions.test.js
// Cache-busting contract for a static host (GitHub Pages: no header control,
// Cache-Control: max-age=600). Every local module/stylesheet URL must carry a
// content hash, and the inline import map must cover every module, otherwise a
// deploy can pair a new module with a stale cached one and the whole graph
// fails to link (app.js never evaluates → boot overlay forever).
//
// Run with: npm test  (node --test)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML_FILES = ['index.html', 'popout.html'];
const STAMPER = path.join(ROOT, 'scripts', 'build-asset-versions.mjs');

function readHtml(name) {
    return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function listModules(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) listModules(full, out);
        else if (entry.name.endsWith('.js')) out.push(full);
    }
    return out;
}

function hashOf(file) {
    return createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 8);
}

function importMapOf(html) {
    const match = html.match(/<script type="importmap" data-asset-versions>([\s\S]*?)<\/script>/);
    assert.ok(match, 'inline import map block is present');
    return JSON.parse(match[1]);
}

describe('asset versions · stamper output', () => {
    it('passes --check (committed HTML matches the current asset contents)', () => {
        try {
            execFileSync(process.execPath, [STAMPER, '--check'], { cwd: ROOT, stdio: 'pipe' });
        } catch (error) {
            assert.fail(`asset versions are stale — run: node scripts/build-asset-versions.mjs\n${error.stderr}`);
        }
    });

    it('is idempotent (running it twice changes nothing)', () => {
        const run = () => execFileSync(process.execPath, [STAMPER], { cwd: ROOT, stdio: 'pipe' });

        run();
        const first = HTML_FILES.map((name) => readHtml(name));
        run();
        const second = HTML_FILES.map((name) => readHtml(name));

        assert.deepEqual(second, first, 'a second stamp must be a no-op');
        assert.match(run().toString(), /up to date|stamped/);
    });

    for (const name of HTML_FILES) {
        it(`${name} maps every module to its own content hash`, () => {
            const imports = importMapOf(readHtml(name)).imports;
            const modules = listModules(path.join(ROOT, 'js'))
                .map((file) => path.relative(ROOT, file).split(path.sep).join('/'));

            assert.ok(modules.length > 0);
            for (const module of modules) {
                assert.equal(
                    imports[`./${module}`],
                    `./${module}?v=${hashOf(path.join(ROOT, module))}`,
                    `${module} needs a hash entry`
                );
            }
            assert.equal(Object.keys(imports).length, modules.length, 'no stale or duplicate entries');
        });

        it(`${name} declares the import map before any module script`, () => {
            const html = readHtml(name);
            const mapIndex = html.search(/<script type="importmap"/);
            const moduleIndex = html.search(/<script[^>]*type="module"/);
            assert.ok(mapIndex >= 0, 'import map exists');
            assert.ok(moduleIndex >= 0, 'module entry script exists');
            assert.ok(mapIndex < moduleIndex, 'import map must precede module scripts');
        });

        it(`${name} versions every local js/css reference (no dev_ counters left)`, () => {
            const html = readHtml(name);
            assert.doesNotMatch(html, /dev_\d+\.\d+\.\d+/, 'hand-bumped versions must be gone');

            const refs = [...html.matchAll(/(?:href|src)="(\.\/(?:js|css)\/[^"?]+\.(?:js|css))(?:\?v=([a-f0-9]{8}))?"/g)];
            assert.ok(refs.length > 0, 'local assets are referenced');
            for (const [, url, hash] of refs) {
                assert.ok(hash, `${url} must carry ?v=<content hash>`);
            }
        });
    }
});
