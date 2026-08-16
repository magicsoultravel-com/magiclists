/** @module {"owns":"note HTML building and rendering", "related":["noteSurface.js","noteModel.js","sheet.js","checklistSteps.js"], "events":[]} */
import { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS } from './icons.js';
import { UNCATEGORIZED_COLOR } from './categories.js';
import { stripRichText, hasRichMarkup, sanitizeRichHtml } from './richText.js';
import { isSheetTemplateActive, renderSheetHtml, defaultSheetDimsForTemplate, ensureItemSheet } from './sheet.js';
import { contentHasConvertibleText, stepsHaveConvertibleText } from './noteBodyConversion.js';
import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants, buildVisibleChecklistSteps, buildCompletedChecklistRows, annotateChecklistTreeGuides, canIndentStep } from './checklistSteps.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { isFileCabinetActive, getFileCabinetToggleLabels } from './fileCabinet.js';
import { LEGACY_TILE_SIZE, isCollapsedSpatialSize } from './tileGeometry.js';
import { bindChecklistInteractions, attachChecklistDrag, getChecklistCollapsedKeys, getChecklistDoneCollapsed, isChecklistDoneSectionCollapsed, toggleChecklistDoneSection, getChecklistCollapsibleKeys, checklistGroupsAnyExpanded, collapseAllChecklistGroups, expandAllChecklistGroups, toggleChecklistExpandCollapseAll, buildChecklistExpandCollapseAllHtml, buildChecklistRowHtml } from './noteSurfaceChecklist.js';
import { focusInlineEdit } from './noteSurfaceEditing.js';
import { applyCardTheme } from './cardTheme.js';
import { resolveNoteColor } from './colorPicker.js';
import { NoteSurface } from './noteSurface.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import { NotePopoutBridge } from './notePopoutBridge.js';
import { getCardRenderContext } from './categories.js';
import { DesktopManager } from './desktopManager.js';
import { flushDesktopAutoSave } from './noteSurfaceMutations.js';

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

function formatNoteLineCount(n) {
    return n === 1 ? '1 line' : `${n} lines`;
}

function computeNoteSizeKb(item) {
    if (!item) return '0';
    const payload = {
        title: item.title || '',
        content: item.content || '',
        steps: item.steps || [],
        type: item.type || 'note',
        categories: item.categories || [],
        noteTemplate: item.noteTemplate || '',
        sheet: isSheetTemplateActive(item) ? item.sheet : undefined
    };
    const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    if (bytes === 0) return '0';
    const kb = bytes / 1024;
    if (kb < 0.1) return '<0.1';
    return kb < 10 ? kb.toFixed(1) : String(Math.round(kb));
}

function computeNoteLineCount(item) {
    if (!item) return 0;
    let count = 0;
    const countText = (text) => {
        const plain = stripRichText(text || '');
        if (!plain) return;
        count += plain.split(/\r?\n/).length;
    };
    countText(item.content);
    for (const step of item.steps || []) countText(step.text);
    if (isSheetTemplateActive(item) && item.sheet) {
        count += sheetCellTexts(item.sheet).length;
    }
    return count;
}

function sheetCellTexts(sheet) {
    if (!sheet?.rows || !Array.isArray(sheet.rows)) return [];
    return sheet.rows.reduce((acc, row) => {
        const cells = row.cells || [];
        return acc.concat(cells.map(c => c?.text || ''));
    }, []);
}

