/** @module {"owns":"note card DOM, inline edit, checklist interactions, item mutations", "related":["checklistSteps.js","richText.js","sheet.js","noteBodyConversion.js","noteQuickActions.js","noteSurfaceHtml.js","noteSurfaceEditing.js","noteSurfaceChecklist.js"], "events":["item:mutation_requested"]} */
import { isFileCabinetActive, getFileCabinetToggleLabels } from './fileCabinet.js';
import { isCollapsedSpatialSize, LEGACY_TILE_SIZE } from './tileGeometry.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import {
    contentHasConvertibleText,
    convertChecklistToContent,
    convertContentToChecklist,
    deriveEditorBodyLayout,
    SOFT_BREAK,
    stepToPlainCopyLine,
    unwrapLineStrike,
    wrapLineAsStruck,
    stepsHaveConvertibleText
} from './noteBodyConversion.js';
import { hasRichMarkup, linkifyPlainUrls, sanitizeRichHtml, stripRichText } from './richText.js';
import { normalizeItemForSave } from './noteModel.js';
import { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS } from './icons.js';
import { UndoManager } from './undo.js';
import { escapeHTML, escapeAttr, escapeQuotes } from './domEscape.js';
import { UNCATEGORIZED_COLOR } from './categories.js';
import {
    attachSheetInteractions,
    defaultSheetDimsForTemplate,
    ensureItemSheet,
    renderSheetHtml,
    syncSheetFromDom
} from './sheet.js';


// Import from noteSurfaceHtml.js
import {
    buildNoteQuickActionsHtml,
    buildNoteBodyConvertButtonsHtml,
    updateConvertButtons,
    resolveNoteBodyVisibility,
    buildNoteBodyHtml,
    buildNoteBodySection,
    bindNoteBodySections,
    buildMeetingBodyHtml,
    buildNoteTitleHtml,
    buildNoteFormatPanelHtml,
    buildNoteMetaFooterHtml,
    buildNoteConfigPanelHtml,
    buildNoteEditorShell,
    bindCollapsable,
    flashCopyFeedback,
    refreshNoteBody,
    buildChecklistRowHtml
} from './noteSurfaceHtml.js';

// Import from checklistSteps.js
import {
    getStepLevel,
    partitionChecklistSteps,
    stepHasDescendants,
    buildVisibleChecklistSteps,
    annotateChecklistTreeGuides,
    canIndentStep
} from './checklistSteps.js';

// Import from noteSurfaceChecklist.js
import {
    bindChecklistInteractions,
    getChecklistCollapsedKeys,
    getChecklistDoneCollapsed,
    isChecklistDoneSectionCollapsed,
    toggleChecklistDoneSection,
    getChecklistCollapsibleKeys,
    checklistGroupsAnyExpanded,
    collapseAllChecklistGroups,
    expandAllChecklistGroups,
    toggleChecklistExpandCollapseAll,
    attachChecklistDrag,
    getActiveRows,
    insertChecklistStep,
    removeChecklistStepAndFocus,
    handleChecklistBackspace,
    handleChecklistDelete,
    handleChecklistEnter,
    expandChecklistAncestorsForStep,
    prepareInlineOpSnapshot,
    createStepId
} from './noteSurfaceChecklist.js';

import {
    insertTextAtCaret,
    resolveEmojiInsertTarget,
    saveEmojiInsertContext,
    restoreEmojiInsertRange,
    insertEmojiAtCaret,
    openEmojiPickerForNote,
    tryOpenRichEditLink,
    renderRichHtml,
    prepareContentForEdit,
    canInlineEditText,
    commitFocusedInlineField,
    splitInlineEditAtCaret,
    caretAtEdge,
    caretAtPlainEdge,
    focusInlineEdit,
    setCaretAtPlainOffset,
    getInlineEditSequence,
    handleInlineEditArrowNav,
    applyFormatCommand,
    getEditorZoom,
    setEditorZoom,
    syncZoomInput,
    zoomToDisplay,
    displayToZoom,
    applyZoomFromInput,
    bindFormatPanel,
    bindBodyConvertBar,
    bindNoteEditorShell
} from './noteSurfaceEditing.js';

