/** @module {"owns":"checklist operations, drag/drop, state management", "related":["noteSurface.js","checklistSteps.js","noteBodyConversion.js","richText.js"], "events":[]} */
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants, canIndentStep, computeVisibleInsertBounds, resolvePointerDropTarget, buildVisibleChecklistSteps, annotateChecklistTreeGuides, addChecklistStep, insertChecklistStepBefore, splitChecklistStep, deleteChecklistStep, mergeChecklistStepIntoPrev, indentChecklistSteps, outdentChecklistSteps, moveChecklistStepBlock, toggleStepCompletion, toggleGroupCompletion, getGroupStepIds, buildCompletedChecklistRows } from './checklistSteps.js';
import { stripRichText, sanitizeRichHtml, hasRichMarkup, linkifyPlainUrls } from './richText.js';
import { mutateItem, syncItemBodyFromDom, syncInlineFieldToItem, commitInlineChecklistOp, flushDesktopAutoSave } from './noteSurfaceMutations.js';
import { focusInlineEdit, canInlineEditText, splitInlineEditAtCaret, insertTextAtCaret, handleInlineEditArrowNav, isAtAbsoluteStart } from './noteSurfaceEditing.js';
import { copyPlainTextToClipboard } from './clipboard.js';

import {
    buildChecklistRowHtml
} from './noteSurfaceChecklist/rows.js';

import {
    getChecklistCollapsedKeys,
    getChecklistDoneCollapsed,
    toggleChecklistDoneSection,
    toggleChecklistExpandCollapseAll,
    isChecklistGroupCollapsed,
    expandChecklistAncestorsForStep,
    getCachedChecklistCollapsedKeys,
    getCachedChecklistDoneCollapsed,
    invalidateChecklistCache
} from './noteSurfaceChecklist/collapse.js';
export {
    getChecklistCollapsedKeys,
    getChecklistDoneCollapsed,
    toggleChecklistDoneSection,
    toggleChecklistExpandCollapseAll,
    expandChecklistAncestorsForStep
};
export {
    isChecklistDoneSectionCollapsed,
    getChecklistCollapsibleKeys,
    checklistGroupsAnyExpanded,
    collapseAllChecklistGroups,
    expandAllChecklistGroups,
    buildChecklistExpandCollapseAllHtml
} from './noteSurfaceChecklist/collapse.js';

import {
    getActiveRows,
    findStepInsertionPosition
} from './noteSurfaceChecklist/targeting.js';

import {
    setPendingChecklistFocus,
    syncFocusedStepTextToItem,
    insertChecklistStep,
    removeChecklistStepAndFocus,
    handleChecklistEnter,
    prepareInlineOpSnapshot
} from './noteSurfaceChecklist/ops.js';
export {
    insertChecklistStep,
    removeChecklistStepAndFocus,
    handleChecklistEnter,
    prepareInlineOpSnapshot
};
export {
    handleChecklistBackspace,
    handleChecklistDelete,
    createStepId
} from './noteSurfaceChecklist/ops.js';
export {
    getActiveRows
};
export {
    buildChecklistRowHtml
};

const DRAG_THRESHOLD = 4;

/**
 * Check if a target element is a checklist interaction element.
 * Used by dragdrop.js to determine if pointer events should yield to checklist interactions.
 * @param {Element} target - The target element to check
 * @returns {boolean} - True if the target is a checklist interaction element
 */
export function isChecklistInteraction(target) {
    if (!target) return false;
    return !!target.closest(
        '.step-check, .step-delete-btn, .step-collapse-btn, .grab-handle--step, ' +
        '.step-nest-controls, .step-row-actions, .expanded-checklist-add-btn, ' +
        '.checklist-expand-collapse-all-btn, .step-text, .checklist-done-toggle'
    );
}

/**
 * Bind all checklist action buttons (copy, delete, indent, outdent,
 * collapse/expand, checkbox toggle, add-step, done-section toggle,
 * expand/collapse-all). Call this after the checklist HTML is rendered.
 */
