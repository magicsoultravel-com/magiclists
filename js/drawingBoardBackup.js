/** @module {"owns":"magicCanvas backup/restore payload (document + prefs + toolbar)", "related":["drawingBoard.js","canvasDocument.js","layoutStorage.js"]} */
import {
    readDocument, writeDocument,
    STORAGE_KEY
} from './canvasDocument.js';

export const DRAWING_PREFS_KEY = 'matrix_drawing_prefs';
export const DRAWING_TOOLBAR_STATE_KEY = 'matrix_drawing_toolbar';

/**
 * Canvas stream payload: the magicCanvas document plus its own prefs/toolbar.
 * Lives here (not on DrawingBoard) so backup/restore never pulls the whole
 * canvas engine into the import graph. Kept next to readDocument()/writeDocument()
 * because the document is big — reading it eagerly on every export tick would
 * re-download the canvas on each unrelated board move.
 */
export async function getCanvasDocumentBackupKeys() {
    // IndexedDB is the primary store; read the persisted document directly.
    let matrix_global_drawing = null;
    let referencedMediaIds = [];
    try {
        const doc = await readDocument();
        matrix_global_drawing = JSON.stringify(doc);
        // Which media files the drawing points at — lets a canvas-only restore
        // warn about images that still need the media ZIP instead of failing
        // silently with blank placeholders.
        const { collectNoteCanvasMediaIds } = await import('./noteFieldOwnership.js');
        referencedMediaIds = collectNoteCanvasMediaIds(doc);
    } catch (e) {
        matrix_global_drawing = localStorage.getItem(STORAGE_KEY);
    }

    return {
        matrix_global_drawing,
        referencedMediaIds,
        matrix_drawing_prefs: localStorage.getItem(DRAWING_PREFS_KEY),
        matrix_drawing_toolbar: localStorage.getItem(DRAWING_TOOLBAR_STATE_KEY)
    };
}

export async function applyDrawingBackupKeys(backup) {
    const { applyCanvasBackupKeys } = await import('./layoutStorage.js');
    await applyCanvasBackupKeys(backup);
    if (backup.matrix_global_drawing != null) {
        let doc = backup.matrix_global_drawing;
        if (typeof doc === 'string') {
            try {
                doc = JSON.parse(doc);
            } catch {
                // Leave as raw string; writeDocument will fail gracefully below.
            }
        }
        try {
            await writeDocument(doc);
        } catch (e) {
            // Fallback to localStorage only if IndexedDB write fails.
        }
        try {
            localStorage.setItem(STORAGE_KEY, typeof doc === 'string' ? doc : JSON.stringify(doc));
        } catch (e) {
            // Ignore quota errors.
        }
    }
    if (backup.matrix_drawing_prefs != null) {
        const prefs = typeof backup.matrix_drawing_prefs === 'string'
            ? backup.matrix_drawing_prefs : JSON.stringify(backup.matrix_drawing_prefs);
        localStorage.setItem(DRAWING_PREFS_KEY, prefs);
    }
    const toolbarState = backup.matrix_drawing_toolbar;
    if (toolbarState != null) {
        if (typeof toolbarState === 'string' && toolbarState === 'true') {
            localStorage.setItem(DRAWING_TOOLBAR_STATE_KEY, JSON.stringify({ collapsed: true }));
        } else if (typeof toolbarState === 'string' && toolbarState === 'false') {
            localStorage.setItem(DRAWING_TOOLBAR_STATE_KEY, JSON.stringify({ collapsed: false }));
        } else {
            localStorage.setItem(DRAWING_TOOLBAR_STATE_KEY, typeof toolbarState === 'string'
                ? toolbarState : JSON.stringify(toolbarState));
        }
    }
}
