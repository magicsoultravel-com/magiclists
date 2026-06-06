<?php
/**
 * Builds data/airports-major.json from OurAirports (large_airport + IATA).
 * Run: php scripts/build-airports-major.php
 */

$outFile = __DIR__ . '/../data/airports-major.json';
$csvUrl = 'https://davidmegginson.github.io/ourairports-data/airports.csv';

$csv = @file_get_contents($csvUrl);
if ($csv === false) {
    fwrite(STDERR, "Failed to download airports.csv\n");
    exit(1);
}

$lines = preg_split('/\r\n|\r|\n/', trim($csv));
$headers = str_getcsv(array_shift($lines));
$idx = array_flip($headers);
$features = [];

foreach ($lines as $line) {
    if ($line === '') {
        continue;
    }
    $row = str_getcsv($line);
    if (($row[$idx['type']] ?? '') !== 'large_airport') {
        continue;
    }

    $iata = trim($row[$idx['iata_code']] ?? '');
    if ($iata === '') {
        continue;
    }

    $lat = (float) ($row[$idx['latitude_deg']] ?? 0);
    $lng = (float) ($row[$idx['longitude_deg']] ?? 0);
    if (!is_finite($lat) || !is_finite($lng)) {
        continue;
    }

    $features[] = [
        'type' => 'Feature',
        'geometry' => [
            'type' => 'Point',
            'coordinates' => [$lng, $lat],
        ],
        'properties' => [
            'name' => $row[$idx['name']] ?? '',
            'iata' => $iata,
            'icao' => trim($row[$idx['icao_code']] ?? $row[$idx['gps_code']] ?? ''),
            'city' => $row[$idx['municipality']] ?? '',
            'country' => $row[$idx['iso_country']] ?? '',
        ],
    ];
}

usort($features, function ($a, $b) {
    return strcmp($a['properties']['iata'], $b['properties']['iata']);
});

$geojson = [
    'type' => 'FeatureCollection',
    'meta' => [
        'source' => 'OurAirports (ourairports.com)',
        'filter' => 'large_airport with IATA',
        'count' => count($features),
        'generated' => gmdate('Y-m-d'),
    ],
    'features' => $features,
];

$dir = dirname($outFile);
if (!is_dir($dir)) {
    mkdir($dir, 0777, true);
}

file_put_contents($outFile, json_encode($geojson));
echo 'Wrote ' . count($features) . " airports to {$outFile}\n";
