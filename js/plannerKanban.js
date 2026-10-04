/** @module {"owns":"magicPlanner Kanban layout — stages, sort, column flavours (display + drag meta)", "related":["planner.js","plannerUi.js","displayOptions.js"]} */
import { parsePlannerDateTime } from './plannerGantt.js';

export const KANBAN_STAGE_COUNT = 5;

/** Display sort chips (manual is entered by dragging). */
export const KANBAN_SORT_CHIP_MODES = Object.freeze(['row', 'date', 'alpha']);
export const KANBAN_SORT_MODES = Object.freeze(['row', 'date', 'alpha', 'manual']);
export const KANBAN_DEFAULT_SORT = 'row';
export const KANBAN_SORT_DIRS = Object.freeze(['asc', 'desc']);
export const KANBAN_DEFAULT_SORT_DIR = 'asc';

export const KANBAN_COMMENT_CLIP = 90;

export const KANBAN_FLAVOURS = Object.freeze({
    release: Object.freeze([
        'Preparation',
        'Planning',
        'Development',
        'Release Candidate',
        'Released'
    ]),
    workflow: Object.freeze([
        'New',
        'Planning',
        'In Progress',
        'Sign off',
        'Completed'
    ])
});

export const KANBAN_DEFAULT_FLAVOUR = 'release';
export const KANBAN_FLAVOUR_IDS = Object.freeze(Object.keys(KANBAN_FLAVOURS));

/** Locked planner column indices — avoid importing planner.js. */
const NAME_COL = 0;
const CATEGORY_COL = 1;
const START_COL = 2;
const STOP_COL = 3;
const COMMENTS_COL = 5;

/**
 * @param {unknown} raw
 * @returns {'release'|'workflow'}
 */
export function normalizeKanbanFlavour(raw) {
    const id = String(raw || '').toLowerCase();
    return KANBAN_FLAVOUR_IDS.includes(id) ? id : KANBAN_DEFAULT_FLAVOUR;
}

/**
 * @param {unknown} raw
 * @returns {'row'|'date'|'alpha'|'manual'}
 */
export function normalizeKanbanSort(raw) {
    const s = String(raw || '').toLowerCase();
    return KANBAN_SORT_MODES.includes(s) ? s : KANBAN_DEFAULT_SORT;
}

/**
 * @param {unknown} raw
 * @returns {'asc'|'desc'}
 */
export function normalizeKanbanSortDir(raw) {
    const d = String(raw || '').toLowerCase();
    return KANBAN_SORT_DIRS.includes(d) ? d : KANBAN_DEFAULT_SORT_DIR;
}

/**
 * @param {unknown} raw
 * @param {number} rowCount
 * @returns {Record<string, number>}
 */
export function normalizeKanbanStageByRow(raw, rowCount = 0) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    const max = Math.max(0, Number(rowCount) || 0);
    for (const [k, v] of Object.entries(raw)) {
        const row = Number(k);
        const stage = Number(v);
        if (!Number.isFinite(row) || row < 0 || row >= max) continue;
        if (!Number.isFinite(stage) || stage < 0 || stage >= KANBAN_STAGE_COUNT) continue;
        out[String(Math.floor(row))] = Math.floor(stage);
    }
    return out;
}

/**
 * @param {unknown} raw
 * @param {number} rowCount
 * @returns {Record<string, number[]>}
 */
export function normalizeKanbanOrderByStage(raw, rowCount = 0) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    const max = Math.max(0, Number(rowCount) || 0);
    for (let stage = 0; stage < KANBAN_STAGE_COUNT; stage++) {
        const list = raw[String(stage)] ?? raw[stage];
        if (!Array.isArray(list)) continue;
        const seen = new Set();
        const next = [];
        for (const item of list) {
            const row = Number(item);
            if (!Number.isFinite(row) || row < 0 || row >= max) continue;
            const r = Math.floor(row);
            if (seen.has(r)) continue;
            seen.add(r);
            next.push(r);
        }
        if (next.length) out[String(stage)] = next;
    }
    return out;
}

