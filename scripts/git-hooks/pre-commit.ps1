# Pre-commit hook — regenerates architecture map and tools registry when relevant
# files are staged, then re-stages generated outputs. No Node required.
$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
. (Join-Path $Root 'scripts\lib\ArchitectureMapCommon.ps1')

function Get-StagedFiles {
    try {
        $raw = git -C $Root diff --cached --name-only -z 2>$null
        if (-not $raw) { return @() }
        return @($raw -split "`0" | Where-Object { $_ -and $_.Trim() })
    } catch {
        return @()
    }
}

function Add-StagedIfExists {
    param([string]$RelPath)
    $abs = Join-Path $Root $RelPath
    if (-not (Test-Path -LiteralPath $abs)) { return }
    git -C $Root add -- $RelPath | Out-Null
}

$staged = Get-StagedFiles
if (-not $staged.Count) { exit 0 }

$needsArchitecture = $false
$needsTools = $false
$needsAssets = $false
foreach ($f in $staged) {
    $p = ($f -replace '\\', '/')
    $rel = Test-ArchitectureRelevantPath -RelPath $p -Root $Root
    if ($rel.architecture) { $needsArchitecture = $true }
    if ($rel.tools) { $needsTools = $true }
    if ($p -like '.cursor/rules/*') { $needsArchitecture = $true }
    if (($p -like 'js/*.js') -or ($p -like 'css/*.css') -or $p -eq 'index.html' -or $p -eq 'popout.html') {
        $needsAssets = $true
    }
}

if (-not $needsArchitecture -and -not $needsTools -and -not $needsAssets) { exit 0 }

try {
    if ($needsArchitecture) {
        & (Join-Path $Root 'scripts\build-architecture-map.ps1')
        Add-StagedIfExists '.cursor/rules/magiclists-architecture.mdc'
    }
    if ($needsTools) {
        & (Join-Path $Root 'scripts\build-tools-list.ps1')
        Add-StagedIfExists 'js/tools/registry.js'
        Add-StagedIfExists 'api/tools-list.json'
    }
    if ($needsAssets) {
        # Content hashes keep a deploy from pairing a new module with a stale
        # cached one (GitHub Pages sends Cache-Control: max-age=600).
        $node = Get-Command node -ErrorAction SilentlyContinue
        if ($node) {
            & node (Join-Path $Root 'scripts\build-asset-versions.mjs')
            if ($LASTEXITCODE -ne 0) { throw 'build-asset-versions.mjs failed' }
            Add-StagedIfExists 'index.html'
            Add-StagedIfExists 'popout.html'
            & node --experimental-vm-modules (Join-Path $Root 'scripts\check-module-graph.mjs')
            if ($LASTEXITCODE -ne 0) { throw 'check-module-graph.mjs failed — a module imports a missing export' }
        } else {
            Write-Warning '[pre-commit] node not found - skipped asset stamping + module graph check.'
        }
    }
} catch {
    Write-Error "[pre-commit] Generator failed - commit aborted. $_"
    exit 1
}

exit 0
