/** @module {"owns":"checklist operations, drag/drop, state management", "related":["noteSurface.js","checklistSteps.js","noteBodyConversion.js","richText.js"], "events":[]} */
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants, collectStepSubtree, canIndentStep, normalizeChecklistLevels, computeVisibleInsertBounds, reorderActiveStepsFromDomOrder, applySubtreeLevelDelta, resolvePointerDropTarget, resolveDropTarget } from './checklistSteps.js';
import { contentHasConvertibleText, stepsHaveConvertibleText } from './noteBodyConversion.js';
import { stripRichText, sanitizeRichHtml, hasRichMarkup } from './richText.js';
import { mutateItem, syncItemBodyFromDom, syncInlineFieldToItem } from './noteSurfaceMutations.js';
import { focusInlineEdit, canInlineEditText, renderRichHtml, splitInlineEditAtCaret, insertTextAtCaret, handleInlineEditArrowNav } from './noteSurfaceEditing.js';
import { copyPlainTextToClipboard } from './clipboard.js';


const DRAG_THRESHOLD = 4;

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
    root.addEventListener('change', (e) => {
        const cb = e.target.closest('.step-check');
        if (!cb || !root.contains(cb)) return;
        const row = cb.closest('.step-row--display');
        const stepId = row?.dataset?.stepId;
        if (!stepId) return;
        const step = (item.steps || []).find(s => s.id === stepId);
        if (!step) return;
        const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
        step.completed = cb.checked;
        syncItemBodyFromDom(root, item);
        if (localOnly) {
            onChange();
        } else {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true, localOnly });
            commitInlineChecklistOp(item, beforeItem, { localOnly });
        }
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
            syncItemBodyFromDom(root, item);
            const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
            const stepIdx = item.steps.findIndex((s) => s.id === stepId);
            if (stepIdx < 0) return;
            applySubtreeLevelDelta(item.steps, stepIdx, 1);
            normalizeChecklistLevels(item.steps);
            if (localOnly) onChange();
            else commitInlineChecklistOp(item, beforeItem, { localOnly });
            setPendingChecklistFocus(root, stepId, 'end');
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
            syncItemBodyFromDom(root, item);
            const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
            const stepIdx = item.steps.findIndex((s) => s.id === stepId);
            if (stepIdx < 0) return;
            applySubtreeLevelDelta(item.steps, stepIdx, -1);
            normalizeChecklistLevels(item.steps);
            if (localOnly) onChange();
            else commitInlineChecklistOp(item, beforeItem, { localOnly });
            setPendingChecklistFocus(root, stepId, 'end');
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
        const newStepId = insertChecklistStep(root, item, { localOnly, onChange });
        if (newStepId) setPendingChecklistFocus(root, newStepId, 'start');
        refresh();
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
        if (result) setPendingChecklistFocus(root, result, 'start');
        refresh();
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
        const parent = block[0]?.parentNode;
        if (!parent) return;
        const anchor = getChecklistInsertAnchor();
        const ref = insertIndex < others.length ? others[insertIndex] : null;
        block.forEach((row) => {
            if (ref) parent.insertBefore(row, ref);
            else if (anchor) parent.insertBefore(row, anchor);
            else parent.appendChild(row);
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
        const { block, moved, blockStepIds, dropMode } = activeDrag;
        const blockRootId = blockStepIds[0];
        block.forEach((r) => r.classList.remove('is-dragging'));
        hideDropIndicator();
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
            const shell = root.closest('.editor-note-shell') || root;
            syncItemBodyFromDom(shell, item);
            const collapsedKeys = getChecklistCollapsedKeys();
            const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
            let parentIdToExpand = null;
            applyMutate((it) => {
                const activeSteps = it.steps.filter((step) => !step.completed);
                const doneSteps = it.steps.filter((step) => step.completed);
                const visibleOrderIds = getActiveRows().map((r) => r.dataset.stepId);
                const reordered = reorderActiveStepsFromDomOrder(
                    activeSteps,
                    visibleOrderIds,
                    item.id,
                    collapsedKeys
                );
                const dropResult = resolveDropTarget(reordered, blockRootId, { mode: dropMode || 'sibling' });
                parentIdToExpand = dropResult?.parentId || null;
                normalizeChecklistLevels(reordered);
                it.steps = [...reordered, ...doneSteps];
            }, { persist: false });
            expandChecklistAncestorsForStep(item, blockRootId);
            if (parentIdToExpand) {
                expandChecklistAncestorsForStep(item, parentIdToExpand);
            }
            setPendingChecklistFocus(root, blockRootId, 'end');
            refresh();
            commitInlineChecklistOp(item, beforeItem, { localOnly });
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

        const rows = getActiveRows();
        const { block, bounds, isSingleLeaf } = activeDrag;
        const { insertIndex, dropMode, others } = resolvePointerDropTarget(
            e.clientY,
            rows,
            block,
            { bounds, isSingleLeaf }
        );

        activeDrag.dropMode = dropMode;
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

    // Attach mousedown handler for grab-handle to initiate drag
    root.addEventListener('mousedown', (e) => {
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

        const visibleIds = getActiveRows().map((r) => r.dataset.stepId);
        const { subtreeIds, minAmongOthers, maxAmongOthers } = computeVisibleInsertBounds(
            activeSteps,
            stepIndex,
            visibleIds
        );
        const isSingleLeaf = subtreeIds.length === 1
            || !stepHasDescendants(activeSteps, stepIndex);
        const rows = getActiveRows();
        const block = buildDomBlockFromIds(rows, subtreeIds);
        const othersCount = visibleIds.filter((id) => !subtreeIds.includes(id)).length;

        activeDrag = {
            row,
            block,
            blockStepIds: subtreeIds,
            isSingleLeaf,
            bounds: isSingleLeaf
                ? { minAmongOthers: 0, maxAmongOthers: othersCount }
                : { minAmongOthers, maxAmongOthers },
            dropMode: 'sibling',
            lastInsertIndex: -1,
            startX: e.clientX,
            startY: e.clientY,
            moved: false
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, true);
}

export function getActiveRows() {
    const collapsed = getChecklistCollapsedKeys();
    const doneCollapsed = getChecklistDoneCollapsed();
    const rows = [];
    const allRows = document.querySelectorAll('.step-row--display');
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

export function buildChecklistExpandCollapseAllHtml(item) {
    if (!item?.id || !checklistHasIndentations(item.steps)) return '';
    if (getChecklistCollapsedKeys().length === 0) return '';
    const anyExpanded = getChecklistCollapsibleKeys(item).some((key) => !getChecklistCollapsedKeys()[key]);
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
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const steps = item.steps || [];
    const newStep = {
        id: createStepId(),
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

    item.steps = steps;
    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true, localOnly });
        commitInlineChecklistOp(item, beforeItem, { localOnly });
    }
    onChange();
    return newStep.id;
}

export function removeChecklistStepAndFocus(root, item, stepId, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return null;
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const idx = item.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return null;

    const prevStep = item.steps[idx - 1];
    const nextStep = item.steps[idx + 1];
    item.steps.splice(idx, 1);

    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true, localOnly });
        commitInlineChecklistOp(item, beforeItem, { localOnly });
    }
    onChange();

    return prevStep?.id || nextStep?.id || null;
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
        syncStepTextToItem(active, item);
        if (!localOnly) {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
        onChange();
        return true;
    }

    if (stepIdx === 0) return false;

    const root = active.closest('.step-row--display');
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const prevStep = item.steps[stepIdx - 1];
    const prevText = prevStep.text || '';
    const newText = prevText + '\n' + text;
    prevStep.text = newText;
    item.steps.splice(stepIdx, 1);

    if (root) {
        const prevRow = root.previousElementSibling;
        const prevTextEl = prevRow?.querySelector('.step-text');
        if (prevTextEl) {
            focusInlineEdit(prevTextEl, 'end');
        }
    }

    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true, localOnly });
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
        syncStepTextToItem(active, item);
        if (!localOnly) {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
        onChange();
        return true;
    }

    const root = active.closest('.step-row--display');
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    item.steps.splice(stepIdx, 1);
    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true, localOnly });
        commitInlineChecklistOp(item, beforeItem, { localOnly });
    }
    onChange();
    return true;
}

