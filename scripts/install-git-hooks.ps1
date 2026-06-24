# Installs repo git hooks (pre-commit -> PowerShell architecture refresh).
# Run once per clone: powershell -NoProfile -File scripts/install-git-hooks.ps1

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$HooksDir = Join-Path $Root '.git\hooks'
$HookPath = Join-Path $HooksDir 'pre-commit'
$Marker = 'magiclists-pre-commit'

if (-not (Test-Path -LiteralPath (Join-Path $Root '.git'))) {
    Write-Error '[install-git-hooks] Not a git repository - skipped.'
    exit 1
}

$hookBody = @"
#!/bin/sh
# $Marker
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/git-hooks/pre-commit.ps1
exit `$?
"@

if (-not (Test-Path -LiteralPath $HooksDir)) {
    New-Item -ItemType Directory -Path $HooksDir -Force | Out-Null
}
[System.IO.File]::WriteAllText($HookPath, $hookBody.Replace("`r`n", "`n"), [System.Text.UTF8Encoding]::new($false))
Write-Host "[install-git-hooks] Installed $HookPath"
