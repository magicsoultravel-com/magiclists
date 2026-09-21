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
import { parsePlannerDateTime } from './plannerGantt.js';

export const PLANNER_VERSION = 2;
export const PLANNER_DEFAULT_ROWS = 3;
export const PLANNER_ZOOM_LEVELS = Object.freeze(['day', 'week', 'month', 'year']);
export const PLANNER_DEFAULT_ZOOM = 'week';

/** Fixed column schema v2 (locked — no add/remove cols). Row numbers replace ID. */
export const PLANNER_COLUMNS = Object.freeze([
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'category', label: 'Category', type: 'category' },
    { key: 'start', label: 'Start', type: 'datetime' },
    { key: 'stop', label: 'Stop', type: 'datetime' },
    { key: 'pred', label: 'Pred', type: 'pred' },
    { key: 'comments', label: 'Comments', type: 'text' }
]);

export const PLANNER_COL_COUNT = PLANNER_COLUMNS.length;

/** Old v1 column keys (for migration). */
const V1_COLUMNS = Object.freeze(['id', 'start', 'stop', 'name', 'category', 'comments', 'pred']);

const DEFAULT_COL_WIDTHS = Object.freeze([90, 72, 108, 108, 44, 80]);

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
        chartCollapsed: false,
        categoryColors: {},
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
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalizeCategoryColors(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const name = String(k || '').trim();
        const hex = String(v || '').trim();
        if (!name || !/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
        out[name] = hex;
    }
    return out;
}

function getRawCell(cells, row, col) {
    return String(cells?.[`${row}:${col}`]?.v ?? '').trim();
}

/**
 * Migrate a v1 (7-col with ID) sheet into v2 layout.
 * @param {object} sheetIn
 * @returns {{ rows: number, cells: object, colWidths: number[] }}
 */
function migrateV1Sheet(sheetIn) {
    const rows = Number.isFinite(sheetIn.rows) && sheetIn.rows >= SHEET_MIN_ROWS
        ? Math.floor(sheetIn.rows)
        : PLANNER_DEFAULT_ROWS;
    const oldCells = sheetIn.cells && typeof sheetIn.cells === 'object' ? sheetIn.cells : {};
    const idToRow = new Map();
    for (let r = 0; r < rows; r++) {
        const id = getRawCell(oldCells, r, 0);
        if (id) idToRow.set(id.toLowerCase(), String(r + 1));
    }

    const cells = {};
    const v2Keys = PLANNER_COLUMNS.map((c) => c.key);
    for (let r = 0; r < rows; r++) {
        for (let newCol = 0; newCol < PLANNER_COL_COUNT; newCol++) {
            const key = v2Keys[newCol];
            const oldCol = V1_COLUMNS.indexOf(key);
            if (oldCol < 0) continue;
            let val = getRawCell(oldCells, r, oldCol);
            if (key === 'pred' && val) {
                val = parsePredecessorIds(val)
                    .map((tok) => {
                        const asNum = Number(tok);
                        if (Number.isFinite(asNum) && asNum >= 1) return String(Math.floor(asNum));
                        return idToRow.get(tok.toLowerCase()) || tok;
                    })
                    .join(', ');
            }
            if (val) cells[`${r}:${newCol}`] = { v: val };
        }
    }
    return { rows, cells, colWidths: [...DEFAULT_COL_WIDTHS] };
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

    const version = Number(raw.version) || 1;
    let rows;
    let cells;
    let colWidths;

    const looksLikeV1 = version < 2
        || (Number.isFinite(sheetIn.cols) && sheetIn.cols === 7)
        || (Array.isArray(sheetIn.colWidths) && sheetIn.colWidths.length === 7);

    if (looksLikeV1) {
        ({ rows, cells, colWidths } = migrateV1Sheet(sheetIn));
    } else {
        rows = Number.isFinite(sheetIn.rows) && sheetIn.rows >= SHEET_MIN_ROWS
            ? Math.floor(sheetIn.rows)
            : PLANNER_DEFAULT_ROWS;
        cells = sheetIn.cells && typeof sheetIn.cells === 'object' ? { ...sheetIn.cells } : {};
        colWidths = Array.isArray(sheetIn.colWidths) ? [...sheetIn.colWidths] : [...DEFAULT_COL_WIDTHS];
    }

    const sheet = {
        rows,
        cols: PLANNER_COL_COUNT,
        cells,
        colWidths
    };
    ensurePlannerColWidths(sheet);

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

    return {
        version: PLANNER_VERSION,
        zoom: normalizePlannerZoom(raw.zoom),
        chartCollapsed: !!raw.chartCollapsed,
        categoryColors: normalizeCategoryColors(raw.categoryColors),
        sheet
    };
}

