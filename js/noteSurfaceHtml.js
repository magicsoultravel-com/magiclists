/** @module {"owns":"note HTML building and rendering", "related":["noteSurface.js","noteModel.js","sheet.js","checklistSteps.js"], "events":[]} */
import { CARD_ICONS } from './icons.js';
import { UNCATEGORIZED_COLOR } from './categories.js';
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

import { resolveNoteBodyVisibility, buildNoteBodyHtml, renderRichHtml, canInlineEditText, prepareContentForEdit, buildNoteBodySection, bindNoteBodySections, bindNoteContentSubToggles, buildMeetingBodyHtml, buildNoteBodyConvertButtonsHtml } from './noteSurfaceHtml/body.js';
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

import {
    buildNoteTitleHtml,
    buildNoteFormatPanelHtml,
    buildNoteConfigPanelHtml,
    buildNoteEditorShell,
    bindCollapsable,
    flashCopyFeedback
} from './noteSurfaceHtml/shell.js';
export {
    buildNoteTitleHtml,
    buildNoteFormatPanelHtml,
    buildNoteConfigPanelHtml,
    buildNoteEditorShell,
    bindCollapsable,
    flashCopyFeedback
};
export {
    buildExpandedChecklistHtml
};

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

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
    buildChecklistRowHtml,
};
