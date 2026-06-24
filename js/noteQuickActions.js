/** @module {"owns":"board + modal note quick-action DOM binding", "related":["noteSurface.js","ui.js","editor.js"]} */
import { ColorPicker, PALETTE_NOTE, resolveNoteColor, THEME_DEFAULT_COLOR } from './colorPicker.js';
import { copyPlainTextToClipboard } from './clipboard.js';
import { itemToPlainCopyText } from './noteBodyConversion.js';
import { CARD_ICONS } from './icons.js';
import { NoteSurface } from './noteSurface.js';
import { isDesktopCard } from './ui.js';

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
            ui.hideFromBoard(item);
        } else {
            editor.syncActiveItemFromDom();
            Object.assign(item, editor.collectFormData());
            ui.hideFromBoard(item);
        }
    });

    if (calBtn) {
        ui.syncCalendarButtonUI(item, calBtn);
        attachCardActionButton(calBtn, () => {
            if (surface === 'board') {
                NoteSurface.commitFocusedInlineField(card, item);
                ui.toggleCardCalendar(item, calBtn);
            } else {
                editor.syncActiveItemFromDom();
                ui.toggleCardCalendar(item, calBtn);
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
