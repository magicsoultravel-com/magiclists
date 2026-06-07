export const GRID_CELL = 24;
export const GRID_CARD_CELLS_W = 4;
export const GRID_MIN_CELLS_W = 4;
export const GRID_MIN_CELLS_H = 1;
export const GRID_MAX_CELLS_W = 12;
export const GRID_MAX_CELLS_H = 24;
export const GRID_DEFAULT_CANVAS = 4800;

export const GRID_SIZE_PRESETS = {
    1: { gw: 4, gh: 1, label: 'Minimal' },
    2: { gw: 4, gh: 2, label: 'Compact' },
    3: { gw: 4, gh: 3, label: 'Standard' },
    4: { gw: 4, gh: 4, label: 'Comfort' }
};

export const GRID_EXPANDED_DEFAULT = { gw: 8, gh: 6 };

export function snapPx(px) {
    return Math.round(px / GRID_CELL) * GRID_CELL;
}

export function cellsToPx(cells) {
    return Math.max(GRID_MIN_CELLS_H, cells) * GRID_CELL;
}

export function pxToCells(px, { min = 1, max = GRID_MAX_CELLS_H } = {}) {
    return Math.min(max, Math.max(min, Math.round(px / GRID_CELL)));
}

export function clampGridSize(gw, gh, { expanded = false } = {}) {
    const minW = expanded ? 6 : GRID_MIN_CELLS_W;
    const minH = expanded ? 4 : GRID_MIN_CELLS_H;
    return {
        gw: Math.min(GRID_MAX_CELLS_W, Math.max(minW, gw)),
        gh: Math.min(GRID_MAX_CELLS_H, Math.max(minH, gh))
    };
}

export function presetForLevel(level) {
    return GRID_SIZE_PRESETS[level] || GRID_SIZE_PRESETS[3];
}

export function readGridDefaultLevel() {
    const raw = parseInt(localStorage.getItem('matrix_grid_default_level') || '3', 10);
    return GRID_SIZE_PRESETS[raw] ? raw : 3;
}

export function writeGridDefaultLevel(level) {
    localStorage.setItem('matrix_grid_default_level', String(level));
}
