import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createEmptyPlanner,
    normalizePlanner,
    normalizePlannerLabelWidth,
    normalizeTodayLine,
    normalizePlannerChartView,
    plannerHasContent,
    derivePlannerTasks,
    addPlannerRow,
    removePlannerRow,
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
    PLANNER_DEFAULT_CHART_VIEW,
    PLANNER_DEFAULT_LABEL_WIDTH,
    PLANNER_DEFAULT_TODAY_LINE,
    PLANNER_VERSION
} from '../js/planner.js';
import { layoutPlannerGantt, parsePlannerDateTime, zoomPxPerDay, buildGanttAxis, padGanttRange, isoWeekNumber } from '../js/plannerGantt.js';
import {
    buildPlannerCalendarDayCoverage,
    layoutPlannerCalendar,
    layoutPlannerCalendarMonthBars,
    listPlannerCalendarMonths,
    packPlannerCalendarLanes,
    parsePlannerCalendarTaskIntervals,
    plannerCalendarBarHeightFraction,
    plannerCalendarDayKey,
    splitPlannerCalendarWeekSegments,
    PLANNER_CAL_DAY_NUM_BAND_FRAC
} from '../js/plannerCalendar.js';
import {
    derivePlannerKanbanCards,
    layoutPlannerKanban,
    moveKanbanCard,
    normalizeKanbanFlavour,
    kanbanLabelsForFlavour,
    clipKanbanComment,
    setKanbanCardEmphasis,
    setKanbanCardCollapsed,
    setKanbanStageCollapsed,
    normalizeKanbanCollapsedByStage,
    expandAllKanbanCards,
    collapseAllKanbanCards,
    resetKanbanCardStyles,
    resetAllKanbanCardStyles,
    resetKanbanArrangement,
    KANBAN_DEFAULT_FLAVOUR,
    KANBAN_FLAVOURS
} from '../js/plannerKanban.js';
import { SHARED_FIELDS } from '../js/noteFieldOwnership.js';
import { reconcileItemPlanner } from '../js/api.js';
import { buildNotePlannerSectionHtml, renderPlannerGanttHtml, renderPlannerKanbanHtml } from '../js/plannerUi.js';
import { readDisplayOptions } from '../js/displayOptions.js';

