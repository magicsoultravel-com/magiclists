import { applyCardTheme } from './cardTheme.js';
import { ColorPicker, PALETTE_NOTE, randomNoteColor, resolveNoteColor } from './colorPicker.js';
import { sanitizeRichHtml, stripRichText } from './richText.js';
import { CARD_ICONS, UI, computeNoteSizeKb, createNoteId, defaultStartDateTimeNow, noteHasSavableContent, normalizeItemForSave } from './ui.js';

export const Editor = {
    overlay: null,
    mountZone: null,
    activeItem: null,
    availableCategories: [],
    autoSaveTimer: null,
    hasUserInteracted: false,
    isNewUnsavedNote: false,
    
    init() {
        this.overlay = document.getElementById('editor-overlay');
        this.mountZone = document.getElementById('modal-form-mount');
        this.calendarToggleBtn = document.getElementById('modal-calendar-toggle');
        this.saveBtn = document.getElementById('modal-save-btn');
        this.archiveBtn = document.getElementById('modal-archive-btn');
        this.approveBtn = document.getElementById('modal-approve-btn');

        const commitAndClose = () => this.closeAndSave({ revealOnBoard: true });
        document.getElementById('modal-close-btn')?.addEventListener('click', commitAndClose);
        this.saveBtn?.addEventListener('click', commitAndClose);
        this.approveBtn?.addEventListener('click', commitAndClose);
        this.calendarToggleBtn?.addEventListener('click', () => this.toggleCalendarVisibility());
        this.archiveBtn?.addEventListener('click', () => this.emitArchiveAction());
        this.overlay?.addEventListener('mousedown', (e) => {
            if (e.target !== this.overlay) return;
            this.closeAndSave({ revealOnBoard: true });
        });
    },
    
    open(item = null, categoriesList = []) {
        this.availableCategories = categoriesList;
        this.hasUserInteracted = false;
        
        const isNew = !item;
        this.isNewUnsavedNote = isNew;
        
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
            steps: []
        };
        if (this.activeItem.hideFromCalendar === undefined) {
            this.activeItem.hideFromCalendar = false;
        }
        this.syncEditorTheme(resolveNoteColor(this.activeItem.backgroundColor));
        this.renderForm();
        this.updateCalendarToggleUI();
        this.overlay.classList.remove('is-hidden');
        const modal = this.overlay.querySelector('.modal');
        if (modal) modal.classList.add('modal--editor');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.overlay?.classList.add('is-open');
                if (isNew) {
                    const focusTarget = this.mountZone.querySelector('[data-field="content"].card-inline-edit')
                        || this.mountZone.querySelector('[data-field="title"].card-inline-edit');
                    if (focusTarget) UI.focusInlineEdit(focusTarget, 'start');
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
    
    persistNote({ force = false } = {}) {
        if (!this.activeItem) return false;
        if (!force && !this.hasUserInteracted) return false;

        const currentData = this.collectFormData();
        if (!noteHasSavableContent(currentData) && this.isNewUnsavedNote) return false;

        const unchanged = JSON.stringify(currentData) === JSON.stringify(this.activeItem);
        if (!force && unchanged) return true;

        this.isNewUnsavedNote = false;
        this.activeItem = currentData;
        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: { item: currentData, preserveView: true }
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
        const hidden = this.activeItem.hideFromCalendar === true ||
            (() => {
                try {
                    return JSON.parse(localStorage.getItem('matrix_calendar_hidden_ids') || '[]').includes(this.activeItem.id);
                } catch { return false; }
            })();
        this.calendarToggleBtn.innerHTML = CARD_ICONS.calendar;
        this.calendarToggleBtn.title = hidden ? 'Hidden from calendar — click to show' : 'Shown on calendar — click to hide';
        this.calendarToggleBtn.classList.toggle('is-off', hidden);
        this.calendarToggleBtn.classList.toggle('is-on', !hidden);
    },

    toggleCalendarVisibility() {
        if (!this.activeItem) return;
        this.activeItem.hideFromCalendar = !this.activeItem.hideFromCalendar;
        this.updateCalendarToggleUI();
        this.markInteracted();
        this.triggerAutoSave();
        window.dispatchEvent(new CustomEvent('calendar:items_changed'));
    },

    syncActiveItemFromDom() {
        if (!this.activeItem || !this.mountZone) return;
        const titleEl = this.mountZone.querySelector('[data-field="title"]');
        const contentEl = this.mountZone.querySelector('[data-field="content"]');
        if (titleEl) {
            this.activeItem.title = titleEl.classList.contains('rich-text--edit')
                ? sanitizeRichHtml(titleEl.innerHTML)
                : titleEl.textContent.trim();
        }
        if (contentEl) {
            this.activeItem.content = contentEl.classList.contains('rich-text--edit')
                ? sanitizeRichHtml(contentEl.innerHTML)
                : contentEl.textContent;
        }
        this.mountZone.querySelectorAll('[data-field="step-text"]').forEach((el) => {
            const step = this.activeItem.steps?.find((s) => s.id === el.dataset.stepId);
            if (!step) return;
            step.text = el.classList.contains('rich-text--edit')
                ? sanitizeRichHtml(el.innerHTML)
                : el.textContent;
        });
    },

    collectFormData() {
        this.syncActiveItemFromDom();
        const finalBgColor = resolveNoteColor(document.getElementById('edit-bg-color-value')?.value);
        const steps = (this.activeItem.steps || []).filter((step) => stripRichText(step.text || '').trim());

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
            editorBodyLayout: (() => {
                const bothEl = document.getElementById('edit-show-both-panes');
                if (bothEl?.checked) return 'both';
                return UI.resolveEditorBodyLayoutUnchecked(this.activeItem);
            })()
        };
        return normalizeItemForSave(data);
    },
    
    resetEditorState() {
        this.mountZone.innerHTML = '';
        this.syncEditorTheme('');
        this.activeItem = null;
        this.hasUserInteracted = false;
        this.isNewUnsavedNote = false;
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    },

    closeAndSave({ revealOnBoard = false } = {}) {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
            this.autoSaveTimer = null;
        }

        let savedItem = null;
        if (this.activeItem) {
            this.syncActiveItemFromDom();
            const currentData = this.collectFormData();
            const shouldPersist = noteHasSavableContent(currentData)
                || (this.hasUserInteracted && !this.isNewUnsavedNote);
            if (shouldPersist) {
                UI.markNoteExpanded(currentData.id);
                this.persistNote({ force: true });
                savedItem = this.activeItem;
            }
        }

        const itemToReveal = revealOnBoard ? savedItem : null;
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
        const scrollTop = body.scrollTop;
        const active = document.activeElement;
        const focusField = active?.dataset?.field;
        const focusStepId = active?.dataset?.stepId;

        const pendingFocusStepId = body.dataset.pendingFocusStepId;
        body.innerHTML = UI.buildNoteBodyHtml(this.activeItem, {
            canEdit: true,
            alwaysShowChecklist: true,
            richEdit: true
        });
        const shell = this.mountZone?.querySelector('.editor-note-shell');
        if (shell) UI.updateConvertButtons(shell, this.activeItem);
        if (pendingFocusStepId) body.dataset.pendingFocusStepId = pendingFocusStepId;
        UI.attachNoteBodyInteractions(body, this.activeItem, {
            refresh: () => this.refreshEditorNoteBody(),
            localOnly: true,
            richEdit: true,
            onChange: () => {
                this.markInteracted();
                this.updateEditorSizeLabel();
                this.triggerAutoSave();
            }
        });
        body.scrollTop = scrollTop;

        if (body.dataset.pendingFocusStepId) {
            UI.focusPendingChecklistStep(body);
            return;
        }

        if (!focusField) return;
        const focusEl = focusStepId
            ? body.querySelector(`[data-field="step-text"][data-step-id="${focusStepId}"]`)
            : this.mountZone.querySelector(`[data-field="${focusField}"]`);
        if (focusEl) UI.focusInlineEdit(focusEl, 'end');
    },

    renderForm() {
        const item = this.activeItem;
        const activeCategory = item.categories?.[0] || '';
        const categoryOptionsHtml = `<option value="" ${!activeCategory ? 'selected' : ''}>—</option>` +
            this.availableCategories.map(cat => {
                const catName = typeof cat === 'string' ? cat : cat.name;
                const selected = activeCategory && catName.toLowerCase() === activeCategory.toLowerCase();
                return `<option value="${UI.escapeQuotes(catName)}" ${selected ? 'selected' : ''}>${catName}</option>`;
            }).join('');
        const isExistingItem = item.created_at !== undefined;
        this.archiveBtn?.classList.toggle('is-hidden', !isExistingItem);
        this.updateDoneButtonUI();
        this.updateArchiveToggleUI();
        this.updateCalendarToggleUI();
        const startParts = this.parseStoredDateTime(item.startDateTime || '');
        const endParts = this.parseStoredDateTime(item.endDateTime || '');

        this.mountZone.innerHTML = UI.buildNoteEditorShell(item, {
            canEdit: true,
            alwaysShowChecklist: true,
            showConfig: true,
            showFormat: true,
            richEdit: true,
            metaMode: 'modal',
            categoryOptionsHtml,
            startParts,
            endParts,
            bodyId: 'editor-note-body'
        });

        const onEditorChange = () => {
            this.markInteracted();
            this.updateEditorSizeLabel();
            const shell = this.mountZone?.querySelector('.editor-note-shell');
            if (shell && this.activeItem) UI.updateConvertButtons(shell, this.activeItem);
            this.triggerAutoSave();
        };

        UI.bindNoteEditorShell(this.mountZone, item, {
            showConfig: true,
            showFormat: true,
            richEdit: true,
            localOnly: true,
            refresh: () => this.refreshEditorNoteBody(),
            onChange: onEditorChange,
            onConfigChange: onEditorChange,
            onStatusChange: () => this.updateArchiveToggleUI(),
            bindDateDefaults: (dateId, timeId) => this.bindDateInputDefaults(dateId, timeId),
            setupColorPalette: () => this.setupColorPalette(item)
        });

        this.syncEditorTheme(resolveNoteColor(item.backgroundColor));
    },

    syncEditorTheme(backgroundColor) {
        const modal = this.overlay?.querySelector('.modal');
        applyCardTheme(modal, backgroundColor || '', { paintBackground: true });
    },

    updateDoneButtonUI() {
        const doneTitle = 'Show on board';
        const doneIcon = CARD_ICONS.collapse;
        this.saveBtn?.classList.add('is-hidden');
        const closeBtn = document.getElementById('modal-close-btn');
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
        const el = document.querySelector('.editor-note-size');
        if (!el) return;
        try {
            const data = this.collectFormData();
            el.textContent = `${computeNoteSizeKb(data)} KB`;
        } catch {
            /* form not ready */
        }
    },

    setupColorPalette(item) {
        const trigger = document.getElementById('edit-color-trigger');
        const hidden = document.getElementById('edit-bg-color-value');
        if (!trigger || !hidden) return;

        const selectColor = (value, { silent = false } = {}) => {
            const color = resolveNoteColor(value);
            hidden.value = color;
            ColorPicker.updateTriggerPreview(trigger, color);
            this.syncEditorTheme(color);
            if (!silent) {
                this.markInteracted();
                this.triggerAutoSave();
            }
        };

        selectColor(resolveNoteColor(item.backgroundColor), { silent: true });
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            ColorPicker.open({
                anchor: trigger,
                presets: PALETTE_NOTE,
                value: hidden.value || '',
                align: 'start',
                onSelect: (color) => selectColor(color)
            });
        });
    },

    collectAndSave() {
        this.closeAndSave({ revealOnBoard: true });
    },
    
    updateArchiveToggleUI() {
        if (!this.archiveBtn || !this.activeItem) return;
        const isArchived = this.activeItem.status === 'archived';
        this.archiveBtn.innerHTML = isArchived ? CARD_ICONS.unarchive : CARD_ICONS.archive;
        this.archiveBtn.title = isArchived ? 'Restore to active' : 'Archive note';
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
        const data = this.collectFormData();
        data.status = isArchived ? 'active' : 'archived';

        window.dispatchEvent(new CustomEvent('item:mutation_requested', {
            detail: { item: data, beforeItem, preserveView: false }
        }));
        this.close();
    },
    
};
