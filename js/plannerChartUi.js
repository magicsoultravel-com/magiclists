/** @module {"owns":"magicPlanner chart subsection UI — Gantt/calendar board, rail measure, pan, zoom, today line", "related":["plannerUi.js","plannerSheetUi.js","plannerKanbanUi.js","plannerWbsUi.js","planner.js","plannerGantt.js","plannerCalendar.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS } from './icons.js';
import { surfaceThemeInline } from './cardTheme.js';
import { resolveNoteColor } from './colorPicker.js';
import { readDisplayOptions } from './displayOptions.js';
import {
    PLANNER_ZOOM_LEVELS,
    PLANNER_DEFAULT_CHART_VIEW,
    normalizePlannerLabelWidth,
    normalizeTodayLine,
    normalizePlannerChartView,
    derivePlannerTasks
} from './planner.js';
import { layoutPlannerGantt, parsePlannerDateTime } from './plannerGantt.js';
import { renderPlannerCalendarBoardHtml } from './plannerCalendar.js';
import { refreshPlannerSummaryInSection } from './plannerSheetUi.js';

/** Same pattern as checklist: keep #app-canvas from jumping on DOM surgery. */
function captureCanvasScroll() {
    const canvas = document.getElementById('app-canvas');
    return {
        scrollTop: canvas?.scrollTop ?? 0,
        scrollLeft: canvas?.scrollLeft ?? 0
    };
}

function restoreCanvasScroll(scrollPos) {
    const canvas = document.getElementById('app-canvas');
    if (!canvas || !scrollPos) return;
    canvas.scrollTop = scrollPos.scrollTop;
    canvas.scrollLeft = scrollPos.scrollLeft;
}

function bodyCanEdit(body) {
    return !!(body?.querySelector?.('.card-inline-edit, .sheet-cell-input, .planner-cell-input, .expanded-checklist-add-btn'));
}

function plannerSectionCanEdit(section) {
    if (!section) return false;
    if (section.closest?.('.magic-focus__pane')) return true;
    if (section.matches?.('[data-focus-table-only], [data-focus-chart-only], [data-focus-kanban-only], [data-focus-wbs-only]')) return true;
    if (section.querySelector?.('.planner-cell-input, [data-planner-rail-resize], .planner-kanban__card.is-editable, [data-planner-kanban-field], .planner-wbs__card.is-editable, [data-planner-wbs-field]')) {
        return true;
    }
    return bodyCanEdit(section.closest('.editor-note-body') || section);
}

function formatKanbanCardDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
}

/**
 * Read-only Kanban-like HTML for a calendar bar hover preview.
 * @param {object} planner
 * @param {number} row
 * @returns {string}
 */
function buildCalendarTaskPreviewHtml(planner, row) {
    if (!planner || !Number.isFinite(row)) return '';
    const task = derivePlannerTasks(planner).find((t) => t.row === row);
    if (!task) return '';
    const startLabel = formatKanbanCardDate(task.start);
    const stopLabel = formatKanbanCardDate(task.stop);
    const rowLabel = String(task.id || row + 1);
    const startHtml = startLabel
        ? `<span class="planner-kanban__card-date planner-kanban__card-date--start" title="Start ${escapeAttr(startLabel)}">${escapeHTML(startLabel)}</span>`
        : '';
    const stopHtml = stopLabel
        ? `<span class="planner-kanban__card-date planner-kanban__card-date--stop" title="Stop ${escapeAttr(stopLabel)}">${escapeHTML(stopLabel)}</span>`
        : '';
    const comment = String(task.comments || '').trim();
    const commentHtml = comment
        ? `<span class="planner-kanban__card-comment">${escapeHTML(comment)}</span>`
        : '';
    const cardHex = resolveNoteColor(
        planner.kanbanCardColors?.[String(row)] || task.categoryColor || ''
    );
    const surface = surfaceThemeInline(cardHex);
    const colorClass = cardHex ? ` has-color${surface.className}` : '';
    return `<article class="planner-kanban__card planner-calendar__task-preview-card${colorClass}" data-planner-row="${row}"${surface.style}>
        <div class="planner-kanban__card-slot">
            <span class="planner-kanban__card-row" title="Row ${escapeAttr(rowLabel)}">${escapeHTML(rowLabel)}</span>
            ${startHtml}${stopHtml}
            <div class="planner-kanban__card-top">
                <span class="planner-kanban__card-name">${escapeHTML(task.name || 'Untitled')}</span>
            </div>
            ${commentHtml}
        </div>
    </article>`;
}

