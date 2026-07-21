/** @module {"owns":"unified checklist interaction controller", "related":["checklistSteps.js","noteSurfaceMutations.js","noteSurfaceEditing.js","checklistHtml.js"], "events":[]} */
import {
    getStepLevel,
    partitionChecklistSteps,
    checklistHasIndentations,
    stepHasDescendants,
    canIndentStep,
    normalizeChecklistLevels,
    computeVisibleInsertBounds,
    reorderActiveStepsFromDomOrder,
    applySubtreeLevelDelta,
    resolvePointerDropTarget,
    resolveDropTarget,
    buildVisibleChecklistSteps,
    collectStepSubtree
} from './checklistSteps.js';
import {
    mutateItem,
    syncItemBodyFromDom,
    syncInlineFieldToItem,
    commitInlineChecklistOp,
    createBlankChecklistStep
} from './noteSurfaceMutations.js';
import {
    splitInlineEditAtCaret,
    insertTextAtCaret,
    handleInlineEditArrowNav,
    focusInlineEdit,
    isAtAbsoluteStart,
    isAtAbsoluteEnd,
    getInlineEditSequence
} from './noteSurfaceEditing.js';
import {
    buildChecklistRowHtml,
    buildChecklistExpandCollapseAllHtml
} from './checklistHtml.js';
import { CARD_ICONS } from './icons.js';
import { stripRichText } from './richText.js';
import { copyPlainTextToClipboard } from './clipboard.js';

const DRAG_THRESHOLD = 4;

/**
 * ChecklistController - Unified controller for checklist interactions.
 * Handles keyboard events, click delegation, and drag-and-drop for checklist steps.
 * Works with both surface notes and modal editor.
 */
export class ChecklistController {
    constructor(container, item, options = {}) {
        this.container = container;
        this.item = item;
        this.options = {
            isModal: false,
            richEdit: false,
            localOnly: false,
            canEdit: true,
            onChange: () => {},
            onPersist: () => {},
            onFocusChange: () => {},
            refresh: () => {},
            ...options
        };
        this.boundItemId = null;
        this._dragData = null;
        this._boundClickHandler = null;
        this._boundKeydownHandler = null;
        this._boundPointerdownHandler = null;
        this._init();
    }

    _init() {
        if (!this.container || !this.item) return;
        
        // Check if a controller is already bound to this container for this item
        if (this.container._checklistController && this.container._checklistController.item?.id === this.item.id) {
            // Destroy the old controller to clean up listeners
            this.container._checklistController.destroy();
        }
        
        this.boundItemId = this.item.id;
        this.container._checklistController = this;

        this._bindClickHandlers();
        this._bindKeyHandlers();
        this._bindDragHandlers();
    }

    /**
     * Focus a step text element and set caret at the specified edge.
     * @param {HTMLElement} el - The element to focus
     * @param {string} edge - 'start' or 'end'
     */
    _focusStepTextAtEdge(el, edge = 'start') {
        if (!el) return;
        // Cache scroll position before focus to prevent browser scroll-snap
        const scrollContainer = el.closest('.editor-note-body') || document.documentElement;
        const cachedScrollTop = scrollContainer.scrollTop;
        el.focus({ preventScroll: true });
        // Restore scroll if browser changed it
        if (scrollContainer.scrollTop !== cachedScrollTop) {
            scrollContainer.scrollTop = cachedScrollTop;
        }
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(edge === 'start');
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    }

    /**
     * Set pending focus on a checklist step.
     * @param {string} stepId - The step ID to focus
     * @param {string} edge - 'start' or 'end'
     */
    _setPendingFocus(stepId, edge = 'start') {
        if (!this.container || !stepId) return;
        this.container.dataset.pendingFocusStepId = stepId;
        this.container.dataset.pendingFocusEdge = edge;
        this.options.onFocusChange(stepId, edge);
    }

    /**
     * Get cached collapsed keys from localStorage.
     */
    _getCachedCollapsedKeys() {
        try {
            return JSON.parse(localStorage.getItem('matrix_checklist_collapsed') || '{}');
        } catch {
            return {};
        }
    }

    /**
     * Get cached done collapsed state.
     */
    _getCachedDoneCollapsed() {
        try {
            return JSON.parse(localStorage.getItem('matrix_checklist_done_collapsed') || '{}');
        } catch {
            return {};
        }
    }

    /**
     * Prepare a snapshot of the item for undo/rollback.
     */
    _prepareSnapshot() {
        if (!this.item) return null;
        const snapshot = JSON.parse(JSON.stringify(this.item));
        snapshot._localOnly = this.options.localOnly;
        return snapshot;
    }

