import { Holidays } from './holidays.js';
import { readStoredCategories } from './categories.js';
import { CARD_ICONS } from './ui.js';
import { resolveNoteColor } from './colorPicker.js';
import { stripRichText } from './richText.js';

export const Calendar = {
    overlay: null,
    mountZone: null,
    defaultMount: null,
    inlineMode: false,
    onInlineClose: null,
    currentView: 'month',
    currentDate: new Date(),
    selectedDate: null,
    items: [],
    hiddenCategories: [],
    autoSaveTimer: null,
    
    isItemCalendarHidden(itemId) {
        try {
            const ids = JSON.parse(localStorage.getItem('matrix_calendar_hidden_ids') || '[]');
            return ids.includes(itemId);
        } catch {
            return false;
        }
    },

    init() {
        this.overlay = document.getElementById('calendar-overlay');
        this.defaultMount = document.getElementById('calendar-mount');
        
        const savedView = localStorage.getItem('calendar_last_view');
        const savedDate = localStorage.getItem('calendar_last_date');
        if (savedView) this.currentView = savedView;
        if (savedDate) this.currentDate = new Date(savedDate);
        
        window.addEventListener('categories:toggled', () => {
            if (this.isActive()) this.refresh();
        });
    },

    isActive() {
        if (this.inlineMode) return !!this.mountZone?.innerHTML;
        return this.overlay && !this.overlay.classList.contains('is-hidden');
    },
    
    open(items, options = {}) {
        this.items = items;
        this.hiddenCategories = JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]');
        this.inlineMode = !!options.inline;
        this.onInlineClose = options.onClose || null;

        if (options.mount) {
            this.mountZone = options.mount;
        } else {
            this.mountZone = this.defaultMount;
            this.inlineMode = false;
        }

        this.render();

        if (!this.inlineMode && this.overlay) {
            this.overlay.classList.remove('is-hidden');
        }
    },
    
    close() {
        const stepModals = document.querySelectorAll('.step-date-modal');
        stepModals.forEach(modal => modal.remove());

        if (this.mountZone) this.mountZone.innerHTML = '';

        if (this.inlineMode) {
            const done = this.onInlineClose;
            this.inlineMode = false;
            this.onInlineClose = null;
            if (done) done();
            return;
        }

        if (this.overlay) this.overlay.classList.add('is-hidden');
    },
    
    refresh() {
        this.hiddenCategories = JSON.parse(localStorage.getItem('matrix_hidden_categories') || '[]');
        this.render();
    },

    getFilteredItems() {
        return this.items || [];
    },
    
    saveState() {
        localStorage.setItem('calendar_last_view', this.currentView);
        localStorage.setItem('calendar_last_date', this.currentDate.toISOString());
    },
    
    setDefaultDateForView(view) {
        const today = new Date();
        if (view === 'month') {
            this.currentDate = new Date(today.getFullYear(), today.getMonth(), 1);
        } else if (view === 'year') {
            this.currentDate = new Date(today.getFullYear(), 0, 1);
        } else if (view === 'day') {
            this.currentDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        }
    },
    
    shouldShowRed(date) {
        const dayOfWeek = date.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) return true;
        return Holidays.isHoliday(date) !== null;
    },
    
    isToday(date) {
        const today = new Date();
        return date.getFullYear() === today.getFullYear() &&
               date.getMonth() === today.getMonth() &&
               date.getDate() === today.getDate();
    },
    
    getEventsForDate(date) {
        const targetDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        targetDate.setHours(0, 0, 0, 0);
        
        const events = [];
        
        this.getFilteredItems().forEach(item => {
            if (item.status === 'archived') return;
            if (item.hideFromCalendar || this.isItemCalendarHidden(item.id)) return;
            const itemCategory = item.categories?.[0] || '';
            if (this.hiddenCategories.includes(itemCategory)) return;
            
            // Check checklist steps first
            if (item.type === 'checklist' && item.steps && item.steps.length > 0) {
                item.steps.forEach(step => {
                    let startDate = null;
                    let endDate = null;
                    
                    if (step.startDateTime) {
                        startDate = new Date(step.startDateTime);
                    } else if (item.startDateTime) {
                        startDate = new Date(item.startDateTime);
                    } else {
                        return;
                    }
                    
                    if (step.endDateTime) {
                        endDate = new Date(step.endDateTime);
                        endDate.setHours(23, 59, 59, 999);
                    } else if (item.endDateTime) {
                        endDate = new Date(item.endDateTime);
                        endDate.setHours(23, 59, 59, 999);
                    } else {
                        endDate = new Date(startDate);
                        endDate.setHours(23, 59, 59, 999);
                    }
                    
                    const targetTime = targetDate.getTime();
                    const startTime = startDate.getTime();
                    const endTime = endDate.getTime();
                    
                    if (targetTime >= startTime && targetTime <= endTime) {
                        events.push({
                            id: `${item.id}_step_${step.id}`,
                            title: stripRichText(`${step.completed ? '✓' : '☐'} ${item.title}: ${step.text}`),
                            color: this.getNoteColor(item),
                            backgroundColor: resolveNoteColor(item.backgroundColor),
                            isStep: true,
                            parentId: item.id,
                            stepId: step.id
                        });
                    }
                });
            }
            
            // Check note-level dates
            let startDate = null;
            let endDate = null;
            
            if (item.startDateTime) {
                startDate = new Date(item.startDateTime);
            } else {
                return;
            }
            
            if (item.endDateTime) {
                endDate = new Date(item.endDateTime);
                endDate.setHours(23, 59, 59, 999);
            } else {
                endDate = new Date(startDate);
                endDate.setHours(23, 59, 59, 999);
            }
            
            const targetTime = targetDate.getTime();
            const startTime = startDate.getTime();
            const endTime = endDate.getTime();
            
            if (targetTime >= startTime && targetTime <= endTime) {
                events.push({
                    id: item.id,
                    title: stripRichText(item.title || ''),
                    color: this.getNoteColor(item),
                    backgroundColor: resolveNoteColor(item.backgroundColor),
                    isStep: false,
                    parentId: item.id
                });
            }
        });
        
        return events;
    },
    
    getNoteColor(item) {
        if (item.backgroundColor) return item.backgroundColor;
        const categoryName = item.categories?.[0] || '';
        const storedCats = localStorage.getItem('matrix_custom_categories');
        if (storedCats) {
            try {
                const cats = JSON.parse(storedCats);
                const matched = cats.find(c => c.name === categoryName);
                if (matched) return matched.color;
            } catch(e) {}
        }
        const matched = readStoredCategories().find(c => c.name === categoryName);
        return matched ? matched.color : "#64748b";
    },
    
    render() {
        this.saveState();
        
        const viewButtons = `
            <div class="calendar-view-buttons">
                <button class="btn btn--compact ${this.currentView === 'month' ? 'active' : ''}" data-view="month">Month</button>
                <button class="btn btn--compact ${this.currentView === 'year' ? 'active' : ''}" data-view="year">Year</button>
                <button class="btn btn--compact ${this.currentView === 'day' ? 'active' : ''}" data-view="day">Day</button>
            </div>
        `;
        
        let content = '';
        if (this.currentView === 'month') content = this.renderMonthView();
        else if (this.currentView === 'year') content = this.renderYearView();
        else if (this.currentView === 'day') content = this.renderDayView();
        
        this.mountZone.innerHTML = `
            <div class="toolbar toolbar--spread calendar-toolbar">
                <div class="calendar-nav">
                    <button class="btn btn--compact btn-icon" id="calendar-prev">◀</button>
                    <span id="calendar-title" class="calendar-title">${this.getTitle()}</span>
                    <button class="btn btn--compact btn-icon" id="calendar-next">▶</button>
                    <select id="holiday-country-select" class="btn btn--compact calendar-holiday-select">
                        ${Object.entries(Holidays.countries).map(([code, name]) => 
                            `<option value="${code}" ${Holidays.getCountry() === code ? 'selected' : ''}>${name}</option>`
                        ).join('')}
                    </select>
                </div>
                ${viewButtons}
            </div>
            <div id="calendar-grid" class="calendar-grid-container">
                ${content}
            </div>
            <div class="toolbar toolbar--spread calendar-footer">
                <button class="btn btn--compact" id="calendar-today">Today</button>
                <button class="btn btn--compact" id="calendar-add-note">+ Add Note</button>
            </div>
        `;
        
        document.getElementById('calendar-prev').addEventListener('click', () => this.navigate(-1));
        document.getElementById('calendar-next').addEventListener('click', () => this.navigate(1));
        document.getElementById('calendar-today').addEventListener('click', () => {
            this.setDefaultDateForView(this.currentView);
            this.render();
        });
        document.getElementById('calendar-add-note').addEventListener('click', () => {
            const defaultDate = this.currentView === 'day' ? this.currentDate : new Date();
            defaultDate.setHours(12, 0, 0, 0);
            window.dispatchEvent(new CustomEvent('calendar:add_note', { detail: defaultDate }));
        });
        document.getElementById('holiday-country-select').addEventListener('change', (e) => {
            Holidays.setCountry(e.target.value);
            this.render();
        });
        
        document.querySelectorAll('[data-view]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const newView = e.target.getAttribute('data-view');
                this.currentView = newView;
                this.setDefaultDateForView(newView);
                this.render();
            });
        });
    },
    
    getTitle() {
        if (this.currentView === 'month') {
            return this.currentDate.toLocaleDateString('default', { month: 'long', year: 'numeric' });
        } else if (this.currentView === 'year') {
            return this.currentDate.getFullYear().toString();
        } else {
            return this.currentDate.toLocaleDateString('default', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        }
    },
    
    navigate(delta) {
        if (this.currentView === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() + delta);
        } else if (this.currentView === 'year') {
            this.currentDate.setFullYear(this.currentDate.getFullYear() + delta);
        } else {
            this.currentDate.setDate(this.currentDate.getDate() + delta);
        }
        this.render();
    },
    
    renderMonthView() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const firstDay = new Date(year, month, 1);
        const startDay = firstDay.getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        
        let grid = '<div class="calendar-month-grid">';
        const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        weekdays.forEach(day => {
            grid += `<div class="calendar-weekday">${day}</div>`;
        });
        
        for (let i = 0; i < startDay; i++) {
            grid += `<div class="calendar-empty-cell"></div>`;
        }
        
        for (let d = 1; d <= daysInMonth; d++) {
            const currentDate = new Date(year, month, d);
            const events = this.getEventsForDate(currentDate);
            const hasEvents = events.length > 0;
            const isRed = this.shouldShowRed(currentDate);
            const isToday = this.isToday(currentDate);
            
            let gradient = '';
            let numberClass = 'cal-text--default';
            let todayClass = '';
            
            if (hasEvents && events.length === 1) {
                gradient = `background: ${events[0].color};`;
                numberClass = 'cal-text--white';
            } else if (hasEvents && events.length > 1) {
                const colors = events.map(e => e.color);
                const angleStep = 360 / colors.length;
                const stops = colors.map((color, idx) => `${color} ${idx * angleStep}deg ${(idx + 1) * angleStep}deg`).join(', ');
                gradient = `background: conic-gradient(from 0deg, ${stops});`;
                numberClass = 'cal-text--white';
            } else if (isRed) {
                numberClass = 'cal-text--red';
            }
            
            if (isToday && !hasEvents) {
                todayClass = 'calendar-day-today';
            } else if (isToday && hasEvents) {
                todayClass = 'calendar-day-today';
            }
            
            grid += `
                <div class="calendar-day ${todayClass}" data-year="${year}" data-month="${month}" data-day="${d}" style="${gradient}">
                    <div class="calendar-day-number ${numberClass}">${d}</div>
                    ${hasEvents ? `<div class="calendar-day-notes-count" aria-label="${events.length} event${events.length === 1 ? '' : 's'}"></div>` : ''}
                </div>
            `;
        }
        
        grid += '</div>';
        
        setTimeout(() => {
            document.querySelectorAll('.calendar-day').forEach(el => {
                el.addEventListener('click', (e) => {
                    const year = parseInt(el.dataset.year);
                    const month = parseInt(el.dataset.month);
                    const day = parseInt(el.dataset.day);
                    const clickedDate = new Date(year, month, day);
                    const events = this.getEventsForDate(clickedDate);
                    if (events.length > 0) {
                        this.showEventsList(events, clickedDate);
                    } else {
                        window.dispatchEvent(new CustomEvent('calendar:add_note', { detail: clickedDate }));
                    }
                });
            });
        }, 10);
        
        return grid;
    },
    
    renderYearView() {
        const year = this.currentDate.getFullYear();
        let grid = '<div class="calendar-year-grid">';
        
        for (let m = 0; m < 12; m++) {
            const monthDate = new Date(year, m, 1);
            const daysInMonth = new Date(year, m + 1, 0).getDate();
            const firstDayIndex = new Date(year, m, 1).getDay();
            
            let hasAnyEvents = false;
            const dayEvents = {};
            for (let d = 1; d <= daysInMonth; d++) {
                const currentDate = new Date(year, m, d);
                const events = this.getEventsForDate(currentDate);
                if (events.length > 0) {
                    hasAnyEvents = true;
                    dayEvents[d] = events;
                }
            }
            
            const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
            const titleClass = hasAnyEvents ? 'calendar-year-month-title-highlight' : 'calendar-year-month-title-normal';
            
            let monthHtml = `
                <div class="calendar-year-month">
                    <div class="calendar-year-month-title ${titleClass}" data-month="${m}">
                        ${monthDate.toLocaleDateString('default', { month: 'short' })}
                    </div>
                    <div class="calendar-year-weekdays">
                        ${weekdays.map(day => `<div class="calendar-year-weekday">${day}</div>`).join('')}
                    </div>
                    <div class="calendar-year-days">
            `;
            
            for (let i = 0; i < firstDayIndex; i++) {
                monthHtml += `<div class="calendar-year-empty-cell"></div>`;
            }
            
            for (let d = 1; d <= daysInMonth; d++) {
                const hasEvents = dayEvents[d] && dayEvents[d].length > 0;
                const currentDate = new Date(year, m, d);
                const isToday = this.isToday(currentDate);
                let gradient = '';
                let textClass = 'cal-text--default';
                let weightClass = '';
                let todayClass = '';
                
                if (hasEvents && dayEvents[d].length === 1) {
                    gradient = `background: ${dayEvents[d][0].color};`;
                    textClass = 'cal-text--white';
                    weightClass = 'calendar-year-day-bold';
                } else if (hasEvents && dayEvents[d].length > 1) {
                    const colors = dayEvents[d].map(e => e.color);
                    const angleStep = 360 / colors.length;
                    const stops = colors.map((color, idx) => `${color} ${idx * angleStep}deg ${(idx + 1) * angleStep}deg`).join(', ');
                    gradient = `background: conic-gradient(from 0deg, ${stops});`;
                    textClass = 'cal-text--white';
                    weightClass = 'calendar-year-day-bold';
                } else {
                    if (this.shouldShowRed(currentDate)) {
                        textClass = 'cal-text--red';
                    }
                }
                
                if (isToday && !hasEvents) {
                    todayClass = 'calendar-year-day-today';
                } else if (isToday && hasEvents) {
                    todayClass = 'calendar-year-day-today';
                }
                
                monthHtml += `
                    <div class="calendar-year-day ${weightClass} ${todayClass}" data-year="${year}" data-month="${m}" data-day="${d}" style="${gradient}">
                        <span class="${textClass}">${d}</span>
                    </div>
                `;
            }
            
            monthHtml += `
                    </div>
                </div>
            `;
            
            grid += monthHtml;
        }
        
        grid += '</div>';
        
        setTimeout(() => {
            document.querySelectorAll('.calendar-year-month-title').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const month = parseInt(el.dataset.month);
                    this.currentDate = new Date(year, month, 1);
                    this.currentView = 'month';
                    this.render();
                });
            });
            
            document.querySelectorAll('.calendar-year-day').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const year = parseInt(el.dataset.year);
                    const month = parseInt(el.dataset.month);
                    const day = parseInt(el.dataset.day);
                    const clickedDate = new Date(year, month, day);
                    const events = this.getEventsForDate(clickedDate);
                    if (events.length > 0) {
                        this.showEventsList(events, clickedDate);
                    } else {
                        window.dispatchEvent(new CustomEvent('calendar:add_note', { detail: clickedDate }));
                    }
                });
            });
        }, 10);
        
        return grid;
    },
    
    showEventsList(events, date) {
        const modal = document.createElement('div');
        modal.className = 'calendar-notes-modal';
        
        modal.innerHTML = `
            <div class="calendar-notes-header">
                <h4 class="calendar-notes-title">Events for ${date.toLocaleDateString()}</h4>
                <button type="button" class="card-act card-act--close" id="close-notes-list" title="Close" aria-label="Close"></button>
            </div>
            <div class="calendar-notes-list">
                ${events.map(event => `
                    <div class="calendar-note-item" data-id="${event.id}" data-parent="${event.parentId}" data-step="${event.stepId || ''}" style="background: ${event.backgroundColor || 'var(--bg-card)'}; border-left: 3px solid ${event.color};">
                        <div class="calendar-note-title">${this.escapeHTML(event.title)}</div>
                        <div class="calendar-note-preview">${event.isStep ? 'Checklist item' : 'Note'}</div>
                    </div>
                `).join('')}
            </div>
        `;
        
        document.body.appendChild(modal);
        modal.querySelector('#close-notes-list').innerHTML = CARD_ICONS.close;
        
        modal.querySelectorAll('.calendar-note-item').forEach(el => {
            el.addEventListener('click', () => {
                const parentId = el.dataset.parent;
                const note = this.items.find(i => i.id === parentId);
                if (note) {
                    window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: note }));
                    modal.remove();
                }
            });
        });
        
        document.getElementById('close-notes-list').addEventListener('click', () => modal.remove());
    },
    
    renderDayView() {
        const date = this.currentDate;
        const events = this.getEventsForDate(date);
        const eventsByHour = {};
        
        events.forEach(event => {
            let hour = 12;
            const parentNote = this.items.find(i => i.id === event.parentId);
            if (parentNote) {
                if (event.isStep && event.stepId) {
                    const step = parentNote.steps?.find(s => s.id === event.stepId);
                    if (step && step.startDateTime) {
                        hour = new Date(step.startDateTime).getHours();
                    } else if (parentNote.startDateTime) {
                        hour = new Date(parentNote.startDateTime).getHours();
                    }
                } else if (parentNote.startDateTime) {
                    hour = new Date(parentNote.startDateTime).getHours();
                }
            }
            if (!eventsByHour[hour]) eventsByHour[hour] = [];
            eventsByHour[hour].push(event);
        });
        
        let timeline = '<div class="calendar-timeline">';
        for (let h = 0; h < 24; h++) {
            const hourEvents = eventsByHour[h] || [];
            const hourLabel = `${h.toString().padStart(2, '0')}:00`;
            
            timeline += `
                <div class="calendar-hour" data-hour="${h}">
                    <div class="calendar-hour-label">${hourLabel}</div>
                    <div class="calendar-hour-content">
                        ${hourEvents.map(event => `
                            <div class="calendar-hour-note" data-id="${event.id}" data-parent="${event.parentId}" data-step="${event.stepId || ''}" style="background: ${event.backgroundColor || 'var(--bg-card)'}; border-left: 3px solid ${event.color};">
                                <div class="calendar-hour-note-title">${this.escapeHTML(event.title)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        timeline += '</div>';
        
        setTimeout(() => {
            document.querySelectorAll('.calendar-hour').forEach(el => {
                el.addEventListener('click', (e) => {
                    if (e.target.classList.contains('calendar-hour-note')) return;
                    const hour = parseInt(el.dataset.hour);
                    const newDate = new Date(date);
                    newDate.setHours(hour, 0, 0, 0);
                    window.dispatchEvent(new CustomEvent('calendar:add_note', { detail: newDate }));
                });
            });
            
            document.querySelectorAll('.calendar-hour-note').forEach(el => {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const parentId = el.dataset.parent;
                    const note = this.items.find(i => i.id === parentId);
                    if (note) {
                        window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: note }));
                    }
                });
            });
        }, 10);
        
        return timeline;
    },
    
    escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
};
