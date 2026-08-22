/** @module {"owns":"media library overlay gallery browser", "related":["mediaLibrary.js","mediaStagingDialog.js","noteQuickActions.js","mediaAttachments.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { ACTION_ICONS, CARD_ICONS } from './icons.js';
import {
    getObjectUrl,
    listMedia,
    removeMedia,
    revokeAllObjectUrls,
    updateMediaMeta,
    MEDIA_LIBRARY_CHANGED
} from './mediaLibrary.js';
import { formatByteSize, humanMetaRows, formatMediaDetailDates } from './mediaMetadata.js';
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
import { buildMediaQuickActionsHtml, bindMediaQuickActions } from './mediaQuickActions.js';
import { buildSidebarNoteListItemHtml } from './sidebarNoteListHtml.js';
import { bindFloatResize, mountFloatChrome } from './desktopFloatChrome.js';
import { raiseDesktopElement } from './desktopStack.js';

const PANEL_STORAGE_KEY = 'matrix_media_lib_panel';
const DEFAULT_W = 720;
const DEFAULT_H = 520;
const MIN_W = 420;
const MIN_H = 320;

let panel = null;
let notePickerOverlay = null;
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

export function isNotePickerOpen() {
    return notePickerOpen;
}

function bringPanelFront() {
    if (!panel) return;
    raiseDesktopElement(panel);
}

function pointerDelta(clientX, clientY, startX, startY) {
    return { dx: clientX - startX, dy: clientY - startY };
}

function bindPanelDrag() {
    const header = panel.querySelector('[data-media-lib-header]');
    const dragHandle = panel.querySelector('[data-media-lib-drag]');
    const dragTargets = [header, dragHandle].filter(Boolean);
    if (!dragTargets.length) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let captureEl = null;

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, textarea, a, .btn')) return;
        if (e.target.closest('.card-act') && !e.target.closest('.media-lib-panel__drag')) return;
        e.preventDefault();
        dragging = true;
        captureEl = e.currentTarget;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = panel.offsetLeft;
        originTop = panel.offsetTop;
        captureEl.setPointerCapture(e.pointerId);
        panel.classList.add('is-dragging');
        bringPanelFront();
    };

    const onPointerMove = (e) => {
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
    };

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove('is-dragging');
        try {
            captureEl?.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        captureEl = null;
        savePanelGeom();
    };

    dragTargets.forEach((el) => {
        el.addEventListener('pointerdown', onPointerDown);
        el.addEventListener('pointermove', onPointerMove);
        el.addEventListener('pointerup', endDrag);
        el.addEventListener('pointercancel', endDrag);
    });
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
        notePickerOverlay = document.getElementById('media-note-picker-overlay');
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
            if (notePickerOpen) {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                this.closeNotePicker();
                return;
            }
            if (!this.isOpen()) return;
            if (isMediaStagingOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
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

        notePickerOverlay?.addEventListener('click', (e) => {
            if (e.target === notePickerOverlay) {
                this.closeNotePicker();
            }
        });
    },

    renderChrome() {
        const header = panel.querySelector('[data-media-lib-header]');
        const footer = panel.querySelector('[data-media-lib-footer]');
        const closeBtn = panel.querySelector('[data-media-lib-close]');
        if (!header) return;

        header.innerHTML = `<h2 class="media-lib-panel__title" data-media-lib-title>Media library</h2>`;

        const dragHandle = panel.querySelector('[data-media-lib-drag]');
        if (dragHandle && !dragHandle.innerHTML.trim()) {
            dragHandle.innerHTML = CARD_ICONS.drag;
        }

        if (footer) {
            footer.innerHTML = `
                <button type="button" class="btn btn--compact btn--icon" data-media-lib-upload title="Upload files" aria-label="Upload files">${ACTION_ICONS.upload}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-lib-select-note title="Select note to attach" aria-label="Select note to attach">${ACTION_ICONS.selectNote}</button>
                <button type="button" class="btn btn--compact btn--icon is-hidden" data-media-lib-attach title="Attach selected media to note" aria-label="Attach to note" disabled>${CARD_ICONS.attach}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-export-meta title="Export media metadata" aria-label="Export media metadata">${ACTION_ICONS.export}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-export-zip title="Export media ZIP" aria-label="Export media ZIP">${ACTION_ICONS.cloudExport}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-import-meta title="Import media metadata" aria-label="Import media metadata">${ACTION_ICONS.import}</button>
                <button type="button" class="btn btn--compact btn--icon" data-media-import-zip title="Import media ZIP" aria-label="Import media ZIP">${ACTION_ICONS.cloudImport}</button>
            `;
        }

        if (closeBtn && !closeBtn.innerHTML.trim()) {
            closeBtn.innerHTML = CARD_ICONS.close;
        }
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
        let clearedAttach = false;
        if (attachNoteId && !liveItem(attachNoteId)) {
            attachNoteId = null;
            clearedAttach = true;
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
                    this.rerenderDetailIfSelected();
                });
            } else {
                chip.classList.add('is-hidden');
                chip.innerHTML = '';
            }
        }
        if (attachBtn) {
            if (target) {
                attachBtn.classList.remove('is-hidden');
                attachBtn.disabled = !selectedId;
            } else {
                attachBtn.classList.add('is-hidden');
                attachBtn.disabled = true;
            }
        }
        if (clearedAttach) {
            void this.rerenderDetailIfSelected();
        }
    },

    async rerenderDetailIfSelected() {
        if (!selectedId) return;
        const items = await listMedia();
        const item = items.find((i) => i.id === selectedId);
        if (item) await this.renderDetail(item);
    },

    toggleNotePicker() {
        if (notePickerOpen) {
            this.closeNotePicker();
            return;
        }
        this.openNotePicker();
    },

    openNotePicker() {
        const body = notePickerOverlay?.querySelector('[data-media-note-picker-body]');
        if (!body || !notePickerOverlay) return;
        notePickerOpen = true;
        notePickerOverlay.classList.remove('is-hidden');
        notePickerOverlay.classList.add('is-open');
        const notes = notesForAttachPicker(getItems?.() || []);
        if (!notes.length) {
            body.innerHTML = `<div class="media-lib-note-picker">
                <div class="media-lib-note-picker__head">
                    <span>Select note</span>
                    <button type="button" class="card-act" data-media-picker-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
                </div>
                <div class="sidebar-notes-list-empty">No active notes</div>
            </div>`;
        } else {
            const rows = notes.map((item) => buildSidebarNoteListItemHtml(item, {
                selected: item.id === attachNoteId,
                extraClass: ' media-lib-note-picker__item'
            })).join('');
            body.innerHTML = `
                <div class="media-lib-note-picker">
                    <div class="media-lib-note-picker__head">
                        <span>Select note</span>
                        <button type="button" class="card-act" data-media-picker-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
                    </div>
                    <div class="media-lib-note-picker__list sidebar-notes-list">${rows}</div>
                </div>
            `;
            body.querySelectorAll('[data-id]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    attachNoteId = btn.dataset.id;
                    this.closeNotePicker();
                    this.syncAttachControls();
                    this.rerenderDetailIfSelected();
                    showAppToast(`Attach target: ${noteDisplayTitle(liveItem(attachNoteId))}`);
                });
            });
        }
        body.querySelector('[data-media-picker-close]')?.addEventListener('click', () => {
            this.closeNotePicker();
        });
    },

    closeNotePicker() {
        notePickerOpen = false;
        if (!notePickerOverlay) return;
        notePickerOverlay.classList.remove('is-open');
        notePickerOverlay.classList.add('is-hidden');
        const body = notePickerOverlay.querySelector('[data-media-note-picker-body]');
        if (body) body.innerHTML = '';
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
        const titleEl = panel.querySelector('[data-media-lib-title]');
        if (titleEl) {
            titleEl.textContent = items.length
                ? `Media library (${items.length})`
                : 'Media library';
        }

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
            const alreadyOnTarget = attachNoteId
                && normalizeAttachments(liveItem(attachNoteId)?.attachments).some((a) => a.mediaId === item.id);
            const actions = buildMediaQuickActionsHtml({
                mediaId: item.id,
                context: 'library-tile',
                attachNoteId,
                alreadyAttached: !!alreadyOnTarget,
                blobMissing: !!item.blobMissing
            });
            return `
                <div class="media-lib-tile${selected}${missing}" data-media-id="${escapeAttr(item.id)}" title="${escapeAttr(item.title || item.filename)}">
                    <div class="media-lib-tile__preview-wrap">
                        <button type="button" class="media-lib-tile__select" data-media-select title="Select">
                            <span class="media-lib-tile__preview">${preview}</span>
                        </button>
                        ${actions}
                    </div>
                    ${item.blobMissing ? '<span class="media-lib-tile__badge">Missing</span>' : ''}
                    ${linked.length ? `<span class="media-lib-tile__badge media-lib-tile__badge--attach">${linked.length}</span>` : ''}
                </div>
            `;
        }));

        if (grid) {
            grid.innerHTML = tiles.join('');
            grid.querySelectorAll('[data-media-select]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const tile = btn.closest('[data-media-id]');
                    if (!tile) return;
                    selectedId = tile.dataset.mediaId;
                    this.refresh();
                });
            });
            grid.querySelectorAll('.media-lib-tile__preview-wrap').forEach((wrap) => {
                const tile = wrap.closest('[data-media-id]');
                const mediaId = tile?.dataset.mediaId;
                if (!mediaId) return;
                bindMediaQuickActions(wrap, {
                    context: 'library-tile',
                    attachNoteId,
                    onAttach: (id) => {
                        selectedId = id;
                        this.attachSelectedToNote();
                    },
                    onRemove: async (id) => {
                        if (!confirm('Remove this item from the media library?')) return;
                        await removeMedia(id);
                        if (selectedId === id) selectedId = null;
                        showAppToast('Removed');
                        this.refresh();
                    }
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

        const rows = humanMetaRows(item)
            .filter((r) => r.label !== 'Added' && r.label !== 'Modified')
            .map((r) => (
                `<div class="media-lib-detail__row"><dt>${escapeHTML(r.label)}</dt><dd>${escapeHTML(r.value)}</dd></div>`
            )).join('');

        const linkedNotes = findNotesForMedia(getItems?.() || [], item.id);
        const linkedHtml = linkedNotes.length
            ? `<div class="media-lib-detail__links">
                <div class="media-lib-detail__links-title">Attached to</div>
                <div class="sidebar-notes-list media-lib-detail__attached-list">
                    ${linkedNotes.map((n) => buildSidebarNoteListItemHtml(n, {
                        variant: 'with-act',
                        dataIdAttr: 'data-open-note',
                        trailingActionHtml: `<button type="button" class="card-act" data-detach-note="${escapeAttr(n.id)}" title="Detach from note" aria-label="Detach">${CARD_ICONS.close}</button>`
                    })).join('')}
                </div>
               </div>`
            : '<p class="media-lib-detail__links-empty">Not attached to any note</p>';

        const alreadyOnTarget = attachNoteId
            && normalizeAttachments(liveItem(attachNoteId)?.attachments).some((a) => a.mediaId === item.id);

        const quickActions = buildMediaQuickActionsHtml({
            mediaId: item.id,
            context: 'library-detail',
            attachNoteId,
            alreadyAttached: !!alreadyOnTarget,
            blobMissing: !!item.blobMissing,
            showSave: true,
            saveHidden: true
        });

        const { added, modified } = formatMediaDetailDates(item);
        const dateLineHtml = added
            ? `<dl class="media-lib-detail__dates">
                <div class="media-lib-detail__date-row"><dt>Added</dt><dd>${escapeHTML(added)}</dd></div>
                <div class="media-lib-detail__date-row"><dt>Modified</dt><dd>${escapeHTML(modified || added)}</dd></div>
               </dl>`
            : '';

        detail.innerHTML = `
            <div class="media-lib-detail__preview" data-media-detail-preview>
                ${previewHtml}
                <div class="media-lib-detail__preview-actions">
                    ${quickActions}
                </div>
            </div>
            ${dateLineHtml}
            <label class="media-staging__label">Title
                <input type="text" class="media-staging__input" data-detail-title value="${escapeAttr(item.title || '')}">
            </label>
            <label class="media-staging__label">Description
                <textarea class="media-staging__input media-staging__textarea" data-detail-desc rows="2">${escapeHTML(item.description || '')}</textarea>
            </label>
            ${linkedHtml}
            <dl class="media-lib-detail__meta">${rows}</dl>
        `;

        const previewActions = detail.querySelector('.media-lib-detail__preview-actions');
        let savedTitle = item.title || '';
        let savedDesc = item.description || '';
        const syncSaveBtn = () => {
            const title = detail.querySelector('[data-detail-title]')?.value ?? '';
            const desc = detail.querySelector('[data-detail-desc]')?.value ?? '';
            const dirty = title !== savedTitle || desc !== savedDesc;
            detail.querySelector('[data-media-action-save]')?.classList.toggle('is-hidden', !dirty);
        };

        bindMediaQuickActions(previewActions, {
            context: 'library-detail',
            attachNoteId,
            onAttach: () => this.attachSelectedToNote(),
            onSave: async () => {
                const title = detail.querySelector('[data-detail-title]')?.value || '';
                const description = detail.querySelector('[data-detail-desc]')?.value || '';
                if (title === savedTitle && description === savedDesc) return;
                await updateMediaMeta(item.id, { title, description });
                savedTitle = title;
                savedDesc = description;
                item.title = title;
                item.description = description;
                showAppToast('Saved');
                syncSaveBtn();
                const tile = panel.querySelector(`.media-lib-tile[data-media-id="${CSS.escape(item.id)}"]`);
                if (tile) {
                    tile.title = title || item.filename || 'Untitled';
                }
            },
            onRemove: async () => {
                if (!confirm('Remove this item from the media library?')) return;
                await removeMedia(item.id);
                selectedId = null;
                showAppToast('Removed');
                this.refresh();
            }
        });

        detail.querySelector('[data-detail-title]')?.addEventListener('input', syncSaveBtn);
        detail.querySelector('[data-detail-desc]')?.addEventListener('input', syncSaveBtn);
        syncSaveBtn();

        detail.querySelectorAll('[data-open-note]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const note = liveItem(btn.dataset.openNote);
                if (note) {
                    window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: note }));
                }
            });
        });

        detail.querySelectorAll('[data-detach-note]').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
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