    /**
     * Update a row's level attribute and tree guides in-place.
     */
    _updateRowLevelInDom(row, step) {
        if (!row || !step) return;
        const { active } = partitionChecklistSteps(this.item.steps || []);
        const stepIdx = active.findIndex((s) => s.id === step.id);
        const newLevel = getStepLevel(step);

        row.dataset.level = String(newLevel);

        const treeGutter = row.querySelector('.step-tree-gutter');
        if (treeGutter && stepIdx >= 0) {
            const treeGuides = buildVisibleChecklistSteps(active, this.item.id, this._getCachedCollapsedKeys())
                .find((s) => s.step.id === step.id)?.treeGuides || [];
            treeGutter.innerHTML = treeGuides.map(({ role }) =>
                `<span class="step-tree-guide step-tree-guide--${role}" aria-hidden="true"></span>`
            ).join('');
        }

        const outdentBtn = row.querySelector('.step-outdent-btn');
        if (outdentBtn) outdentBtn.disabled = newLevel <= 0;

        const indentBtn = row.querySelector('.step-indent-btn');
        if (indentBtn) indentBtn.disabled = !canIndentStep(active, stepIdx);
    }

    /**
     * Insert a new step row into the DOM.
     */
    _insertStepRowInDom(newStep, { afterStepId = null } = {}) {
        if (!this.container || !newStep || !this.item) return null;

        const { active } = partitionChecklistSteps(this.item.steps || []);
        const rowHtml = buildChecklistRowHtml(newStep, {
            hasKids: stepHasDescendants(active, active.findIndex((s) => s.id === newStep.id)),
            isCollapsed: false,
            collapseKey: '',
            isDoneSection: false,
            treeGuides: [],
            canEdit: this.options.canEdit,
            richEdit: this.options.richEdit,
            active
        });

        const temp = document.createElement('div');
        temp.innerHTML = rowHtml.trim();
        const newRow = temp.firstElementChild;

        // Find insertion point: after specified step or at end
        const afterRow = afterStepId ? this.container.querySelector(`.step-row--display[data-step-id="${afterStepId}"]`) : null;
        const addBtn = this.container.querySelector('.expanded-checklist-add-btn');
        const doneToggle = this.container.querySelector('.checklist-done-toggle');

        if (afterRow) {
            afterRow.insertAdjacentElement('afterend', newRow);
        } else if (addBtn) {
            addBtn.parentNode.insertBefore(newRow, addBtn);
        } else if (doneToggle) {
            doneToggle.insertAdjacentElement('beforebegin', newRow);
        } else {
            this.container.querySelector('.expanded-checklist')?.appendChild(newRow);
        }

        return newRow;
    }