/**
 * Hover preview for calendar task bars (read-only kanban-like card).
 * @param {HTMLElement} host - [data-planner-gantt] root
 * @param {object} item
 */
function bindCalendarTaskPreview(host, item) {
    const root = host?.querySelector?.('[data-planner-calendar]') || host;
    if (!root || !item?.planner || root.dataset.calendarPreviewBound === '1') return;
    root.dataset.calendarPreviewBound = '1';

    /** @type {HTMLElement|null} */
    let previewEl = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let hideTimer = null;

    const clearHide = () => {
        if (hideTimer) {
            clearTimeout(hideTimer);
            hideTimer = null;
        }
    };

    const removePreview = () => {
        clearHide();
        previewEl?.remove();
        previewEl = null;
    };

    const scheduleHide = () => {
        clearHide();
        hideTimer = setTimeout(removePreview, 140);
    };

    const positionPreview = (bar) => {
        if (!previewEl) return;
        const rect = bar.getBoundingClientRect();
        const pad = 8;
        const pw = previewEl.offsetWidth || 160;
        const ph = previewEl.offsetHeight || 80;
        let left = rect.left;
        let top = rect.bottom + 6;
        left = Math.min(Math.max(pad, left), window.innerWidth - pw - pad);
        if (top + ph > window.innerHeight - pad) {
            top = Math.max(pad, rect.top - ph - 6);
        }
        previewEl.style.left = `${Math.round(left)}px`;
        previewEl.style.top = `${Math.round(top)}px`;
    };

    const showForBar = (bar) => {
        const viewport = bar.closest('[data-planner-calendar-viewport]');
        if (viewport?.classList.contains('is-panning')) return;
        const row = Number(bar.dataset.plannerRow);
        if (!Number.isFinite(row)) return;
        clearHide();
        const inner = buildCalendarTaskPreviewHtml(item.planner, row);
        if (!inner) {
            removePreview();
            return;
        }
        if (!previewEl) {
            previewEl = document.createElement('div');
            previewEl.className = 'planner-calendar__task-preview';
            previewEl.addEventListener('pointerenter', clearHide);
            previewEl.addEventListener('pointerleave', scheduleHide);
            document.body.appendChild(previewEl);
        }
        previewEl.innerHTML = inner;
        positionPreview(bar);
        requestAnimationFrame(() => positionPreview(bar));
    };

    root.addEventListener('pointerover', (e) => {
        const bar = e.target.closest?.('.planner-calendar__bar[data-planner-row]');
        if (!bar || !root.contains(bar)) return;
        showForBar(bar);
    });

    root.addEventListener('pointerout', (e) => {
        const fromBar = e.target.closest?.('.planner-calendar__bar[data-planner-row]');
        if (!fromBar || !root.contains(fromBar)) return;
        const related = /** @type {Node|null} */ (e.relatedTarget);
        if (related && (fromBar.contains(related) || previewEl?.contains(related))) return;
        scheduleHide();
    });
}

const GANTT_RAIL_MIN_ROW_H = 22;
/** @type {HTMLElement|null} */
let _railMeasureEl = null;
/** @type {Map<string, number>} */
const _railHeightCache = new Map();

