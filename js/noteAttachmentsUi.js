/** @module {"owns":"note card attached-media section HTML and hydrate", "related":["mediaAttachments.js","mediaLibrary.js","noteSurfaceHtml.js","mediaLibraryOverlay.js","mediaQuickActions.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { CARD_ICONS } from './icons.js';
import { getMediaMeta, getObjectUrl, releaseObjectUrl } from './mediaLibrary.js';
import {
    detachMediaFromNote,
    normalizeAttachments
} from './mediaAttachments.js';
import { buildMediaQuickActionsHtml, bindMediaQuickActions, viewMediaFullSize } from './mediaQuickActions.js';
import { showAppToast } from './toast.js';
import { createEmptyNoteCanvas } from './noteModel.js';
import { ensureCanvasVisibleIfContent } from './noteFieldOwnership.js';
import { renderNoteCanvas, refreshNoteCanvasPreview } from './noteCanvasRenderer.js';
import { initialImageSize } from './canvasImages.js';
import { mutateItem } from './noteSurfaceMutations.js';

const CASCADE_STEP = 18;
const CANVAS_PAD = 24;

function noteHasVisibleCanvas(item) {
    return !!(item?.canvas && !item?.canvasHidden);
}

function paintNoteCanvasPreview(section, item) {
    if (!section || !noteHasVisibleCanvas(item)) return;
    sizeCanvasViewport(section);
    refreshNoteCanvasPreview(section, item);
}

async function openMediaLibrary(opts) {
    const { MediaLibraryOverlay } = await import('./mediaLibraryOverlay.js');
    return MediaLibraryOverlay.open(opts);
}

function canvasRoot(section) {
    return section?.querySelector?.('[data-note-media-canvas]') || null;
}

function canvasViewport(section) {
    return canvasRoot(section)?.querySelector?.('[data-note-media-viewport]') || null;
}

function canvasPreview(section) {
    return canvasRoot(section)?.querySelector?.('[data-note-canvas-preview]') || null;
}

function ensureNoteCanvas(item) {
    if (item?.canvas) return item.canvas;
    const doc = createEmptyNoteCanvas();
    mutateItem(item, (it) => {
        it.canvas = doc;
        it.canvasHidden = false;
    }, { preserveView: true, skipRerender: true });
    return doc;
}

function getNoteCanvasLayer(item) {
    if (!item?.canvas) return null;
    return item.canvas.pages?.find((p) => p.id === item.canvas.activePageId) || null;
}

function getNoteCanvasImages(item) {
    const layer = getNoteCanvasLayer(item);
    if (!layer) return [];
    if (!Array.isArray(layer.images)) layer.images = [];
    return layer.images;
}

function setNoteCanvasImages(item, images) {
    const layer = getNoteCanvasLayer(item);
    if (!layer) return;
    layer.images = images;
}

function imageIsInNoteCanvas(item, mediaId) {
    return getNoteCanvasImages(item).some((img) => img.mediaId === mediaId);
}

function removeMediaImageFromNoteCanvas(item, mediaId) {
    const images = getNoteCanvasImages(item);
    const next = images.filter((img) => img.mediaId !== mediaId);
    if (next.length !== images.length) {
        setNoteCanvasImages(item, next);
    }
}

async function addMediaImageToNoteCanvas(item, mediaId) {
    ensureNoteCanvas(item);
    const images = getNoteCanvasImages(item);
    if (images.some((img) => img.mediaId === mediaId)) return null;

    const img = await (await import('./canvasImages.js')).loadImage(mediaId);
    if (!img) return null;

    const size = initialImageSize(img.naturalWidth, img.naturalHeight);
    const cascade = defaultCascadePos(item, mediaId);

    const imageObj = {
        id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        tool: 'image',
        mediaId,
        x: cascade.x,
        y: cascade.y,
        width: size.width,
        height: size.height,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
    };

    // Persist presentation onto Shared canvas (membership is attachments).
    mutateItem(item, (it) => {
        ensureNoteCanvas(it);
        const list = getNoteCanvasImages(it);
        if (list.some((imgEntry) => imgEntry.mediaId === mediaId)) return;
        list.push(imageObj);
        it.canvasHidden = false;
    }, { preserveView: true, skipRerender: true });

    return imageObj;
}

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

function releaseSectionUrls(section) {
    if (!section) return;
    section.querySelectorAll('.note-attachment[data-media-id]').forEach((row) => {
        releaseAttachmentRowUrls(row);
    });
}

function showNoteMediaCanvas(section) {
    const root = canvasRoot(section);
    if (!root) return;
    root.classList.remove('is-hidden');
    root.hidden = false;
}

function hideNoteMediaCanvas(section) {
    const root = canvasRoot(section);
    if (!root) return;
    root.classList.add('is-hidden');
    root.hidden = true;
}

/**
 * Size the inline note-canvas viewport from the host card box.
 * Sets both width and height so board-grid cards do not collapse to ~2px
 * before the preview bitmap is painted.
 * @param {HTMLElement|null|undefined} section
 */
