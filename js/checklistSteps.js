/** @module {"owns":"checklist tree logic, step reorder, indent/outdent", "related":["noteSurface.js","noteBodyConversion.js"]} */
import { unwrapLineStrike, wrapLineAsStruck } from './noteBodyConversion.js';

export function getStepLevel(step) {
    const n = Number(step?.level);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(4, Math.floor(n));
}

export function partitionChecklistSteps(steps) {
    const active = [];
    const done = [];
    (steps || []).forEach(step => {
        if (step.completed) done.push(step);
        else active.push(step);
    });
    return { active, done };
}

export function reorderStepsByCompletion(steps) {
    if (!steps?.length) return;
    const { active, done } = partitionChecklistSteps(steps);
    steps.splice(0, steps.length, ...active, ...done);
}

export function moveStepOnCompletionChange(steps, step, completed) {
    step.completed = completed;
    if (completed) {
        step.text = wrapLineAsStruck(step.text || '');
    } else {
        step.text = unwrapLineStrike(step.text || '');
    }
    reorderStepsByCompletion(steps);
}

export function collectStepSubtree(steps, startIndex) {
    if (!steps?.length || startIndex < 0 || startIndex >= steps.length) return [];
    const rootLevel = getStepLevel(steps[startIndex]);
    const subtree = [steps[startIndex]];
    for (let i = startIndex + 1; i < steps.length; i++) {
        if (getStepLevel(steps[i]) <= rootLevel) break;
        subtree.push(steps[i]);
    }
    return subtree;
}

export function collectStepSubtreeIds(steps, startIndex) {
    return collectStepSubtree(steps, startIndex).map((step) => step.id);
}

export function findStepParentIndex(steps, index) {
    const level = getStepLevel(steps[index]);
    if (level <= 0) return -1;
    for (let i = index - 1; i >= 0; i--) {
        if (getStepLevel(steps[i]) < level) return i;
    }
    return -1;
}

export function applySubtreeLevelDelta(steps, startIndex, delta) {
    const subtree = collectStepSubtree(steps, startIndex);
    if (!subtree.length || !delta) return;
    const rootLevel = getStepLevel(subtree[0]);
    let effectiveDelta = delta;
    if (delta < 0 && rootLevel + delta < 0) {
        effectiveDelta = -rootLevel;
    }
    for (const step of subtree) {
        step.level = Math.max(0, Math.min(4, getStepLevel(step) + effectiveDelta));
    }
}

export function normalizeChecklistLevels(steps) {
    if (!steps?.length) return;
    for (let i = 0; i < steps.length; i++) {
        const maxLevel = i === 0 ? 0 : getStepLevel(steps[i - 1]) + 1;
        const current = getStepLevel(steps[i]);
        steps[i].level = Math.max(0, Math.min(4, Math.min(current, maxLevel)));
    }
}

export function canIndentStep(steps, idx) {
    if (!steps?.[idx]) return false;
    const level = getStepLevel(steps[idx]);
    if (level >= 4) return false;
    const maxFromPrev = idx === 0 ? 0 : getStepLevel(steps[idx - 1]) + 1;
    return level + 1 <= maxFromPrev;
}

export function previewDropTargetLevel(rows, insertIndex, dropMode, getLevel = getStepRowLevel) {
    if (insertIndex <= 0) return 0;
    if (dropMode === 'child') {
        const parent = rows[insertIndex - 1];
        return parent ? Math.min(4, getLevel(parent) + 1) : 0;
    }
    const next = rows[insertIndex];
    if (next) return getLevel(next);
    const prev = rows[insertIndex - 1];
    return prev ? getLevel(prev) : 0;
}

export function resolveDropTarget(steps, blockRootId, { mode = 'sibling' } = {}) {
    const blockStartIndex = steps.findIndex((step) => step.id === blockRootId);
    if (blockStartIndex < 0) return null;
    const subtree = collectStepSubtree(steps, blockStartIndex);
    const oldRootLevel = getStepLevel(subtree[0]);
    let newRootLevel = oldRootLevel;

    if (mode === 'child' && blockStartIndex > 0) {
        const parent = steps[blockStartIndex - 1];
        newRootLevel = Math.min(4, getStepLevel(parent) + 1);
    } else if (blockStartIndex === 0) {
        newRootLevel = 0;
    } else {
        const nextIndex = blockStartIndex + subtree.length;
        newRootLevel = nextIndex < steps.length
            ? getStepLevel(steps[nextIndex])
            : getStepLevel(steps[blockStartIndex - 1]);
    }

    const delta = newRootLevel - oldRootLevel;
    if (delta) applySubtreeLevelDelta(steps, blockStartIndex, delta);

    const parentId = mode === 'child' && blockStartIndex > 0
        ? steps[blockStartIndex - 1].id
        : null;
    return { parentId };
}

