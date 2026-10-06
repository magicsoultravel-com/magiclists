/** @module {"owns":"magicPlanner WBS subsection UI — board render, card chrome, pointer drag, field edit, bucket labels", "related":["plannerUi.js","plannerSheetUi.js","plannerChartUi.js","plannerKanbanUi.js","planner.js","plannerWbs.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor } from './colorPicker.js';
import { surfaceThemeInline } from './cardTheme.js';
import {
    normalizePlanner,
    getCategoryColor,
    getPlannerField,
    setPlannerField,
    getPlannerRowId,
    getPlannerOutlineLabel,
    createEmptyPlanner,
    isPlannerUnsupportedNewer
} from './planner.js';
import {
    layoutPlannerWbs,
    moveWbsCard,
    normalizeWbsMode,
    resetWbsArrangement,
    resetWbsLabels,
    setWbsBucketCollapsed,
    setWbsBucketLabel,
    getWbsMode,
    setWbsCardColor,
    setWbsCardEmphasis,
    setWbsCardCollapsed,
    resetWbsCardStyles,
    resetAllWbsCardStyles,
    expandAllWbsCards,
    collapseAllWbsCards
} from './plannerWbs.js';

/** Pointer lift threshold — local copy (Kanban defines its own). */
const WBS_DRAG_THRESHOLD = 4;

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


/** Compact date for WBS corner overlays. */
function formatKanbanCardDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
}

/** Warning triangle with exclamation — urgent / focus. */
const KANBAN_URGENT_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false" aria-hidden="true"><path d="M6 1.8 10.6 10.2H1.4Z" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linejoin="round"/><path d="M6 4.4v2.6" fill="none" stroke="currentColor" stroke-width="1.05" stroke-linecap="round"/><circle cx="6" cy="8.55" r="0.55" fill="currentColor"/></svg>';

/** Soft circle — non-urgent / muted. */
const KANBAN_MUTED_ICON = '<svg viewBox="0 0 12 12" width="11" height="11" focusable="false" aria-hidden="true"><circle cx="6" cy="6" r="4.2" fill="none" stroke="currentColor" stroke-width="0.95"/><path d="M3.6 6h4.8" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';

/** Phase/deliverable mode swap. */
const WBS_MODE_ICON = '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true"><path d="M2.4 3.2h7.2M2.4 6h7.2M2.4 8.8h4.4" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/><path d="M8.2 7.4l1.6 1.6 1.6-1.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {object} planner
 * @param {object} card
 * @param {{ canEdit?: boolean, childClass?: string }} [opts]
 */
