<?php
/**
 * Scans js/tools/*.js and returns tool menu metadata as JSON.
 * InfinityFree (and most PHP hosts) can run this; browsers cannot list folders.
 *
 * Optional per-file header in each tool .js file:
 *   @tool {"label":"Calculator","order":1,"icon":"calculator"}
 */
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache, must-revalidate');

$toolsDir = realpath(__DIR__ . '/../js/tools');
if (!$toolsDir || !is_dir($toolsDir)) {
    http_response_code(500);
    echo json_encode(['error' => 'Tools directory not found']);
    exit;
}

$tools = [];
$files = glob($toolsDir . '/*.js') ?: [];

foreach ($files as $file) {
    $id = basename($file, '.js');
    if ($id === '' || $id[0] === '_') {
        continue;
    }

    $head = file_get_contents($file, false, null, 0, 2048) ?: '';
    $label = humanize_tool_id($id);
    $order = 100;
    $icon = $id;

    if (preg_match('/@tool\s+(\{[^}]+\})/', $head, $matches)) {
        $meta = json_decode($matches[1], true);
        if (is_array($meta)) {
            if (!empty($meta['label'])) {
                $label = $meta['label'];
            }
            if (isset($meta['order'])) {
                $order = (int) $meta['order'];
            }
            if (!empty($meta['icon'])) {
                $icon = $meta['icon'];
            }
        }
    }

    $tools[] = [
        'id' => $id,
        'label' => $label,
        'order' => $order,
        'icon' => $icon,
    ];
}

usort($tools, function ($a, $b) {
    if ($a['order'] !== $b['order']) {
        return $a['order'] <=> $b['order'];
    }
    return strcasecmp($a['label'], $b['label']);
});

echo json_encode(array_values($tools));

function humanize_tool_id(string $id): string
{
    return ucwords(str_replace(['-', '_'], ' ', $id));
}
