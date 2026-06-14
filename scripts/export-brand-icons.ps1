# Export brand icon PNG + ICO rasters (simplified bitmaps matching SVG palette).
# Run: powershell -ExecutionPolicy Bypass -File scripts/export-brand-icons.ps1

Add-Type -AssemblyName System.Drawing

$brandDir = Join-Path $PSScriptRoot '..\assets\brand'
$ids = @('clipboard', 'easel', 'block', 'tile')

function Get-Color($hex) {
    $hex = $hex.TrimStart('#')
    return [System.Drawing.Color]::FromArgb(
        255,
        [Convert]::ToInt32($hex.Substring(0, 2), 16),
        [Convert]::ToInt32($hex.Substring(2, 2), 16),
        [Convert]::ToInt32($hex.Substring(4, 2), 16)
    )
}

function Fill-RoundedRect($g, $brush, $x, $y, $w, $h, $r) {
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc($x, $y, $r * 2, $r * 2, 180, 90)
    $path.AddArc($x + $w - $r * 2, $y, $r * 2, $r * 2, 270, 90)
    $path.AddArc($x + $w - $r * 2, $y + $h - $r * 2, $r * 2, $r * 2, 0, 90)
    $path.AddArc($x, $y + $h - $r * 2, $r * 2, $r * 2, 90, 90)
    $path.CloseFigure()
    $g.FillPath($brush, $path)
    $path.Dispose()
}

function Draw-NeonLines($g, $x, $y, $w, $lineH, $gap, $colors) {
    $cy = $y
    foreach ($c in $colors) {
        $brush = New-Object System.Drawing.SolidBrush (Get-Color $c)
        Fill-RoundedRect $g $brush $x $cy $w $lineH ([math]::Max(1, $lineH / 4))
        $brush.Dispose()
        $cy += $lineH + $gap
    }
}

function Draw-Icon($g, $id, $size) {
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $bg = New-Object System.Drawing.SolidBrush (Get-Color '#050506')
    Fill-RoundedRect $g $bg 0 0 $size $size ($size * 0.19)
    $bg.Dispose()

    $colors = @('#A83888', '#008899', '#601898')
    $paper = New-Object System.Drawing.SolidBrush (Get-Color '#BDB3A3')
    $wood = New-Object System.Drawing.SolidBrush (Get-Color '#4A3018')
    $woodDark = New-Object System.Drawing.SolidBrush (Get-Color '#261810')
    $woodHi = New-Object System.Drawing.SolidBrush (Get-Color '#6E4E30')
    $clip = New-Object System.Drawing.SolidBrush (Get-Color '#242428')

    switch ($id) {
        'clipboard' {
            Fill-RoundedRect $g $wood ($size * 0.19) ($size * 0.17) ($size * 0.62) ($size * 0.75) ($size * 0.07)
            Fill-RoundedRect $g $clip ($size * 0.38) ($size * 0.14) ($size * 0.24) ($size * 0.11) ($size * 0.02)
            Fill-RoundedRect $g $paper ($size * 0.25) ($size * 0.25) ($size * 0.5) ($size * 0.58) ($size * 0.02)
            Draw-NeonLines $g ($size * 0.30) ($size * 0.34) ($size * 0.41) ($size * 0.062) ($size * 0.045) $colors
        }
        'easel' {
            $ptsL = @(
                [System.Drawing.Point]::new([int]($size * 0.31), [int]($size * 0.82)),
                [System.Drawing.Point]::new([int]($size * 0.39), [int]($size * 0.35)),
                [System.Drawing.Point]::new([int]($size * 0.47), [int]($size * 0.82))
            )
            $ptsR = @(
                [System.Drawing.Point]::new([int]($size * 0.69), [int]($size * 0.82)),
                [System.Drawing.Point]::new([int]($size * 0.61), [int]($size * 0.35)),
                [System.Drawing.Point]::new([int]($size * 0.53), [int]($size * 0.82))
            )
            $g.FillPolygon($woodDark, $ptsL)
            $g.FillPolygon($woodDark, $ptsR)
            $state = $g.Save()
            $g.TranslateTransform($size * 0.5, $size * 0.5)
            $g.RotateTransform(-10)
            $g.TranslateTransform(-$size * 0.5, -$size * 0.5)
            Fill-RoundedRect $g $paper ($size * 0.28) ($size * 0.29) ($size * 0.44) ($size * 0.55) ($size * 0.02)
            Draw-NeonLines $g ($size * 0.33) ($size * 0.38) ($size * 0.34) ($size * 0.055) ($size * 0.038) $colors
            $g.Restore($state)
        }
        'block' {
            Fill-RoundedRect $g $woodDark ($size * 0.22) ($size * 0.64) ($size * 0.56) ($size * 0.19) ($size * 0.03)
            Fill-RoundedRect $g $wood ($size * 0.23) ($size * 0.66) ($size * 0.53) ($size * 0.14) ($size * 0.025)
            Fill-RoundedRect $g (New-Object System.Drawing.SolidBrush (Get-Color '#A69C8C')) ($size * 0.33) ($size * 0.22) ($size * 0.41) ($size * 0.45) ($size * 0.02)
            Fill-RoundedRect $g $paper ($size * 0.27) ($size * 0.25) ($size * 0.47) ($size * 0.5) ($size * 0.02)
            Draw-NeonLines $g ($size * 0.31) ($size * 0.34) ($size * 0.38) ($size * 0.058) ($size * 0.038) $colors
        }
        'tile' {
            Fill-RoundedRect $g $paper ($size * 0.19) ($size * 0.19) ($size * 0.62) ($size * 0.62) ($size * 0.09)
            Draw-NeonLines $g ($size * 0.25) ($size * 0.30) ($size * 0.5) ($size * 0.07) ($size * 0.04) $colors
            $spark = New-Object System.Drawing.SolidBrush (Get-Color '#8A7018')
            $g.FillEllipse($spark, $size * 0.66, $size * 0.28, $size * 0.08, $size * 0.08)
            $spark.Dispose()
        }
    }

    $paper.Dispose(); $wood.Dispose(); $woodDark.Dispose(); $woodHi.Dispose(); $clip.Dispose()
}

function Save-Png($id, $px, $outPath) {
    $bmp = New-Object System.Drawing.Bitmap $px, $px
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    Draw-Icon $g $id $px
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose(); $bmp.Dispose()
}

function Save-Ico($pngPath, $icoPath) {
    $bytes = [System.IO.File]::ReadAllBytes($pngPath)
    $count = 1
    $header = 6 + 16 * $count
    $ms = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter $ms
    $bw.Write([uint16]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]$count)
    $bw.Write([byte]32)
    $bw.Write([byte]32)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$bytes.Length)
    $bw.Write([uint32]$header)
    $bw.Write($bytes)
    $bw.Flush()
    [System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
    $bw.Dispose(); $ms.Dispose()
}

foreach ($id in $ids) {
    $png180 = Join-Path $brandDir "apple-touch-$id.png"
    $png32 = Join-Path $brandDir "favicon-$id-32.png"
    $ico = Join-Path $brandDir "favicon-$id.ico"
    Save-Png $id 180 $png180
    Save-Png $id 32 $png32
    Save-Ico $png32 $ico
    Remove-Item $png32 -Force
    Write-Host "Exported $id"
}

Copy-Item (Join-Path $brandDir 'favicon-clipboard.ico') (Join-Path $brandDir 'favicon.ico') -Force
Write-Host 'Done.'
