/** @module {"owns":"note card Media section HTML, attachment row hydrate, rename/detach/reorder and expand-to-canvas wiring", "related":["noteAttachmentsUi.js","noteAttachmentsUi/shared.js","noteAttachmentsUi/canvas.js","mediaAttachments.js","mediaLibrary.js","mediaQuickActions.js"]} */
import { escapeAttr, escapeHTML } from '../domEscape.js';
import { getMediaMeta, getObjectUrl, releaseObjectUrl, updateMediaMeta } from '../mediaLibrary.js';
import { detachMediaFromNote, normalizeAttachments, reorderAttachments } from '../mediaAttachments.js';
import { buildMediaQuickActionsHtml, bindMediaQuickActions, viewMediaFullSize } from '../mediaQuickActions.js';
import { showAppToast } from '../toast.js';
import { mutateItem } from '../noteSurfaceMutations.js';
import { refreshNoteCanvasPreview } from '../noteCanvasRenderer.js';
import { renderFocusSpawnTrayHtml } from '../noteFocusSpawn.js';
import {
    noteBodiesForItem,
    bodyCanEdit,
    canvasSectionForBody,
    mediaSectionForBody,
    plannerSectionForBody,
    releaseSectionUrls,
    setExpandButtonState,
    clearExpandedAttachmentRows
} from './shared.js';
import {
    addMediaImageToNoteCanvas,
    removeMediaImageFromNoteCanvas,
    imageIsInNoteCanvas,
    syncNoteCanvasDom
} from './canvas.js';

/**
 * Inline-rename a media attachment title; persists via updateMediaMeta.
 * @param {HTMLElement} row
 * @param {string} mediaId
 */
function beginAttachmentTitleEdit(row, mediaId) {
    if (!row || !mediaId) return;
    if (row.querySelector('.note-attachment__title-input')) return;

    const labelBtn = row.querySelector('[data-rename-media]');
    const labelEl = row.querySelector('[data-attach-label]');
    if (!labelBtn || !labelEl) return;

    const previous = labelEl.textContent || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-attachment__title-input';
    input.value = previous === 'Loading…' ? '' : previous;
    input.setAttribute('aria-label', 'Rename media');

    let finished = false;
    const restoreLabel = (text) => {
        labelEl.textContent = text;
        labelBtn.replaceChildren(labelEl);
    };

    const finish = async (save) => {
        if (finished) return;
        finished = true;
        const raw = input.value;
        input.removeEventListener('blur', onBlur);
        if (!save) {
            restoreLabel(previous);
            return;
        }
        try {
            const meta = await updateMediaMeta(mediaId, { title: raw });
            const next = (meta?.title || meta?.filename || raw.trim() || previous || 'Untitled');
            restoreLabel(next);
            row.title = next;
        } catch {
            restoreLabel(previous);
            showAppToast('Rename failed');
        }
    };

    const onBlur = () => {
        finish(true).catch(() => {});
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            input.blur();
            return;
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            finished = true;
            input.removeEventListener('blur', onBlur);
            restoreLabel(previous);
            return;
        }
        e.stopPropagation();
    });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('blur', onBlur);

    labelBtn.replaceChildren(input);
    input.focus();
    input.select();
}

/**
 * @param {HTMLElement} mediaSection
 * @param {HTMLElement} row
 * @param {object} item
 * @param {string} mediaId
 */
async function expandAttachmentOnCanvas(mediaSection, row, item, mediaId) {
    const expandBtn = row.querySelector('[data-expand-media]');
    if (!mediaSection) return;

    const added = await addMediaImageToNoteCanvas(item, mediaId);
    if (!added) {
        showAppToast('Preview unavailable');
        return;
    }

    row.classList.add('is-expanded');
    setExpandButtonState(expandBtn, true);
    syncNoteCanvasDom(item);
}

/**
 * @param {HTMLElement} mediaSection
 * @param {HTMLElement} row
 * @param {object} item
 * @param {string} mediaId
 */
function collapseAttachmentFromCanvas(mediaSection, row, item, mediaId) {
    const expandBtn = row.querySelector('[data-expand-media]');
    mutateItem(item, (it) => {
        removeMediaImageFromNoteCanvas(it, mediaId);
    }, { preserveView: true, skipRerender: true });
    row.classList.remove('is-expanded');
    delete row.dataset.attachScale;
    setExpandButtonState(expandBtn, false);
    const body = mediaSection?.closest?.('.editor-note-body') || mediaSection?.parentElement;
    const canvasSection = canvasSectionForBody(body);
    if (canvasSection) {
        refreshNoteCanvasPreview(canvasSection, item);
    } else {
        syncNoteCanvasDom(item);
    }
}

