/** @module {"owns":"note paste target resolution for clipboard media attach", "related":["mediaPasteCatcher.js","mediaStagingDialog.js","mediaAttachments.js"]} */

const NOTE_BODY_FIELDS = new Set(['title', 'content', 'step-text']);

/** @type {Array<(noteId: string) => object|null>} */
const liveNoteSources = [];

/** @type {(() => string|null|undefined)|null} */
let modalEditorNoteIdResolver = null;

/**
 * Register a function that returns the live note object for an id (board AppState, modal editor, popout).
 * @param {(noteId: string) => object|null} fn
 */
export function registerLiveNoteSource(fn) {
    if (typeof fn === 'function') liveNoteSources.push(fn);
}

/**
 * Resolve note id when caret is in the modal editor (no .mini-card wrapper).
 * @param {(() => string|null|undefined)|null} fn
 */
export function setModalEditorNoteIdResolver(fn) {
    modalEditorNoteIdResolver = fn;
}

/**
 * @param {Blob|File|null|undefined} file
 * @returns {boolean}
 */
export function isImageFile(file) {
    return !!(file && String(file.type || '').startsWith('image/'));
}

/**
 * @param {Array<Blob|File>} files
 * @returns {File[]|Blob[]}
 */
export function filterImageFiles(files) {
    return (files || []).filter(isImageFile);
}

function isExcludedPasteField(field) {
    if (!field) return true;
    if (field.closest?.('#media-staging-overlay')) return true;
    if (field.closest?.('.file-cabinet-category-name, .file-cabinet-filed-chip-name')) return true;
    if (field.matches?.('[data-sheet-cell]')) return true;
    return false;
}

/**
 * Resolve note id from a focused inline-edit field inside a note shell.
 * @param {Element|null|undefined} activeEl
 * @returns {{ noteId: string, field: string }|null}
 */
export function resolveNotePasteTarget(activeEl = (typeof document !== 'undefined' ? document.activeElement : null)) {
    const field = activeEl?.closest?.('.card-inline-edit');
    if (!field || isExcludedPasteField(field)) return null;

    const fieldName = field.dataset?.field;
    if (!fieldName || !NOTE_BODY_FIELDS.has(fieldName)) return null;

    const shell = field.closest?.('.editor-note-shell');
    if (!shell) return null;

    let noteId = field.closest?.('.mini-card')?.dataset?.id || null;
    if (!noteId && field.closest?.('#modal-form-mount')) {
        noteId = modalEditorNoteIdResolver?.() || null;
    }
    if (!noteId || typeof noteId !== 'string') return null;

    return { noteId, field: fieldName };
}

/**
 * When pasting files in a note, return attachNoteId if images present and user is logged in.
 * @param {Array<Blob|File>} files
 * @param {{ pasteTarget?: { noteId: string, field: string }|null, hasLogin?: boolean }} [opts]
 * @returns {string|null}
 */
export function resolveImagePasteAttachNoteId(files, { pasteTarget = null, hasLogin = false } = {}) {
    const target = pasteTarget ?? resolveNotePasteTarget();
    if (!target?.noteId) return null;
    if (!hasLogin) return null;
    if (!(files || []).some(isImageFile)) return null;
    return target.noteId;
}

/**
 * @param {string} noteId
 * @returns {object|null}
 */
export function resolveLiveNoteItem(noteId) {
    if (!noteId) return null;
    for (const src of liveNoteSources) {
        try {
            const item = src(noteId);
            if (item?.id === noteId) return item;
        } catch {
            /* skip broken registry */
        }
    }
    return null;
}

/** Reset registries — for unit tests only. */
export function resetNotePasteContextForTests() {
    liveNoteSources.length = 0;
    modalEditorNoteIdResolver = null;
}