export function handleChecklistEnter(root, item, e, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return false;
    const active = e.target;
    if (!active?.classList?.contains('step-text')) return false;

    const stepId = active.dataset.stepId;
     const stepIdx = item.steps.findIndex((s) => s.id === stepId);
     if (stepIdx < 0) return false;

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

    // Enter: split text at caret position and create a new step with the "after" text
    // Determine the insertion index: if the step has children and the group is collapsed,
    // insert after the entire subtree; otherwise insert right after this step
    const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
    const subtree = collectStepSubtree(item.steps, stepIdx);
    const isCollapsed = isChecklistGroupCollapsed(item.id, stepId);
    const hasChildren = subtree.length > 1;
    const insertIdx = hasChildren && isCollapsed
        ? stepIdx + subtree.length
        : stepIdx + 1;

    // Update current step's text to the "before" portion
    // For rich text, before is already sanitized HTML; for plain text, it's plain text
    const rich = active.classList.contains('rich-text--edit');
    if (rich) {
        active.innerHTML = before;
    } else {
        active.textContent = before;
    }
    syncInlineFieldToItem(active, item);

    // Create new step with the "after" text
    const newStep = {
        id: createStepId(),
        text: after,
        completed: false,
        level: getStepLevel(step)
    };
    item.steps.splice(insertIdx, 0, newStep);

    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true, localOnly });
        commitInlineChecklistOp(item, beforeItem, { localOnly });
    }
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