/**
 * Per-card color overrides (hex). Empty / invalid dropped.
 * @param {unknown} raw
 * @param {number} rowCount
 * @returns {Record<string, string>}
 */
export function normalizeKanbanCardColors(raw, rowCount = 0) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    const max = Math.max(0, Number(rowCount) || 0);
    for (const [k, v] of Object.entries(raw)) {
        const row = Number(k);
        const hex = String(v || '').trim();
        if (!Number.isFinite(row) || row < 0 || row >= max) continue;
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
        out[String(Math.floor(row))] = hex.toLowerCase();
    }
    return out;
}

/**
 * @param {'release'|'workflow'|string} flavourId
 * @returns {readonly string[]}
 */
export function kanbanLabelsForFlavour(flavourId) {
    const id = normalizeKanbanFlavour(flavourId);
    return KANBAN_FLAVOURS[id] || KANBAN_FLAVOURS[KANBAN_DEFAULT_FLAVOUR];
}

/**
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function clipKanbanComment(text, max = KANBAN_COMMENT_CLIP) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (s.length <= max) return s;
    return `${s.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function cellTrim(sheet, row, col) {
    return String(sheet?.cells?.[`${row}:${col}`]?.v ?? '').trim();
}

function categoryColorLookup(planner, categoryName) {
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
 * Cards with a non-empty name (empty-name rows stay off the board).
 * @param {object|null|undefined} planner
 * @returns {Array<{ row: number, id: string, name: string, start: string, stop: string, category: string, comments: string, categoryColor: string, cardColor: string }>}
 */
export function derivePlannerKanbanCards(planner) {
    const sheet = planner?.sheet;
    if (!sheet) return [];
    const cards = [];
    for (let r = 0; r < (sheet.rows || 0); r++) {
        const name = cellTrim(sheet, r, NAME_COL);
        if (!name) continue;
        const category = cellTrim(sheet, r, CATEGORY_COL);
        const categoryColor = categoryColorLookup(planner, category);
        const override = planner?.kanbanCardColors?.[String(r)] || planner?.kanbanCardColors?.[r] || '';
        const cardColor = /^#[0-9a-fA-F]{6}$/.test(override) ? override : categoryColor;
        cards.push({
            row: r,
            id: String(r + 1),
            name,
            start: cellTrim(sheet, r, START_COL),
            stop: cellTrim(sheet, r, STOP_COL),
            category,
            comments: cellTrim(sheet, r, COMMENTS_COL),
            categoryColor,
            cardColor
        });
    }
    return cards;
}

/**
 * @param {object|null|undefined} planner
 * @param {number} row
 * @returns {number}
 */
export function getKanbanStageForRow(planner, row) {
    const raw = planner?.kanbanStageByRow?.[String(row)] ?? planner?.kanbanStageByRow?.[row];
    const stage = Number(raw);
    if (!Number.isFinite(stage) || stage < 0 || stage >= KANBAN_STAGE_COUNT) return 0;
    return Math.floor(stage);
}

/**
 * Layout cards into 5 columns for the current sort mode + flavour labels.
 * @param {object|null|undefined} planner
 * @param {{ flavour?: string }} [opts]
 */
