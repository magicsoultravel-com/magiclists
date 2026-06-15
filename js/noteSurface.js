import { isFileCabinetActive, getFileCabinetToggleLabels } from './fileCabinet.js';
import { isCollapsedSpatialSize, LEGACY_TILE_SIZE } from './tileGeometry.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import {
    contentHasConvertibleText,
    convertChecklistToContent,
    convertContentToChecklist,
    deriveEditorBodyLayout,
    itemToPlainCopyText,
    SOFT_BREAK,
    stepToPlainCopyLine,
    unwrapLineStrike,
    wrapLineAsStruck,
    stepsHaveConvertibleText
} from './noteBodyConversion.js';
import { hasRichMarkup, linkifyPlainUrls, sanitizeHref, sanitizeRichHtml, stripRichText } from './richText.js';
import { hydrateNoteIcons, hydrateNoteIconsHtml, isNoteIconId, noteIconTokenMarkup } from './noteIcons.js';
import { IconBoard, buildIconBoardHtml } from './iconPicker.js';
import { normalizeItemForSave } from './noteModel.js';
import { CARD_ICONS, FORMAT_ICONS, ACTION_ICONS } from './icons.js';
import {
    getStepLevel,
    partitionChecklistSteps,
    reorderStepsByCompletion,
    moveStepOnCompletionChange,
    collectStepSubtree,
    collectStepSubtreeIds,
    findStepParentIndex,
    applySubtreeLevelDelta,
    normalizeChecklistLevels,
    previewDropTargetLevel,
    resolveDropTarget,
    computeChecklistInsertBounds,
    computeVisibleInsertBounds,
    resolvePointerDropTarget,
    getStepRowLevel,
    collectDomRowBlock,
    clampChecklistInsertIndex,
    reorderActiveStepsFromDomOrder,
    stepHasDescendants,
    checklistHasIndentations,
    buildVisibleChecklistSteps,
    annotateChecklistTreeGuides
} from './checklistSteps.js';
import { UndoManager } from './undo.js';
import { escapeHTML, escapeAttr, escapeQuotes } from './domEscape.js';

const UNCATEGORIZED_COLOR = '#64748b';
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
        categories: item.categories || []
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

