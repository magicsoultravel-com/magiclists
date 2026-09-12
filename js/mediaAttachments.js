/** @module {"owns":"note↔media attachment helpers", "related":["mediaLibrary.js","noteSurface.js","mediaLibraryOverlay.js"]} */
import { NoteSurface } from './noteSurface.js';
import { stripRichText } from './richText.js';
import { removeMediaIdFromNoteCanvas } from './noteFieldOwnership.js';

/** Discrete scale range for expand-in-note image size */
export const ATTACH_SCALE_MIN = 0.2;
export const ATTACH_SCALE_MAX = 3;
export const ATTACH_SCALE_STEP = 0.1;
export const ATTACH_SCALE_DEFAULT = 1;

function roundAttachScale(n) {
    return Math.round(n * 10) / 10;
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function syncAttachmentsUi(item) {
    import('./noteAttachmentsUi.js').then(({ syncNoteAttachmentsDom }) => {
        syncNoteAttachmentsDom(item);
    }).catch(() => {});
}

/**
 * Clamp scale to 0.2–3 in 0.1 steps (default 1).
 * @param {unknown} scale
 * @returns {number}
 */
export function clampAttachScale(scale) {
    const n = Number(scale);
    if (!Number.isFinite(n)) return ATTACH_SCALE_DEFAULT;
    const clamped = Math.min(ATTACH_SCALE_MAX, Math.max(ATTACH_SCALE_MIN, n));
    return roundAttachScale(clamped);
}

/**
 * Step scale up (+1) or down (-1) by ATTACH_SCALE_STEP.
 * @param {unknown} scale
 * @param {number} dir
 * @returns {number}
 */
export function stepAttachScale(scale, dir) {
    const cur = clampAttachScale(scale);
    const delta = dir > 0 ? ATTACH_SCALE_STEP : -ATTACH_SCALE_STEP;
    return clampAttachScale(cur + delta);
}

/**
 * Canvas position in px (null when unset / use default cascade).
 * @param {unknown} value
 * @returns {number|null}
 */
export function clampAttachCoord(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return null;
    return Math.round(Math.max(0, n));
}

/**
 * Normalize note.attachments to `{ mediaId, attachedAt, expanded, scale, x, y }[]`.
 * @param {unknown} list
 * @returns {Array<{ mediaId: string, attachedAt: number, expanded: boolean, scale: number, x: number|null, y: number|null }>}
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
        const x = clampAttachCoord(
            typeof entry === 'object' && entry ? entry.x : null
        );
        const y = clampAttachCoord(
            typeof entry === 'object' && entry ? entry.y : null
        );
        out.push({
            mediaId,
            attachedAt: Number.isFinite(attachedAt) && attachedAt > 0 ? attachedAt : nowSeconds(),
            expanded,
            scale,
            x,
            y
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
        list.push({ mediaId, attachedAt: nowSeconds(), expanded: false, scale: 1, x: null, y: null });
        it.attachments = list;
        added = true;
    }, { preserveView: true });
    if (added) syncAttachmentsUi(item);
    return added;
}

/**
 * Remove a media id from a note's attachments (membership) and from canvas images
 * (presentation). Collapse/canvas-only delete must not call this.
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
        const canvasRemoved = removeMediaIdFromNoteCanvas(it.canvas, mediaId);
        if (list.length === before.length && !canvasRemoved) return;
        it.attachments = list;
        removed = true;
    }, { preserveView: true });
    if (removed) syncAttachmentsUi(item);
    return removed;
}

/**
 * Update expand-in-note / canvas view state for one attachment.
 * @param {object} item
 * @param {string} mediaId
 * @param {{ expanded?: boolean, scale?: number, x?: number|null, y?: number|null }} patch
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
        if ('x' in patch) next.x = clampAttachCoord(patch.x);
        if ('y' in patch) next.y = clampAttachCoord(patch.y);
        if (
            next.expanded === prev.expanded
            && next.scale === prev.scale
            && next.x === prev.x
            && next.y === prev.y
        ) return;
        list[idx] = next;
        it.attachments = list;
        changed = true;
    }, { preserveView: true, skipRerender: true });
    if (changed && syncUi) syncAttachmentsUi(item);
    return changed;
}

/**
 * Collapse all canvas tiles and clear saved positions for a note.
 * @param {object} item
 * @param {{ syncUi?: boolean }} [opts]
 * @returns {boolean}
 */
export function resetAttachmentCanvas(item, { syncUi = true } = {}) {
    if (!item?.id) return false;
    let changed = false;
    NoteSurface.mutateItem(item, (it) => {
        const list = normalizeAttachments(it.attachments);
        let nextChanged = false;
        const next = list.map((entry) => {
            if (!entry.expanded && entry.x == null && entry.y == null) return entry;
            nextChanged = true;
            return { ...entry, expanded: false, x: null, y: null };
        });
        if (!nextChanged) return;
        it.attachments = next;
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