export function layoutPlannerKanban(planner, { flavour } = {}) {
    const flavourId = normalizeKanbanFlavour(flavour);
    const labels = [...kanbanLabelsForFlavour(flavourId)];
    const sort = normalizeKanbanSort(planner?.kanbanSort);
    const sortDir = normalizeKanbanSortDir(planner?.kanbanSortDir);
    const dirMul = sortDir === 'desc' ? -1 : 1;
    const cards = derivePlannerKanbanCards(planner);
    const byStage = Array.from({ length: KANBAN_STAGE_COUNT }, () => []);

    for (const card of cards) {
        byStage[getKanbanStageForRow(planner, card.row)].push(card);
    }

    for (let stage = 0; stage < KANBAN_STAGE_COUNT; stage++) {
        const list = byStage[stage];
        if (sort === 'date') {
            list.sort((a, b) => {
                const da = parsePlannerDateTime(a.start);
                const db = parsePlannerDateTime(b.start);
                if (da && db) {
                    const diff = da.getTime() - db.getTime();
                    if (diff !== 0) return diff * dirMul;
                } else if (da && !db) return -1; // undated always last
                else if (!da && db) return 1;
                return (a.row - b.row) * dirMul;
            });
        } else if (sort === 'alpha') {
            list.sort((a, b) => {
                const cmp = String(a.name || '').localeCompare(String(b.name || ''), undefined, {
                    sensitivity: 'base',
                    numeric: true
                });
                if (cmp !== 0) return cmp * dirMul;
                return (a.row - b.row) * dirMul;
            });
        } else if (sort === 'manual') {
            const order = planner?.kanbanOrderByStage?.[String(stage)] || [];
            const rank = new Map(order.map((row, i) => [row, i]));
            list.sort((a, b) => {
                const ra = rank.has(a.row) ? rank.get(a.row) : Number.POSITIVE_INFINITY;
                const rb = rank.has(b.row) ? rank.get(b.row) : Number.POSITIVE_INFINITY;
                if (ra !== rb) return ra - rb;
                return a.row - b.row;
            });
        } else {
            list.sort((a, b) => (a.row - b.row) * dirMul);
        }
    }

    return {
        sort,
        sortDir,
        flavour: flavourId,
        labels,
        columns: byStage.map((cardsInCol, stage) => ({
            stage,
            label: labels[stage] || `Stage ${stage + 1}`,
            cards: cardsInCol
        }))
    };
}

/**
 * Remap kanban stage/order/color maps after a row reorder (oldRow → newRow via order[]).
 * @param {object} planner
 * @param {number[]} order - order[newRow] = oldRow
 */
export function remapKanbanAfterRowMove(planner, order) {
    if (!planner || !Array.isArray(order)) return;
    const oldToNew = new Map();
    order.forEach((oldRow, newRow) => oldToNew.set(oldRow, newRow));

    const nextStage = {};
    const srcStage = planner.kanbanStageByRow && typeof planner.kanbanStageByRow === 'object'
        ? planner.kanbanStageByRow
        : {};
    for (const [k, v] of Object.entries(srcStage)) {
        const oldRow = Number(k);
        if (!oldToNew.has(oldRow)) continue;
        const stage = Number(v);
        if (!Number.isFinite(stage) || stage < 0 || stage >= KANBAN_STAGE_COUNT) continue;
        nextStage[String(oldToNew.get(oldRow))] = Math.floor(stage);
    }
    planner.kanbanStageByRow = nextStage;

    const nextOrder = {};
    const srcOrder = planner.kanbanOrderByStage && typeof planner.kanbanOrderByStage === 'object'
        ? planner.kanbanOrderByStage
        : {};
    for (let stage = 0; stage < KANBAN_STAGE_COUNT; stage++) {
        const list = srcOrder[String(stage)] ?? srcOrder[stage];
        if (!Array.isArray(list)) continue;
        const mapped = [];
        const seen = new Set();
        for (const item of list) {
            const oldRow = Number(item);
            if (!oldToNew.has(oldRow)) continue;
            const newRow = oldToNew.get(oldRow);
            if (seen.has(newRow)) continue;
            seen.add(newRow);
            mapped.push(newRow);
        }
        if (mapped.length) nextOrder[String(stage)] = mapped;
    }
    planner.kanbanOrderByStage = nextOrder;

    const nextColors = {};
    const srcColors = planner.kanbanCardColors && typeof planner.kanbanCardColors === 'object'
        ? planner.kanbanCardColors
        : {};
    for (const [k, v] of Object.entries(srcColors)) {
        const oldRow = Number(k);
        if (!oldToNew.has(oldRow)) continue;
        const hex = String(v || '').trim();
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
        nextColors[String(oldToNew.get(oldRow))] = hex.toLowerCase();
    }
    planner.kanbanCardColors = nextColors;
}

