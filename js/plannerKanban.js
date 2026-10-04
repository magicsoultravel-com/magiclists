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

export const KANBAN_EMPHASIS_MODES = Object.freeze(['urgent', 'muted']);

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
 * Resolve a stored map key to a row id (supports legacy index keys).
 * @param {string} key
 * @param {string[]} rowIds
 * @param {{ keysAreIndexes?: boolean }} [opts]
 * @returns {string}
 */
function resolveMapKeyToId(key, rowIds, { keysAreIndexes = false } = {}) {
    const k = String(key || '');
    if (!k) return '';
    const asIndex = Number(k);
    const isIndexToken = Number.isFinite(asIndex) && asIndex >= 0 && asIndex < rowIds.length
        && String(Math.floor(asIndex)) === k;
    if (keysAreIndexes) {
        return isIndexToken ? String(rowIds[Math.floor(asIndex)] || '') : '';
    }
    if (rowIds.includes(k)) return k;
    if (isIndexToken) return String(rowIds[Math.floor(asIndex)] || '');
    return '';
}

/**
 * @param {unknown} raw
 * @param {string[]} rowIds
 * @param {{ keysAreIndexes?: boolean }} [opts]
 * @returns {Record<string, number>}
 */
export function normalizeKanbanStageById(raw, rowIds = [], opts = {}) {
    if (!raw || typeof raw !== 'object') return {};
    const ids = Array.isArray(rowIds) ? rowIds : [];
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const id = resolveMapKeyToId(k, ids, opts);
        const stage = Number(v);
        if (!id) continue;
        if (!Number.isFinite(stage) || stage < 0 || stage >= KANBAN_STAGE_COUNT) continue;
        out[id] = Math.floor(stage);
    }
    return out;
}

/** @deprecated use normalizeKanbanStageById */
export function normalizeKanbanStageByRow(raw, rowCount = 0) {
    const rowIds = Array.from({ length: Math.max(0, Number(rowCount) || 0) }, (_, i) => String(i));
    return normalizeKanbanStageById(raw, rowIds);
}

/**
 * @param {unknown} raw
 * @param {string[]} rowIds
 * @param {{ keysAreIndexes?: boolean }} [opts]
 * @returns {Record<string, string[]>}
 */
export function normalizeKanbanOrderByStage(raw, rowIds = [], opts = {}) {
    if (!raw || typeof raw !== 'object') return {};
    const ids = Array.isArray(rowIds) ? rowIds : [];
    const out = {};
    for (let stage = 0; stage < KANBAN_STAGE_COUNT; stage++) {
        const list = raw[String(stage)] ?? raw[stage];
        if (!Array.isArray(list)) continue;
        const seen = new Set();
        const next = [];
        for (const item of list) {
            const id = resolveMapKeyToId(String(item), ids, opts);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            next.push(id);
        }
        if (next.length) out[String(stage)] = next;
    }
    return out;
}

/**
 * @param {unknown} raw
 * @param {string[]} rowIds
 * @param {{ keysAreIndexes?: boolean }} [opts]
 * @returns {Record<string, string>}
 */
export function normalizeKanbanCardColors(raw, rowIds = [], opts = {}) {
    if (!raw || typeof raw !== 'object') return {};
    const ids = Array.isArray(rowIds) ? rowIds : [];
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const id = resolveMapKeyToId(k, ids, opts);
        const hex = String(v || '').trim();
        if (!id) continue;
        if (!/^#[0-9a-fA-F]{6}$/.test(hex)) continue;
        out[id] = hex.toLowerCase();
    }
    return out;
}

/**
 * @param {unknown} raw
 * @param {string[]} rowIds
 * @param {{ keysAreIndexes?: boolean }} [opts]
 * @returns {Record<string, 'urgent'|'muted'>}
 */