/**
 * Media attachments list only (rows + optional list wrapper, no section
 * shell). Focus panes use this; board/modal use SectionHtml below.
 * @param {object} item
 * @param {{ canEdit?: boolean }} [opts]
 */
export function buildNoteAttachmentsListHtml(item, { canEdit = false } = {}) {
    return buildNoteAttachmentsRowsHtml(item, { canEdit, wrapList: true });
}

function buildNoteAttachmentsRowsHtml(item, { canEdit = false, wrapList = false } = {}) {
    const list = normalizeAttachments(item?.attachments);
    if (!list.length) return wrapList ? '<div class="note-attachments__list"></div>' : '';

    const rows = list.map((entry) => {
        const id = escapeAttr(entry.mediaId);
        const actions = buildMediaQuickActionsHtml({
            mediaId: entry.mediaId,
            context: 'note-attachment',
            blobMissing: false,
            showRemove: canEdit,
            showReorder: canEdit
        });
        const labelEditable = canEdit ? ' note-attachment__label-btn--editable' : '';
        return `
            <div class="note-attachment" data-media-id="${id}">
                <div class="note-attachment__compact">
                    <button type="button" class="note-attachment__thumb-btn" data-thumb-media="${id}" title="View full size" aria-label="View full size">
                        <span class="note-attachment__thumb" data-attach-thumb aria-hidden="true"></span>
                    </button>
                    <button type="button" class="note-attachment__label-btn${labelEditable}" data-rename-media="${id}" title="Rename" aria-label="Rename">
                        <span class="note-attachment__label" data-attach-label>Loading…</span>
                    </button>
                    ${actions}
                </div>
            </div>`;
    }).join('');

    if (wrapList) return `<div class="note-attachments__list">${rows}</div>`;
    return rows;
}

/**
 * Render the full Media card section (shell + list). Board/modal path —
 * row markup lives in buildNoteAttachmentsRowsHtml (single template).
 * @param {object} item
 * @param {{ canEdit?: boolean, startCollapsed?: boolean }} [opts]
 */
export function buildNoteAttachmentsSectionHtml(item, { canEdit = false, startCollapsed = true } = {}) {
    const list = normalizeAttachments(item?.attachments);
    if (!list.length) return '';

    const count = list.length;
    const title = count === 1 ? 'Media (1)' : `Media (${count})`;
    const collapsedClass = startCollapsed ? ' collapsed' : '';
    const toggleCollapsed = startCollapsed ? ' collapsed' : '';
    const rows = buildNoteAttachmentsRowsHtml(item, { canEdit });

    return `
            <div class="note-body-section note-body-section--media" data-note-attachments>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>${escapeHTML(title)}</span>
                    ${renderFocusSpawnTrayHtml('media', 'Media')}
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    <div class="note-attachments__list">${rows}</div>
                </div>
            </div>`;
}

/**
 * Rebuild Media section for a note in the live DOM (board + modal).
 * @param {object} item
 */
export function syncNoteAttachmentsDom(item) {
    if (!item?.id) return;

    for (const body of noteBodiesForItem(item.id)) {
        // Focus Media panes own a planner-sub wrapper around the list host —
        // board sync must not outerHTML-replace the inner out from under it
        // (canvas sync already skips Focus the same way).
        if (body.closest?.('#magic-focus')) continue;
        const canEdit = bodyCanEdit(body);
        const startCollapsed = !!item.attachmentsCollapsed;
        const html = buildNoteAttachmentsSectionHtml(item, { canEdit, startCollapsed });
        const existing = mediaSectionForBody(body);
        if (!html) {
            releaseSectionUrls(existing);
            existing?.remove();
            continue;
        }
        if (existing) {
            releaseSectionUrls(existing);
            existing.outerHTML = html;
        } else {
            // Order: Content → Media → Canvas → Plan.
            const canvas = canvasSectionForBody(body);
            if (canvas) canvas.insertAdjacentHTML('beforebegin', html);
            else {
                const planner = plannerSectionForBody(body);
                if (planner) planner.insertAdjacentHTML('beforebegin', html);
                else body.insertAdjacentHTML('beforeend', html);
            }
        }
        bindNoteAttachments(body, item);
    }
}

