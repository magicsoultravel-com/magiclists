/** @module {"owns":"note item mutation functions", "related":["noteSurface.js","noteSurfaceEditing.js","noteSurfaceChecklist.js","noteModel.js","sheet.js","undo.js"], "events":["item:mutation_requested"]} */
import { normalizeItemForSave } from './noteModel.js';
import { syncSheetFromDom } from './sheet.js';
import { UndoManager } from './undo.js';
import { syncInlineFieldToItem } from './noteSurfaceEditing.js';

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

function emitItemMutation(item, { preserveView = false, beforeItem = null, skipRerender = false } = {}) {
    const preserveEmptySteps = preserveView && skipRerender;
    const normalized = normalizeItemForSave(item, { preserveEmptySteps });
    Object.assign(item, normalized);
    const normalizedBefore = beforeItem
        ? normalizeItemForSave(beforeItem, { preserveEmptySteps })
        : null;
    window.dispatchEvent(new CustomEvent('item:mutation_requested', {
        detail: { item: normalized, preserveView, beforeItem: normalizedBefore, skipRerender }
    }));
}

function mutateItem(item, mutator, { preserveView = false, skipRerender = false, localOnly = false } = {}) {
    const beforeItem = JSON.parse(JSON.stringify(item));
    mutator(item);
    if (!localOnly) {
        emitItemMutation(item, { preserveView, beforeItem, skipRerender });
    }
}

function syncItemBodyFromDom(root, item) {
    root?.querySelectorAll('.card-inline-edit').forEach((el) => {
        const field = el.dataset.field;
        if (field === 'title' || field === 'content' || field === 'step-text') {
            syncInlineFieldToItem(el, item);
        }
    });
    syncSheetFromDom(root, item);
}

function attachNoteBodyInteractions(root, item, {
    refresh = () => {},
    localOnly = false,
    onChange = () => {},
    stopMousedownPropagation = false,
    richEdit = false,
    onRaiseCard = null
} = {}) {
    const header = root.querySelector('.editor-note-header');
    const body = root.querySelector('.editor-note-body');
    
    if (header) {
        header.querySelectorAll('.card-inline-edit').forEach((el) => {
            el.addEventListener('input', () => updateNoteMetaStats(root, item));
        });
    }
    
    if (body) {
        body.querySelectorAll('.card-inline-edit').forEach((el) => {
            el.addEventListener('input', () => updateNoteMetaStats(root, item));
        });
        body.querySelectorAll('[data-sheet-cell]').forEach((el) => {
            el.addEventListener('input', () => updateNoteMetaStats(root, item));
        });
    }

    if (localOnly && onChange) {
        root.querySelectorAll('.card-inline-edit').forEach((el) => {
            el.addEventListener('input', onChange);
        });
    }

    if (stopMousedownPropagation && !root.dataset.shellBubbleBound) {
        root.dataset.shellBubbleBound = '1';
        root.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.card-act--drag')) return;
            if (!e.target.closest(
                '.card-inline-edit, .step-check, .step-text, input, textarea, button, a, '
                + '.card-act, .grab-handle--step, .expanded-checklist-add-btn, '
                + '.checklist-done-toggle, .step-collapse-btn, .step-delete-btn, '
                + '.step-indent-btn, .step-outdent-btn, .checklist-expand-collapse-all-btn, '
                + '.sheet-cell-input, .sheet-struct-actions, .sheet-struct-actions .card-act, '
                + '.note-section-header, .note-section-header .collapsable-toggle'
            )) return;
            e.stopPropagation();
        });
    }
}

function updateNoteMetaStats(shell, item) {
    // This function will be imported from noteSurfaceHtml.js
    // For now, we'll just update the stats
    const statsEl = shell?.querySelector('.editor-meta-stats');
    if (statsEl && item) {
        // Update stats display
    }
}

export {
    emitItemMutation,
    mutateItem,
    syncItemBodyFromDom,
    attachNoteBodyInteractions,
    updateNoteMetaStats
};
