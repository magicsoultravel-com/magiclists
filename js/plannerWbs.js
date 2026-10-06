/** @module {"owns":"magicPlanner WBS layout — phase/deliverable buckets, drag meta", "related":["planner.js","plannerUi.js","plannerKanban.js"]} */

export const WBS_BUCKET_COUNT = 5;
/** @deprecated Missing assignment defaults to first column (0); kept for old order-map migration. */
export const WBS_UNMAPPED = 'unmapped';
export const WBS_MODES = Object.freeze(['phase', 'deliverable']);
export const WBS_DEFAULT_MODE = 'phase';

const WBS_BUCKET_KEYS = Object.freeze(
    Array.from({ length: WBS_BUCKET_COUNT }, (_, i) => String(i))
);

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
    const mergeIntoZero = Array.isArray(raw[WBS_UNMAPPED]) ? raw[WBS_UNMAPPED] : [];
    for (const key of WBS_BUCKET_KEYS) {
        const list = key === '0'
            ? [...(Array.isArray(raw['0']) ? raw['0'] : []), ...mergeIntoZero]
            : raw[key];
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
    for (const key of WBS_BUCKET_KEYS) {
        if (raw[key]) out[key] = true;
    }
    // Old Unmapped collapse → first column.
    if (raw[WBS_UNMAPPED]) out['0'] = true;
    return out;
}

/**
 * Sparse bucket → #rrggbb map for column header fills.
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function normalizeWbsBucketColors(raw) {
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const key of WBS_BUCKET_KEYS) {
        const color = String(raw[key] || '').trim().toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(color)) out[key] = color;
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
 * @returns {number} bucket index (missing → 0, first column)
 */
export function getWbsBucketForId(planner, rowId, mode) {
    const m = mode || getWbsMode(planner);
    const map = m === 'deliverable' ? planner?.wbsDeliverableById : planner?.wbsPhaseById;
    const raw = map?.[String(rowId)];
    const bucket = Number(raw);
    if (!Number.isFinite(bucket) || bucket < 0 || bucket >= WBS_BUCKET_COUNT) return 0;
    return Math.floor(bucket);
}

/**
 * @param {number|null|undefined} bucket
 * @returns {string}
 */
export function wbsBucketKey(bucket) {
    const n = Math.floor(Number(bucket));
    if (!Number.isFinite(n) || n < 0 || n >= WBS_BUCKET_COUNT) return '0';
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
 * @param {object|null|undefined} planner
 * @param {number|string} bucket
 * @param {'phase'|'deliverable'} [mode]
 * @returns {string} #rrggbb or ''
 */
export function getWbsBucketColor(planner, bucket, mode) {
    const key = wbsBucketKey(bucket);
    const m = normalizeWbsMode(mode || planner?.wbsMode);
    const map = m === 'deliverable'
        ? planner?.wbsDeliverableColorsByBucket
        : planner?.wbsPhaseColorsByBucket;
    const color = String(map?.[key] || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : '';
}

/**
 * @param {object} planner
 * @param {number|string} bucket
 * @param {string} hex - empty clears
 * @param {'phase'|'deliverable'} [mode]
 */
export function setWbsBucketColor(planner, bucket, hex, mode) {
    if (!planner) return;
    const key = wbsBucketKey(bucket);
    const m = normalizeWbsMode(mode || planner.wbsMode);
    const mapKey = m === 'deliverable' ? 'wbsDeliverableColorsByBucket' : 'wbsPhaseColorsByBucket';
    if (!planner[mapKey] || typeof planner[mapKey] !== 'object') planner[mapKey] = {};
    const color = String(hex || '').trim().toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(color)) {
        delete planner[mapKey][key];
        return;
    }
    planner[mapKey][key] = color;
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
 * Leaf + pack cards: named, non-hidden. Packs are first-class WBS tiles.
 * @param {object|null|undefined} planner
 * @returns {Array<{ row: number, rowId: string, id: string, name: string, start: string, stop: string, category: string, comments: string, categoryColor: string, cardColor: string, emphasis: string, collapsed: boolean, isPack: boolean }>}
 */
export function derivePlannerWbsCards(planner) {
    const sheet = planner?.sheet;
    const rowIds = Array.isArray(planner?.rowIds) ? planner.rowIds : [];
    if (!sheet) return [];
    const cards = [];
    for (let r = 0; r < (sheet.rows || 0); r++) {
        const rowId = String(rowIds[r] || '');
        if (!rowId) continue;
        if (isHiddenId(planner, rowId)) continue;
        const name = cellTrim(sheet, r, NAME_COL);
        if (!name) continue;
        const category = cellTrim(sheet, r, CATEGORY_COL);
        const categoryColor = categoryColorLookup(planner, category);
        const override = planner?.wbsCardColors?.[rowId] || '';
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
            emphasis: getWbsEmphasisForRow(planner, rowId),
            collapsed: isWbsCardCollapsed(planner, rowId),
            isPack: isPackId(planner, rowId)
        });
    }
    return cards;
}

