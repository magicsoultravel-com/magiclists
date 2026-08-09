/** @module {"owns":"checklist tree logic, step reorder, indent/outdent", "related":["noteSurface.js","noteBodyConversion.js"]} */

export function getStepLevel(step) {
    return Math.min(4, Math.max(0, Number(step?.level) || 0));
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
    // Preserve each step's authored level (first item may be any level 0-4,
    // and gaps are allowed), only clamping to the valid 0-4 range.
    if (!steps?.length) return;
    for (let i = 0; i < steps.length; i++) {
        steps[i].level = Math.min(4, Math.max(0, getStepLevel(steps[i])));
    }
}

export function canIndentStep(steps, idx) {
    if (!steps?.[idx]) return false;
    // Any item (including the first) may be indented up to level 4, even if
    // that creates a level gap. Grouping is preserved by applySubtreeLevelDelta.
    return getStepLevel(steps[idx]) < 4;
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
        // First item of the whole list may keep any level (0-4) without a parent.
        newRootLevel = oldRootLevel;
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

export function resolvePointerDropTarget(clientY, clientX, visibleRows, blockRows, { bounds = null } = {}) {
    const blockSet = new Set(blockRows);
    const others = visibleRows.filter((row) => !blockSet.has(row));
    let insertIndex = others.length;

    for (let i = 0; i < others.length; i++) {
        const box = others[i].getBoundingClientRect();
        const midY = box.top + box.height / 2;

        if (clientY < box.top) {
            insertIndex = i;
            break;
        }
        if (clientY <= midY) {
            insertIndex = i;
            break;
        }
        if (clientY <= box.bottom) {
            insertIndex = i + 1;
            break;
        }
    }

    // Clamp insert index within valid bounds to prevent dropping into indented groups
    if (bounds) {
        insertIndex = Math.max(bounds.minAmongOthers, Math.min(bounds.maxAmongOthers, insertIndex));
    }

    // Determine the anchor row (the row the pointer is vertically over). When the
    // pointer is below every row there is no anchor, so only a sibling drop applies.
    let anchorIndex = null;
    for (let i = 0; i < others.length; i++) {
        const box = others[i].getBoundingClientRect();
        if (clientY <= box.bottom) {
            anchorIndex = i;
            break;
        }
    }
    const anchorRow = anchorIndex !== null ? others[anchorIndex] : null;

    // Drop mode: left half of the anchor row = sibling (reorder at the same level),
    // right half = child (indent under the anchor row as its new parent).
    let dropMode = 'sibling';
    if (anchorRow && Number.isFinite(clientX)) {
        const box = anchorRow.getBoundingClientRect();
        if (clientX > box.left + box.width / 2) dropMode = 'child';
    }

    // A child cannot be created under a parent already at the max level (4) — its
    // child would exceed the cap. Fall back to a sibling drop to keep the tree intact.
    if (dropMode === 'child' && anchorRow && getStepRowLevel(anchorRow) >= 4) {
        dropMode = 'sibling';
    }

    // Child drop inserts the block immediately after its new parent (i.e. as the
    // parent's first child), always at least one row after the anchor.
    if (dropMode === 'child' && anchorIndex !== null && insertIndex <= anchorIndex) {
        insertIndex = anchorIndex + 1;
    }
    if (bounds && dropMode === 'child') {
        insertIndex = Math.max(bounds.minAmongOthers, Math.min(bounds.maxAmongOthers, insertIndex));
    }

    const targetLevel = previewDropTargetLevel(others, insertIndex, dropMode);
    return { insertIndex, dropMode, anchorRow, targetLevel, others };
}

export function getStepRowLevel(row) {
    const n = Number(row?.dataset?.level);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.min(4, Math.floor(n));
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
    const rows = visibleRows || [];
    if (rows.length === 0) return rows;
    
    // Pre-compute levels array for O(1) access
    const levels = rows.map((row) => getStepLevel(row.step));
    
    // O(N) backward pass: compute max level below each row
    // This replaces the O(N²) nested loop with a single backward traversal
    const maxLevelBelow = new Array(rows.length).fill(0);
    let runningMax = 0;
    
    for (let i = rows.length - 1; i >= 0; i--) {
        maxLevelBelow[i] = runningMax;
        runningMax = Math.max(runningMax, levels[i]);
    }
    
    // Forward pass: build tree guides using pre-computed max levels
    return rows.map((row, i) => {
        const level = levels[i];
        const treeGuides = [];
        
        if (level > 0) {
            const prevLevel = i > 0 ? levels[i - 1] : -1;
            const nextLevel = i < rows.length - 1 ? levels[i + 1] : -1;
            const isFirst = prevLevel < level;
            const isLast = nextLevel < level;
            let branchRole;
            if (isFirst && isLast) branchRole = 'solo';
            else if (isFirst) branchRole = 'start';
            else if (isLast) branchRole = 'end';
            else branchRole = 'mid';

            for (let d = 0; d < level; d++) {
                if (d < level - 1) {
                    // Check if any row below has a level greater than d
                    // maxLevelBelow[i] tells us the maximum level in rows below
                    const show = maxLevelBelow[i] > d;
                    treeGuides.push({ role: show ? 'through' : null });
                } else {
                    treeGuides.push({ role: branchRole });
                }
            }
        }
        return { ...row, treeGuides };
    });
}

/**
 * Build the ordered list of rows to render in the Completed section.
 *
 * Completed steps keep their authored order. When a completed step's parent
 * (nearest preceding step with a strictly lower level) is still open, a derived
 * "ghost" of that parent is emitted in the parent's original position so the
 * completed children stay visually grouped under a parent header. When the
 * parent itself is later completed the ghost is naturally replaced by the real
 * completed row (they are "joined" in the same parent-child group). Ghosts are
 * only rendering hints — they are never written back into item.steps.
 *
 * @param {Array} steps - full flat step array
 * @param {string} itemId - checklist owner id (collapse-key namespace)
 * @param {Object} collapsedKeys - row collapse state map (shared with the active section)
 * @returns {Array<{step:Object, isGhost:boolean, hasKids:boolean, isCollapsed:boolean, collapseKey:string}>}
 *     rows ready for annotateChecklistTreeGuides(); `isGhost` marks the synthetic
 *     placeholders. Ghosts intentionally carry no data-step-id at render time so
 *     DOM scanners keyed on step ids (drag, editing, inline sync) ignore them.
 */
export function buildCompletedChecklistRows(steps, itemId, collapsedKeys = {}) {
    const list = Array.isArray(steps) ? steps : [];
    const doneIds = new Set();
    for (const s of list) if (s?.completed) doneIds.add(s.id);

    const ghostIds = computeGhostStepIds(list, doneIds);
    const view = [];
    for (const step of list) {
        if (doneIds.has(step.id) || ghostIds.has(step.id)) view.push(step);
    }

    return buildVisibleChecklistSteps(view, itemId, collapsedKeys)
        .map((row) => ({ ...row, isGhost: ghostIds.has(row.step.id) }));
}

/**
 * Collect the ids of every open (not completed) step that must be rendered as a
 * ghost so completed descendants keep their parent context: for each completed
 * step with level > 0, walk up its ancestor chain (nearest preceding lower-level
 * steps) and add every ancestor that is still open; stop at the first ancestor
 * that is itself completed (its real row already appears in the Completed
 * section).
 * @param {Array} steps - full flat step array
 * @param {Set<string>} doneIds - ids of completed steps
 * @returns {Set<string>}
 */
function computeGhostStepIds(steps, doneIds) {
    const ghosts = new Set();
    if (!doneIds.size) return ghosts;

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (!doneIds.has(step.id)) continue;
        let level = getStepLevel(step);
        for (let j = i - 1; j >= 0 && level > 0; j--) {
            const pLevel = getStepLevel(steps[j]);
            if (pLevel >= level) continue;
            if (doneIds.has(steps[j].id)) break; // real completed parent nests this child
            ghosts.add(steps[j].id);
            level = pLevel; // keep walking up through open ancestors
        }
    }
    return ghosts;
}

