/** @module {"owns":"media library overlay gallery browser", "related":["mediaLibrary.js","mediaStagingDialog.js","sidebarMediaLibrary.js","mediaAttachments.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import {
    getMediaRecord,
    getObjectUrl,
    listMedia,
    removeMedia,
    revokeAllObjectUrls,
    updateMediaMeta,
    MEDIA_LIBRARY_CHANGED
} from './mediaLibrary.js';
import { formatByteSize, humanMetaRows } from './mediaMetadata.js';
import { isMediaStagingOpen, openMediaStaging } from './mediaStagingDialog.js';
import { filesFromDataTransfer } from './mediaPasteCatcher.js';
import { showAppToast } from './toast.js';
import {
    downloadMediaMetaJson,
    downloadMediaZip,
    importMediaMetaJsonFile,
    importMediaZipFile
} from './mediaBackup.js';
import {
    attachMediaToNote,
    detachMediaFromNote,
    findNotesForMedia,
    noteDisplayTitle,
    notesForAttachPicker,
    normalizeAttachments
} from './mediaAttachments.js';
import { resolveNoteColor } from './colorPicker.js';
import { NoteSurface } from './noteSurface.js';
import { stripRichText, hasRichMarkup } from './richText.js';
import { bindFloatResize, mountFloatChrome } from './desktopFloatChrome.js';

const PANEL_STORAGE_KEY = 'matrix_media_lib_panel';
const DEFAULT_W = 720;
const DEFAULT_H = 520;
const MIN_W = 420;
const MIN_H = 320;

let panel = null;
let selectedId = null;
let attachNoteId = null;
let notePickerOpen = false;
/** @type {Map<string, string>} */
let thumbUrls = new Map();
/** @type {null | (() => object[])} */
let getItems = null;
let floatChromeBound = false;

function liveItem(id) {
    if (!id || !getItems) return null;
    return (getItems() || []).find((it) => it.id === id) || null;
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function loadPanelGeom() {
    try {
        return JSON.parse(localStorage.getItem(PANEL_STORAGE_KEY) || 'null') || {};
    } catch {
        return {};
    }
}

function savePanelGeom(patch = {}) {
    if (!panel) return;
    const next = {
        ...loadPanelGeom(),
        x: panel.offsetLeft,
        y: panel.offsetTop,
        w: panel.offsetWidth,
        h: panel.offsetHeight,
        ...patch
    };
    try {
        localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify(next));
    } catch {
        /* ignore quota */
    }
}

function viewportBounds() {
    return {
        left: 8,
        top: 8,
        right: window.innerWidth - 8,
        bottom: window.innerHeight - 8
    };
}

function clampPanelPos(x, y, w, h) {
    const b = viewportBounds();
    return {
        x: clamp(x, b.left, Math.max(b.left, b.right - w)),
        y: clamp(y, b.top, Math.max(b.top, b.bottom - h))
    };
}

function applySavedGeometry() {
    if (!panel) return;
    const saved = loadPanelGeom();
    const w = Number.isFinite(saved.w) ? saved.w : DEFAULT_W;
    const h = Number.isFinite(saved.h) ? saved.h : DEFAULT_H;
    const width = clamp(w, MIN_W, window.innerWidth - 16);
    const height = clamp(h, MIN_H, window.innerHeight - 16);
    const fallbackX = Math.max(16, (window.innerWidth - width) / 2);
    const fallbackY = Math.max(16, (window.innerHeight - height) / 5);
    const pos = clampPanelPos(
        Number.isFinite(saved.x) ? saved.x : fallbackX,
        Number.isFinite(saved.y) ? saved.y : fallbackY,
        width,
        height
    );
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.left = `${pos.x}px`;
    panel.style.top = `${pos.y}px`;
}

function bringPanelFront() {
    if (!panel) return;
    panel.style.zIndex = String(1100 + (Date.now() % 1000));
}

function pointerDelta(clientX, clientY, startX, startY) {
    return { dx: clientX - startX, dy: clientY - startY };
}

