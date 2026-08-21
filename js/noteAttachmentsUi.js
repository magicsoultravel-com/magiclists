/** @module {"owns":"note card attached-media section HTML and hydrate", "related":["mediaAttachments.js","mediaLibrary.js","noteSurfaceHtml.js","mediaLibraryOverlay.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { CARD_ICONS } from './icons.js';
import { getMediaMeta, getObjectUrl } from './mediaLibrary.js';
import {
    detachMediaFromNote,
    normalizeAttachments
} from './mediaAttachments.js';
import { showAppToast } from './toast.js';

/** @type {Set<string>} session keys `noteId:mediaId` for in-note expanded rows */
const expandedInNote = new Set();

let lightboxEl = null;
let lightboxBound = false;

async function openMediaLibrary(opts) {
    const { MediaLibraryOverlay } = await import('./mediaLibraryOverlay.js');
    return MediaLibraryOverlay.open(opts);
}

function expandKey(noteId, mediaId) {
    return `${noteId}:${mediaId}`;
}

/**
 * Collapsible Media section — only when the note has attachments.
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

    const rows = list.map((entry) => {
        const id = escapeAttr(entry.mediaId);
        const detach = canEdit
            ? `<button type="button" class="card-act note-attachment__detach" data-detach-media="${id}" title="Detach" aria-label="Detach">${CARD_ICONS.close}</button>`
            : '';
        return `
            <div class="note-attachment" data-media-id="${id}">
                <div class="note-attachment__compact">
                    <button type="button" class="note-attachment__thumb-btn" data-thumb-media="${id}" title="View full size" aria-label="View full size">
                        <span class="note-attachment__thumb" data-attach-thumb aria-hidden="true"></span>
                    </button>
                    <button type="button" class="note-attachment__label-btn" data-open-media="${id}" title="Open in media library">
                        <span class="note-attachment__label" data-attach-label>Loading…</span>
                    </button>
                    <div class="note-attachment__actions">
                        <button type="button" class="card-act note-attachment__expand is-hidden" data-expand-media="${id}" title="Expand in note" aria-label="Expand in note" aria-pressed="false">${CARD_ICONS.expandMedia}</button>
                        ${detach}
                    </div>
                </div>
                <div class="note-attachment__preview is-hidden" data-attach-preview></div>
            </div>`;
    }).join('');

    return `
            <div class="note-body-section note-body-section--media" data-note-attachments>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>${escapeHTML(title)}</span>
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    <div class="note-attachments__list">${rows}</div>
                </div>
            </div>`;
}

function noteBodiesForItem(itemId) {
    if (!itemId) return [];
    const out = [];
    document.querySelectorAll(`.mini-card[data-id="${CSS.escape(itemId)}"] .editor-note-body`).forEach((el) => out.push(el));
    const modalBody = document.getElementById('editor-note-body');
    const modal = document.getElementById('editor-overlay');
    if (modalBody && modal && !modal.classList.contains('is-hidden') && !out.includes(modalBody)) {
        out.push(modalBody);
    }
    return out;
}

function bodyCanEdit(body) {
    return !!(body?.querySelector?.('.card-inline-edit, .sheet-cell-input, .expanded-checklist-add-btn'));
}

function bodyInModal(body) {
    return !!(body?.closest?.('#editor-overlay') || body?.id === 'editor-note-body');
}

/**
 * Rebuild Media section(s) for a note in the live DOM (board + modal).
 * @param {object} item
 */