// ─────────────────────────────────────────────────────────────────────────────
// H3-B: explicit parentId + order position model
//
// level stays the authored visual indent (gap-tolerant, first item may be any
// level 0-4 — never derived). parentId records the structural parent: the
// nearest PRECEDING step with a strictly lower level (identical to
// findStepParentIndex semantics), or null when no such step exists. order is a
// global 0..n-1 sequence index. Every mutation below refreshes position
// metadata via refreshStepsPosition so parentId/order can never drift from the
// real state — the model is the single source of truth.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute parentId for every step: nearest preceding step with a strictly lower
 * level (gap-tolerant, same rule as findStepParentIndex). O(n) single pass via
 * a monotonic ancestor stack.
 * @param {Array} steps - flat step array
 * @returns {Map<string, string|null>}
 */
export function computeStepParentIds(steps) {
    const parentIds = new Map();
    const stack = [];
    (steps || []).forEach((step) => {
        if (!step || typeof step !== 'object' || !step.id) return;
        const level = getStepLevel(step);
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        parentIds.set(step.id, stack.length ? stack[stack.length - 1].id : null);
        stack.push({ level, id: step.id });
    });
    return parentIds;
}

/**
 * Renumber `order` (0..n-1) and refresh `parentId` from level ordering, in
 * place. Called by every mutation so the position metadata is always current.
 */
