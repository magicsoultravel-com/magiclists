/** @module {"owns":"note↔media attachment helpers", "related":["mediaLibrary.js","noteSurface.js","mediaLibraryOverlay.js"]} */
import { NoteSurface } from './noteSurface.js';
import { stripRichText } from './richText.js';

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function syncAttachmentsUi(item) {
    import('./noteAttachmentsUi.js').then(({ syncNoteAttachmentsDom }) => {
        syncNoteAttachmentsDom(item);
    }).catch(() => {});
}

/**
 * Normalize note.attachments to `{ mediaId, attachedAt }[]`.
 * @param {unknown} list
 * @returns {Array<{ mediaId: string, attachedAt: number }>}
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
        out.push({
            mediaId,
            attachedAt: Number.isFinite(attachedAt) && attachedAt > 0 ? attachedAt : nowSeconds()
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
        list.push({ mediaId, attachedAt: nowSeconds() });
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