export function bindChecklistInteractions(root, item, {
    refresh = () => {},
    localOnly = false,
    onChange = () => {}
} = {}) {
    if (!root || !item) return;
    if (root.dataset.checklistInteractionsBound === item.id) return;
    root.dataset.checklistInteractionsBound = item.id;

    // --- step checkbox (toggle completion) ---
    // Update DOM immediately for responsive UX, then refresh to sync state.
    // Local class toggles (done section, completed text) show instant feedback;
    // refresh() ensures the done section moves on the board surface too.
    root.addEventListener('change', (e) => {
        const cb = e.target.closest('.step-check');
        if (!cb || !root.contains(cb)) return;
        const row = cb.closest('.step-row--display');
        if (!row) return;
        const stepId = row.dataset.stepId;
        if (!stepId) return;
        const step = (item.steps || []).find(s => s.id === stepId);
        if (!step) return;
        
        const newCompleted = cb.checked;
        const wasCompleted = step.completed;

        // Snapshot before mutating so undo/persist see the prior state.
        const beforeItem = wasCompleted !== newCompleted
            ? prepareInlineOpSnapshot(root, item, localOnly)
            : null;
        
        // Check if this is a parent step (has descendants)
        const stepIdx = (item.steps || []).findIndex(s => s.id === stepId);
        const hasDescendants = stepHasDescendants(item.steps, stepIdx);
        
        // For non-structural updates (checkbox toggle), update the model in place
        // and keep the DOM as a render of the model. Positions/order are untouched.
        if (wasCompleted !== newCompleted) {
            // Use group completion for parents, single for leaves
            let affectedStepIds;
            if (newCompleted && hasDescendants) {
                // Completing a parent: mark all descendants too
                affectedStepIds = toggleGroupCompletion(item.steps, stepId, newCompleted);
            } else {
                toggleStepCompletion(item.steps, stepId, newCompleted);
                affectedStepIds = [stepId];
            }
            
            // Update row classes for all affected rows
            const doneSection = root.querySelector('.checklist-done-section');
            const addBtn = root.querySelector('.expanded-checklist-add-btn');
            const doneToggle = root.querySelector('.checklist-done-toggle');
            
            // Collect all DOM rows for affected steps (in DOM order, parent first)
            const affectedRows = affectedStepIds
                .map(id => root.querySelector(`.step-row--display[data-step-id="${id}"]`))
                .filter(r => r)
                .sort((a, b) => a.comparePosition ? 0 : a.compareDocumentPosition(b) < 14 ? -1 : 1);
            
            // Update each row's classes
            for (const r of affectedRows) {
                r.classList.toggle('step-row--done', newCompleted);
                const stepTextEl = r.querySelector('.step-text');
                if (stepTextEl) {
                    stepTextEl.classList.toggle('completed', newCompleted);
                }
            }
            
            if (newCompleted && doneSection) {
                // Move all rows together to done section (in reverse order to maintain sequence)
                for (let i = affectedRows.length - 1; i >= 0; i--) {
                    doneSection.appendChild(affectedRows[i]);
                }
            } else if (!newCompleted && doneSection) {
                // When uncompleting, only the parent row is moved back
                // (children stay done -- they can be toggled individually)
                const parentRow = row;
                const insertRef = findStepInsertionPosition(parentRow, item, addBtn);
                if (insertRef) {
                    insertRef.parentNode.insertBefore(parentRow, insertRef.nextSibling);
                } else if (addBtn.parentNode) {
                    addBtn.parentNode.insertBefore(parentRow, addBtn);
                }
            }
            
            // Update done toggle visibility
            if (doneSection) {
                const doneRows = doneSection.querySelectorAll('.step-row--display');
                doneSection.classList.toggle('is-hidden', doneRows.length === 0);
                if (doneToggle) {
                    doneToggle.setAttribute('aria-expanded', doneRows.length > 0 ? 'true' : 'false');
                }
            }
        }
        
        // Always persist immediately — even in the modal (localOnly=true) — so
        // toggles are not lost if close races the debounced autosave.
        if (beforeItem) {
            syncItemBodyFromDom(root, item);
            commitInlineChecklistOp(item, beforeItem, { localOnly: false });
        }
        onChange();
        refresh();
    });

    // --- generic click delegation for all other step buttons ---
    root.addEventListener('click', (e) => {
        // --- step delete ---
        const delBtn = e.target.closest('.step-delete-btn');
        if (delBtn && root.contains(delBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const row = delBtn.closest('.step-row--display');
            const stepId = row?.dataset?.stepId;
            if (!stepId) return;
            const focusStepId = removeChecklistStepAndFocus(root, item, stepId, { localOnly, onChange });
            if (focusStepId) setPendingChecklistFocus(root, focusStepId, 'end');
            // Always refresh (matches indent/outdent) so the row disappears
            // immediately on the board surface too (localOnly=false), not just
            // in the modal editor.
            refresh();
            return;
        }

        // --- step copy ---
        const copyBtn = e.target.closest('.step-copy-btn');
        if (copyBtn && root.contains(copyBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const row = copyBtn.closest('.step-row--display');
            const stepId = row?.dataset?.stepId;
            if (!stepId) return;
            const step = (item.steps || []).find(s => s.id === stepId);
            if (!step) return;
            const text = stripRichText(step.text || '');
            copyPlainTextToClipboard(text);
            // Simple flash feedback without triggering circular import
            const prevTitle = copyBtn.getAttribute('title');
            const prevHtml = copyBtn.innerHTML;
            copyBtn.innerHTML = CARD_ICONS.save;
            copyBtn.setAttribute('title', 'Copied!');
            copyBtn.setAttribute('aria-label', 'Copied!');
            setTimeout(() => {
                copyBtn.innerHTML = prevHtml;
                if (prevTitle != null) copyBtn.setAttribute('title', prevTitle);
                else copyBtn.removeAttribute('title');
                copyBtn.setAttribute('aria-label', 'Copy step');
            }, 1400);
            return;
        }

 // --- step indent ---
          const indentBtn = e.target.closest('.step-indent-btn');
          if (indentBtn && root.contains(indentBtn)) {
              e.preventDefault();
              e.stopPropagation();
              if (indentBtn.disabled) return;
              const row = indentBtn.closest('.step-row--display');
              const stepId = row?.dataset?.stepId;
              if (!stepId) return;
              // Flush any pending autosave before DOM operations
              flushDesktopAutoSave(root, item);
              syncItemBodyFromDom(root, item);
              const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
              const stepIdx = item.steps.findIndex((s) => s.id === stepId);
              if (stepIdx < 0) return;
              indentChecklistSteps(item.steps, stepIdx);
              // Set pending focus so refreshNoteBody restores caret on the same step
              setPendingChecklistFocus(root, stepId, 'end');
              // Always persist immediately — even in the modal — matching Enter-split.
              if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
              onChange();
              // Full refresh so tree guides and button states update on ALL rows
              refresh();
              return;
          }

         // --- step outdent ---
         const outdentBtn = e.target.closest('.step-outdent-btn');
         if (outdentBtn && root.contains(outdentBtn)) {
             e.preventDefault();
             e.stopPropagation();
             if (outdentBtn.disabled) return;
             const row = outdentBtn.closest('.step-row--display');
             const stepId = row?.dataset?.stepId;
             if (!stepId) return;
             const step = (item.steps || []).find(s => s.id === stepId);
             if (!step || getStepLevel(step) <= 0) return;
             // Flush any pending autosave before DOM operations
             flushDesktopAutoSave(root, item);
             syncItemBodyFromDom(root, item);
             const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
             const stepIdx = item.steps.findIndex((s) => s.id === stepId);
             if (stepIdx < 0) return;
             outdentChecklistSteps(item.steps, stepIdx);
             // Set pending focus so refreshNoteBody restores caret on the same step
             setPendingChecklistFocus(root, stepId, 'end');
            // Always persist immediately — even in the modal — matching Enter-split.
            if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
            onChange();
            // Full refresh so tree guides and button states update on ALL rows
            refresh();
            return;
        }

        // --- step collapse/expand ---
        const collapseBtn = e.target.closest('.step-collapse-btn');
        if (collapseBtn && root.contains(collapseBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const key = collapseBtn.dataset.collapseKey;
            if (!key) return;
            const collapsed = getChecklistCollapsedKeys();
            if (collapsed[key]) {
                delete collapsed[key];
            } else {
                collapsed[key] = true;
            }
            localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
            refresh();
            return;
        }

        // --- expand/collapse all ---
        const expandAllBtn = e.target.closest('.checklist-expand-collapse-all-btn');
        if (expandAllBtn && root.contains(expandAllBtn)) {
            e.preventDefault();
            e.stopPropagation();
            toggleChecklistExpandCollapseAll(item);
            refresh();
            return;
        }

        // --- done section toggle ---
        const doneToggle = e.target.closest('.checklist-done-toggle');
        if (doneToggle && root.contains(doneToggle)) {
            e.preventDefault();
            e.stopPropagation();
            toggleChecklistDoneSection(item.id);
            refresh();
            return;
        }

    // --- add step ---
    const addBtn = e.target.closest('.expanded-checklist-add-btn');
    if (addBtn && root.contains(addBtn)) {
        e.preventDefault();
        e.stopPropagation();
        // Flush any pending autosave AND synchronously sync the focused step's
        // text to the model BEFORE inserting a new row. This prevents typed text
        // from being lost during re-render / rapid-fire clicks.
        flushDesktopAutoSave(root, item);
        syncFocusedStepTextToItem(root, item);
        const newStepId = insertChecklistStep(root, item, { localOnly, onChange });
        // The insert is surgical (row already in DOM). Do NOT call refresh() here —
        // a full re-render would race with the focused text sync. Focus is handled
        // by setPendingChecklistFocus on the next refresh cycle if needed.
        if (newStepId) setPendingChecklistFocus(root, newStepId, 'start');
        return;
    }
    });

    // --- step-text keydown: Enter creates sibling, Shift+Enter inserts line break ---
    root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const active = e.target;
        if (!active?.classList?.contains('step-text')) return;
        e.preventDefault();
        const result = handleChecklistEnter(root, item, e, { localOnly, onChange });
        if (result === false) return;
        if (result === 'stay') return;
        // No refresh() - handleChecklistEnter does surgical DOM insertion
    });

    // --- step-text arrow key navigation: navigate between steps on visual edge ---
    root.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        const active = e.target;
        if (!active?.classList?.contains('step-text')) return;
        if (!handleInlineEditArrowNav(e, root, active)) return;
        e.preventDefault();
        e.stopPropagation();
    });
}

