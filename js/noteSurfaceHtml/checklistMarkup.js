/** @module {"owns":"expanded checklist markup for a note body - open steps, the done section and the expand/collapse-all control", "related":["noteSurfaceHtml.js","checklistSteps.js","noteSurfaceChecklist.js"]} */
import { CARD_ICONS } from '../icons.js';
import { escapeHTML, escapeAttr } from '../domEscape.js';
import {
    partitionChecklistSteps,
    buildVisibleChecklistSteps,
    buildCompletedChecklistRows,
    annotateChecklistTreeGuides
} from '../checklistSteps.js';
import {
    getChecklistCollapsedKeys,
    isChecklistDoneSectionCollapsed,
    buildChecklistExpandCollapseAllHtml,
    buildChecklistRowHtml
} from '../noteSurfaceChecklist.js';
export function buildExpandedChecklistHtml(item, canEdit, { richEdit = false } = {}) {
    const collapsedKeys = getChecklistCollapsedKeys();
    const { active, done } = partitionChecklistSteps(item.steps);
    let html = '<div class="expanded-checklist">';
    html += buildChecklistExpandCollapseAllHtml(item);

    annotateChecklistTreeGuides(buildVisibleChecklistSteps(active, item.id, collapsedKeys))
        .forEach((row) => {
            html += buildChecklistRowHtml(row.step, {
                hasKids: row.hasKids,
                isCollapsed: !!collapsedKeys[row.collapseKey],
                collapseKey: row.collapseKey,
                isDoneSection: false,
                treeGuides: row.treeGuides || [],
                canEdit,
                richEdit,
                active
            });
        });

    if (canEdit) {
        html += `<button type="button" class="card-act expanded-checklist-add-btn" title="Add checklist item" aria-label="Add checklist item">+</button>`;
    }

    if (done.length > 0) {
        const doneCollapsed = isChecklistDoneSectionCollapsed(item.id);
        const toggleTitle = doneCollapsed
            ? `Show ${done.length} completed item${done.length === 1 ? '' : 's'}`
            : 'Collapse completed items';
        const toggleIcon = doneCollapsed ? CARD_ICONS.chevronRight : CARD_ICONS.chevronDown;
        const toggleLabel = doneCollapsed
            ? `Hidden items (${done.length})`
            : 'Completed';
        html += `<button type="button" class="checklist-done-toggle" title="${escapeAttr(toggleTitle)}" aria-expanded="${doneCollapsed ? 'false' : 'true'}" aria-label="${escapeAttr(toggleTitle)}">
                <span class="checklist-done-toggle-icon" aria-hidden="true">${toggleIcon}</span>
                <span class="checklist-done-toggle-label">${escapeHTML(toggleLabel)}</span>
            </button>`;
        if (!doneCollapsed && active.length > 0) {
            html += '<div class="checklist-done-divider" role="separator" aria-hidden="true"></div>';
        }
        html += `<div class="checklist-done-section${doneCollapsed ? ' is-hidden' : ''}">`;
        // Completed groups keep their parent-child hierarchy: run the same
        // collapse-aware + tree-guide pipeline as the active section so done
        // parents show expand/collapse chevrons and their children stay nested.
        // buildCompletedChecklistRows additionally emits a read-only "ghost" of
        // an open parent above its completed children so those children stay
        // grouped until the parent itself is completed (then it replaces the
        // ghost and they join into one group).
        annotateChecklistTreeGuides(buildCompletedChecklistRows(item.steps, item.id, collapsedKeys))
            .forEach((row) => {
                html += buildChecklistRowHtml(row.step, {
                    hasKids: row.hasKids,
                    isCollapsed: !!collapsedKeys[row.collapseKey],
                    collapseKey: row.collapseKey,
                    isDoneSection: true,
                    isGhost: row.isGhost,
                    treeGuides: row.treeGuides || [],
                    canEdit,
                    richEdit,
                    active
                });
            });
        html += '</div>';
    }

    html += '</div>';
    return html;
}