/**
 * Child row ids under a pack (contiguous sheet block).
 * @param {object|null|undefined} planner
 * @param {string} packId
 * @returns {string[]}
 */
export function listWbsPackChildIds(planner, packId) {
    const id = String(packId || '');
    if (!id || !isPackId(planner, id) || !planner?.rowIds) return [];
    const idx = planner.rowIds.indexOf(id);
    if (idx < 0) return [];
    const out = [];
    for (let i = idx + 1; i < planner.rowIds.length; i++) {
        const cid = String(planner.rowIds[i] || '');
        if (!cid) continue;
        if (!(Number(planner.rowLevelById?.[cid]) > 0)) break;
        if (resolveWbsPackParentId(planner, cid) !== id) break;
        out.push(cid);
    }
    return out;
}

/**
 * Walk sheet order upward from a child leaf to its pack root.
 * @param {object|null|undefined} planner
 * @param {string} rowId
 * @returns {string|null}
 */
export function resolveWbsPackParentId(planner, rowId) {
    const id = String(rowId || '');
    if (!id || !planner?.rowIds) return null;
    if (!(Number(planner.rowLevelById?.[id]) > 0)) return null;
    const idx = planner.rowIds.indexOf(id);
    if (idx < 0) return null;
    for (let i = idx - 1; i >= 0; i--) {
        const pid = String(planner.rowIds[i] || '');
        if (!pid) continue;
        if (planner.rowPackById?.[pid]) return pid;
        if (Number(planner.rowLevelById?.[pid]) > 0) continue;
        break;
    }
    return null;
}

/**
 * Keep packs ahead of their children in column order for tree grouping.
 * @param {object|null|undefined} planner
 * @param {Array<object>} cards
 * @returns {Array<object>}
 */
function orderWbsPacksBeforeChildren(planner, cards) {
    const list = Array.isArray(cards) ? cards : [];
    if (list.length < 2) return list;
    const byId = new Map(list.map((c) => [c.rowId, c]));
    const childToPack = new Map();
    for (const c of list) {
        if (c.isPack) continue;
        const pid = resolveWbsPackParentId(planner, c.rowId);
        if (pid && byId.has(pid)) childToPack.set(c.rowId, pid);
    }
    const seen = new Set();
    const out = [];
    for (const c of list) {
        if (seen.has(c.rowId)) continue;
        const packId = c.isPack ? c.rowId : childToPack.get(c.rowId);
        if (packId && byId.has(packId) && !seen.has(packId)) {
            seen.add(packId);
            out.push(byId.get(packId));
            for (const x of list) {
                if (childToPack.get(x.rowId) === packId && !seen.has(x.rowId)) {
                    seen.add(x.rowId);
                    out.push(x);
                }
            }
            continue;
        }
        seen.add(c.rowId);
        out.push(c);
    }
    return out;
}

