/** @module {"owns":"note card attached-media section HTML and hydrate", "related":["mediaAttachments.js","mediaLibrary.js","noteSurfaceHtml.js","mediaLibraryOverlay.js","mediaQuickActions.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { CARD_ICONS } from './icons.js';
import { getMediaMeta, getObjectUrl, releaseObjectUrl } from './mediaLibrary.js';
import {
    ATTACH_SCALE_DEFAULT,
    ATTACH_SCALE_MAX,
    ATTACH_SCALE_MIN,
    clampAttachCoord,
    clampAttachScale,
    detachMediaFromNote,
    normalizeAttachments,
    resetAttachmentCanvas,
    stepAttachScale,
    updateAttachmentView
} from './mediaAttachments.js';
import { buildMediaQuickActionsHtml, bindMediaQuickActions, viewMediaFullSize } from './mediaQuickActions.js';
import { showAppToast } from './toast.js';

const CANVAS_PAD = 12;
const CASCADE_STEP = 18;
const TILE_WIDTH_FRAC = 0.42;
const TILE_WIDTH_MIN = 96;

async function openMediaLibrary(opts) {
    const { MediaLibraryOverlay } = await import('./mediaLibraryOverlay.js');
    return MediaLibraryOverlay.open(opts);
}

function attachmentEntry(item, mediaId) {
    return normalizeAttachments(item?.attachments).find((a) => a.mediaId === mediaId) || null;
}

function canvasRoot(section) {
    return section?.querySelector?.('[data-note-media-canvas]') || null;
}

function canvasViewport(section) {
    return canvasRoot(section)?.querySelector?.('[data-note-media-viewport]') || null;
}

function canvasSurface(section) {
    return canvasRoot(section)?.querySelector?.('[data-note-media-surface]') || null;
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
    section.querySelectorAll('.note-media-canvas__tile[data-media-id]').forEach((tile) => {
        releaseCanvasTileUrls(tile);
    });
}

function nextCanvasZ(surface) {
    const cur = Number(surface.dataset.zTop || 1);
    const next = (Number.isFinite(cur) ? cur : 1) + 1;
    surface.dataset.zTop = String(next);
    return next;
}

function bringTileToFront(tile) {
    const surface = tile?.closest?.('[data-note-media-surface]');
    if (!tile || !surface) return;
    tile.style.zIndex = String(nextCanvasZ(surface));
}

function baseTileWidthPx(viewport) {
    const w = viewport?.clientWidth || 200;
    return Math.max(TILE_WIDTH_MIN, Math.round(w * TILE_WIDTH_FRAC));
}

function applyTileScale(tile, scale, viewport) {
    if (!tile) return;
    const s = clampAttachScale(scale);
    tile.dataset.attachScale = String(s);
    tile.style.width = `${Math.round(baseTileWidthPx(viewport) * s)}px`;
    syncZoomButtonState(tile, s);
}

function syncZoomButtonState(host, scale) {
    if (!host) return;
    const s = clampAttachScale(scale);
    const outBtn = host.querySelector('[data-attach-zoom-out]');
    const resetBtn = host.querySelector('[data-attach-zoom-reset]');
    const inBtn = host.querySelector('[data-attach-zoom-in]');
    if (outBtn) outBtn.disabled = s <= ATTACH_SCALE_MIN;
    if (resetBtn) resetBtn.disabled = s === ATTACH_SCALE_DEFAULT;
    if (inBtn) inBtn.disabled = s >= ATTACH_SCALE_MAX;
}

function setTilePosition(tile, x, y) {
    const px = clampAttachCoord(x) ?? 0;
    const py = clampAttachCoord(y) ?? 0;
    tile.style.left = `${px}px`;
    tile.style.top = `${py}px`;
    tile.dataset.attachX = String(px);
    tile.dataset.attachY = String(py);
}

function syncCanvasExtents(section) {
    const viewport = canvasViewport(section);
    const surface = canvasSurface(section);
    if (!viewport || !surface) return;
    const tiles = surface.querySelectorAll('.note-media-canvas__tile');
    let maxR = viewport.clientWidth;
    let maxB = viewport.clientHeight;
    tiles.forEach((tile) => {
        const x = Number(tile.dataset.attachX || 0);
        const y = Number(tile.dataset.attachY || 0);
        maxR = Math.max(maxR, x + tile.offsetWidth + CANVAS_PAD);
        maxB = Math.max(maxB, y + tile.offsetHeight + CANVAS_PAD);
    });
    surface.style.width = `${Math.round(maxR)}px`;
    surface.style.height = `${Math.round(maxB)}px`;
}

function updateCanvasVisibility(section) {
    const root = canvasRoot(section);
    if (!root) return;
    const count = root.querySelectorAll('.note-media-canvas__tile').length;
    root.classList.toggle('is-hidden', count === 0);
    root.hidden = count === 0;
    if (count > 0) syncCanvasExtents(section);
}

function sizeCanvasViewport(section) {
    const viewport = canvasViewport(section);
    if (!viewport) return;
    const card = section.closest('.mini-card, .editor-note-shell, #editor-overlay');
    const hostH = card?.clientHeight || 0;
    const h = hostH
        ? Math.round(Math.max(120, Math.min(260, hostH * 0.42)))
        : 180;
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

function bindTileDrag(tile, item, mediaId, section) {
    if (!tile || tile.dataset.dragBound === '1') return;
    tile.dataset.dragBound = '1';

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    tile.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        bringTileToFront(tile);
        if (e.target.closest('.note-attachment__zoom, .card-act, button')) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        originX = Number(tile.dataset.attachX || 0);
        originY = Number(tile.dataset.attachY || 0);
        tile.classList.add('is-dragging');
        try {
            tile.setPointerCapture(e.pointerId);
        } catch { /* ignore */ }
    });

    tile.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        e.preventDefault();
        const x = Math.max(0, Math.round(originX + (e.clientX - startX)));
        const y = Math.max(0, Math.round(originY + (e.clientY - startY)));
        setTilePosition(tile, x, y);
        syncCanvasExtents(section);
    });

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        tile.classList.remove('is-dragging');
        try {
            tile.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        const x = Number(tile.dataset.attachX || 0);
        const y = Number(tile.dataset.attachY || 0);
        updateAttachmentView(item, mediaId, { x, y }, { syncUi: false });
        syncCanvasExtents(section);
    };

    tile.addEventListener('pointerup', endDrag);
    tile.addEventListener('pointercancel', endDrag);
}

