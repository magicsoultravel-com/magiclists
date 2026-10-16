/** @module {"owns":"magicPlanner WBS subsection UI — board render, card chrome, pointer drag, field edit, bucket labels", "related":["plannerUi.js","plannerSheetUi.js","plannerChartUi.js","plannerKanbanUi.js","planner.js","plannerWbs.js"]} */
import { escapeHTML, escapeAttr } from './domEscape.js';
import { CARD_ICONS, ACTION_ICONS } from './icons.js';
import { renderFocusSpawnBtnHtml } from './noteFocusSpawn.js';
import { ColorPicker, PALETTE_NOTE, resolveNoteColor } from './colorPicker.js';
import { surfaceThemeInline } from './cardTheme.js';
import {
    normalizePlanner,
    getCategoryColor,
    getPlannerField,
    getPlannerRowId,
    getPlannerOutlineLabel,
    isPlannerUnsupportedNewer,
    setPlannerPackCollapsed,
    isPlannerPackCollapsed
} from './planner.js';
import {
    layoutPlannerWbs,
    moveWbsCard,
    normalizeWbsMode,
    resetWbsArrangement,
    resetWbsLabels,
    setWbsBucketCollapsed,
    setWbsBucketLabel,
    setWbsBucketColor,
    getWbsBucketColor,
    moveWbsBucket,
    getWbsMode,
    setWbsCardColor,
    setWbsCardEmphasis,
    setWbsCardCollapsed,
    resetWbsCardStyles,
    resetAllWbsCardStyles,
    expandAllWbsCards,
    collapseAllWbsCards
} from './plannerWbs.js';
import {
    plannerSectionCanEdit,
    growPlannerTextareas,
    growPlannerCell,
    PLANNER_CARD_DRAG_THRESHOLD
} from './plannerSharedUi.js';
import { renderPlannerCardHtml, bindPlannerCardFields, closeOpenPlannerCardActions } from './plannerCardUi.js';

/** Phase/deliverable mode swap. */
const WBS_MODE_ICON = '<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true"><path d="M2.4 3.2h7.2M2.4 6h7.2M2.4 8.8h4.4" fill="none" stroke="currentColor" stroke-width="0.95" stroke-linecap="round"/><path d="M8.2 7.4l1.6 1.6 1.6-1.6" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * @param {object} planner
 * @param {object} card
 * @param {{ canEdit?: boolean, childClass?: string, isPack?: boolean, packCollapsed?: boolean }} [opts]
 */
function renderWbsCardHtml(planner, card, { canEdit = false, childClass = '', isPack = false, packCollapsed = false } = {}) {
    return renderPlannerCardHtml(planner, card, {
        mode: 'wbs',
        canEdit,
        childClass,
        isPack,
        packCollapsed,
        includeRowId: true,
        indent: '        ',
        rowLabel: (p, c) => getPlannerOutlineLabel(p, c.row)
    });
}

/**
 * @param {object} planner
 * @param {Array<{ type: string, card?: object, packId?: string, packRow?: number, packCard?: object, collapsed?: boolean, cards?: object[] }>} groups
 * @param {{ canEdit?: boolean }} [opts]
 */