    /**
     * Bind all click handlers for checklist interactions.
     */
    _bindClickHandlers() {
        const boundChangeHandler = (e) => {
            const cb = e.target.closest('.step-check');
            if (!cb || !this.container.contains(cb)) return;
            const row = cb.closest('.step-row--display');
            if (!row) return;
            const stepId = row.dataset.stepId;
            if (!stepId) return;
            const step = (this.item.steps || []).find(s => s.id === stepId);
            if (!step) return;

            const newCompleted = cb.checked;
            const wasCompleted = step.completed;

            // For non-structural updates (checkbox toggle), update DOM directly
            if (wasCompleted !== newCompleted) {
                step.completed = newCompleted;

                // Update row class
                row.classList.toggle('step-row--done', newCompleted);

                // Update step text class
                const stepTextEl = row.querySelector('.step-text');
                if (stepTextEl) {
                    stepTextEl.classList.toggle('completed', newCompleted);
                }

                // Move row to done section or back to active section
                const doneSection = this.container.querySelector('.checklist-done-section');
                const addBtn = this.container.querySelector('.expanded-checklist-add-btn');
                const doneToggle = this.container.querySelector('.checklist-done-toggle');

                if (newCompleted && doneSection) {
                    doneSection.appendChild(row);
                } else if (!newCompleted && doneSection && addBtn) {
                    addBtn.parentNode.insertBefore(row, addBtn);
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
            if (this.options.localOnly) {
                this.options.onChange();
            } else {
                const beforeItem = this._prepareSnapshot();
                syncItemBodyFromDom(this.container, this.item);
                commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
            }
        };

        const boundClickHandler = (e) => {
            // Step delete
            const delBtn = e.target.closest('.step-delete-btn');
            if (delBtn && this.container.contains(delBtn)) {
                e.preventDefault();
                e.stopPropagation();
                const row = delBtn.closest('.step-row--display');
                const stepId = row?.dataset?.stepId;
                if (!stepId) return;
                const focusStepId = this._removeChecklistStep(stepId);
                if (focusStepId) this._setPendingFocus(focusStepId, 'end');
                if (this.options.localOnly) this.options.refresh();
                return;
            }

            // Step copy
            const copyBtn = e.target.closest('.step-copy-btn');
            if (copyBtn && this.container.contains(copyBtn)) {
                e.preventDefault();
                e.stopPropagation();
                const row = copyBtn.closest('.step-row--display');
                const stepId = row?.dataset?.stepId;
                if (!stepId) return;
                const step = (this.item.steps || []).find(s => s.id === stepId);
                if (!step) return;
                const text = stripRichText(step.text || '');
                copyPlainTextToClipboard(text);
                // Simple flash feedback
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

            // Step indent
            const indentBtn = e.target.closest('.step-indent-btn');
            if (indentBtn && this.container.contains(indentBtn)) {
                e.preventDefault();
                e.stopPropagation();
                if (indentBtn.disabled) return;
                const row = indentBtn.closest('.step-row--display');
                const stepId = row?.dataset?.stepId;
                if (!stepId) return;
                syncItemBodyFromDom(this.container, this.item);
                const beforeItem = this._prepareSnapshot();
                const stepIdx = this.item.steps.findIndex((s) => s.id === stepId);
                if (stepIdx < 0) return;
                applySubtreeLevelDelta(this.item.steps, stepIdx, 1);
                normalizeChecklistLevels(this.item.steps);
                this._updateRowLevelInDom(row, this.item.steps[stepIdx]);
                const indentTargetEl = row.querySelector('.step-text.card-inline-edit');
                requestAnimationFrame(() => {
                    if (indentTargetEl) {
                        this._focusStepTextAtEdge(indentTargetEl, 'end');
                    }
                });
                if (this.options.localOnly) {
                    this.options.onChange();
                } else {
                    commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
                }
                return;
            }

            // Step outdent
            const outdentBtn = e.target.closest('.step-outdent-btn');
            if (outdentBtn && this.container.contains(outdentBtn)) {
                e.preventDefault();
                e.stopPropagation();
                if (outdentBtn.disabled) return;
                const row = outdentBtn.closest('.step-row--display');
                const stepId = row?.dataset?.stepId;
                if (!stepId) return;
                const step = (this.item.steps || []).find(s => s.id === stepId);
                if (!step || getStepLevel(step) <= 0) return;
                syncItemBodyFromDom(this.container, this.item);
                const beforeItem = this._prepareSnapshot();
                const stepIdx = this.item.steps.findIndex((s) => s.id === stepId);
                if (stepIdx < 0) return;
                applySubtreeLevelDelta(this.item.steps, stepIdx, -1);
                normalizeChecklistLevels(this.item.steps);
                this._updateRowLevelInDom(row, this.item.steps[stepIdx]);
                const outdentTargetEl = row.querySelector('.step-text.card-inline-edit');
                requestAnimationFrame(() => {
                    if (outdentTargetEl) {
                        this._focusStepTextAtEdge(outdentTargetEl, 'end');
                    }
                });
                if (this.options.localOnly) {
                    this.options.onChange();
                } else {
                    commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
                }
                return;
            }

            // Step collapse/expand
            const collapseBtn = e.target.closest('.step-collapse-btn');
            if (collapseBtn && this.container.contains(collapseBtn)) {
                e.preventDefault();
                e.stopPropagation();
                const key = collapseBtn.dataset.collapseKey;
                if (!key) return;
                const collapsed = this._getCachedCollapsedKeys();
                if (collapsed[key]) {
                    delete collapsed[key];
                } else {
                    collapsed[key] = true;
                }
                localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
                this.options.refresh();
                return;
            }

            // Expand/collapse all
            const expandAllBtn = e.target.closest('.checklist-expand-collapse-all-btn');
            if (expandAllBtn && this.container.contains(expandAllBtn)) {
                e.preventDefault();
                e.stopPropagation();
                this._toggleChecklistExpandCollapseAll();
                this.options.refresh();
                return;
            }

            // Done section toggle
            const doneToggle = e.target.closest('.checklist-done-toggle');
            if (doneToggle && this.container.contains(doneToggle)) {
                e.preventDefault();
                e.stopPropagation();
                this._toggleChecklistDoneSection();
                this.options.refresh();
                return;
            }

            // Add step
            const addBtn = e.target.closest('.expanded-checklist-add-btn');
            if (addBtn && this.container.contains(addBtn)) {
                e.preventDefault();
                e.stopPropagation();
                const newStepId = this._insertChecklistStep();
                if (newStepId) this._setPendingFocus(newStepId, 'start');
                if (this.options.localOnly) this.options.refresh();
                return;
            }
        };

        this.container.addEventListener('change', boundChangeHandler);
        this.container.addEventListener('click', boundClickHandler);
        this._boundChangeHandler = boundChangeHandler;
        this._boundClickHandler = boundClickHandler;
    }

    /**
     * Bind all keyboard handlers for checklist interactions.
     */
    _bindKeyHandlers() {
        const boundKeydownHandler = (e) => {
            // Escape key: blur current element and exit editing mode
            if (e.key === 'Escape') {
                const active = e.target;
                if (active?.classList?.contains('step-text')) {
                    e.preventDefault();
                    e.stopPropagation();
                    active.blur();
                    this.options.onFocusChange(null, null);
                    return;
                }
            }

            // Step-text keydown: Enter creates sibling, Shift+Enter inserts line break
            if (e.key !== 'Enter') return;
            const active = e.target;
            if (!active?.classList?.contains('step-text')) return;
            e.preventDefault();
            this._handleChecklistEnter(e);
        };

        const boundArrowKeyHandler = (e) => {
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
            const active = e.target;
            if (!active?.classList?.contains('step-text')) return;
            if (!handleInlineEditArrowNav(e, this.container, active)) return;
            e.preventDefault();
            e.stopPropagation();
        };

        const boundTabHandler = (e) => {
            if (e.key !== 'Tab') return;
            const active = e.target;
            if (!active?.classList?.contains('step-text')) return;
            e.preventDefault();
            e.stopPropagation();

            const stepId = active.dataset.stepId;
            const stepIdx = this.item.steps?.findIndex((s) => s.id === stepId);
            if (stepIdx < 0) return;

            syncItemBodyFromDom(this.container, this.item);
            const beforeItem = this._prepareSnapshot();

            if (e.shiftKey) {
                // Shift+Tab: outdent
                const step = this.item.steps[stepIdx];
                if (!step || getStepLevel(step) <= 0) return;
                applySubtreeLevelDelta(this.item.steps, stepIdx, -1);
                normalizeChecklistLevels(this.item.steps);
                const row = active.closest('.step-row--display');
                this._updateRowLevelInDom(row, this.item.steps[stepIdx]);
                requestAnimationFrame(() => {
                    this._focusStepTextAtEdge(active, 'end');
                });
            } else {
                // Tab: indent
                if (!canIndentStep(this.item.steps, stepIdx)) return;
                applySubtreeLevelDelta(this.item.steps, stepIdx, 1);
                normalizeChecklistLevels(this.item.steps);
                const row = active.closest('.step-row--display');
                this._updateRowLevelInDom(row, this.item.steps[stepIdx]);
                requestAnimationFrame(() => {
                    this._focusStepTextAtEdge(active, 'end');
                });
            }

            if (this.options.localOnly) {
                this.options.onChange();
            } else {
                commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
            }
        };

        this.container.addEventListener('keydown', boundKeydownHandler);
        this.container.addEventListener('keydown', boundArrowKeyHandler);
        this.container.addEventListener('keydown', boundTabHandler);
        this._boundKeydownHandler = boundKeydownHandler;
        this._boundArrowKeyHandler = boundArrowKeyHandler;
        this._boundTabHandler = boundTabHandler;
    }

    /**
     * Bind drag-and-drop handlers for checklist.
     */
    _bindDragHandlers() {
        if (this.container.dataset.checklistDragBound === this.item.id) return;

        // Clean up any existing drag listeners
        if (this.container.dataset.checklistDragBound) {
            const oldData = this.container._checklistDragData;
            if (oldData) {
                document.removeEventListener('pointermove', oldData.onMove);
                document.removeEventListener('pointerup', oldData.onUp);
                document.removeEventListener('pointercancel', oldData.onUp);
                document.body.classList.remove('is-checklist-dragging');
                delete this.container._checklistDragData;
            }
        }

        this.container.dataset.checklistDragBound = this.item.id;

        const applyMutate = (mutator, { persist = !this.options.localOnly } = {}) => {
            if (persist) {
                mutateItem(this.item, mutator, { preserveView: true, skipRerender: true, localOnly: this.options.localOnly });
            } else {
                mutator(this.item);
            }
        };

        let activeDrag = null;

        const hideDropIndicator = () => {
            this.container.querySelectorAll('.checklist-drop-indicator').forEach((el) => el.remove());
        };

        const getChecklistInsertAnchor = () => {
            return this.container.querySelector('.expanded-checklist-add-btn, .checklist-done-toggle');
        };

        const updateDropIndicator = (ref, position = 'before') => {
            hideDropIndicator();
            if (!ref) return;
            const indicator = document.createElement('div');
            indicator.className = 'checklist-drop-indicator is-visible';
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
                if (!row.parentNode) return;

                let targetParent = null;
                let targetRef = null;

                if (ref && ref.parentNode) {
                    targetParent = ref.parentNode;
                    targetRef = ref;
                } else if (anchor && anchor.parentNode) {
                    targetParent = anchor.parentNode;
                    targetRef = anchor;
                } else {
                    targetParent = block[0].parentNode;
                }

                if (!targetParent) {
                    const expandedChecklist = this.container.querySelector('.expanded-checklist');
                    if (expandedChecklist) {
                        targetParent = expandedChecklist;
                    } else {
                        return;
                    }
                }

                if (targetRef && targetRef.parentNode === targetParent) {
                    targetParent.insertBefore(row, targetRef);
                } else {
                    targetParent.appendChild(row);
                }
            });
        };

        const syncDomBlock = () => {
            if (!activeDrag) return;
            const { block } = activeDrag;
            this.container.querySelectorAll('.step-row--display').forEach((r) => r.classList.remove('is-dragging'));
            block.forEach((r) => r.classList.add('is-dragging'));
        };

        const finishDrag = () => {
            if (!activeDrag) return;
            const { block, moved, blockStepIds } = activeDrag;
            const blockRootId = blockStepIds[0];
            block.forEach((r) => r.classList.remove('is-dragging'));
            hideDropIndicator();
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.body.classList.remove('is-checklist-dragging');
            if (moved) {
                const shell = this.container.closest('.editor-note-shell') || this.container;
                syncItemBodyFromDom(shell, this.item);
                const collapsedKeys = this._getCachedCollapsedKeys();
                const beforeItem = this._prepareSnapshot();
                let parentIdToExpand = null;
                applyMutate((it) => {
                    const activeSteps = it.steps.filter((step) => !step.completed);
                    const doneSteps = it.steps.filter((step) => step.completed);
                    const visibleOrderIds = this._getActiveRows().map((r) => r.dataset.stepId);
                    const reordered = reorderActiveStepsFromDomOrder(
                        activeSteps,
                        visibleOrderIds,
                        this.item.id,
                        collapsedKeys
                    );
                    const dropResult = resolveDropTarget(reordered, blockRootId, { mode: 'sibling' });
                    parentIdToExpand = dropResult?.parentId || null;
                    normalizeChecklistLevels(reordered);
                    it.steps = [...reordered, ...doneSteps];
                }, { persist: false });
                this._expandChecklistAncestorsForStep(blockRootId);
                if (parentIdToExpand) {
                    this._expandChecklistAncestorsForStep(parentIdToExpand);
                }
                this._setPendingFocus(blockRootId, 'end');
                if (!this.options.localOnly) {
                    commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
                }
            }
            activeDrag = null;
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

            const { block, bounds, cachedRows } = activeDrag;
            const { insertIndex, others } = resolvePointerDropTarget(
                e.clientY,
                cachedRows,
                block,
                { bounds }
            );

            if (activeDrag.lastInsertIndex !== insertIndex) {
                activeDrag.lastInsertIndex = insertIndex;
                moveBlockInDom(block, insertIndex, others);
            }

            const indicatorRef = insertIndex < others.length
                ? others[insertIndex]
                : others[others.length - 1];
            if (indicatorRef) {
                updateDropIndicator(indicatorRef, insertIndex < others.length ? 'before' : 'after');
            }
        };

        const onUp = () => finishDrag();

        // Attach pointerdown handler for grab-handle
        const boundPointerdownHandler = (e) => {
            if (e.button !== 0) return;
            const handle = e.target.closest('.grab-handle--step');
            if (!handle || !this.container.contains(handle)) return;
            const row = handle.closest('.step-row--display:not(.step-row--done)');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();

            const stepId = row.dataset.stepId;
            const activeSteps = (this.item.steps || []).filter((step) => !step.completed);
            const stepIndex = activeSteps.findIndex((step) => step.id === stepId);
            if (stepIndex < 0) return;

            // Cache active rows at drag start
            const cachedRows = this._getActiveRows();
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
                startX: e.clientX,
                startY: e.clientY,
                moved: false
            };

            this.container._checklistDragData = { onMove, onUp };
            document.body.classList.add('is-checklist-dragging');

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        };

        this.container.addEventListener('pointerdown', boundPointerdownHandler, true);
        this._boundPointerdownHandler = boundPointerdownHandler;
    }

