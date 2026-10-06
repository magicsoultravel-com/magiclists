/** @module {"owns":"magicPlanner Kanban subsection UI — board render, card chrome, pointer drag, field edit", "related":["plannerUi.js","plannerSheetUi.js","plannerChartUi.js","plannerWbsUi.js","planner.js","plannerKanban.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { renderFocusSpawnBtnHtml } from './noteFocusSpawn.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor } from './colorPicker.js';
import { surfaceThemeInline } from './cardTheme.js';
import { readDisplayOptions } from './displayOptions.js';
import {
    normalizePlanner,
    getCategoryColor,
    getPlannerField,
    setPlannerField,
    getPlannerRowId,
    createEmptyPlanner,
    isPlannerUnsupportedNewer
} from './planner.js';
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
    setKanbanStageCollapsed,
    expandAllKanbanCards,
    collapseAllKanbanCards,
    resetKanbanCardStyles,
    resetAllKanbanCardStyles,
    resetKanbanArrangement
} from './plannerKanban.js';

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

function growPlannerCellLocal(el) {
    if (!el || !el.style) return;
    el.style.height = '0';
    const next = Math.max(el.scrollHeight, 18);
    if (el.matches?.('textarea.planner-kanban__card-comment') && document.activeElement !== el) {
        const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || 14;
        const hasText = String(el.value || '').trim().length > 0;
        el.style.height = `${Math.min(next, Math.round(lh * (hasText ? 3 : 1)))}px`;
        return;
    }
    el.style.height = `${next}px`;
}

function growPlannerTextareasLocal(section) {
    const canvasScroll = captureCanvasScroll();
    section?.querySelectorAll('.planner-cell-input, textarea.planner-kanban__card-comment').forEach((el) => {
        growPlannerCellLocal(el);
    });
    restoreCanvasScroll(canvasScroll);
}

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

    // Collapsed stages first (stage order), then open stages (stage order).
    const orderedColumns = [
        ...layout.columns.filter((c) => c.collapsed),
        ...layout.columns.filter((c) => !c.collapsed)
    ];

    const columnsHtml = orderedColumns.map((col) => {
        const stageCollapsed = !!col.collapsed;
        const stageCollapsedClass = stageCollapsed ? ' is-collapsed' : '';
        const stageCollapseTitle = stageCollapsed ? 'Expand column' : 'Collapse column';
        // Collapse = chevron down; expand = chevron up (CARD_ICONS names are inverted for this chrome).
        const stageCollapseIcon = stageCollapsed ? CARD_ICONS.collapse : CARD_ICONS.expand;
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
                // Slot: editable when canEdit. Flyout: read-only full-content overlay (no layout push).
                const slotNameHtml = canEdit
                    ? `<div class="planner-kanban__card-name card-inline-edit" contenteditable="plaintext-only" data-planner-kanban-field="name" data-planner-row="${card.row}" spellcheck="false" role="textbox" aria-label="Name">${escapeHTML(nameText)}</div>`
                    : `<span class="planner-kanban__card-name">${escapeHTML(nameText)}</span>`;
                const slotCommentHtml = canEdit
                    ? `<textarea class="planner-kanban__card-comment card-inline-edit" data-planner-kanban-field="comments" data-planner-row="${card.row}" rows="1" spellcheck="false" aria-label="Comments">${escapeHTML(commentRaw)}</textarea>`
                    : (comment ? `<span class="planner-kanban__card-comment">${escapeHTML(comment)}</span>` : '');
                const flyoutNameHtml = `<span class="planner-kanban__card-name">${escapeHTML(nameText)}</span>`;
                const flyoutCommentHtml = comment
                    ? `<span class="planner-kanban__card-comment">${escapeHTML(comment)}</span>`
                    : '';
                const metaHtml = `${rowHtml}${startHtml}${stopHtml}`;
                const slotBody = `${metaHtml}
                    <div class="planner-kanban__card-top">${slotNameHtml}</div>
                    ${slotCommentHtml}`;
                const flyoutBody = `${metaHtml}
                    <div class="planner-kanban__card-top">${flyoutNameHtml}</div>
                    ${flyoutCommentHtml}`;
                const surface = surfaceThemeInline(card.cardColor);
                const colorClass = card.cardColor ? ` has-color${surface.className}` : '';
                return `<article class="planner-kanban__card${colorClass}${emphasisClass}${collapsedClass}${editClass}" data-planner-kanban-card data-planner-row="${card.row}" data-kanban-emphasis="${escapeAttr(emphasis)}" data-kanban-collapsed="${collapsed ? '1' : '0'}"${surface.style}>
                    <div class="planner-kanban__card-slot">${slotBody}</div>
                    <div class="planner-kanban__card-flyout" aria-hidden="true">${flyoutBody}</div>
                    ${actionsHtml}
                </article>`;
            }).join('')
            : '<div class="planner-kanban__empty-col" aria-hidden="true"></div>';
        return `<div class="planner-kanban__column${stageCollapsedClass}" data-planner-kanban-stage="${col.stage}" data-kanban-stage-collapsed="${stageCollapsed ? '1' : '0'}">
            <div class="planner-kanban__column-head">
                <span class="planner-kanban__column-title">${escapeHTML(col.label)}</span>
                <span class="planner-kanban__column-count">${col.cards.length}</span>
                <button type="button" class="planner-kanban__column-collapse" data-planner-kanban-stage-collapse title="${escapeAttr(stageCollapseTitle)}" aria-label="${escapeAttr(stageCollapseTitle)}" aria-expanded="${stageCollapsed ? 'false' : 'true'}">${stageCollapseIcon}</button>
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
                ${renderFocusSpawnBtnHtml('kanban', 'Kanban', { className: 'card-act planner-kanban-module-btn' })}
                <span class="planner-kanban__sort" role="group" aria-label="Kanban sort">${sortBtns}</span>
                ${moduleResetHtml}
            </div>
        </div>
        <div class="planner-kanban__board${boardCollapsed}" data-planner-kanban-board>
            ${columnsHtml}
        </div>
    </div>`;
}

export function refreshKanbanInSection(section, item) {
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
    if (isPlannerUnsupportedNewer(item.planner)) return;
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
    growPlannerTextareasLocal(next);
}
/**
 * @param {HTMLElement} section
 * @param {HTMLElement|null} [except]
 */
