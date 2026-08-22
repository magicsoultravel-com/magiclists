/** @module {"owns":"board + modal note quick-action DOM binding", "related":["noteSurface.js","ui.js","editor.js"]} */
import { ColorPicker, PALETTE_NOTE, resolveNoteColor, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import { itemToPlainCopyText, itemToTxtExportText, sortItemsForTxtExport } from './noteBodyConversion.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { NoteSurface } from './noteSurface.js';
import { applyItemCardTheme, applyCardCategoryBand } from './noteSurfaceHtml.js';
import { getCardRenderContext, readStoredCategories } from './categories.js';
import { isDesktopCard } from './ui.js';
import { BoardOperations } from './boardOperations.js';
import { DisplayOptions } from './displayOptions.js';
import { ClockStyle } from './clockStyle.js';
import { BoardSort } from './boardSort.js';
import { Fullscreen } from './fullscreen.js';
import { UndoManager } from './undo.js';
import { BoardOverlay } from './boardOverlay.js';
import { NotePopoutBridge } from './notePopoutBridge.js';
import { getAppElementById } from './appDocuments.js';
import { showAppToast } from './toast.js';
import { MediaLibraryOverlay } from './mediaLibraryOverlay.js';
import { attachmentCount } from './mediaAttachments.js';

/**
 * Attach a quick-action button using a "commit then act" pattern.
 *
 * Pressing a quick action while the note is being edited inline causes the
 * button to grab focus, which blurs the focused `.card-inline-edit` and runs
 * the editor's blur/autosave logic. Previously that first press was entirely
 * absorbed by "escaping the edit" and a second press was needed to act — in
 * both the surface/board editor and the modal editor.
 *
 * This wrapper collapses that into a single press:
 *  1. `commit()` runs synchronously on `mousedown`, BEFORE the button takes
 *     focus, so the latest keystrokes in the active inline field are captured.
 *  2. The `handler` is deferred to the next animation frame so it runs after
 *     the editable's blur/autosave/reflow has settled — which is what lets
 *     popovers (color/emoji pickers) and state toggles "stick" on the first
 *     press instead of being cancelled by the edit-exit reflow.
 *
 * For keyboard activation (click without a preceding mousedown), `commit()` and
 * `handler` both run immediately; the `handledByMouse` guard prevents the click
 * fallback from double-firing a mousedown-triggered action.
 *
 * @param {HTMLElement} btn - The quick-action button.
 * @param {Function} handler - The action to perform.
 * @param {{ commit?: Function|null, defer?: boolean }} [opts]
 * @param {Function|null} [opts.commit] - Synchronous callback that captures the
 *   currently focused inline edit before focus moves (e.g. commitFocusedInlineField).
 * @param {boolean} [opts.defer=true] - Defer `handler` to the next animation frame.
 */
function attachCardActionButton(btn, handler, { commit = null, defer = true } = {}) {
    if (!btn) return;

    let handledByMouse = false;
    btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        handledByMouse = true;
        // Commit synchronously so the action sees the latest in-progress edit.
        if (typeof commit === 'function') commit();
        if (defer) {
            // Let the editable's blur/autosave/reflow finish, then act on a stable DOM.
            requestAnimationFrame(() => handler(e));
        } else {
            handler(e);
        }
    });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (handledByMouse) {
            handledByMouse = false;
            return;
        }
        if (typeof commit === 'function') commit();
        handler(e);
    });
}

function syncPinButton(pinBtn, pinned, dragBtn) {
    pinBtn.classList.toggle('is-active', pinned);
    pinBtn.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    const pinTitle = pinned ? 'Unpin (unlock drag)' : 'Pin position (locks drag)';
    pinBtn.setAttribute('title', pinTitle);
    pinBtn.setAttribute('aria-label', pinTitle);
    pinBtn.innerHTML = pinned ? CARD_ICONS.unpin : CARD_ICONS.pin;
    if (dragBtn) dragBtn.classList.toggle('is-hidden', pinned);
}

