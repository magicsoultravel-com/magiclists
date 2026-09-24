/** @module {"owns":"note card attached-media section HTML and hydrate", "related":["mediaAttachments.js","mediaLibrary.js","noteSurfaceHtml.js","mediaLibraryOverlay.js","mediaQuickActions.js","scribbleInk.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS, DRAWING_ICONS } from './icons.js';
import { getMediaMeta, getObjectUrl, releaseObjectUrl, updateMediaMeta } from './mediaLibrary.js';
import { drawBrushStroke } from './canvasBrushes.js';
import {
    detachMediaFromNote,
    normalizeAttachments,
    reorderAttachments
} from './mediaAttachments.js';
import { buildMediaQuickActionsHtml, bindMediaQuickActions, viewMediaFullSize } from './mediaQuickActions.js';
import { showAppToast } from './toast.js';
import { createEmptyNoteCanvas } from './noteModel.js';
import { renderNoteCanvas, refreshNoteCanvasPreview } from './noteCanvasRenderer.js';
import { initialImageSize } from './canvasImages.js';
import { mutateItem } from './noteSurfaceMutations.js';
import { ColorPicker, PALETTE_UNIFIED } from './colorPicker.js';
import {
    SCRIBBLE_COLORS,
    SCRIBBLE_COLOR_CUSTOM_INDEX,
    SCRIBBLE_WIDTH_MIN,
    SCRIBBLE_WIDTH_MAX,
    SCRIBBLE_WIDTH_DEFAULT,
    normalizeScribbleColorIndex,
    getScribbleColor,
    setScribbleCustomColor,
    clampScribbleWidth,
    stepScribbleWidth,
    eraseScribbleStrokesAt
} from './scribbleInk.js';

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

function clearExpandedAttachmentRows(mediaSection) {
    if (!mediaSection) return;
    mediaSection.querySelectorAll('.note-attachment.is-expanded').forEach((row) => {
        row.classList.remove('is-expanded');
        delete row.dataset.attachScale;
        setExpandButtonState(row.querySelector('[data-expand-media]'), false);
    });
}

/**
 * Collapsible Media section (attachments list only).
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

/**
 * Collapsible Canvas section (preview + draw/reset). Independent from Media.
 * Hidden canvas with data is sticky: omit the DOM so no blank spacer remains.
 * @param {object} item
 * @param {{ startCollapsed?: boolean }} [opts]
 */
