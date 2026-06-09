<?php
/**
 * Scans js/tools/*.js and returns tool menu metadata as JSON.
 * InfinityFree (and most PHP hosts) can run this; browsers cannot list folders.
 *
 * Each tool .js file declares metadata in header comments:
 *   @tool {"label":"Calculator","order":1,"wide":false,"mountClass":"tool-mount--example"}
 *   @tool-icon <path d="..." fill="none" stroke="currentColor"/>
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

    $head = file_get_contents($file, false, null, 0, 4096) ?: '';
    if (!preg_match('/@tool\b/', $head)) {
        continue;
    }

    $label = humanize_tool_id($id);
    $order = 100;
    $wide = false;
    $mountClass = '';
    $icon = '';

    if (preg_match('/@tool\s+(\{.*?\})/s', $head, $matches)) {
        $meta = json_decode($matches[1], true);
        if (is_array($meta)) {
            if (!empty($meta['label'])) {
                $label = $meta['label'];
            }
            if (isset($meta['order'])) {
                $order = (int) $meta['order'];
            }
            if (!empty($meta['wide'])) {
                $wide = true;
            }
            if (!empty($meta['mountClass'])) {
                $mountClass = (string) $meta['mountClass'];
            }
            if (!empty($meta['icon'])) {
                $icon = (string) $meta['icon'];
            }
        }
    }

    if (preg_match('/@tool-icon\s+(.+?)\s*\*\//s', $head, $iconMatch)) {
        $icon = trim($iconMatch[1]);
    }

    $tools[] = [
        'id' => $id,
        'label' => $label,
        'order' => $order,
        'icon' => $icon,
        'wide' => $wide,
        'mountClass' => $mountClass,
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
