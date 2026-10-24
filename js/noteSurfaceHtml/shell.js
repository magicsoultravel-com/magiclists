/** @module {"owns":"note editor shell - the title bar, format/config side panels, meta footer assembly and the copy-feedback flash", "related":["noteSurfaceHtml.js","noteSurfaceHtml/body.js","noteSurfaceHtml/metaFooter.js"]} */
import { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS } from '../icons.js';
import { UNCATEGORIZED_COLOR } from '../categories.js';
import { stripRichText, hasRichMarkup, sanitizeRichHtml } from '../richText.js';
import { escapeHTML, escapeAttr } from '../domEscape.js';
import { buildNoteMetaFooterHtml } from './metaFooter.js';
import {
    buildNoteBodyHtml,
    renderRichHtml,
    canInlineEditText,
    resolveNoteTemplate,
    buildNoteBodyConvertButtonsHtml
} from './body.js';

export function buildNoteTitleHtml(item, canEdit, { richEdit = false } = {}) {
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

export function buildNoteFormatPanelHtml(item = null) {
    return `
            <div class="editor-panel editor-panel--format">
                <div class="collapsable-header" id="format-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Formatting</span>
                </div>
                <div class="collapsable-section collapsed" id="format-section">
                    <div class="format-toolbar">
                        <button type="button" class="format-btn card-act" data-format-cmd="bold" title="Bold (Ctrl+B)" aria-label="Bold">${FORMAT_ICONS.bold}</button>
                        <button type="button" class="format-btn card-act" data-format-cmd="italic" title="Italic (Ctrl+I)" aria-label="Italic">${FORMAT_ICONS.italic}</button>
                        <button type="button" class="format-btn card-act" data-format-cmd="underline" title="Underline (Ctrl+U)" aria-label="Underline">${FORMAT_ICONS.underline}</button>
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

export function buildNoteConfigPanelHtml(item, { categoryOptionsHtml = '', startParts = {}, endParts = {} } = {}) {
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

export function buildNoteEditorShell(item, {
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

export function bindCollapsable(headerId, sectionId, startCollapsed = false) {
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

export function flashCopyFeedback(btn, message = 'Copied!', { failed = false } = {}) {
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
