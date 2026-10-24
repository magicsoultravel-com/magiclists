/** @module {"owns":"magicCanvas document persistence and undo application - snapshots, layer history, debounced save","related":["drawingBoard.js","drawingBoard/history.js","canvasDocument.js","drawingBoardClipboard.js","canvasViewport.js"]} */
import { CanvasViewport } from '../canvasViewport.js';
import {
    writeDocument,
    getActiveStrokes,
    getActiveTexts,
    setActiveStrokes,
    setActiveTexts,
    getActiveImages,
    setActiveImages,
    getActiveBackground,
    setActiveBackground,
    getActiveBackgroundColor,
    setActiveBackgroundColor
} from '../canvasDocument.js';
import { SAVE_DEBOUNCE_MS } from '../drawingBoardCore.js';
import * as ClipboardSession from '../drawingBoardClipboard.js';

export function getSnapshot(board) {
    return JSON.parse(JSON.stringify(board.doc));
}

export function getLayerUndoSlice(board) {
    return {
        kind: 'layer',
        canvasMode: board.doc.canvasMode,
        activePageId: board.doc.activePageId,
        background: getActiveBackground(board.doc),
        backgroundColor: getActiveBackgroundColor(board.doc),
        strokes: JSON.parse(JSON.stringify(getActiveStrokes(board.doc))),
        texts: JSON.parse(JSON.stringify(getActiveTexts(board.doc))),
        images: JSON.parse(JSON.stringify(getActiveImages(board.doc)))
    };
}

export function pushLayerHistory(board) {
    board.history.push(board.getLayerUndoSlice());
}

export function applySnapshot(board, snapshot) {
    if (snapshot?.kind === 'layer') {
        // A layer snapshot belongs to the page it was taken on. Restore that
        // page first: undoing from page 2 must not paste page 1's strokes
        // into page 2 (the pages would silently swap content).
        const switchedPage = board.restoreSnapshotPage(snapshot.activePageId);
        setActiveStrokes(board.doc, JSON.parse(JSON.stringify(snapshot.strokes || [])));
        setActiveTexts(board.doc, JSON.parse(JSON.stringify(snapshot.texts || [])));
        setActiveImages(board.doc, JSON.parse(JSON.stringify(snapshot.images || [])));
        const hasBackground = snapshot.background !== undefined || snapshot.backgroundColor !== undefined;
        if (snapshot.background !== undefined) setActiveBackground(board.doc, snapshot.background);
        if (snapshot.backgroundColor !== undefined) setActiveBackgroundColor(board.doc, snapshot.backgroundColor);
        if (hasBackground) board.redrawBackground();
        if (switchedPage) board.resize();
    } else {
        board.doc = JSON.parse(JSON.stringify(snapshot));
        board.resize();
        if (board.doc.viewport) CanvasViewport.loadFromDoc(board.doc.viewport);
    }
    // Layers are fresh deep clones — re-point selection by id or drop orphans.
    ClipboardSession.pruneSelection(board);
    board.redraw();
    board.scheduleSave();
    board.updateToolbarState();
}

export function restoreSnapshotPage(board, pageId) {
    if (!pageId || !Array.isArray(board.doc?.pages)) return false;
    if (pageId === board.doc.activePageId) return false;
    if (!board.doc.pages.some((page) => page.id === pageId)) return false;
    board.doc.activePageId = pageId;
    return true;
}

export function undo(board) {
    board.clearCropSession();
    const prev = board.history.undo(board.getSnapshot());
    if (prev) { board.applySnapshot(prev); board.renderToolbar(); }
}

export function redo(board) {
    board.clearCropSession();
    const next = board.history.redo(board.getSnapshot());
    if (next) { board.applySnapshot(next); board.renderToolbar(); }
}

export function clearAll(board) {
    if (!board.strokes().length && !getActiveTexts(board.doc).length && !board.images().length) return;
    if (!confirm('Clear the current canvas page?')) return;
    board.pushLayerHistory();
    board.setStrokes([]);
    board.setImages([]);
    setActiveTexts(board.doc, []);
    board.selectedStrokes.clear();
    board.shrinkInfiniteIfNeeded();
    board.redraw();
    board.scheduleSave();
}

export function scheduleSave(board) {
    if (!board.active || !board.doc || !board.docOwner) return;
    clearTimeout(board.saveTimer);
    board.saveTimer = setTimeout(() => board.flushSave(), SAVE_DEBOUNCE_MS);
}

export async function flushSave(board) {
    clearTimeout(board.saveTimer);
    board.saveTimer = null;
    if (!board.doc || !board.docOwner) return;
    board.doc.viewport = CanvasViewport.toDoc();
    if (board.docOwner === 'note') {
        const item = board.noteCanvasItem;
        if (!item) return;
        const doc = JSON.parse(JSON.stringify(board.doc));
        const { mutateItem } = await import('./noteSurfaceMutations.js');
        mutateItem(item, (it) => {
            it.canvas = doc;
            // Drawing implies the note canvas should be visible on board/modal.
            it.canvasHidden = false;
        }, { preserveView: true, skipRerender: true });
        import('./noteAttachmentsUi.js').then(({ syncNoteCanvasDom }) => {
            syncNoteCanvasDom(item);
        }).catch(() => {});
        return;
    }
    if (board.docOwner === 'flowchart') {
        const item = board.flowchartItem;
        if (!item) return;
        const doc = JSON.parse(JSON.stringify(board.doc));
        const { mutateItem } = await import('./noteSurfaceMutations.js');
        mutateItem(item, (it) => {
            if (!it.flowchart) return;
            it.flowchart.doc = doc;
            // Drawing implies the flowchart should be visible on board/modal.
            it.flowchartHidden = false;
        }, { preserveView: true, skipRerender: true });
        import('./flowchartUi.js').then(({ syncNoteFlowchartDom }) => {
            syncNoteFlowchartDom(item);
        }).catch(() => {});
        return;
    }
    if (board.docOwner === 'workspace') {
        await writeDocument(board.doc);
    }
}