function queryActionButtons(root) {
    const actions = root.querySelector?.('.card-actions') || root;
    return {
        actions,
        archiveBtn: root.querySelector?.('.card-act--archive'),
        copyBtn: actions.querySelector('.card-act--copy'),
        pinBtn: actions.querySelector('.card-act--pin'),
        dragBtn: actions.querySelector('.card-act--drag'),
        toggleBtn: actions.querySelector('.card-act--toggle'),
        colorBtn: actions.querySelector('.card-act--color'),
        attachBtn: actions.querySelector('.card-act--attach'),
        iconBtn: actions.querySelector('.card-act--emoji'),
        hideBtn: actions.querySelector('.card-act--hide'),
        editBtn: actions.querySelector('.card-act--edit'),
        calBtn: actions.querySelector('.card-act--cal'),
        popoutBtn: actions.querySelector('.card-act--popout'),
        popinBtn: actions.querySelector('.card-act--popin'),
        closeBtn: actions.querySelector('.card-act--close'),
        windowSizeBtn: actions.querySelector('.card-act--window-size')
    };
}


function wireSharedActions(buttons, item, { ui, surface, card, editor } = {}) {
    const { copyBtn, pinBtn, dragBtn, colorBtn, attachBtn, iconBtn, hideBtn, calBtn, popoutBtn, popinBtn } = buttons;
    const iconRoot = surface === 'board'
        ? (card?.querySelector('.editor-note-shell') || card)
        : (editor?.mountZone?.querySelector('.editor-note-shell') || editor?.mountZone || editor?.popoutRoot);

    // Synchronous commit used before the button steals focus from the active inline edit.
    const boardCommit = surface === 'board' ? () => NoteSurface.commitFocusedInlineField(card, item) : null;
    const modalCommit = (surface === 'modal' || surface === 'popout')
        ? () => editor?.syncActiveItemFromDom?.()
        : null;

    const lockedByPopout = surface === 'board' && NotePopoutBridge.isClaimedByOther(item?.id);

    if (popoutBtn) {
        NotePopoutBridge.syncPopoutButtonUI(popoutBtn, item.id);
        attachCardActionButton(popoutBtn, () => {
            if (surface === 'popout') {
                editor?.closePopout?.();
                return;
            }
            if (surface === 'board') {
                NoteSurface.commitFocusedInlineField(card, item);
            } else if (surface === 'modal') {
                editor?.syncActiveItemFromDom?.();
                editor?.persistNote?.({ force: true });
            }
            if (!localStorage.getItem('admin_token')) {
                showAppToast('Login required to pop out notes');
                return;
            }
            NotePopoutBridge.openOrFocus(item.id);
            NotePopoutBridge.syncPopoutButtonUI(popoutBtn, item.id);
            if (surface === 'modal' && NotePopoutBridge.isPoppedOut(item.id)) {
                // Popout owns the note; dismiss modal without a second save race.
                editor?.close?.();
            }
        }, { commit: boardCommit || modalCommit, defer: false });
    }

    if (popinBtn) {
        // Recall a popped-out note: ask the popout window to flush + save then
        // close itself. The popout_closed broadcast brings the final content
        // back to the board and the card re-renders unlocked.
        attachCardActionButton(popinBtn, () => {
            if (surface === 'board') NoteSurface.commitFocusedInlineField(card, item);
            else editor?.syncActiveItemFromDom?.();
            if (NotePopoutBridge.isPoppedOut(item.id)) {
                NotePopoutBridge.requestClose(item.id);
                NotePopoutBridge.syncAllPopoutButtons();
                showAppToast('Returning note to the board');
            }
        }, { commit: boardCommit || modalCommit, defer: false });
    }

    // Content ownership is in the popout — leave drag, pin, popout on the board card.
    if (lockedByPopout) {
        [colorBtn, attachBtn, iconBtn, hideBtn, calBtn, copyBtn].forEach((btn) => {
            if (!btn) return;
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
            btn.classList.add('is-popout-locked-action');
        });
        attachCardActionButton(pinBtn, () => {
            const pinned = ui.toggleBoardPin(item.id);
            if (surface === 'board') ui.syncBoardPinClass(card);
            syncPinButton(pinBtn, pinned, dragBtn);
        });
        return;
    }

    attachCardActionButton(copyBtn, async () => {
        if (surface === 'board') {
            const shell = card.querySelector('.editor-note-shell');
            if (shell) NoteSurface.syncItemBodyFromDom(shell, item);
            const ok = await copyPlainTextToClipboard(itemToPlainCopyText(item));
            if (ok) NoteSurface.flashCopyFeedback(copyBtn);
            else NoteSurface.flashCopyFeedback(copyBtn, 'Copy failed', { failed: true });
        } else {
            editor.syncActiveItemFromDom();
            const data = editor.collectFormData ? editor.collectFormData() : item;
            const ok = await copyPlainTextToClipboard(itemToPlainCopyText(data));
            if (ok) NoteSurface.flashCopyFeedback(copyBtn);
            else NoteSurface.flashCopyFeedback(copyBtn, 'Copy failed', { failed: true });
        }
    }, { commit: boardCommit || modalCommit });

    attachCardActionButton(pinBtn, () => {
        const pinned = ui.toggleBoardPin(item.id);
        if (surface === 'board') ui.syncBoardPinClass(card);
        syncPinButton(pinBtn, pinned, dragBtn);
    });

    attachCardActionButton(colorBtn, () => {
        if (surface === 'board') {
            if (isDesktopCard(card)) ui.raiseDesktopCard(card);
            if (!localStorage.getItem('admin_token')) return;
            ColorPicker.open({
                anchor: colorBtn,
                presets: PALETTE_NOTE,
                value: resolveNoteColor(item.backgroundColor),
                align: 'end',
                onSelect: (color) => {
                    NoteSurface.mutateItem(item, (it) => {
                        it.backgroundColor = color || THEME_DEFAULT_COLOR;
                    }, { preserveView: true, skipRerender: true });
                    applyItemCardTheme(card, item);
                    const { categoryColor } = getCardRenderContext(item, readStoredCategories());
                    applyCardCategoryBand(card, categoryColor);
                }
            });
        } else if (surface === 'popout') {
            editor.openColorPicker?.();
        } else {
            editor.openColorPicker();
        }
    }, { commit: boardCommit || modalCommit });

    if (attachBtn) {
        const count = attachmentCount(item);
        attachBtn.classList.toggle('is-active', count > 0);
        attachBtn.setAttribute('aria-pressed', count > 0 ? 'true' : 'false');
        const attachTitle = count ? `Attach media (${count})` : 'Attach media';
        attachBtn.setAttribute('title', attachTitle);
        attachBtn.setAttribute('aria-label', attachTitle);

        attachCardActionButton(attachBtn, () => {
            if (surface === 'board') {
                if (isDesktopCard(card)) ui.raiseDesktopCard(card);
            } else {
                editor?.syncActiveItemFromDom?.();
            }
            if (!localStorage.getItem('admin_token')) {
                showAppToast('Login required to attach media');
                return;
            }
            MediaLibraryOverlay.open({ attachNoteId: item.id });
        }, { commit: boardCommit || modalCommit });
    }

    attachCardActionButton(iconBtn, () => {
        if (surface === 'board') {
            if (isDesktopCard(card)) ui.raiseDesktopCard(card);
            if (!localStorage.getItem('admin_token')) return;
            NoteSurface.openEmojiPickerForNote(iconRoot, iconBtn, item);
        } else if (surface === 'popout') {
            editor.openEmojiPicker?.();
        } else {
            editor.openEmojiPicker();
        }
    }, { commit: boardCommit || modalCommit });

    attachCardActionButton(hideBtn, () => {
        if (surface === 'board') {
            BoardOperations.hideFromBoard(item);
        } else {
            editor.syncActiveItemFromDom();
            Object.assign(item, editor.collectFormData());
            BoardOperations.hideFromBoard(item);
        }
    }, { commit: boardCommit || modalCommit });

    if (calBtn) {
        BoardOperations.syncCalendarButtonUI(item, calBtn);
        attachCardActionButton(calBtn, () => {
            if (surface === 'board') {
                BoardOperations.toggleCardCalendar(item, calBtn);
            } else if (surface === 'popout') {
                editor.syncActiveItemFromDom?.();
                BoardOperations.toggleCardCalendar(item, calBtn);
                if (editor.activeItem) editor.activeItem.hideFromCalendar = item.hideFromCalendar;
                editor.markInteracted?.();
                editor.triggerAutoSave?.();
            } else {
                editor.syncActiveItemFromDom();
                BoardOperations.toggleCardCalendar(item, calBtn);
                editor.activeItem.hideFromCalendar = item.hideFromCalendar;
                editor.markInteracted();
                editor.triggerAutoSave();
            }
        }, { commit: boardCommit || modalCommit });
    }
}

