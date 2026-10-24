/** @module {"owns":"markup for one checklist step row - checkbox, text, collapse chevron, indent/outdent, copy and delete controls, tree guides", "related":["noteSurfaceChecklist.js","noteSurfaceHtml/checklistMarkup.js","checklistSteps.js"]} */
import { CARD_ICONS } from '../icons.js';
import { escapeHTML, escapeAttr } from '../domEscape.js';
import { getStepLevel, canIndentStep } from '../checklistSteps.js';
import { sanitizeRichHtml, hasRichMarkup } from '../richText.js';
import { canInlineEditText } from '../noteSurfaceEditing.js';

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
