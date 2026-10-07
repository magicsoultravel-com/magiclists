/** @module {"owns":"magicPlanner sheet/table subsection UI — typed sheet, summary, datetime/category, row DnD, col resize, pack chrome", "related":["plannerUi.js","plannerChartUi.js","plannerKanbanUi.js","plannerWbsUi.js","planner.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { renderFocusSpawnSubTrayHtml } from './noteFocusSpawn.js';
import { parseStoredDateTime, combineDateTime } from './noteModel.js';
import { mutateItem } from './noteSurfaceMutations.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor } from './colorPicker.js';
import {
    PLANNER_COLUMNS,
    PLANNER_COL_COUNT,
    createEmptyPlanner,
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
    getPlannerOutlineLabel,
    getPlannerRowLevel,
    isPlannerRowPack,
    isPlannerRowHidden,
    isPlannerTablePackCollapsed,
    setPlannerTablePackCollapsed,
    togglePlannerWorkPack,
    unhidePlannerRow,
    getPlannerRowId,
    addPlannerPackChild,
    removePlannerPackChild,
    getPlannerRowBlock,
    getPlannerPackParentRow,
    syncPlannerPackChildCategories,
    addPlannerRow,
    removePlannerRow,
    movePlannerRow,
    adoptPlannerRowIntoPack
} from './planner.js';

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

/** Work-pack toggle — nested lines. */
const PLANNER_PACK_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false" aria-hidden="true"><path d="M2 3.2h8M2 6h8M4.2 8.8H10" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/></svg>';

