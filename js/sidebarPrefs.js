export const PANEL_COLLAPSED_KEY = 'matrix_panel_collapsed';
export const SIDEBAR_SECTIONS_KEY = 'matrix_sidebar_sections';
export const NOTES_LIST_SORT_KEY = 'matrix_notes_list_sort';
export const BOARD_SORT_KEY = 'matrix_board_sort';
export const MODULE_DOCKS_KEY = 'matrix_sidebar_module_docks';
export const SHELL_DOCK_KEY = 'matrix_sidebar_shell_dock';
export const SIDEBAR_WIDTH_KEY = 'matrix_sidebar_width';

/** @deprecated migration read only */
const LEGACY_QUICK_ACTIONS_DOCK_KEY = 'matrix_quick_actions_dock';
/** @deprecated migration read only */
const LEGACY_TOOLS_DOCK_KEY = 'matrix_tools_dock';

export const SIDEBAR_DEFAULT_WIDTH = 220;
/** 33% below prior 160px floor — narrower drag allowed */
export const SIDEBAR_MIN_WIDTH = Math.round(160 * (1 - 1 / 3));

export const SIDEBAR_BACKUP_KEYS = [
    PANEL_COLLAPSED_KEY,
    SIDEBAR_SECTIONS_KEY,
    NOTES_LIST_SORT_KEY,
    BOARD_SORT_KEY,
    MODULE_DOCKS_KEY,
    SHELL_DOCK_KEY,
    SIDEBAR_WIDTH_KEY
];

const DEFAULT_NOTES_LIST_SORT = { field: 'date', dir: 'desc' };
const DEFAULT_BOARD_SORT = { direction: 'horizontal', field: 'date', dir: 'desc', cascade: false };

const DEFAULT_DOCK = { docked: true, x: null, y: null };

const LEGACY_MODULE_DOCK_KEYS = {
    'quick-actions': LEGACY_QUICK_ACTIONS_DOCK_KEY,
    tools: LEGACY_TOOLS_DOCK_KEY
};

const LEGACY_PLAYER_STATE_KEYS = {
    radio: 'matrix_radio_state',
    tv: 'matrix_tv_state'
};

function normalizeDock(raw) {
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_DOCK };
    return {
        docked: raw.docked !== false,
        x: Number.isFinite(raw.x) ? raw.x : null,
        y: Number.isFinite(raw.y) ? raw.y : null
    };
}

