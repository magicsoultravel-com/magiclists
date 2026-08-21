/** @module {"owns":"media library overlay gallery browser", "related":["mediaLibrary.js","mediaStagingDialog.js","sidebarMediaLibrary.js"]} */
import { escapeAttr, escapeHTML } from './domEscape.js';
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

let overlay = null;
let selectedId = null;
let thumbUrls = new Map();

export const MediaLibraryOverlay = {
    init() {
        overlay = document.getElementById('media-library-overlay');
        if (!overlay) return;

        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) this.close();
        });
        overlay.querySelector('[data-media-lib-close]')?.addEventListener('click', () => this.close());
        overlay.querySelector('[data-media-lib-upload]')?.addEventListener('click', () => {
            document.getElementById('media-library-file-picker')?.click();
        });
        overlay.querySelector('[data-media-export-meta]')?.addEventListener('click', () => {
            downloadMediaMetaJson().catch((err) => showAppToast(err?.message || 'Export failed'));
        });
        overlay.querySelector('[data-media-export-zip]')?.addEventListener('click', () => {
            downloadMediaZip().catch((err) => showAppToast(err?.message || 'Export failed'));
        });
        overlay.querySelector('[data-media-import-meta]')?.addEventListener('click', () => {
            document.getElementById('media-meta-import-picker')?.click();
        });
        overlay.querySelector('[data-media-import-zip]')?.addEventListener('click', () => {
            document.getElementById('media-zip-import-picker')?.click();
        });

        const dropZone = overlay.querySelector('[data-media-lib-drop]');
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
            this.close();
        }, true);

        window.addEventListener(MEDIA_LIBRARY_CHANGED, () => {
            if (this.isOpen()) this.refresh();
        });
    },

    isOpen() {
        return !!(overlay && !overlay.classList.contains('is-hidden'));
    },

    async open() {
        if (!overlay) return;
        overlay.classList.remove('is-hidden');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => overlay?.classList.add('is-open'));
        });
        await this.refresh();
    },

    close() {
        if (!overlay) return;
        overlay.classList.remove('is-open');
        overlay.classList.add('is-hidden');
        selectedId = null;
        thumbUrls.clear();
        revokeAllObjectUrls();
    },

    clearThumbs() {
        thumbUrls.clear();
    },

    async refresh() {
        if (!overlay) return;
        const items = await listMedia();
        const grid = overlay.querySelector('[data-media-lib-grid]');
        const empty = overlay.querySelector('[data-media-lib-empty]');
        const countEl = overlay.querySelector('[data-media-lib-count]');
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
            const preview = thumbSrc
                ? `<img src="${escapeAttr(thumbSrc)}" alt="">`
                : `<span class="media-lib-tile__icon">${escapeHTML((item.mime || 'file').split('/').pop() || 'file')}</span>`;
            return `
                <button type="button" class="media-lib-tile${selected}${missing}" data-media-id="${escapeAttr(item.id)}" title="${escapeAttr(item.title || item.filename)}">
                    <span class="media-lib-tile__preview">${preview}</span>
                    <span class="media-lib-tile__label">${escapeHTML(item.title || item.filename || 'Untitled')}</span>
                    ${item.blobMissing ? '<span class="media-lib-tile__badge">Missing</span>' : ''}
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
        const detail = overlay?.querySelector('[data-media-lib-detail]');
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

        detail.innerHTML = `
            <div class="media-lib-detail__preview">${previewHtml}</div>
            <label class="media-staging__label">Title
                <input type="text" class="media-staging__input" data-detail-title value="${escapeAttr(item.title || '')}">
            </label>
            <label class="media-staging__label">Description
                <textarea class="media-staging__input media-staging__textarea" data-detail-desc rows="2">${escapeHTML(item.description || '')}</textarea>
            </label>
            <div class="media-lib-detail__actions">
                <button type="button" class="btn btn--compact" data-detail-save>Save</button>
                <button type="button" class="btn btn--compact" data-detail-download ${item.blobMissing ? 'disabled' : ''}>Download</button>
                <button type="button" class="btn btn--compact btn--danger" data-detail-delete>Delete</button>
            </div>
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

        detail.querySelector('[data-detail-delete]')?.addEventListener('click', async () => {
            if (!confirm('Remove this item from the media library?')) return;
            await removeMedia(item.id);
            selectedId = null;
            showAppToast('Removed');
            this.refresh();
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
