/** @module {"owns":"which checklist groups are collapsed - the localStorage-backed state, the expand/collapse-all toolbar and the short-lived read cache used on drag/render hot paths", "related":["noteSurfaceChecklist.js","noteSurfaceChecklist/targeting.js","noteSurfaceChecklist/drag.js","checklistSteps.js"]} */
import { ACTION_ICONS } from '../icons.js';
import { escapeHTML } from '../domEscape.js';
import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants, buildCompletedChecklistRows } from '../checklistSteps.js';


let _cachedCollapsedKeys = null;
let _cachedDoneCollapsed = null;
let _cacheTimestamp = 0;
const CACHE_TTL = 1000; // 1 second cache for hot paths

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

export function isChecklistGroupCollapsed(itemId, stepId) {
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

export function getCachedChecklistCollapsedKeys() {
    const now = Date.now();
    if (_cachedCollapsedKeys && (now - _cacheTimestamp) < CACHE_TTL) {
        return _cachedCollapsedKeys;
    }
    _cachedCollapsedKeys = getChecklistCollapsedKeys();
    _cacheTimestamp = now;
    return _cachedCollapsedKeys;
}

export function getCachedChecklistDoneCollapsed() {
    const now = Date.now();
    if (_cachedDoneCollapsed && (now - _cacheTimestamp) < CACHE_TTL) {
        return _cachedDoneCollapsed;
    }
    _cachedDoneCollapsed = getChecklistDoneCollapsed();
    _cacheTimestamp = now;
    return _cachedDoneCollapsed;
}

export function invalidateChecklistCache() {
    _cachedCollapsedKeys = null;
    _cachedDoneCollapsed = null;
    _cacheTimestamp = 0;
}