function readAllModuleDocks() {
    try {
        const raw = JSON.parse(localStorage.getItem(MODULE_DOCKS_KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

function writeAllModuleDocks(map) {
    localStorage.setItem(MODULE_DOCKS_KEY, JSON.stringify(map));
}

function readLegacyModuleDock(moduleId) {
    const legacyKey = LEGACY_MODULE_DOCK_KEYS[moduleId];
    if (!legacyKey) return null;
    try {
        const raw = JSON.parse(localStorage.getItem(legacyKey) || 'null');
        if (!raw || typeof raw !== 'object') return null;
        return normalizeDock(raw);
    } catch {
        return null;
    }
}

function readLegacyPlayerModuleDock(moduleId) {
    const stateKey = LEGACY_PLAYER_STATE_KEYS[moduleId];
    if (!stateKey) return null;
    try {
        const raw = JSON.parse(localStorage.getItem(stateKey) || '{}');
        if (!raw || typeof raw !== 'object') return null;
        const docked = raw.miniPlayerDocked !== undefined
            ? raw.miniPlayerDocked !== false
            : raw.panelDocked !== false;
        const x = Number.isFinite(raw.miniPlayerX) ? raw.miniPlayerX
            : (Number.isFinite(raw.panelX) ? raw.panelX : null);
        const y = Number.isFinite(raw.miniPlayerY) ? raw.miniPlayerY
            : (Number.isFinite(raw.panelY) ? raw.panelY : null);
        return { docked, x, y };
    } catch {
        return null;
    }
}

export function readModuleDock(moduleId) {
    const map = readAllModuleDocks();
    if (Object.prototype.hasOwnProperty.call(map, moduleId)) {
        return normalizeDock(map[moduleId]);
    }

    const legacy = readLegacyModuleDock(moduleId)
        || readLegacyPlayerModuleDock(moduleId);
    if (legacy) {
        writeModuleDock(moduleId, legacy);
        return legacy;
    }

    return { ...DEFAULT_DOCK };
}

export function writeModuleDock(moduleId, patch) {
    const map = readAllModuleDocks();
    const next = { ...normalizeDock(map[moduleId]), ...patch };
    map[moduleId] = next;
    writeAllModuleDocks(map);
}

export function readShellDock() {
    try {
        const raw = JSON.parse(localStorage.getItem(SHELL_DOCK_KEY) || 'null');
        return normalizeDock(raw);
    } catch {
        return { ...DEFAULT_DOCK };
    }
}

export function writeShellDock(patch) {
    const next = { ...readShellDock(), ...patch };
    localStorage.setItem(SHELL_DOCK_KEY, JSON.stringify(next));
}

export function readPanelCollapsed() {
    const stored = localStorage.getItem(PANEL_COLLAPSED_KEY);
    return stored === null ? true : stored === 'true';
}

export function writePanelCollapsed(collapsed) {
    localStorage.setItem(PANEL_COLLAPSED_KEY, collapsed ? 'true' : 'false');
}

export function readSidebarSections() {
    try {
        return JSON.parse(localStorage.getItem(SIDEBAR_SECTIONS_KEY) || '{}');
    } catch {
        return {};
    }
}

export function writeSidebarSection(sectionId, collapsed) {
    const map = readSidebarSections();
    if (collapsed) map[sectionId] = true;
    else delete map[sectionId];
    localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(map));
}

export function readNotesListSort() {
    try {
        const stored = JSON.parse(localStorage.getItem(NOTES_LIST_SORT_KEY) || 'null');
        if (stored?.field === 'title' || stored?.field === 'date') {
            return {
                field: stored.field,
                dir: stored.dir === 'asc' ? 'asc' : 'desc'
            };
        }
    } catch {
        /* ignore */
    }
    return { ...DEFAULT_NOTES_LIST_SORT };
}

export function writeNotesListSort(sort) {
    localStorage.setItem(NOTES_LIST_SORT_KEY, JSON.stringify(sort));
}

export function readBoardSort() {
    try {
        const stored = JSON.parse(localStorage.getItem(BOARD_SORT_KEY) || 'null');
        if (!stored || typeof stored !== 'object') return { ...DEFAULT_BOARD_SORT };
        const direction = stored.direction === 'vertical' ? 'vertical' : 'horizontal';
        const field = ['date', 'name', 'category', 'edited'].includes(stored.field)
            ? stored.field
            : DEFAULT_BOARD_SORT.field;
        const dir = stored.dir === 'asc' ? 'asc' : 'desc';
        const cascade = stored.cascade === true;
        return { direction, field, dir, cascade };
    } catch {
        return { ...DEFAULT_BOARD_SORT };
    }
}

export function writeBoardSort(sort) {
    localStorage.setItem(BOARD_SORT_KEY, JSON.stringify(sort));
}

export function isBoardSortCustomized(sort = readBoardSort()) {
    return sort.direction !== DEFAULT_BOARD_SORT.direction
        || sort.field !== DEFAULT_BOARD_SORT.field
        || sort.dir !== DEFAULT_BOARD_SORT.dir
        || sort.cascade === true;
}

export function readSidebarWidth() {
    const raw = parseFloat(localStorage.getItem(SIDEBAR_WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function writeSidebarWidth(width) {
    if (!Number.isFinite(width) || width <= 0) {
        localStorage.removeItem(SIDEBAR_WIDTH_KEY);
        return;
    }
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width)));
}

export function readSidebarPrefs() {
    return {
        panelCollapsed: readPanelCollapsed(),
        sections: readSidebarSections(),
        notesListSort: readNotesListSort(),
        boardSort: readBoardSort(),
        moduleDocks: readAllModuleDocks(),
        sidebarWidth: readSidebarWidth()
    };
}
