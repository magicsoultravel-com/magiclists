/** @module {"owns":"media library overlay gallery browser", "related":["mediaLibrary.js","mediaStagingDialog.js","noteQuickActions.js","mediaAttachments.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
import { ACTION_ICONS, CARD_ICONS, FORMAT_ICONS } from './icons.js';
import {
    getObjectUrl,
    listMedia,
    releaseObjectUrl,
    removeMedia,
    updateMediaMeta,
    MEDIA_LIBRARY_CHANGED
} from './mediaLibrary.js';
import { formatByteSize, humanMetaRows, formatMediaDetailDates } from './mediaMetadata.js';
import { isMediaStagingOpen, openMediaStaging } from './mediaStagingDialog.js';
import { filesFromDataTransfer, readClipboardIntoStaging } from './mediaPasteCatcher.js';
import { showAppToast } from './toast.js';
import {
    downloadMediaMetaJson,
    downloadMediaZip,
    importMediaMetaJsonFile,
    importMediaZipFile
} from './mediaBackup.js';
import {
    formatExportTimestamp,
    readLastMediaMetaExportAt,
    readLastMediaZipExportAt,
    writeLastMediaMetaExportAt,
    writeLastMediaZipExportAt
} from './backup.js';
import {
    attachMediaToNote,
    detachMediaFromNote,
    findNotesForMedia,
    noteDisplayTitle,
    notesForAttachPicker,
    normalizeAttachments
} from './mediaAttachments.js';
import { buildMediaQuickActionsHtml, bindMediaQuickActions, viewMediaFullSize } from './mediaQuickActions.js';
import { buildSidebarNoteListItemHtml } from './sidebarNoteListHtml.js';
import { bindFloatResize, mountFloatChrome } from './desktopFloatChrome.js';
import { raiseDesktopElement } from './desktopStack.js';

const PANEL_STORAGE_KEY = 'matrix_media_lib_panel';
const SORT_MODE_KEY = 'matrix_media_lib_sort';
const SORT_DIR_KEY = 'matrix_media_lib_sort_dir';
const VIEW_MODE_KEY = 'matrix_media_lib_view';
const DEFAULT_W = 720;
const DEFAULT_H = 520;
const MIN_W = 420;
const MIN_H = 320;

const SORT_ICONS = Object.freeze({
    date: ACTION_ICONS.sortDate,
    alpha: ACTION_ICONS.sortAlpha
});

const SORT_TITLES = Object.freeze({
    date: 'Sort by date',
    alpha: 'Sort alphabetically'
});

const VIEW_ICONS = Object.freeze({
    tiles: ACTION_ICONS.category,
    list: FORMAT_ICONS.toNotes
});

const VIEW_TITLES = Object.freeze({
    tiles: 'Tiles view',
    list: 'List view'
});

let panel = null;
let notePickerOverlay = null;
let selectedId = null;
let attachNoteId = null;
let notePickerOpen = false;
/** @type {Set<string>} object URL keys currently claimed by this panel */
let claimedUrlKeys = new Set();
/** @type {null | (() => object[])} */
let getItems = null;
let floatChromeBound = false;

function normalizeSortMode(value) {
    return value === 'alpha' ? 'alpha' : 'date';
}

function normalizeSortDir(value) {
    return value === 'asc' ? 'asc' : 'desc';
}

function defaultDirForMode(mode) {
    return mode === 'alpha' ? 'asc' : 'desc';
}

function loadSortPrefs() {
    let mode = 'date';
    let dir = 'desc';
    try {
        mode = normalizeSortMode(localStorage.getItem(SORT_MODE_KEY));
        const storedDir = localStorage.getItem(SORT_DIR_KEY);
        dir = storedDir == null ? defaultDirForMode(mode) : normalizeSortDir(storedDir);
    } catch {
        /* ignore */
    }
    return { mode, dir };
}

function saveSortPrefs(mode, dir) {
    try {
        localStorage.setItem(SORT_MODE_KEY, normalizeSortMode(mode));
        localStorage.setItem(SORT_DIR_KEY, normalizeSortDir(dir));
    } catch {
        /* ignore quota */
    }
}

function normalizeViewMode(value) {
    return value === 'list' ? 'list' : 'tiles';
}

function loadViewMode() {
    try {
        return normalizeViewMode(localStorage.getItem(VIEW_MODE_KEY));
    } catch {
        return 'tiles';
    }
}

