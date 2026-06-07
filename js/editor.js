import { applyCardTheme } from './cardTheme.js';
import { CARD_ICONS, UI, computeNoteSizeKb } from './ui.js';

const NOTE_COLOR_PRESETS = [
    { value: '', label: 'Default' },
    { value: '#1e293b', label: 'Slate' },
    { value: '#312e81', label: 'Indigo' },
    { value: '#134e4a', label: 'Teal' },
    { value: '#365314', label: 'Olive' },
    { value: '#78350f', label: 'Amber' },
    { value: '#7f1d1d', label: 'Rose' },
    { value: '#4c1d95', label: 'Violet' },
    { value: '#1e3a5f', label: 'Navy' }
];

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
        this.deleteBtn = document.getElementById('modal-delete-btn');
        this.approveBtn = document.getElementById('modal-approve-btn');

        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeAndSave());
        const commitAndClose = () => {
            this.markInteracted();
            this.autoSave();
            this.closeAndSave();
        };
        this.saveBtn?.addEventListener('click', commitAndClose);
        this.approveBtn?.addEventListener('click', commitAndClose);
        this.calendarToggleBtn?.addEventListener('click', () => this.toggleCalendarVisibility());
        this.deleteBtn?.addEventListener('click', () => this.emitDeleteAction());
    },
    
    open(item = null, categoriesList = []) {
        this.availableCategories = categoriesList;
        this.hasUserInteracted = false;
        
        const isNew = !item;
        this.isNewUnsavedNote = isNew;
        
        this.activeItem = item ? JSON.parse(JSON.stringify(item)) : {
            id: `item_${Math.floor(Date.now() / 1000)}`,
            owner_id: "admin",
            visibility: "private",
            type: "note",
            title: "",
            content: "",
            status: "active",
            categories: [],
            backgroundColor: "",
            startDateTime: "",
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
        this.syncEditorTheme('');
        this.renderForm();
        this.updateCalendarToggleUI();
        this.overlay.classList.remove('is-hidden');
        const modal = this.overlay.querySelector('.modal');
        if (modal) modal.classList.add('modal--editor');
        requestAnimationFrame(() => {
            requestAnimationFrame(() => this.overlay?.classList.add('is-open'));
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
    
    autoSave() {
        if (!this.hasUserInteracted) return;
        if (!this.activeItem) return;
        const currentData = this.collectFormData();
        
        const hasContent = currentData.title.trim() !== "" || currentData.content.trim() !== "" || 
                          (currentData.steps && currentData.steps.length > 0);
        
        if (!hasContent && this.isNewUnsavedNote) {
            return;
        }
        
        this.isNewUnsavedNote = false;
        
        if (JSON.stringify(currentData) !== JSON.stringify(this.activeItem)) {
            this.activeItem = currentData;
            window.dispatchEvent(new CustomEvent('item:mutation_requested', { detail: this.activeItem }));
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
        if (titleEl) this.activeItem.title = titleEl.textContent.trim();
        if (contentEl) this.activeItem.content = contentEl.textContent;
        this.mountZone.querySelectorAll('[data-field="step-text"]').forEach((el) => {
            const step = this.activeItem.steps?.find((s) => s.id === el.dataset.stepId);
            if (step) step.text = el.textContent;
        });
    },

    collectFormData() {
        this.syncActiveItemFromDom();
        const finalBgColor = document.getElementById('edit-bg-color-value')?.value || '';
        const steps = (this.activeItem.steps || []).filter((step) => step.text?.trim());

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
            isRecurring: document.getElementById('edit-recurring')?.value === 'yes',
            hideFromCalendar: this.activeItem.hideFromCalendar === true,
            hiddenFromBoard: this.activeItem.hiddenFromBoard === true
        };
        return data;
    },
    
    resetEditorState() {
        this.mountZone.innerHTML = '';
        this.syncEditorTheme('');
        this.activeItem = null;
        this.hasUserInteracted = false;
        this.isNewUnsavedNote = false;
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    },

    closeAndSave() {
        if (this.hasUserInteracted) {
            const currentData = this.collectFormData();
            const hasContent = currentData.title.trim() !== "" || currentData.content.trim() !== "" || 
                              (currentData.steps && currentData.steps.length > 0);
            
            if (hasContent || !this.isNewUnsavedNote) {
                this.autoSave();
            }
        }

        this.animateEditorClose(() => this.resetEditorState());
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

        body.innerHTML = UI.buildNoteBodyHtml(this.activeItem, { canEdit: true, alwaysShowChecklist: true });
        UI.attachNoteBodyInteractions(body, this.activeItem, {
            refresh: () => this.refreshEditorNoteBody(),
            localOnly: true,
            onChange: () => {
                this.markInteracted();
                this.updateEditorSizeLabel();
                this.triggerAutoSave();
            }
        });
        body.scrollTop = scrollTop;

        if (!focusField) return;
        const focusEl = focusStepId
            ? body.querySelector(`[data-field="step-text"][data-step-id="${focusStepId}"]`)
            : this.mountZone.querySelector(`[data-field="${focusField}"]`);
        if (focusEl) UI.focusInlineEdit(focusEl, 'end');
    },

    bindEditorNoteInteractions() {
        if (!this.mountZone || !this.activeItem) return;
        const options = {
            refresh: () => this.refreshEditorNoteBody(),
            localOnly: true,
            onChange: () => {
                this.markInteracted();
                this.updateEditorSizeLabel();
                this.triggerAutoSave();
            }
        };
        const header = this.mountZone.querySelector('.editor-note-header');
        const body = document.getElementById('editor-note-body');
        if (header) UI.attachNoteBodyInteractions(header, this.activeItem, options);
        if (body) UI.attachNoteBodyInteractions(body, this.activeItem, options);
    },

    renderForm() {
        const item = this.activeItem;
        const activeCategory = item.categories?.[0] || '';
        const categoryOptionsHtml = `<option value="" ${!activeCategory ? 'selected' : ''}>—</option>` +
            this.availableCategories.map(cat => {
                const catName = typeof cat === 'string' ? cat : cat.name;
                const selected = activeCategory && catName.toLowerCase() === activeCategory.toLowerCase();
                return `<option value="${this.escapeQuotes(catName)}" ${selected ? 'selected' : ''}>${catName}</option>`;
            }).join('');
        const isExistingItem = item.created_at !== undefined;
        const createdLabel = this.formatCreatedDate(item.created_at);
        const sizeLabel = computeNoteSizeKb(item);
        this.deleteBtn?.classList.toggle('is-hidden', !isExistingItem);
        this.saveBtn.innerHTML = CARD_ICONS.save;
        document.getElementById('modal-close-btn').innerHTML = CARD_ICONS.close;
        if (this.deleteBtn) this.deleteBtn.innerHTML = CARD_ICONS.close;
        this.updateCalendarToggleUI();
        const warningLightHtml = '';
        const startParts = this.parseStoredDateTime(item.startDateTime || '');
        const endParts = this.parseStoredDateTime(item.endDateTime || '');
        const colorSwatchesHtml = NOTE_COLOR_PRESETS.map(preset => {
            const isNone = preset.value === '';
            const selected = (item.backgroundColor || '') === preset.value;
            return `<button type="button" class="color-swatch${isNone ? ' color-swatch--none' : ''}${selected ? ' is-selected' : ''}" data-color="${preset.value}" title="${preset.label}" aria-label="${preset.label}"${isNone ? '' : ` style="--swatch:${preset.value}"`}></button>`;
        }).join('');

        const bodyHtml = UI.buildNoteBodyHtml(item, { canEdit: true, alwaysShowChecklist: true });

        this.mountZone.innerHTML = `
            ${warningLightHtml}
            <div class="editor-note-shell">
                <div class="editor-note-header">
                    <div class="mini-card-title card-inline-edit" contenteditable="plaintext-only" spellcheck="false" data-field="title" data-placeholder="Title…">${UI.escapeHTML(item.title || '')}</div>
                </div>
                <div class="editor-meta-row">
                    ${createdLabel ? `<span class="editor-created-date">Created ${createdLabel}</span>` : ''}
                    <span class="editor-note-size" title="Note content size">${sizeLabel} KB</span>
                </div>

            <div class="editor-panel editor-panel--config">
                <div class="collapsable-header" id="config-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Configuration</span>
                </div>
                <div class="collapsable-section collapsed" id="config-section">
                    <div class="form-row-grid form-row-grid--2">
                        <div class="form-group form-group--compact">
                            <label>Visibility</label>
                            <select id="edit-visibility" class="form-input">
                                <option value="private" ${item.visibility === 'private' ? 'selected' : ''}>Private</option>
                                <option value="public" ${item.visibility === 'public' ? 'selected' : ''}>Public</option>
                            </select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Start</label>
                            <div class="datetime-input-row">
                                <input type="date" id="edit-start-date" class="form-input" value="${startParts.date}">
                                <input type="time" id="edit-start-time" class="form-input form-input--optional-time" value="${startParts.time}" step="60" title="Optional — leave blank for date only">
                            </div>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>End</label>
                            <div class="datetime-input-row">
                                <input type="date" id="edit-end-date" class="form-input" value="${endParts.date}">
                                <input type="time" id="edit-end-time" class="form-input form-input--optional-time" value="${endParts.time}" step="60" title="Optional — leave blank for date only">
                            </div>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Category</label>
                            <select id="edit-category" class="form-input">${categoryOptionsHtml}</select>
                        </div>
                        <div class="form-group form-group--compact">
                            <label>Status</label>
                            <select id="edit-status" class="form-input">
                                <option value="active" ${item.status === 'active' ? 'selected' : ''}>Active</option>
                                <option value="archived" ${item.status === 'archived' ? 'selected' : ''}>Archived</option>
                                <option value="completed" ${item.status === 'completed' ? 'selected' : ''}>Done</option>
                            </select>
                        </div>
                        <div class="form-group form-group--compact form-group--color">
                            <label>Card color</label>
                            <input type="hidden" id="edit-bg-color-value" value="${this.escapeQuotes(item.backgroundColor || '')}">
                            <div class="color-palette" id="edit-color-palette">
                                ${colorSwatchesHtml}
                                <label class="color-swatch color-swatch--custom" title="Custom color">
                                    <input type="color" id="edit-bg-color-custom" value="${item.backgroundColor || '#26262b'}">
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card-body editor-note-body" id="editor-note-body">
                ${bodyHtml}
            </div>
            </div>
        `;
        
        const inputs = ['edit-visibility', 'edit-status', 'edit-category', 'edit-start-date', 'edit-start-time', 'edit-end-date', 'edit-end-time', 'edit-recurring'];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    this.markInteracted();
                    this.updateEditorSizeLabel();
                    this.triggerAutoSave();
                });
                el.addEventListener('change', () => {
                    this.markInteracted();
                    this.updateEditorSizeLabel();
                    this.triggerAutoSave();
                });
            }
        });
        
        this.setupColorPalette(item);
        this.bindDateInputDefaults('edit-start-date', 'edit-start-time');
        this.bindDateInputDefaults('edit-end-date', 'edit-end-time');
        this.syncEditorTheme(item.backgroundColor || '');
        this.bindCollapsable('config-section-header', 'config-section', true);
        this.bindEditorNoteInteractions();
    },
    
    bindCollapsable(headerId, sectionId, startCollapsed = false) {
        const header = document.getElementById(headerId);
        const section = document.getElementById(sectionId);
        if (!header || !section) return;

        const toggle = header.querySelector('.collapsable-toggle');
        if (startCollapsed) {
            section.classList.add('collapsed');
            toggle?.classList.add('collapsed');
        }

        header.addEventListener('click', () => {
            section.classList.toggle('collapsed');
            toggle?.classList.toggle('collapsed');
        });
    },

    syncEditorTheme(backgroundColor) {
        const modal = this.overlay?.querySelector('.modal');
        applyCardTheme(modal, backgroundColor || '', { paintBackground: true });
    },

    formatCreatedDate(timestamp) {
        if (!timestamp) return '';
        const d = new Date(Number(timestamp) * 1000);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
        const palette = document.getElementById('edit-color-palette');
        const hidden = document.getElementById('edit-bg-color-value');
        const custom = document.getElementById('edit-bg-color-custom');
        if (!palette || !hidden) return;

        const selectColor = (value, { silent = false } = {}) => {
            hidden.value = value;
            palette.querySelectorAll('.color-swatch').forEach(btn => {
                btn.classList.toggle('is-selected', btn.dataset?.color === value || btn.classList.contains('color-swatch--custom') && value && !NOTE_COLOR_PRESETS.some(p => p.value === value));
            });
            if (custom && value) custom.value = value;
            if (custom && !value) custom.value = '#26262b';
            const customWrap = palette.querySelector('.color-swatch--custom');
            if (customWrap) {
                const isCustom = value && !NOTE_COLOR_PRESETS.some(p => p.value === value);
                customWrap.classList.toggle('is-selected', isCustom);
            }
            this.syncEditorTheme(value);
            if (!silent) {
                this.markInteracted();
                this.triggerAutoSave();
            }
        };

        palette.querySelectorAll('.color-swatch[data-color]').forEach(btn => {
            btn.addEventListener('click', () => selectColor(btn.dataset.color || ''));
        });

        custom?.addEventListener('input', () => {
            palette.querySelectorAll('.color-swatch[data-color]').forEach(b => b.classList.remove('is-selected'));
            palette.querySelector('.color-swatch--custom')?.classList.add('is-selected');
            hidden.value = custom.value;
            this.syncEditorTheme(custom.value);
            this.markInteracted();
            this.triggerAutoSave();
        });

        selectColor(item.backgroundColor || '', { silent: true });
    },

    collectAndSave() {
        this.markInteracted();
        this.autoSave();
        this.closeAndSave();
    },
    
    emitDeleteAction() {
        const label = this.activeItem.title?.trim() || 'this note';
        if (confirm(`Delete "${label}"? You can undo afterwards.`)) {
            window.dispatchEvent(new CustomEvent('item:deletion_requested', { detail: this.activeItem.id }));
            this.close();
        }
    },
    
    escapeQuotes(str) { return str ? str.replace(/"/g, '&quot;') : ''; }
};
