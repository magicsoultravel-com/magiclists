/** @module {"owns":"magicPlanner model — schema-bound schedule sheet + zoom prefs", "related":["plannerUi.js","plannerGantt.js","sheet.js","noteModel.js"]} */
import {
    cellKey,
    getCellValue,
    setCellValue,
    getColWidth,
    setColWidth,
    sheetGridTotalWidthPx,
    SHEET_MIN_ROWS,
    SHEET_DEFAULT_COL_WIDTH_PX,
    SHEET_MIN_COL_WIDTH_PX,
    SHEET_MAX_COL_WIDTH_PX,
    SHEET_ROW_HEAD_WIDTH_PX,
    SHEET_STRUCT_COL_WIDTH_PX
} from './sheet.js';

export const PLANNER_VERSION = 1;
export const PLANNER_DEFAULT_ROWS = 3;
export const PLANNER_ZOOM_LEVELS = Object.freeze(['day', 'week', 'month', 'year']);
export const PLANNER_DEFAULT_ZOOM = 'week';

/** Fixed column schema (locked — no add/remove cols). */
export const PLANNER_COLUMNS = Object.freeze([
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'start', label: 'Start', type: 'datetime' },
    { key: 'stop', label: 'Stop', type: 'datetime' },
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'comments', label: 'Comments', type: 'text' },
    { key: 'pred', label: 'Pred', type: 'pred' }
]);

export const PLANNER_COL_COUNT = PLANNER_COLUMNS.length;

const DEFAULT_COL_WIDTHS = Object.freeze([36, 108, 108, 72, 56, 72, 44]);

function clampColWidth(px) {
    const n = Number(px);
    if (!Number.isFinite(n)) return SHEET_DEFAULT_COL_WIDTH_PX;
    return Math.min(SHEET_MAX_COL_WIDTH_PX, Math.max(SHEET_MIN_COL_WIDTH_PX, Math.round(n)));
}

function ensurePlannerColWidths(sheet) {
    if (!sheet) return;
    if (!Array.isArray(sheet.colWidths)) sheet.colWidths = [];
    while (sheet.colWidths.length < PLANNER_COL_COUNT) {
        sheet.colWidths.push(DEFAULT_COL_WIDTHS[sheet.colWidths.length] ?? SHEET_DEFAULT_COL_WIDTH_PX);
    }
    if (sheet.colWidths.length > PLANNER_COL_COUNT) {
        sheet.colWidths.length = PLANNER_COL_COUNT;
    }
    sheet.colWidths = sheet.colWidths.map(clampColWidth);
}

/**
 * @param {number} [rows]
 * @returns {{ rows: number, cols: number, cells: object, colWidths: number[] }}
 */
export function createPlannerSheet(rows = PLANNER_DEFAULT_ROWS) {
    const sheet = {
        rows: Math.max(SHEET_MIN_ROWS, rows | 0 || PLANNER_DEFAULT_ROWS),
        cols: PLANNER_COL_COUNT,
        cells: {},
        colWidths: [...DEFAULT_COL_WIDTHS]
    };
    ensurePlannerColWidths(sheet);
    for (let r = 0; r < sheet.rows; r++) {
        setCellValue(sheet, r, 0, `P${r + 1}`);
    }
    return sheet;
}

/**
 * @param {{ zoom?: string }} [opts]
 * @returns {object}
 */
