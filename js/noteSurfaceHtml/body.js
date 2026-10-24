/** @module {"owns":"note body markup - the content field, checklist/sheet/meeting bodies, side sections, visibility rules and the rich-text render helpers", "related":["noteSurfaceHtml.js","noteSurfaceHtml/checklistMarkup.js","sheet.js","richText.js"]} */
import { FORMAT_ICONS } from '../icons.js';
import { stripRichText, hasRichMarkup, sanitizeRichHtml } from '../richText.js';
import {
    isSheetTemplateActive,
    renderSheetHtml,
    defaultSheetDimsForTemplate,
    ensureItemSheet
} from '../sheet.js';
import { contentHasConvertibleText, stepsHaveConvertibleText } from '../noteBodyConversion.js';
import { escapeHTML } from '../domEscape.js';
import { mutateItem } from '../noteSurfaceMutations.js';
import { buildNoteAttachmentsSectionHtml, buildNoteCanvasSectionHtml } from '../noteAttachmentsUi.js';
import { buildNotePlannerSectionHtml } from '../plannerUi.js';
import { buildNoteFlowchartSectionHtml } from '../flowchartUi.js';
import { renderFocusSpawnTrayHtml, renderFocusSpawnSubTrayHtml } from '../noteFocusSpawn.js';
import { buildExpandedChecklistHtml } from './checklistMarkup.js';

export function resolveNoteBodyVisibility(item, { canEdit = false, inModalEditor = false } = {}) {
    const layout = item.editorBodyLayout || 'both';
    const hasContent = stripRichText(item.content || '').trim();

    if (inModalEditor) {
        return { showContent: true, showChecklist: true };
    }
    if (canEdit) {
        // In edit mode the checklist section (and its "+" button) must ALWAYS
        // render so users can add a first item at any time, even when the note
        // has editorBodyLayout === 'content' and zero existing steps.
        return {
            showContent: hasContent || layout === 'both' || layout === 'content',
            showChecklist: true
        };
    }
    return {
        showContent: !!hasContent,
        showChecklist: item.steps && item.steps.length > 0
    };
}

export function mediaSectionStartCollapsed(item) {
    return !!item?.attachmentsCollapsed;
}

export function canvasSectionStartCollapsed(item) {
    return !!item?.canvasCollapsed;
}

export function plannerSectionStartCollapsed(item) {
    return !!item?.plannerCollapsed;
}

export function flowchartSectionStartCollapsed(item) {
    return !!(item?.flowchartCollapsed ?? item?.flowchart?.collapsed);
}

/** Append peer side sections: Media → Canvas → Plan → Flowchart. */
export function appendNoteSideSections(item, html, { canEdit = false } = {}) {
    let out = html;
    out += buildNoteAttachmentsSectionHtml(item, {
        canEdit,
        startCollapsed: mediaSectionStartCollapsed(item)
    });
    out += buildNoteCanvasSectionHtml(item, {
        startCollapsed: canvasSectionStartCollapsed(item)
    });
    out += buildNotePlannerSectionHtml(item, {
        canEdit,
        startCollapsed: plannerSectionStartCollapsed(item)
    });
    out += buildNoteFlowchartSectionHtml(item, {
        canEdit,
        startCollapsed: flowchartSectionStartCollapsed(item)
    });
    return out;
}

export function buildNoteBodyHtml(item, { canEdit = false, inModalEditor = false, richEdit = false } = {}) {
    const template = resolveNoteTemplate(item);

    if (template === 'sheet') {
        ensureItemSheet(item, defaultSheetDimsForTemplate('sheet'));
        let sheetHtml = renderSheetHtml(item.sheet, { canEdit, inModalEditor });
        return appendNoteSideSections(item, sheetHtml, { canEdit });
    }

    if (template === 'meeting') {
        return buildMeetingBodyHtml(item, { canEdit, inModalEditor, richEdit });
    }

    let html = '';
    const { showContent, showChecklist } = resolveNoteBodyVisibility(item, { canEdit, inModalEditor });
    const plannerActive = !!(item?.planner && !item?.plannerHidden);

    if (plannerActive && (showContent || showChecklist)) {
        html += buildNoteContentSectionHtml(item, {
            canEdit,
            richEdit,
            showContent,
            showChecklist
        });
    } else {
        if (showContent) {
            html += buildNoteContentFieldHtml(item, { canEdit, richEdit });
        }
        if (showChecklist) {
            if (!item.steps) item.steps = [];
            html += buildExpandedChecklistHtml(item, canEdit, { richEdit });
        }
    }
    return appendNoteSideSections(item, html, { canEdit });
}