/**
 * True when planner has user-authored schedule data.
 * @param {unknown} planner
 * @returns {boolean}
 */
export function plannerHasContent(planner) {
    const sheet = planner?.sheet;
    if (!sheet?.cells) return false;
    return Object.values(sheet.cells).some((cell) => String(cell?.v ?? '').trim());
}

/**
 * @deprecated Hide-with-data is intentional; do not force-unhide on content.
 * Kept as a no-op so older call sites stay safe.
 * @returns {boolean}
 */
export function ensurePlannerVisibleIfContent() {
    return false;
}

/**
 * @param {object} planner
 */
export function addPlannerRow(planner) {
    if (!planner?.sheet) return;
    planner.sheet.rows = (planner.sheet.rows || 0) + 1;
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
    // Drop preds that pointed at the removed last row.
    const predCol = PLANNER_COLUMNS.findIndex((c) => c.key === 'pred');
    for (let r = 0; r < sheet.rows - 1; r++) {
        const raw = getCellValue(sheet, r, predCol);
        if (!raw) continue;
        const next = parsePredecessorIds(raw)
            .map((tok) => Number(tok))
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= last)
            .map(String)
            .join(', ');
        setCellValue(sheet, r, predCol, next);
    }
    sheet.rows -= 1;
    return true;
}

/**
 * Move a planner row from fromIndex to toIndex and remap Pred row numbers.
 * @param {object} planner
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {boolean}
 */
export function movePlannerRow(planner, fromIndex, toIndex) {
    const sheet = planner?.sheet;
    if (!sheet) return false;
    const rows = sheet.rows || 0;
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return false;
    if (fromIndex < 0 || fromIndex >= rows || toIndex < 0 || toIndex >= rows) return false;
    if (fromIndex === toIndex) return false;

    const order = Array.from({ length: rows }, (_, i) => i);
    const [moved] = order.splice(fromIndex, 1);
    order.splice(toIndex, 0, moved);

    // oldRow -> new 1-based number
    const remap = new Map();
    order.forEach((oldRow, newRow) => remap.set(oldRow + 1, newRow + 1));

    const nextCells = {};
    const predCol = PLANNER_COLUMNS.findIndex((c) => c.key === 'pred');
    for (let newRow = 0; newRow < rows; newRow++) {
        const oldRow = order[newRow];
        for (let c = 0; c < PLANNER_COL_COUNT; c++) {
            let val = getCellValue(sheet, oldRow, c);
            if (c === predCol && val) {
                val = parsePredecessorIds(val)
                    .map((tok) => {
                        const n = Number(tok);
                        if (!Number.isFinite(n)) return tok;
                        return String(remap.get(n) || n);
                    })
                    .join(', ');
            }
            if (String(val || '').trim()) nextCells[`${newRow}:${c}`] = { v: String(val) };
        }
    }
    sheet.cells = nextCells;
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
 * Parse predecessor cell into tokens (row numbers as strings).
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
 * Unique category names used in this planner (for datalist reuse).
 * @param {object|null|undefined} planner
 * @returns {string[]}
 */
export function listPlannerCategories(planner) {
    const sheet = planner?.sheet;
    if (!sheet) return [];
    const seen = new Set();
    const out = [];
    for (let r = 0; r < (sheet.rows || 0); r++) {
        const name = getPlannerField(sheet, r, 'category').trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
    }
    return out;
}

/**
 * @param {object} planner
 * @param {string} categoryName
 * @returns {string}
 */
export function getCategoryColor(planner, categoryName) {
    const name = String(categoryName || '').trim();
    if (!name) return '';
    const map = planner?.categoryColors || {};
    if (map[name]) return map[name];
    // Case-insensitive fallback
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(map)) {
        if (k.toLowerCase() === lower) return v;
    }
    return '';
}

