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
foreach ($f in $staged) {
    $p = ($f -replace '\\', '/')
    $rel = Test-ArchitectureRelevantPath -RelPath $p -Root $Root
    if ($rel.architecture) { $needsArchitecture = $true }
    if ($rel.tools) { $needsTools = $true }
    if ($p -like '.cursor/rules/*') { $needsArchitecture = $true }
}

if (-not $needsArchitecture -and -not $needsTools) { exit 0 }

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
} catch {
    Write-Error "[pre-commit] Generator failed - commit aborted. $_"
    exit 1
}

exit 0
