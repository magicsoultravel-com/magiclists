/** @module {"owns":"checklist HTML building", "related":["checklistSteps.js","noteSurfaceChecklist.js","icons.js"], "events":[]} */
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants, canIndentStep } from './checklistSteps.js';
import { hasRichMarkup, sanitizeRichHtml } from './richText.js';

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

function canInlineEditText(text, { richEdit = false } = {}) {
    if (richEdit) return true;
    return !hasRichMarkup(text);
}

/**
 * Build HTML for the expand/collapse all button.
 * @param {Object} item - The note item
 * @returns {string} HTML for the expand/collapse all button
 */
export function buildChecklistExpandCollapseAllHtml(item) {
    if (!item?.id || !checklistHasIndentations(item.steps)) return '';
    
    // Get collapsed keys from localStorage
    let collapsed = {};
    try {
        collapsed = JSON.parse(localStorage.getItem('matrix_checklist_collapsed') || '{}');
    } catch {
        // ignore
    }
    
    // Get collapsible keys
    const { active } = partitionChecklistSteps(item.steps || []);
    const collapsibleKeys = [];
    active.forEach((step, index) => {
        if (!stepHasDescendants(active, index)) return;
        collapsibleKeys.push(`${item.id}:${step.id}`);
    });
    
    if (collapsibleKeys.length === 0) return '';
    
    const anyExpanded = collapsibleKeys.some((key) => !collapsed[key]);
    const label = anyExpanded ? 'Collapse all checklist groups' : 'Expand all checklist groups';
    const icon = anyExpanded ? ACTION_ICONS.collapseAll : ACTION_ICONS.expandAll;
    return `<div class="checklist-toolbar">
            <button type="button" class="card-act checklist-expand-collapse-all-btn" title="${escapeHTML(label).replace(/"/g, "")}" aria-label="${escapeHTML(label).replace(/"/g, "")}">${icon}</button>
        </div>`;
}
