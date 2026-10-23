import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALLER = path.join(ROOT, 'scripts', 'git-hooks', 'install.mjs');

function scratchHooksDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'magiclists-hooks-'));
    return path.join(dir, 'hooks');
}

function install(hooksDir, env = {}) {
    const result = spawnSync(process.execPath, [INSTALLER], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, MAGICLISTS_HOOKS_DIR: hooksDir, ...env }
    });
    assert.equal(result.status, 0, `installer exited ${result.status}: ${result.stderr}`);
    // The installer reports on stderr (it must never pollute hook stdout).
    return `${result.stdout}${result.stderr}`;
}

const hookPath = (dir) => path.join(dir, 'pre-commit');

describe('pre-commit hook installer', () => {
    it('installs an executable shim that runs the real hook', () => {
        const dir = scratchHooksDir();
        install(dir);

        const body = fs.readFileSync(hookPath(dir), 'utf8');
        assert.match(body, /^#!\/bin\/sh/);
        assert.match(body, /magiclists hook shim/);
        assert.match(body, /exec node scripts\/git-hooks\/pre-commit\.mjs/);
        // A non-executable hook is skipped by git without a word — that is how the
        // previous PowerShell-only hook ended up guarding nothing.
        assert.equal(fs.statSync(hookPath(dir)).mode & 0o111, 0o111);
    });

    it('is idempotent and reports no churn on re-run', () => {
        const dir = scratchHooksDir();
        install(dir);
        const first = fs.readFileSync(hookPath(dir), 'utf8');
        const secondRun = install(dir);

        assert.equal(fs.readFileSync(hookPath(dir), 'utf8'), first);
        assert.match(secondRun, /already current/);
        assert.equal(fs.statSync(hookPath(dir)).mode & 0o111, 0o111);
    });

    it('backs up a foreign hook instead of dropping it', () => {
        const dir = scratchHooksDir();
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(hookPath(dir), '#!/bin/sh\necho custom\n');

        const output = install(dir);
        const backups = fs.readdirSync(dir).filter((f) => f.startsWith('pre-commit.backup-'));

        assert.equal(backups.length, 1);
        assert.match(fs.readFileSync(path.join(dir, backups[0]), 'utf8'), /echo custom/);
        assert.match(fs.readFileSync(hookPath(dir), 'utf8'), /magiclists hook shim/);
        assert.match(output, /backed up/);
    });

    it('can be skipped with MAGICLISTS_SKIP_HOOKS=1', () => {
        const dir = scratchHooksDir();
        const output = install(dir, { MAGICLISTS_SKIP_HOOKS: '1' });

        assert.equal(fs.existsSync(hookPath(dir)), false);
        assert.match(output, /skipped/);
    });

    it('is wired into npm install and documented as a script', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

        assert.equal(pkg.scripts['hooks:install'], 'node scripts/git-hooks/install.mjs');
        assert.equal(pkg.scripts.prepare, 'node scripts/git-hooks/install.mjs');
    });
});
