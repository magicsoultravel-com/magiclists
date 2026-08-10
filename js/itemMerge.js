/** @module {"owns":"shared merge helper for undo/redo restore (preserves note metadata)", "related":["undo.js","app.js"]} */

/**
 * Merge a (possibly partial) restored item — e.g. an undo/redo content snapshot
 * that only carries content fields + id — back onto an existing full item so
 * theme/color/category/layout metadata is preserved. Undo/redo change entries
 * deliberately store only content-related fields; applying them must not wipe
 * the visual/metadata fields of the live note (otherwise an undo would render
 * the note with its default/black appearance).
 *
 * @param {object} fullItem    The item currently held in app state (with metadata)
 * @param {object} partialItem The restored snapshot being applied
 * @returns {object} fullItem with partialItem's fields merged on top
 */
export function mergeItemOntoExisting(fullItem, partialItem) {
    if (!partialItem || typeof partialItem !== 'object') return fullItem;
    if (!fullItem || typeof fullItem !== 'object') return JSON.parse(JSON.stringify(partialItem));
    return { ...fullItem, ...partialItem };
}