function getRailMeasureEl() {
    if (typeof document === 'undefined') return null;
    if (_railMeasureEl && document.body.contains(_railMeasureEl)) return _railMeasureEl;
    const el = document.createElement('div');
    el.className = 'planner-gantt__rail-label planner-gantt__rail-label--measure';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
        position: 'absolute',
        left: '-9999px',
        top: '0',
        visibility: 'hidden',
        pointerEvents: 'none',
        height: 'auto',
        maxHeight: 'none',
        overflow: 'visible'
    });
    document.body.appendChild(el);
    _railMeasureEl = el;
    return el;
}

/**
 * DOM-measure tallest wrapped rail label for a given label column width.
 * @param {string[]} names
 * @param {number} labelWidth
 * @returns {number}
 */
export function measureGanttRailRowHeight(names, labelWidth) {
    const w = normalizePlannerLabelWidth(labelWidth);
    const list = (names && names.length) ? names : ['—'];
    const el = getRailMeasureEl();
    if (!el) return GANTT_RAIL_MIN_ROW_H;
    // Match .planner-gantt__rail-row horizontal padding (~0.28rem × 2).
    const contentW = Math.max(20, w - 10);
    el.style.width = `${contentW}px`;
    let maxH = GANTT_RAIL_MIN_ROW_H;
    for (const raw of list) {
        const name = String(raw || '—');
        const key = `${w}\0${name}`;
        const cached = _railHeightCache.get(key);
        if (cached != null) {
            maxH = Math.max(maxH, cached);
            continue;
        }
        el.textContent = name;
        const h = Math.max(GANTT_RAIL_MIN_ROW_H, el.offsetHeight || GANTT_RAIL_MIN_ROW_H);
        _railHeightCache.set(key, h);
        maxH = Math.max(maxH, h);
    }
    return maxH;
}

function invalidateRailHeightCache() {
    _railHeightCache.clear();
}

/**
 * @param {object|null|undefined} todayLine
 * @returns {string} SVG attribute string
 */
function todayLineSvgAttrs(todayLine) {
    const tl = normalizeTodayLine(todayLine ?? readDisplayOptions().plannerTodayLine);
    const dash = tl.style === 'solid'
        ? 'none'
        : tl.style === 'dotted'
            ? '1 2'
            : '3 2';
    return `style="stroke:${escapeAttr(tl.color)};stroke-width:${tl.thickness};stroke-dasharray:${dash}"`;
}

/**
 * Layout opts derived from planner (label width + DOM-measured row height).
 * @param {object} planner
 * @returns {{ zoom: string, labelWidth: number, rowHeight: number }}
 */
function ganttLayoutOpts(planner) {
    const zoom = planner?.zoom || 'week';
    const labelWidth = normalizePlannerLabelWidth(planner?.labelWidth);
    const tasks = derivePlannerTasks(planner);
    const datedNames = [];
    for (const t of tasks) {
        if (!parsePlannerDateTime(t.start)) continue;
        datedNames.push(t.name || t.id || '—');
    }
    const rowHeight = measureGanttRailRowHeight(datedNames, labelWidth);
    return {
        zoom,
        labelWidth,
        rowHeight
    };
}

/**
 * @param {object} layout
 * @returns {string}
 */