/**
 * @param {HTMLElement} mount — board card or modal toolbar mount
 * @param {object} item
 * @param {{ surface: 'board'|'modal'|'popout', ui: object, card?: HTMLElement, ctx?: object, editor?: object }} opts
 */
export function bindNoteQuickActions(mount, item, { surface, ui, card, ctx, editor } = {}) {
    if (!mount || !item || !ui) return;

    if (surface === 'modal') {
        bindModalQuickActions(mount, item, ui, editor);
        return;
    }

    if (surface === 'popout') {
        bindPopoutQuickActions(mount, item, ui, editor);
        return;
    }

    if (!card) return;
    const buttons = queryActionButtons(card);
    if (!buttons.actions) return;

    wireSharedActions(buttons, item, { ui, surface, card, editor });

    const toolbar = card.querySelector('.note-editor-toolbar');
    toolbar?.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.card-act')) return;
        NoteSurface.commitFocusedInlineField(card, item);
    }, true);

    if (buttons.toggleBtn) {
        buttons.toggleBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            // Capture the active inline edit before this button steals focus.
            NoteSurface.commitFocusedInlineField(card, item);
        });
        buttons.toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            delete card.dataset.skipExpand;
            if (ctx) ui.applyTileZoneToggle(card, item, { ...ctx, fromToolbar: true });
        });
    }

    attachCardActionButton(buttons.editBtn, () => {
        if (isDesktopCard(card)) ui.raiseDesktopCard(card);
        if (card.dataset.skipExpand) {
            delete card.dataset.skipExpand;
            return;
        }
        if (!localStorage.getItem('admin_token')) return;
        if (NotePopoutBridge.isClaimedByOther(item.id)) {
            NotePopoutBridge.openOrFocus(item.id);
            showAppToast('Note is open in a popout');
            return;
        }
        window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: { item } }));
    }, { commit: () => NoteSurface.commitFocusedInlineField(card, item) });
}