    /**
     * Get active (non-collapsed) rows in the checklist.
     */
    _getActiveRows() {
        if (!this.container) return [];
        const collapsed = this._getCachedCollapsedKeys();
        const doneCollapsed = this._getCachedDoneCollapsed();
        const rows = [];
        const allRows = this.container.querySelectorAll('.step-row--display');
        allRows.forEach((row) => {
            const stepId = row.dataset.stepId;
            if (!stepId) return;
            const isDone = row.classList.contains('step-row--done');
            const isCollapsedGroup = this._isCollapsedGroupRow(row, collapsed);
            const isCollapsedDone = isDone && doneCollapsed[row.dataset.itemId];
            if (!isCollapsedGroup && !isCollapsedDone) {
                rows.push(row);
            }
        });
        return rows;
    }

    _isCollapsedGroupRow(row, collapsedKeys) {
        const itemId = row.dataset.itemId;
        const stepId = row.dataset.stepId;
        if (!itemId || !stepId) return false;
        const key = `${itemId}:${stepId}`;
        return !!collapsedKeys[key];
    }

    /**
     * Handle Enter key in checklist step-text.
     */
    _handleChecklistEnter(e) {
        if (!this.item || !this.item.steps) return false;
        const active = e.target;
        if (!active?.classList?.contains('step-text')) return false;

        const stepId = active.dataset.stepId;
        const stepIdx = this.item.steps.findIndex((s) => s.id === stepId);
        if (stepIdx < 0) return false;

        if (e.shiftKey) {
            const rich = active.classList.contains('rich-text--edit');
            if (rich) {
                document.execCommand('insertLineBreak');
            } else {
                insertTextAtCaret(active, '\n');
            }
            syncInlineFieldToItem(active, this.item);
            if (!this.options.localOnly) {
                mutateItem(this.item, () => {}, { preserveView: true, skipRerender: true, localOnly: this.options.localOnly });
            }
            this.options.onChange();
            return 'stay';
        }

        // Enter: split text at caret position
        const beforeItem = this._prepareSnapshot();
        const subtree = collectStepSubtree(this.item.steps, stepIdx);
        const isCollapsed = this._isChecklistGroupCollapsed(stepId);
        const hasChildren = subtree.length > 1;
        const insertIdx = hasChildren && isCollapsed
            ? stepIdx + subtree.length
            : stepIdx + 1;

        const step = this.item.steps[stepIdx];
        const { before, after } = splitInlineEditAtCaret(active);

        // Update the current step's text in the item directly
        const rich = active.classList.contains('rich-text--edit');
        if (rich) {
            active.innerHTML = before;
        } else {
            active.textContent = before;
        }
        step.text = before;

        // Create new step with the "after" text
        const newStep = {
            id: this._createStepId(),
            text: after,
            completed: false,
            level: getStepLevel(step)
        };
        this.item.steps.splice(insertIdx, 0, newStep);

        // Surgical DOM insertion
        const newRow = this._insertStepRowInDom(newStep, { afterStepId: stepId });

        // Focus the new step's text element
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

        if (!this.options.localOnly) {
            commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
        }
        this.options.onChange();
        return newStep.id;
    }