function renderWbsCardHtml(planner, card, { canEdit = false, childClass = '' } = {}) {
    const editClass = canEdit ? ' is-editable' : '';
    const startLabel = formatKanbanCardDate(card.start);
    const stopLabel = formatKanbanCardDate(card.stop);
    const rowLabel = getPlannerOutlineLabel(planner, card.row);
    const startHtml = startLabel
        ? `<span class="planner-wbs__card-date planner-wbs__card-date--start" title="Start ${escapeAttr(startLabel)}">${escapeHTML(startLabel)}</span>`
        : '';
    const stopHtml = stopLabel
        ? `<span class="planner-wbs__card-date planner-wbs__card-date--stop" title="Stop ${escapeAttr(stopLabel)}">${escapeHTML(stopLabel)}</span>`
        : '';
    const rowHtml = `<span class="planner-wbs__card-row" title="Row ${escapeAttr(rowLabel)}">${escapeHTML(rowLabel)}</span>`;
    const commentRaw = String(card.comments || '');
    const comment = commentRaw.trim();
    const nameText = String(card.name || '');
    const emphasis = card.emphasis === 'urgent' || card.emphasis === 'muted' ? card.emphasis : '';
    const emphasisClass = emphasis ? ` is-${emphasis}` : '';
    const cardCollapsed = !!card.collapsed;
    const collapsedClass = cardCollapsed ? ' is-collapsed' : '';
    const urgentActive = emphasis === 'urgent' ? ' is-active' : '';
    const mutedActive = emphasis === 'muted' ? ' is-active' : '';
    const densityTitle = cardCollapsed ? 'Expand card' : 'Collapse card';
    const densityIcon = cardCollapsed ? CARD_ICONS.expand : CARD_ICONS.collapse;
    const actionsHtml = canEdit
        ? `<span class="planner-wbs__card-actions">
            <span class="planner-wbs__card-actions-tray">
                <button type="button" class="planner-wbs__card-density" data-planner-wbs-density title="${escapeAttr(densityTitle)}" aria-label="${escapeAttr(densityTitle)}" aria-pressed="${cardCollapsed ? 'true' : 'false'}">${densityIcon}</button>
                <button type="button" class="planner-wbs__card-emphasis${urgentActive}" data-planner-wbs-emphasis="urgent" title="Mark urgent" aria-label="Mark urgent" aria-pressed="${emphasis === 'urgent' ? 'true' : 'false'}">${KANBAN_URGENT_ICON}</button>
                <button type="button" class="planner-wbs__card-emphasis${mutedActive}" data-planner-wbs-emphasis="muted" title="Mark non-urgent" aria-label="Mark non-urgent" aria-pressed="${emphasis === 'muted' ? 'true' : 'false'}">${KANBAN_MUTED_ICON}</button>
                <button type="button" class="planner-wbs__card-color" data-planner-wbs-color title="Card color" aria-label="Card color">${CARD_ICONS.color}</button>
                <button type="button" class="planner-wbs__card-reset" data-planner-wbs-reset-card title="Reset card styles" aria-label="Reset card styles">${ACTION_ICONS.resetCustomization}</button>
            </span>
            <button type="button" class="planner-wbs__card-more" data-planner-wbs-more title="More actions" aria-label="More actions" aria-expanded="false">${CARD_ICONS.more}</button>
            <span class="planner-wbs__card-grab" title="Drag to move" aria-hidden="true">${CARD_ICONS.drag}</span>
        </span>`
        : '';
    const slotNameHtml = canEdit
        ? `<div class="planner-wbs__card-name card-inline-edit" contenteditable="plaintext-only" data-planner-wbs-field="name" data-planner-row="${card.row}" spellcheck="false" role="textbox" aria-label="Name">${escapeHTML(nameText)}</div>`
        : `<span class="planner-wbs__card-name">${escapeHTML(nameText)}</span>`;
    const slotCommentHtml = canEdit
        ? `<textarea class="planner-wbs__card-comment card-inline-edit" data-planner-wbs-field="comments" data-planner-row="${card.row}" rows="1" spellcheck="false" aria-label="Comments">${escapeHTML(commentRaw)}</textarea>`
        : (comment ? `<span class="planner-wbs__card-comment">${escapeHTML(comment)}</span>` : '');
    const flyoutNameHtml = `<span class="planner-wbs__card-name">${escapeHTML(nameText)}</span>`;
    const flyoutCommentHtml = comment
        ? `<span class="planner-wbs__card-comment">${escapeHTML(comment)}</span>`
        : '';
    const metaHtml = `${rowHtml}${startHtml}${stopHtml}`;
    const slotBody = `${metaHtml}
        <div class="planner-wbs__card-top">${slotNameHtml}</div>
        ${slotCommentHtml}`;
    const flyoutBody = `${metaHtml}
        <div class="planner-wbs__card-top">${flyoutNameHtml}</div>
        ${flyoutCommentHtml}`;
    const surface = surfaceThemeInline(card.cardColor);
    const colorClass = card.cardColor ? ` has-color${surface.className}` : '';
    return `<article class="planner-wbs__card${colorClass}${emphasisClass}${collapsedClass}${editClass}${childClass}" data-planner-wbs-card data-planner-row="${card.row}" data-planner-row-id="${escapeAttr(card.rowId)}" data-wbs-emphasis="${escapeAttr(emphasis)}" data-wbs-collapsed="${cardCollapsed ? '1' : '0'}"${surface.style}>
        <div class="planner-wbs__card-slot">${slotBody}</div>
        <div class="planner-wbs__card-flyout" aria-hidden="true">${flyoutBody}</div>
        ${actionsHtml}
    </article>`;
}

/**
 * @param {object} planner
 * @param {Array<{ type: string, card?: object, packId?: string, packRow?: number, packName?: string, cards?: object[] }>} groups
 * @param {{ canEdit?: boolean }} [opts]
 */
function renderWbsColumnBodyHtml(planner, groups, { canEdit = false } = {}) {
    if (!groups?.length) return '<div class="planner-wbs__empty-col" aria-hidden="true"></div>';
    const lastIdx = groups.length - 1;
    return groups.map((group, gi) => {
        const branchClass = gi === lastIdx ? ' is-wbs-branch is-wbs-branch-last' : ' is-wbs-branch';
        if (group.type === 'pack' && Array.isArray(group.cards) && group.cards.length) {
            const outline = group.packRow >= 0
                ? getPlannerOutlineLabel(planner, group.packRow)
                : '';
            const packName = String(group.packName || 'Pack');
            const kidsHtml = group.cards.map((card, i) => {
                const last = i === group.cards.length - 1;
                const childClass = last ? ' is-wbs-child is-wbs-child-last' : ' is-wbs-child';
                return renderWbsCardHtml(planner, card, { canEdit, childClass });
            }).join('');
            return `<div class="planner-wbs__tree${branchClass}" data-planner-wbs-tree data-planner-wbs-pack-id="${escapeAttr(group.packId)}">
                <div class="planner-wbs__tree-pack" data-planner-wbs-pack>
                    <span class="planner-wbs__tree-pack-row" title="Row ${escapeAttr(outline)}">${escapeHTML(outline)}</span>
                    <span class="planner-wbs__tree-pack-name">${escapeHTML(packName)}</span>
                </div>
                <div class="planner-wbs__tree-kids">${kidsHtml}</div>
            </div>`;
        }
        if (group.type === 'root' && group.card) {
            return renderWbsCardHtml(planner, group.card, { canEdit, childClass: branchClass });
        }
        return '';
    }).join('');
}