function bindPanelDrag() {
    const header = panel.querySelector('[data-media-lib-header]');
    if (!header) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    header.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, textarea, a, .btn, .card-act')) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = panel.offsetLeft;
        originTop = panel.offsetTop;
        header.setPointerCapture(e.pointerId);
        panel.classList.add('is-dragging');
        bringPanelFront();
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const { dx, dy } = pointerDelta(e.clientX, e.clientY, startX, startY);
        const pos = clampPanelPos(
            originLeft + dx,
            originTop + dy,
            panel.offsetWidth,
            panel.offsetHeight
        );
        panel.style.left = `${pos.x}px`;
        panel.style.top = `${pos.y}px`;
    });

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove('is-dragging');
        try {
            header.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        savePanelGeom();
    };
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
}

function setupFloatingChrome() {
    if (!panel || floatChromeBound) return;
    mountFloatChrome(panel, { resizable: true, mode: 'tool' });
    bindFloatResize(panel, {
        mins: { w: MIN_W, h: MIN_H },
        getBounds: viewportBounds,
        pointerDelta,
        clampPosition: (el, x, y) => clampPanelPos(x, y, el.offsetWidth, el.offsetHeight),
        onEnd: () => savePanelGeom(),
        onBringToFront: bringPanelFront
    });
    bindPanelDrag();
    panel.addEventListener('pointerdown', () => bringPanelFront());
    floatChromeBound = true;
}

