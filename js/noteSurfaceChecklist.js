/** @module {"owns":"checklist operations, drag/drop, state management", "related":["noteSurface.js","checklistSteps.js","noteBodyConversion.js","richText.js"], "events":[]} */
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants, canIndentStep, computeVisibleInsertBounds, resolvePointerDropTarget, buildVisibleChecklistSteps, annotateChecklistTreeGuides, addChecklistStep, splitChecklistStep, deleteChecklistStep, mergeChecklistStepIntoPrev, indentChecklistSteps, outdentChecklistSteps, moveChecklistStepBlock, toggleStepCompletion, toggleGroupCompletion, getGroupStepIds, buildCompletedChecklistRows } from './checklistSteps.js';
import { stripRichText, sanitizeRichHtml, hasRichMarkup, linkifyPlainUrls } from './richText.js';
import { mutateItem, syncItemBodyFromDom, syncInlineFieldToItem, commitInlineChecklistOp, flushDesktopAutoSave } from './noteSurfaceMutations.js';
import { focusInlineEdit, canInlineEditText, splitInlineEditAtCaret, insertTextAtCaret, handleInlineEditArrowNav } from './noteSurfaceEditing.js';
import { copyPlainTextToClipboard } from './clipboard.js';


const DRAG_THRESHOLD = 4;

/**
 * Capture the canvas scroll position for preservation during DOM operations.
 * @returns {{scrollTop: number, scrollLeft: number}} The scroll position
 */
