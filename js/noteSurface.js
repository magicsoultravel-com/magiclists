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
import { escapeHTML, escapeAttr } from './domEscape.js';
import { UNCATEGORIZED_COLOR } from './categories.js';
import {
    attachSheetInteractions,
    defaultSheetDimsForTemplate,
    ensureItemSheet,
    renderSheetHtml,
    syncSheetFromDom
} from './sheet.js';

// Import from new modules
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
    buildExpandedChecklistHtml,
    getChecklistCollapsedKeys,
    getChecklistDoneCollapsed,
    isChecklistDoneSectionCollapsed,
    toggleChecklistDoneSection,
    getChecklistCollapsibleKeys,
    checklistGroupsAnyExpanded,
    collapseAllChecklistGroups,
    expandAllChecklistGroups,
    toggleChecklistExpandCollapseAll,
    stepHasDescendants,
    buildVisibleChecklistSteps,
    annotateChecklistTreeGuides,
    canIndentStep
} from './noteSurfaceHtml.js';

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
    zoomToDisplay,
    displayToZoom,
    syncZoomInput,
    setEditorZoom,
    applyZoomFromInput,
    bindFormatPanel,
    bindBodyConvertBar
} from './noteSurfaceEditing.js';

import {
    attachChecklistDrag,
    getActiveRows,
    insertChecklistStep,
    removeChecklistStepAndFocus,
    handleChecklistBackspace,
    handleChecklistDelete,
    handleChecklistEnter,
    expandChecklistAncestorsForStep,
    prepareInlineOpSnapshot,
    commitInlineChecklistOp,
    createStepId
} from './noteSurfaceChecklist.js';

import { EmojiPicker } from './iconPicker.js';

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;

function syncInlineFieldToItem(el, item) {
    const field = el.dataset.field;
    if (el.classList.contains('rich-text--edit')) {
        const val = sanitizeRichHtml(linkifyPlainUrls(el.innerHTML));
        if (field === 'title') item.title = val;
        else if (field === 'content') item.content = val;
        else if (field === 'step-text') {
            const step = item.steps?.find(s => s.id === el.dataset.stepId);
            if (step) step.text = val;
        }
        return;
    }
    if (field === 'title') {
        item.title = el.textContent.trim();
    } else if (field === 'content') {
        item.content = el.textContent;
    } else if (field === 'step-text') {
        const step = item.steps?.find(s => s.id === el.dataset.stepId);
        if (step) step.text = el.textContent;
    }
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

// Core mutation functions - these must remain in noteSurface.js as they are the foundation
function emitItemMutation(item, { preserveView = false, beforeItem = null, skipRerender = false } = {}) {
    const preserveEmptySteps = preserveView && skipRerender;
    const normalized = normalizeItemForSave(item, { preserveEmptySteps });
    Object.assign(item, normalized);
    const normalizedBefore = beforeItem
        ? normalizeItemForSave(beforeItem, { preserveEmptySteps })
        : null;
    window.dispatchEvent(new CustomEvent('item:mutation_requested', {
        detail: { item: normalized, preserveView, beforeItem: normalizedBefore, skipRerender }
    }));
}

function mutateItem(item, mutator, { preserveView = false, skipRerender = false, localOnly = false } = {}) {
    const beforeItem = JSON.parse(JSON.stringify(item));
    mutator(item);
    if (!localOnly) {
        emitItemMutation(item, { preserveView, beforeItem, skipRerender });
    }
}

function commitInlineTextOp(item, beforeItem, { localOnly = false, mergeKey = null, mergeWindow = true } = {}) {
    if (localOnly || !beforeItem) return;
    const preserveEmptySteps = true;
    const afterNorm = normalizeItemForSave(item, { preserveEmptySteps });
    const beforeNorm = normalizeItemForSave(beforeItem, { preserveEmptySteps });
    if (JSON.stringify(beforeNorm) === JSON.stringify(afterNorm)) return;
    Object.assign(item, afterNorm);
    window.dispatchEvent(new CustomEvent('item:mutation_requested', {
        detail: {
            item: afterNorm,
            preserveView: true,
            beforeItem: beforeNorm,
            skipRerender: true,
            mergeKey: mergeKey || `${afterNorm.id}:text`,
            mergeWindow
        }
    }));
}

function commitInlineChecklistOp(item, beforeItem, { localOnly = false } = {}) {
    if (localOnly || !beforeItem) return;
    const preserveEmptySteps = true;
    const afterNorm = normalizeItemForSave(item, { preserveEmptySteps });
    const beforeNorm = normalizeItemForSave(beforeItem, { preserveEmptySteps });
    if (JSON.stringify(beforeNorm) === JSON.stringify(afterNorm)) return;
    Object.assign(item, afterNorm);
    window.dispatchEvent(new CustomEvent('item:mutation_requested', {
        detail: {
            item: afterNorm,
            preserveView: true,
            beforeItem: beforeNorm,
            skipRerender: true,
            mergeKey: `${afterNorm.id}:struct`,
            mergeWindow: false
        }
    }));
}

function createBlankChecklistStep() {
    return {
        id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        text: '',
        completed: false,
        level: 0,
        startDateTime: '',
        endDateTime: ''
    };
}

function syncItemBodyFromDom(root, item) {
    root?.querySelectorAll('.card-inline-edit').forEach((el) => {
        const field = el.dataset.field;
        if (field === 'title' || field === 'content' || field === 'step-text') {
            syncInlineFieldToItem(el, item);
        }
    });
    syncSheetFromDom(root, item);
}

function buildSheetInteractionOptions(shell, item, { localOnly = false, onChange = () => {}, refresh = () => {} } = {}) {
    return {
        localOnly,
        onChange,
        refresh,
        inModalEditor: !!shell?.closest('#editor-overlay'),
        prepareSnapshot: () => prepareInlineOpSnapshot(shell, item, localOnly),
        commitCellEdit: (beforeItem) => {
            commitInlineTextOp(item, beforeItem, {
                localOnly,
                mergeKey: `${item.id}:sheet`,
                mergeWindow: true
            });
        },
        commitStructure: (beforeItem) => {
            commitInlineChecklistOp(item, beforeItem, { localOnly });
        },
        onUndo: () => UndoManager.undo(),
        onRedo: () => UndoManager.redo()
    };
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
    buildExpandedChecklistHtml,

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

    // Editing methods - delegate to noteSurfaceEditing module
    insertTextAtCaret,
    resolveEmojiInsertTarget,
    saveEmojiInsertContext,
    restoreEmojiInsertRange,
    insertEmojiAtCaret,
    openEmojiPickerForNote,
    syncInlineFieldToItem,
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

    // Checklist methods - delegate to noteSurfaceChecklist module
    attachChecklistDrag,
    getActiveRows,
    insertChecklistStep,
    removeChecklistStepAndFocus,
    handleChecklistBackspace,
    handleChecklistDelete,
    handleChecklistEnter,
    expandChecklistAncestorsForStep,
    commitInlineChecklistOp,
    createStepId,

    // Utility methods
    escapeHTML,
    escapeAttr,
};

export { escapeHTML, escapeAttr } from './domEscape.js';