function bindMediaSectionToggle(section, item) {
    const header = section?.querySelector('.note-section-header');
    if (!header || header.dataset.bound === '1') return;
    header.dataset.bound = '1';
    header.addEventListener('click', (e) => {
        // Let Focus-spawn bubble to bindFocusSpawnButtons (do not stopPropagation).
        if (e.target.closest?.('[data-focus-spawn]')) return;
        e.stopPropagation();
        const bodyEl = header.nextElementSibling;
        const toggle = header.querySelector('.collapsable-toggle');
        const nextCollapsed = !item?.attachmentsCollapsed;
        if (item) {
            mutateItem(item, (it) => {
                it.attachmentsCollapsed = nextCollapsed;
            }, { preserveView: true, skipRerender: true });
        }
        bodyEl?.classList.toggle('collapsed', nextCollapsed);
        toggle?.classList.toggle('collapsed', nextCollapsed);
    });
}

/**
 * Flat-list drag reorder for media attachment rows.
 * @param {HTMLElement} section
 * @param {object} item
 */
function bindAttachmentListReorder(section, item) {
    if (!section || !item || section.dataset.attachReorderBound === '1') return;
    if (!section.querySelector('.note-attachment__grab')) return;
    section.dataset.attachReorderBound = '1';

    const listEl = () => section.querySelector('.note-attachments__list');

    const hideDropIndicator = () => {
        section.querySelectorAll('.note-attachment-drop-indicator').forEach((el) => el.remove());
    };

    const showDropIndicator = (ref, position) => {
        hideDropIndicator();
        if (!ref) return;
        const indicator = document.createElement('div');
        indicator.className = 'note-attachment-drop-indicator is-visible';
        indicator.setAttribute('aria-hidden', 'true');
        if (position === 'after') {
            ref.insertAdjacentElement('afterend', indicator);
        } else {
            ref.insertAdjacentElement('beforebegin', indicator);
        }
    };

    const getRows = () => {
        const list = listEl();
        if (!list) return [];
        return [...list.querySelectorAll(':scope > .note-attachment[data-media-id]')];
    };

    let activeDrag = null;

    const finishDrag = () => {
        if (!activeDrag) return;
        const { row, moved } = activeDrag;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('is-checklist-dragging');
        hideDropIndicator();
        row?.classList.remove('is-dragging');
        activeDrag = null;

        if (!moved) return;
        const orderedIds = getRows().map((r) => r.dataset.mediaId).filter(Boolean);
        reorderAttachments(item, orderedIds, { syncUi: false });
    };

    const onMove = (e) => {
        if (!activeDrag) return;
        const dy = Math.abs(e.clientY - activeDrag.startY);
        const dx = Math.abs(e.clientX - activeDrag.startX);
        if (!activeDrag.moved && dy < 4 && dx < 4) return;

        if (!activeDrag.moved) {
            activeDrag.moved = true;
            activeDrag.row.classList.add('is-dragging');
            document.body.classList.add('is-checklist-dragging');
        }

        const rows = getRows().filter((r) => r !== activeDrag.row);
        const list = listEl();
        if (!list || !rows.length) {
            hideDropIndicator();
            return;
        }

        let insertBefore = null;
        for (const other of rows) {
            const rect = other.getBoundingClientRect();
            const mid = rect.top + rect.height / 2;
            if (e.clientY < mid) {
                insertBefore = other;
                break;
            }
        }

        if (insertBefore) {
            list.insertBefore(activeDrag.row, insertBefore);
            showDropIndicator(insertBefore, 'before');
        } else {
            const last = rows[rows.length - 1];
            list.appendChild(activeDrag.row);
            if (last) showDropIndicator(last, 'after');
            else hideDropIndicator();
        }
    };

    const onUp = () => finishDrag();

    section.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const handle = e.target.closest('.note-attachment__grab');
        if (!handle || !section.contains(handle)) return;
        const row = handle.closest('.note-attachment[data-media-id]');
        if (!row || !listEl()?.contains(row)) return;

        e.preventDefault();
        e.stopPropagation();

        activeDrag = {
            row,
            startX: e.clientX,
            startY: e.clientY,
            moved: false
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }, true);
}

