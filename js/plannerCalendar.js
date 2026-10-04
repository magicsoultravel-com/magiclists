/** @module {"owns":"magicPlanner calendar chart view — month-strip layout + task day coverage", "related":["planner.js","plannerGantt.js","plannerUi.js"]} */
import { parsePlannerDateTime, padGanttRange } from './plannerGantt.js';
import { derivePlannerTasks } from './planner.js';
import { escapeHTML, escapeAttr } from './domEscape.js';

const WEEKDAYS = Object.freeze(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
const MONTH_SHORT = Object.freeze([
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]);

function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
}

/**
 * @param {Date} date
 * @returns {string} YYYY-MM-DD
 */
export function plannerCalendarDayKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Map each covered local day → unique category colors (for cell wash).
 * @param {Array<{ start: string, stop: string, categoryColor?: string }>} tasks
 * @returns {Map<string, string[]>}
 */
export function buildPlannerCalendarDayCoverage(tasks) {
    /** @type {Map<string, string[]>} */
    const map = new Map();
    for (const task of tasks || []) {
        const start = parsePlannerDateTime(task.start);
        if (!start) continue;
        const milestone = !String(task.stop || '').trim();
        let stop = parsePlannerDateTime(task.stop) || start;
        if (stop.getTime() < start.getTime()) stop = start;
        const from = startOfLocalDay(start);
        const to = startOfLocalDay(stop);
        const color = String(task.categoryColor || '').trim();
        let cursor = from;
        while (cursor.getTime() <= to.getTime()) {
            const key = plannerCalendarDayKey(cursor);
            if (!map.has(key)) map.set(key, []);
            if (color) {
                const list = map.get(key);
                if (!list.includes(color)) list.push(color);
            }
            if (milestone) break;
            cursor = addDays(cursor, 1);
        }
    }
    return map;
}

/**
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @returns {Array<{ year: number, month: number }>}
 */
export function listPlannerCalendarMonths(rangeStart, rangeEnd) {
    const months = [];
    let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
    const end = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth(), 1);
    while (cursor.getTime() < end.getTime()) {
        months.push({ year: cursor.getFullYear(), month: cursor.getMonth() });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
    if (!months.length) {
        months.push({ year: rangeStart.getFullYear(), month: rangeStart.getMonth() });
    }
    return months;
}

/**
 * @param {object} planner
 * @param {{ now?: Date }} [opts]
 * @returns {{
 *   rangeStart: Date,
 *   rangeEnd: Date,
 *   months: Array<{ year: number, month: number }>,
 *   dayCoverage: Map<string, string[]>,
 *   todayKey: string,
 *   focusMonthIndex: number
 * }}
 */
export function layoutPlannerCalendar(planner, opts = {}) {
    const now = opts.now instanceof Date ? opts.now : new Date();
    const today = startOfLocalDay(now);
    const tasks = derivePlannerTasks(planner);
    const dated = [];
    for (const task of tasks) {
        const start = parsePlannerDateTime(task.start);
        if (!start) continue;
        let stop = parsePlannerDateTime(task.stop) || start;
        if (stop.getTime() < start.getTime()) stop = start;
        dated.push({ start, stop });
    }

    let rangeStart;
    let rangeEnd;
    if (!dated.length) {
        ({ rangeStart, rangeEnd } = padGanttRange(today, addDays(today, 7), 'month'));
    } else {
        let min = dated[0].start;
        let max = dated[0].stop;
        for (const t of dated) {
            if (t.start < min) min = t.start;
            if (t.stop > max) max = t.stop;
        }
        ({ rangeStart, rangeEnd } = padGanttRange(min, max, 'month'));
    }

    const months = listPlannerCalendarMonths(rangeStart, rangeEnd);
    const dayCoverage = buildPlannerCalendarDayCoverage(tasks);
    const todayKey = plannerCalendarDayKey(today);
    let focusMonthIndex = months.findIndex(
        (m) => m.year === today.getFullYear() && m.month === today.getMonth()
    );
    if (focusMonthIndex < 0) focusMonthIndex = 0;

    return {
        rangeStart,
        rangeEnd,
        months,
        dayCoverage,
        todayKey,
        focusMonthIndex
    };
}

/**
 * @param {string[]} colors
 * @returns {string}
 */
function dayBackgroundStyle(colors) {
    if (!colors?.length) return '';
    if (colors.length === 1) return `background:${escapeAttr(colors[0])};`;
    const slice = 100 / colors.length;
    const stops = colors.map((c, i) => {
        const a = (i * slice).toFixed(2);
        const b = ((i + 1) * slice).toFixed(2);
        return `${escapeAttr(c)} ${a}% ${b}%`;
    }).join(', ');
    return `background:conic-gradient(from 0deg, ${stops});`;
}

/**
 * @param {{ year: number, month: number }} monthInfo
 * @param {Map<string, string[]>} dayCoverage
 * @param {string} todayKey
 * @returns {string}
 */
function renderMonthCardHtml(monthInfo, dayCoverage, todayKey) {
    const { year, month } = monthInfo;
    const title = `${MONTH_SHORT[month] || ''} ${year}`;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayIndex = new Date(year, month, 1).getDay();
    let hasAny = false;

    let daysHtml = '';
    for (let i = 0; i < firstDayIndex; i++) {
        daysHtml += '<div class="planner-calendar__empty" aria-hidden="true"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const key = plannerCalendarDayKey(new Date(year, month, d));
        const colors = dayCoverage.get(key) || [];
        const covered = dayCoverage.has(key);
        if (covered) hasAny = true;
        const isToday = key === todayKey;
        const style = dayBackgroundStyle(colors);
        const textClass = colors.length ? ' is-filled' : '';
        const weightClass = covered ? ' is-active' : '';
        const todayClass = isToday ? ' is-today' : '';
        daysHtml += `<div class="planner-calendar__day${weightClass}${todayClass}${textClass}" data-day="${d}"${style ? ` style="${style}"` : ''}>
            <span class="planner-calendar__day-num">${d}</span>
        </div>`;
    }

    const titleClass = hasAny ? ' is-busy' : '';
    return `<div class="planner-calendar__month" data-planner-cal-year="${year}" data-planner-cal-month="${month}">
        <div class="planner-calendar__month-title${titleClass}">${escapeHTML(title)}</div>
        <div class="planner-calendar__weekdays">
            ${WEEKDAYS.map((w) => `<div class="planner-calendar__weekday">${w}</div>`).join('')}
        </div>
        <div class="planner-calendar__days">${daysHtml}</div>
    </div>`;
}

/**
 * @param {object} planner
 * @param {{ now?: Date }} [opts]
 * @returns {{ html: string, layout: object }}
 */
export function renderPlannerCalendarBoardHtml(planner, opts = {}) {
    const layout = layoutPlannerCalendar(planner, opts);
    const monthsHtml = layout.months
        .map((m) => renderMonthCardHtml(m, layout.dayCoverage, layout.todayKey))
        .join('');
    const html = `<div class="planner-calendar" data-planner-calendar data-focus-month="${layout.focusMonthIndex}">
        <div class="planner-calendar__viewport" data-planner-calendar-viewport title="Drag to pan">
            <div class="planner-calendar__strip">${monthsHtml}</div>
        </div>
    </div>`;
    return { html, layout };
}
