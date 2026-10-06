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
    togglePlannerWorkPack,
    addPlannerPackChild,
    removePlannerPackChild,
    buildPlannerOutlineLabels,
    isPlannerUnsupportedNewer,
    isPlannerRowPack,
    isPlannerRowHidden,
    isPlannerPackCollapsed,
    setPlannerPackCollapsed,
    getPlannerRowId,
    getPlannerRowLevel,
    PLANNER_COL_COUNT,
    PLANNER_DEFAULT_ZOOM,
    PLANNER_DEFAULT_CHART_VIEW,
    PLANNER_DEFAULT_LABEL_WIDTH,
    PLANNER_DEFAULT_TODAY_LINE,
    PLANNER_VERSION
} from '../js/planner.js';
import {
    derivePlannerWbsCards,
    layoutPlannerWbs,
    groupWbsColumnCards,
    resolveWbsPackParentId,
    moveWbsCard,
    resetWbsArrangement,
    resetWbsLabels,
    setWbsCardColor,
    setWbsCardEmphasis,
    setWbsCardCollapsed,
    resetWbsCardStyles,
    pruneWbsAfterRowRemove,
    WBS_DEFAULT_PHASE_LABELS,
    WBS_DEFAULT_DELIVERABLE_LABELS
} from '../js/plannerWbs.js';
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
import { buildNotePlannerSectionHtml, renderPlannerGanttHtml, renderPlannerKanbanHtml, renderPlannerWbsHtml } from '../js/plannerUi.js';
import { readDisplayOptions } from '../js/displayOptions.js';