export function normalizeKanbanEmphasisById(raw, rowIds = [], opts = {}) {
    if (!raw || typeof raw !== 'object') return {};
    const ids = Array.isArray(rowIds) ? rowIds : [];
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const id = resolveMapKeyToId(k, ids, opts);
        const mode = String(v || '').toLowerCase();
        if (!id) continue;
        if (!KANBAN_EMPHASIS_MODES.includes(mode)) continue;
        out[id] = /** @type {'urgent'|'muted'} */ (mode);
    }
    return out;
}

/** @deprecated use normalizeKanbanEmphasisById */
export function normalizeKanbanEmphasisByRow(raw, rowCount = 0) {
    const rowIds = Array.from({ length: Math.max(0, Number(rowCount) || 0) }, (_, i) => String(i));
    return normalizeKanbanEmphasisById(raw, rowIds);
}

/**
 * @param {object|null|undefined} planner
 * @param {number|string} rowOrId
 * @returns {''|'urgent'|'muted'}
 */
export function getKanbanEmphasisForRow(planner, rowOrId) {
    const id = resolveRowOrId(planner, rowOrId);
    const raw = planner?.kanbanEmphasisById?.[id];
    const mode = String(raw || '').toLowerCase();
    return KANBAN_EMPHASIS_MODES.includes(mode) ? /** @type {'urgent'|'muted'} */ (mode) : '';
}

/**
 * @param {unknown} raw
 * @param {string[]} rowIds
 * @param {{ keysAreIndexes?: boolean }} [opts]
 * @returns {Record<string, true>}
 */
export function normalizeKanbanCollapsedById(raw, rowIds = [], opts = {}) {
    if (!raw || typeof raw !== 'object') return {};
    const ids = Array.isArray(rowIds) ? rowIds : [];
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const id = resolveMapKeyToId(k, ids, opts);
        if (!id || !v) continue;
        out[id] = true;
    }
    return out;
}

/** @deprecated use normalizeKanbanCollapsedById */
export function normalizeKanbanCollapsedByRow(raw, rowCount = 0) {
    const rowIds = Array.from({ length: Math.max(0, Number(rowCount) || 0) }, (_, i) => String(i));
    return normalizeKanbanCollapsedById(raw, rowIds);
}

/**
 * @param {object|null|undefined} planner
 * @param {number|string} rowOrId
 * @returns {boolean}
 */
export function isKanbanCardCollapsed(planner, rowOrId) {
    const id = resolveRowOrId(planner, rowOrId);
    return !!(planner?.kanbanCollapsedById?.[id]);
}

/**
 * @param {unknown} raw
 * @returns {Record<string, true>}
 */
export function normalizeKanbanCollapsedByStage(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const stage = Number(k);
        if (!Number.isFinite(stage) || stage < 0 || stage >= KANBAN_STAGE_COUNT) continue;
        if (!v) continue;
        out[String(Math.floor(stage))] = true;
    }
    return out;
}

/**
 * @param {object|null|undefined} planner
 * @param {number} stage
 * @returns {boolean}
 */
export function isKanbanStageCollapsed(planner, stage) {
    const s = Number(stage);
    if (!Number.isFinite(s) || s < 0 || s >= KANBAN_STAGE_COUNT) return false;
    const raw = planner?.kanbanCollapsedByStage?.[String(Math.floor(s))]
        ?? planner?.kanbanCollapsedByStage?.[Math.floor(s)];
    return !!raw;
}

/**
 * @param {object} planner
 * @param {number} stage
 * @param {boolean} collapsed
 */
