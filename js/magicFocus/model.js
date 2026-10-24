/** @module {"owns":"the focus layout model - block catalogue, preset tables, zone/ratio/zoom normalisation and the configured check; no DOM, no state", "related":["magicFocus.js","magicFocus/layout.js","magicFocus/setup.js"]} */

export const BLOCKS = [
    { id: 'text', label: 'Text' },
    { id: 'checklist', label: 'Checklist' },
    { id: 'table', label: 'Table' },
    { id: 'chart', label: 'Chart' },
    { id: 'kanban', label: 'Kanban' },
    { id: 'wbs', label: 'WBS' },
    { id: 'media', label: 'Media' },
    { id: 'canvas', label: 'Canvas' }
];

export const PRESET_META = [
    { id: 'split2-v', label: 'Halves', hint: 'Left · Right' },
    { id: 'split2-h', label: 'Stack', hint: 'Top · Bottom' },
    { id: 'split3-cols', label: '3 columns', hint: 'Side by side' },
    { id: 'split3-rows', label: '3 rows', hint: 'Stacked' },
    { id: 'split3-1over2', label: '1 over 2', hint: 'Wide top' },
    { id: 'split3-2over1', label: '2 over 1', hint: 'Wide bottom' },
    { id: 'split4-grid', label: 'Quad', hint: '2 × 2' }
];

export const BLOCK_ICONS = {
    text: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M3 4h10M5 4v8M11 4v8M6.5 12h3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    checklist: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><rect x="2.5" y="3" width="3" height="3" rx="0.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.2 4.5l.8.8 1.4-1.6M7.5 4.5h6M2.5 8.5h3v3h-3zM7.5 10h6" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    table: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><rect x="2" y="3" width="12" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h12M2 9.5h12M6 3v10M10 3v10" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
    chart: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M2.5 13V3M2.5 13h11" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="4.2" y="7" width="2" height="4.5" rx="0.3" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="7.2" y="4.5" width="2" height="7" rx="0.3" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="10.2" y="6" width="2" height="5.5" rx="0.3" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
    kanban: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><rect x="2" y="2.5" width="3.2" height="11" rx="0.6" fill="none" stroke="currentColor" stroke-width="1.15"/><rect x="6.4" y="2.5" width="3.2" height="11" rx="0.6" fill="none" stroke="currentColor" stroke-width="1.15"/><rect x="10.8" y="2.5" width="3.2" height="11" rx="0.6" fill="none" stroke="currentColor" stroke-width="1.15"/><path d="M2.7 5.2h1.8M6.1 5.2h1.8M11.5 5.2h1.8M2.7 8h1.8M6.1 8h1.8" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round"/></svg>',
    wbs: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M8 2.5v3.5M4 6h8M4 6v7.5M8 6v7.5M12 6v7.5" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><rect x="2.4" y="11" width="3.2" height="2.5" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="6.4" y="9.5" width="3.2" height="4" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.1"/><rect x="10.4" y="10.2" width="3.2" height="3.3" rx="0.4" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>',
    media: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><rect x="2" y="3.5" width="12" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="6.8" r="1.1" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M2.8 11.2 6.2 8.2l2.2 2 2-1.6 2.8 2.6" fill="none" stroke="currentColor" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    canvas: '<svg viewBox="0 0 16 16" width="16" height="16" focusable="false"><path d="M10.5 2.5 13.5 5.5 6 13H3v-3L10.5 2.5z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 4l3 3" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>'
};

export const PRESET_ZONE_COUNTS = {
    'split2-v': 2,
    'split2-h': 2,
    'split3-cols': 3,
    'split3-rows': 3,
    'split3-1over2': 3,
    'split3-2over1': 3,
    'split4-grid': 4
};

export const FOCUS_ZOOM_MIN = 50;

export const FOCUS_ZOOM_MAX = 200;

export const FOCUS_ZOOM_STEP = 10;

export const FOCUS_ZOOM_DEFAULT = 100;

export function clampFocusZoom(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return FOCUS_ZOOM_DEFAULT;
    const clamped = Math.min(FOCUS_ZOOM_MAX, Math.max(FOCUS_ZOOM_MIN, v));
    return Math.round(clamped / FOCUS_ZOOM_STEP) * FOCUS_ZOOM_STEP;
}

export function emptyZoom(count, rawZoom = null) {
    const zoom = {};
    const src = rawZoom && typeof rawZoom === 'object' ? rawZoom : null;
    for (let i = 0; i < count; i += 1) {
        const key = `z${i}`;
        zoom[key] = clampFocusZoom(src?.[key] ?? FOCUS_ZOOM_DEFAULT);
    }
    return zoom;
}

export function defaultRatios(preset) {
    switch (preset) {
        case 'split2-v':
        case 'split2-h':
            return [0.5];
        case 'split3-cols':
        case 'split3-rows':
            return [1 / 3, 2 / 3];
        case 'split3-1over2':
        case 'split3-2over1':
            return [0.45, 0.5];
        case 'split4-grid':
            return [0.5, 0.5];
        default:
            return [0.5];
    }
}

export function emptyZones(count) {
    const zones = {};
    for (let i = 0; i < count; i += 1) zones[`z${i}`] = [];
    return zones;
}

export function asBlockList(val) {
    if (Array.isArray(val)) {
        return val.filter((id) => BLOCKS.some((b) => b.id === id));
    }
    if (typeof val === 'string' && BLOCKS.some((b) => b.id === val)) return [val];
    return [];
}

export function allPlacedBlocks(zones) {
    const seen = new Set();
    Object.values(zones || {}).forEach((val) => {
        asBlockList(val).forEach((id) => seen.add(id));
    });
    return seen;
}

export function removeBlockFromZones(zones, blockId) {
    Object.keys(zones || {}).forEach((k) => {
        zones[k] = asBlockList(zones[k]).filter((id) => id !== blockId);
    });
}

export function createDefaultFocus(preset = 'split2-v') {
    const count = PRESET_ZONE_COUNTS[preset] || 2;
    return {
        version: 1,
        preset,
        ratios: defaultRatios(preset),
        zones: emptyZones(count),
        zoom: emptyZoom(count)
    };
}

export function normalizeFocus(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const preset = PRESET_ZONE_COUNTS[raw.preset] ? raw.preset : 'split2-v';
    const count = PRESET_ZONE_COUNTS[preset];
    const ratios = Array.isArray(raw.ratios) && raw.ratios.length
        ? raw.ratios.map((n) => {
            const v = Number(n);
            return Number.isFinite(v) ? Math.min(0.92, Math.max(0.08, v)) : 0.5;
        })
        : defaultRatios(preset);
    const zones = emptyZones(count);
    const seen = new Set();
    if (raw.zones && typeof raw.zones === 'object') {
        for (let i = 0; i < count; i += 1) {
            const key = `z${i}`;
            asBlockList(raw.zones[key]).forEach((id) => {
                if (seen.has(id)) return;
                zones[key].push(id);
                seen.add(id);
            });
        }
    }
    return {
        version: 1,
        preset,
        ratios,
        zones,
        zoom: emptyZoom(count, raw.zoom)
    };
}

export function focusIsConfigured(focus) {
    const n = normalizeFocus(focus);
    if (!n) return false;
    return Object.values(n.zones).some((list) => asBlockList(list).length > 0);
}

export function blockLabel(id) {
    return BLOCKS.find((b) => b.id === id)?.label || id || 'Empty';
}
