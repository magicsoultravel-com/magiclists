/** @module {"owns":"shared planner card anatomy — card HTML, field editing bind, action-tray close", "related":["plannerSharedUi.js","plannerKanbanUi.js","plannerWbsUi.js","plannerUi.js","planner.js","icons.js","cardTheme.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { surfaceThemeInline } from './cardTheme.js';
import { formatPlannerCardDate, growPlannerCell } from './plannerSharedUi.js';
import { createEmptyPlanner, getPlannerField, setPlannerField } from './planner.js';

/**
 * Both boards render the identical card anatomy, only the namespace differs:
 * `mode` drives every class/attribute (`planner-<mode>__card`, `data-planner-<mode>-field`,
 * `is-<mode>-editing`, `<mode>NamePrev`, …). Keep this the single source of truth —
 * a card change belongs here, not in one of the two boards.
 */

/**
 * Render one board card. `indent` is the caller's nesting whitespace so the emitted
 * markup stays byte-identical to each board's historical formatting.
 * @param {object} planner
 * @param {object} card
 * @param {{
 *   mode: 'kanban'|'wbs', canEdit?: boolean, indent: string,
 *   rowLabel: (planner: object, card: object) => string,
 *   includeRowId?: boolean, childClass?: string, isPack?: boolean, packCollapsed?: boolean
 * }} opts
 * @returns {string}
 */
