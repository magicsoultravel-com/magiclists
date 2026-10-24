/** @module {"owns":"note card Canvas section HTML, live DOM sync, and canvas image membership", "related":["noteAttachmentsUi.js","noteAttachmentsUi/shared.js","noteCanvasRenderer.js","noteModel.js","canvasImages.js","noteSurfaceMutations.js","noteFocusSpawn.js","icons.js"]} */
import { CARD_ICONS } from '../icons.js';
import { normalizeAttachments } from '../mediaAttachments.js';
import { refreshNoteCanvasPreview } from '../noteCanvasRenderer.js';
import { createEmptyNoteCanvas } from '../noteModel.js';
import { initialImageSize } from '../canvasImages.js';
import { mutateItem } from '../noteSurfaceMutations.js';
import { renderFocusSpawnTrayHtml } from '../noteFocusSpawn.js';
import { showAppToast } from '../toast.js';
import {
    noteBodiesForItem,
    canvasSectionForBody,
    mediaSectionForBody,
    insertCanvasHtml,
    clearExpandedAttachmentRows
} from './shared.js';

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

export function imageIsInNoteCanvas(item, mediaId) {
    return getNoteCanvasImages(item).some((img) => img.mediaId === mediaId);
}

export function removeMediaImageFromNoteCanvas(item, mediaId) {
    const images = getNoteCanvasImages(item);
    const next = images.filter((img) => img.mediaId !== mediaId);
    if (next.length !== images.length) {
        setNoteCanvasImages(item, next);
    }
}

export async function addMediaImageToNoteCanvas(item, mediaId) {
    ensureNoteCanvas(item);
    const images = getNoteCanvasImages(item);
    if (images.some((img) => img.mediaId === mediaId)) return null;

    const img = await (await import('../canvasImages.js')).loadImage(mediaId);
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
                    ${renderFocusSpawnTrayHtml('canvas', 'Canvas')}
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

/**
 * Upsert/remove the independent Canvas section and paint when visible.
 * @param {object} item
 */
export function syncNoteCanvasDom(item) {
    if (!item?.id) return;

    for (const body of noteBodiesForItem(item.id)) {
        // Focus canvas panes host live DrawingBoard — don't inject preview sections.
        if (body.closest?.('#magic-focus')) continue;
        const startCollapsed = !!item.canvasCollapsed;
        const html = buildNoteCanvasSectionHtml(item, { startCollapsed });
        const existing = canvasSectionForBody(body);

        if (!html) {
            existing?.remove();
            continue;
        }

        if (existing) {
            existing.outerHTML = html;
        } else {
            insertCanvasHtml(body, html);
        }

        const section = canvasSectionForBody(body);
        bindNoteCanvas(body, item);
        if (section && noteHasVisibleCanvas(item) && !item.canvasCollapsed) {
            sizeCanvasViewport(section);
            paintNoteCanvasPreview(section, item);
        }
    }
}

function bindCanvasSectionToggle(section, item) {
    const header = section?.querySelector('.note-section-header');
    if (!header || header.dataset.bound === '1') return;
    header.dataset.bound = '1';
    header.addEventListener('click', (e) => {
        // Let Focus-spawn bubble to bindFocusSpawnButtons (do not stopPropagation).
        if (e.target.closest?.('[data-focus-spawn]')) return;
        e.stopPropagation();
        const bodyEl = header.nextElementSibling;
        const toggle = header.querySelector('.collapsable-toggle');
        const nextCollapsed = !item?.canvasCollapsed;
        if (item) {
            mutateItem(item, (it) => {
                it.canvasCollapsed = nextCollapsed;
            }, { preserveView: true, skipRerender: true });
        }
        bodyEl?.classList.toggle('collapsed', nextCollapsed);
        toggle?.classList.toggle('collapsed', nextCollapsed);
        if (!nextCollapsed) {
            sizeCanvasViewport(section);
            paintNoteCanvasPreview(section, item);
        }
    });
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
    if (!item.canvasCollapsed) {
        paintNoteCanvasPreview(section, item);
    }

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
