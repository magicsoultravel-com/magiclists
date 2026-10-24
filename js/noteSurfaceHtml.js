/** @module {"owns":"note HTML building and rendering", "related":["noteSurface.js","noteModel.js","sheet.js","checklistSteps.js"], "events":[]} */
import { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS } from './icons.js';
import { UNCATEGORIZED_COLOR } from './categories.js';
import { stripRichText, hasRichMarkup, sanitizeRichHtml } from './richText.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { bindChecklistInteractions, attachChecklistDrag, buildChecklistRowHtml } from './noteSurfaceChecklist.js';
import { applyCardTheme } from './cardTheme.js';
import { resolveNoteColor } from './colorPicker.js';
import { NoteSurface } from './noteSurface.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import { NotePopoutBridge } from './notePopoutBridge.js';
import { getCardRenderContext } from './categories.js';
import { flushDesktopAutoSave } from './noteSurfaceMutations.js';
export {
    buildNoteQuickActionsHtml
} from './noteSurfaceHtml/quickActions.js';

import { buildNoteMetaFooterHtml } from './noteSurfaceHtml/metaFooter.js';
export { buildNoteMetaFooterHtml };
export {
    formatNoteLineCount,
    computeNoteSizeKb,
    computeNoteLineCount
} from './noteSurfaceHtml/metaFooter.js';

import {
    buildExpandedChecklistHtml
} from './noteSurfaceHtml/checklistMarkup.js';

import {
    resolveNoteBodyVisibility,
    buildNoteBodyHtml,
    renderRichHtml,
    canInlineEditText,
    prepareContentForEdit,
    buildNoteBodySection,
    bindNoteBodySections,
    bindNoteContentSubToggles,
    buildMeetingBodyHtml,
    resolveNoteTemplate,
    buildNoteBodyConvertButtonsHtml
} from './noteSurfaceHtml/body.js';
export {
    resolveNoteBodyVisibility,
    buildNoteBodyHtml,
    buildNoteBodyConvertButtonsHtml,
    renderRichHtml,
    canInlineEditText,
    prepareContentForEdit,
    buildNoteBodySection,
    bindNoteBodySections,
    bindNoteContentSubToggles,
    buildMeetingBodyHtml
};
export {
    buildNoteContentFieldHtml,
    updateConvertButtons
} from './noteSurfaceHtml/body.js';
export {
    buildExpandedChecklistHtml
};

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

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
        // Overlay badge (no layout shift): a single large popout icon centered
        // over the card. Clicking it focuses the owning popout window.
        if (!card.querySelector('.note-popout-lock-overlay')) {
            const overlay = document.createElement('div');
            overlay.className = 'note-popout-lock-overlay';
            const icon = document.createElement('button');
            icon.type = 'button';
            icon.className = 'note-popout-lock-icon';
            icon.title = 'Editing in popout — click to focus';
            icon.setAttribute('aria-label', 'Editing in popout — click to focus');
            icon.innerHTML = CARD_ICONS.popout;
            icon.addEventListener('click', (e) => {
                e.stopPropagation();
                NotePopoutBridge.openOrFocus(item.id);
            });
            overlay.appendChild(icon);
            card.appendChild(overlay);
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
    buildNoteTitleHtml,
    buildNoteFormatPanelHtml,
    buildNoteConfigPanelHtml,
    buildNoteEditorShell,
    bindCollapsable,
    flashCopyFeedback,
    buildChecklistRowHtml,
};
