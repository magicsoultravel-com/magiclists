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

/**
 * Sync a single inline-editable field's DOM value back to the item object.
 * Handles both rich-text and plain-text content fields.
 * @param {HTMLElement} el - The inline-editable element
 * @param {object} item - The note item to update
 * @param {string} el.dataset.field - The field name ('title', 'content', or 'step-text')
 * @param {string} [el.dataset.stepId] - The step ID when field is 'step-text'
 */
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

/**
 * Emit an item:mutation_requested event with the normalized item and optional beforeItem snapshot.
 * @param {object} item - The note item (will be normalized in-place via Object.assign)
 * @param {object} [opts] - Options
 * @param {boolean} [opts.preserveView=false] - If true, preserves the current view state
 * @param {object|null} [opts.beforeItem=null] - Pre-mutation snapshot for undo/redo
 * @param {boolean} [opts.skipRerender=false] - If true, skips re-rendering the note surface
 * @param {string|null} [opts.mergeKey=null] - Key for merging consecutive mutations
 * @param {boolean} [opts.mergeWindow=true] - Whether to allow merging with adjacent changes
 */
function emitItemMutation(item, { preserveView = false, beforeItem = null, skipRerender = false, mergeKey = null, mergeWindow = true, preserveEmptySteps = null } = {}) {
    const preserveEmpty = preserveEmptySteps !== null
        ? preserveEmptySteps
        : (preserveView && skipRerender);
    const normalized = normalizeItemForSave(item, { preserveEmptySteps: preserveEmpty });
    Object.assign(item, normalized);
    const normalizedBefore = beforeItem
        ? normalizeItemForSave(beforeItem, { preserveEmptySteps: preserveEmpty })
        : null;
    window.dispatchEvent(new CustomEvent('item:mutation_requested', {
        detail: { item: normalized, preserveView, beforeItem: normalizedBefore, skipRerender, mergeKey, mergeWindow }
    }));
}

/**
 * Apply a mutation to an item, capturing a beforeItem snapshot for undo/redo.
 * @param {object} item - The note item to mutate
 * @param {function(object): void} mutator - Function that mutates the item in-place
 * @param {object} [opts] - Options
 * @param {boolean} [opts.preserveView=false] - If true, preserves the current view state
 * @param {boolean} [opts.skipRerender=false] - If true, skips re-rendering the note surface
 * @param {boolean} [opts.localOnly=false] - If true, only mutates locally without emitting event
 */
function mutateItem(item, mutator, { preserveView = false, skipRerender = false, localOnly = false } = {}) {
    const beforeItem = JSON.parse(JSON.stringify(item));
    mutator(item);
    if (!localOnly) {
        emitItemMutation(item, { preserveView, beforeItem, skipRerender });
    }
}

/**
 * Sync all inline-editable fields and sheet cells from the DOM back to the item object.
 * @param {HTMLElement} root - The editor shell/root element
 * @param {object} item - The note item to update
 */
function syncItemBodyFromDom(root, item) {
    root?.querySelectorAll('.card-inline-edit').forEach((el) => {
        const field = el.dataset.field;
        if (field === 'title' || field === 'content' || field === 'step-text') {
            syncInlineFieldToItem(el, item);
        }
    });
    syncSheetFromDom(root, item);
}

/**
 * Commit an inline text operation (title, content, or step text) to the item and emit a mutation event.
 * @param {object} item - The note item
 * @param {object} beforeItem - Pre-mutation snapshot for undo/redo
 * @param {object} [opts] - Options
 * @param {boolean} [opts.localOnly=false] - If true, only mutates locally without emitting event
 * @param {string|null} [opts.mergeKey=null] - Key for merging consecutive mutations
 * @param {boolean} [opts.mergeWindow=true] - Whether to allow merging with adjacent changes
 */
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

/**
 * Commit an inline checklist operation (step add/remove/reorder/indent/outdent) to the item and emit a mutation event.
 * @param {object} item - The note item
 * @param {object} beforeItem - Pre-mutation snapshot for undo/redo
 * @param {object} [opts] - Options
 * @param {boolean} [opts.localOnly=false] - If true, only mutates locally without emitting event
 */
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

/**
 * Create a blank checklist step object with default values.
 * @returns {object} A new step object with id, text, completed, level, startDateTime, endDateTime
 */
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

