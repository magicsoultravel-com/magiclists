/** @module {"owns":"magicPlanner shared UI helpers — canvas scroll guard, edit-state probes, card comment auto-grow, card date label", "related":["plannerUi.js","plannerSheetUi.js","plannerChartUi.js","plannerKanbanUi.js","plannerWbsUi.js","icons.js"]} */

/**
 * Same pattern as checklist: keep #app-canvas from jumping on DOM surgery.
 * @returns {{ scrollTop: number, scrollLeft: number }}
 */
export function captureCanvasScroll() {
    const canvas = document.getElementById('app-canvas');
    return {
        scrollTop: canvas?.scrollTop ?? 0,
        scrollLeft: canvas?.scrollLeft ?? 0
    };
}

/**
 * @param {{ scrollTop?: number, scrollLeft?: number } | null} scrollPos
 */
export function restoreCanvasScroll(scrollPos) {
    const canvas = document.getElementById('app-canvas');
    if (!canvas || !scrollPos) return;
    canvas.scrollTop = scrollPos.scrollTop;
    canvas.scrollLeft = scrollPos.scrollLeft;
}

/**
 * @param {Element | null | undefined} body
 * @returns {boolean}
 */
export function bodyCanEdit(body) {
    return !!(body?.querySelector?.('.card-inline-edit, .sheet-cell-input, .planner-cell-input, .expanded-checklist-add-btn'));
}

/**
 * @param {Element | null | undefined} section
 * @returns {boolean}
 */
export function plannerSectionCanEdit(section) {
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
 * Compact `YYYY-MM-DD` label for card corner overlays (Kanban, WBS, chart preview).
 * @param {unknown} value
 * @returns {string}
 */
export function formatPlannerCardDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
}

/** Pointer lift threshold shared by Kanban / WBS card drags. */
export const PLANNER_CARD_DRAG_THRESHOLD = 4;

/**
 * Card comment textareas that cap at ~3 lines when not focused.
 * Sheet `.planner-cell-input` textareas are intentionally unbounded (no CSS cap) —
 * keep them out of this list or sheet cells start clamping.
 */
export const PLANNER_COMMENT_TEXTAREA_SEL = 'textarea.planner-kanban__card-comment, textarea.planner-wbs__card-comment';

/** Every planner textarea that needs a height re-measure after DOM rebuild. */
const PLANNER_GROW_SEL = `.planner-cell-input, ${PLANNER_COMMENT_TEXTAREA_SEL}`;

/**
 * Re-measure planner textareas after DOM rebuild (Focus table, first bind, refresh).
 * @param {ParentNode | null | undefined} section
 */
export function growPlannerTextareas(section) {
    const canvasScroll = captureCanvasScroll();
    section?.querySelectorAll(PLANNER_GROW_SEL).forEach((el) => {
        growPlannerCell(el);
    });
    restoreCanvasScroll(canvasScroll);
}

/**
 * Auto-size a single planner cell — cheap enough for per-keystroke use.
 * Card comments: empty stays 1 line; content caps at ~3 lines unless focused.
 * @param {HTMLElement | null | undefined} el
 */
export function growPlannerCell(el) {
    if (!el || !el.style) return;
    el.style.height = '0';
    const next = Math.max(el.scrollHeight, 18);
    if (el.matches?.(PLANNER_COMMENT_TEXTAREA_SEL) && document.activeElement !== el) {
        const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || 14;
        const hasText = String(el.value || '').trim().length > 0;
        el.style.height = `${Math.min(next, Math.round(lh * (hasText ? 3 : 1)))}px`;
        return;
    }
    el.style.height = `${next}px`;
}
