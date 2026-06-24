# Cursor afterFileEdit hook — mark architecture map dirty when relevant files change.
$ErrorActionPreference = 'SilentlyContinue'

$HookDir = $PSScriptRoot
$Root = (Resolve-Path (Join-Path $HookDir '..\..')).Path
. (Join-Path $Root 'scripts\lib\ArchitectureMapCommon.ps1')

function Get-EditedPathFromHookInput {
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $null }
    try {
        $data = $Raw | ConvertFrom-Json
    } catch {
        return $null
    }
    foreach ($key in @('file_path', 'filePath', 'path', 'file', 'uri')) {
        if ($data.PSObject.Properties.Name -contains $key -and $data.$key) {
            return [string]$data.$key
        }
    }
    return $null
}

$raw = [Console]::In.ReadToEnd()
$edited = Get-EditedPathFromHookInput -Raw $raw
if (-not $edited) { exit 0 }

$p = $edited -replace '\\', '/'
if ($p -match '^[A-Za-z]:') {
    $p = $p.Substring($Root.Length).TrimStart('/')
}
$p = $p.TrimStart('./')

$relevant = Test-ArchitectureRelevantPath -RelPath $p -Root $Root
if (-not $relevant.architecture -and -not $relevant.tools) { exit 0 }

$flagPath = Join-Path $Root '.cursor\.architecture-map-dirty'
$state = [ordered]@{ architecture = $false; tools = $false }
if (Test-Path -LiteralPath $flagPath) {
    try {
        $existing = Get-Content -LiteralPath $flagPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $state.architecture = [bool]$existing.architecture
        $state.tools = [bool]$existing.tools
    } catch { }
}
$state.architecture = $state.architecture -or $relevant.architecture
$state.tools = $state.tools -or $relevant.tools

$flagDir = Split-Path -Parent $flagPath
if (-not (Test-Path -LiteralPath $flagDir)) {
    New-Item -ItemType Directory -Path $flagDir -Force | Out-Null
}
($state | ConvertTo-Json -Compress) | Set-Content -LiteralPath $flagPath -Encoding UTF8 -NoNewline
exit 0
