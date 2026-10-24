/** @module {"owns":"note body/section DOM lookups and object-URL release shared by media and canvas sections", "related":["noteAttachmentsUi.js","noteAttachmentsUi/media.js","noteAttachmentsUi/canvas.js","mediaLibrary.js"]} */
import { CARD_ICONS } from '../icons.js';
import { releaseObjectUrl } from '../mediaLibrary.js';

function releaseAttachmentRowUrls(row) {
    const mediaId = row.dataset.mediaId || null;
    if (!mediaId) return;
    if (row.dataset.thumbClaimed) {
        delete row.dataset.thumbClaimed;
        releaseObjectUrl(mediaId, 'thumb');
    }
}

function releaseCanvasTileUrls(tile) {
    const mediaId = tile?.dataset?.mediaId || null;
    if (!mediaId) return;
    if (tile.dataset.blobClaimed) {
        delete tile.dataset.blobClaimed;
        releaseObjectUrl(mediaId, 'blob');
    }
}

export function releaseSectionUrls(section) {
    if (!section) return;
    section.querySelectorAll('.note-attachment[data-media-id]').forEach((row) => {
        releaseAttachmentRowUrls(row);
    });
}

export function noteBodiesForItem(itemId) {
    if (!itemId) return [];
    const out = [];
    document.querySelectorAll(`.mini-card[data-id="${CSS.escape(itemId)}"] .editor-note-body`).forEach((el) => out.push(el));
    const modalBody = document.getElementById('editor-note-body');
    const modal = document.getElementById('editor-overlay');
    if (modalBody && modal && !modal.classList.contains('is-hidden') && !out.includes(modalBody)) {
        out.push(modalBody);
    }
    const focusRoot = document.getElementById('magic-focus');
    const focusOpen = focusRoot && !focusRoot.classList.contains('is-hidden');
    if (focusOpen && typeof window.__MagicFocusIsOpenFor === 'function' && window.__MagicFocusIsOpenFor(itemId)) {
        focusRoot.querySelectorAll('.magic-focus__pane-body.editor-note-body').forEach((el) => {
            if (!out.includes(el)) out.push(el);
        });
    }
    return out;
}

export function bodyCanEdit(body) {
    return !!(body?.querySelector?.('.card-inline-edit, .sheet-cell-input, .expanded-checklist-add-btn'));
}

export function canvasSectionForBody(body) {
    return body?.querySelector?.('[data-note-canvas]') || null;
}

export function mediaSectionForBody(body) {
    return body?.querySelector?.('[data-note-attachments]') || null;
}

export function plannerSectionForBody(body) {
    return body?.querySelector?.('[data-note-planner]') || null;
}

export function insertCanvasHtml(body, html) {
    const media = mediaSectionForBody(body);
    if (media) {
        media.insertAdjacentHTML('afterend', html);
        return;
    }
    const planner = plannerSectionForBody(body);
    if (planner) planner.insertAdjacentHTML('beforebegin', html);
    else body.insertAdjacentHTML('beforeend', html);
}

export function setExpandButtonState(expandBtn, expanded) {
    if (!expandBtn) return;
    if (expanded) {
        expandBtn.innerHTML = CARD_ICONS.collapseMedia;
        expandBtn.title = 'Collapse in note';
        expandBtn.setAttribute('aria-label', 'Collapse in note');
        expandBtn.setAttribute('aria-pressed', 'true');
        expandBtn.classList.add('is-active');
        expandBtn.classList.remove('is-hidden');
        return;
    }
    expandBtn.innerHTML = CARD_ICONS.expandMedia;
    expandBtn.title = 'Expand in note';
    expandBtn.setAttribute('aria-label', 'Expand in note');
    expandBtn.setAttribute('aria-pressed', 'false');
    expandBtn.classList.remove('is-active');
}

export function clearExpandedAttachmentRows(mediaSection) {
    if (!mediaSection) return;
    mediaSection.querySelectorAll('.note-attachment.is-expanded').forEach((row) => {
        row.classList.remove('is-expanded');
        delete row.dataset.attachScale;
        setExpandButtonState(row.querySelector('[data-expand-media]'), false);
    });
}
