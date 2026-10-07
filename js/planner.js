/** @module {"owns":"magicPlanner model — schema-bound schedule sheet + zoom prefs", "related":["plannerUi.js","plannerGantt.js","plannerKanban.js","plannerWbs.js","plannerCalendar.js","sheet.js","noteModel.js"]} */
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
import {
    normalizeKanbanSort,
    normalizeKanbanSortDir,
    normalizeKanbanStageById,
    normalizeKanbanOrderByStage,
    normalizeKanbanCardColors,
    normalizeKanbanEmphasisById,
    normalizeKanbanCollapsedById,
    normalizeKanbanCollapsedByStage,
    pruneKanbanAfterRowRemove,
    pruneKanbanOrphanKeys
} from './plannerKanban.js';
import {
    WBS_DEFAULT_PHASE_LABELS,
    WBS_DEFAULT_DELIVERABLE_LABELS,
    normalizeWbsMode,
    normalizeWbsLabels,
    normalizeWbsBucketById,
    normalizeWbsOrderByBucket,
    normalizeWbsCollapsedByBucket,
    normalizeWbsBucketColors,
    pruneWbsAfterRowRemove
} from './plannerWbs.js';

export const PLANNER_VERSION = 3;
export const PLANNER_DEFAULT_ROWS = 3;
export const PLANNER_ZOOM_LEVELS = Object.freeze(['day', 'week', 'month', 'quarter', 'year']);
export const PLANNER_DEFAULT_ZOOM = 'week';
export const PLANNER_CHART_VIEWS = Object.freeze(['gantt', 'calendar']);
export const PLANNER_DEFAULT_CHART_VIEW = 'gantt';

export const PLANNER_DEFAULT_LABEL_WIDTH = 120;
export const PLANNER_MIN_LABEL_WIDTH = 48;
export const PLANNER_MAX_LABEL_WIDTH = 280;

export const PLANNER_TODAY_LINE_STYLES = Object.freeze(['solid', 'dashed', 'dotted']);
export const PLANNER_TODAY_LINE_THICKNESSES = Object.freeze([1, 1.25, 2, 3]);
export const PLANNER_DEFAULT_TODAY_LINE = Object.freeze({
    color: '#e11d48',
    style: 'dashed',
    thickness: 1.25
});

/** Fixed column schema v2+ (locked — no add/remove cols). Stable rowIds replace positional identity. */
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

const DEFAULT_COL_WIDTHS = Object.freeze([90, 72, 92, 92, 44, 80]);

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
 * @param {number} count
 * @param {number} [startAt=1]
 * @returns {{ rowIds: string[], nextRowId: number }}
 */
export function allocatePlannerRowIds(count, startAt = 1) {
    const n = Math.max(0, Number(count) || 0);
    let next = Math.max(1, Math.floor(Number(startAt) || 1));
    const rowIds = [];
    for (let i = 0; i < n; i++) {
        rowIds.push(String(next));
        next += 1;
    }
    return { rowIds, nextRowId: next };
}

/**
 * @param {object} planner
 * @returns {string}
 */
export function allocPlannerRowId(planner) {
    if (!planner) return '1';
    let next = Math.max(1, Math.floor(Number(planner.nextRowId) || 1));
    const id = String(next);
    planner.nextRowId = next + 1;
    return id;
}

/**
 * @param {unknown} raw
 * @returns {number}
 */
export function normalizePlannerLabelWidth(raw) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return PLANNER_DEFAULT_LABEL_WIDTH;
    return Math.min(PLANNER_MAX_LABEL_WIDTH, Math.max(PLANNER_MIN_LABEL_WIDTH, Math.round(n)));
}

/**
 * @param {unknown} raw
 * @returns {{ color: string, style: string, thickness: number }}
 */
export function normalizeTodayLine(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    let color = String(src.color || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) color = PLANNER_DEFAULT_TODAY_LINE.color;
    const styleRaw = String(src.style || '').toLowerCase();
    const style = PLANNER_TODAY_LINE_STYLES.includes(styleRaw)
        ? styleRaw
        : PLANNER_DEFAULT_TODAY_LINE.style;
    const thicknessN = Number(src.thickness);
    const thickness = PLANNER_TODAY_LINE_THICKNESSES.includes(thicknessN)
        ? thicknessN
        : PLANNER_DEFAULT_TODAY_LINE.thickness;
    return { color, style, thickness };
}

function emptyHierarchyMaps() {
    return {
        rowLevelById: {},
        rowPackById: {},
        rowHiddenById: {},
        rowCollapsedById: {}
    };
}

function emptyWbsFields() {
    return {
        wbsMode: WBS_DEFAULT_MODE_SAFE,
        wbsPhaseLabels: [...WBS_DEFAULT_PHASE_LABELS],
        wbsDeliverableLabels: [...WBS_DEFAULT_DELIVERABLE_LABELS],
        wbsPhaseById: {},
        wbsDeliverableById: {},
        wbsPhaseOrderByBucket: {},
        wbsDeliverableOrderByBucket: {},
        wbsPhaseColorsByBucket: {},
        wbsDeliverableColorsByBucket: {},
        wbsCollapsed: false,
        wbsCollapsedByBucket: {},
        wbsCardColors: {},
        wbsEmphasisById: {},
        wbsCollapsedById: {}
    };
}

