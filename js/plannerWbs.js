/** @module {"owns":"magicPlanner WBS layout — phase/deliverable buckets, unmapped column, drag meta", "related":["planner.js","plannerUi.js","plannerKanban.js"]} */

export const WBS_BUCKET_COUNT = 5;
export const WBS_UNMAPPED = 'unmapped';
export const WBS_MODES = Object.freeze(['phase', 'deliverable']);
export const WBS_DEFAULT_MODE = 'phase';

export const WBS_DEFAULT_PHASE_LABELS = Object.freeze([
    'Initiation',
    'Planning',
    'Execution',
    'Control',
    'Closure'
]);

export const WBS_DEFAULT_DELIVERABLE_LABELS = Object.freeze([
    'Concept',
    'Design',
    'Build',
    'Validate',
    'Handoff'
]);

/** Locked planner column indices — avoid importing planner.js. */
const NAME_COL = 0;
const CATEGORY_COL = 1;
const START_COL = 2;
const STOP_COL = 3;
const COMMENTS_COL = 5;

/**
 * @param {unknown} raw
 * @returns {'phase'|'deliverable'}
 */
export function normalizeWbsMode(raw) {
    const m = String(raw || '').toLowerCase();
    return WBS_MODES.includes(m) ? /** @type {'phase'|'deliverable'} */ (m) : WBS_DEFAULT_MODE;
}

/**
 * @param {unknown} raw
 * @param {readonly string[]} defaults
 * @returns {string[]}
 */
export function normalizeWbsLabels(raw, defaults) {
    const base = [...defaults];
    if (!Array.isArray(raw)) return base;
    for (let i = 0; i < WBS_BUCKET_COUNT; i++) {
        const label = String(raw[i] ?? '').trim();
        if (label) base[i] = label;
    }
    return base;
}

/**
 * @param {unknown} raw
 * @param {Set<string>|string[]} idSet
 * @returns {Record<string, number>}
 */
export function normalizeWbsBucketById(raw, idSet) {
    if (!raw || typeof raw !== 'object') return {};
    const ids = idSet instanceof Set ? idSet : new Set(idSet || []);
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
        const id = String(k || '');
        if (!id || !ids.has(id)) continue;
        const bucket = Number(v);
        if (!Number.isFinite(bucket) || bucket < 0 || bucket >= WBS_BUCKET_COUNT) continue;
        out[id] = Math.floor(bucket);
    }
    return out;
}

/**
 * @param {unknown} raw
 * @param {Set<string>|string[]} idSet
 * @returns {Record<string, string[]>}
 */
export function normalizeWbsOrderByBucket(raw, idSet) {
    if (!raw || typeof raw !== 'object') return {};
    const ids = idSet instanceof Set ? idSet : new Set(idSet || []);
    const out = {};
    const keys = [WBS_UNMAPPED, ...Array.from({ length: WBS_BUCKET_COUNT }, (_, i) => String(i))];
    for (const key of keys) {
        const list = raw[key];
        if (!Array.isArray(list)) continue;
        const seen = new Set();
        const next = [];
        for (const item of list) {
            const id = String(item || '');
            if (!id || !ids.has(id) || seen.has(id)) continue;
            seen.add(id);
            next.push(id);
        }
        if (next.length) out[key] = next;
    }
    return out;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, true>}
 */
export function normalizeWbsCollapsedByBucket(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    const keys = [WBS_UNMAPPED, ...Array.from({ length: WBS_BUCKET_COUNT }, (_, i) => String(i))];
    for (const key of keys) {
        if (raw[key]) out[key] = true;
    }
    return out;
}

/**
 * @param {object|null|undefined} planner
 * @returns {'phase'|'deliverable'}
 */
export function getWbsMode(planner) {
    return normalizeWbsMode(planner?.wbsMode);
}

/**
 * @param {object|null|undefined} planner
 * @param {'phase'|'deliverable'} [mode]
 * @returns {string[]}
 */
export function getWbsLabels(planner, mode) {
    const m = mode || getWbsMode(planner);
    if (m === 'deliverable') {
        return normalizeWbsLabels(planner?.wbsDeliverableLabels, WBS_DEFAULT_DELIVERABLE_LABELS);
    }
    return normalizeWbsLabels(planner?.wbsPhaseLabels, WBS_DEFAULT_PHASE_LABELS);
}

/**
 * @param {object|null|undefined} planner
 * @param {string} rowId
 * @param {'phase'|'deliverable'} [mode]
 * @returns {number|null} bucket index or null for unmapped
 */
export function getWbsBucketForId(planner, rowId, mode) {
    const m = mode || getWbsMode(planner);
    const map = m === 'deliverable' ? planner?.wbsDeliverableById : planner?.wbsPhaseById;
    const raw = map?.[String(rowId)];
    const bucket = Number(raw);
    if (!Number.isFinite(bucket) || bucket < 0 || bucket >= WBS_BUCKET_COUNT) return null;
    return Math.floor(bucket);
}

/**
 * @param {number|null|undefined} bucket
 * @returns {string}
 */
