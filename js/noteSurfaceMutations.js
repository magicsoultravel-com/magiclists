/** @module {"owns":"note item mutation functions", "related":["noteSurface.js","noteSurfaceEditing.js","noteSurfaceChecklist.js","noteModel.js","sheet.js","undo.js"], "events":["item:mutation_requested"]} */
import { normalizeItemForSave } from './noteModel.js';
import { syncSheetFromDom } from './sheet.js';
import { UndoManager } from './undo.js';
import { sanitizeRichHtml, linkifyPlainUrls } from './richText.js';
import { insertTextAtCaret, handleInlineEditArrowNav } from './noteSurfaceEditing.js';

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

// Desktop autosave debounce timer (shared across all inline editors)
let desktopAutoSaveTimer = null;

function syncInlineFieldToItem(el, item) {
    const field = el.dataset.field;
    if (el.classList.contains('rich-text--edit')) {
        const val = sanitizeRichHtml(linkifyPlainUrls(el.innerHTML));
        if (field === 'title') item.title = val;
        else if (field === 'content') item.content = val;
        else if (field === 'step-text') {
            const step = item.steps?.find(s => s.id === el.dataset.stepId);
            if (step) step.text = val;
        }
        return;
    }
    if (field === 'title') {
        item.title = el.textContent.trim();
    } else if (field === 'content') {
        item.content = el.textContent;
    } else if (field === 'step-text') {
        const step = item.steps?.find(s => s.id === el.dataset.stepId);
        if (step) step.text = el.textContent;
    }
}

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

function commitInlineTextOp(item, beforeItem, { localOnly = false, mergeKey = null, mergeWindow = true } = {}) {
    if (localOnly || !beforeItem) return;
    const preserveEmptySteps = true;
    const afterNorm = normalizeItemForSave(item, { preserveEmptySteps });
    const beforeNorm = normalizeItemForSave(beforeItem, { preserveEmptySteps });
    if (JSON.stringify(beforeNorm) === JSON.stringify(afterNorm)) return;
    Object.assign(item, afterNorm);
    window.dispatchEvent(new CustomEvent('item:mutation_requested', {
        detail: {
            item: afterNorm,
            preserveView: true,
            beforeItem: beforeNorm,
            skipRerender: true,
            mergeKey: mergeKey || `${afterNorm.id}:text`,
            mergeWindow
        }
    }));
}

function commitInlineChecklistOp(item, beforeItem, { localOnly = false } = {}) {
    if (localOnly || !beforeItem) return;
    const preserveEmptySteps = true;
    const afterNorm = normalizeItemForSave(item, { preserveEmptySteps });
    const beforeNorm = normalizeItemForSave(beforeItem, { preserveEmptySteps });
    if (JSON.stringify(beforeNorm) === JSON.stringify(afterNorm)) return;
    Object.assign(item, afterNorm);
    window.dispatchEvent(new CustomEvent('item:mutation_requested', {
        detail: {
            item: afterNorm,
            preserveView: true,
            beforeItem: beforeNorm,
            mergeKey: `${afterNorm.id}:struct`,
            mergeWindow: false
        }
    }));
}

function createBlankChecklistStep() {
    return {
        id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: '',
        completed: false,
        level: 0,
        startDateTime: '',
        endDateTime: ''
    };
}

function buildSheetInteractionOptions(shell, item, { localOnly = false, onChange = () => {}, refresh = () => {} } = {}) {
    return {
        localOnly,
        onChange,
        refresh,
        inModalEditor: !!shell?.closest('#editor-overlay'),
        prepareSnapshot: () => {
            const root = shell?.querySelector?.('.editor-note-body') || shell;
            const beforeItem = JSON.parse(JSON.stringify(item));
            return beforeItem;
        },
        commitCellEdit: (beforeItem) => {
            commitInlineTextOp(item, beforeItem, {
                localOnly,
                mergeKey: `${item.id}:sheet`,
                mergeWindow: true
            });
        },
        commitStructure: (beforeItem) => {
            commitInlineChecklistOp(item, beforeItem, { localOnly });
        },
        onUndo: () => UndoManager.undo(),
        onRedo: () => UndoManager.redo()
    };
}