const WBS_DEFAULT_MODE_SAFE = 'phase';

/**
 * @param {{ zoom?: string }} [opts]
 * @returns {object}
 */
export function createEmptyPlanner(opts = {}) {
    const sheet = createPlannerSheet();
    const { rowIds, nextRowId } = allocatePlannerRowIds(sheet.rows);
    return {
        version: PLANNER_VERSION,
        zoom: normalizePlannerZoom(opts.zoom),
        chartView: normalizePlannerChartView(opts.chartView),
        chartCollapsed: false,
        tableCollapsed: false,
        kanbanCollapsed: false,
        chartHidden: false,
        kanbanHidden: false,
        wbsHidden: false,
        kanbanSort: 'row',
        kanbanSortDir: 'asc',
        kanbanStageById: {},
        kanbanOrderByStage: {},
        kanbanCardColors: {},
        kanbanEmphasisById: {},
        kanbanCollapsedById: {},
        kanbanCollapsedByStage: {},
        labelWidth: PLANNER_DEFAULT_LABEL_WIDTH,
        categoryColors: {},
        rowIds,
        nextRowId,
        ...emptyHierarchyMaps(),
        ...emptyWbsFields(),
        sheet
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
 * @returns {'gantt'|'calendar'}
 */
export function normalizePlannerChartView(raw) {
    const v = String(raw || '').toLowerCase();
    return PLANNER_CHART_VIEWS.includes(v) ? v : PLANNER_DEFAULT_CHART_VIEW;
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

/**
 * True when planner was written by a newer app build and must not be mutated.
 * @param {object|null|undefined} planner
 * @returns {boolean}
 */
export function isPlannerUnsupportedNewer(planner) {
    return !!(planner && planner.unsupportedNewer);
}

/**
 * @param {object|null|undefined} planner
 * @returns {boolean}
 */
export function isPlannerWritable(planner) {
    return !!(planner?.sheet) && !isPlannerUnsupportedNewer(planner);
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
                val = String(val)
                    .split(/[,;\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((tok) => {
                        const asNum = Number(tok);
                        if (Number.isFinite(asNum) && asNum >= 1) return String(Math.floor(asNum));
                        return idToRow.get(tok.toLowerCase()) || '';
                    })
                    .filter(Boolean)
                    .join(', ');
            }
            if (val) cells[`${r}:${newCol}`] = { v: val };
        }
    }
    return { rows, cells, colWidths: [...DEFAULT_COL_WIDTHS] };
}

/**
 * @param {unknown} raw
 * @param {string[]} rowIds
 * @returns {Record<string, number>}
 */
function normalizeRowLevelById(raw, rowIds) {
    if (!raw || typeof raw !== 'object') return {};
    const idSet = new Set(rowIds);
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const id = String(k || '');
        if (!idSet.has(id)) continue;
        const level = Number(v);
        if (!Number.isFinite(level)) continue;
        out[id] = Math.min(1, Math.max(0, Math.floor(level)));
    }
    return out;
}

/**
 * @param {unknown} raw
 * @param {string[]} rowIds
 * @returns {Record<string, true>}
 */
function normalizeTruthyIdMap(raw, rowIds) {
    if (!raw || typeof raw !== 'object') return {};
    const idSet = new Set(rowIds);
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const id = String(k || '');
        if (!idSet.has(id) || !v) continue;
        out[id] = true;
    }
    return out;
}

/**
 * Ensure child contiguity under packs; promote orphans.
 * @param {object} planner
 */
export function repairPlannerHierarchy(planner) {
    if (!planner?.sheet || !Array.isArray(planner.rowIds)) return;
    const rows = planner.sheet.rows || 0;
    const rowIds = planner.rowIds;
    if (!planner.rowLevelById) planner.rowLevelById = {};
    if (!planner.rowPackById) planner.rowPackById = {};
    if (!planner.rowHiddenById) planner.rowHiddenById = {};
    if (!planner.rowCollapsedById) planner.rowCollapsedById = {};

    for (let r = 0; r < rows; r++) {
        const id = String(rowIds[r] || '');
        if (!id) continue;
        let level = Number(planner.rowLevelById[id]) || 0;
        if (level > 1) level = 1;
        if (level < 0) level = 0;
        if (level === 1) {
            const prevId = r > 0 ? String(rowIds[r - 1] || '') : '';
            const prevLevel = prevId ? (Number(planner.rowLevelById[prevId]) || 0) : 0;
            const prevPack = prevId && planner.rowPackById[prevId];
            const prevIsChild = prevLevel === 1;
            // Valid if previous is pack root, or previous is a sibling child under a pack.
            let ok = false;
            if (prevPack && prevLevel === 0) ok = true;
            else if (prevIsChild) {
                // Walk back to pack
                for (let i = r - 1; i >= 0; i--) {
                    const pid = String(rowIds[i] || '');
                    const pl = Number(planner.rowLevelById[pid]) || 0;
                    if (pl === 0) {
                        ok = !!(planner.rowPackById[pid]);
                        break;
                    }
                }
            }
            if (!ok) {
                level = 0;
                delete planner.rowPackById[id];
            } else {
                delete planner.rowPackById[id]; // children never packs
            }
        } else {
            // root
            if (!planner.rowPackById[id]) delete planner.rowPackById[id];
        }
        if (level === 0) {
            if (planner.rowLevelById[id]) delete planner.rowLevelById[id];
        } else {
            planner.rowLevelById[id] = 1;
        }
    }
}