export function syncNoteAttachmentsDom(item) {
    if (!item?.id) return;
    const stillAttached = new Set(normalizeAttachments(item.attachments).map((a) => a.mediaId));
    for (const key of [...expandedInNote]) {
        if (!key.startsWith(`${item.id}:`)) continue;
        const mediaId = key.slice(item.id.length + 1);
        if (!stillAttached.has(mediaId)) expandedInNote.delete(key);
    }

    for (const body of noteBodiesForItem(item.id)) {
        const canEdit = bodyCanEdit(body);
        const startCollapsed = !bodyInModal(body);
        const html = buildNoteAttachmentsSectionHtml(item, { canEdit, startCollapsed });
        const existing = body.querySelector('[data-note-attachments]');
        if (!html) {
            existing?.remove();
            continue;
        }
        if (existing) {
            const wasCollapsed = existing.querySelector('.note-section-body')?.classList.contains('collapsed');
            existing.outerHTML = html;
            const next = body.querySelector('[data-note-attachments]');
            if (next && wasCollapsed !== undefined) {
                const sectionBody = next.querySelector('.note-section-body');
                const toggle = next.querySelector('.collapsable-toggle');
                if (wasCollapsed) {
                    sectionBody?.classList.add('collapsed');
                    toggle?.classList.add('collapsed');
                } else {
                    sectionBody?.classList.remove('collapsed');
                    toggle?.classList.remove('collapsed');
                }
            }
        } else {
            body.insertAdjacentHTML('beforeend', html);
        }
        const nextSection = body.querySelector('[data-note-attachments]');
        bindMediaSectionToggle(nextSection);
        bindNoteAttachments(body, item);
    }
}

function bindMediaSectionToggle(section) {
    const header = section?.querySelector('.note-section-header');
    if (!header || header.dataset.bound === '1') return;
    header.dataset.bound = '1';
    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const bodyEl = header.nextElementSibling;
        const toggle = header.querySelector('.collapsable-toggle');
        bodyEl?.classList.toggle('collapsed');
        toggle?.classList.toggle('collapsed');
    });
}

function ensureLightbox() {
    if (lightboxEl) return lightboxEl;
    lightboxEl = document.createElement('div');
    lightboxEl.id = 'media-lightbox';
    lightboxEl.className = 'media-lightbox is-hidden';
    lightboxEl.setAttribute('role', 'dialog');
    lightboxEl.setAttribute('aria-modal', 'true');
    lightboxEl.setAttribute('aria-label', 'Image preview');
    lightboxEl.innerHTML = `
        <button type="button" class="media-lightbox__backdrop" data-lightbox-close aria-label="Close"></button>
        <div class="media-lightbox__frame">
            <button type="button" class="card-act media-lightbox__close" data-lightbox-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            <img class="media-lightbox__img" data-lightbox-img alt="">
        </div>
    `;
    document.body.appendChild(lightboxEl);

    if (!lightboxBound) {
        lightboxBound = true;
        lightboxEl.addEventListener('click', (e) => {
            if (e.target.closest('[data-lightbox-close]')) {
                e.preventDefault();
                closeMediaLightbox();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!lightboxEl || lightboxEl.classList.contains('is-hidden')) return;
            e.preventDefault();
            e.stopPropagation();
            closeMediaLightbox();
        }, true);
    }
    return lightboxEl;
}

/**
 * Full-viewport image lightbox.
 * @param {string} mediaId
 */
export async function openMediaLightbox(mediaId) {
    if (!mediaId) return;
    const meta = await getMediaMeta(mediaId);
    if (!meta || meta.blobMissing || !String(meta.mime || '').startsWith('image/')) {
        showAppToast('Preview unavailable');
        return;
    }
    const url = await getObjectUrl(mediaId, 'blob');
    if (!url) {
        showAppToast('Preview unavailable');
        return;
    }
    const el = ensureLightbox();
    const img = el.querySelector('[data-lightbox-img]');
    if (img) {
        img.src = url;
        img.alt = meta.title || meta.filename || 'Image';
    }
    el.classList.remove('is-hidden');
    el.classList.add('is-open');
}

export function closeMediaLightbox() {
    if (!lightboxEl) return;
    lightboxEl.classList.remove('is-open');
    lightboxEl.classList.add('is-hidden');
    const img = lightboxEl.querySelector('[data-lightbox-img]');
    if (img) {
        img.removeAttribute('src');
        img.alt = '';
    }
}