export function renderPlannerCardHtml(planner, card, {
    mode, canEdit = false, indent, rowLabel,
    includeRowId = false, childClass = '', isPack = false, packCollapsed = false
}) {
    const block = `planner-${mode}__`;
    const fieldAttr = `data-planner-${mode}-field`;
    const editClass = canEdit ? ' is-editable' : '';
    const startLabel = formatPlannerCardDate(card.start);
    const stopLabel = formatPlannerCardDate(card.stop);
    const label = rowLabel(planner, card);
    const startHtml = startLabel
        ? `<span class="${block}card-date ${block}card-date--start" title="Start ${escapeAttr(startLabel)}">${escapeHTML(startLabel)}</span>`
        : '';
    const stopHtml = stopLabel
        ? `<span class="${block}card-date ${block}card-date--stop" title="Stop ${escapeAttr(stopLabel)}">${escapeHTML(stopLabel)}</span>`
        : '';
    const rowHtml = `<span class="${block}card-row" title="Row ${escapeAttr(label)}">${escapeHTML(label)}</span>`;
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
    const packToggleTitle = packCollapsed ? 'Expand work pack' : 'Collapse work pack';
    const packToggleHtml = isPack
        ? `<button type="button" class="${block}pack-toggle collapsable-toggle${packCollapsed ? ' collapsed' : ''}" data-planner-${mode}-pack-toggle title="${escapeAttr(packToggleTitle)}" aria-label="${escapeAttr(packToggleTitle)}" aria-expanded="${packCollapsed ? 'false' : 'true'}">▼</button>`
        : '';
    const actionsHtml = canEdit
        ? `<span class="${block}card-actions">
${indent}    <span class="${block}card-actions-tray">
${indent}        <button type="button" class="${block}card-density" data-planner-${mode}-density title="${escapeAttr(densityTitle)}" aria-label="${escapeAttr(densityTitle)}" aria-pressed="${collapsed ? 'true' : 'false'}">${densityIcon}</button>
${indent}        <button type="button" class="${block}card-emphasis${urgentActive}" data-planner-${mode}-emphasis="urgent" title="Mark urgent" aria-label="Mark urgent" aria-pressed="${emphasis === 'urgent' ? 'true' : 'false'}">${CARD_ICONS.emphasisUrgent}</button>
${indent}        <button type="button" class="${block}card-emphasis${mutedActive}" data-planner-${mode}-emphasis="muted" title="Mark non-urgent" aria-label="Mark non-urgent" aria-pressed="${emphasis === 'muted' ? 'true' : 'false'}">${CARD_ICONS.emphasisMuted}</button>
${indent}        <button type="button" class="${block}card-color" data-planner-${mode}-color title="Card color" aria-label="Card color">${CARD_ICONS.color}</button>
${indent}        <button type="button" class="${block}card-reset" data-planner-${mode}-reset-card title="Reset card styles" aria-label="Reset card styles">${ACTION_ICONS.resetCustomization}</button>
${indent}    </span>
${indent}    <button type="button" class="${block}card-more" data-planner-${mode}-more title="More actions" aria-label="More actions" aria-expanded="false">${CARD_ICONS.more}</button>
${indent}    <span class="${block}card-grab" title="Drag to move" aria-hidden="true">${CARD_ICONS.drag}</span>
${indent}</span>`
        : '';
    // Slot: editable when canEdit. Flyout: read-only full-content overlay (no layout push).
    const slotNameHtml = canEdit
        ? `<div class="${block}card-name card-inline-edit" contenteditable="plaintext-only" ${fieldAttr}="name" data-planner-row="${card.row}" spellcheck="false" role="textbox" aria-label="Name">${escapeHTML(nameText)}</div>`
        : `<span class="${block}card-name">${escapeHTML(nameText)}</span>`;
    const slotCommentHtml = canEdit
        ? `<textarea class="${block}card-comment card-inline-edit" ${fieldAttr}="comments" data-planner-row="${card.row}" rows="1" spellcheck="false" aria-label="Comments">${escapeHTML(commentRaw)}</textarea>`
        : (comment ? `<span class="${block}card-comment">${escapeHTML(comment)}</span>` : '');
    const flyoutNameHtml = `<span class="${block}card-name">${escapeHTML(nameText)}</span>`;
    const flyoutCommentHtml = comment
        ? `<span class="${block}card-comment">${escapeHTML(comment)}</span>`
        : '';
    const metaHtml = `${rowHtml}${startHtml}${stopHtml}`;
    const slotBody = `${metaHtml}
${indent}<div class="${block}card-top">${packToggleHtml}${slotNameHtml}</div>
${indent}${slotCommentHtml}`;
    const flyoutBody = `${metaHtml}
${indent}<div class="${block}card-top">${flyoutNameHtml}</div>
${indent}${flyoutCommentHtml}`;
    const surface = surfaceThemeInline(card.cardColor);
    const colorClass = card.cardColor ? ` has-color${surface.className}` : '';
    const packClass = isPack ? ` ${block}pack-card` : '';
    const rowIdAttr = includeRowId ? ` data-planner-row-id="${escapeAttr(card.rowId)}"` : '';
    const packAttrs = isPack
        ? ` data-planner-${mode}-pack data-${mode}-pack-collapsed="${packCollapsed ? '1' : '0'}"`
        : '';
    return `<article class="${block}card${packClass}${colorClass}${emphasisClass}${collapsedClass}${editClass}${childClass}" data-planner-${mode}-card data-planner-row="${card.row}"${rowIdAttr} data-${mode}-emphasis="${escapeAttr(emphasis)}" data-${mode}-collapsed="${collapsed ? '1' : '0'}"${packAttrs}${surface.style}>
${indent}<div class="${block}card-slot">${slotBody}</div>
${indent}<div class="${block}card-flyout" aria-hidden="true">${flyoutBody}</div>
${indent}${actionsHtml}
${indent.slice(0, -4)}</article>`;
}

/**
 * Close an open card action tray (the `more` popover).
 * @param {ParentNode} section
 * @param {'kanban'|'wbs'} mode
 * @param {Element | null} [except]
 */
export function closeOpenPlannerCardActions(section, mode, except = null) {
    const block = `planner-${mode}__`;
    section.querySelectorAll(`.${block}card-actions.is-actions-open`).forEach((el) => {
        if (except && el === except) return;
        el.classList.remove('is-actions-open');
        const more = el.querySelector(`[data-planner-${mode}-more]`);
        if (more) more.setAttribute('aria-expanded', 'false');
    });
}