function saveViewMode(mode) {
    try {
        localStorage.setItem(VIEW_MODE_KEY, normalizeViewMode(mode));
    } catch {
        /* ignore quota */
    }
}

/**
 * @param {object[]} items
 * @param {'date'|'alpha'} mode
 * @param {'asc'|'desc'} dir
 */
function sortMediaItems(items, mode, dir) {
    const list = Array.isArray(items) ? items.slice() : [];
    const mul = dir === 'desc' ? -1 : 1;
    if (mode === 'alpha') {
        list.sort((a, b) => {
            const an = String(a?.title || a?.filename || '');
            const bn = String(b?.title || b?.filename || '');
            return an.localeCompare(bn, undefined, { sensitivity: 'base' }) * mul;
        });
        return list;
    }
    list.sort((a, b) => {
        const at = Number(a?.createdAt || a?.updatedAt || 0);
        const bt = Number(b?.createdAt || b?.updatedAt || 0);
        return (at - bt) * mul;
    });
    return list;
}

function syncSortButtons() {
    if (!panel) return;
    const { mode, dir } = loadSortPrefs();
    panel.querySelectorAll('[data-media-lib-sort]').forEach((btn) => {
        const btnMode = normalizeSortMode(btn.dataset.mediaLibSort);
        const active = btnMode === mode;
        const baseTitle = SORT_TITLES[btnMode] || 'Sort';
        const title = active
            ? `${baseTitle} (${dir === 'desc' ? 'descending' : 'ascending'} — click to flip)`
            : baseTitle;
        btn.classList.toggle('is-active', active);
        btn.classList.toggle('is-desc', active && dir === 'desc');
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.title = title;
        btn.setAttribute('aria-label', title);
        if (!btn.innerHTML.trim()) {
            btn.innerHTML = SORT_ICONS[btnMode] || '';
        }
    });
}

function syncViewButtons() {
    if (!panel) return;
    const mode = loadViewMode();
    const btn = panel.querySelector('[data-media-lib-view-toggle]');
    if (btn) {
        const title = mode === 'list'
            ? 'List view (click for tiles)'
            : 'Tiles view (click for list)';
        btn.innerHTML = VIEW_ICONS[mode] || '';
        btn.dataset.viewMode = mode;
        btn.setAttribute('aria-pressed', 'true');
        btn.title = title;
        btn.setAttribute('aria-label', title);
        btn.classList.toggle('is-list', mode === 'list');
        btn.classList.toggle('is-tiles', mode !== 'list');
    }
    const dropZone = panel.querySelector('[data-media-lib-drop]');
    dropZone?.classList.toggle('is-list-view', mode === 'list');
    dropZone?.classList.toggle('is-tiles-view', mode !== 'list');
}

function formatListDate(item) {
    const ts = Number(item?.createdAt || item?.updatedAt || 0);
    if (!ts) return '';
    try {
        return new Date(ts * 1000).toLocaleDateString();
    } catch {
        return '';
    }
}

/**
 * @param {object[]|undefined} items  When provided, refresh total size; export times always refresh.
 */
function syncFooterStats(items) {
    if (!panel) return;
    const sizeEl = panel.querySelector('[data-media-lib-total-size]');
    const metaEl = panel.querySelector('[data-media-lib-export-meta]');
    const zipEl = panel.querySelector('[data-media-lib-export-zip]');
    if (sizeEl && Array.isArray(items)) {
        const totalBytes = items.reduce((sum, it) => sum + (Number(it?.byteSize) || 0), 0);
        const label = formatByteSize(totalBytes);
        sizeEl.textContent = label;
        sizeEl.title = `Total media library size (${items.length} item${items.length === 1 ? '' : 's'})`;
    }
    if (metaEl) {
        const at = formatExportTimestamp(readLastMediaMetaExportAt());
        metaEl.textContent = `Meta ${at}`;
        metaEl.title = `Last media metadata export: ${at}`;
    }
    if (zipEl) {
        const at = formatExportTimestamp(readLastMediaZipExportAt());
        zipEl.textContent = `ZIP ${at}`;
        zipEl.title = `Last media ZIP export: ${at}`;
    }
}

function dataTransferHasFiles(dataTransfer) {
    if (!dataTransfer) return false;
    const types = dataTransfer.types;
    if (!types) return false;
    if (typeof types.includes === 'function') return types.includes('Files');
    return Array.from(types).includes('Files');
}

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

async function claimUrl(id, which) {
    const url = await getObjectUrl(id, which);
    if (url) claimedUrlKeys.add(`${which}:${id}`);
    return url;
}

