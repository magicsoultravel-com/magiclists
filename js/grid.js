export const GRID_CELL = 24;
export const GRID_CARD_CELLS_W = 4;
export const GRID_MIN_CELLS_W = 4;
export const GRID_MIN_CELLS_H = 1;
export const GRID_MAX_CELLS_W = 12;
export const GRID_MAX_CELLS_H = 24;
export const GRID_PADDING = GRID_CELL;

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

export function placementRect(x, y, gw, gh) {
    const w = cellsToPx(gw);
    const h = cellsToPx(gh);
    return { x, y, w, h, gw, gh, right: x + w, bottom: y + h };
}

export function rectsOverlap(a, b) {
    return a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
}

export function canPlaceAt(x, y, gw, gh, occupied, excludeId = null) {
    if (x < 0 || y < 0) return false;
    const rect = placementRect(x, y, gw, gh);
    for (const slot of occupied) {
        if (excludeId && slot.id === excludeId) continue;
        if (rectsOverlap(rect, slot)) return false;
    }
    return true;
}

export function findFreeSlot(gw, gh, occupied, containerWidthPx, nearX = GRID_PADDING, nearY = GRID_PADDING) {
    const cardW = cellsToPx(gw);
    const packW = Math.max(cardW + GRID_PADDING * 2, containerWidthPx);
    const maxX = Math.max(GRID_PADDING, packW - cardW);
    const startY = snapPx(Math.max(GRID_PADDING, nearY));
    const startX = snapPx(Math.max(GRID_PADDING, Math.min(nearX, maxX)));

    for (let row = 0; row < 800; row += 1) {
        const y = startY + row * GRID_CELL;
        const xStart = row === 0 ? startX : GRID_PADDING;
        for (let x = xStart; x <= maxX; x += GRID_CELL) {
            if (canPlaceAt(x, y, gw, gh, occupied, null)) {
                return { x, y };
            }
        }
    }
    return { x: GRID_PADDING, y: startY };
}

export function resolveGridPosition(x, y, gw, gh, occupied, itemId, containerWidthPx) {
    const sx = snapPx(Math.max(0, x));
    const sy = snapPx(Math.max(0, y));
    if (canPlaceAt(sx, sy, gw, gh, occupied, itemId)) {
        return { x: sx, y: sy };
    }
    const others = occupied.filter((slot) => slot.id !== itemId);
    return findFreeSlot(gw, gh, others, containerWidthPx, sx, sy);
}

export function computeExtentFromOccupied(occupied, viewportW) {
    let maxRight = viewportW;
    let maxBottom = GRID_PADDING * 2;
    for (const slot of occupied) {
        maxRight = Math.max(maxRight, slot.right + GRID_PADDING);
        maxBottom = Math.max(maxBottom, slot.bottom + GRID_PADDING);
    }
    return {
        w: Math.max(viewportW, snapPx(maxRight)),
        h: Math.max(GRID_PADDING * 3, snapPx(maxBottom))
    };
}

export function packGridItems(items, { viewportW, positions, getSize }) {
    const occupied = [];
    const placements = {};
    const packW = Math.max(cellsToPx(GRID_MIN_CELLS_W) + GRID_PADDING * 2, viewportW);

    const sorted = [...items].sort((a, b) => {
        const pa = positions[a.id];
        const pb = positions[b.id];
        if (pa && pb) return pa.y - pb.y || pa.x - pb.x;
        if (pa) return -1;
        if (pb) return 1;
        const aTime = Number(a.created_at || a.updated_at || 0);
        const bTime = Number(b.created_at || b.updated_at || 0);
        return aTime - bTime;
    });

    for (const item of sorted) {
        const { gw, gh } = getSize(item.id);
        const saved = positions[item.id];
        let placed = null;

        if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
            const x = snapPx(saved.x);
            const y = snapPx(saved.y);
            if (canPlaceAt(x, y, gw, gh, occupied, item.id)) {
                placed = { x, y };
            }
        }

        if (!placed) {
            placed = findFreeSlot(gw, gh, occupied, packW, GRID_PADDING, GRID_PADDING);
        }

        placements[item.id] = placed;
        occupied.push({ id: item.id, ...placementRect(placed.x, placed.y, gw, gh) });
    }

    return {
        placements,
        extent: computeExtentFromOccupied(occupied, packW)
    };
}

export function collectOccupiedFromCards(cards, readSize) {
    return [...cards].map((card) => {
        const { gw, gh } = readSize(card);
        const x = parseFloat(card.style.left) || 0;
        const y = parseFloat(card.style.top) || 0;
        return { id: card.dataset.id, ...placementRect(x, y, gw, gh) };
    });
}