/**
 * Name/comment editing for board cards — the input / focusin / focusout trio.
 * Identical for both boards apart from the namespace `mode` drives.
 * @param {HTMLElement} section
 * @param {'kanban'|'wbs'} mode
 * @param {{
 *   item: object,
 *   schedulePlannerCommit: (opts: object) => void,
 *   flushPlannerCommit: () => void,
 *   mirrorBoardFieldToTableDom?: (itemId: string, row: number, key: string, value: string) => void
 * }} ctx
 */
export function bindPlannerCardFields(section, mode, {
    item, schedulePlannerCommit, flushPlannerCommit, mirrorBoardFieldToTableDom
}) {
    const fieldSel = `[data-planner-${mode}-field]`;
    const cardSel = `[data-planner-${mode}-card]`;
    const editingClass = `is-${mode}-editing`;
    const prevKey = `${mode}NamePrev`;
    const datasetKey = `planner${mode[0].toUpperCase()}${mode.slice(1)}Field`;
    const grow = growPlannerCell;

    section.addEventListener('input', (e) => {
        const field = e.target.closest(fieldSel);
        if (field && section.contains(field)) {
            const row = Number(field.dataset.plannerRow);
            const key = String(field.dataset[datasetKey] || '');
            if (!Number.isFinite(row) || (key !== 'name' && key !== 'comments')) return;
            schedulePlannerCommit({ refreshGantt: true });
            if (!item.planner) item.planner = createEmptyPlanner();
            const value = key === 'name'
                ? String(field.textContent || '')
                : String(field.value ?? '');
            setPlannerField(item.planner.sheet, row, key, value);
            mirrorBoardFieldToTableDom?.(item.id, row, key, value);
            if (key === 'comments') grow(field);
        }
    });

    section.addEventListener('focusin', (e) => {
        const field = e.target.closest?.(fieldSel);
        if (field && section.contains(field)) {
            const card = field.closest(cardSel);
            card?.classList.add(editingClass);
            if (field.dataset[datasetKey] === 'name') {
                field.dataset[prevKey] = String(field.textContent || '');
            }
            if (field.dataset[datasetKey] === 'comments') {
                grow(field);
            }
        }
    });

    section.addEventListener('focusout', (e) => {
        const field = e.target.closest?.(fieldSel);
        if (field && section.contains(field)) {
            const card = field.closest(cardSel);
            const related = e.relatedTarget;
            const stayingOnCard = related && card?.contains(related);
            if (!stayingOnCard) card?.classList.remove(editingClass);

            if (field.dataset[datasetKey] === 'name') {
                const row = Number(field.dataset.plannerRow);
                const trimmed = String(field.textContent || '').trim();
                if (!trimmed) {
                    const prev = String(field.dataset[prevKey] || '').trim()
                        || (Number.isFinite(row) ? getPlannerField(item.planner?.sheet, row, 'name') : '');
                    field.textContent = prev;
                    if (Number.isFinite(row) && item.planner?.sheet) {
                        setPlannerField(item.planner.sheet, row, 'name', prev);
                        mirrorBoardFieldToTableDom?.(item.id, row, 'name', prev);
                    }
                } else if (String(field.textContent || '') !== trimmed) {
                    field.textContent = trimmed;
                    const rowNum = Number(field.dataset.plannerRow);
                    if (Number.isFinite(rowNum) && item.planner?.sheet) {
                        setPlannerField(item.planner.sheet, rowNum, 'name', trimmed);
                        mirrorBoardFieldToTableDom?.(item.id, rowNum, 'name', trimmed);
                    }
                } else if (Number.isFinite(row)) {
                    mirrorBoardFieldToTableDom?.(item.id, row, 'name', trimmed);
                }
            }
            if (field.dataset[datasetKey] === 'comments') {
                const row = Number(field.dataset.plannerRow);
                if (Number.isFinite(row)) {
                    mirrorBoardFieldToTableDom?.(item.id, row, 'comments', String(field.value ?? ''));
                }
                requestAnimationFrame(() => grow(field));
            }
            flushPlannerCommit();
        }
    });
}