export function setKanbanStageCollapsed(planner, stage, collapsed) {
    if (!planner) return;
    const s = Number(stage);
    if (!Number.isFinite(s) || s < 0 || s >= KANBAN_STAGE_COUNT) return;
    if (!planner.kanbanCollapsedByStage || typeof planner.kanbanCollapsedByStage !== 'object') {
        planner.kanbanCollapsedByStage = {};
    }
    const key = String(Math.floor(s));
    if (collapsed) planner.kanbanCollapsedByStage[key] = true;
    else delete planner.kanbanCollapsedByStage[key];
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
 * @param {object|null|undefined} planner
 * @param {number|string} rowOrId
 * @returns {string}
 */
function resolveRowOrId(planner, rowOrId) {
    if (typeof rowOrId === 'string' && rowOrId && !/^\d+$/.test(rowOrId)) return rowOrId;
    if (typeof rowOrId === 'string' && planner?.rowIds?.includes(rowOrId)) return rowOrId;
    const row = Number(rowOrId);
    if (Number.isFinite(row) && Array.isArray(planner?.rowIds) && row >= 0 && row < planner.rowIds.length) {
        return String(planner.rowIds[row] || '');
    }
    // Legacy: treat bare numeric string as id if present
    if (typeof rowOrId === 'string' && planner?.rowIds?.includes(rowOrId)) return rowOrId;
    return String(rowOrId ?? '');
}

function isPackId(planner, rowId) {
    return !!(planner?.rowPackById?.[String(rowId)]);
}

function isHiddenId(planner, rowId) {
    return !!(planner?.rowHiddenById?.[String(rowId)]);
}

/**
 * Cards with a non-empty name (empty-name / pack / hidden rows stay off the board).
 * @param {object|null|undefined} planner
 * @returns {Array<{ row: number, rowId: string, id: string, name: string, start: string, stop: string, category: string, comments: string, categoryColor: string, cardColor: string, emphasis: string, collapsed: boolean }>}
 */
export function derivePlannerKanbanCards(planner) {
    const sheet = planner?.sheet;
    const rowIds = Array.isArray(planner?.rowIds) ? planner.rowIds : [];
    if (!sheet) return [];
    const cards = [];
    for (let r = 0; r < (sheet.rows || 0); r++) {
        const rowId = String(rowIds[r] || r);
        if (isPackId(planner, rowId) || isHiddenId(planner, rowId)) continue;
        const name = cellTrim(sheet, r, NAME_COL);
        if (!name) continue;
        const category = cellTrim(sheet, r, CATEGORY_COL);
        const categoryColor = categoryColorLookup(planner, category);
        const override = planner?.kanbanCardColors?.[rowId] || '';
        const cardColor = /^#[0-9a-fA-F]{6}$/.test(override) ? override : categoryColor;
        cards.push({
            row: r,
            rowId,
            id: rowId,
            name,
            start: cellTrim(sheet, r, START_COL),
            stop: cellTrim(sheet, r, STOP_COL),
            category,
            comments: cellTrim(sheet, r, COMMENTS_COL),
            categoryColor,
            cardColor,
            emphasis: getKanbanEmphasisForRow(planner, rowId),
            collapsed: isKanbanCardCollapsed(planner, rowId)
        });
    }
    return cards;
}

/**
 * @param {object|null|undefined} planner
 * @param {number|string} rowOrId
 * @returns {number}
 */
export function getKanbanStageForRow(planner, rowOrId) {
    const id = resolveRowOrId(planner, rowOrId);
    const raw = planner?.kanbanStageById?.[id];
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
        byStage[getKanbanStageForRow(planner, card.rowId)].push(card);
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
                } else if (da && !db) return -1;
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
            const rank = new Map(order.map((id, i) => [String(id), i]));
            list.sort((a, b) => {
                const ra = rank.has(a.rowId) ? rank.get(a.rowId) : Number.POSITIVE_INFINITY;
                const rb = rank.has(b.rowId) ? rank.get(b.rowId) : Number.POSITIVE_INFINITY;
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
            cards: cardsInCol,
            collapsed: isKanbanStageCollapsed(planner, stage)
        }))
    };
}

/**
 * Id-keyed maps do not remap on row reorder — only prune orphans.
 * Kept for call-site compatibility.
 * @param {object} planner
 * @param {number[]} [_order]
 */
export function remapKanbanAfterRowMove(planner, _order) {
    pruneKanbanOrphanKeys(planner);
}

/**
 * @param {object} planner
 */
