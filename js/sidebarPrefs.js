export const PANEL_COLLAPSED_KEY = 'matrix_panel_collapsed';
export const SIDEBAR_SECTIONS_KEY = 'matrix_sidebar_sections';
export const NOTES_LIST_SORT_KEY = 'matrix_notes_list_sort';
export const QUICK_ACTIONS_DOCK_KEY = 'matrix_quick_actions_dock';
export const TOOLS_DOCK_KEY = 'matrix_tools_dock';
export const SIDEBAR_WIDTH_KEY = 'matrix_sidebar_width';

export const SIDEBAR_DEFAULT_WIDTH = 220;
/** 33% below prior 160px floor — narrower drag allowed */
export const SIDEBAR_MIN_WIDTH = Math.round(160 * (1 - 1 / 3));

export const SIDEBAR_BACKUP_KEYS = [
    PANEL_COLLAPSED_KEY,
    SIDEBAR_SECTIONS_KEY,
    NOTES_LIST_SORT_KEY,
    QUICK_ACTIONS_DOCK_KEY,
    TOOLS_DOCK_KEY,
    SIDEBAR_WIDTH_KEY
];

const DEFAULT_NOTES_LIST_SORT = { field: 'date', dir: 'desc' };

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

export function readQuickActionsDock() {
    try {
        const raw = JSON.parse(localStorage.getItem(QUICK_ACTIONS_DOCK_KEY) || 'null');
        if (!raw || typeof raw !== 'object') {
            return { docked: true, x: null, y: null };
        }
        return {
            docked: raw.docked !== false,
            x: Number.isFinite(raw.x) ? raw.x : null,
            y: Number.isFinite(raw.y) ? raw.y : null
        };
    } catch {
        return { docked: true, x: null, y: null };
    }
}

export function writeQuickActionsDock(patch) {
    const next = { ...readQuickActionsDock(), ...patch };
    localStorage.setItem(QUICK_ACTIONS_DOCK_KEY, JSON.stringify(next));
}

export function readToolsDock() {
    try {
        const raw = JSON.parse(localStorage.getItem(TOOLS_DOCK_KEY) || 'null');
        if (!raw || typeof raw !== 'object') {
            return { docked: true, x: null, y: null };
        }
        return {
            docked: raw.docked !== false,
            x: Number.isFinite(raw.x) ? raw.x : null,
            y: Number.isFinite(raw.y) ? raw.y : null
        };
    } catch {
        return { docked: true, x: null, y: null };
    }
}

export function writeToolsDock(patch) {
    const next = { ...readToolsDock(), ...patch };
    localStorage.setItem(TOOLS_DOCK_KEY, JSON.stringify(next));
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
        quickActionsDock: readQuickActionsDock(),
        toolsDock: readToolsDock(),
        sidebarWidth: readSidebarWidth()
    };
}
