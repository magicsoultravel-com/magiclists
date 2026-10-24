/** @module {"owns":"painting the workspace - the header with its item picker and quick actions, the multi-pane work surface, and the ephemeral single-pane spawn view", "related":["magicFocus.js","magicFocus/panes.js","magicFocus/splitters.js","magicFocus/layout.js","magicFocus/model.js"]} */
import { CARD_ICONS, ACTION_ICONS } from '../icons.js';
import { buildNoteQuickActionsHtml, buildNoteTitleHtml } from '../noteSurfaceHtml.js';
import { bindNoteQuickActions } from '../noteQuickActions.js';
import { NoteSurface } from '../noteSurface.js';
import { applyCardTheme } from '../cardTheme.js';
import { resolveNoteColor } from '../colorPicker.js';
import {
    PRESET_ZONE_COUNTS,
    FOCUS_ZOOM_MIN,
    FOCUS_ZOOM_MAX,
    FOCUS_ZOOM_DEFAULT,
    clampFocusZoom,
    asBlockList,
    createDefaultFocus,
    normalizeFocus
} from './model.js';
import { layoutForFocus } from './layout.js';


export function applyNoteTheme(magicFocus, item) {
    if (!magicFocus.root) return;
    const color = item ? resolveNoteColor(item.backgroundColor) : '';
    applyCardTheme(magicFocus.root, color, { paintBackground: true });
}

export function renderHeader(magicFocus, item) {
    if (!magicFocus.headerEl) return;
    magicFocus.applyNoteTheme(item);
    const actions = buildNoteQuickActionsHtml(item, {
        surface: 'focus',
        isExpanded: true,
        showDrag: false,
        calHidden: !!item.hideFromCalendar,
        poppedOut: false
    });
    const titleHtml = buildNoteTitleHtml(item, true, { richEdit: true });
    magicFocus.headerEl.innerHTML = `
        <div class="editor-note-shell magic-focus__note-shell" data-magic-focus-shell>
            <div class="editor-note-topline">
                <div class="editor-note-header">
                    ${titleHtml}
                </div>
                <div class="note-editor-toolbar" data-magic-focus-actions>${actions}</div>
            </div>
        </div>
    `;
    const shell = magicFocus.headerEl.querySelector('[data-magic-focus-shell]');
    const actionsRoot = magicFocus.headerEl.querySelector('[data-magic-focus-actions]');
    const cardActions = actionsRoot?.querySelector('.card-actions');
    if (cardActions) {
        const focusBtn = cardActions.querySelector('.card-act--focus');
        const cog = document.createElement('button');
        cog.type = 'button';
        cog.className = 'card-act card-act--focus-settings';
        cog.title = 'Focus layout settings';
        cog.setAttribute('aria-label', 'Focus layout settings');
        cog.innerHTML = CARD_ICONS.focusSettings;
        if (focusBtn) focusBtn.insertAdjacentElement('afterend', cog);
        else cardActions.prepend(cog);

        cog.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            magicFocus.openSettings();
        });
    }

    if (shell) {
        NoteSurface.bindNoteEditorShell(shell, item, {
            richEdit: true,
            localOnly: false,
            stopMousedownPropagation: true,
            refresh: () => magicFocus.refreshChecklistPane(shell),
            onChange: () => {}
        });
    }

    bindNoteQuickActions(actionsRoot, item, {
        surface: 'focus',
        ui: magicFocus._ui,
        editor: {
            syncActiveItemFromDom: () => {
                const live = magicFocus.resolveItem() || item;
                if (shell) NoteSurface.syncItemBodyFromDom(shell, live);
                magicFocus.bodyEl?.querySelectorAll?.('.magic-focus__pane-body.editor-note-body').forEach((body) => {
                    NoteSurface.syncItemBodyFromDom(body, live);
                });
            },
            openColorPicker: () => {},
            openEmojiPicker: () => {},
            markInteracted: () => {},
            triggerAutoSave: () => {},
            collectFormData: () => magicFocus.resolveItem() || item,
            persistNote: () => {},
            close: () => magicFocus.close(),
            applySharedFromLive: () => {},
            applyNoteTheme: () => {
                magicFocus.applyNoteTheme(magicFocus.resolveItem() || item);
            }
        }
    });
}

