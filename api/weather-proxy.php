<?php
/**
 * Server-side proxy for IMGW grid forecast (CORS fallback for hosted PHP deploys).
 * Usage: api/weather-proxy.php?lat=52.19&lon=21.04
 */
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Cache-Control: public, max-age=300');

$lat = isset($_GET['lat']) ? filter_var($_GET['lat'], FILTER_VALIDATE_FLOAT) : false;
$lon = isset($_GET['lon']) ? filter_var($_GET['lon'], FILTER_VALIDATE_FLOAT) : false;

if ($lat === false || $lon === false) {
    http_response_code(400);
    echo json_encode(['error' => 'lat and lon required']);
    exit;
}

$url = sprintf(
    'https://imgw-api-proxy.evtlab.pl/forecast?lat=%s&lon=%s',
    rawurlencode((string) $lat),
    rawurlencode((string) $lon)
);

$ctx = stream_context_create([
    'http' => [
        'method' => 'GET',
        'header' => "Accept: application/json\r\nUser-Agent: magiclists/1.0\r\n",
        'timeout' => 20
    ]
]);

$body = @file_get_contents($url, false, $ctx);
if ($body === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Upstream forecast unavailable']);
    exit;
}

echo $body;
