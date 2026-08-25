/** @module {"owns":"note↔media attachment helpers", "related":["mediaLibrary.js","noteSurface.js","mediaLibraryOverlay.js"]} */
import { NoteSurface } from './noteSurface.js';
import { stripRichText } from './richText.js';

/** Discrete scale steps for expand-in-note image size */
export const ATTACH_SCALE_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function syncAttachmentsUi(item) {
    import('./noteAttachmentsUi.js').then(({ syncNoteAttachmentsDom }) => {
        syncNoteAttachmentsDom(item);
    }).catch(() => {});
}

/**
 * Snap scale to nearest allowed step (default 1).
 * @param {unknown} scale
 * @returns {number}
 */
export function clampAttachScale(scale) {
    const n = Number(scale);
    if (!Number.isFinite(n)) return 1;
    let best = ATTACH_SCALE_STEPS[0];
    let bestDist = Infinity;
    for (const step of ATTACH_SCALE_STEPS) {
        const dist = Math.abs(step - n);
        if (dist < bestDist) {
            bestDist = dist;
            best = step;
        }
    }
    return best;
}

/**
 * Step scale up (+1) or down (-1) within ATTACH_SCALE_STEPS.
 * @param {unknown} scale
 * @param {number} dir
 * @returns {number}
 */
export function stepAttachScale(scale, dir) {
    const cur = clampAttachScale(scale);
    const idx = ATTACH_SCALE_STEPS.indexOf(cur);
    const next = idx + (dir > 0 ? 1 : -1);
    if (next < 0 || next >= ATTACH_SCALE_STEPS.length) return cur;
    return ATTACH_SCALE_STEPS[next];
}

/**
 * Normalize note.attachments to `{ mediaId, attachedAt, expanded, scale }[]`.
 * @param {unknown} list
 * @returns {Array<{ mediaId: string, attachedAt: number, expanded: boolean, scale: number }>}
 */
export function normalizeAttachments(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const entry of list) {
        const mediaId = typeof entry === 'string'
            ? entry
            : (entry && typeof entry === 'object' ? entry.mediaId : null);
        if (!mediaId || typeof mediaId !== 'string' || seen.has(mediaId)) continue;
        seen.add(mediaId);
        const attachedAt = Number(
            typeof entry === 'object' && entry ? entry.attachedAt : 0
        );
        const expanded = !!(typeof entry === 'object' && entry && entry.expanded);
        const scale = clampAttachScale(
            typeof entry === 'object' && entry ? entry.scale : 1
        );
        out.push({
            mediaId,
            attachedAt: Number.isFinite(attachedAt) && attachedAt > 0 ? attachedAt : nowSeconds(),
            expanded,
            scale
        });
    }
    return out;
}

/**
 * @param {object} item
 * @returns {number}
 */
export function attachmentCount(item) {
    return normalizeAttachments(item?.attachments).length;
}

/**
 * Attach a media id to a note (deduped). Emits item:mutation_requested via mutateItem.
 * @param {object} item - live note object from AppState
 * @param {string} mediaId
 * @returns {boolean} true if newly attached
 */
export function attachMediaToNote(item, mediaId) {
    if (!item?.id || !mediaId) return false;
    let added = false;
    NoteSurface.mutateItem(item, (it) => {
        const list = normalizeAttachments(it.attachments);
        if (list.some((a) => a.mediaId === mediaId)) return;
        list.push({ mediaId, attachedAt: nowSeconds(), expanded: false, scale: 1 });
        it.attachments = list;
        added = true;
    }, { preserveView: true });
    if (added) syncAttachmentsUi(item);
    return added;
}

/**
 * Remove a media id from a note's attachments.
 * @param {object} item
 * @param {string} mediaId
 * @returns {boolean}
 */
export function detachMediaFromNote(item, mediaId) {
    if (!item?.id || !mediaId) return false;
    let removed = false;
    NoteSurface.mutateItem(item, (it) => {
        const before = normalizeAttachments(it.attachments);
        const list = before.filter((a) => a.mediaId !== mediaId);
        if (list.length === before.length) return;
        it.attachments = list;
        removed = true;
    }, { preserveView: true });
    if (removed) syncAttachmentsUi(item);
    return removed;
}

/**
 * Update expand-in-note view state for one attachment (expanded / scale).
 * @param {object} item
 * @param {string} mediaId
 * @param {{ expanded?: boolean, scale?: number }} patch
 * @param {{ syncUi?: boolean }} [opts]
 * @returns {boolean}
 */
export function updateAttachmentView(item, mediaId, patch = {}, { syncUi = true } = {}) {
    if (!item?.id || !mediaId || !patch || typeof patch !== 'object') return false;
    let changed = false;
    NoteSurface.mutateItem(item, (it) => {
        const list = normalizeAttachments(it.attachments);
        const idx = list.findIndex((a) => a.mediaId === mediaId);
        if (idx < 0) return;
        const prev = list[idx];
        const next = { ...prev };
        if ('expanded' in patch) next.expanded = !!patch.expanded;
        if ('scale' in patch) next.scale = clampAttachScale(patch.scale);
        if (next.expanded === prev.expanded && next.scale === prev.scale) return;
        list[idx] = next;
        it.attachments = list;
        changed = true;
    }, { preserveView: true, skipRerender: true });
    if (changed && syncUi) syncAttachmentsUi(item);
    return changed;
}

/**
 * Find notes that reference a media id.
 * @param {object[]} items
 * @param {string} mediaId
 * @returns {object[]}
 */
export function findNotesForMedia(items, mediaId) {
    if (!mediaId || !Array.isArray(items)) return [];
    return items.filter((item) =>
        normalizeAttachments(item?.attachments).some((a) => a.mediaId === mediaId)
    );
}

/**
 * Active (non-archived) notes sorted by last modified desc.
 * @param {object[]} items
 * @returns {object[]}
 */
export function notesForAttachPicker(items) {
    const active = (items || []).filter((item) => item && item.status !== 'archived');
    return [...active].sort((a, b) => {
        const left = Number(a.updated_at || a.created_at || 0);
        const right = Number(b.updated_at || b.created_at || 0);
        return right - left;
    });
}

/**
 * Plain title for chips / toasts.
 * @param {object} item
 */
export function noteDisplayTitle(item) {
    const plain = stripRichText(item?.title || '').trim();
    return plain || 'Untitled';
}