export function buildNoteCanvasSectionHtml(item, { startCollapsed = true } = {}) {
    if (!noteHasVisibleCanvas(item)) return '';

    const collapsedClass = startCollapsed ? ' collapsed' : '';
    const toggleCollapsed = startCollapsed ? ' collapsed' : '';

    return `
            <div class="note-body-section note-body-section--canvas" data-note-canvas>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>Canvas</span>
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    <div class="note-media-canvas" data-note-media-canvas>
                        <div class="note-media-canvas__toolbar">
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

function canvasSectionForBody(body) {
    return body?.querySelector?.('[data-note-canvas]') || null;
}

function mediaSectionForBody(body) {
    return body?.querySelector?.('[data-note-attachments]') || null;
}

function insertCanvasHtml(body, html) {
    const media = mediaSectionForBody(body);
    if (media) media.insertAdjacentHTML('afterend', html);
    else body.insertAdjacentHTML('beforeend', html);
}

function restoreSectionCollapse(section, wasCollapsed) {
    if (!section || wasCollapsed === undefined) return;
    const sectionBody = section.querySelector('.note-section-body');
    const toggle = section.querySelector('.collapsable-toggle');
    if (wasCollapsed) {
        sectionBody?.classList.add('collapsed');
        toggle?.classList.add('collapsed');
    } else {
        sectionBody?.classList.remove('collapsed');
        toggle?.classList.remove('collapsed');
    }
}

/**
 * Rebuild Media section for a note in the live DOM (board + modal).
 * @param {object} item
 */
export function syncNoteAttachmentsDom(item) {
    if (!item?.id) return;

    for (const body of noteBodiesForItem(item.id)) {
        const canEdit = bodyCanEdit(body);
        const hasAttachments = normalizeAttachments(item?.attachments).length > 0;
        const startCollapsed = !hasAttachments;
        const html = buildNoteAttachmentsSectionHtml(item, { canEdit, startCollapsed });
        const existing = mediaSectionForBody(body);
        if (!html) {
            releaseSectionUrls(existing);
            existing?.remove();
            continue;
        }
        if (existing) {
            releaseSectionUrls(existing);
            const wasCollapsed = existing.querySelector('.note-section-body')?.classList.contains('collapsed');
            existing.outerHTML = html;
            const next = mediaSectionForBody(body);
            restoreSectionCollapse(next, wasCollapsed);
        } else {
            const canvas = canvasSectionForBody(body);
            if (canvas) canvas.insertAdjacentHTML('beforebegin', html);
            else body.insertAdjacentHTML('beforeend', html);
        }
        bindNoteAttachments(body, item);
    }
}

/**
 * Upsert/remove the independent Canvas section and paint when visible.
 * @param {object} item
 */
export function syncNoteCanvasDom(item) {
    if (!item?.id) return;

    for (const body of noteBodiesForItem(item.id)) {
        const startCollapsed = !noteHasVisibleCanvas(item);
        const html = buildNoteCanvasSectionHtml(item, { startCollapsed });
        const existing = canvasSectionForBody(body);

        if (!html) {
            existing?.remove();
            continue;
        }

        if (existing) {
            const wasCollapsed = existing.querySelector('.note-section-body')?.classList.contains('collapsed');
            existing.outerHTML = html;
            const next = canvasSectionForBody(body);
            restoreSectionCollapse(next, wasCollapsed);
        } else {
            insertCanvasHtml(body, html);
        }

        const section = canvasSectionForBody(body);
        bindNoteCanvas(body, item);
        if (section && noteHasVisibleCanvas(item)) {
            sizeCanvasViewport(section);
            paintNoteCanvasPreview(section, item);
        }
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

function bindCanvasSectionToggle(section, item) {
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
            sizeCanvasViewport(section);
            paintNoteCanvasPreview(section, item);
        }
    });
}

let lightboxEl = null;
let lightboxBound = false;
export const LIGHTBOX_ZOOM_MIN = 1;
export const LIGHTBOX_ZOOM_MAX = 5;
let lightboxZoom = LIGHTBOX_ZOOM_MIN;
let lightboxPanX = 0;
let lightboxPanY = 0;
let lightboxPanning = false;
let lightboxPanStartX = 0;
let lightboxPanStartY = 0;
let lightboxPanBaseX = 0;
let lightboxPanBaseY = 0;
/** Preview-only rotation in degrees (0/90/180/270). Never persisted. */
let lightboxRotation = 0;
/**
 * Auto-shrink so a rotated preview fits the viewport (1 = no shrink).
 * Wide panoramas at 90/270 would otherwise overflow and clip.
 */
let lightboxFitScale = 1;
/** Preview-only scribble state. Strokes live in memory; never persisted. */
let lightboxDoodleMode = false;
let lightboxDoodleColorIndex = 0;
/** @type {'pen'|'eraser'} */
let lightboxDoodleTool = 'pen';
/** Pen width in image-layout CSS px (same idea as magicCanvas brush width). */
let lightboxDoodleWidth = SCRIBBLE_WIDTH_DEFAULT;
let lightboxDoodles = [];
let lightboxActiveStroke = null;
/** Cached untransformed image layout box ({w,h} in CSS px). */
let lightboxLayoutCache = { w: 0, h: 0 };

/**
 * Snap a rotation to the nearest 90-degree step in [0, 360).
 * @param {unknown} value
 * @returns {number}
 */
export function normalizeLightboxRotation(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const stepped = Math.round(n / 90) * 90;
    return ((stepped % 360) + 360) % 360;
}

/**
 * Step preview rotation left (-1) or right (+1) by 90 degrees.
 * @param {unknown} current
 * @param {number} dir
 * @returns {number}
 */
export function rotateLightboxStep(current, dir) {
    const base = normalizeLightboxRotation(current);
    const step = dir >= 0 ? 90 : -90;
    return normalizeLightboxRotation(base + step);
}

/**
 * Clamp a lightbox zoom factor to the supported range.
 * @param {unknown} value
 * @returns {number}
 */
export function clampLightboxZoom(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return LIGHTBOX_ZOOM_MIN;
    return Math.min(LIGHTBOX_ZOOM_MAX, Math.max(LIGHTBOX_ZOOM_MIN, Math.round(n * 100) / 100));
}

/**
 * Next zoom factor for a wheel delta (scroll up zooms in).
 * @param {unknown} current
 * @param {unknown} deltaY
 * @param {unknown} [deltaMode]
 * @returns {number}
 */
export function nextLightboxZoom(current, deltaY, deltaMode = 0) {
    const base = clampLightboxZoom(current);
    let dy = Number(deltaY);
    if (!Number.isFinite(dy) || dy === 0) return base;
    if (Number(deltaMode) === 1) dy *= 16;
    // Exponential factor feels smooth for both notched wheels (~100/detent)
    // and high-frequency trackpads (small deltas).
    const factor = Math.exp(-dy * 0.0018);
    return clampLightboxZoom(base * factor);
}

/**
 * Cursor-anchored pan adjustment so the point under the cursor stays put.
 * @param {{ panX: number, panY: number, cursorX: number, cursorY: number, prevZoom: number, nextZoom: number }} args
 * @returns {{ panX: number, panY: number }}
 */
export function anchorLightboxPan({ panX = 0, panY = 0, cursorX = 0, cursorY = 0, prevZoom = 1, nextZoom = 1 } = {}) {
    const z0 = clampLightboxZoom(prevZoom);
    const z1 = clampLightboxZoom(nextZoom);
    if (z0 <= 0 || z1 === z0) return { panX: Number(panX) || 0, panY: Number(panY) || 0 };
    const ratio = z1 / z0;
    return {
        panX: (Number(panX) || 0) + (Number(cursorX) || 0) * (1 - ratio),
        panY: (Number(panY) || 0) + (Number(cursorY) || 0) * (1 - ratio)
    };
}

/**
 * Fit-scale so a rotated image stays fully visible inside its frame.
 * Only shrinks (never upscales); 0/180 always fit like the base layout.
 * @param {unknown} rotation
 * @param {unknown} imgW
 * @param {unknown} imgH
 * @param {unknown} frameW
 * @param {unknown} frameH
 * @returns {number}
 */
export function lightboxFitScaleForRotation(rotation, imgW, imgH, frameW, frameH) {
    const rot = normalizeLightboxRotation(rotation);
    const w = Number(imgW);
    const h = Number(imgH);
    const fw = Number(frameW);
    const fh = Number(frameH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
    if (!Number.isFinite(fw) || !Number.isFinite(fh) || fw <= 0 || fh <= 0) return 1;
    if (rot !== 90 && rot !== 270) return 1;
    // After a 90/270 CSS rotate the layout box is unchanged, so the visual
    // footprint becomes h×w. Scale it to fit the frame it already fit in.
    const scale = Math.min(fw / h, fh / w, 1);
    if (!Number.isFinite(scale) || scale <= 0) return 1;
    return Math.round(scale * 1000) / 1000;
}

/**
 * Whether the current view can be panned (zoomed, rotated, or fit-shrunk
 * view where drag reveals clipped edges is handled by scroll fallback).
 * @param {unknown} zoom
 * @param {unknown} rotation
 * @returns {boolean}
 */
export function lightboxCanPan(zoom, rotation) {
    return clampLightboxZoom(zoom) > LIGHTBOX_ZOOM_MIN + 1e-9
        || normalizeLightboxRotation(rotation) !== 0;
}

/** Shared scribble palette (3 neon + mutable custom). */
export const LIGHTBOX_DOODLE_COLORS = SCRIBBLE_COLORS;
export const LIGHTBOX_DOODLE_CUSTOM_INDEX = SCRIBBLE_COLOR_CUSTOM_INDEX;
/** @deprecated Prefer LIGHTBOX_DOODLE_WIDTH_DEFAULT; kept for callers that used relative width. */
export const LIGHTBOX_DOODLE_WIDTH = 0.006;
export const LIGHTBOX_DOODLE_WIDTH_MIN = SCRIBBLE_WIDTH_MIN;
export const LIGHTBOX_DOODLE_WIDTH_MAX = SCRIBBLE_WIDTH_MAX;
export const LIGHTBOX_DOODLE_WIDTH_DEFAULT = SCRIBBLE_WIDTH_DEFAULT;

/**
 * Clamp a lightbox doodle pen width (px) to the supported range.
 * @param {unknown} value
 * @returns {number}
 */
export function clampLightboxDoodleWidth(value) {
    return clampScribbleWidth(value);
}

/**
 * Step the doodle pen width by delta px (clamped).
 * @param {unknown} current
 * @param {number} delta
 * @returns {number}
 */
export function stepLightboxDoodleWidth(current, delta) {
    return stepScribbleWidth(current, delta);
}

/**
 * Pick a doodle color index, wrapping around the scribble palette.
 * @param {unknown} index
 * @returns {number}
 */
export function normalizeLightboxDoodleColor(index) {
    return normalizeScribbleColorIndex(index);
}

/**
 * Re-export stroke-hit erase for tests / site-wide scribble.
 * @param {Array<{ points?: Array<{x?: number, y?: number}>, width?: number }>} strokes
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @param {{ scaleX?: number, scaleY?: number }} [opts]
 */
export function eraseLightboxDoodlesAt(strokes, x, y, radius, opts = {}) {
    return eraseScribbleStrokesAt(strokes, x, y, radius, opts);
}

/**
 * Clamp a pointer position to normalized image coordinates (0..1).
 * @param {unknown} x
 * @param {unknown} y
 * @returns {{ x: number, y: number }}
 */
export function normalizeLightboxDoodlePoint(x, y) {
    const nx = Number(x);
    const ny = Number(y);
    const clamp01 = (v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));
    return { x: clamp01(nx), y: clamp01(ny) };
}

/**
 * Convert a normalized doodle point back to CSS pixels inside the unrotated
 * image layout box (forward map; inverse is below).
 * @param {{ x: number, y: number }} point
 * @param {number} layoutW
 * @param {number} layoutH
 * @returns {{ x: number, y: number }}
 */
export function lightboxDoodleToLayout(point, layoutW, layoutH) {
    const px = Number(point?.x);
    const py = Number(point?.y);
    const w = Number(layoutW);
    const h = Number(layoutH);
    return {
        x: (Number.isFinite(px) ? px : 0) * (Number.isFinite(w) ? w : 0),
        y: (Number.isFinite(py) ? py : 0) * (Number.isFinite(h) ? h : 0)
    };
}

/**
 * Inverse of CSS `rotate(deg)` about the layout-box center, mapping a point
 * in the rotated visual frame back to the unrotated layout box. Rotation is
 * snapped to 90-degree steps (the only states the preview supports).
 * @param {number} x point x in visual (rotated) coordinates
 * @param {number} y point y in visual (rotated) coordinates
 * @param {number} layoutW unrotated layout width
 * @param {number} layoutH unrotated layout height
 * @param {unknown} rotation preview rotation in degrees
 * @returns {{ x: number, y: number }}
 */
export function lightboxDoodleFromVisual(x, y, layoutW, layoutH, rotation) {
    const rot = normalizeLightboxRotation(rotation);
    const w = Number(layoutW);
    const h = Number(layoutH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { x: 0, y: 0 };
    // For 90/270 the visual footprint is h×w centered on the same center.
    const vw = (rot === 90 || rot === 270) ? h : w;
    const vh = (rot === 90 || rot === 270) ? w : h;
    const cx = (Number(x) || 0) - vw / 2;
    const cy = (Number(y) || 0) - vh / 2;
    const rad = (rot * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    // Inverse rotation by -rot: lx = cx*cos + cy*sin, ly = -cx*sin + cy*cos.
    return {
        x: w / 2 + cx * cos + cy * sin,
        y: h / 2 - cx * sin + cy * cos
    };
}

/**
 * Forward map: unrotated layout-box point to the rotated visual frame.
 * Used to paint preview strokes so ink sits exactly on the pixels.
 * @param {number} x point x in layout coordinates
 * @param {number} y point y in layout coordinates
 * @param {number} layoutW unrotated layout width
 * @param {number} layoutH unrotated layout height
 * @param {unknown} rotation preview rotation in degrees
 * @returns {{ x: number, y: number }}
 */
export function lightboxDoodleToVisual(x, y, layoutW, layoutH, rotation) {
    const rot = normalizeLightboxRotation(rotation);
    const w = Number(layoutW);
    const h = Number(layoutH);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { x: 0, y: 0 };
    const rad = (rot * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const lx = (Number(x) || 0) - w / 2;
    const ly = (Number(y) || 0) - h / 2;
    const vw = (rot === 90 || rot === 270) ? h : w;
    const vh = (rot === 90 || rot === 270) ? w : h;
    return {
        x: vw / 2 + lx * cos - ly * sin,
        y: vh / 2 + lx * sin + ly * cos
    };
}

function lightboxImg() {
    return lightboxEl?.querySelector?.('[data-lightbox-img]') || null;
}

function lightboxFrame() {
    return lightboxEl?.querySelector?.('[data-lightbox-frame]') || null;
}

function lightboxZoomBadge() {
    return lightboxEl?.querySelector?.('[data-lightbox-zoom]') || null;
}

function applyLightboxTransform() {
    const img = lightboxImg();
    const frame = lightboxFrame();
    const badge = lightboxZoomBadge();
    if (!img || !frame) return;
    const rot = normalizeLightboxRotation(lightboxRotation);
    const rotated = rot !== 0;
    // Swap the CSS fit box only when the visual footprint is h×w.
    const swappedFootprint = rot === 90 || rot === 270;
    const zoomed = lightboxZoom > LIGHTBOX_ZOOM_MIN + 1e-9;
    const effectiveZoom = lightboxZoom * lightboxFitScale;
    if (!zoomed && !rotated) {
        img.style.transform = '';
        img.style.transformOrigin = '';
        img.style.cursor = '';
    } else if (rotated) {
        // Center-origin keeps 90/270-degree previews centered. Pan stays
        // outermost so drag deltas map 1:1 to screen axes at any rotation;
        // zoom-while-rotated anchors to the image center. Always keep an
        // explicit rotate(Ndeg) so wraparound never depends on clearing
        // the transform string (empty → 270deg would animate the long way).
        img.style.transformOrigin = 'center';
        img.style.transform = `translate(${lightboxPanX}px, ${lightboxPanY}px) rotate(${rot}deg) scale(${effectiveZoom})`;
        img.style.cursor = lightboxPanning ? 'grabbing' : 'grab';
    } else {
        img.style.transformOrigin = '0 0';
        img.style.transform = `translate(${lightboxPanX}px, ${lightboxPanY}px) scale(${lightboxZoom})`;
        img.style.cursor = lightboxPanning ? 'grabbing' : 'grab';
    }
    frame.classList.toggle('is-zoomed', zoomed);
    frame.classList.toggle('is-rotated', swappedFootprint);
    // The doodle overlay paints in pan-free frame coordinates; the canvas
    // element itself rides the same translate so ink tracks the image
    // during drag-pans without a repaint per pointermove.
    const doodle = lightboxDoodleCanvas();
    if (doodle) {
        doodle.style.transform = (lightboxPanX || lightboxPanY)
            ? `translate(${lightboxPanX}px, ${lightboxPanY}px)`
            : '';
    }
    if (badge) {
        const pct = Math.round(lightboxZoom * 100);
        badge.textContent = `${pct}%`;
        badge.classList.toggle('is-visible', zoomed);
    }
}

function measureLightboxFit() {
    const img = lightboxImg();
    const frame = lightboxFrame();
    if (!img || !frame) {
        lightboxFitScale = 1;
        return;
    }
    const rot = normalizeLightboxRotation(lightboxRotation);
    if (rot !== 90 && rot !== 270) {
        lightboxFitScale = 1;
        return;
    }
    // offsetWidth/Height are the untransformed layout box — never clear
    // style.transform to measure (that used to flash through CSS transitions).
    const w = img.offsetWidth || img.naturalWidth || 0;
    const h = img.offsetHeight || img.naturalHeight || 0;
    const fw = frame.clientWidth || frame.offsetWidth || 0;
    const fh = frame.clientHeight || frame.offsetHeight || 0;
    lightboxFitScale = lightboxFitScaleForRotation(rot, w, h, fw, fh);
}

/**
 * Untransformed image layout box in CSS px (cached for doodle mapping).
 * @returns {{ w: number, h: number }}
 */
export function measureLightboxLayout() {
    const img = typeof lightboxImg === 'function' ? lightboxImg() : null;
    // Prefer layout sizes that ignore CSS transforms; never toggle transform.
    let w = img?.offsetWidth || 0;
    let h = img?.offsetHeight || 0;
    if ((!w || !h) && img) {
        w = w || img.naturalWidth || img.width || 0;
        h = h || img.naturalHeight || img.height || 0;
    }
    lightboxLayoutCache = { w: Number(w) || 0, h: Number(h) || 0 };
    return lightboxLayoutCache;
}

function lightboxDoodleCanvas() {
    return lightboxEl?.querySelector?.('[data-lightbox-doodle]') || null;
}

function lightboxDoodleBar() {
    return lightboxEl?.querySelector?.('[data-lightbox-doodle-bar]') || null;
}

/**
 * Size the doodle canvas to the image's rendered (visual incl. zoom/fit,
 * excl. pan) footprint and position it over the image.
 * @returns {{ canvas: HTMLCanvasElement, dpr: number, w: number, h: number } | null}
 */
function sizeLightboxDoodleCanvas() {
    const canvas = lightboxDoodleCanvas();
    const img = lightboxImg();
    const frame = lightboxFrame();
    if (!canvas || !img || !frame) return null;
    if (lightboxEl?.classList?.contains('is-hidden')) return null;
    const layout = measureLightboxLayout();
    const rot = normalizeLightboxRotation(lightboxRotation);
    const effZoom = (Number(lightboxZoom) || 1) * (Number(lightboxFitScale) || 1);
    const baseW = (rot === 90 || rot === 270) ? layout.h : layout.w;
    const baseH = (rot === 90 || rot === 270) ? layout.w : layout.h;
    const w = Math.max(1, Math.round(baseW * effZoom));
    const h = Math.max(1, Math.round(baseH * effZoom));
    if (w <= 1 || h <= 1) return null;
    const dpr = Math.min(3, Math.max(1, Number(window?.devicePixelRatio) || 1));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const frameRect = frame.getBoundingClientRect?.();
    const imgRect = img.getBoundingClientRect?.();
    if (frameRect && imgRect) {
        // Visual rect includes pan; subtract it — pan rides on the canvas
        // element transform instead (see applyLightboxTransform).
        canvas.style.left = `${(imgRect.left - frameRect.left) - lightboxPanX}px`;
        canvas.style.top = `${(imgRect.top - frameRect.top) - lightboxPanY}px`;
    }
    return { canvas, dpr, w, h };
}

/**
 * Repaint preview-only doodles. Stored normalized (0..1); mapped here to
 * visual pixels (rotate then scale by effective zoom) so ink sits on the
 * displayed pixels exactly.
 */
function paintLightboxDoodles() {
    const sized = sizeLightboxDoodleCanvas();
    if (!sized) return;
    const { canvas, dpr, w, h } = sized;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const layout = lightboxLayoutCache;
    if (!layout.w || !layout.h) return;
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    const rot = normalizeLightboxRotation(lightboxRotation);
    const effZoom = (Number(lightboxZoom) || 1) * (Number(lightboxFitScale) || 1);
    const strokes = Array.isArray(lightboxDoodles) ? lightboxDoodles.slice() : [];
    if (lightboxActiveStroke?.points?.length) strokes.push(lightboxActiveStroke);
    for (const stroke of strokes) {
        const pts = Array.isArray(stroke?.points) ? stroke.points : [];
        if (!pts.length) continue;
        const mapped = [];
        for (const pt of pts) {
            const base = lightboxDoodleToLayout(pt, layout.w, layout.h);
            const vis = lightboxDoodleToVisual(base.x, base.y, layout.w, layout.h, rot);
            mapped.push({
                x: vis.x * effZoom,
                y: vis.y * effZoom,
                p: Number.isFinite(Number(pt?.p)) ? Number(pt.p) : 0.5
            });
        }
        drawBrushStroke(ctx, {
            points: mapped,
            color: stroke.color,
            // Width is image-layout px; scale with zoom so thickness tracks the photo.
            width: Math.max(1, (Number(stroke.width) || lightboxDoodleWidth || LIGHTBOX_DOODLE_WIDTH_DEFAULT) * effZoom),
            style: 'pen'
        });
    }
    ctx.restore();
}

/**
 * Map a doodle-canvas pointer event to normalized (0..1) image coords.
 * Inverse of the paint path: unscale zoom, then unrotate.
 * @param {PointerEvent} e
 * @returns {{ x: number, y: number } | null}
 */
function lightboxDoodlePointFromEvent(e) {
    const canvas = lightboxDoodleCanvas();
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect?.();
    if (!rect?.width || !rect?.height) return null;
    const layout = (lightboxLayoutCache.w && lightboxLayoutCache.h)
        ? lightboxLayoutCache
        : measureLightboxLayout();
    if (!layout.w || !layout.h) return null;
    const rot = normalizeLightboxRotation(lightboxRotation);
    const effZoom = (Number(lightboxZoom) || 1) * (Number(lightboxFitScale) || 1) || 1;
    const visX = ((Number(e?.clientX) || 0) - rect.left) / effZoom;
    const visY = ((Number(e?.clientY) || 0) - rect.top) / effZoom;
    const base = lightboxDoodleFromVisual(visX, visY, layout.w, layout.h, rot);
    return normalizeLightboxDoodlePoint(base.x / layout.w, base.y / layout.h);
}

function syncLightboxDoodleUI() {
    const frame = lightboxFrame();
    const penBtn = lightboxEl?.querySelector?.('[data-lightbox-doodle-toggle]') || null;
    const bar = lightboxDoodleBar();
    const canvas = lightboxDoodleCanvas();
    const hint = lightboxEl?.querySelector?.('[data-lightbox-hint]') || null;
    frame?.classList.toggle('is-doodling', !!lightboxDoodleMode);
    frame?.classList.toggle('is-erasing', !!lightboxDoodleMode && lightboxDoodleTool === 'eraser');
    if (penBtn) {
        penBtn.classList.toggle('is-active', !!lightboxDoodleMode);
        penBtn.setAttribute('aria-pressed', lightboxDoodleMode ? 'true' : 'false');
    }
    if (bar) bar.hidden = !lightboxDoodleMode;
    if (canvas) {
        canvas.style.display = lightboxDoodleMode ? '' : 'none';
        canvas.style.pointerEvents = lightboxDoodleMode ? 'auto' : 'none';
    }
    syncLightboxDoodleWidthUI();
    syncLightboxDoodleToolUI();
    syncLightboxDoodleColorUI();
    if (hint) {
        hint.textContent = lightboxDoodleMode
            ? (lightboxDoodleTool === 'eraser'
                ? 'Erase scribbles · Scroll to zoom'
                : 'Draw to scribble (preview only) · Scroll to zoom · Pick a color below')
            : 'Scroll to zoom · Drag to pan · Double-click to reset';
    }
}

function syncLightboxDoodleWidthUI() {
    const width = clampLightboxDoodleWidth(lightboxDoodleWidth);
    lightboxDoodleWidth = width;
    const label = lightboxEl?.querySelector?.('[data-lightbox-doodle-width]') || null;
    if (label) label.textContent = `${width}px`;
    const smaller = lightboxEl?.querySelector?.('[data-lightbox-doodle-smaller]') || null;
    const larger = lightboxEl?.querySelector?.('[data-lightbox-doodle-larger]') || null;
    if (smaller) smaller.disabled = width <= LIGHTBOX_DOODLE_WIDTH_MIN;
    if (larger) larger.disabled = width >= LIGHTBOX_DOODLE_WIDTH_MAX;
}

function syncLightboxDoodleToolUI() {
    const bar = lightboxDoodleBar();
    const eraser = bar?.querySelector?.('[data-lightbox-doodle-eraser]') || null;
    if (eraser) {
        const on = lightboxDoodleTool === 'eraser';
        eraser.classList.toggle('is-active', on);
        eraser.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
}

function syncLightboxDoodleColorUI() {
    const bar = lightboxDoodleBar();
    bar?.querySelectorAll?.('[data-lightbox-doodle-color]')?.forEach?.((btn) => {
        const idx = Number(btn?.dataset?.lightboxDoodleColor);
        const active = idx === lightboxDoodleColorIndex && lightboxDoodleTool === 'pen';
        btn.classList.toggle('is-active', active);
        if (active) btn.setAttribute('aria-pressed', 'true');
        else btn.removeAttribute('aria-pressed');
        if (idx === LIGHTBOX_DOODLE_CUSTOM_INDEX) {
            btn.style.setProperty('--doodle-color', getScribbleColor(LIGHTBOX_DOODLE_CUSTOM_INDEX));
            btn.title = 'Custom color';
            btn.setAttribute('aria-label', 'Custom pen color');
        }
    });
}

function setLightboxDoodleWidth(next) {
    lightboxDoodleWidth = clampLightboxDoodleWidth(next);
    syncLightboxDoodleWidthUI();
}

function adjustLightboxDoodleWidth(delta) {
    setLightboxDoodleWidth(stepLightboxDoodleWidth(lightboxDoodleWidth, delta));
}

function setLightboxDoodleMode(on) {
    lightboxDoodleMode = !!on;
    if (!lightboxDoodleMode) {
        if (lightboxActiveStroke?.points?.length) {
            lightboxDoodles.push(lightboxActiveStroke);
        }
        lightboxActiveStroke = null;
        ColorPicker.close();
    }
    syncLightboxDoodleUI();
    paintLightboxDoodles();
}

function setLightboxDoodleTool(tool) {
    lightboxDoodleTool = tool === 'eraser' ? 'eraser' : 'pen';
    if (lightboxDoodleTool === 'pen') ColorPicker.close();
    syncLightboxDoodleUI();
}

/**
 * @param {unknown} index
 * @param {{ openPicker?: boolean }} [opts]
 */
function setLightboxDoodleColor(index, opts = {}) {
    const next = normalizeLightboxDoodleColor(index);
    const wasActive = next === lightboxDoodleColorIndex && lightboxDoodleTool === 'pen';
    lightboxDoodleColorIndex = next;
    lightboxDoodleTool = 'pen';
    syncLightboxDoodleUI();
    const wantPicker = !!opts.openPicker
        || (wasActive && next === LIGHTBOX_DOODLE_CUSTOM_INDEX);
    if (wantPicker && next === LIGHTBOX_DOODLE_CUSTOM_INDEX) {
        openLightboxCustomColorPicker();
    } else if (next !== LIGHTBOX_DOODLE_CUSTOM_INDEX) {
        ColorPicker.close();
    }
}

function openLightboxCustomColorPicker() {
    const bar = lightboxDoodleBar();
    const chip = bar?.querySelector?.(`[data-lightbox-doodle-color="${LIGHTBOX_DOODLE_CUSTOM_INDEX}"]`) || null;
    if (!chip) return;
    ColorPicker.open({
        anchor: chip,
        presets: PALETTE_UNIFIED,
        value: getScribbleColor(LIGHTBOX_DOODLE_CUSTOM_INDEX),
        align: 'center',
        onSelect: (hex) => {
            setScribbleCustomColor(hex);
            syncLightboxDoodleColorUI();
        }
    });
}

function eraseLightboxAtEvent(e) {
    const pt = lightboxDoodlePointFromEvent(e);
    if (!pt) return;
    const layout = (lightboxLayoutCache.w > 0 && lightboxLayoutCache.h > 0)
        ? lightboxLayoutCache
        : measureLightboxLayout();
    if (!layout.w || !layout.h) return;
    const lx = pt.x * layout.w;
    const ly = pt.y * layout.h;
    const radius = clampLightboxDoodleWidth(lightboxDoodleWidth);
    const next = eraseLightboxDoodlesAt(lightboxDoodles, lx, ly, radius, {
        scaleX: layout.w,
        scaleY: layout.h
    });
    if (next.length !== lightboxDoodles.length) {
        lightboxDoodles = next;
        paintLightboxDoodles();
    }
}

function clearLightboxDoodles() {
    lightboxDoodles = [];
    lightboxActiveStroke = null;
    paintLightboxDoodles();
}

function resetLightboxZoom() {
    lightboxZoom = LIGHTBOX_ZOOM_MIN;
    lightboxPanX = 0;
    lightboxPanY = 0;
    lightboxPanning = false;
    lightboxRotation = 0;
    lightboxFitScale = 1;
    // Preview-only scribbles never survive open/close.
    lightboxDoodleMode = false;
    lightboxDoodleTool = 'pen';
    lightboxDoodles = [];
    lightboxActiveStroke = null;
    lightboxLayoutCache = { w: 0, h: 0 };
    ColorPicker.close();
    applyLightboxTransform();
    syncLightboxDoodleUI();
    paintLightboxDoodles();
}

function rotateLightboxPreview(dir) {
    lightboxRotation = rotateLightboxStep(lightboxRotation, dir);
    // Recenter pan on rotation so the preview stays framed; drag re-pans.
    lightboxPanX = 0;
    lightboxPanY = 0;
    measureLightboxFit();
    applyLightboxTransform();
    paintLightboxDoodles();
}

function zoomLightboxAtPoint(clientX, clientY, nextZoom) {
    const img = lightboxImg();
    if (!img) return;
    const prevZoom = lightboxZoom;
    const clamped = clampLightboxZoom(nextZoom);
    if (clamped === prevZoom) {
        // Still re-apply so hitting the min snaps back to unzoomed layout.
        if (clamped <= LIGHTBOX_ZOOM_MIN + 1e-9) {
            lightboxPanX = 0;
            lightboxPanY = 0;
            lightboxZoom = clamped;
            applyLightboxTransform();
        }
        return;
    }
    if (lightboxRotation !== 0) {
        // While rotated, zoom anchors to the image center (cursor-anchored
        // zoom would need axis-swapped math for 90/270-degree previews).
        lightboxZoom = clamped;
        if (lightboxZoom <= LIGHTBOX_ZOOM_MIN + 1e-9) {
            lightboxPanX = 0;
            lightboxPanY = 0;
        }
        applyLightboxTransform();
        paintLightboxDoodles();
        return;
    }
    const rect = img.getBoundingClientRect();
    const cursorX = (Number(clientX) || 0) - (rect?.left || 0);
    const cursorY = (Number(clientY) || 0) - (rect?.top || 0);
    const anchored = anchorLightboxPan({
        panX: lightboxPanX,
        panY: lightboxPanY,
        cursorX,
        cursorY,
        prevZoom,
        nextZoom: clamped
    });
    lightboxZoom = clamped;
    if (lightboxZoom <= LIGHTBOX_ZOOM_MIN + 1e-9) {
        lightboxPanX = 0;
        lightboxPanY = 0;
    } else {
        lightboxPanX = anchored.panX;
        lightboxPanY = anchored.panY;
    }
    applyLightboxTransform();
    paintLightboxDoodles();
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
        <div class="media-lightbox__frame" data-lightbox-frame>
            <img class="media-lightbox__img" data-lightbox-img alt="" draggable="false">
            <canvas class="media-lightbox__doodle" data-lightbox-doodle style="display:none"></canvas>
            <div class="media-lightbox__chrome" data-lightbox-chrome>
                <div class="media-lightbox__doodle-bar" data-lightbox-doodle-bar hidden>
                    <button type="button" class="media-lightbox__doodle-dot is-active" data-lightbox-doodle-color="0" style="--doodle-color:#ff00ff" title="Pink" aria-label="Pink pen" aria-pressed="true"></button>
                    <button type="button" class="media-lightbox__doodle-dot" data-lightbox-doodle-color="1" style="--doodle-color:#00ffff" title="Cyan" aria-label="Cyan pen"></button>
                    <button type="button" class="media-lightbox__doodle-dot" data-lightbox-doodle-color="2" style="--doodle-color:#00ff00" title="Green" aria-label="Green pen"></button>
                    <button type="button" class="media-lightbox__doodle-dot" data-lightbox-doodle-color="3" style="--doodle-color:#ffaa00" title="Custom color" aria-label="Custom pen color"></button>
                    <button type="button" class="media-lightbox__doodle-tool" data-lightbox-doodle-eraser title="Eraser" aria-label="Eraser" aria-pressed="false">${DRAWING_ICONS.eraser}</button>
                    <span class="media-lightbox__doodle-size" aria-label="Pen size">
                        <button type="button" class="media-lightbox__doodle-size-btn" data-lightbox-doodle-smaller title="Decrease pen size" aria-label="Decrease pen size">${ACTION_ICONS.minus}</button>
                        <span class="media-lightbox__doodle-size-value" data-lightbox-doodle-width aria-live="polite">6px</span>
                        <button type="button" class="media-lightbox__doodle-size-btn" data-lightbox-doodle-larger title="Increase pen size" aria-label="Increase pen size">${ACTION_ICONS.plus}</button>
                    </span>
                    <button type="button" class="media-lightbox__doodle-clear" data-lightbox-doodle-clear title="Clear scribbles" aria-label="Clear scribbles">Clear</button>
                </div>
                <div class="media-lightbox__tools">
                    <button type="button" class="card-act" data-lightbox-doodle-toggle title="Scribble (preview only)" aria-label="Scribble (preview only)" aria-pressed="false">${CARD_ICONS.drawingPencil}</button>
                    <button type="button" class="card-act" data-lightbox-rotate-left title="Rotate left (preview only)" aria-label="Rotate left (preview only)">${CARD_ICONS.rotateLeft}</button>
                    <button type="button" class="card-act" data-lightbox-rotate-right title="Rotate right (preview only)" aria-label="Rotate right (preview only)">${CARD_ICONS.rotateRight}</button>
                    <button type="button" class="card-act media-lightbox__close" data-lightbox-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
                </div>
            </div>
            <div class="media-lightbox__zoom-badge" data-lightbox-zoom aria-hidden="true">100%</div>
            <div class="media-lightbox__hint" data-lightbox-hint aria-hidden="true">Scroll to zoom &middot; Drag to pan &middot; Double-click to reset</div>
        </div>
    `;
    document.body.appendChild(lightboxEl);

    if (!lightboxBound) {
        lightboxBound = true;
        lightboxEl.addEventListener('click', (e) => {
            const rotLeft = e.target.closest('[data-lightbox-rotate-left]');
            if (rotLeft) {
                e.preventDefault();
                e.stopPropagation();
                rotateLightboxPreview(-1);
                return;
            }
            const rotRight = e.target.closest('[data-lightbox-rotate-right]');
            if (rotRight) {
                e.preventDefault();
                e.stopPropagation();
                rotateLightboxPreview(1);
                return;
            }
            const doodleToggle = e.target.closest('[data-lightbox-doodle-toggle]');
            if (doodleToggle) {
                e.preventDefault();
                e.stopPropagation();
                setLightboxDoodleMode(!lightboxDoodleMode);
                return;
            }
            const doodleColor = e.target.closest('[data-lightbox-doodle-color]');
            if (doodleColor) {
                e.preventDefault();
                e.stopPropagation();
                const idx = Number(doodleColor.dataset?.lightboxDoodleColor);
                const already = idx === lightboxDoodleColorIndex && lightboxDoodleTool === 'pen';
                setLightboxDoodleColor(idx, {
                    openPicker: already && idx === LIGHTBOX_DOODLE_CUSTOM_INDEX
                });
                return;
            }
            if (e.target.closest('[data-lightbox-doodle-eraser]')) {
                e.preventDefault();
                e.stopPropagation();
                setLightboxDoodleTool(lightboxDoodleTool === 'eraser' ? 'pen' : 'eraser');
                return;
            }
            if (e.target.closest('[data-lightbox-doodle-clear]')) {
                e.preventDefault();
                e.stopPropagation();
                clearLightboxDoodles();
                return;
            }
            if (e.target.closest('[data-lightbox-doodle-smaller]')) {
                e.preventDefault();
                e.stopPropagation();
                adjustLightboxDoodleWidth(-1);
                return;
            }
            if (e.target.closest('[data-lightbox-doodle-larger]')) {
                e.preventDefault();
                e.stopPropagation();
                adjustLightboxDoodleWidth(1);
                return;
            }
            if (e.target.closest('[data-lightbox-close]')) {
                e.preventDefault();
                closeMediaLightbox();
            }
        });
        const frame = lightboxEl.querySelector('[data-lightbox-frame]');
        const zoomImg = lightboxEl.querySelector('[data-lightbox-img]');
        // Scroll over the image zooms in/out (page behind must not scroll).
        // Pen mode still zooms — scribble coords are normalized so ink stays put.
        frame?.addEventListener('wheel', (e) => {
            if (!lightboxEl || lightboxEl.classList.contains('is-hidden')) return;
            if (e.target?.closest?.('[data-lightbox-close],[data-lightbox-rotate-left],[data-lightbox-rotate-right],[data-lightbox-doodle-toggle],[data-lightbox-doodle-smaller],[data-lightbox-doodle-larger]')) return;
            e.preventDefault();
            e.stopPropagation();
            zoomLightboxAtPoint(e.clientX, e.clientY, nextLightboxZoom(lightboxZoom, e.deltaY, e.deltaMode));
        }, { passive: false });
        // Double-click resets; drag pans while zoomed or rotated (so a
        // rotated panorama can be dragged to reveal clipped edges).
        zoomImg?.addEventListener('dblclick', (e) => {
            // Pen mode locks the view; never reset away someone's ink.
            if (lightboxDoodleMode) return;
            e.preventDefault();
            resetLightboxZoom();
        });
        zoomImg?.addEventListener('pointerdown', (e) => {
            // Pen mode locks the view: the doodle canvas owns the pointer.
            if (lightboxDoodleMode) return;
            if (!lightboxCanPan(lightboxZoom, lightboxRotation)) return;
            if (e.button !== undefined && e.button !== 0) return;
            lightboxPanning = true;
            lightboxPanStartX = e.clientX;
            lightboxPanStartY = e.clientY;
            lightboxPanBaseX = lightboxPanX;
            lightboxPanBaseY = lightboxPanY;
            try { zoomImg.setPointerCapture(e.pointerId); } catch { /* noop */ }
            applyLightboxTransform();
            e.preventDefault();
        });
        zoomImg?.addEventListener('pointermove', (e) => {
            if (!lightboxPanning) return;
            lightboxPanX = lightboxPanBaseX + (e.clientX - lightboxPanStartX);
            lightboxPanY = lightboxPanBaseY + (e.clientY - lightboxPanStartY);
            applyLightboxTransform();
        });
        const endPan = () => {
            if (!lightboxPanning) return;
            lightboxPanning = false;
            applyLightboxTransform();
        };
        zoomImg?.addEventListener('pointerup', endPan);
        zoomImg?.addEventListener('pointercancel', endPan);
        // Preview-only scribble strokes (magic-canvas pen, neon + custom).
        const doodleCanvas = lightboxEl.querySelector('[data-lightbox-doodle]');
        let doodleErasing = false;
        const doodlePressure = (e) => {
            const raw = Number(e?.pressure);
            if (Number.isFinite(raw) && raw > 0) return Math.min(1, raw);
            if (e?.pointerType === 'mouse') return 0.6;
            return 0.5;
        };
        const doodleAppendPoint = (e) => {
            const pt = lightboxDoodlePointFromEvent(e);
            if (!pt || !lightboxActiveStroke) return;
            const prev = lightboxActiveStroke.points[lightboxActiveStroke.points.length - 1];
            // Drop exact duplicates (e.g. pointerdown + first move at rest).
            if (prev && Math.abs(prev.x - pt.x) < 1e-6 && Math.abs(prev.y - pt.y) < 1e-6) return;
            lightboxActiveStroke.points.push({ x: pt.x, y: pt.y, p: doodlePressure(e) });
            paintLightboxDoodles();
        };
        doodleCanvas?.addEventListener('pointerdown', (e) => {
            if (!lightboxDoodleMode) return;
            if (e.button !== undefined && e.button !== 0) return;
            try { doodleCanvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
            if (lightboxDoodleTool === 'eraser') {
                doodleErasing = true;
                lightboxActiveStroke = null;
                eraseLightboxAtEvent(e);
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            if (lightboxActiveStroke?.points?.length) {
                lightboxDoodles.push(lightboxActiveStroke);
            }
            lightboxActiveStroke = {
                color: getScribbleColor(lightboxDoodleColorIndex),
                width: clampLightboxDoodleWidth(lightboxDoodleWidth),
                points: []
            };
            doodleAppendPoint(e);
            e.preventDefault();
            e.stopPropagation();
        });
        doodleCanvas?.addEventListener('pointermove', (e) => {
            if (!lightboxDoodleMode) return;
            if (lightboxDoodleTool === 'eraser' && doodleErasing) {
                const events = typeof e.getCoalescedEvents === 'function'
                    ? e.getCoalescedEvents()
                    : [e];
                for (const sub of events.length ? events : [e]) eraseLightboxAtEvent(sub);
                e.preventDefault();
                return;
            }
            if (!lightboxActiveStroke) return;
            // coalesced events smooth fast strokes on high-Hz pointers.
            const events = typeof e.getCoalescedEvents === 'function'
                ? e.getCoalescedEvents()
                : [e];
            for (const sub of events.length ? events : [e]) doodleAppendPoint(sub);
            e.preventDefault();
        });
        const endDoodleStroke = () => {
            doodleErasing = false;
            if (!lightboxActiveStroke) return;
            if (lightboxActiveStroke.points.length) {
                lightboxDoodles.push(lightboxActiveStroke);
            }
            lightboxActiveStroke = null;
            paintLightboxDoodles();
        };
        doodleCanvas?.addEventListener('pointerup', endDoodleStroke);
        doodleCanvas?.addEventListener('pointercancel', endDoodleStroke);
        // Re-fit if the viewport resizes while rotated (e.g. window resize).
        window.addEventListener('resize', () => {
            if (!lightboxEl || lightboxEl.classList.contains('is-hidden')) return;
            const rot = normalizeLightboxRotation(lightboxRotation);
            if (rot === 90 || rot === 270) {
                measureLightboxFit();
                applyLightboxTransform();
            }
            // Keep scribbles aligned after layout changes at any rotation.
            paintLightboxDoodles();
        });
        document.addEventListener('keydown', (e) => {
            if (!lightboxEl || lightboxEl.classList.contains('is-hidden')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeMediaLightbox();
                return;
            }
            if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '0') {
                // Reset (0) still clears scribbles — keep that out of pen mode.
                if (lightboxDoodleMode && e.key === '0') return;
                const img = lightboxImg();
                if (!img) return;
                const rect = img.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
                const cx = (rect.left || 0) + (rect.width || 0) / 2;
                const cy = (rect.top || 0) + (rect.height || 0) / 2;
                if (e.key === '0') resetLightboxZoom();
                else zoomLightboxAtPoint(cx, cy, clampLightboxZoom(lightboxZoom * (e.key === '-' ? 0.8 : 1.25)));
                e.preventDefault();
            }
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
    resetLightboxZoom();
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
    resetLightboxZoom();
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
    const section = root.querySelector('[data-note-attachments]');
    if (!section) return;

    bindMediaSectionToggle(section);
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

/**
 * Wire Canvas section toggle + draw/reset controls and paint preview.
 * @param {HTMLElement} root
 * @param {object} item
 */
export function bindNoteCanvas(root, item) {
    if (!root || !item) return;
    const section = root.querySelector('[data-note-canvas]');
    if (!section) return;

    bindCanvasSectionToggle(section, item);
    paintNoteCanvasPreview(section, item);

    if (section.dataset.canvasControlsBound === '1') return;
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
            const body = section.closest('.editor-note-body') || root;
            clearExpandedAttachmentRows(mediaSectionForBody(body));
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
        }
    });
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
        const section = card.querySelector('[data-note-canvas]');
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