function renderGanttSvg(layout) {
    const {
        chartWidth, height, headerHeight, majorBandH = 0, minorBandH = 14,
        majors = [], minors = [], bands = [], ticks, bars, edges, todayX, empty
    } = layout;
    const minorTicks = minors.length ? minors : (ticks || []);
    const majorY = majorBandH > 0 ? majorBandH - 3 : 0;
    const minorY = headerHeight - 4;
    const bodyH = Math.max(0, height - headerHeight);

    const bandEls = (bands || []).map((b) => {
        if (!(b.width > 0)) return '';
        const cls = b.alt ? 'planner-gantt__band planner-gantt__band--alt' : 'planner-gantt__band';
        return `<rect class="${cls}" x="${b.x}" y="${headerHeight}" width="${b.width}" height="${bodyH}"/>`;
    }).join('');

    const majorBandEls = (majors || []).map((m) => {
        if (m.width < 8) return '';
        return `<g class="planner-gantt__major">
            <line class="planner-gantt__tick planner-gantt__tick--major" x1="${m.x}" y1="0" x2="${m.x}" y2="${height}"/>
            <text class="planner-gantt__major-label" x="${m.x + 3}" y="${majorY || 11}">${escapeHTML(m.label)}</text>
            <line class="planner-gantt__major-rule" x1="${m.x}" y1="${majorBandH}" x2="${m.x + m.width}" y2="${majorBandH}"/>
        </g>`;
    }).join('');

    const minorEls = minorTicks.map((t) => {
        const cls = t.major ? 'planner-gantt__tick planner-gantt__tick--emphasis' : 'planner-gantt__tick';
        const labelCls = t.weekend
            ? 'planner-gantt__tick-label planner-gantt__tick-label--weekend'
            : 'planner-gantt__tick-label';
        const label = t.label
            ? `<text class="${labelCls}" x="${t.x + 2}" y="${minorY}">${escapeHTML(t.label)}</text>`
            : '';
        return `<line class="${cls}" x1="${t.x}" y1="${majorBandH}" x2="${t.x}" y2="${height}"/>${label}`;
    }).join('');

    const edgePaths = edges.map((e) => {
        if (!e?.path) return '';
        return `<path class="planner-gantt__edge" d="${escapeAttr(e.path)}" fill="none"/>`;
    }).join('');

    const barEls = bars.map((b) => {
        const title = escapeHTML(b.name || b.id || 'Task');
        const fill = b.categoryColor
            ? ` style="fill:${escapeAttr(b.categoryColor)}"`
            : '';
        let shape;
        if (b.milestone) {
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            const d = `M${cx},${b.y} L${b.x + b.width},${cy} L${cx},${b.y + b.height} L${b.x},${cy} Z`;
            shape = `<path class="planner-gantt__milestone" d="${d}"${fill}/>`;
        } else {
            const barCls = b.isSummary ? 'planner-gantt__bar planner-gantt__bar--summary' : 'planner-gantt__bar';
            shape = `<rect class="${barCls}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2"${fill}/>`;
        }
        return `<g class="planner-gantt__bar-group${b.isSummary ? ' is-summary' : ''}${b.level === 1 ? ' is-child' : ''}" data-task-id="${escapeAttr(b.id)}">
            <title>${title}</title>
            ${shape}
        </g>`;
    }).join('');

    const todayLineEl = todayX != null
        ? `<line class="planner-gantt__today" x1="${todayX}" y1="0" x2="${todayX}" y2="${height}" ${todayLineSvgAttrs()}/>`
        : '';

    const emptyMsg = empty
        ? `<text class="planner-gantt__empty" x="12" y="${headerHeight + 28}">Add Start dates in the table to see bars</text>`
        : '';

    const axisBg = majorBandH > 0
        ? `<rect class="planner-gantt__axis-bg" x="0" y="0" width="${chartWidth}" height="${headerHeight}"/>`
        : '';

    return `<svg class="planner-gantt__svg" width="${chartWidth}" height="${height}" viewBox="0 0 ${chartWidth} ${height}" role="img" aria-label="Planner chart">
        ${axisBg}
        <rect class="planner-gantt__bg" x="0" y="${headerHeight}" width="${chartWidth}" height="${bodyH}"/>
        ${bandEls}
        ${majorBandEls}
        ${minorEls}
        ${edgePaths}
        ${barEls}
        ${todayLineEl}
        ${emptyMsg}
    </svg>`;
}