    /**
     * Handle Backspace key in checklist step-text.
     * Only merges with previous step when text is empty AND caret is at absolute start.
     */
    _handleChecklistBackspace(e) {
        if (!this.item || !this.item.steps) return false;
        const active = document.activeElement;
        if (!active?.classList?.contains('step-text')) return false;

        const stepId = active.dataset.stepId;
        const stepIdx = this.item.steps.findIndex((s) => s.id === stepId);
        if (stepIdx < 0) return false;

        // Only merge with previous step if text is empty AND caret is at absolute start
        if (isAtAbsoluteStart(active)) {
            if (stepIdx === 0) return false;

            const root = active.closest('.step-row--display');
            const beforeItem = this._prepareSnapshot();
            const prevStep = this.item.steps[stepIdx - 1];
            const prevText = prevStep.text || '';
            const newText = prevText + '\n' + (active.textContent || '');
            prevStep.text = newText;
            this.item.steps.splice(stepIdx, 1);

            if (root) {
                const prevRow = root.previousElementSibling;
                const prevTextEl = prevRow?.querySelector('.step-text');
                if (prevTextEl) {
                    focusInlineEdit(prevTextEl, 'end');
                }
            }

            if (!this.options.localOnly) {
                commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
            }
            this.options.onChange();
            return true;
        }

        // Let native contenteditable handle character deletion
        return false;
    }