export function refreshStepsPosition(steps) {
    if (!Array.isArray(steps)) return steps;
    const parentIds = computeStepParentIds(steps);
    steps.forEach((step, i) => {
        if (!step || typeof step !== 'object') return;
        step.order = i;
        step.parentId = parentIds.get(step.id) ?? null;
    });
    return steps;
}

/** Non-mutating canonical projection: returns a NEW array with parentId/order. */
export function stepsToParentOrder(steps) {
    if (!Array.isArray(steps)) return [];
    const next = steps.map((step) => (step && typeof step === 'object' ? { ...step } : step));
    return refreshStepsPosition(next);
}

/** Reconstruct canonical array order from `order` (falls back to array order). */
export function stepsFromParentOrder(steps) {
    if (!Array.isArray(steps)) return [];
    const ordered = [...steps].sort((a, b) => {
        const oa = Number.isInteger(a?.order) ? a.order : Infinity;
        const ob = Number.isInteger(b?.order) ? b.order : Infinity;
        return (oa - ob) || 0;
    });
    return refreshStepsPosition(ordered);
}

/**
 * Non-destructive repair mirroring ensureStepIds/ensureStepLevels. Fills missing
 * parentId/order and canonicalizes stale ones. Never rewrites ids/text/levels.
 * @returns {{ steps: Array, added: number }}
 */
export function ensureStepsParentOrder(steps) {
    if (!Array.isArray(steps)) return { steps: [], added: 0 };
    const parentIds = computeStepParentIds(steps);
    let added = 0;
    const next = steps.map((step, i) => {
        if (!step || typeof step !== 'object') return step;
        const canonicalParent = parentIds.get(step.id) ?? null;
        const hasOrder = Number.isInteger(step.order) && step.order >= 0;
        const hasParent = step.parentId === canonicalParent;
        if (hasOrder && hasParent) return step;
        added += 1;
        return { ...step, order: hasOrder ? step.order : i, parentId: canonicalParent };
    });
    return { steps: next, added };
}

/**
 * Collect invariant violations for the position model. Used by unit + fuzz tests.
 * @returns {Array<string>} empty when all invariants hold
 */