export function computeChecklistInsertBounds(steps, startIndex) {
    const blockLevel = getStepLevel(steps[startIndex]);
    const subtree = collectStepSubtree(steps, startIndex);
    const parentIdx = findStepParentIndex(steps, startIndex);

    let minIndex = 0;
    if (parentIdx >= 0) minIndex = parentIdx + 1;

    let maxIndex = steps.length;
    for (let i = startIndex + subtree.length; i < steps.length; i++) {
        if (getStepLevel(steps[i]) < blockLevel) {
            maxIndex = i;
            break;
        }
    }

    return { minIndex, maxIndex, blockLevel, subtreeIds: subtree.map((step) => step.id) };
}

export function computeVisibleInsertBounds(activeSteps, startIndex, visibleIds, blockIds) {
    const { minIndex, maxIndex, subtreeIds } = computeChecklistInsertBounds(activeSteps, startIndex);
    const blockIdSet = new Set(blockIds || subtreeIds);
    const others = visibleIds.filter((id) => !blockIdSet.has(id));

    let minAmongOthers = 0;
    if (minIndex > 0) {
        const parentId = activeSteps[minIndex - 1]?.id;
        const parentPos = others.indexOf(parentId);
        minAmongOthers = parentPos >= 0 ? parentPos + 1 : 0;
    }

    let maxAmongOthers = others.length;
    if (maxIndex < activeSteps.length) {
        const boundaryId = activeSteps[maxIndex]?.id;
        const boundaryPos = others.indexOf(boundaryId);
        maxAmongOthers = boundaryPos >= 0 ? boundaryPos : others.length;
    }

    return { minAmongOthers, maxAmongOthers, subtreeIds: subtreeIds || [...blockIdSet], others };
}

export function resolvePointerDropTarget(clientY, visibleRows, blockRows, { bounds = null, isSingleLeaf = false } = {}) {
    const blockSet = new Set(blockRows);
    const others = visibleRows.filter((row) => !blockSet.has(row));
    let insertIndex = others.length;
    let dropMode = 'sibling';

    for (let i = 0; i < others.length; i++) {
        const box = others[i].getBoundingClientRect();
        const midY = box.top + box.height / 2;

        if (clientY < box.top) {
            insertIndex = i;
            if (i > 0 && getStepRowLevel(others[i - 1]) < getStepRowLevel(others[i])) {
                dropMode = 'child';
            } else {
                dropMode = 'sibling';
            }
            break;
        }
        if (clientY <= midY) {
            insertIndex = i;
            dropMode = 'sibling';
            break;
        }
        if (clientY <= box.bottom) {
            insertIndex = i + 1;
            dropMode = 'child';
            break;
        }
    }

    if (bounds && !isSingleLeaf) {
        insertIndex = Math.max(bounds.minAmongOthers, Math.min(bounds.maxAmongOthers, insertIndex));
        if (dropMode === 'child' && insertIndex > 0 && insertIndex <= others.length) {
            const parentRow = others[insertIndex - 1];
            if (!parentRow) dropMode = 'sibling';
        }
    }

    const targetLevel = previewDropTargetLevel(others, insertIndex, dropMode);
    return { insertIndex, dropMode, others, targetLevel };
}

export function getStepRowLevel(row) {
    const n = Number(row?.dataset?.level);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(4, Math.floor(n));
}

export function collectDomRowBlock(rows, row) {
    const idx = rows.indexOf(row);
    if (idx < 0) return [row];
    const level = getStepRowLevel(row);
    const block = [row];
    for (let i = idx + 1; i < rows.length; i++) {
        if (getStepRowLevel(rows[i]) <= level) break;
        block.push(rows[i]);
    }
    return block;
}

function findParentRowIndex(rows, rowIndex) {
    const level = getStepRowLevel(rows[rowIndex]);
    if (level <= 0) return -1;
    for (let i = rowIndex - 1; i >= 0; i--) {
        if (getStepRowLevel(rows[i]) < level) return i;
    }
    return -1;
}

