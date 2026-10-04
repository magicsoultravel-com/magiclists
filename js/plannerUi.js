/** @module {"owns":"magicPlanner note subsection UI facade — section HTML, commit flush, interaction orchestration across sheet/chart/kanban/wbs", "related":["plannerSheetUi.js","plannerChartUi.js","plannerKanbanUi.js","plannerWbsUi.js","planner.js","plannerGantt.js","plannerKanban.js","plannerWbs.js","plannerCalendar.js","noteSurfaceMutations.js","noteQuickActions.js"]} */
import { mutateItem, emitItemMutation } from './noteSurfaceMutations.js';
import { UndoManager } from './undo.js';
import { refreshNoteCanvasPreview } from './noteCanvasRenderer.js';
import { combineDateTime } from './noteModel.js';
import {
    createEmptyPlanner,
    normalizePlanner,
    normalizePlannerChartView,
    plannerHasContent,
    isPlannerUnsupportedNewer,
    isPlannerWritable,
    setCellValue,
    setPlannerField,
    derivePlannerTasks
} from './planner.js';
import { layoutPlannerGantt } from './plannerGantt.js';
import { renderPlannerCalendarBoardHtml } from './plannerCalendar.js';

import {
    renderPlannerSheetHtml,
    renderPlannerSummaryHtml,
    renderPlannerTableHtml,
    handleSheetClick,
    bindSheet,
    captureCanvasScroll,
    restoreCanvasScroll
} from './plannerSheetUi.js';
import {
    renderPlannerGanttHtml,
    measureGanttRailRowHeight,
    refreshGanttInSection,
    mountGanttViewport,
    ganttLayoutOpts,
    handleChartClick,
    bindChart
} from './plannerChartUi.js';
import {
    renderPlannerKanbanHtml,
    refreshKanbanInSection,
    handleKanbanClick,
    bindKanban,
    closeOpenKanbanCardActions
} from './plannerKanbanUi.js';
import {
    renderPlannerWbsHtml,
    refreshWbsInSection,
    handleWbsClick,
    bindWbs,
    closeOpenWbsCardActions
} from './plannerWbsUi.js';

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

