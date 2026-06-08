<?php
/**
 * Admin-only export of app source as a ZIP archive.
 * Validates X-Admin-Token against data.json (or dev default).
 *
 * ?manifest=1  → JSON list of relative paths (for client-side fallback zip).
 */
header('Cache-Control: no-store');

$root = realpath(__DIR__ . '/..');
if (!$root) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Project root not found']);
    exit;
}

$token = trim((string) ($_SERVER['HTTP_X_ADMIN_TOKEN'] ?? ''));
$expected = read_admin_token($root);
if ($token === '' || !hash_equals($expected, $token)) {
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Admin token required']);
    exit;
}

$paths = collect_export_paths($root);

if (!empty($_GET['manifest'])) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['paths' => $paths]);
    exit;
}

if (!class_exists('ZipArchive')) {
    http_response_code(501);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'ZipArchive not available on this host']);
    exit;
}

$stamp = gmdate('Ymd_His');
$zipName = "magiclists_code_{$stamp}.zip";
$tmp = tempnam(sys_get_temp_dir(), 'mlzip_');
if ($tmp === false) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Could not create temp file']);
    exit;
}

$zip = new ZipArchive();
if ($zip->open($tmp, ZipArchive::OVERWRITE) !== true) {
    @unlink($tmp);
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['error' => 'Could not open zip archive']);
    exit;
}

foreach ($paths as $rel) {
    $abs = $root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $rel);
    if (is_file($abs)) {
        $zip->addFile($abs, $rel);
    }
}

$zip->close();

header('Content-Type: application/zip');
header('Content-Disposition: attachment; filename="' . $zipName . '"');
header('Content-Length: ' . filesize($tmp));
readfile($tmp);
@unlink($tmp);
exit;

function read_admin_token(string $root): string
{
    $default = 'dev-admin-secret-2026';
    $dataPath = $root . DIRECTORY_SEPARATOR . 'data.json';
    if (!is_file($dataPath)) {
        return $default;
    }
    $raw = file_get_contents($dataPath);
    $parsed = json_decode($raw ?: '', true);
    $token = $parsed['auth']['admin_token'] ?? '';
    return is_string($token) && $token !== '' ? $token : $default;
}

/** @return list<string> */
function collect_export_paths(string $root): array
{
    $skipDirs = ['.git', '.cursor', 'node_modules', 'vendor'];
    $allowExt = ['html', 'css', 'js', 'json', 'php', 'mjs', 'ps1', 'md', 'mdc'];
    $paths = [];

    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iterator as $fileInfo) {
        if (!$fileInfo->isFile()) {
            continue;
        }

        $abs = $fileInfo->getPathname();
        $rel = substr($abs, strlen($root) + 1);
        $rel = str_replace('\\', '/', $rel);

        $parts = explode('/', $rel);
        if (array_intersect($parts, $skipDirs)) {
            continue;
        }

        $base = basename($rel);
        if ($base === '.DS_Store' || $base === 'Thumbs.db') {
            continue;
        }

        $ext = strtolower(pathinfo($rel, PATHINFO_EXTENSION));
        if (!in_array($ext, $allowExt, true)) {
            continue;
        }

        $paths[] = $rel;
    }

    sort($paths, SORT_STRING);
    return $paths;
}