/**
 * @param {object} planner
 */
export function assertPlannerRowIdInvariant(planner) {
    if (!planner?.sheet || !Array.isArray(planner.rowIds)) return;
    if (planner.rowIds.length !== (planner.sheet.rows || 0)) {
        // Repair length mismatch by reallocating missing ids
        while (planner.rowIds.length < planner.sheet.rows) {
            planner.rowIds.push(allocPlannerRowId(planner));
        }
        if (planner.rowIds.length > planner.sheet.rows) {
            planner.rowIds.length = planner.sheet.rows;
        }
    }
    pruneKanbanOrphanKeys(planner);
    pruneWbsAfterRowRemove(planner, []);
    // prune hierarchy orphans
    const idSet = new Set(planner.rowIds.map(String));
    for (const map of [planner.rowLevelById, planner.rowPackById, planner.rowHiddenById, planner.rowCollapsedById]) {
        if (!map || typeof map !== 'object') continue;
        for (const key of Object.keys(map)) {
            if (!idSet.has(key)) delete map[key];
        }
    }
    // Also prune WBS orphans against current ids
    const gone = [];
    for (const mapKey of ['wbsPhaseById', 'wbsDeliverableById']) {
        const map = planner[mapKey];
        if (!map || typeof map !== 'object') continue;
        for (const key of Object.keys(map)) {
            if (!idSet.has(key)) gone.push(key);
        }
    }
    if (gone.length) pruneWbsAfterRowRemove(planner, gone);
    repairPlannerHierarchy(planner);
}

/**
 * Outline labels: roots 1,2,3… children 1a,1b…
 * @param {object|null|undefined} planner
 * @returns {string[]}
 */
export function buildPlannerOutlineLabels(planner) {
    const rows = planner?.sheet?.rows || 0;
    const rowIds = Array.isArray(planner?.rowIds) ? planner.rowIds : [];
    const labels = Array.from({ length: rows }, () => '');
    let rootNum = 0;
    let childOrd = 0;
    for (let r = 0; r < rows; r++) {
        const id = String(rowIds[r] || '');
        const level = id ? (Number(planner?.rowLevelById?.[id]) || 0) : 0;
        if (level === 0) {
            rootNum += 1;
            childOrd = 0;
            labels[r] = String(rootNum);
        } else {
            childOrd += 1;
            const letter = childOrd <= 26
                ? String.fromCharCode(96 + childOrd)
                : `z${childOrd}`;
            labels[r] = `${rootNum}${letter}`;
        }
    }
    return labels;
}

/**
 * @param {object|null|undefined} planner
 * @param {number} row
 * @returns {string}
 */
export function getPlannerOutlineLabel(planner, row) {
    return buildPlannerOutlineLabels(planner)[row] || String((Number(row) || 0) + 1);
}

/**
 * Map outline token (1, 1a) → current 1-based display is the token itself for authorship.
 * Resolve outline → row index.
 * @param {object|null|undefined} planner
 * @param {string} token
 * @returns {number} row index or -1
 */
export function findPlannerRowByOutline(planner, token) {
    const t = String(token || '').trim().toLowerCase();
    if (!t) return -1;
    const labels = buildPlannerOutlineLabels(planner);
    return labels.findIndex((l) => String(l).toLowerCase() === t);
}

/**
 * @param {object|null|undefined} planner
 * @param {number} row
 * @returns {string}
 */
export function getPlannerRowId(planner, row) {
    const id = planner?.rowIds?.[row];
    return id != null ? String(id) : '';
}

/**
 * @param {object|null|undefined} planner
 * @param {string} rowId
 * @returns {number}
 */
export function findPlannerRowById(planner, rowId) {
    if (!planner?.rowIds || !rowId) return -1;
    return planner.rowIds.indexOf(String(rowId));
}

/**
 * @param {object|null|undefined} planner
 * @param {number} row
 * @returns {boolean}
 */
export function isPlannerRowPack(planner, row) {
    const id = getPlannerRowId(planner, row);
    return !!(id && planner?.rowPackById?.[id]);
}

/**
 * @param {object|null|undefined} planner
 * @param {number} row
 * @returns {number}
 */
export function getPlannerRowLevel(planner, row) {
    const id = getPlannerRowId(planner, row);
    if (!id) return 0;
    return Math.min(1, Math.max(0, Number(planner?.rowLevelById?.[id]) || 0));
}

/**
 * @param {object|null|undefined} planner
 * @param {number} row
 * @returns {boolean}
 */
export function isPlannerRowHidden(planner, row) {
    const id = getPlannerRowId(planner, row);
    return !!(id && planner?.rowHiddenById?.[id]);
}

/**
 * Contiguous block starting at row (pack + children, or single row).
 * @param {object} planner
 * @param {number} row
 * @returns {{ start: number, end: number }} end exclusive
 */