/**
 * @param {object} planner
 * @param {string} categoryName
 * @param {string} hex
 */
export function setCategoryColor(planner, categoryName, hex) {
    if (!planner) return;
    const name = String(categoryName || '').trim();
    if (!name || !/^#[0-9a-fA-F]{6}$/.test(hex)) return;
    if (!planner.categoryColors || typeof planner.categoryColors !== 'object') {
        planner.categoryColors = {};
    }
    // Replace any prior case-variant key
    for (const k of Object.keys(planner.categoryColors)) {
        if (k.toLowerCase() === name.toLowerCase()) delete planner.categoryColors[k];
    }
    planner.categoryColors[name] = hex;
}

/**
 * Derive Gantt tasks from planner sheet rows.
 * `id` is the 1-based row number (string) for pred edges.
 * @param {object|null|undefined} planner
 * @returns {Array<{ row: number, id: string, start: string, stop: string, name: string, category: string, categoryColor: string, comments: string, predecessors: string[] }>}
 */
export function derivePlannerTasks(planner) {
    const sheet = planner?.sheet;
    if (!sheet) return [];
    const tasks = [];
    for (let r = 0; r < (sheet.rows || 0); r++) {
        const start = getPlannerField(sheet, r, 'start').trim();
        const stop = getPlannerField(sheet, r, 'stop').trim();
        const name = getPlannerField(sheet, r, 'name').trim();
        const category = getPlannerField(sheet, r, 'category').trim();
        const comments = getPlannerField(sheet, r, 'comments').trim();
        const predecessors = parsePredecessorIds(getPlannerField(sheet, r, 'pred'));
        if (!start && !stop && !name && !category && !comments && !predecessors.length) continue;
        tasks.push({
            row: r,
            id: String(r + 1),
            start,
            stop,
            name,
            category,
            categoryColor: getCategoryColor(planner, category),
            comments,
            predecessors
        });
    }
    return tasks;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addLocalDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
}

function calendarDaysInclusive(a, b) {
    const start = startOfLocalDay(a);
    const end = startOfLocalDay(b);
    if (end < start) return 0;
    return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function workingDaysInclusive(a, b) {
    let d = startOfLocalDay(a);
    const end = startOfLocalDay(b);
    if (end < d) return 0;
    let count = 0;
    while (d <= end) {
        const day = d.getDay();
        if (day !== 0 && day !== 6) count += 1;
        d = addLocalDays(d, 1);
    }
    return count;
}

function formatScheduleLabel(raw) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
        const [date, time] = s.split('T');
        return `${date} ${time.slice(0, 5)}`;
    }
    return s;
}

/**
 * Overall schedule span across all planner rows: earliest Start, latest Stop,
 * plus inclusive calendar / Mon–Fri working duration.
 * @param {object|null|undefined} planner
 * @returns {{ startLabel: string, stopLabel: string, calendarDays: number|null, workingDays: number|null } | null}
 */
export function summarizePlannerSchedule(planner) {
    const tasks = derivePlannerTasks(planner);
    let earliest = null;
    let latest = null;
    for (const task of tasks) {
        const start = parsePlannerDateTime(task.start);
        if (start && (!earliest || start.getTime() < earliest.date.getTime())) {
            earliest = { date: start, raw: task.start };
        }
        const stop = parsePlannerDateTime(task.stop);
        if (stop && (!latest || stop.getTime() > latest.date.getTime())) {
            latest = { date: stop, raw: task.stop };
        }
    }
    if (!earliest && !latest) return null;

    let calendarDays = null;
    let workingDays = null;
    if (earliest && latest) {
        calendarDays = calendarDaysInclusive(earliest.date, latest.date);
        workingDays = workingDaysInclusive(earliest.date, latest.date);
    }

    return {
        startLabel: earliest ? formatScheduleLabel(earliest.raw) : '',
        stopLabel: latest ? formatScheduleLabel(latest.raw) : '',
        calendarDays,
        workingDays
    };
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