export function wbsBucketKey(bucket) {
    if (bucket == null || !Number.isFinite(bucket)) return WBS_UNMAPPED;
    const n = Math.floor(Number(bucket));
    if (n < 0 || n >= WBS_BUCKET_COUNT) return WBS_UNMAPPED;
    return String(n);
}

/**
 * @param {object|null|undefined} planner
 * @param {string} bucketKey
 * @returns {boolean}
 */
export function isWbsBucketCollapsed(planner, bucketKey) {
    const key = String(bucketKey || '');
    return !!(planner?.wbsCollapsedByBucket?.[key]);
}

/**
 * @param {object} planner
 * @param {string} bucketKey
 * @param {boolean} collapsed
 */
export function setWbsBucketCollapsed(planner, bucketKey, collapsed) {
    if (!planner) return;
    if (!planner.wbsCollapsedByBucket || typeof planner.wbsCollapsedByBucket !== 'object') {
        planner.wbsCollapsedByBucket = {};
    }
    const key = String(bucketKey || '');
    if (!key) return;
    if (collapsed) planner.wbsCollapsedByBucket[key] = true;
    else delete planner.wbsCollapsedByBucket[key];
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

function isPackId(planner, rowId) {
    return !!(planner?.rowPackById?.[String(rowId)]);
}

function isHiddenId(planner, rowId) {
    return !!(planner?.rowHiddenById?.[String(rowId)]);
}

/**
 * Leaf cards only: named, non-hidden, non-pack.
 * @param {object|null|undefined} planner
 * @returns {Array<{ row: number, rowId: string, id: string, name: string, start: string, stop: string, category: string, comments: string, categoryColor: string }>}
 */
export function derivePlannerWbsCards(planner) {
    const sheet = planner?.sheet;
    const rowIds = Array.isArray(planner?.rowIds) ? planner.rowIds : [];
    if (!sheet) return [];
    const cards = [];
    for (let r = 0; r < (sheet.rows || 0); r++) {
        const rowId = String(rowIds[r] || '');
        if (!rowId) continue;
        if (isPackId(planner, rowId) || isHiddenId(planner, rowId)) continue;
        const name = cellTrim(sheet, r, NAME_COL);
        if (!name) continue;
        const category = cellTrim(sheet, r, CATEGORY_COL);
        cards.push({
            row: r,
            rowId,
            id: rowId,
            name,
            start: cellTrim(sheet, r, START_COL),
            stop: cellTrim(sheet, r, STOP_COL),
            category,
            comments: cellTrim(sheet, r, COMMENTS_COL),
            categoryColor: categoryColorLookup(planner, category)
        });
    }
    return cards;
}

/**
 * @param {object|null|undefined} planner
 * @param {{ mode?: string }} [opts]
 */
export function layoutPlannerWbs(planner, { mode } = {}) {
    const m = normalizeWbsMode(mode || planner?.wbsMode);
    const labels = getWbsLabels(planner, m);
    const cards = derivePlannerWbsCards(planner);
    const columns = [
        { key: WBS_UNMAPPED, bucket: null, label: 'Unmapped', cards: [] },
        ...labels.map((label, bucket) => ({
            key: String(bucket),
            bucket,
            label,
            cards: []
        }))
    ];
    const byKey = new Map(columns.map((c) => [c.key, c]));

    for (const card of cards) {
        const bucket = getWbsBucketForId(planner, card.rowId, m);
        const key = wbsBucketKey(bucket);
        byKey.get(key)?.cards.push(card);
    }

    const orderMap = m === 'deliverable'
        ? (planner?.wbsDeliverableOrderByBucket || {})
        : (planner?.wbsPhaseOrderByBucket || {});

    for (const col of columns) {
        const order = Array.isArray(orderMap[col.key]) ? orderMap[col.key] : [];
        const rank = new Map(order.map((id, i) => [String(id), i]));
        col.cards.sort((a, b) => {
            const ra = rank.has(a.rowId) ? rank.get(a.rowId) : Number.POSITIVE_INFINITY;
            const rb = rank.has(b.rowId) ? rank.get(b.rowId) : Number.POSITIVE_INFINITY;
            if (ra !== rb) return ra - rb;
            return a.row - b.row;
        });
        col.collapsed = isWbsBucketCollapsed(planner, col.key);
    }

    return { mode: m, labels, columns };
}

/**
 * @param {object} planner
 * @param {string} rowId
 * @param {number|null} toBucket - null = unmapped
 * @param {{ beforeId?: string|null, mode?: string }} [opts]
 */
export function moveWbsCard(planner, rowId, toBucket, { beforeId = null, mode } = {}) {
    if (!planner || !rowId) return;
    const m = normalizeWbsMode(mode || planner.wbsMode);
    const id = String(rowId);
    const bucket = toBucket == null || !Number.isFinite(toBucket)
        ? null
        : Math.floor(Number(toBucket));
    if (bucket != null && (bucket < 0 || bucket >= WBS_BUCKET_COUNT)) return;

    const byKey = m === 'deliverable' ? 'wbsDeliverableById' : 'wbsPhaseById';
    const orderKey = m === 'deliverable' ? 'wbsDeliverableOrderByBucket' : 'wbsPhaseOrderByBucket';

    if (!planner[byKey] || typeof planner[byKey] !== 'object') planner[byKey] = {};
    if (!planner[orderKey] || typeof planner[orderKey] !== 'object') planner[orderKey] = {};

    if (bucket == null) delete planner[byKey][id];
    else planner[byKey][id] = bucket;

    const order = planner[orderKey];
    const allKeys = [WBS_UNMAPPED, ...Array.from({ length: WBS_BUCKET_COUNT }, (_, i) => String(i))];
    for (const key of allKeys) {
        const list = order[key];
        if (!Array.isArray(list)) continue;
        const next = list.filter((x) => String(x) !== id);
        if (next.length) order[key] = next;
        else delete order[key];
    }

    const destKey = wbsBucketKey(bucket);
    let list = Array.isArray(order[destKey]) ? order[destKey].filter((x) => String(x) !== id) : [];
    if (!list.length) {
        list = derivePlannerWbsCards(planner)
            .filter((c) => c.rowId !== id && wbsBucketKey(getWbsBucketForId(planner, c.rowId, m)) === destKey)
            .map((c) => c.rowId)
            .sort((a, b) => {
                const ra = planner.rowIds?.indexOf(a) ?? 0;
                const rb = planner.rowIds?.indexOf(b) ?? 0;
                return ra - rb;
            });
    }

    const before = beforeId != null ? String(beforeId) : null;
    if (before && list.includes(before)) {
        list.splice(list.indexOf(before), 0, id);
    } else {
        list.push(id);
    }
    order[destKey] = list;
}

/**
 * Clear active-mode assignments + order (all Unmapped).
 * @param {object} planner
 * @param {'phase'|'deliverable'} [mode]
 */
export function resetWbsArrangement(planner, mode) {
    if (!planner) return;
    const m = normalizeWbsMode(mode || planner.wbsMode);
    if (m === 'deliverable') {
        planner.wbsDeliverableById = {};
        planner.wbsDeliverableOrderByBucket = {};
    } else {
        planner.wbsPhaseById = {};
        planner.wbsPhaseOrderByBucket = {};
    }
}

/**
 * Restore active-mode default bucket labels.
 * @param {object} planner
 * @param {'phase'|'deliverable'} [mode]
 */
export function resetWbsLabels(planner, mode) {
    if (!planner) return;
    const m = normalizeWbsMode(mode || planner.wbsMode);
    if (m === 'deliverable') {
        planner.wbsDeliverableLabels = [...WBS_DEFAULT_DELIVERABLE_LABELS];
    } else {
        planner.wbsPhaseLabels = [...WBS_DEFAULT_PHASE_LABELS];
    }
}

/**
 * @param {object} planner
 * @param {number} bucket
 * @param {string} label
 * @param {'phase'|'deliverable'} [mode]
 */
export function setWbsBucketLabel(planner, bucket, label, mode) {
    if (!planner || !Number.isFinite(bucket)) return;
    const b = Math.floor(bucket);
    if (b < 0 || b >= WBS_BUCKET_COUNT) return;
    const m = normalizeWbsMode(mode || planner.wbsMode);
    const next = String(label || '').trim() || (m === 'deliverable'
        ? WBS_DEFAULT_DELIVERABLE_LABELS[b]
        : WBS_DEFAULT_PHASE_LABELS[b]);
    if (m === 'deliverable') {
        const labels = normalizeWbsLabels(planner.wbsDeliverableLabels, WBS_DEFAULT_DELIVERABLE_LABELS);
        labels[b] = next;
        planner.wbsDeliverableLabels = labels;
    } else {
        const labels = normalizeWbsLabels(planner.wbsPhaseLabels, WBS_DEFAULT_PHASE_LABELS);
        labels[b] = next;
        planner.wbsPhaseLabels = labels;
    }
}

/**
 * Drop WBS map entries for removed row ids.
 * @param {object} planner
 * @param {Iterable<string>} removedIds
 */
export function pruneWbsAfterRowRemove(planner, removedIds) {
    if (!planner || !removedIds) return;
    const gone = new Set([...removedIds].map(String));
    if (!gone.size) return;
    for (const mapKey of ['wbsPhaseById', 'wbsDeliverableById']) {
        const map = planner[mapKey];
        if (!map || typeof map !== 'object') continue;
        for (const id of gone) delete map[id];
    }
    for (const orderKey of ['wbsPhaseOrderByBucket', 'wbsDeliverableOrderByBucket']) {
        const order = planner[orderKey];
        if (!order || typeof order !== 'object') continue;
        for (const key of Object.keys(order)) {
            const list = order[key];
            if (!Array.isArray(list)) continue;
            const next = list.filter((id) => !gone.has(String(id)));
            if (next.length) order[key] = next;
            else delete order[key];
        }
    }
}