function refreshItemNoteCanvas(item) {
    if (!item?.id || !item?.canvas) return;
    for (const body of noteBodiesForItem(item.id)) {
        const section = body.querySelector('[data-note-attachments]');
        if (section) refreshNoteCanvasPreview(section, item);
    }
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
    if (section.matches?.('[data-focus-table-only], [data-focus-chart-only], [data-focus-kanban-only], [data-focus-wbs-only]')) return true;
    // Require editable chrome — readonly cards also carry [data-planner-kanban-card].
    if (section.querySelector?.('.planner-cell-input, [data-planner-rail-resize], .planner-kanban__card.is-editable, [data-planner-kanban-field], .planner-wbs__card.is-editable, [data-planner-wbs-field]')) {
        return true;
    }
    return bodyCanEdit(section.closest('.editor-note-body') || section);
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
    if (isPlannerUnsupportedNewer(planner)) {
        return `
            <div class="note-body-section note-body-section--planner" data-note-planner data-planner-readonly="1">
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>Plan</span>
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    <div class="planner-version-banner" role="status">
                        This plan was saved with a newer app version. Reload the page to edit.
                    </div>
                </div>
            </div>`;
    }
    const edit = canEdit && isPlannerWritable(planner);
    const tableHtml = renderPlannerTableHtml(planner, { canEdit: edit });
    const { html: ganttHtml } = renderPlannerGanttHtml(planner, { canEdit: edit });
    const kanbanHtml = renderPlannerKanbanHtml(planner, { canEdit: edit });
    const wbsHtml = renderPlannerWbsHtml(planner, { canEdit: edit });

    return `
            <div class="note-body-section note-body-section--planner" data-note-planner>
                <div class="note-section-header collapsable-header">
                    <span class="collapsable-heading"><span class="collapsable-toggle${toggleCollapsed}">▼</span>Plan</span>
                </div>
                <div class="note-section-body collapsable-section${collapsedClass}">
                    ${tableHtml}
                    ${ganttHtml}
                    ${kanbanHtml}
                    ${wbsHtml}
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

    // After table cells so live kanban/wbs edits win over stale sheet inputs.
    section.querySelectorAll('[data-planner-kanban-field], [data-planner-wbs-field]').forEach((el) => {
        const row = Number(el.dataset.plannerRow);
        const key = String(el.dataset.plannerKanbanField || el.dataset.plannerWbsField || '');
        if (!Number.isFinite(row) || (key !== 'name' && key !== 'comments')) return;
        const value = key === 'name'
            ? String(el.textContent || '')
            : String(el.value ?? '');
        setPlannerField(sheet, row, key, value);
    });
}

/**
 * Keep table name/comments inputs aligned with a kanban/wbs field edit (same note hosts).
 * Prevents stale table DOM from overwriting the sheet on the next body sync.
 * @param {string} itemId
 * @param {number} row
 * @param {'name'|'comments'} key
 * @param {string} value
 */
function mirrorBoardFieldToTableDom(itemId, row, key, value) {
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

/** @deprecated alias — same as mirrorBoardFieldToTableDom */
function mirrorKanbanFieldToTableDom(itemId, row, key, value) {
    mirrorBoardFieldToTableDom(itemId, row, key, value);
}

/**
 * Refresh derived planner UI (gantt + kanban + wbs + summary) across all live hosts for an item.
 * @param {object} item
 * @param {{ refocus?: boolean }} [opts]
 */
export function refreshPlannerDerivedViews(item, { refocus = false } = {}) {
    if (!item?.id || !item?.planner) return;
    for (const body of noteBodiesForItem(item.id)) {
        body.querySelectorAll?.('[data-note-planner]').forEach((sec) => {
            refreshGanttInSection(sec, item, { refocus });
            refreshKanbanInSection(sec, item);
            refreshWbsInSection(sec, item);
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
        if (item.planner && isPlannerUnsupportedNewer(item.planner)) {
            window.alert?.('This plan was saved with a newer app version. Reload the page to edit.');
            return;
        }
        mutateItem(item, (it) => {
            if (!it.planner) it.planner = createEmptyPlanner();
            if (isPlannerUnsupportedNewer(it.planner)) return;
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

    const ctx = {
        section,
        item,
        mutate,
        schedulePlannerCommit,
        flushPlannerCommit,
        refresh,
        localOnly,
        onChange,
        growPlannerCell,
        mirrorBoardFieldToTableDom
    };

    bindSheet(ctx);
    bindChart(ctx);
    bindKanban(ctx);
    bindWbs(ctx);

    section.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const openKanban = section.querySelector('.planner-kanban__card-actions.is-actions-open');
            if (openKanban) {
                e.preventDefault();
                closeOpenKanbanCardActions(section);
                return;
            }
            const openWbs = section.querySelector('.planner-wbs__card-actions.is-actions-open');
            if (openWbs) {
                e.preventDefault();
                closeOpenWbsCardActions(section);
                return;
            }
        }
        // Planner fields skip the global UndoManager chord (contenteditable/input).
        // Flush pending debounce, then use app undo so table + boards stay aligned.
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
            const inPlannerEdit = e.target.closest?.(
                '[data-planner-cell], [data-planner-kanban-field], [data-planner-wbs-field], [data-planner-wbs-label], [data-planner-date], [data-planner-time], [data-planner-datetime]'
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
        const nameField = e.target.closest?.('[data-planner-kanban-field="name"], [data-planner-wbs-field="name"]');
        if (!nameField || !section.contains(nameField)) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            nameField.blur();
        }
    });

    document.addEventListener('pointerdown', (e) => {
        if (!section.isConnected) return;
        const openKanban = section.querySelector('.planner-kanban__card-actions.is-actions-open');
        if (openKanban && !openKanban.contains(e.target)) closeOpenKanbanCardActions(section);
        const openWbs = section.querySelector('.planner-wbs__card-actions.is-actions-open');
        if (openWbs && !openWbs.contains(e.target)) closeOpenWbsCardActions(section);
    }, true);

    // Click selectors verified exclusive across sheet/chart/kanban/wbs; dispatch order free.
    section.addEventListener('click', (e) => {
        if (handleSheetClick(ctx, e)) return;
        if (handleChartClick(ctx, e)) return;
        if (handleKanbanClick(ctx, e)) return;
        if (handleWbsClick(ctx, e)) return;
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

// Re-export public API for magicFocus, noteSurfaceHtml, noteSurfaceEditing, tests
export {
    renderPlannerSheetHtml,
    renderPlannerSummaryHtml,
    renderPlannerTableHtml,
    renderPlannerGanttHtml,
    measureGanttRailRowHeight,
    renderPlannerKanbanHtml,
    renderPlannerWbsHtml,
    createEmptyPlanner,
    normalizePlanner,
    plannerHasContent
};

