/** @module {"owns":"checklist step operations - insert, remove, and the Backspace/Delete/Enter key handling that edits the tree in place with surgical DOM updates", "related":["noteSurfaceChecklist.js","noteSurfaceChecklist/rows.js","noteSurfaceChecklist/collapse.js","checklistSteps.js"]} */
import { partitionChecklistSteps, stepHasDescendants, buildVisibleChecklistSteps, annotateChecklistTreeGuides, addChecklistStep, insertChecklistStepBefore, splitChecklistStep, deleteChecklistStep, mergeChecklistStepIntoPrev } from '../checklistSteps.js';
import { sanitizeRichHtml, linkifyPlainUrls } from '../richText.js';
import { mutateItem, syncInlineFieldToItem, commitInlineChecklistOp, flushDesktopAutoSave } from '../noteSurfaceMutations.js';
import { focusInlineEdit, splitInlineEditAtCaret, insertTextAtCaret, isAtAbsoluteStart } from '../noteSurfaceEditing.js';
import { buildChecklistRowHtml } from './rows.js';
import { getChecklistCollapsedKeys, isChecklistGroupCollapsed } from './collapse.js';

/**
 * Capture the canvas scroll position for preservation during DOM operations.
 * @returns {{scrollTop: number, scrollLeft: number}} The scroll position
 */
export function captureCanvasScroll() {
    const canvas = document.getElementById('app-canvas');
    return {
        scrollTop: canvas?.scrollTop ?? 0,
        scrollLeft: canvas?.scrollLeft ?? 0
    };
}

/**
 * Restore the canvas scroll position after DOM operations.
 * @param {{scrollTop: number, scrollLeft: number}} scrollPos - The scroll position to restore
 */
export function restoreCanvasScroll(scrollPos) {
    const canvas = document.getElementById('app-canvas');
    if (canvas) {
        canvas.scrollTop = scrollPos.scrollTop;
        canvas.scrollLeft = scrollPos.scrollLeft;
    }
}

export function setPendingChecklistFocus(root, stepId, edge = 'start') {
    if (!root || !stepId) return;
    root.dataset.pendingFocusStepId = stepId;
    root.dataset.pendingFocusEdge = edge;
}

// Surgical DOM update: insert a new step row into the DOM
export function insertStepRowInDom(root, newStep, item, { afterStepId = null, beforeStepId = null, richEdit = false } = {}) {
    if (!root || !newStep || !item) return null;
    
    const { active } = partitionChecklistSteps(item.steps || []);
    // Compute tree guides using the same pipeline as buildExpandedChecklistHtml
    // so the surgically-inserted row renders with correct visual indentation.
    const collapsedKeys = getChecklistCollapsedKeys();
    const visibleRows = annotateChecklistTreeGuides(
        buildVisibleChecklistSteps(active, item.id, collapsedKeys)
    );
    const newRowInfo = visibleRows.find((r) => r.step.id === newStep.id) || {
        hasKids: false,
        isCollapsed: false,
        collapseKey: '',
        treeGuides: []
    };
    
    const rowHtml = buildChecklistRowHtml(newStep, {
        hasKids: newRowInfo.hasKids,
        isCollapsed: newRowInfo.isCollapsed,
        collapseKey: newRowInfo.collapseKey,
        isDoneSection: false,
        treeGuides: newRowInfo.treeGuides,
        canEdit: true,
        richEdit,
        active
    });
    
    const temp = document.createElement('div');
    temp.innerHTML = rowHtml.trim();
    const newRow = temp.firstElementChild;
    
    // Find insertion point: before/after specified step or at end
    const beforeRow = beforeStepId ? root.querySelector(`.step-row--display[data-step-id="${beforeStepId}"]`) : null;
    const afterRow = afterStepId ? root.querySelector(`.step-row--display[data-step-id="${afterStepId}"]`) : null;
    const addBtn = root.querySelector('.expanded-checklist-add-btn');
    const doneToggle = root.querySelector('.checklist-done-toggle');
    
    if (beforeRow) {
        beforeRow.insertAdjacentElement('beforebegin', newRow);
    } else if (afterRow) {
        afterRow.insertAdjacentElement('afterend', newRow);
    } else if (addBtn) {
        addBtn.parentNode.insertBefore(newRow, addBtn);
    } else if (doneToggle) {
        doneToggle.insertAdjacentElement('beforebegin', newRow);
    } else {
        root.querySelector('.expanded-checklist')?.appendChild(newRow);
    }
    
    return newRow;
}

// Unified state synchronizer for checklist step text updates
export function syncChecklistStepToItem(el, item) {
    const stepId = el.dataset.stepId;
    const step = item.steps?.find((s) => s.id === stepId);
    if (step) {
        step.text = el.textContent || '';
    }
}

/**
 * Synchronously sync the currently-focused checklist step's text into the item
 * model. This prevents typed text from being lost before a DOM insertion or
 * re-render (e.g. clicking "+", indent/outdent, or rapid-fire clicks). It only
 * touches the focused step, avoiding the risk of clobbering other unsynced state.
 * @param {HTMLElement} root - The editor body / checklist root element
 * @param {object} item - The note item
 */