function renderGanttRailHtml(layout, { canEdit = false } = {}) {
    const { headerHeight, rowHeight, bars, empty } = layout;
    const rows = empty
        ? `<div class="planner-gantt__rail-row" style="height:${rowHeight}px"><span class="planner-gantt__rail-label is-muted">—</span></div>`
        : bars.map((b) => {
            const outline = escapeHTML(b.outlineId || b.id || '');
            const name = escapeHTML(b.name || '—');
            const pad = b.level === 1 ? ' is-child' : (b.isPack || b.isSummary ? ' is-pack' : '');
            return `<div class="planner-gantt__rail-row${pad}" style="height:${rowHeight}px"><span class="planner-gantt__rail-outline">${outline}</span><span class="planner-gantt__rail-label" title="${name}">${name}</span></div>`;
        }).join('');
    const resize = canEdit
        ? '<span class="planner-gantt__rail-resize" data-planner-rail-resize title="Drag to resize"></span>'
        : '';
    return `<div class="planner-gantt__rail" style="width:${layout.labelWidth}px" data-planner-gantt-rail>
        <div class="planner-gantt__rail-head" style="height:${headerHeight}px"></div>
        ${rows}
        ${resize}
    </div>`;
}


/**
 * Focus the viewport on today (if in range) or the midpoint of task bars.
 * When not refocusing, restore prior Gantt scrollLeft/Top.
 * @param {HTMLElement} viewport
 * @param {object} layout
 * @param {{ preserveScrollLeft?: number|null, preserveScrollTop?: number|null, refocus?: boolean }} [opts]
 */
function focusGanttViewport(viewport, layout, {
    preserveScrollLeft = null,
    preserveScrollTop = null,
    refocus = false
} = {}) {
    if (!viewport || !layout) return;
    if (!refocus && preserveScrollLeft != null && Number.isFinite(preserveScrollLeft)) {
        viewport.scrollLeft = Math.max(0, Math.min(preserveScrollLeft, viewport.scrollWidth - viewport.clientWidth));
    } else if (refocus) {
        const viewW = viewport.clientWidth || 0;
        let focusX = layout.todayX;
        if (focusX == null && layout.bars?.length) {
            const minX = Math.min(...layout.bars.map((b) => b.x));
            const maxX = Math.max(...layout.bars.map((b) => b.x + b.width));
            focusX = (minX + maxX) / 2;
        }
        if (focusX == null) focusX = (layout.chartWidth || 0) / 2;
        viewport.scrollLeft = Math.max(0, focusX - viewW / 2);
    }
    if (preserveScrollTop != null && Number.isFinite(preserveScrollTop)) {
        viewport.scrollTop = Math.max(0, Math.min(preserveScrollTop, viewport.scrollHeight - viewport.clientHeight));
    }
}

/**
 * Focus calendar strip on the focus month (usually today), or restore scroll.
 * @param {HTMLElement} viewport
 * @param {object|null} calendarLayout
 * @param {{ preserveScrollLeft?: number|null, refocus?: boolean }} [opts]
 */
function focusCalendarViewport(viewport, calendarLayout, {
    preserveScrollLeft = null,
    refocus = false
} = {}) {
    if (!viewport) return;
    if (!refocus && preserveScrollLeft != null && Number.isFinite(preserveScrollLeft)) {
        viewport.scrollLeft = Math.max(0, Math.min(preserveScrollLeft, viewport.scrollWidth - viewport.clientWidth));
        return;
    }
    if (!refocus) return;
    const months = viewport.querySelectorAll('.planner-calendar__month');
    const idx = calendarLayout?.focusMonthIndex ?? 0;
    const target = months[idx] || months[0];
    if (!target) return;
    viewport.scrollLeft = Math.max(0, target.offsetLeft - 8);
}

/**
 * Drag-to-pan an overflow viewport (Gantt or calendar strip).
 * @param {HTMLElement} viewport
 */