const PLANNER_START_COL = PLANNER_COLUMNS.findIndex((c) => c.key === 'start');
const PLANNER_STOP_COL = PLANNER_COLUMNS.findIndex((c) => c.key === 'stop');

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
            <div class="planner-datetime__picks" role="group" aria-label="Date and time">
                <button type="button" class="card-act planner-datetime__pick" data-planner-pick="date" title="Set date" aria-label="Set date">${CARD_ICONS.calendar}</button>
                <button type="button" class="card-act planner-datetime__pick" data-planner-pick="time" title="Set time" aria-label="Set time">${CARD_ICONS.clock}</button>
            </div>
            <span class="planner-datetime__value${label ? '' : ' is-empty'}" data-planner-datetime-value>${escapeHTML(display)}</span>
            <input type="date" class="planner-datetime__native" data-planner-date tabindex="-1" value="${escapeAttr(parts.date || '')}"${minAttr} aria-hidden="true">
            <input type="time" class="planner-datetime__native" data-planner-time tabindex="-1" value="${escapeAttr(parts.time || '')}" step="60" aria-hidden="true">
        </div>
    </td>`;
}

function renderTextCell(value, row, col, canEdit, { key = '', packToggle = '', packLeading = '' } = {}) {
    const nameClass = key === 'name' ? ' planner-cell--name' : '';
    const body = canEdit
        ? `<textarea class="sheet-cell-input form-input planner-cell-input" data-planner-cell data-row="${row}" data-col="${col}" data-col-key="${escapeAttr(key)}" rows="1" spellcheck="false">${escapeHTML(value)}</textarea>`
        : `<span class="sheet-cell-read">${escapeHTML(value)}</span>`;
    // Inner flex wrapper keeps the chevron in flow (pushes text) without display:flex on <td>.
    const content = packLeading
        ? `<div class="planner-name-cell">${packLeading}${body}</div>`
        : body;
    return `<td class="sheet-grid__cell planner-cell${nameClass}">${content}${packToggle}</td>`;
}

function renderCategoryCell(value, row, col, canEdit, planner, { inherited = false } = {}) {
    const color = getCategoryColor(planner, value) || '';
    const swatchStyle = color ? ` style="background:${escapeAttr(color)}"` : '';
    if (!canEdit || inherited) {
        const inheritedClass = inherited ? ' planner-category--inherited' : '';
        const title = inherited ? ' title="Inherited from work pack"' : '';
        return `<td class="sheet-grid__cell planner-cell planner-cell--category">
            <div class="planner-category${inheritedClass}"${title}>
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
        const outline = getPlannerOutlineLabel(planner, r);
        const level = getPlannerRowLevel(planner, r);
        const isPack = isPlannerRowPack(planner, r);
        const hidden = isPlannerRowHidden(planner, r);
        const collapsed = isPack && isPlannerTablePackCollapsed(planner, r);
        // Hide table-collapsed children from the sheet body (WBS/chart fold is separate).
        if (level === 1) {
            const packParent = getPlannerPackParentRow(planner, r);
            if (packParent >= 0 && isPlannerTablePackCollapsed(planner, packParent)) continue;
        }
        const levelClass = level === 1 ? ' is-child' : (isPack ? ' is-pack' : '');
        const hiddenClass = hidden ? ' is-row-hidden' : '';
        const packHeadAttr = isPack
            ? ` data-planner-pack-head="${collapsed ? '1' : '0'}"`
            : '';
        const rowHead = canEdit
            ? `<th class="sheet-grid__row-head planner-row-head${levelClass}" scope="row" draggable="true" data-planner-row="${r}" title="Drag to reorder"${packHeadAttr}>${escapeHTML(outline)}</th>`
            : `<th class="sheet-grid__row-head${levelClass}" scope="row">${escapeHTML(outline)}</th>`;
        body += `<tr class="planner-grid__row${levelClass}${hiddenClass}" data-planner-row-index="${r}" data-planner-row-id="${escapeAttr(getPlannerRowId(planner, r))}">${rowHead}`;
        const rowStartDate = parseStoredDateTime(getPlannerField(sheet, r, 'start')).date || '';
        for (let c = 0; c < PLANNER_COL_COUNT; c++) {
            const colDef = PLANNER_COLUMNS[c];
            const value = getCellValue(sheet, r, c);
            if (colDef.type === 'datetime') {
                const minDate = colDef.key === 'stop' ? rowStartDate : '';
                body += renderDatetimeCell(value, r, c, canEdit, { minDate });
            } else if (colDef.type === 'category') {
                if (level === 1) {
                    const packParent = getPlannerPackParentRow(planner, r);
                    const inherited = packParent >= 0
                        ? getPlannerField(sheet, packParent, 'category')
                        : value;
                    body += renderCategoryCell(inherited, r, c, canEdit, planner, { inherited: true });
                } else {
                    body += renderCategoryCell(value, r, c, canEdit, planner);
                }
            } else if (colDef.key === 'name' && level === 0) {
                const { end } = isPack ? getPlannerRowBlock(planner, r) : { end: r + 1 };
                const childCount = isPack ? Math.max(0, end - r - 1) : 0;
                const collapseTitle = collapsed ? 'Expand work pack' : 'Collapse work pack';
                // Same ▼ / rotate chevron as WBS pack cards — always visible in the name title.
                const packLeading = isPack && childCount
                    ? `<button type="button" class="planner-pack-collapse collapsable-toggle${collapsed ? ' collapsed' : ''}" data-planner-pack-collapse data-row="${r}" data-collapsed="${collapsed ? '1' : '0'}" title="${escapeAttr(collapseTitle)}" aria-label="${escapeAttr(collapseTitle)}" aria-expanded="${collapsed ? 'false' : 'true'}">▼</button>`
                    : '';
                if (canEdit) {
                    const pressed = isPack ? 'true' : 'false';
                    const packToggle = `<button type="button" class="planner-pack-toggle" data-planner-pack-toggle data-row="${r}" title="${isPack ? 'Convert to single task' : 'Convert to work pack'}" aria-label="${isPack ? 'Convert to single task' : 'Convert to work pack'}" aria-pressed="${pressed}">${PLANNER_PACK_ICON}</button>`;
                    const packLines = isPack
                        ? `<span class="planner-pack-lines" role="group" aria-label="Work pack lines">
                            <button type="button" class="planner-pack-line-btn" data-planner-pack-add data-row="${r}" title="Add line" aria-label="Add line">${ACTION_ICONS.plus}</button>
                            <button type="button" class="planner-pack-line-btn" data-planner-pack-remove data-row="${r}" title="Remove last line" aria-label="Remove last line"${childCount ? '' : ' disabled'}>${ACTION_ICONS.minus}</button>
                        </span>`
                        : '';
                    body += renderTextCell(value, r, c, canEdit, {
                        key: colDef.key,
                        packLeading,
                        packToggle: packToggle + packLines
                    });
                } else {
                    body += renderTextCell(value, r, c, canEdit, { key: colDef.key, packLeading });
                }
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
            ${renderFocusSpawnSubTrayHtml('table', 'Table')}
        </div>
        <div class="planner-sub__body${bodyCollapsed}" data-planner-table-body>
            ${sheetHtml}
            ${summaryHtml}
        </div>
    </div>`;
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

function closePlannerTimePanels(root = document) {
    root.querySelectorAll?.('[data-planner-time-pop]').forEach((pop) => {
        pop.hidden = true;
    });
    if (closePlannerTimePanels._onPointer) {
        document.removeEventListener('pointerdown', closePlannerTimePanels._onPointer, true);
        closePlannerTimePanels._onPointer = null;
    }
}

/**
 * In-cell time popover (time field + Clear). Stays under the cell — no body portal / board-zoom drift.
 * @param {HTMLElement} wrap
 * @param {{ commitDatetimeWrap: Function }} opts
 */
function openPlannerTimePanel(wrap, { commitDatetimeWrap } = {}) {
    if (!wrap) return;
    const timeInput = wrap.querySelector('[data-planner-time]');
    if (!timeInput) return;

    let pop = wrap.querySelector('[data-planner-time-pop]');
    if (pop && !pop.hidden) {
        closePlannerTimePanels();
        return;
    }

    closePlannerTimePanels();
    closePlannerCategoryMenus();

    if (!pop) {
        pop = document.createElement('div');
        pop.className = 'planner-datetime__time-pop';
        pop.setAttribute('data-planner-time-pop', '1');
        pop.innerHTML = `
            <input type="time" class="planner-datetime__time-pop-input" data-planner-time-pop-input step="60" value="">
            <button type="button" class="planner-datetime__time-pop-clear" data-planner-time-pop-clear>Clear</button>
        `;
        wrap.appendChild(pop);

        const panelInput = pop.querySelector('[data-planner-time-pop-input]');
        const clearBtn = pop.querySelector('[data-planner-time-pop-clear]');

        const applyFromPanel = () => {
            const hostTime = wrap.querySelector('[data-planner-time]');
            if (hostTime) hostTime.value = panelInput?.value || '';
            commitDatetimeWrap?.(wrap);
        };

        panelInput?.addEventListener('change', () => {
            applyFromPanel();
            closePlannerTimePanels();
        });
        panelInput?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyFromPanel();
                closePlannerTimePanels();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                closePlannerTimePanels();
            }
        });
        clearBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (panelInput) panelInput.value = '';
            const hostTime = wrap.querySelector('[data-planner-time]');
            if (hostTime) hostTime.value = '';
            commitDatetimeWrap?.(wrap);
            closePlannerTimePanels();
        });
        pop.addEventListener('mousedown', (e) => e.stopPropagation());
        pop.addEventListener('click', (e) => e.stopPropagation());
    }

    const panelInput = pop.querySelector('[data-planner-time-pop-input]');
    if (panelInput) panelInput.value = timeInput.value || '';
    pop.hidden = false;

    const onPointer = (e) => {
        if (wrap.contains(e.target)) return;
        closePlannerTimePanels();
    };
    closePlannerTimePanels._onPointer = onPointer;
    document.addEventListener('pointerdown', onPointer, true);

    requestAnimationFrame(() => {
        panelInput?.focus();
    });
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

function openPlannerCategoryMenu(wrap, item, { mutate, refresh } = {}) {
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
        let syncedPack = false;
        mutate?.((it) => {
            if (!it.planner) it.planner = createEmptyPlanner();
            if (Number.isFinite(row) && Number.isFinite(col)) {
                setCellValue(it.planner.sheet, row, col, name);
                if (isPlannerRowPack(it.planner, row)) {
                    syncPlannerPackChildCategories(it.planner, row);
                    syncedPack = true;
                }
            }
        }, { refreshGantt: true });
        const known = getCategoryColor(item.planner, name);
        const swatch = wrap.querySelector('[data-planner-category-color]');
        if (swatch) swatch.style.background = known || '';
        closePlannerCategoryMenus();
        if (syncedPack && refresh) {
            refresh();
            return;
        }
        input.focus();
        // Do not call syncNotePlannerDom — mutate already refreshes Gantt.
    });
}

/**
 * @param {HTMLElement} section
 * @param {object} item
 */
export function refreshPlannerSummaryInSection(section, item) {
    const host = section?.querySelector('[data-planner-summary]');
    if (!host || !item?.planner) return;
    const canvasScroll = captureCanvasScroll();
    const tmp = document.createElement('div');
    tmp.innerHTML = renderPlannerSummaryHtml(item.planner).trim();
    const next = tmp.firstElementChild;
    if (next) host.replaceWith(next);
    restoreCanvasScroll(canvasScroll);
}

export { captureCanvasScroll, restoreCanvasScroll };

/**
 * Build datetime commit helpers closed over ctx.mutate / section.
 * @param {{ section: HTMLElement, item: object, mutate: Function }} ctx
 */
function makeDatetimeHelpers(ctx) {
    const { section, mutate } = ctx;

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
        if (col === PLANNER_START_COL) {
            const clampedStop = syncStopMinFromRowStart(section, row, { clampValue: true });
            if (clampedStop) commitDatetimeWrap(clampedStop);
            if (openStopAfter && date) openStopDateAfterStart(row);
        }
    };

    return { commitDatetimeWrap, openStopDateAfterStart };
}

/**
 * Sheet click handler.
 * Click selectors verified exclusive across sheet/chart/kanban/wbs; dispatch order free.
 * @param {object} ctx
 * @param {Event} e
 * @returns {boolean} true if handled
 */
export function handleSheetClick(ctx, e) {
    const { section, item, mutate, refresh } = ctx;
    const { commitDatetimeWrap } = makeDatetimeHelpers(ctx);

    const catMenuBtn = e.target.closest('[data-planner-category-menu]');
    if (catMenuBtn && section.contains(catMenuBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const wrap = catMenuBtn.closest('[data-planner-category]');
        openPlannerCategoryMenu(wrap, item, { mutate, refresh });
        return true;
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
        if (!Number.isFinite(row)) return true;
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
        return true;
    }

    const pickBtn = e.target.closest('[data-planner-pick]');
    if (pickBtn && section.contains(pickBtn)) {
        e.preventDefault();
        e.stopPropagation();
        const wrap = pickBtn.closest('[data-planner-datetime]');
        if (!wrap) return true;
        const kind = pickBtn.dataset.plannerPick;
        const dateInput = wrap.querySelector('[data-planner-date]');
        const col = Number(wrap.dataset.col);
        const row = Number(wrap.dataset.row);
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
        if (kind === 'time') {
            openPlannerTimePanel(wrap, { commitDatetimeWrap });
            return true;
        }
        openPlannerNativePicker(dateInput);
        return true;
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
        return true;
    }

    const packToggle = e.target.closest('[data-planner-pack-toggle]');
    if (packToggle && section.contains(packToggle)) {
        e.preventDefault();
        e.stopPropagation();
        const row = Number(packToggle.dataset.row);
        if (!Number.isFinite(row)) return true;
        mutate((it) => {
            togglePlannerWorkPack(it.planner, row);
        }, { skipRerender: true, refreshGantt: true });
        refresh();
        return true;
    }

    const packCollapse = e.target.closest('[data-planner-pack-collapse]');
    if (packCollapse && section.contains(packCollapse)) {
        e.preventDefault();
        e.stopPropagation();
        const row = Number(packCollapse.dataset.row);
        if (!Number.isFinite(row)) return true;
        const collapsed = packCollapse.dataset.collapsed === '1';
        mutate((it) => {
            setPlannerTablePackCollapsed(it.planner, row, !collapsed);
        }, { skipRerender: true, refreshGantt: false });
        refresh();
        return true;
    }

    const packAdd = e.target.closest('[data-planner-pack-add]');
    if (packAdd && section.contains(packAdd)) {
        e.preventDefault();
        e.stopPropagation();
        const row = Number(packAdd.dataset.row);
        if (!Number.isFinite(row)) return true;
        mutate((it) => {
            addPlannerPackChild(it.planner, row);
        }, { skipRerender: true, refreshGantt: true });
        refresh();
        return true;
    }

    const packRemove = e.target.closest('[data-planner-pack-remove]');
    if (packRemove && section.contains(packRemove)) {
        e.preventDefault();
        e.stopPropagation();
        const row = Number(packRemove.dataset.row);
        if (!Number.isFinite(row)) return true;
        mutate((it) => {
            removePlannerPackChild(it.planner, row);
        }, { skipRerender: true, refreshGantt: true });
        refresh();
        return true;
    }

    const addBtn = e.target.closest('.planner-add-row-btn');
    if (addBtn && section.contains(addBtn)) {
        e.preventDefault();
        e.stopPropagation();
        mutate((it) => addPlannerRow(it.planner), { skipRerender: true, refreshGantt: false });
        refresh();
        return true;
    }

    const removeBtn = e.target.closest('.planner-remove-row-btn');
    if (removeBtn && section.contains(removeBtn)) {
        e.preventDefault();
        e.stopPropagation();
        mutate((it) => removePlannerRow(it.planner), { skipRerender: true, refreshGantt: false });
        refresh();
        return true;
    }

    return false;
}

/**
 * Register sheet non-click listeners (input/change/focus/col-resize/row-dnd).
 * @param {object} ctx
 */
export function bindSheet(ctx) {
    const {
        section, item, mutate, schedulePlannerCommit, flushPlannerCommit,
        refresh, localOnly, onChange, growPlannerCell
    } = ctx;
    const { commitDatetimeWrap } = makeDatetimeHelpers(ctx);

    section.addEventListener('input', (e) => {
        const cell = e.target.closest('[data-planner-cell]');
        if (!cell || !section.contains(cell)) return;
        const row = Number(cell.dataset.row);
        const col = Number(cell.dataset.col);
        if (!Number.isFinite(row) || !Number.isFinite(col)) return;
        const key = cell.dataset.colKey || '';
        // Child categories are inherited from the pack parent — ignore edits.
        if (key === 'category' && item.planner && getPlannerRowLevel(item.planner, row) === 1) {
            return;
        }
        if (key === 'name' && item.planner && isPlannerRowHidden(item.planner, row)) {
            unhidePlannerRow(item.planner, row);
        }
        schedulePlannerCommit({ refreshGantt: true });
        if (!item.planner) item.planner = createEmptyPlanner();
        setCellValue(item.planner.sheet, row, col, cell.value);
        if (key === 'category') {
            const known = getCategoryColor(item.planner, cell.value);
            const wrap = cell.closest('[data-planner-category]');
            const swatch = wrap?.querySelector?.('[data-planner-category-color]');
            if (swatch) swatch.style.background = known || '';
            if (isPlannerRowPack(item.planner, row)) {
                syncPlannerPackChildCategories(item.planner, row);
                const { end } = getPlannerRowBlock(item.planner, row);
                for (let r = row + 1; r < end; r++) {
                    const tr = section.querySelector(`tr[data-planner-row-index="${r}"]`);
                    const inherited = tr?.querySelector?.('.planner-category--inherited');
                    if (!inherited) continue;
                    const read = inherited.querySelector('.sheet-cell-read');
                    const childSwatch = inherited.querySelector('.planner-category__swatch');
                    if (read) read.textContent = cell.value;
                    if (childSwatch) childSwatch.style.background = known || '';
                }
            }
        }
        growPlannerCell?.(cell);
    });

    section.addEventListener('change', (e) => {
        if (e.target.matches('[data-planner-date], [data-planner-time]')) {
            const wrap = e.target.closest('[data-planner-datetime]');
            const isDate = e.target.matches('[data-planner-date]');
            commitDatetimeWrap(wrap, { openStopAfter: isDate });
        }
    });

    section.addEventListener('focusin', (e) => {
        const catInput = e.target.closest?.('.planner-category__input');
        if (catInput && section.contains(catInput)) {
            const wrap = catInput.closest('[data-planner-category]');
            const openPanel = document.querySelector('[data-planner-category-panel]');
            const ownsOpen = openPanel
                && openPanel.dataset.ownerRow === String(wrap?.dataset?.row ?? '')
                && openPanel.dataset.ownerCol === String(wrap?.dataset?.col ?? '');
            if (!ownsOpen) {
                openPlannerCategoryMenu(wrap, item, { mutate, refresh });
            }
        }
    });

    section.addEventListener('focusout', (e) => {
        const leaving = e.target.closest('[data-planner-cell], [data-planner-datetime]');
        if (!leaving || !section.contains(leaving)) return;
        // Skip if leaving into kanban/wbs field — those have their own focusout handlers.
        if (e.target.closest?.('[data-planner-kanban-field], [data-planner-wbs-field]')) return;
        flushPlannerCommit();
    });

    // Table row HTML5 reorder
    let dragFrom = null;
    section.addEventListener('dragstart', (e) => {
        if (e.target.closest?.('[data-planner-kanban-card], [data-planner-wbs-card]')) {
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
        section.querySelectorAll('tr.is-drag-over, tr.is-drag-over-pack').forEach((el) => {
            el.classList.remove('is-drag-over', 'is-drag-over-pack');
        });
        row.classList.add('is-drag-over');
        const toIndex = Number(row.dataset.plannerRowIndex);
        if (
            Number.isFinite(toIndex)
            && item.planner
            && isPlannerRowPack(item.planner, toIndex)
            && getPlannerRowLevel(item.planner, toIndex) === 0
            && toIndex !== dragFrom
            && getPlannerPackParentRow(item.planner, dragFrom) !== toIndex
        ) {
            row.classList.add('is-drag-over-pack');
        }
    });
    section.addEventListener('drop', (e) => {
        const row = e.target.closest('tr[data-planner-row-index]');
        if (!row || !section.contains(row) || dragFrom == null) return;
        e.preventDefault();
        const toIndex = Number(row.dataset.plannerRowIndex);
        section.querySelectorAll('tr.is-drag-over, tr.is-drag-over-pack, tr.is-dragging').forEach((el) => {
            el.classList.remove('is-drag-over', 'is-drag-over-pack', 'is-dragging');
        });
        if (!Number.isFinite(toIndex) || toIndex === dragFrom) {
            dragFrom = null;
            return;
        }
        const from = dragFrom;
        dragFrom = null;
        mutate((it) => {
            const packDrop = isPlannerRowPack(it.planner, toIndex)
                && getPlannerRowLevel(it.planner, toIndex) === 0;
            if (packDrop) {
                if (!adoptPlannerRowIntoPack(it.planner, from, toIndex)) {
                    // Already a child of this pack (or invalid) — leave order alone.
                }
            } else {
                movePlannerRow(it.planner, from, toIndex);
            }
        }, { skipRerender: true, refreshGantt: true });
        refresh();
    });
    section.addEventListener('dragend', () => {
        dragFrom = null;
        section.querySelectorAll('tr.is-drag-over, tr.is-drag-over-pack, tr.is-dragging').forEach((el) => {
            el.classList.remove('is-drag-over', 'is-drag-over-pack', 'is-dragging');
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