/**
 * Fill titles/thumbs and wire open/detach/expand/zoom/lightbox.
 * @param {HTMLElement} root
 * @param {object} item
 */
export function bindNoteAttachments(root, item) {
    if (!root || !item) return;
    const section = root.matches?.('[data-note-attachments]')
        ? root
        : root.querySelector?.('[data-note-attachments]');
    if (!section) return;

    bindMediaSectionToggle(section, item);
    bindAttachmentListReorder(section, item);

    section.querySelectorAll('.note-attachment[data-media-id]').forEach((row) => {
        const mediaId = row.dataset.mediaId;
        if (!mediaId) return;

        const thumbWrap = row.querySelector('.note-attachment__actions');
        if (thumbWrap && thumbWrap.dataset.quickActionsBound !== '1') {
            bindMediaQuickActions(thumbWrap, {
                context: 'note-attachment',
                noteItem: item,
                onRemove: () => {
                    if (!localStorage.getItem('admin_token')) {
                        showAppToast('Login required');
                        return;
                    }
                    if (detachMediaFromNote(item, mediaId)) {
                        showAppToast('Detached');
                    }
                }
            });
        }
    });

    section.querySelectorAll('[data-thumb-media]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await viewMediaFullSize(btn.dataset.thumbMedia, { attachNoteId: item.id });
        });
    });

    section.querySelectorAll('[data-rename-media]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (btn.querySelector('.note-attachment__title-input')) return;
            const mediaId = btn.dataset.renameMedia;
            const row = btn.closest('.note-attachment');
            beginAttachmentTitleEdit(row, mediaId);
        });
    });

    section.querySelectorAll('[data-expand-media]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mediaId = btn.dataset.expandMedia;
            const row = btn.closest('.note-attachment');
            if (!row || !mediaId) return;
            if (row.classList.contains('is-expanded')) {
                collapseAttachmentFromCanvas(section, row, item, mediaId);
            } else {
                expandAttachmentOnCanvas(section, row, item, mediaId).catch(() => {});
            }
        });
    });

    hydrateAttachmentRows(section, item).catch(() => {});
}

async function hydrateAttachmentRows(section, item) {
    const rows = section.querySelectorAll('.note-attachment[data-media-id]');
    await Promise.all([...rows].map(async (row) => {
        const id = row.dataset.mediaId;
        const labelEl = row.querySelector('[data-attach-label]');
        const thumbEl = row.querySelector('[data-attach-thumb]');
        const expandBtn = row.querySelector('[data-expand-media]');
        if (!id) return;
        try {
            const meta = await getMediaMeta(id);
            if (!meta) {
                if (labelEl) labelEl.textContent = 'Missing file';
                row.classList.add('is-missing');
                expandBtn?.classList.add('is-hidden');
                return;
            }
            const label = meta.title || meta.filename || 'Untitled';
            if (labelEl) labelEl.textContent = label;
            row.title = label;
            if (meta.blobMissing) {
                row.classList.add('is-missing');
                expandBtn?.classList.add('is-hidden');
                return;
            }
            const isImage = String(meta.mime || '').startsWith('image/');
            if (isImage) {
                row.dataset.isImage = '1';
                expandBtn?.classList.remove('is-hidden');
                if (thumbEl) {
                    const url = await getObjectUrl(id, 'thumb');
                    if (url) {
                        if (!row.isConnected) {
                            releaseObjectUrl(id, 'thumb');
                        } else {
                            row.dataset.thumbClaimed = '1';
                            thumbEl.innerHTML = `<img src="${escapeAttr(url)}" alt="">`;
                        }
                    }
                }
                const isExpanded = imageIsInNoteCanvas(item, id);
                setExpandButtonState(expandBtn, isExpanded);
                if (isExpanded) {
                    row.classList.add('is-expanded');
                }
                return;
            }
            row.dataset.isImage = '0';
            expandBtn?.classList.add('is-hidden');
            if (thumbEl) {
                const ext = (meta.mime || 'file').split('/').pop() || 'file';
                thumbEl.innerHTML = `<span class="note-attachment__icon">${escapeHTML(ext)}</span>`;
            }
        } catch {
            if (labelEl) labelEl.textContent = 'Unavailable';
            row.classList.add('is-missing');
            expandBtn?.classList.add('is-hidden');
        }
    }));
}