export function pruneKanbanOrphanKeys(planner) {
    if (!planner) return;
    const idSet = new Set(Array.isArray(planner.rowIds) ? planner.rowIds.map(String) : []);
    const pruneMap = (map) => {
        if (!map || typeof map !== 'object') return;
        for (const key of Object.keys(map)) {
            if (!idSet.has(String(key))) delete map[key];
        }
    };
    pruneMap(planner.kanbanStageById);
    pruneMap(planner.kanbanCardColors);
    pruneMap(planner.kanbanEmphasisById);
    pruneMap(planner.kanbanCollapsedById);
    const orderMap = planner.kanbanOrderByStage;
    if (orderMap && typeof orderMap === 'object') {
        for (let stage = 0; stage < KANBAN_STAGE_COUNT; stage++) {
            const key = String(stage);
            const list = orderMap[key];
            if (!Array.isArray(list)) continue;
            const next = list.filter((id) => idSet.has(String(id)));
            if (next.length) orderMap[key] = next;
            else delete orderMap[key];
        }
    }
}

/**
 * Drop stage/order/color/emphasis/collapsed entries for removed row ids.
 * @param {object} planner
 * @param {number|string|Iterable<string>} removedRowOrIds
 */
export function pruneKanbanAfterRowRemove(planner, removedRowOrIds) {
    if (!planner) return;
    let ids = [];
    if (removedRowOrIds && typeof removedRowOrIds === 'object' && Symbol.iterator in removedRowOrIds
        && typeof removedRowOrIds !== 'string') {
        ids = [...removedRowOrIds].map(String);
    } else {
        ids = [resolveRowOrId(planner, /** @type {any} */ (removedRowOrIds))].filter(Boolean);
    }
    for (const id of ids) {
        if (planner.kanbanStageById) delete planner.kanbanStageById[id];
        if (planner.kanbanCardColors) delete planner.kanbanCardColors[id];
        if (planner.kanbanEmphasisById) delete planner.kanbanEmphasisById[id];
        if (planner.kanbanCollapsedById) delete planner.kanbanCollapsedById[id];
        const orderMap = planner.kanbanOrderByStage;
        if (orderMap && typeof orderMap === 'object') {
            for (let stage = 0; stage < KANBAN_STAGE_COUNT; stage++) {
                const key = String(stage);
                const list = orderMap[key];
                if (!Array.isArray(list)) continue;
                const next = list.filter((x) => String(x) !== id);
                if (next.length) orderMap[key] = next;
                else delete orderMap[key];
            }
        }
    }
}

/**
 * Move a card to a stage; optionally insert before a target row (always updates order).
 * @param {object} planner
 * @param {number|string} rowOrId
 * @param {number} toStage
 * @param {{ beforeRow?: number|string|null, beforeId?: string|null }} [opts]
 */
export function moveKanbanCard(planner, rowOrId, toStage, { beforeRow = null, beforeId = null } = {}) {
    if (!planner || !Number.isFinite(toStage)) return;
    const stage = Math.floor(toStage);
    if (stage < 0 || stage >= KANBAN_STAGE_COUNT) return;
    const id = resolveRowOrId(planner, rowOrId);
    if (!id) return;

    if (!planner.kanbanStageById || typeof planner.kanbanStageById !== 'object') {
        planner.kanbanStageById = {};
    }
    planner.kanbanStageById[id] = stage;

    if (!planner.kanbanOrderByStage || typeof planner.kanbanOrderByStage !== 'object') {
        planner.kanbanOrderByStage = {};
    }
    const order = planner.kanbanOrderByStage;

    for (let s = 0; s < KANBAN_STAGE_COUNT; s++) {
        const key = String(s);
        const list = order[key];
        if (!Array.isArray(list)) continue;
        const next = list.filter((x) => String(x) !== id);
        if (next.length) order[key] = next;
        else delete order[key];
    }

    const key = String(stage);
    let list = Array.isArray(order[key]) ? order[key].filter((x) => String(x) !== id) : [];

    if (!list.length) {
        const peers = derivePlannerKanbanCards(planner)
            .filter((c) => c.rowId !== id && getKanbanStageForRow(planner, c.rowId) === stage)
            .map((c) => c.rowId)
            .sort((a, b) => {
                const ra = planner.rowIds?.indexOf(a) ?? 0;
                const rb = planner.rowIds?.indexOf(b) ?? 0;
                return ra - rb;
            });
        list = peers;
    }

    let before = beforeId != null ? String(beforeId) : null;
    if (!before && beforeRow != null) before = resolveRowOrId(planner, beforeRow) || null;
    if (before && list.includes(before)) {
        list.splice(list.indexOf(before), 0, id);
    } else {
        list.push(id);
    }
    order[key] = list;
}

