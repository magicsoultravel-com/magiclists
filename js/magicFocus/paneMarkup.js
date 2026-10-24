/** @module {"owns":"the body markup for one focus pane - checklist, planner table/chart/kanban/wbs, media, and the preset picker glyphs; the planner and attachment renderers are loaded lazily so focus never drags them into the boot graph", "related":["magicFocus.js","magicFocus/panes.js","noteSurfaceHtml.js","plannerUi.js"]} */

import { buildExpandedChecklistHtml } from '../noteSurfaceHtml.js';

export function buildChecklistPaneHtml(item) {
    if (!item.steps) item.steps = [];
    return buildExpandedChecklistHtml(item, true, { richEdit: true });
}

export async function buildTablePaneHtml(item) {
    const { normalizePlanner } = await import('../planner.js');
    const { renderPlannerTableHtml } = await import('../plannerUi.js');
    if (!item.planner) return '<p class="magic-focus__empty">No planner table</p>';
    item.planner = normalizePlanner(item.planner) || item.planner;
    return `<div data-note-planner data-focus-table-only="1">${renderPlannerTableHtml(item.planner, { canEdit: true })}</div>`;
}

export async function buildChartPaneHtml(item) {
    const { normalizePlanner } = await import('../planner.js');
    const { renderPlannerGanttHtml } = await import('../plannerUi.js');
    if (!item.planner) return '<p class="magic-focus__empty">No planner chart</p>';
    item.planner = normalizePlanner(item.planner) || item.planner;
    // Force chart visible in focus pane
    const planner = { ...item.planner, chartCollapsed: false };
    const { html } = renderPlannerGanttHtml(planner, { canEdit: true });
    return `<div data-note-planner data-focus-chart-only="1">${html}</div>`;
}

export async function buildKanbanPaneHtml(item) {
    const { normalizePlanner } = await import('../planner.js');
    const { renderPlannerKanbanHtml } = await import('../plannerUi.js');
    if (!item.planner) return '<p class="magic-focus__empty">No planner kanban</p>';
    item.planner = normalizePlanner(item.planner) || item.planner;
    const planner = { ...item.planner, kanbanCollapsed: false };
    const html = renderPlannerKanbanHtml(planner, { canEdit: true });
    return `<div data-note-planner data-focus-kanban-only="1">${html}</div>`;
}

export async function buildWbsPaneHtml(item) {
    const { normalizePlanner } = await import('../planner.js');
    const { renderPlannerWbsHtml } = await import('../plannerUi.js');
    if (!item.planner) return '<p class="magic-focus__empty">No planner WBS</p>';
    item.planner = normalizePlanner(item.planner) || item.planner;
    const planner = { ...item.planner, wbsCollapsed: false };
    const html = renderPlannerWbsHtml(planner, { canEdit: true });
    return `<div data-note-planner data-focus-wbs-only="1">${html}</div>`;
}

export async function buildMediaPaneHtml(item) {
    const { buildNoteAttachmentsListHtml } = await import('../noteAttachmentsUi.js');
    const { normalizeAttachments } = await import('../mediaAttachments.js');
    const count = normalizeAttachments(item?.attachments).length;
    const listHtml = buildNoteAttachmentsListHtml(item, { canEdit: true });
    const bodyInner = count
        ? listHtml
        : `<p class="magic-focus__empty">No media yet</p>
            <p class="magic-focus__empty-cta"><button type="button" class="btn btn--compact" data-focus-media-add>Add media</button></p>`;
    // planner-sub shell matches Text/Checklist/Canvas panes. data-focus-media-sub
    // is the structural/CSS hook; data-focus-media-only on the inner host keeps
    // pane-identity parity with the table/chart/kanban/wbs -only markers.
    return `<div class="planner-sub magic-focus__media-sub" data-focus-media-sub data-media-collapsed="0">
        <div class="planner-sub__toolbar">
            <button type="button" class="planner-sub__title" data-focus-media-toggle aria-expanded="true">
                <span class="collapsable-toggle" aria-hidden="true">▼</span>Media${count ? ` (${count})` : ''}
            </button>
        </div>
        <div class="planner-sub__body" data-focus-media-body>
            <div data-note-attachments data-focus-media-only="1">${bodyInner}</div>
        </div>
    </div>`;
}

export function presetGlyphHtml(presetId) {
    // Stroke-based SVGs using currentColor — survives every theme.
    const icons = {
        'split2-v': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M20 2v24" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split2-h': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 14h36" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split3-cols': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M14 2v24M26 2v24" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split3-rows': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 10h36M2 18h36" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split3-1over2': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 13h36M20 13v13" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split3-2over1': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M2 15h36M20 2v13" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
        'split4-grid': `<svg class="magic-focus__preset-glyph" viewBox="0 0 40 28" width="40" height="28" aria-hidden="true"><rect x="1.5" y="1.5" width="37" height="25" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M20 2v24M2 14h36" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`
    };
    return icons[presetId] || icons['split2-v'];
}
