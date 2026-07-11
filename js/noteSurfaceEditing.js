/** @module {"owns":"note inline editing, emoji, text operations, zoom controls", "related":["noteSurface.js","noteSurfaceHtml.js","richText.js","emojiPicker.js","domEscape.js"], "events":[]} */
import { sanitizeRichHtml, linkifyPlainUrls, stripRichText, hasRichMarkup } from './richText.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { EmojiPicker } from './iconPicker.js';
import { isAllowedEmoji } from './noteEmojis.js';
import { CARD_ICONS } from './icons.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import { stepToPlainCopyLine } from './noteBodyConversion.js';
import { UndoManager } from './undo.js';
import { bindNoteBodySections, updateConvertButtons, bindCollapsable } from './noteSurfaceHtml.js';
import { syncItemBodyFromDom, mutateItem, attachNoteBodyInteractions, updateNoteMetaStats, syncInlineFieldToItem, buildSheetInteractionOptions } from './noteSurfaceMutations.js';
import { normalizeItemForSave } from './noteModel.js';
import { createBlankChecklistStep } from './noteSurfaceMutations.js';
import { contentHasConvertibleText, stepsHaveConvertibleText, convertContentToChecklist, convertChecklistToContent } from './noteBodyConversion.js';
import { attachSheetInteractions } from './sheet.js';
import { bindChecklistInteractions, attachChecklistDrag } from './noteSurfaceChecklist.js';

const EDITOR_ZOOM_KEY = 'matrix_editor_zoom';
const EDITOR_ZOOM_MIN = 0.85;
const EDITOR_ZOOM_MAX = 1.25;
const EDITOR_ZOOM_STEP = 0.05;
const SOFT_BREAK = '\u2028';

export function insertTextAtCaret(el, text) {
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
}

export function resolveEmojiInsertTarget(root) {
    if (!root) return null;
    const active = document.activeElement;
    if (active?.classList?.contains('card-inline-edit')
        && active.classList.contains('rich-text--edit')
        && root.contains(active)) {
        return active;
    }
    const title = root.querySelector('[data-field="title"].card-inline-edit.rich-text--edit');
    if (title) {
        focusInlineEdit(title, 'end');
        return title;
    }
    const content = root.querySelector('[data-field="content"].card-inline-edit.rich-text--edit');
    if (content) {
        focusInlineEdit(content, 'end');
        return content;
    }
    const step = root.querySelector('[data-field="step-text"].card-inline-edit.rich-text--edit');
    if (step) {
        focusInlineEdit(step, 'end');
        return step;
    }
    return null;
}

export function saveEmojiInsertContext(root) {
    const active = document.activeElement;
    let target = null;
    let range = null;
    if (active?.classList?.contains('card-inline-edit')
        && active.classList.contains('rich-text--edit')
        && root?.contains(active)) {
        target = active;
    } else {
        target = resolveEmojiInsertTarget(root);
    }
    if (target) {
        const sel = window.getSelection();
        if (sel?.rangeCount && target.contains(sel.getRangeAt(0).startContainer)) {
            range = sel.getRangeAt(0).cloneRange();
        }
    }
    return { target, range };
}

export function restoreEmojiInsertRange(target, range) {
    if (!target) return;
    target.focus();
    if (!range) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
}

export function insertEmojiAtCaret(el, emoji, { item, localOnly = false, onChange = () => {} } = {}) {
    if (!el || !emoji || !isAllowedEmoji(emoji)) return false;
    insertTextAtCaret(el, emoji);
    if (item) {
        syncInlineFieldToItem(el, item);
        if (localOnly) {
            onChange();
        } else {
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true });
        }
    }
    return true;
}

export function openEmojiPickerForNote(root, anchor, item, { localOnly = false, onChange = () => {}, savedContext = null } = {}) {
    if (!anchor || !root) return;
    const ctx = savedContext || saveEmojiInsertContext(root);
    EmojiPicker.open({
        anchor,
        align: 'end',
        onSelect: (emoji) => {
            if (!ctx.target) return;
            restoreEmojiInsertRange(ctx.target, ctx.range);
            insertEmojiAtCaret(ctx.target, emoji, { item, localOnly, onChange });
        }
    });
}

export function tryOpenRichEditLink(e, host) {
    if (!host?.classList?.contains('rich-text--edit')) return false;
    const anchor = e.target.closest?.('a[href]');
    if (!anchor || !host.contains(anchor)) return false;
    const href = sanitizeHref(anchor.getAttribute('href'));
    if (!href) return false;
    e.preventDefault();
    e.stopPropagation();
    window.open(href, '_blank', 'noopener,noreferrer');
    return true;
}

function sanitizeHref(href) {
    if (!href) return null;
    href = href.trim();
    if (!href.startsWith('http://') && !href.startsWith('https://') && !href.startsWith('mailto:')) return null;
    return href;
}

export function renderRichHtml(str) {
    if (!str) return '';
    const prepared = String(str).replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
    if (hasRichMarkup(prepared)) return sanitizeRichHtml(prepared);
    return sanitizeRichHtml(escapeHTML(prepared));
}

