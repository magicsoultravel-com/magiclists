/** @module {"owns":"magicPlanner calendar chart view — month-strip layout + task bars", "related":["planner.js","plannerGantt.js","plannerUi.js"]} */
import { parsePlannerDateTime, padGanttRange } from './plannerGantt.js';
import { derivePlannerTasks } from './planner.js';
import { escapeHTML, escapeAttr } from './domEscape.js';

const WEEKDAYS = Object.freeze(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
const MONTH_SHORT = Object.freeze([
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]);

/**
 * Top fraction of each day tile reserved for the day number.
 * Task bars are laid out in the remaining body (underlay below the number).
 */
export const PLANNER_CAL_DAY_NUM_BAND_FRAC = 0.32;

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
 * Bar height as a fraction of one day tile when `n` tasks overlap.
 * 1 → 1/2, 2 → 1/3, 3 → 1/4, …
 * @param {number} n
 * @returns {number}
 */
export function plannerCalendarBarHeightFraction(n) {
    const count = Math.max(1, Math.floor(Number(n)) || 1);
    return 1 / (count + 1);
}

/**
 * Greedy lane packing: overlapping intervals get distinct lanes; non-overlap can share.
 * @param {Array<{ id: string, dayStart: number, dayEnd: number }>} intervals
 * @returns {Array<{ id: string, dayStart: number, dayEnd: number, lane: number }>}
 */
export function packPlannerCalendarLanes(intervals) {
    const sorted = [...(intervals || [])].sort((a, b) => {
        if (a.dayStart !== b.dayStart) return a.dayStart - b.dayStart;
        if (a.dayEnd !== b.dayEnd) return a.dayEnd - b.dayEnd;
        return String(a.id).localeCompare(String(b.id));
    });
    /** @type {Array<{ dayEnd: number }>} */
    const laneEnds = [];
    return sorted.map((iv) => {
        let lane = 0;
        while (lane < laneEnds.length && laneEnds[lane].dayEnd >= iv.dayStart) {
            lane += 1;
        }
        if (lane === laneEnds.length) laneEnds.push({ dayEnd: iv.dayEnd });
        else laneEnds[lane] = { dayEnd: iv.dayEnd };
        return { ...iv, lane };
    });
}

/**
 * Split an inclusive day range into Sun–Sat week segments within a month grid.
 * @param {number} dayStart 1-based day of month
 * @param {number} dayEnd inclusive
 * @param {number} firstDayIndex weekday index of day 1 (0=Sun)
 * @returns {Array<{ weekRow: number, startCol: number, endCol: number, dayStart: number, dayEnd: number }>}
 */
export function splitPlannerCalendarWeekSegments(dayStart, dayEnd, firstDayIndex) {
    const segs = [];
    let d = dayStart;
    while (d <= dayEnd) {
        const cellIndex = firstDayIndex + (d - 1);
        const col = cellIndex % 7;
        const weekRow = Math.floor(cellIndex / 7);
        const daysLeftInWeek = 6 - col;
        const segEnd = Math.min(dayEnd, d + daysLeftInWeek);
        const endCol = col + (segEnd - d);
        segs.push({
            weekRow,
            startCol: col,
            endCol,
            dayStart: d,
            dayEnd: segEnd
        });
        d = segEnd + 1;
    }
    return segs;
}

/**
 * Peak number of intervals covering any single day in [1 .. daysInMonth].
 * @param {Array<{ dayStart: number, dayEnd: number }>} intervals
 * @param {number} daysInMonth
 * @returns {number}
 */
export function peakPlannerCalendarConcurrency(intervals, daysInMonth) {
    if (!intervals?.length) return 0;
    let peak = 0;
    for (let d = 1; d <= daysInMonth; d++) {
        let n = 0;
        for (const iv of intervals) {
            if (iv.dayStart <= d && d <= iv.dayEnd) n += 1;
        }
        if (n > peak) peak = n;
    }
    return peak;
}

/**
 * @param {Array<{ id?: string, name?: string, start: string, stop: string, categoryColor?: string }>} tasks
 * @returns {Array<{ id: string, name: string, start: Date, stop: Date, color: string, milestone: boolean }>}
 */
export function parsePlannerCalendarTaskIntervals(tasks) {
    const out = [];
    for (const task of tasks || []) {
        const start = parsePlannerDateTime(task.start);
        if (!start) continue;
        const milestone = !String(task.stop || '').trim();
        let stop = parsePlannerDateTime(task.stop) || start;
        if (stop.getTime() < start.getTime()) stop = start;
        out.push({
            id: String(task.id || task.name || out.length),
            name: String(task.name || task.id || ''),
            start: startOfLocalDay(start),
            stop: startOfLocalDay(stop),
            color: String(task.categoryColor || '').trim(),
            milestone
        });
    }
    return out;
}

/**
 * Clip dated tasks into month-local day intervals + week bar segments.
 * @param {number} year
 * @param {number} month 0-based
 * @param {Array<{ id: string, name: string, start: Date, stop: Date, color: string, milestone: boolean }>} datedTasks
 * @returns {{
 *   intervals: Array<{ id: string, name: string, color: string, dayStart: number, dayEnd: number, lane: number }>,
 *   peak: number,
 *   heightFraction: number,
 *   weekRows: number,
 *   firstDayIndex: number,
 *   daysInMonth: number,
 *   segments: Array<{ id: string, name: string, color: string, lane: number, weekRow: number, startCol: number, endCol: number }>
 * }}
 */
export function layoutPlannerCalendarMonthBars(year, month, datedTasks) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const monthFirst = new Date(year, month, 1);
    const monthLast = new Date(year, month, daysInMonth);

    /** @type {Array<{ id: string, name: string, color: string, dayStart: number, dayEnd: number }>} */
    const clipped = [];
    for (const task of datedTasks || []) {
        let from = task.start;
        let to = task.stop;
        if (task.milestone) to = from;
        if (to.getTime() < monthFirst.getTime() || from.getTime() > monthLast.getTime()) continue;
        if (from.getTime() < monthFirst.getTime()) from = monthFirst;
        if (to.getTime() > monthLast.getTime()) to = monthLast;
        clipped.push({
            id: task.id,
            name: task.name,
            color: task.color,
            dayStart: from.getDate(),
            dayEnd: to.getDate()
        });
    }

    const peak = peakPlannerCalendarConcurrency(clipped, daysInMonth);
    const heightFraction = peak > 0 ? plannerCalendarBarHeightFraction(peak) : 0;
    const packed = packPlannerCalendarLanes(clipped);
    const totalCells = firstDayIndex + daysInMonth;
    const weekRows = Math.max(1, Math.ceil(totalCells / 7));

    /** @type {Array<{ id: string, name: string, color: string, lane: number, weekRow: number, startCol: number, endCol: number }>} */
    const segments = [];
    for (const iv of packed) {
        const segs = splitPlannerCalendarWeekSegments(iv.dayStart, iv.dayEnd, firstDayIndex);
        for (const seg of segs) {
            segments.push({
                id: iv.id,
                name: iv.name,
                color: iv.color,
                lane: iv.lane,
                weekRow: seg.weekRow,
                startCol: seg.startCol,
                endCol: seg.endCol
            });
        }
    }

    return {
        intervals: packed,
        peak,
        heightFraction,
        weekRows,
        firstDayIndex,
        daysInMonth,
        segments
    };
}

