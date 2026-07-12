/** @module {"owns":"note HTML building and rendering", "related":["noteSurface.js","noteModel.js","sheet.js","checklistSteps.js"], "events":[]} */
import { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS } from './icons.js';
import { UNCATEGORIZED_COLOR } from './categories.js';
import { stripRichText, hasRichMarkup, sanitizeRichHtml } from './richText.js';
import { isSheetTemplateActive, renderSheetHtml, defaultSheetDimsForTemplate, ensureItemSheet } from './sheet.js';
import { contentHasConvertibleText, stepsHaveConvertibleText } from './noteBodyConversion.js';
import { getStepLevel, partitionChecklistSteps, checklistHasIndentations, stepHasDescendants, buildVisibleChecklistSteps, annotateChecklistTreeGuides, canIndentStep } from './checklistSteps.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { isFileCabinetActive, getFileCabinetToggleLabels } from './fileCabinet.js';
import { LEGACY_TILE_SIZE } from './tileGeometry.js';
import { bindChecklistInteractions, attachChecklistDrag, getChecklistCollapsedKeys, getChecklistDoneCollapsed, isChecklistDoneSectionCollapsed, toggleChecklistDoneSection, getChecklistCollapsibleKeys, checklistGroupsAnyExpanded, collapseAllChecklistGroups, expandAllChecklistGroups, toggleChecklistExpandCollapseAll, buildChecklistExpandCollapseAllHtml, buildChecklistRowHtml } from './noteSurfaceChecklist.js';
import { focusInlineEdit, setCaretAtPlainOffset } from './noteSurfaceEditing.js';

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
    calHidden = !!(item?.hideFromCalendar)
} = {}) {
    const isModal = surface === 'modal';
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
    const pinBtn = `<button type="button" class="card-act card-act--pin${pinned ? ' is-active' : ''}" title="${pinTitle}" aria-label="${pinTitle}" aria-pressed="${pinned ? 'true' : 'false'}">${pinned ? CARD_ICONS.unpin : CARD_ICONS.pin}</button>`;
    const calTitle = calHidden
        ? 'Hidden from calendar — click to show'
        : 'Shown on calendar — click to hide';
    const calBtn = `<button type="button" class="card-act card-act--cal${calHidden ? ' is-off' : ' is-on'}" title="${escapeAttr(calTitle)}" aria-label="${escapeAttr(calTitle)}">${CARD_ICONS.calendar}</button>`;
    const showDragIcon = isModal ? true : (showDrag && !pinned);
    const dragBtn = showDragIcon
        ? `<button type="button" class="card-act card-act--drag${isModal ? ' card-act--decorative' : ''}" title="Drag to move" aria-label="Drag to move"${isModal ? ' tabindex="-1" aria-hidden="true"' : ''}>${CARD_ICONS.drag}</button>`
        : '';
    let actionCount = 8;
    if (showDragIcon) actionCount += 1;
    if (showArchive) actionCount += 1;
    const archiveBtn = showArchive
        ? `<button type="button" id="modal-archive-btn" class="card-act card-act--archive" title="Archive note" aria-label="Archive note">${CARD_ICONS.delete}</button>`
        : '';
    const actionsHtml = `<div class="card-actions${isModal ? ' modal-card-actions' : ''}" data-action-count="${actionCount}" data-surface="${surface}">
            ${calBtn}
            <button type="button" class="card-act card-act--emoji" title="Insert emoji" aria-label="Insert emoji" aria-haspopup="dialog" aria-expanded="false">${CARD_ICONS.insertEmoji}</button>
            <button type="button" class="card-act card-act--copy" title="Copy note as text" aria-label="Copy note as text">${CARD_ICONS.copy}</button>
            ${pinBtn}
            <button type="button" class="card-act card-act--color" title="Note color" aria-label="Note color" aria-haspopup="dialog">${CARD_ICONS.color}</button>
            <button type="button" class="card-act card-act--hide" title="Hide from board" aria-label="Hide from board">${CARD_ICONS.hide}</button>
            <button type="button" class="card-act card-act--edit" title="Edit note" aria-label="Edit note">${CARD_ICONS.edit}</button>
            ${dragBtn}
            <button type="button" class="card-act ${lastClass}"${lastId} title="${escapeHTML(expandTitle).replace(/"/g, "")}" aria-label="${escapeHTML(expandTitle).replace(/"/g, "")}">${lastIcon}</button>
        </div>`;
    return isModal ? `${archiveBtn}${actionsHtml}` : actionsHtml;
}

function isCollapsedSpatialSize(w, h, tileSize) {
    if (!tileSize) return false;
    const small = getSmallRect(readTileSmallFootprint());
    return w <= small.w && h <= small.h;
}

function getSmallRect(footprint) {
    if (!footprint) return { w: 120, h: 60 };
    return { w: footprint.w || 120, h: footprint.h || 60 };
}