export function getPlannerRowBlock(planner, row) {
    const rows = planner?.sheet?.rows || 0;
    if (!Number.isFinite(row) || row < 0 || row >= rows) return { start: 0, end: 0 };
    const level = getPlannerRowLevel(planner, row);
    if (level === 1) return { start: row, end: row + 1 };
    if (!isPlannerRowPack(planner, row)) return { start: row, end: row + 1 };
    let end = row + 1;
    while (end < rows && getPlannerRowLevel(planner, end) === 1) end += 1;
    return { start: row, end };
}

/**
 * Walk back from a level-1 child to its pack parent row index.
 * @param {object|null|undefined} planner
 * @param {number} row
 * @returns {number} pack parent row, or -1 if not a child under a pack
 */
export function getPlannerPackParentRow(planner, row) {
    if (!planner || !Number.isFinite(row) || row < 0) return -1;
    if (getPlannerRowLevel(planner, row) !== 1) return -1;
    let packRow = row - 1;
    while (packRow >= 0 && getPlannerRowLevel(planner, packRow) === 1) packRow -= 1;
    if (packRow < 0 || !isPlannerRowPack(planner, packRow)) return -1;
    return packRow;
}

/**
 * Copy pack parent category onto every child in the pack block.
 * @param {object} planner
 * @param {number} packRow
 * @returns {boolean}
 */
export function syncPlannerPackChildCategories(planner, packRow) {
    if (!planner?.sheet || !isPlannerRowPack(planner, packRow)) return false;
    if (getPlannerRowLevel(planner, packRow) === 1) return false;
    const { start, end } = getPlannerRowBlock(planner, packRow);
    if (end <= start + 1) return false;
    const category = getPlannerField(planner.sheet, packRow, 'category');
    for (let r = start + 1; r < end; r++) {
        setPlannerField(planner.sheet, r, 'category', category);
    }
    return true;
}

/**
 * Insert a blank row at index, shifting later rows down. Returns new row id.
 * @param {object} planner
 * @param {number} index
 * @returns {string}
 */
export function insertPlannerRowAt(planner, index) {
    if (!planner?.sheet) return '';
    const sheet = planner.sheet;
    const rows = sheet.rows || 0;
    const at = Math.max(0, Math.min(rows, Math.floor(Number(index) || 0)));
    const newId = allocPlannerRowId(planner);

    const nextCells = {};
    for (const key of Object.keys(sheet.cells || {})) {
        const [rs, cs] = String(key).split(':');
        const r = Number(rs);
        const c = Number(cs);
        if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
        const newR = r >= at ? r + 1 : r;
        nextCells[`${newR}:${c}`] = sheet.cells[key];
    }
    sheet.cells = nextCells;
    sheet.rows = rows + 1;

    if (!Array.isArray(planner.rowIds)) planner.rowIds = [];
    planner.rowIds.splice(at, 0, newId);
    assertPlannerRowIdInvariant(planner);
    return newId;
}

/**
 * Toggle single ↔ work pack at row.
 * Parent-only; convert creates an empty pack (no parked-hidden child).
 * @param {object} planner
 * @param {number} row
 * @returns {boolean}
 */
export function togglePlannerWorkPack(planner, row) {
    if (!isPlannerWritable(planner)) return false;
    const rows = planner.sheet.rows || 0;
    if (!Number.isFinite(row) || row < 0 || row >= rows) return false;
    if (getPlannerRowLevel(planner, row) === 1) return false;

    const id = getPlannerRowId(planner, row);
    if (!id) return false;
    if (!planner.rowPackById) planner.rowPackById = {};
    if (!planner.rowLevelById) planner.rowLevelById = {};
    if (!planner.rowHiddenById) planner.rowHiddenById = {};

    if (planner.rowPackById[id]) {
        // Pack → single: promote children
        const { start, end } = getPlannerRowBlock(planner, row);
        for (let r = start + 1; r < end; r++) {
            const cid = getPlannerRowId(planner, r);
            if (!cid) continue;
            delete planner.rowLevelById[cid];
            delete planner.rowHiddenById[cid];
        }
        delete planner.rowPackById[id];
        delete planner.rowCollapsedById?.[id];
        assertPlannerRowIdInvariant(planner);
        return true;
    }

    // Single → pack: mark parent only (children added via pack +/−).
    planner.rowPackById[id] = true;
    assertPlannerRowIdInvariant(planner);
    return true;
}

/**
 * Insert a blank child line under a pack parent.
 * @param {object} planner
 * @param {number} packRow - pack parent row index
 * @returns {string} new child row id or ''
 */
export function addPlannerPackChild(planner, packRow) {
    if (!isPlannerWritable(planner)) return '';
    if (!isPlannerRowPack(planner, packRow)) return '';
    if (getPlannerRowLevel(planner, packRow) === 1) return '';
    const { end } = getPlannerRowBlock(planner, packRow);
    const childId = insertPlannerRowAt(planner, end);
    if (!childId) return '';
    if (!planner.rowLevelById) planner.rowLevelById = {};
    planner.rowLevelById[childId] = 1;
    // Expanding to add a line — clear pack collapse so the new child is visible.
    delete planner.rowCollapsedById?.[getPlannerRowId(planner, packRow)];
    // Children inherit the pack parent's category.
    const childRow = end;
    setPlannerField(planner.sheet, childRow, 'category', getPlannerField(planner.sheet, packRow, 'category'));
    assertPlannerRowIdInvariant(planner);
    return childId;
}