/**
 * Drop stage/order/color entries for a removed last row.
 * @param {object} planner
 * @param {number} removedRow
 */
export function pruneKanbanAfterRowRemove(planner, removedRow) {
    if (!planner || !Number.isFinite(removedRow)) return;
    const stageMap = planner.kanbanStageByRow;
    if (stageMap && typeof stageMap === 'object') {
        delete stageMap[String(removedRow)];
        delete stageMap[removedRow];
    }
    const orderMap = planner.kanbanOrderByStage;
    if (orderMap && typeof orderMap === 'object') {
        for (let stage = 0; stage < KANBAN_STAGE_COUNT; stage++) {
            const key = String(stage);
            const list = orderMap[key] ?? orderMap[stage];
            if (!Array.isArray(list)) continue;
            const next = list.filter((r) => Number(r) !== removedRow);
            if (next.length) orderMap[key] = next;
            else {
                delete orderMap[key];
                delete orderMap[stage];
            }
        }
    }
    const colorMap = planner.kanbanCardColors;
    if (colorMap && typeof colorMap === 'object') {
        delete colorMap[String(removedRow)];
        delete colorMap[removedRow];
    }
}

/**
 * Move a card to a stage; optionally insert before a target row (always updates order).
 * @param {object} planner
 * @param {number} row
 * @param {number} toStage
 * @param {{ beforeRow?: number|null }} [opts]
 */
export function moveKanbanCard(planner, row, toStage, { beforeRow = null } = {}) {
    if (!planner || !Number.isFinite(row) || !Number.isFinite(toStage)) return;
    const stage = Math.floor(toStage);
    if (stage < 0 || stage >= KANBAN_STAGE_COUNT) return;
    const r = Math.floor(row);

    if (!planner.kanbanStageByRow || typeof planner.kanbanStageByRow !== 'object') {
        planner.kanbanStageByRow = {};
    }
    planner.kanbanStageByRow[String(r)] = stage;

    if (!planner.kanbanOrderByStage || typeof planner.kanbanOrderByStage !== 'object') {
        planner.kanbanOrderByStage = {};
    }
    const order = planner.kanbanOrderByStage;

    for (let s = 0; s < KANBAN_STAGE_COUNT; s++) {
        const key = String(s);
        const list = order[key];
        if (!Array.isArray(list)) continue;
        const next = list.filter((x) => x !== r);
        if (next.length) order[key] = next;
        else delete order[key];
    }

    const key = String(stage);
    let list = Array.isArray(order[key]) ? order[key].filter((x) => x !== r) : [];

    if (!list.length) {
        const peers = derivePlannerKanbanCards(planner)
            .filter((c) => c.row !== r && getKanbanStageForRow(planner, c.row) === stage)
            .map((c) => c.row)
            .sort((a, b) => a - b);
        list = peers;
    }

    const before = beforeRow != null && Number.isFinite(beforeRow) ? Math.floor(beforeRow) : null;
    if (before != null && list.includes(before)) {
        list.splice(list.indexOf(before), 0, r);
    } else {
        list.push(r);
    }
    order[key] = list;
}

/**
 * @param {object} planner
 * @param {number} row
 * @param {string} hex
 */
export function setKanbanCardColor(planner, row, hex) {
    if (!planner || !Number.isFinite(row)) return;
    const color = String(hex || '').trim();
    if (!planner.kanbanCardColors || typeof planner.kanbanCardColors !== 'object') {
        planner.kanbanCardColors = {};
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        delete planner.kanbanCardColors[String(Math.floor(row))];
        return;
    }
    planner.kanbanCardColors[String(Math.floor(row))] = color.toLowerCase();
}