export function sizeCanvasViewport(section) {
    const viewport = canvasViewport(section);
    if (!viewport) return;
    const card = section.closest('.mini-card, .editor-note-shell, #editor-overlay');
    const hostH = card?.clientHeight || 0;
    const hostW = card?.clientWidth || section?.clientWidth || 0;
    // Before grid placement / drawer transitions settle, the host card can still
    // report a 0 box. Baking an explicit viewport size from that would freeze a
    // stale (collapsed ~2px or oversized) size forever. Let the CSS natural size
    // (.note-media-canvas__viewport → 100% × 180px) drive the preview until the
    // card has a real measured box, then size explicitly and let
    // refreshNoteCanvasPreview re-paint once layout settles.
    if (hostH < 2 && hostW < 2) return;
    const h = hostH
        ? Math.round(Math.max(120, Math.min(260, hostH * 0.42)))
        : 180;
    const w = hostW
        ? Math.round(Math.max(120, Math.min(hostW, hostW * 0.98)))
        : 320;
    viewport.style.width = `${w}px`;
    viewport.style.height = `${h}px`;
}

function defaultCascadePos(item, mediaId) {
    const list = normalizeAttachments(item?.attachments);
    const idx = Math.max(0, list.findIndex((a) => a.mediaId === mediaId));
    return {
        x: CANVAS_PAD + idx * CASCADE_STEP,
        y: CANVAS_PAD + idx * CASCADE_STEP
    };
}

function setExpandButtonState(expandBtn, expanded) {
    if (!expandBtn) return;
    if (expanded) {
        expandBtn.innerHTML = CARD_ICONS.collapseMedia;
        expandBtn.title = 'Collapse in note';
        expandBtn.setAttribute('aria-label', 'Collapse in note');
        expandBtn.setAttribute('aria-pressed', 'true');
        expandBtn.classList.remove('is-hidden');
        return;
    }
    expandBtn.innerHTML = CARD_ICONS.expandMedia;
    expandBtn.title = 'Expand in note';
    expandBtn.setAttribute('aria-label', 'Expand in note');
    expandBtn.setAttribute('aria-pressed', 'false');
}

/**
 * @param {HTMLElement} section
 * @param {HTMLElement} row
 * @param {object} item
 * @param {string} mediaId
 */
async function expandAttachmentOnCanvas(section, row, item, mediaId) {
    const expandBtn = row.querySelector('[data-expand-media]');
    if (!section) return;

    const added = await addMediaImageToNoteCanvas(item, mediaId);
    if (!added) {
        showAppToast('Preview unavailable');
        return;
    }

    row.classList.add('is-expanded');
    setExpandButtonState(expandBtn, true);
    showNoteMediaCanvas(section);
    refreshNoteCanvasPreview(section, item);
}

/**
 * @param {HTMLElement} section
 * @param {HTMLElement} row
 * @param {string} mediaId
 */
function collapseAttachmentFromCanvas(section, row, item, mediaId) {
    const expandBtn = row.querySelector('[data-expand-media]');
    mutateItem(item, (it) => {
        removeMediaImageFromNoteCanvas(it, mediaId);
    }, { preserveView: true, skipRerender: true });
    row.classList.remove('is-expanded');
    delete row.dataset.attachScale;
    setExpandButtonState(expandBtn, false);
    refreshNoteCanvasPreview(section, item);
}

function clearCanvasDom(section) {
    if (!section) return;
    section.querySelectorAll('.note-attachment.is-expanded').forEach((row) => {
        row.classList.remove('is-expanded');
        delete row.dataset.attachScale;
        setExpandButtonState(row.querySelector('[data-expand-media]'), false);
    });
}

/**
 * Collapsible Media + Canvas section.
 * Renders when the note has attachments or a canvas document (even if hidden),
 * so the draw toggle can reveal the preview without rebuilding from scratch.
 * @param {object} item
 * @param {{ canEdit?: boolean, startCollapsed?: boolean }} [opts]
 */
