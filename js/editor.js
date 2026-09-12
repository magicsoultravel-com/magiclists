/** @module {"owns":"modal note editor overlay, save flow", "related":["noteSurface.js","noteQuickActions.js","editorModalChrome.js","sheet.js"], "events":["item:selected_for_edit","editor:reveal_on_board"]} */
import { applyCardTheme } from './cardTheme.js';
import { ColorPicker, PALETTE_NOTE, randomNoteColor, resolveNoteColor } from './colorPicker.js';
import { EditorModalChrome } from './editorModalChrome.js';
import { CARD_ICONS } from './icons.js';
import {
    combineDateTime,
    createDefaultNote,
    createNoteId,
    defaultStartDateTimeNow,
    formatLocalDate,
    formatLocalTime,
    noteHasSavableContent,
    normalizeItemForSave,
    parseStoredDateTime
} from './noteModel.js';
import {
    mergeModalOwnedOntoLive,
    patchSharedFieldsOntoDraft,
    ensureCanvasVisibleIfContent
} from './noteFieldOwnership.js';
import { getCardRenderContext } from './categories.js';
import { bindNoteQuickActions } from './noteQuickActions.js';
import { NoteSurface } from './noteSurface.js';
import { NotePopoutBridge } from './notePopoutBridge.js';
import { UI } from './ui.js';
import { showAppToast } from './toast.js';
import { escapeQuotes } from './domEscape.js';
import {
    attachSheetInteractions,
    defaultSheetDimsForTemplate,
    ensureItemSheet,
    isSheetTemplateActive,
    resolveNoteTemplate,
    resolveEditorBodyLayoutUnchecked
} from './sheet.js';

