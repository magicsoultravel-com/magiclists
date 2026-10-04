/** @module {"owns":"magicPlanner note subsection UI — typed sheet + Gantt + Kanban + calendar chart view", "related":["planner.js","plannerGantt.js","plannerKanban.js","plannerCalendar.js","noteSurfaceMutations.js","noteQuickActions.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { parseStoredDateTime, combineDateTime } from './noteModel.js';
import { mutateItem, emitItemMutation } from './noteSurfaceMutations.js';
import { UndoManager } from './undo.js';

/** @type {Set<() => void>} */
const plannerCommitFlushers = new Set();

/** Flush any in-flight debounced planner text commits before undo/redo. */
export function flushOpenPlannerCommits() {
    for (const flush of [...plannerCommitFlushers]) {
        try {
            flush();
        } catch {
            /* ignore stale flushers */
        }
    }
}
import {
    PLANNER_COLUMNS,
    PLANNER_COL_COUNT,
    PLANNER_ZOOM_LEVELS,
    PLANNER_DEFAULT_CHART_VIEW,
    createEmptyPlanner,
    normalizePlanner,
    normalizePlannerLabelWidth,
    normalizeTodayLine,
    normalizePlannerChartView,
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
    setPlannerField,
    getColWidth,
    setColWidth,
    sheetGridTotalWidthPx,
    ensurePlannerColWidths,
    SHEET_MIN_ROWS,
    SHEET_ROW_HEAD_WIDTH_PX,
    plannerHasContent
} from './planner.js';
import { layoutPlannerGantt, parsePlannerDateTime } from './plannerGantt.js';
import { renderPlannerCalendarBoardHtml } from './plannerCalendar.js';
import {
    KANBAN_SORT_CHIP_MODES,
    layoutPlannerKanban,
    moveKanbanCard,
    normalizeKanbanFlavour,
    normalizeKanbanSort,
    normalizeKanbanSortDir,
    setKanbanCardColor,
    setKanbanCardEmphasis,
    setKanbanCardCollapsed,
    expandAllKanbanCards,
    collapseAllKanbanCards,
    resetKanbanCardStyles,
    resetAllKanbanCardStyles,
    resetKanbanArrangement
} from './plannerKanban.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor } from './colorPicker.js';
import { surfaceThemeInline } from './cardTheme.js';
import { refreshNoteCanvasPreview } from './noteCanvasRenderer.js';
import { readDisplayOptions } from './displayOptions.js';

/** Row-number sort chip (hash + up/down). */
const KANBAN_SORT_ROW_ICON = '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true"><path d="M1.8 3.2h2.6M1.8 6h2.6M1.8 8.8h2.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/><path d="M8.4 3v6M7.5 4.1l0.9-1.1 0.9 1.1M7.5 7.9l0.9 1.1 0.9-1.1" fill="none" stroke="currentColor" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const KANBAN_SORT_ICONS = Object.freeze({
    row: KANBAN_SORT_ROW_ICON,
    date: ACTION_ICONS.sortDate,
    alpha: ACTION_ICONS.sortAlpha
});

const KANBAN_SORT_TITLES = Object.freeze({
    row: 'Sort by row',
    date: 'Sort by date',
    alpha: 'Sort alphabetically'
});

/** Warning triangle with exclamation — urgent / focus. */
const KANBAN_URGENT_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false" aria-hidden="true"><path d="M6 1.8 10.6 10.2H1.4Z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M6 4.4v2.6" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round"/><circle cx="6" cy="8.55" r="0.55" fill="currentColor"/></svg>';

/** Soft circle — non-urgent / muted. */
const KANBAN_MUTED_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M3.6 6h4.8" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';

/** Compact date for kanban corner overlays. */
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