/**
 * @param {object} planner
 * @param {number|string} rowOrId
 * @param {string} hex
 */
export function setKanbanCardColor(planner, rowOrId, hex) {
    if (!planner) return;
    const id = resolveRowOrId(planner, rowOrId);
    if (!id) return;
    const color = String(hex || '').trim();
    if (!planner.kanbanCardColors || typeof planner.kanbanCardColors !== 'object') {
        planner.kanbanCardColors = {};
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        delete planner.kanbanCardColors[id];
        return;
    }
    planner.kanbanCardColors[id] = color.toLowerCase();
}

/**
 * @param {object} planner
 * @param {number|string} rowOrId
 * @param {'urgent'|'muted'|''} mode
 */
export function setKanbanCardEmphasis(planner, rowOrId, mode) {
    if (!planner) return;
    const id = resolveRowOrId(planner, rowOrId);
    if (!id) return;
    if (!planner.kanbanEmphasisById || typeof planner.kanbanEmphasisById !== 'object') {
        planner.kanbanEmphasisById = {};
    }
    const next = String(mode || '').toLowerCase();
    if (!KANBAN_EMPHASIS_MODES.includes(next)) {
        delete planner.kanbanEmphasisById[id];
        return;
    }
    if (planner.kanbanEmphasisById[id] === next) {
        delete planner.kanbanEmphasisById[id];
        return;
    }
    planner.kanbanEmphasisById[id] = next;
}

/**
 * @param {object} planner
 * @param {number|string} rowOrId
 */
export function resetKanbanCardStyles(planner, rowOrId) {
    if (!planner) return;
    setKanbanCardColor(planner, rowOrId, '');
    setKanbanCardEmphasis(planner, rowOrId, '');
}

/**
 * @param {object} planner
 */
export function resetAllKanbanCardStyles(planner) {
    if (!planner) return;
    planner.kanbanCardColors = {};
    planner.kanbanEmphasisById = {};
}

/**
 * @param {object} planner
 */
export function resetKanbanArrangement(planner) {
    if (!planner) return;
    planner.kanbanStageById = {};
    planner.kanbanOrderByStage = {};
    planner.kanbanSort = KANBAN_DEFAULT_SORT;
    planner.kanbanSortDir = KANBAN_DEFAULT_SORT_DIR;
}

/**
 * @param {object} planner
 * @param {number|string} rowOrId
 * @param {boolean} collapsed
 */
export function setKanbanCardCollapsed(planner, rowOrId, collapsed) {
    if (!planner) return;
    const id = resolveRowOrId(planner, rowOrId);
    if (!id) return;
    if (!planner.kanbanCollapsedById || typeof planner.kanbanCollapsedById !== 'object') {
        planner.kanbanCollapsedById = {};
    }
    if (collapsed) planner.kanbanCollapsedById[id] = true;
    else delete planner.kanbanCollapsedById[id];
}

/**
 * @param {object} planner
 */
export function expandAllKanbanCards(planner) {
    if (!planner) return;
    planner.kanbanCollapsedById = {};
}

/**
 * @param {object} planner
 */
export function collapseAllKanbanCards(planner) {
    if (!planner) return;
    const next = {};
    for (const card of derivePlannerKanbanCards(planner)) {
        next[card.rowId] = true;
    }
    planner.kanbanCollapsedById = next;
}