function captureCanvasScroll() {
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
function restoreCanvasScroll(scrollPos) {
    const canvas = document.getElementById('app-canvas');
    if (canvas) {
        canvas.scrollTop = scrollPos.scrollTop;
        canvas.scrollLeft = scrollPos.scrollLeft;
    }
}

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

function setPendingChecklistFocus(root, stepId, edge = 'start') {
    if (!root || !stepId) return;
    root.dataset.pendingFocusStepId = stepId;
    root.dataset.pendingFocusEdge = edge;
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
        
        // Sync to item and persist
        if (localOnly) {
            onChange();
            refresh();
        } else {
            const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
            syncItemBodyFromDom(root, item);
            commitInlineChecklistOp(item, beforeItem, { localOnly });
            // Always refresh to ensure the done section updates on the board surface
            // and syncs state for both modal and surface editors.
            refresh();
        }
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
              if (localOnly) {
                  onChange();
              } else {
                  commitInlineChecklistOp(item, beforeItem, { localOnly });
              }
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
            if (localOnly) {
                onChange();
            } else {
                commitInlineChecklistOp(item, beforeItem, { localOnly });
            }
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

// Module-level cache for localStorage reads during active drag/render cycles
let _cachedCollapsedKeys = null;
let _cachedDoneCollapsed = null;
let _cacheTimestamp = 0;
const CACHE_TTL = 1000; // 1 second cache for hot paths

function getCachedChecklistCollapsedKeys() {
    const now = Date.now();
    if (_cachedCollapsedKeys && (now - _cacheTimestamp) < CACHE_TTL) {
        return _cachedCollapsedKeys;
    }
    _cachedCollapsedKeys = getChecklistCollapsedKeys();
    _cacheTimestamp = now;
    return _cachedCollapsedKeys;
}

function getCachedChecklistDoneCollapsed() {
    const now = Date.now();
    if (_cachedDoneCollapsed && (now - _cacheTimestamp) < CACHE_TTL) {
        return _cachedDoneCollapsed;
    }
    _cachedDoneCollapsed = getChecklistDoneCollapsed();
    _cacheTimestamp = now;
    return _cachedDoneCollapsed;
}

function invalidateChecklistCache() {
    _cachedCollapsedKeys = null;
    _cachedDoneCollapsed = null;
    _cacheTimestamp = 0;
}

// Surgical DOM update: insert a new step row into the DOM
function insertStepRowInDom(root, newStep, item, { afterStepId = null, richEdit = false } = {}) {
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
    
    // Find insertion point: after specified step or at end
    const afterRow = afterStepId ? root.querySelector(`.step-row--display[data-step-id="${afterStepId}"]`) : null;
    const addBtn = root.querySelector('.expanded-checklist-add-btn');
    const doneToggle = root.querySelector('.checklist-done-toggle');
    
    if (afterRow) {
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
function syncChecklistStepToItem(el, item) {
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
function syncFocusedStepTextToItem(root, item) {
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
            if (!localOnly) {
                commitInlineChecklistOp(item, beforeItem, { localOnly });
            }
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

export function getActiveRows(root = document) {
    if (!root) return [];
    const collapsed = getChecklistCollapsedKeys();
    const doneCollapsed = getChecklistDoneCollapsed();
    const rows = [];
    const allRows = root.querySelectorAll('.step-row--display');
    allRows.forEach((row) => {
        const stepId = row.dataset.stepId;
        if (!stepId) return;
        const isDone = row.classList.contains('step-row--done');
        const isCollapsedGroup = isCollapsedGroupRow(row, collapsed);
        const isCollapsedDone = isDone && doneCollapsed[row.dataset.itemId];
        if (!isCollapsedGroup && !isCollapsedDone) {
            rows.push(row);
        }
    });
    return rows;
}

/**
 * Find the correct DOM insertion position for a step when moving it from done to active section.
 * The step should be inserted after its parent (based on parentId in the model),
 * or after the last sibling at the same level that comes before it in tree order.
 * 
 * @param {HTMLElement} row - the step row to reposition
 * @param {object} item - the note item
 * @param {HTMLElement} addBtn - the "add step" button (anchor point for end of active section)
 * @returns {HTMLElement|null} - the reference element after which to insert, or null to append
 */
function findStepInsertionPosition(row, item, addBtn) {
    const stepId = row.dataset.stepId;
    if (!stepId) return null;
    
    const step = (item.steps || []).find(s => s.id === stepId);
    if (!step) return null;
    
    const parentId = step.parentId;
    const stepLevel = step.level || 0;
    
    // Get all active rows in DOM order
    const activeRows = Array.from(row.parentNode.querySelectorAll('.step-row--display:not(.step-row--done)'));
    
    // If no parent, insert at the end (but before add button)
    if (!parentId) {
        // Find the last row at level 0 or higher that comes before the add button
        for (let i = activeRows.length - 1; i >= 0; i--) {
            const r = activeRows[i];
            const rLevel = Number(r.dataset.level) || 0;
            if (rLevel <= 0 && r !== addBtn) {
                return r; // Insert after this
            }
        }
        return addBtn; // Before add button
    }
    
    const parentRow = activeRows.find(r => r.dataset.stepId === parentId);
    if (!parentRow) {
        // Parent not found in active rows (might be in done section or moved)
        // Insert before add button as fallback
        return addBtn;
    }
    
    // Find the last sibling or child that this step should come after
    // It should come after:
    // 1. Its parent
    // 2. Any siblings of the parent that are at the same level or lower
    
    const parentLevel = Number(parentRow.dataset.level) || 0;
    
    // Find all rows after the parent, looking for the right position
    const parentIndex = activeRows.indexOf(parentRow);
    for (let i = parentIndex + 1; i < activeRows.length; i++) {
        const r = activeRows[i];
        const rLevel = Number(r.dataset.level) || 0;
        
        // If we find a row at the same level or higher, stop before it
        if (rLevel <= parentLevel) {
            // Insert after the row at i-1, or after parent if i == parentIndex + 1
            return i > parentIndex + 1 ? activeRows[i - 1] : parentRow;
        }
        
        // If the row is higher than our step's level, we might need to insert after it
        if (rLevel < stepLevel && r !== addBtn) {
            // Keep looking - this could be a potential insertion point
        }
    }
    
    // If we get here, insert after the parent (or before add button if parent is last)
    const lastInParentGroup = activeRows[activeRows.length - 1];
    return lastInParentGroup && lastInParentGroup !== addBtn ? lastInParentGroup : addBtn;
}


function isCollapsedGroupRow(row, collapsedKeys) {
    const itemId = row.dataset.itemId;
    const stepId = row.dataset.stepId;
    if (!itemId || !stepId) return false;
    const key = `${itemId}:${stepId}`;
    return !!collapsedKeys[key];
}

export function getChecklistCollapsedKeys() {
    try {
        return JSON.parse(localStorage.getItem('matrix_checklist_collapsed') || '{}');
    } catch {
        return {};
    }
}

export function getChecklistDoneCollapsed() {
    try {
        return JSON.parse(localStorage.getItem('matrix_checklist_done_collapsed') || '{}');
    } catch {
        return {};
    }
}

export function isChecklistDoneSectionCollapsed(itemId) {
    return !!getChecklistDoneCollapsed()[itemId];
}

export function toggleChecklistDoneSection(itemId) {
    const collapsed = getChecklistDoneCollapsed();
    collapsed[itemId] = !collapsed[itemId];
    if (!collapsed[itemId]) delete collapsed[itemId];
    localStorage.setItem('matrix_checklist_done_collapsed', JSON.stringify(collapsed));
}

export function getChecklistCollapsibleKeys(item) {
    if (!item?.id) return [];
    const { active, done } = partitionChecklistSteps(item.steps || []);
    const keys = new Set();
    // Collect collapsible groups per section, so completed groups stay
    // collapseable and the expand/collapse-all toolbar covers them too.
    const collectCollapsible = (list) => {
        list.forEach((step, index) => {
            if (!stepHasDescendants(list, index)) return;
            keys.add(`${item.id}:${step.id}`);
        });
    };
    collectCollapsible(active);
    collectCollapsible(done);
    // Ghost groups (open parents shown above their completed children) also
    // collapse via the shared step key.
    buildCompletedChecklistRows(item.steps, item.id, {})
        .forEach((row) => {
            if (row.isGhost && row.hasKids) keys.add(row.collapseKey);
        });
    return [...keys];
}

export function checklistGroupsAnyExpanded(item) {
    const collapsed = getChecklistCollapsedKeys();
    return getChecklistCollapsibleKeys(item).some((key) => !collapsed[key]);
}

export function collapseAllChecklistGroups(item) {
    const collapsed = getChecklistCollapsedKeys();
    getChecklistCollapsibleKeys(item).forEach((key) => {
        collapsed[key] = true;
    });
    localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
}

export function expandAllChecklistGroups(item) {
    const collapsed = getChecklistCollapsedKeys();
    getChecklistCollapsibleKeys(item).forEach((key) => {
        delete collapsed[key];
    });
    localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
}

export function toggleChecklistExpandCollapseAll(item) {
    if (checklistGroupsAnyExpanded(item)) {
        collapseAllChecklistGroups(item);
    } else {
        expandAllChecklistGroups(item);
    }
}

export function buildChecklistExpandCollapseAllHtml(item) {
    if (!item?.id || !checklistHasIndentations(item.steps)) return '';
    const collapsibleKeys = getChecklistCollapsibleKeys(item);
    if (collapsibleKeys.length === 0) return '';
    const collapsed = getChecklistCollapsedKeys();
    const anyExpanded = collapsibleKeys.some((key) => !collapsed[key]);
    const label = anyExpanded ? 'Collapse all checklist groups' : 'Expand all checklist groups';
    const icon = anyExpanded ? ACTION_ICONS.collapseAll : ACTION_ICONS.expandAll;
    return `<div class="checklist-toolbar">
            <button type="button" class="card-act checklist-expand-collapse-all-btn" title="${escapeHTML(label).replace(/"/g, "")}" aria-label="${escapeHTML(label).replace(/"/g, "")}">${icon}</button>
        </div>`;
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
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const result = deleteChecklistStep(item.steps, stepId);
    item.steps = result.steps;
    const prevStepId = result.prevStepId;
    const nextStepId = result.nextStepId;

    if (!localOnly) {
        commitInlineChecklistOp(item, beforeItem, { localOnly });
    }
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

    if (!localOnly) {
        commitInlineChecklistOp(item, beforeItem, { localOnly });
    }
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
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const result = deleteChecklistStep(item.steps, stepId);
    item.steps = result.steps;
    if (!localOnly) {
        commitInlineChecklistOp(item, beforeItem, { localOnly });
    }
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

    const step = item.steps[stepIdx];
    const { before, after } = splitInlineEditAtCaret(active);

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

function isChecklistGroupCollapsed(itemId, stepId) {
    const collapsed = getChecklistCollapsedKeys();
    return !!collapsed[`${itemId}:${stepId}`];
}

export function expandChecklistAncestorsForStep(item, stepId) {
    if (!item?.id || !item.steps) return;
    const collapsed = getChecklistCollapsedKeys();
    const step = item.steps.find((s) => s.id === stepId);
    if (!step) return;

    const level = getStepLevel(step);
    for (let i = 0; i < level; i++) {
        const ancestorKey = `${item.id}:ancestor_${i}`;
        delete collapsed[ancestorKey];
    }
    localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
}

export function prepareInlineOpSnapshot(root, item, localOnly) {
    if (!root || !item) return null;
    const snapshot = JSON.parse(JSON.stringify(item));
    snapshot._localOnly = localOnly;
    return snapshot;
}

/**
 * Build HTML for a single checklist step row.
 * This function is used by both modal and inline editors.
 */
export function buildChecklistRowHtml(step, {
    hasKids = false,
    isCollapsed = false,
    collapseKey = '',
    isDoneSection = false,
    isGhost = false,
    treeGuides = [],
    canEdit = true,
    richEdit = false,
    active = []
} = {}) {
    const stepLevel = getStepLevel(step);
    const activeIdx = (isDoneSection || isGhost) ? -1 : active.findIndex((s) => s.id === step.id);
    // Collapse chevrons render for any parent group — including completed groups
    // in the done section — so completed trees keep their expand/collapse control.
    const collapseControl = hasKids
        ? `<button type="button" class="step-collapse-btn" data-collapse-key="${escapeAttr(collapseKey)}" title="${isCollapsed ? 'Expand group' : 'Collapse group'}" aria-label="${isCollapsed ? 'Expand group' : 'Collapse group'}">${isCollapsed ? CARD_ICONS.chevronRight : CARD_ICONS.chevronDown}</button>`
        : '<span class="step-collapse-spacer" aria-hidden="true"></span>';
    const dragHandle = !canEdit
        ? ''
        : (isGhost || isDoneSection)
            ? '<span class="grab-handle grab-handle--step grab-handle--spacer" aria-hidden="true">⋮⋮</span>'
            : '<span class="grab-handle grab-handle--step" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>';
    const nestControls = !isGhost && canEdit ? `
        <button type="button" class="card-act step-outdent-btn" title="Outdent" aria-label="Outdent"${stepLevel === 0 ? ' disabled' : ''}>‹</button>
        <button type="button" class="card-act step-indent-btn" title="Indent" aria-label="Indent"${!canIndentStep(active, activeIdx) ? ' disabled' : ''}>›</button>` : '';
    const copyBtn = !isGhost && canEdit
        ? `<button type="button" class="card-act step-copy-btn" title="Copy item" aria-label="Copy item">${CARD_ICONS.copy}</button>`
        : '';
    const deleteBtn = !isGhost && canEdit
        ? `<button type="button" class="card-act card-act--danger step-delete-btn" title="Remove item" aria-label="Remove item">${CARD_ICONS.close}</button>`
        : '';
    const stepText = step.text || '';
    let textHtml;
    if (isGhost) {
        // Ghost rows are read-only context placeholders (never editable).
        textHtml = `<span class="step-text step-text--ghost${hasRichMarkup(stepText) ? ' rich-text' : ''}">${sanitizeRichHtml(stepText)}</span>`;
    } else if (canEdit && (richEdit || canInlineEditText(stepText, { richEdit }))) {
        const inner = richEdit ? sanitizeRichHtml(stepText) : escapeHTML(stepText);
        const ce = richEdit ? 'true' : 'plaintext-only';
        const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
        textHtml = `<span class="step-text card-inline-edit${richClasses} ${step.completed ? 'completed' : ''}" contenteditable="${ce}" spellcheck="false" data-field="step-text" data-step-id="${step.id}">${inner}</span>`;
    } else {
        const richClass = hasRichMarkup(stepText) ? ' rich-text' : '';
        textHtml = `<span class="step-text${richClass} ${step.completed ? 'completed' : ''}">${sanitizeRichHtml(stepText)}</span>`;
    }
    // Tree guides render for done-section rows too so completed groups keep
    // their visual parent-child indentation.
    const treeGutterHtml = treeGuides.length > 0
        ? `<span class="step-tree-gutter" aria-hidden="true">${treeGuides.map(({ role }) => {
            return `<span class="step-tree-guide step-tree-guide--${role}" aria-hidden="true"></span>`;
        }).join('')}</span>`
        : '';
    const stepCheckHtml = isGhost
        ? '<span class="step-check step-check--ghost" aria-hidden="true"></span>'
        : `<input type="checkbox" class="step-check" ${step.completed ? 'checked' : ''}>`;
    // Ghosts intentionally omit data-step-id so DOM scanners keyed on step ids
    // (drag bounds, inline editing, DOM sync) skip them automatically.
    const stepIdAttr = isGhost ? '' : ` data-step-id="${step.id}"`;
    const ghostAttr = isGhost ? ' data-ghost-step="1"' : '';
    return `
        <div class="step-row step-row--display${step.completed ? ' step-row--done' : ''}${isGhost ? ' step-row--ghost' : ''}"${stepIdAttr}${ghostAttr} data-level="${stepLevel}">
            <div class="step-row-leading">
                ${dragHandle}
                ${treeGutterHtml}
                ${collapseControl}
                ${stepCheckHtml}
            </div>
            ${textHtml}
            <div class="step-row-actions">
                ${copyBtn}
                ${canEdit ? `<span class="step-nest-controls">${nestControls}</span>` : ''}
                ${deleteBtn}
            </div>
        </div>
    `;
}

export function createStepId() {
    return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}