export function renderPlannerWbsHtml(planner, { canEdit = false } = {}) {
    const wbsCollapsed = !!planner?.wbsCollapsed;
    const mode = getWbsMode(planner);
    const layout = layoutPlannerWbs(planner, { mode });
    const modeLabel = mode === 'deliverable' ? 'Deliverables' : 'Phases';
    const otherMode = mode === 'deliverable' ? 'phase' : 'deliverable';
    const otherLabel = otherMode === 'deliverable' ? 'Deliverables' : 'Phases';

    // Collapsed buckets first (bucket order), then open buckets — same as Kanban.
    const orderedColumns = [
        ...layout.columns.filter((c) => c.collapsed),
        ...layout.columns.filter((c) => !c.collapsed)
    ];

    const columnsHtml = orderedColumns.map((col) => {
        const collapsed = !!col.collapsed;
        const colClass = collapsed ? ' is-collapsed' : '';
        const collapseTitle = collapsed ? 'Expand column' : 'Collapse column';
        const collapseIcon = collapsed ? CARD_ICONS.collapse : CARD_ICONS.expand;
        const cardsHtml = renderWbsColumnBodyHtml(planner, col.groups, { canEdit });
        // Collapsed strips need a plain title for sideways text; edit when open.
        const labelHtml = canEdit && !collapsed && col.bucket != null
            ? `<input type="text" class="planner-wbs__column-title planner-wbs__column-title-input" data-planner-wbs-label data-bucket="${col.bucket}" value="${escapeAttr(col.label)}" spellcheck="false" aria-label="Bucket label">`
            : `<span class="planner-wbs__column-title">${escapeHTML(col.label)}</span>`;
        return `<section class="planner-wbs__column${colClass}" data-planner-wbs-column data-planner-wbs-bucket="${escapeAttr(col.key)}" data-wbs-bucket-collapsed="${collapsed ? '1' : '0'}">
            <header class="planner-wbs__column-head">
                ${labelHtml}
                <span class="planner-wbs__column-count">${col.cards.length}</span>
                <button type="button" class="planner-wbs__column-collapse" data-planner-wbs-bucket-collapse title="${escapeAttr(collapseTitle)}" aria-label="${escapeAttr(collapseTitle)}" aria-expanded="${collapsed ? 'false' : 'true'}">${collapseIcon}</button>
            </header>
            <div class="planner-wbs__column-body" data-planner-wbs-drop="${escapeAttr(col.key)}">${cardsHtml}</div>
        </section>`;
    }).join('');

    const tools = canEdit
        ? `<button type="button" class="card-act planner-wbs-module-btn" data-planner-wbs-mode title="Switch to ${escapeAttr(otherLabel)}" aria-label="Switch to ${escapeAttr(otherLabel)}">${WBS_MODE_ICON}</button>
            <button type="button" class="card-act planner-wbs-module-btn" data-planner-wbs-expand-all title="Expand all cards" aria-label="Expand all cards">${ACTION_ICONS.expandAll}</button>
            <button type="button" class="card-act planner-wbs-module-btn" data-planner-wbs-collapse-all title="Collapse all cards" aria-label="Collapse all cards">${ACTION_ICONS.collapseAll}</button>
            <button type="button" class="card-act planner-wbs-module-btn" data-planner-wbs-reset-styles title="Reset all card styles" aria-label="Reset all card styles">${ACTION_ICONS.resetCustomization}</button>
            <button type="button" class="card-act planner-wbs-module-btn" data-planner-wbs-reset-labels title="Reset ${escapeAttr(modeLabel)} labels" aria-label="Reset labels">${ACTION_ICONS.resetCustomization}</button>
            <button type="button" class="card-act planner-wbs-module-btn" data-planner-wbs-reset-arrangement title="Reset ${escapeAttr(modeLabel)} arrangement" aria-label="Reset arrangement">${ACTION_ICONS.layoutReset}</button>`
        : '';

    const toggleCollapsed = wbsCollapsed ? ' collapsed' : '';
    const boardCollapsed = wbsCollapsed ? ' is-collapsed' : '';
    return `<div class="planner-wbs planner-sub" data-planner-wbs data-wbs-collapsed="${wbsCollapsed ? '1' : '0'}" data-wbs-mode="${escapeAttr(mode)}">
        <div class="planner-wbs__toolbar planner-sub__toolbar">
            <button type="button" class="planner-wbs__title planner-sub__title" data-planner-wbs-toggle aria-expanded="${wbsCollapsed ? 'false' : 'true'}">
                <span class="collapsable-toggle${toggleCollapsed}" aria-hidden="true">▼</span>WBS
            </button>
            <div class="planner-wbs__tools${wbsCollapsed ? ' is-collapsed' : ''}" role="group" aria-label="WBS tools"${wbsCollapsed ? ' hidden' : ''}>
                ${tools}
            </div>
        </div>
        <div class="planner-wbs__board${boardCollapsed}" data-planner-wbs-board>
            ${columnsHtml}
        </div>
    </div>`;
}