/**
 * Remove the last child of a pack (pack-scoped −).
 * @param {object} planner
 * @param {number} packRow
 * @returns {boolean}
 */
export function removePlannerPackChild(planner, packRow) {
    if (!isPlannerWritable(planner)) return false;
    if (!isPlannerRowPack(planner, packRow)) return false;
    const { start, end } = getPlannerRowBlock(planner, packRow);
    if (end <= start + 1) return false; // no children
    const childRow = end - 1;
    const removedId = getPlannerRowId(planner, childRow);
    const sheet = planner.sheet;
    if (!sheet) return false;

    const removedOutline = getPlannerOutlineLabel(planner, childRow);
    const predCol = PLANNER_COLUMNS.findIndex((c) => c.key === 'pred');
    for (let r = 0; r < sheet.rows; r++) {
        if (r === childRow) continue;
        const raw = getCellValue(sheet, r, predCol);
        if (!raw) continue;
        const next = parsePredecessorIds(raw)
            .filter((tok) => String(tok).toLowerCase() !== String(removedOutline).toLowerCase())
            .join(', ');
        setCellValue(sheet, r, predCol, next);
    }

    const nextCells = {};
    for (const key of Object.keys(sheet.cells || {})) {
        const [rs, cs] = String(key).split(':');
        const r = Number(rs);
        const c = Number(cs);
        if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
        if (r === childRow) continue;
        const newR = r > childRow ? r - 1 : r;
        nextCells[`${newR}:${c}`] = sheet.cells[key];
    }
    sheet.cells = nextCells;

    if (removedId) {
        pruneKanbanAfterRowRemove(planner, [removedId]);
        pruneWbsAfterRowRemove(planner, [removedId]);
        for (const map of [planner.rowLevelById, planner.rowPackById, planner.rowHiddenById, planner.rowCollapsedById]) {
            if (map) delete map[removedId];
        }
    }
    if (Array.isArray(planner.rowIds)) planner.rowIds.splice(childRow, 1);
    sheet.rows = Array.isArray(planner.rowIds) ? planner.rowIds.length : Math.max(SHEET_MIN_ROWS, (sheet.rows || 1) - 1);
    assertPlannerRowIdInvariant(planner);
    return true;
}

/**
 * @param {object} planner
 * @param {number} row
 * @param {boolean} collapsed
 */
export function setPlannerPackCollapsed(planner, row, collapsed) {
    if (!planner || !isPlannerRowPack(planner, row)) return;
    const id = getPlannerRowId(planner, row);
    if (!id) return;
    if (!planner.rowCollapsedById) planner.rowCollapsedById = {};
    if (collapsed) planner.rowCollapsedById[id] = true;
    else delete planner.rowCollapsedById[id];
}

/**
 * @param {object|null|undefined} planner
 * @param {number} row
 * @returns {boolean}
 */
export function isPlannerPackCollapsed(planner, row) {
    const id = getPlannerRowId(planner, row);
    return !!(id && planner?.rowCollapsedById?.[id]);
}

/**
 * Unhide a row (e.g. after user edits name on a parked child).
 * @param {object} planner
 * @param {number} row
 */