    /**
     * Handle Delete key in checklist step-text.
     */
    _handleChecklistDelete(e) {
        if (!this.item || !this.item.steps) return false;
        const active = document.activeElement;
        if (!active?.classList?.contains('step-text')) return false;

        const stepId = active.dataset.stepId;
        const stepIdx = this.item.steps.findIndex((s) => s.id === stepId);
        if (stepIdx < 0) return false;

        const step = this.item.steps[stepIdx];
        const text = step.text || '';

        if (text.length > 0) {
            active.textContent = text.slice(0, -1);
            syncInlineFieldToItem(active, this.item);
            if (!this.options.localOnly) {
                mutateItem(this.item, () => {}, { preserveView: true, skipRerender: true, localOnly: this.options.localOnly });
            }
            this.options.onChange();
            return true;
        }

        const root = active.closest('.step-row--display');
        const beforeItem = this._prepareSnapshot();
        this.item.steps.splice(stepIdx, 1);
        if (!this.options.localOnly) {
            commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
        }
        this.options.onChange();
        return true;
    }

    /**
     * Insert a new checklist step.
     */
    _insertChecklistStep(afterStepId = null, text = '', completed = false) {
        if (!this.item) return null;
        const beforeItem = this._prepareSnapshot();
        const steps = this.item.steps || [];
        const newStep = {
            id: this._createStepId(),
            text,
            completed,
            level: 0
        };

        if (afterStepId) {
            const idx = steps.findIndex((s) => s.id === afterStepId);
            if (idx >= 0) {
                steps.splice(idx + 1, 0, newStep);
            } else {
                steps.push(newStep);
            }
        } else {
            steps.push(newStep);
        }

        this.item.steps = steps;

        // Surgical DOM insertion
        const newRow = this._insertStepRowInDom(newStep, { afterStepId });

        // Focus the new step's text element
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

        if (!this.options.localOnly) {
            commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
        }
        this.options.onChange();
        return newStep.id;
    }