describe('planner model', () => {
    it('creates an empty planner with v3 schema and stable rowIds', () => {
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
        assert.equal(planner.chartHidden, false);
        assert.equal(planner.kanbanHidden, false);
        assert.equal(planner.wbsHidden, false);
        assert.equal(planner.kanbanSort, 'row');
        assert.equal(planner.kanbanSortDir, 'asc');
        assert.deepEqual(planner.kanbanStageById, {});
        assert.deepEqual(planner.kanbanOrderByStage, {});
        assert.deepEqual(planner.kanbanCardColors, {});
        assert.deepEqual(planner.kanbanEmphasisById, {});
        assert.deepEqual(planner.kanbanCollapsedById, {});
        assert.deepEqual(planner.kanbanCollapsedByStage, {});
        assert.equal(planner.rowIds.length, 3);
        assert.equal(planner.nextRowId, 4);
        assert.equal(planner.wbsMode, 'phase');
        assert.deepEqual(planner.wbsPhaseLabels, [...WBS_DEFAULT_PHASE_LABELS]);
        assert.equal(getPlannerField(planner.sheet, 0, 'name'), '');
        assert.equal(plannerHasContent(planner), false);
        assert.deepEqual(planner.sheet.colWidths.slice(2, 4), [92, 92]);
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
        assert.equal(planner.version, PLANNER_VERSION);
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
        assert.ok(html.includes('data-planner-module-toggle="chart"'));
        assert.ok(html.includes('data-planner-module-toggle="kanban"'));
        assert.ok(html.includes('data-planner-module-toggle="wbs"'));
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

    it('buildNotePlannerSectionHtml omits hidden modules; table always present', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Keep');
        planner.chartHidden = true;
        planner.kanbanHidden = true;
        planner.wbsHidden = true;
        const html = buildNotePlannerSectionHtml({ id: 'n-hide', planner }, { canEdit: true });
        assert.ok(html.includes('data-planner-table'));
        assert.ok(html.includes('data-planner-table-toggle'));
        assert.ok(html.includes('data-planner-module-toggle="chart"'));
        assert.ok(html.includes('data-planner-module-toggle="kanban"'));
        assert.ok(html.includes('data-planner-module-toggle="wbs"'));
        assert.ok(html.includes('aria-pressed="false"'));
        assert.ok(!html.includes('data-planner-gantt'));
        assert.ok(!html.includes('data-planner-chart-toggle'));
        assert.ok(!html.includes('data-planner-kanban'));
        assert.ok(!html.includes('data-planner-wbs'));
        const normalized = normalizePlanner(planner);
        assert.equal(normalized.chartHidden, true);
        assert.equal(normalized.kanbanHidden, true);
        assert.equal(normalized.wbsHidden, true);
    });

    it('kanban inline fields only when canEdit; flyout stays read-only spans', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Task A');
        setPlannerField(planner.sheet, 0, 'comments', 'Hello');
        const editable = renderPlannerKanbanHtml(planner, { canEdit: true });
        assert.ok(editable.includes('data-planner-kanban-field="name"'));
        assert.ok(editable.includes('data-planner-kanban-field="comments"'));
        assert.ok(editable.includes('contenteditable="plaintext-only"'));
        assert.ok(/<textarea[^>]*data-planner-kanban-field="comments"/.test(editable));
        assert.ok(/rows="1"/.test(editable));
        // Flyout mirrors are plain spans (no contenteditable inside flyout).
        assert.ok(editable.includes('planner-kanban__card-flyout'));
        assert.ok(!/<div class="planner-kanban__card-flyout"[^>]*>[\s\S]*?contenteditable/.test(editable));
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
        assert.ok(readonly.includes('planner-kanban__card-flyout'));
    });

    it('colored kanban cards emit contrast tokens and collapsed keeps comments for flyout', () => {
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
        assert.ok(html.includes('planner-kanban__card-flyout'));

        // Collapsed cards keep comments in DOM so the absolute flyout can peek them.
        planner.kanbanCollapsedById = { [planner.rowIds[0]]: true };
        const collapsed = renderPlannerKanbanHtml(planner, { canEdit: true });
        assert.ok(collapsed.includes('is-collapsed'));
        assert.ok(collapsed.includes('data-planner-kanban-field="comments"'));
        assert.ok(collapsed.includes('notes'));
        assert.ok(collapsed.includes('planner-kanban__card-flyout'));
        assert.ok(/planner-kanban__card-flyout[\s\S]*?notes/.test(collapsed));
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
        const id2 = planner.rowIds[2];
        setPlannerField(planner.sheet, 0, 'name', 'Alpha');
        setPlannerField(planner.sheet, 1, 'start', '2026-03-01'); // no name → hidden
        setPlannerField(planner.sheet, 2, 'name', 'Beta');
        planner.kanbanStageById = { [id2]: 3 };
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
        const id0 = planner.rowIds[0];
        setPlannerField(planner.sheet, 0, 'name', 'Paint');
        setPlannerField(planner.sheet, 0, 'category', 'Design');
        setPlannerField(planner.sheet, 0, 'comments', 'x'.repeat(120));
        setCategoryColor(planner, 'Design', '#aabbcc');
        const cards = derivePlannerKanbanCards(planner);
        assert.equal(cards[0].cardColor, '#aabbcc');
        assert.equal(cards[0].comments.length, 120);
        assert.ok(clipKanbanComment(cards[0].comments).endsWith('…'));

        planner.kanbanCardColors = { [id0]: '#112233' };
        const overridden = derivePlannerKanbanCards(planner);
        assert.equal(overridden[0].cardColor, '#112233');

        setKanbanCardEmphasis(planner, 0, 'urgent');
        assert.equal(derivePlannerKanbanCards(planner)[0].emphasis, 'urgent');
        setKanbanCardEmphasis(planner, 0, 'muted');
        assert.equal(derivePlannerKanbanCards(planner)[0].emphasis, 'muted');
        setKanbanCardEmphasis(planner, 0, 'muted');
        assert.equal(derivePlannerKanbanCards(planner)[0].emphasis, '');
        assert.equal(planner.kanbanEmphasisById[id0], undefined);

        planner.kanbanCardColors = { [id0]: '#112233' };
        setKanbanCardEmphasis(planner, 0, 'urgent');
        resetKanbanCardStyles(planner, 0);
        assert.equal(planner.kanbanCardColors[id0], undefined);
        assert.equal(planner.kanbanEmphasisById[id0], undefined);
        assert.equal(derivePlannerKanbanCards(planner)[0].cardColor, '#aabbcc');
    });

    it('resets all card styles and arrangement', () => {
        const planner = createEmptyPlanner();
        const id0 = planner.rowIds[0];
        const id1 = planner.rowIds[1];
        setPlannerField(planner.sheet, 0, 'name', 'A');
        setPlannerField(planner.sheet, 1, 'name', 'B');
        planner.kanbanCardColors = { [id0]: '#112233', [id1]: '#abcdef' };
        planner.kanbanEmphasisById = { [id0]: 'urgent', [id1]: 'muted' };
        moveKanbanCard(planner, 0, 3);
        moveKanbanCard(planner, 1, 4);
        planner.kanbanSort = 'manual';
        planner.kanbanSortDir = 'desc';

        resetAllKanbanCardStyles(planner);
        assert.deepEqual(planner.kanbanCardColors, {});
        assert.deepEqual(planner.kanbanEmphasisById, {});
        assert.equal(planner.kanbanStageById[id0], 3);

        resetKanbanArrangement(planner);
        assert.deepEqual(planner.kanbanStageById, {});
        assert.deepEqual(planner.kanbanOrderByStage, {});
        assert.equal(planner.kanbanSort, 'row');
        assert.equal(planner.kanbanSortDir, 'asc');
        const layout = layoutPlannerKanban(planner);
        assert.deepEqual(layout.columns[0].cards.map((c) => c.name), ['A', 'B']);
    });

    it('collapses and expands cards; id keys survive row moves', () => {
        const planner = createEmptyPlanner();
        const id0 = planner.rowIds[0];
        const id1 = planner.rowIds[1];
        const id2 = planner.rowIds[2];
        setPlannerField(planner.sheet, 0, 'name', 'A');
        setPlannerField(planner.sheet, 1, 'name', 'B');
        setPlannerField(planner.sheet, 2, 'name', 'C');

        assert.equal(derivePlannerKanbanCards(planner)[0].collapsed, false);
        setKanbanCardCollapsed(planner, 0, true);
        assert.equal(derivePlannerKanbanCards(planner)[0].collapsed, true);
        assert.deepEqual(planner.kanbanCollapsedById, { [id0]: true });

        collapseAllKanbanCards(planner);
        assert.deepEqual(planner.kanbanCollapsedById, { [id0]: true, [id1]: true, [id2]: true });
        expandAllKanbanCards(planner);
        assert.deepEqual(planner.kanbanCollapsedById, {});

        setKanbanCardCollapsed(planner, 0, true);
        setKanbanCardCollapsed(planner, 2, true);
        movePlannerRow(planner, 0, 2);
        // Id-keyed maps do not remap — same ids stay collapsed.
        assert.deepEqual(planner.kanbanCollapsedById, { [id0]: true, [id2]: true });

        addPlannerRow(planner);
        const id3 = planner.rowIds[3];
        setPlannerField(planner.sheet, 3, 'name', 'D');
        setKanbanCardCollapsed(planner, 3, true);
        removePlannerRow(planner);
        assert.equal(planner.kanbanCollapsedById[id3], undefined);

        const normalized = normalizePlanner({
            ...createEmptyPlanner(),
            sheet: { rows: 3, cols: 6, cells: { '0:0': { v: 'Keep' } }, colWidths: [90, 72, 108, 108, 44, 80] },
            rowIds: ['1', '2', '3'],
            nextRowId: 4,
            kanbanCollapsedById: { '1': true, '9': true, '2': 0 }
        });
        assert.deepEqual(normalized.kanbanCollapsedById, { '1': true });
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

        resetKanbanArrangement(planner);
        assert.deepEqual(planner.kanbanCollapsedByStage, { '1': true, '3': true });

        setKanbanStageCollapsed(planner, 1, false);
        assert.deepEqual(planner.kanbanCollapsedByStage, { '3': true });

        planner.kanbanCollapsedByStage = { '1': true, '3': true };
        const html = renderPlannerKanbanHtml(planner, { canEdit: true, flavour: 'release' });
        assert.ok(html.includes('data-planner-kanban-stage-collapse'));
        assert.ok(html.includes('data-kanban-stage-collapsed="1"'));
        assert.ok(html.includes('planner-kanban__column is-collapsed'));

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
        const [id0, id1, id2] = planner.rowIds;
        setPlannerField(planner.sheet, 0, 'name', 'Late');
        setPlannerField(planner.sheet, 0, 'start', '2026-03-10');
        setPlannerField(planner.sheet, 1, 'name', 'Early');
        setPlannerField(planner.sheet, 1, 'start', '2026-03-01');
        setPlannerField(planner.sheet, 2, 'name', 'alpha');
        planner.kanbanStageById = { [id0]: 1, [id1]: 1, [id2]: 1 };

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
        planner.kanbanOrderByStage = { '1': [id0, id1, id2] };
        layout = layoutPlannerKanban(planner, { flavour: 'workflow' });
        assert.deepEqual(layout.columns[1].cards.map((c) => c.name), ['Late', 'Early', 'alpha']);
    });

    it('moveKanbanCard keeps stage by stable id across row moves', () => {
        const planner = createEmptyPlanner();
        const id0 = planner.rowIds[0];
        const id1 = planner.rowIds[1];
        setPlannerField(planner.sheet, 0, 'name', 'A');
        setPlannerField(planner.sheet, 1, 'name', 'B');
        setPlannerField(planner.sheet, 2, 'name', 'C');
        moveKanbanCard(planner, 0, 2);
        moveKanbanCard(planner, 1, 4);
        assert.equal(planner.kanbanStageById[id0], 2);
        assert.equal(planner.kanbanStageById[id1], 4);

        movePlannerRow(planner, 0, 2);
        // Stages follow ids, not positions.
        assert.equal(planner.kanbanStageById[id0], 2);
        assert.equal(planner.kanbanStageById[id1], 4);

        addPlannerRow(planner);
        const id3 = planner.rowIds[3];
        setPlannerField(planner.sheet, 3, 'name', 'D');
        moveKanbanCard(planner, 3, 1);
        assert.equal(planner.kanbanStageById[id3], 1);
        removePlannerRow(planner);
        assert.equal(planner.kanbanStageById[id3], undefined);
    });

    it('normalizePlanner migrates legacy index keys to ids and drops orphans', () => {
        const raw = createEmptyPlanner();
        setPlannerField(raw.sheet, 0, 'name', 'Keep');
        raw.kanbanCollapsed = true;
        raw.kanbanSort = 'manual';
        // Legacy index-keyed maps
        raw.kanbanStageByRow = { '0': 2, '9': 1, '1': 4 };
        raw.kanbanOrderByStage = { '2': [0, 9] };
        delete raw.kanbanStageById;
        const planner = normalizePlanner(raw);
        assert.equal(planner.kanbanCollapsed, true);
        assert.equal(planner.kanbanSort, 'manual');
        assert.deepEqual(planner.kanbanStageById, { [planner.rowIds[0]]: 2 });
        assert.deepEqual(planner.kanbanOrderByStage, { '2': [planner.rowIds[0]] });
    });

    it('normalizePlanner prunes empty-name kanban maps and inherits chart collapse', () => {
        const raw = createEmptyPlanner();
        const id0 = raw.rowIds[0];
        const id1 = raw.rowIds[1];
        setPlannerField(raw.sheet, 0, 'name', 'Keep');
        raw.kanbanStageById = { [id0]: 1, [id1]: 2 };
        raw.kanbanOrderByStage = { '1': [id0, id1], '2': [id1] };
        raw.kanbanCardColors = { [id0]: '#112233', [id1]: '#abcdef' };
        raw.kanbanEmphasisById = { [id0]: 'urgent', [id1]: 'muted' };
        raw.kanbanCollapsedById = { [id0]: true, [id1]: true };
        raw.chartCollapsed = true;
        delete raw.kanbanCollapsed;
        const planner = normalizePlanner(raw);
        assert.equal(planner.kanbanCollapsed, true);
        assert.deepEqual(planner.kanbanStageById, { [id0]: 1 });
        assert.deepEqual(planner.kanbanOrderByStage, { '1': [id0] });
        assert.deepEqual(planner.kanbanCardColors, { [id0]: '#112233' });
        assert.deepEqual(planner.kanbanEmphasisById, { [id0]: 'urgent' });
        assert.deepEqual(planner.kanbanCollapsedById, { [id0]: true });
    });
});