export function buildNoteContentFieldHtml(item, { canEdit = false, richEdit = false } = {}) {
    const content = item.content || '';
    const rich = hasRichMarkup(content) || content.includes('\u2028');
    if (canEdit && (richEdit || canInlineEditText(content, { richEdit }))) {
        const inner = richEdit ? sanitizeRichHtml(content) : escapeHTML(content.replace(/\u2028/g, '\n'));
        const ce = richEdit ? 'true' : 'plaintext-only';
        const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
        return `<div class="card-content-preview card-inline-edit${richClasses}" contenteditable="${ce}" spellcheck="false" data-field="content" data-placeholder="Add note…">${inner}</div>`;
    }
    const richClass = rich ? ' rich-text' : '';
    return `<div class="card-content-preview${richClass}">${renderRichHtml(content)}</div>`;
}

export function buildNoteContentSectionHtml(item, {
    canEdit = false,
    richEdit = false,
    showContent = false,
    showChecklist = false
} = {}) {
    const textCollapsed = !!item.textCollapsed;
    const checklistCollapsed = !!item.checklistCollapsed;
    let inner = '';
    if (showContent) {
        inner += `<div class="planner-sub" data-note-text data-text-collapsed="${textCollapsed ? '1' : '0'}">
            <div class="planner-sub__toolbar">
                <button type="button" class="planner-sub__title" data-note-text-toggle aria-expanded="${textCollapsed ? 'false' : 'true'}">
                    <span class="collapsable-toggle${textCollapsed ? ' collapsed' : ''}" aria-hidden="true">▼</span>Text
                </button>
                ${renderFocusSpawnSubTrayHtml('text', 'Text')}
            </div>
            <div class="planner-sub__body${textCollapsed ? ' is-collapsed' : ''}" data-note-text-body>
                ${buildNoteContentFieldHtml(item, { canEdit, richEdit })}
            </div>
        </div>`;
    }
    if (showChecklist) {
        if (!item.steps) item.steps = [];
        inner += `<div class="planner-sub" data-note-checklist-sub data-checklist-collapsed="${checklistCollapsed ? '1' : '0'}">
            <div class="planner-sub__toolbar">
                <button type="button" class="planner-sub__title" data-note-checklist-toggle aria-expanded="${checklistCollapsed ? 'false' : 'true'}">
                    <span class="collapsable-toggle${checklistCollapsed ? ' collapsed' : ''}" aria-hidden="true">▼</span>Checklist
                </button>
                ${renderFocusSpawnSubTrayHtml('checklist', 'Checklist')}
            </div>
            <div class="planner-sub__body${checklistCollapsed ? ' is-collapsed' : ''}" data-note-checklist-body>
                ${buildExpandedChecklistHtml(item, canEdit, { richEdit })}
            </div>
        </div>`;
    }
    const contentCollapsed = !!item.contentCollapsed;
    const collapsedClass = contentCollapsed ? ' collapsed' : '';
    const toggleCollapsed = contentCollapsed ? ' collapsed' : '';
    return `
            <div class="note-body-section note-body-section--content" data-note-content>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>Content</span>
                    ${renderFocusSpawnTrayHtml('content', 'Content')}
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    ${inner}
                </div>
            </div>`;
}

export function renderRichHtml(str) {
    if (!str) return '';
    const prepared = String(str).replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
    if (hasRichMarkup(prepared)) return sanitizeRichHtml(prepared);
    return sanitizeRichHtml(escapeHTML(prepared));
}

export function canInlineEditText(text, { richEdit = false } = {}) {
    if (richEdit) return true;
    return !hasRichMarkup(text);
}