function bindGanttPan(viewport) {
    if (!viewport || viewport.dataset.panBound === '1') return;
    viewport.dataset.panBound = '1';
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;
    let pointerId = null;

    viewport.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        // Drop calendar hover preview when starting a pan.
        document.querySelectorAll('.planner-calendar__task-preview').forEach((el) => el.remove());
        e.stopPropagation();
        dragging = true;
        moved = false;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = viewport.scrollLeft;
        originTop = viewport.scrollTop;
        viewport.classList.add('is-panning');
        try { viewport.setPointerCapture(pointerId); } catch { /* ignore */ }
    });

    viewport.addEventListener('mousedown', (e) => {
        // Keep card/board drag from stealing the pan gesture.
        e.stopPropagation();
    });

    viewport.addEventListener('pointermove', (e) => {
        if (!dragging || (pointerId != null && e.pointerId !== pointerId)) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (!moved && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) moved = true;
        if (!moved) return;
        e.preventDefault();
        viewport.scrollLeft = originLeft - dx;
        viewport.scrollTop = originTop - dy;
    });

    const endPan = (e) => {
        if (!dragging) return;
        if (pointerId != null && e.pointerId !== pointerId) return;
        dragging = false;
        pointerId = null;
        viewport.classList.remove('is-panning');
    };
    viewport.addEventListener('pointerup', endPan);
    viewport.addEventListener('pointercancel', endPan);
}

export function renderPlannerGanttHtml(planner, { canEdit = false } = {}) {
    const opts = ganttLayoutOpts(planner);
    const chartCollapsed = !!planner?.chartCollapsed;
    const chartView = normalizePlannerChartView(planner?.chartView);
    const isCalendar = chartView === 'calendar';
    const tasks = derivePlannerTasks(planner);
    const layout = isCalendar
        ? null
        : layoutPlannerGantt(tasks, {
            zoom: opts.zoom,
            labelWidth: opts.labelWidth,
            rowHeight: opts.rowHeight
        });
    const calendarBoard = isCalendar ? renderPlannerCalendarBoardHtml(planner) : null;
    const zoomIcons = {
        day: CARD_ICONS.zoomDay,
        week: CARD_ICONS.zoomWeek,
        month: CARD_ICONS.zoomMonth,
        quarter: CARD_ICONS.zoomQuarter,
        year: CARD_ICONS.zoomYear
    };
    const zoomBtns = PLANNER_ZOOM_LEVELS.map((z) => {
        const active = !isCalendar && z === opts.zoom ? ' is-active' : '';
        const icon = zoomIcons[z] || '';
        return `<button type="button" class="card-act planner-zoom-btn${active}" data-planner-zoom="${z}" title="${escapeAttr(z)}" aria-label="${escapeAttr(z)}" aria-pressed="${!isCalendar && z === opts.zoom ? 'true' : 'false'}">${icon}</button>`;
    }).join('');
    const calActive = isCalendar ? ' is-active' : '';
    const calBtn = `<button type="button" class="card-act planner-chart-view-btn${calActive}" data-planner-chart-view="calendar" title="Calendar view" aria-label="Calendar view" aria-pressed="${isCalendar ? 'true' : 'false'}">${CARD_ICONS.calendar}</button>`;
    const toggleCollapsed = chartCollapsed ? ' collapsed' : '';
    const boardCollapsed = chartCollapsed ? ' is-collapsed' : '';
    const toolsDimmed = isCalendar ? ' is-calendar-view' : '';

    const boardInner = isCalendar
        ? calendarBoard.html
        : `${renderGanttRailHtml(layout, { canEdit })}
            <div class="planner-gantt__viewport" data-planner-gantt-viewport title="Drag to pan">${renderGanttSvg(layout)}</div>`;

    const html = `<div class="planner-gantt planner-sub" data-planner-gantt data-planner-zoom-current="${escapeAttr(opts.zoom)}" data-planner-chart-view-current="${escapeAttr(chartView)}" data-chart-collapsed="${chartCollapsed ? '1' : '0'}">
        <div class="planner-gantt__toolbar planner-sub__toolbar">
            <button type="button" class="planner-gantt__title planner-sub__title" data-planner-chart-toggle aria-expanded="${chartCollapsed ? 'false' : 'true'}">
                <span class="collapsable-toggle${toggleCollapsed}" aria-hidden="true">▼</span>Chart
            </button>
            <div class="planner-gantt__zoom${toolsDimmed}${chartCollapsed ? ' is-collapsed' : ''}" role="group" aria-label="Chart view"${chartCollapsed ? ' hidden' : ''}>${zoomBtns}${calBtn}</div>
        </div>
        <div class="planner-gantt__board${boardCollapsed}" data-planner-chart-board>
            ${boardInner}
        </div>
    </div>`;
    return { html, layout, calendarLayout: calendarBoard?.layout || null };
}