export function refreshWbsInSection(section, item) {
    if (!section || !item?.planner) return;
    const host = section.querySelector('[data-planner-wbs]');
    if (!host) return;
    const active = section.ownerDocument?.activeElement;
    if (active && host.contains(active) && active.closest?.('[data-planner-wbs-label], [data-planner-wbs-field]')) return;
    const board = host.querySelector('[data-planner-wbs-board]');
    const preserveScrollLeft = board ? board.scrollLeft : null;
    const normalized = normalizePlanner(item.planner);
    if (normalized) item.planner = normalized;
    if (isPlannerUnsupportedNewer(item.planner)) return;
    const html = renderPlannerWbsHtml(item.planner, {
        canEdit: plannerSectionCanEdit(section)
    });
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    const next = tmp.firstElementChild;
    if (!next) return;
    host.replaceWith(next);
    const nextBoard = next.querySelector('[data-planner-wbs-board]');
    if (nextBoard && preserveScrollLeft != null) nextBoard.scrollLeft = preserveScrollLeft;
    growPlannerTextareasLocal(next);
}
/**
 * @param {HTMLElement} section
 * @param {HTMLElement|null} [except]
 */
export function closeOpenWbsCardActions(section, except = null) {
    section.querySelectorAll('.planner-wbs__card-actions.is-actions-open').forEach((el) => {
        if (except && el === except) return;
        el.classList.remove('is-actions-open');
        const more = el.querySelector('[data-planner-wbs-more]');
        if (more) more.setAttribute('aria-expanded', 'false');
    });
}

/**
 * WBS click handler.
 * Click selectors verified exclusive across sheet/chart/kanban/wbs; dispatch order free.
 * @param {object} ctx
 * @param {Event} e
 * @returns {boolean}
 */
