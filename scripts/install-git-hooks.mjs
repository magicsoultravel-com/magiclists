/**
 * Installs repo git hooks (pre-commit → PowerShell architecture refresh).
 * Run once per clone: powershell -NoProfile -File scripts/install-git-hooks.ps1
 * (Legacy Node installer — prefer install-git-hooks.ps1)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const HOOKS_DIR = path.join(ROOT, '.git', 'hooks');
const HOOK_PATH = path.join(HOOKS_DIR, 'pre-commit');
const MARKER = 'magiclists-pre-commit';

const hookBody = `#!/bin/sh
# ${MARKER}
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/git-hooks/pre-commit.ps1
exit $?
`;

if (!fs.existsSync(path.join(ROOT, '.git'))) {
    console.error('[install-git-hooks] Not a git repository — skipped.');
    process.exit(1);
}

fs.mkdirSync(HOOKS_DIR, { recursive: true });
fs.writeFileSync(HOOK_PATH, hookBody, { mode: 0o755 });
console.log(`[install-git-hooks] Installed ${path.relative(ROOT, HOOK_PATH)}`);