export function mountGanttViewport(host, layout, {
    preserveScrollLeft = null,
    preserveScrollTop = null,
    refocus = false,
    canvasScroll = null,
    calendarLayout = null,
    item = null
} = {}) {
    const ganttViewport = host?.querySelector?.('[data-planner-gantt-viewport]');
    const calViewport = host?.querySelector?.('[data-planner-calendar-viewport]');
    if (ganttViewport && layout) {
        bindGanttPan(ganttViewport);
        requestAnimationFrame(() => {
            focusGanttViewport(ganttViewport, layout, { preserveScrollLeft, preserveScrollTop, refocus });
            if (canvasScroll) restoreCanvasScroll(canvasScroll);
        });
        return;
    }
    if (calViewport) {
        bindGanttPan(calViewport);
        if (item) bindCalendarTaskPreview(host, item);
        requestAnimationFrame(() => {
            focusCalendarViewport(calViewport, calendarLayout, { preserveScrollLeft, refocus });
            if (canvasScroll) restoreCanvasScroll(canvasScroll);
        });
    }
}

export function refreshGanttInSection(section, item, { refocus = false } = {}) {
    if (!section || !item?.planner) return;
    const host = section.querySelector('[data-planner-gantt]');
    if (host) {
        const canvasScroll = captureCanvasScroll();
        const prevZoom = host.dataset.plannerZoomCurrent || '';
        const prevView = host.dataset.plannerChartViewCurrent || PLANNER_DEFAULT_CHART_VIEW;
        const prevGanttViewport = host.querySelector('[data-planner-gantt-viewport]');
        const prevCalViewport = host.querySelector('[data-planner-calendar-viewport]');
        const prevViewport = prevGanttViewport || prevCalViewport;
        const preserveScrollLeft = prevViewport ? prevViewport.scrollLeft : null;
        const preserveScrollTop = prevGanttViewport ? prevGanttViewport.scrollTop : null;
        const { html, layout, calendarLayout } = renderPlannerGanttHtml(item.planner, {
            canEdit: plannerSectionCanEdit(section)
        });
        const tmp = document.createElement('div');
        tmp.innerHTML = html.trim();
        const next = tmp.firstElementChild;
        if (next) {
            host.replaceWith(next);
            const nextView = next.dataset.plannerChartViewCurrent || PLANNER_DEFAULT_CHART_VIEW;
            const zoomChanged = (layout?.zoom || '') !== prevZoom;
            const viewChanged = nextView !== prevView;
            mountGanttViewport(next, layout, {
                preserveScrollLeft,
                preserveScrollTop,
                refocus: refocus || zoomChanged || viewChanged,
                canvasScroll,
                calendarLayout,
                item
            });
        }
        restoreCanvasScroll(canvasScroll);
    }
    // Summary lives under the table host — refresh even when this section has no gantt
    // (Focus splits table/chart into separate [data-note-planner] panes).
    refreshPlannerSummaryInSection(section, item);
}

