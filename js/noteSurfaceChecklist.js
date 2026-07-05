/** @module {"owns":"checklist operations, drag/drop, state management", "related":["noteSurface.js","checklistSteps.js","noteBodyConversion.js","richText.js"], "events":[]} */
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { escapeHTML } from './domEscape.js';
import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants } from './checklistSteps.js';
import { reorderActiveStepsFromDomOrder, computeVisibleInsertBounds, resolveDropTarget, normalizeChecklistLevels } from './checklistSteps.js';
import { contentHasConvertibleText, stepsHaveConvertibleText } from './noteBodyConversion.js';
import { stripRichText, sanitizeRichHtml } from './richText.js';
import { mutateItem, syncItemBodyFromDom } from './noteSurfaceMutations.js';
import { focusInlineEdit, canInlineEditText, renderRichHtml } from './noteSurfaceEditing.js';
import { copyPlainTextToClipboard } from './clipboard.js';


const DRAG_THRESHOLD = 4;

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
            removeChecklistStepAndFocus(item, stepId, { localOnly, onChange });
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
            const row = indentBtn.closest('.step-row--display');
            const stepId = row?.dataset?.stepId;
            if (!stepId) return;
            const step = (item.steps || []).find(s => s.id === stepId);
            if (!step) return;
            syncItemBodyFromDom(root, item);
            const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
            step.level = (step.level || 0) + 1;
            normalizeChecklistLevels(item.steps);
            if (localOnly) onChange();
            else commitInlineChecklistOp(item, beforeItem, { localOnly });
            refresh();
            return;
        }

        // --- step outdent ---
        const outdentBtn = e.target.closest('.step-outdent-btn');
        if (outdentBtn && root.contains(outdentBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const row = outdentBtn.closest('.step-row--display');
            const stepId = row?.dataset?.stepId;
            if (!stepId) return;
            const step = (item.steps || []).find(s => s.id === stepId);
            if (!step || (step.level || 0) <= 0) return;
            syncItemBodyFromDom(root, item);
            const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
            step.level = Math.max(0, (step.level || 0) - 1);
            normalizeChecklistLevels(item.steps);
            if (localOnly) onChange();
            else commitInlineChecklistOp(item, beforeItem, { localOnly });
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
        insertChecklistStep(item, { localOnly, onChange });
        refresh();
        return;
    }
    });

    // --- step-text keydown: Enter creates sibling, Shift+Enter creates nested step ---
    root.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const active = e.target;
        if (!active?.classList?.contains('step-text')) return;
        e.preventDefault();
        const beforeItem = prepareInlineOpSnapshot(root, item, localOnly);
        const stepId = active.dataset.stepId;
        if (handleChecklistEnter(e, item, { localOnly, onChange })) {
            if (!localOnly) {
                commitInlineChecklistOp(item, beforeItem, { localOnly });
            }
            // Focus the new step after DOM update
            // The new step is always inserted right after the current step
            const focusNewStep = () => {
                const currentRow = root.querySelector(`[data-step-id="${stepId}"]`)?.closest('.step-row--display');
                if (!currentRow) return;
                const newRow = currentRow.nextElementSibling;
                if (newRow) {
                    const newTextEl = newRow.querySelector('.step-text');
                    if (newTextEl) {
                        focusInlineEdit(newTextEl, 'start');
                    }
                }
            };
            refresh();
            // Use setTimeout to ensure DOM is updated after refresh
            setTimeout(focusNewStep, 0);
        }
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
    const { active: activeSteps } = partitionChecklistSteps(item.steps || []);

    const hideDropIndicator = () => {
        root.querySelectorAll('.checklist-drop-indicator').forEach((el) => el.remove());
    };

    const updateDropIndicator = (activeList, ref, { mode = 'sibling', targetLevel = 0 } = {}) => {
        hideDropIndicator();
        if (!activeList || !ref) return;
        const indicator = document.createElement('div');
        indicator.className = 'checklist-drop-indicator';
        indicator.dataset.dropMode = mode;
        indicator.dataset.targetLevel = targetLevel;
        indicator.style.position = 'absolute';
        indicator.style.left = '0';
        indicator.style.top = `${ref.offsetTop - 2}px`;
        indicator.style.height = `${ref.offsetHeight}px`;
        indicator.style.width = '100%';
        indicator.style.background = 'var(--color-accent-7)';
        indicator.style.height = '2px';
        indicator.style.transform = `scaleY(0.5)`;
        indicator.style.opacity = '0.8';
        indicator.style.transformOrigin = 'top';
        indicator.style.zIndex = '10';
        root.appendChild(indicator);
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

    const syncDomBlock = () => {
        if (!activeDrag) return;
        const { block, blockStepIds } = activeDrag;
        const rows = root.querySelectorAll('.step-row--display');
        rows.forEach((r) => r.classList.remove('is-dragging'));
        block.forEach((r) => r.classList.add('is-dragging'));
    };

    const reorderAt = (clientY) => {
        if (!activeDrag) return;
        const rows = root.querySelectorAll('.step-row--display');
        const ref = [...rows].find((r) => r.offsetTop > clientY);
        if (!ref) return;
        const insertIndex = [...rows].indexOf(ref);
        const { minAmongOthers, maxAmongOthers } = computeVisibleInsertBounds(
            activeSteps,
            insertIndex,
            getActiveRows().map((r) => r.dataset.stepId)
        );
        const isSingleLeaf = activeDrag.isSingleLeaf;
        const dropMode = activeDrag.dropMode;
        const targetLevel = activeDrag.targetLevel;
        updateDropIndicator(activeSteps, ref, { mode: dropMode, targetLevel });
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
            syncDomBlock();
            activeDrag.block.forEach((r) => r.classList.add('is-dragging'));
        }
        e.preventDefault();
        syncDomBlock();
        reorderAt(e.clientY);
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
            insertIndex: 0,
            targetLevel: 0,
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

export function buildVisibleChecklistSteps(steps, itemId, collapsedKeys = {}) {
    if (!steps || !steps.length) return [];
    const result = [];
    for (const step of steps) {
        const key = `${itemId}:${step.id}`;
        if (collapsedKeys[key]) continue;
        result.push({ step, level: getStepLevel(step) });
    }
    return result;
}

export function annotateChecklistTreeGuides(rows) {
    return rows.map(row => {
        const level = row.level;
        const treeGuides = [];
        for (let i = 0; i < level; i++) {
            treeGuides.push({ role: i < level - 1 ? 'parent' : 'child' });
        }
        return { ...row, treeGuides };
    });
}

export function insertChecklistStep(item, {
    afterStepId = null,
    text = '',
    completed = false,
    localOnly = false,
    onChange = () => {}
} = {}) {
    if (!item) return false;
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
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
    }
    onChange();
    return true;
}

