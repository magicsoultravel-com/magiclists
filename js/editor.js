import { applyCardTheme } from './cardTheme.js';
import { ColorPicker, PALETTE_NOTE, randomNoteColor, resolveNoteColor } from './colorPicker.js';
import { EditorModalChrome } from './editorModalChrome.js';
import { stripRichText } from './richText.js';
import { CARD_ICONS } from './icons.js';
import {
    createNoteId,
    defaultStartDateTimeNow,
    noteHasSavableContent,
    normalizeItemForSave
} from './noteModel.js';
import { NoteSurface } from './noteSurface.js';
import { UI } from './ui.js';
import {
    attachSheetInteractions,
    defaultSheetDimsForTemplate,
    ensureItemSheet,
    isSheetTemplateActive,
    resolveNoteTemplate
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

    isColorPickerOpen() {
        if (ColorPicker.eyedropperCleanup) return true;
        return !!(ColorPicker.popover && !ColorPicker.popover.classList.contains('is-hidden'));
    },

    commitAndClose() {
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

        this.approveBtn?.addEventListener('click', () => this.commitAndClose());
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
    },
    
    open(item = null, categoriesList = []) {
        this.availableCategories = categoriesList;
        this.hasUserInteracted = false;

        const isNew = !item;
        this.activeItem = item ? JSON.parse(JSON.stringify(item)) : {
            id: createNoteId(),
            owner_id: "admin",
            visibility: "private",
            type: "note",
            title: "",
            content: "",
            status: "active",
            categories: [],
            backgroundColor: randomNoteColor(),
            startDateTime: defaultStartDateTimeNow(),
            endDateTime: "",
            isRecurring: false,
            hideFromCalendar: false,
            hiddenFromBoard: false,
            attachments: [],
            steps: [],
            editorBodyLayout: 'both',
            tileSize: 'large'
        };
        if (!this.activeItem.editorBodyLayout) {
            this.activeItem.editorBodyLayout = 'both';
        }
        this.isNewUnsavedNote = isNew || !noteHasSavableContent(this.activeItem);
        if (this.activeItem.hideFromCalendar === undefined) {
            this.activeItem.hideFromCalendar = false;
        }
        this.syncEditorTheme(resolveNoteColor(this.activeItem.backgroundColor));
        this.renderForm();
        this.overlay.classList.remove('is-hidden');
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
            done();
            return;
        }
        this.overlay.classList.remove('is-open');
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

        const unchanged = JSON.stringify(currentData) === JSON.stringify(this.activeItem);
        if (!force && unchanged) return true;

        this.isNewUnsavedNote = false;
        Object.assign(this.activeItem, currentData);
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: { item: { ...this.activeItem }, preserveView: true }
        }));
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
        const steps = normalize
            ? allSteps.filter((step) => stripRichText(step.text || '').trim())
            : allSteps;

        const data = {
            ...this.activeItem,
            title: this.activeItem.title || '',
            type: steps.length > 0 ? 'checklist' : 'note',
            visibility: document.getElementById('edit-visibility')?.value || 'private',
            status: document.getElementById('edit-status')?.value || 'active',
            content: this.activeItem.content || '',
            steps,
            categories: (() => {
                const cat = document.getElementById('edit-category')?.value?.trim() || '';
                return cat ? [cat] : [];
            })(),
            backgroundColor: finalBgColor,
            startDateTime: this.combineDateTime(
                document.getElementById('edit-start-date')?.value || '',
                document.getElementById('edit-start-time')?.value || ''
            ),
            endDateTime: this.combineDateTime(
                document.getElementById('edit-end-date')?.value || '',
                document.getElementById('edit-end-time')?.value || ''
            ),
            isRecurring: this.activeItem.isRecurring === true,
            hideFromCalendar: this.activeItem.hideFromCalendar === true,
            hiddenFromBoard: this.activeItem.hiddenFromBoard === true,
            editorBodyLayout: NoteSurface.resolveEditorBodyLayoutUnchecked(this.activeItem),
            noteTemplate: this.activeItem.noteTemplate,
            sheet: this.activeItem.sheet
        };
        if (data.noteTemplate === 'default' || !data.noteTemplate) {
            delete data.noteTemplate;
        }
        return normalize ? normalizeItemForSave(data) : data;
    },
    
    resetEditorState() {
        this.mountZone.innerHTML = '';
        this.syncEditorTheme('');
        this.activeItem = null;
        this.hasUserInteracted = false;
        this.isNewUnsavedNote = false;
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
                if (scrollToBoard) UI.markNoteCollapsed(currentData.id);
                this.persistNote({ force: true, normalize: true });
                savedItem = { ...this.activeItem };
            }
        }

        const itemToReveal = scrollToBoard ? savedItem : null;
        this.animateEditorClose(() => {
            this.resetEditorState();
            if (itemToReveal) {
                window.dispatchEvent(new CustomEvent('editor:reveal_on_board', { detail: itemToReveal }));
            }
        });
    },
    
    close() {
        this.animateEditorClose(() => this.resetEditorState());
    },
    
    formatLocalDate(date = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    },

    formatLocalTime(date = new Date()) {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    },

    parseStoredDateTime(value) {
        if (!value) return { date: '', time: '' };
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { date: value, time: '' };
        if (value.includes('T')) {
            const [date, timePart] = value.split('T');
            return { date: date || '', time: timePart ? timePart.slice(0, 5) : '' };
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime())) {
            return { date: this.formatLocalDate(parsed), time: this.formatLocalTime(parsed) };
        }
        return { date: '', time: '' };
    },

    combineDateTime(date, time) {
        if (!date) return '';
        return time ? `${date}T${time}` : date;
    },

    bindDateInputDefaults(dateId, timeId, { defaultTimeOnFocus = true } = {}) {
        const dateEl = document.getElementById(dateId);
        const timeEl = document.getElementById(timeId);
        if (!dateEl) return;

        dateEl.addEventListener('focus', () => {
            if (!dateEl.value) dateEl.value = this.formatLocalDate();
        });
        if (!timeEl || !defaultTimeOnFocus) return;
        timeEl.addEventListener('focus', () => {
            if (!timeEl.value && dateEl.value) timeEl.value = this.formatLocalTime();
        });
    },

    refreshEditorNoteBody() {
        const body = document.getElementById('editor-note-body');
        if (!body || !this.activeItem) return;
        if (!body.dataset.pendingFocusStepId) {
            this.syncActiveItemFromDom();
        }
        const scrollTop = body.scrollTop;
        const active = document.activeElement;
        const focusField = active?.dataset?.field;
        const focusStepId = active?.dataset?.stepId;

        const pendingFocusStepId = body.dataset.pendingFocusStepId;
        const pendingFocusEdge = body.dataset.pendingFocusEdge;
        const pendingFocusPlainOffset = body.dataset.pendingFocusPlainOffset;
        body.innerHTML = NoteSurface.buildNoteBodyHtml(this.activeItem, {
            canEdit: true,
            inModalEditor: true,
            richEdit: true
        });
        const shell = this.mountZone?.querySelector('.editor-note-shell');
        if (shell) NoteSurface.updateConvertButtons(shell, this.activeItem);
        if (pendingFocusStepId) {
            body.dataset.pendingFocusStepId = pendingFocusStepId;
            if (pendingFocusEdge) body.dataset.pendingFocusEdge = pendingFocusEdge;
            if (pendingFocusPlainOffset != null) {
                body.dataset.pendingFocusPlainOffset = pendingFocusPlainOffset;
            }
        }
        delete body.dataset.noteInteractionsBound;
        delete body.dataset.checklistInteractionsBound;
        const onEditorChange = () => {
            this.markInteracted();
            this.scheduleEditorSizeLabelUpdate();
            this.triggerAutoSave();
        };
        NoteSurface.attachNoteBodyInteractions(body, this.activeItem, {
            refresh: () => this.refreshEditorNoteBody(),
            localOnly: true,
            richEdit: true,
            onChange: onEditorChange
        });
        if (shell) {
            attachSheetInteractions(body, this.activeItem, NoteSurface.buildSheetInteractionOptions(shell, this.activeItem, {
                localOnly: true,
                onChange: onEditorChange,
                refresh: () => this.refreshEditorNoteBody()
            }));
        }
        body.scrollTop = scrollTop;

        if (body.dataset.pendingFocusStepId) {
            NoteSurface.focusPendingChecklistStep(body);
            return;
        }

        if (!focusField) return;
        const focusEl = focusStepId
            ? body.querySelector(`[data-field="step-text"][data-step-id="${focusStepId}"]`)
            : this.mountZone.querySelector(`[data-field="${focusField}"]`);
        if (focusEl) NoteSurface.focusInlineEdit(focusEl, 'end');
    },

    renderForm() {
        const item = this.activeItem;
        const activeCategory = item.categories?.[0] || '';
        const matchedCat = this.availableCategories.find((cat) => {
            const name = typeof cat === 'string' ? cat : cat?.name;
            return name && name.toLowerCase() === activeCategory.toLowerCase();
        });
        const categoryColor = matchedCat && typeof matchedCat !== 'string' && matchedCat.color
            ? matchedCat.color
            : '#64748b';
        const categoryOptionsHtml = `<option value="" ${!activeCategory ? 'selected' : ''}>—</option>` +
            this.availableCategories.map(cat => {
                const catName = typeof cat === 'string' ? cat : cat.name;
                const selected = activeCategory && catName.toLowerCase() === activeCategory.toLowerCase();
                return `<option value="${NoteSurface.escapeQuotes(catName)}" ${selected ? 'selected' : ''}>${catName}</option>`;
            }).join('');
        const isExistingItem = item.created_at !== undefined;
        if (this.toolbarMount) {
            this.toolbarMount.innerHTML = NoteSurface.buildNoteQuickActionsHtml(item, {
                surface: 'modal',
                pinned: UI.isBoardPinned(item.id),
                showDrag: true,
                showArchive: isExistingItem
            });
            UI.attachModalQuickActions(this.toolbarMount, item, this);
        }
        this.updateDoneButtonUI();
        this.updateArchiveToggleUI();
        this.updateCalendarToggleUI();
        const startParts = this.parseStoredDateTime(item.startDateTime || '');
        const endParts = this.parseStoredDateTime(item.endDateTime || '');

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
        const modal = this.overlay?.querySelector('.modal');
        applyCardTheme(modal, backgroundColor || '', { paintBackground: true });
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
                this.triggerAutoSave();
            }
        });
    },

    collectAndSave() {
        this.closeAndSave({ scrollToBoard: true });
    },
    
    updateArchiveToggleUI() {
        if (!this.archiveBtn || !this.activeItem) return;
        const isArchived = this.activeItem.status === 'archived';
        this.archiveBtn.innerHTML = isArchived ? CARD_ICONS.unarchive : CARD_ICONS.delete;
        this.archiveBtn.title = isArchived ? 'Restore from bin' : 'Move to bin';
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
        const beforeItem = JSON.parse(JSON.stringify(this.activeItem));
        const data = this.collectFormData({ normalize: true });
        data.status = isArchived ? 'active' : 'archived';

        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: { item: data, beforeItem, preserveView: false }
        }));
        this.close();
    },
    
};