export function commitInlineChecklistOp(item, beforeItem, { localOnly = false } = {}) {
    if (!item || !beforeItem) return;
    if (localOnly) return;

    const changes = diffChecklistSteps(beforeItem.steps || [], item.steps || []);
    if (changes.length === 0) return;

    const action = changes.length === 1 && changes[0].type === 'remove'
        ? 'delete'
        : 'update';

    const eventDetail = {
        item,
        beforeItem,
        action,
        changes
    };

    window.dispatchEvent(new CustomEvent('item:mutation_requested', { detail: eventDetail }));
}

function diffChecklistSteps(oldSteps, newSteps) {
    const changes = [];
    const oldMap = new Map(oldSteps.map((s, i) => [s.id, { step: s, index: i }]));
    const newMap = new Map(newSteps.map((s, i) => [s.id, { step: s, index: i }]));

    for (const [id, oldInfo] of oldMap) {
        if (!newMap.has(id)) {
            changes.push({ type: 'remove', id, index: oldInfo.index });
        }
    }

    for (const [id, newInfo] of newMap) {
        const oldInfo = oldMap.get(id);
        if (!oldInfo) {
            changes.push({ type: 'add', id, index: newInfo.index });
        } else if (JSON.stringify(oldInfo.step) !== JSON.stringify(newInfo.step)) {
            changes.push({ type: 'update', id, index: newInfo.index });
        }
    }

    return changes;
}

function syncStepTextToItem(el, item) {
    const stepId = el.dataset.stepId;
    const step = item.steps?.find((s) => s.id === stepId);
    if (step) {
        step.text = el.textContent || '';
    }
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
    treeGuides = [],
    canEdit = true,
    richEdit = false,
    active = []
} = {}) {
    const stepLevel = getStepLevel(step);
    const activeIdx = isDoneSection ? -1 : active.findIndex((s) => s.id === step.id);
    const collapseControl = !isDoneSection && hasKids
        ? `<button type="button" class="step-collapse-btn" data-collapse-key="${escapeAttr(collapseKey)}" title="${isCollapsed ? 'Expand group' : 'Collapse group'}" aria-label="${isCollapsed ? 'Expand group' : 'Collapse group'}">${isCollapsed ? CARD_ICONS.chevronRight : CARD_ICONS.chevronDown}</button>`
        : '<span class="step-collapse-spacer" aria-hidden="true"></span>';
    const dragHandle = !canEdit
        ? ''
        : isDoneSection
            ? '<span class="grab-handle grab-handle--step grab-handle--spacer" aria-hidden="true">⋮⋮</span>'
            : '<span class="grab-handle grab-handle--step" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>';
    const nestControls = canEdit ? `
        <button type="button" class="card-act step-outdent-btn" title="Outdent" aria-label="Outdent"${stepLevel === 0 ? ' disabled' : ''}>‹</button>
        <button type="button" class="card-act step-indent-btn" title="Indent" aria-label="Indent"${!canIndentStep(active, activeIdx) ? ' disabled' : ''}>›</button>` : '';
    const copyBtn = canEdit
        ? `<button type="button" class="card-act step-copy-btn" title="Copy item" aria-label="Copy item">${CARD_ICONS.copy}</button>`
        : '';
    const deleteBtn = canEdit
        ? `<button type="button" class="card-act card-act--danger step-delete-btn" title="Remove item" aria-label="Remove item">${CARD_ICONS.close}</button>`
        : '';
    const stepText = step.text || '';
    let textHtml;
    if (canEdit && (richEdit || canInlineEditText(stepText, { richEdit }))) {
        const inner = richEdit ? sanitizeRichHtml(stepText) : escapeHTML(stepText);
        const ce = richEdit ? 'true' : 'plaintext-only';
        const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
        textHtml = `<span class="step-text card-inline-edit${richClasses} ${step.completed ? 'completed' : ''}" contenteditable="${ce}" spellcheck="false" data-field="step-text" data-step-id="${step.id}">${inner}</span>`;
    } else {
        const richClass = hasRichMarkup(stepText) ? ' rich-text' : '';
        textHtml = `<span class="step-text${richClass} ${step.completed ? 'completed' : ''}">${sanitizeRichHtml(stepText)}</span>`;
    }
    const treeGutterHtml = !isDoneSection && treeGuides.length > 0
        ? `<span class="step-tree-gutter" aria-hidden="true">${treeGuides.map(({ role }) => {
            return `<span class="step-tree-guide step-tree-guide--${role}" aria-hidden="true"></span>`;
        }).join('')}</span>`
        : '';
    return `
        <div class="step-row step-row--display${step.completed ? ' step-row--done' : ''}" data-step-id="${step.id}" data-level="${stepLevel}">
            <div class="step-row-leading">
                ${dragHandle}
                ${collapseControl}
                ${treeGutterHtml}
                <input type="checkbox" class="step-check" ${step.completed ? 'checked' : ''}>
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