function bindPopoutQuickActions(toolbarMount, item, ui, editor) {
    if (!editor) return;
    const buttons = queryActionButtons(toolbarMount);
    if (!buttons.actions) return;

    editor.colorBtn = buttons.colorBtn;
    editor.iconBtn = buttons.iconBtn;
    editor.calendarToggleBtn = buttons.calBtn;

    wireSharedActions(buttons, item, { ui, surface: 'popout', editor });

    if (buttons.closeBtn) {
        buttons.closeBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            editor.syncActiveItemFromDom?.();
        });
        buttons.closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editor.closePopout?.();
        });
    }

    if (buttons.windowSizeBtn) {
        attachCardActionButton(buttons.windowSizeBtn, () => {
            editor.toggleWindowSize?.();
        }, { commit: () => editor.syncActiveItemFromDom?.(), defer: false });
    }
}

function bindModalQuickActions(toolbarMount, item, ui, editor) {
    if (!editor) return;

    const buttons = queryActionButtons(toolbarMount);
    if (!buttons.actions) return;

    editor.archiveBtn = buttons.archiveBtn;
    editor.colorBtn = buttons.colorBtn;
    editor.iconBtn = buttons.iconBtn;
    editor.calendarToggleBtn = buttons.calBtn;

    if (buttons.archiveBtn) {
        attachCardActionButton(buttons.archiveBtn, () => editor.emitArchiveAction(), { commit: () => editor.syncActiveItemFromDom() });
    }

    if (buttons.closeBtn) {
        buttons.closeBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
            // Capture the active inline edit before this button steals focus.
            editor.syncActiveItemFromDom();
        });
        buttons.closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editor.commitAndClose();
        });
    }

    wireSharedActions(buttons, item, { ui, surface: 'modal', editor });

    // Pencil matches board layout; in the modal it closes (already editing).
    attachCardActionButton(buttons.editBtn, () => {
        editor.commitAndClose();
    }, { commit: () => editor.syncActiveItemFromDom() });
}