/**
 * Schedule a debounced autosave for desktop inline editing.
 * Uses a 100ms debounce to provide responsive saving while avoiding excessive writes.
 * Immediately syncs the active field to the item to ensure data is never lost.
 * @param {HTMLElement} root - The editor shell/root element
 * @param {object} item - The note item being edited
 * @param {HTMLElement} [activeEl] - The currently focused editable element (optional)
 */
function scheduleDesktopAutoSave(root, item, activeEl) {
    // Immediately sync the active field to ensure data is never lost
    // This runs synchronously and does NOT trigger a re-render
    if (activeEl && activeEl.classList.contains('card-inline-edit')) {
        syncInlineFieldToItem(activeEl, item);
    }
    
    if (desktopAutoSaveTimer) clearTimeout(desktopAutoSaveTimer);
    desktopAutoSaveTimer = setTimeout(() => {
        desktopAutoSaveTimer = null;
        // Take snapshot BEFORE syncing DOM to item
        const beforeItem = JSON.parse(JSON.stringify(item));
        // Sync any remaining DOM changes to item
        syncItemBodyFromDom(root, item);
        // Emit mutation with correct beforeItem
        emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
    }, 100);
}

/**
 * Flush any pending desktop autosave immediately.
 * Always syncs DOM and emits mutation, regardless of pending timer.
 * @param {HTMLElement} root - The editor shell/root element
 * @param {object} item - The note item being edited
 */
function flushDesktopAutoSave(root, item) {
    // Clear any pending timer
    if (desktopAutoSaveTimer) {
        clearTimeout(desktopAutoSaveTimer);
        desktopAutoSaveTimer = null;
    }
    // Take snapshot BEFORE syncing DOM to item
    const beforeItem = JSON.parse(JSON.stringify(item));
    // Sync DOM changes to item
    syncItemBodyFromDom(root, item);
    // Emit mutation with correct beforeItem
    emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
}

/**
 * Clear any pending desktop autosave timer without saving.
 * Use this when a card is unmounted, closed, or deleted to prevent
 * stale saves from firing after the card is gone.
 */
function clearDesktopAutoSaveTimer() {
    if (desktopAutoSaveTimer) {
        clearTimeout(desktopAutoSaveTimer);
        desktopAutoSaveTimer = null;
    }
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

    // Always add onChange for inline edits to trigger auto-save
    // For modal editor (localOnly=true), onChange syncs DOM and triggers auto-save
    // For board surface (localOnly=false), we use debounced autosave
    const handleInlineEditInput = (el) => {
        if (localOnly) {
            onChange();
        } else {
            // For board surface: immediately sync the active field to ensure data is never lost,
            // then use debounced autosave to persist to storage
            scheduleDesktopAutoSave(root, item, el);
        }
    };
    
    root.querySelectorAll('.card-inline-edit').forEach((el) => {
        el.addEventListener('input', () => handleInlineEditInput(el));
        // Also flush on blur to save when user navigates away
        el.addEventListener('blur', () => {
            if (!localOnly) {
                flushDesktopAutoSave(root, item);
            }
        });
        
        // Handle Enter and Arrow keys in inline edit fields
        el.addEventListener('keydown', (e) => {
            // Handle Enter key in content fields to insert <br> instead of browser default block containers
            if (e.key === 'Enter' && !e.shiftKey && el.dataset.field === 'content') {
                e.preventDefault();
                e.stopPropagation();
                
                // Try execCommand first for native <br> insertion
                const success = document.execCommand('insertLineBreak');
                
                // Fall back to range-based insertion if execCommand fails
                if (!success) {
                    insertTextAtCaret(el, '\n');
                }
                
                // Immediately persist the change
                if (localOnly) {
                    onChange();
                } else {
                    scheduleDesktopAutoSave(root, item, el);
                }
                return;
            }
            
            // Handle Arrow key navigation between fields
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                if (handleInlineEditArrowNav(e, root, el)) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }
        });
    });

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
    const statsEl = shell?.querySelector('.editor-meta-stats');
    if (statsEl && item) {
        // Update stats display
    }
}

export {
    emitItemMutation,
    mutateItem,
    syncInlineFieldToItem,
    syncItemBodyFromDom,
    commitInlineTextOp,
    commitInlineChecklistOp,
    createBlankChecklistStep,
    buildSheetInteractionOptions,
    attachNoteBodyInteractions,
    updateNoteMetaStats,
    flushDesktopAutoSave,
    clearDesktopAutoSaveTimer
};