/**
 * Contiguous pack runs for in-column tree chrome (presentation only).
 * @param {object|null|undefined} planner
 * @param {Array<object>} cards
 * @returns {Array<{ type: 'root', card: object } | { type: 'pack', packId: string, packRow: number, packName: string, packStart: string, packStop: string, category: string, categoryColor: string, cardColor: string, collapsed: boolean, packCard: object, cards: object[] }>}
 */
export function groupWbsColumnCards(planner, cards) {
    const list = orderWbsPacksBeforeChildren(planner, cards);
    /** @type {Array<{ type: 'root', card: object } | { type: 'pack', packId: string, packRow: number, packName: string, packStart: string, packStop: string, category: string, categoryColor: string, cardColor: string, collapsed: boolean, packCard: object, cards: object[] }>} */
    const groups = [];
    const packGroupById = new Map();

    const makePackMeta = (packCard, packId, packRow) => ({
        type: /** @type {'pack'} */ ('pack'),
        packId,
        packRow,
        packName: String(packCard?.name || ''),
        packStart: String(packCard?.start || ''),
        packStop: String(packCard?.stop || ''),
        category: String(packCard?.category || ''),
        categoryColor: String(packCard?.categoryColor || ''),
        cardColor: String(packCard?.cardColor || ''),
        collapsed: !!(packId && planner?.rowCollapsedById?.[packId]),
        packCard,
        cards: /** @type {object[]} */ ([])
    });

    for (const card of list) {
        if (card.isPack || isPackId(planner, card.rowId)) {
            const packId = card.rowId;
            let g = packGroupById.get(packId);
            if (g) {
                g.packCard = card;
                g.packRow = card.row;
                g.packName = card.name;
                g.packStart = card.start;
                g.packStop = card.stop;
                g.category = card.category;
                g.categoryColor = card.categoryColor;
                g.cardColor = card.cardColor;
                g.collapsed = !!(planner?.rowCollapsedById?.[packId]);
            } else {
                g = makePackMeta(card, packId, card.row);
                groups.push(g);
                packGroupById.set(packId, g);
            }
            continue;
        }
        const packId = resolveWbsPackParentId(planner, card.rowId);
        if (packId && packGroupById.has(packId)) {
            packGroupById.get(packId).cards.push(card);
            continue;
        }
        if (packId) {
            const packRow = planner?.rowIds?.indexOf(packId) ?? -1;
            const packName = packRow >= 0 ? cellTrim(planner.sheet, packRow, NAME_COL) : '';
            const category = packRow >= 0 ? cellTrim(planner.sheet, packRow, CATEGORY_COL) : '';
            const categoryColor = categoryColorLookup(planner, category);
            const override = planner?.wbsCardColors?.[packId] || '';
            const cardColor = /^#[0-9a-fA-F]{6}$/.test(override) ? override : categoryColor;
            const synthetic = {
                row: packRow,
                rowId: packId,
                id: packId,
                name: packName,
                start: packRow >= 0 ? cellTrim(planner.sheet, packRow, START_COL) : '',
                stop: packRow >= 0 ? cellTrim(planner.sheet, packRow, STOP_COL) : '',
                category,
                comments: packRow >= 0 ? cellTrim(planner.sheet, packRow, COMMENTS_COL) : '',
                categoryColor,
                cardColor,
                emphasis: getWbsEmphasisForRow(planner, packId),
                collapsed: isWbsCardCollapsed(planner, packId),
                isPack: true
            };
            const g = makePackMeta(synthetic, packId, packRow);
            g.cards.push(card);
            groups.push(g);
            packGroupById.set(packId, g);
            continue;
        }
        groups.push({ type: 'root', card });
    }
    return groups;
}

/**
 * @param {object|null|undefined} planner
 * @param {{ mode?: string }} [opts]
 */
