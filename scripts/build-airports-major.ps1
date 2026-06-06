$outFile = Join-Path $PSScriptRoot '..\data\airports-major.json'
$csvUrl = 'https://davidmegginson.github.io/ourairports-data/airports.csv'

$response = Invoke-WebRequest -Uri $csvUrl -UseBasicParsing
$lines = ($response.Content -split "`r?`n") | Where-Object { $_ -ne '' }
$headers = $lines[0] | ConvertFrom-Csv -Delimiter ',' -Header (1..20) | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name

# Parse header manually
$headerRow = $lines[0]
$headers = @()
$current = ''
$inQuotes = $false
foreach ($ch in $headerRow.ToCharArray()) {
    if ($ch -eq '"') { $inQuotes = -not $inQuotes }
    elseif ($ch -eq ',' -and -not $inQuotes) { $headers += $current; $current = '' }
    else { $current += $ch }
}
$headers += $current

function Parse-CsvLine([string]$line) {
    $values = @()
    $current = ''
    $inQuotes = $false
    foreach ($ch in $line.ToCharArray()) {
        if ($ch -eq '"') { $inQuotes = -not $inQuotes }
        elseif ($ch -eq ',' -and -not $inQuotes) { $values += $current; $current = '' }
        else { $current += $ch }
    }
    $values += $current
    return $values
}

$idx = @{}
for ($i = 0; $i -lt $headers.Count; $i++) { $idx[$headers[$i]] = $i }

$features = @()
for ($i = 1; $i -lt $lines.Count; $i++) {
    $row = Parse-CsvLine $lines[$i]
    if ($row[$idx['type']] -ne 'large_airport') { continue }
    $iata = ($row[$idx['iata_code']] -as [string]).Trim()
    if (-not $iata) { continue }
    $lat = [double]$row[$idx['latitude_deg']]
    $lng = [double]$row[$idx['longitude_deg']]
    if ([double]::IsNaN($lat) -or [double]::IsNaN($lng)) { continue }

    $features += [ordered]@{
        type = 'Feature'
        geometry = @{ type = 'Point'; coordinates = @($lng, $lat) }
        properties = @{
            name = $row[$idx['name']]
            iata = $iata
            icao = (($row[$idx['icao_code']] -as [string]).Trim())
            city = $row[$idx['municipality']]
            country = $row[$idx['iso_country']]
        }
    }
}

$features = $features | Sort-Object { $_.properties.iata }

$geojson = [ordered]@{
    type = 'FeatureCollection'
    meta = @{
        source = 'OurAirports (ourairports.com)'
        filter = 'large_airport with IATA'
        count = $features.Count
        generated = (Get-Date -Format 'yyyy-MM-dd')
    }
    features = $features
}

$dir = Split-Path $outFile -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
$geojson | ConvertTo-Json -Depth 8 -Compress | Set-Content -Path $outFile -Encoding UTF8
Write-Output "Wrote $($features.Count) airports to $outFile"
