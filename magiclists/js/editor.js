import { CARD_ICONS, attachAutoGrow } from './ui.js';

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

        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeAndSave());
        this.saveBtn?.addEventListener('click', () => {
            this.markInteracted();
            this.autoSave();
            this.closeAndSave();
        });
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
        this.renderForm();
        this.updateCalendarToggleUI();
        this.overlay.classList.remove('is-hidden'); const modal = this.overlay.querySelector('.modal'); if (modal) { modal.classList.add('modal--editor'); }
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
        const inputColor = document.getElementById('edit-bg-color')?.value || '#26262b';
        const finalBgColor = (inputColor === '#26262b') ? "" : inputColor;
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
            startDateTime: document.getElementById('edit-start-datetime')?.value || '',
            endDateTime: document.getElementById('edit-end-datetime')?.value || '',
            isRecurring: document.getElementById('edit-recurring')?.value === 'yes',
            hideFromCalendar: this.activeItem.hideFromCalendar === true,
            hiddenFromBoard: this.activeItem.hiddenFromBoard === true
        };
        
        if (activeType === 'checklist') {
            data.steps = [];
            document.querySelectorAll('.step-row--edit').forEach((row, idx) => {
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
    
    closeAndSave() {
        if (this.hasUserInteracted) {
            const currentData = this.collectFormData();
            const hasContent = currentData.title.trim() !== "" || currentData.content.trim() !== "" || 
                              (currentData.steps && currentData.steps.length > 0);
            
            if (hasContent || !this.isNewUnsavedNote) {
                this.autoSave();
            }
        }
        
        this.overlay.classList.add('is-hidden');
        this.mountZone.innerHTML = '';
        this.activeItem = null;
        this.draggedRow = null;
        this.hasUserInteracted = false;
        this.isNewUnsavedNote = false;
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    },
    
    close() {
        this.overlay.classList.add('is-hidden');
        this.mountZone.innerHTML = '';
        this.activeItem = null;
        this.draggedRow = null;
        this.hasUserInteracted = false;
        this.isNewUnsavedNote = false;
        if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    },
    
    showDatePickerForStep(rowElement, currentStart, currentEnd) {
        const modal = document.createElement('div');
        modal.className = 'date-picker-modal';
        
        modal.innerHTML = `
            <h4 class="section-title">Set Line Date</h4>
            <div class="form-group">
                <label>Start Date & Time</label>
                <input type="datetime-local" id="step-start-datetime" class="form-input" value="${currentStart || ''}">
            </div>
            <div class="form-group">
                <label>End Date & Time (Optional)</label>
                <input type="datetime-local" id="step-end-datetime" class="form-input" value="${currentEnd || ''}">
            </div>
            <div class="form-actions">
                <button class="btn btn--flex-1" id="step-date-clear">Clear</button>
                <button class="btn btn--accent active btn--grow" id="step-date-save">Save</button>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        const startInput = document.getElementById('step-start-datetime');
        const endInput = document.getElementById('step-end-datetime');
        
        // Auto-focus end date after start date is set
        startInput.addEventListener('change', () => {
            if (startInput.value && !endInput.value) {
                endInput.value = startInput.value;
            }
            endInput.focus();
        });
        
        document.getElementById('step-date-save').addEventListener('click', () => {
            const startVal = startInput.value;
            const endVal = endInput.value;
            rowElement.dataset.startDateTime = startVal;
            rowElement.dataset.endDateTime = endVal;
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
        
        // If start already has a value, focus end on open
        if (startInput.value && !endInput.value) {
            endInput.focus();
        }
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
        this.deleteBtn?.classList.toggle('is-hidden', !isExistingItem);
        this.saveBtn.innerHTML = CARD_ICONS.save;
        document.getElementById('modal-close-btn').innerHTML = CARD_ICONS.close;
        if (this.deleteBtn) this.deleteBtn.innerHTML = CARD_ICONS.delete;
        this.updateCalendarToggleUI();
        const hasHiddenSteps = item.type === 'note' && item.steps && item.steps.length > 0;
        const warningLightHtml = hasHiddenSteps
            ? `<div class="warning-banner">⚠️ This note contains ${item.steps.length} hidden checklist items from a previous state. Switch type to re-activate.</div>`
            : '';
        this.mountZone.innerHTML = `
            ${warningLightHtml}
            <input type="text" id="edit-title" class="form-input form-input--title" placeholder="${isExistingItem ? 'Edit title' : 'New title'}" value="${this.escapeQuotes(item.title)}">

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

            <div class="editor-panel">
                <div class="collapsable-header" id="config-section-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle collapsed">▼</span>Configuration</span>
                </div>
                <div class="collapsable-section collapsed" id="config-section">
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
                            <input type="datetime-local" id="edit-start-datetime" class="form-input" value="${item.startDateTime || ''}">
                        </div>
                        <div class="form-group form-group--compact">
                            <label>End</label>
                            <input type="datetime-local" id="edit-end-datetime" class="form-input" value="${item.endDateTime || ''}">
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
                            <label>Color</label>
                            <input type="color" id="edit-bg-color" class="color-picker-input color-picker-input--block" value="${item.backgroundColor || '#26262b'}">
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        const inputs = ['edit-title', 'edit-type', 'edit-visibility', 'edit-status', 'edit-category', 'edit-content', 'edit-start-datetime', 'edit-end-datetime', 'edit-recurring', 'edit-bg-color'];
        inputs.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('input', () => {
                    this.markInteracted();
                    this.triggerAutoSave();
                });
                el.addEventListener('change', () => {
                    this.markInteracted();
                    this.triggerAutoSave();
                });
            }
        });
        
        document.getElementById('edit-type').addEventListener('change', (e) => {
            this.markInteracted();
            this.toggleTypeExtensions(e.target.value);
            this.triggerAutoSave();
        });
        
        this.bindCollapsable('content-section-header', 'content-section');
        this.bindCollapsable('checklist-section-header', 'checklist-section');
        this.bindCollapsable('config-section-header', 'config-section', true);

        attachAutoGrow(document.getElementById('edit-content'), { maxHeight: 160 });
        this.toggleTypeExtensions(item.type);
    },
    
    updateLineCounter() {
        const contentText = document.getElementById('edit-content')?.value || '';
        const contentLines = contentText.split(/\r\n|\r|\n/).filter(line => line.trim().length > 0).length;
        
        const checklistRows = document.querySelectorAll('#checklist-rows-container .step-row--edit');
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

    toggleTypeExtensions(type) {
        const extensionZone = document.getElementById('morphic-extension-zone');
        const checklistPanel = document.getElementById('checklist-panel');
        if (!extensionZone) return;

        checklistPanel?.classList.toggle('is-hidden', type !== 'checklist');
        extensionZone.innerHTML = '';

        if (type === 'checklist') {
            const steps = this.activeItem.steps || [];
            extensionZone.innerHTML = `
                <div id="checklist-rows-container"></div>
                <button type="button" class="btn btn--sm btn--compact" id="btn-add-step-row">+ Item</button>
            `;
            const container = document.getElementById('checklist-rows-container');
            container.addEventListener('dragover', (e) => this.handleContainerDragOver(e, container));
            steps.forEach(step => this.appendStepRow(container, step));
            if (steps.length === 0) this.appendStepRow(container);
            document.getElementById('btn-add-step-row').addEventListener('click', () => {
                this.markInteracted();
                this.appendStepRow(container);
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
            
            this.updateLineCounter();
        }
    },
    
    appendStepRow(container, step = null) {
        const row = document.createElement('div');
        row.classList.add('step-row', 'step-row--edit');
        row.setAttribute('draggable', 'true');
        if (step && step.id) row.dataset.stepId = step.id;
        if (step && step.startDateTime) row.dataset.startDateTime = step.startDateTime;
        if (step && step.endDateTime) row.dataset.endDateTime = step.endDateTime;
        const level = Math.min(4, Math.max(0, parseInt(step?.level ?? '0', 10) || 0));
        row.dataset.level = String(level);
        row.style.paddingLeft = `${0.5 + level * 0.45}rem`;
        
        const hasDate = !!(step && (step.startDateTime || step.endDateTime));
        
        row.innerHTML = `
            <div class="grab-handle">⋮⋮</div>
            <input type="checkbox" class="step-check" ${step && step.completed ? 'checked' : ''}>
            <textarea class="form-input step-text input-grow" rows="1" placeholder="Checklist item...">${step ? this.escapeQuotes(step.text) : ''}</textarea>
            <button type="button" class="card-act step-outdent-btn" title="Outdent" aria-label="Outdent"${level === 0 ? ' disabled' : ''}>‹</button>
            <button type="button" class="card-act step-indent-btn" title="Indent" aria-label="Indent"${level >= 4 ? ' disabled' : ''}>›</button>
            <button type="button" class="card-act step-date-btn${hasDate ? ' btn--date-on is-on' : ''}" title="Set date">${CARD_ICONS.calendar}</button>
            <button type="button" class="card-act card-act--danger remove-row-btn" title="Remove">${CARD_ICONS.delete}</button>
        `;
        
        const textarea = row.querySelector('.step-text');
        attachAutoGrow(textarea, { maxHeight: 96 });
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
            this.updateLineCounter();
            this.triggerAutoSave();
        });
        
        row.querySelector('.step-check').addEventListener('change', () => {
            this.sortChecklistRowsByCompletion(container);
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
        this.updateLineCounter();
    },
    
    sortChecklistRowsByCompletion(container) {
        const rows = [...container.querySelectorAll('.step-row--edit')];
        const withIndex = rows.map((row, index) => ({ row, index }));
        withIndex.sort((a, b) => {
            const aDone = a.row.querySelector('.step-check')?.checked;
            const bDone = b.row.querySelector('.step-check')?.checked;
            if (aDone !== bDone) return aDone ? 1 : -1;
            return a.index - b.index;
        });
        withIndex.forEach(({ row }) => container.appendChild(row));
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
