import { Holidays } from './holidays.js';
import { readStoredCategories, resolveCategoryColor, UNCATEGORIZED_COLOR } from './categories.js';
import { CARD_ICONS } from './icons.js';
import { resolveNoteColor } from './colorPicker.js';
import { stripRichText } from './richText.js';
import { escapeHTML, escapeAttr } from './domEscape.js';
import { isoWeekNumber } from './plannerGantt.js';

/**
 * Split a month into Sunday-start week rows.
 *
 * The month grid and the year-view mini months both render from this, so the
 * two views cannot drift apart on padding cells, and the ISO week number is
 * taken from the row's Monday - by definition the Monday of the ISO week that
 * owns the whole row.
 * @param {number} year
 * @param {number} month 0-based month index
 * @returns {Array<{week: number, cells: Array<number|null>}>}
 */
export function buildMonthWeekRows(year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const rows = [];

    for (let start = 1 - firstDayIndex; start <= daysInMonth; start += 7) {
        const cells = [];
        for (let i = 0; i < 7; i++) {
            const day = start + i;
            cells.push(day >= 1 && day <= daysInMonth ? day : null);
        }
        rows.push({ week: isoWeekNumber(new Date(year, month, start + 1)), cells });
    }

    return rows;
}

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
    eventsModal: null,
    eventsModalBinding: null,
    
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
        this.closeEventsList();

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
    
    /**
     * Sundays and the holidays of the country selected in the toolbar carry the
     * subtle red tint. Saturdays used to be tinted as well; they are ordinary
     * days again.
     * @param {Date} date
     * @returns {{isRed: boolean, holidayName: string|null}}
     */
    getRedDayInfo(date) {
        const holidayName = Holidays.isHoliday(date) || null;
        return { isRed: date.getDay() === 0 || holidayName !== null, holidayName };
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
            if (item.steps && item.steps.length > 0) {
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
        return resolveCategoryColor(categoryName, readStoredCategories());
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

        this.bindGridEvents();
    },

    /**
     * One delegated click handler for every day / hour cell in the grid.
     *
     * The cells used to be bound one by one inside `setTimeout(…, 10)` with
     * `document.querySelectorAll`, and nothing deduped them: two renders inside
     * the same tick (the tool opening, a category toggle, a quick prev/next)
     * left a second listener on every cell, so one click opened two copies of
     * the events popout - and the visible copy's close button then pointed at
     * the *first* popup, i.e. it did nothing. Delegation makes that impossible:
     * `render()` replaces the grid HTML first, and a single listener survives.
     */
    bindGridEvents() {
        const grid = this.mountZone?.querySelector('#calendar-grid');
        if (!grid) return;

        grid.addEventListener('click', (e) => {
            const monthTitle = e.target.closest('.calendar-year-month-title');
            if (monthTitle) {
                e.stopPropagation();
                const month = parseInt(monthTitle.dataset.month, 10);
                this.currentDate = new Date(this.currentDate.getFullYear(), month, 1);
                this.currentView = 'month';
                this.render();
                return;
            }

            const hourNote = e.target.closest('.calendar-hour-note');
            if (hourNote) {
                e.stopPropagation();
                const note = this.items.find(i => i.id === hourNote.dataset.parent);
                if (note) {
                    window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: note }));
                }
                return;
            }

            const dayEl = e.target.closest('.calendar-day, .calendar-year-day');
            if (dayEl) {
                const clickedDate = new Date(
                    parseInt(dayEl.dataset.year, 10),
                    parseInt(dayEl.dataset.month, 10),
                    parseInt(dayEl.dataset.day, 10)
                );
                const events = this.getEventsForDate(clickedDate);
                if (events.length > 0) {
                    this.showEventsList(events, clickedDate);
                } else {
                    window.dispatchEvent(new CustomEvent('calendar:add_note', { detail: clickedDate }));
                }
                return;
            }

            const hourEl = e.target.closest('.calendar-hour');
            if (hourEl) {
                const newDate = new Date(this.currentDate);
                newDate.setHours(parseInt(hourEl.dataset.hour, 10), 0, 0, 0);
                window.dispatchEvent(new CustomEvent('calendar:add_note', { detail: newDate }));
            }
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
        const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

        let grid = '<div class="calendar-month-grid">';
        grid += '<div class="calendar-week-number calendar-week-number--header" aria-hidden="true"></div>';
        weekdays.forEach(day => {
            grid += `<div class="calendar-weekday">${day}</div>`;
        });

        buildMonthWeekRows(year, month).forEach(({ week, cells }) => {
            grid += `<div class="calendar-week-number" title="ISO week ${week}" aria-label="Week ${week}">${week}</div>`;

            cells.forEach((d) => {
                if (d === null) {
                    grid += `<div class="calendar-empty-cell"></div>`;
                    return;
                }

                const currentDate = new Date(year, month, d);
                const events = this.getEventsForDate(currentDate);
                const hasEvents = events.length > 0;
                const { isRed, holidayName } = this.getRedDayInfo(currentDate);
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

                if (isToday) {
                    todayClass = 'calendar-day-today';
                }

                const classes = ['calendar-day', todayClass].filter(Boolean).join(' ');
                const title = holidayName && !hasEvents ? ` title="${escapeAttr(holidayName)}"` : '';

                grid += `
                <div class="${classes}" data-year="${year}" data-month="${month}" data-day="${d}" style="${gradient}"${title}>
                    <div class="calendar-day-number ${numberClass}">${d}</div>
                    ${hasEvents ? `<div class="calendar-day-notes-count" aria-label="${events.length} event${events.length === 1 ? '' : 's'}"></div>` : ''}
                </div>
            `;
            });
        });

        grid += '</div>';

        return grid;
    },
    
    renderYearView() {
        const year = this.currentDate.getFullYear();
        const weekdays = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
        let grid = '<div class="calendar-year-grid">';

        for (let m = 0; m < 12; m++) {
            const monthDate = new Date(year, m, 1);
            const daysInMonth = new Date(year, m + 1, 0).getDate();

            let hasAnyEvents = false;
            const dayEvents = {};
            for (let d = 1; d <= daysInMonth; d++) {
                const events = this.getEventsForDate(new Date(year, m, d));
                if (events.length > 0) {
                    hasAnyEvents = true;
                    dayEvents[d] = events;
                }
            }

            const titleClass = hasAnyEvents ? 'calendar-year-month-title-highlight' : 'calendar-year-month-title-normal';

            let monthHtml = `
                <div class="calendar-year-month">
                    <div class="calendar-year-month-title ${titleClass}" data-month="${m}">
                        ${monthDate.toLocaleDateString('default', { month: 'short' })}
                    </div>
                    <div class="calendar-year-weekdays">
                        <div class="calendar-year-week-number calendar-year-week-number--header" aria-hidden="true"></div>
                        ${weekdays.map(day => `<div class="calendar-year-weekday">${day}</div>`).join('')}
                    </div>
                    <div class="calendar-year-days">
            `;

            buildMonthWeekRows(year, m).forEach(({ week, cells }) => {
                monthHtml += `<div class="calendar-year-week-number" title="ISO week ${week}" aria-label="Week ${week}">${week}</div>`;

                cells.forEach((d) => {
                    if (d === null) {
                        monthHtml += `<div class="calendar-year-empty-cell"></div>`;
                        return;
                    }

                    const hasEvents = dayEvents[d] && dayEvents[d].length > 0;
                    const currentDate = new Date(year, m, d);
                    const isToday = this.isToday(currentDate);
                    const { isRed, holidayName } = this.getRedDayInfo(currentDate);
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
                    } else if (isRed) {
                        textClass = 'cal-text--red';
                    }

                    if (isToday) {
                        todayClass = 'calendar-year-day-today';
                    }

                    const classes = ['calendar-year-day', weightClass, todayClass].filter(Boolean).join(' ');
                    const title = holidayName && !hasEvents ? ` title="${escapeAttr(holidayName)}"` : '';

                    monthHtml += `
                    <div class="${classes}" data-year="${year}" data-month="${m}" data-day="${d}" style="${gradient}"${title}>
                        <span class="${textClass}">${d}</span>
                    </div>
                `;
                });
            });

            monthHtml += `
                    </div>
                </div>
            `;

            grid += monthHtml;
        }

        grid += '</div>';

        return grid;
    },
    
    showEventsList(events, date) {
        // Never stack two popouts: a stale copy would own the shared close id
        // and leave the visible copy's X unbound.
        this.closeEventsList();

        const modal = document.createElement('div');
        modal.className = 'calendar-notes-modal';
        
        modal.innerHTML = `
            <div class="calendar-notes-header">
                <h4 class="calendar-notes-title">Events for ${date.toLocaleDateString()}</h4>
                <button type="button" class="card-act card-act--close calendar-notes-close" data-close-events title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            </div>
            <div class="calendar-notes-list">
                ${events.map(event => `
                    <div class="calendar-note-item" data-id="${event.id}" data-parent="${event.parentId}" data-step="${event.stepId || ''}" style="background: ${event.backgroundColor || 'var(--bg-card)'}; border-left: 3px solid ${event.color};">
                        <div class="calendar-note-title">${escapeHTML(event.title)}</div>
                        <div class="calendar-note-preview">${event.isStep ? 'Checklist item' : 'Note'}</div>
                    </div>
                `).join('')}
            </div>
        `;
        
        document.body.appendChild(modal);
        this.eventsModal = modal;

        const binding = new AbortController();
        this.eventsModalBinding = binding;

        modal.addEventListener('click', (e) => {
            if (e.target.closest('[data-close-events]')) {
                e.stopPropagation();
                this.closeEventsList();
                return;
            }

            const item = e.target.closest('.calendar-note-item');
            if (!item) return;

            const note = this.items.find(i => i.id === item.dataset.parent);
            if (note) {
                window.dispatchEvent(new CustomEvent('item:selected_for_edit', { detail: note }));
                this.closeEventsList();
            }
        }, { signal: binding.signal });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeEventsList();
        }, { signal: binding.signal });

        // Click anywhere outside the popout to dismiss it (a click on a day cell
        // closes this popout first and then opens that day's own popout).
        document.addEventListener('pointerdown', (e) => {
            if (!modal.contains(e.target)) this.closeEventsList();
        }, { signal: binding.signal });
    },

    /** Close the day popout, if one is open. Safe to call at any time. */
    closeEventsList() {
        if (this.eventsModalBinding) {
            this.eventsModalBinding.abort();
            this.eventsModalBinding = null;
        }
        if (this.eventsModal) {
            this.eventsModal.remove();
            this.eventsModal = null;
        }
        document.querySelectorAll('.calendar-notes-modal').forEach(modal => modal.remove());
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
                                <div class="calendar-hour-note-title">${escapeHTML(event.title)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        timeline += '</div>';

        // Hour cells and hour notes are wired by bindGridEvents().
        return timeline;
    }
};