export function assertStepsInvariants(steps) {
    if (!Array.isArray(steps)) return ['steps is not an array'];
    const issues = [];
    const canonical = computeStepParentIds(steps);
    const indexById = new Map();
    steps.forEach((step, i) => {
        if (step?.id) indexById.set(step.id, i);
    });
    steps.forEach((step, i) => {
        if (!step || typeof step !== 'object') {
            issues.push(`[${i}] not an object`);
            return;
        }
        if (!step.id || indexById.get(step.id) !== i) {
            issues.push(`[${i}] missing or duplicate id`);
            return;
        }
        if (step.order !== i) issues.push(`[${i}] order ${step.order} !== ${i}`);
        const expected = canonical.get(step.id) ?? null;
        if (step.parentId !== expected) {
            issues.push(`[${i}] parentId ${step.parentId} !== canonical ${expected}`);
        }
        if (step.parentId === step.id) issues.push(`[${i}] self-referential parentId`);
        if (step.parentId && !indexById.has(step.parentId)) {
            issues.push(`[${i}] dangling parentId ${step.parentId}`);
        }
        if (step.parentId) {
            const parentIdx = indexById.get(step.parentId);
            if (parentIdx > i) issues.push(`[${i}] parent appears after child`);
            if (getStepLevel(steps[parentIdx]) >= getStepLevel(step)) {
                issues.push(`[${i}] parent level not strictly lower`);
            }
        }
    });
    return issues;
}

/** Toggle a step's completion in place. Order and positions are untouched. */
export function toggleStepCompletion(steps, stepId, completed) {
    const step = (steps || []).find((s) => s?.id === stepId);
    if (!step) return false;
    if (step.completed === completed) return false;
    step.completed = completed;
    return true;
}

/**
 * Toggle a group (parent) step and ALL its descendants.
 * When completing a parent, all children are also marked complete.
 * When uncompleting a parent, only the parent is marked uncompleted (children stay done).
 * Returns the list of affected step IDs, or empty array if no changes.
 * @param {Array} steps - The steps array
 * @param {string} stepId - The step ID to toggle
 * @param {boolean} completed - The completed state to set
 * @returns {string[]} Array of step IDs that were affected
 */
export function toggleGroupCompletion(steps, stepId, completed) {
    const list = steps || [];
    const stepIdx = list.findIndex((s) => s?.id === stepId);
    if (stepIdx < 0) return [];
    
    // Collect the whole subtree (parent + all descendants)
    const subtree = collectStepSubtree(list, stepIdx);
    if (!subtree.length) return [];
    
    const affectedIds = [];
    // When completing: mark all descendants as complete too
    // When uncompleting: only touch the parent (children remain done)
    if (completed) {
        // Completing: mark entire subtree
        for (const s of subtree) {
            if (s.completed !== completed) {
                s.completed = completed;
                affectedIds.push(s.id);
            }
        }
    } else {
        // Uncompleting: only the parent
        const parent = subtree[0];
        if (parent.completed !== completed) {
            parent.completed = completed;
            affectedIds.push(parent.id);
        }
    }
    return affectedIds;
}

/**
 * Find all descendant step IDs for a given step (including itself).
 * @param {Array} steps - The steps array
 * @param {string} stepId - The parent step ID
 * @returns {string[]} Array of step IDs in the subtree
 */
export function getGroupStepIds(steps, stepId) {
    const list = steps || [];
    const stepIdx = list.findIndex((s) => s?.id === stepId);
    if (stepIdx < 0) return [];
    
    const subtree = collectStepSubtree(list, stepIdx);
    return subtree.map(s => s.id);
}

/**
 * Insert a new sibling step after afterStepId (or append when omitted).
 * The new step inherits the anchor's level; position metadata is refreshed.
 * @returns {{ steps: Array, step: Object }}
 */