export function buildNoteQuickActionsHtml(item, {
    surface = 'board',
    isExpanded = false,
    pinned = false,
    showDrag = false,
    showArchive = false,
    spatialTile = false,
    tileSize = LEGACY_TILE_SIZE,
    tileW = 0,
    tileH = 0,
    calHidden = !!(item?.hideFromCalendar),
    poppedOut = false,
    windowCollapsed = false
} = {}) {
    const isModal = surface === 'modal';
    const isPopout = surface === 'popout';
    let expandTitle;
    let lastIcon;
    if (isModal) {
        expandTitle = 'Show on board';
        lastIcon = CARD_ICONS.collapse;
    } else if (spatialTile) {
        const atSmall = isCollapsedSpatialSize(tileW, tileH, tileSize);
        expandTitle = atSmall ? 'Expand' : 'Collapse to small';
        lastIcon = atSmall ? CARD_ICONS.expand : CARD_ICONS.collapse;
    } else {
        expandTitle = isExpanded ? 'Collapse note' : 'Expand note';
        lastIcon = isExpanded ? CARD_ICONS.collapse : CARD_ICONS.expand;
    }
    const lastClass = isModal ? 'card-act--close' : 'card-act--toggle';
    const lastId = isModal ? ' id="modal-close-btn"' : '';
    const pinTitle = pinned ? 'Unpin position (locks drag)' : 'Pin position (locks drag)';
    const pinBtn = (isModal || isPopout)
        ? ''
        : `<button type="button" class="card-act card-act--pin${pinned ? ' is-active' : ''}" title="${pinTitle}" aria-label="${pinTitle}" aria-pressed="${pinned ? 'true' : 'false'}">${pinned ? CARD_ICONS.unpin : CARD_ICONS.pin}</button>`;
    const calTitle = calHidden
        ? 'Hidden from calendar — click to show'
        : 'Shown on calendar — click to hide';
    const calBtn = `<button type="button" class="card-act card-act--cal${calHidden ? ' is-off' : ' is-on'}" title="${escapeAttr(calTitle)}" aria-label="${escapeAttr(calTitle)}">${CARD_ICONS.calendar}</button>`;
    // Board/modal: popout is a normal suite icon. Popout window: omit it (close = pop in).
    const popTitle = poppedOut ? 'Focus popout window' : 'Pop out note';
    const popBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--popout${poppedOut ? ' is-active' : ''}" data-note-id="${escapeAttr(item?.id || '')}" title="${escapeAttr(popTitle)}" aria-label="${escapeAttr(popTitle)}" aria-pressed="${poppedOut ? 'true' : 'false'}">${poppedOut ? CARD_ICONS.popoutExit : CARD_ICONS.popout}</button>`;
    // Board/modal: while a popout owns the note, offer a recall action that
    // returns it to the board (closes the popout after saving).
    const popinTitle = 'Pop in (return note to board)';
    const popinBtn = (!isPopout && poppedOut)
        ? `<button type="button" class="card-act card-act--popin" title="${popinTitle}" aria-label="${popinTitle}">${CARD_ICONS.popin}</button>`
        : '';
    // Popout window: pop-in sits next to calendar (left side of the suite).
    const closeTitle = 'Pop in (close window)';
    const closeBtn = isPopout
        ? `<button type="button" class="card-act card-act--close" id="modal-close-btn" title="${closeTitle}" aria-label="${closeTitle}">${CARD_ICONS.popoutExit}</button>`
        : '';
    const windowSizeTitle = windowCollapsed ? 'Expand window' : 'Collapse window';
    const windowSizeIcon = windowCollapsed ? CARD_ICONS.expand : CARD_ICONS.collapse;
    const windowSizeBtn = isPopout
        ? `<button type="button" class="card-act card-act--window-size" title="${windowSizeTitle}" aria-label="${windowSizeTitle}" aria-pressed="${windowCollapsed ? 'true' : 'false'}">${windowSizeIcon}</button>`
        : '';
    const showDragIcon = !isPopout && (isModal || (showDrag && !pinned));
    const dragBtn = showDragIcon
        ? `<button type="button" class="card-act card-act--drag" title="Drag to move" aria-label="Drag to move">${CARD_ICONS.drag}</button>`
        : '';
    const editTitle = isPopout ? 'Pop in' : (isModal ? 'Close' : 'Edit note');
    const editBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--edit" title="${editTitle}" aria-label="${editTitle}">${CARD_ICONS.edit}</button>`;
    const hideBtn = isPopout
        ? ''
        : `<button type="button" class="card-act card-act--hide" title="Hide from board" aria-label="Hide from board">${CARD_ICONS.hide}</button>`;
    // Board: popout, cal, popin (popped only), emoji, copy, [pin], color, hide, edit, [drag], toggle
    // Popout: cal, close (pop in), emoji, copy, color, window-size
    let actionCount = isPopout ? 6 : 9;
    if (!isModal && !isPopout && showDragIcon) actionCount += 1;
    if (!isPopout && poppedOut) actionCount += 1; // popin

    if (showArchive) actionCount += 1;
    const archiveBtn = showArchive
        ? `<button type="button" id="modal-archive-btn" class="card-act card-act--archive" title="Move to Archive" aria-label="Move to Archive">${CARD_ICONS.delete}</button>`
        : '';
    const lastBtn = isPopout
        ? windowSizeBtn
        : `<button type="button" class="card-act ${lastClass}"${lastId} title="${escapeHTML(expandTitle).replace(/"/g, "")}" aria-label="${escapeHTML(expandTitle).replace(/"/g, "")}">${lastIcon}</button>`;
    const actionsHtml = `<div class="card-actions${(isModal || isPopout) ? ' modal-card-actions' : ''}" data-action-count="${actionCount}" data-surface="${surface}">
            ${popBtn}
            ${calBtn}
            ${closeBtn}
            ${popinBtn}
            <button type="button" class="card-act card-act--emoji" title="Insert emoji" aria-label="Insert emoji" aria-haspopup="dialog" aria-expanded="false">${CARD_ICONS.insertEmoji}</button>
            <button type="button" class="card-act card-act--copy" title="Copy note as text" aria-label="Copy note as text">${CARD_ICONS.copy}</button>
            ${pinBtn}
            <button type="button" class="card-act card-act--color" title="Note color" aria-label="Note color" aria-haspopup="dialog">${CARD_ICONS.color}</button>
            ${hideBtn}
            ${editBtn}
            ${dragBtn}

            ${lastBtn}
        </div>`;
    return (isModal || isPopout) ? `${archiveBtn}${actionsHtml}` : actionsHtml;
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

export function buildNoteBodyHtml(item, { canEdit = false, inModalEditor = false, richEdit = false } = {}) {
    const template = resolveNoteTemplate(item);

    if (template === 'sheet') {
        ensureItemSheet(item, defaultSheetDimsForTemplate('sheet'));
        return renderSheetHtml(item.sheet, { canEdit, inModalEditor });
    }

    if (template === 'meeting') {
        return buildMeetingBodyHtml(item, { canEdit, inModalEditor, richEdit });
    }

    let html = '';
    const { showContent, showChecklist } = resolveNoteBodyVisibility(item, { canEdit, inModalEditor });

    if (showContent) {
        const content = item.content || '';
        const rich = hasRichMarkup(content) || content.includes('\u2028');
        if (canEdit && (richEdit || canInlineEditText(content, { richEdit }))) {
            const inner = richEdit ? sanitizeRichHtml(content) : escapeHTML(content.replace(/\u2028/g, '\n'));
            const ce = richEdit ? 'true' : 'plaintext-only';
            const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
            html += `<div class="card-content-preview card-inline-edit${richClasses}" contenteditable="${ce}" spellcheck="false" data-field="content" data-placeholder="Add note…">${inner}</div>`;
        } else {
            const richClass = rich ? ' rich-text' : '';
            html += `<div class="card-content-preview${richClass}">${renderRichHtml(content)}</div>`;
        }
    }

    if (showChecklist) {
        if (!item.steps) item.steps = [];
        html += buildExpandedChecklistHtml(item, canEdit, { richEdit });
    }
    return html;
}

function renderRichHtml(str) {
    if (!str) return '';
    const prepared = String(str).replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
    if (hasRichMarkup(prepared)) return sanitizeRichHtml(prepared);
    return sanitizeRichHtml(escapeHTML(prepared));
}

function canInlineEditText(text, { richEdit = false } = {}) {
    if (richEdit) return true;
    return !hasRichMarkup(text);
}

function prepareContentForEdit(content) {
    const prepared = String(content || '').replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
    if (hasRichMarkup(prepared)) return sanitizeRichHtml(prepared);
    return sanitizeRichHtml(escapeHTML(prepared));
}

function buildNoteBodySection(title, innerHtml) {
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

function bindNoteBodySections(root) {
    if (!root || root.dataset.noteSectionsBound === '1') return;
    root.dataset.noteSectionsBound = '1';
    root.querySelectorAll('.note-body-section .note-section-header').forEach((header) => {
        header.addEventListener('click', (e) => {
            e.stopPropagation();
            const body = header.nextElementSibling;
            const toggle = header.querySelector('.collapsable-toggle');
            const collapsed = body?.classList.toggle('collapsed');
            toggle?.classList.toggle('collapsed');
            if (!collapsed) {
                body?.querySelectorAll('[data-sheet-block]').forEach((block) => growSheetCells(block));
            }
        });
    });
}

function growSheetCells(block) {
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

function buildMeetingBodyHtml(item, { canEdit = false, inModalEditor = false, richEdit = false } = {}) {
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
    return html;
}

function formatMeetingDateTimeBadge(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function resolveNoteTemplate(item) {
    if (!item) return 'default';
    if (item.noteTemplate === 'sheet') return 'sheet';
    if (item.noteTemplate === 'meeting') return 'meeting';
    return 'default';
}

function buildNoteTitleHtml(item, canEdit, { richEdit = false } = {}) {
    const fullTitle = item.title || '';
    const titleAttr = stripRichText(fullTitle);

    if (canEdit && (richEdit || canInlineEditText(fullTitle, { richEdit }))) {
        const inner = richEdit ? sanitizeRichHtml(fullTitle) : escapeHTML(fullTitle);
        const ce = richEdit ? 'true' : 'plaintext-only';
        const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
        return `<div class="mini-card-title card-inline-edit${richClasses}" contenteditable="${ce}" spellcheck="false" data-field="title" data-placeholder="Title…">${inner}</div>`;
    }

    const richClass = hasRichMarkup(fullTitle) ? ' rich-text' : '';
    return `<div class="mini-card-title${richClass}" title="${escapeAttr(titleAttr)}">${renderRichHtml(fullTitle)}</div>`;
}

function buildNoteFormatPanelHtml(item = null) {
    return `
            <div class="editor-panel editor-panel--format">
                <div class="collapsable-header" id="format-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Formatting</span>
                </div>
                <div class="collapsable-section collapsed" id="format-section">
                    <div class="format-toolbar">
                        <button type="button" class="format-btn card-act" data-format-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold">${FORMAT_ICONS.bold}</button>
                        <button type="button" class="format-btn card-act" data-format-cmd="italic" title="Italic (Ctrl+I)" aria-label="Italic">${FORMAT_ICONS.italic}</button>
                        <button type="button" class="format-btn card-act" data-format-cmd="strikeThrough" title="Strikethrough (Ctrl+Shift+S)" aria-label="Strikethrough">${FORMAT_ICONS.strike}</button>
                        <span class="format-toolbar-sep" aria-hidden="true"></span>
                        <button type="button" class="format-btn card-act" data-zoom="down" title="Smaller text" aria-label="Smaller text">${FORMAT_ICONS.smaller}</button>
                        <input type="text" id="format-zoom-input" class="format-zoom-input" inputmode="numeric" title="Text size (100 = default)" aria-label="Text size" value="100">
                        <button type="button" class="format-btn card-act" data-zoom="up" title="Larger text" aria-label="Larger text">${FORMAT_ICONS.larger}</button>
                        <button type="button" class="format-btn card-act" data-zoom="reset" title="Reset text size" aria-label="Reset text size">${ACTION_ICONS.layoutReset}</button>
                        ${item ? buildNoteBodyConvertButtonsHtml(item) : ''}
                    </div>
                </div>
            </div>
        `;
}

export function buildNoteMetaFooterHtml(item, { targetCatName = '', categoryColor = UNCATEGORIZED_COLOR } = {}) {
    const createdLabel = formatCreatedDate(item.created_at);
    const modifiedLabel = formatModifiedDate(item.updated_at);
    const sizeLabel = computeNoteSizeKb(item);
    const lineLabel = formatNoteLineCount(computeNoteLineCount(item));
    const createdHtml = createdLabel
        ? `<span class="editor-created-date" title="Created">${createdLabel}</span>`
        : '';
    const modifiedHtml = modifiedLabel
        ? `<span class="editor-modified-date" title="Last modified">${modifiedLabel}</span>`
        : '';
    const sizeHtml = `<span class="editor-note-size" title="Note content size">${sizeLabel} KB</span>`;
    const lineHtml = `<span class="editor-note-lines" title="Number of lines">${lineLabel}</span>`;
    const statsHtml = `${sizeHtml}${lineHtml}${createdHtml}${modifiedHtml}`;

    return `
            <div class="editor-meta-row editor-meta-row--footer editor-meta-row--inline">
                <span class="editor-meta-badges">
                    <span class="badge-dot" style="background-color: ${categoryColor};" title="${escapeAttr(targetCatName || 'Uncategorized')}"></span>
                    ${targetCatName ? `<span class="category-name">${escapeHTML(targetCatName)}</span>` : ''}
                </span>
                <span class="editor-meta-stats">
                    ${statsHtml}
                </span>
            </div>
        `;
}

function formatCreatedDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatModifiedDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildNoteConfigPanelHtml(item, { categoryOptionsHtml = '', startParts = {}, endParts = {} } = {}) {
    const template = resolveNoteTemplate(item);
    const templateDefault = template === 'default' ? 'selected' : '';
    const templateSheet = template === 'sheet' ? 'selected' : '';
    const templateMeeting = template === 'meeting' ? 'selected' : '';
    return `
            <div class="editor-panel editor-panel--config">
                <div class="collapsable-header" id="config-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Configuration</span>
                </div>
                <div class="collapsable-section collapsed" id="config-section">
                    <div class="form-row-grid form-row-grid--2">
                        <div class="form-group form-group--compact">
                            <label for="edit-template">Template</label>
                            <select id="edit-template" class="form-input">
                                <option value="default" ${templateDefault}>Note / Checklist</option>
                                <option value="sheet" ${templateSheet}>Sheet</option>
                                <option value="meeting" ${templateMeeting}>Meeting</option>
                            </select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Visibility</label>
                            <select id="edit-visibility" class="form-input">
                                <option value="private" ${item.visibility === 'private' ? 'selected' : ''}>Private</option>
                                <option value="public" ${item.visibility === 'public' ? 'selected' : ''}>Public</option>
                            </select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Start</label>
                            <div class="datetime-input-row">
                                <input type="date" id="edit-start-date" class="form-input" value="${startParts.date || ''}">
                                <input type="time" id="edit-start-time" class="form-input form-input--optional-time" value="${startParts.time || ''}" step="60" title="Optional — leave blank for date only">
                            </div>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>End</label>
                            <div class="datetime-input-row">
                                <input type="date" id="edit-end-date" class="form-input" value="${endParts.date || ''}">
                                <input type="time" id="edit-end-time" class="form-input form-input--optional-time" value="${endParts.time || ''}" step="60" title="Optional — leave blank for date only">
                            </div>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Category</label>
                            <select id="edit-category" class="form-input">${categoryOptionsHtml}</select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Status</label>
                            <select id="edit-status" class="form-input">
                                <option value="active" ${item.status === 'active' ? 'selected' : ''}>Active</option>
                                <option value="archived" ${item.status === 'archived' ? 'selected' : ''}>Archived</option>
                                <option value="completed" ${item.status === 'completed' ? 'selected' : ''}>Done</option>
                            </select>
                        </div>
                    </div>
                </div>
            </div>
        `;
}

function buildNoteEditorShell(item, {
    canEdit = false,
    inModalEditor = false,
    showConfig = false,
    showFormat = false,
    richEdit = false,
    toolbarHtml = '',
    toplineDragZone = '',
    footerDragZone = '',
    targetCatName = '',
    categoryColor = UNCATEGORIZED_COLOR,
    categoryOptionsHtml = '',
    startParts = {},
    endParts = {},
    bodyId = ''
} = {}) {
    const titleHtml = buildNoteTitleHtml(item, canEdit, { richEdit });
    const bodyHtml = buildNoteBodyHtml(item, {
        canEdit,
        inModalEditor,
        richEdit
    });
    const formatHtml = showFormat ? buildNoteFormatPanelHtml(item) : '';
    const configHtml = showConfig
        ? buildNoteConfigPanelHtml(item, { categoryOptionsHtml, startParts, endParts })
        : '';
    const metaHtml = buildNoteMetaFooterHtml(item, {
        targetCatName,
        categoryColor
    });
    const bodyIdAttr = bodyId ? ` id="${bodyId}"` : '';
    const toplineClass = toplineDragZone || footerDragZone || '';
    const toplineHtml = `
                <div class="editor-note-topline${toplineClass}">
                    <div class="editor-note-header">
                        ${titleHtml}
                    </div>
                    ${toolbarHtml ? `<div class="note-editor-toolbar">${toolbarHtml}</div>` : ''}
                </div>`;

    return `
            <div class="editor-note-shell note-surface">
                ${toplineHtml}
                ${formatHtml}
                ${configHtml}
                <div class="card-body editor-note-body"${bodyIdAttr}>
                    ${bodyHtml}
                </div>
                <div class="${footerDragZone ? `editor-meta-wrap${footerDragZone}` : 'editor-meta-wrap'}">
                    ${metaHtml}
                </div>
            </div>
        `;
}

function bindCollapsable(headerId, sectionId, startCollapsed = false) {
    const header = document.getElementById(headerId);
    const section = document.getElementById(sectionId);
    if (!header || !section) return;

    const toggle = header.querySelector('.collapsable-toggle');
    if (startCollapsed) {
        section.classList.add('collapsed');
        toggle?.classList.add('collapsed');
    }

    header.addEventListener('click', () => {
        section.classList.toggle('collapsed');
        toggle?.classList.toggle('collapsed');
    });
}

function flashCopyFeedback(btn, message = 'Copied!', { failed = false } = {}) {
    if (!btn) return;
    if (btn.dataset.copyFlashTimer) {
        clearTimeout(Number(btn.dataset.copyFlashTimer));
        delete btn.dataset.copyFlashTimer;
    }

    const row = btn.closest('.step-row--display');
    const prevTitle = btn.getAttribute('title');
    const prevLabel = btn.getAttribute('aria-label');
    const prevHtml = btn.innerHTML;
    const isCopyBtn = btn.classList.contains('step-copy-btn') || btn.classList.contains('card-act--copy');

    btn.classList.remove('is-copy-flashed', 'is-copy-flash-failed');
    row?.classList.remove('is-copy-row-flashed');
    btn.classList.add(failed ? 'is-copy-flash-failed' : 'is-copy-flashed');
    if (!failed) row?.classList.add('is-copy-row-flashed');

    if (isCopyBtn && !failed) btn.innerHTML = CARD_ICONS.save;
    btn.setAttribute('title', message);
    btn.setAttribute('aria-label', message);

    btn.dataset.copyFlashTimer = String(window.setTimeout(() => {
        btn.classList.remove('is-copy-flashed', 'is-copy-flash-failed');
        row?.classList.remove('is-copy-row-flashed');
        if (isCopyBtn && !failed) btn.innerHTML = prevHtml;
        if (prevTitle != null) btn.setAttribute('title', prevTitle);
        else btn.removeAttribute('title');
        if (prevLabel != null) btn.setAttribute('aria-label', prevLabel);
        else btn.removeAttribute('aria-label');
        delete btn.dataset.copyFlashTimer;
    }, 1400));
}

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

/**
 * Refresh the checklist portion of a note body (re-render checklist HTML
 * and re-bind interactions). Used by the modal editor after checklist
 * mutations (add/delete/reorder/indent/etc.).
 *
 * @param {HTMLElement} body - the .editor-note-body element
 * @param {object} item - the note item
 * @param {object} opts
 * @param {HTMLElement} [opts.mountZone] - the modal form mount (parent of shell)
 * @param {HTMLElement} [opts.shell] - the .editor-note-shell element
 * @param {boolean} [opts.localOnly]
 * @param {boolean} [opts.richEdit]
 * @param {Function} [opts.onChange]
 * @param {Function} [opts.refresh]
 * @param {object} [opts.sheetInteractionOpts]
 */
export function refreshNoteBody(body, item, {
    mountZone,
    shell,
    localOnly = false,
    richEdit = false,
    onChange = () => {},
    refresh = () => {},
    sheetInteractionOpts = null
} = {}) {
    if (!body || !item) return;
    const { showChecklist } = resolveNoteBodyVisibility(item, {
        canEdit: true,
        inModalEditor: !!mountZone?.closest('#editor-overlay')
    });
    if (!showChecklist) return;

    // Re-render only the checklist section
    const expandedChecklist = body.querySelector('.expanded-checklist');
    if (!expandedChecklist) return;

    // Get focus state before re-render
    const pendingFocusStepId = body.dataset.pendingFocusStepId || '';
    const pendingFocusEdge = body.dataset.pendingFocusEdge || 'end';
    delete body.dataset.pendingFocusStepId;
    delete body.dataset.pendingFocusEdge;

    // Capture scroll position before re-render to prevent view jump
    // For modal editor, use the body element itself; for board, the canvas scroll is handled separately
    const scrollContainer = body;
    const cachedScrollTop = scrollContainer.scrollTop;
    const cachedScrollLeft = scrollContainer.scrollLeft;

    // Re-render the checklist section
    expandedChecklist.outerHTML = buildExpandedChecklistHtml(item, true, { richEdit });

    // Restore scroll position after re-render
    if (scrollContainer.scrollTop !== cachedScrollTop) {
        scrollContainer.scrollTop = cachedScrollTop;
    }
    if (scrollContainer.scrollLeft !== cachedScrollLeft) {
        scrollContainer.scrollLeft = cachedScrollLeft;
    }

    // Focus and scroll restoration in a single frame
    const focusStepId = pendingFocusStepId;
    if (focusStepId) {
        const stepTextEl = body.querySelector(`.step-text.card-inline-edit[data-step-id="${focusStepId}"]`);
        if (stepTextEl) {
            stepTextEl.focus({ preventScroll: true });
            const range = document.createRange();
            range.selectNodeContents(stepTextEl);
            if (pendingFocusEdge === 'end') {
                range.setStart(stepTextEl, stepTextEl.childNodes.length);
                range.setEnd(stepTextEl, stepTextEl.childNodes.length);
            } else {
                range.collapse(true);
            }
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }

    // Re-bind interactions
    if (mountZone) {
        const newShell = mountZone.querySelector('.editor-note-shell');
        if (newShell) {
            const newBody = newShell.querySelector('.editor-note-body');
            if (newBody) {
                if (newBody.dataset.checklistInteractionsBound !== item.id) {
                    bindChecklistInteractions(newBody, item, {
                        localOnly,
                        onChange,
                        refresh: localOnly ? () => refresh() : () => {}
                    });
                }
                if (newBody.dataset.checklistDragBound !== item.id) {
                    attachChecklistDrag(newBody, item, {
                        localOnly,
                        onChange,
                        refresh: localOnly ? () => refresh() : () => {}
                    });
                }
            }
        }
    }
}

/**
 * Applies card background/theme styling.
 * Sets non-left border colors only so the category band (left) stays CSS-owned.
 * @param {HTMLElement} card - The card element
 * @param {Object} item - The note item
 */
export function applyItemCardTheme(card, item) {
    const color = resolveNoteColor(item.backgroundColor);
    const edge = 'rgba(255,255,255,0.15)';
    card.style.borderTopColor = edge;
    card.style.borderRightColor = edge;
    card.style.borderBottomColor = edge;
    // Apply custom background to the editor-note-shell for consistent styling
    const shell = card.querySelector('.editor-note-shell');
    if (shell) {
        applyCardTheme(shell, color, { paintBackground: true });
    }
}

/**
 * Sets the category color band via CSS variable and clears legacy inline left-border paint.
 * CSS owns the left band via `--card-category-color`; do not set borderLeftColor.
 * @param {HTMLElement} card - The card element
 * @param {string} categoryColor - Resolved category color
 */
export function applyCardCategoryBand(card, categoryColor) {
    if (!card) return;
    card.style.setProperty('--card-category-color', categoryColor || UNCATEGORIZED_COLOR);
    card.style.removeProperty('border-left-color');
}

/**
 * Creates a card DOM element for a note item
 * @param {Object} uiInstance - The UI object with helper methods
 * @param {Object} item - The note item
 * @param {Array} activeCategories - Active categories array
 * @returns {HTMLElement} The created card element
 */
export function createCardComponent(uiInstance, item, activeCategories) {
    const card = document.createElement('div');
    card.classList.add('mini-card');
    card.dataset.id = item.id;
    card.dataset.desktop = String(item.desktopId || 1);

    const { targetCatName, categoryColor } = getCardRenderContext(item, activeCategories);

    renderBoardEditorCard(uiInstance, card, item, activeCategories, targetCatName, categoryColor);
    applyItemCardTheme(card, item);
    applyCardCategoryBand(card, categoryColor);
    card.addEventListener('mousedown', () => uiInstance.raiseDesktopCard(card), true);
    uiInstance.syncBoardPinClass(card);
    return card;
}

/**
 * Renders the inner HTML of a board editor card
 * @param {Object} uiInstance - The UI object with helper methods
 * @param {HTMLElement} card - The card element
 * @param {Object} item - The note item
 * @param {Array} activeCategories - Active categories array
 * @param {string} targetCatName - Target category name
 * @param {string} categoryColor - Category color
 */
export function renderBoardEditorCard(uiInstance, card, item, activeCategories, targetCatName, categoryColor) {
    const lockedByPopout = NotePopoutBridge.isClaimedByOther(item?.id);
    const canEdit = NoteSurface.canEditInline() && !lockedByPopout;
    const dotColor = targetCatName ? categoryColor : UNCATEGORIZED_COLOR;
    const dragZone = ' card-drag-zone';

    card.classList.toggle('is-popout-locked', lockedByPopout);
    card.innerHTML = NoteSurface.buildNoteEditorShell(item, {
        canEdit,
        richEdit: true,
        toolbarHtml: uiInstance.buildCardActionsHtml(item, false, uiInstance.getCardActionsOptions(card)),
        toplineDragZone: dragZone,
        footerDragZone: dragZone,
        targetCatName,
        categoryColor: dotColor
    });

    if (lockedByPopout) {
        const shell = card.querySelector('.editor-note-shell');
        if (shell && !shell.querySelector('.note-popout-lock-banner')) {
            const banner = document.createElement('button');
            banner.type = 'button';
            banner.className = 'note-popout-lock-banner';
            banner.textContent = 'Editing in popout — click to focus';
            banner.addEventListener('click', (e) => {
                e.stopPropagation();
                NotePopoutBridge.openOrFocus(item.id);
            });
            shell.insertBefore(banner, shell.firstChild);
        }
    }

    bindNoteQuickActions(card, item, {
        surface: 'board',
        ui: uiInstance,
        card,
        ctx: {
            activeCategories,
            targetCatName,
            categoryColor
        }
    });
    
    // Create onChange callback for format commands on board surface
    // This ensures undo/redo tracking works for format commands
    const onChange = () => {
        if (NotePopoutBridge.isClaimedByOther(item?.id)) return;
        const shell = card.querySelector('.editor-note-shell');
        if (shell && item) {
            flushDesktopAutoSave(shell, item, { mergeWindow: false });

        }
    };
    
    NoteSurface.bindNoteEditorShell(card, item, {
        richEdit: true,
        onChange,
        refresh: () => {
            const body = card.querySelector('.editor-note-body');
            if (body?.querySelector('.expanded-checklist')) {
                refreshBoardChecklistBody(uiInstance, card, item, activeCategories, targetCatName, categoryColor);
                return;
            }
            refreshBoardEditorCard(uiInstance, card, item, activeCategories, targetCatName, categoryColor);
        },
        stopMousedownPropagation: true,
        onRaiseCard: (c) => uiInstance.raiseDesktopCard(c)
    });
    uiInstance.bindBoardEditorFocusChrome(card);
    uiInstance.finalizeDesktopCard(card);
    uiInstance.syncBoardPinClass(card);
    uiInstance.focusPendingBoardField(card);
}

/**
 * Refreshes the checklist body of a board card
 * @param {Object} uiInstance - The UI object with helper methods
 * @param {HTMLElement} card - The card element
 * @param {Object} item - The note item
 * @param {Array} activeCategories - Active categories array
 * @param {string} targetCatName - Target category name
 * @param {string} categoryColor - Category color
 */
export function refreshBoardChecklistBody(uiInstance, card, item, activeCategories, targetCatName, categoryColor) {
    const body = card.querySelector('.editor-note-body');
    const shell = card.querySelector('.editor-note-shell');
    if (!body || !item) return;
    
    // Capture canvas scroll position before any updates to prevent view jump
    const canvas = document.getElementById('app-canvas');
    const canvasScrollTop = canvas?.scrollTop ?? 0;
    const canvasScrollLeft = canvas?.scrollLeft ?? 0;
    
    if (shell) NoteSurface.syncItemBodyFromDom(shell, item);
    // Note: refreshNoteBody already handles re-binding interactions internally
    // and we don't pass refresh callback to avoid double refresh
    NoteSurface.refreshNoteBody(body, item, {
        mountZone: card,
        shell,
        localOnly: true,
        richEdit: true
    });
    
    // Restore canvas scroll position immediately after update
    if (canvas) {
        canvas.scrollTop = canvasScrollTop;
        canvas.scrollLeft = canvasScrollLeft;
    }
}

/**
 * Refreshes a board editor card (full re-render)
 * @param {Object} uiInstance - The UI object with helper methods
 * @param {HTMLElement} card - The card element
 * @param {Object} item - The note item
 * @param {Array} activeCategories - Active categories array
 * @param {string} targetCatName - Target category name
 * @param {string} categoryColor - Category color
 */
export function refreshBoardEditorCard(uiInstance, card, item, activeCategories, targetCatName, categoryColor) {
    const body = card.querySelector('.editor-note-body');
    const focusState = body ? NoteSurface.captureNoteBodyFocusState(body) : null;
    const shell = card.querySelector('.editor-note-shell');
    
    // Capture canvas scroll position before full re-render to prevent view jump
    const canvas = document.getElementById('app-canvas');
    const canvasScrollTop = canvas?.scrollTop ?? 0;
    const canvasScrollLeft = canvas?.scrollLeft ?? 0;
    
    if (shell && !card.dataset.pendingFocusStepId) {
        NoteSurface.syncItemBodyFromDom(shell, item);
    }
    const pendingFocusStepId = card.dataset.pendingFocusStepId;
    renderBoardEditorCard(uiInstance, card, item, activeCategories, targetCatName, categoryColor);
    const newBody = card.querySelector('.editor-note-body');
    if (newBody && focusState) {
        NoteSurface.restoreNoteBodyFocusState(newBody, card, focusState);
    }
    if (pendingFocusStepId) {
        card.dataset.pendingFocusStepId = pendingFocusStepId;
        NoteSurface.focusPendingChecklistStep(card);
    }
    // Restore canvas scroll position after full re-render
    if (canvas) {
        canvas.scrollTop = canvasScrollTop;
        canvas.scrollLeft = canvasScrollLeft;
    }
}

export {
    computeNoteSizeKb,
    computeNoteLineCount,
    formatNoteLineCount,
    renderRichHtml,
    canInlineEditText,
    prepareContentForEdit,
    buildNoteBodySection,
    bindNoteBodySections,
    buildMeetingBodyHtml,
    buildNoteTitleHtml,
    buildNoteFormatPanelHtml,
    buildNoteConfigPanelHtml,
    buildNoteEditorShell,
    bindCollapsable,
    flashCopyFeedback,
    buildChecklistRowHtml,
};