export function handleWbsClick(ctx, e) {
    const { section, item, mutate } = ctx;

        const wbsToggle = e.target.closest('[data-planner-wbs-toggle]');
        if (wbsToggle && section.contains(wbsToggle)) {
            e.preventDefault();
            e.stopPropagation();
            const nextCollapsed = !item.planner?.wbsCollapsed;
            mutate((it) => {
                it.planner.wbsCollapsed = nextCollapsed;
            }, { skipRerender: true, refreshGantt: true });
            const block = section.querySelector('[data-planner-wbs]');
            if (block) {
                block.dataset.wbsCollapsed = nextCollapsed ? '1' : '0';
                block.querySelector('[data-planner-wbs-board]')?.classList.toggle('is-collapsed', nextCollapsed);
                const tools = block.querySelector('.planner-wbs__tools');
                tools?.classList.toggle('is-collapsed', nextCollapsed);
                if (tools) tools.hidden = nextCollapsed;
                const title = block.querySelector('[data-planner-wbs-toggle]');
                title?.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
                title?.querySelector('.collapsable-toggle')?.classList.toggle('collapsed', nextCollapsed);
            }
            return true;
        }

        const wbsModeBtn = e.target.closest('[data-planner-wbs-mode]');
        if (wbsModeBtn && section.contains(wbsModeBtn)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => {
                const cur = normalizeWbsMode(it.planner.wbsMode);
                it.planner.wbsMode = cur === 'deliverable' ? 'phase' : 'deliverable';
            }, { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsExpandAll = e.target.closest('[data-planner-wbs-expand-all]');
        if (wbsExpandAll && section.contains(wbsExpandAll)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => expandAllWbsCards(it.planner), { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsCollapseAll = e.target.closest('[data-planner-wbs-collapse-all]');
        if (wbsCollapseAll && section.contains(wbsCollapseAll)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => collapseAllWbsCards(it.planner), { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsResetStylesAll = e.target.closest('[data-planner-wbs-reset-styles]');
        if (wbsResetStylesAll && section.contains(wbsResetStylesAll)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => resetAllWbsCardStyles(it.planner), { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsResetLabels = e.target.closest('[data-planner-wbs-reset-labels]');
        if (wbsResetLabels && section.contains(wbsResetLabels)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => resetWbsLabels(it.planner), { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsResetArr = e.target.closest('[data-planner-wbs-reset-arrangement]');
        if (wbsResetArr && section.contains(wbsResetArr)) {
            e.preventDefault();
            e.stopPropagation();
            mutate((it) => resetWbsArrangement(it.planner), { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsMoreBtn = e.target.closest('[data-planner-wbs-more]');
        if (wbsMoreBtn && section.contains(wbsMoreBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const actions = wbsMoreBtn.closest('.planner-wbs__card-actions');
            if (!actions) return true;
            const willOpen = !actions.classList.contains('is-actions-open');
            closeOpenWbsCardActions(section, willOpen ? actions : null);
            actions.classList.toggle('is-actions-open', willOpen);
            wbsMoreBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            return true;
        }

        const wbsDensityBtn = e.target.closest('[data-planner-wbs-density]');
        if (wbsDensityBtn && section.contains(wbsDensityBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = wbsDensityBtn.closest('[data-planner-wbs-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return true;
            const nextCollapsed = card?.dataset?.wbsCollapsed !== '1';
            mutate((it) => setWbsCardCollapsed(it.planner, row, nextCollapsed), { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsEmphasisBtn = e.target.closest('[data-planner-wbs-emphasis]');
        if (wbsEmphasisBtn && section.contains(wbsEmphasisBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = wbsEmphasisBtn.closest('[data-planner-wbs-card]');
            const row = Number(card?.dataset?.plannerRow);
            const mode = String(wbsEmphasisBtn.dataset.plannerWbsEmphasis || '');
            if (!Number.isFinite(row) || (mode !== 'urgent' && mode !== 'muted')) return true;
            mutate((it) => setWbsCardEmphasis(it.planner, row, mode), { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsResetCardBtn = e.target.closest('[data-planner-wbs-reset-card]');
        if (wbsResetCardBtn && section.contains(wbsResetCardBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = wbsResetCardBtn.closest('[data-planner-wbs-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return true;
            mutate((it) => resetWbsCardStyles(it.planner, row), { skipRerender: true, refreshGantt: true });
            return true;
        }

        const wbsColorBtn = e.target.closest('[data-planner-wbs-color]');
        if (wbsColorBtn && section.contains(wbsColorBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const card = wbsColorBtn.closest('[data-planner-wbs-card]');
            const row = Number(card?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return true;
            const rowId = getPlannerRowId(item.planner, row);
            const current = resolveNoteColor(
                (rowId && item.planner?.wbsCardColors?.[rowId])
                || getCategoryColor(item.planner, getPlannerField(item.planner.sheet, row, 'category'))
                || ''
            );
            ColorPicker.open({
                anchor: wbsColorBtn,
                presets: PALETTE_NOTE,
                value: current,
                onSelect: (color) => {
                    const hex = resolveNoteColor(color);
                    mutate((it) => {
                        setWbsCardColor(it.planner, row, hex);
                    }, { skipRerender: true, refreshGantt: true });
                }
            });
            return true;
        }

        const wbsBucketCollapse = e.target.closest('[data-planner-wbs-bucket-collapse]');
        if (wbsBucketCollapse && section.contains(wbsBucketCollapse)) {
            e.preventDefault();
            e.stopPropagation();
            const col = wbsBucketCollapse.closest('[data-planner-wbs-column]');
            const key = String(col?.dataset?.plannerWbsBucket || '');
            if (!key) return true;
            const next = col?.dataset?.wbsBucketCollapsed !== '1';
            mutate((it) => setWbsBucketCollapsed(it.planner, key, next), { skipRerender: true, refreshGantt: true });
            return true;
        }

    return false;
}

/**
 * Pointer drag, field focus, label change.
 * @param {object} ctx
 */
export function bindWbs(ctx) {
    const {
        section, item, mutate, schedulePlannerCommit, flushPlannerCommit,
        growPlannerCell, mirrorBoardFieldToTableDom
    } = ctx;
    const grow = growPlannerCell || growPlannerCellLocal;

    section.addEventListener('input', (e) => {
        const wbsField = e.target.closest('[data-planner-wbs-field]');
        if (wbsField && section.contains(wbsField)) {
            const row = Number(wbsField.dataset.plannerRow);
            const key = String(wbsField.dataset.plannerWbsField || '');
            if (!Number.isFinite(row) || (key !== 'name' && key !== 'comments')) return;
            schedulePlannerCommit({ refreshGantt: true });
            if (!item.planner) item.planner = createEmptyPlanner();
            const value = key === 'name'
                ? String(wbsField.textContent || '')
                : String(wbsField.value ?? '');
            setPlannerField(item.planner.sheet, row, key, value);
            mirrorBoardFieldToTableDom?.(item.id, row, key, value);
            if (key === 'comments') grow(wbsField);
        }
    });

    section.addEventListener('change', (e) => {
        const labelInput = e.target.closest('[data-planner-wbs-label]');
        if (labelInput && section.contains(labelInput)) {
            const bucket = Number(labelInput.dataset.bucket);
            if (!Number.isFinite(bucket)) return;
            mutate((it) => {
                setWbsBucketLabel(it.planner, bucket, labelInput.value);
            }, { skipRerender: true, refreshGantt: true });
        }
    });

    section.addEventListener('focusin', (e) => {
        const wbsField = e.target.closest?.('[data-planner-wbs-field]');
        if (wbsField && section.contains(wbsField)) {
            const card = wbsField.closest('[data-planner-wbs-card]');
            card?.classList.add('is-wbs-editing');
            if (wbsField.dataset.plannerWbsField === 'name') {
                wbsField.dataset.wbsNamePrev = String(wbsField.textContent || '');
            }
            if (wbsField.dataset.plannerWbsField === 'comments') {
                grow(wbsField);
            }
        }
    });

    section.addEventListener('focusout', (e) => {
        const wbsField = e.target.closest?.('[data-planner-wbs-field]');
        if (wbsField && section.contains(wbsField)) {
            const card = wbsField.closest('[data-planner-wbs-card]');
            const related = e.relatedTarget;
            const stayingOnCard = related && card?.contains(related);
            if (!stayingOnCard) card?.classList.remove('is-wbs-editing');

            if (wbsField.dataset.plannerWbsField === 'name') {
                const row = Number(wbsField.dataset.plannerRow);
                const trimmed = String(wbsField.textContent || '').trim();
                if (!trimmed) {
                    const prev = String(wbsField.dataset.wbsNamePrev || '').trim()
                        || (Number.isFinite(row) ? getPlannerField(item.planner?.sheet, row, 'name') : '');
                    wbsField.textContent = prev;
                    if (Number.isFinite(row) && item.planner?.sheet) {
                        setPlannerField(item.planner.sheet, row, 'name', prev);
                        mirrorBoardFieldToTableDom?.(item.id, row, 'name', prev);
                    }
                } else if (String(wbsField.textContent || '') !== trimmed) {
                    wbsField.textContent = trimmed;
                    const rowNum = Number(wbsField.dataset.plannerRow);
                    if (Number.isFinite(rowNum) && item.planner?.sheet) {
                        setPlannerField(item.planner.sheet, rowNum, 'name', trimmed);
                        mirrorBoardFieldToTableDom?.(item.id, rowNum, 'name', trimmed);
                    }
                } else if (Number.isFinite(row)) {
                    mirrorBoardFieldToTableDom?.(item.id, row, 'name', trimmed);
                }
            }
            if (wbsField.dataset.plannerWbsField === 'comments') {
                const row = Number(wbsField.dataset.plannerRow);
                if (Number.isFinite(row)) {
                    mirrorBoardFieldToTableDom?.(item.id, row, 'comments', String(wbsField.value ?? ''));
                }
                requestAnimationFrame(() => grow(wbsField));
            }
            flushPlannerCommit();
        }
    });

    /** @type {{
     *   card: HTMLElement,
     *   rowId: string,
     *   slot: HTMLElement|null,
     *   offsetX: number,
     *   offsetY: number,
     *   lifted: boolean,
     *   startX: number,
     *   startY: number,
     *   pointerId: number
     * } | null} */
    let wbsPtr = null;

    const clearWbsColumnOver = () => {
        section.querySelectorAll('.planner-wbs__column-body.is-drag-over').forEach((el) => {
            el.classList.remove('is-drag-over');
        });
    };

    /** Next leaf id after a placeholder, walking past pack tree wrappers. */
    const nextWbsLeafIdAfter = (slot, excludeId) => {
        if (!slot) return null;
        const leafFrom = (node) => {
            if (!node) return null;
            if (node.matches?.('[data-planner-wbs-card]')) {
                const id = node.dataset.plannerRowId;
                return id && id !== excludeId ? id : null;
            }
            if (node.matches?.('[data-planner-wbs-tree]')) {
                const first = node.querySelector('[data-planner-wbs-card]');
                const id = first?.dataset?.plannerRowId;
                return id && id !== excludeId ? id : null;
            }
            return null;
        };
        let el = slot.nextElementSibling;
        while (el) {
            const id = leafFrom(el);
            if (id) return id;
            el = el.nextElementSibling;
        }
        const tree = slot.closest('[data-planner-wbs-tree]');
        if (tree) {
            let after = tree.nextElementSibling;
            while (after) {
                const id = leafFrom(after);
                if (id) return id;
                after = after.nextElementSibling;
            }
        }
        return null;
    };

    /** Drop empty pack shells left behind when the placeholder leaves mid-drag. */
    const pruneEmptyWbsTrees = (root) => {
        root?.querySelectorAll?.('[data-planner-wbs-tree]').forEach((tree) => {
            if (tree.querySelector('[data-planner-wbs-card], .planner-wbs__placeholder')) return;
            tree.remove();
        });
    };

    /**
     * Insert placeholder before a leaf. Flat cards: Kanban-identical body.insertBefore.
     * Pack trees: body-level before the tree for the first child; kids insert for mid-pack.
     */
    const insertWbsSlotBeforeCard = (slot, card, body) => {
        if (!slot || !card || !body) return;
        try {
            const tree = card.closest?.('[data-planner-wbs-tree]');
            if (tree && body.contains(tree)) {
                const kids = tree.querySelector('.planner-wbs__tree-kids');
                const cardsInTree = [...(kids?.querySelectorAll('[data-planner-wbs-card]') || [])];
                if (cardsInTree[0] === card) {
                    body.insertBefore(slot, tree);
                    pruneEmptyWbsTrees(body);
                    return;
                }
                if (kids && cardsInTree.includes(card)) {
                    kids.insertBefore(slot, card);
                    return;
                }
            }
            // Flat Kanban parity: card is a direct child of the column body.
            if (card.parentNode === body) {
                body.insertBefore(slot, card);
            } else {
                body.appendChild(slot);
            }
            pruneEmptyWbsTrees(section);
        } catch {
            try {
                body.appendChild(slot);
                pruneEmptyWbsTrees(section);
            } catch {
                /* ignore — next move retries */
            }
        }
    };

    const resetWbsCardDragStyles = (card) => {
        if (!card) return;
        card.classList.remove('is-planner-wbs-dragging');
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
        card.style.zIndex = '';
        card.style.pointerEvents = '';
        card.style.margin = '';
    };

    const endWbsPointerDrag = ({ commit = false } = {}) => {
        const state = wbsPtr;
        wbsPtr = null;
        // Parity with Kanban: always detach doc listeners here so a stalled
        // pointerup / re-entrant pointerdown cannot leave move handlers stuck.
        document.removeEventListener('pointermove', onWbsDocPointerMove);
        document.removeEventListener('pointerup', onWbsDocPointerUp);
        document.removeEventListener('pointercancel', onWbsDocPointerUp);
        document.body.classList.remove('is-planner-wbs-drag-active');
        clearWbsColumnOver();
        if (!state) return;
        const { card, slot, rowId } = state;
        let target = null;
        if (commit && slot?.isConnected) {
            const body = slot.closest('[data-planner-wbs-drop]');
            const bucketKey = body?.dataset?.plannerWbsDrop;
            if (bucketKey != null && bucketKey !== '') {
                const n = Number(bucketKey);
                const toBucket = Number.isFinite(n) ? n : 0;
                target = { toBucket, beforeId: nextWbsLeafIdAfter(slot, rowId) };
            }
        }
        if (slot?.parentNode) {
            slot.parentNode.insertBefore(card, slot);
            slot.remove();
        } else if (card && !card.isConnected && section.isConnected) {
            section.querySelector('[data-planner-wbs-drop]')?.appendChild(card);
        }
        resetWbsCardDragStyles(card);
        pruneEmptyWbsTrees(section);
        if (commit && target) {
            mutate((it) => {
                moveWbsCard(it.planner, rowId, target.toBucket, { beforeId: target.beforeId });
            }, { skipRerender: true, refreshGantt: true });
        }
    };

    const placeWbsSlot = (clientX, clientY, slot, draggedId) => {
        if (!slot) return;
        const board = section.querySelector('[data-planner-wbs-board]');
        if (!board) return;
        const columns = [...board.querySelectorAll('.planner-wbs__column[data-planner-wbs-bucket]')];
        let column = null;
        for (const col of columns) {
            const rect = col.getBoundingClientRect();
            if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
                column = col;
                break;
            }
        }
        if (!column) {
            // Nearest column by horizontal distance when pointer is between/above columns.
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
        const body = column?.querySelector('[data-planner-wbs-drop]') || null;
        if (!body) return;
        clearWbsColumnOver();
        body.classList.add('is-drag-over');
        try {
            if (column.classList.contains('is-collapsed')) {
                body.appendChild(slot);
                pruneEmptyWbsTrees(section);
                return;
            }
            const cards = [...body.querySelectorAll('[data-planner-wbs-card]')]
                .filter((c) => String(c.dataset.plannerRowId || '') !== String(draggedId || ''));
            if (!cards.length) {
                body.appendChild(slot);
                pruneEmptyWbsTrees(section);
                return;
            }
            for (const card of cards) {
                const rect = card.getBoundingClientRect();
                if (clientY < rect.top + rect.height / 2) {
                    insertWbsSlotBeforeCard(slot, card, body);
                    return;
                }
            }
            body.appendChild(slot);
            pruneEmptyWbsTrees(section);
        } catch {
            try {
                body.appendChild(slot);
                pruneEmptyWbsTrees(section);
            } catch {
                /* ignore */
            }
        }
    };

    const liftWbsCard = (state, clientX, clientY) => {
        if (state.lifted) return;
        const { card } = state;
        const rect = card.getBoundingClientRect();
        state.offsetX = clientX - rect.left;
        state.offsetY = clientY - rect.top;
        const slot = document.createElement('div');
        slot.className = 'planner-wbs__placeholder';
        slot.setAttribute('aria-hidden', 'true');
        slot.style.height = `${rect.height}px`;
        // Prefer column-body as placeholder parent (Kanban parity) so cross-column
        // moves never start nested under a pack tree shell.
        const homeBody = card.closest('[data-planner-wbs-drop]');
        if (homeBody && homeBody.contains(card)) {
            const tree = card.closest('[data-planner-wbs-tree]');
            if (tree && homeBody.contains(tree)) {
                const kids = tree.querySelector('.planner-wbs__tree-kids');
                const first = kids?.querySelector('[data-planner-wbs-card]');
                if (first === card) homeBody.insertBefore(slot, tree);
                else if (kids?.contains(card)) kids.insertBefore(slot, card);
                else homeBody.insertBefore(slot, tree);
            } else {
                homeBody.insertBefore(slot, card);
            }
        } else {
            card.parentNode?.insertBefore(slot, card);
        }
        state.slot = slot;
        document.body.appendChild(card);
        card.classList.add('is-planner-wbs-dragging');
        card.style.position = 'fixed';
        card.style.width = `${rect.width}px`;
        card.style.height = `${rect.height}px`;
        card.style.left = `${rect.left}px`;
        card.style.top = `${rect.top}px`;
        card.style.zIndex = '9999';
        card.style.pointerEvents = 'none';
        card.style.margin = '0';
        document.body.classList.add('is-planner-wbs-drag-active');
        state.lifted = true;
    };

    const onWbsDocPointerMove = (e) => {
        const state = wbsPtr;
        if (!state || state.pointerId !== e.pointerId) return;
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (!state.lifted) {
            if ((dx * dx + dy * dy) < WBS_DRAG_THRESHOLD * WBS_DRAG_THRESHOLD) return;
            e.preventDefault();
            liftWbsCard(state, e.clientX, e.clientY);
        }
        if (!state.lifted) return;
        e.preventDefault();
        state.card.style.left = `${e.clientX - state.offsetX}px`;
        state.card.style.top = `${e.clientY - state.offsetY}px`;
        placeWbsSlot(e.clientX, e.clientY, state.slot, state.rowId);
    };

    const onWbsDocPointerUp = (e) => {
        const state = wbsPtr;
        if (!state || (e.pointerId != null && state.pointerId !== e.pointerId)) return;
        endWbsPointerDrag({ commit: state.lifted });
    };

    /**
     * Flyout is pointer-events:none on editable cards (peek only). Detect
     * name/comment under the cursor via elementsFromPoint so collapsed peeks
     * can still enter inline edit (parity with Kanban HEAD flyout peek).
     * @returns {{ card: HTMLElement, fieldKey: 'name'|'comments' } | null}
     */
    const wbsFlyoutEditAt = (clientX, clientY) => {
        const stack = typeof document.elementsFromPoint === 'function'
            ? document.elementsFromPoint(clientX, clientY)
            : [];
        for (const el of stack) {
            if (!(el instanceof Element)) continue;
            const flyout = el.closest?.('.planner-wbs__card-flyout');
            if (!flyout) continue;
            const card = flyout.closest('[data-planner-wbs-card]');
            if (!card || !section.contains(card) || !card.classList.contains('is-editable')) continue;
            if (el.closest?.('.planner-wbs__card-name')) return { card, fieldKey: 'name' };
            if (el.closest?.('.planner-wbs__card-comment')) return { card, fieldKey: 'comments' };
        }
        return null;
    };

    section.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('[data-planner-wbs-field], textarea, [contenteditable]')) return;
        if (e.target.closest?.('[data-planner-wbs-color], [data-planner-wbs-emphasis], [data-planner-wbs-reset-card], [data-planner-wbs-density], [data-planner-wbs-more]')) return;
        const hit = wbsFlyoutEditAt(e.clientX, e.clientY);
        if (!hit) return;
        hit.card.classList.add('is-wbs-editing');
        const field = hit.card.querySelector(`[data-planner-wbs-field="${hit.fieldKey}"]`);
        requestAnimationFrame(() => {
            field?.focus?.();
            if (hit.fieldKey === 'comments' && field) grow(field);
        });
    }, true);

    section.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('[data-planner-wbs-color], [data-planner-wbs-emphasis], [data-planner-wbs-reset-card], [data-planner-wbs-density], [data-planner-wbs-more], [data-planner-wbs-field], textarea, input, [contenteditable]')) return;
        const card = e.target.closest('[data-planner-wbs-card]');
        if (!card || !section.contains(card) || !card.classList.contains('is-editable')) return;
        if (wbsFlyoutEditAt(e.clientX, e.clientY)) return;
        const rowId = String(card.dataset.plannerRowId || '');
        if (!rowId) return;
        if (wbsPtr) endWbsPointerDrag({ commit: false });
        wbsPtr = {
            card,
            rowId,
            slot: null,
            offsetX: 0,
            offsetY: 0,
            lifted: false,
            startX: e.clientX,
            startY: e.clientY,
            pointerId: e.pointerId
        };
        document.addEventListener('pointermove', onWbsDocPointerMove, { passive: false });
        document.addEventListener('pointerup', onWbsDocPointerUp);
        document.addEventListener('pointercancel', onWbsDocPointerUp);
    });
}