    /**
     * Remove a checklist step and return the focus target.
     */
    _removeChecklistStep(stepId) {
        if (!this.item || !this.item.steps) return null;
        const beforeItem = this._prepareSnapshot();
        const idx = this.item.steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return null;

        const prevStep = this.item.steps[idx - 1];
        const nextStep = this.item.steps[idx + 1];
        this.item.steps.splice(idx, 1);

        if (!this.options.localOnly) {
            commitInlineChecklistOp(this.item, beforeItem, { localOnly: this.options.localOnly });
        }
        this.options.onChange();

        return prevStep?.id || nextStep?.id || null;
    }

    /**
     * Check if a checklist group is collapsed.
     */
    _isChecklistGroupCollapsed(stepId) {
        const collapsed = this._getCachedCollapsedKeys();
        return !!collapsed[`${this.item.id}:${stepId}`];
    }

    /**
     * Expand ancestors for a step.
     */
    _expandChecklistAncestorsForStep(stepId) {
        if (!this.item?.id || !this.item.steps) return;
        const collapsed = this._getCachedCollapsedKeys();
        const step = this.item.steps.find((s) => s.id === stepId);
        if (!step) return;

        const level = getStepLevel(step);
        for (let i = 0; i < level; i++) {
            const ancestorKey = `${this.item.id}:ancestor_${i}`;
            delete collapsed[ancestorKey];
        }
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
    }

