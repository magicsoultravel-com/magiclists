import { applyCardTheme } from './cardTheme.js';
import {
    CARD_ICONS,
    attachAutoGrow,
    computeNoteSizeKb,
    levelListHasDescendants,
    partitionChecklistSteps,
    reorderStepsByCompletion
} from './ui.js';

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
    draggedRow: null,
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
            attachments: []
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

    collectFormData() {
        const finalBgColor = document.getElementById('edit-bg-color-value')?.value || '';
        const activeType = document.getElementById('edit-type')?.value || 'note';
        
        const data = {
            ...this.activeItem,
            title: document.getElementById('edit-title')?.value.trim() || "",
            type: activeType,
            visibility: document.getElementById('edit-visibility')?.value || 'private',
            status: document.getElementById('edit-status')?.value || 'active',
            content: document.getElementById('edit-content')?.value || '',
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
        
        if (activeType === 'checklist') {
            data.steps = [];
            document.querySelectorAll('#checklist-rows-active .step-row--edit, #checklist-rows-done .step-row--edit').forEach((row, idx) => {
                const text = row.querySelector('.step-text')?.value.trim();
                if (text) {
                    const stepId = row.dataset.stepId || `step_${idx}_${Math.floor(Math.random() * 1000)}`;
                    data.steps.push({
                        id: stepId,
                        text: text,
                        completed: row.querySelector('.step-check')?.checked || false,
                        level: Math.min(4, Math.max(0, parseInt(row.dataset.level || '0', 10) || 0)),
                        startDateTime: row.dataset.startDateTime || '',
                        endDateTime: row.dataset.endDateTime || ''
                    });
                }
            });
        }
        return data;
    },
    
    resetEditorState() {
        this.mountZone.innerHTML = '';
        this.syncEditorTheme('');
        this.activeItem = null;
        this.draggedRow = null;
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

    showDatePickerForStep(rowElement, currentStart, currentEnd) {
        const modal = document.createElement('div');
        modal.className = 'date-picker-modal';
        const now = new Date();
        const isNew = !currentStart;
        const startParts = this.parseStoredDateTime(currentStart);
        const endParts = this.parseStoredDateTime(currentEnd);
        const startDateVal = startParts.date || (isNew ? this.formatLocalDate(now) : '');
        const startTimeVal = startParts.time || (isNew ? this.formatLocalTime(now) : '');
        const endDateVal = endParts.date;
        const endTimeVal = endParts.time;

        modal.innerHTML = `
            <h4 class="section-title">Set Line Date</h4>
            <div class="form-group">
                <label>Start</label>
                <div class="datetime-input-row">
                    <input type="date" id="step-start-date" class="form-input" value="${startDateVal}">
                    <input type="time" id="step-start-time" class="form-input form-input--optional-time" value="${startTimeVal}" step="60">
                </div>
            </div>
            <div class="form-group">
                <label>End (optional)</label>
                <div class="datetime-input-row">
                    <input type="date" id="step-end-date" class="form-input" value="${endDateVal}">
                    <input type="time" id="step-end-time" class="form-input form-input--optional-time" value="${endTimeVal}" step="60">
                </div>
            </div>
            <div class="form-actions">
                <button class="btn btn--flex-1" id="step-date-clear">Clear</button>
                <button class="btn btn--accent active btn--grow" id="step-date-save">Save</button>
            </div>
        `;

        document.body.appendChild(modal);

        const startDateInput = document.getElementById('step-start-date');
        const startTimeInput = document.getElementById('step-start-time');
        const endDateInput = document.getElementById('step-end-date');
        const endTimeInput = document.getElementById('step-end-time');

        this.bindDateInputDefaults('step-start-date', 'step-start-time');
        this.bindDateInputDefaults('step-end-date', 'step-end-time');

        startDateInput.addEventListener('change', () => {
            if (startDateInput.value && !endDateInput.value) {
                endDateInput.value = startDateInput.value;
            }
        });

        document.getElementById('step-date-save').addEventListener('click', () => {
            const startVal = this.combineDateTime(startDateInput.value, startTimeInput.value);
            const endVal = this.combineDateTime(endDateInput.value, endTimeInput.value);
            if (startVal) rowElement.dataset.startDateTime = startVal;
            else delete rowElement.dataset.startDateTime;
            if (endVal) rowElement.dataset.endDateTime = endVal;
            else delete rowElement.dataset.endDateTime;
            this.updateStepDateIcon(rowElement, startVal);
            modal.remove();
            this.markInteracted();
            this.triggerAutoSave();
        });

        document.getElementById('step-date-clear').addEventListener('click', () => {
            delete rowElement.dataset.startDateTime;
            delete rowElement.dataset.endDateTime;
            this.updateStepDateIcon(rowElement, null);
            modal.remove();
            this.markInteracted();
            this.triggerAutoSave();
        });
    },
    
    updateStepDateIcon(rowElement, hasDate) {
        const dateBtn = rowElement.querySelector('.step-date-btn');
        if (dateBtn) {
            dateBtn.innerHTML = CARD_ICONS.calendar;
            dateBtn.classList.toggle('btn--date-on', !!hasDate);
            dateBtn.classList.toggle('is-on', !!hasDate);
            dateBtn.title = hasDate ? 'Date set - click to edit' : 'No date - click to set';
        }
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
        const hasHiddenSteps = item.type === 'note' && item.steps && item.steps.length > 0;
        const warningLightHtml = hasHiddenSteps
            ? `<div class="warning-banner">⚠️ This note contains ${item.steps.length} hidden checklist items from a previous state. Switch type to re-activate.</div>`
            : '';
        const startParts = this.parseStoredDateTime(item.startDateTime || '');
        const endParts = this.parseStoredDateTime(item.endDateTime || '');
        const colorSwatchesHtml = NOTE_COLOR_PRESETS.map(preset => {
            const isNone = preset.value === '';
            const selected = (item.backgroundColor || '') === preset.value;
            return `<button type="button" class="color-swatch${isNone ? ' color-swatch--none' : ''}${selected ? ' is-selected' : ''}" data-color="${preset.value}" title="${preset.label}" aria-label="${preset.label}"${isNone ? '' : ` style="--swatch:${preset.value}"`}></button>`;
        }).join('');

        this.mountZone.innerHTML = `
            ${warningLightHtml}
            <input type="text" id="edit-title" class="form-input form-input--title" placeholder="${isExistingItem ? 'Edit title' : 'New title'}" value="${this.escapeQuotes(item.title)}">
            <div class="editor-meta-row">
                ${createdLabel ? `<span class="editor-created-date">Created ${createdLabel}</span>` : ''}
                <span class="editor-note-size" title="Note content size">${sizeLabel} KB</span>
            </div>

            <div class="editor-panel">
                <div class="collapsable-header" id="config-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>Configuration</span>
                </div>
                <div class="collapsable-section" id="config-section">
                    <div class="form-row-grid form-row-grid--2">
                        <div class="form-group form-group--compact">
                            <label>Type</label>
                            <select id="edit-type" class="form-input">
                                <option value="note" ${item.type === 'note' ? 'selected' : ''}>Note</option>
                                <option value="checklist" ${item.type === 'checklist' ? 'selected' : ''}>Checklist</option>
                            </select>
                        </div>
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

            <div class="editor-panel">
                <div class="collapsable-header" id="content-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>Content</span>
                </div>
                <div class="collapsable-section" id="content-section">
                    <textarea id="edit-content" class="form-input form-input--content input-grow" rows="1" placeholder="Notes...">${item.content || ''}</textarea>
                </div>
            </div>

            <div class="editor-panel${item.type === 'checklist' ? '' : ' is-hidden'}" id="checklist-panel">
                <div class="collapsable-header" id="checklist-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle">▼</span>Checklist <span id="line-counter-display" class="line-counter">0</span></span>
                </div>
                <div class="collapsable-section" id="checklist-section">
                    <div id="morphic-extension-zone"></div>
                </div>
            </div>
        `;
        
        const inputs = ['edit-title', 'edit-type', 'edit-visibility', 'edit-status', 'edit-category', 'edit-content', 'edit-start-date', 'edit-start-time', 'edit-end-date', 'edit-end-time', 'edit-recurring'];
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
        
        document.getElementById('edit-type').addEventListener('change', (e) => {
            this.markInteracted();
            this.toggleTypeExtensions(e.target.value);
            this.triggerAutoSave();
        });
        
        this.setupColorPalette(item);
        this.bindDateInputDefaults('edit-start-date', 'edit-start-time');
        this.bindDateInputDefaults('edit-end-date', 'edit-end-time');
        this.syncEditorTheme(item.backgroundColor || '');
        this.bindCollapsable('config-section-header', 'config-section');
        this.bindCollapsable('content-section-header', 'content-section');
        if (item.type === 'checklist') {
            document.getElementById('checklist-section')?.classList.remove('collapsed');
            document.querySelector('#checklist-section-header .collapsable-toggle')?.classList.remove('collapsed');
            document.getElementById('checklist-section-header')?.classList.add('is-locked-open');
        } else {
            this.bindCollapsable('checklist-section-header', 'checklist-section');
        }

        attachAutoGrow(document.getElementById('edit-content'), { maxHeight: 420 });
        this.toggleTypeExtensions(item.type);
    },
    
    updateLineCounter() {
        const contentText = document.getElementById('edit-content')?.value || '';
        const contentLines = contentText.split(/\r\n|\r|\n/).filter(line => line.trim().length > 0).length;
        
        const checklistRows = document.querySelectorAll('#checklist-rows-active .step-row--edit, #checklist-rows-done .step-row--edit');
        const checklistLines = checklistRows.length;
        
        const totalLines = contentLines + checklistLines;
        
        const counterDisplay = document.getElementById('line-counter-display');
        if (counterDisplay) {
            counterDisplay.textContent = `${totalLines}`;
        }
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

    getChecklistContainers() {
        return {
            active: document.getElementById('checklist-rows-active'),
            done: document.getElementById('checklist-rows-done'),
            doneSection: document.getElementById('checklist-done-section')
        };
    },

    updateDoneSectionVisibility() {
        const { done, doneSection } = this.getChecklistContainers();
        if (!doneSection || !done) return;
        doneSection.classList.toggle('is-hidden', done.querySelectorAll('.step-row--edit').length === 0);
    },

    handleEditorStepCheckChange(row) {
        const checkbox = row.querySelector('.step-check');
        const { active, done } = this.getChecklistContainers();
        if (!active || !done || !checkbox) return;

        if (checkbox.checked) {
            done.appendChild(row);
            row.dataset.level = '0';
            row.style.paddingLeft = '0.5rem';
            row.querySelector('.step-outdent-btn').disabled = true;
            row.querySelector('.step-indent-btn').disabled = false;
            row.querySelector('.step-indent-btn').style.visibility = 'hidden';
            row.querySelector('.step-outdent-btn').style.visibility = 'hidden';
            row.querySelector('.step-collapse-btn--edit')?.style.setProperty('visibility', 'hidden');
            row.removeAttribute('draggable');
        } else {
            row.dataset.level = '0';
            row.style.paddingLeft = '0.5rem';
            row.querySelector('.step-outdent-btn').disabled = true;
            row.querySelector('.step-indent-btn').disabled = false;
            row.querySelector('.step-indent-btn').style.visibility = '';
            row.querySelector('.step-outdent-btn').style.visibility = '';
            row.setAttribute('draggable', 'true');
            active.appendChild(row);
            this.syncEditorChecklistCollapse(active);
        }

        this.updateDoneSectionVisibility();
    },

    toggleTypeExtensions(type) {
        const extensionZone = document.getElementById('morphic-extension-zone');
        const checklistPanel = document.getElementById('checklist-panel');
        if (!extensionZone) return;

        checklistPanel?.classList.toggle('is-hidden', type !== 'checklist');
        extensionZone.innerHTML = '';

        if (type === 'checklist') {
            const steps = this.activeItem.steps || [];
            extensionZone.innerHTML = `
                <div id="checklist-rows-active" class="checklist-rows-zone"></div>
                <div id="checklist-done-section" class="checklist-done-section is-hidden">
                    <div class="checklist-done-divider"><span>Done</span></div>
                    <div id="checklist-rows-done" class="checklist-rows-zone"></div>
                </div>
                <button type="button" class="btn btn--sm btn--compact" id="btn-add-step-row">+ Item</button>
            `;
            const activeContainer = document.getElementById('checklist-rows-active');
            const doneContainer = document.getElementById('checklist-rows-done');
            activeContainer.addEventListener('dragover', (e) => this.handleContainerDragOver(e, activeContainer));
            if (!activeContainer.dataset.collapseBound) {
                activeContainer.dataset.collapseBound = '1';
                activeContainer.addEventListener('click', (e) => {
                    const btn = e.target.closest('.step-collapse-btn--edit');
                    if (!btn || btn.style.visibility === 'hidden') return;
                    e.stopPropagation();
                    const row = btn.closest('.step-row--edit');
                    const stepId = row?.dataset.stepId;
                    if (!stepId) return;
                    const collapseKey = `${this.activeItem.id}:${stepId}`;
                    const keys = this.getChecklistCollapsedKeys();
                    keys[collapseKey] = !keys[collapseKey];
                    if (!keys[collapseKey]) delete keys[collapseKey];
                    localStorage.setItem('matrix_checklist_collapsed', JSON.stringify(keys));
                    this.syncEditorChecklistCollapse(activeContainer);
                });
            }
            document.getElementById('checklist-section')?.classList.remove('collapsed');
            document.querySelector('#checklist-section-header .collapsable-toggle')?.classList.remove('collapsed');
            document.getElementById('checklist-section-header')?.classList.add('is-locked-open');
            reorderStepsByCompletion(steps);
            const { active, done } = partitionChecklistSteps(steps);
            active.forEach(step => this.appendStepRow(activeContainer, step, { isDone: false }));
            done.forEach(step => this.appendStepRow(doneContainer, step, { isDone: true }));
            if (steps.length === 0) this.appendStepRow(activeContainer, null, { isDone: false });
            this.updateDoneSectionVisibility();
            document.getElementById('btn-add-step-row').addEventListener('click', () => {
                this.markInteracted();
                this.appendStepRow(activeContainer, null, { isDone: false });
                this.updateLineCounter();
                this.triggerAutoSave();
            });
            
            const contentInput = document.getElementById('edit-content');
            if (contentInput) {
                contentInput.addEventListener('input', () => {
                    this.updateLineCounter();
                    this.markInteracted();
                    this.triggerAutoSave();
                });
            }
            
            this.syncEditorChecklistCollapse(activeContainer);
            this.updateLineCounter();
        }
    },

    getChecklistCollapsedKeys() {
        try {
            return JSON.parse(localStorage.getItem('matrix_checklist_collapsed') || '{}');
        } catch {
            return {};
        }
    },

    syncEditorChecklistCollapse(container) {
        if (!container || !this.activeItem?.id) return;
        const rows = [...container.querySelectorAll('.step-row--edit')];
        const levels = rows.map(row => parseInt(row.dataset.level || '0', 10) || 0);
        const collapsedKeys = this.getChecklistCollapsedKeys();
        const itemId = this.activeItem.id;
        let suppressBelow = -1;

        rows.forEach((row, index) => {
            const level = levels[index];
            if (!row.dataset.stepId) {
                row.dataset.stepId = `step_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            }
            const stepId = row.dataset.stepId;
            const collapseKey = `${itemId}:${stepId}`;
            const hasKids = levelListHasDescendants(levels, index);
            const collapseBtn = row.querySelector('.step-collapse-btn--edit');

            if (hasKids && collapseBtn) {
                const isCollapsed = !!collapsedKeys[collapseKey];
                collapseBtn.textContent = isCollapsed ? '▶' : '▼';
                collapseBtn.title = isCollapsed ? 'Expand group' : 'Collapse group';
                collapseBtn.style.visibility = 'visible';
                collapseBtn.setAttribute('aria-hidden', 'false');
            } else if (collapseBtn) {
                collapseBtn.style.visibility = 'hidden';
                collapseBtn.setAttribute('aria-hidden', 'true');
            }

            if (suppressBelow >= 0 && level > suppressBelow) {
                row.classList.add('is-collapsed-child');
                row.style.display = 'none';
            } else {
                row.classList.remove('is-collapsed-child');
                row.style.display = '';
                suppressBelow = -1;
                if (hasKids && collapsedKeys[collapseKey]) {
                    suppressBelow = level;
                }
            }
        });
    },
    
    appendStepRow(container, step = null, { isDone = false } = {}) {
        const row = document.createElement('div');
        row.classList.add('step-row', 'step-row--edit');
        if (!isDone) row.setAttribute('draggable', 'true');
        if (step && step.id) row.dataset.stepId = step.id;
        if (step && step.startDateTime) row.dataset.startDateTime = step.startDateTime;
        if (step && step.endDateTime) row.dataset.endDateTime = step.endDateTime;
        const rawLevel = isDone ? 0 : parseInt(step?.level ?? '0', 10) || 0;
        const level = Math.min(4, Math.max(0, rawLevel));
        row.dataset.level = String(level);
        row.style.paddingLeft = `${0.5 + level * 0.45}rem`;
        
        const hasDate = !!(step && (step.startDateTime || step.endDateTime));
        
        row.innerHTML = `
            <div class="step-row-leading">
                <div class="grab-handle">⋮⋮</div>
                <button type="button" class="step-collapse-btn step-collapse-btn--edit" style="visibility:hidden" aria-hidden="true">▼</button>
                <input type="checkbox" class="step-check" ${step && step.completed ? 'checked' : ''}>
            </div>
            <textarea class="form-input step-text input-grow" rows="1" placeholder="Checklist item...">${step ? this.escapeQuotes(step.text) : ''}</textarea>
            <div class="step-row-actions">
                <button type="button" class="card-act step-outdent-btn" title="Outdent" aria-label="Outdent"${level === 0 ? ' disabled' : ''}>‹</button>
                <button type="button" class="card-act step-indent-btn" title="Indent" aria-label="Indent"${level >= 4 ? ' disabled' : ''}>›</button>
                <button type="button" class="card-act step-date-btn${hasDate ? ' btn--date-on is-on' : ''}" title="Set date">${CARD_ICONS.calendar}</button>
                <button type="button" class="card-act card-act--danger remove-row-btn" title="Remove" aria-label="Remove">${CARD_ICONS.close}</button>
            </div>
        `;
        
        const textarea = row.querySelector('.step-text');
        attachAutoGrow(textarea, { maxHeight: 240 });
        textarea.addEventListener('input', () => {
            this.updateLineCounter();
            this.markInteracted();
            this.triggerAutoSave();
        });
        
        row.addEventListener('dragstart', () => {
            this.draggedRow = row;
            row.style.opacity = '0.4';
        });
        row.addEventListener('dragend', () => {
            this.draggedRow = null;
            row.style.opacity = '1.0';
        });
        
        row.querySelector('.remove-row-btn').addEventListener('click', () => {
            this.markInteracted();
            row.remove();
            this.updateDoneSectionVisibility();
            this.updateLineCounter();
            this.triggerAutoSave();
        });
        
        row.querySelector('.step-check').addEventListener('change', () => {
            this.handleEditorStepCheckChange(row);
            this.updateLineCounter();
            this.markInteracted();
            this.triggerAutoSave();
        });

        row.querySelector('.step-indent-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const next = Math.min(4, (parseInt(row.dataset.level || '0', 10) || 0) + 1);
            row.dataset.level = String(next);
            row.style.paddingLeft = `${0.5 + next * 0.45}rem`;
            row.querySelector('.step-outdent-btn').disabled = next === 0;
            row.querySelector('.step-indent-btn').disabled = next >= 4;
            this.syncEditorChecklistCollapse(container);
            this.markInteracted();
            this.triggerAutoSave();
        });

        row.querySelector('.step-outdent-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const next = Math.max(0, (parseInt(row.dataset.level || '0', 10) || 0) - 1);
            row.dataset.level = String(next);
            row.style.paddingLeft = `${0.5 + next * 0.45}rem`;
            row.querySelector('.step-outdent-btn').disabled = next === 0;
            row.querySelector('.step-indent-btn').disabled = next >= 4;
            this.syncEditorChecklistCollapse(container);
            this.markInteracted();
            this.triggerAutoSave();
        });
        
        const dateBtn = row.querySelector('.step-date-btn');
        dateBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const currentStart = row.dataset.startDateTime || '';
            const currentEnd = row.dataset.endDateTime || '';
            this.showDatePickerForStep(row, currentStart, currentEnd);
        });
        
        container.appendChild(row);
        if (isDone) {
            row.querySelector('.step-indent-btn').style.visibility = 'hidden';
            row.querySelector('.step-outdent-btn').style.visibility = 'hidden';
            row.querySelector('.step-collapse-btn--edit')?.style.setProperty('visibility', 'hidden');
        } else {
            const activeContainer = document.getElementById('checklist-rows-active');
            this.syncEditorChecklistCollapse(activeContainer || container);
        }
        this.updateLineCounter();
    },

    handleContainerDragOver(e, container) {
        e.preventDefault();
        if (!this.draggedRow) return;
        const siblings = [...container.querySelectorAll('.step-row--edit:not([style*="opacity: 0.4"])')];
        const nextSibling = siblings.find(sibling => {
            const box = sibling.getBoundingClientRect();
            return e.clientY <= box.top + box.height / 2;
        });
        if (nextSibling) { container.insertBefore(this.draggedRow, nextSibling); } 
        else { container.appendChild(this.draggedRow); }
        this.syncEditorChecklistCollapse(container);
        this.updateLineCounter();
        this.markInteracted();
        this.triggerAutoSave();
    },
    
    collectAndSave() {
        this.markInteracted();
        this.autoSave();
        this.closeAndSave();
    },
    
    emitDeleteAction() {
        if (confirm(`Are you absolutely sure you want to permanently delete "${this.activeItem.title}"?`)) {
            window.dispatchEvent(new CustomEvent('item:deletion_requested', { detail: this.activeItem.id }));
            this.close();
        }
    },
    
    escapeQuotes(str) { return str ? str.replace(/"/g, '&quot;') : ''; }
};
