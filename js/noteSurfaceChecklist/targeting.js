/** @module {"owns":"queries against the rendered step list - which rows are currently visible, whether a row is a collapsed group, and where a pointer/drop lands in the visible order", "related":["noteSurfaceChecklist.js","noteSurfaceChecklist/collapse.js","noteSurfaceChecklist/drag.js"]} */

import { getChecklistCollapsedKeys, getChecklistDoneCollapsed } from './collapse.js';

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
export function findStepInsertionPosition(row, item, addBtn) {
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

export function isCollapsedGroupRow(row, collapsedKeys) {
    const itemId = row.dataset.itemId;
    const stepId = row.dataset.stepId;
    if (!itemId || !stepId) return false;
    const key = `${itemId}:${stepId}`;
    return !!collapsedKeys[key];
}
