/**
 * Installs the pre-commit guard into .git/hooks.
 *
 * Why this exists: git silently skips a hook file that is not executable, so a
 * guard that "exists" in the repo can still never run. The previous hook was a
 * PowerShell-only shim (fine on Windows, inert elsewhere and non-executable),
 * so nothing protected the asset stamps or the module graph on Linux/macOS.
 *
 * The installed shim is deliberately tiny and sh-based: git runs hooks with its
 * own shell (including Git for Windows) and from the repository root, so one
 * portable shim replaces the .ps1/.mjs split. scripts/git-hooks/pre-commit.ps1
 * stays available for anyone who installs it by hand.
 *
 * Runs from `npm install` (prepare), so it must never fail an install: every
 * failure path warns and exits 0. Set MAGICLISTS_SKIP_HOOKS=1 to opt out.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', '..');

const MARKER = '# magiclists hook shim';
const HOOK_BODY = `#!/bin/sh
${MARKER} — installed by node scripts/git-hooks/install.mjs
# Guards: asset content hashes (stale-module boot hang) + module graph linking.
# Regenerate with: npm run hooks:install
if ! command -v node >/dev/null 2>&1; then
    echo "[pre-commit] node not found — skipping magiclists guards" >&2
    exit 0
fi
exec node scripts/git-hooks/pre-commit.mjs "$@"
`;

function hooksDir() {
    if (process.env.MAGICLISTS_HOOKS_DIR) {
        // Test seam: point the installer at a scratch directory.
        return path.resolve(ROOT, process.env.MAGICLISTS_HOOKS_DIR);
    }
    try {
        const dir = execFileSync('git', ['rev-parse', '--git-path', 'hooks'], {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (dir) return path.resolve(ROOT, dir);
    } catch {
        // not a git checkout (tarball, packaged install) — fall through
    }
    return path.join(ROOT, '.git', 'hooks');
}

function warn(message) {
    console.warn(`[hooks] ${message}`);
}

function main() {
    if (process.env.MAGICLISTS_SKIP_HOOKS === '1') {
        return warn('skipped (MAGICLISTS_SKIP_HOOKS=1)');
    }

    const dir = hooksDir();
    if (!process.env.MAGICLISTS_HOOKS_DIR && !fs.existsSync(path.dirname(dir))) {
        return warn('no git checkout here — nothing to install');
    }

    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, 'pre-commit');
    const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;

    if (existing !== null && !existing.includes(MARKER)) {
        // Someone else's hook: keep it, but do not silently drop it either.
        const backup = `${target}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        fs.copyFileSync(target, backup);
        warn(`existing hook backed up to ${path.relative(ROOT, backup)}`);
    }

    if (existing !== HOOK_BODY) fs.writeFileSync(target, HOOK_BODY);
    // Non-executable hooks are skipped without a word — this chmod is the point.
    fs.chmodSync(target, 0o755);

    const current = fs.readFileSync(target, 'utf8');
    if (!current.includes(MARKER)) throw new Error('hook shim not written');
    warn(`installed ${path.relative(ROOT, target)}${existing === HOOK_BODY ? ' (already current)' : ''}`);
}

try {
    main();
} catch (error) {
    // Never block `npm install` on hook plumbing.
    console.warn(`[hooks] could not install pre-commit hook: ${error.message}`);
}
process.exit(0);
