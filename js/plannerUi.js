/** @module {"owns":"magicPlanner note subsection UI — typed sheet + Gantt", "related":["planner.js","plannerGantt.js","noteSurfaceMutations.js","noteQuickActions.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { parseStoredDateTime, combineDateTime } from './noteModel.js';
import { mutateItem, emitItemMutation } from './noteSurfaceMutations.js';
import {
    PLANNER_COLUMNS,
    PLANNER_COL_COUNT,
    PLANNER_ZOOM_LEVELS,
    PLANNER_ZOOM_LABELS,
    createEmptyPlanner,
    normalizePlanner,
    addPlannerRow,
    removePlannerRow,
    movePlannerRow,
    derivePlannerTasks,
    summarizePlannerSchedule,
    listPlannerCategories,
    getCategoryColor,
    setCategoryColor,
    getCellValue,
    setCellValue,
    getPlannerField,
    getColWidth,
    setColWidth,
    sheetGridTotalWidthPx,
    ensurePlannerColWidths,
    SHEET_MIN_ROWS,
    SHEET_ROW_HEAD_WIDTH_PX,
    plannerHasContent
} from './planner.js';
import { layoutPlannerGantt } from './plannerGantt.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor } from './colorPicker.js';

function noteBodiesForItem(itemId) {
    if (!itemId) return [];
    const out = [];
    document.querySelectorAll(`.mini-card[data-id="${CSS.escape(itemId)}"] .editor-note-body`).forEach((el) => out.push(el));
    const modalBody = document.getElementById('editor-note-body');
    const modal = document.getElementById('editor-overlay');
    if (modalBody && modal && !modal.classList.contains('is-hidden') && !out.includes(modalBody)) {
        out.push(modalBody);
    }
    return out;
}

function bodyCanEdit(body) {
    return !!(body?.querySelector?.('.card-inline-edit, .sheet-cell-input, .planner-cell-input, .expanded-checklist-add-btn'));
}

function renderStructActions({ canRemove }) {
    const disabled = canRemove ? '' : ' disabled';
    return `<span class="sheet-struct-actions">
            <button type="button" class="card-act planner-add-row-btn" title="Add row" aria-label="Add row">${ACTION_ICONS.plus}</button>
            <button type="button" class="card-act planner-remove-row-btn" title="Remove last row" aria-label="Remove last row"${disabled}>${ACTION_ICONS.minus}</button>
        </span>`;
}

function formatPlannerDatetimeLabel(value) {
    const parts = parseStoredDateTime(value);
    if (!parts.date) return '';
    return parts.time ? `${parts.date} ${parts.time}` : parts.date;
}

function renderDatetimeCell(value, row, col, canEdit, { minDate = '' } = {}) {
    const parts = parseStoredDateTime(value);
    const label = formatPlannerDatetimeLabel(value);
    const display = label || '—';
    if (!canEdit) {
        return `<td class="sheet-grid__cell planner-cell planner-cell--datetime"><span class="sheet-cell-read">${escapeHTML(label)}</span></td>`;
    }
    const minAttr = minDate ? ` min="${escapeAttr(minDate)}"` : '';
    return `<td class="sheet-grid__cell planner-cell planner-cell--datetime">
        <div class="planner-datetime" data-planner-datetime data-row="${row}" data-col="${col}">
            <span class="planner-datetime__value${label ? '' : ' is-empty'}" data-planner-datetime-value>${escapeHTML(display)}</span>
            <button type="button" class="card-act planner-datetime__pick" data-planner-pick="date" title="Set date" aria-label="Set date">${CARD_ICONS.calendar}</button>
            <button type="button" class="card-act planner-datetime__pick" data-planner-pick="time" title="Set time" aria-label="Set time">${CARD_ICONS.clock}</button>
            <input type="date" class="planner-datetime__native" data-planner-date tabindex="-1" value="${escapeAttr(parts.date || '')}"${minAttr} aria-hidden="true">
            <input type="time" class="planner-datetime__native" data-planner-time tabindex="-1" value="${escapeAttr(parts.time || '')}" step="60" aria-hidden="true">
        </div>
    </td>`;
}

function renderTextCell(value, row, col, canEdit, { key = '' } = {}) {
    if (!canEdit) {
        return `<td class="sheet-grid__cell planner-cell"><span class="sheet-cell-read">${escapeHTML(value)}</span></td>`;
    }
    return `<td class="sheet-grid__cell planner-cell">
        <textarea class="sheet-cell-input form-input planner-cell-input" data-planner-cell data-row="${row}" data-col="${col}" data-col-key="${escapeAttr(key)}" rows="1" spellcheck="false">${escapeHTML(value)}</textarea>
    </td>`;
}

function renderCategoryCell(value, row, col, canEdit, planner, datalistId) {
    const color = getCategoryColor(planner, value) || '';
    const swatchStyle = color ? ` style="background:${escapeAttr(color)}"` : '';
    if (!canEdit) {
        return `<td class="sheet-grid__cell planner-cell planner-cell--category">
            <div class="planner-category">
                <span class="planner-category__swatch"${swatchStyle} aria-hidden="true"></span>
                <span class="sheet-cell-read">${escapeHTML(value)}</span>
            </div>
        </td>`;
    }
    const listAttr = datalistId ? ` list="${escapeAttr(datalistId)}"` : '';
    return `<td class="sheet-grid__cell planner-cell planner-cell--category">
        <div class="planner-category" data-planner-category data-row="${row}" data-col="${col}">
            <button type="button" class="planner-category__swatch-btn" data-planner-category-color title="Category color" aria-label="Category color"${swatchStyle}></button>
            <input type="text" class="form-input sheet-cell-input planner-cell-input planner-category__input" data-planner-cell data-row="${row}" data-col="${col}" data-col-key="category" value="${escapeAttr(value)}" spellcheck="false"${listAttr}>
        </div>
    </td>`;
}

/**
 * @param {object} planner
 * @param {{ canEdit?: boolean }} [opts]
 * @returns {string}
 */