function releaseAllClaimedUrls() {
    for (const key of claimedUrlKeys) {
        const [which, id] = key.split(':');
        releaseObjectUrl(id, which);
    }
    claimedUrlKeys.clear();
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

const PANEL_DRAG_BLOCK_SEL = [
    'button',
    'input',
    'textarea',
    'select',
    'a',
    'label',
    '.btn',
    '.media-lib-tile',
    '.media-lib-list-row',
    '.media-lib-detail__preview',
    '[data-media-detail-save]',
    '.media-quick-actions',
    '.media-lib-list-actions',
    '.sidebar-notes-list-item',
    '.ff-resize',
    '.ff-resize-layer'
].join(', ');

function isPanelDragBlocked(target) {
    if (!target?.closest) return true;
    if (target.closest('.media-lib-panel__drag')) return false;
    if (target.closest('.card-act')) return true;
    return !!target.closest(PANEL_DRAG_BLOCK_SEL);
}

function bindPanelDrag() {
    if (!panel) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        if (!panel.contains(e.target)) return;
        if (isPanelDragBlocked(e.target)) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = panel.offsetLeft;
        originTop = panel.offsetTop;
        try {
            panel.setPointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
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
            panel.releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
        savePanelGeom();
    };

    panel.addEventListener('pointerdown', onPointerDown);
    panel.addEventListener('pointermove', onPointerMove);
    panel.addEventListener('pointerup', endDrag);
    panel.addEventListener('pointercancel', endDrag);
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
                    if (!dataTransferHasFiles(e.dataTransfer)) return;
                    e.preventDefault();
                    dropZone.classList.add('is-dragover');
                });
            });
            dropZone.addEventListener('dragleave', (e) => {
                if (e.relatedTarget && dropZone.contains(e.relatedTarget)) return;
                dropZone.classList.remove('is-dragover');
            });
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('is-dragover');
                if (!dataTransferHasFiles(e.dataTransfer)) return;
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

        syncSortButtons();
        syncViewButtons();

        if (footer) {
            footer.innerHTML = `
                <div class="media-lib-panel__footer-actions">
                    <button type="button" class="btn btn--compact btn--icon" data-media-lib-upload title="Upload files" aria-label="Upload files">${ACTION_ICONS.upload}</button>
                    <button type="button" class="btn btn--compact btn--icon" data-media-lib-clipboard title="Add from clipboard" aria-label="Add from clipboard">${ACTION_ICONS.mediaPaste}</button>
                    <button type="button" class="btn btn--compact btn--icon" data-media-lib-select-note title="Select note to attach" aria-label="Select note to attach">${ACTION_ICONS.selectNote}</button>
                    <button type="button" class="btn btn--compact btn--icon is-hidden" data-media-lib-attach title="Attach selected media to note" aria-label="Attach to note" disabled>${CARD_ICONS.attach}</button>
                    <button type="button" class="btn btn--compact btn--icon" data-media-export-meta title="Export media metadata" aria-label="Export media metadata">${ACTION_ICONS.export}</button>
                    <button type="button" class="btn btn--compact btn--icon" data-media-export-zip title="Export media ZIP" aria-label="Export media ZIP">${ACTION_ICONS.cloudExport}</button>
                    <button type="button" class="btn btn--compact btn--icon" data-media-import-meta title="Import media metadata" aria-label="Import media metadata">${ACTION_ICONS.import}</button>
                    <button type="button" class="btn btn--compact btn--icon" data-media-import-zip title="Import media ZIP" aria-label="Import media ZIP">${ACTION_ICONS.cloudImport}</button>
                </div>
                <div class="media-lib-panel__footer-stats" data-media-lib-stats>
                    <span class="media-lib-panel__stat" data-media-lib-export-meta>Meta Never</span>
                    <span class="media-lib-panel__stat" data-media-lib-export-zip>ZIP Never</span>
                    <span class="media-lib-panel__stat" data-media-lib-total-size>0 B</span>
                </div>
            `;
        }

        if (closeBtn && !closeBtn.innerHTML.trim()) {
            closeBtn.innerHTML = CARD_ICONS.close;
        }
    },

    bindChrome() {
        panel.querySelector('[data-media-lib-close]')?.addEventListener('click', () => this.close());
        panel.querySelector('[data-media-lib-sort-group]')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-media-lib-sort]');
            if (!btn || !panel.contains(btn)) return;
            e.preventDefault();
            e.stopPropagation();
            const nextMode = normalizeSortMode(btn.dataset.mediaLibSort);
            const { mode, dir } = loadSortPrefs();
            if (nextMode === mode) {
                saveSortPrefs(mode, dir === 'asc' ? 'desc' : 'asc');
            } else {
                saveSortPrefs(nextMode, defaultDirForMode(nextMode));
            }
            syncSortButtons();
            this.refresh();
        });
        panel.querySelector('[data-media-lib-view-toggle]')?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const next = loadViewMode() === 'list' ? 'tiles' : 'list';
            saveViewMode(next);
            syncViewButtons();
            this.refresh();
        });
        panel.querySelector('[data-media-lib-upload]')?.addEventListener('click', () => {
            document.getElementById('media-library-file-picker')?.click();
        });
        panel.querySelector('[data-media-lib-clipboard]')?.addEventListener('click', () => {
            readClipboardIntoStaging();
        });
        panel.querySelector('[data-media-lib-select-note]')?.addEventListener('click', () => {
            this.toggleNotePicker();
        });
        panel.querySelector('[data-media-lib-attach]')?.addEventListener('click', () => {
            this.attachSelectedToNote();
        });
        panel.querySelector('[data-media-export-meta]')?.addEventListener('click', () => {
            downloadMediaMetaJson()
                .then((payload) => {
                    writeLastMediaMetaExportAt(payload?.timestamp || Math.floor(Date.now() / 1000));
                    syncFooterStats();
                })
                .catch((err) => showAppToast(err?.message || 'Export failed'));
        });
        panel.querySelector('[data-media-export-zip]')?.addEventListener('click', () => {
            downloadMediaZip()
                .then((payload) => {
                    writeLastMediaZipExportAt(payload?.timestamp || Math.floor(Date.now() / 1000));
                    syncFooterStats();
                })
                .catch((err) => showAppToast(err?.message || 'Export failed'));
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
        releaseAllClaimedUrls();
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
        const { mode, dir } = loadSortPrefs();
        const items = sortMediaItems(await listMedia(), mode, dir);
        const grid = panel.querySelector('[data-media-lib-grid]');
        const empty = panel.querySelector('[data-media-lib-empty]');
        const dropHint = panel.querySelector('[data-media-lib-drop-hint]');
        const titleEl = panel.querySelector('[data-media-lib-title]');
        if (titleEl) {
            titleEl.textContent = items.length
                ? `Media library (${items.length})`
                : 'Media library';
        }
        syncSortButtons();
        syncViewButtons();
        syncFooterStats(items);

        if (!items.length) {
            if (grid) grid.innerHTML = '';
            empty?.classList.remove('is-hidden');
            dropHint?.classList.add('is-hidden');
            this.renderDetail(null);
            return;
        }
        empty?.classList.add('is-hidden');
        dropHint?.classList.remove('is-hidden');

        if (!selectedId || !items.some((i) => i.id === selectedId)) {
            selectedId = items[0].id;
        }
        this.syncAttachControls();

        const viewMode = loadViewMode();
        const tiles = await Promise.all(items.map(async (item) => {
            let thumbSrc = '';
            if (!item.blobMissing && String(item.mime || '').startsWith('image/')) {
                const url = await claimUrl(item.id, 'thumb');
                if (url) thumbSrc = url;
            }
            const missing = item.blobMissing ? ' media-lib-tile--missing' : '';
            const selected = item.id === selectedId ? ' is-selected' : '';
            const linked = findNotesForMedia(getItems?.() || [], item.id);
            const preview = thumbSrc
                ? `<img src="${escapeAttr(thumbSrc)}" alt="" draggable="false">`
                : `<span class="media-lib-tile__icon">${escapeHTML((item.mime || 'file').split('/').pop() || 'file')}</span>`;
            const alreadyOnTarget = attachNoteId
                && normalizeAttachments(liveItem(attachNoteId)?.attachments).some((a) => a.mediaId === item.id);
            const isImage = String(item.mime || '').startsWith('image/');
            const actions = buildMediaQuickActionsHtml({
                mediaId: item.id,
                context: 'library-tile',
                attachNoteId,
                alreadyAttached: !!alreadyOnTarget,
                blobMissing: !!item.blobMissing,
                isImage,
                layout: viewMode === 'list' ? 'inline-row' : 'overlay'
            });

            if (viewMode === 'list') {
                const title = item.title || item.filename || 'Untitled';
                const subParts = [
                    formatByteSize(item.byteSize || 0),
                    formatListDate(item),
                    item.mime || '',
                    linked.length ? `${linked.length} note${linked.length === 1 ? '' : 's'}` : ''
                ].filter(Boolean);
                return `
                    <div class="media-lib-list-row${selected}${missing}" data-media-id="${escapeAttr(item.id)}" title="${escapeAttr(title)}">
                        <button type="button" class="media-lib-list-row__select" data-media-select title="Select">
                            <span class="media-lib-list-row__thumb">${preview}</span>
                            <span class="media-lib-list-row__meta">
                                <span class="media-lib-list-row__title">${escapeHTML(title)}</span>
                                <span class="media-lib-list-row__sub">${escapeHTML(subParts.join(' · '))}</span>
                            </span>
                        </button>
                        ${actions}
                    </div>
                `;
            }

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
            grid.classList.toggle('media-lib-grid--list', viewMode === 'list');
            grid.innerHTML = tiles.join('');
            grid.querySelectorAll('[data-media-select]').forEach((btn) => {
                btn.addEventListener('click', () => {
                    const tile = btn.closest('[data-media-id]');
                    if (!tile) return;
                    selectedId = tile.dataset.mediaId;
                    this.refresh();
                });
            });
            const actionRoots = viewMode === 'list'
                ? grid.querySelectorAll('.media-lib-list-row')
                : grid.querySelectorAll('.media-lib-tile__preview-wrap');
            actionRoots.forEach((wrap) => {
                const tile = wrap.closest('[data-media-id]') || wrap;
                const mediaId = tile?.dataset.mediaId;
                if (!mediaId) return;
                bindMediaQuickActions(wrap, {
                    context: 'library-tile',
                    attachNoteId,
                    onTransformCommitted: (meta) => {
                        if (meta?.id) selectedId = meta.id;
                        this.refresh();
                    },
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
            const url = await claimUrl(item.id, 'blob');
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
            isImage: String(item.mime || '').startsWith('image/'),
            showSave: false
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
                <button type="button" class="media-lib-detail__save is-hidden" data-media-detail-save data-media-id="${escapeAttr(item.id)}" title="Save" aria-label="Save">
                    <span class="media-lib-detail__save-icon">${CARD_ICONS.save}</span>
                    <span class="media-lib-detail__save-label">Save</span>
                </button>
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
        const saveOverlayBtn = detail.querySelector('[data-media-detail-save]');
        let savedTitle = item.title || '';
        let savedDesc = item.description || '';
        const syncSaveBtn = () => {
            const title = detail.querySelector('[data-detail-title]')?.value ?? '';
            const desc = detail.querySelector('[data-detail-desc]')?.value ?? '';
            const dirty = title !== savedTitle || desc !== savedDesc;
            saveOverlayBtn?.classList.toggle('is-hidden', !dirty);
            detail.querySelector('[data-media-detail-preview]')?.classList.toggle('is-dirty', dirty);
        };

        const commitDetailSave = async () => {
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
            const row = panel.querySelector(`[data-media-id="${CSS.escape(item.id)}"]`);
            if (row) {
                row.title = title || item.filename || 'Untitled';
                const listTitle = row.querySelector('.media-lib-list-row__title');
                if (listTitle) listTitle.textContent = title || item.filename || 'Untitled';
            }
        };

        bindMediaQuickActions(previewActions, {
            context: 'library-detail',
            attachNoteId,
            onTransformCommitted: (meta) => {
                if (meta?.id) selectedId = meta.id;
                this.refresh();
            },
            onAttach: () => this.attachSelectedToNote(),
            onRemove: async () => {
                if (!confirm('Remove this item from the media library?')) return;
                await removeMedia(item.id);
                selectedId = null;
                showAppToast('Removed');
                this.refresh();
            }
        });

        saveOverlayBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            commitDetailSave().catch(() => showAppToast('Save failed'));
        });

        const previewEl = detail.querySelector('[data-media-detail-preview]');
        if (previewEl && !item.blobMissing && String(item.mime || '').startsWith('image/')) {
            previewEl.classList.add('is-clickable');
            previewEl.title = 'View full size';
            previewEl.addEventListener('click', (e) => {
                if (e.target.closest('.card-act, .media-quick-actions, [data-media-detail-save]')) return;
                if (previewEl.classList.contains('is-dirty')) return;
                viewMediaFullSize(item.id, { attachNoteId }).catch(() => {});
            });
        }

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