export function attachChecklistDrag(root, item, {
    refresh = () => {},
    localOnly = false,
    onChange = () => {}
} = {}) {
    if (!root || !item) return;
    if (root.dataset.checklistDragBound === item.id) return;
    
    // Clean up any existing drag listeners from previous bindings
    if (root.dataset.checklistDragBound) {
        // Remove old stored references if any
        const oldData = root._checklistDragData;
        if (oldData) {
            document.removeEventListener('pointermove', oldData.onMove);
            document.removeEventListener('pointerup', oldData.onUp);
            document.removeEventListener('pointercancel', oldData.onUp);
            document.body.classList.remove('is-checklist-dragging');
            delete root._checklistDragData;
        }
    }
    
    root.dataset.checklistDragBound = item.id;
    
    // Local helper for applying mutations during drag operations
    const applyMutate = (mutator, { persist = !localOnly } = {}) => {
        if (persist) {
            mutateItem(item, mutator, { preserveView: true, skipRerender: true, localOnly });
        } else {
            mutator(item);
        }
    };
    
    let activeDrag = null;

    const hideDropIndicator = () => {
        root.querySelectorAll('.checklist-drop-indicator').forEach((el) => el.remove());
    };

    const getChecklistInsertAnchor = () => {
        return root.querySelector('.expanded-checklist-add-btn, .checklist-done-toggle');
    };

    const updateDropIndicator = (ref, position = 'before', dropMode = 'sibling') => {
        hideDropIndicator();
        if (!ref) return;
        const indicator = document.createElement('div');
        indicator.className = `checklist-drop-indicator is-visible${dropMode === 'child' ? ' is-child' : ''}`;
        indicator.setAttribute('aria-hidden', 'true');
        if (position === 'after') {
            ref.insertAdjacentElement('afterend', indicator);
        } else {
            ref.insertAdjacentElement('beforebegin', indicator);
        }
    };

    const buildDomBlockFromIds = (rows, subtreeIds) => {
        const block = [];
        rows.forEach((row) => {
            if (subtreeIds.includes(row.dataset.stepId)) {
                block.push(row);
            }
        });
        return block;
    };

    const moveBlockInDom = (block, insertIndex, others) => {
        if (!block || block.length === 0) return;
        
        const anchor = getChecklistInsertAnchor();
        const ref = insertIndex < others.length ? others[insertIndex] : null;
        
        block.forEach((row) => {
            // Skip if row is no longer in DOM
            if (!row.parentNode) return;
            
            // Determine the correct parent container dynamically
            // to guarantee parent-child alignment for insertBefore
            let targetParent = null;
            let targetRef = null;
            
            if (ref && ref.parentNode) {
                // Use ref's parent as the target container - this ensures
                // the reference node is a child of the target parent
                targetParent = ref.parentNode;
                targetRef = ref;
            } else if (anchor && anchor.parentNode) {
                // Fall back to anchor's parent
                targetParent = anchor.parentNode;
                targetRef = anchor;
            } else {
                // Last resort: use the block's first row's parent
                targetParent = block[0].parentNode;
            }
            
            // Final fallback: append to expanded-checklist container
            if (!targetParent) {
                const expandedChecklist = root.querySelector('.expanded-checklist');
                if (expandedChecklist) {
                    targetParent = expandedChecklist;
                } else {
                    return; // No valid target, skip this row
                }
            }
            
            // Perform the move with validation
            // Check that targetRef is still a child of targetParent
            if (targetRef && targetRef.parentNode === targetParent) {
                targetParent.insertBefore(row, targetRef);
            } else {
                // If reference is invalid, just append
                targetParent.appendChild(row);
            }
        });
    };

    const syncDomBlock = () => {
        if (!activeDrag) return;
        const { block } = activeDrag;
        root.querySelectorAll('.step-row--display').forEach((r) => r.classList.remove('is-dragging'));
        block.forEach((r) => r.classList.add('is-dragging'));
    };

    const finishDrag = () => {
        if (!activeDrag) return;
        const { block, moved, blockStepIds, dropMode: activeDropMode = 'sibling' } = activeDrag;
        const dropMode = activeDropMode === 'child' ? 'child' : 'sibling';
        const blockRootId = blockStepIds[0];
        block.forEach((r) => r.classList.remove('is-dragging'));
        hideDropIndicator();
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('is-checklist-dragging');
        if (moved) {
            const shell = root.closest('.editor-note-shell') || root;
            // Flush any pending text autosave before the structural move snapshot
            // so a stale autosave can't fire after the reorder with an outdated
            // beforeItem (which would corrupt the undo stack).
            flushDesktopAutoSave(root, item);
            syncItemBodyFromDom(shell, item);
            // Use cached values during drag operations
            const collapsedKeys = getCachedChecklistCollapsedKeys();
            const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
            let parentIdToExpand = null;
            let levelChanged = false;
            applyMutate((it) => {
                // Model-first commit: the drop geometry captured during pointer
                // tracking drives a pure rebuild of item.steps. Structure is
                // never read back from the DOM.
                const result = moveChecklistStepBlock(it.steps, blockRootId, {
                    dropMode,
                    insertIndex: activeDrag.insertIndex ?? 0,
                    anchorStepId: activeDrag.anchorStepId || null,
                    itemId: item.id,
                    collapsedKeys
                });
                parentIdToExpand = result.parentId;
                levelChanged = result.levelChanged;
                it.steps = result.steps;
            }, { persist: false });
            expandChecklistAncestorsForStep(item, blockRootId);
            if (parentIdToExpand) {
                expandChecklistAncestorsForStep(item, parentIdToExpand);
            }
            setPendingChecklistFocus(root, blockRootId, 'end');
            // Always persist immediately — even in the modal (localOnly=true) — so
            // drag reorders are not lost if close races the debounced autosave.
            if (beforeItem) commitInlineChecklistOp(item, beforeItem, { localOnly: false });
            onChange();
            // A child drop (or any re-level) changed the visual indentation, so the
            // rows must re-render at their new levels. Sibling reorders that keep the
            // same level skip the expensive refresh (rows were already moved in place).
            if (levelChanged) refresh();
        }
        activeDrag = null;
        // Invalidate cache after drag completes
        invalidateChecklistCache();
    };

    const onMove = (e) => {
        if (!activeDrag) return;
        if (!activeDrag.moved) {
            const dx = Math.abs(e.clientX - activeDrag.startX);
            const dy = Math.abs(e.clientY - activeDrag.startY);
            if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
            activeDrag.moved = true;
        }
        e.preventDefault();
        syncDomBlock();

        // Use cached rows to avoid repeated DOM queries during pointermove
        const { block, bounds, cachedRows } = activeDrag;
        const { insertIndex, dropMode, anchorRow, others } = resolvePointerDropTarget(
            e.clientY,
            e.clientX,
            cachedRows,
            block,
            { bounds }
        );
        activeDrag.dropMode = dropMode;
        activeDrag.insertIndex = insertIndex;
        activeDrag.anchorStepId = anchorRow?.dataset?.stepId || null;

        if (activeDrag.lastInsertIndex !== insertIndex) {
            activeDrag.lastInsertIndex = insertIndex;
            moveBlockInDom(block, insertIndex, others);
        }

        const indicatorRef = insertIndex < others.length
            ? others[insertIndex]
            : others[others.length - 1];
        if (indicatorRef) {
            updateDropIndicator(indicatorRef, insertIndex < others.length ? 'before' : 'after', dropMode);
        }
    };

    const onUp = () => finishDrag();

    // Attach pointerdown handler for grab-handle to initiate drag
    // Using pointerdown instead of mousedown to avoid conflicts with touch/hybrid hardware
    // and to prevent being swallowed by mousedown propagation filters
    root.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const handle = e.target.closest('.grab-handle--step');
        if (!handle || !root.contains(handle)) return;
        const row = handle.closest('.step-row--display:not(.step-row--done)');
        if (!row) return;
        e.preventDefault();
        e.stopPropagation();

        const stepId = row.dataset.stepId;
        const activeSteps = (item.steps || []).filter((step) => !step.completed);
        const stepIndex = activeSteps.findIndex((step) => step.id === stepId);
        if (stepIndex < 0) return;

        // Cache localStorage reads at drag start for performance
        getCachedChecklistCollapsedKeys();
        getCachedChecklistDoneCollapsed();

        // Cache active rows at drag start to avoid repeated DOM queries during pointermove
        const cachedRows = getActiveRows(root);
        const visibleIds = cachedRows.map((r) => r.dataset.stepId);
        const { subtreeIds, minAmongOthers, maxAmongOthers } = computeVisibleInsertBounds(
            activeSteps,
            stepIndex,
            visibleIds
        );
        const block = buildDomBlockFromIds(cachedRows, subtreeIds);

        activeDrag = {
            row,
            block,
            blockStepIds: subtreeIds,
            bounds: { minAmongOthers, maxAmongOthers },
            cachedRows,
            lastInsertIndex: -1,
            insertIndex: 0,
            anchorStepId: null,
            dropMode: 'sibling',
            startX: e.clientX,
            startY: e.clientY,
            moved: false
        };
        
        // Store references for cleanup on re-render
        root._checklistDragData = { onMove, onUp };
        
        // Add body class for consistent cursor during drag
        document.body.classList.add('is-checklist-dragging');
        
        // Use pointer events for proper touch/mouse interoperability
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }, true);
}