export function prepareContentForEdit(content) {
    const prepared = String(content || '').replace(/\u2028/g, '<br>').replace(/\n/g, '<br>');
    if (hasRichMarkup(prepared)) return sanitizeRichHtml(prepared);
    return sanitizeRichHtml(escapeHTML(prepared));
}

export function canInlineEditText(text, { richEdit = false } = {}) {
    if (richEdit) return true;
    return !hasRichMarkup(text);
}

export function commitFocusedInlineField(card, item) {
    const active = document.activeElement;
    if (!active || !card.contains(active) || !active.classList.contains('card-inline-edit')) return;
    mutateItem(item, () => {
        syncInlineFieldToItem(active, item);
    }, { preserveView: true, skipRerender: true });
    active.dataset.skipBlurSave = '1';
}

export function splitInlineEditAtCaret(el) {
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
}

export function caretAtEdge(el, edge) {
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
}

/**
 * Check if the caret is at the visual top or bottom of a multi-line element.
 * This is used for arrow navigation between checklist items when word wrapping is enabled.
 * @param {HTMLElement} el - The element to check
 * @param {string} edge - 'top' or 'bottom'
 * @returns {boolean} - True if caret is at the visual edge
 */
export function caretAtVisualEdge(el, edge) {
    const sel = window.getSelection();
    if (!sel?.rangeCount) return edge === 'bottom';
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return false;
    
    // Get the caret position
    const caretRect = range.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    
    // Use a small threshold for visual edge detection
    const threshold = 2;
    
    if (edge === 'top') {
        return caretRect.top <= elRect.top + threshold;
    }
    if (edge === 'bottom') {
        return caretRect.bottom >= elRect.bottom - threshold;
    }
    return false;
}

export function caretAtPlainEdge(el, edge) {
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
}

export function focusInlineEdit(el, edge = 'end') {
    if (!el) return;
    el.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(edge === 'start');
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
}

export function setCaretAtPlainOffset(el, offset) {
    if (!el) return;
    // Note: Caller is responsible for focusing the element with preventScroll: true
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
}

export function getInlineEditSequence(root) {
    const fields = [];
    const title = root.querySelector('[data-field="title"].card-inline-edit');
    const content = root.querySelector('[data-field="content"].card-inline-edit');
    if (title) fields.push(title);
    if (content) fields.push(content);
    root.querySelectorAll('[data-field="step-text"].card-inline-edit').forEach((el) => fields.push(el));
    return fields;
}

/**
 * Enhanced arrow navigation for inline edit fields.
 * Navigates between fields when at text edge OR visual edge (for multi-line items).
 * @param {KeyboardEvent} e - The keyboard event
 * @param {HTMLElement} root - The root element
 * @param {HTMLElement} fieldEl - The current focused field element
 * @returns {boolean} - True if navigation occurred
 */
export function handleInlineEditArrowNav(e, root, fieldEl) {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return false;
    const sequenceRoot = fieldEl.closest('.editor-note-shell') || root;
    const fields = getInlineEditSequence(sequenceRoot);
    const idx = fields.indexOf(fieldEl);
    if (idx < 0) return false;

    // Check if this is a step-text element (for multi-line navigation)
    const isStepText = fieldEl.classList?.contains('step-text') && fieldEl.classList?.contains('card-inline-edit');

    if (e.key === 'ArrowDown') {
        // Navigate to next field if at end of current field
        // For multi-line step-text, also check visual bottom edge
        const atTextEnd = caretAtEdge(fieldEl, 'end');
        const atVisualBottom = isStepText && caretAtVisualEdge(fieldEl, 'bottom');
        
        if ((atTextEnd || atVisualBottom) && idx < fields.length - 1) {
            e.preventDefault();
            focusInlineEdit(fields[idx + 1], 'start');
            return true;
        }
    }
    
    if (e.key === 'ArrowUp') {
        // Navigate to previous field if at start of current field
        // For multi-line step-text, also check visual top edge
        const atTextStart = caretAtEdge(fieldEl, 'start');
        const atVisualTop = isStepText && caretAtVisualEdge(fieldEl, 'top');
        
        if ((atTextStart || atVisualTop) && idx > 0) {
            e.preventDefault();
            focusInlineEdit(fields[idx - 1], 'end');
            return true;
        }
    }
    return false;
}

export function applyFormatCommand(cmd) {
    const el = document.activeElement;
    if (!el?.classList?.contains('rich-text--edit')) return false;
    document.execCommand(cmd, false, null);
    return true;
}

export function getEditorZoom() {
    const stored = parseFloat(localStorage.getItem(EDITOR_ZOOM_KEY));
    if (!Number.isFinite(stored)) return 1;
    return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, stored));
}

export function zoomToDisplay(zoom) {
    return Math.round(zoom * 100);
}

export function displayToZoom(display) {
    const n = parseInt(String(display).trim(), 10);
    if (!Number.isFinite(n)) return 1;
    const zoom = n / 100;
    return Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, zoom));
}

