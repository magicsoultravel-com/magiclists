# Shared helpers for build-architecture-map.ps1 and build-tools-list.ps1

function Get-RepoRoot {
    return (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

function Read-FileHead {
    param([string]$Path, [int]$MaxChars = 4096)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $fs = [System.IO.File]::OpenRead($Path)
    try {
        $buf = New-Object byte[] $MaxChars
        $read = $fs.Read($buf, 0, $MaxChars)
        return [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
    } finally {
        $fs.Close()
    }
}

function Parse-MetaTag {
    param([string]$Head, [string]$Tag)
    if ([string]::IsNullOrEmpty($Head)) { return $null }
    $tagMatch = [regex]::Match($Head, "@$Tag\s+")
    if (-not $tagMatch.Success) { return $null }

    $jsonStart = $Head.IndexOf('{', $tagMatch.Index)
    if ($jsonStart -lt 0) { return $null }

    $depth = 0
    for ($i = $jsonStart; $i -lt $Head.Length; $i++) {
        $char = $Head[$i]
        if ($char -eq '{') { $depth++ }
        elseif ($char -eq '}') {
            $depth--
            if ($depth -eq 0) {
                $json = $Head.Substring($jsonStart, $i - $jsonStart + 1)
                try {
                    return ($json | ConvertFrom-Json)
                } catch {
                    return $null
                }
            }
        }
    }
    return $null
}

function Get-BannerTitle {
    param([string]$Head)
    if ([string]::IsNullOrEmpty($Head)) { return '' }
    $m = [regex]::Match($Head, '/\*\s*=+\s*\r?\n\s*(.+?)\s*\r?\n\s*=+\s*\*/', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($m.Success) { return $m.Groups[1].Value.Trim() }
    return ''
}

function Escape-MdCell {
    param([object]$Value)
    if ($null -eq $Value) { return '' }
    return ([string]$Value).Replace('|', '\|').Replace("`n", ' ').Replace("`r", '')
}

function Format-ListCell {
    param($Items)
    if ($null -eq $Items) { return '-' }
    if ($Items -is [System.Array] -or ($Items -is [System.Collections.IEnumerable] -and $Items -isnot [string])) {
        $arr = @($Items)
        if ($arr.Count -eq 0) { return '-' }
        return ($arr -join ', ')
    }
    return [string]$Items
}

function Render-MarkdownTable {
    param([string[]]$Headers, [object[]]$Rows)
    $lines = @()
    $lines += "| $($Headers -join ' | ') |"
    $lines += "| $(($Headers | ForEach-Object { '---' }) -join ' | ') |"
    foreach ($row in $Rows) {
        $cells = foreach ($h in $Headers) {
            Escape-MdCell $row.$h
        }
        $lines += "| $($cells -join ' | ') |"
    }
    return ($lines -join "`n")
}

function Humanize-ToolId {
    param([string]$Id)
    $s = ($Id -replace '[-_]', ' ').ToLowerInvariant()
    return [System.Globalization.CultureInfo]::InvariantCulture.TextInfo.ToTitleCase($s)
}

function Parse-ToolFile {
    param([string]$FilePath)
    $id = [System.IO.Path]::GetFileNameWithoutExtension($FilePath)
    if ([string]::IsNullOrEmpty($id) -or $id.StartsWith('_') -or $id -eq 'registry') { return $null }

    $head = Read-FileHead -Path $FilePath
    if ($head -notmatch '@tool\b') { return $null }

    $label = Humanize-ToolId $id
    $order = 100
    $wide = $false
    $mountClass = ''
    $resizable = $false
    $resizeMode = ''
    $defaultSize = $null
    $minSize = $null
    $icon = ''

    $meta = Parse-MetaTag -Head $head -Tag 'tool'
    if ($meta) {
        if ($meta.label) { $label = [string]$meta.label }
        if ($null -ne $meta.order) { $order = [int]$meta.order }
        if ($meta.wide) { $wide = $true }
        if ($meta.mountClass) { $mountClass = [string]$meta.mountClass }
        if ($meta.resizable) { $resizable = $true }
        if ($meta.resizeMode) { $resizeMode = [string]$meta.resizeMode }
        if ($meta.defaultSize) { $defaultSize = $meta.defaultSize }
        if ($meta.minSize) { $minSize = $meta.minSize }
        if ($meta.icon) { $icon = [string]$meta.icon }
    }

    $iconMatch = [regex]::Match($head, '@tool-icon\s+(.+?)\s*\*/', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    if ($iconMatch.Success) {
        $icon = $iconMatch.Groups[1].Value.Trim()
    }

    $entry = [ordered]@{
        id         = $id
        label      = $label
        order      = $order
        icon       = $icon
        wide       = $wide
        mountClass = $mountClass
    }
    if ($resizable) { $entry.resizable = $true }
    if ($resizeMode) { $entry.resizeMode = $resizeMode }
    if ($defaultSize) { $entry.defaultSize = $defaultSize }
    if ($minSize) { $entry.minSize = $minSize }
    return [pscustomobject]$entry
}

function Get-ToolsRegistry {
    param([string]$ToolsDir)
    if (-not (Test-Path -LiteralPath $ToolsDir)) { return @() }
    $tools = Get-ChildItem -LiteralPath $ToolsDir -Filter '*.js' -File |
        Where-Object { $_.Name -ne 'registry.js' } |
        ForEach-Object { Parse-ToolFile -FilePath $_.FullName } |
        Where-Object { $_ -ne $null }

    return @($tools | Sort-Object order, label)
}

function Get-CssLinksFromIndex {
    param([string]$IndexPath)
    $html = Get-Content -LiteralPath $IndexPath -Raw -Encoding UTF8
    $links = [System.Collections.Generic.List[string]]::new()
    $re = [regex]'<link\s+[^>]*href="\./css/([^"?]+\.css)[^"]*"[^>]*>'
    foreach ($m in $re.Matches($html)) {
        $links.Add(($m.Groups[1].Value -replace '\\', '/'))
    }
    return $links
}

function Get-AllJsFiles {
    param([string]$JsDir, [string]$RelPrefix = '')
    $results = @()
    Get-ChildItem -LiteralPath $JsDir -Force | ForEach-Object {
        if ($_.Name -eq 'node_modules') { return }
        $rel = if ($RelPrefix) { "$RelPrefix/$($_.Name)" } else { $_.Name }
        if ($_.PSIsContainer) {
            $results += Get-AllJsFiles -JsDir $_.FullName -RelPrefix ($rel -replace '\\', '/')
        } elseif ($_.Extension -eq '.js') {
            $results += [pscustomobject]@{
                Rel = ($rel -replace '\\', '/')
                Abs = $_.FullName
            }
        }
    }
    return $results
}

function Test-ArchitectureRelevantPath {
    param([string]$RelPath, [string]$Root)
    if ([string]::IsNullOrWhiteSpace($RelPath)) { return @{ architecture = $false; tools = $false } }
    $p = ($RelPath -replace '\\', '/').TrimStart('./')

    if ($p -like 'css/*' -or $p -eq 'index.html') {
        return @{ architecture = $true; tools = $false }
    }
    if ($p -like 'js/tools/*' -and $p -ne 'js/tools/registry.js' -and $p -like '*.js') {
        return @{ architecture = $true; tools = $true }
    }
    if ($p -like 'js/*.js' -or $p -like 'js/*/*.js') {
        $abs = Join-Path $Root $p
        if (Test-Path -LiteralPath $abs) {
            $head = Read-FileHead -Path $abs
            if ($head -match '@module\b' -or $head -match '@tool\b') {
                $isTool = $p -like 'js/tools/*'
                return @{ architecture = $true; tools = $isTool }
            }
        }
    }
    return @{ architecture = $false; tools = $false }
}
