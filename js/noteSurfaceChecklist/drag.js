/** @module {"owns":"pointer drag for checklist steps - ghosts, drop targeting with computed insert bounds, and the reorder/indent intent that lands as one committed operation", "related":["noteSurfaceChecklist.js","noteSurfaceChecklist/targeting.js","noteSurfaceChecklist/collapse.js","noteSurfaceChecklist/ops.js","checklistSteps.js"]} */
import { computeVisibleInsertBounds, resolvePointerDropTarget, moveChecklistStepBlock } from '../checklistSteps.js';
import { mutateItem, syncItemBodyFromDom, commitInlineChecklistOp, flushDesktopAutoSave } from '../noteSurfaceMutations.js';
import { expandChecklistAncestorsForStep, getCachedChecklistCollapsedKeys, getCachedChecklistDoneCollapsed, invalidateChecklistCache } from './collapse.js';
import { getActiveRows } from './targeting.js';
import { setPendingChecklistFocus, prepareInlineOpSnapshot } from './ops.js';


const DRAG_THRESHOLD = 4;

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