export function buildNoteAttachmentsSectionHtml(item, { canEdit = false, startCollapsed = true } = {}) {
    // Render choke point: a canvas with real content must never be emitted hidden,
    // otherwise every full-board rebuild (File Cabinet toggle, category change,
    // desktop switch, …) can make it disappear until another sync re-fixes state.
    // Mirrors the repair-on-read/write behavior in api.js (reconcileItemMediaCanvas)
    // and syncNoteAttachmentsDom, so all render paths agree with the persisted item.
    ensureCanvasVisibleIfContent(item);
    const list = normalizeAttachments(item?.attachments);
    const hasCanvasDoc = !!item?.canvas;
    const hasVisibleCanvas = hasCanvasDoc && !item?.canvasHidden;
    if (!list.length && !hasCanvasDoc) return '';

    const count = list.length;
    const title = count > 0
        ? (count === 1 ? 'Media (1)' : `Media (${count})`)
        : 'Note canvas';
    const collapsedClass = startCollapsed ? ' collapsed' : '';
    const toggleCollapsed = startCollapsed ? ' collapsed' : '';
    const canvasHiddenClass = hasVisibleCanvas ? '' : ' is-hidden';

    const rows = list.map((entry) => {
        const id = escapeAttr(entry.mediaId);
        const actions = buildMediaQuickActionsHtml({
            mediaId: entry.mediaId,
            context: 'note-attachment',
            blobMissing: false,
            showRemove: canEdit
        });
        return `
            <div class="note-attachment" data-media-id="${id}">
                <div class="note-attachment__compact">
                    <button type="button" class="note-attachment__thumb-btn" data-thumb-media="${id}" title="View full size" aria-label="View full size">
                        <span class="note-attachment__thumb" data-attach-thumb aria-hidden="true"></span>
                    </button>
                    <button type="button" class="note-attachment__label-btn" data-open-media="${id}" title="Open in media library">
                        <span class="note-attachment__label" data-attach-label>Loading…</span>
                    </button>
                    ${actions}
                </div>
            </div>`;
    }).join('');

    return `
            <div class="note-body-section note-body-section--media" data-note-attachments>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>${escapeHTML(title)}</span>
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    <div class="note-attachments__list">${rows}</div>
                    <div class="note-media-canvas${canvasHiddenClass}" data-note-media-canvas ${hasVisibleCanvas ? '' : 'hidden'}>
                        <div class="note-media-canvas__toolbar">
                            <span class="note-media-canvas__title">Note canvas</span>
                            <button type="button" class="card-act note-media-canvas__enter-drawing" data-enter-drawing title="Draw in magicCanvas" aria-label="Draw in magicCanvas">${CARD_ICONS.drawingPencil}</button>
                            <button type="button" class="card-act note-media-canvas__reset" data-reset-media-canvas title="Reset canvas" aria-label="Reset canvas">${CARD_ICONS.zoomReset}</button>
                        </div>
                        <div class="note-media-canvas__viewport" data-note-media-viewport>
                            <canvas class="note-media-canvas__preview" data-note-canvas-preview></canvas>
                        </div>
                    </div>
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
 * Rebuild Media + Canvas section(s) for a note in the live DOM (board + modal).
 * @param {object} item
 */
export function syncNoteAttachmentsDom(item) {
    if (!item?.id) return;
    // If drawings exist but canvasHidden is stuck true, unhide before rebuild so
    // board and modal both get a visible Note canvas block.
    ensureCanvasVisibleIfContent(item);

    for (const body of noteBodiesForItem(item.id)) {
        const canEdit = bodyCanEdit(body);
        const hasAttachments = normalizeAttachments(item?.attachments).length > 0;
        const startCollapsed = !(hasAttachments || noteHasVisibleCanvas(item));
        const html = buildNoteAttachmentsSectionHtml(item, { canEdit, startCollapsed });
        const existing = body.querySelector('[data-note-attachments]');
        if (!html) {
            releaseSectionUrls(existing);
            existing?.remove();
            continue;
        }
        if (existing) {
            releaseSectionUrls(existing);
            const wasCollapsed = existing.querySelector('.note-section-body')?.classList.contains('collapsed');
            existing.outerHTML = html;
            const next = body.querySelector('[data-note-attachments]');
            // Keep prior collapse only when there is no visible canvas to show.
            if (next && wasCollapsed !== undefined && !noteHasVisibleCanvas(item)) {
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
        bindNoteAttachments(body, item);
        if (noteHasVisibleCanvas(item)) {
            sizeCanvasViewport(nextSection);
            paintNoteCanvasPreview(nextSection, item);
        }
    }
}

/**
 * Sync only the note canvas preview(s) for an item without rebuilding the whole section.
 * @param {object} item
 */
export function syncNoteCanvasDom(item) {
    if (!item?.id) return;
    for (const body of noteBodiesForItem(item.id)) {
        const section = body.querySelector('[data-note-attachments]');
        if (!section) continue;
        if (item.canvas && !item.canvasHidden) {
            showNoteMediaCanvas(section);
            sizeCanvasViewport(section);
            paintNoteCanvasPreview(section, item);
        } else {
            hideNoteMediaCanvas(section);
        }
    }
}

function bindMediaSectionToggle(section, item) {
    const header = section?.querySelector('.note-section-header');
    if (!header || header.dataset.bound === '1') return;
    header.dataset.bound = '1';
    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const bodyEl = header.nextElementSibling;
        const toggle = header.querySelector('.collapsable-toggle');
        const collapsed = bodyEl?.classList.toggle('collapsed');
        toggle?.classList.toggle('collapsed');
        if (!collapsed) {
            paintNoteCanvasPreview(section, item);
        }
    });
}

let lightboxEl = null;
let lightboxBound = false;

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
    closeMediaLightbox();
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
    el.dataset.claimedMediaId = mediaId;
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
    const mediaId = lightboxEl.dataset.claimedMediaId || null;
    if (mediaId) {
        delete lightboxEl.dataset.claimedMediaId;
        releaseObjectUrl(mediaId, 'blob');
    }
}

/**
 * Fill titles/thumbs and wire open/detach/expand/zoom/lightbox.
 * @param {HTMLElement} root
 * @param {object} item
 */
export function bindNoteAttachments(root, item) {
    if (!root || !item) return;
    const section = root.querySelector('[data-note-attachments]');
    if (!section) return;

    bindMediaSectionToggle(section, item);
    paintNoteCanvasPreview(section, item);

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
                collapseAttachmentFromCanvas(section, row, item, mediaId);
            } else {
                expandAttachmentOnCanvas(section, row, item, mediaId).catch(() => {});
            }
        });
    });

    if (section.dataset.canvasControlsBound !== '1') {
        section.dataset.canvasControlsBound = '1';
        section.addEventListener('click', (e) => {
            const resetBtn = e.target.closest('[data-reset-media-canvas]');
            if (resetBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (!confirm('Reset note canvas? This clears media positions and drawings.')) return;
                mutateItem(item, (it) => {
                    it.canvas = createEmptyNoteCanvas();
                    const list = normalizeAttachments(it.attachments);
                    for (const entry of list) entry.expanded = false;
                    it.attachments = list;
                }, { preserveView: true, skipRerender: true });
                clearCanvasDom(section);
                refreshNoteCanvasPreview(section, item);
                return;
            }

            const drawBtn = e.target.closest('[data-enter-drawing]');
            if (drawBtn) {
                e.preventDefault();
                e.stopPropagation();
                if (window.opener) {
                    window.opener.dispatchEvent(new CustomEvent('note:canvas_draw_requested', { detail: { item } }));
                    showAppToast('Opened drawing workspace in main window');
                } else {
                    window.dispatchEvent(new CustomEvent('note:canvas_draw_requested', { detail: { item } }));
                }
                return;
            }
        });
    }

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
/**
 * Dev-only diagnostics: dump each board card's note-canvas invariants so a
 * "canvas disappeared" bug can be pinned to hidden/collapsed/size/bitmap failure
 * in one glance. From the DevTools console on the running app (localhost:45781):
 *   import('./js/noteAttachmentsUi.js').then(m => m.dumpNoteCanvasState())
 * @returns {Array<object>} one row per board card with a media/canvas section
 */
export function dumpNoteCanvasState() {
    const rows = [];
    document.querySelectorAll('.mini-card[data-id]').forEach((card) => {
        const section = card.querySelector('[data-note-attachments]');
        if (!section) return;
        const block = section.querySelector('[data-note-media-canvas]');
        const viewport = block?.querySelector('[data-note-media-viewport]') || null;
        const canvas = block?.querySelector('[data-note-canvas-preview]') || null;
        const body = section.querySelector('.note-section-body');
        rows.push({
            id: card.dataset.id,
            title: (card.querySelector('.editor-note-title, .card-title, [data-field="title"]')?.textContent || '').trim().slice(0, 24),
            sectionCollapsed: !!body?.classList.contains('collapsed'),
            canvasBlockHidden: !!block?.classList.contains('is-hidden') || !!block?.hasAttribute('hidden'),
            viewportSize: viewport ? `${viewport.style.width || 'css'} x ${viewport.style.height || '180'}` : 'none',
            canvasBitmap: canvas ? `${canvas.width}x${canvas.height}` : 'missing'
        });
    });
    console.table(rows);
    return rows;
}
