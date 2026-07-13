/** @module {"owns":"board + modal note quick-action DOM binding", "related":["noteSurface.js","ui.js","editor.js"]} */
import { ColorPicker, PALETTE_NOTE, resolveNoteColor, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import { itemToPlainCopyText } from './noteBodyConversion.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { NoteSurface } from './noteSurface.js';
import { isDesktopCard } from './ui.js';
import { DisplayOptions } from './displayOptions.js';
import { ClockStyle } from './clockStyle.js';
import { BoardOperations } from './boardOperations.js';
import { BoardSort } from './boardSort.js';
import { Fullscreen } from './fullscreen.js';
import { UndoManager } from './undo.js';
import { BoardOverlay } from './boardOverlay.js';

function attachCardActionButton(btn, handler) {
    if (!btn) return;
    let handledByMouse = false;
    btn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        handledByMouse = true;
        handler(e);
    });
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (handledByMouse) {
            handledByMouse = false;
            return;
        }
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
        iconBtn: actions.querySelector('.card-act--emoji'),
        hideBtn: actions.querySelector('.card-act--hide'),
        editBtn: actions.querySelector('.card-act--edit'),
        calBtn: actions.querySelector('.card-act--cal'),
        closeBtn: actions.querySelector('.card-act--close')
    };
}

function wireSharedActions(buttons, item, { ui, surface, card, editor } = {}) {
    const { copyBtn, pinBtn, dragBtn, colorBtn, iconBtn, hideBtn, calBtn } = buttons;
    const iconRoot = surface === 'board'
        ? (card?.querySelector('.editor-note-shell') || card)
        : (editor?.mountZone?.querySelector('.editor-note-shell') || editor?.mountZone);

    attachCardActionButton(copyBtn, async () => {
        if (surface === 'board') {
            NoteSurface.commitFocusedInlineField(card, item);
            const shell = card.querySelector('.editor-note-shell');
            if (shell) NoteSurface.syncItemBodyFromDom(shell, item);
            const ok = await copyPlainTextToClipboard(itemToPlainCopyText(item));
            if (ok) NoteSurface.flashCopyFeedback(copyBtn);
            else NoteSurface.flashCopyFeedback(copyBtn, 'Copy failed', { failed: true });
        } else {
            editor.syncActiveItemFromDom();
            const data = editor.collectFormData();
            const ok = await copyPlainTextToClipboard(itemToPlainCopyText(data));
            if (ok) NoteSurface.flashCopyFeedback(copyBtn);
            else NoteSurface.flashCopyFeedback(copyBtn, 'Copy failed', { failed: true });
        }
    });

    attachCardActionButton(pinBtn, () => {
        const pinned = ui.toggleBoardPin(item.id);
        if (surface === 'board') ui.syncBoardPinClass(card);
        syncPinButton(pinBtn, pinned, dragBtn);
    });

    attachCardActionButton(colorBtn, () => {
        if (surface === 'board') {
            NoteSurface.commitFocusedInlineField(card, item);
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
                    ui.applyItemCardTheme(card, item);
                }
            });
        } else {
            editor.openColorPicker();
        }
    });

    attachCardActionButton(iconBtn, () => {
        if (surface === 'board') {
            NoteSurface.commitFocusedInlineField(card, item);
            if (isDesktopCard(card)) ui.raiseDesktopCard(card);
            if (!localStorage.getItem('admin_token')) return;
            NoteSurface.openEmojiPickerForNote(iconRoot, iconBtn, item);
        } else {
            editor.openEmojiPicker();
        }
    });

    attachCardActionButton(hideBtn, () => {
        if (surface === 'board') {
            NoteSurface.commitFocusedInlineField(card, item);
            BoardOperations.hideFromBoard(item);
        } else {
            editor.syncActiveItemFromDom();
            Object.assign(item, editor.collectFormData());
            BoardOperations.hideFromBoard(item);
        }
    });

    if (calBtn) {
        BoardOperations.syncCalendarButtonUI(item, calBtn);
        attachCardActionButton(calBtn, () => {
            if (surface === 'board') {
                NoteSurface.commitFocusedInlineField(card, item);
                BoardOperations.toggleCardCalendar(item, calBtn);
            } else {
                editor.syncActiveItemFromDom();
                BoardOperations.toggleCardCalendar(item, calBtn);
                editor.activeItem.hideFromCalendar = item.hideFromCalendar;
                editor.markInteracted();
                editor.triggerAutoSave();
            }
        });
    }
}

/**
 * @param {HTMLElement} mount — board card or modal toolbar mount
 * @param {object} item
 * @param {{ surface: 'board'|'modal', ui: object, card?: HTMLElement, ctx?: object, editor?: object }} opts
 */
export function bindNoteQuickActions(mount, item, { surface, ui, card, ctx, editor } = {}) {
    if (!mount || !item || !ui) return;

    if (surface === 'modal') {
        bindModalQuickActions(mount, item, ui, editor);
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
        });
        buttons.toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            delete card.dataset.skipExpand;
            if (ctx) ui.applyTileZoneToggle(card, item, { ...ctx, fromToolbar: true });
        });
    }

    attachCardActionButton(buttons.editBtn, () => {
        NoteSurface.commitFocusedInlineField(card, item);
        if (isDesktopCard(card)) ui.raiseDesktopCard(card);
        if (card.dataset.skipExpand) {
            delete card.dataset.skipExpand;
            return;
        }
        if (!localStorage.getItem('admin_token')) return;
        window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: { item } }));
    });
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
        attachCardActionButton(buttons.archiveBtn, () => editor.emitArchiveAction());
    }

    if (buttons.closeBtn) {
        buttons.closeBtn.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            e.stopPropagation();
        });
        buttons.closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            editor.commitAndClose();
        });
    }

    wireSharedActions(buttons, item, { ui, surface: 'modal', editor });

    attachCardActionButton(buttons.editBtn, () => {
        const titleEl = editor.mountZone?.querySelector('[data-field="title"]');
        if (titleEl) NoteSurface.focusInlineEdit(titleEl, 'end');
    });
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
    const zone = document.getElementById('quick-actions-zone');
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
            <button type="button" class="btn btn--compact btn--icon" id="btn-cloud" title="Cloud backup" aria-label="Cloud backup">${ACTION_ICONS.cloud}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-cloud-export" data-enabled-title="Export to cloud" title="Connect cloud first (Cloud icon)" aria-label="Export to cloud" disabled>${ACTION_ICONS.cloudExport}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-cloud-import" data-enabled-title="Import from cloud" title="Connect cloud first (Cloud icon)" aria-label="Import from cloud" disabled>${ACTION_ICONS.cloudImport}</button>
            <button type="button" class="btn btn--compact btn--icon" id="btn-export-db" title="Export backup" aria-label="Export backup">${ACTION_ICONS.export}</button>
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
    document.getElementById('btn-cloud')?.addEventListener('click', onCloudClick);
    document.getElementById('btn-cloud-export')?.addEventListener('click', onCloudExport);
    document.getElementById('btn-cloud-import')?.addEventListener('click', onCloudImport);
    document.getElementById('btn-export-db')?.addEventListener('click', onExportDb);
    document.getElementById('btn-import-db')?.addEventListener('click', onImportDb);
    document.getElementById('btn-auth-logout')?.addEventListener('click', onLogout);
    document.getElementById('btn-auth-login')?.addEventListener('click', onLogin);
    document.getElementById('btn-layout-reset')?.addEventListener('click', onLayoutReset);
}