function renderWbsColumnBodyHtml(planner, groups, { canEdit = false } = {}) {
    if (!groups?.length) return '<div class="planner-wbs__empty-col" aria-hidden="true"></div>';
    const lastIdx = groups.length - 1;
    return groups.map((group, gi) => {
        const branchClass = gi === lastIdx ? ' is-wbs-branch is-wbs-branch-last' : ' is-wbs-branch';
        if (group.type === 'pack' && group.packCard) {
            const packCollapsed = !!group.collapsed;
            const collapsedClass = packCollapsed ? ' is-pack-collapsed' : '';
            const kidsHtml = packCollapsed
                ? ''
                : (group.cards || []).map((card, i) => {
                    const last = i === group.cards.length - 1;
                    const childClass = last ? ' is-wbs-child is-wbs-child-last' : ' is-wbs-child';
                    return renderWbsCardHtml(planner, card, { canEdit, childClass });
                }).join('');
            const kidsBlock = kidsHtml
                ? `<div class="planner-wbs__tree-kids">${kidsHtml}</div>`
                : '';
            return `<div class="planner-wbs__tree${branchClass}${collapsedClass}" data-planner-wbs-tree data-planner-wbs-pack-id="${escapeAttr(group.packId)}" data-wbs-pack-collapsed="${packCollapsed ? '1' : '0'}">
                ${renderWbsCardHtml(planner, group.packCard, { canEdit, isPack: true, packCollapsed })}
                ${kidsBlock}
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
        const headColor = String(col.color || '').trim();
        const headSurface = surfaceThemeInline(headColor);
        const headColorClass = headColor ? ` has-color${headSurface.className}` : '';
        const colorBtnHtml = canEdit && !collapsed && col.bucket != null
            ? `<button type="button" class="planner-wbs__column-color" data-planner-wbs-bucket-color data-bucket="${col.bucket}" title="Column color" aria-label="Column color">${CARD_ICONS.color}</button>`
            : '';
        const grabHtml = canEdit && !collapsed && col.bucket != null
            ? `<span class="planner-wbs__column-grab" data-planner-wbs-bucket-grab title="Drag to reorder column" aria-hidden="true">${CARD_ICONS.drag}</span>`
            : '';
        return `<section class="planner-wbs__column${colClass}" data-planner-wbs-column data-planner-wbs-bucket="${escapeAttr(col.key)}" data-wbs-bucket-collapsed="${collapsed ? '1' : '0'}">
            <header class="planner-wbs__column-head${headColorClass}"${headSurface.style}>
                ${labelHtml}
                <span class="planner-wbs__column-count">${col.cards.length}</span>
                ${colorBtnHtml}
                ${grabHtml}
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
                ${renderFocusSpawnBtnHtml('wbs', 'WBS', { className: 'card-act planner-wbs-module-btn' })}
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
    growPlannerTextareas(next);
}
/**
 * @param {HTMLElement} section
 * @param {HTMLElement|null} [except]
 */
export function closeOpenWbsCardActions(section, except = null) {
    closeOpenPlannerCardActions(section, 'wbs', except);
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

        const wbsPackToggle = e.target.closest('[data-planner-wbs-pack-toggle]');
        if (wbsPackToggle && section.contains(wbsPackToggle)) {
            e.preventDefault();
            e.stopPropagation();
            const pack = wbsPackToggle.closest('[data-planner-wbs-pack]');
            const row = Number(pack?.dataset?.plannerRow);
            if (!Number.isFinite(row)) return true;
            const next = !isPlannerPackCollapsed(item.planner, row);
            mutate((it) => setPlannerPackCollapsed(it.planner, row, next), { skipRerender: true, refreshGantt: true });
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

        const wbsBucketColorBtn = e.target.closest('[data-planner-wbs-bucket-color]');
        if (wbsBucketColorBtn && section.contains(wbsBucketColorBtn)) {
            e.preventDefault();
            e.stopPropagation();
            const bucket = Number(wbsBucketColorBtn.dataset.bucket);
            if (!Number.isFinite(bucket)) return true;
            const current = resolveNoteColor(getWbsBucketColor(item.planner, bucket) || '');
            ColorPicker.open({
                anchor: wbsBucketColorBtn,
                presets: PALETTE_NOTE,
                value: current,
                onSelect: (color) => {
                    const hex = resolveNoteColor(color);
                    mutate((it) => {
                        setWbsBucketColor(it.planner, bucket, hex);
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
        mirrorBoardFieldToTableDom
    } = ctx;

    bindPlannerCardFields(section, 'wbs', {
        item, schedulePlannerCommit, flushPlannerCommit, mirrorBoardFieldToTableDom
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

    /** @type {{
     *   column: HTMLElement,
     *   bucket: number,
     *   slot: HTMLElement|null,
     *   offsetX: number,
     *   offsetY: number,
     *   lifted: boolean,
     *   startX: number,
     *   startY: number,
     *   pointerId: number
     * } | null} */
    let wbsColPtr = null;

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
     * Pack trees: before pack → before whole tree; mid-kids → inside tree-kids.
     */
    const insertWbsSlotBeforeCard = (slot, card, body) => {
        if (!slot || !card || !body) return;
        try {
            const tree = card.closest?.('[data-planner-wbs-tree]');
            if (tree && body.contains(tree)) {
                // Pack parent tile is a direct child of the tree wrapper.
                if (card.parentNode === tree) {
                    body.insertBefore(slot, tree);
                    pruneEmptyWbsTrees(body);
                    return;
                }
                const kids = tree.querySelector('.planner-wbs__tree-kids');
                if (kids?.contains(card)) {
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
            // Pack lifts leave children in the tree; put the pack back as the
            // tree's first child when the placeholder still sits before that tree.
            const treeAfter = slot.nextElementSibling;
            const packId = card?.hasAttribute?.('data-planner-wbs-pack')
                ? String(card.dataset.plannerRowId || '')
                : '';
            if (
                packId
                && treeAfter?.matches?.('[data-planner-wbs-tree]')
                && treeAfter.dataset.plannerWbsPackId === packId
            ) {
                treeAfter.insertBefore(card, treeAfter.firstChild);
            } else {
                slot.parentNode.insertBefore(card, slot);
            }
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
                if (card.parentNode === tree) {
                    // Pack parent — leave the placeholder before the whole tree
                    // (children stay nested under the tree while the pack floats).
                    homeBody.insertBefore(slot, tree);
                } else {
                    const kids = tree.querySelector('.planner-wbs__tree-kids');
                    if (kids?.contains(card)) kids.insertBefore(slot, card);
                    else homeBody.insertBefore(slot, tree);
                }
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
            if ((dx * dx + dy * dy) < PLANNER_CARD_DRAG_THRESHOLD * PLANNER_CARD_DRAG_THRESHOLD) return;
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
            if (hit.fieldKey === 'comments' && field) growPlannerCell(field);
        });
    }, true);

    const resetWbsColDragStyles = (column) => {
        if (!column) return;
        column.classList.remove('is-planner-wbs-col-dragging');
        column.style.position = '';
        column.style.left = '';
        column.style.top = '';
        column.style.width = '';
        column.style.height = '';
        column.style.zIndex = '';
        column.style.pointerEvents = '';
        column.style.margin = '';
        column.style.flex = '';
        column.style.maxWidth = '';
        column.style.minWidth = '';
    };

    const endWbsColPointerDrag = ({ commit = false } = {}) => {
        const state = wbsColPtr;
        wbsColPtr = null;
        document.removeEventListener('pointermove', onWbsColDocPointerMove);
        document.removeEventListener('pointerup', onWbsColDocPointerUp);
        document.removeEventListener('pointercancel', onWbsColDocPointerUp);
        document.body.classList.remove('is-planner-wbs-col-drag-active');
        if (!state) return;
        const { column, slot, bucket } = state;
        let beforeBucket = null;
        if (commit && slot?.isConnected) {
            const nextCol = slot.nextElementSibling;
            if (nextCol?.matches?.('[data-planner-wbs-column]')) {
                const n = Number(nextCol.dataset.plannerWbsBucket);
                if (Number.isFinite(n)) beforeBucket = n;
            }
        }
        if (slot?.parentNode) {
            slot.parentNode.insertBefore(column, slot);
            slot.remove();
        } else if (column && !column.isConnected && section.isConnected) {
            section.querySelector('[data-planner-wbs-board]')?.appendChild(column);
        }
        resetWbsColDragStyles(column);
        if (commit && state.lifted) {
            mutate((it) => {
                moveWbsBucket(it.planner, bucket, { beforeBucket });
            }, { skipRerender: true, refreshGantt: true });
        }
    };

    const placeWbsColSlot = (clientX, clientY, slot, draggedBucket) => {
        if (!slot) return;
        const board = section.querySelector('[data-planner-wbs-board]');
        if (!board) return;
        const columns = [...board.querySelectorAll('.planner-wbs__column[data-planner-wbs-bucket]')]
            .filter((c) => Number(c.dataset.plannerWbsBucket) !== draggedBucket);
        if (!columns.length) {
            board.appendChild(slot);
            return;
        }
        for (const col of columns) {
            const rect = col.getBoundingClientRect();
            const mid = (rect.left + rect.right) / 2;
            if (clientX < mid) {
                board.insertBefore(slot, col);
                return;
            }
        }
        board.appendChild(slot);
    };

    const liftWbsColumn = (state, clientX, clientY) => {
        if (state.lifted) return;
        const { column } = state;
        const board = column.closest('[data-planner-wbs-board]');
        if (!board) return;
        const rect = column.getBoundingClientRect();
        state.offsetX = clientX - rect.left;
        state.offsetY = clientY - rect.top;
        const slot = document.createElement('div');
        slot.className = 'planner-wbs__column-placeholder';
        slot.setAttribute('aria-hidden', 'true');
        slot.style.width = `${rect.width}px`;
        slot.style.minHeight = `${rect.height}px`;
        board.insertBefore(slot, column);
        state.slot = slot;
        document.body.appendChild(column);
        column.classList.add('is-planner-wbs-col-dragging');
        column.style.position = 'fixed';
        column.style.width = `${rect.width}px`;
        column.style.height = `${rect.height}px`;
        column.style.left = `${rect.left}px`;
        column.style.top = `${rect.top}px`;
        column.style.zIndex = '9999';
        column.style.pointerEvents = 'none';
        column.style.margin = '0';
        column.style.flex = 'none';
        column.style.maxWidth = 'none';
        column.style.minWidth = '0';
        document.body.classList.add('is-planner-wbs-col-drag-active');
        state.lifted = true;
    };

    const onWbsColDocPointerMove = (e) => {
        const state = wbsColPtr;
        if (!state || state.pointerId !== e.pointerId) return;
        const dx = e.clientX - state.startX;
        const dy = e.clientY - state.startY;
        if (!state.lifted) {
            if ((dx * dx + dy * dy) < PLANNER_CARD_DRAG_THRESHOLD * PLANNER_CARD_DRAG_THRESHOLD) return;
            e.preventDefault();
            liftWbsColumn(state, e.clientX, e.clientY);
        }
        if (!state.lifted) return;
        e.preventDefault();
        state.column.style.left = `${e.clientX - state.offsetX}px`;
        state.column.style.top = `${e.clientY - state.offsetY}px`;
        placeWbsColSlot(e.clientX, e.clientY, state.slot, state.bucket);
    };

    const onWbsColDocPointerUp = (e) => {
        const state = wbsColPtr;
        if (!state || (e.pointerId != null && state.pointerId !== e.pointerId)) return;
        endWbsColPointerDrag({ commit: state.lifted });
    };

    section.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (!plannerSectionCanEdit(section)) return;
        if (e.target.closest?.('[data-planner-wbs-bucket-color], [data-planner-wbs-bucket-collapse], [data-planner-wbs-label], input, textarea, [contenteditable], button')) return;
        const head = e.target.closest('.planner-wbs__column-head');
        if (!head || !section.contains(head)) return;
        const column = head.closest('[data-planner-wbs-column]');
        if (!column || !section.contains(column)) return;
        const bucket = Number(column.dataset.plannerWbsBucket);
        if (!Number.isFinite(bucket)) return;
        if (wbsPtr) endWbsPointerDrag({ commit: false });
        if (wbsColPtr) endWbsColPointerDrag({ commit: false });
        wbsColPtr = {
            column,
            bucket,
            slot: null,
            offsetX: 0,
            offsetY: 0,
            lifted: false,
            startX: e.clientX,
            startY: e.clientY,
            pointerId: e.pointerId
        };
        document.addEventListener('pointermove', onWbsColDocPointerMove, { passive: false });
        document.addEventListener('pointerup', onWbsColDocPointerUp);
        document.addEventListener('pointercancel', onWbsColDocPointerUp);
    });

    section.addEventListener('pointerdown', (e) => {
        if (e.button != null && e.button !== 0) return;
        if (e.target.closest?.('[data-planner-wbs-color], [data-planner-wbs-emphasis], [data-planner-wbs-reset-card], [data-planner-wbs-density], [data-planner-wbs-more], [data-planner-wbs-pack-toggle], [data-planner-wbs-field], textarea, input, [contenteditable]')) return;
        const card = e.target.closest('[data-planner-wbs-card]');
        if (!card || !section.contains(card) || !card.classList.contains('is-editable')) return;
        if (wbsFlyoutEditAt(e.clientX, e.clientY)) return;
        if (wbsColPtr) endWbsColPointerDrag({ commit: false });
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

    section.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const toggle = e.target.closest?.('[data-planner-wbs-pack-toggle]');
        if (!toggle || !section.contains(toggle)) return;
        e.preventDefault();
        const pack = toggle.closest('[data-planner-wbs-pack]');
        const row = Number(pack?.dataset?.plannerRow);
        if (!Number.isFinite(row)) return;
        const next = !isPlannerPackCollapsed(item.planner, row);
        mutate((it) => setPlannerPackCollapsed(it.planner, row, next), { skipRerender: true, refreshGantt: true });
    });
}