export async function renderWork(magicFocus, item) {
    if (!magicFocus.bodyEl || !item) return;
    magicFocus.expandedPaneId = null;
    await magicFocus._unhostDrawingBoard();

    if (magicFocus.sessionSpawnBlocks?.length) {
        await magicFocus._renderSpawnWork(item);
        return;
    }

    const focus = normalizeFocus(item.focus) || createDefaultFocus();
    const layout = layoutForFocus(focus);
    const count = PRESET_ZONE_COUNTS[focus.preset] || 2;

    const panes = [];
    for (let i = 0; i < count; i += 1) {
        const zid = `z${i}`;
        const blocks = asBlockList(focus.zones[zid]);
        const empty = blocks.length === 0;
        const hasCanvas = blocks.includes('canvas');
        const zoomPct = clampFocusZoom(focus.zoom?.[zid] ?? FOCUS_ZOOM_DEFAULT);
        const zoomFactor = zoomPct / 100;
        const zoomOutDisabled = zoomPct <= FOCUS_ZOOM_MIN ? ' disabled' : '';
        const zoomInDisabled = zoomPct >= FOCUS_ZOOM_MAX ? ' disabled' : '';
        panes.push(`
            <section class="magic-focus__pane${empty ? ' magic-focus__pane--empty' : ''}${hasCanvas ? ' magic-focus__pane--canvas' : ''}"
                data-focus-pane="${zid}" style="grid-area:${zid}; --focus-pane-zoom: ${zoomFactor}">
                <div class="magic-focus__pane-chrome">
                    <button type="button" class="card-act" data-focus-pane-zoom-out
                        title="Zoom out" aria-label="Zoom out"${zoomOutDisabled}>${ACTION_ICONS.minus}</button>
                    <span class="magic-focus__pane-zoom-label" data-focus-pane-zoom-label>${zoomPct}%</span>
                    <button type="button" class="card-act" data-focus-pane-zoom-in
                        title="Zoom in" aria-label="Zoom in"${zoomInDisabled}>${ACTION_ICONS.plus}</button>
                    <button type="button" class="card-act magic-focus__pane-expand" data-focus-pane-expand
                        title="Expand pane" aria-label="Expand pane" aria-pressed="false">${CARD_ICONS.expandMedia}</button>
                </div>
                <div class="magic-focus__pane-body editor-note-body" data-focus-pane-body="${zid}"></div>
            </section>
        `);
    }

    magicFocus.bodyEl.innerHTML = `
        <div class="magic-focus__work" data-magic-focus-work>
            ${panes.join('')}
        </div>
    `;
    const workEl = magicFocus.bodyEl.querySelector('[data-magic-focus-work]');
    if (workEl) {
        workEl.style.gridTemplateColumns = layout.columns;
        workEl.style.gridTemplateRows = layout.rows;
        workEl.style.gridTemplateAreas = layout.areas;
    }

    for (let i = 0; i < count; i += 1) {
        const zid = `z${i}`;
        const blocks = asBlockList(focus.zones[zid]);
        const body = magicFocus.bodyEl.querySelector(`[data-focus-pane-body="${zid}"]`);
        if (!body) continue;
        if (!blocks.length) {
            body.innerHTML = `<div class="magic-focus__pane-empty-msg">Empty</div>`;
            continue;
        }
        await magicFocus._fillPane(body, item, blocks, zid);
    }

    magicFocus._mountSplitters(focus, layout);
    magicFocus._bindPaneChromeControls();
    magicFocus.renderHeader(item);
}

export async function _renderSpawnWork(magicFocus, item) {
    const zid = 'z0';
    const blocks = asBlockList(magicFocus.sessionSpawnBlocks);
    const empty = blocks.length === 0;
    const hasCanvas = blocks.includes('canvas');
    const zoomPct = clampFocusZoom(magicFocus.sessionSpawnZoom ?? FOCUS_ZOOM_DEFAULT);
    const zoomFactor = zoomPct / 100;
    const zoomOutDisabled = zoomPct <= FOCUS_ZOOM_MIN ? ' disabled' : '';
    const zoomInDisabled = zoomPct >= FOCUS_ZOOM_MAX ? ' disabled' : '';

    magicFocus.bodyEl.innerHTML = `
        <div class="magic-focus__work is-pane-expanded is-focus-spawn" data-magic-focus-work data-focus-spawn-work>
            <section class="magic-focus__pane${empty ? ' magic-focus__pane--empty' : ''}${hasCanvas ? ' magic-focus__pane--canvas' : ''} is-expanded"
                data-focus-pane="${zid}" style="grid-area: 1 / 1 / -1 / -1; --focus-pane-zoom: ${zoomFactor}">
                <div class="magic-focus__pane-chrome">
                    <button type="button" class="card-act" data-focus-pane-zoom-out
                        title="Zoom out" aria-label="Zoom out"${zoomOutDisabled}>${ACTION_ICONS.minus}</button>
                    <span class="magic-focus__pane-zoom-label" data-focus-pane-zoom-label>${zoomPct}%</span>
                    <button type="button" class="card-act" data-focus-pane-zoom-in
                        title="Zoom in" aria-label="Zoom in"${zoomInDisabled}>${ACTION_ICONS.plus}</button>
                    <button type="button" class="card-act magic-focus__pane-expand" data-focus-pane-expand
                        title="Restore pane" aria-label="Restore pane" aria-pressed="true">${CARD_ICONS.collapseMedia}</button>
                </div>
                <div class="magic-focus__pane-body editor-note-body" data-focus-pane-body="${zid}"></div>
            </section>
        </div>
    `;
    const workEl = magicFocus.bodyEl.querySelector('[data-magic-focus-work]');
    if (workEl) {
        workEl.style.gridTemplateColumns = '1fr';
        workEl.style.gridTemplateRows = '1fr';
        workEl.style.gridTemplateAreas = '"z0"';
    }

    const body = magicFocus.bodyEl.querySelector(`[data-focus-pane-body="${zid}"]`);
    if (body) {
        if (!blocks.length) {
            body.innerHTML = `<div class="magic-focus__pane-empty-msg">Empty</div>`;
        } else {
            await magicFocus._fillPane(body, item, blocks, zid);
        }
    }

    magicFocus.expandedPaneId = zid;
    magicFocus._bindPaneChromeControls();
    magicFocus._syncPaneExpandButtons();
    magicFocus.renderHeader(item);
}