export function unhidePlannerRow(planner, row) {
    const id = getPlannerRowId(planner, row);
    if (!id || !planner?.rowHiddenById) return;
    delete planner.rowHiddenById[id];
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
    if (version > PLANNER_VERSION) {
        return {
            unsupportedNewer: true,
            version,
            sheet: sheetIn,
            rowIds: Array.isArray(raw.rowIds) ? [...raw.rowIds] : [],
            nextRowId: Number(raw.nextRowId) || 1
        };
    }

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

    // Stable row ids
    let rowIds = Array.isArray(raw.rowIds) ? raw.rowIds.map(String) : [];
    let nextRowId = Math.max(1, Math.floor(Number(raw.nextRowId) || 1));
    if (rowIds.length !== sheet.rows) {
        const allocated = allocatePlannerRowIds(sheet.rows, nextRowId);
        // Prefer existing ids where possible
        const merged = [];
        for (let i = 0; i < sheet.rows; i++) {
            merged.push(rowIds[i] && String(rowIds[i]) ? String(rowIds[i]) : allocated.rowIds[i]);
        }
        // Ensure uniqueness
        const seen = new Set();
        for (let i = 0; i < merged.length; i++) {
            let id = merged[i];
            while (seen.has(id)) {
                id = String(nextRowId++);
            }
            seen.add(id);
            merged[i] = id;
            const n = Number(id);
            if (Number.isFinite(n) && n >= nextRowId) nextRowId = n + 1;
        }
        rowIds = merged;
    } else {
        for (const id of rowIds) {
            const n = Number(id);
            if (Number.isFinite(n) && n >= nextRowId) nextRowId = n + 1;
        }
    }

    // Kanban: accept legacy *ByRow / index keys. When only index-era fields exist,
    // force index→id (numeric rowIds would otherwise collide with index tokens).
    const idMapFilled = (map) => !!(map && typeof map === 'object' && Object.keys(map).length);
    const preferIndexKeys = version < 3
        || (!idMapFilled(raw.kanbanStageById) && !!raw.kanbanStageByRow)
        || (!idMapFilled(raw.kanbanEmphasisById) && !!raw.kanbanEmphasisByRow)
        || (!idMapFilled(raw.kanbanCollapsedById) && !!raw.kanbanCollapsedByRow);
    const mapOpts = preferIndexKeys ? { keysAreIndexes: true } : {};
    const legacyStage = idMapFilled(raw.kanbanStageById) ? raw.kanbanStageById : (raw.kanbanStageByRow || raw.kanbanStageById);
    const legacyEmphasis = idMapFilled(raw.kanbanEmphasisById)
        ? raw.kanbanEmphasisById
        : (raw.kanbanEmphasisByRow || raw.kanbanEmphasisById);
    const legacyCollapsed = idMapFilled(raw.kanbanCollapsedById)
        ? raw.kanbanCollapsedById
        : (raw.kanbanCollapsedByRow || raw.kanbanCollapsedById);
    const stageById = normalizeKanbanStageById(legacyStage, rowIds, mapOpts);
    const orderByStage = normalizeKanbanOrderByStage(raw.kanbanOrderByStage, rowIds, mapOpts);
    const cardColors = normalizeKanbanCardColors(raw.kanbanCardColors, rowIds, mapOpts);
    const emphasisById = normalizeKanbanEmphasisById(legacyEmphasis, rowIds, mapOpts);
    const collapsedById = normalizeKanbanCollapsedById(legacyCollapsed, rowIds, mapOpts);
    const collapsedByStage = normalizeKanbanCollapsedByStage(raw.kanbanCollapsedByStage);

    const nameCol = PLANNER_COLUMNS.findIndex((c) => c.key === 'name');
    const pruneEmptyNameKeys = (map) => {
        for (const key of Object.keys(map)) {
            const r = rowIds.indexOf(key);
            if (r < 0 || !getRawCell(sheet.cells, r, nameCol)) delete map[key];
        }
        return map;
    };
    pruneEmptyNameKeys(stageById);
    pruneEmptyNameKeys(cardColors);
    pruneEmptyNameKeys(emphasisById);
    pruneEmptyNameKeys(collapsedById);
    for (const key of Object.keys(orderByStage)) {
        const next = orderByStage[key].filter((id) => {
            const r = rowIds.indexOf(String(id));
            return r >= 0 && getRawCell(sheet.cells, r, nameCol);
        });
        if (next.length) orderByStage[key] = next;
        else delete orderByStage[key];
    }

    const idSet = new Set(rowIds);
    const rowLevelById = normalizeRowLevelById(raw.rowLevelById, rowIds);
    const rowPackById = normalizeTruthyIdMap(raw.rowPackById, rowIds);
    const rowHiddenById = normalizeTruthyIdMap(raw.rowHiddenById, rowIds);
    const rowCollapsedById = normalizeTruthyIdMap(raw.rowCollapsedById, rowIds);

    const wbsCardColors = normalizeKanbanCardColors(raw.wbsCardColors, rowIds, mapOpts);
    const wbsEmphasisById = normalizeKanbanEmphasisById(raw.wbsEmphasisById, rowIds, mapOpts);
    const wbsCollapsedById = normalizeKanbanCollapsedById(raw.wbsCollapsedById, rowIds, mapOpts);
    pruneEmptyNameKeys(wbsCardColors);
    pruneEmptyNameKeys(wbsEmphasisById);
    pruneEmptyNameKeys(wbsCollapsedById);

    const planner = {
        version: PLANNER_VERSION,
        zoom: normalizePlannerZoom(raw.zoom),
        chartView: normalizePlannerChartView(raw.chartView),
        chartCollapsed: !!raw.chartCollapsed,
        tableCollapsed: !!raw.tableCollapsed,
        kanbanCollapsed: Object.prototype.hasOwnProperty.call(raw, 'kanbanCollapsed')
            ? !!raw.kanbanCollapsed
            : !!raw.chartCollapsed,
        chartHidden: !!raw.chartHidden,
        kanbanHidden: !!raw.kanbanHidden,
        wbsHidden: !!raw.wbsHidden,
        kanbanSort: normalizeKanbanSort(raw.kanbanSort),
        kanbanSortDir: normalizeKanbanSortDir(raw.kanbanSortDir),
        kanbanStageById: stageById,
        kanbanOrderByStage: orderByStage,
        kanbanCardColors: cardColors,
        kanbanEmphasisById: emphasisById,
        kanbanCollapsedById: collapsedById,
        kanbanCollapsedByStage: collapsedByStage,
        labelWidth: normalizePlannerLabelWidth(raw.labelWidth),
        categoryColors: normalizeCategoryColors(raw.categoryColors),
        rowIds,
        nextRowId,
        rowLevelById,
        rowPackById,
        rowHiddenById,
        rowCollapsedById,
        wbsMode: normalizeWbsMode(raw.wbsMode),
        wbsPhaseLabels: normalizeWbsLabels(raw.wbsPhaseLabels, WBS_DEFAULT_PHASE_LABELS),
        wbsDeliverableLabels: normalizeWbsLabels(raw.wbsDeliverableLabels, WBS_DEFAULT_DELIVERABLE_LABELS),
        wbsPhaseById: normalizeWbsBucketById(raw.wbsPhaseById, idSet),
        wbsDeliverableById: normalizeWbsBucketById(raw.wbsDeliverableById, idSet),
        wbsPhaseOrderByBucket: normalizeWbsOrderByBucket(raw.wbsPhaseOrderByBucket, idSet),
        wbsDeliverableOrderByBucket: normalizeWbsOrderByBucket(raw.wbsDeliverableOrderByBucket, idSet),
        wbsCollapsed: !!raw.wbsCollapsed,
        wbsCollapsedByBucket: normalizeWbsCollapsedByBucket(raw.wbsCollapsedByBucket),
        wbsPhaseColorsByBucket: normalizeWbsBucketColors(raw.wbsPhaseColorsByBucket),
        wbsDeliverableColorsByBucket: normalizeWbsBucketColors(raw.wbsDeliverableColorsByBucket),
        wbsCardColors,
        wbsEmphasisById,
        wbsCollapsedById,
        sheet
    };

    repairPlannerHierarchy(planner);
    assertPlannerRowIdInvariant(planner);
    return planner;
}