export function prepareContentForEdit(content) {
    const prepared = String(content || '').replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
    if (hasRichMarkup(prepared)) return sanitizeRichHtml(prepared);
    return sanitizeRichHtml(escapeHTML(prepared));
}

export function buildNoteBodySection(title, innerHtml) {
    return `
            <div class="note-body-section">
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>${escapeHTML(title)}</span>
                </div>
                <div class="note-section-body collapsable-section">
                    ${innerHtml}
                </div>
            </div>`;
}

/**
 * Bind outer note-body section collapse toggles.
 * Content ([data-note-content]) persists via item.contentCollapsed.
 * Plan/Media/Canvas are owned by their own binders; meeting/sheet headers stay DOM-only.
 * @param {HTMLElement} root
 * @param {object} [item]
 */
export function bindNoteBodySections(root, item) {
    if (!root || root.dataset.noteSectionsBound === '1') return;
    root.dataset.noteSectionsBound = '1';
    root.querySelectorAll('.note-body-section .note-section-header').forEach((header) => {
        // Media/canvas section collapse is owned by noteAttachmentsUi.bindMediaSectionToggle
        // so expand can re-paint the canvas preview. Planner owns its own toggle too.
        if (header.closest('[data-note-attachments], [data-note-planner], [data-note-canvas], [data-note-flowchart]')) return;
        header.addEventListener('click', (e) => {
            // Let Focus-spawn bubble to bindFocusSpawnButtons (do not stopPropagation).
            if (e.target.closest?.('[data-focus-spawn]')) return;
            e.stopPropagation();
            const body = header.nextElementSibling;
            const toggle = header.querySelector('.collapsable-toggle');
            const contentSection = header.closest('[data-note-content]');
            if (contentSection && item) {
                const nextCollapsed = !item.contentCollapsed;
                mutateItem(item, (it) => {
                    it.contentCollapsed = nextCollapsed;
                }, { preserveView: true, skipRerender: true });
                body?.classList.toggle('collapsed', nextCollapsed);
                toggle?.classList.toggle('collapsed', nextCollapsed);
                return;
            }
            const collapsed = body?.classList.toggle('collapsed');
            toggle?.classList.toggle('collapsed');
            if (!collapsed) {
                body?.querySelectorAll('[data-sheet-block]').forEach((block) => growSheetCells(block));
            }
        });
    });
}

/**
 * Persist Text / Checklist subsection collapse when Plan is active.
 * @param {HTMLElement} root
 * @param {object} item
 */
export function bindNoteContentSubToggles(root, item) {
    if (!root || !item) return;
    // Board wraps subs in [data-note-content]; Focus hosts the same toggles
    // directly in a pane body — accept either host.
    const section = root.querySelector?.('[data-note-content]')
        || root.closest?.('[data-note-content]')
        || (root.querySelector?.('[data-note-text-toggle], [data-note-checklist-toggle]') ? root : null);
    if (!section || section.dataset.contentSubsBound === '1') return;
    section.dataset.contentSubsBound = '1';

    section.addEventListener('click', (e) => {
        const textToggle = e.target.closest('[data-note-text-toggle]');
        if (textToggle && section.contains(textToggle)) {
            e.preventDefault();
            e.stopPropagation();
            const nextCollapsed = !item.textCollapsed;
            mutateItem(item, (it) => {
                it.textCollapsed = nextCollapsed;
            }, { preserveView: true, skipRerender: true });
            const block = textToggle.closest('[data-note-text]')
                || section.querySelector('[data-note-text]');
            const body = block?.querySelector?.('[data-note-text-body]');
            const icon = textToggle.querySelector('.collapsable-toggle');
            textToggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
            icon?.classList.toggle('collapsed', nextCollapsed);
            body?.classList.toggle('is-collapsed', nextCollapsed);
            if (block) block.dataset.textCollapsed = nextCollapsed ? '1' : '0';
            return;
        }

        const checklistToggle = e.target.closest('[data-note-checklist-toggle]');
        if (checklistToggle && section.contains(checklistToggle)) {
            e.preventDefault();
            e.stopPropagation();
            const nextCollapsed = !item.checklistCollapsed;
            mutateItem(item, (it) => {
                it.checklistCollapsed = nextCollapsed;
            }, { preserveView: true, skipRerender: true });
            const block = checklistToggle.closest('[data-note-checklist-sub]')
                || section.querySelector('[data-note-checklist-sub]');
            const body = block?.querySelector?.('[data-note-checklist-body]');
            const icon = checklistToggle.querySelector('.collapsable-toggle');
            checklistToggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
            icon?.classList.toggle('collapsed', nextCollapsed);
            body?.classList.toggle('is-collapsed', nextCollapsed);
            if (block) block.dataset.checklistCollapsed = nextCollapsed ? '1' : '0';
        }
    });
}