/**
 * @param {HTMLElement} section
 * @param {HTMLElement} row
 * @param {object} item
 * @param {string} mediaId
 * @param {{ scale?: number, x?: number|null, y?: number|null }} [layout]
 */
async function expandAttachmentOnCanvas(section, row, item, mediaId, layout = {}) {
    const surface = canvasSurface(section);
    const viewport = canvasViewport(section);
    const expandBtn = row.querySelector('[data-expand-media]');
    if (!surface || !viewport) return;

    let tile = surface.querySelector(`.note-media-canvas__tile[data-media-id="${CSS.escape(mediaId)}"]`);
    if (tile) {
        row.classList.add('is-expanded');
        setExpandButtonState(expandBtn, true);
        updateCanvasVisibility(section);
        return;
    }

    const url = await getObjectUrl(mediaId, 'blob');
    if (!url) {
        showAppToast('Preview unavailable');
        return;
    }
    if (!section.isConnected) {
        releaseObjectUrl(mediaId, 'blob');
        return;
    }

    sizeCanvasViewport(section);

    const s = clampAttachScale(layout.scale ?? 1);
    const cascade = defaultCascadePos(item, mediaId);
    const x = clampAttachCoord(layout.x) ?? cascade.x;
    const y = clampAttachCoord(layout.y) ?? cascade.y;

    tile = document.createElement('div');
    tile.className = 'note-media-canvas__tile';
    tile.dataset.mediaId = mediaId;
    tile.dataset.blobClaimed = '1';
    tile.innerHTML = `
        <div class="note-attachment__zoom" role="group" aria-label="Zoom image">
            <button type="button" class="card-act" data-attach-zoom-out title="Zoom out" aria-label="Zoom out">${CARD_ICONS.minus}</button>
            <button type="button" class="card-act" data-attach-zoom-reset title="Reset zoom" aria-label="Reset zoom">${CARD_ICONS.zoomReset}</button>
            <button type="button" class="card-act" data-attach-zoom-in title="Zoom in" aria-label="Zoom in">${CARD_ICONS.plus}</button>
        </div>
        <img class="note-media-canvas__img" data-attach-full src="${escapeAttr(url)}" alt="">
    `;
    surface.appendChild(tile);
    applyTileScale(tile, s, viewport);
    setTilePosition(tile, x, y);
    bringTileToFront(tile);
    bindTileDrag(tile, item, mediaId, section);

    row.classList.add('is-expanded');
    row.dataset.attachScale = String(s);
    setExpandButtonState(expandBtn, true);
    updateCanvasVisibility(section);

    if (layout.x == null || layout.y == null) {
        updateAttachmentView(item, mediaId, { x, y }, { syncUi: false });
    }
}

/**
 * @param {HTMLElement} section
 * @param {HTMLElement} row
 * @param {string} mediaId
 */