export function layoutPlannerWbs(planner, { mode } = {}) {
    const m = normalizeWbsMode(mode || planner?.wbsMode);
    const labels = getWbsLabels(planner, m);
    const cards = derivePlannerWbsCards(planner);
    const columns = labels.map((label, bucket) => ({
        key: String(bucket),
        bucket,
        label,
        color: getWbsBucketColor(planner, bucket, m),
        cards: [],
        groups: []
    }));
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
        col.groups = groupWbsColumnCards(planner, col.cards);
        col.collapsed = isWbsBucketCollapsed(planner, col.key);
    }

    return { mode: m, labels, columns };
}

/**
 * @param {object} planner
 * @param {string} rowId
 * @param {number|null|undefined} toBucket - null/invalid → first column (0)
 * @param {{ beforeId?: string|null, mode?: string }} [opts]
 */
function moveWbsCardSingle(planner, rowId, toBucket, { beforeId = null, mode } = {}) {
    if (!planner || !rowId) return;
    const m = normalizeWbsMode(mode || planner.wbsMode);
    const id = String(rowId);
    let bucket = toBucket == null || !Number.isFinite(toBucket)
        ? 0
        : Math.floor(Number(toBucket));
    if (bucket < 0 || bucket >= WBS_BUCKET_COUNT) bucket = 0;

    const byKey = m === 'deliverable' ? 'wbsDeliverableById' : 'wbsPhaseById';
    const orderKey = m === 'deliverable' ? 'wbsDeliverableOrderByBucket' : 'wbsPhaseOrderByBucket';

    if (!planner[byKey] || typeof planner[byKey] !== 'object') planner[byKey] = {};
    if (!planner[orderKey] || typeof planner[orderKey] !== 'object') planner[orderKey] = {};

    // Sparse maps: omit explicit 0 (default first column), same spirit as Kanban stage 0.
    if (bucket === 0) delete planner[byKey][id];
    else planner[byKey][id] = bucket;

    const order = planner[orderKey];
    for (const key of [...WBS_BUCKET_KEYS, WBS_UNMAPPED]) {
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
 * Move a WBS card. Packs take same-bucket children with them.
 * @param {object} planner
 * @param {string} rowId
 * @param {number|null|undefined} toBucket - null/invalid → first column (0)
 * @param {{ beforeId?: string|null, mode?: string }} [opts]
 */
export function moveWbsCard(planner, rowId, toBucket, { beforeId = null, mode } = {}) {
    if (!planner || !rowId) return;
    const m = normalizeWbsMode(mode || planner.wbsMode);
    const id = String(rowId);
    const fromBucket = getWbsBucketForId(planner, id, m);
    const childIds = isPackId(planner, id)
        ? listWbsPackChildIds(planner, id)
            .filter((cid) => getWbsBucketForId(planner, cid, m) === fromBucket)
        : [];

    moveWbsCardSingle(planner, id, toBucket, { beforeId, mode: m });
    // Children follow the pack (each insert before the same beforeId preserves order).
    for (const cid of childIds) {
        moveWbsCardSingle(planner, cid, toBucket, { beforeId, mode: m });
    }
}

/**
 * Clear active-mode assignments + order (everything back in first column).
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
        planner.wbsDeliverableColorsByBucket = {};
    } else {
        planner.wbsPhaseLabels = [...WBS_DEFAULT_PHASE_LABELS];
        planner.wbsPhaseColorsByBucket = {};
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
    for (const mapKey of [
        'wbsPhaseById',
        'wbsDeliverableById',
        'wbsCardColors',
        'wbsEmphasisById',
        'wbsCollapsedById'
    ]) {
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

export const WBS_EMPHASIS_MODES = Object.freeze(['urgent', 'muted']);

/**
 * @param {object|null|undefined} planner
 * @param {number|string} rowOrId
 * @returns {string}
 */
function resolveWbsRowOrId(planner, rowOrId) {
    if (typeof rowOrId === 'string' && rowOrId && !/^\d+$/.test(rowOrId)) return rowOrId;
    if (typeof rowOrId === 'string' && planner?.rowIds?.includes(rowOrId)) return rowOrId;
    const row = Number(rowOrId);
    if (Number.isFinite(row) && Array.isArray(planner?.rowIds) && row >= 0 && row < planner.rowIds.length) {
        return String(planner.rowIds[row] || '');
    }
    if (typeof rowOrId === 'string' && planner?.rowIds?.includes(rowOrId)) return rowOrId;
    return String(rowOrId ?? '');
}

/**
 * @param {object|null|undefined} planner
 * @param {number|string} rowOrId
 * @returns {''|'urgent'|'muted'}
 */
export function getWbsEmphasisForRow(planner, rowOrId) {
    const id = resolveWbsRowOrId(planner, rowOrId);
    const raw = planner?.wbsEmphasisById?.[id];
    const mode = String(raw || '').toLowerCase();
    return WBS_EMPHASIS_MODES.includes(mode) ? /** @type {'urgent'|'muted'} */ (mode) : '';
}

/**
 * @param {object|null|undefined} planner
 * @param {number|string} rowOrId
 * @returns {boolean}
 */
export function isWbsCardCollapsed(planner, rowOrId) {
    const id = resolveWbsRowOrId(planner, rowOrId);
    return !!(planner?.wbsCollapsedById?.[id]);
}

/**
 * @param {object} planner
 * @param {number|string} rowOrId
 * @param {string} hex
 */
export function setWbsCardColor(planner, rowOrId, hex) {
    if (!planner) return;
    const id = resolveWbsRowOrId(planner, rowOrId);
    if (!id) return;
    const color = String(hex || '').trim();
    if (!planner.wbsCardColors || typeof planner.wbsCardColors !== 'object') {
        planner.wbsCardColors = {};
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        delete planner.wbsCardColors[id];
        return;
    }
    planner.wbsCardColors[id] = color.toLowerCase();
}

/**
 * @param {object} planner
 * @param {number|string} rowOrId
 * @param {'urgent'|'muted'|''} mode
 */
export function setWbsCardEmphasis(planner, rowOrId, mode) {
    if (!planner) return;
    const id = resolveWbsRowOrId(planner, rowOrId);
    if (!id) return;
    if (!planner.wbsEmphasisById || typeof planner.wbsEmphasisById !== 'object') {
        planner.wbsEmphasisById = {};
    }
    const next = String(mode || '').toLowerCase();
    if (!WBS_EMPHASIS_MODES.includes(next)) {
        delete planner.wbsEmphasisById[id];
        return;
    }
    if (planner.wbsEmphasisById[id] === next) {
        delete planner.wbsEmphasisById[id];
        return;
    }
    planner.wbsEmphasisById[id] = next;
}

/**
 * @param {object} planner
 * @param {number|string} rowOrId
 */
export function resetWbsCardStyles(planner, rowOrId) {
    if (!planner) return;
    setWbsCardColor(planner, rowOrId, '');
    setWbsCardEmphasis(planner, rowOrId, '');
}

/**
 * @param {object} planner
 */
export function resetAllWbsCardStyles(planner) {
    if (!planner) return;
    planner.wbsCardColors = {};
    planner.wbsEmphasisById = {};
}

/**
 * @param {object} planner
 * @param {number|string} rowOrId
 * @param {boolean} collapsed
 */
export function setWbsCardCollapsed(planner, rowOrId, collapsed) {
    if (!planner) return;
    const id = resolveWbsRowOrId(planner, rowOrId);
    if (!id) return;
    if (!planner.wbsCollapsedById || typeof planner.wbsCollapsedById !== 'object') {
        planner.wbsCollapsedById = {};
    }
    if (collapsed) planner.wbsCollapsedById[id] = true;
    else delete planner.wbsCollapsedById[id];
}

/**
 * @param {object} planner
 */
export function expandAllWbsCards(planner) {
    if (!planner) return;
    planner.wbsCollapsedById = {};
}

/**
 * @param {object} planner
 */
export function collapseAllWbsCards(planner) {
    if (!planner) return;
    const next = {};
    for (const card of derivePlannerWbsCards(planner)) {
        next[card.rowId] = true;
    }
    planner.wbsCollapsedById = next;
}