/**
 * True when planner has user-authored schedule data.
 * @param {unknown} planner
 * @returns {boolean}
 */
export function plannerHasContent(planner) {
    if (isPlannerUnsupportedNewer(planner)) {
        const cells = planner?.sheet?.cells;
        if (!cells) return true;
        return Object.values(cells).some((cell) => String(cell?.v ?? '').trim());
    }
    const sheet = planner?.sheet;
    if (!sheet?.cells) return false;
    return Object.values(sheet.cells).some((cell) => String(cell?.v ?? '').trim());
}

/**
 * @deprecated Hide-with-data is intentional; do not force-unhide on content.
 * @returns {boolean}
 */
export function ensurePlannerVisibleIfContent() {
    return false;
}

/**
 * @param {object} planner
 */
export function addPlannerRow(planner) {
    if (!isPlannerWritable(planner)) return;
    const id = allocPlannerRowId(planner);
    planner.sheet.rows = (planner.sheet.rows || 0) + 1;
    if (!Array.isArray(planner.rowIds)) planner.rowIds = [];
    planner.rowIds.push(id);
    assertPlannerRowIdInvariant(planner);
}

/**
 * @param {object} planner
 * @returns {boolean}
 */
export function removePlannerRow(planner) {
    if (!isPlannerWritable(planner) || (planner.sheet.rows || 1) <= SHEET_MIN_ROWS) return false;
    const sheet = planner.sheet;
    const last = sheet.rows - 1;
    // If last is a child, just remove it; if last is a pack with only itself… packs at end without children ok
    // If removing would orphan — last row only
    const removedId = getPlannerRowId(planner, last);
    if (sheet.cells) {
        for (const key of Object.keys(sheet.cells)) {
            const r = Number(String(key).split(':')[0]);
            if (r === last) delete sheet.cells[key];
        }
    }
    // Drop preds that pointed at the removed outline label
    const removedOutline = getPlannerOutlineLabel(planner, last);
    const predCol = PLANNER_COLUMNS.findIndex((c) => c.key === 'pred');
    for (let r = 0; r < sheet.rows - 1; r++) {
        const raw = getCellValue(sheet, r, predCol);
        if (!raw) continue;
        const next = parsePredecessorIds(raw)
            .filter((tok) => String(tok).toLowerCase() !== String(removedOutline).toLowerCase())
            .join(', ');
        setCellValue(sheet, r, predCol, next);
    }
    if (removedId) {
        pruneKanbanAfterRowRemove(planner, [removedId]);
        pruneWbsAfterRowRemove(planner, [removedId]);
        for (const map of [planner.rowLevelById, planner.rowPackById, planner.rowHiddenById, planner.rowCollapsedById]) {
            if (map) delete map[removedId];
        }
    }
    sheet.rows -= 1;
    if (Array.isArray(planner.rowIds)) planner.rowIds.pop();
    assertPlannerRowIdInvariant(planner);
    return true;
}

/**
 * Move a planner row (or pack block) from fromIndex to toIndex and remap Pred outline tokens.
 * @param {object} planner
 * @param {number} fromIndex
 * @param {number} toIndex
 * @returns {boolean}
 */
