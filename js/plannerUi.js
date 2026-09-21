/** @module {"owns":"magicPlanner note subsection UI — typed sheet + Gantt", "related":["planner.js","plannerGantt.js","noteSurfaceMutations.js","noteQuickActions.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { parseStoredDateTime, combineDateTime } from './noteModel.js';
import { mutateItem } from './noteSurfaceMutations.js';
import {
    PLANNER_COLUMNS,
    PLANNER_COL_COUNT,
    PLANNER_ZOOM_LEVELS,
    createEmptyPlanner,
    normalizePlanner,
    ensurePlannerVisibleIfContent,
    addPlannerRow,
    removePlannerRow,
    derivePlannerTasks,
    getCellValue,
    setCellValue,
    getColWidth,
    setColWidth,
    sheetGridTotalWidthPx,
    ensurePlannerColWidths,
    SHEET_MIN_ROWS,
    SHEET_ROW_HEAD_WIDTH_PX,
    plannerHasContent
} from './planner.js';
import { layoutPlannerGantt } from './plannerGantt.js';

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

function renderDatetimeCell(value, row, col, canEdit) {
    const parts = parseStoredDateTime(value);
    const label = formatPlannerDatetimeLabel(value);
    const display = label || '—';
    if (!canEdit) {
        return `<td class="sheet-grid__cell planner-cell planner-cell--datetime"><span class="sheet-cell-read">${escapeHTML(label)}</span></td>`;
    }
    return `<td class="sheet-grid__cell planner-cell planner-cell--datetime">
        <div class="planner-datetime" data-planner-datetime data-row="${row}" data-col="${col}">
            <span class="planner-datetime__value${label ? '' : ' is-empty'}" data-planner-datetime-value>${escapeHTML(display)}</span>
            <button type="button" class="card-act planner-datetime__pick" data-planner-pick="date" title="Set date" aria-label="Set date">${CARD_ICONS.calendar}</button>
            <button type="button" class="card-act planner-datetime__pick" data-planner-pick="time" title="Set time" aria-label="Set time">${CARD_ICONS.clock}</button>
            <input type="date" class="planner-datetime__native" data-planner-date tabindex="-1" value="${escapeAttr(parts.date || '')}" aria-hidden="true">
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

/**
 * @param {object} sheet
 * @param {{ canEdit?: boolean }} [opts]
 * @returns {string}
 */