/**
 * Build interaction options for sheet-grid note templates.
 * @param {HTMLElement} shell - The editor shell element
 * @param {object} item - The note item
 * @param {object} [opts] - Options
 * @param {boolean} [opts.localOnly=false] - If true, only mutates locally without emitting event
 * @param {function} [opts.onChange=()=>{}] - Callback for change events
 * @param {function} [opts.refresh=()=>{}] - Callback for refresh events
 * @returns {object} Interaction options object with prepareSnapshot, commitCellEdit, commitStructure, onUndo, onRedo
 */
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
 * Uses a 1000ms debounce to provide responsive saving while avoiding excessive writes.
 * Immediately syncs the active field to the item to ensure data is never lost.
 * @param {HTMLElement} root - The editor shell/root element
 * @param {object} item - The note item being edited
 * @param {HTMLElement} [activeEl] - The currently focused editable element (optional)
 */
function scheduleDesktopAutoSave(root, item, activeEl) {
    // Take snapshot BEFORE any DOM-to-item sync so beforeItem captures pre-mutation state
    const beforeItem = JSON.parse(JSON.stringify(item));
    
    // Immediately sync the active field to ensure data is never lost
    // This runs synchronously and does NOT trigger a re-render
    if (activeEl && activeEl.classList.contains('card-inline-edit')) {
        syncInlineFieldToItem(activeEl, item);
    }
    
    if (desktopAutoSaveTimer) clearTimeout(desktopAutoSaveTimer);
    desktopAutoSaveTimer = setTimeout(() => {
        desktopAutoSaveTimer = null;
        // Sync any remaining DOM changes to item
        syncItemBodyFromDom(root, item);
        // Emit mutation with correct beforeItem
        emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true });
    }, 1000);
}

/**
 * Flush any pending desktop autosave immediately.
 * Always syncs DOM and emits mutation, regardless of pending timer.
 * For format commands, mergeWindow is set to false to prevent merging with typing actions.
 * @param {HTMLElement} root - The editor shell/root element
 * @param {object} item - The note item being edited
 * @param {object} [opts] - Options
 * @param {boolean} [opts.mergeWindow=true] - Whether to allow merging with adjacent changes
 */
function flushDesktopAutoSave(root, item, opts = {}) {
    const { mergeWindow = true } = opts;
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
    // Use unique mergeKey for format commands to prevent merging with typing
    const mergeKey = mergeWindow ? null : `${item.id}:format:${Date.now()}`;
    emitItemMutation(item, { preserveView: true, beforeItem, skipRerender: true, mergeKey, mergeWindow });
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

/**
 * Attach DOM event listeners for inline editing interactions on a note surface.
 * Handles input events, blur saves, keydown navigation, mousedown propagation, and link clicks.
 * Uses dataset flags (shellBubbleBound, linkClickBound) to prevent duplicate listener attachment on re-renders.
 * @param {HTMLElement} root - The editor shell/root element
 * @param {object} item - The note item being edited
 * @param {object} [opts] - Options
 * @param {function} [opts.refresh] - Callback for refresh events
 * @param {boolean} [opts.localOnly=false] - If true, uses onChange instead of debounced autosave
 * @param {function} [opts.onChange] - Callback for change events (used when localOnly=true)
 * @param {boolean} [opts.stopMousedownPropagation=false] - If true, stops mousedown propagation on interactive elements
 * @param {boolean} [opts.richEdit=false] - Whether rich text editing is enabled
 * @param {function|null} [opts.onRaiseCard=null] - Callback to raise the card to front
 */
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

    // Handle link clicks in non-edit mode - allow browser to open target="_blank" links
    if (body && !root.dataset.linkClickBound) {
        root.dataset.linkClickBound = '1';
        body.addEventListener('click', (e) => {
            const anchor = e.target.closest('a[href]');
            if (!anchor || !root.contains(anchor)) return;
            // In edit mode, let tryOpenRichEditLink handle it
            if (anchor.closest('.rich-text--edit')) return;
            // In non-edit mode, stop propagation to prevent card actions
            // but allow the browser's native target="_blank" to work
            e.stopPropagation();
        });
    }
}

/**
 * Update the editor meta stats display (e.g., word count, step count).
 * @param {HTMLElement} shell - The editor shell element
 * @param {object} item - The note item
 */
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