import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createEmptyPlanner,
    normalizePlanner,
    plannerHasContent,
    derivePlannerTasks,
    addPlannerRow,
    parsePredecessorIds,
    getPlannerField,
    setPlannerField,
    PLANNER_COL_COUNT,
    PLANNER_DEFAULT_ZOOM
} from '../js/planner.js';
import { layoutPlannerGantt, parsePlannerDateTime, zoomPxPerDay, buildGanttAxis, padGanttRange } from '../js/plannerGantt.js';
import { SHARED_FIELDS } from '../js/noteFieldOwnership.js';
import { reconcileItemPlanner } from '../js/api.js';

describe('planner model', () => {
    it('creates an empty planner with fixed schema and auto IDs', () => {
        const planner = createEmptyPlanner();
        assert.equal(planner.version, 1);
        assert.equal(planner.zoom, PLANNER_DEFAULT_ZOOM);
        assert.equal(planner.sheet.cols, PLANNER_COL_COUNT);
        assert.equal(planner.sheet.rows, 3);
        assert.equal(getPlannerField(planner.sheet, 0, 'id'), 'P1');
        assert.equal(getPlannerField(planner.sheet, 2, 'id'), 'P3');
        assert.equal(plannerHasContent(planner), false);
    });

    it('detects content outside ID column', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Kickoff');
        assert.equal(plannerHasContent(planner), true);
    });

    it('normalizes zoom and drops out-of-range cells', () => {
        const raw = {
            version: 9,
            zoom: 'nope',
            sheet: {
                rows: 2,
                cols: 99,
                cells: {
                    '0:0': { v: 'A1' },
                    '0:3': { v: 'Task' },
                    '9:0': { v: 'ghost' },
                    '0:20': { v: 'bad' }
                }
            }
        };
        const planner = normalizePlanner(raw);
        assert.equal(planner.zoom, 'week');
        assert.equal(planner.sheet.cols, PLANNER_COL_COUNT);
        assert.equal(getPlannerField(planner.sheet, 0, 'id'), 'A1');
        assert.equal(getPlannerField(planner.sheet, 0, 'name'), 'Task');
        assert.equal(planner.sheet.cells['9:0'], undefined);
        assert.equal(planner.sheet.cells['0:20'], undefined);
    });

    it('derives tasks and parses predecessors', () => {
        assert.deepEqual(parsePredecessorIds('P1, P2;p3'), ['P1', 'P2', 'p3']);
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'start', '2026-03-01');
        setPlannerField(planner.sheet, 0, 'stop', '2026-03-05');
        setPlannerField(planner.sheet, 0, 'name', 'Alpha');
        setPlannerField(planner.sheet, 0, 'pred', 'P2');
        setPlannerField(planner.sheet, 1, 'start', '2026-03-06');
        setPlannerField(planner.sheet, 1, 'name', 'Beta');
        const tasks = derivePlannerTasks(planner);
        assert.equal(tasks.length, 2);
        assert.equal(tasks[0].name, 'Alpha');
        assert.deepEqual(tasks[0].predecessors, ['P2']);
    });

    it('adds rows with unique IDs', () => {
        const planner = createEmptyPlanner({ zoom: 'day' });
        assert.equal(planner.zoom, 'day');
        const before = planner.sheet.rows;
        addPlannerRow(planner);
        assert.equal(planner.sheet.rows, before + 1);
        assert.equal(getPlannerField(planner.sheet, before, 'id'), `P${before + 1}`);
    });

    it('lists planner fields as Shared', () => {
        assert.ok(SHARED_FIELDS.includes('planner'));
        assert.ok(SHARED_FIELDS.includes('plannerHidden'));
    });

    it('reconcileItemPlanner strips empty shells and keeps content visible', () => {
        const emptyItem = { planner: createEmptyPlanner(), plannerHidden: true };
        assert.equal(reconcileItemPlanner(emptyItem), true);
        assert.equal(emptyItem.planner, null);
        assert.equal(emptyItem.plannerHidden, undefined);

        const rich = createEmptyPlanner();
        setPlannerField(rich.sheet, 0, 'start', '2026-01-01');
        const item = { planner: rich, plannerHidden: true };
        assert.equal(reconcileItemPlanner(item), true);
        assert.ok(item.planner);
        assert.equal(item.plannerHidden, false);
    });
});

