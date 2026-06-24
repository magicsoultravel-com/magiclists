# Regenerates .cursor/rules/magiclists-architecture.mdc from index.html,
# @css headers, @module headers, and @tool metadata.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-architecture-map.ps1

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\ArchitectureMapCommon.ps1')

$Root = Get-RepoRoot
$IndexHtml = Join-Path $Root 'index.html'
$CssDir = Join-Path $Root 'css'
$JsDir = Join-Path $Root 'js'
$OutMdc = Join-Path $Root '.cursor\rules\magiclists-architecture.mdc'

$warnings = [System.Collections.Generic.List[string]]::new()
$errors = [System.Collections.Generic.List[string]]::new()
$cssRows = [System.Collections.Generic.List[object]]::new()

$linkedCss = Get-CssLinksFromIndex -IndexPath $IndexHtml
$index = 0
foreach ($file in $linkedCss) {
    $index++
    $abs = Join-Path $CssDir $file
    if (-not (Test-Path -LiteralPath $abs)) {
        $errors.Add("index.html links missing file: css/$file")
        continue
    }
    $head = Read-FileHead -Path $abs
    $meta = Parse-MetaTag -Head $head -Tag 'css'
    $banner = Get-BannerTitle -Head $head
    if (-not $meta -or -not $meta.owns) {
        $suffix = if ($banner) { " (banner: $banner)" } else { '' }
        $warnings.Add("css/${file}: missing @css header$suffix")
    }
    $cssRows.Add([pscustomobject]@{
        file  = "css/$file"
        owns  = if ($meta -and $meta.owns) { [string]$meta.owns } elseif ($banner) { $banner } else { '(unknown)' }
        js    = Format-ListCell $meta.js
        notes = if ($meta -and $meta.notes) { [string]$meta.notes } else { '-' }
        load  = $index
    })
}

$linkedSet = @{}
foreach ($f in $linkedCss) { $linkedSet[$f] = $true }
if (Test-Path -LiteralPath $CssDir) {
    Get-ChildItem -LiteralPath $CssDir -Filter '*.css' -File | ForEach-Object {
        if (-not $linkedSet.ContainsKey($_.Name)) {
            $warnings.Add("css/$($_.Name): on disk but not linked in index.html (orphan)")
        }
    }
}

if ($errors.Count -gt 0) {
    foreach ($err in $errors) { Write-Error "[build-architecture-map] ERROR: $err" }
    exit 1
}

$jsRows = [System.Collections.Generic.List[object]]::new()
foreach ($entry in (Get-AllJsFiles -JsDir $JsDir)) {
    $head = Read-FileHead -Path $entry.Abs
    $meta = Parse-MetaTag -Head $head -Tag 'module'
    if (-not $meta -or -not $meta.owns) { continue }
    $jsRows.Add([pscustomobject]@{
        file    = "js/$($entry.Rel)"
        owns    = [string]$meta.owns
        related = Format-ListCell $meta.related
        events  = Format-ListCell $meta.events
        notes   = if ($meta.notes) { [string]$meta.notes } else { '-' }
    })
}
$sortedJs = @($jsRows | Sort-Object file)

$tools = Get-ToolsRegistry -ToolsDir (Join-Path $JsDir 'tools')
$toolRows = foreach ($t in $tools) {
    [pscustomobject]@{
        id         = $t.id
        label      = $t.label
        mountClass = if ($t.mountClass) { $t.mountClass } else { '-' }
        order      = $t.order
    }
}

$timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$lines = @(
    '---',
    'description: magiclists architecture map (auto-generated - do not edit by hand)',
    'alwaysApply: true',
    '---',
    '',
    '# Architecture map (generated)',
    '',
    "> Regenerate: scripts/build-architecture-map.ps1 - built $timestamp",
    '',
    '## CSS load order',
    '',
    (Render-MarkdownTable -Headers @('file', 'owns', 'js', 'notes', 'load') -Rows $cssRows),
    '',
    '## JS domains (@module)',
    '',
    (Render-MarkdownTable -Headers @('file', 'owns', 'related', 'events', 'notes') -Rows $sortedJs),
    '',
    '## Tools (@tool)',
    '',
    (Render-MarkdownTable -Headers @('id', 'label', 'mountClass', 'order') -Rows $toolRows)
)

if ($warnings.Count -gt 0) {
    $lines += '', '## Validation', ''
    foreach ($warn in $warnings) { $lines += "- **WARN:** $warn" }
}
$lines += ''

$mdc = ($lines -join "`n")
$outDir = Split-Path -Parent $OutMdc
if (-not (Test-Path -LiteralPath $outDir)) {
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
}

$write = $true
if (Test-Path -LiteralPath $OutMdc) {
    $existing = Get-Content -LiteralPath $OutMdc -Raw -Encoding UTF8
    if ($existing -eq $mdc) { $write = $false }
}
if ($write) {
    [System.IO.File]::WriteAllText($OutMdc, $mdc, [System.Text.UTF8Encoding]::new($false))
}

Write-Host "[build-architecture-map] $($cssRows.Count) CSS, $($sortedJs.Count) JS modules, $($toolRows.Count) tools -> .cursor/rules/magiclists-architecture.mdc"
foreach ($warn in $warnings) { Write-Warning "[build-architecture-map] WARN: $warn" }