/**
 * Renders the quick actions zone HTML.
 * @param {object} config - Configuration object
 * @param {string} config.sortBy - Current sort mode ('grid' or 'freeform')
 * @param {string} config.workspaceMode - Current workspace mode ('notes' or 'drawing')
 * @param {boolean} config.fileCabinet - Whether file cabinet is active
 * @param {boolean} config.isLoggedIn - Whether user is logged in
 * @param {object} handlers - Event handlers object
 * @param {function} handlers.onToggleOverlay - Toggle overlay click handler
 * @param {function} handlers.onToggleFileCabinet - Toggle file cabinet click handler
 * @param {function} handlers.onToggleDrawing - Toggle drawing mode click handler
 * @param {function} handlers.onAddCategory - Add category click handler
 * @param {function} handlers.onCloudClick - Cloud button click handler
 * @param {function} handlers.onCloudExport - Cloud export click handler
 * @param {function} handlers.onCloudImport - Cloud import click handler
 * @param {function} handlers.onExportDb - Export DB click handler
 * @param {function} handlers.onExportAllTxt - Export all as TXT click handler
 * @param {function} handlers.onImportDb - Import DB click handler
 * @param {function} handlers.onLogout - Logout click handler
 * @param {function} handlers.onLogin - Login click handler
 */
export function renderQuickActions({
    sortBy,
    workspaceMode,
    fileCabinet,
    isLoggedIn,
    handlers = {}
} = {}) {
    const zone = getAppElementById('quick-actions-zone');
    if (!zone) return;

    const drawingActive = workspaceMode === 'drawing';
    const fileCabinetActive = !drawingActive && fileCabinet;
    const overlayActive = !drawingActive && BoardOverlay.isEnabled();
    const fileCabinetTitle = fileCabinetActive ? 'Hide File Cabinet' : 'File Cabinet';
    const viewTitle = fileCabinetActive
        ? (overlayActive ? 'Snap bottom to bento' : 'Allow overlap on bottom')
        : (overlayActive ? 'Snap to bento grid' : 'Allow overlap');
    const viewIcon = overlayActive ? ACTION_ICONS.viewGrid : ACTION_ICONS.viewFree;

    const workspaceGroup = `
        <button class="btn btn--compact btn--icon ${overlayActive ? 'active' : ''}" id="btn-freeform-toggle" title="${viewTitle}" aria-label="${viewTitle}" aria-pressed="${overlayActive ? 'true' : 'false'}">${viewIcon}</button>
        <button class="btn btn--compact btn--icon ${fileCabinetActive ? 'active' : ''}" id="btn-file-cabinet-toggle" title="${fileCabinetTitle}" aria-label="${fileCabinetTitle}" aria-pressed="${fileCabinetActive ? 'true' : 'false'}">${ACTION_ICONS.viewFileCabinet}</button>
        <button class="btn btn--compact btn--icon ${drawingActive ? 'active' : ''}" id="btn-drawing-mode" title="magicCanvas" aria-label="magicCanvas">${ACTION_ICONS.drawingPencil}</button>
    `;

    const historyGroup = `
        <button type="button" id="btn-undo" class="btn btn--compact btn--icon is-hidden" disabled title="Undo (Ctrl+Z)" aria-label="Undo"></button>
        <button type="button" id="btn-redo" class="btn btn--compact btn--icon is-hidden" disabled title="Redo (Ctrl+Y)" aria-label="Redo"></button>
    `;

    const displayGroup = `
        <button type="button" id="btn-display-options" class="btn btn--compact btn--icon" title="Display options" aria-label="Display options" aria-expanded="false" aria-haspopup="menu"></button>
    `;

    const layoutGroup = `
        <button type="button" id="btn-board-sort" class="btn btn--compact btn--icon is-hidden" title="Sort board" aria-label="Sort board" aria-expanded="false" aria-haspopup="menu"></button>
        <button type="button" id="btn-layout-reset" class="btn btn--compact btn--icon is-hidden" title="Reset" aria-label="Reset"></button>
    `;

    const shellGroup = `
        <button type="button" id="btn-fullscreen" class="btn btn--compact btn--icon" title="Full screen" aria-label="Full screen" aria-pressed="false"></button>
        <button type="button" id="btn-show-clock" class="btn btn--compact btn--icon is-hidden" title="Show clock" aria-label="Show clock"></button>
    `;

    if (!isLoggedIn) {
        zone.innerHTML = `${workspaceGroup}${historyGroup}${displayGroup}${layoutGroup}${shellGroup}
            <button type="button" class="btn btn--compact btn--block" id="btn-auth-login">Login</button>`;
    } else {
        const accountGroup = `
            <button type="button" class="btn btn--compact btn--icon" id="btn-add-category" title="Add category" aria-label="Add category">${ACTION_ICONS.category}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-media-library" title="Open media library" aria-label="Open media library">${ACTION_ICONS.mediaLibrary}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-cloud" title="Cloud backup" aria-label="Cloud backup">${ACTION_ICONS.cloud}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-cloud-export" data-enabled-title="Export to cloud" title="Connect cloud first (Cloud icon)" aria-label="Export to cloud" disabled>${ACTION_ICONS.cloudExport}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-cloud-import" data-enabled-title="Import from cloud" title="Connect cloud first (Cloud icon)" aria-label="Import from cloud" disabled>${ACTION_ICONS.cloudImport}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-export-db" title="Export backup" aria-label="Export backup">${ACTION_ICONS.export}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-export-txt" title="Export all as TXT" aria-label="Export all as TXT">${ACTION_ICONS.exportTxt}</button>
            <button type="button" class="btn btn--compact btn--icon schedule-export-btn" id="btn-schedule-export" title="Scheduled backup" aria-label="Scheduled backup">${ACTION_ICONS.scheduleExport}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-import-db" title="Import backup" aria-label="Import backup">${ACTION_ICONS.import}</button>
            <button type="button" class="btn btn--compact btn--icon btn--icon-danger" id="btn-auth-logout" title="Logout" aria-label="Logout">${ACTION_ICONS.logout}</button>
        `;
        zone.innerHTML = `${workspaceGroup}${historyGroup}${displayGroup}${layoutGroup}${shellGroup}${accountGroup}`;
    }

    bindQuickActionHandlers(handlers);
}

