/** @module {"owns":"sidebar media library module chrome", "related":["mediaLibraryOverlay.js","mediaStagingDialog.js","sidebarModules.js"]} */
import { ACTION_ICONS } from './icons.js';
import { countMedia, MEDIA_LIBRARY_CHANGED } from './mediaLibrary.js';
import { MediaLibraryOverlay } from './mediaLibraryOverlay.js';
import { readClipboardIntoStaging } from './mediaPasteCatcher.js';
import {
    downloadMediaMetaJson,
    downloadMediaZip
} from './mediaBackup.js';
import { renderSidebarModuleHeaderHtml } from './sidebarModules.js';
import { showAppToast } from './toast.js';

export const SidebarMediaLibrary = {
    root: null,

    init() {
        this.root = document.getElementById('sidebar-media-library');
        if (!this.root) return;

        this.renderShell();
        this.bindListeners();
        this.refreshCount();
        window.addEventListener(MEDIA_LIBRARY_CHANGED, () => this.refreshCount());
    },

    renderShell() {
        const extrasHtml = `
                <span class="sidebar-media-lib__compact" data-media-lib-compact title="Items in library">0</span>
                <button type="button" class="btn btn--compact btn-icon" data-media-lib-open title="Open media library" aria-label="Open media library">${ACTION_ICONS.mediaLibrary}</button>`;
        this.root.innerHTML = `
            ${renderSidebarModuleHeaderHtml({ headerId: 'media-library-section-header', title: 'Media', extrasHtml })}
            <div class="collapsable-section collapsed" id="media-library-section">
                <div class="sidebar-media-lib__body">
                    <div class="sidebar-media-lib__actions">
                        <button type="button" class="btn btn--compact" data-media-lib-upload>Upload</button>
                        <button type="button" class="btn btn--compact" data-media-lib-clipboard>Clipboard</button>
                        <button type="button" class="btn btn--compact" data-media-lib-browse>Browse</button>
                    </div>
                    <div class="sidebar-media-lib__exports">
                        <button type="button" class="btn btn--compact btn--icon" data-media-lib-export-meta title="Export media metadata" aria-label="Export media metadata">${ACTION_ICONS.export}</button>
                        <button type="button" class="btn btn--compact btn--icon" data-media-lib-export-zip title="Export media + metadata ZIP" aria-label="Export media ZIP">${ACTION_ICONS.cloudExport}</button>
                    </div>
                    <p class="sidebar-media-lib__hint">Paste images with Ctrl+V anywhere — confirm before adding.</p>
                </div>
            </div>
        `;
    },

    bindListeners() {
        this.root.querySelector('[data-media-lib-open]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            MediaLibraryOverlay.open();
        });
        this.root.querySelector('[data-media-lib-browse]')?.addEventListener('click', () => {
            MediaLibraryOverlay.open();
        });
        this.root.querySelector('[data-media-lib-upload]')?.addEventListener('click', () => {
            document.getElementById('media-library-file-picker')?.click();
        });
        this.root.querySelector('[data-media-lib-clipboard]')?.addEventListener('click', () => {
            readClipboardIntoStaging();
        });
        this.root.querySelector('[data-media-lib-export-meta]')?.addEventListener('click', () => {
            downloadMediaMetaJson().catch((err) => showAppToast(err?.message || 'Export failed'));
        });
        this.root.querySelector('[data-media-lib-export-zip]')?.addEventListener('click', () => {
            downloadMediaZip().catch((err) => showAppToast(err?.message || 'Export failed'));
        });
    },

    async refreshCount() {
        const n = await countMedia();
        const el = this.root?.querySelector('[data-media-lib-compact]');
        if (el) el.textContent = String(n);
    }
};