describe('planner WBS and work packs', () => {
    it('pack toggle marks parent only (no parked-hidden child)', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'PackMe');
        setPlannerField(planner.sheet, 1, 'name', 'Neighbor');
        const neighborId = planner.rowIds[1];
        const rowsBefore = planner.sheet.rows;
        assert.equal(togglePlannerWorkPack(planner, 0), true);
        assert.equal(isPlannerRowPack(planner, 0), true);
        assert.equal(planner.sheet.rows, rowsBefore);
        assert.equal(planner.rowIds[1], neighborId);
        assert.equal(getPlannerField(planner.sheet, 1, 'name'), 'Neighbor');
        assert.equal(isPlannerRowHidden(planner, 1), false);
        const leafCards = derivePlannerWbsCards(planner);
        assert.deepEqual(leafCards.map((c) => c.name).sort(), ['Neighbor']);
    });

    it('pack-scoped +/− adds and removes child lines under parent', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Pack');
        togglePlannerWorkPack(planner, 0);
        const id0 = addPlannerPackChild(planner, 0);
        assert.ok(id0);
        assert.equal(getPlannerRowLevel(planner, 1), 1);
        setPlannerField(planner.sheet, 1, 'name', 'Line1');
        const id1 = addPlannerPackChild(planner, 0);
        assert.ok(id1);
        setPlannerField(planner.sheet, 2, 'name', 'Line2');
        assert.deepEqual(buildPlannerOutlineLabels(planner).slice(0, 3), ['1', '1a', '1b']);
        assert.equal(removePlannerPackChild(planner, 0), true);
        assert.equal(getPlannerField(planner.sheet, 1, 'name'), 'Line1');
        assert.ok(!planner.rowIds.includes(id1));
        assert.equal(removePlannerPackChild(planner, 0), true);
        assert.equal(removePlannerPackChild(planner, 0), false);
        assert.equal(isPlannerRowPack(planner, 0), true);
    });

    it('pack collapse hides children in sheet derive path; WBS leaves only', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Pack');
        togglePlannerWorkPack(planner, 0);
        addPlannerPackChild(planner, 0);
        setPlannerField(planner.sheet, 1, 'name', 'Child');
        setPlannerPackCollapsed(planner, 0, true);
        assert.equal(isPlannerPackCollapsed(planner, 0), true);
        const html = buildNotePlannerSectionHtml({ id: 'n', planner }, { canEdit: true });
        assert.ok(html.includes('data-planner-pack-head="1"'));
        assert.ok(!html.includes('data-planner-row-index="1"')); // sheet omits collapsed children
        assert.ok(html.includes('data-planner-pack-add'));
        const leaves = derivePlannerWbsCards(planner);
        assert.deepEqual(leaves.map((c) => c.name), ['Child']);
    });

    it('WBS card styles set/prune and editable HTML', () => {
        const planner = createEmptyPlanner();
        const id0 = planner.rowIds[0];
        setPlannerField(planner.sheet, 0, 'name', 'Styled');
        setWbsCardColor(planner, id0, '#aabbcc');
        setWbsCardEmphasis(planner, id0, 'urgent');
        setWbsCardCollapsed(planner, id0, true);
        const cards = derivePlannerWbsCards(planner);
        assert.equal(cards[0].cardColor, '#aabbcc');
        assert.equal(cards[0].emphasis, 'urgent');
        assert.equal(cards[0].collapsed, true);
        const html = renderPlannerWbsHtml(planner, { canEdit: true });
        assert.ok(html.includes('data-planner-wbs-field="name"'));
        assert.ok(html.includes('data-planner-wbs-field="comments"'));
        assert.ok(html.includes('planner-wbs__card-flyout'));
        assert.ok(html.includes('data-planner-wbs-density'));
        assert.ok(html.includes('is-editable'));
        assert.ok(html.includes('is-collapsed'));
        resetWbsCardStyles(planner, id0);
        assert.equal(planner.wbsCardColors[id0], undefined);
        assert.equal(planner.wbsEmphasisById[id0], undefined);
        pruneWbsAfterRowRemove(planner, [id0]);
        assert.equal(planner.wbsCollapsedById?.[id0], undefined);
    });

    it('WBS mode maps are independent; reset labels vs arrangement', () => {
        const planner = createEmptyPlanner();
        const id0 = planner.rowIds[0];
        setPlannerField(planner.sheet, 0, 'name', 'Task');
        moveWbsCard(planner, id0, 2);
        planner.wbsMode = 'deliverable';
        moveWbsCard(planner, id0, 4);
        assert.equal(planner.wbsPhaseById[id0], 2);
        assert.equal(planner.wbsDeliverableById[id0], 4);

        planner.wbsMode = 'phase';
        resetWbsArrangement(planner);
        assert.deepEqual(planner.wbsPhaseById, {});
        assert.equal(planner.wbsDeliverableById[id0], 4);

        planner.wbsPhaseLabels = ['A', 'B', 'C', 'D', 'E'];
        resetWbsLabels(planner);
        assert.deepEqual(planner.wbsPhaseLabels, [...WBS_DEFAULT_PHASE_LABELS]);
        assert.deepEqual(planner.wbsDeliverableLabels, [...WBS_DEFAULT_DELIVERABLE_LABELS]);

        const layout = layoutPlannerWbs(planner, { mode: 'deliverable' });
        assert.equal(layout.columns.length, 5);
        assert.equal(layout.columns[0].key, '0');
        assert.equal(layout.columns[4].cards[0]?.name, 'Task');
        // Missing assignment lands in first column.
        const phaseLayout = layoutPlannerWbs(planner, { mode: 'phase' });
        assert.equal(phaseLayout.columns[0].cards[0]?.name, 'Task');
    });

    it('WBS in-column tree groups contiguous pack siblings', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Design Pack');
        togglePlannerWorkPack(planner, 0);
        addPlannerPackChild(planner, 0);
        setPlannerField(planner.sheet, 1, 'name', 'Wireframes');
        addPlannerPackChild(planner, 0);
        setPlannerField(planner.sheet, 2, 'name', 'Mockups');
        setPlannerField(planner.sheet, 3, 'name', 'Solo Root');

        const packId = planner.rowIds[0];
        const childA = planner.rowIds[1];
        const childB = planner.rowIds[2];
        const soloId = planner.rowIds[3];

        assert.equal(resolveWbsPackParentId(planner, childA), packId);
        assert.equal(resolveWbsPackParentId(planner, childB), packId);
        assert.equal(resolveWbsPackParentId(planner, soloId), null);
        assert.equal(resolveWbsPackParentId(planner, packId), null);

        const leaves = derivePlannerWbsCards(planner);
        assert.deepEqual(leaves.map((c) => c.name).sort(), ['Mockups', 'Solo Root', 'Wireframes']);
        assert.ok(!leaves.some((c) => c.rowId === packId));

        const layout = layoutPlannerWbs(planner, { mode: 'phase' });
        const col0 = layout.columns[0];
        assert.equal(col0.cards.length, 3);
        assert.ok(Array.isArray(col0.groups));
        assert.equal(col0.groups[0]?.type, 'pack');
        assert.equal(col0.groups[0]?.packName, 'Design Pack');
        assert.deepEqual(col0.groups[0]?.cards.map((c) => c.name), ['Wireframes', 'Mockups']);
        assert.equal(col0.groups[1]?.type, 'root');
        assert.equal(col0.groups[1]?.card?.name, 'Solo Root');

        const html = renderPlannerWbsHtml(planner, { canEdit: false });
        assert.ok(html.includes('data-planner-wbs-tree'));
        assert.ok(html.includes('data-planner-wbs-pack'));
        assert.ok(html.includes('Design Pack'));
        assert.ok(html.includes('is-wbs-child'));
        assert.ok(html.includes('is-wbs-child-last'));
        assert.ok(html.includes('Wireframes'));
        assert.ok(html.includes('Solo Root'));
        // Pack itself is header-only, not a draggable card.
        assert.ok(!html.includes(`data-planner-row-id="${packId}"`));

        // Split children across buckets → local tree fragment per column.
        moveWbsCard(planner, childB, 2);
        const split = layoutPlannerWbs(planner, { mode: 'phase' });
        assert.equal(split.columns[0].groups.filter((g) => g.type === 'pack').length, 1);
        assert.equal(split.columns[0].groups.find((g) => g.type === 'pack')?.cards.length, 1);
        assert.equal(split.columns[2].groups.filter((g) => g.type === 'pack').length, 1);
        assert.equal(split.columns[2].groups.find((g) => g.type === 'pack')?.cards[0]?.name, 'Mockups');

        const splitHtml = renderPlannerWbsHtml(planner, { canEdit: false });
        assert.equal((splitHtml.match(/data-planner-wbs-tree/g) || []).length, 2);

        // Contiguous-only: foreign card between siblings splits the run.
        moveWbsCard(planner, childB, 0, { beforeId: null });
        moveWbsCard(planner, soloId, 0, { beforeId: childB });
        const fragmented = groupWbsColumnCards(planner, layoutPlannerWbs(planner, { mode: 'phase' }).columns[0].cards);
        const packRuns = fragmented.filter((g) => g.type === 'pack');
        assert.ok(packRuns.length >= 1);
        assert.ok(fragmented.some((g) => g.type === 'root' && g.card?.name === 'Solo Root'));
    });

    it('refuses unsupported newer planner version', () => {
        const newer = normalizePlanner({
            version: PLANNER_VERSION + 1,
            sheet: { rows: 3, cols: 6, cells: { '0:0': { v: 'X' } }, colWidths: [90, 72, 108, 108, 44, 80] },
            rowIds: ['a', 'b', 'c'],
            nextRowId: 9
        });
        assert.equal(isPlannerUnsupportedNewer(newer), true);
        assert.equal(movePlannerRow(newer, 0, 1), false);
        assert.equal(togglePlannerWorkPack(newer, 0), false);
    });

    it('gantt summary bar rolls up child dates', () => {
        const planner = createEmptyPlanner();
        setPlannerField(planner.sheet, 0, 'name', 'Parent');
        togglePlannerWorkPack(planner, 0);
        addPlannerPackChild(planner, 0);
        setPlannerField(planner.sheet, 1, 'name', 'Child');
        setPlannerField(planner.sheet, 1, 'start', '2026-03-01');
        setPlannerField(planner.sheet, 1, 'stop', '2026-03-10');
        const tasks = derivePlannerTasks(planner);
        const pack = tasks.find((t) => t.isPack);
        assert.ok(pack);
        assert.equal(pack.start, '2026-03-01');
        assert.equal(pack.stop, '2026-03-10');
        assert.equal(pack.isSummary, true);
        const layout = layoutPlannerGantt(tasks, { zoom: 'week' });
        assert.ok(layout.bars.some((b) => b.isSummary));
    });

    it('section html includes WBS board', () => {
        const item = { id: 'n1', planner: createEmptyPlanner() };
        setPlannerField(item.planner.sheet, 0, 'name', 'T');
        const html = buildNotePlannerSectionHtml(item, { canEdit: true });
        assert.ok(html.includes('data-planner-wbs'));
        assert.ok(html.includes('data-planner-pack-toggle'));
        assert.ok(html.includes('Initiation'));
        assert.ok(!html.includes('Unmapped'));
        assert.equal(item.planner.wbsCardColors && typeof item.planner.wbsCardColors, 'object');
    });
});

function testDaysBetween(a, b) {
    const DAY = 24 * 60 * 60 * 1000;
    const s = new Date(a.getFullYear(), a.getMonth(), a.getDate());
    const e = new Date(b.getFullYear(), b.getMonth(), b.getDate());
    return Math.round((e - s) / DAY);
}