export function createEmptyPlanner(opts = {}) {
    return {
        version: PLANNER_VERSION,
        zoom: normalizePlannerZoom(opts.zoom),
        sheet: createPlannerSheet()
    };
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizePlannerZoom(raw) {
    const z = String(raw || '').toLowerCase();
    return PLANNER_ZOOM_LEVELS.includes(z) ? z : PLANNER_DEFAULT_ZOOM;
}

/**
 * Normalize a planner payload. Returns null for missing/invalid shells.
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizePlanner(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const sheetIn = raw.sheet && typeof raw.sheet === 'object' ? raw.sheet : null;
    if (!sheetIn) return null;

    const rows = Number.isFinite(sheetIn.rows) && sheetIn.rows >= SHEET_MIN_ROWS
        ? Math.floor(sheetIn.rows)
        : PLANNER_DEFAULT_ROWS;
    const cells = sheetIn.cells && typeof sheetIn.cells === 'object' ? { ...sheetIn.cells } : {};
    const sheet = {
        rows,
        cols: PLANNER_COL_COUNT,
        cells,
        colWidths: Array.isArray(sheetIn.colWidths) ? [...sheetIn.colWidths] : [...DEFAULT_COL_WIDTHS]
    };
    ensurePlannerColWidths(sheet);

    // Drop cells outside the locked schema / row count.
    for (const key of Object.keys(sheet.cells)) {
        const [rs, cs] = String(key).split(':');
        const r = Number(rs);
        const c = Number(cs);
        if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || r >= sheet.rows || c < 0 || c >= PLANNER_COL_COUNT) {
            delete sheet.cells[key];
            continue;
        }
        const v = sheet.cells[key]?.v;
        if (v == null || !String(v).trim()) delete sheet.cells[key];
        else sheet.cells[key] = { v: String(v) };
    }

    // Ensure every row has an ID.
    for (let r = 0; r < sheet.rows; r++) {
        if (!String(getCellValue(sheet, r, 0)).trim()) {
            setCellValue(sheet, r, 0, nextPlannerRowId(sheet, r));
        }
    }

    return {
        version: PLANNER_VERSION,
        zoom: normalizePlannerZoom(raw.zoom),
        sheet
    };
}

/**
 * True when planner has user-authored schedule data (not only auto IDs).
 * @param {unknown} planner
 * @returns {boolean}
 */
export function plannerHasContent(planner) {
    const sheet = planner?.sheet;
    if (!sheet?.cells) return false;
    for (const [key, cell] of Object.entries(sheet.cells)) {
        const text = String(cell?.v ?? '').trim();
        if (!text) continue;
        const col = Number(String(key).split(':')[1]);
        if (col === 0) continue; // ignore auto IDs
        return true;
    }
    return false;
}

/**
 * @param {object|null|undefined} item
 * @returns {boolean}
 */
export function ensurePlannerVisibleIfContent(item) {
    if (!item || !plannerHasContent(item.planner)) return false;
    if (item.plannerHidden === false) return false;
    item.plannerHidden = false;
    return true;
}

/**
 * Allocate next free Pn-style id for a row index (prefer P{row+1} if free).
 * @param {object} sheet
 * @param {number} [preferRow]
 * @returns {string}
 */
export function nextPlannerRowId(sheet, preferRow = -1) {
    const used = new Set();
    const rows = sheet?.rows || 0;
    for (let r = 0; r < rows; r++) {
        if (r === preferRow) continue;
        const id = String(getCellValue(sheet, r, 0)).trim();
        if (id) used.add(id.toLowerCase());
    }
    if (preferRow >= 0) {
        const preferred = `P${preferRow + 1}`;
        if (!used.has(preferred.toLowerCase())) return preferred;
    }
    let n = 1;
    while (used.has(`p${n}`)) n += 1;
    return `P${n}`;
}

/**
 * @param {object} planner
 */
export function addPlannerRow(planner) {
    if (!planner?.sheet) return;
    const sheet = planner.sheet;
    sheet.rows = (sheet.rows || 0) + 1;
    const r = sheet.rows - 1;
    setCellValue(sheet, r, 0, nextPlannerRowId(sheet, r));
}

/**
 * @param {object} planner
 * @returns {boolean}
 */
export function removePlannerRow(planner) {
    if (!planner?.sheet || (planner.sheet.rows || 1) <= SHEET_MIN_ROWS) return false;
    const sheet = planner.sheet;
    const last = sheet.rows - 1;
    if (sheet.cells) {
        for (const key of Object.keys(sheet.cells)) {
            const r = Number(String(key).split(':')[0]);
            if (r === last) delete sheet.cells[key];
        }
    }
    sheet.rows -= 1;
    return true;
}

/**
 * @param {object} sheet
 * @param {number} row
 * @param {string} key - column key
 * @returns {string}
 */
export function getPlannerField(sheet, row, key) {
    const col = PLANNER_COLUMNS.findIndex((c) => c.key === key);
    if (col < 0) return '';
    return String(getCellValue(sheet, row, col) ?? '');
}

/**
 * @param {object} sheet
 * @param {number} row
 * @param {string} key
 * @param {string} value
 */
export function setPlannerField(sheet, row, key, value) {
    const col = PLANNER_COLUMNS.findIndex((c) => c.key === key);
    if (col < 0) return;
    setCellValue(sheet, row, col, value);
}

/**
 * Parse predecessor cell into ID tokens.
 * @param {string} raw
 * @returns {string[]}
 */
export function parsePredecessorIds(raw) {
    return String(raw || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * Derive Gantt tasks from planner sheet rows.
 * @param {object|null|undefined} planner
 * @returns {Array<{ row: number, id: string, start: string, stop: string, name: string, category: string, comments: string, predecessors: string[] }>}
 */
export function derivePlannerTasks(planner) {
    const sheet = planner?.sheet;
    if (!sheet) return [];
    const tasks = [];
    for (let r = 0; r < (sheet.rows || 0); r++) {
        const id = getPlannerField(sheet, r, 'id').trim();
        const start = getPlannerField(sheet, r, 'start').trim();
        const stop = getPlannerField(sheet, r, 'stop').trim();
        const name = getPlannerField(sheet, r, 'name').trim();
        const category = getPlannerField(sheet, r, 'category').trim();
        const comments = getPlannerField(sheet, r, 'comments').trim();
        const predecessors = parsePredecessorIds(getPlannerField(sheet, r, 'pred'));
        // Skip blank/auto-ID-only rows — IDs alone are not schedule content.
        if (!start && !stop && !name && !category && !comments && !predecessors.length) continue;
        tasks.push({ row: r, id, start, stop, name, category, comments, predecessors });
    }
    return tasks;
}

export {
    cellKey,
    getCellValue,
    setCellValue,
    getColWidth,
    setColWidth,
    sheetGridTotalWidthPx,
    ensurePlannerColWidths,
    SHEET_MIN_ROWS,
    SHEET_ROW_HEAD_WIDTH_PX,
    SHEET_STRUCT_COL_WIDTH_PX,
    clampColWidth
};