export function growSheetCells(block) {
    if (!block) return;
    const cells = block.querySelectorAll('[data-sheet-cell]');
    cells.forEach(cell => {
        const row = cell.closest('[data-sheet-row]');
        if (row) {
            const rowHeight = row.offsetHeight;
            cell.style.height = `${rowHeight}px`;
        }
    });
}

export function buildMeetingBodyHtml(item, { canEdit = false, inModalEditor = false, richEdit = false } = {}) {
    ensureItemSheet(item, defaultSheetDimsForTemplate('meeting'));
    let html = '';
    html += buildNoteBodySection('Attendees', renderSheetHtml(item.sheet, { canEdit, inModalEditor }));

    const content = item.content || '';
    const rich = hasRichMarkup(content) || content.includes('\u2028');
    let agendaHtml = '';
    if (canEdit && (richEdit || canInlineEditText(content, { richEdit }))) {
        const inner = richEdit ? prepareContentForEdit(content) : escapeHTML(content.replace(/\u2028/g, '\n'));
        const ce = richEdit ? 'true' : 'plaintext-only';
        const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
        agendaHtml += `<div class="card-content-preview card-inline-edit${richClasses}" contenteditable="${ce}" spellcheck="false" data-field="content" data-placeholder="Add agenda…">${inner}</div>`;
    } else {
        const richClass = rich ? ' rich-text' : '';
        agendaHtml += `<div class="card-content-preview${richClass}">${renderRichHtml(content)}</div>`;
    }
    html += buildNoteBodySection('Agenda', agendaHtml);

    if (!item.steps) item.steps = [];
    let actionHtml = buildExpandedChecklistHtml(item, canEdit, { richEdit });
    const meetingWhen = formatMeetingDateTimeBadge(item.startDateTime);
    if (meetingWhen) {
        actionHtml += `<p class="meeting-datetime meeting-datetime--body">${escapeHTML(meetingWhen)}</p>`;
    }
    html += buildNoteBodySection('Action items', actionHtml);
    return appendNoteSideSections(item, html, { canEdit });
}

export function formatMeetingDateTimeBadge(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function resolveNoteTemplate(item) {
    if (!item) return 'default';
    if (item.noteTemplate === 'sheet') return 'sheet';
    if (item.noteTemplate === 'meeting') return 'meeting';
    return 'default';
}

export function buildNoteBodyConvertButtonsHtml(item) {
    if (isSheetTemplateActive(item)) return '';
    const canToChecklist = contentHasConvertibleText(item?.content);
    const canToContent = stepsHaveConvertibleText(item?.steps);
    return `
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="format-btn card-act editor-convert-btn" data-convert="to-checklist" title="Move content into checklist items" aria-label="To checklist"${canToChecklist ? '' : ' disabled'}>${FORMAT_ICONS.toChecklist}</button>
            <button type="button" class="format-btn card-act editor-convert-btn" data-convert="to-content" title="Move checklist into note content" aria-label="To notes"${canToContent ? '' : ' disabled'}>${FORMAT_ICONS.toNotes}</button>
        `;
}

export function updateConvertButtons(shell, item) {
    if (!shell || !item) return;
    const toChecklist = shell.querySelector('[data-convert="to-checklist"]');
    const toContent = shell.querySelector('[data-convert="to-content"]');
    if (toChecklist) toChecklist.disabled = !contentHasConvertibleText(item.content);
    if (toContent) toContent.disabled = !stepsHaveConvertibleText(item.steps);
}