export function movePlannerRow(planner, fromIndex, toIndex) {
    if (!isPlannerWritable(planner)) return false;
    const sheet = planner.sheet;
    const rows = sheet.rows || 0;
    if (!Number.isFinite(fromIndex) || !Number.isFinite(toIndex)) return false;
    if (fromIndex < 0 || fromIndex >= rows || toIndex < 0 || toIndex >= rows) return false;

    const block = getPlannerRowBlock(planner, fromIndex);
    const blockLen = block.end - block.start;
    if (blockLen <= 0) return false;

    const oldLabels = buildPlannerOutlineLabels(planner);
    const order = Array.from({ length: rows }, (_, i) => i);
    const moved = order.splice(block.start, blockLen);
    // Match legacy single-row splice(toIndex) semantics after removal.
    let insertAt = Math.floor(toIndex);
    if (insertAt > block.start) insertAt = insertAt - blockLen + 1;
    insertAt = Math.max(0, Math.min(order.length, insertAt));
    order.splice(insertAt, 0, ...moved);

    if (order.every((v, i) => v === i)) return false;

    const oldToNew = new Map();
    order.forEach((oldRow, newRow) => oldToNew.set(oldRow, newRow));

    const nextCells = {};
    const predCol = PLANNER_COLUMNS.findIndex((c) => c.key === 'pred');
    const nextRowIds = order.map((oldRow) => String(planner.rowIds[oldRow]));

    for (let newRow = 0; newRow < rows; newRow++) {
        const oldRow = order[newRow];
        for (let c = 0; c < PLANNER_COL_COUNT; c++) {
            const val = getCellValue(sheet, oldRow, c);
            if (String(val || '').trim()) nextCells[`${newRow}:${c}`] = { v: String(val) };
        }
    }
    sheet.cells = nextCells;
    planner.rowIds = nextRowIds;

    const newLabels = buildPlannerOutlineLabels(planner);
    const oldLabelToNewLabel = new Map();
    for (let oldRow = 0; oldRow < oldLabels.length; oldRow++) {
        const newRow = oldToNew.get(oldRow);
        if (newRow == null) continue;
        oldLabelToNewLabel.set(String(oldLabels[oldRow]).toLowerCase(), newLabels[newRow]);
    }
    for (let r = 0; r < rows; r++) {
        const raw = getCellValue(sheet, r, predCol);
        if (!raw) continue;
        const next = parsePredecessorIds(raw)
            .map((tok) => oldLabelToNewLabel.get(String(tok).toLowerCase()) || tok)
            .join(', ');
        setCellValue(sheet, r, predCol, next);
    }

    pruneKanbanOrphanKeys(planner);
    assertPlannerRowIdInvariant(planner);
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
 * Parse predecessor cell into outline tokens (1, 1a, 2…).
 * @param {string} raw
 * @returns {string[]}
 */
export function parsePredecessorIds(raw) {
    return String(raw || '')
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter((s) => /^\d+[a-z]?$/i.test(s));
}

/**
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
    for (const k of Object.keys(planner.categoryColors)) {
        if (k.toLowerCase() === name.toLowerCase()) delete planner.categoryColors[k];
    }
    planner.categoryColors[name] = hex;
}

/**
 * Derive tasks from planner sheet rows (includes packs for Gantt summary; skips hidden).
 * `id` is the outline label for pred edges; `rowId` is the stable id.
 * @param {object|null|undefined} planner
 * @returns {Array<object>}
 */
export function derivePlannerTasks(planner) {
    const sheet = planner?.sheet;
    if (!sheet) return [];
    const outlines = buildPlannerOutlineLabels(planner);
    const tasks = [];
    for (let r = 0; r < (sheet.rows || 0); r++) {
        if (isPlannerRowHidden(planner, r)) continue;
        // Skip collapsed children
        if (getPlannerRowLevel(planner, r) === 1) {
            // find pack
            let packRow = r - 1;
            while (packRow >= 0 && getPlannerRowLevel(planner, packRow) === 1) packRow -= 1;
            if (packRow >= 0 && isPlannerPackCollapsed(planner, packRow)) continue;
        }
        const start = getPlannerField(sheet, r, 'start').trim();
        const stop = getPlannerField(sheet, r, 'stop').trim();
        const name = getPlannerField(sheet, r, 'name').trim();
        const category = getPlannerField(sheet, r, 'category').trim();
        const comments = getPlannerField(sheet, r, 'comments').trim();
        const predecessors = parsePredecessorIds(getPlannerField(sheet, r, 'pred'));
        const isPack = isPlannerRowPack(planner, r);
        const level = getPlannerRowLevel(planner, r);
        if (!start && !stop && !name && !category && !comments && !predecessors.length && !isPack) continue;

        let taskStart = start;
        let taskStop = stop;
        let isSummary = false;
        if (isPack) {
            isSummary = true;
            // Roll up from non-hidden children
            let minStart = null;
            let maxStop = null;
            const { end } = getPlannerRowBlock(planner, r);
            for (let c = r + 1; c < end; c++) {
                if (isPlannerRowHidden(planner, c)) continue;
                const cs = parsePlannerDateTime(getPlannerField(sheet, c, 'start'));
                const ce = parsePlannerDateTime(getPlannerField(sheet, c, 'stop'))
                    || parsePlannerDateTime(getPlannerField(sheet, c, 'start'));
                if (cs && (!minStart || cs < minStart)) {
                    minStart = cs;
                    taskStart = getPlannerField(sheet, c, 'start').trim();
                }
                if (ce && (!maxStop || ce > maxStop)) {
                    maxStop = ce;
                    const childStop = getPlannerField(sheet, c, 'stop').trim();
                    taskStop = childStop || getPlannerField(sheet, c, 'start').trim();
                }
            }
            // Prefer explicit pack dates if set
            if (start) taskStart = start;
            if (stop) taskStop = stop;
        }

        tasks.push({
            row: r,
            rowId: getPlannerRowId(planner, r),
            id: outlines[r] || String(r + 1),
            outlineId: outlines[r] || String(r + 1),
            start: taskStart,
            stop: taskStop,
            name,
            category,
            categoryColor: getCategoryColor(planner, category),
            comments,
            predecessors: isPack ? [] : predecessors,
            level,
            isPack,
            isSummary,
            hidden: false
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