export function addChecklistStep(steps, { afterStepId = null, text = '', completed = false, level, newId = null } = {}) {
    const list = Array.isArray(steps) ? steps.map((s) => s) : [];
    if (!newId) newId = `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const afterIdx = afterStepId ? list.findIndex((s) => s?.id === afterStepId) : list.length - 1;
    const anchor = afterIdx >= 0 ? list[afterIdx] : null;
    const step = {
        id: newId,
        text: String(text ?? ''),
        completed: completed === true,
        level: Math.min(4, Math.max(0, Number.isFinite(level) ? level : (anchor ? getStepLevel(anchor) : 0))),
        parentId: null,
        order: list.length
    };
    const insertAt = afterIdx >= 0 ? afterIdx + 1 : list.length;
    const next = [...list.slice(0, insertAt), step, ...list.slice(insertAt)];
    return { steps: refreshStepsPosition(next), step };
}

/**
 * Split a step at Enter: the original keeps beforeText (as a sibling), a new
 * step with afterText is inserted after it (or after its whole subtree when the
 * group is collapsed). Position metadata is refreshed.
 * @returns {{ steps: Array, newStep: Object|null }}
 */
export function splitChecklistStep(steps, stepId, beforeText, afterText, { afterSubtree = false, newId = null } = {}) {
    const list = Array.isArray(steps) ? [...steps] : [];
    const idx = list.findIndex((s) => s?.id === stepId);
    if (idx < 0) return { steps: list, newStep: null };
    const step = list[idx];
    step.text = String(beforeText ?? '');
    if (!newId) newId = `step_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let insertAt = idx + 1;
    if (afterSubtree) {
        insertAt = idx + collectStepSubtree(list, idx).length;
    }
    const newStep = {
        id: newId,
        text: String(afterText ?? ''),
        completed: false,
        level: getStepLevel(step),
        parentId: null,
        order: insertAt
    };
    list.splice(insertAt, 0, newStep);
    return { steps: refreshStepsPosition(list), newStep };
}

/**
 * Delete a step. Children left behind are re-parented automatically by the
 * nearest-preceding-lower-level rule via refreshStepsPosition.
 * @returns {{ steps: Array, prevStepId: string|null, nextStepId: string|null }}
 */
export function deleteChecklistStep(steps, stepId) {
    const list = Array.isArray(steps) ? [...steps] : [];
    const idx = list.findIndex((s) => s?.id === stepId);
    if (idx < 0) return { steps: list, prevStepId: null, nextStepId: null };
    const prevStepId = idx > 0 ? (list[idx - 1]?.id ?? null) : null;
    const subtree = collectStepSubtree(list, idx);
    const nextIdx = idx + subtree.length - 1;
    const nextStepId = nextIdx + 1 < list.length ? (list[nextIdx + 1]?.id ?? null) : null;
    list.splice(idx, 1);
    return { steps: refreshStepsPosition(list), prevStepId, nextStepId };
}

/** Merge stepIdx into its previous step (Enter/Backspace merge on an empty row). */
export function mergeChecklistStepIntoPrev(steps, stepIdx) {
    const list = Array.isArray(steps) ? [...steps] : [];
    if (stepIdx <= 0 || stepIdx >= list.length) return { steps: list, merged: false };
    const prev = list[stepIdx - 1];
    const step = list[stepIdx];
    prev.text = `${prev.text || ''}\n${step.text || ''}`;
    list.splice(stepIdx, 1);
    return { steps: refreshStepsPosition(list), merged: true };
}

/** Indent a whole subtree by one level (grouping preserved) and refresh metadata. */
export function indentChecklistSteps(steps, startIndex) {
    if (!steps?.[startIndex]) return steps;
    applySubtreeLevelDelta(steps, startIndex, 1);
    return refreshStepsPosition(steps);
}

/** Outdent a whole subtree by one level (clamped at 0) and refresh metadata. */
export function outdentChecklistSteps(steps, startIndex) {
    if (!steps?.[startIndex]) return steps;
    applySubtreeLevelDelta(steps, startIndex, -1);
    return refreshStepsPosition(steps);
}

/**
 * Model-first drag commit.
 *
 * The DOM is used only for pointer hit-test geometry; the resulting drop target
 * (insertIndex into the visible-others list, dropMode, anchorStepId) drives this
 * pure rebuild of the steps array. Structure is never read back from the DOM.
 *
 * @param {Array} steps - full item.steps
 * @param {string} blockRootId - id of the dragged block's root step
 * @param {Object} opts
 * @param {'sibling'|'child'} [opts.dropMode]
 * @param {number} [opts.insertIndex] - drop index into the visible-others list
 * @param {string|null} [opts.anchorStepId] - row the pointer is over (child mode parent)
 * @param {string} [opts.itemId] - for collapse-key based visibility
 * @param {Object} [opts.collapsedKeys]
 * @returns {{ steps: Array, parentId: string|null, levelChanged: boolean }}
 */