export function renderPlannerSheetHtml(planner, { canEdit = false } = {}) {
    const sheet = planner?.sheet;
    if (!sheet) return '';
    ensurePlannerColWidths(sheet);
    const rows = sheet.rows || SHEET_MIN_ROWS;
    const canRemoveRow = rows > SHEET_MIN_ROWS;
    const totalW = sheetGridTotalWidthPx(sheet, { includeStructCol: false });
    const datalistId = `planner-cat-list-${Math.random().toString(36).slice(2, 9)}`;
    const categories = listPlannerCategories(planner);
    const datalist = canEdit
        ? `<datalist id="${escapeAttr(datalistId)}">${categories.map((c) => `<option value="${escapeAttr(c)}"></option>`).join('')}</datalist>`
        : '';

    let colgroup = `<col class="sheet-grid__row-head-col" style="width:${Math.max(SHEET_ROW_HEAD_WIDTH_PX, 22)}px">`;
    for (let c = 0; c < PLANNER_COL_COUNT; c++) {
        colgroup += `<col data-col="${c}" style="width:${getColWidth(sheet, c)}px">`;
    }

    let colHead = '<th class="sheet-grid__corner" scope="col"></th>';
    for (let c = 0; c < PLANNER_COL_COUNT; c++) {
        const label = PLANNER_COLUMNS[c].label;
        if (canEdit) {
            colHead += `<th class="sheet-grid__col-head" scope="col" data-col="${c}"><span class="sheet-col-head__label">${escapeHTML(label)}</span><span class="sheet-col-resize" data-col="${c}" title="Drag to resize"></span></th>`;
        } else {
            colHead += `<th class="sheet-grid__col-head" scope="col">${escapeHTML(label)}</th>`;
        }
    }

    let body = '';
    for (let r = 0; r < rows; r++) {
        const rowHead = canEdit
            ? `<th class="sheet-grid__row-head planner-row-head" scope="row" draggable="true" data-planner-row="${r}" title="Drag to reorder">${r + 1}</th>`
            : `<th class="sheet-grid__row-head" scope="row">${r + 1}</th>`;
        body += `<tr data-planner-row-index="${r}">${rowHead}`;
        const rowStartDate = parseStoredDateTime(getPlannerField(sheet, r, 'start')).date || '';
        for (let c = 0; c < PLANNER_COL_COUNT; c++) {
            const colDef = PLANNER_COLUMNS[c];
            const value = getCellValue(sheet, r, c);
            if (colDef.type === 'datetime') {
                // Stop is constrained by this row's Start only (not project-wide earliest).
                const minDate = colDef.key === 'stop' ? rowStartDate : '';
                body += renderDatetimeCell(value, r, c, canEdit, { minDate });
            } else if (colDef.type === 'category') {
                body += renderCategoryCell(value, r, c, canEdit, planner, datalistId);
            } else {
                body += renderTextCell(value, r, c, canEdit, { key: colDef.key });
            }
        }
        body += '</tr>';
    }
    if (canEdit) {
        body += `<tr class="planner-grid__actions-row"><th class="sheet-grid__row-head" scope="row"></th>`;
        body += `<td class="planner-grid__actions" colspan="${PLANNER_COL_COUNT}">${renderStructActions({ canRemove: canRemoveRow })}</td></tr>`;
    }

    return `<div class="sheet-block planner-sheet-block" data-planner-sheet-block>
        ${datalist}
        <div class="sheet-grid-wrap">
            <table class="sheet-grid planner-grid" style="width:${totalW}px">
                <colgroup>${colgroup}</colgroup>
                <thead><tr>${colHead}</tr></thead>
                <tbody>${body}</tbody>
            </table>
        </div>
    </div>`;
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
        return `<g class="planner-gantt__bar-group" data-task-id="${escapeAttr(b.id)}">
            <title>${title}</title>
            <rect class="planner-gantt__bar" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2"${fill}/>
        </g>`;
    }).join('');

    const todayLine = todayX != null
        ? `<line class="planner-gantt__today" x1="${todayX}" y1="0" x2="${todayX}" y2="${height}"/>`
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
        ${todayLine}
        ${emptyMsg}
    </svg>`;
}

function renderGanttRailHtml(layout) {
    const { headerHeight, rowHeight, bars, empty } = layout;
    const rows = empty
        ? `<div class="planner-gantt__rail-row" style="height:${rowHeight}px"><span class="planner-gantt__rail-label is-muted">—</span></div>`
        : bars.map((b) => {
            const label = escapeHTML(b.name || b.id || '—');
            return `<div class="planner-gantt__rail-row" style="height:${rowHeight}px"><span class="planner-gantt__rail-label" title="${label}">${label}</span></div>`;
        }).join('');
    return `<div class="planner-gantt__rail" style="width:${layout.labelWidth}px">
        <div class="planner-gantt__rail-head" style="height:${headerHeight}px"></div>
        ${rows}
    </div>`;
}

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
 * Drag-to-pan the Gantt timeline (no visible scrollbar / no arrow chrome).
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

/**
 * One-line schedule span under the table: earliest Start, latest Stop, durations.
 * @param {object} planner
 * @returns {string}
 */
export function renderPlannerSummaryHtml(planner) {
    const summary = summarizePlannerSchedule(planner);
    if (!summary) {
        return `<div class="planner-summary" data-planner-summary>
            <span class="planner-summary__muted">Add Start / Stop dates to see schedule span</span>
        </div>`;
    }
    const start = summary.startLabel || '—';
    const stop = summary.stopLabel || '—';
    const duration = (summary.calendarDays != null && summary.workingDays != null)
        ? `${summary.calendarDays} cd / ${summary.workingDays} wd`
        : '—';
    return `<div class="planner-summary" data-planner-summary>
        <span class="planner-summary__part"><span class="planner-summary__label">Start</span> ${escapeHTML(start)}</span>
        <span class="planner-summary__sep" aria-hidden="true">·</span>
        <span class="planner-summary__part"><span class="planner-summary__label">Stop</span> ${escapeHTML(stop)}</span>
        <span class="planner-summary__sep" aria-hidden="true">·</span>
        <span class="planner-summary__part"><span class="planner-summary__label">Duration</span> ${escapeHTML(duration)}</span>
    </div>`;
}

/**
 * Table subsection: schedule sheet + one-line span stats.
 * @param {object} planner
 * @param {{ canEdit?: boolean }} [opts]
 * @returns {string}
 */
export function renderPlannerTableHtml(planner, { canEdit = false } = {}) {
    const tableCollapsed = !!planner?.tableCollapsed;
    const toggleCollapsed = tableCollapsed ? ' collapsed' : '';
    const bodyCollapsed = tableCollapsed ? ' is-collapsed' : '';
    const sheetHtml = renderPlannerSheetHtml(planner, { canEdit });
    const summaryHtml = renderPlannerSummaryHtml(planner);
    return `<div class="planner-sub" data-planner-table data-table-collapsed="${tableCollapsed ? '1' : '0'}">
        <div class="planner-sub__toolbar">
            <button type="button" class="planner-sub__title" data-planner-table-toggle aria-expanded="${tableCollapsed ? 'false' : 'true'}">
                <span class="collapsable-toggle${toggleCollapsed}" aria-hidden="true">▼</span>Table
            </button>
        </div>
        <div class="planner-sub__body${bodyCollapsed}" data-planner-table-body>
            ${sheetHtml}
            ${summaryHtml}
        </div>
    </div>`;
}

/**
 * @param {object} planner
 * @returns {{ html: string, layout: object }}
 */
export function renderPlannerGanttHtml(planner) {
    const zoom = planner?.zoom || 'week';
    const chartCollapsed = !!planner?.chartCollapsed;
    const tasks = derivePlannerTasks(planner);
    const layout = layoutPlannerGantt(tasks, { zoom });
    const zoomBtns = PLANNER_ZOOM_LEVELS.map((z) => {
        const active = z === zoom ? ' is-active' : '';
        const label = PLANNER_ZOOM_LABELS[z] || z.charAt(0).toUpperCase();
        return `<button type="button" class="btn btn--compact planner-zoom-btn${active}" data-planner-zoom="${z}" title="${escapeAttr(z)}" aria-label="${escapeAttr(z)}" aria-pressed="${z === zoom ? 'true' : 'false'}">${label}</button>`;
    }).join('');
    const toggleCollapsed = chartCollapsed ? ' collapsed' : '';
    const boardCollapsed = chartCollapsed ? ' is-collapsed' : '';

    const html = `<div class="planner-gantt planner-sub" data-planner-gantt data-planner-zoom-current="${escapeAttr(zoom)}" data-chart-collapsed="${chartCollapsed ? '1' : '0'}">
        <div class="planner-gantt__toolbar planner-sub__toolbar">
            <button type="button" class="planner-gantt__title planner-sub__title" data-planner-chart-toggle aria-expanded="${chartCollapsed ? 'false' : 'true'}">
                <span class="collapsable-toggle${toggleCollapsed}" aria-hidden="true">▼</span>Chart
            </button>
            <div class="planner-gantt__zoom${chartCollapsed ? ' is-collapsed' : ''}" role="group" aria-label="Chart zoom"${chartCollapsed ? ' hidden' : ''}>${zoomBtns}</div>
        </div>
        <div class="planner-gantt__board${boardCollapsed}" data-planner-chart-board>
            ${renderGanttRailHtml(layout)}
            <div class="planner-gantt__viewport" data-planner-gantt-viewport title="Drag to pan">${renderGanttSvg(layout)}</div>
        </div>
    </div>`;
    return { html, layout };
}

/**
 * Build the full Planner note subsection HTML.
 * @param {object} item
 * @param {{ canEdit?: boolean, startCollapsed?: boolean }} [opts]
 * @returns {string}
 */
export function buildNotePlannerSectionHtml(item, { canEdit = false, startCollapsed = false } = {}) {
    if (!item?.planner) return '';
    // Sticky hide: keep data, emit no DOM (no blank spacer).
    if (item.plannerHidden) return '';

    const planner = normalizePlanner(item.planner) || item.planner;
    item.planner = planner;
    const collapsedClass = startCollapsed ? ' collapsed' : '';
    const toggleCollapsed = startCollapsed ? ' collapsed' : '';
    const tableHtml = renderPlannerTableHtml(planner, { canEdit });
    const { html: ganttHtml } = renderPlannerGanttHtml(planner);

    return `
            <div class="note-body-section note-body-section--planner" data-note-planner>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>Plan</span>
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    ${tableHtml}
                    ${ganttHtml}
                </div>
            </div>`;
}

function bindPlannerSectionToggle(section) {
    const header = section?.querySelector('.note-section-header');
    if (!header || header.dataset.plannerToggleBound === '1') return;
    header.dataset.plannerToggleBound = '1';
    header.addEventListener('click', (e) => {
        e.stopPropagation();
        const body = header.nextElementSibling;
        const toggle = header.querySelector('.collapsable-toggle');
        body?.classList.toggle('collapsed');
        toggle?.classList.toggle('collapsed');
    });
}

/**
 * Sync planner datetime/text inputs from DOM into item.planner.sheet.
 * @param {HTMLElement} section
 * @param {object} item
 */
export function syncPlannerFromDom(section, item) {
    if (!section || !item?.planner?.sheet) return;
    const sheet = item.planner.sheet;

    section.querySelectorAll('[data-planner-datetime]').forEach((wrap) => {
        const row = Number(wrap.dataset.row);
        const col = Number(wrap.dataset.col);
        if (!Number.isFinite(row) || !Number.isFinite(col)) return;
        const date = wrap.querySelector('[data-planner-date]')?.value || '';
        const time = wrap.querySelector('[data-planner-time]')?.value || '';
        setCellValue(sheet, row, col, combineDateTime(date, time));
    });

    section.querySelectorAll('[data-planner-cell]').forEach((el) => {
        const row = Number(el.dataset.row);
        const col = Number(el.dataset.col);
        if (!Number.isFinite(row) || !Number.isFinite(col)) return;
        setCellValue(sheet, row, col, el.value);
    });
}

function mountGanttViewport(host, layout, {
    preserveScrollLeft = null,
    preserveScrollTop = null,
    refocus = false,
    canvasScroll = null
} = {}) {
    const viewport = host?.querySelector?.('[data-planner-gantt-viewport]');
    if (!viewport) return;
    bindGanttPan(viewport);
    requestAnimationFrame(() => {
        focusGanttViewport(viewport, layout, { preserveScrollLeft, preserveScrollTop, refocus });
        // Re-assert board scroll after rAF layout (Gantt focus can yank anchoring).
        if (canvasScroll) restoreCanvasScroll(canvasScroll);
    });
}

function refreshGanttInSection(section, item, { refocus = false } = {}) {
    const host = section?.querySelector('[data-planner-gantt]');
    if (!host || !item?.planner) return;
    const canvasScroll = captureCanvasScroll();
    const prevZoom = host.dataset.plannerZoomCurrent || '';
    const prevViewport = host.querySelector('[data-planner-gantt-viewport]');
    const preserveScrollLeft = prevViewport ? prevViewport.scrollLeft : null;
    const preserveScrollTop = prevViewport ? prevViewport.scrollTop : null;
    const { html, layout } = renderPlannerGanttHtml(item.planner);
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const next = tmp.firstElementChild;
    if (!next) return;
    host.replaceWith(next);
    const zoomChanged = (layout.zoom || '') !== prevZoom;
    mountGanttViewport(next, layout, {
        preserveScrollLeft,
        preserveScrollTop,
        refocus: refocus || zoomChanged,
        canvasScroll
    });
    refreshPlannerSummaryInSection(section, item);
    restoreCanvasScroll(canvasScroll);
}

function refreshPlannerSummaryInSection(section, item) {
    const host = section?.querySelector('[data-planner-summary]');
    if (!host || !item?.planner) return;
    const canvasScroll = captureCanvasScroll();
    const tmp = document.createElement('div');
    tmp.innerHTML = renderPlannerSummaryHtml(item.planner).trim();
    const next = tmp.firstElementChild;
    if (next) host.replaceWith(next);
    restoreCanvasScroll(canvasScroll);
}

function growPlannerTextareas(section) {
    const canvasScroll = captureCanvasScroll();
    section?.querySelectorAll('.planner-cell-input').forEach((el) => {
        growPlannerCell(el);
    });
    restoreCanvasScroll(canvasScroll);
}

/** Auto-size a single planner cell — cheap enough for per-keystroke use. */
function growPlannerCell(el) {
    if (!el || !el.style) return;
    el.style.height = '0';
    el.style.height = `${Math.max(el.scrollHeight, 18)}px`;
}

const PLANNER_COMMIT_MS = 380;
const PLANNER_START_COL = PLANNER_COLUMNS.findIndex((c) => c.key === 'start');
const PLANNER_STOP_COL = PLANNER_COLUMNS.findIndex((c) => c.key === 'stop');

function todayLocalDate() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function updateDatetimeValueDisplay(wrap) {
    if (!wrap) return;
    const date = wrap.querySelector('[data-planner-date]')?.value || '';
    const time = wrap.querySelector('[data-planner-time]')?.value || '';
    const label = date ? (time ? `${date} ${time}` : date) : '';
    const valueEl = wrap.querySelector('[data-planner-datetime-value]');
    if (!valueEl) return;
    valueEl.textContent = label || '—';
    valueEl.classList.toggle('is-empty', !label);
}

/**
 * Same-row Start date (YYYY-MM-DD) — drives Stop min / seeding only.
 * Not the project-wide earliest Start from the summary line.
 * @param {HTMLElement} section
 * @param {number} row
 * @returns {string}
 */
function rowStartDate(section, row) {
    if (!Number.isFinite(row) || PLANNER_START_COL < 0) return '';
    const startWrap = section.querySelector(
        `[data-planner-datetime][data-row="${row}"][data-col="${PLANNER_START_COL}"]`
    );
    return startWrap?.querySelector?.('[data-planner-date]')?.value || '';
}

/**
 * Keep Stop's native date `min` (and value) aligned to this row's Start.
 * @param {HTMLElement} section
 * @param {number} row
 * @param {{ clampValue?: boolean }} [opts]
 * @returns {HTMLElement|null} stop wrap if value was clamped
 */
function syncStopMinFromRowStart(section, row, { clampValue = true } = {}) {
    if (!Number.isFinite(row) || PLANNER_STOP_COL < 0) return null;
    const stopWrap = section.querySelector(
        `[data-planner-datetime][data-row="${row}"][data-col="${PLANNER_STOP_COL}"]`
    );
    const stopDate = stopWrap?.querySelector?.('[data-planner-date]');
    if (!stopDate) return null;
    const start = rowStartDate(section, row);
    if (start) stopDate.min = start;
    else stopDate.removeAttribute('min');
    if (clampValue && start && stopDate.value && stopDate.value < start) {
        stopDate.value = start;
        updateDatetimeValueDisplay(stopWrap);
        return stopWrap;
    }
    return null;
}

function openPlannerNativePicker(input) {
    if (!input) return;
    try {
        if (typeof input.showPicker === 'function') {
            input.showPicker();
            return;
        }
    } catch {
        // fall through to click
    }
    input.click();
}

/**
 * Attach planner sheet + gantt interactions inside a note body.
 * @param {HTMLElement} root - note body or shell
 * @param {object} item
 * @param {{ localOnly?: boolean, onChange?: Function, refresh?: Function }} [opts]
 */
export function attachPlannerInteractions(root, item, {
    localOnly = false,
    onChange = () => {},
    refresh = () => {},
    refocusGantt = undefined,
    preserveGanttScroll = null
} = {}) {
    const section = root?.querySelector?.('[data-note-planner]') || root?.closest?.('[data-note-planner]');
    if (!section || !item?.planner) return;

    bindPlannerSectionToggle(section);

    const alreadyBound = section.dataset.plannerBound === '1';
    // Height thrash (0 → auto) only on first bind — rebind must not yank board scroll.
    if (!alreadyBound) growPlannerTextareas(section);

    if (alreadyBound) return;
    section.dataset.plannerBound = '1';

    // First bind: pan wiring. Re-center only when explicitly requested or never focused.
    const ganttHost = section.querySelector('[data-planner-gantt]');
    if (ganttHost && item.planner) {
        const layout = layoutPlannerGantt(derivePlannerTasks(item.planner), { zoom: item.planner.zoom || 'week' });
        const shouldRefocus = refocusGantt != null
            ? !!refocusGantt
            : section.dataset.plannerFocused !== '1';
        const canvasScroll = captureCanvasScroll();
        mountGanttViewport(ganttHost, layout, {
            refocus: shouldRefocus,
            preserveScrollLeft: preserveGanttScroll?.left ?? null,
            preserveScrollTop: preserveGanttScroll?.top ?? null,
            canvasScroll
        });
        section.dataset.plannerFocused = '1';
        restoreCanvasScroll(canvasScroll);
    }

    // Debounced persist + Gantt: patch sheet on every keystroke, emit/refresh once.
    let commitTimer = null;
    let pendingBefore = null;
    let pendingNeedGantt = false;

    const flushPlannerCommit = () => {
        if (commitTimer) {
            clearTimeout(commitTimer);
            commitTimer = null;
        }
        if (!pendingBefore) return;
        const beforeItem = pendingBefore;
        pendingBefore = null;
        const needGantt = pendingNeedGantt;
        pendingNeedGantt = false;
        if (!localOnly) {
            emitItemMutation(item, {
                preserveView: true,
                beforeItem,
                skipRerender: true
            });
        }
        if (needGantt) refreshGanttInSection(section, item);
        onChange();
    };

    const schedulePlannerCommit = ({ refreshGantt = true } = {}) => {
        if (!pendingBefore) {
            pendingBefore = JSON.parse(JSON.stringify(item));
        }
        if (refreshGantt) pendingNeedGantt = true;
        if (commitTimer) clearTimeout(commitTimer);
        commitTimer = setTimeout(flushPlannerCommit, PLANNER_COMMIT_MS);
    };

    const mutate = (fn, { skipRerender = true, refreshGantt = true } = {}) => {
        // Persist any in-flight text edits before structural / date mutations.
        flushPlannerCommit();
        mutateItem(item, (it) => {
            if (!it.planner) it.planner = createEmptyPlanner();
            fn(it);
        }, { preserveView: true, skipRerender, localOnly });
        if (refreshGantt) refreshGanttInSection(section, item);
        onChange();
    };

    const commitDatetimeWrap = (wrap) => {
        if (!wrap) return;
        const row = Number(wrap.dataset.row);
        const col = Number(wrap.dataset.col);
        if (!Number.isFinite(row) || !Number.isFinite(col)) return;
        const date = wrap.querySelector('[data-planner-date]')?.value || '';
        const time = wrap.querySelector('[data-planner-time]')?.value || '';
        updateDatetimeValueDisplay(wrap);
        mutate((it) => {
            setCellValue(it.planner.sheet, row, col, combineDateTime(date, time));
        });
        // After Start changes, Stop for this row cannot be earlier than Start.
        if (col === PLANNER_START_COL) {
            const clampedStop = syncStopMinFromRowStart(section, row, { clampValue: true });
            if (clampedStop) commitDatetimeWrap(clampedStop);
        }
    };

    section.addEventListener('input', (e) => {
        const cell = e.target.closest('[data-planner-cell]');
        if (cell) {
            const row = Number(cell.dataset.row);
            const col = Number(cell.dataset.col);
            if (!Number.isFinite(row) || !Number.isFinite(col)) return;
            const key = cell.dataset.colKey || '';
            // Snapshot before first patch in this debounce window, then cheap in-place write.
            schedulePlannerCommit({ refreshGantt: true });
            if (!item.planner) item.planner = createEmptyPlanner();
            setCellValue(item.planner.sheet, row, col, cell.value);
            if (key === 'category') {
                const known = getCategoryColor(item.planner, cell.value);
                const wrap = cell.closest('[data-planner-category]');
                const swatch = wrap?.querySelector?.('[data-planner-category-color]');
                if (swatch) swatch.style.background = known || '';
            }
            growPlannerCell(cell);
            return;
        }
        // Date/time: ignore input — picker fires change; avoid per-keystroke Gantt + double emit.
    });

    section.addEventListener('change', (e) => {
        if (e.target.matches('[data-planner-date], [data-planner-time]')) {
            const wrap = e.target.closest('[data-planner-datetime]');
            commitDatetimeWrap(wrap);
        }
    });

    // Flush pending text persist + chart when leaving a planner cell / datetime control.
    section.addEventListener('focusout', (e) => {
        const leaving = e.target.closest('[data-planner-cell], [data-planner-datetime]');
        if (!leaving || !section.contains(leaving)) return;
        flushPlannerCommit();
    });

    section.addEventListener('click', (e) => {
        const colorBtn = e.target.closest('[data-planner-category-color]');
        if (colorBtn && section.contains(colorBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const wrap = colorBtn.closest('[data-planner-category]');
            const row = Number(wrap?.dataset?.row);
            const nameInput = wrap?.querySelector?.('[data-col-key="category"]');
            const catName = (nameInput?.value || '').trim();
            if (!Number.isFinite(row)) return;
            ColorPicker.open({
                anchor: colorBtn,
                presets: PALETTE_NOTE,
                value: resolveNoteColor(getCategoryColor(item.planner, catName) || colorBtn.style.background),
                onSelect: (color) => {
                    const hex = resolveNoteColor(color);
                    const name = catName || `Category ${row + 1}`;
                    mutate((it) => {
                        if (nameInput && !nameInput.value.trim()) nameInput.value = name;
                        setCellValue(it.planner.sheet, row, 1, name);
                        setCategoryColor(it.planner, name, hex);
                    }, { refreshGantt: true });
                    refresh();
                }
            });
            return;
        }

        const pickBtn = e.target.closest('[data-planner-pick]');
        if (pickBtn && section.contains(pickBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const wrap = pickBtn.closest('[data-planner-datetime]');
            if (!wrap) return;
            const kind = pickBtn.dataset.plannerPick;
            const dateInput = wrap.querySelector('[data-planner-date]');
            const timeInput = wrap.querySelector('[data-planner-time]');
            const col = Number(wrap.dataset.col);
            const row = Number(wrap.dataset.row);
            // Stop is driven by this row's Start only (open ≥ Start, never project-wide earliest).
            if (dateInput && col === PLANNER_STOP_COL) {
                const fromStart = rowStartDate(section, row);
                if (fromStart) {
                    dateInput.min = fromStart;
                    if (!dateInput.value || dateInput.value < fromStart) {
                        dateInput.value = fromStart;
                        commitDatetimeWrap(wrap);
                    }
                } else {
                    dateInput.removeAttribute('min');
                }
            }
            if (kind === 'time' && dateInput && !dateInput.value) {
                dateInput.value = (col === PLANNER_STOP_COL && rowStartDate(section, row))
                    || todayLocalDate();
                commitDatetimeWrap(wrap);
            }
            openPlannerNativePicker(kind === 'time' ? timeInput : dateInput);
            return;
        }

        const chartToggle = e.target.closest('[data-planner-chart-toggle]');
        if (chartToggle && section.contains(chartToggle)) {
            e.preventDefault();
            e.stopPropagation();
            const wasCollapsed = !!item.planner?.chartCollapsed;
            mutate((it) => {
                it.planner.chartCollapsed = !it.planner.chartCollapsed;
            }, { skipRerender: true, refreshGantt: true });
            if (wasCollapsed) {
                // Expanding: re-center the chart viewport (board scroll must stay put).
                const host = section.querySelector('[data-planner-gantt]');
                if (host) {
                    const canvasScroll = captureCanvasScroll();
                    const layout = layoutPlannerGantt(
                        derivePlannerTasks(item.planner),
                        { zoom: item.planner.zoom || 'week' }
                    );
                    mountGanttViewport(host, layout, { refocus: true, canvasScroll });
                    restoreCanvasScroll(canvasScroll);
                }
            }
            return;
        }

        const tableToggle = e.target.closest('[data-planner-table-toggle]');
        if (tableToggle && section.contains(tableToggle)) {
            e.preventDefault();
            e.stopPropagation();
            const nextCollapsed = !item.planner?.tableCollapsed;
            mutate((it) => {
                it.planner.tableCollapsed = nextCollapsed;
            }, { skipRerender: true, refreshGantt: false });
            const block = section.querySelector('[data-planner-table]');
            const bodyEl = block?.querySelector('[data-planner-table-body]');
            const toggle = tableToggle.querySelector('.collapsable-toggle');
            bodyEl?.classList.toggle('is-collapsed', nextCollapsed);
            toggle?.classList.toggle('collapsed', nextCollapsed);
            tableToggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
            if (block) block.dataset.tableCollapsed = nextCollapsed ? '1' : '0';
            return;
        }

        const zoomBtn = e.target.closest('[data-planner-zoom]');
        if (zoomBtn && section.contains(zoomBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const zoom = zoomBtn.dataset.plannerZoom;
            mutate((it) => {
                it.planner.zoom = zoom;
            }, { refreshGantt: true });
            return;
        }

        const addBtn = e.target.closest('.planner-add-row-btn');
        if (addBtn && section.contains(addBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => addPlannerRow(it.planner), { skipRerender: true, refreshGantt: false });
            refresh();
            return;
        }

        const removeBtn = e.target.closest('.planner-remove-row-btn');
        if (removeBtn && section.contains(removeBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => removePlannerRow(it.planner), { skipRerender: true, refreshGantt: false });
            refresh();
        }
    });

    // Row drag-reorder via row-number handle
    let dragFrom = null;
    section.addEventListener('dragstart', (e) => {
        const head = e.target.closest('.planner-row-head[data-planner-row]');
        if (!head || !section.contains(head)) return;
        dragFrom = Number(head.dataset.plannerRow);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(dragFrom));
        head.closest('tr')?.classList.add('is-dragging');
    });
    section.addEventListener('dragover', (e) => {
        const row = e.target.closest('tr[data-planner-row-index]');
        if (!row || !section.contains(row) || dragFrom == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        section.querySelectorAll('tr.is-drag-over').forEach((el) => el.classList.remove('is-drag-over'));
        row.classList.add('is-drag-over');
    });
    section.addEventListener('drop', (e) => {
        const row = e.target.closest('tr[data-planner-row-index]');
        if (!row || !section.contains(row) || dragFrom == null) return;
        e.preventDefault();
        const toIndex = Number(row.dataset.plannerRowIndex);
        section.querySelectorAll('tr.is-drag-over, tr.is-dragging').forEach((el) => {
            el.classList.remove('is-drag-over', 'is-dragging');
        });
        if (!Number.isFinite(toIndex) || toIndex === dragFrom) {
            dragFrom = null;
            return;
        }
        mutate((it) => movePlannerRow(it.planner, dragFrom, toIndex), { skipRerender: true, refreshGantt: false });
        dragFrom = null;
        refresh();
    });
    section.addEventListener('dragend', () => {
        dragFrom = null;
        section.querySelectorAll('tr.is-drag-over, tr.is-dragging').forEach((el) => {
            el.classList.remove('is-drag-over', 'is-dragging');
        });
    });

    // Column resize
    let resizeCol = null;
    let resizeStartX = 0;
    let resizeStartW = 0;
    section.addEventListener('mousedown', (e) => {
        const handle = e.target.closest('.sheet-col-resize');
        if (!handle || !section.contains(handle)) return;
        e.preventDefault();
        e.stopPropagation();
        resizeCol = Number(handle.dataset.col);
        resizeStartX = e.clientX;
        resizeStartW = getColWidth(item.planner.sheet, resizeCol);
        const onMove = (ev) => {
            if (resizeCol == null) return;
            const next = resizeStartW + (ev.clientX - resizeStartX);
            setColWidth(item.planner.sheet, resizeCol, next);
            const table = section.querySelector('.planner-grid');
            const colEl = table?.querySelector(`colgroup col[data-col="${resizeCol}"]`);
            if (colEl) colEl.style.width = `${getColWidth(item.planner.sheet, resizeCol)}px`;
            if (table) {
                table.style.width = `${sheetGridTotalWidthPx(item.planner.sheet, { includeStructCol: false })}px`;
            }
        };
        const onUp = () => {
            resizeCol = null;
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            mutateItem(item, () => {}, { preserveView: true, skipRerender: true, localOnly });
            onChange();
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

/**
 * Rebuild Planner section(s) for a note in the live DOM (board + modal).
 * @param {object} item
 */
export function syncNotePlannerDom(item) {
    if (!item?.id) return;

    for (const body of noteBodiesForItem(item.id)) {
        const canEdit = bodyCanEdit(body);
        const startCollapsed = false;
        const html = buildNotePlannerSectionHtml(item, { canEdit, startCollapsed });
        const existing = body.querySelector('[data-note-planner]');

        if (!html) {
            existing?.remove();
            continue;
        }

        const canvasScroll = captureCanvasScroll();
        const prevViewport = existing?.querySelector?.('[data-planner-gantt-viewport]');
        const preserveGanttScroll = prevViewport
            ? { left: prevViewport.scrollLeft, top: prevViewport.scrollTop }
            : null;
        const hadExisting = !!existing;

        const tmp = document.createElement('div');
        tmp.innerHTML = html.trim();
        const next = tmp.firstElementChild;
        if (!next) continue;

        if (existing) {
            existing.replaceWith(next);
        } else {
            const media = body.querySelector('[data-note-attachments]');
            if (media) body.insertBefore(next, media);
            else body.appendChild(next);
        }

        attachPlannerInteractions(body, item, {
            refresh: () => syncNotePlannerDom(item),
            // Replacing an existing section: keep prior Gantt pan; don't yank to today.
            refocusGantt: hadExisting ? false : true,
            preserveGanttScroll
        });
        restoreCanvasScroll(canvasScroll);
    }
}

export { createEmptyPlanner, normalizePlanner, plannerHasContent };