export function clampChecklistInsertIndex(allRows, block, insertIndexInOthers, bounds = null) {
    if (bounds) {
        return Math.max(bounds.minAmongOthers, Math.min(bounds.maxAmongOthers, insertIndexInOthers));
    }

    const others = allRows.filter((row) => !block.includes(row));
    const firstIdx = allRows.indexOf(block[0]);
    if (firstIdx < 0) return insertIndexInOthers;

    const blockLevel = getStepRowLevel(block[0]);
    const parentIdx = findParentRowIndex(allRows, firstIdx);
    let minIndex = 0;
    if (parentIdx >= 0) {
        const parentRow = allRows[parentIdx];
        const parentInOthers = others.indexOf(parentRow);
        minIndex = parentInOthers >= 0 ? parentInOthers + 1 : 0;
    }

    let maxIndex = others.length;
    for (let i = firstIdx + block.length; i < allRows.length; i++) {
        if (getStepRowLevel(allRows[i]) < blockLevel) {
            const boundaryInOthers = others.indexOf(allRows[i]);
            maxIndex = boundaryInOthers >= 0 ? boundaryInOthers : others.length;
            break;
        }
    }

    return Math.max(minIndex, Math.min(maxIndex, insertIndexInOthers));
}

export function reorderActiveStepsFromDomOrder(activeSteps, visibleOrderIds, itemId, collapsedKeys = {}) {
    const stepById = new Map(activeSteps.map((step) => [step.id, step]));
    const visibleSet = new Set(visibleOrderIds);
    const placed = new Set();
    const result = [];

    for (const id of visibleOrderIds) {
        const step = stepById.get(id);
        if (!step || placed.has(id)) continue;
        result.push(step);
        placed.add(id);

        const idx = activeSteps.findIndex((s) => s.id === id);
        const collapseKey = `${itemId}:${id}`;
        if (idx < 0 || !collapsedKeys[collapseKey] || !stepHasDescendants(activeSteps, idx)) continue;

        const rootLevel = getStepLevel(step);
        for (let i = idx + 1; i < activeSteps.length; i++) {
            const child = activeSteps[i];
            const level = getStepLevel(child);
            if (level <= rootLevel) break;
            if (visibleSet.has(child.id) || placed.has(child.id)) continue;
            result.push(child);
            placed.add(child.id);
        }
    }

    for (const step of activeSteps) {
        if (!placed.has(step.id)) result.push(step);
    }

    return result;
}

export function stepHasDescendants(steps, index) {
    const level = getStepLevel(steps[index]);
    for (let i = index + 1; i < steps.length; i++) {
        const nextLevel = getStepLevel(steps[i]);
        if (nextLevel <= level) return false;
        if (nextLevel > level) return true;
    }
    return false;
}

export function levelListHasDescendants(levels, index) {
    const level = levels[index];
    for (let i = index + 1; i < levels.length; i++) {
        if (levels[i] <= level) return false;
        if (levels[i] > level) return true;
    }
    return false;
}

export function checklistHasIndentations(steps) {
    return (steps || []).some((step) => getStepLevel(step) > 0);
}

export function buildVisibleChecklistSteps(steps, itemId, collapsedKeys = {}) {
    const visible = [];
    let suppressBelow = -1;

    (steps || []).forEach((step, index) => {
        const level = getStepLevel(step);
        if (suppressBelow >= 0 && level > suppressBelow) return;

        suppressBelow = -1;
        const hasKids = stepHasDescendants(steps, index);
        const collapseKey = `${itemId}:${step.id}`;
        const isCollapsed = !!collapsedKeys[collapseKey];

        visible.push({ step, hasKids, isCollapsed, collapseKey });
        if (hasKids && isCollapsed) suppressBelow = level;
    });

    return visible;
}

export function annotateChecklistTreeGuides(visibleRows) {
    return (visibleRows || []).map((row, i) => {
        const level = getStepLevel(row.step);
        const treeGuides = [];
        if (level > 0) {
            const prevLevel = i > 0 ? getStepLevel(visibleRows[i - 1].step) : -1;
            const nextLevel = i < visibleRows.length - 1
                ? getStepLevel(visibleRows[i + 1].step)
                : -1;
            const isFirst = prevLevel < level;
            const isLast = nextLevel < level;
            let branchRole;
            if (isFirst && isLast) branchRole = 'solo';
            else if (isFirst) branchRole = 'start';
            else if (isLast) branchRole = 'end';
            else branchRole = 'mid';

            for (let d = 0; d < level; d++) {
                if (d < level - 1) {
                    let show = false;
                    for (let j = i + 1; j < visibleRows.length; j++) {
                        if (getStepLevel(visibleRows[j].step) > d) {
                            show = true;
                            break;
                        }
                    }
                    treeGuides.push({ role: show ? 'through' : null });
                } else {
                    treeGuides.push({ role: branchRole });
                }
            }
        }
        return { ...row, treeGuides };
    });
}