function refreshItemNoteCanvas(item) {
    if (!item?.id || !item?.canvas) return;
    for (const body of noteBodiesForItem(item.id)) {
        const section = body.querySelector('[data-note-attachments]');
        if (section) refreshNoteCanvasPreview(section, item);
    }
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

function noteBodiesForItem(itemId) {
    if (!itemId) return [];
    const out = [];
    document.querySelectorAll(`.mini-card[data-id="${CSS.escape(itemId)}"] .editor-note-body`).forEach((el) => out.push(el));
    const modalBody = document.getElementById('editor-note-body');
    const modal = document.getElementById('editor-overlay');
    if (modalBody && modal && !modal.classList.contains('is-hidden') && !out.includes(modalBody)) {
        out.push(modalBody);
    }
    const focusRoot = document.getElementById('magic-focus');
    const focusOpen = focusRoot && !focusRoot.classList.contains('is-hidden');
    if (focusOpen && typeof window.__MagicFocusIsOpenFor === 'function' && window.__MagicFocusIsOpenFor(itemId)) {
        focusRoot.querySelectorAll('.magic-focus__pane-body.editor-note-body').forEach((el) => {
            if (!out.includes(el)) out.push(el);
        });
    }
    return out;
}

function bodyCanEdit(body) {
    return !!(body?.querySelector?.('.card-inline-edit, .sheet-cell-input, .planner-cell-input, .expanded-checklist-add-btn'));
}

function plannerSectionCanEdit(section) {
    if (!section) return false;
    if (section.closest?.('.magic-focus__pane')) return true;
    if (section.matches?.('[data-focus-table-only], [data-focus-chart-only], [data-focus-kanban-only]')) return true;
    // Require editable chrome — readonly cards also carry [data-planner-kanban-card].
    if (section.querySelector?.('.planner-cell-input, [data-planner-rail-resize], .planner-kanban__card.is-editable, [data-planner-kanban-field]')) {
        return true;
    }
    return bodyCanEdit(section.closest('.editor-note-body') || section);
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

function renderCategoryCell(value, row, col, canEdit, planner) {
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
    return `<td class="sheet-grid__cell planner-cell planner-cell--category">
        <div class="planner-category" data-planner-category data-row="${row}" data-col="${col}">
            <button type="button" class="planner-category__swatch-btn" data-planner-category-color title="Category color" aria-label="Category color"${swatchStyle}></button>
            <input type="text" class="form-input sheet-cell-input planner-cell-input planner-category__input" data-planner-cell data-row="${row}" data-col="${col}" data-col-key="category" value="${escapeAttr(value)}" spellcheck="false" autocomplete="off">
            <button type="button" class="planner-category__chevron" data-planner-category-menu title="Choose category" aria-label="Choose category" aria-haspopup="listbox" aria-expanded="false">▼</button>
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
                body += renderCategoryCell(value, r, c, canEdit, planner);
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
        let shape;
        if (b.milestone) {
            const cx = b.x + b.width / 2;
            const cy = b.y + b.height / 2;
            const d = `M${cx},${b.y} L${b.x + b.width},${cy} L${cx},${b.y + b.height} L${b.x},${cy} Z`;
            shape = `<path class="planner-gantt__milestone" d="${d}"${fill}/>`;
        } else {
            shape = `<rect class="planner-gantt__bar" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2"${fill}/>`;
        }
        return `<g class="planner-gantt__bar-group" data-task-id="${escapeAttr(b.id)}">
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
            const label = escapeHTML(b.name || b.id || '—');
            return `<div class="planner-gantt__rail-row" style="height:${rowHeight}px"><span class="planner-gantt__rail-label" title="${label}">${label}</span></div>`;
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
 * @param {{ canEdit?: boolean }} [opts]
 * @returns {{ html: string, layout: object|null, calendarLayout: object|null }}
 */
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

/**
 * @param {object} planner
 * @param {{ canEdit?: boolean, flavour?: string }} [opts]
 * @returns {string}
 */
export function renderPlannerKanbanHtml(planner, { canEdit = false, flavour } = {}) {
    const flavourId = normalizeKanbanFlavour(
        flavour ?? readDisplayOptions().plannerKanbanFlavour
    );
    const kanbanCollapsed = !!planner?.kanbanCollapsed;
    const layout = layoutPlannerKanban(planner, { flavour: flavourId });
    const sort = layout.sort;
    const sortDir = layout.sortDir;
    const sortBtns = KANBAN_SORT_CHIP_MODES.map((mode) => {
        const active = mode === sort;
        const dirClass = active && sortDir === 'desc' ? ' is-desc' : '';
        const activeClass = active ? ' is-active' : '';
        const title = active
            ? `${KANBAN_SORT_TITLES[mode]} (${sortDir === 'desc' ? 'descending' : 'ascending'} — click to flip)`
            : KANBAN_SORT_TITLES[mode];
        const icon = KANBAN_SORT_ICONS[mode] || '';
        return `<button type="button" class="card-act planner-kanban-sort-btn${activeClass}${dirClass}" data-planner-kanban-sort="${mode}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" aria-pressed="${active ? 'true' : 'false'}">${icon}</button>`;
    }).join('');
    const toggleCollapsed = kanbanCollapsed ? ' collapsed' : '';
    const boardCollapsed = kanbanCollapsed ? ' is-collapsed' : '';

    const columnsHtml = layout.columns.map((col) => {
        const cardsHtml = col.cards.length
            ? col.cards.map((card) => {
                const editClass = canEdit ? ' is-editable' : '';
                const startLabel = formatKanbanCardDate(card.start);
                const stopLabel = formatKanbanCardDate(card.stop);
                const rowLabel = String(card.id || card.row + 1);
                const startHtml = startLabel
                    ? `<span class="planner-kanban__card-date planner-kanban__card-date--start" title="Start ${escapeAttr(startLabel)}">${escapeHTML(startLabel)}</span>`
                    : '';
                const stopHtml = stopLabel
                    ? `<span class="planner-kanban__card-date planner-kanban__card-date--stop" title="Stop ${escapeAttr(stopLabel)}">${escapeHTML(stopLabel)}</span>`
                    : '';
                const rowHtml = `<span class="planner-kanban__card-row" title="Row ${escapeAttr(rowLabel)}">${escapeHTML(rowLabel)}</span>`;
                const commentRaw = String(card.comments || '');
                const comment = commentRaw.trim();
                const nameText = String(card.name || '');
                const emphasis = card.emphasis === 'urgent' || card.emphasis === 'muted' ? card.emphasis : '';
                const emphasisClass = emphasis ? ` is-${emphasis}` : '';
                const collapsed = !!card.collapsed;
                const collapsedClass = collapsed ? ' is-collapsed' : '';
                const urgentActive = emphasis === 'urgent' ? ' is-active' : '';
                const mutedActive = emphasis === 'muted' ? ' is-active' : '';
                const densityTitle = collapsed ? 'Expand card' : 'Collapse card';
                const densityIcon = collapsed ? CARD_ICONS.expand : CARD_ICONS.collapse;
                const actionsHtml = canEdit
                    ? `<span class="planner-kanban__card-actions">
                        <span class="planner-kanban__card-actions-tray">
                            <button type="button" class="planner-kanban__card-density" data-planner-kanban-density title="${escapeAttr(densityTitle)}" aria-label="${escapeAttr(densityTitle)}" aria-pressed="${collapsed ? 'true' : 'false'}">${densityIcon}</button>
                            <button type="button" class="planner-kanban__card-emphasis${urgentActive}" data-planner-kanban-emphasis="urgent" title="Mark urgent" aria-label="Mark urgent" aria-pressed="${emphasis === 'urgent' ? 'true' : 'false'}">${KANBAN_URGENT_ICON}</button>
                            <button type="button" class="planner-kanban__card-emphasis${mutedActive}" data-planner-kanban-emphasis="muted" title="Mark non-urgent" aria-label="Mark non-urgent" aria-pressed="${emphasis === 'muted' ? 'true' : 'false'}">${KANBAN_MUTED_ICON}</button>
                            <button type="button" class="planner-kanban__card-color" data-planner-kanban-color title="Card color" aria-label="Card color">${CARD_ICONS.color}</button>
                            <button type="button" class="planner-kanban__card-reset" data-planner-kanban-reset-card title="Reset card styles" aria-label="Reset card styles">${ACTION_ICONS.resetCustomization}</button>
                        </span>
                        <button type="button" class="planner-kanban__card-more" data-planner-kanban-more title="More actions" aria-label="More actions" aria-expanded="false">${CARD_ICONS.more}</button>
                        <span class="planner-kanban__card-grab" title="Drag to move" aria-hidden="true">${CARD_ICONS.drag}</span>
                    </span>`
                    : '';
                // Stable slot (no size-changing flyout). Actions + footer grip are chrome only.
                const slotNameHtml = canEdit
                    ? `<div class="planner-kanban__card-name card-inline-edit" contenteditable="plaintext-only" data-planner-kanban-field="name" data-planner-row="${card.row}" spellcheck="false" role="textbox" aria-label="Name">${escapeHTML(nameText)}</div>`
                    : `<span class="planner-kanban__card-name">${escapeHTML(nameText)}</span>`;
                const slotCommentHtml = canEdit
                    ? `<textarea class="planner-kanban__card-comment card-inline-edit" data-planner-kanban-field="comments" data-planner-row="${card.row}" rows="1" spellcheck="false" aria-label="Comments">${escapeHTML(commentRaw)}</textarea>`
                    : (comment ? `<span class="planner-kanban__card-comment">${escapeHTML(comment)}</span>` : '');
                const metaHtml = `${rowHtml}${startHtml}${stopHtml}`;
                const slotBody = `${metaHtml}
                    <div class="planner-kanban__card-top">${slotNameHtml}</div>
                    ${slotCommentHtml}`;
                const surface = surfaceThemeInline(card.cardColor);
                const colorClass = card.cardColor ? ` has-color${surface.className}` : '';
                return `<article class="planner-kanban__card${colorClass}${emphasisClass}${collapsedClass}${editClass}" data-planner-kanban-card data-planner-row="${card.row}" data-kanban-emphasis="${escapeAttr(emphasis)}" data-kanban-collapsed="${collapsed ? '1' : '0'}"${surface.style}>
                    <div class="planner-kanban__card-slot">${slotBody}</div>
                    ${actionsHtml}
                </article>`;
            }).join('')
            : '<div class="planner-kanban__empty-col" aria-hidden="true"></div>';
        return `<div class="planner-kanban__column" data-planner-kanban-stage="${col.stage}">
            <div class="planner-kanban__column-head">
                <span class="planner-kanban__column-title">${escapeHTML(col.label)}</span>
                <span class="planner-kanban__column-count">${col.cards.length}</span>
            </div>
            <div class="planner-kanban__column-body" data-planner-kanban-drop="${col.stage}">
                ${cardsHtml}
            </div>
        </div>`;
    }).join('');

    const moduleResetHtml = canEdit
        ? `<span class="planner-kanban__module-sep" aria-hidden="true"></span>
            <button type="button" class="card-act planner-kanban-module-btn" data-planner-kanban-expand-all title="Expand all cards" aria-label="Expand all cards">${ACTION_ICONS.expandAll}</button>
            <button type="button" class="card-act planner-kanban-module-btn" data-planner-kanban-collapse-all title="Collapse all cards" aria-label="Collapse all cards">${ACTION_ICONS.collapseAll}</button>
            <button type="button" class="card-act planner-kanban-module-btn" data-planner-kanban-reset-styles title="Reset all card styles" aria-label="Reset all card styles">${ACTION_ICONS.resetCustomization}</button>
            <button type="button" class="card-act planner-kanban-module-btn" data-planner-kanban-reset-arrangement title="Reset arrangement" aria-label="Reset arrangement">${ACTION_ICONS.layoutReset}</button>`
        : '';

    return `<div class="planner-kanban planner-sub" data-planner-kanban data-kanban-collapsed="${kanbanCollapsed ? '1' : '0'}" data-kanban-sort="${escapeAttr(sort)}" data-kanban-sort-dir="${escapeAttr(sortDir)}" data-kanban-flavour="${escapeAttr(flavourId)}">
        <div class="planner-kanban__toolbar planner-sub__toolbar">
            <button type="button" class="planner-kanban__title planner-sub__title" data-planner-kanban-toggle aria-expanded="${kanbanCollapsed ? 'false' : 'true'}">
                <span class="collapsable-toggle${toggleCollapsed}" aria-hidden="true">▼</span>Kanban
            </button>
            <div class="planner-kanban__tools${kanbanCollapsed ? ' is-collapsed' : ''}" role="group" aria-label="Kanban tools"${kanbanCollapsed ? ' hidden' : ''}>
                <span class="planner-kanban__sort" role="group" aria-label="Kanban sort">${sortBtns}</span>
                ${moduleResetHtml}
            </div>
        </div>
        <div class="planner-kanban__board${boardCollapsed}" data-planner-kanban-board>
            ${columnsHtml}
        </div>
    </div>`;
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
    const { html: ganttHtml } = renderPlannerGanttHtml(planner, { canEdit });
    const kanbanHtml = renderPlannerKanbanHtml(planner, { canEdit });

    return `
            <div class="note-body-section note-body-section--planner" data-note-planner>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>Plan</span>
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    ${tableHtml}
                    ${ganttHtml}
                    ${kanbanHtml}
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

    // After table cells so live kanban edits win over stale sheet inputs.
    section.querySelectorAll('[data-planner-kanban-field]').forEach((el) => {
        const row = Number(el.dataset.plannerRow);
        const key = String(el.dataset.plannerKanbanField || '');
        if (!Number.isFinite(row) || (key !== 'name' && key !== 'comments')) return;
        const value = key === 'name'
            ? String(el.textContent || '')
            : String(el.value ?? '');
        setPlannerField(sheet, row, key, value);
    });
}

/**
 * Keep table name/comments inputs aligned with a kanban field edit (same note hosts).
 * Prevents stale table DOM from overwriting the sheet on the next body sync.
 * @param {string} itemId
 * @param {number} row
 * @param {'name'|'comments'} key
 * @param {string} value
 */
function mirrorKanbanFieldToTableDom(itemId, row, key, value) {
    if (!itemId || !Number.isFinite(row) || (key !== 'name' && key !== 'comments')) return;
    const next = String(value ?? '');
    for (const body of noteBodiesForItem(itemId)) {
        body.querySelectorAll?.(`[data-planner-cell][data-row="${row}"][data-col-key="${key}"]`).forEach((cell) => {
            if (cell.value === next) return;
            cell.value = next;
            growPlannerCell(cell);
        });
    }
}

function mountGanttViewport(host, layout, {
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

function refreshGanttInSection(section, item, { refocus = false } = {}) {
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

function refreshKanbanInSection(section, item) {
    if (!section || !item?.planner) return;
    const host = section.querySelector('[data-planner-kanban]');
    if (!host) return;
    // Don't nuke the board while a kanban field is focused (typing).
    const active = section.ownerDocument?.activeElement;
    if (active && host.contains(active) && active.closest?.('[data-planner-kanban-field]')) return;
    const board = host.querySelector('[data-planner-kanban-board]');
    const preserveScrollLeft = board ? board.scrollLeft : null;
    const normalized = normalizePlanner(item.planner);
    if (normalized) item.planner = normalized;
    const html = renderPlannerKanbanHtml(item.planner, {
        canEdit: plannerSectionCanEdit(section),
        flavour: readDisplayOptions().plannerKanbanFlavour
    });
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const next = tmp.firstElementChild;
    if (!next) return;
    host.replaceWith(next);
    const nextBoard = next.querySelector('[data-planner-kanban-board]');
    if (nextBoard && preserveScrollLeft != null) nextBoard.scrollLeft = preserveScrollLeft;
    // Host swap skips re-bind; re-measure comments now that nodes are connected.
    growPlannerTextareas(next);
}

/**
 * Refresh derived planner UI (gantt + kanban + summary) across all live hosts for an item.
 * Used so Focus table edits update sibling chart/kanban panes without remounting the table.
 * @param {object} item
 * @param {{ refocus?: boolean }} [opts]
 */
export function refreshPlannerDerivedViews(item, { refocus = false } = {}) {
    if (!item?.id || !item?.planner) return;
    for (const body of noteBodiesForItem(item.id)) {
        body.querySelectorAll?.('[data-note-planner]').forEach((sec) => {
            refreshGanttInSection(sec, item, { refocus });
            refreshKanbanInSection(sec, item);
        });
    }
    refreshItemNoteCanvas(item);
}

/**
 * Re-render every open planner chart (e.g. after Display Options today-line change).
 * @param {object[]} [items]
 */
export function refreshAllPlannerCharts(items = []) {
    const list = Array.isArray(items) ? items : [];
    for (const item of list) {
        if (item?.id && item?.planner) refreshPlannerDerivedViews(item);
    }
}

/**
 * Re-render every open planner kanban (e.g. after Display Options flavour change).
 * @param {object[]} [items]
 */
export function refreshAllPlannerKanbans(items = []) {
    const list = Array.isArray(items) ? items : [];
    for (const item of list) {
        if (!item?.id || !item?.planner) continue;
        for (const body of noteBodiesForItem(item.id)) {
            body.querySelectorAll?.('[data-note-planner]').forEach((sec) => {
                refreshKanbanInSection(sec, item);
            });
        }
    }
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
    section?.querySelectorAll('.planner-cell-input, textarea.planner-kanban__card-comment').forEach((el) => {
        growPlannerCell(el);
    });
    restoreCanvasScroll(canvasScroll);
}

/** Auto-size a single planner cell — cheap enough for per-keystroke use. */
function growPlannerCell(el) {
    if (!el || !el.style) return;
    el.style.height = '0';
    const next = Math.max(el.scrollHeight, 18);
    // Kanban comments: empty stays 1 line; content caps at ~3 unless focused.
    if (el.matches?.('textarea.planner-kanban__card-comment') && document.activeElement !== el) {
        const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || 14;
        const hasText = String(el.value || '').trim().length > 0;
        el.style.height = `${Math.min(next, Math.round(lh * (hasText ? 3 : 1)))}px`;
        return;
    }
    el.style.height = `${next}px`;
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

function closePlannerCategoryMenus() {
    document.querySelectorAll('[data-planner-category-panel]').forEach((panel) => {
        panel.remove();
    });
    document.querySelectorAll('[data-planner-category-menu][aria-expanded="true"]').forEach((btn) => {
        btn.setAttribute('aria-expanded', 'false');
    });
    if (closePlannerCategoryMenus._onPointer) {
        document.removeEventListener('pointerdown', closePlannerCategoryMenus._onPointer, true);
        closePlannerCategoryMenus._onPointer = null;
    }
    if (closePlannerCategoryMenus._onReposition) {
        window.removeEventListener('scroll', closePlannerCategoryMenus._onReposition, true);
        window.removeEventListener('resize', closePlannerCategoryMenus._onReposition);
        closePlannerCategoryMenus._onReposition = null;
    }
}

function positionPlannerCategoryMenu(panel, wrap) {
    if (!panel || !wrap) return;
    const rect = wrap.getBoundingClientRect();
    const minW = Math.max(rect.width, 112);
    let left = rect.left;
    let top = rect.bottom + 2;
    // Keep inside viewport.
    const maxLeft = Math.max(8, window.innerWidth - minW - 8);
    left = Math.min(Math.max(8, left), maxLeft);
    panel.style.position = 'fixed';
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
    panel.style.minWidth = `${Math.round(minW)}px`;
    panel.style.right = 'auto';
    panel.style.zIndex = '10050';
    // Flip above if not enough room below.
    const panelH = panel.offsetHeight || 160;
    if (top + panelH > window.innerHeight - 8 && rect.top > panelH + 8) {
        panel.style.top = `${Math.round(rect.top - panelH - 2)}px`;
    }
}

function openPlannerCategoryMenu(wrap, item, { mutate } = {}) {
    if (!wrap) return;
    const input = wrap.querySelector('[data-col-key="category"]');
    const chevron = wrap.querySelector('[data-planner-category-menu]');
    if (!input) return;

    // Toggle closed if this wrap already owns the open panel.
    const existing = document.querySelector('[data-planner-category-panel]');
    if (existing && existing.dataset.ownerRow === String(wrap.dataset.row)
        && existing.dataset.ownerCol === String(wrap.dataset.col)) {
        closePlannerCategoryMenus();
        return;
    }

    closePlannerCategoryMenus();

    const names = listPlannerCategories(item?.planner);
    const panel = document.createElement('div');
    panel.className = 'planner-category__menu';
    panel.setAttribute('data-planner-category-panel', '1');
    panel.setAttribute('role', 'listbox');
    panel.dataset.ownerRow = String(wrap.dataset.row ?? '');
    panel.dataset.ownerCol = String(wrap.dataset.col ?? '');
    if (!names.length) {
        panel.innerHTML = '<div class="planner-category__menu-empty">No categories yet</div>';
    } else {
        panel.innerHTML = names.map((name) => {
            const selected = String(input.value || '').trim().toLowerCase() === name.toLowerCase();
            return `<button type="button" class="planner-category__option${selected ? ' is-selected' : ''}" role="option" data-planner-category-option="${escapeAttr(name)}" aria-selected="${selected ? 'true' : 'false'}">${escapeHTML(name)}</button>`;
        }).join('');
    }
    document.body.appendChild(panel);
    chevron?.setAttribute('aria-expanded', 'true');
    positionPlannerCategoryMenu(panel, wrap);

    const onReposition = () => {
        if (!document.body.contains(panel) || !document.body.contains(wrap)) {
            closePlannerCategoryMenus();
            return;
        }
        positionPlannerCategoryMenu(panel, wrap);
    };
    closePlannerCategoryMenus._onReposition = onReposition;
    window.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);

    const onPointer = (e) => {
        if (panel.contains(e.target) || wrap.contains(e.target)) return;
        closePlannerCategoryMenus();
    };
    closePlannerCategoryMenus._onPointer = onPointer;
    document.addEventListener('pointerdown', onPointer, true);

    panel.addEventListener('mousedown', (e) => {
        const opt = e.target.closest('[data-planner-category-option]');
        if (!opt || !panel.contains(opt)) return;
        e.preventDefault();
        e.stopPropagation();
        const name = opt.getAttribute('data-planner-category-option') || '';
        const row = Number(wrap.dataset.row);
        const col = Number(wrap.dataset.col);
        input.value = name;
        mutate?.((it) => {
            if (!it.planner) it.planner = createEmptyPlanner();
            if (Number.isFinite(row) && Number.isFinite(col)) {
                setCellValue(it.planner.sheet, row, col, name);
            }
        }, { refreshGantt: true });
        const known = getCategoryColor(item.planner, name);
        const swatch = wrap.querySelector('[data-planner-category-color]');
        if (swatch) swatch.style.background = known || '';
        closePlannerCategoryMenus();
        input.focus();
        // Do not call syncNotePlannerDom — mutate already refreshes Gantt.
    });
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
    // Board cards often bind before appendChild; re-grow next frame once connected.
    if (!alreadyBound) {
        growPlannerTextareas(section);
        requestAnimationFrame(() => {
            if (section.isConnected) growPlannerTextareas(section);
        });
    }

    if (alreadyBound) return;
    section.dataset.plannerBound = '1';

    // First bind: pan wiring. Re-center only when explicitly requested or never focused.
    const ganttHost = section.querySelector('[data-planner-gantt]');
    if (ganttHost && item.planner) {
        const chartView = normalizePlannerChartView(item.planner.chartView);
        const shouldRefocus = refocusGantt != null
            ? !!refocusGantt
            : section.dataset.plannerFocused !== '1';
        const canvasScroll = captureCanvasScroll();
        if (chartView === 'calendar') {
            const { layout: calendarLayout } = renderPlannerCalendarBoardHtml(item.planner);
            mountGanttViewport(ganttHost, null, {
                refocus: shouldRefocus,
                preserveScrollLeft: preserveGanttScroll?.left ?? null,
                preserveScrollTop: preserveGanttScroll?.top ?? null,
                canvasScroll,
                calendarLayout,
                item
            });
        } else {
            const layoutOpts = ganttLayoutOpts(item.planner);
            const layout = layoutPlannerGantt(derivePlannerTasks(item.planner), {
                zoom: layoutOpts.zoom,
                labelWidth: layoutOpts.labelWidth,
                rowHeight: layoutOpts.rowHeight
            });
            mountGanttViewport(ganttHost, layout, {
                refocus: shouldRefocus,
                preserveScrollLeft: preserveGanttScroll?.left ?? null,
                preserveScrollTop: preserveGanttScroll?.top ?? null,
                canvasScroll,
                item
            });
        }
        section.dataset.plannerFocused = '1';
        restoreCanvasScroll(canvasScroll);
    }

    // Debounced persist + Gantt: patch sheet on every keystroke, emit/refresh once.
    let commitTimer = null;
    let pendingBefore = null;
    let pendingNeedGantt = false;
    const plannerMergeKey = () => `${item.id}:planner`;

    const flushPlannerCommit = () => {
        if (!section.isConnected) {
            plannerCommitFlushers.delete(flushPlannerCommit);
            return;
        }
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
                skipRerender: true,
                mergeKey: plannerMergeKey(),
                mergeWindow: true
            });
        }
        if (needGantt) refreshPlannerDerivedViews(item);
        onChange();
    };
    plannerCommitFlushers.add(flushPlannerCommit);

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
        }, {
            preserveView: true,
            skipRerender,
            localOnly,
            mergeKey: plannerMergeKey(),
            mergeWindow: true
        });
        if (refreshGantt) refreshPlannerDerivedViews(item);
        onChange();
    };

    const openStopDateAfterStart = (row) => {
        if (!Number.isFinite(row) || PLANNER_STOP_COL < 0) return;
        const stopWrap = section.querySelector(
            `[data-planner-datetime][data-row="${row}"][data-col="${PLANNER_STOP_COL}"]`
        );
        const dateInput = stopWrap?.querySelector?.('[data-planner-date]');
        if (!dateInput) return;
        const fromStart = rowStartDate(section, row);
        if (fromStart) {
            dateInput.min = fromStart;
            if (!dateInput.value || dateInput.value < fromStart) {
                dateInput.value = fromStart;
                commitDatetimeWrap(stopWrap);
            }
        } else {
            dateInput.removeAttribute('min');
        }
        // Let the Start picker finish closing before opening Stop.
        requestAnimationFrame(() => {
            setTimeout(() => openPlannerNativePicker(dateInput), 0);
        });
    };

    const commitDatetimeWrap = (wrap, { openStopAfter = false } = {}) => {
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
            if (openStopAfter && date) openStopDateAfterStart(row);
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

        const kanbanField = e.target.closest('[data-planner-kanban-field]');
        if (kanbanField && section.contains(kanbanField)) {
            const row = Number(kanbanField.dataset.plannerRow);
            const key = String(kanbanField.dataset.plannerKanbanField || '');
            if (!Number.isFinite(row) || (key !== 'name' && key !== 'comments')) return;
            schedulePlannerCommit({ refreshGantt: true });
            if (!item.planner) item.planner = createEmptyPlanner();
            const value = key === 'name'
                ? String(kanbanField.textContent || '')
                : String(kanbanField.value ?? '');
            setPlannerField(item.planner.sheet, row, key, value);
            mirrorKanbanFieldToTableDom(item.id, row, key, value);
            if (key === 'comments') growPlannerCell(kanbanField);
            return;
        }
        // Date/time: ignore input — picker fires change; avoid per-keystroke Gantt + double emit.
    });

    // Flush pending text persist + chart when leaving a planner cell / datetime control.
    section.addEventListener('change', (e) => {
        if (e.target.matches('[data-planner-date], [data-planner-time]')) {
            const wrap = e.target.closest('[data-planner-datetime]');
            const isDate = e.target.matches('[data-planner-date]');
            commitDatetimeWrap(wrap, { openStopAfter: isDate });
        }
    });

    // Flush pending text persist + chart when leaving a planner cell / datetime control.
    section.addEventListener('focusin', (e) => {
        const catInput = e.target.closest?.('.planner-category__input');
        if (catInput && section.contains(catInput)) {
            const wrap = catInput.closest('[data-planner-category]');
            const openPanel = document.querySelector('[data-planner-category-panel]');
            const ownsOpen = openPanel
                && openPanel.dataset.ownerRow === String(wrap?.dataset?.row ?? '')
                && openPanel.dataset.ownerCol === String(wrap?.dataset?.col ?? '');
            if (!ownsOpen) {
                openPlannerCategoryMenu(wrap, item, { mutate });
            }
        }

        const kanbanField = e.target.closest?.('[data-planner-kanban-field]');
        if (kanbanField && section.contains(kanbanField)) {
            const card = kanbanField.closest('[data-planner-kanban-card]');
            card?.classList.add('is-kanban-editing');
            if (kanbanField.dataset.plannerKanbanField === 'name') {
                kanbanField.dataset.kanbanNamePrev = String(kanbanField.textContent || '');
            }
            if (kanbanField.dataset.plannerKanbanField === 'comments') {
                growPlannerCell(kanbanField);
            }
        }
    });

    section.addEventListener('focusout', (e) => {
        const kanbanField = e.target.closest?.('[data-planner-kanban-field]');
        if (kanbanField && section.contains(kanbanField)) {
            const card = kanbanField.closest('[data-planner-kanban-card]');
            const related = e.relatedTarget;
            const stayingOnCard = related && card?.contains(related);
            if (!stayingOnCard) card?.classList.remove('is-kanban-editing');

            if (kanbanField.dataset.plannerKanbanField === 'name') {
                const row = Number(kanbanField.dataset.plannerRow);
                const trimmed = String(kanbanField.textContent || '').trim();
                if (!trimmed) {
                    const prev = String(kanbanField.dataset.kanbanNamePrev || '').trim()
                        || (Number.isFinite(row) ? getPlannerField(item.planner?.sheet, row, 'name') : '');
                    kanbanField.textContent = prev;
                    if (Number.isFinite(row) && item.planner?.sheet) {
                        setPlannerField(item.planner.sheet, row, 'name', prev);
                        mirrorKanbanFieldToTableDom(item.id, row, 'name', prev);
                    }
                } else if (String(kanbanField.textContent || '') !== trimmed) {
                    kanbanField.textContent = trimmed;
                    const rowNum = Number(kanbanField.dataset.plannerRow);
                    if (Number.isFinite(rowNum) && item.planner?.sheet) {
                        setPlannerField(item.planner.sheet, rowNum, 'name', trimmed);
                        mirrorKanbanFieldToTableDom(item.id, rowNum, 'name', trimmed);
                    }
                } else if (Number.isFinite(row)) {
                    mirrorKanbanFieldToTableDom(item.id, row, 'name', trimmed);
                }
            }
            if (kanbanField.dataset.plannerKanbanField === 'comments') {
                const row = Number(kanbanField.dataset.plannerRow);
                if (Number.isFinite(row)) {
                    mirrorKanbanFieldToTableDom(item.id, row, 'comments', String(kanbanField.value ?? ''));
                }
                // Re-clamp to ~3 lines after edit.
                requestAnimationFrame(() => growPlannerCell(kanbanField));
            }
            flushPlannerCommit();
            return;
        }

        const leaving = e.target.closest('[data-planner-cell], [data-planner-datetime]');
        if (!leaving || !section.contains(leaving)) return;
        flushPlannerCommit();
        // Category menu closes via document pointerdown — not focusout (relatedTarget is often null).
    });

    const closeOpenKanbanCardActions = (except = null) => {
        section.querySelectorAll('.planner-kanban__card-actions.is-actions-open').forEach((el) => {
            if (except && el === except) return;
            el.classList.remove('is-actions-open');
            const more = el.querySelector('[data-planner-kanban-more]');
            if (more) more.setAttribute('aria-expanded', 'false');
        });
    };

    section.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const open = section.querySelector('.planner-kanban__card-actions.is-actions-open');
            if (open) {
                e.preventDefault();
                closeOpenKanbanCardActions();
                return;
            }
        }
        // Planner fields skip the global UndoManager chord (contenteditable/input).
        // Flush pending debounce, then use app undo so table + kanban stay aligned.
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
            const inPlannerEdit = e.target.closest?.(
                '[data-planner-cell], [data-planner-kanban-field], [data-planner-date], [data-planner-time], [data-planner-datetime]'
            );
            if (inPlannerEdit && section.contains(inPlannerEdit)) {
                e.preventDefault();
                e.stopPropagation();
                flushPlannerCommit();
                const redo = e.key === 'y' || e.key === 'Y' || ((e.key === 'z' || e.key === 'Z') && e.shiftKey);
                if (redo) UndoManager.redo();
                else UndoManager.undo();
                return;
            }
        }
        const nameField = e.target.closest?.('[data-planner-kanban-field="name"]');
        if (!nameField || !section.contains(nameField)) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            nameField.blur();
        }
    });

    document.addEventListener('pointerdown', (e) => {
        if (!section.isConnected) return;
        const open = section.querySelector('.planner-kanban__card-actions.is-actions-open');
        if (!open) return;
        if (open.contains(e.target)) return;
        closeOpenKanbanCardActions();
    }, true);

    section.addEventListener('click', (e) => {
        const catMenuBtn = e.target.closest('[data-planner-category-menu]');
        if (catMenuBtn && section.contains(catMenuBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const wrap = catMenuBtn.closest('[data-planner-category]');
            openPlannerCategoryMenu(wrap, item, { mutate });
            return;
        }

        const colorBtn = e.target.closest('[data-planner-category-color]');
        if (colorBtn && section.contains(colorBtn)) {
            e.preventDefault();
            e.stopPropagation();
            closePlannerCategoryMenus();
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
                    if (nameInput) nameInput.value = name;
                    colorBtn.style.background = hex;
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

        const kanbanToggle = e.target.closest('[data-planner-kanban-toggle]');
        if (kanbanToggle && section.contains(kanbanToggle)) {
            e.preventDefault();
            e.stopPropagation();
            const nextCollapsed = !item.planner?.kanbanCollapsed;
            mutate((it) => {
                it.planner.kanbanCollapsed = nextCollapsed;
            }, { skipRerender: true, refreshGantt: false });
            const block = section.querySelector('[data-planner-kanban]');
            const boardEl = block?.querySelector('[data-planner-kanban-board]');
            const toolsEl = block?.querySelector('.planner-kanban__tools');
            const toggle = kanbanToggle.querySelector('.collapsable-toggle');
            boardEl?.classList.toggle('is-collapsed', nextCollapsed);
            toolsEl?.classList.toggle('is-collapsed', nextCollapsed);
            if (toolsEl) toolsEl.hidden = nextCollapsed;
            toggle?.classList.toggle('collapsed', nextCollapsed);
            kanbanToggle.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
            if (block) block.dataset.kanbanCollapsed = nextCollapsed ? '1' : '0';
            return;
        }

        const kanbanSortBtn = e.target.closest('[data-planner-kanban-sort]');
        if (kanbanSortBtn && section.contains(kanbanSortBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const mode = normalizeKanbanSort(kanbanSortBtn.dataset.plannerKanbanSort);
            if (mode !== 'row' && mode !== 'date' && mode !== 'alpha') return;
            mutate((it) => {
                const cur = normalizeKanbanSort(it.planner.kanbanSort);
                const curDir = normalizeKanbanSortDir(it.planner.kanbanSortDir);
                if (cur === mode) {
                    it.planner.kanbanSortDir = curDir === 'asc' ? 'desc' : 'asc';
                } else {
                    it.planner.kanbanSort = mode;
                    it.planner.kanbanSortDir = 'asc';
                }
            }, { skipRerender: true, refreshGantt: true });
            return;
        }

        const kanbanExpandAllBtn = e.target.closest('[data-planner-kanban-expand-all]');
        if (kanbanExpandAllBtn && section.contains(kanbanExpandAllBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                expandAllKanbanCards(it.planner);
            }, { skipRerender: true, refreshGantt: true });
            return;
        }

        const kanbanCollapseAllBtn = e.target.closest('[data-planner-kanban-collapse-all]');
        if (kanbanCollapseAllBtn && section.contains(kanbanCollapseAllBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                collapseAllKanbanCards(it.planner);
            }, { skipRerender: true, refreshGantt: true });
            return;
        }

        const kanbanResetStylesBtn = e.target.closest('[data-planner-kanban-reset-styles]');
        if (kanbanResetStylesBtn && section.contains(kanbanResetStylesBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                resetAllKanbanCardStyles(it.planner);
            }, { skipRerender: true, refreshGantt: true });
            return;
        }

        const kanbanResetArrangementBtn = e.target.closest('[data-planner-kanban-reset-arrangement]');
        if (kanbanResetArrangementBtn && section.contains(kanbanResetArrangementBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                resetKanbanArrangement(it.planner);
            }, { skipRerender: true, refreshGantt: true });
            return;
        }

        const kanbanMoreBtn = e.target.closest('[data-planner-kanban-more]');
        if (kanbanMoreBtn && section.contains(kanbanMoreBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const actions = kanbanMoreBtn.closest('.planner-kanban__card-actions');
            if (!actions) return;
            const willOpen = !actions.classList.contains('is-actions-open');
            closeOpenKanbanCardActions(willOpen ? actions : null);
            actions.classList.toggle('is-actions-open', willOpen);
            kanbanMoreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            return;
        }

        const kanbanDensityBtn = e.target.closest('[data-planner-kanban-density]');
        if (kanbanDensityBtn && section.contains(kanbanDensityBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = kanbanDensityBtn.closest('[data-planner-kanban-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return;
            const nextCollapsed = card?.dataset?.kanbanCollapsed !== '1';
            mutate((it) => {
                setKanbanCardCollapsed(it.planner, row, nextCollapsed);
            }, { skipRerender: true, refreshGantt: true });
            return;
        }

        const kanbanEmphasisBtn = e.target.closest('[data-planner-kanban-emphasis]');
        if (kanbanEmphasisBtn && section.contains(kanbanEmphasisBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = kanbanEmphasisBtn.closest('[data-planner-kanban-card]');
            const row = Number(card?.dataset?.plannerRow);
            const mode = String(kanbanEmphasisBtn.dataset.plannerKanbanEmphasis || '');
            if (!Number.isFinite(row) || (mode !== 'urgent' && mode !== 'muted')) return;
            mutate((it) => {
                setKanbanCardEmphasis(it.planner, row, mode);
            }, { skipRerender: true, refreshGantt: true });
            return;
        }

        const kanbanResetCardBtn = e.target.closest('[data-planner-kanban-reset-card]');
        if (kanbanResetCardBtn && section.contains(kanbanResetCardBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = kanbanResetCardBtn.closest('[data-planner-kanban-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return;
            mutate((it) => {
                resetKanbanCardStyles(it.planner, row);
            }, { skipRerender: true, refreshGantt: true });
            return;
        }

        const kanbanColorBtn = e.target.closest('[data-planner-kanban-color]');
        if (kanbanColorBtn && section.contains(kanbanColorBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = kanbanColorBtn.closest('[data-planner-kanban-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return;
            const current = resolveNoteColor(
                item.planner?.kanbanCardColors?.[String(row)]
                || getCategoryColor(item.planner, getPlannerField(item.planner.sheet, row, 'category'))
                || ''
            );
            ColorPicker.open({
                anchor: kanbanColorBtn,
                presets: PALETTE_NOTE,
                value: current,
                onSelect: (color) => {
                    const hex = resolveNoteColor(color);
                    mutate((it) => {
                        setKanbanCardColor(it.planner, row, hex);
                    }, { skipRerender: true, refreshGantt: true });
                }
            });
            return;
        }

        const chartViewBtn = e.target.closest('button[data-planner-chart-view]');
        if (chartViewBtn && section.contains(chartViewBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const nextView = String(chartViewBtn.dataset.plannerChartView || '').toLowerCase();
            if (nextView !== 'calendar') return;
            // Stay on calendar when already active; only zoom icons return to gantt.
            if (normalizePlannerChartView(item.planner?.chartView) === 'calendar') return;
            mutate((it) => {
                it.planner.chartView = 'calendar';
            }, { refreshGantt: true });
            return;
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

    // Table row HTML5 reorder + FC-style pointer drag for kanban cards
    let dragFrom = null;
    const KANBAN_DRAG_THRESHOLD = 4;
    /** @type {{
     *   card: HTMLElement,
     *   row: number,
     *   slot: HTMLElement,
     *   offsetX: number,
     *   offsetY: number,
     *   width: number,
     *   height: number,
     *   lifted: boolean,
     *   startX: number,
     *   startY: number,
     *   pointerId: number
     * } | null} */
    let kanbanPtr = null;

    const clearKanbanColumnOver = () => {
        section.querySelectorAll('.planner-kanban__column-body.is-drag-over').forEach((el) => {
            el.classList.remove('is-drag-over');
        });
    };

    const resetKanbanCardStyles = (card) => {
        if (!card) return;
        card.classList.remove('is-planner-kanban-dragging');
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.zIndex = '';
        card.style.pointerEvents = '';
        card.style.margin = '';
        card.style.transform = '';
    };

    const endKanbanPointerDrag = ({ commit = false } = {}) => {
        const state = kanbanPtr;
        kanbanPtr = null;
        document.removeEventListener('pointermove', onKanbanDocPointerMove);
        document.removeEventListener('pointerup', onKanbanDocPointerUp);
        document.removeEventListener('pointercancel', onKanbanDocPointerUp);
        document.body.classList.remove('is-planner-kanban-drag-active');
        clearKanbanColumnOver();
        if (!state) return;

        const { card, row, slot } = state;
        let target = null;
        if (commit && slot?.isConnected) {
            const body = slot.closest('[data-planner-kanban-drop]');
            const toStage = Number(body?.dataset?.plannerKanbanDrop);
            if (Number.isFinite(toStage)) {
                let beforeRow = null;
                let el = slot.nextElementSibling;
                while (el) {
                    if (el.matches?.('[data-planner-kanban-card]')) {
                        const r = Number(el.dataset.plannerRow);
                        if (Number.isFinite(r) && r !== row) {
                            beforeRow = r;
                            break;
                        }
                    }
                    el = el.nextElementSibling;
                }
                target = { toStage, beforeRow };
            }
        }

        if (slot?.parentNode) {
            slot.parentNode.insertBefore(card, slot);
            slot.remove();
        } else if (!card.isConnected && section.isConnected) {
            const fallback = section.querySelector('[data-planner-kanban-drop]');
            fallback?.appendChild(card);
        }
        resetKanbanCardStyles(card);

        if (commit && target) {
            mutate((it) => {
                it.planner.kanbanSort = 'manual';
                moveKanbanCard(it.planner, row, target.toStage, { beforeRow: target.beforeRow });
            }, { skipRerender: true, refreshGantt: true });
        }
    };

    const placeKanbanSlot = (clientX, clientY, slot, draggedRow) => {
        const board = section.querySelector('[data-planner-kanban-board]');
        if (!board) return;
        const cols = [...board.querySelectorAll('[data-planner-kanban-drop]')];
        let body = null;
        for (const col of cols) {
            const rect = col.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                body = col;
                break;
            }
        }
        if (!body) {
            // Nearest column by horizontal distance when pointer is between/above columns
            let best = null;
            let bestDist = Infinity;
            for (const col of cols) {
                const rect = col.getBoundingClientRect();
                const cx = (rect.left + rect.right) / 2;
                const dist = Math.abs(clientX - cx);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = col;
                }
            }
            body = best;
        }
        if (!body) return;

        clearKanbanColumnOver();
        body.classList.add('is-drag-over');

        const cards = [...body.querySelectorAll('[data-planner-kanban-card]')]
            .filter((c) => Number(c.dataset.plannerRow) !== draggedRow);
        if (!cards.length) {
            body.appendChild(slot);
            return;
        }
        for (const card of cards) {
            const rect = card.getBoundingClientRect();
            if (clientY < rect.top + rect.height / 2) {
                body.insertBefore(slot, card);
                return;
            }
        }
        body.appendChild(slot);
    };

    const liftKanbanCard = (state, clientX, clientY) => {
        if (state.lifted) return;
        const { card } = state;
        const rect = card.getBoundingClientRect();
        state.width = rect.width;
        state.height = rect.height;
        state.offsetX = clientX - rect.left;
        state.offsetY = clientY - rect.top;

        const slot = document.createElement('div');
        slot.className = 'planner-kanban__placeholder';
        slot.setAttribute('aria-hidden', 'true');
        slot.style.height = `${rect.height}px`;
        card.parentNode?.insertBefore(slot, card);
        state.slot = slot;

        document.body.appendChild(card);
        card.classList.add('is-planner-kanban-dragging');
        card.style.position = 'fixed';
        card.style.width = `${rect.width}px`;
        card.style.height = `${rect.height}px`;
        card.style.left = `${rect.left}px`;
        card.style.top = `${rect.top}px`;
        card.style.zIndex = '9999';
        card.style.pointerEvents = 'none';
        card.style.margin = '0';
        document.body.classList.add('is-planner-kanban-drag-active');
        state.lifted = true;
    };

    const onKanbanDocPointerMove = (e) => {
        const state = kanbanPtr;
        if (!state || state.pointerId !== e.pointerId) return;
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (!state.lifted) {
            if ((dx * dx + dy * dy) < KANBAN_DRAG_THRESHOLD * KANBAN_DRAG_THRESHOLD) return;
            e.preventDefault();
            liftKanbanCard(state, e.clientX, e.clientY);
        }
        if (!state.lifted) return;
        e.preventDefault();
        state.card.style.left = `${e.clientX - state.offsetX}px`;
        state.card.style.top = `${e.clientY - state.offsetY}px`;
        placeKanbanSlot(e.clientX, e.clientY, state.slot, state.row);
    };

    const onKanbanDocPointerUp = (e) => {
        const state = kanbanPtr;
        if (!state || (e.pointerId != null && state.pointerId !== e.pointerId)) return;
        document.removeEventListener('pointermove', onKanbanDocPointerMove);
        document.removeEventListener('pointerup', onKanbanDocPointerUp);
        document.removeEventListener('pointercancel', onKanbanDocPointerUp);
        endKanbanPointerDrag({ commit: state.lifted });
    };

    section.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('[data-planner-kanban-color], [data-planner-kanban-emphasis], [data-planner-kanban-reset-card], [data-planner-kanban-density], [data-planner-kanban-more], [data-planner-kanban-field], textarea, [contenteditable]')) return;
        const card = e.target.closest('[data-planner-kanban-card]');
        if (!card || !section.contains(card) || !card.classList.contains('is-editable')) return;
        const row = Number(card.dataset.plannerRow);
        if (!Number.isFinite(row)) return;
        // Abort any prior incomplete drag
        if (kanbanPtr) endKanbanPointerDrag({ commit: false });
        kanbanPtr = {
            card,
            row,
            slot: null,
            offsetX: 0,
            offsetY: 0,
            width: 0,
            height: 0,
            lifted: false,
            startX: e.clientX,
            startY: e.clientY,
            pointerId: e.pointerId
        };
        document.addEventListener('pointermove', onKanbanDocPointerMove, { passive: false });
        document.addEventListener('pointerup', onKanbanDocPointerUp);
        document.addEventListener('pointercancel', onKanbanDocPointerUp);
    });

    section.addEventListener('dragstart', (e) => {
        // Kanban uses pointer drag; block native HTML5 drag from cards.
        if (e.target.closest?.('[data-planner-kanban-card]')) {
            e.preventDefault();
            return;
        }
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

    // Column resize (table) + rail label width resize (chart)
    let resizeCol = null;
    let resizeStartX = 0;
    let resizeStartW = 0;
    let railResizing = false;
    section.addEventListener('mousedown', (e) => {
        const railHandle = e.target.closest('[data-planner-rail-resize]');
        if (railHandle && section.contains(railHandle)) {
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
            return;
        }

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

    let needsFocusRefresh = false;
    for (const body of noteBodiesForItem(item.id)) {
        // Focus panes host table/chart alone — full Plan section rebuild would clobber them.
        if (body.closest?.('#magic-focus')) {
            needsFocusRefresh = true;
            continue;
        }
        const canEdit = bodyCanEdit(body);
        const startCollapsed = false;
        const html = buildNotePlannerSectionHtml(item, { canEdit, startCollapsed });
        const existing = body.querySelector('[data-note-planner]');

        if (!html) {
            existing?.remove();
            continue;
        }

        const canvasScroll = captureCanvasScroll();
        const prevGanttViewport = existing?.querySelector?.('[data-planner-gantt-viewport]');
        const prevCalViewport = existing?.querySelector?.('[data-planner-calendar-viewport]');
        const prevViewport = prevGanttViewport || prevCalViewport;
        const preserveGanttScroll = prevViewport
            ? { left: prevViewport.scrollLeft, top: prevGanttViewport ? prevGanttViewport.scrollTop : 0 }
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
    if (needsFocusRefresh) {
        import('./magicFocus.js').then(({ MagicFocus }) => {
            if (MagicFocus.isOpen() && MagicFocus.getActiveItemId() === item.id) {
                MagicFocus.refreshPlannerPanes?.(item);
            }
        }).catch(() => {});
    }
}

export { createEmptyPlanner, normalizePlanner, plannerHasContent };