export const MediaLibraryOverlay = {
    init(opts = {}) {
        panel = document.getElementById('media-library-panel')
            || document.getElementById('media-library-overlay');
        if (!panel) return;
        getItems = typeof opts.getItems === 'function' ? opts.getItems : () => [];

        // Migrate old overlay wrapper markup if still present
        if (panel.id === 'media-library-overlay' && panel.classList.contains('overlay')) {
            const inner = panel.querySelector('.media-lib-panel');
            if (inner) {
                while (inner.firstChild) panel.appendChild(inner.firstChild);
                inner.remove();
            }
            panel.id = 'media-library-panel';
            panel.className = 'media-lib-panel is-hidden';
            panel.removeAttribute('aria-modal');
        }

        applySavedGeometry();
        this.renderChrome();
        this.bindChrome();
        setupFloatingChrome();

        const dropZone = panel.querySelector('[data-media-lib-drop]');
        if (dropZone) {
            ['dragenter', 'dragover'].forEach((type) => {
                dropZone.addEventListener(type, (e) => {
                    e.preventDefault();
                    dropZone.classList.add('is-dragover');
                });
            });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('is-dragover'));
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('is-dragover');
                const files = filesFromDataTransfer(e.dataTransfer);
                if (files.length) openMediaStaging(files, { source: 'upload' });
            });
        }

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.isOpen()) return;
            if (isMediaStagingOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            if (notePickerOpen) {
                this.closeNotePicker();
                return;
            }
            this.close();
        }, true);

        window.addEventListener(MEDIA_LIBRARY_CHANGED, () => {
            if (this.isOpen()) this.refresh();
        });

        window.addEventListener('resize', () => {
            if (!panel || panel.classList.contains('is-hidden')) return;
            const pos = clampPanelPos(
                panel.offsetLeft,
                panel.offsetTop,
                panel.offsetWidth,
                panel.offsetHeight
            );
            panel.style.left = `${pos.x}px`;
            panel.style.top = `${pos.y}px`;
        });
    },

    renderChrome() {
        const header = panel.querySelector('[data-media-lib-header]');
        if (!header) return;
        header.innerHTML = `
            <span class="media-lib-panel__drag" title="Drag to move" aria-hidden="true">⋮⋮</span>
            <h2 class="media-lib-panel__title">Media library</h2>
            <span data-media-lib-count class="sidebar-media-lib__compact">0</span>
            <div class="media-lib-panel__toolbar">
                <button type="button" class="btn btn--compact btn--icon" data-media-lib-upload title="Upload files" aria-label="Upload files">${ACTION_ICONS.upload}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-lib-select-note title="Select note to attach" aria-label="Select note to attach">${ACTION_ICONS.selectNote}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-lib-attach title="Attach selected media to note" aria-label="Attach to note" disabled>${CARD_ICONS.attach}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-export-meta title="Export media metadata" aria-label="Export media metadata">${ACTION_ICONS.export}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-export-zip title="Export media ZIP" aria-label="Export media ZIP">${ACTION_ICONS.cloudExport}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-import-meta title="Import media metadata" aria-label="Import media metadata">${ACTION_ICONS.import}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-import-zip title="Import media ZIP" aria-label="Import media ZIP">${ACTION_ICONS.cloudImport}</button>
            </div>
            <button type="button" class="card-act media-lib-panel__close" data-media-lib-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
        `;
    },

    bindChrome() {
        panel.querySelector('[data-media-lib-close]')?.addEventListener('click', () => this.close());
        panel.querySelector('[data-media-lib-upload]')?.addEventListener('click', () => {
            document.getElementById('media-library-file-picker')?.click();
        });
        panel.querySelector('[data-media-lib-select-note]')?.addEventListener('click', () => {
            this.toggleNotePicker();
        });
        panel.querySelector('[data-media-lib-attach]')?.addEventListener('click', () => {
            this.attachSelectedToNote();
        });
        panel.querySelector('[data-media-export-meta]')?.addEventListener('click', () => {
            downloadMediaMetaJson().catch((err) => showAppToast(err?.message || 'Export failed'));
        });
        panel.querySelector('[data-media-export-zip]')?.addEventListener('click', () => {
            downloadMediaZip().catch((err) => showAppToast(err?.message || 'Export failed'));
        });
        panel.querySelector('[data-media-import-meta]')?.addEventListener('click', () => {
            document.getElementById('media-meta-import-picker')?.click();
        });
        panel.querySelector('[data-media-import-zip]')?.addEventListener('click', () => {
            document.getElementById('media-zip-import-picker')?.click();
        });
    },

    isOpen() {
        return !!(panel && !panel.classList.contains('is-hidden'));
    },

    /**
     * @param {{ attachNoteId?: string|null, selectMediaId?: string|null }} [opts]
     */
    async open(opts = {}) {
        if (!panel) return;
        if (opts.attachNoteId) {
            attachNoteId = opts.attachNoteId;
        }
        if (opts.selectMediaId) {
            selectedId = opts.selectMediaId;
        }
        notePickerOpen = false;
        applySavedGeometry();
        panel.classList.remove('is-hidden');
        panel.classList.add('is-open');
        bringPanelFront();
        await this.refresh();
    },

    close() {
        if (!panel) return;
        savePanelGeom();
        panel.classList.remove('is-open');
        panel.classList.add('is-hidden');
        selectedId = null;
        attachNoteId = null;
        notePickerOpen = false;
        thumbUrls.clear();
        revokeAllObjectUrls();
        this.closeNotePicker();
    },

    syncAttachControls() {
        const chip = panel?.querySelector('[data-media-attach-chip]');
        const attachBtn = panel?.querySelector('[data-media-lib-attach]');
        if (attachNoteId && !liveItem(attachNoteId)) {
            attachNoteId = null;
        }
        const target = liveItem(attachNoteId);
        if (chip) {
            if (target) {
                const title = noteDisplayTitle(target);
                chip.classList.remove('is-hidden');
                chip.innerHTML = `
                    <span class="media-lib-attach-chip__label">Attach to</span>
                    <span class="media-lib-attach-chip__title">${escapeHTML(title)}</span>
                    <button type="button" class="card-act media-lib-attach-chip__clear" data-media-attach-clear title="Clear note" aria-label="Clear note">${CARD_ICONS.close}</button>
                `;
                chip.querySelector('[data-media-attach-clear]')?.addEventListener('click', () => {
                    attachNoteId = null;
                    this.syncAttachControls();
                });
            } else {
                chip.classList.add('is-hidden');
                chip.innerHTML = '';
            }
        }
        if (attachBtn) {
            attachBtn.disabled = !(target && selectedId);
        }
    },

    toggleNotePicker() {
        if (notePickerOpen) {
            this.closeNotePicker();
            return;
        }
        this.openNotePicker();
    },

    openNotePicker() {
        const picker = panel?.querySelector('[data-media-note-picker]');
        if (!picker) return;
        notePickerOpen = true;
        picker.classList.remove('is-hidden');
        const notes = notesForAttachPicker(getItems?.() || []);
        if (!notes.length) {
            picker.innerHTML = `<div class="media-lib-note-picker__head">
                <span>Select note</span>
                <button type="button" class="card-act" data-media-picker-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            </div>
            <div class="sidebar-notes-list-empty">No active notes</div>`;
        } else {
            const rows = notes.map((item) => {
                const accent = resolveNoteColor(item.backgroundColor);
                const plainTitle = stripRichText(item.title || '') || 'Untitled';
                const titleRich = hasRichMarkup(item.title);
                const titleHtml = titleRich
                    ? NoteSurface.renderRichHtml(item.title || '')
                    : escapeHTML(plainTitle);
                const dateLabel = NoteSurface.formatNoteListDate(item);
                const selected = item.id === attachNoteId ? ' is-selected' : '';
                return `
                <button type="button" class="sidebar-notes-list-item has-note-color media-lib-note-picker__item${selected}" data-id="${escapeAttr(item.id)}" title="${escapeAttr(plainTitle)}" style="--note-accent:${escapeAttr(accent)}">
                    <span class="sidebar-notes-list-item-title${titleRich ? ' rich-text' : ''}">${titleHtml}</span>
                    <span class="sidebar-notes-list-date">${escapeHTML(dateLabel)}</span>
                </button>`;
            }).join('');
            picker.innerHTML = `
                <div class="media-lib-note-picker__head">
                    <span>Select note</span>
                    <button type="button" class="card-act" data-media-picker-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
                </div>
                <div class="media-lib-note-picker__list sidebar-notes-list">${rows}</div>
            `;
            picker.querySelectorAll('[data-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    attachNoteId = btn.dataset.id;
                    this.closeNotePicker();
                    this.syncAttachControls();
                    showAppToast(`Attach target: ${noteDisplayTitle(liveItem(attachNoteId))}`);
                });
            });
        }
        picker.querySelector('[data-media-picker-close]')?.addEventListener('click', () => {
            this.closeNotePicker();
        });
    },

    closeNotePicker() {
        notePickerOpen = false;
        const picker = panel?.querySelector('[data-media-note-picker]');
        if (picker) {
            picker.classList.add('is-hidden');
            picker.innerHTML = '';
        }
    },

    attachSelectedToNote() {
        const note = liveItem(attachNoteId);
        if (!note) {
            showAppToast('Select a note first');
            this.openNotePicker();
            return;
        }
        if (!selectedId) {
            showAppToast('Select a media item');
            return;
        }
        if (!localStorage.getItem('admin_token')) {
            showAppToast('Login required to attach media');
            return;
        }
        const added = attachMediaToNote(note, selectedId);
        if (added) {
            showAppToast(`Attached to ${noteDisplayTitle(note)}`);
        } else {
            showAppToast('Already attached to this note');
        }
        this.syncAttachControls();
        this.refresh();
    },

    async refresh() {
        if (!panel) return;
        this.syncAttachControls();
        const items = await listMedia();
        const grid = panel.querySelector('[data-media-lib-grid]');
        const empty = panel.querySelector('[data-media-lib-empty]');
        const countEl = panel.querySelector('[data-media-lib-count]');
        if (countEl) countEl.textContent = String(items.length);

        if (!items.length) {
            if (grid) grid.innerHTML = '';
            empty?.classList.remove('is-hidden');
            this.renderDetail(null);
            return;
        }
        empty?.classList.add('is-hidden');

        if (!selectedId || !items.some((i) => i.id === selectedId)) {
            selectedId = items[0].id;
        }
        this.syncAttachControls();

        const tiles = await Promise.all(items.map(async (item) => {
            let thumbSrc = '';
            if (!item.blobMissing && String(item.mime || '').startsWith('image/')) {
                const url = await getObjectUrl(item.id, 'thumb');
                if (url) {
                    thumbUrls.set(item.id, url);
                    thumbSrc = url;
                }
            }
            const missing = item.blobMissing ? ' media-lib-tile--missing' : '';
            const selected = item.id === selectedId ? ' is-selected' : '';
            const linked = findNotesForMedia(getItems?.() || [], item.id);
            const preview = thumbSrc
                ? `<img src="${escapeAttr(thumbSrc)}" alt="">`
                : `<span class="media-lib-tile__icon">${escapeHTML((item.mime || 'file').split('/').pop() || 'file')}</span>`;
            return `
                <button type="button" class="media-lib-tile${selected}${missing}" data-media-id="${escapeAttr(item.id)}" title="${escapeAttr(item.title || item.filename)}">
                    <span class="media-lib-tile__preview">${preview}</span>
                    <span class="media-lib-tile__label">${escapeHTML(item.title || item.filename || 'Untitled')}</span>
                    ${item.blobMissing ? '<span class="media-lib-tile__badge">Missing</span>' : ''}
                    ${linked.length ? `<span class="media-lib-tile__badge media-lib-tile__badge--attach">${linked.length}</span>` : ''}
                </button>
            `;
        }));

        if (grid) {
            grid.innerHTML = tiles.join('');
            grid.querySelectorAll('[data-media-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    selectedId = btn.dataset.mediaId;
                    this.refresh();
                });
            });
        }

        const selected = items.find((i) => i.id === selectedId) || null;
        await this.renderDetail(selected);
    },

    async renderDetail(item) {
        const detail = panel?.querySelector('[data-media-lib-detail]');
        if (!detail) return;
        if (!item) {
            detail.innerHTML = '<p class="media-lib-detail__empty">Select an item</p>';
            return;
        }

        let previewHtml = '';
        if (!item.blobMissing && String(item.mime || '').startsWith('image/')) {
            const url = await getObjectUrl(item.id, 'blob');
            if (url) previewHtml = `<img class="media-lib-detail__img" src="${escapeAttr(url)}" alt="">`;
        } else if (item.blobMissing) {
            previewHtml = '<p class="media-lib-detail__missing">File bytes missing — re-import media ZIP or re-upload.</p>';
        } else {
            previewHtml = `<p class="media-lib-detail__file">${escapeHTML(item.mime)} · ${escapeHTML(formatByteSize(item.byteSize))}</p>`;
        }

        const rows = humanMetaRows(item).map((r) => (
            `<div class="media-lib-detail__row"><dt>${escapeHTML(r.label)}</dt><dd>${escapeHTML(r.value)}</dd></div>`
        )).join('');

        const linkedNotes = findNotesForMedia(getItems?.() || [], item.id);
        const linkedHtml = linkedNotes.length
            ? `<div class="media-lib-detail__links">
                <div class="media-lib-detail__links-title">Attached to</div>
                ${linkedNotes.map((n) => `<div class="media-lib-detail__link-row">
                        <span>${escapeHTML(noteDisplayTitle(n))}</span>
                        <button type="button" class="btn btn--compact btn--icon" data-detach-note="${escapeAttr(n.id)}" title="Detach from note" aria-label="Detach">${CARD_ICONS.close}</button>
                    </div>`).join('')}
               </div>`
            : '<p class="media-lib-detail__links-empty">Not attached to any note</p>';

        const alreadyOnTarget = attachNoteId
            && normalizeAttachments(liveItem(attachNoteId)?.attachments).some((a) => a.mediaId === item.id);

        detail.innerHTML = `
            <div class="media-lib-detail__preview">${previewHtml}</div>
            <label class="media-staging__label">Title
                <input type="text" class="media-staging__input" data-detail-title value="${escapeAttr(item.title || '')}">
            </label>
            <label class="media-staging__label">Description
                <textarea class="media-staging__input media-staging__textarea" data-detail-desc rows="2">${escapeHTML(item.description || '')}</textarea>
            </label>
            <div class="media-lib-detail__actions">
                <button type="button" class="btn btn--compact btn--icon" data-detail-save title="Save" aria-label="Save">${CARD_ICONS.save}</button>
                <button type="button" class="btn btn--compact btn--icon" data-detail-download title="Download" aria-label="Download" ${item.blobMissing ? 'disabled' : ''}>${ACTION_ICONS.export}</button>
                <button type="button" class="btn btn--compact btn--icon" data-detail-attach title="Attach to selected note" aria-label="Attach" ${!attachNoteId || alreadyOnTarget ? 'disabled' : ''}>${CARD_ICONS.attach}</button>
                <button type="button" class="btn btn--compact btn--icon btn--danger" data-detail-delete title="Delete from library" aria-label="Delete">${CARD_ICONS.delete}</button>
            </div>
            ${linkedHtml}
            <dl class="media-lib-detail__meta">${rows}</dl>
        `;

        detail.querySelector('[data-detail-save]')?.addEventListener('click', async () => {
            const title = detail.querySelector('[data-detail-title]')?.value || '';
            const description = detail.querySelector('[data-detail-desc]')?.value || '';
            await updateMediaMeta(item.id, { title, description });
            showAppToast('Saved');
            this.refresh();
        });

        detail.querySelector('[data-detail-download]')?.addEventListener('click', async () => {
            const record = await getMediaRecord(item.id);
            if (!record?.blob) {
                showAppToast('File missing');
                return;
            }
            const url = URL.createObjectURL(record.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = record.filename || 'download';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
        });

        detail.querySelector('[data-detail-attach]')?.addEventListener('click', () => {
            this.attachSelectedToNote();
        });

        detail.querySelector('[data-detail-delete]')?.addEventListener('click', async () => {
            if (!confirm('Remove this item from the media library?')) return;
            await removeMedia(item.id);
            selectedId = null;
            showAppToast('Removed');
            this.refresh();
        });

        detail.querySelectorAll('[data-detach-note]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const note = liveItem(btn.dataset.detachNote);
                if (!note) return;
                if (detachMediaFromNote(note, item.id)) {
                    showAppToast(`Detached from ${noteDisplayTitle(note)}`);
                    this.refresh();
                }
            });
        });
    }
};