    /**
     * Create a unique step ID.
     */
    _createStepId() {
        return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Toggle expand/collapse all checklist groups.
     */
    _toggleChecklistExpandCollapseAll() {
        const collapsed = this._getCachedCollapsedKeys();
        const collapsibleKeys = this._getChecklistCollapsibleKeys();
        const anyExpanded = collapsibleKeys.some((key) => !collapsed[key]);

        if (anyExpanded) {
            collapsibleKeys.forEach((key) => {
                collapsed[key] = true;
            });
        } else {
            collapsibleKeys.forEach((key) => {
                delete collapsed[key];
            });
        }
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
    }

    /**
     * Get collapsible keys for the current item.
     */
    _getChecklistCollapsibleKeys() {
        if (!this.item?.id) return [];
        const { active } = partitionChecklistSteps(this.item.steps || []);
        const keys = [];
        active.forEach((step, index) => {
            if (!stepHasDescendants(active, index)) return;
            keys.push(`${this.item.id}:${step.id}`);
        });
        return keys;
    }

    /**
     * Toggle done section visibility.
     */
    _toggleChecklistDoneSection() {
        const collapsed = this._getCachedDoneCollapsed();
        collapsed[this.item.id] = !collapsed[this.item.id];
        if (!collapsed[this.item.id]) delete collapsed[this.item.id];
        localStorage.setItem('matrix_checklist_done_collapsed', JSON.stringify(collapsed));
    }

    /**
     * Destroy the controller and clean up event listeners.
     */
    destroy() {
        // Clean up click handlers
        if (this._boundChangeHandler) {
            this.container.removeEventListener('change', this._boundChangeHandler);
            this._boundChangeHandler = null;
        }
        if (this._boundClickHandler) {
            this.container.removeEventListener('click', this._boundClickHandler);
            this._boundClickHandler = null;
        }

        // Clean up keydown handlers
        if (this._boundKeydownHandler) {
            this.container.removeEventListener('keydown', this._boundKeydownHandler);
            this._boundKeydownHandler = null;
        }
        if (this._boundArrowKeyHandler) {
            this.container.removeEventListener('keydown', this._boundArrowKeyHandler);
            this._boundArrowKeyHandler = null;
        }
        if (this._boundTabHandler) {
            this.container.removeEventListener('keydown', this._boundTabHandler);
            this._boundTabHandler = null;
        }

        // Clean up pointerdown handler
        if (this._boundPointerdownHandler) {
            this.container.removeEventListener('pointerdown', this._boundPointerdownHandler);
            this._boundPointerdownHandler = null;
        }

        // Clean up drag listeners if any
        if (this.container._checklistDragData) {
            const { onMove, onUp } = this.container._checklistDragData;
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.body.classList.remove('is-checklist-dragging');
            delete this.container._checklistDragData;
        }

        // Remove controller reference
        if (this.container._checklistController === this) {
            delete this.container._checklistController;
        }

        this.boundItemId = null;
    }
}

// Re-exported functions for backward compatibility
export function createStepId() {
    return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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
    const { active } = partitionChecklistSteps(item.steps || []);
    const keys = [];
    active.forEach((step, index) => {
        if (!stepHasDescendants(active, index)) return;
        keys.push(`${item.id}:${step.id}`);
    });
    return keys;
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

function isCollapsedGroupRow(row, collapsedKeys) {
    const itemId = row.dataset.itemId;
    const stepId = row.dataset.stepId;
    if (!itemId || !stepId) return false;
    const key = `${itemId}:${stepId}`;
    return !!collapsedKeys[key];
}

/**
 * Check if target is a checklist interaction element.
 * Used by dragdrop.js to determine if click should be handled by checklist.
 */
export function isChecklistInteraction(target) {
    if (!target) return false;
    return !!target.closest(
        '.step-check, .step-delete-btn, .step-collapse-btn, .grab-handle--step, ' +
        '.step-nest-controls, .step-row-actions, .expanded-checklist-add-btn, ' +
        '.checklist-expand-collapse-all-btn, .step-text, .checklist-done-toggle'
    );
}

// Re-export buildChecklistRowHtml for backward compatibility
export { buildChecklistRowHtml, buildChecklistExpandCollapseAllHtml } from './checklistHtml.js';

// Legacy wrapper functions for backward compatibility
export function bindChecklistInteractions(root, item, options = {}) {
    return new ChecklistController(root, item, options);
}

export function attachChecklistDrag(root, item, options = {}) {
    // The controller already handles drag binding in its constructor
    // This is just a wrapper for backward compatibility
    const controller = new ChecklistController(root, item, options);
    return controller;
}

export function insertChecklistStep(root, item, options = {}) {
    const controller = new ChecklistController(root, item, options);
    return controller._insertChecklistStep(options.afterStepId, options.text, options.completed);
}

export function removeChecklistStepAndFocus(root, item, stepId, options = {}) {
    const controller = new ChecklistController(root, item, options);
    const focusStepId = controller._removeChecklistStep(stepId);
    if (focusStepId) {
        setPendingChecklistFocus(root, focusStepId, 'end');
    }
    return focusStepId;
}

export function handleChecklistEnter(root, item, e, options = {}) {
    const controller = new ChecklistController(root, item, options);
    return controller._handleChecklistEnter(e);
}

export function handleChecklistBackspace(e, item, options = {}) {
    const controller = new ChecklistController(null, item, options);
    return controller._handleChecklistBackspace(e);
}

export function handleChecklistDelete(e, item, options = {}) {
    const controller = new ChecklistController(null, item, options);
    return controller._handleChecklistDelete(e);
}

function setPendingChecklistFocus(root, stepId, edge = 'start') {
    if (!root || !stepId) return;
    root.dataset.pendingFocusStepId = stepId;
    root.dataset.pendingFocusEdge = edge;
}