export function renderPlannerSheetHtml(sheet, { canEdit = false } = {}) {
    if (!sheet) return '';
    ensurePlannerColWidths(sheet);
    const rows = sheet.rows || SHEET_MIN_ROWS;
    const canRemoveRow = rows > SHEET_MIN_ROWS;
    const totalW = sheetGridTotalWidthPx(sheet, { includeStructCol: false });

    let colgroup = `<col class="sheet-grid__row-head-col" style="width:${SHEET_ROW_HEAD_WIDTH_PX}px">`;
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
        body += `<tr><th class="sheet-grid__row-head" scope="row">${r + 1}</th>`;
        for (let c = 0; c < PLANNER_COL_COUNT; c++) {
            const colDef = PLANNER_COLUMNS[c];
            const value = getCellValue(sheet, r, c);
            if (colDef.type === 'datetime') {
                body += renderDatetimeCell(value, r, c, canEdit);
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
        majors = [], minors = [], ticks, bars, edges, todayX, empty
    } = layout;
    const minorTicks = minors.length ? minors : (ticks || []);
    const majorY = majorBandH > 0 ? majorBandH - 3 : 0;
    const minorY = headerHeight - 4;

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
        const label = t.label
            ? `<text class="planner-gantt__tick-label" x="${t.x + 2}" y="${minorY}">${escapeHTML(t.label)}</text>`
            : '';
        return `<line class="${cls}" x1="${t.x}" y1="${majorBandH}" x2="${t.x}" y2="${height}"/>${label}`;
    }).join('');

    const edgePaths = edges.map((e) => {
        const parts = e.path.match(/-?\d+(?:\.\d+)?/g) || [];
        if (parts.length < 6) return '';
        const [x1, y1, midX, y2, , x2] = parts.map(Number);
        return `<path class="planner-gantt__edge" d="M${x1},${y1} H${midX} V${y2} H${x2}" fill="none"/>`;
    }).join('');

    const barEls = bars.map((b) => {
        const title = escapeHTML(b.name || b.id || 'Task');
        return `<g class="planner-gantt__bar-group" data-task-id="${escapeAttr(b.id)}">
            <title>${title}</title>
            <rect class="planner-gantt__bar" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="2"/>
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

    return `<svg class="planner-gantt__svg" width="${chartWidth}" height="${height}" viewBox="0 0 ${chartWidth} ${height}" role="img" aria-label="Planner Gantt chart">
        ${axisBg}
        <rect class="planner-gantt__bg" x="0" y="${headerHeight}" width="${chartWidth}" height="${Math.max(0, height - headerHeight)}"/>
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

/**
 * Focus the viewport on today (if in range) or the midpoint of task bars.
 * @param {HTMLElement} viewport
 * @param {object} layout
 * @param {number|null} [preserveScrollLeft]
 */
function focusGanttViewport(viewport, layout, preserveScrollLeft = null) {
    if (!viewport || !layout) return;
    if (preserveScrollLeft != null && Number.isFinite(preserveScrollLeft)) {
        viewport.scrollLeft = Math.max(0, Math.min(preserveScrollLeft, viewport.scrollWidth - viewport.clientWidth));
        return;
    }
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
 * @param {object} planner
 * @returns {{ html: string, layout: object }}
 */
export function renderPlannerGanttHtml(planner) {
    const zoom = planner?.zoom || 'week';
    const tasks = derivePlannerTasks(planner);
    const layout = layoutPlannerGantt(tasks, { zoom });
    const zoomBtns = PLANNER_ZOOM_LEVELS.map((z) => {
        const active = z === zoom ? ' is-active' : '';
        const label = z.charAt(0).toUpperCase() + z.slice(1);
        return `<button type="button" class="btn btn--compact planner-zoom-btn${active}" data-planner-zoom="${z}" aria-pressed="${z === zoom ? 'true' : 'false'}">${label}</button>`;
    }).join('');

    const html = `<div class="planner-gantt" data-planner-gantt data-planner-zoom-current="${escapeAttr(zoom)}">
        <div class="planner-gantt__toolbar">
            <span class="planner-gantt__title">Gantt</span>
            <div class="planner-gantt__zoom" role="group" aria-label="Gantt zoom">${zoomBtns}</div>
        </div>
        <div class="planner-gantt__board">
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
    ensurePlannerVisibleIfContent(item);
    if (!item?.planner) return '';

    const visible = !item.plannerHidden;
    const planner = normalizePlanner(item.planner) || item.planner;
    const hiddenClass = visible ? '' : ' is-hidden';
    const collapsedClass = startCollapsed ? ' collapsed' : '';
    const toggleCollapsed = startCollapsed ? ' collapsed' : '';
    const sheetHtml = renderPlannerSheetHtml(planner.sheet, { canEdit });
    const { html: ganttHtml } = renderPlannerGanttHtml(planner);

    return `
            <div class="note-body-section note-body-section--planner${hiddenClass}" data-note-planner ${visible ? '' : 'hidden'}>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>Planner</span>
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    ${sheetHtml}
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

function mountGanttViewport(host, layout, { preserveScrollLeft = null, refocus = false } = {}) {
    const viewport = host?.querySelector?.('[data-planner-gantt-viewport]');
    if (!viewport) return;
    bindGanttPan(viewport);
    requestAnimationFrame(() => {
        focusGanttViewport(viewport, layout, refocus ? null : preserveScrollLeft);
    });
}

function refreshGanttInSection(section, item, { refocus = false } = {}) {
    const host = section?.querySelector('[data-planner-gantt]');
    if (!host || !item?.planner) return;
    const prevZoom = host.dataset.plannerZoomCurrent || '';
    const prevViewport = host.querySelector('[data-planner-gantt-viewport]');
    const preserveScrollLeft = prevViewport ? prevViewport.scrollLeft : null;
    const { html, layout } = renderPlannerGanttHtml(item.planner);
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const next = tmp.firstElementChild;
    if (!next) return;
    host.replaceWith(next);
    const zoomChanged = (layout.zoom || '') !== prevZoom;
    mountGanttViewport(next, layout, {
        preserveScrollLeft,
        refocus: refocus || zoomChanged
    });
}

function growPlannerTextareas(section) {
    section?.querySelectorAll('.planner-cell-input').forEach((el) => {
        el.style.height = '0';
        el.style.height = `${Math.max(el.scrollHeight, 18)}px`;
    });
}

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
    refresh = () => {}
} = {}) {
    const section = root?.querySelector?.('[data-note-planner]') || root?.closest?.('[data-note-planner]');
    if (!section || !item?.planner) return;

    bindPlannerSectionToggle(section);
    growPlannerTextareas(section);

    if (section.dataset.plannerBound === '1') return;
    section.dataset.plannerBound = '1';

    // First bind: enable drag-pan and center on today / tasks.
    const ganttHost = section.querySelector('[data-planner-gantt]');
    if (ganttHost && item.planner) {
        const layout = layoutPlannerGantt(derivePlannerTasks(item.planner), { zoom: item.planner.zoom || 'week' });
        mountGanttViewport(ganttHost, layout, { refocus: true });
    }

    const mutate = (fn, { skipRerender = true, refreshGantt = true } = {}) => {
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
    };

    section.addEventListener('input', (e) => {
        const cell = e.target.closest('[data-planner-cell]');
        if (cell) {
            const row = Number(cell.dataset.row);
            const col = Number(cell.dataset.col);
            mutate((it) => {
                setCellValue(it.planner.sheet, row, col, cell.value);
            });
            growPlannerTextareas(section);
            return;
        }
        if (e.target.matches('[data-planner-date], [data-planner-time]')) {
            const wrap = e.target.closest('[data-planner-datetime]');
            commitDatetimeWrap(wrap);
        }
    });

    section.addEventListener('change', (e) => {
        if (e.target.matches('[data-planner-date], [data-planner-time]')) {
            const wrap = e.target.closest('[data-planner-datetime]');
            commitDatetimeWrap(wrap);
        }
    });

    section.addEventListener('click', (e) => {
        const pickBtn = e.target.closest('[data-planner-pick]');
        if (pickBtn && section.contains(pickBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const wrap = pickBtn.closest('[data-planner-datetime]');
            if (!wrap) return;
            const kind = pickBtn.dataset.plannerPick;
            const dateInput = wrap.querySelector('[data-planner-date]');
            const timeInput = wrap.querySelector('[data-planner-time]');
            if (kind === 'time' && dateInput && !dateInput.value) {
                dateInput.value = todayLocalDate();
            }
            openPlannerNativePicker(kind === 'time' ? timeInput : dateInput);
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
            // Zoom change is handled inside refreshGanttInSection (refocus).
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
    ensurePlannerVisibleIfContent(item);

    for (const body of noteBodiesForItem(item.id)) {
        const canEdit = bodyCanEdit(body);
        const startCollapsed = false;
        const html = buildNotePlannerSectionHtml(item, { canEdit, startCollapsed });
        const existing = body.querySelector('[data-note-planner]');

        if (!html) {
            existing?.remove();
            continue;
        }

        const tmp = document.createElement('div');
        tmp.innerHTML = html.trim();
        const next = tmp.firstElementChild;
        if (!next) continue;

        if (existing) {
            existing.replaceWith(next);
        } else {
            // Insert before media section if present, else append.
            const media = body.querySelector('[data-note-attachments]');
            if (media) body.insertBefore(next, media);
            else body.appendChild(next);
        }

        attachPlannerInteractions(body, item, {
            refresh: () => syncNotePlannerDom(item)
        });
    }
}

export { createEmptyPlanner, normalizePlanner, plannerHasContent };
