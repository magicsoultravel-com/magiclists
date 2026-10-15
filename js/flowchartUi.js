/** flowchart note subsection UI */
import { escapeAttr } from './domEscape.js';
import { CARD_ICONS } from './icons.js';
import { createEmptyFlowchart, normalizeFlowchart, flowchartHasContent } from './flowchart.js';
import { renderFocusSpawnTrayHtml } from './noteFocusSpawn.js';

function flowchartIsVisible(item) {
    return !!(item && item.flowchart && !item.flowchartHidden);
}

export function buildNoteFlowchartSectionHtml(item, opts) {
    const o = opts || {};
    const canEdit = o.canEdit !== false;
    if (!flowchartIsVisible(item)) return '';
    const collapsed = o.startCollapsed ? ' collapsed' : '';
    const toggleCollapsed = o.startCollapsed ? ' collapsed' : '';
    const isEmpty = !flowchartHasContent(item.flowchart);
    // Pencil lives in the body toolbar (same as the Canvas section) so it is
    // always reachable instead of hidden behind a hover-gated header tray.
    const editBtn = canEdit
        ? '<button type="button" class="card-act note-flowchart__enter-drawing" data-flowchart-edit title="Draw in magicCanvas" aria-label="Draw in magicCanvas">'
            + CARD_ICONS.drawingPencil + '</button>'
        : '';
    return '<div class="note-body-section note-body-section--flowchart" data-note-flowchart>'
        + '<div class="note-section-header collapsable-header" data-flowchart-header>'
        + '<span class="collapsable-heading"><span class="collapsable-toggle' + toggleCollapsed + '">▼</span>Flowchart</span>'
        + renderFocusSpawnTrayHtml('flowchart', 'Flowchart')
        + '</div>'
        + '<div class="note-section-body collapsable-section' + collapsed + '" data-flowchart-body>'
        + '<div class="note-flowchart" data-note-flowchart-inner>'
        + '<div class="note-flowchart__toolbar">' + editBtn + '</div>'
        + '<div class="note-flowchart__viewport" data-note-flowchart-viewport>'
        + '<canvas data-note-flowchart-preview></canvas>'
        + (isEmpty ? '<span class="note-flowchart__empty">Click the pencil to draw a flowchart</span>' : '')
        + '</div>'
        + '</div>'
        + '</div></div>';
}

export function refreshNoteFlowchartPreview(section, item) {
    if (!section || !item || !item.flowchart) return;
    const canvas = section.querySelector('[data-note-flowchart-preview]');
    if (!canvas || !canvas.getContext) return;
    import('./noteCanvasRenderer.js').then(function (m) {
        m.renderNoteCanvas(canvas, item.flowchart.doc, { item });
    }).catch(function () {});
}

export function attachFlowchartInteractions(body, item) {
    if (!body || !item || !body.querySelector) return;
    const section = body.querySelector('[data-note-flowchart]');
    if (!section) return;
    refreshNoteFlowchartPreview(section, item);
    const header = section.querySelector('[data-flowchart-header]');
    const inner = section.querySelector('[data-flowchart-body]');
    if (header && inner) {
        header.addEventListener('click', function (e) {
            // Let the focus-spawn tray and body toolbar handle their own clicks.
            if (e.target.closest('[data-flowchart-edit], [data-focus-spawn]')) return;
            const next = inner.classList.toggle('collapsed');
            // Rotate the caret so collapsed state is visible, matching collapsable-toggle.
            const caret = header.querySelector('.collapsable-toggle');
            if (caret) caret.classList.toggle('collapsed', next);
            // Persist like contentCollapsed so the section remembers its state.
            import('./noteSurfaceMutations.js').then(function (m) {
                if (m && m.mutateItem) {
                    m.mutateItem(item, function (it) {
                        it.flowchartCollapsed = next;
                    }, { preserveView: true, skipRerender: true });
                }
            }).catch(function () {});
        });
    }
    const editBtn = section.querySelector('[data-flowchart-edit]');
    if (editBtn) {
        editBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            // Dispatch like the Canvas section's pencil: the app owns the
            // workspace switch (dock/zoom/shell) and then opens the board.
            if (window.opener) {
                window.opener.dispatchEvent(new CustomEvent('note:flowchart_draw_requested', { detail: { item: item } }));
            } else {
                window.dispatchEvent(new CustomEvent('note:flowchart_draw_requested', { detail: { item: item } }));
            }
        });
    }
}

function noteBodiesForItem(itemId) {
    if (!itemId || typeof document === 'undefined') return [];
    const out = [];
    document.querySelectorAll('.mini-card[data-id]').forEach(function (card) {
        if (card.dataset.id !== itemId) return;
        const body = card.querySelector('.editor-note-body');
        if (body) out.push(body);
    });
    return out;
}

export function syncNoteFlowchartDom(item) {
    if (!item || !item.id || typeof document === 'undefined') return;
    const bodies = noteBodiesForItem(item.id);
    for (const body of bodies) {
        if (body.closest && body.closest('#magic-focus')) continue;
        const html = buildNoteFlowchartSectionHtml(item, { canEdit: true });
        const existing = body.querySelector('[data-note-flowchart]');
        if (!html) {
            if (existing) existing.remove();
            continue;
        }
        const tmp = document.createElement('div');
        tmp.innerHTML = html.trim();
        const next = tmp.firstElementChild;
        if (!next) continue;
        if (existing) existing.replaceWith(next);
        else body.appendChild(next);
        attachFlowchartInteractions(body, item);
    }
}

export { createEmptyFlowchart, normalizeFlowchart };
