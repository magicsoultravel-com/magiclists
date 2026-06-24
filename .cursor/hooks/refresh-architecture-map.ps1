# Cursor stop hook — rebuild architecture map / tools registry if dirty.
$ErrorActionPreference = 'SilentlyContinue'

$HookDir = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $HookDir '..\..')).Path
$flagPath = Join-Path $Root '.cursor\.architecture-map-dirty'

if (-not (Test-Path -LiteralPath $flagPath)) { exit 0 }

try {
    $state = Get-Content -LiteralPath $flagPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
    Remove-Item -LiteralPath $flagPath -Force -ErrorAction SilentlyContinue
    exit 0
}

Remove-Item -LiteralPath $flagPath -Force -ErrorAction SilentlyContinue

try {
    if ($state.architecture) {
        & (Join-Path $Root 'scripts\build-architecture-map.ps1')
    }
    if ($state.tools) {
        & (Join-Path $Root 'scripts\build-tools-list.ps1')
    }
} catch {
    # Re-set dirty flag so a later turn can retry
    $retry = [ordered]@{
        architecture = [bool]$state.architecture
        tools          = [bool]$state.tools
    }
    ($retry | ConvertTo-Json -Compress) | Set-Content -LiteralPath $flagPath -Encoding UTF8 -NoNewline
    [Console]::Error.WriteLine("[refresh-architecture-map] $_")
}

exit 0