function collapseAttachmentFromCanvas(section, row, mediaId) {
    const surface = canvasSurface(section);
    const expandBtn = row.querySelector('[data-expand-media]');
    const tile = surface?.querySelector?.(`.note-media-canvas__tile[data-media-id="${CSS.escape(mediaId)}"]`);
    if (tile) {
        releaseCanvasTileUrls(tile);
        tile.remove();
    }
    row.classList.remove('is-expanded');
    delete row.dataset.attachScale;
    setExpandButtonState(expandBtn, false);
    updateCanvasVisibility(section);
}

function setAttachmentTileScale(section, row, item, mediaId, scale) {
    const next = clampAttachScale(scale);
    const viewport = canvasViewport(section);
    const surface = canvasSurface(section);
    const tile = surface?.querySelector?.(`.note-media-canvas__tile[data-media-id="${CSS.escape(mediaId)}"]`);
    if (tile) applyTileScale(tile, next, viewport);
    row.dataset.attachScale = String(next);
    updateAttachmentView(item, mediaId, { scale: next }, { syncUi: false });
    syncCanvasExtents(section);
}

function clearCanvasDom(section) {
    const surface = canvasSurface(section);
    if (!surface) return;
    surface.querySelectorAll('.note-media-canvas__tile').forEach((tile) => {
        releaseCanvasTileUrls(tile);
        tile.remove();
    });
    section.querySelectorAll('.note-attachment.is-expanded').forEach((row) => {
        row.classList.remove('is-expanded');
        delete row.dataset.attachScale;
        setExpandButtonState(row.querySelector('[data-expand-media]'), false);
    });
    updateCanvasVisibility(section);
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
                    <div class="note-media-canvas is-hidden" data-note-media-canvas hidden>
                        <div class="note-media-canvas__toolbar">
                            <span class="note-media-canvas__title">Note canvas</span>
                            <button type="button" class="card-act note-media-canvas__reset" data-reset-media-canvas title="Reset canvas" aria-label="Reset canvas">${CARD_ICONS.zoomReset}</button>
                        </div>
                        <div class="note-media-canvas__viewport" data-note-media-viewport>
                            <div class="note-media-canvas__surface" data-note-media-surface></div>
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
 * Rebuild Media section(s) for a note in the live DOM (board + modal).
 * @param {object} item
 */
export function syncNoteAttachmentsDom(item) {
    if (!item?.id) return;

    for (const body of noteBodiesForItem(item.id)) {
        const canEdit = bodyCanEdit(body);
        const startCollapsed = !bodyInModal(body);
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

    sizeCanvasViewport(section);

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
                collapseAttachmentFromCanvas(section, row, mediaId);
                updateAttachmentView(item, mediaId, { expanded: false }, { syncUi: false });
            } else {
                const entry = attachmentEntry(item, mediaId);
                expandAttachmentOnCanvas(section, row, item, mediaId, {
                    scale: entry?.scale ?? 1,
                    x: entry?.x,
                    y: entry?.y
                })
                    .then(() => {
                        updateAttachmentView(item, mediaId, { expanded: true }, { syncUi: false });
                    })
                    .catch(() => {});
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
                clearCanvasDom(section);
                resetAttachmentCanvas(item, { syncUi: false });
                return;
            }

            const zoomIn = e.target.closest('[data-attach-zoom-in]');
            const zoomOut = e.target.closest('[data-attach-zoom-out]');
            const zoomReset = e.target.closest('[data-attach-zoom-reset]');
            if (!zoomIn && !zoomOut && !zoomReset) return;
            e.preventDefault();
            e.stopPropagation();
            const tile = (zoomIn || zoomOut || zoomReset).closest('.note-media-canvas__tile');
            const mediaId = tile?.dataset?.mediaId;
            const row = mediaId
                ? section.querySelector(`.note-attachment[data-media-id="${CSS.escape(mediaId)}"]`)
                : null;
            if (!tile || !mediaId || !row) return;
            bringTileToFront(tile);
            if (zoomReset) {
                setAttachmentTileScale(section, row, item, mediaId, ATTACH_SCALE_DEFAULT);
                return;
            }
            const cur = clampAttachScale(
                tile.dataset.attachScale || attachmentEntry(item, mediaId)?.scale || ATTACH_SCALE_DEFAULT
            );
            const next = stepAttachScale(cur, zoomIn ? 1 : -1);
            if (next === cur) return;
            setAttachmentTileScale(section, row, item, mediaId, next);
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
                const entry = attachmentEntry(item, id);
                if (entry?.expanded) {
                    await expandAttachmentOnCanvas(section, row, item, id, {
                        scale: entry.scale,
                        x: entry.x,
                        y: entry.y
                    });
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
