/** @module {"owns":"shared media hover quick actions", "related":["mediaLibrary.js","noteAttachmentsUi.js","mediaLibraryOverlay.js"]} */
import { CARD_ICONS } from './icons.js';
import { getMediaMeta, getMediaRecord } from './mediaLibrary.js';
import { detachMediaFromNote } from './mediaAttachments.js';
import { showAppToast } from './toast.js';

/**
 * @param {{
 *   mediaId: string,
 *   context: 'library-tile' | 'library-detail' | 'note-attachment',
 *   attachNoteId?: string|null,
 *   alreadyAttached?: boolean,
 *   blobMissing?: boolean,
 *   showSave?: boolean,
 *   showRemove?: boolean
 * }} opts
 */
export function buildMediaQuickActionsHtml(opts) {
    const {
        mediaId,
        context,
        attachNoteId = null,
        alreadyAttached = false,
        blobMissing = false,
        showSave = false,
        showRemove = true
    } = opts;

    const showAttach = (context === 'library-tile' || context === 'library-detail')
        && attachNoteId
        && !alreadyAttached;
    const isNote = context === 'note-attachment';
    const removeIcon = isNote ? CARD_ICONS.close : CARD_ICONS.delete;
    const removeTitle = isNote ? 'Detach' : 'Delete from library';
    const removeClass = isNote ? '' : ' card-act--danger';
    const removeAttr = isNote ? 'data-media-action-detach' : 'data-media-action-delete';

    const saveBtn = showSave
        ? `<button type="button" class="card-act" data-media-action-save data-media-id="${mediaId}" title="Save" aria-label="Save">${CARD_ICONS.save}</button>`
        : '';

    const removeBlock = showRemove
        ? `<div class="media-quick-actions media-quick-actions--left">
            <button type="button" class="card-act${removeClass}" ${removeAttr} data-media-id="${mediaId}" title="${removeTitle}" aria-label="${removeTitle}">${removeIcon}</button>
        </div>`
        : '';

    return `
        ${removeBlock}
        <div class="media-quick-actions media-quick-actions--right">
            <button type="button" class="card-act" data-media-action-view data-media-id="${mediaId}" title="View full size" aria-label="View full size">${CARD_ICONS.expandMedia}</button>
            <button type="button" class="card-act" data-media-action-download data-media-id="${mediaId}" title="Download" aria-label="Download" ${blobMissing ? 'disabled' : ''}>${CARD_ICONS.download}</button>
            ${showAttach ? `<button type="button" class="card-act" data-media-action-attach data-media-id="${mediaId}" title="Attach to selected note" aria-label="Attach">${CARD_ICONS.attach}</button>` : ''}
            ${saveBtn}
        </div>`;
}

/**
 * @param {string} mediaId
 */
export async function downloadMediaFile(mediaId) {
    const record = await getMediaRecord(mediaId);
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
}

/**
 * @param {string} mediaId
 * @param {{ attachNoteId?: string|null }} [opts]
 */
export async function viewMediaFullSize(mediaId, opts = {}) {
    if (!mediaId) return;
    const meta = await getMediaMeta(mediaId);
    if (!meta || meta.blobMissing) {
        showAppToast('Preview unavailable');
        return;
    }
    if (String(meta.mime || '').startsWith('image/')) {
        const { openMediaLightbox } = await import('./noteAttachmentsUi.js');
        await openMediaLightbox(mediaId);
        return;
    }
    const { MediaLibraryOverlay } = await import('./mediaLibraryOverlay.js');
    await MediaLibraryOverlay.open({
        selectMediaId: mediaId,
        attachNoteId: opts.attachNoteId || null
    });
}

/**
 * @param {HTMLElement} container
 * @param {{
 *   context: 'library-tile' | 'library-detail' | 'note-attachment',
 *   attachNoteId?: string|null,
 *   noteItem?: object|null,
 *   onAttach?: (mediaId: string) => void,
 *   onRemove?: (mediaId: string) => void|Promise<void>,
 *   onSave?: () => void|Promise<void>
 * }} opts
 */
export function bindMediaQuickActions(container, opts) {
    if (!container || container.dataset.quickActionsBound === '1') return;
    container.dataset.quickActionsBound = '1';

    const stop = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };

    container.querySelector('[data-media-action-view]')?.addEventListener('click', (e) => {
        stop(e);
        const mediaId = e.currentTarget.dataset.mediaId;
        viewMediaFullSize(mediaId, { attachNoteId: opts.attachNoteId }).catch(() => {});
    });

    container.querySelector('[data-media-action-download]')?.addEventListener('click', (e) => {
        stop(e);
        const mediaId = e.currentTarget.dataset.mediaId;
        downloadMediaFile(mediaId).catch(() => showAppToast('Download failed'));
    });

    container.querySelector('[data-media-action-attach]')?.addEventListener('click', (e) => {
        stop(e);
        const mediaId = e.currentTarget.dataset.mediaId;
        opts.onAttach?.(mediaId);
    });

    container.querySelector('[data-media-action-save]')?.addEventListener('click', (e) => {
        stop(e);
        opts.onSave?.();
    });

    container.querySelector('[data-media-action-delete]')?.addEventListener('click', async (e) => {
        stop(e);
        const mediaId = e.currentTarget.dataset.mediaId;
        if (opts.onRemove) {
            await opts.onRemove(mediaId);
            return;
        }
        if (!confirm('Remove this item from the media library?')) return;
        const { removeMedia } = await import('./mediaLibrary.js');
        await removeMedia(mediaId);
        showAppToast('Removed');
    });

    container.querySelector('[data-media-action-detach]')?.addEventListener('click', (e) => {
        stop(e);
        const mediaId = e.currentTarget.dataset.mediaId;
        const note = opts.noteItem;
        if (!note || !mediaId) return;
        if (!localStorage.getItem('admin_token')) {
            showAppToast('Login required');
            return;
        }
        if (detachMediaFromNote(note, mediaId)) {
            showAppToast('Detached');
        }
    });
}