function bindQuickActionHandlers(handlers = {}) {
    const {
        onToggleOverlay,
        onToggleFileCabinet,
        onToggleDrawing,
        onAddCategory,
        onCloudClick,
        onCloudExport,
        onCloudImport,
        onExportDb,
        onExportAllTxt,
        onScheduleExport,
        onImportDb,
        onLogout,
        onLogin,
        onLayoutReset
    } = handlers;

    const undoBtn = document.getElementById('btn-undo');
    const redoBtn = document.getElementById('btn-redo');
    if (undoBtn) undoBtn.innerHTML = ACTION_ICONS.undo;
    if (redoBtn) redoBtn.innerHTML = ACTION_ICONS.redo;

    UndoManager.rebindToolbar();

    const displayBtn = document.getElementById('btn-display-options');
    if (displayBtn) displayBtn.innerHTML = ACTION_ICONS.displayOptions;
    DisplayOptions.rebindTrigger();
    ClockStyle.rebindTrigger();

    const sortBtn = document.getElementById('btn-board-sort');
    if (sortBtn) sortBtn.innerHTML = ACTION_ICONS.sortAlpha;
    BoardSort.rebindTrigger();
    Fullscreen.rebindMainButton();

    document.getElementById('btn-freeform-toggle')?.addEventListener('click', onToggleOverlay);
    document.getElementById('btn-file-cabinet-toggle')?.addEventListener('click', onToggleFileCabinet);
    document.getElementById('btn-drawing-mode')?.addEventListener('click', onToggleDrawing);
    document.getElementById('btn-add-category')?.addEventListener('click', onAddCategory);
    document.getElementById('btn-media-library')?.addEventListener('click', () => {
        MediaLibraryOverlay.open();
    });
    document.getElementById('btn-cloud')?.addEventListener('click', onCloudClick);
    document.getElementById('btn-cloud-export')?.addEventListener('click', onCloudExport);
    document.getElementById('btn-cloud-import')?.addEventListener('click', onCloudImport);
    document.getElementById('btn-export-db')?.addEventListener('click', onExportDb);
    document.getElementById('btn-export-txt')?.addEventListener('click', onExportAllTxt);
    document.getElementById('btn-schedule-export')?.addEventListener('click', onScheduleExport);
    document.getElementById('btn-import-db')?.addEventListener('click', onImportDb);
    document.getElementById('btn-auth-logout')?.addEventListener('click', onLogout);
    document.getElementById('btn-auth-login')?.addEventListener('click', onLogin);
    document.getElementById('btn-layout-reset')?.addEventListener('click', onLayoutReset);
}