export function bindMediaFilePickers() {
    const filePicker = document.getElementById('media-library-file-picker');
    filePicker?.addEventListener('change', () => {
        const files = Array.from(filePicker.files || []);
        filePicker.value = '';
        if (files.length) openMediaStaging(files, { source: 'upload' });
    });

    const metaPicker = document.getElementById('media-meta-import-picker');
    metaPicker?.addEventListener('change', async () => {
        const file = metaPicker.files?.[0];
        metaPicker.value = '';
        if (!file) return;
        try {
            const n = await importMediaMetaJsonFile(file);
            showAppToast(n ? `Imported metadata for ${n} items` : 'No media metadata in file');
            if (MediaLibraryOverlay.isOpen()) MediaLibraryOverlay.refresh();
        } catch (err) {
            showAppToast(err?.message || 'Import failed');
        }
    });

    const zipPicker = document.getElementById('media-zip-import-picker');
    zipPicker?.addEventListener('change', async () => {
        const file = zipPicker.files?.[0];
        zipPicker.value = '';
        if (!file) return;
        try {
            const n = await importMediaZipFile(file);
            showAppToast(n ? `Imported ${n} media items` : 'No media in archive');
            if (MediaLibraryOverlay.isOpen()) MediaLibraryOverlay.refresh();
        } catch (err) {
            showAppToast(err?.message || 'Import failed');
        }
    });
}