async function expandAttachmentRow(row, noteId, mediaId) {
    const preview = row.querySelector('[data-attach-preview]');
    const expandBtn = row.querySelector('[data-expand-media]');
    if (!preview) return;
    const url = await getObjectUrl(mediaId, 'blob');
    if (!url) {
        showAppToast('Preview unavailable');
        return;
    }
    preview.innerHTML = `<img class="note-attachment__full" src="${escapeAttr(url)}" alt="">`;
    preview.classList.remove('is-hidden');
    row.classList.add('is-expanded');
    expandedInNote.add(expandKey(noteId, mediaId));
    if (expandBtn) {
        expandBtn.innerHTML = CARD_ICONS.collapseMedia;
        expandBtn.title = 'Collapse in note';
        expandBtn.setAttribute('aria-label', 'Collapse in note');
        expandBtn.setAttribute('aria-pressed', 'true');
        expandBtn.classList.remove('is-hidden');
    }
}

function collapseAttachmentRow(row, noteId, mediaId) {
    const preview = row.querySelector('[data-attach-preview]');
    const expandBtn = row.querySelector('[data-expand-media]');
    if (preview) {
        preview.innerHTML = '';
        preview.classList.add('is-hidden');
    }
    row.classList.remove('is-expanded');
    expandedInNote.delete(expandKey(noteId, mediaId));
    if (expandBtn) {
        expandBtn.innerHTML = CARD_ICONS.expandMedia;
        expandBtn.title = 'Expand in note';
        expandBtn.setAttribute('aria-label', 'Expand in note');
        expandBtn.setAttribute('aria-pressed', 'false');
    }
}

/**
 * Fill titles/thumbs and wire open/detach/expand/lightbox.
 * @param {HTMLElement} root
 * @param {object} item
 */
export function bindNoteAttachments(root, item) {
    if (!root || !item) return;
    const section = root.querySelector('[data-note-attachments]');
    if (!section) return;

    section.querySelectorAll('[data-thumb-media]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mediaId = btn.dataset.thumbMedia;
            const row = btn.closest('.note-attachment');
            let isImage = row?.dataset.isImage === '1';
            if (row && row.dataset.isImage !== '1' && row.dataset.isImage !== '0') {
                try {
                    const meta = await getMediaMeta(mediaId);
                    isImage = !!(meta && !meta.blobMissing && String(meta.mime || '').startsWith('image/'));
                    row.dataset.isImage = isImage ? '1' : '0';
                } catch {
                    isImage = false;
                }
            }
            if (isImage) {
                openMediaLightbox(mediaId);
                return;
            }
            openMediaLibrary({
                attachNoteId: item.id,
                selectMediaId: mediaId
            });
        });
    });

    section.querySelectorAll('[data-open-media]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mediaId = btn.dataset.openMedia;
            openMediaLibrary({
                attachNoteId: item.id,
                selectMediaId: mediaId
            });
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
                collapseAttachmentRow(row, item.id, mediaId);
            } else {
                expandAttachmentRow(row, item.id, mediaId).catch(() => {});
            }
        });
    });

    section.querySelectorAll('[data-detach-media]').forEach((btn) => {
        if (btn.dataset.bound === '1') return;
        btn.dataset.bound = '1';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const mediaId = btn.dataset.detachMedia;
            if (!mediaId) return;
            if (!localStorage.getItem('admin_token')) {
                showAppToast('Login required');
                return;
            }
            if (detachMediaFromNote(item, mediaId)) {
                showAppToast('Detached');
            }
        });
    });

    hydrateAttachmentRows(section, item.id).catch(() => {});
}

async function hydrateAttachmentRows(section, noteId) {
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
                        thumbEl.innerHTML = `<img src="${escapeAttr(url)}" alt="">`;
                    }
                }
                if (noteId && expandedInNote.has(expandKey(noteId, id))) {
                    await expandAttachmentRow(row, noteId, id);
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