export function syncFocusedStepTextToItem(root, item) {
    if (!root || !item) return;
    const active = document.activeElement;
    if (!active || !root.contains(active)) return;
    if (!active.classList?.contains('step-text')) return;
    const stepId = active.dataset.stepId;
    if (!stepId) return;
    const step = (item.steps || []).find((s) => s.id === stepId);
    if (!step) return;
    if (active.classList.contains('rich-text--edit')) {
        step.text = sanitizeRichHtml(linkifyPlainUrls(active.innerHTML));
    } else {
        step.text = active.textContent || '';
    }
}

export function insertChecklistStep(root, item, {
    afterStepId = null,
    text = '',
    completed = false,
    localOnly = false,
    onChange = () => {}
} = {}) {
    if (!item) return null;
    // Flush the focused step's text into the model before any DOM mutation so
    // typed text is never lost (guards against rapid-fire + clicks too).
    syncFocusedStepTextToItem(root, item);
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const { steps, step: newStep } = addChecklistStep(item.steps || [], {
        afterStepId,
        text,
        completed,
        newId: createStepId()
    });
    item.steps = steps;
    
    // Capture canvas scroll position before DOM insertion to prevent view jump
    const scrollPos = captureCanvasScroll();
    
    // Surgical DOM insertion - insert the new row without full refresh
    const richEdit = root.querySelector('.step-text')?.classList?.contains('rich-text--edit') || false;
    const newRow = insertStepRowInDom(root, newStep, item, { afterStepId, richEdit });
    
    // Focus the new step's text element directly
    if (newRow) {
        const stepTextEl = newRow.querySelector('.step-text.card-inline-edit');
        if (stepTextEl) {
            stepTextEl.focus({ preventScroll: true });
            // Set caret at start
            const range = document.createRange();
            range.selectNodeContents(stepTextEl);
            range.collapse(true);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }
    
    // Restore canvas scroll position after DOM insertion
    restoreCanvasScroll(scrollPos);
    
    // Always commit a real, immediate structural mutation — even in the modal
    // (localOnly=true). This atomically persists the full accumulated item.steps
    // with preserveEmptySteps=true, so rapid successive "+" clicks do not lose
    // intermediate empty rows to a deferred DOM re-sync. onChange() is still
    // called for the editor's internal state/size/render updates.
    if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
    onChange();
    return newStep.id;
}

export function removeChecklistStepAndFocus(root, item, stepId, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return null;
    // Flush any pending text autosave BEFORE the structural snapshot so the
    // structural undo entry captures post-typing state and a stale autosave
    // cannot fire afterwards with an outdated beforeItem (which would corrupt
    // the undo stack or lose/restore the line unexpectedly).
    flushDesktopAutoSave(root, item);
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const result = deleteChecklistStep(item.steps, stepId);
    item.steps = result.steps;
    const prevStepId = result.prevStepId;
    const nextStepId = result.nextStepId;

    if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
    onChange();

    return prevStepId || nextStepId || null;
}

export function handleChecklistBackspace(e, item, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return false;
    const active = document.activeElement;
    if (!active?.classList?.contains('step-text')) return false;

    const stepId = active.dataset.stepId;
    const stepIdx = item.steps.findIndex((s) => s.id === stepId);
    if (stepIdx < 0) return false;

    const step = item.steps[stepIdx];
    const text = active.textContent || '';

    if (text.length > 0) {
        active.textContent = text.slice(0, -1);
        syncChecklistStepToItem(active, item);
        if (!localOnly) {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
        onChange();
        return true;
    }

    if (stepIdx === 0) return false;

    const root = active.closest('.step-row--display');
    // Flush pending text autosave before the merge so the structural entry's
    // beforeItem reflects all typed text and a stale autosave can't fire later.
    flushDesktopAutoSave(root, item);
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const result = mergeChecklistStepIntoPrev(item.steps, stepIdx);
    item.steps = result.steps;

    if (root) {
        const prevRow = root.previousElementSibling;
        const prevTextEl = prevRow?.querySelector('.step-text');
        if (prevTextEl) {
            focusInlineEdit(prevTextEl, 'end');
        }
    }

    if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
    onChange();
    return true;
}

export function handleChecklistDelete(e, item, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return false;
    const active = document.activeElement;
    if (!active?.classList?.contains('step-text')) return false;

    const stepId = active.dataset.stepId;
    const stepIdx = item.steps.findIndex((s) => s.id === stepId);
    if (stepIdx < 0) return false;

    const step = item.steps[stepIdx];
    const text = step.text || '';

    if (text.length > 0) {
        active.textContent = text.slice(0, -1);
        syncChecklistStepToItem(active, item);
        if (!localOnly) {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
        onChange();
        return true;
    }

    const root = active.closest('.step-row--display');
    // Flush pending text autosave before the delete so the structural entry's
    // beforeItem reflects all typed text and a stale autosave can't fire later.
    flushDesktopAutoSave(root, item);
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const result = deleteChecklistStep(item.steps, stepId);
    item.steps = result.steps;
    if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
    onChange();
    return true;
}

/**
 * Handle Enter key in checklist step-text.
 * CRITICAL: Does NOT sync before split - instead, directly updates the item steps
 * with the split text chunks, then commits atomically.
 */
export function handleChecklistEnter(root, item, e, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return false;
    const active = e.target;
    if (!active?.classList?.contains('step-text')) return false;

    const stepId = active.dataset.stepId;
    const stepIdx = item.steps.findIndex((s) => s.id === stepId);
    if (stepIdx < 0) return false;

    // Do NOT sync before split - that would save the full unbroken string
    // Instead, let splitInlineEditAtCaret run on the live DOM to calculate chunks

    // Flush any pending text autosave before the split so the structural entry
    // captures all typed text and no stale autosave fires after the split.
    // This runs synchronously before commitInlineChecklistOp, so the deferred
    // DOM re-sync can't clobber the split lines (see the CRITICAL below).
    flushDesktopAutoSave(root, item);

    if (e.shiftKey) {
        const rich = active.classList.contains('rich-text--edit');
        if (rich) {
            document.execCommand('insertLineBreak');
        } else {
            insertTextAtCaret(active, '\n');
        }
        syncInlineFieldToItem(active, item);
        if (!localOnly) {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
        onChange();
        return 'stay';
    }

    // Enter at absolute start: insert empty sibling above; keep this item/group intact.
    if (isAtAbsoluteStart(active)) {
        const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
        const result = insertChecklistStepBefore(item.steps, stepId, {
            text: '',
            newId: createStepId()
        });
        item.steps = result.steps;
        const newStep = result.step;
        if (!newStep) return false;

        const scrollPos = captureCanvasScroll();
        const richEdit = active.classList.contains('rich-text--edit');
        const newRow = insertStepRowInDom(root, newStep, item, { beforeStepId: stepId, richEdit });
        if (newRow) {
            const stepTextEl = newRow.querySelector('.step-text.card-inline-edit');
            if (stepTextEl) {
                stepTextEl.focus({ preventScroll: true });
                const range = document.createRange();
                range.selectNodeContents(stepTextEl);
                range.collapse(true);
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            }
        }
        restoreCanvasScroll(scrollPos);
        if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
        onChange();
        return newStep.id;
    }

    const { before, after } = splitInlineEditAtCaret(active);

    // Enter: split text at caret position and create a new step with the "after" text.
    // When the group is collapsed the new row lands after the whole subtree so it
    // is not hidden inside the collapsed group.
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const afterSubtree = stepHasDescendants(item.steps, stepIdx) && isChecklistGroupCollapsed(item.id, stepId);

    // CRITICAL: Directly update the item's step text with the "before" portion
    // This avoids the race condition where the pre-split full text overwrites the split lines
    // For rich text, before is already sanitized HTML; for plain text, it's plain text
    const rich = active.classList.contains('rich-text--edit');
    if (rich) {
        active.innerHTML = before;
    } else {
        active.textContent = before;
    }

    // Model-first split: the original step keeps "before", a new sibling gets
    // "after"; explicit parentId/order metadata is refreshed atomically by the op.
    const result = splitChecklistStep(item.steps, stepId, before, after, {
        afterSubtree,
        newId: createStepId()
    });
    item.steps = result.steps;
    const newStep = result.newStep;

    // Capture canvas scroll position before DOM insertion to prevent view jump
    const scrollPos = captureCanvasScroll();

    // Surgical DOM insertion - insert the new row without full refresh
    const richEdit = active.classList.contains('rich-text--edit');
    const newRow = insertStepRowInDom(root, newStep, item, { afterStepId: stepId, richEdit });
    
    // Focus the new step's text element directly
    if (newRow) {
        const stepTextEl = newRow.querySelector('.step-text.card-inline-edit');
        if (stepTextEl) {
            stepTextEl.focus({ preventScroll: true });
            // Set caret at start
            const range = document.createRange();
            range.selectNodeContents(stepTextEl);
            range.collapse(true);
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }

    // Restore canvas scroll position after DOM insertion
    restoreCanvasScroll(scrollPos);

    // CRITICAL: Commit as atomic batch operation - both the modified step and the new step
    // are saved together in a single mutation to prevent race conditions.
    // Always persist immediately — even in the modal (localOnly=true) — so rapid
    // Enter+typing sequences atomically accumulate every line in item.steps and
    // cannot be clobbered by a deferred DOM re-sync. onChange() is still called
    // for the editor's internal state/size/render updates.
    if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
    onChange();
    return newStep.id;
}

export function prepareInlineOpSnapshot(root, item, localOnly) {
    if (!root || !item) return null;
    const snapshot = JSON.parse(JSON.stringify(item));
    snapshot._localOnly = localOnly;
    return snapshot;
}

export function createStepId() {
    return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
