/** @module {"owns":"note field ownership contract and modal draft reconciliation", "related":["noteModel.js","editor.js","app.js","mediaAttachments.js"]} */

/**
 * Modal draft is authoritative until persist. Overlay these onto the live item on save.
 * @type {readonly string[]}
 */
export const MODAL_OWNED_FIELDS = Object.freeze([
    'title',
    'content',
    'steps',
    'sheet',
    'noteTemplate',
    'type',
    'visibility',
    'status',
    'categories',
    'backgroundColor',
    'startDateTime',
    'endDateTime',
    'editorBodyLayout',
    'isRecurring',
    'hideFromCalendar',
    'hiddenFromBoard'
]);

/**
 * Live AppState is authoritative. Draft must not clobber these on save.
 * @type {readonly string[]}
 */
export const SHARED_FIELDS = Object.freeze([
    'attachments',
    'canvas',
    'canvasHidden',
    'canvasShowNoteContent',
    'canvasShowNoteChecklist',
    'canvasOverlayFontSize'
]);

/**
 * Prefer live values on merge; modal must not reset from a stale draft.
 * @type {readonly string[]}
 */
export const EXTERNAL_ONLY_FIELDS = Object.freeze([
    'id',
    'owner_id',
    'created_at',
    'updated_at',
    'desktopId',
    'tileSize'
]);

/**
 * Deep-clone a value for Shared field patches (attachments / canvas docs).
 * @param {unknown} value
 * @returns {unknown}
 */
function cloneValue(value) {
    if (value == null) return value;
    return JSON.parse(JSON.stringify(value));
}

/**
 * Build a save payload: live item as base, overlay ModalOwned from the draft.
 * Shared and ExternalOnly ride from live automatically.
 * For new notes with no live item, returns a clone of the draft.
 *
 * @param {object|null|undefined} liveItem
 * @param {object} draft
 * @returns {object}
 */
export function mergeModalOwnedOntoLive(liveItem, draft) {
    if (!draft || typeof draft !== 'object') {
        return liveItem ? { ...liveItem } : {};
    }
    if (!liveItem || typeof liveItem !== 'object') {
        return JSON.parse(JSON.stringify(draft));
    }

    const out = { ...liveItem };
    for (const key of MODAL_OWNED_FIELDS) {
        if (key === 'noteTemplate') {
            const val = draft.noteTemplate;
            if (val === 'default' || !val) delete out.noteTemplate;
            else out.noteTemplate = val;
            continue;
        }
        if (Object.prototype.hasOwnProperty.call(draft, key)) {
            out[key] = draft[key];
        }
    }
    return out;
}

/**
 * Copy Shared fields from live onto the modal draft cache (in place).
 * Always deep-clones so the draft never aliases live canvas/attachments.
 * Leaves ModalOwned and identity fields alone.
 *
 * @param {object} draft
 * @param {object} liveItem
 * @returns {boolean} true if any Shared field content changed on the draft
 */
export function patchSharedFieldsOntoDraft(draft, liveItem) {
    if (!draft || !liveItem) return false;
    let changed = false;
    for (const key of SHARED_FIELDS) {
        const next = cloneValue(liveItem[key]);
        const prev = draft[key];
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
            changed = true;
        }
        if (next === undefined) delete draft[key];
        else draft[key] = next;
    }
    return changed;
}

/**
 * Whether Shared fields differ between two note objects.
 * @param {object|null|undefined} a
 * @param {object|null|undefined} b
 * @returns {boolean}
 */
export function sharedFieldsDiffer(a, b) {
    if (!a || !b) return !!(a || b);
    for (const key of SHARED_FIELDS) {
        if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return true;
    }
    return false;
}

/**
 * True when a note canvas document has any strokes, texts, images, or shapes.
 * @param {unknown} canvas
 * @returns {boolean}
 */
export function noteCanvasHasContent(canvas) {
    if (!canvas || typeof canvas !== 'object') return false;
    const pages = Array.isArray(canvas.pages) ? canvas.pages : [];
    for (const page of pages) {
        if (!page || typeof page !== 'object') continue;
        if ((page.strokes || []).length) return true;
        if ((page.texts || []).length) return true;
        if ((page.images || []).length) return true;
        if ((page.shapes || []).length) return true;
    }
    const inf = canvas.infinite;
    if (inf && typeof inf === 'object') {
        if ((inf.strokes || []).length) return true;
        if ((inf.texts || []).length) return true;
        if ((inf.images || []).length) return true;
        if ((inf.shapes || []).length) return true;
    }
    return false;
}

/**
 * Remove every canvas image object with the given mediaId from a note canvas doc.
 * Mutates `canvas` in place when provided; returns whether anything was removed.
 *
 * @param {object|null|undefined} canvas
 * @param {string} mediaId
 * @returns {boolean}
 */
export function removeMediaIdFromNoteCanvas(canvas, mediaId) {
    if (!canvas || !mediaId || typeof canvas !== 'object') return false;
    let removed = false;
    const scrub = (images) => {
        if (!Array.isArray(images)) return images;
        const next = images.filter((img) => img?.mediaId !== mediaId);
        if (next.length !== images.length) removed = true;
        return next;
    };
    if (Array.isArray(canvas.pages)) {
        for (const page of canvas.pages) {
            if (!page || typeof page !== 'object') continue;
            page.images = scrub(page.images || []);
        }
    }
    if (canvas.infinite && typeof canvas.infinite === 'object') {
        canvas.infinite.images = scrub(canvas.infinite.images || []);
    }
    return removed;
}