describe('planner Gantt layout', () => {
    it('parses date and datetime values', () => {
        const d = parsePlannerDateTime('2026-06-15');
        assert.ok(d);
        assert.equal(d.getFullYear(), 2026);
        assert.equal(d.getMonth(), 5);
        assert.equal(d.getDate(), 15);

        const dt = parsePlannerDateTime('2026-06-15T09:30');
        assert.equal(dt.getHours(), 9);
        assert.equal(dt.getMinutes(), 30);
        assert.equal(parsePlannerDateTime(''), null);
    });

    it('lays out bars, today line, and predecessor edges', () => {
        const now = new Date(2026, 2, 10); // Mar 10 2026
        const layout = layoutPlannerGantt([
            { id: 'P1', name: 'One', start: '2026-03-01', stop: '2026-03-05', predecessors: [] },
            { id: 'P2', name: 'Two', start: '2026-03-06', stop: '2026-03-12', predecessors: ['P1'] }
        ], { zoom: 'day', now });

        assert.equal(layout.empty, false);
        assert.equal(layout.bars.length, 2);
        assert.ok(layout.bars[0].width > 0);
        assert.ok(layout.chartWidth > 0);
        assert.equal(layout.edges.length, 1);
        assert.equal(layout.edges[0].fromId, 'P1');
        assert.equal(layout.edges[0].toId, 'P2');
        assert.ok(layout.todayX != null);
        assert.ok(layout.majors.length > 0);
        assert.ok(layout.minors.length > 0);
        // Day zoom: month band + day-of-month numbers (not locale date soup)
        assert.match(layout.majors[0].label, /Mar|March|2026/i);
        assert.ok(layout.minors.some((m) => m.label === '2' || m.label === '10'));
    });

    it('returns empty chart with today when no dated tasks', () => {
        const layout = layoutPlannerGantt([], { zoom: 'week', now: new Date(2026, 0, 15) });
        assert.equal(layout.empty, true);
        assert.equal(layout.bars.length, 0);
        assert.ok(layout.chartWidth > 0);
    });

    it('uses fewer pixels-per-day at coarser zoom', () => {
        assert.ok(zoomPxPerDay('day') > zoomPxPerDay('week'));
        assert.ok(zoomPxPerDay('week') > zoomPxPerDay('month'));
        assert.ok(zoomPxPerDay('month') > zoomPxPerDay('year'));
    });

    it('builds readable month/year axis labels', () => {
        const start = new Date(2026, 0, 1);
        const end = new Date(2027, 0, 1);
        const monthAxis = buildGanttAxis(start, end, 'month', zoomPxPerDay('month'));
        assert.ok(monthAxis.majors.some((m) => m.label === '2026'));
        assert.ok(monthAxis.minors.some((m) => m.label === 'Jan'));
        assert.ok(monthAxis.minors.some((m) => m.label === 'Jun'));

        const yearAxis = buildGanttAxis(start, new Date(2028, 0, 1), 'year', zoomPxPerDay('year'));
        assert.deepEqual(yearAxis.majors.map((m) => m.label), ['2026', '2027']);
    });

    it('pads timeline with surrounding context', () => {
        const min = new Date(2026, 2, 10);
        const max = new Date(2026, 2, 12);
        const day = padGanttRange(min, max, 'day');
        assert.ok(testDaysBetween(day.rangeStart, day.rangeEnd) >= 30);

        const week = padGanttRange(min, max, 'week');
        assert.ok(testDaysBetween(week.rangeStart, week.rangeEnd) >= 56);

        const month = padGanttRange(min, max, 'month');
        assert.ok(testDaysBetween(month.rangeStart, month.rangeEnd) >= 150);
    });
});

function testDaysBetween(a, b) {
    const DAY = 24 * 60 * 60 * 1000;
    const s = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const e = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((e - s) / DAY);
}
