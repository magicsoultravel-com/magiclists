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
import { bindNoteAttachments, bindNoteCanvas } from './noteAttachmentsUi.js';
import { syncItemBodyFromDom, mutateItem, attachNoteBodyInteractions, updateNoteMetaStats, syncInlineFieldToItem, buildSheetInteractionOptions } from './noteSurfaceMutations.js';
import { normalizeItemForSave } from './noteModel.js';
import { createBlankChecklistStep } from './noteSurfaceMutations.js';
import { contentHasConvertibleText, stepsHaveConvertibleText, convertContentToChecklist, convertChecklistToContent } from './noteBodyConversion.js';
import { attachSheetInteractions } from './sheet.js';
import { attachPlannerInteractions } from './plannerUi.js';
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
    const pack = (before, after) => ({
        before: trimSoftBreaks(before, rich),
        after: trimSoftBreaks(after, rich)
    });

    const sel = window.getSelection();
    if (!sel?.rangeCount) {
        const full = readFull();
        return pack(full, '');
    }

    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer)) {
        const full = readFull();
        return pack(full, '');
    }

    const measureRange = range.cloneRange();
    measureRange.selectNodeContents(el);
    measureRange.setEnd(range.startContainer, range.startOffset);
    const plainOffset = measureRange.toString().length;

    if (!rich) {
        const full = el.textContent || '';
        return pack(full.slice(0, plainOffset), full.slice(plainOffset));
    }

    const fullHtml = readFull();
    const fullPlain = stripRichText(fullHtml);
    if (plainOffset <= 0) {
        return pack('', fullHtml);
    }
    if (plainOffset >= fullPlain.length) {
        return pack(fullHtml, '');
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
    return pack(
        sanitizeRichHtml(linkifyPlainUrls(htmlFromFragment(beforeRange.cloneContents()))),
        sanitizeRichHtml(linkifyPlainUrls(htmlFromFragment(afterRange.cloneContents())))
    );
}

/**
 * Trim leading/trailing soft breaks from a split chunk.
 * Plain: leading/trailing \n (and \u2028). Rich: leading/trailing <br>.
 * Mid-content soft breaks between real text are kept.
 */
function trimSoftBreaks(chunk, rich) {
    if (chunk == null || chunk === '') return '';
    const s = String(chunk);
    if (rich) {
        return s.replace(/^(?:\s*<br>)+/i, '').replace(/(?:<br>\s*)+$/i, '');
    }
    return s.replace(/^[\n\u2028]+/, '').replace(/[\n\u2028]+$/, '');
}

/**
 * A pre-/post-caret range is "only soft breaks" (and does not block absolute
 * start/end) iff, walking nodes in document order within the range:
 * 1. Skip text nodes that are entirely whitespace (including \n)
 * 2. Skip <br> elements
 * 3. Stop / fail at the first non-whitespace character or any non-break element
 *
 * Empty fields with a placeholder <br>, and soft-break-only fields, therefore
 * count as both at-start and at-end. Caret mid-way through text<br>more does not.
 */
function rangeIsOnlySoftBreaks(range) {
    if (!range) return true;
    const frag = range.cloneContents();
    const walk = (node) => {
        if (node.nodeType === Node.TEXT_NODE) {
            return !/[^\s]/.test(node.textContent || '');
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return true;
        if (node.tagName === 'BR') return true;
        for (const child of node.childNodes) {
            if (!walk(child)) return false;
        }
        // Non-break element with only soft-break children still blocks start/end
        // if it is something other than a wrapper we unwrap — treat unknown
        // elements with no children as blocking; with only soft kids as ok unwrap.
        return true;
    };
    for (const child of frag.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE && child.tagName !== 'BR') {
            // Non-br element: only allow if its entire subtree is soft breaks
            // AND it is a formatting wrapper we would otherwise ignore for nav.
            // Any media / block content blocks absolute edge.
            if (/^(IMG|TABLE|IFRAME|VIDEO|AUDIO|HR)$/i.test(child.tagName)) return false;
            if (!walk(child)) return false;
            continue;
        }
        if (!walk(child)) return false;
    }
    return true;
}