export function syncZoomInput(shell, zoom) {
    const input = shell?.querySelector('#format-zoom-input')
        || document.getElementById('format-zoom-input');
    if (input) input.value = String(zoomToDisplay(zoom));
}

export function setEditorZoom(shell, zoom) {
    const clamped = Math.min(EDITOR_ZOOM_MAX, Math.max(EDITOR_ZOOM_MIN, zoom));
    localStorage.setItem(EDITOR_ZOOM_KEY, String(clamped));
    shell?.style?.setProperty('--editor-zoom', String(clamped));
    syncZoomInput(shell, clamped);
    return clamped;
}

export function applyZoomFromInput(shell) {
    const input = shell?.querySelector('#format-zoom-input')
        || document.getElementById('format-zoom-input');
    if (!input) return getEditorZoom();
    return setEditorZoom(shell, displayToZoom(input.value));
}

export function bindFormatPanel(shell, { onChange = () => {} } = {}) {
    if (!shell) return;
    bindCollapsable('format-section-header', 'format-section', true);
    setEditorZoom(shell, getEditorZoom());

    shell.querySelectorAll('[data-format-cmd]').forEach((btn) => {
        const handler = (e) => {
            e.preventDefault();
            if (e.type === 'click') {
                e.stopPropagation();
                if (applyFormatCommand(btn.dataset.formatCmd)) onChange();
            }
        };
        btn.addEventListener('mousedown', handler);
        btn.addEventListener('click', handler);
    });

    shell.querySelectorAll('[data-zoom]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const action = btn.dataset.zoom;
            const current = getEditorZoom();
            if (action === 'reset') setEditorZoom(shell, 1);
            else if (action === 'up') setEditorZoom(shell, current + EDITOR_ZOOM_STEP);
            else if (action === 'down') setEditorZoom(shell, current - EDITOR_ZOOM_STEP);
        });
    });

    const zoomInput = shell.querySelector('#format-zoom-input')
        || document.getElementById('format-zoom-input');
    if (zoomInput) {
        const commitZoomInput = () => {
            applyZoomFromInput(shell);
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
}

export function bindBodyConvertBar(shell, item, {
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
        syncItemBodyFromDom(shell, item);
        Object.assign(item, normalizeItemForSave(item));

        const applyMutate = (mutator, { persist = !localOnly } = {}) => {
            if (persist) {
                mutateItem(item, mutator, { preserveView: true, skipRerender: true, localOnly });
            } else {
                mutator(item);
            }
        };

        const syncAndNormalize = (it) => {
            syncItemBodyFromDom(shell, it);
            Object.assign(it, normalizeItemForSave(it));
        };

        if (action === 'to-checklist') {
            if (!contentHasConvertibleText(item.content)) return;
            applyMutate((it) => {
                syncAndNormalize(it);
                convertContentToChecklist(it, () => createBlankChecklistStep());
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
        updateConvertButtons(shell, item);
        if (localOnly) onChange();

        const body = shell.querySelector('.editor-note-body');
        requestAnimationFrame(() => {
            if (action === 'to-checklist') {
                const first = body?.querySelector('[data-field="step-text"].card-inline-edit');
                if (first) focusInlineEdit(first, 'start');
            } else if (action === 'to-content') {
                const content = body?.querySelector('[data-field="content"].card-inline-edit');
                if (content) focusInlineEdit(content, 'start');
            }
        });
    });
}

export function bindNoteEditorShell(root, item, {
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
    if (header) attachNoteBodyInteractions(header, item, interactionOptions);
    if (body) {
        attachNoteBodyInteractions(body, item, interactionOptions);
        bindNoteBodySections(body);
        attachSheetInteractions(body, item, buildSheetInteractionOptions(shell, item, {
            localOnly,
            onChange,
            refresh
        }));
        bindChecklistInteractions(body, item, {
            refresh,
            localOnly,
            onChange
        });
        attachChecklistDrag(body, item, {
            refresh,
            localOnly,
            onChange
        });
    }

    if (stopMousedownPropagation && !shell.dataset.shellBubbleBound) {
        shell.dataset.shellBubbleBound = '1';
        shell.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.card-act--drag')) return;
            if (!e.target.closest(
                '.card-inline-edit, .step-check, .step-text, input, textarea, button, a, '
                + '.card-act, .grab-handle--step, .expanded-checklist-add-btn, '
                + '.checklist-done-toggle, .step-collapse-btn, .step-delete-btn, '
                + '.step-indent-btn, .step-outdent-btn, .checklist-expand-collapse-all-btn, '
                + '.sheet-cell-input, .sheet-struct-actions, .sheet-struct-actions .card-act, '
                + '.note-section-header, .note-section-header .collapsable-toggle'
            )) return;
            e.stopPropagation();
        });
    }

    if (showFormat) {
        bindFormatPanel(shell, { onChange });
        bindBodyConvertBar(shell, item, { refresh, localOnly, onChange });
        updateConvertButtons(shell, item);
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
    bindCollapsable('config-section-header', 'config-section', true);
}