export const Editor = {
    overlay: null,
    mountZone: null,
    activeItem: null,
    availableCategories: [],
    autoSaveTimer: null,
    metaLabelTimer: null,
    hasUserInteracted: false,
    isNewUnsavedNote: false,
    lastPersistedItem: null,
    fabClickListenerBound: false,
    /** @type {((noteId: string) => object|null)|null} */
    liveItemResolver: null,

    /**
     * Register how the modal resolves the live AppState note for reconciliation.
     * @param {(noteId: string) => object|null} fn
     */
    setLiveItemResolver(fn) {
        this.liveItemResolver = typeof fn === 'function' ? fn : null;
    },

    /**
     * @param {string|null|undefined} [noteId]
     * @returns {object|null}
     */
    resolveLiveItem(noteId = this.activeItem?.id) {
        if (!noteId || !this.liveItemResolver) return null;
        try {
            return this.liveItemResolver(noteId) || null;
        } catch {
            return null;
        }
    },

    /**
     * Patch Shared fields from live onto the draft and refresh media/canvas UI only.
     * @param {object} [liveItem]
     * @returns {boolean}
     */
    applySharedFromLive(liveItem) {
        if (!this.activeItem?.id) return false;
        const live = liveItem || this.resolveLiveItem(this.activeItem.id);
        if (!live || live.id !== this.activeItem.id) return false;
        const unhid = ensureCanvasVisibleIfContent(live);
        const changed = patchSharedFieldsOntoDraft(this.activeItem, live) || unhid;
        if (!changed) return false;
        import('./noteAttachmentsUi.js').then(({ syncNoteAttachmentsDom }) => {
            if (this.activeItem?.id === live.id && !this.overlay?.classList.contains('is-hidden')) {
                syncNoteAttachmentsDom(this.activeItem);
            }
        }).catch(() => {});
        return true;
    },

    isColorPickerOpen() {
        if (ColorPicker.eyedropperCleanup) return true;
        return !!(ColorPicker.popover && !ColorPicker.popover.classList.contains('is-hidden'));
    },

    commitAndClose() {
        this.closeAndSave({ scrollToBoard: false });
    },

    approveAndClose() {
        this.closeAndSave({ scrollToBoard: true });
    },

    scheduleEditorSizeLabelUpdate() {
        if (this.metaLabelTimer) clearTimeout(this.metaLabelTimer);
        this.metaLabelTimer = setTimeout(() => {
            this.metaLabelTimer = null;
            this.updateEditorSizeLabel();
        }, 150);
    },
    
    init() {
        this.overlay = document.getElementById('editor-overlay');
        this.mountZone = document.getElementById('modal-form-mount');
        this.toolbarMount = document.getElementById('modal-toolbar-mount');
        this.archiveBtn = null;
        this.colorBtn = null;
        this.calendarToggleBtn = null;
        this.approveBtn = document.getElementById('modal-approve-btn');

        this.approveBtn?.addEventListener('click', () => this.approveAndClose());
        this.overlay?.addEventListener('mousedown', (e) => {
            if (e.target !== this.overlay) return;
            this.commitAndClose();
        });

        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this.overlay?.classList.contains('is-open')) return;
            if (this.isColorPickerOpen()) return;
            e.preventDefault();
            e.stopPropagation();
            this.commitAndClose();
        }, true);

        // Bind FAB click handler for creating new notes
        if (!this.fabClickListenerBound) {
            const fab = document.getElementById('fab-create');
            if (fab) {
                fab.addEventListener('click', () => this.handleCreateNote());
                this.fabClickListenerBound = true;
            }
        }
    },

    handleCreateNote() {
        // Check for admin session token
        const adminToken = localStorage.getItem('admin_token');
        if (!adminToken) {
            alert('Login required to create notes. Use Quick actions → Login.');
            return;
        }

     // Create a blank note with default schema
     const blankNote = createDefaultNote({ backgroundColor: randomNoteColor() });

        // Open the editor with the blank note
        this.open(blankNote);
    },
    
    open(item = null, categoriesList = []) {
        if (item?.id && NotePopoutBridge.isClaimedByOther(item.id)) {
            NotePopoutBridge.openOrFocus(item.id);
            showAppToast('Note is open in a popout');
            return;
        }

        // If there's an active item, we need to handle the transition properly
        if (this.activeItem) {
            // Sync to ensure we have the latest DOM state for comparison
            this.syncActiveItemFromDom();

            if (this.activeItem.id !== item?.id) {
                // Switching to a different note - save changes if needed
                const baselineItem = this.lastPersistedItem || JSON.parse(JSON.stringify(this.activeItem));

                const currentData = this.collectFormData({ normalize: true });
                const hasChanges = JSON.stringify(currentData) !== JSON.stringify(baselineItem);
                const shouldPersist = hasChanges
                    || (this.hasUserInteracted && !this.isNewUnsavedNote)
                    || (this.isNewUnsavedNote && noteHasSavableContent(currentData));

                if (shouldPersist) {
                    this.persistNote({ force: true, normalize: true });
                    window.dispatchEvent(new CustomEvent('editor:reveal_on_board', {
                        detail: { item: NoteSurface.snapshotItem(this.activeItem), scrollToBoard: false }
                    }));
                }
            } else {
                // Same note clicked again - edits already synced to activeItem
                return;
            }
}

        this.availableCategories = categoriesList;
        this.hasUserInteracted = false;

        const isNew = !item;
        this.activeItem = item ? NoteSurface.snapshotItem(item) : createDefaultNote({ backgroundColor: randomNoteColor() });
        if (!this.activeItem.editorBodyLayout) {
            this.activeItem.editorBodyLayout = 'both';
        }
        // Repair stuck hidden canvases as soon as the modal opens, and mirror
        // onto the live AppState note so the board card can show Note canvas too.
        {
            const live = item?.id ? this.resolveLiveItem(item.id) : null;
            const liveUnhid = live ? ensureCanvasVisibleIfContent(live) : false;
            const draftUnhid = ensureCanvasVisibleIfContent(this.activeItem);
            if (liveUnhid) {
                patchSharedFieldsOntoDraft(this.activeItem, live);
                NoteSurface.emitItemMutation(live, { preserveView: true, skipRerender: true });
            }
            if (liveUnhid || draftUnhid) {
                import('./noteAttachmentsUi.js').then(({ syncNoteAttachmentsDom }) => {
                    const target = (item?.id && this.resolveLiveItem(item.id)) || this.activeItem;
                    if (target) syncNoteAttachmentsDom(target);
                }).catch(() => {});
            }
        }
        this.isNewUnsavedNote = isNew || !noteHasSavableContent(this.activeItem);
        if (this.activeItem.hideFromCalendar === undefined) {
            this.activeItem.hideFromCalendar = false;
        }
        this.syncEditorTheme(resolveNoteColor(this.activeItem.backgroundColor));
        this.renderForm();
        this.overlay.classList.remove('is-hidden');
        document.body.classList.add('is-editor-modal-open');
        const modal = this.overlay.querySelector('.modal');
        if (modal) modal.classList.add('modal--editor');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.overlay?.classList.add('is-open');
                if (this.isNewUnsavedNote) {
                    if (isSheetTemplateActive(this.activeItem)) {
                        const cell = this.mountZone.querySelector('[data-sheet-cell]');
                        if (cell) cell.focus();
                    } else {
                        const content = this.mountZone.querySelector('[data-field="content"].card-inline-edit');
                        if (content) NoteSurface.focusInlineEdit(content, 'start');
                    }
                }
            });
        });
    },

    animateEditorClose(done) {
        if (!this.overlay) {
            document.body.classList.remove('is-editor-modal-open');
            done();
            return;
        }
        this.overlay.classList.remove('is-open');
        document.body.classList.remove('is-editor-modal-open');
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            this.overlay.classList.add('is-hidden');
            done();
        };
        const timer = setTimeout(finish, 320);
        const onEnd = (e) => {
            if (e.target !== this.overlay) return;
            clearTimeout(timer);
            this.overlay.removeEventListener('transitionend', onEnd);
            finish();
        };
        this.overlay.addEventListener('transitionend', onEnd);
    },
    
    markInteracted() {
        this.hasUserInteracted = true;
    },
    
    triggerAutoSave() {
        if (!this.hasUserInteracted) return;
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = setTimeout(() => {
            this.autoSave();
        }, 1000);
    },
    
    persistNote({ force = false, normalize = false } = {}) {
        if (!this.activeItem) return false;
        if (!force && !this.hasUserInteracted) return false;

        const currentData = this.collectFormData({ normalize });
        if (!force && !noteHasSavableContent(currentData) && this.isNewUnsavedNote) return false;

        // Initialize lastPersistedItem if not set
        if (!this.lastPersistedItem) {
            this.lastPersistedItem = JSON.parse(JSON.stringify(this.activeItem));
        }

        const unchanged = JSON.stringify(currentData) === JSON.stringify(this.lastPersistedItem);
        if (!force && unchanged) return true;

        this.isNewUnsavedNote = false;
        // Align draft ModalOwned with the merged payload, then deep-clone Shared
        // from the merge result so the draft never aliases the live note.
        Object.assign(this.activeItem, currentData);
        patchSharedFieldsOntoDraft(this.activeItem, currentData);
        // Update lastPersistedItem after successful persist
        this.lastPersistedItem = JSON.parse(JSON.stringify(currentData));
        // skipRerender + preserveView makes preserveEmptySteps true so empty
        // checklist items are preserved — matching the surface/board save path.
        NoteSurface.emitItemMutation(currentData, {
            preserveView: true,
            skipRerender: true,
            mergeKey: 'modal-owned-persist'
        });
        return true;
    },

    autoSave() {
        if (!this.hasUserInteracted) return;
        if (!this.activeItem) return;
        if (this.persistNote()) {
            console.log('Auto-saved at', new Date().toLocaleTimeString());
        }
    },
    
    updateCalendarToggleUI() {
        if (!this.calendarToggleBtn || !this.activeItem) return;
        UI.syncCalendarButtonUI(this.activeItem, this.calendarToggleBtn);
    },

    syncActiveItemFromDom() {
        if (!this.activeItem || !this.mountZone) return;
        NoteSurface.syncItemBodyFromDom(this.mountZone, this.activeItem);
    },

    /**
     * Sync ModalOwned from DOM into the draft, then merge onto the live item
     * so Shared/External fields are never clobbered by a stale draft snapshot.
     */
    collectFormData({ normalize = false } = {}) {
        this.syncActiveItemFromDom();
        const templateEl = document.getElementById('edit-template');
        if (templateEl) {
            const val = templateEl.value || 'default';
            if (val === 'default') delete this.activeItem.noteTemplate;
            else this.activeItem.noteTemplate = val;
        }
        const finalBgColor = resolveNoteColor(document.getElementById('edit-bg-color-value')?.value);
        const allSteps = this.activeItem.steps || [];
        // Preserve empty checklist items so they are not destroyed on save —
        // matching the surface/board save path. Only the type is derived from
        // the presence of any steps (including empty ones).
        const steps = allSteps;

        // Write ModalOwned onto the draft first (source for the overlay).
        this.activeItem.title = this.activeItem.title || '';
        this.activeItem.type = steps.length > 0 ? 'checklist' : 'note';
        this.activeItem.visibility = document.getElementById('edit-visibility')?.value || 'private';
        this.activeItem.status = document.getElementById('edit-status')?.value || 'active';
        this.activeItem.content = this.activeItem.content || '';
        this.activeItem.steps = steps;
        this.activeItem.categories = (() => {
            const cat = document.getElementById('edit-category')?.value?.trim() || '';
            return cat ? [cat] : [];
        })();
        this.activeItem.backgroundColor = finalBgColor;
        this.activeItem.startDateTime = combineDateTime(
            document.getElementById('edit-start-date')?.value || '',
            document.getElementById('edit-start-time')?.value || ''
        );
        this.activeItem.endDateTime = combineDateTime(
            document.getElementById('edit-end-date')?.value || '',
            document.getElementById('edit-end-time')?.value || ''
        );
        this.activeItem.isRecurring = this.activeItem.isRecurring === true;
        this.activeItem.hideFromCalendar = this.activeItem.hideFromCalendar === true;
        this.activeItem.hiddenFromBoard = this.activeItem.hiddenFromBoard === true;
        this.activeItem.editorBodyLayout = resolveEditorBodyLayoutUnchecked(this.activeItem);
        if (this.activeItem.noteTemplate === 'default' || !this.activeItem.noteTemplate) {
            delete this.activeItem.noteTemplate;
        }

        const live = this.resolveLiveItem(this.activeItem.id);
        const data = mergeModalOwnedOntoLive(live, this.activeItem);
        return normalize ? normalizeItemForSave(data, { preserveEmptySteps: true }) : data;
    },
    
    resetEditorState() {
        this.mountZone.innerHTML = '';
        this.syncEditorTheme('');
        this.activeItem = null;
        this.hasUserInteracted = false;
        this.isNewUnsavedNote = false;
        this.lastPersistedItem = null;
        const modal = this.overlay?.querySelector('.modal');
        if (modal) EditorModalChrome.teardown(modal);
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
        if (this.metaLabelTimer) clearTimeout(this.metaLabelTimer);
    },

    closeAndSave({ scrollToBoard = false } = {}) {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }
        if (this.metaLabelTimer) {
            clearTimeout(this.metaLabelTimer);
            this.metaLabelTimer = null;
        }

        let savedItem = null;
        if (this.activeItem) {
            const currentData = this.collectFormData({ normalize: true });
            let shouldPersist = noteHasSavableContent(currentData)
                || (this.hasUserInteracted && !this.isNewUnsavedNote);

            if (!shouldPersist && this.isNewUnsavedNote && !noteHasSavableContent(currentData)) {
                const saveEmpty = window.confirm(
                    'This note is empty. Save it anyway?\n\nOK — save empty note\nCancel — discard'
                );
                if (!saveEmpty) {
                    this.animateEditorClose(() => this.resetEditorState());
                    return;
                }
                shouldPersist = true;
            }

            if (shouldPersist) {
                this.persistNote({ force: true, normalize: true });
                savedItem = NoteSurface.snapshotItem(this.activeItem);
            }
        }

        this.animateEditorClose(() => {
            this.resetEditorState();
            // Always publish the saved note back onto the board so the card DOM
            // matches AppState/localStorage. scrollToBoard only controls scrolling.
            if (savedItem) {
                window.dispatchEvent(new CustomEvent('editor:reveal_on_board', {
                    detail: { item: savedItem, scrollToBoard }
                }));
            }
        });
    },
    
    close() {
        this.animateEditorClose(() => this.resetEditorState());
    },
    
    bindDateInputDefaults(dateId, timeId, { defaultTimeOnFocus = true } = {}) {
        const dateEl = document.getElementById(dateId);
        const timeEl = document.getElementById(timeId);
        if (!dateEl) return;

        dateEl.addEventListener('focus', () => {
            if (!dateEl.value) dateEl.value = formatLocalDate();
        });
        if (!timeEl || !defaultTimeOnFocus) return;
        timeEl.addEventListener('focus', () => {
            if (!timeEl.value && dateEl.value) timeEl.value = formatLocalTime();
        });
    },

    refreshEditorNoteBody() {
        const body = document.getElementById('editor-note-body');
        if (!body || !this.activeItem) return;
        // Guard against mid-keystroke text syncing to prevent line duplication
        if (!body.dataset.pendingFocusStepId && !body.querySelector('.card-inline-edit:focus')) {
            this.syncActiveItemFromDom();
        }
        const shell = this.mountZone?.querySelector('.editor-note-shell');
        const onEditorChange = () => {
            this.markInteracted();
            this.scheduleEditorSizeLabelUpdate();
            this.syncActiveItemFromDom();
            const shell = this.mountZone?.querySelector('.editor-note-shell');
            if (shell && this.activeItem) NoteSurface.updateConvertButtons(shell, this.activeItem);
            this.triggerAutoSave();
        };
        NoteSurface.refreshNoteBody(body, this.activeItem, {
            mountZone: this.mountZone,
            shell,
            localOnly: true,
            richEdit: true,
            onChange: onEditorChange,
            refresh: () => this.refreshEditorNoteBody(),
            sheetInteractionOpts: shell
                ? NoteSurface.buildSheetInteractionOptions(shell, this.activeItem, {
                    localOnly: true,
                    onChange: onEditorChange,
                    refresh: () => this.refreshEditorNoteBody()
                })
                : null
        });
    },

    renderForm() {
        const item = this.activeItem;
        const { targetCatName: activeCategory, categoryColor } = getCardRenderContext(item, this.availableCategories);
        const categoryOptionsHtml = `<option value="" ${!activeCategory ? 'selected' : ''}>—</option>` +
            this.availableCategories.map(cat => {
                const catName = typeof cat === 'string' ? cat : cat.name;
                const selected = activeCategory && catName.toLowerCase() === activeCategory.toLowerCase();
                return `<option value="${escapeQuotes(catName)}" ${selected ? 'selected' : ''}>${catName}</option>`;
            }).join('');
        const isExistingItem = item.created_at !== undefined;
        if (this.toolbarMount) {
            this.toolbarMount.innerHTML = NoteSurface.buildNoteQuickActionsHtml(item, {
                surface: 'modal',
                pinned: UI.isBoardPinned(item.id),
                showDrag: true,
                showArchive: isExistingItem,
                poppedOut: NotePopoutBridge.isPoppedOut(item.id)
            });
            bindNoteQuickActions(this.toolbarMount, item, {
                surface: 'modal',
                ui: UI,
                editor: this
            });
        }
        this.updateDoneButtonUI();
        this.updateArchiveToggleUI();
        this.updateCalendarToggleUI();
        const startParts = parseStoredDateTime(item.startDateTime || '');
        const endParts = parseStoredDateTime(item.endDateTime || '');

        this.mountZone.innerHTML = NoteSurface.buildNoteEditorShell(item, {
            canEdit: true,
            inModalEditor: true,
            showConfig: true,
            showFormat: !isSheetTemplateActive(item),
            richEdit: true,
            targetCatName: activeCategory,
            categoryColor,
            categoryOptionsHtml,
            startParts,
            endParts,
            bodyId: 'editor-note-body'
        });

        const onEditorChange = () => {
            this.markInteracted();
            this.scheduleEditorSizeLabelUpdate();
            this.syncActiveItemFromDom();
            const shell = this.mountZone?.querySelector('.editor-note-shell');
            if (shell && this.activeItem) NoteSurface.updateConvertButtons(shell, this.activeItem);
            this.triggerAutoSave();
        };

        NoteSurface.bindNoteEditorShell(this.mountZone, item, {
            showConfig: true,
            showFormat: !isSheetTemplateActive(item),
            richEdit: true,
            localOnly: true,
            refresh: () => this.refreshEditorNoteBody(),
            onChange: onEditorChange,
            onConfigChange: onEditorChange,
            onStatusChange: () => this.updateArchiveToggleUI(),
            bindDateDefaults: (dateId, timeId) => this.bindDateInputDefaults(dateId, timeId)
        });

        const templateEl = document.getElementById('edit-template');
        if (templateEl) {
            templateEl.addEventListener('change', () => {
                if (!this.activeItem) return;
                this.syncActiveItemFromDom();
                const next = templateEl.value || 'default';
                const prev = resolveNoteTemplate(this.activeItem);
                if (next === prev) {
                    onEditorChange();
                    return;
                }
                if (next === 'default') {
                    delete this.activeItem.noteTemplate;
                } else {
                    this.activeItem.noteTemplate = next;
                    ensureItemSheet(this.activeItem, defaultSheetDimsForTemplate(next));
                }
                this.markInteracted();
                this.renderForm();
                this.triggerAutoSave();
            });
        }

        this.syncColorFromItem(item);
        const modal = this.overlay?.querySelector('.modal');
        if (modal) {
            EditorModalChrome.init(modal);
        }
    },

    syncEditorTheme(backgroundColor) {
        const shell = this.mountZone?.querySelector('.editor-note-shell');
        if (shell) {
            applyCardTheme(shell, backgroundColor || '', { paintBackground: true });
        }
    },

    updateDoneButtonUI() {
        const doneTitle = 'Show on board';
        const doneIcon = CARD_ICONS.collapse;
        const closeBtn = this.toolbarMount?.querySelector('.card-act--close');
        if (closeBtn) {
            closeBtn.innerHTML = doneIcon;
            closeBtn.title = doneTitle;
            closeBtn.setAttribute('aria-label', doneTitle);
        }
        if (this.approveBtn) {
            this.approveBtn.innerHTML = doneIcon;
            this.approveBtn.title = doneTitle;
            this.approveBtn.setAttribute('aria-label', doneTitle);
        }
    },

    updateEditorSizeLabel() {
        try {
            const shell = this.mountZone?.querySelector('.editor-note-shell');
            const data = this.collectFormData();
            if (shell) NoteSurface.updateNoteMetaStats(shell, data);
        } catch {
            /* form not ready */
        }
    },

    syncColorFromItem(item) {
        const hidden = document.getElementById('edit-bg-color-value');
        if (!hidden || !item) return;
        const color = resolveNoteColor(item.backgroundColor);
        hidden.value = color;
        if (this.activeItem) this.activeItem.backgroundColor = color;
        this.syncEditorTheme(color);
    },

    applyNoteColor(value, { silent = false } = {}) {
        const hidden = document.getElementById('edit-bg-color-value');
        if (!hidden) return;
        const color = resolveNoteColor(value);
        hidden.value = color;
        if (this.activeItem) this.activeItem.backgroundColor = color;
        this.syncEditorTheme(color);
        if (!silent) {
            this.markInteracted();
            this.triggerAutoSave();
        }
    },

    openColorPicker() {
        if (!this.colorBtn) return;
        const hidden = document.getElementById('edit-bg-color-value');
        ColorPicker.open({
            anchor: this.colorBtn,
            presets: PALETTE_NOTE,
            value: hidden?.value || resolveNoteColor(this.activeItem?.backgroundColor),
            align: 'end',
            onSelect: (color) => this.applyNoteColor(color)
        });
    },

    openEmojiPicker() {
        if (!this.iconBtn || !this.activeItem) return;
        const root = this.mountZone?.querySelector('.editor-note-shell') || this.mountZone;
        NoteSurface.openEmojiPickerForNote(root, this.iconBtn, this.activeItem, {
            localOnly: true,
            onChange: () => {
                this.markInteracted();
                this.syncActiveItemFromDom();
                this.triggerAutoSave();
            }
        });
    },

    updateArchiveToggleUI() {
        if (!this.archiveBtn || !this.activeItem) return;
        const isArchived = this.activeItem.status === 'archived';
        this.archiveBtn.innerHTML = isArchived ? CARD_ICONS.unarchive : CARD_ICONS.delete;
        this.archiveBtn.title = isArchived ? 'Restore from Archive' : 'Move to Archive';
        this.archiveBtn.setAttribute('aria-label', this.archiveBtn.title);
        this.archiveBtn.classList.toggle('card-act--archive-on', isArchived);
    },

    emitArchiveAction() {
        if (!this.activeItem) return;
        const isArchived = this.activeItem.status === 'archived';
        const label = this.activeItem.title?.trim() || 'this note';
        const verb = isArchived ? 'Restore' : 'Archive';
        if (!confirm(`${verb} "${label}"? You can undo afterwards.`)) return;

        this.markInteracted();
        const beforeItem = NoteSurface.snapshotItem(this.activeItem);
        const data = this.collectFormData({ normalize: true });
        data.status = isArchived ? 'active' : 'archived';
        Object.assign(this.activeItem, data);
        // preserveEmptySteps: true so archiving/restoring never strips empty
        // checklist steps from old imported notes (see noteModel normalizeItemForSave).
        NoteSurface.emitItemMutation(this.activeItem, { preserveView: false, beforeItem, preserveEmptySteps: true });
        this.close();
    },
    
};