/**
 * Check if the caret is at the absolute start of an element.
 * Leading soft breaks (<br> / whitespace) do not block "at start".
 * @param {HTMLElement} element - The element to check
 * @returns {boolean} - True if caret is at the absolute start
 */
export function isAtAbsoluteStart(element) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer)) return false;
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return rangeIsOnlySoftBreaks(preCaretRange);
}

/**
 * Check if the caret is at the absolute end of an element.
 * Trailing soft breaks (<br> / whitespace) do not block "at end".
 * @param {HTMLElement} element - The element to check
 * @returns {boolean} - True if caret is at the absolute end
 */
export function isAtAbsoluteEnd(element) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.endContainer)) return false;
    const postCaretRange = range.cloneRange();
    postCaretRange.selectNodeContents(element);
    postCaretRange.setStart(range.endContainer, range.endOffset);
    return rangeIsOnlySoftBreaks(postCaretRange);
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
    // No text nodes or offset beyond content - place caret at end using robust childNodes approach
    // This handles empty elements and elements with <br> tags correctly
    const fullRange = document.createRange();
    fullRange.setStart(el, el.childNodes.length);
    fullRange.setEnd(el, el.childNodes.length);
    sel?.removeAllRanges();
    sel?.addRange(fullRange);
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
 * Arrow navigation for inline edit fields.
 * Navigates between fields when at absolute start/end of element.
 * Uses robust range-based checks that handle multi-line content with soft breaks.
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

    if (e.key === 'ArrowDown') {
        // Navigate to next field if at absolute end of current field
        if (isAtAbsoluteEnd(fieldEl) && idx < fields.length - 1) {
            e.preventDefault();
            focusInlineEdit(fields[idx + 1], 'start');
            return true;
        }
    }
    
    if (e.key === 'ArrowUp') {
        // Navigate to previous field if at absolute start of current field
        if (isAtAbsoluteStart(fieldEl) && idx > 0) {
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
        bindNoteAttachments(body, item);
        bindNoteCanvas(body, item);
        attachSheetInteractions(body, item, buildSheetInteractionOptions(shell, item, {
            localOnly,
            onChange,
            refresh
        }));
        attachPlannerInteractions(body, item, {
            localOnly,
            onChange,
            refresh: () => {
                import('./plannerUi.js').then(({ syncNotePlannerDom }) => syncNotePlannerDom(item)).catch(() => {});
            }
        });
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

    // For modal editor (localOnly=true), add blur handler to flush immediately
    // This prevents data loss when user navigates away or closes the editor
    if (localOnly && body) {
        body.querySelectorAll('.card-inline-edit').forEach((el) => {
            el.addEventListener('blur', () => {
                // Skip if this blur was triggered by a save operation
                if (el.dataset.skipBlurSave === '1') {
                    delete el.dataset.skipBlurSave;
                    return;
                }
                // Sync and immediately persist the change
                syncItemBodyFromDom(shell, item);
                if (item) {
                    // The onChange callback will handle the mutation
                    onChange();
                }
            });
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
                + '.note-section-header, .note-section-header .collapsable-toggle, '
                + '.note-attachment, .note-attachment__thumb-btn, .note-attachment__label-btn, '
                + '.note-attachment__expand, .note-attachment__detach, .note-media-canvas, '
                + '.note-media-canvas__tile, .note-media-canvas__reset'
            )) return;
            e.stopPropagation();
        });
    }

    // Handle link clicks in edit mode - use tryOpenRichEditLink for rich-text--edit elements
    if (body && !shell.dataset.editLinkClickBound) {
        shell.dataset.editLinkClickBound = '1';
        body.addEventListener('click', (e) => {
            const richHost = e.target.closest('.rich-text--edit');
            if (richHost) {
                tryOpenRichEditLink(e, richHost);
            }
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