/**
 * Map each covered local day → unique category colors (kept for coverage tests / tooling).
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
 *   datedTasks: Array<{ id: string, name: string, start: Date, stop: Date, color: string, milestone: boolean }>,
 *   dayCoverage: Map<string, string[]>,
 *   todayKey: string,
 *   focusMonthIndex: number
 * }}
 */
export function layoutPlannerCalendar(planner, opts = {}) {
    const now = opts.now instanceof Date ? opts.now : new Date();
    const today = startOfLocalDay(now);
    const tasks = derivePlannerTasks(planner);
    const datedTasks = parsePlannerCalendarTaskIntervals(tasks);

    let rangeStart;
    let rangeEnd;
    if (!datedTasks.length) {
        ({ rangeStart, rangeEnd } = padGanttRange(today, addDays(today, 7), 'month'));
    } else {
        let min = datedTasks[0].start;
        let max = datedTasks[0].stop;
        for (const t of datedTasks) {
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
        datedTasks,
        dayCoverage,
        todayKey,
        focusMonthIndex
    };
}

/**
 * @param {{ year: number, month: number }} monthInfo
 * @param {Array<{ id: string, name: string, start: Date, stop: Date, color: string, milestone: boolean }>} datedTasks
 * @param {string} todayKey
 * @returns {string}
 */
function renderMonthCardHtml(monthInfo, datedTasks, todayKey) {
    const { year, month } = monthInfo;
    const title = `${MONTH_SHORT[month] || ''} ${year}`;
    const barLayout = layoutPlannerCalendarMonthBars(year, month, datedTasks);
    const {
        firstDayIndex,
        daysInMonth,
        weekRows,
        heightFraction,
        segments,
        peak
    } = barLayout;

    let daysHtml = '';
    let numsHtml = '';
    for (let i = 0; i < firstDayIndex; i++) {
        daysHtml += '<div class="planner-calendar__empty" aria-hidden="true"></div>';
        numsHtml += '<div class="planner-calendar__num-cell" aria-hidden="true"></div>';
    }
    for (let d = 1; d <= daysInMonth; d++) {
        const key = plannerCalendarDayKey(new Date(year, month, d));
        const isToday = key === todayKey;
        const todayClass = isToday ? ' is-today' : '';
        daysHtml += `<div class="planner-calendar__day${todayClass}" data-day="${d}"></div>`;
        numsHtml += `<div class="planner-calendar__num-cell${todayClass}" data-day="${d}">
            <span class="planner-calendar__day-num">${d}</span>
        </div>`;
    }
    const trailing = weekRows * 7 - (firstDayIndex + daysInMonth);
    for (let i = 0; i < trailing; i++) {
        daysHtml += '<div class="planner-calendar__empty" aria-hidden="true"></div>';
        numsHtml += '<div class="planner-calendar__num-cell" aria-hidden="true"></div>';
    }

    const rowH = 100 / weekRows;
    // Planned day-number band; bars use only the body below (underlay).
    const labelBand = rowH * PLANNER_CAL_DAY_NUM_BAND_FRAC;
    const bodyH = rowH - labelBand;
    const barH = heightFraction * bodyH;
    let barsHtml = '';
    if (peak > 0 && segments.length) {
        barsHtml = segments.map((seg) => {
            const top = seg.weekRow * rowH + labelBand + seg.lane * barH;
            const left = (seg.startCol / 7) * 100;
            const width = ((seg.endCol - seg.startCol + 1) / 7) * 100;
            const color = seg.color
                ? `background:${escapeAttr(seg.color)};`
                : '';
            const titleAttr = seg.name ? ` title="${escapeAttr(seg.name)}"` : '';
            return `<div class="planner-calendar__bar" style="top:${top.toFixed(3)}%;left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;height:${barH.toFixed(3)}%;${color}"${titleAttr}></div>`;
        }).join('');
    }

    const titleClass = peak > 0 ? ' is-busy' : '';
    return `<div class="planner-calendar__month" data-planner-cal-year="${year}" data-planner-cal-month="${month}">
        <div class="planner-calendar__month-title${titleClass}">${escapeHTML(title)}</div>
        <div class="planner-calendar__weekdays">
            ${WEEKDAYS.map((w) => `<div class="planner-calendar__weekday">${w}</div>`).join('')}
        </div>
        <div class="planner-calendar__days-wrap">
            <div class="planner-calendar__days">${daysHtml}</div>
            <div class="planner-calendar__bars" aria-hidden="true">${barsHtml}</div>
            <div class="planner-calendar__nums" aria-hidden="true">${numsHtml}</div>
        </div>
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
        .map((m) => renderMonthCardHtml(m, layout.datedTasks, layout.todayKey))
        .join('');
    const html = `<div class="planner-calendar" data-planner-calendar data-focus-month="${layout.focusMonthIndex}">
        <div class="planner-calendar__viewport" data-planner-calendar-viewport title="Drag to pan">
            <div class="planner-calendar__strip">${monthsHtml}</div>
        </div>
    </div>`;
    return { html, layout };
}