export const NoteSurface = {
    snapshotItem(item) {
        return JSON.parse(JSON.stringify(item));
    },

    emitItemMutation(item, { preserveView = false, beforeItem = null, skipRerender = false } = {}) {
        const preserveEmptySteps = preserveView && skipRerender;
        const normalized = normalizeItemForSave(item, { preserveEmptySteps });
        Object.assign(item, normalized);
        const normalizedBefore = beforeItem
            ? normalizeItemForSave(beforeItem, { preserveEmptySteps })
            : null;
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: { item: normalized, preserveView, beforeItem: normalizedBefore, skipRerender }
        }));
    },

    prepareInlineOpSnapshot(root, item, localOnly = false) {
        const shell = root.closest('.editor-note-shell') || root;
        this.syncItemBodyFromDom(shell, item);
        if (localOnly) return null;
        return this.snapshotItem(item);
    },

    ensureChecklistStepFromRow(row, item) {
        const stepId = row?.dataset?.stepId;
        if (!stepId || !item) return null;
        if (!item.steps) item.steps = [];
        let step = item.steps.find((s) => s.id === stepId);
        if (!step) {
            step = this.createBlankChecklistStep();
            step.id = stepId;
            step.level = Number(row.dataset.level) || 0;
            step.completed = row.classList.contains('step-row--done');
            const prevRow = this.findAdjacentChecklistStepRow(row, 'prev');
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
        if (textEl) this.syncInlineFieldToItem(textEl, step);
        return step;
    },

    expandChecklistAncestorsForStep(item, stepId) {
        const steps = item?.steps || [];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return;
        const collapsed = this.getChecklistCollapsedKeys();
        let changed = false;
        let childLevel = getStepLevel(steps[idx]);
        for (let i = idx - 1; i >= 0 && childLevel > 0; i--) {
            const level = getStepLevel(steps[i]);
            if (level < childLevel) {
                const key = `${item.id}:${steps[i].id}`;
                if (collapsed[key]) {
                    delete collapsed[key];
                    changed = true;
                }
                childLevel = level;
            }
        }
        if (changed) {
            localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
        }
    },

    commitInlineChecklistOp(item, beforeItem, { localOnly = false } = {}) {
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
    },

    commitInlineTextOp(item, beforeItem, { localOnly = false } = {}) {
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
                mergeKey: `${afterNorm.id}:text`,
                mergeWindow: true
            }
        }));
    },

    mutateItem(item, mutator, { preserveView = false, skipRerender = false, localOnly = false } = {}) {
        const beforeItem = this.snapshotItem(item);
        mutator(item);
        if (!localOnly) {
            this.emitItemMutation(item, { preserveView, beforeItem, skipRerender });
        }
    },

    syncInlineFieldToItem(el, item) {
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
    },

    renderRichHtml(str) {
        if (!str) return '';
        const prepared = String(str).replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
        const out = hasRichMarkup(prepared)
            ? sanitizeRichHtml(prepared)
            : sanitizeRichHtml(escapeHTML(prepared));
        return hydrateNoteIconsHtml(out);
    },

    prepareContentForEdit(content) {
        const prepared = String(content || '').replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
        const out = hasRichMarkup(prepared)
            ? sanitizeRichHtml(prepared)
            : sanitizeRichHtml(escapeHTML(prepared));
        return hydrateNoteIconsHtml(out);
    },

    tryOpenRichEditLink(e, host) {
        if (!host?.classList?.contains('rich-text--edit')) return false;
        const anchor = e.target.closest?.('a[href]');
        if (!anchor || !host.contains(anchor)) return false;
        const href = sanitizeHref(anchor.getAttribute('href'));
        if (!href) return false;
        e.preventDefault();
        e.stopPropagation();
        window.open(href, '_blank', 'noopener,noreferrer');
        return true;
    },

    resolveEditorBodyLayoutUnchecked(item) {
        return deriveEditorBodyLayout(item);
    },

    syncItemBodyFromDom(root, item) {
        root?.querySelectorAll('.card-inline-edit').forEach((el) => {
            const field = el.dataset.field;
            if (field === 'title' || field === 'content' || field === 'step-text') {
                this.syncInlineFieldToItem(el, item);
            }
        });
    },

    insertTextAtCaret(el, text) {
        if (!el) return;
        el.focus();
        const sel = window.getSelection();
        if (!sel?.rangeCount) return;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return;
        range.deleteContents();
        range.insertNode(document.createTextNode(text));
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    },

    resolveIconInsertTarget(root) {
        if (!root) return null;
        const active = document.activeElement;
        if (active?.classList?.contains('card-inline-edit')
            && active.classList.contains('rich-text--edit')
            && root.contains(active)) {
            return active;
        }
        const title = root.querySelector('[data-field="title"].card-inline-edit.rich-text--edit');
        if (title) {
            this.focusInlineEdit(title, 'end');
            return title;
        }
        const content = root.querySelector('[data-field="content"].card-inline-edit.rich-text--edit');
        if (content) {
            this.focusInlineEdit(content, 'end');
            return content;
        }
        const step = root.querySelector('[data-field="step-text"].card-inline-edit.rich-text--edit');
        if (step) {
            this.focusInlineEdit(step, 'end');
            return step;
        }
        return null;
    },

    saveIconInsertContext(root) {
        const active = document.activeElement;
        let target = null;
        let range = null;
        if (active?.classList?.contains('card-inline-edit')
            && active.classList.contains('rich-text--edit')
            && root?.contains(active)) {
            target = active;
        } else {
            target = this.resolveIconInsertTarget(root);
        }
        if (target) {
            const sel = window.getSelection();
            if (sel?.rangeCount && target.contains(sel.getRangeAt(0).startContainer)) {
                range = sel.getRangeAt(0).cloneRange();
            }
        }
        return { target, range };
    },

    restoreIconInsertRange(target, range) {
        if (!target) return;
        target.focus();
        if (!range) return;
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    },

    insertNoteIconAtCaret(el, iconId, { item, localOnly = false, onChange = () => {} } = {}) {
        if (!el || !isNoteIconId(iconId)) return false;
        el.focus();
        const sel = window.getSelection();
        if (!sel?.rangeCount || !el.contains(sel.getRangeAt(0).startContainer)) {
            this.focusInlineEdit(el, 'end');
        }
        const token = sanitizeRichHtml(noteIconTokenMarkup(iconId));
        document.execCommand('insertHTML', false, token);
        hydrateNoteIcons(el);
        if (item) {
            this.syncInlineFieldToItem(el, item);
            if (localOnly) {
                onChange();
            } else {
                this.mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
            }
        }
        return true;
    },

    attachIconBoard(stack, root, item, { localOnly = false, onChange = () => {} } = {}) {
        if (!stack || !root) return;
        IconBoard.attach(stack, {
            getContext: () => this.saveIconInsertContext(root),
            insertIcon: (ctx, iconId) => {
                if (!ctx?.target) return;
                this.restoreIconInsertRange(ctx.target, ctx.range);
                this.insertNoteIconAtCaret(ctx.target, iconId, { item, localOnly, onChange });
            }
        });
    },

    toggleIconBoard(stack, root, item, { localOnly = false, onChange = () => {} } = {}) {
        if (!stack) return;
        if (!stack.dataset.iconBoardBound) {
            this.attachIconBoard(stack, root, item, { localOnly, onChange });
        }
        stack._iconBoardToggle?.();
    },

    canInlineEditText(text, { richEdit = false } = {}) {
        if (richEdit) return true;
        return !hasRichMarkup(text);
    },

    commitFocusedInlineField(card, item) {
        const active = document.activeElement;
        if (!active || !card.contains(active) || !active.classList.contains('card-inline-edit')) return;
        this.mutateItem(item, () => {
            this.syncInlineFieldToItem(active, item);
        }, { preserveView: true, skipRerender: true });
        active.dataset.skipBlurSave = '1';
    },

    createBlankChecklistStep() {
        return {
            id: `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
            text: '',
            completed: false,
            level: 0,
            startDateTime: '',
            endDateTime: ''
        };
    },
    buildNoteQuickActionsHtml(item, {
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
            if (isFileCabinetActive()) {
                const labels = getFileCabinetToggleLabels(atSmall, atSmall);
                expandTitle = labels.title;
                lastIcon = labels.iconKey === 'expand' ? CARD_ICONS.expand : CARD_ICONS.collapse;
            } else {
                expandTitle = atSmall ? 'Expand' : 'Collapse to small';
                lastIcon = atSmall ? CARD_ICONS.expand : CARD_ICONS.collapse;
            }
        } else {
            expandTitle = isExpanded ? 'Collapse note' : 'Expand note';
            lastIcon = isExpanded ? CARD_ICONS.collapse : CARD_ICONS.expand;
        }
        const lastClass = isModal ? 'card-act--close' : 'card-act--toggle';
        const lastId = isModal ? ' id="modal-close-btn"' : '';
        const pinTitle = pinned ? 'Unpin (unlock drag)' : 'Pin position (locks drag)';
        const pinBtn = `<button type="button" class="card-act card-act--pin${pinned ? ' is-active' : ''}" title="${pinTitle}" aria-label="${pinTitle}" aria-pressed="${pinned ? 'true' : 'false'}">${pinned ? CARD_ICONS.unpin : CARD_ICONS.pin}</button>`;
        const calTitle = calHidden
            ? 'Hidden from calendar — click to show'
            : 'Shown on calendar — click to hide';
        const calBtn = `<button type="button" class="card-act card-act--cal${calHidden ? ' is-off' : ' is-on'}" title="${this.escapeAttr(calTitle)}" aria-label="${this.escapeAttr(calTitle)}">${CARD_ICONS.calendar}</button>`;
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
        const actionsHtml = `<div class="note-quick-actions-stack">
            ${buildIconBoardHtml()}
            <div class="card-actions${isModal ? ' modal-card-actions' : ''}" data-action-count="${actionCount}" data-surface="${surface}">
            ${calBtn}
            <button type="button" class="card-act card-act--icon" title="Insert icon" aria-label="Insert icon" aria-haspopup="true" aria-expanded="false">${CARD_ICONS.insertIcon}</button>
            <button type="button" class="card-act card-act--copy" title="Copy note as text" aria-label="Copy note as text">${CARD_ICONS.copy}</button>
            ${pinBtn}
            <button type="button" class="card-act card-act--color" title="Note color" aria-label="Note color" aria-haspopup="dialog">${CARD_ICONS.color}</button>
            <button type="button" class="card-act card-act--hide" title="Hide from board" aria-label="Hide from board">${CARD_ICONS.hide}</button>
            <button type="button" class="card-act card-act--edit" title="Edit note" aria-label="Edit note">${CARD_ICONS.edit}</button>
            ${dragBtn}
            <button type="button" class="card-act ${lastClass}"${lastId} title="${expandTitle}" aria-label="${expandTitle}">${lastIcon}</button>
            </div>
        </div>`;
        return isModal ? `${archiveBtn}${actionsHtml}` : actionsHtml;
    },
    flashCopyFeedback(btn, message = 'Copied!', { failed = false } = {}) {
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
    },
    formatCreatedDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(Number(timestamp) * 1000);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    },

    formatNoteListDate(item) {
        const ts = Number(item?.updated_at || item?.created_at || 0);
        if (!ts) return '—';
        const d = new Date(ts * 1000);
        if (Number.isNaN(d.getTime())) return '—';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    },

    buildNoteBodyConvertButtonsHtml(item) {
        const canToChecklist = contentHasConvertibleText(item?.content);
        const canToContent = stepsHaveConvertibleText(item?.steps);
        return `
            <span class="format-toolbar-sep" aria-hidden="true"></span>
            <button type="button" class="format-btn card-act editor-convert-btn" data-convert="to-checklist" title="Move content into checklist items" aria-label="To checklist"${canToChecklist ? '' : ' disabled'}>${FORMAT_ICONS.toChecklist}</button>
            <button type="button" class="format-btn card-act editor-convert-btn" data-convert="to-content" title="Move checklist into note content" aria-label="To notes"${canToContent ? '' : ' disabled'}>${FORMAT_ICONS.toNotes}</button>
        `;
    },

    updateConvertButtons(shell, item) {
        if (!shell || !item) return;
        const toChecklist = shell.querySelector('[data-convert="to-checklist"]');
        const toContent = shell.querySelector('[data-convert="to-content"]');
        if (toChecklist) toChecklist.disabled = !contentHasConvertibleText(item.content);
        if (toContent) toContent.disabled = !stepsHaveConvertibleText(item.steps);
    },

    resolveNoteBodyVisibility(item, { canEdit = false, inModalEditor = false } = {}) {
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
    },

    buildNoteBodyHtml(item, { canEdit = false, inModalEditor = false, richEdit = false } = {}) {
        let html = '';
        const { showContent, showChecklist } = this.resolveNoteBodyVisibility(item, { canEdit, inModalEditor });

        if (showContent) {
            const content = item.content || '';
            const rich = hasRichMarkup(content) || content.includes('\u2028');
            if (canEdit && (richEdit || this.canInlineEditText(content, { richEdit }))) {
                const inner = richEdit ? this.prepareContentForEdit(content) : this.escapeHTML(content.replace(/\u2028/g, '\n'));
                const ce = richEdit ? 'true' : 'plaintext-only';
                const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
                html += `<div class="card-content-preview card-inline-edit${richClasses}" contenteditable="${ce}" spellcheck="false" data-field="content" data-placeholder="Add note…">${inner}</div>`;
            } else {
                const richClass = rich ? ' rich-text' : '';
                html += `<div class="card-content-preview${richClass}">${this.renderRichHtml(content)}</div>`;
            }
        }

        if (showChecklist) {
            if (!item.steps) item.steps = [];
            html += this.buildExpandedChecklistHtml(item, canEdit, { richEdit });
        }
        return html;
    },

    escapeQuotes,

    buildNoteTitleHtml(item, canEdit, { richEdit = false } = {}) {
        const fullTitle = item.title || '';
        const titleAttr = this.escapeAttr(stripRichText(fullTitle));
        const rich = hasRichMarkup(fullTitle);

        if (canEdit && (richEdit || this.canInlineEditText(fullTitle, { richEdit }))) {
            const inner = richEdit ? sanitizeRichHtml(fullTitle) : this.escapeHTML(fullTitle);
            const ce = richEdit ? 'true' : 'plaintext-only';
            const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
            return `<div class="mini-card-title card-inline-edit${richClasses}" contenteditable="${ce}" spellcheck="false" data-field="title" data-placeholder="Title…">${inner}</div>`;
        }

        const richClass = rich ? ' rich-text' : '';
        return `<div class="mini-card-title${richClass}" title="${titleAttr}">${this.renderRichHtml(fullTitle)}</div>`;
    },

    buildNoteFormatPanelHtml(item = null) {
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
                        ${item ? this.buildNoteBodyConvertButtonsHtml(item) : ''}
                    </div>
                </div>
            </div>
        `;
    },

    buildNoteMetaFooterHtml(item, { targetCatName = '', categoryColor = UNCATEGORIZED_COLOR } = {}) {
        const createdLabel = this.formatCreatedDate(item.created_at);
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
                    <span class="badge-dot" style="background-color: ${categoryColor};" title="${this.escapeAttr(targetCatName || 'Uncategorized')}"></span>
                    ${targetCatName ? `<span class="category-name">${this.escapeHTML(targetCatName)}</span>` : ''}
                </span>
                <span class="editor-meta-stats">
                    ${statsHtml}
                </span>
            </div>
        `;
    },

    updateNoteMetaStats(shell, item) {
        if (!shell || !item) return;
        const draft = { ...item };
        this.syncItemBodyFromDom(shell, draft);
        const sizeEl = shell.querySelector('.editor-note-size');
        const linesEl = shell.querySelector('.editor-note-lines');
        if (sizeEl) sizeEl.textContent = `${computeNoteSizeKb(draft)} KB`;
        if (linesEl) linesEl.textContent = formatNoteLineCount(computeNoteLineCount(draft));
    },

    buildNoteConfigPanelHtml(item, { categoryOptionsHtml = '', startParts = {}, endParts = {} } = {}) {
        return `
            <div class="editor-panel editor-panel--config">
                <div class="collapsable-header" id="config-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Configuration</span>
                </div>
                <div class="collapsable-section collapsed" id="config-section">
                    <div class="form-row-grid form-row-grid--2">
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
    },

    buildNoteEditorShell(item, {
        canEdit = false,
        inModalEditor = false,
        showConfig = false,
        showFormat = false,
        richEdit = false,
        toolbarHtml = '',
        toolbarDragZone = '',
        footerDragZone = '',
        targetCatName = '',
        categoryColor = UNCATEGORIZED_COLOR,
        categoryOptionsHtml = '',
        startParts = {},
        endParts = {},
        bodyId = ''
    } = {}) {
        const titleHtml = this.buildNoteTitleHtml(item, canEdit, { richEdit });
        const bodyHtml = this.buildNoteBodyHtml(item, {
            canEdit,
            inModalEditor,
            richEdit
        });
        const formatHtml = showFormat ? this.buildNoteFormatPanelHtml(item) : '';
        const configHtml = showConfig
            ? this.buildNoteConfigPanelHtml(item, { categoryOptionsHtml, startParts, endParts })
            : '';
        const metaHtml = this.buildNoteMetaFooterHtml(item, {
            targetCatName,
            categoryColor
        });
        const bodyIdAttr = bodyId ? ` id="${bodyId}"` : '';

        const toplineDragZone = toolbarDragZone || footerDragZone || '';
        const toplineHtml = `
                <div class="editor-note-topline${toplineDragZone}">
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
    },

    bindCollapsable(headerId, sectionId, startCollapsed = false) {
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
    },

    getEditorZoom() {
        const stored = parseFloat(localStorage.getItem(EDITOR_ZOOM_KEY));
        if (!Number.isFinite(stored)) return 1;
        return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, stored));
    },

    zoomToDisplay(zoom) {
        return Math.round(zoom * 100);
    },

    displayToZoom(display) {
        const n = parseInt(String(display).trim(), 10);
        if (!Number.isFinite(n)) return 1;
        const zoom = n / 100;
        return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, zoom));
    },

    syncZoomInput(shell, zoom) {
        const input = shell?.querySelector('#format-zoom-input')
            || document.getElementById('format-zoom-input');
        if (input) input.value = String(this.zoomToDisplay(zoom));
    },

    setEditorZoom(shell, zoom) {
        const clamped = Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, zoom));
        localStorage.setItem(EDITOR_ZOOM_KEY, String(clamped));
        shell?.style?.setProperty('--editor-zoom', String(clamped));
        this.syncZoomInput(shell, clamped);
        return clamped;
    },

    applyZoomFromInput(shell) {
        const input = shell?.querySelector('#format-zoom-input')
            || document.getElementById('format-zoom-input');
        if (!input) return this.getEditorZoom();
        return this.setEditorZoom(shell, this.displayToZoom(input.value));
    },

    applyFormatCommand(cmd) {
        const el = document.activeElement;
        if (!el?.classList?.contains('rich-text--edit')) return false;
        document.execCommand(cmd, false, null);
        return true;
    },

    bindBodyConvertBar(shell, item, {
        refresh = () => {},
        localOnly = false,
        onChange = () => {}
    } = {}) {
        if (!shell || shell.dataset.convertBound) return;
        shell.dataset.convertBound = '1';

        shell.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-convert]');
            if (!btn || !shell.contains(btn) || btn.disabled) return;
            e.preventDefault();
            e.stopPropagation();

            const action = btn.dataset.convert;
            this.syncItemBodyFromDom(shell, item);
            Object.assign(item, normalizeItemForSave(item));

            const applyMutate = (mutator, { persist = !localOnly } = {}) => {
                if (persist) {
                    this.mutateItem(item, mutator, { preserveView: true, skipRerender: true, localOnly });
                } else {
                    mutator(item);
                }
            };

            const syncAndNormalize = (it) => {
                this.syncItemBodyFromDom(shell, it);
                Object.assign(it, normalizeItemForSave(it));
            };

            if (action === 'to-checklist') {
                if (!contentHasConvertibleText(item.content)) return;
                applyMutate((it) => {
                    syncAndNormalize(it);
                    convertContentToChecklist(it, () => this.createBlankChecklistStep());
                    Object.assign(it, normalizeItemForSave(it));
                });
            } else if (action === 'to-content') {
                if (!stepsHaveConvertibleText(item.steps)) return;
                applyMutate((it) => {
                    syncAndNormalize(it);
                    convertChecklistToContent(it);
                    Object.assign(it, normalizeItemForSave(it));
                });
            } else {
                return;
            }

            refresh();
            this.updateConvertButtons(shell, item);
            if (localOnly) onChange();

            const body = shell.querySelector('.editor-note-body');
            requestAnimationFrame(() => {
                if (action === 'to-checklist') {
                    const first = body?.querySelector('[data-field="step-text"].card-inline-edit');
                    if (first) this.focusInlineEdit(first, 'start');
                } else if (action === 'to-content') {
                    const content = body?.querySelector('[data-field="content"].card-inline-edit');
                    if (content) this.focusInlineEdit(content, 'start');
                }
            });
        });
    },

    bindFormatPanel(shell, { onChange = () => {} } = {}) {
        if (!shell) return;
        this.bindCollapsable('format-section-header', 'format-section', true);
        this.setEditorZoom(shell, this.getEditorZoom());

        shell.querySelectorAll('[data-format-cmd]').forEach((btn) => {
            btn.addEventListener('mousedown', (e) => e.preventDefault());
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (this.applyFormatCommand(btn.dataset.formatCmd)) onChange();
            });
        });

        shell.querySelectorAll('[data-zoom]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const action = btn.dataset.zoom;
                const current = this.getEditorZoom();
                if (action === 'reset') this.setEditorZoom(shell, 1);
                else if (action === 'up') this.setEditorZoom(shell, current + EDITOR_ZOOM_STEP);
                else if (action === 'down') this.setEditorZoom(shell, current - EDITOR_ZOOM_STEP);
            });
        });

        const zoomInput = shell.querySelector('#format-zoom-input')
            || document.getElementById('format-zoom-input');
        if (zoomInput) {
            const commitZoomInput = () => {
                this.applyZoomFromInput(shell);
            };
            zoomInput.addEventListener('change', commitZoomInput);
            zoomInput.addEventListener('blur', commitZoomInput);
            zoomInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    commitZoomInput();
                    zoomInput.blur();
                }
            });
        }
    },

    bindNoteEditorShell(root, item, {
        showConfig = false,
        showFormat = false,
        richEdit = false,
        localOnly = false,
        refresh = () => {},
        onChange = () => {},
        onConfigChange = () => {},
        onStatusChange = () => {},
        bindDateDefaults = null,
        stopMousedownPropagation = false,
        onRaiseCard = null
    } = {}) {
        const shell = root?.querySelector?.('.editor-note-shell') || root;
        if (!shell || !item) return;

        const interactionOptions = {
            refresh,
            localOnly,
            onChange,
            stopMousedownPropagation,
            richEdit,
            onRaiseCard
        };
        const header = shell.querySelector('.editor-note-header');
        const body = shell.querySelector('.editor-note-body');
        if (header) this.attachNoteBodyInteractions(header, item, interactionOptions);
        if (body) this.attachNoteBodyInteractions(body, item, interactionOptions);
        hydrateNoteIcons(shell);

        if (stopMousedownPropagation && !shell.dataset.shellBubbleBound) {
            shell.dataset.shellBubbleBound = '1';
            shell.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (e.target.closest('.card-act--drag')) return;
                if (!e.target.closest(
                    '.card-inline-edit, .step-check, .step-text, input, textarea, button, a, '
                    + '.card-act, .grab-handle--step, .expanded-checklist-add-btn, '
                    + '.checklist-done-toggle, .step-collapse-btn, .step-delete-btn, '
                    + '.step-indent-btn, .step-outdent-btn, .checklist-expand-collapse-all-btn'
                )) return;
                e.stopPropagation();
            });
        }

        shell.querySelectorAll('.card-inline-edit').forEach((el) => {
            el.addEventListener('input', () => this.updateNoteMetaStats(shell, item));
        });

        if (localOnly && onChange) {
            shell.querySelectorAll('.card-inline-edit').forEach((el) => {
                el.addEventListener('input', onChange);
            });
        }

        if (showFormat) {
            this.bindFormatPanel(shell, { onChange });
            this.bindBodyConvertBar(shell, item, { refresh, localOnly, onChange });
            this.updateConvertButtons(shell, item);
        }

        if (!showConfig) return;

        ['edit-visibility', 'edit-status', 'edit-category', 'edit-start-date', 'edit-start-time', 'edit-end-date', 'edit-end-time'].forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.addEventListener('input', onConfigChange);
            el.addEventListener('change', () => {
                onConfigChange();
                if (id === 'edit-status' && onStatusChange) onStatusChange();
            });
        });

        if (bindDateDefaults) {
            bindDateDefaults('edit-start-date', 'edit-start-time');
            bindDateDefaults('edit-end-date', 'edit-end-time');
        }
        this.bindCollapsable('config-section-header', 'config-section', true);
    },

    canEditInline() {
        return !!localStorage.getItem('admin_token');
    },

    buildExpandedChecklistHtml(item, canEdit, { richEdit = false } = {}) {
        const collapsedKeys = this.getChecklistCollapsedKeys();
        const { active, done } = partitionChecklistSteps(item.steps);
        let html = '<div class="expanded-checklist">';
        html += this.buildChecklistExpandCollapseAllHtml(item);

        const renderRowHtml = (step, { hasKids = false, isCollapsed = false, collapseKey = '', isDoneSection = false, treeGuides = [] } = {}) => {
            const level = getStepLevel(step);
            const collapseControl = !isDoneSection && hasKids
                ? `<button type="button" class="step-collapse-btn" data-collapse-key="${this.escapeAttr(collapseKey)}" title="${isCollapsed ? 'Expand group' : 'Collapse group'}" aria-label="${isCollapsed ? 'Expand group' : 'Collapse group'}">${isCollapsed ? CARD_ICONS.chevronRight : CARD_ICONS.chevronDown}</button>`
                : '<span class="step-collapse-spacer" aria-hidden="true"></span>';
            const dragHandle = !canEdit
                ? ''
                : isDoneSection
                    ? '<span class="grab-handle grab-handle--step grab-handle--spacer" aria-hidden="true">⋮⋮</span>'
                    : '<span class="grab-handle grab-handle--step" title="Drag to reorder" aria-label="Drag to reorder">⋮⋮</span>';
            const nestControls = canEdit ? `
                    <button type="button" class="card-act step-outdent-btn" title="Outdent" aria-label="Outdent"${level === 0 ? ' disabled' : ''}>‹</button>
                    <button type="button" class="card-act step-indent-btn" title="Indent" aria-label="Indent"${level >= 4 ? ' disabled' : ''}>›</button>` : '';
            const copyBtn = canEdit
                ? `<button type="button" class="card-act step-copy-btn" title="Copy item" aria-label="Copy item">${CARD_ICONS.copy}</button>`
                : '';
            const deleteBtn = canEdit
                ? `<button type="button" class="card-act card-act--danger step-delete-btn" title="Remove item" aria-label="Remove item">${CARD_ICONS.close}</button>`
                : '';
            const stepText = step.text || '';
            const stepRich = hasRichMarkup(stepText);
            let textHtml;
            if (canEdit && (richEdit || this.canInlineEditText(stepText, { richEdit }))) {
                const inner = richEdit ? sanitizeRichHtml(stepText) : this.escapeHTML(stepText);
                const ce = richEdit ? 'true' : 'plaintext-only';
                const richClasses = richEdit ? ' rich-text rich-text--edit' : '';
                textHtml = `<span class="step-text card-inline-edit${richClasses} ${step.completed ? 'completed' : ''}" contenteditable="${ce}" spellcheck="false" data-field="step-text" data-step-id="${step.id}">${inner}</span>`;
            } else {
                const richClass = stepRich ? ' rich-text' : '';
                textHtml = `<span class="step-text${richClass} ${step.completed ? 'completed' : ''}">${this.renderRichHtml(stepText)}</span>`;
            }
            const treeGutterHtml = !isDoneSection && treeGuides.length > 0
                ? `<span class="step-tree-gutter" aria-hidden="true">${treeGuides.map(({ role }) => {
                    if (!role) return '<span class="step-tree-cell" aria-hidden="true"></span>';
                    return `<span class="step-tree-guide step-tree-guide--${role}" aria-hidden="true"></span>`;
                }).join('')}</span>`
                : '';
            return `
                <div class="step-row step-row--display${step.completed ? ' step-row--done' : ''}" data-step-id="${step.id}" data-level="${level}">
                    <div class="step-row-leading">
                        ${dragHandle}
                        ${collapseControl}
                        ${treeGutterHtml}
                        <input type="checkbox" class="step-check" ${step.completed ? 'checked' : ''}>
                    </div>
                    ${textHtml}
                    <div class="step-row-actions">
                        ${copyBtn}
                        ${canEdit ? `<span class="step-nest-controls">${nestControls}</span>` : ''}
                        ${deleteBtn}
                    </div>
                </div>
            `;
        };

        annotateChecklistTreeGuides(buildVisibleChecklistSteps(active, item.id, collapsedKeys))
            .forEach((row) => { html += renderRowHtml(row.step, row); });

        if (canEdit) {
            html += `<button type="button" class="card-act expanded-checklist-add-btn" title="Add checklist item" aria-label="Add checklist item">+</button>`;
        }

        if (done.length > 0) {
            const doneCollapsed = this.isChecklistDoneSectionCollapsed(item.id);
            const toggleTitle = doneCollapsed
                ? `Show ${done.length} completed item${done.length === 1 ? '' : 's'}`
                : 'Collapse completed items';
            const toggleIcon = doneCollapsed ? CARD_ICONS.chevronRight : CARD_ICONS.chevronDown;
            const toggleLabel = doneCollapsed
                ? `Hidden items (${done.length})`
                : 'Completed';
            html += `<button type="button" class="checklist-done-toggle" title="${this.escapeAttr(toggleTitle)}" aria-expanded="${doneCollapsed ? 'false' : 'true'}" aria-label="${this.escapeAttr(toggleTitle)}">
                <span class="checklist-done-toggle-icon" aria-hidden="true">${toggleIcon}</span>
                <span class="checklist-done-toggle-label">${this.escapeHTML(toggleLabel)}</span>
            </button>`;
            if (!doneCollapsed && active.length > 0) {
                html += '<div class="checklist-done-divider" role="separator" aria-hidden="true"></div>';
            }
            html += `<div class="checklist-done-section${doneCollapsed ? ' is-hidden' : ''}">`;
            done.forEach((step) => { html += renderRowHtml(step, { isDoneSection: true }); });
            html += '</div>';
        }

        html += '</div>';
        return html;
    },

    splitInlineEditAtCaret(el) {
        const rich = el.classList.contains('rich-text--edit');
        const readFull = () => (rich
            ? sanitizeRichHtml(linkifyPlainUrls(el.innerHTML))
            : (el.textContent || ''));

        const sel = window.getSelection();
        if (!sel?.rangeCount) {
            const full = readFull();
            return { before: full, after: '' };
        }

        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) {
            const full = readFull();
            return { before: full, after: '' };
        }

        const measureRange = range.cloneRange();
        measureRange.selectNodeContents(el);
        measureRange.setEnd(range.startContainer, range.startOffset);
        const plainOffset = measureRange.toString().length;

        if (!rich) {
            const full = el.textContent || '';
            return {
                before: full.slice(0, plainOffset),
                after: full.slice(plainOffset)
            };
        }

        const fullHtml = readFull();
        const fullPlain = stripRichText(fullHtml);
        if (plainOffset <= 0) {
            return { before: '', after: fullHtml };
        }
        if (plainOffset >= fullPlain.length) {
            return { before: fullHtml, after: '' };
        }

        const beforeRange = range.cloneRange();
        beforeRange.selectNodeContents(el);
        beforeRange.setEnd(range.startContainer, range.startOffset);

        const afterRange = range.cloneRange();
        afterRange.selectNodeContents(el);
        afterRange.setStart(range.endContainer, range.endOffset);

        const htmlFromFragment = (frag) => {
            const div = document.createElement('div');
            div.appendChild(frag);
            return div.innerHTML;
        };
        return {
            before: sanitizeRichHtml(linkifyPlainUrls(htmlFromFragment(beforeRange.cloneContents()))),
            after: sanitizeRichHtml(linkifyPlainUrls(htmlFromFragment(afterRange.cloneContents())))
        };
    },

    caretAtEdge(el, edge) {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return false;
        const probe = range.cloneRange();
        probe.selectNodeContents(el);
        if (edge === 'start') {
            probe.setEnd(range.startContainer, range.startOffset);
            return probe.toString().length === 0;
        }
        probe.setStart(range.endContainer, range.endOffset);
        return probe.toString().length === 0;
    },

    caretAtPlainEdge(el, edge) {
        const sel = window.getSelection();
        if (!sel?.rangeCount) return true;
        const range = sel.getRangeAt(0);
        if (!el.contains(range.startContainer)) return false;

        const measureRange = range.cloneRange();
        measureRange.selectNodeContents(el);
        measureRange.setEnd(range.startContainer, range.startOffset);
        const plainOffset = measureRange.toString().length;

        const rich = el.classList.contains('rich-text--edit');
        const fullPlain = rich
            ? stripRichText(sanitizeRichHtml(linkifyPlainUrls(el.innerHTML)))
            : (el.textContent || '');

        if (edge === 'start') return plainOffset <= 0;
        return plainOffset >= fullPlain.length;
    },

    findAdjacentChecklistStepRow(row, direction) {
        if (!row) return null;
        let sibling = direction === 'next' ? row.nextElementSibling : row.previousElementSibling;
        while (sibling) {
            if (sibling.classList?.contains('step-row--display')) return sibling;
            sibling = direction === 'next' ? sibling.nextElementSibling : sibling.previousElementSibling;
        }
        return null;
    },

    getAdjacentChecklistStep(item, row, direction) {
        const stepId = row?.dataset?.stepId;
        if (!stepId) return null;
        const steps = item.steps || [];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return null;
        if (direction === 'prev') {
            return idx > 0 ? steps[idx - 1] : null;
        }
        return idx < steps.length - 1 ? steps[idx + 1] : null;
    },

    focusInlineEdit(el, edge = 'end') {
        if (!el) return;
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(edge === 'start');
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
    },

    setCaretAtPlainOffset(el, offset) {
        if (!el) return;
        el.focus();
        const target = Math.max(0, Number(offset) || 0);
        const range = document.createRange();
        const sel = window.getSelection();
        let remaining = target;
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node) {
            const len = node.textContent.length;
            if (remaining <= len) {
                range.setStart(node, remaining);
                range.collapse(true);
                sel?.removeAllRanges();
                sel?.addRange(range);
                return;
            }
            remaining -= len;
            node = walker.nextNode();
        }
        range.selectNodeContents(el);
        range.collapse(false);
        sel?.removeAllRanges();
        sel?.addRange(range);
    },

    scheduleChecklistStepFocus(root, stepId, { edge = 'start', plainOffset = null } = {}) {
        const host = root.closest('.mini-card') || root;
        host.dataset.pendingFocusStepId = stepId;
        host.dataset.pendingFocusEdge = edge;
        if (plainOffset != null) {
            host.dataset.pendingFocusPlainOffset = String(plainOffset);
        } else {
            delete host.dataset.pendingFocusPlainOffset;
        }
    },

    getInlineEditSequence(root) {
        const fields = [];
        const title = root.querySelector('[data-field="title"].card-inline-edit');
        const content = root.querySelector('[data-field="content"].card-inline-edit');
        if (title) fields.push(title);
        if (content) fields.push(content);
        root.querySelectorAll('[data-field="step-text"].card-inline-edit').forEach((el) => fields.push(el));
        return fields;
    },

    handleInlineEditArrowNav(e, root, fieldEl) {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
        const sequenceRoot = fieldEl.closest('.editor-note-shell') || root;
        const fields = this.getInlineEditSequence(sequenceRoot);
        const idx = fields.indexOf(fieldEl);
        if (idx < 0) return false;

        if (e.key === 'ArrowDown' && this.caretAtEdge(fieldEl, 'end') && idx < fields.length - 1) {
            e.preventDefault();
            this.focusInlineEdit(fields[idx + 1], 'start');
            return true;
        }
        if (e.key === 'ArrowUp' && this.caretAtEdge(fieldEl, 'start') && idx > 0) {
            e.preventDefault();
            this.focusInlineEdit(fields[idx - 1], 'end');
            return true;
        }
        return false;
    },

    insertChecklistStep(root, item, refresh, applyMutate, { afterStepId = null, initialText = '' } = {}) {
        const newStep = this.createBlankChecklistStep();
        newStep.text = initialText ?? '';
        applyMutate((it) => {
            if (it.type !== 'checklist') it.type = 'checklist';
            if (!it.steps) it.steps = [];
            if (afterStepId) {
                const idx = it.steps.findIndex((s) => s.id === afterStepId);
                if (idx >= 0) {
                    newStep.level = getStepLevel(it.steps[idx]);
                    it.steps.splice(idx + 1, 0, newStep);
                } else {
                    it.steps.push(newStep);
                }
            } else {
                it.steps.push(newStep);
            }
            reorderStepsByCompletion(it.steps);
        }, { persist: false });

        const host = root.closest('.mini-card') || root;
        this.scheduleChecklistStepFocus(root, newStep.id, { edge: 'start' });
        refresh();
        this.focusPendingChecklistStep(host);
    },

    focusPendingChecklistStep(root) {
        const focusNewStep = () => {
            const pendingId = root.dataset.pendingFocusStepId;
            if (!pendingId) return false;
            const newEl = root.querySelector(
                `[data-field="step-text"].card-inline-edit[data-step-id="${pendingId}"]`
            );
            if (!newEl) return false;
            const edge = root.dataset.pendingFocusEdge || 'start';
            const plainOffset = root.dataset.pendingFocusPlainOffset;
            delete root.dataset.pendingFocusStepId;
            delete root.dataset.pendingFocusEdge;
            delete root.dataset.pendingFocusPlainOffset;
            if (plainOffset != null && plainOffset !== '') {
                this.setCaretAtPlainOffset(newEl, Number(plainOffset));
            } else {
                this.focusInlineEdit(newEl, edge);
            }
            return true;
        };

        requestAnimationFrame(() => {
            if (!focusNewStep()) requestAnimationFrame(() => focusNewStep());
        });
    },

    removeChecklistStepAndFocus(root, item, refresh, applyMutate, {
        stepId,
        focusStepId,
        focusEdge = 'start',
        plainOffset = null
    } = {}) {
        applyMutate((it) => {
            it.steps = (it.steps || []).filter((s) => s.id !== stepId);
            if (!it.steps.length) it.type = 'note';
        }, { persist: false });
        this.scheduleChecklistStepFocus(root, focusStepId, { edge: focusEdge, plainOffset });
        refresh();
        this.focusPendingChecklistStep(root.closest('.mini-card') || root);
    },

    handleChecklistBackspace(root, item, el, refresh, { applyMutate, localOnly = false } = {}) {
        const sel = window.getSelection();
        if (!sel?.isCollapsed) return false;
        if (!this.caretAtPlainEdge(el, 'start')) return false;

        el.dataset.skipBlurSave = '1';
        this.syncInlineFieldToItem(el, item);
        const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);

        const stepId = el.dataset.stepId;
        const steps = item.steps || [];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return false;

        const current = steps[idx];
        const empty = !stripRichText(current.text || '').trim();
        const row = el.closest('.step-row--display');

        if (empty) {
            if (steps.length <= 1) return true;
            const prevRow = this.findAdjacentChecklistStepRow(row, 'prev');
            const nextRow = this.findAdjacentChecklistStepRow(row, 'next');
            const focusStepId = prevRow?.dataset.stepId || nextRow?.dataset.stepId;
            if (!focusStepId) return true;
            this.removeChecklistStepAndFocus(root, item, refresh, applyMutate, {
                stepId,
                focusStepId,
                focusEdge: prevRow ? 'end' : 'start'
            });
            this.commitInlineChecklistOp(item, beforeItem, { localOnly });
            return true;
        }

        const prev = this.getAdjacentChecklistStep(item, row, 'prev');
        if (!prev || prev.completed !== current.completed) return false;

        const joinAt = stripRichText(prev.text || '').length;
        const merged = `${prev.text || ''}${current.text || ''}`;
        const rich = el.classList.contains('rich-text--edit');

        applyMutate((it) => {
            const p = it.steps?.find((s) => s.id === prev.id);
            const c = it.steps?.find((s) => s.id === stepId);
            if (!p || !c) return;
            p.text = rich ? sanitizeRichHtml(linkifyPlainUrls(merged)) : merged;
            it.steps = it.steps.filter((s) => s.id !== stepId);
        }, { persist: false });

        this.scheduleChecklistStepFocus(root, prev.id, { plainOffset: joinAt });
        refresh();
        this.focusPendingChecklistStep(root.closest('.mini-card') || root);
        this.commitInlineChecklistOp(item, beforeItem, { localOnly });
        return true;
    },

    handleChecklistDelete(root, item, el, refresh, { applyMutate, localOnly = false } = {}) {
        const sel = window.getSelection();
        if (!sel?.isCollapsed) return false;
        if (!this.caretAtPlainEdge(el, 'end')) return false;

        el.dataset.skipBlurSave = '1';
        this.syncInlineFieldToItem(el, item);
        const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);

        const stepId = el.dataset.stepId;
        const steps = item.steps || [];
        const idx = steps.findIndex((s) => s.id === stepId);
        if (idx < 0) return false;

        const current = steps[idx];
        const row = el.closest('.step-row--display');
        const next = this.getAdjacentChecklistStep(item, row, 'next');
        if (!next || next.completed !== current.completed) return false;

        const nextEmpty = !stripRichText(next.text || '').trim();
        const rich = el.classList.contains('rich-text--edit');

        if (nextEmpty) {
            applyMutate((it) => {
                it.steps = (it.steps || []).filter((s) => s.id !== next.id);
            }, { persist: false });
            this.scheduleChecklistStepFocus(root, stepId, { edge: 'end' });
            refresh();
            this.focusPendingChecklistStep(root.closest('.mini-card') || root);
            this.commitInlineChecklistOp(item, beforeItem, { localOnly });
            return true;
        }

        const joinAt = stripRichText(current.text || '').length;
        const merged = `${current.text || ''}${next.text || ''}`;

        applyMutate((it) => {
            const cur = it.steps?.find((s) => s.id === stepId);
            if (!cur) return;
            cur.text = rich ? sanitizeRichHtml(linkifyPlainUrls(merged)) : merged;
            it.steps = it.steps.filter((s) => s.id !== next.id);
        }, { persist: false });

        this.scheduleChecklistStepFocus(root, stepId, { plainOffset: joinAt });
        refresh();
        this.focusPendingChecklistStep(root.closest('.mini-card') || root);
        this.commitInlineChecklistOp(item, beforeItem, { localOnly });
        return true;
    },

    handleChecklistEnter(root, item, el, refresh, { applyMutate, localOnly = false } = {}) {
        el.dataset.skipBlurSave = '1';
        const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
        const stepId = el.dataset.stepId;
        const { before, after } = this.splitInlineEditAtCaret(el);
        applyMutate((it) => {
            const step = it.steps?.find((s) => s.id === stepId);
            if (step) step.text = before ?? '';
        }, { persist: false });
        this.insertChecklistStep(root, item, refresh, applyMutate, {
            afterStepId: stepId,
            initialText: after
        });
        this.commitInlineChecklistOp(item, beforeItem, { localOnly });
    },

    attachNoteBodyInteractions(root, item, {
        refresh = () => {},
        localOnly = false,
        onChange = () => {},
        stopMousedownPropagation = false,
        richEdit = false,
        onRaiseCard = null
    } = {}) {
        const applyMutate = (mutator, { persist = !localOnly } = {}) => {
            if (persist) {
                this.mutateItem(item, mutator, { preserveView: true, skipRerender: true, localOnly });
                if (localOnly) onChange();
            } else {
                mutator(item);
            }
        };

        if (this.canEditInline() || localOnly) {
            if (!root.dataset.noteInteractionsBound) {
                root.dataset.noteInteractionsBound = '1';
                root.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    const active = document.activeElement;
                    if (!active?.classList?.contains('card-inline-edit') || !root.contains(active)) return;
                    if (active === e.target || active.contains(e.target)) return;
                    applyMutate(() => this.syncInlineFieldToItem(active, item));
                    active.dataset.skipBlurSave = '1';
                }, true);
            }

            root.querySelectorAll('.card-inline-edit').forEach((el) => {
                el.addEventListener('click', (e) => {
                    if (this.tryOpenRichEditLink(e, el)) return;
                    e.stopPropagation();
                });
                el.addEventListener('mousedown', (e) => {
                    if (e.button !== 0) return;
                    if (el.classList.contains('rich-text--edit') && e.target.closest('a[href]')) {
                        e.preventDefault();
                    }
                    if (stopMousedownPropagation) {
                        e.stopPropagation();
                    }
                });
                el.addEventListener('focus', () => {
                    const card = root.closest('.mini-card');
                    if (card?.dataset?.desktop === '1' && onRaiseCard) onRaiseCard(card);
                });
                if (el.classList.contains('rich-text--edit')) {
                    el.addEventListener('paste', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const beforePaste = this.prepareInlineOpSnapshot(root, item, localOnly);
                        const plain = e.clipboardData?.getData('text/plain') || '';
                        if (plain) {
                            document.execCommand('insertText', false, plain);
                        } else {
                            const html = e.clipboardData?.getData('text/html') || '';
                            if (html) document.execCommand('insertHTML', false, sanitizeRichHtml(html));
                        }
                        this.syncInlineFieldToItem(el, item);
                        this.commitInlineTextOp(item, beforePaste, { localOnly });
                        if (localOnly) onChange();
                    });
                }
                el.addEventListener('keydown', (e) => {
                    if (el.classList.contains('rich-text--edit')) {
                        const mod = e.ctrlKey || e.metaKey;
                        if (mod && e.key === 'b') {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('bold');
                            if (localOnly) onChange();
                            return;
                        }
                        if (mod && e.key === 'i') {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('italic');
                            if (localOnly) onChange();
                            return;
                        }
                        if (mod && e.shiftKey && (e.key === 's' || e.key === 'S')) {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('strikeThrough');
                            if (localOnly) onChange();
                            return;
                        }
                    }
                    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (localOnly) {
                            document.execCommand('undo');
                        } else {
                            UndoManager.undo();
                        }
                        return;
                    }
                    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                        e.preventDefault();
                        e.stopPropagation();
                        if (!localOnly) UndoManager.redo();
                        return;
                    }
                    if (el.dataset.field === 'content' && e.key === 'Enter') {
                        e.preventDefault();
                        e.stopPropagation();
                        if (el.classList.contains('rich-text--edit')) {
                            document.execCommand('insertLineBreak');
                        } else {
                            this.insertTextAtCaret(el, e.shiftKey ? SOFT_BREAK : '\n');
                        }
                        if (localOnly) onChange();
                        return;
                    }
                    if (el.dataset.field === 'step-text' && e.key === 'Enter') {
                        if (e.shiftKey) {
                            e.preventDefault();
                            e.stopPropagation();
                            document.execCommand('insertLineBreak');
                            return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        this.handleChecklistEnter(root, item, el, refresh, { applyMutate, localOnly });
                        return;
                    }
                    if (el.dataset.field === 'step-text' && e.key === 'Backspace') {
                        if (this.handleChecklistBackspace(root, item, el, refresh, { applyMutate, localOnly })) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        return;
                    }
                    if (el.dataset.field === 'step-text' && e.key === 'Delete') {
                        if (this.handleChecklistDelete(root, item, el, refresh, { applyMutate, localOnly })) {
                            e.preventDefault();
                            e.stopPropagation();
                        }
                        return;
                    }
                    if (!this.handleInlineEditArrowNav(e, root, el)) e.stopPropagation();
                });
                el.addEventListener('blur', () => {
                    if (el.dataset.skipBlurSave) {
                        delete el.dataset.skipBlurSave;
                        return;
                    }
                    applyMutate(() => this.syncInlineFieldToItem(el, item));
                });
            });
        }

        if (root.querySelector('.expanded-checklist') && !root.dataset.checklistInteractionsBound) {
            root.dataset.checklistInteractionsBound = '1';
            if (!item.steps) item.steps = [];

            root.querySelector('.expanded-checklist-add-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.insertChecklistStep(root, item, refresh, applyMutate);
            });

            root.querySelectorAll('.step-row--display').forEach((row) => {
                const checkbox = row.querySelector('.step-check');
                const stepId = row.dataset.stepId;
                checkbox?.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                });
                checkbox?.addEventListener('change', (e) => {
                    e.stopPropagation();
                    this.ensureChecklistStepFromRow(row, item);
                    const step = item.steps?.find((s) => s.id === stepId);
                    if (!step) return;
                    row.classList.add('step-row--animating');
                    applyMutate((it) => {
                        const s = it.steps.find((st) => st.id === stepId);
                        if (!s) return;
                        moveStepOnCompletionChange(it.steps, s, checkbox.checked);
                    });
                    refresh();
                });
            });

            root.querySelectorAll('.step-indent-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId) return;
                    this.ensureChecklistStepFromRow(row, item);
                    const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
                    applyMutate((it) => {
                        const activeSteps = it.steps.filter((step) => !step.completed);
                        const idx = activeSteps.findIndex((s) => s.id === stepId);
                        if (idx < 0) return;
                        if (getStepLevel(activeSteps[idx]) >= 4) return;
                        applySubtreeLevelDelta(activeSteps, idx, +1);
                        normalizeChecklistLevels(activeSteps);
                        const doneSteps = it.steps.filter((step) => step.completed);
                        it.steps = [...activeSteps, ...doneSteps];
                    }, { persist: false });
                    this.expandChecklistAncestorsForStep(item, stepId);
                    const host = root.closest('.mini-card') || root;
                    this.scheduleChecklistStepFocus(root, stepId, { edge: 'start' });
                    refresh();
                    this.focusPendingChecklistStep(host);
                    this.commitInlineChecklistOp(item, beforeItem, { localOnly });
                });
            });

            root.querySelectorAll('.step-outdent-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId) return;
                    this.ensureChecklistStepFromRow(row, item);
                    const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
                    applyMutate((it) => {
                        const activeSteps = it.steps.filter((step) => !step.completed);
                        const idx = activeSteps.findIndex((s) => s.id === stepId);
                        if (idx < 0) return;
                        if (getStepLevel(activeSteps[idx]) <= 0) return;
                        applySubtreeLevelDelta(activeSteps, idx, -1);
                        normalizeChecklistLevels(activeSteps);
                        const doneSteps = it.steps.filter((step) => step.completed);
                        it.steps = [...activeSteps, ...doneSteps];
                    }, { persist: false });
                    this.expandChecklistAncestorsForStep(item, stepId);
                    const host = root.closest('.mini-card') || root;
                    this.scheduleChecklistStepFocus(root, stepId, { edge: 'start' });
                    refresh();
                    this.focusPendingChecklistStep(host);
                    this.commitInlineChecklistOp(item, beforeItem, { localOnly });
                });
            });

            root.querySelectorAll('.step-collapse-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const key = btn.dataset.collapseKey;
                    if (!key) return;
                    const collapsed = this.getChecklistCollapsedKeys();
                    collapsed[key] = !collapsed[key];
                    if (!collapsed[key]) delete collapsed[key];
                    localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
                    refresh();
                });
            });

            root.querySelectorAll('.checklist-done-toggle').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleChecklistDoneSection(item.id);
                    refresh();
                });
            });

            root.querySelector('.checklist-expand-collapse-all-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleChecklistExpandCollapseAll(item);
                refresh();
            });

            root.querySelectorAll('.step-delete-btn').forEach((btn) => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    if (!stepId || !item.steps) return;
                    if (!item.steps.some((s) => s.id === stepId)) return;
                    applyMutate((it) => {
                        it.steps = it.steps.filter((s) => s.id !== stepId);
                        if (!it.steps.length) it.type = 'note';
                    }, { persist: false });
                    refresh();
                    this.commitInlineChecklistOp(item, beforeItem, { localOnly });
                });
            });

            root.querySelectorAll('.step-copy-btn').forEach((btn) => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const shell = root.closest('.editor-note-shell') || root;
                    this.syncItemBodyFromDom(shell, item);
                    const row = btn.closest('.step-row--display');
                    const stepId = row?.dataset.stepId;
                    const step = item.steps?.find((s) => s.id === stepId);
                    if (!step) return;
                    const ok = await copyPlainTextToClipboard(stepToPlainCopyLine(step));
                    if (ok) this.flashCopyFeedback(btn);
                    else this.flashCopyFeedback(btn, 'Copy failed', { failed: true });
                });
            });

            if (this.canEditInline() || localOnly) {
                this.attachChecklistDrag(root, item, applyMutate, refresh, localOnly);
            }
        }
    },

    attachChecklistDrag(root, item, applyMutate, refresh, localOnly = false) {
        if (!root.querySelector('.expanded-checklist')) return;
        if (root.dataset.checklistDragBound) return;
        root.dataset.checklistDragBound = '1';

        const DRAG_THRESHOLD = 4;
        let activeDrag = null;

        const getList = () => root.querySelector('.expanded-checklist');
        const getActiveRows = () => [...(getList()?.querySelectorAll('.step-row--display:not(.step-row--done)') || [])];

        const getDoneAnchor = (activeList) => activeList.querySelector('.checklist-done-toggle')
            || activeList.querySelector('.checklist-done-section')
            || activeList.querySelector('.step-row--done');

        const buildDomBlockFromIds = (rows, ids) => {
            const idSet = new Set(ids);
            return rows.filter((row) => idSet.has(row.dataset.stepId));
        };

        const syncDomBlock = () => {
            if (!activeDrag) return;
            const rows = getActiveRows();
            activeDrag.block = buildDomBlockFromIds(rows, activeDrag.blockStepIds);
        };

        const updateDropIndicator = (activeList, ref, { mode, targetLevel = 0 } = {}) => {
            let indicator = activeList.querySelector('.checklist-drop-indicator');
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.className = 'checklist-drop-indicator';
                indicator.setAttribute('aria-hidden', 'true');
                activeList.appendChild(indicator);
            }
            if (!ref) {
                indicator.classList.remove('is-visible');
                indicator.style.marginLeft = '';
                return;
            }
            indicator.classList.add('is-visible');
            indicator.style.marginLeft = `${targetLevel * 0.45}rem`;
            activeList.insertBefore(indicator, ref);
        };

        const hideDropIndicator = () => {
            const indicator = getList()?.querySelector('.checklist-drop-indicator');
            if (!indicator) return;
            indicator.classList.remove('is-visible');
            indicator.style.marginLeft = '';
        };

        const reorderAt = (clientY) => {
            const block = activeDrag?.block;
            const activeList = getList();
            if (!block?.length || !activeList?.contains(block[0])) return;

            const allRows = getActiveRows();
            const { insertIndex, dropMode, others, targetLevel } = resolvePointerDropTarget(
                clientY,
                allRows,
                block,
                { bounds: activeDrag.bounds, isSingleLeaf: activeDrag.isSingleLeaf }
            );
            activeDrag.dropMode = dropMode;
            activeDrag.insertIndex = insertIndex;
            activeDrag.targetLevel = targetLevel;

            const ref = others[insertIndex] || getDoneAnchor(activeList);
            block.forEach((node) => {
                activeList.insertBefore(node, ref);
            });
            updateDropIndicator(activeList, ref, { mode: dropMode, targetLevel });
        };

        const finishDrag = () => {
            if (!activeDrag) return;
            const { block, moved, blockStepIds, dropMode } = activeDrag;
            const blockRootId = blockStepIds[0];
            block.forEach((r) => r.classList.remove('is-dragging'));
            hideDropIndicator();
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            if (moved) {
                const shell = root.closest('.editor-note-shell') || root;
                this.syncItemBodyFromDom(shell, item);
                const collapsedKeys = this.getChecklistCollapsedKeys();
                const beforeItem = this.prepareInlineOpSnapshot(root, item, localOnly);
                let parentIdToExpand = null;
                applyMutate((it) => {
                    const activeSteps = it.steps.filter((step) => !step.completed);
                    const doneSteps = it.steps.filter((step) => step.completed);
                    const visibleOrderIds = getActiveRows().map((r) => r.dataset.stepId);
                    const reordered = reorderActiveStepsFromDomOrder(
                        activeSteps,
                        visibleOrderIds,
                        item.id,
                        collapsedKeys
                    );
                    const dropResult = resolveDropTarget(reordered, blockRootId, { mode: dropMode || 'sibling' });
                    parentIdToExpand = dropResult?.parentId || null;
                    normalizeChecklistLevels(reordered);
                    it.steps = [...reordered, ...doneSteps];
                }, { persist: false });
                this.expandChecklistAncestorsForStep(item, blockRootId);
                if (parentIdToExpand) {
                    this.expandChecklistAncestorsForStep(item, parentIdToExpand);
                }
                refresh();
                this.commitInlineChecklistOp(item, beforeItem, { localOnly });
            }
            activeDrag = null;
        };

        const onMove = (e) => {
            if (!activeDrag) return;
            if (!activeDrag.moved) {
                const dx = Math.abs(e.clientX - activeDrag.startX);
                const dy = Math.abs(e.clientY - activeDrag.startY);
                if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return;
                activeDrag.moved = true;
                syncDomBlock();
                activeDrag.block.forEach((r) => r.classList.add('is-dragging'));
            }
            e.preventDefault();
            syncDomBlock();
            reorderAt(e.clientY);
        };

        const onUp = () => finishDrag();

        root.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            const handle = e.target.closest('.grab-handle--step');
            if (!handle || !root.contains(handle)) return;
            const row = handle.closest('.step-row--display:not(.step-row--done)');
            if (!row) return;
            e.preventDefault();
            e.stopPropagation();

            const stepId = row.dataset.stepId;
            const activeSteps = (item.steps || []).filter((step) => !step.completed);
            const stepIndex = activeSteps.findIndex((step) => step.id === stepId);
            if (stepIndex < 0) return;

            const visibleIds = getActiveRows().map((r) => r.dataset.stepId);
            const { subtreeIds, minAmongOthers, maxAmongOthers } = computeVisibleInsertBounds(
                activeSteps,
                stepIndex,
                visibleIds
            );
            const isSingleLeaf = subtreeIds.length === 1
                || !stepHasDescendants(activeSteps, stepIndex);
            const rows = getActiveRows();
            const block = buildDomBlockFromIds(rows, subtreeIds);
            const othersCount = visibleIds.filter((id) => !subtreeIds.includes(id)).length;

            activeDrag = {
                row,
                block,
                blockStepIds: subtreeIds,
                isSingleLeaf,
                bounds: isSingleLeaf
                    ? { minAmongOthers: 0, maxAmongOthers: othersCount }
                    : { minAmongOthers, maxAmongOthers },
                dropMode: 'sibling',
                insertIndex: 0,
                targetLevel: 0,
                startX: e.clientX,
                startY: e.clientY,
                moved: false
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        }, true);
    },

    getChecklistCollapsedKeys() {
        try {
            return JSON.parse(localStorage.getItem('matrix_checklist_collapsed') || '{}');
        } catch {
            return {};
        }
    },

    getChecklistDoneCollapsed() {
        try {
            return JSON.parse(localStorage.getItem('matrix_checklist_done_collapsed') || '{}');
        } catch {
            return {};
        }
    },

    isChecklistDoneSectionCollapsed(itemId) {
        return !!this.getChecklistDoneCollapsed()[itemId];
    },

    toggleChecklistDoneSection(itemId) {
        const collapsed = this.getChecklistDoneCollapsed();
        collapsed[itemId] = !collapsed[itemId];
        if (!collapsed[itemId]) delete collapsed[itemId];
        localStorage.setItem('matrix_checklist_done_collapsed', JSON.stringify(collapsed));
    },

    getChecklistCollapsibleKeys(item) {
        if (!item?.id) return [];
        const { active } = partitionChecklistSteps(item.steps || []);
        const keys = [];
        active.forEach((step, index) => {
            if (!stepHasDescendants(active, index)) return;
            keys.push(`${item.id}:${step.id}`);
        });
        return keys;
    },

    checklistGroupsAnyExpanded(item) {
        const collapsed = this.getChecklistCollapsedKeys();
        return this.getChecklistCollapsibleKeys(item).some((key) => !collapsed[key]);
    },

    collapseAllChecklistGroups(item) {
        const collapsed = this.getChecklistCollapsedKeys();
        this.getChecklistCollapsibleKeys(item).forEach((key) => {
            collapsed[key] = true;
        });
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
    },

    expandAllChecklistGroups(item) {
        const collapsed = this.getChecklistCollapsedKeys();
        this.getChecklistCollapsibleKeys(item).forEach((key) => {
            delete collapsed[key];
        });
        localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(collapsed));
    },

    toggleChecklistExpandCollapseAll(item) {
        if (this.checklistGroupsAnyExpanded(item)) {
            this.collapseAllChecklistGroups(item);
        } else {
            this.expandAllChecklistGroups(item);
        }
    },

    buildChecklistExpandCollapseAllHtml(item) {
        if (!item?.id || !checklistHasIndentations(item.steps)) return '';
        if (this.getChecklistCollapsibleKeys(item).length === 0) return '';
        const anyExpanded = this.checklistGroupsAnyExpanded(item);
        const label = anyExpanded ? 'Collapse all checklist groups' : 'Expand all checklist groups';
        const icon = anyExpanded ? ACTION_ICONS.collapseAll : ACTION_ICONS.expandAll;
        return `<div class="checklist-toolbar">
            <button type="button" class="card-act checklist-expand-collapse-all-btn" title="${this.escapeAttr(label)}" aria-label="${this.escapeAttr(label)}">${icon}</button>
        </div>`;
    },

    escapeHTML,
    escapeAttr
};

export { escapeHTML, escapeAttr } from './domEscape.js';

export const snapshotItem = NoteSurface.snapshotItem.bind(NoteSurface);
export const emitItemMutation = NoteSurface.emitItemMutation.bind(NoteSurface);
export const mutateItem = NoteSurface.mutateItem.bind(NoteSurface);
export const canEditInline = NoteSurface.canEditInline.bind(NoteSurface);
export const renderRichHtml = NoteSurface.renderRichHtml.bind(NoteSurface);
export const formatNoteListDate = NoteSurface.formatNoteListDate.bind(NoteSurface);