export { ganttLayoutOpts, captureCanvasScroll, restoreCanvasScroll };

/**
 * Chart click handler (toggle, chart-view, zoom).
 * Click selectors verified exclusive across sheet/chart/kanban/wbs; dispatch order free.
 * @param {object} ctx
 * @param {Event} e
 * @returns {boolean}
 */
export function handleChartClick(ctx, e) {
    const { section, item, mutate } = ctx;

    const chartToggle = e.target.closest('[data-planner-chart-toggle]');
    if (chartToggle && section.contains(chartToggle)) {
        e.preventDefault();
        e.stopPropagation();
        const wasCollapsed = !!item.planner?.chartCollapsed;
        mutate((it) => {
            it.planner.chartCollapsed = !it.planner.chartCollapsed;
        }, { skipRerender: true, refreshGantt: true });
        if (wasCollapsed) {
            const host = section.querySelector('[data-planner-gantt]');
            if (host) {
                const canvasScroll = captureCanvasScroll();
                const chartView = normalizePlannerChartView(item.planner?.chartView);
                if (chartView === 'calendar') {
                    const { layout: calendarLayout } = renderPlannerCalendarBoardHtml(item.planner);
                    mountGanttViewport(host, null, { refocus: true, canvasScroll, calendarLayout, item });
                } else {
                    const layoutOpts = ganttLayoutOpts(item.planner);
                    const layout = layoutPlannerGantt(
                        derivePlannerTasks(item.planner),
                        {
                            zoom: layoutOpts.zoom,
                            labelWidth: layoutOpts.labelWidth,
                            rowHeight: layoutOpts.rowHeight
                        }
                    );
                    mountGanttViewport(host, layout, { refocus: true, canvasScroll, item });
                }
                restoreCanvasScroll(canvasScroll);
            }
        }
        return true;
    }

    const chartViewBtn = e.target.closest('button[data-planner-chart-view]');
    if (chartViewBtn && section.contains(chartViewBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const nextView = String(chartViewBtn.dataset.plannerChartView || '').toLowerCase();
        if (nextView !== 'calendar') return true;
        if (normalizePlannerChartView(item.planner?.chartView) === 'calendar') return true;
        mutate((it) => {
            it.planner.chartView = 'calendar';
        }, { refreshGantt: true });
        return true;
    }

    const zoomBtn = e.target.closest('[data-planner-zoom]');
    if (zoomBtn && section.contains(zoomBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const zoom = zoomBtn.dataset.plannerZoom;
        mutate((it) => {
            it.planner.zoom = zoom;
            it.planner.chartView = 'gantt';
        }, { refreshGantt: true });
        return true;
    }

    return false;
}

/**
 * Rail resize mousedown binding.
 * @param {object} ctx
 */
export function bindChart(ctx) {
    const { section, item, mutate } = ctx;
    let railResizing = false;
    let resizeStartX = 0;
    let resizeStartW = 0;
    section.addEventListener('mousedown', (e) => {
        const railHandle = e.target.closest('[data-planner-rail-resize]');
        if (!railHandle || !section.contains(railHandle)) return;
        e.preventDefault();
        e.stopPropagation();
        railResizing = true;
        resizeStartX = e.clientX;
        resizeStartW = normalizePlannerLabelWidth(item.planner?.labelWidth);
        const onMove = (ev) => {
            if (!railResizing) return;
            const next = normalizePlannerLabelWidth(resizeStartW + (ev.clientX - resizeStartX));
            const rail = section.querySelector('[data-planner-gantt-rail]');
            if (rail) rail.style.width = `${next}px`;
            if (item.planner) item.planner.labelWidth = next;
        };
        const onUp = () => {
            railResizing = false;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            invalidateRailHeightCache();
            mutate((it) => {
                it.planner.labelWidth = normalizePlannerLabelWidth(it.planner.labelWidth);
            }, { refreshGantt: true });
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}