export function moveChecklistStepBlock(steps, blockRootId, {
    dropMode = 'sibling',
    insertIndex = 0,
    anchorStepId = null,
    itemId = '',
    collapsedKeys = {}
} = {}) {
    const list = Array.isArray(steps) ? steps : [];
    const { active, done } = partitionChecklistSteps(list);
    const rootIdx = active.findIndex((s) => s.id === blockRootId);
    if (rootIdx < 0) return { steps: list, parentId: null, levelChanged: false };
    const block = collectStepSubtree(active, rootIdx);
    const blockIds = new Set(block.map((s) => s.id));
    
    // Also include done steps that are descendants of the block root
    // These need to move with the block to maintain tree structure
    const rootIds = new Set([blockRootId, ...block.map(s => s.id)]);
    const doneInBlock = [];
    const doneNotInBlock = [];
    for (const d of done) {
        let isDescendant = false;
        let currentId = d.parentId;
        while (currentId) {
            if (rootIds.has(currentId)) {
                isDescendant = true;
                break;
            }
            const parent = list.find(s => s.id === currentId);
            currentId = parent?.parentId;
        }
        if (isDescendant) {
            doneInBlock.push(d);
        } else {
            doneNotInBlock.push(d);
        }
    }
    
    // Merge done steps into block at correct positions based on their parentId
    // The done steps need to be interleaved with active steps in the block
    // We use a single array and sort by original order to maintain tree structure
    const allBlockSteps = [...block, ...doneInBlock];
    // Sort by the original order property to maintain proper tree order
    allBlockSteps.sort((a, b) => (a.order || 0) - (b.order || 0));

    const othersActive = active.filter((s) => !blockIds.has(s.id));
    const othersVisible = buildVisibleChecklistSteps(active, itemId, collapsedKeys)
        .filter((row) => !blockIds.has(row.step.id))
        .map((row) => row.step.id);

    let targetModelIndex;
    if (dropMode === 'child' && anchorStepId) {
        const anchorIdx = othersActive.findIndex((s) => s.id === anchorStepId);
        targetModelIndex = anchorIdx >= 0 ? anchorIdx + 1 : 0;
    } else if (insertIndex < othersVisible.length) {
        const targetId = othersVisible[insertIndex];
        const ti = othersActive.findIndex((s) => s.id === targetId);
        targetModelIndex = ti >= 0 ? ti : othersActive.length;
    } else if (othersVisible.length) {
        const lastId = othersVisible[othersVisible.length - 1];
        const ti = othersActive.findIndex((s) => s.id === lastId);
        targetModelIndex = ti >= 0 ? ti + 1 : othersActive.length;
    } else {
        targetModelIndex = 0;
    }

    // Build reordered array - the block now includes interleaved done steps
    const reordered = [
        ...othersActive.slice(0, targetModelIndex),
        ...allBlockSteps,
        ...othersActive.slice(targetModelIndex)
    ];

    const beforeLevel = getStepLevel(block[0]);
    const dropResult = resolveDropTarget(reordered, blockRootId, { mode: dropMode });
    const rootIdxFinal = reordered.findIndex((s) => s.id === blockRootId);
    const afterLevel = rootIdxFinal >= 0 ? getStepLevel(reordered[rootIdxFinal]) : beforeLevel;

    refreshStepsPosition(reordered);
    // Use doneNotInBlock to preserve tree structure - done steps that are
    // descendants of the moved block stay with the block
    // Note: doneInBlock are already interleaved in allBlockSteps above
    const finalSteps = [...reordered, ...doneNotInBlock];
    // Re-apply refresh to ensure order is correct after appending
    refreshStepsPosition(finalSteps);
    refreshStepsPosition(finalSteps);
    return {
        steps: finalSteps,
        parentId: dropResult?.parentId || null,
        levelChanged: beforeLevel !== afterLevel
    };
}
