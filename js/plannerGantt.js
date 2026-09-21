/** @module {"owns":"magicPlanner Gantt layout math (display-only)", "related":["planner.js","plannerUi.js"]} */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pixels per calendar day at each zoom (keeps bars and ticks on the same scale). */
const PX_PER_DAY = Object.freeze({
    day: 28,
    week: 10,
    quarter: 5.2,
    month: 3.4,
    year: 0.6
});

const MONTH_SHORT = Object.freeze([
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]);

/**
 * Parse stored Start/Stop into a local Date at midnight (date-only) or with time.
 * @param {string} value
 * @returns {Date|null}
 */
export function parsePlannerDateTime(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split('-').map(Number);
        const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
        const [datePart, timePart] = raw.split('T');
        const [y, m, d] = datePart.split('-').map(Number);
        const [hh, mm] = timePart.split(':').map(Number);
        const dt = new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function startOfLocalDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function addDays(date, n) {
    const d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
}

function daysBetween(a, b) {
    return Math.round((startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime()) / DAY_MS);
}

/**
 * @param {'day'|'week'|'month'|'year'} zoom
 * @returns {number}
 */
export function zoomPxPerDay(zoom) {
    return PX_PER_DAY[zoom] || PX_PER_DAY.day;
}

/** @deprecated use zoomPxPerDay — kept for older tests */
export function zoomUnitMs(zoom) {
    if (zoom === 'week') return 7 * DAY_MS;
    if (zoom === 'quarter') return 91 * DAY_MS;
    if (zoom === 'month') return 30 * DAY_MS;
    if (zoom === 'year') return 365 * DAY_MS;
    return DAY_MS;
}

/** @deprecated use zoomPxPerDay */
export function zoomPxPerUnit(zoom) {
    return zoomPxPerDay(zoom);
}

function startOfQuarter(date) {
    const qMonth = Math.floor(date.getMonth() / 3) * 3;
    return new Date(date.getFullYear(), qMonth, 1);
}

function addQuarters(date, n) {
    return new Date(date.getFullYear(), date.getMonth() + (n * 3), 1);
}

/**
 * Snap range start/end to zoom-friendly boundaries with generous surrounding context
 * so the axis shows neighboring days/weeks/months/years, not only the task span.
 * @param {Date} min
 * @param {Date} max
 * @param {'day'|'week'|'quarter'|'month'|'year'} zoom
 * @returns {{ rangeStart: Date, rangeEnd: Date }}
 */
export function padGanttRange(min, max, zoom) {
    let rangeStart = startOfLocalDay(min);
    let rangeEnd = startOfLocalDay(max);

    if (zoom === 'week') {
        // Pad ~4 weeks each side, snap to Mondays
        rangeStart = addDays(rangeStart, -28);
        rangeEnd = addDays(rangeEnd, 28);
        const dowS = rangeStart.getDay();
        rangeStart = addDays(rangeStart, -((dowS + 6) % 7));
        const dowE = rangeEnd.getDay();
        rangeEnd = addDays(rangeEnd, (7 - ((dowE + 6) % 7)) % 7 || 7);
        if (daysBetween(rangeStart, rangeEnd) < 70) rangeEnd = addDays(rangeStart, 70);
    } else if (zoom === 'quarter') {
        // Full quarters with ±1 quarter context
        rangeStart = addQuarters(startOfQuarter(rangeStart), -1);
        rangeEnd = addQuarters(startOfQuarter(rangeEnd), 3);
        if (daysBetween(rangeStart, rangeEnd) < 365) {
            rangeEnd = addQuarters(rangeStart, 5);
        }
    } else if (zoom === 'month') {
        // Full months with ~3 months context each side
        rangeStart = new Date(rangeStart.getFullYear(), rangeStart.getMonth() - 3, 1);
        rangeEnd = new Date(rangeEnd.getFullYear(), rangeEnd.getMonth() + 4, 1);
        if (daysBetween(rangeStart, rangeEnd) < 180) {
            rangeEnd = new Date(rangeStart.getFullYear(), rangeStart.getMonth() + 8, 1);
        }
    } else if (zoom === 'year') {
        // Full years with ±1 year context
        rangeStart = new Date(rangeStart.getFullYear() - 1, 0, 1);
        rangeEnd = new Date(rangeEnd.getFullYear() + 2, 0, 1);
        if (daysBetween(rangeStart, rangeEnd) < 365 * 3) {
            rangeEnd = new Date(rangeStart.getFullYear() + 3, 0, 1);
        }
    } else {
        // Day: ~10 days each side, at least ~5 weeks of timeline
        rangeStart = addDays(rangeStart, -10);
        rangeEnd = addDays(rangeEnd, 10);
        if (daysBetween(rangeStart, rangeEnd) < 35) rangeEnd = addDays(rangeStart, 35);
    }

    if (rangeEnd.getTime() <= rangeStart.getTime()) {
        rangeEnd = addDays(rangeStart, 35);
    }
    return { rangeStart, rangeEnd };
}

/**
 * @param {Date} rangeStart
 * @param {Date} rangeEnd
 * @param {'day'|'week'|'month'|'year'} zoom
 * @param {number} pxPerDay
 * @returns {{ majors: Array<{x:number,width:number,label:string}>, minors: Array<{x:number,label:string,major:boolean}>, bands: Array<{x:number,width:number,alt:boolean}>, chartWidth: number }}
 */
export function buildGanttAxis(rangeStart, rangeEnd, zoom, pxPerDay) {
    const totalDays = Math.max(1, daysBetween(rangeStart, rangeEnd));
    const chartWidth = totalDays * pxPerDay;
    const majors = [];
    const minors = [];
    /** Interval start x positions for alternating body bands (week/quarter/month/year). */
    const bandStarts = [];
    /** Day zoom builds bands directly (weekend + weekday alt). */
    let dayBands = null;

    const xAt = (date) => daysBetween(rangeStart, date) * pxPerDay;

    if (zoom === 'day') {
        // Major: month bands. Minor: each day labeled with day-of-month.
        let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
        if (cursor < rangeStart) cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
        while (cursor < rangeEnd) {
            const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
            const x0 = Math.max(0, xAt(cursor));
            const x1 = Math.min(chartWidth, xAt(next));
            if (x1 > x0) {
                const label = cursor.getMonth() === 0 || cursor <= rangeStart
                    ? `${MONTH_SHORT[cursor.getMonth()]} ${cursor.getFullYear()}`
                    : MONTH_SHORT[cursor.getMonth()];
                majors.push({ x: x0, width: x1 - x0, label });
            }
            cursor = next;
        }
        dayBands = [];
        let d = new Date(rangeStart.getTime());
        let dayIndex = 0;
        while (d < rangeEnd) {
            const x = xAt(d);
            const next = addDays(d, 1);
            const x1 = Math.min(chartWidth, xAt(next));
            const dow = d.getDay();
            const weekend = dow === 0 || dow === 6;
            dayBands.push({
                x,
                width: Math.max(0, x1 - x),
                alt: dayIndex % 2 === 1
            });
            minors.push({
                x,
                label: String(d.getDate()),
                major: dow === 1,
                weekend
            });
            d = next;
            dayIndex += 1;
        }
    } else if (zoom === 'week') {
        // Major: month bands. Minor: Mondays → "3" or "3 Mar" at month change.
        let cursor = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
        while (cursor < rangeEnd) {
            const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
            const x0 = Math.max(0, xAt(cursor));
            const x1 = Math.min(chartWidth, xAt(next));
            if (x1 > x0) {
                const label = cursor.getMonth() === 0 || cursor <= rangeStart
                    ? `${MONTH_SHORT[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`
                    : MONTH_SHORT[cursor.getMonth()];
                majors.push({ x: x0, width: x1 - x0, label });
            }
            cursor = next;
        }
        let d = new Date(rangeStart.getTime());
        // Align to Monday
        const dow = d.getDay();
        if (dow !== 1) d = addDays(d, (8 - dow) % 7);
        // Cover partial first week before the first Monday
        if (d > rangeStart) bandStarts.push(0);
        while (d < rangeEnd) {
            const x = xAt(d);
            bandStarts.push(x);
            minors.push({
                x,
                label: String(d.getDate()),
                major: d.getDate() <= 7
            });
            d = addDays(d, 7);
        }
    } else if (zoom === 'quarter') {
        // Major: year bands. Minor: quarters → Q1 … Q4.
        let y = rangeStart.getFullYear();
        while (y <= rangeEnd.getFullYear()) {
            const start = new Date(y, 0, 1);
            const next = new Date(y + 1, 0, 1);
            const x0 = Math.max(0, xAt(start));
            const x1 = Math.min(chartWidth, xAt(next));
            if (x1 > x0) majors.push({ x: x0, width: x1 - x0, label: String(y) });
            y += 1;
        }
        let d = startOfQuarter(rangeStart);
        while (d < rangeEnd) {
            const x = Math.max(0, xAt(d));
            bandStarts.push(x);
            const q = Math.floor(d.getMonth() / 3) + 1;
            minors.push({
                x,
                label: `Q${q}`,
                major: d.getMonth() === 0
            });
            d = addQuarters(d, 1);
        }
    } else if (zoom === 'month') {
        // Major: year bands. Minor: months → "Jan" … "Dec".
        let y = rangeStart.getFullYear();
        while (y <= rangeEnd.getFullYear()) {
            const start = new Date(y, 0, 1);
            const next = new Date(y + 1, 0, 1);
            const x0 = Math.max(0, xAt(start));
            const x1 = Math.min(chartWidth, xAt(next));
            if (x1 > x0) majors.push({ x: x0, width: x1 - x0, label: String(y) });
            y += 1;
        }
        let d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), 1);
        while (d < rangeEnd) {
            const x = xAt(d);
            bandStarts.push(Math.max(0, x));
            minors.push({
                x,
                label: MONTH_SHORT[d.getMonth()],
                major: d.getMonth() === 0
            });
            d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        }
    } else {
        // year zoom: major empty / minor = years (one tier is enough)
        let y = rangeStart.getFullYear();
        while (y <= rangeEnd.getFullYear()) {
            const start = new Date(y, 0, 1);
            const next = new Date(y + 1, 0, 1);
            const x0 = Math.max(0, xAt(start));
            const x1 = Math.min(chartWidth, xAt(next));
            if (x1 > x0) {
                majors.push({ x: x0, width: x1 - x0, label: String(y) });
                minors.push({ x: x0, label: '', major: true });
                bandStarts.push(x0);
            }
            y += 1;
        }
    }

    const bands = dayBands || [];
    if (!dayBands) {
        const starts = bandStarts.length ? [...bandStarts] : [0];
        if (starts[0] > 0) starts.unshift(0);
        for (let i = 0; i < starts.length; i++) {
            const x = starts[i];
            const x1 = i + 1 < starts.length ? starts[i + 1] : chartWidth;
            if (x1 > x) bands.push({ x, width: x1 - x, alt: i % 2 === 1 });
        }
    }

    return { majors, minors, bands, chartWidth };
}