describe('planner model', () => {
    it('creates an empty planner with v2 schema and no IDs', () => {
        const planner = createEmptyPlanner();
        assert.equal(planner.version, PLANNER_VERSION);
        assert.equal(planner.zoom, PLANNER_DEFAULT_ZOOM);
        assert.equal(planner.chartView, PLANNER_DEFAULT_CHART_VIEW);
        assert.equal(planner.labelWidth, PLANNER_DEFAULT_LABEL_WIDTH);
        assert.equal(planner.todayLine, undefined);
        assert.equal(planner.sheet.cols, PLANNER_COL_COUNT);
        assert.equal(planner.sheet.rows, 3);
        assert.deepEqual(planner.categoryColors, {});
        assert.equal(planner.kanbanCollapsed, false);
        assert.equal(planner.kanbanSort, 'row');
        assert.equal(planner.kanbanSortDir, 'asc');
        assert.deepEqual(planner.kanbanStageByRow, {});
        assert.deepEqual(planner.kanbanOrderByStage, {});
        assert.deepEqual(planner.kanbanCardColors, {});
        assert.deepEqual(planner.kanbanEmphasisByRow, {});
        assert.deepEqual(planner.kanbanCollapsedByRow, {});
        assert.deepEqual(planner.kanbanCollapsedByStage, {});
        assert.equal(getPlannerField(planner.sheet, 0, 'name'), '');
        assert.equal(plannerHasContent(planner), false);
    });

    it('normalizes labelWidth; todayLine lives in Display Options', () => {
        assert.equal(normalizePlannerLabelWidth(10), 48);
        assert.equal(normalizePlannerLabelWidth(999), 280);
        assert.equal(normalizePlannerLabelWidth('bad'), PLANNER_DEFAULT_LABEL_WIDTH);
        const tl = normalizeTodayLine({ color: '#112233', style: 'dotted', thickness: 3 });
        assert.deepEqual(tl, { color: '#112233', style: 'dotted', thickness: 3 });
        assert.deepEqual(normalizeTodayLine({ color: 'nope', style: 'zigzag', thickness: 9 }), {
            ...PLANNER_DEFAULT_TODAY_LINE
        });
        const planner = normalizePlanner({
            version: 2,
            labelWidth: 200,
            todayLine: { color: '#00ff00', style: 'solid', thickness: 2 },
            sheet: { rows: 3, cols: 6, cells: {}, colWidths: [90, 72, 108, 108, 44, 80] }
        });
        assert.equal(planner.labelWidth, 200);
        assert.equal(planner.todayLine, undefined);
        const opts = readDisplayOptions();
        assert.ok(opts.plannerTodayLine);
        assert.equal(typeof opts.plannerTodayLine.color, 'string');
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
        assert.deepEqual(parsePredecessorIds('1, 3, x, 5'), ['1', '3', '5']);
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

    it('normalizes chartView gantt|calendar', () => {
        assert.equal(normalizePlannerChartView('calendar'), 'calendar');
        assert.equal(normalizePlannerChartView('GANTT'), 'gantt');
        assert.equal(normalizePlannerChartView('nope'), PLANNER_DEFAULT_CHART_VIEW);
        assert.equal(normalizePlanner({ ...createEmptyPlanner(), chartView: 'calendar' }).chartView, 'calendar');
        assert.equal(normalizePlanner(createEmptyPlanner()).chartView, PLANNER_DEFAULT_CHART_VIEW);
    });

    it('keeps chart-view host state attr separate from calendar action button', () => {
        const planner = createEmptyPlanner();
        planner.chartView = 'calendar';
        const { html } = renderPlannerGanttHtml(planner, { canEdit: true });
        assert.ok(html.includes('data-planner-chart-view-current="calendar"'));
        // Host must not reuse the action attribute (that locked zoom clicks in calendar).
        assert.ok(!/data-planner-gantt[^>]*data-planner-chart-view="/.test(html));
        assert.equal((html.match(/data-planner-chart-view="calendar"/g) || []).length, 1);
        assert.ok(/button[^>]*data-planner-chart-view="calendar"/.test(html));
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
        assert.ok(html.includes('data-planner-table-toggle'));
        assert.ok(html.includes('data-planner-chart-toggle'));
        assert.ok(html.includes('data-planner-kanban-toggle'));
        assert.ok(html.includes('Table</button>') || html.includes('>Table'));
        assert.ok(html.includes('Chart</button>') || html.includes('>Chart'));
        assert.ok(html.includes('Kanban</button>') || html.includes('>Kanban'));
        assert.ok(html.includes('data-planner-kanban-sort="row"'));
        assert.ok(html.includes('data-planner-kanban-sort="date"'));
        assert.ok(html.includes('data-planner-kanban-sort="alpha"'));
        assert.ok(!html.includes('data-planner-kanban-sort="manual"'));
        assert.ok(html.includes('card-act planner-kanban-sort-btn'));
        assert.ok(html.includes('planner-kanban__card is-editable') || html.includes('is-editable"'));
        assert.ok(!html.includes('data-planner-kanban-card') || !/data-planner-kanban-card[^>]*draggable="true"/.test(html));
        assert.ok(html.includes('data-planner-kanban-color'));
        assert.ok(html.includes('data-planner-kanban-emphasis="urgent"'));
        assert.ok(html.includes('data-planner-kanban-emphasis="muted"'));
        assert.ok(html.includes('data-planner-kanban-reset-card'));
        assert.ok(html.includes('data-planner-kanban-density'));
        assert.ok(html.includes('data-planner-kanban-stage-collapse'));
        assert.ok(html.includes('data-planner-kanban-expand-all'));
        assert.ok(html.includes('data-planner-kanban-collapse-all'));
        assert.ok(html.includes('data-planner-kanban-reset-styles'));
        assert.ok(html.includes('data-planner-kanban-reset-arrangement'));
        assert.ok(html.includes('planner-kanban__tools'));
        assert.ok(html.includes('data-planner-kanban-field="name"'));
        assert.ok(html.includes('data-planner-kanban-field="comments"'));
        assert.ok(html.includes('contenteditable="plaintext-only"'));
        assert.ok(html.includes('data-planner-rail-resize'));
        assert.ok(!html.includes('data-planner-today-settings-toggle'));
        assert.ok(html.includes('planner-gantt__today') || html.includes('data-planner-gantt'));
        assert.ok(html.includes('data-planner-kanban'));
    });

    it('kanban inline fields only when canEdit; stable slot without flyout', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Task A');
        setPlannerField(planner.sheet, 0, 'comments', 'Hello');
        const editable = renderPlannerKanbanHtml(planner, { canEdit: true });
        assert.ok(editable.includes('data-planner-kanban-field="name"'));
        assert.ok(editable.includes('data-planner-kanban-field="comments"'));
        assert.ok(editable.includes('contenteditable="plaintext-only"'));
        assert.ok(/<textarea[^>]*data-planner-kanban-field="comments"/.test(editable));
        assert.ok(/rows="1"/.test(editable));
        // No size-changing hover flyout — content stays in the stable slot.
        assert.ok(!editable.includes('planner-kanban__card-flyout'));
        // One action suite on the article; overflow tray behind more + grab.
        assert.equal((editable.match(/data-planner-kanban-density/g) || []).length, 1);
        assert.equal((editable.match(/class="planner-kanban__card-actions"/g) || []).length, 1);
        assert.ok(editable.includes('planner-kanban__card-actions-tray'));
        assert.ok(editable.includes('data-planner-kanban-more'));
        assert.ok(editable.includes('planner-kanban__card-grab'));

        const readonly = renderPlannerKanbanHtml(planner, { canEdit: false });
        assert.ok(!readonly.includes('data-planner-kanban-field='));
        assert.ok(!readonly.includes('contenteditable='));
        assert.ok(!readonly.includes('<textarea'));
        assert.ok(readonly.includes('planner-kanban__card-name'));
        assert.ok(readonly.includes('Hello'));
    });

    it('colored kanban cards emit contrast tokens and collapsed hides density class', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Paint');
        setPlannerField(planner.sheet, 0, 'category', 'Design');
        setPlannerField(planner.sheet, 0, 'comments', 'notes');
        setCategoryColor(planner, 'Design', '#112233');
        const html = renderPlannerKanbanHtml(planner, { canEdit: true });
        assert.ok(html.includes('has-color'));
        assert.ok(html.includes('has-custom-bg'));
        assert.ok(html.includes('--card-fg:'));
        assert.ok(html.includes('--card-muted:'));
        assert.ok(html.includes('--card-action-fg:'));
        assert.ok(html.includes('background:#112233'));

        planner.kanbanCollapsedByRow = { '0': true };
        const collapsed = renderPlannerKanbanHtml(planner, { canEdit: true });
        assert.ok(collapsed.includes('is-collapsed'));
        assert.ok(collapsed.includes('data-planner-kanban-field="comments"'));
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

    it('builds multiple predecessor edges from comma-separated row preds', () => {
        const layout = layoutPlannerGantt([
            { id: '1', name: 'A', start: '2026-03-01', stop: '2026-03-03', predecessors: [] },
            { id: '2', name: 'B', start: '2026-03-02', stop: '2026-03-04', predecessors: [] },
            { id: '3', name: 'C', start: '2026-03-05', stop: '2026-03-08', predecessors: ['1', '3', '2'] }
        ], { zoom: 'day', now: new Date(2026, 2, 6) });
        // Self-pred "3" is skipped; edges from 1 and 2 remain.
        assert.equal(layout.edges.length, 2);
        const fromIds = layout.edges.map((e) => e.fromId).sort();
        assert.deepEqual(fromIds, ['1', '2']);
        assert.ok(layout.edges.every((e) => e.toId === '3' && e.path));
    });

    it('treats start-only tasks as square milestone diamonds', () => {
        const layout = layoutPlannerGantt([
            { id: '1', name: 'Gate', start: '2026-03-10', stop: '', predecessors: [] },
            { id: '2', name: 'Span', start: '2026-03-10', stop: '2026-03-12', predecessors: [] }
        ], { zoom: 'day', now: new Date(2026, 2, 10) });

        assert.equal(layout.bars.length, 2);
        const milestone = layout.bars[0];
        const bar = layout.bars[1];
        assert.equal(milestone.milestone, true);
        assert.equal(milestone.width, milestone.height);
        assert.equal(bar.milestone, false);
        assert.ok(bar.width > bar.height);
    });

    it('returns empty chart with today when no dated tasks', () => {
        const layout = layoutPlannerGantt([], { zoom: 'week', now: new Date(2026, 0, 15) });
        assert.equal(layout.empty, true);
        assert.ok(layout.chartWidth > 0);
    });

    it('uses fewer pixels-per-day at coarser zoom', () => {
        assert.ok(zoomPxPerDay('day') > zoomPxPerDay('week'));
        assert.ok(zoomPxPerDay('week') > zoomPxPerDay('month'));
        assert.ok(zoomPxPerDay('month') > zoomPxPerDay('quarter'));
        assert.ok(zoomPxPerDay('quarter') > zoomPxPerDay('year'));
    });

    it('builds alternating interval bands per zoom', () => {
        const start = new Date(2026, 0, 1);
        const end = new Date(2026, 1, 1);
        const day = buildGanttAxis(start, end, 'day', zoomPxPerDay('day'));
        assert.ok(day.bands.length >= 28);
        assert.equal(day.bands[0].alt, false);
        assert.equal(day.bands[1].alt, true);
        assert.ok(day.minors.some((m) => m.label === '1'));
        assert.ok(day.minors.some((m) => m.weekend && (m.label === '1' || Number(m.label) >= 1)));
        const satSun = day.minors.filter((m) => m.weekend);
        assert.ok(satSun.length >= 8);

        const week = buildGanttAxis(start, end, 'week', zoomPxPerDay('week'));
        assert.ok(week.bands.length >= 4);
        assert.ok(week.bands.some((b) => b.alt));
        assert.ok(week.minors.every((m) => /^W\d+$/.test(m.label)));
        assert.ok(week.minors.some((m) => m.label === 'W1' || m.label === 'W2'));

        const quarter = buildGanttAxis(start, new Date(2027, 0, 1), 'quarter', zoomPxPerDay('quarter'));
        assert.ok(quarter.bands.length >= 4);
        assert.ok(quarter.minors.some((m) => m.label === 'Q1'));

        const month = buildGanttAxis(start, new Date(2026, 6, 1), 'month', zoomPxPerDay('month'));
        assert.ok(month.bands.length >= 6);

        const year = buildGanttAxis(start, new Date(2029, 0, 1), 'year', zoomPxPerDay('year'));
        assert.ok(year.bands.length >= 3);
        assert.equal(year.bands.filter((b) => b.alt).length >= 1, true);
    });

    it('computes ISO week numbers across year boundaries and leap years', () => {
        // 2026-01-01 is Thursday → ISO week 1 of 2026
        assert.equal(isoWeekNumber(new Date(2026, 0, 1)), 1);
        // 2021-01-01 is Friday → belongs to ISO week 53 of 2020
        assert.equal(isoWeekNumber(new Date(2021, 0, 1)), 53);
        // 2020-12-31 is Thursday → ISO week 53 of 2020
        assert.equal(isoWeekNumber(new Date(2020, 11, 31)), 53);
        // 2024-12-30 is Monday → ISO week 1 of 2025
        assert.equal(isoWeekNumber(new Date(2024, 11, 30)), 1);
        // Leap year: 2024-02-29 is Thursday → ISO week 9
        assert.equal(isoWeekNumber(new Date(2024, 1, 29)), 9);

        const axis = buildGanttAxis(
            new Date(2020, 11, 21),
            new Date(2021, 0, 18),
            'week',
            zoomPxPerDay('week')
        );
        assert.ok(axis.minors.some((m) => m.label === 'W53'));
        assert.ok(axis.minors.some((m) => m.label === 'W1'));
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

describe('planner calendar layout', () => {
    it('covers inclusive local days and milestones', () => {
        const coverage = buildPlannerCalendarDayCoverage([
            { start: '2026-03-01', stop: '2026-03-03', categoryColor: '#112233' },
            { start: '2026-03-05', stop: '', categoryColor: '#445566' }
        ]);
        assert.deepEqual(coverage.get('2026-03-01'), ['#112233']);
        assert.deepEqual(coverage.get('2026-03-02'), ['#112233']);
        assert.deepEqual(coverage.get('2026-03-03'), ['#112233']);
        assert.equal(coverage.has('2026-03-04'), false);
        assert.deepEqual(coverage.get('2026-03-05'), ['#445566']);
    });

    it('lists consecutive months for a padded range', () => {
        const months = listPlannerCalendarMonths(
            new Date(2026, 0, 1),
            new Date(2026, 4, 1)
        );
        assert.deepEqual(months, [
            { year: 2026, month: 0 },
            { year: 2026, month: 1 },
            { year: 2026, month: 2 },
            { year: 2026, month: 3 }
        ]);
    });

    it('layouts a month-padded strip from planner tasks', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Alpha');
        setPlannerField(planner.sheet, 0, 'start', '2026-06-10');
        setPlannerField(planner.sheet, 0, 'stop', '2026-06-20');
        setCategoryColor(planner, 'Ops', '#aabbcc');
        setPlannerField(planner.sheet, 0, 'category', 'Ops');

        const layout = layoutPlannerCalendar(planner, { now: new Date(2026, 5, 15) });
        assert.ok(layout.months.length >= 3);
        assert.equal(plannerCalendarDayKey(new Date(2026, 5, 15)), '2026-06-15');
        assert.ok(layout.dayCoverage.has('2026-06-10'));
        assert.ok(layout.dayCoverage.has('2026-06-20'));
        assert.deepEqual(layout.dayCoverage.get('2026-06-12'), ['#aabbcc']);
        assert.ok(layout.focusMonthIndex >= 0);
    });

    it('uses 1/(n+1) bar height fractions', () => {
        assert.equal(plannerCalendarBarHeightFraction(1), 0.5);
        assert.equal(plannerCalendarBarHeightFraction(2), 1 / 3);
        assert.equal(plannerCalendarBarHeightFraction(3), 0.25);
        assert.equal(plannerCalendarBarHeightFraction(4), 0.2);
        assert.equal(plannerCalendarBarHeightFraction(0), 0.5);
    });

    it('reserves a day-number band above bar body', () => {
        assert.ok(PLANNER_CAL_DAY_NUM_BAND_FRAC > 0 && PLANNER_CAL_DAY_NUM_BAND_FRAC < 0.5);
    });

    it('packs overlapping intervals into distinct lanes', () => {
        const packed = packPlannerCalendarLanes([
            { id: 'a', dayStart: 1, dayEnd: 5 },
            { id: 'b', dayStart: 3, dayEnd: 7 },
            { id: 'c', dayStart: 8, dayEnd: 10 }
        ]);
        const byId = Object.fromEntries(packed.map((p) => [p.id, p.lane]));
        assert.equal(byId.a, 0);
        assert.equal(byId.b, 1);
        assert.equal(byId.c, 0);
    });

    it('splits ranges across week boundaries', () => {
        // March 2026: day 1 is Sunday → firstDayIndex 0
        // Days 1–8 cross Sat(7) into next week
        const segs = splitPlannerCalendarWeekSegments(1, 8, 0);
        assert.equal(segs.length, 2);
        assert.deepEqual(segs[0], {
            weekRow: 0, startCol: 0, endCol: 6, dayStart: 1, dayEnd: 7
        });
        assert.deepEqual(segs[1], {
            weekRow: 1, startCol: 0, endCol: 0, dayStart: 8, dayEnd: 8
        });
    });

    it('lays out month bars with peak concurrency and week segments', () => {
        const dated = parsePlannerCalendarTaskIntervals([
            { id: '1', name: 'A', start: '2026-03-02', stop: '2026-03-10', categoryColor: '#111111' },
            { id: '2', name: 'B', start: '2026-03-05', stop: '2026-03-07', categoryColor: '#222222' }
        ]);
        // March 2026 starts on Sunday
        const layout = layoutPlannerCalendarMonthBars(2026, 2, dated);
        assert.equal(layout.peak, 2);
        assert.equal(layout.heightFraction, 1 / 3);
        assert.equal(layout.intervals.length, 2);
        const lanes = Object.fromEntries(layout.intervals.map((i) => [i.id, i.lane]));
        assert.notEqual(lanes['1'], lanes['2']);
        assert.ok(layout.segments.length >= 2);
        // Task A spans past a Saturday → multiple segments
        const aSegs = layout.segments.filter((s) => s.id === '1');
        assert.ok(aSegs.length >= 2);
    });
});

describe('planner Kanban', () => {
    it('normalizes flavour labels and defaults', () => {
        assert.equal(normalizeKanbanFlavour('workflow'), 'workflow');
        assert.equal(normalizeKanbanFlavour('nope'), KANBAN_DEFAULT_FLAVOUR);
        assert.deepEqual(kanbanLabelsForFlavour('release'), [...KANBAN_FLAVOURS.release]);
        assert.deepEqual(kanbanLabelsForFlavour('workflow'), [...KANBAN_FLAVOURS.workflow]);
        const opts = readDisplayOptions();
        assert.ok(['release', 'workflow'].includes(opts.plannerKanbanFlavour));
    });

    it('hides empty-name rows and defaults missing stage to column 0', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Alpha');
        setPlannerField(planner.sheet, 1, 'start', '2026-03-01'); // no name → hidden
        setPlannerField(planner.sheet, 2, 'name', 'Beta');
        planner.kanbanStageByRow = { '2': 3 };
        const cards = derivePlannerKanbanCards(planner);
        assert.equal(cards.length, 2);
        assert.deepEqual(cards.map((c) => c.name), ['Alpha', 'Beta']);
        const layout = layoutPlannerKanban(planner, { flavour: 'release' });
        assert.equal(layout.columns[0].cards.map((c) => c.name).join(','), 'Alpha');
        assert.equal(layout.columns[3].cards.map((c) => c.name).join(','), 'Beta');
        assert.equal(layout.labels[0], 'Preparation');
    });

    it('uses category color by default and keeps full comments for CSS clamp', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Paint');
        setPlannerField(planner.sheet, 0, 'category', 'Design');
        setPlannerField(planner.sheet, 0, 'comments', 'x'.repeat(120));
        setCategoryColor(planner, 'Design', '#aabbcc');
        const cards = derivePlannerKanbanCards(planner);
        assert.equal(cards[0].cardColor, '#aabbcc');
        assert.equal(cards[0].comments.length, 120);
        // Helper still truncates for callers that want a plain-text clip.
        assert.ok(clipKanbanComment(cards[0].comments).endsWith('…'));

        planner.kanbanCardColors = { '0': '#112233' };
        const overridden = derivePlannerKanbanCards(planner);
        assert.equal(overridden[0].cardColor, '#112233');

        setKanbanCardEmphasis(planner, 0, 'urgent');
        assert.equal(derivePlannerKanbanCards(planner)[0].emphasis, 'urgent');
        setKanbanCardEmphasis(planner, 0, 'muted');
        assert.equal(derivePlannerKanbanCards(planner)[0].emphasis, 'muted');
        setKanbanCardEmphasis(planner, 0, 'muted');
        assert.equal(derivePlannerKanbanCards(planner)[0].emphasis, '');
        assert.equal(planner.kanbanEmphasisByRow['0'], undefined);

        planner.kanbanCardColors = { '0': '#112233' };
        setKanbanCardEmphasis(planner, 0, 'urgent');
        resetKanbanCardStyles(planner, 0);
        assert.equal(planner.kanbanCardColors['0'], undefined);
        assert.equal(planner.kanbanEmphasisByRow['0'], undefined);
        // Category color still applies after clearing the override.
        assert.equal(derivePlannerKanbanCards(planner)[0].cardColor, '#aabbcc');
    });

    it('resets all card styles and arrangement', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'A');
        setPlannerField(planner.sheet, 1, 'name', 'B');
        planner.kanbanCardColors = { '0': '#112233', '1': '#abcdef' };
        planner.kanbanEmphasisByRow = { '0': 'urgent', '1': 'muted' };
        moveKanbanCard(planner, 0, 3);
        moveKanbanCard(planner, 1, 4);
        planner.kanbanSort = 'manual';
        planner.kanbanSortDir = 'desc';

        resetAllKanbanCardStyles(planner);
        assert.deepEqual(planner.kanbanCardColors, {});
        assert.deepEqual(planner.kanbanEmphasisByRow, {});
        assert.equal(planner.kanbanStageByRow['0'], 3);

        resetKanbanArrangement(planner);
        assert.deepEqual(planner.kanbanStageByRow, {});
        assert.deepEqual(planner.kanbanOrderByStage, {});
        assert.equal(planner.kanbanSort, 'row');
        assert.equal(planner.kanbanSortDir, 'asc');
        const layout = layoutPlannerKanban(planner);
        assert.deepEqual(layout.columns[0].cards.map((c) => c.name), ['A', 'B']);
    });

    it('collapses and expands cards; remaps and prunes collapsed map', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'A');
        setPlannerField(planner.sheet, 1, 'name', 'B');
        setPlannerField(planner.sheet, 2, 'name', 'C');

        assert.equal(derivePlannerKanbanCards(planner)[0].collapsed, false);
        setKanbanCardCollapsed(planner, 0, true);
        assert.equal(derivePlannerKanbanCards(planner)[0].collapsed, true);
        assert.deepEqual(planner.kanbanCollapsedByRow, { '0': true });

        collapseAllKanbanCards(planner);
        assert.deepEqual(planner.kanbanCollapsedByRow, { '0': true, '1': true, '2': true });
        expandAllKanbanCards(planner);
        assert.deepEqual(planner.kanbanCollapsedByRow, {});

        setKanbanCardCollapsed(planner, 0, true);
        setKanbanCardCollapsed(planner, 2, true);
        movePlannerRow(planner, 0, 2);
        // old 0→2, old 1→0, old 2→1
        assert.deepEqual(planner.kanbanCollapsedByRow, { '2': true, '1': true });

        addPlannerRow(planner);
        setPlannerField(planner.sheet, 3, 'name', 'D');
        setKanbanCardCollapsed(planner, 3, true);
        removePlannerRow(planner);
        assert.equal(planner.kanbanCollapsedByRow['3'], undefined);

        const normalized = normalizePlanner({
            ...createEmptyPlanner(),
            sheet: planner.sheet,
            kanbanCollapsedByRow: { '0': true, '9': true, '1': 0 }
        });
        assert.deepEqual(normalized.kanbanCollapsedByRow, { '0': true });
    });

    it('collapses stages; layout flags and render order put collapsed left', () => {
        assert.deepEqual(normalizeKanbanCollapsedByStage({ '1': true, '9': true, '2': 0, foo: true }), {
            '1': true
        });
        assert.deepEqual(normalizeKanbanCollapsedByStage(null), {});

        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'A');
        setKanbanStageCollapsed(planner, 1, true);
        setKanbanStageCollapsed(planner, 3, true);
        assert.deepEqual(planner.kanbanCollapsedByStage, { '1': true, '3': true });

        const layout = layoutPlannerKanban(planner, { flavour: 'release' });
        assert.equal(layout.columns[0].collapsed, false);
        assert.equal(layout.columns[1].collapsed, true);
        assert.equal(layout.columns[3].collapsed, true);

        // Arrangement reset does not clear stage collapse.
        resetKanbanArrangement(planner);
        assert.deepEqual(planner.kanbanCollapsedByStage, { '1': true, '3': true });

        setKanbanStageCollapsed(planner, 1, false);
        assert.deepEqual(planner.kanbanCollapsedByStage, { '3': true });

        planner.kanbanCollapsedByStage = { '1': true, '3': true };
        const html = renderPlannerKanbanHtml(planner, { canEdit: true, flavour: 'release' });
        assert.ok(html.includes('data-planner-kanban-stage-collapse'));
        assert.ok(html.includes('data-kanban-stage-collapsed="1"'));
        assert.ok(html.includes('planner-kanban__column is-collapsed'));

        // Collapsed stages (1, then 3) appear before open stages in DOM order.
        const stageOrder = [...html.matchAll(/data-planner-kanban-stage="(\d)"/g)].map((m) => m[1]);
        assert.deepEqual(stageOrder, ['1', '3', '0', '2', '4']);

        const normalized = normalizePlanner({
            ...createEmptyPlanner(),
            kanbanCollapsedByStage: { '0': true, '4': true, '7': true, '2': false }
        });
        assert.deepEqual(normalized.kanbanCollapsedByStage, { '0': true, '4': true });
    });

    it('sorts by date/row/alpha with asc/desc and manual order', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Late');
        setPlannerField(planner.sheet, 0, 'start', '2026-03-10');
        setPlannerField(planner.sheet, 1, 'name', 'Early');
        setPlannerField(planner.sheet, 1, 'start', '2026-03-01');
        setPlannerField(planner.sheet, 2, 'name', 'alpha');
        planner.kanbanStageByRow = { '0': 1, '1': 1, '2': 1 };

        planner.kanbanSort = 'date';
        planner.kanbanSortDir = 'asc';
        let layout = layoutPlannerKanban(planner, { flavour: 'workflow' });
        assert.deepEqual(layout.columns[1].cards.map((c) => c.name), ['Early', 'Late', 'alpha']);
        assert.equal(layout.labels[1], 'Planning');

        planner.kanbanSortDir = 'desc';
        layout = layoutPlannerKanban(planner, { flavour: 'workflow' });
        assert.deepEqual(layout.columns[1].cards.map((c) => c.name), ['Late', 'Early', 'alpha']);

        planner.kanbanSort = 'row';
        planner.kanbanSortDir = 'desc';
        layout = layoutPlannerKanban(planner, { flavour: 'workflow' });
        assert.deepEqual(layout.columns[1].cards.map((c) => c.name), ['alpha', 'Early', 'Late']);

        planner.kanbanSort = 'alpha';
        planner.kanbanSortDir = 'asc';
        layout = layoutPlannerKanban(planner, { flavour: 'workflow' });
        assert.deepEqual(layout.columns[1].cards.map((c) => c.name), ['alpha', 'Early', 'Late']);

        planner.kanbanSortDir = 'desc';
        layout = layoutPlannerKanban(planner, { flavour: 'workflow' });
        assert.deepEqual(layout.columns[1].cards.map((c) => c.name), ['Late', 'Early', 'alpha']);

        planner.kanbanSort = 'manual';
        planner.kanbanOrderByStage = { '1': [0, 1, 2] };
        layout = layoutPlannerKanban(planner, { flavour: 'workflow' });
        assert.deepEqual(layout.columns[1].cards.map((c) => c.name), ['Late', 'Early', 'alpha']);
    });

    it('moveKanbanCard updates stage and remaps on row move/remove', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'A');
        setPlannerField(planner.sheet, 1, 'name', 'B');
        setPlannerField(planner.sheet, 2, 'name', 'C');
        moveKanbanCard(planner, 0, 2);
        moveKanbanCard(planner, 1, 4);
        assert.equal(planner.kanbanStageByRow['0'], 2);
        assert.equal(planner.kanbanStageByRow['1'], 4);

        movePlannerRow(planner, 0, 2);
        // old 0→2, old 1→0, old 2→1
        assert.equal(planner.kanbanStageByRow['2'], 2);
        assert.equal(planner.kanbanStageByRow['0'], 4);

        addPlannerRow(planner);
        setPlannerField(planner.sheet, 3, 'name', 'D');
        moveKanbanCard(planner, 3, 1);
        assert.equal(planner.kanbanStageByRow['3'], 1);
        removePlannerRow(planner);
        assert.equal(planner.kanbanStageByRow['3'], undefined);
    });

    it('normalizePlanner keeps kanban meta and drops orphan stages', () => {
        const raw = createEmptyPlanner();
        setPlannerField(raw.sheet, 0, 'name', 'Keep');
        raw.kanbanCollapsed = true;
        raw.kanbanSort = 'manual';
        raw.kanbanStageByRow = { '0': 2, '9': 1, '1': 4 };
        raw.kanbanOrderByStage = { '2': [0, 9] };
        const planner = normalizePlanner(raw);
        assert.equal(planner.kanbanCollapsed, true);
        assert.equal(planner.kanbanSort, 'manual');
        assert.deepEqual(planner.kanbanStageByRow, { '0': 2 });
        assert.deepEqual(planner.kanbanOrderByStage, { '2': [0] });
    });

    it('normalizePlanner prunes empty-name kanban maps and inherits chart collapse', () => {
        const raw = createEmptyPlanner();
        setPlannerField(raw.sheet, 0, 'name', 'Keep');
        // Row 1 has no name — meta for it must not survive.
        raw.kanbanStageByRow = { '0': 1, '1': 2 };
        raw.kanbanOrderByStage = { '1': [0, 1], '2': [1] };
        raw.kanbanCardColors = { '0': '#112233', '1': '#abcdef' };
        raw.kanbanEmphasisByRow = { '0': 'urgent', '1': 'muted' };
        raw.kanbanCollapsedByRow = { '0': true, '1': true };
        raw.chartCollapsed = true;
        delete raw.kanbanCollapsed;
        const planner = normalizePlanner(raw);
        assert.equal(planner.kanbanCollapsed, true);
        assert.deepEqual(planner.kanbanStageByRow, { '0': 1 });
        assert.deepEqual(planner.kanbanOrderByStage, { '1': [0] });
        assert.deepEqual(planner.kanbanCardColors, { '0': '#112233' });
        assert.deepEqual(planner.kanbanEmphasisByRow, { '0': 'urgent' });
        assert.deepEqual(planner.kanbanCollapsedByRow, { '0': true });
    });
});

function testDaysBetween(a, b) {
    const DAY = 24 * 60 * 60 * 1000;
    const s = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const e = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((e - s) / DAY);
}