export function removeChecklistStepAndFocus(item, stepId, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return false;
    const idx = item.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return false;

    const prevStep = item.steps[idx - 1];
    const nextStep = item.steps[idx + 1];
    item.steps.splice(idx, 1);

    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
    }
    onChange();

    const root = document.querySelector('.editor-note-body') || document.querySelector('.editor-note-shell');
    if (root) {
        const targetId = prevStep?.id || nextStep?.id;
        if (targetId) {
            const target = root.querySelector(`[data-step-id="${targetId}"] .step-text`);
            if (target) {
                focusInlineEdit(target, 'end');
            }
        }
    }
    return true;
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

    const prevStep = item.steps[stepIdx - 1];
    const prevText = prevStep.text || '';
    const newText = prevText + '\n' + text;
    prevStep.text = newText;
    item.steps.splice(stepIdx, 1);

    const root = active.closest('.step-row--display');
    if (root) {
        const prevRow = root.previousElementSibling;
        const prevTextEl = prevRow?.querySelector('.step-text');
        if (prevTextEl) {
            focusInlineEdit(prevTextEl, 'end');
        }
    }

    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
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

    item.steps.splice(stepIdx, 1);
    if (!localOnly) {
        mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
    }
    onChange();
    return true;
}

export function handleChecklistEnter(e, item, { localOnly = false, onChange = () => {} } = {}) {
    if (!item || !item.steps) return false;
    const active = document.activeElement;
    if (!active?.classList?.contains('step-text')) return false;

    const stepId = active.dataset.stepId;
    const stepIdx = item.steps.findIndex((s) => s.id === stepId);
    if (stepIdx < 0) return false;

    const step = item.steps[stepIdx];
    const text = active.textContent || '';

    if (e.shiftKey) {
        // Shift+Enter: create a nested step (level + 1)
        const newStep = {
            id: createStepId(),
            text: '',
            completed: false,
            level: getStepLevel(step) + 1
        };
        item.steps.splice(stepIdx + 1, 0, newStep);

        if (!localOnly) {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
        onChange();
        return true;
    }

    // Enter: create a sibling step (same level)
    insertChecklistStep(item, {
        afterStepId: stepId,
        text: '',
        localOnly,
        onChange
    });
    return true;
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

export function createStepId() {
    return `step_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}