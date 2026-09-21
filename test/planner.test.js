import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createEmptyPlanner,
    normalizePlanner,
    plannerHasContent,
    derivePlannerTasks,
    addPlannerRow,
    movePlannerRow,
    parsePredecessorIds,
    getPlannerField,
    setPlannerField,
    setCategoryColor,
    getCategoryColor,
    listPlannerCategories,
    summarizePlannerSchedule,
    PLANNER_COL_COUNT,
    PLANNER_DEFAULT_ZOOM,
    PLANNER_VERSION
} from '../js/planner.js';
import { layoutPlannerGantt, parsePlannerDateTime, zoomPxPerDay, buildGanttAxis, padGanttRange } from '../js/plannerGantt.js';
import { SHARED_FIELDS } from '../js/noteFieldOwnership.js';
import { reconcileItemPlanner } from '../js/api.js';
import { buildNotePlannerSectionHtml } from '../js/plannerUi.js';

describe('planner model', () => {
    it('creates an empty planner with v2 schema and no IDs', () => {
        const planner = createEmptyPlanner();
        assert.equal(planner.version, PLANNER_VERSION);
        assert.equal(planner.zoom, PLANNER_DEFAULT_ZOOM);
        assert.equal(planner.sheet.cols, PLANNER_COL_COUNT);
        assert.equal(planner.sheet.rows, 3);
        assert.deepEqual(planner.categoryColors, {});
        assert.equal(getPlannerField(planner.sheet, 0, 'name'), '');
        assert.equal(plannerHasContent(planner), false);
    });

    it('detects content in any column', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Kickoff');
        assert.equal(plannerHasContent(planner), true);
    });

    it('migrates v1 sheets: drops ID, reorders cols, remaps P-style preds', () => {
        const raw = {
            version: 1,
            zoom: 'day',
            sheet: {
                rows: 2,
                cols: 7,
                cells: {
                    '0:0': { v: 'P1' },
                    '0:1': { v: '2026-03-01' },
                    '0:2': { v: '2026-03-02' },
                    '0:3': { v: 'Alpha' },
                    '0:4': { v: 'Work' },
                    '0:6': { v: '' },
                    '1:0': { v: 'P2' },
                    '1:1': { v: '2026-03-03' },
                    '1:3': { v: 'Beta' },
                    '1:6': { v: 'P1' }
                },
                colWidths: [40, 110, 110, 90, 70, 90, 55]
            }
        };
        const planner = normalizePlanner(raw);
        assert.equal(planner.version, 2);
        assert.equal(planner.sheet.cols, 6);
        assert.equal(getPlannerField(planner.sheet, 0, 'name'), 'Alpha');
        assert.equal(getPlannerField(planner.sheet, 0, 'category'), 'Work');
        assert.equal(getPlannerField(planner.sheet, 0, 'start'), '2026-03-01');
        assert.equal(getPlannerField(planner.sheet, 1, 'pred'), '1');
        assert.equal(getPlannerField(planner.sheet, 0, 'id'), '');
    });

    it('derives tasks with row-number ids and category colors', () => {
        assert.deepEqual(parsePredecessorIds('1, 2;3'), ['1', '2', '3']);
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'start', '2026-03-01');
        setPlannerField(planner.sheet, 0, 'name', 'Alpha');
        setPlannerField(planner.sheet, 0, 'category', 'Work');
        setCategoryColor(planner, 'Work', '#3182ce');
        setPlannerField(planner.sheet, 1, 'start', '2026-03-06');
        setPlannerField(planner.sheet, 1, 'name', 'Beta');
        setPlannerField(planner.sheet, 1, 'pred', '1');
        const tasks = derivePlannerTasks(planner);
        assert.equal(tasks.length, 2);
        assert.equal(tasks[0].id, '1');
        assert.equal(tasks[0].categoryColor, '#3182ce');
        assert.deepEqual(tasks[1].predecessors, ['1']);
        assert.deepEqual(listPlannerCategories(planner), ['Work']);
        assert.equal(getCategoryColor(planner, 'work'), '#3182ce');
    });

    it('reorders rows and remaps Pred numbers', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'A');
        setPlannerField(planner.sheet, 1, 'name', 'B');
        setPlannerField(planner.sheet, 1, 'pred', '1');
        setPlannerField(planner.sheet, 2, 'name', 'C');
        assert.equal(movePlannerRow(planner, 0, 2), true);
        assert.equal(getPlannerField(planner.sheet, 0, 'name'), 'B');
        assert.equal(getPlannerField(planner.sheet, 1, 'name'), 'C');
        assert.equal(getPlannerField(planner.sheet, 2, 'name'), 'A');
        // B's pred pointed at old row 1 (A); A is now row 3
        assert.equal(getPlannerField(planner.sheet, 0, 'pred'), '3');
    });

    it('adds rows without inventing IDs', () => {
        const planner = createEmptyPlanner({ zoom: 'day' });
        const before = planner.sheet.rows;
        addPlannerRow(planner);
        assert.equal(planner.sheet.rows, before + 1);
        assert.equal(getPlannerField(planner.sheet, before, 'name'), '');
    });

    it('lists planner fields as Shared', () => {
        assert.ok(SHARED_FIELDS.includes('planner'));
        assert.ok(SHARED_FIELDS.includes('plannerHidden'));
    });

    it('reconcileItemPlanner strips empty shells and keeps hide sticky with content', () => {
        const emptyItem = { planner: createEmptyPlanner(), plannerHidden: true };
        assert.equal(reconcileItemPlanner(emptyItem), true);
        assert.equal(emptyItem.planner, null);

        const rich = createEmptyPlanner();
        setPlannerField(rich.sheet, 0, 'start', '2026-01-01');
        const item = { planner: rich, plannerHidden: true };
        reconcileItemPlanner(item);
        assert.ok(item.planner);
        assert.equal(item.plannerHidden, true);
        assert.equal(plannerHasContent(item.planner), true);
    });

    it('buildNotePlannerSectionHtml emits nothing when hidden', () => {
        const item = { id: 'n1', planner: createEmptyPlanner(), plannerHidden: true };
        setPlannerField(item.planner.sheet, 0, 'name', 'X');
        assert.equal(buildNotePlannerSectionHtml(item), '');
        item.plannerHidden = false;
        const html = buildNotePlannerSectionHtml(item, { canEdit: true });
        assert.ok(html.includes('data-note-planner'));
        assert.ok(html.includes('Name'));
        assert.ok(html.includes('Category'));
        assert.ok(!html.includes('>ID<'));
        assert.ok(html.includes('data-planner-summary'));
        assert.ok(html.includes('data-planner-chart-toggle'));
        assert.ok(html.includes('>Chart') || html.includes('Chart</button>'));
    });

    it('summarizes earliest start, latest stop, calendar and working days', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'start', '2026-03-02'); // Mon
        setPlannerField(planner.sheet, 0, 'stop', '2026-03-04');
        setPlannerField(planner.sheet, 1, 'start', '2026-03-03');
        setPlannerField(planner.sheet, 1, 'stop', '2026-03-06'); // Fri
        const summary = summarizePlannerSchedule(planner);
        assert.equal(summary.startLabel, '2026-03-02');
        assert.equal(summary.stopLabel, '2026-03-06');
        assert.equal(summary.calendarDays, 5);
        assert.equal(summary.workingDays, 5);
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

    it('lays out bars, today line, and predecessor edges by row number', () => {
        const now = new Date(2026, 2, 10);
        const layout = layoutPlannerGantt([
            { id: '1', name: 'One', start: '2026-03-01', stop: '2026-03-05', predecessors: [] },
            { id: '2', name: 'Two', start: '2026-03-06', stop: '2026-03-12', predecessors: ['1'] }
        ], { zoom: 'day', now });

        assert.equal(layout.empty, false);
        assert.equal(layout.bars.length, 2);
        assert.equal(layout.edges.length, 1);
        assert.equal(layout.edges[0].fromId, '1');
        assert.equal(layout.edges[0].toId, '2');
        assert.ok(layout.todayX != null);
        assert.ok(layout.majors.length > 0);
    });

    it('returns empty chart with today when no dated tasks', () => {
        const layout = layoutPlannerGantt([], { zoom: 'week', now: new Date(2026, 0, 15) });
        assert.equal(layout.empty, true);
        assert.ok(layout.chartWidth > 0);
    });

    it('uses fewer pixels-per-day at coarser zoom', () => {
        assert.ok(zoomPxPerDay('day') > zoomPxPerDay('week'));
        assert.ok(zoomPxPerDay('week') > zoomPxPerDay('month'));
        assert.ok(zoomPxPerDay('month') > zoomPxPerDay('year'));
    });

    it('builds alternating interval bands per zoom', () => {
        const start = new Date(2026, 0, 1);
        const end = new Date(2026, 1, 1);
        const day = buildGanttAxis(start, end, 'day', zoomPxPerDay('day'));
        assert.ok(day.bands.length >= 28);
        assert.equal(day.bands[0].alt, false);
        assert.equal(day.bands[1].alt, true);

        const week = buildGanttAxis(start, end, 'week', zoomPxPerDay('week'));
        assert.ok(week.bands.length >= 4);
        assert.ok(week.bands.some((b) => b.alt));

        const month = buildGanttAxis(start, new Date(2026, 6, 1), 'month', zoomPxPerDay('month'));
        assert.ok(month.bands.length >= 6);

        const year = buildGanttAxis(start, new Date(2029, 0, 1), 'year', zoomPxPerDay('year'));
        assert.ok(year.bands.length >= 3);
        assert.equal(year.bands.filter((b) => b.alt).length >= 1, true);
    });

    it('builds readable month/year axis labels', () => {
        const start = new Date(2026, 0, 1);
        const end = new Date(2027, 0, 1);
        const monthAxis = buildGanttAxis(start, end, 'month', zoomPxPerDay('month'));
        assert.ok(monthAxis.majors.some((m) => m.label === '2026'));
        assert.ok(monthAxis.minors.some((m) => m.label === 'Jan'));

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
    });
});

function testDaysBetween(a, b) {
    const DAY = 24 * 60 * 60 * 1000;
    const s = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const e = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((e - s) / DAY);
}