export function closeOpenKanbanCardActions(section, except = null) {
    section.querySelectorAll('.planner-kanban__card-actions.is-actions-open').forEach((el) => {
        if (except && el === except) return;
        el.classList.remove('is-actions-open');
        const more = el.querySelector('[data-planner-kanban-more]');
        if (more) more.setAttribute('aria-expanded', 'false');
    });
}

/**
 * Kanban click handler.
 * Click selectors verified exclusive across sheet/chart/kanban/wbs; dispatch order free.
 * @param {object} ctx
 * @param {Event} e
 * @returns {boolean}
 */
export function handleKanbanClick(ctx, e) {
    const { section, item, mutate } = ctx;

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
            return true;
        }

        const kanbanSortBtn = e.target.closest('[data-planner-kanban-sort]');
        if (kanbanSortBtn && section.contains(kanbanSortBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const mode = normalizeKanbanSort(kanbanSortBtn.dataset.plannerKanbanSort);
            if (mode !== 'row' && mode !== 'date' && mode !== 'alpha') return true;
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
            return true;
        }

        const kanbanStageCollapseBtn = e.target.closest('[data-planner-kanban-stage-collapse]');
        if (kanbanStageCollapseBtn && section.contains(kanbanStageCollapseBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const col = kanbanStageCollapseBtn.closest('[data-planner-kanban-stage]');
            const stage = Number(col?.dataset?.plannerKanbanStage);
            if (!Number.isFinite(stage)) return true;
            const nextCollapsed = col?.dataset?.kanbanStageCollapsed !== '1';
            mutate((it) => {
                setKanbanStageCollapsed(it.planner, stage, nextCollapsed);
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const kanbanExpandAllBtn = e.target.closest('[data-planner-kanban-expand-all]');
        if (kanbanExpandAllBtn && section.contains(kanbanExpandAllBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                expandAllKanbanCards(it.planner);
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const kanbanCollapseAllBtn = e.target.closest('[data-planner-kanban-collapse-all]');
        if (kanbanCollapseAllBtn && section.contains(kanbanCollapseAllBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                collapseAllKanbanCards(it.planner);
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const kanbanResetStylesBtn = e.target.closest('[data-planner-kanban-reset-styles]');
        if (kanbanResetStylesBtn && section.contains(kanbanResetStylesBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                resetAllKanbanCardStyles(it.planner);
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const kanbanResetArrangementBtn = e.target.closest('[data-planner-kanban-reset-arrangement]');
        if (kanbanResetArrangementBtn && section.contains(kanbanResetArrangementBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                resetKanbanArrangement(it.planner);
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const kanbanMoreBtn = e.target.closest('[data-planner-kanban-more]');
        if (kanbanMoreBtn && section.contains(kanbanMoreBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const actions = kanbanMoreBtn.closest('.planner-kanban__card-actions');
            if (!actions) return true;
            const willOpen = !actions.classList.contains('is-actions-open');
            closeOpenKanbanCardActions(section, willOpen ? actions : null);
            actions.classList.toggle('is-actions-open', willOpen);
            kanbanMoreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            return true;
        }

        const kanbanDensityBtn = e.target.closest('[data-planner-kanban-density]');
        if (kanbanDensityBtn && section.contains(kanbanDensityBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = kanbanDensityBtn.closest('[data-planner-kanban-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return true;
            const nextCollapsed = card?.dataset?.kanbanCollapsed !== '1';
            mutate((it) => {
                setKanbanCardCollapsed(it.planner, row, nextCollapsed);
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const kanbanEmphasisBtn = e.target.closest('[data-planner-kanban-emphasis]');
        if (kanbanEmphasisBtn && section.contains(kanbanEmphasisBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = kanbanEmphasisBtn.closest('[data-planner-kanban-card]');
            const row = Number(card?.dataset?.plannerRow);
            const mode = String(kanbanEmphasisBtn.dataset.plannerKanbanEmphasis || '');
            if (!Number.isFinite(row) || (mode !== 'urgent' && mode !== 'muted')) return true;
            mutate((it) => {
                setKanbanCardEmphasis(it.planner, row, mode);
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const kanbanResetCardBtn = e.target.closest('[data-planner-kanban-reset-card]');
        if (kanbanResetCardBtn && section.contains(kanbanResetCardBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = kanbanResetCardBtn.closest('[data-planner-kanban-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return true;
            mutate((it) => {
                resetKanbanCardStyles(it.planner, row);
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const kanbanColorBtn = e.target.closest('[data-planner-kanban-color]');
        if (kanbanColorBtn && section.contains(kanbanColorBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = kanbanColorBtn.closest('[data-planner-kanban-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return true;
            const rowId = getPlannerRowId(item.planner, row);
            const current = resolveNoteColor(
                (rowId && item.planner?.kanbanCardColors?.[rowId])
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
            return true;
        }

    return false;
}

/**
 * Pointer drag, field focus chrome, input.
 * @param {object} ctx
 */
export function bindKanban(ctx) {
    const {
        section, item, mutate, schedulePlannerCommit, flushPlannerCommit,
        growPlannerCell, mirrorBoardFieldToTableDom
    } = ctx;
    const grow = growPlannerCell || growPlannerCellLocal;

    section.addEventListener('input', (e) => {
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
            mirrorBoardFieldToTableDom?.(item.id, row, key, value);
            if (key === 'comments') grow(kanbanField);
        }
    });

    section.addEventListener('focusin', (e) => {
        const kanbanField = e.target.closest?.('[data-planner-kanban-field]');
        if (kanbanField && section.contains(kanbanField)) {
            const card = kanbanField.closest('[data-planner-kanban-card]');
            card?.classList.add('is-kanban-editing');
            if (kanbanField.dataset.plannerKanbanField === 'name') {
                kanbanField.dataset.kanbanNamePrev = String(kanbanField.textContent || '');
            }
            if (kanbanField.dataset.plannerKanbanField === 'comments') {
                grow(kanbanField);
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
                        mirrorBoardFieldToTableDom?.(item.id, row, 'name', prev);
                    }
                } else if (String(kanbanField.textContent || '') !== trimmed) {
                    kanbanField.textContent = trimmed;
                    const rowNum = Number(kanbanField.dataset.plannerRow);
                    if (Number.isFinite(rowNum) && item.planner?.sheet) {
                        setPlannerField(item.planner.sheet, rowNum, 'name', trimmed);
                        mirrorBoardFieldToTableDom?.(item.id, rowNum, 'name', trimmed);
                    }
                } else if (Number.isFinite(row)) {
                    mirrorBoardFieldToTableDom?.(item.id, row, 'name', trimmed);
                }
            }
            if (kanbanField.dataset.plannerKanbanField === 'comments') {
                const row = Number(kanbanField.dataset.plannerRow);
                if (Number.isFinite(row)) {
                    mirrorBoardFieldToTableDom?.(item.id, row, 'comments', String(kanbanField.value ?? ''));
                }
                requestAnimationFrame(() => grow(kanbanField));
            }
            flushPlannerCommit();
        }
    });

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
        const columns = [...board.querySelectorAll('.planner-kanban__column[data-planner-kanban-stage]')];
        let column = null;
        for (const col of columns) {
            const rect = col.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                column = col;
                break;
            }
        }
        if (!column) {
            // Nearest column by horizontal distance when pointer is between/above columns
            let best = null;
            let bestDist = Infinity;
            for (const col of columns) {
                const rect = col.getBoundingClientRect();
                const cx = (rect.left + rect.right) / 2;
                const dist = Math.abs(clientX - cx);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = col;
                }
            }
            column = best;
        }
        const body = column?.querySelector('[data-planner-kanban-drop]') || null;
        if (!body) return;

        clearKanbanColumnOver();
        body.classList.add('is-drag-over');

        // Collapsed columns: append at end (cards hidden; no mid-list insertion).
        if (column.classList.contains('is-collapsed')) {
            body.appendChild(slot);
            return;
        }

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

    /**
     * Flyout is pointer-events:none on editable cards (peek only). Detect
     * name/comment under the cursor via elementsFromPoint (includes pe:none)
     * so collapsed / overflow peeks can still enter inline edit.
     * @returns {{ card: HTMLElement, fieldKey: 'name'|'comments' } | null}
     */
    const kanbanFlyoutEditAt = (clientX, clientY) => {
        const stack = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(clientX, clientY)
            : [];
        for (const el of stack) {
            if (!(el instanceof Element)) continue;
            const flyout = el.closest?.('.planner-kanban__card-flyout');
            if (!flyout) continue;
            const card = flyout.closest('[data-planner-kanban-card]');
            if (!card || !section.contains(card) || !card.classList.contains('is-editable')) continue;
            if (el.closest?.('.planner-kanban__card-name')) return { card, fieldKey: 'name' };
            if (el.closest?.('.planner-kanban__card-comment')) return { card, fieldKey: 'comments' };
        }
        return null;
    };

    section.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('[data-planner-kanban-field], textarea, [contenteditable]')) return;
        if (e.target.closest?.('[data-planner-kanban-color], [data-planner-kanban-emphasis], [data-planner-kanban-reset-card], [data-planner-kanban-density], [data-planner-kanban-more]')) return;
        const hit = kanbanFlyoutEditAt(e.clientX, e.clientY);
        if (!hit) return;
        hit.card.classList.add('is-kanban-editing');
        const field = hit.card.querySelector(`[data-planner-kanban-field="${hit.fieldKey}"]`);
        requestAnimationFrame(() => {
            field?.focus?.();
            if (hit.fieldKey === 'comments' && field) grow(field);
        });
    }, true);

    section.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('[data-planner-kanban-color], [data-planner-kanban-emphasis], [data-planner-kanban-reset-card], [data-planner-kanban-density], [data-planner-kanban-more], [data-planner-kanban-field], textarea, [contenteditable]')) return;
        const card = e.target.closest('[data-planner-kanban-card]');
        if (!card || !section.contains(card) || !card.classList.contains('is-editable')) return;
        // Flyout peek name/body → edit, not drag.
        if (kanbanFlyoutEditAt(e.clientX, e.clientY)) return;
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
}