// Import mutation functions from noteSurfaceMutations.js
import {
    mutateItem,
    syncInlineFieldToItem,
    emitItemMutation,
    commitInlineTextOp,
    commitInlineChecklistOp,
    createBlankChecklistStep,
    syncItemBodyFromDom,
    buildSheetInteractionOptions,
    attachNoteBodyInteractions,
    updateNoteMetaStats
} from './noteSurfaceMutations.js';

import { EmojiPicker } from './iconPicker.js';

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

function computeNoteSizeKb(item) {
    if (!item) return '0';
    const payload = {
        title: item.title || '',
        content: item.content || '',
        steps: item.steps || [],
        type: item.type || 'note',
        categories: item.categories || [],
        noteTemplate: item.noteTemplate || '',
        sheet: item.sheet || undefined
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
    return count;
}

function formatNoteLineCount(n) {
    return n === 1 ? '1 line' : `${n} lines`;
}

function formatCreatedDate(timestamp) {
    if (!timestamp) return '';
    const d = new Date(Number(timestamp) * 1000);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

function ensureChecklistStepFromRow(row, item) {
    const stepId = row?.dataset?.stepId;
    if (!stepId || !item) return null;
    if (!item.steps) item.steps = [];
    let step = item.steps.find((s) => s.id === stepId);
    if (!step) {
        step = createBlankChecklistStep();
        step.id = stepId;
        step.level = Number(row.dataset.level) || 0;
        step.completed = row.classList.contains('step-row--done');
        const prevRow = findAdjacentChecklistStepRow(row, 'prev');
        const prevId = prevRow?.dataset?.stepId;
        if (prevId) {
            const idx = item.steps.findIndex((s) => s.id === prevId);
            item.steps.splice(idx >= 0 ? idx + 1 : item.steps.length, 0, step);
        } else {
            item.steps.unshift(step);
        }
        if (item.type !== 'checklist') item.type = 'checklist';
    }
    const textEl = row.querySelector('[data-field="step-text"]');
    if (textEl) syncInlineFieldToItem(textEl, step);
    return step;
}

function findAdjacentChecklistStepRow(row, direction = 'prev') {
    if (!row) return null;
    const allRows = row.parentNode?.querySelectorAll('.step-row--display') || [];
    const idx = Array.from(allRows).indexOf(row);
    if (direction === 'prev') {
        for (let i = idx - 1; i >= 0; i--) {
            const r = allRows[i];
            if (!r.classList.contains('step-row--done')) return r;
        }
    } else {
        for (let i = idx + 1; i < allRows.length; i++) {
            const r = allRows[i];
            if (!r.classList.contains('step-row--done')) return r;
        }
    }
    return null;
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

function isSheetTemplateActive(item) {
    return item?.noteTemplate === 'sheet';
}

/**
 * Capture the current focus state of a note body element.
 * Returns an object with focus state information, or null if no focus state to capture.
 * @param {HTMLElement} body - The .editor-note-body element
 * @returns {object|null} Focus state object or null
 */
function captureNoteBodyFocusState(body) {
    if (!body) return null;
    
    const active = document.activeElement;
    if (!active || !body.contains(active)) return null;
    
    const field = active.dataset.field;
    if (!field) return null;
    
    // For checklist steps, capture additional state
    if (field === 'step-text') {
        const stepId = active.dataset.stepId;
        const sel = window.getSelection();
        const range = sel?.rangeCount > 0 ? sel.getRangeAt(0) : null;
        
        // Determine if caret is at start or end
        let edge = 'end';
        let plainOffset = 0;
        
        if (range && active.contains(range.startContainer)) {
            const probe = range.cloneRange();
            probe.selectNodeContents(active);
            probe.setEnd(range.startContainer, range.startOffset);
            const plainText = stripRichText(active.textContent || '');
            plainOffset = probe.toString().length;
            edge = plainOffset <= 0 ? 'start' : 'end';
        }
        
        return {
            field,
            stepId,
            edge,
            plainOffset
        };
    }
    
    // For title and content fields
    return { field };
}

/**
 * Restore focus state to a note body element after re-rendering.
 * @param {HTMLElement} newBody - The new .editor-note-body element
 * @param {HTMLElement} card - The card element (for finding step elements)
 * @param {object} focusState - The focus state object from captureNoteBodyFocusState
 */
function restoreNoteBodyFocusState(newBody, card, focusState) {
    if (!newBody || !focusState) return;
    
    const { field, stepId, edge, plainOffset } = focusState;
    
    if (field === 'step-text' && stepId) {
        // Find the step text element in the new body
        const stepEl = newBody.querySelector(`.step-text.card-inline-edit[data-step-id="${stepId}"]`);
        if (stepEl) {
            // Use preventScroll to avoid jumping
            stepEl.focus({ preventScroll: true });
            if (plainOffset != null) {
                setCaretAtPlainOffset(stepEl, plainOffset);
            } else {
                // Set caret at edge if no plain offset - use robust positioning
                const range = document.createRange();
                if (edge === 'end') {
                    // Move selection strictly to the end of the text/child strings
                    range.setStart(stepEl, stepEl.childNodes.length);
                    range.setEnd(stepEl, stepEl.childNodes.length);
                } else {
                    range.selectNodeContents(stepEl);
                    range.collapse(true); // 'start'
                }
                const sel = window.getSelection();
                sel?.removeAllRanges();
                sel?.addRange(range);
            }
            return;
        }
    }
    
    // For title and content fields
    const el = newBody.querySelector(`.card-inline-edit[data-field="${field}"]`);
    if (el) {
        focusInlineEdit(el, edge || 'end');
    }
}

/**
 * Focus a pending checklist step on a card.
 * @param {HTMLElement} card - The card element
 */
function focusPendingChecklistStep(card) {
    if (!card?.dataset?.pendingFocusStepId) return;
    
    const stepId = card.dataset.pendingFocusStepId;
    const edge = card.dataset.pendingFocusEdge || 'end';
    const plainOffset = card.dataset.pendingFocusPlainOffset;
    
    const stepEl = card.querySelector(`.step-text.card-inline-edit[data-step-id="${stepId}"]`);
    if (stepEl) {
        // Use preventScroll to avoid jumping
        stepEl.focus({ preventScroll: true });
        if (plainOffset != null) {
            setCaretAtPlainOffset(stepEl, Number(plainOffset));
        } else {
            // Set caret at edge if no plain offset - use robust positioning
            const range = document.createRange();
            if (edge === 'end') {
                // Move selection strictly to the end of the text/child strings
                range.setStart(stepEl, stepEl.childNodes.length);
                range.setEnd(stepEl, stepEl.childNodes.length);
            } else {
                range.selectNodeContents(stepEl);
                range.collapse(true); // 'start'
            }
            const sel = window.getSelection();
            sel?.removeAllRanges();
            sel?.addRange(range);
        }
    }
}

// Global board event listener for item:mutation_requested
// This is the master event receiver that handles all item mutations on the board canvas
window.addEventListener('item:mutation_requested', (e) => {
    const { item, skipRerender, preserveView } = e.detail;
    
    // Update local in-memory data cache/reference copy with the fresh item state
    // This ensures data remains synchronized globally even when skipping DOM updates
    // Note: The item object passed in the event detail is already the updated version
    
    // Check if we should skip the heavy DOM re-render
    if (skipRerender || preserveView) {
        // Perform targeted DOM updates for inline editing on the board
        // Find the card on the board that corresponds to this item
        const canvas = document.getElementById('app-canvas');
        if (canvas) {
            const card = canvas.querySelector(`.mini-card[data-id="${item.id}"]`);
            if (card) {
                // For board cards, we need to update the card body with the new content
                // while preserving the card's position and size
                const body = card.querySelector('.editor-note-body');
                if (body) {
                    // Capture canvas scroll position before any updates to prevent view jump
                    const canvasScrollTop = canvas.scrollTop || 0;
                    const canvasScrollLeft = canvas.scrollLeft || 0;
                    
                    // Re-render only the checklist section to avoid layout thrashing
                    // The UI.updateSingleCard handles this, but we can do targeted updates
                    // for better performance
                    const expandedChecklist = body.querySelector('.expanded-checklist');
                    if (expandedChecklist) {
                        // Use the refreshNoteBody function for targeted updates
                        // This will update the checklist while preserving scroll
                        const shell = card.querySelector('.editor-note-shell');
                        if (shell) {
                            // Sync the item body from DOM first
                            syncItemBodyFromDom(shell, item);
                        }
                        // Refresh the note body with targeted updates
                        refreshNoteBody(body, item, {
                            mountZone: card,
                            shell,
                            localOnly: true,
                            richEdit: true,
                            refresh: () => {
                                // Re-bind interactions after refresh
                                const newShell = card.querySelector('.editor-note-shell');
                                if (newShell) {
                                    const newBody = newShell.querySelector('.editor-note-body');
                                    if (newBody) {
                                        bindChecklistInteractions(newBody, item, {
                                            localOnly: true,
                                            onChange: () => {},
                                            refresh: () => {}
                                        });
                                        attachChecklistDrag(newBody, item, {
                                            localOnly: true,
                                            onChange: () => {},
                                            refresh: () => {}
                                        });
                                    }
                                }
                            }
                        });
                        // Restore canvas scroll position after targeted update
                        // This prevents the view from jumping to top when cards have overflow: hidden
                        canvas.scrollTop = canvasScrollTop;
                        canvas.scrollLeft = canvasScrollLeft;
                    }
                }
            }
        }
        return;
    }
    
    // Fallback to legacy full card re-render only for cross-board moves/deletions
    // This would be implemented by the board's render system
    // For now, we'll trigger a full refresh through the standard mechanism
    // In a real implementation, this would call the board's render function
});

// Main NoteSurface object
// Note: escapeHTML, escapeAttr, hasRichMarkup, stripRichText, linkifyPlainUrls, sanitizeRichHtml
// are imported from domEscape.js and richText.js respectively
export const NoteSurface = {
    snapshotItem(item) {
        return JSON.parse(JSON.stringify(item));
    },

    emitItemMutation,
    prepareInlineOpSnapshot,
    ensureChecklistStepFromRow,
    commitInlineTextOp,
    commitInlineChecklistOp,
    mutateItem,
    buildSheetInteractionOptions,
    syncItemBodyFromDom,
    createBlankChecklistStep,
    getEditorZoom,
    setEditorZoom,
    syncZoomInput,
    zoomToDisplay,
    displayToZoom,
    applyZoomFromInput,
    applyFormatCommand,
    bindBodyConvertBar,
    bindFormatPanel,
    bindNoteEditorShell,
    bindChecklistInteractions,
    attachChecklistDrag,
    getActiveRows,
    getChecklistCollapsedKeys,
    getChecklistDoneCollapsed,
    isChecklistDoneSectionCollapsed,
    toggleChecklistDoneSection,
    getChecklistCollapsibleKeys,
    checklistGroupsAnyExpanded,
    collapseAllChecklistGroups,
    expandAllChecklistGroups,
    toggleChecklistExpandCollapseAll,

    // HTML building methods - delegate to noteSurfaceHtml module
    buildNoteQuickActionsHtml,
    buildNoteBodyConvertButtonsHtml,
    updateConvertButtons,
    resolveNoteBodyVisibility,
    buildNoteBodyHtml,
    buildNoteBodySection,
    bindNoteBodySections,
    buildMeetingBodyHtml,
    buildNoteTitleHtml,
    buildNoteFormatPanelHtml,
    buildNoteMetaFooterHtml,
    buildNoteConfigPanelHtml,
    buildNoteEditorShell,
    bindCollapsable,
    flashCopyFeedback,
    refreshNoteBody,

    // Editing methods - delegate to noteSurfaceEditing module
    insertTextAtCaret,
    resolveEmojiInsertTarget,
    saveEmojiInsertContext,
    restoreEmojiInsertRange,
    insertEmojiAtCaret,
    openEmojiPickerForNote,
    tryOpenRichEditLink,
    renderRichHtml,
    prepareContentForEdit,
    canInlineEditText,
    commitFocusedInlineField,
    splitInlineEditAtCaret,
    caretAtEdge,
    caretAtPlainEdge,
    focusInlineEdit,
    setCaretAtPlainOffset,
    getInlineEditSequence,
    handleInlineEditArrowNav,

    // Focus state management
    captureNoteBodyFocusState,
    restoreNoteBodyFocusState,
    focusPendingChecklistStep,

    // Mutation functions
    attachNoteBodyInteractions,
    updateNoteMetaStats,

    // Utility methods
    escapeHTML,
    escapeAttr,
    escapeQuotes,
    canEditInline: function() {
        return true;
    },
    formatNoteListDate: function(item) {
        return formatCreatedDate(item.timestamp);
    }
};

export {
    buildSheetInteractionOptions,
    syncInlineFieldToItem,
    escapeHTML,
    escapeAttr,
    escapeQuotes,
    createBlankChecklistStep,
    mutateItem,
    bindChecklistInteractions
};