/** @deprecated use buildGanttAxis */
export function buildGanttTicks(rangeStart, rangeEnd, zoom, pxPerUnit) {
    const pxPerDay = zoom === 'day' || zoom === 'week' || zoom === 'quarter' || zoom === 'month' || zoom === 'year'
        ? (PX_PER_DAY[zoom] || pxPerUnit)
        : pxPerUnit;
    const { minors } = buildGanttAxis(rangeStart, rangeEnd, zoom, pxPerDay);
    return minors.map((m) => ({ x: m.x, label: m.label, major: m.major }));
}

/**
 * Layout Gantt chart for display-only rendering.
 * @param {Array<{ id: string, start: string, stop: string, name: string, predecessors: string[] }>} tasks
 * @param {{ zoom?: string, now?: Date, rowHeight?: number, labelWidth?: number }} [opts]
 * @returns {object}
 */
export function layoutPlannerGantt(tasks, opts = {}) {
    const zoom = opts.zoom || 'week';
    const now = opts.now instanceof Date ? opts.now : new Date();
    const rowHeight = opts.rowHeight || 22;
    const labelWidth = opts.labelWidth || 64;
    const barPadY = 4;
    // Two-tier axis for day/week/month; single tier for year
    const majorBandH = zoom === 'year' ? 0 : 14;
    const minorBandH = 14;
    const headerHeight = majorBandH + minorBandH + 2;
    const pxPerDay = zoomPxPerDay(zoom);

    const dated = [];
    for (const task of tasks || []) {
        const start = parsePlannerDateTime(task.start);
        if (!start) continue;
        let stop = parsePlannerDateTime(task.stop) || start;
        if (stop.getTime() < start.getTime()) stop = start;
        // Date-only stop: treat as inclusive end-of-day for bar width.
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(task.stop || task.start).trim())
            && stop.getTime() === startOfLocalDay(stop).getTime()) {
            stop = addDays(startOfLocalDay(stop), 1);
        }
        dated.push({
            id: task.id || '',
            name: task.name || task.id || '',
            row: task.row,
            start,
            stop,
            categoryColor: task.categoryColor || '',
            predecessors: Array.isArray(task.predecessors) ? task.predecessors : []
        });
    }

    let rangeStart;
    let rangeEnd;
    if (!dated.length) {
        const today = startOfLocalDay(now);
        ({ rangeStart, rangeEnd } = padGanttRange(today, addDays(today, 7), zoom));
    } else {
        let min = dated[0].start;
        let max = dated[0].stop;
        for (const t of dated) {
            if (t.start < min) min = t.start;
            if (t.stop > max) max = t.stop;
        }
        ({ rangeStart, rangeEnd } = padGanttRange(min, max, zoom));
    }

    const axis = buildGanttAxis(rangeStart, rangeEnd, zoom, pxPerDay);
    const chartWidth = Math.max(120, axis.chartWidth);

    const toX = (date) => daysBetween(rangeStart, date) * pxPerDay;

    const bars = dated.map((t, index) => {
        const x = toX(t.start);
        const x2 = toX(t.stop);
        const width = Math.max(4, x2 - x);
        const y = headerHeight + index * rowHeight + barPadY;
        return {
            id: t.id,
            name: t.name,
            row: t.row,
            x,
            y,
            width,
            height: rowHeight - barPadY * 2,
            startMs: t.start.getTime(),
            stopMs: t.stop.getTime(),
            categoryColor: t.categoryColor || '',
            predecessors: t.predecessors
        };
    });

    const byId = new Map();
    for (const bar of bars) {
        if (bar.id) byId.set(bar.id.toLowerCase(), bar);
    }

    const edges = [];
    for (const bar of bars) {
        for (const predId of bar.predecessors) {
            const src = byId.get(String(predId).toLowerCase());
            if (!src || src === bar) continue;
            const x1 = src.x + src.width;
            const y1 = src.y + src.height / 2;
            const x2 = bar.x;
            const y2 = bar.y + bar.height / 2;
            const midX = Math.max(x1 + 6, Math.min(x2 - 6, (x1 + x2) / 2));
            edges.push({
                fromId: src.id,
                toId: bar.id,
                path: `M${x1},${y1} H${midX} V${y2} H${x2}`
            });
        }
    }

    const today = startOfLocalDay(now);
    const todayX = toX(today);
    const showToday = todayX >= 0 && todayX <= chartWidth;

    return {
        zoom,
        labelWidth,
        headerHeight,
        majorBandH,
        minorBandH,
        rowHeight,
        chartWidth,
        height: headerHeight + Math.max(1, bars.length || 1) * rowHeight + 8,
        rangeStart,
        rangeEnd,
        majors: axis.majors,
        minors: axis.minors,
        bands: axis.bands || [],
        // back-compat for older render/tests
        ticks: axis.minors.map((m) => ({ x: m.x, label: m.label, major: m.major })),
        bars,
        edges,
        todayX: showToday ? todayX : null,
        empty: bars.length === 0
    };
}