function readTileSmallFootprint() {
    try {
        return JSON.parse(localStorage.getItem('matrix_tile_footprint') || '{"w":120,"h":60}');
    } catch {
        return { w: 120, h: 60 };
    }
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
        return {
            showContent: layout !== 'checklist'
                && (hasContent || layout === 'both' || layout === 'content'),
            showChecklist: layout !== 'content'
                && (layout === 'both' || layout === 'checklist' || (item.steps && item.steps.length > 0))
        };
    }
    return {
        showContent: !!hasContent,
        showChecklist: item.type === 'checklist' && item.steps && item.steps.length > 0
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
    const sizeLabel = computeNoteSizeKb(item);
    const lineLabel = formatNoteLineCount(computeNoteLineCount(item));
    const createdHtml = createdLabel
        ? `<span class="editor-created-date" title="Created">Created ${createdLabel}</span>`
        : '';
    const sizeHtml = `<span class="editor-note-size" title="Note content size">${sizeLabel} KB</span>`;
    const lineHtml = `<span class="editor-note-lines" title="Number of lines">${lineLabel}</span>`;
    const statsHtml = `${sizeHtml}${lineHtml}${createdHtml}`;

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
        done.forEach((step) => {
            html += buildChecklistRowHtml(step, {
                hasKids: false,
                isCollapsed: false,
                collapseKey: '',
                isDoneSection: true,
                treeGuides: [],
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

function findChecklistScrollContainer(body) {
    if (!body) return null;
    // For desktop cards on the board canvas, return the canvas itself as scroll container
    // since cards have overflow: hidden and the canvas is what scrolls
    const card = body.closest('.mini-card[data-desktop="1"]');
    if (card) {
        const canvas = document.getElementById('app-canvas');
        if (canvas) return canvas;
    }
    // For modal editor, check CSS overflow-y property to identify the correct scroll container
    const computedStyle = window.getComputedStyle(body);
    if (computedStyle.overflowY === 'auto' || computedStyle.overflowY === 'scroll') return body;
    if (body.scrollHeight > body.clientHeight) return body;
    const modal = body.closest('.modal-body');
    if (modal && modal.scrollHeight > modal.clientHeight) return modal;
    return body;
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

    const scrollContainer = findChecklistScrollContainer(body);
    const scrollTop = scrollContainer?.scrollTop ?? 0;

    const activeStep = body.contains(document.activeElement)
        ? document.activeElement.closest('.step-row--display')
        : null;
    const activeStepId = activeStep?.dataset?.stepId;
    const pendingFocusStepId = body.dataset.pendingFocusStepId || '';
    const pendingFocusEdge = body.dataset.pendingFocusEdge || 'end';
    const pendingFocusPlainOffset = body.dataset.pendingFocusPlainOffset;
    delete body.dataset.pendingFocusStepId;
    delete body.dataset.pendingFocusEdge;
    delete body.dataset.pendingFocusPlainOffset;

    // Re-render only the checklist section
    expandedChecklist.outerHTML = buildExpandedChecklistHtml(item, true, { richEdit });

    // Restore scroll position synchronously to prevent scroll jump
    if (scrollContainer) scrollContainer.scrollTop = scrollTop;

    // Focus restoration - use preventScroll to avoid jumping
    const restoreView = () => {
        const focusStepId = pendingFocusStepId || activeStepId;
        if (!focusStepId) return;
        // Fixed selector: data-step-id is on the .step-text element itself, not on a parent
        const stepTextEl = body.querySelector(
            `.step-text.card-inline-edit[data-step-id="${focusStepId}"]`
        );
        if (stepTextEl && document.activeElement !== stepTextEl) {
            // Prevent scroll jump by using preventScroll option
            stepTextEl.focus({ preventScroll: true });
            // Set caret position after focus
            const edge = pendingFocusPlainOffset != null ? null : pendingFocusEdge;
            if (pendingFocusPlainOffset != null) {
                setCaretAtPlainOffset(stepTextEl, Number(pendingFocusPlainOffset));
            } else if (edge) {
                const range = document.createRange();
                range.selectNodeContents(stepTextEl);
                if (edge === 'end') {
                    // Move selection strictly to the end of the text/child strings
                    range.setStart(stepTextEl, stepTextEl.childNodes.length);
                    range.setEnd(stepTextEl, stepTextEl.childNodes.length);
                } else {
                    range.collapse(true); // 'start'
                }
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            }
        }
    };
    // Use microtask to ensure DOM is ready but before browser paint
    queueMicrotask(() => {
        restoreView();
    });

    // Re-bind interactions
    if (mountZone) {
        const newShell = mountZone.querySelector('.editor-note-shell');
        if (newShell) {
            const newBody = newShell.querySelector('.editor-note-body');
            if (newBody && newBody.dataset.checklistInteractionsBound !== item.id) {
                bindChecklistInteractions(newBody, item, {
                    localOnly,
                    onChange,
                    refresh: localOnly ? () => refresh() : () => {}
                });
                attachChecklistDrag(newBody, item, {
                    localOnly,
                    onChange,
                    refresh: localOnly ? () => refresh() : () => {}
                });
            }
        }
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
    // removed
    buildNoteConfigPanelHtml,
    buildNoteEditorShell,
    bindCollapsable,
    flashCopyFeedback,
    buildChecklistRowHtml,
    findChecklistScrollContainer,
};