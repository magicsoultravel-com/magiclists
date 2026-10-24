/** @module {"owns":"the pane surface - chrome controls, per-pane zoom, expand/collapse, filling a pane with its block body, the delegated pane interactions, and hosting the drawing board inside a pane", "related":["magicFocus.js","magicFocus/paneMarkup.js","magicFocus/model.js","magicFocus/splitters.js","drawingBoard.js"]} */
import { CARD_ICONS } from '../icons.js';
import { buildNoteContentFieldHtml } from '../noteSurfaceHtml.js';
import { NoteSurface, clearDesktopAutoSaveTimer, flushDesktopAutoSave } from '../noteSurface.js';
import { escapeAttr } from '../domEscape.js';
import { createEmptyNoteCanvas } from '../noteModel.js';
import { focusInlineEdit } from '../noteSurfaceEditing.js';
import {
    PRESET_ZONE_COUNTS,
    FOCUS_ZOOM_MIN,
    FOCUS_ZOOM_MAX,
    FOCUS_ZOOM_STEP,
    FOCUS_ZOOM_DEFAULT,
    clampFocusZoom,
    asBlockList,
    createDefaultFocus,
    normalizeFocus
} from './model.js';
import {
    buildChecklistPaneHtml,
    buildTablePaneHtml,
    buildChartPaneHtml,
    buildKanbanPaneHtml,
    buildWbsPaneHtml,
    buildMediaPaneHtml
} from './paneMarkup.js';


export function _bindPaneChromeControls(magicFocus) {
    const work = magicFocus.bodyEl?.querySelector('[data-magic-focus-work]');
    if (!work) return;
    work.querySelectorAll('[data-focus-pane-expand]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pane = btn.closest('[data-focus-pane]');
            const zid = pane?.getAttribute('data-focus-pane');
            if (!zid) return;
            if (magicFocus.expandedPaneId === zid) magicFocus.clearExpandedPane();
            else magicFocus.setExpandedPane(zid);
        });
    });
    work.querySelectorAll('[data-focus-pane-zoom-out]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pane = btn.closest('[data-focus-pane]');
            const zid = pane?.getAttribute('data-focus-pane');
            if (!zid) return;
            magicFocus._nudgePaneZoom(zid, -FOCUS_ZOOM_STEP);
        });
    });
    work.querySelectorAll('[data-focus-pane-zoom-in]').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const pane = btn.closest('[data-focus-pane]');
            const zid = pane?.getAttribute('data-focus-pane');
            if (!zid) return;
            magicFocus._nudgePaneZoom(zid, FOCUS_ZOOM_STEP);
        });
    });
}

export function _nudgePaneZoom(magicFocus, zoneId, delta) {
    if (!zoneId) return;
    if (magicFocus.sessionSpawnBlocks?.length) {
        const next = clampFocusZoom((magicFocus.sessionSpawnZoom ?? FOCUS_ZOOM_DEFAULT) + delta);
        magicFocus.sessionSpawnZoom = next;
        magicFocus._applyPaneZoom(zoneId, next);
        magicFocus._refitHostedCanvas();
        return;
    }
    const item = magicFocus.resolveItem();
    if (!item) return;
    const focus = normalizeFocus(item.focus) || createDefaultFocus();
    const next = clampFocusZoom((focus.zoom?.[zoneId] ?? FOCUS_ZOOM_DEFAULT) + delta);
    const zoom = { ...focus.zoom, [zoneId]: next };
    NoteSurface.mutateItem(item, (it) => {
        if (!it.focus) it.focus = createDefaultFocus(focus.preset);
        it.focus = normalizeFocus({
            ...it.focus,
            ratios: focus.ratios,
            preset: focus.preset,
            zones: focus.zones,
            zoom
        });
    }, { preserveView: true, skipRerender: true });
    magicFocus._applyPaneZoom(zoneId, next);
    magicFocus._refitHostedCanvas();
}

export function _applyPaneZoom(magicFocus, zoneId, zoomPct) {
    const pane = magicFocus.bodyEl?.querySelector(`[data-focus-pane="${CSS.escape(zoneId)}"]`);
    if (!pane) return;
    const pct = clampFocusZoom(zoomPct);
    pane.style.setProperty('--focus-pane-zoom', String(pct / 100));
    const label = pane.querySelector('[data-focus-pane-zoom-label]');
    if (label) label.textContent = `${pct}%`;
    const outBtn = pane.querySelector('[data-focus-pane-zoom-out]');
    const inBtn = pane.querySelector('[data-focus-pane-zoom-in]');
    if (outBtn) outBtn.disabled = pct <= FOCUS_ZOOM_MIN;
    if (inBtn) inBtn.disabled = pct >= FOCUS_ZOOM_MAX;
}

export function setExpandedPane(magicFocus, zoneId) {
    const work = magicFocus.bodyEl?.querySelector('[data-magic-focus-work]');
    if (!work || !zoneId) return;
    magicFocus.expandedPaneId = zoneId;
    work.classList.add('is-pane-expanded');
    work.querySelectorAll('[data-focus-pane]').forEach((pane) => {
        const id = pane.getAttribute('data-focus-pane');
        pane.classList.toggle('is-expanded', id === zoneId);
    });
    magicFocus._syncPaneExpandButtons();
    magicFocus._refitHostedCanvas();
}

export function clearExpandedPane(magicFocus) {
    const work = magicFocus.bodyEl?.querySelector('[data-magic-focus-work]');
    magicFocus.expandedPaneId = null;
    if (work) {
        work.classList.remove('is-pane-expanded');
        work.querySelectorAll('[data-focus-pane].is-expanded').forEach((pane) => {
            pane.classList.remove('is-expanded');
        });
    }
    magicFocus._syncPaneExpandButtons();
    magicFocus._refitHostedCanvas();
}

export function _syncPaneExpandButtons(magicFocus) {
    const work = magicFocus.bodyEl?.querySelector('[data-magic-focus-work]');
    if (!work) return;
    work.querySelectorAll('[data-focus-pane]').forEach((pane) => {
        const btn = pane.querySelector('[data-focus-pane-expand]');
        if (!btn) return;
        const zid = pane.getAttribute('data-focus-pane');
        const expanded = magicFocus.expandedPaneId === zid;
        btn.innerHTML = expanded ? CARD_ICONS.collapseMedia : CARD_ICONS.expandMedia;
        const label = expanded ? 'Restore pane' : 'Expand pane';
        btn.title = label;
        btn.setAttribute('aria-label', label);
        btn.setAttribute('aria-pressed', expanded ? 'true' : 'false');
    });
}

export function _refitHostedCanvas(magicFocus) {
    if (!magicFocus.drawingHosted) return;
    import('../drawingBoard.js').then(({ DrawingBoard }) => {
        if (DrawingBoard.active) DrawingBoard.resize?.();
    }).catch(() => {});
}

export async function _blockHtml(magicFocus, item, block, zoneId) {
    if (block === 'text') {
        const textCollapsed = !!item.textCollapsed;
        // Reuse the canonical content-field builder so Focus renders text
        // exactly like the board/modal (rich edit, links, <br> line breaks).
        const field = buildNoteContentFieldHtml(item, { canEdit: true, richEdit: true });
        return `<div class="planner-sub" data-note-text data-text-collapsed="${textCollapsed ? '1' : '0'}">
            <div class="planner-sub__toolbar">
                <button type="button" class="planner-sub__title" data-note-text-toggle aria-expanded="${textCollapsed ? 'false' : 'true'}">
                    <span class="collapsable-toggle${textCollapsed ? ' collapsed' : ''}" aria-hidden="true">▼</span>Text
                </button>
            </div>
            <div class="planner-sub__body${textCollapsed ? ' is-collapsed' : ''}" data-note-text-body>${field}</div>
        </div>`;
    }
    if (block === 'checklist') {
        const checklistCollapsed = !!item.checklistCollapsed;
        if (!item.steps) item.steps = [];
        return `<div class="planner-sub" data-note-checklist-sub data-checklist-collapsed="${checklistCollapsed ? '1' : '0'}">
            <div class="planner-sub__toolbar">
                <button type="button" class="planner-sub__title" data-note-checklist-toggle aria-expanded="${checklistCollapsed ? 'false' : 'true'}">
                    <span class="collapsable-toggle${checklistCollapsed ? ' collapsed' : ''}" aria-hidden="true">▼</span>Checklist
                </button>
            </div>
            <div class="planner-sub__body${checklistCollapsed ? ' is-collapsed' : ''}" data-note-checklist-body>
                ${buildChecklistPaneHtml(item)}
            </div>
        </div>`;
    }
    if (block === 'table') return buildTablePaneHtml(item);
    if (block === 'chart') return buildChartPaneHtml(item);
    if (block === 'kanban') return buildKanbanPaneHtml(item);
    if (block === 'wbs') return buildWbsPaneHtml(item);
    if (block === 'media') return buildMediaPaneHtml(item);
    if (block === 'canvas') {
        if (!item.canvas) {
            NoteSurface.mutateItem(item, (it) => {
                it.canvas = createEmptyNoteCanvas();
                it.canvasHidden = false;
            }, { preserveView: true, skipRerender: true });
        }
        return `<div class="planner-sub magic-focus__canvas-sub" data-focus-canvas-sub>
            <div class="planner-sub__toolbar">
                <button type="button" class="planner-sub__title" data-focus-canvas-toggle aria-expanded="true">
                    <span class="collapsable-toggle" aria-hidden="true">▼</span>Canvas
                </button>
            </div>
            <div class="planner-sub__body" data-focus-canvas-body>
                <div class="magic-focus__canvas-host" data-focus-canvas-host="${escapeAttr(zoneId)}"></div>
            </div>
        </div>`;
    }
    return '';
}

export async function _fillPane(magicFocus, body, item, blocks, zoneId) {
    const list = Array.isArray(blocks) ? blocks : asBlockList(blocks);
    // Board checklist refresh syncs before rebuild; match that so collapse/
    // expand paths do not drop in-flight step/text edits.
    const pane = body.closest?.('.magic-focus__pane');
    const live = magicFocus.resolveItem() || item;
    if (pane && live && pane.querySelector('.card-inline-edit, .expanded-checklist, [data-note-text]')) {
        flushDesktopAutoSave(pane, live, { mergeWindow: false });
    } else {
        // No editable DOM yet (first mount) — still cancel any orphan timer.
        clearDesktopAutoSaveTimer();
    }
    // Checklist structural ops (indent/outdent/delete/drag) stash the step to
    // refocus; re-apply it once the fresh rows exist.
    const pendingStepId = body.dataset.pendingFocusStepId || '';
    const pendingEdge = body.dataset.pendingFocusEdge || 'end';
    if (pendingStepId) {
        delete body.dataset.pendingFocusStepId;
        delete body.dataset.pendingFocusEdge;
    }
    const parts = [];
    for (const block of list) {
        parts.push(await magicFocus._blockHtml(live || item, block, zoneId));
    }
    body.innerHTML = parts.join('');
    magicFocus._bindPaneInteractions(body, live || item);
    if (pendingStepId) {
        const stepTextEl = body.querySelector(`.step-text.card-inline-edit[data-step-id="${CSS.escape(pendingStepId)}"]`);
        if (stepTextEl) focusInlineEdit(stepTextEl, pendingEdge === 'start' ? 'start' : 'end');
    }

    const canvasHost = body.querySelector('[data-focus-canvas-host]');
    if (canvasHost) {
        await magicFocus._hostDrawingBoard(canvasHost, item);
        const toggle = body.querySelector('[data-focus-canvas-toggle]');
        toggle?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sub = body.querySelector('[data-focus-canvas-sub]');
            const subBody = sub?.querySelector('[data-focus-canvas-body]');
            const chevron = toggle.querySelector('.collapsable-toggle');
            const collapsed = subBody?.classList.toggle('is-collapsed');
            chevron?.classList.toggle('collapsed', !!collapsed);
            toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
            if (!collapsed) magicFocus._relayoutFocusCanvas();
        });
    }
}

export function _relayoutFocusCanvas(magicFocus) {
    if (!magicFocus.drawingHosted) return;
    requestAnimationFrame(() => {
        import('../drawingBoard.js').then(({ DrawingBoard }) => {
            if (DrawingBoard.active) DrawingBoard.resize?.();
        });
        import('../drawingToolbarChrome.js').then(({ DrawingToolbarChrome }) => {
            if (DrawingToolbarChrome.collapsed) {
                DrawingToolbarChrome.positionChip?.(false);
                DrawingToolbarChrome.chip?.classList.remove('is-hidden');
            }
        });
    });
}

export function _bindPaneInteractions(magicFocus, body, item) {
    const { bindNoteEditorShell } = NoteSurface;
    const pane = body.closest('.magic-focus__pane');
    if (!pane) return;
    if (!pane.classList.contains('editor-note-shell')) {
        pane.classList.add('editor-note-shell');
    }
    try {
        bindNoteEditorShell(pane, item, {
            richEdit: true,
            localOnly: false,
            stopMousedownPropagation: true,
            // Checklist structural ops call refresh() (delete/indent/outdent/
            // collapse/done). Focus owns the pane, so rebuild it in place.
            refresh: () => magicFocus.refreshChecklistPane(body),
            onChange: () => {}
        });
    } catch { /* ignore */ }

    // Each table/chart/kanban block is its own [data-note-planner] — bind every one.
    import('../plannerUi.js').then(({ attachPlannerInteractions }) => {
        body.querySelectorAll('[data-note-planner]').forEach((sec) => {
            attachPlannerInteractions(sec, item, {
                localOnly: false,
                onChange: () => {},
                refresh: () => {
                    magicFocus.refreshPlannerPanes?.(item);
                }
            });
        });
    }).catch(() => {});

    import('../noteAttachmentsUi.js').then(({ bindNoteAttachments }) => {
        body.querySelectorAll('[data-focus-media-sub]').forEach((sub) => {
            // Focus-local collapse: toggle the planner-sub body only.
            // Never writes item.attachmentsCollapsed (board state stays intact).
            const toggle = sub.querySelector('[data-focus-media-toggle]');
            const subBody = sub.querySelector('[data-focus-media-body]');
            if (toggle && subBody && !toggle.dataset.focusMediaToggleBound) {
                toggle.dataset.focusMediaToggleBound = '1';
                toggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const collapsed = subBody.classList.toggle('is-collapsed');
                    toggle.querySelector('.collapsable-toggle')?.classList.toggle('collapsed', !!collapsed);
                    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
                    sub.dataset.mediaCollapsed = collapsed ? '1' : '0';
                });
            }
            // Add-media CTA routes to the board entry point (library overlay).
            const addBtn = sub.querySelector('[data-focus-media-add]');
            if (addBtn && !addBtn.dataset.focusMediaAddBound) {
                addBtn.dataset.focusMediaAddBound = '1';
                addBtn.addEventListener('click', () => {
                    if (!localStorage.getItem('admin_token')) {
                        import('../toast.js').then(({ showAppToast }) => {
                            showAppToast('Login required to attach media');
                        }).catch(() => {});
                        return;
                    }
                    import('../mediaLibraryOverlay.js').then(({ MediaLibraryOverlay }) => {
                        MediaLibraryOverlay.open({ attachNoteId: item.id });
                    }).catch(() => {});
                });
            }
            // Row bindings (hydrate, reorder via mutateItem, quick-actions)
            // attach to the inner host. bindNoteAttachments is idempotent
            // per root (dataset flags), so a re-bind after refresh is safe.
            const host = sub.querySelector('[data-note-attachments][data-focus-media-only]');
            if (host) bindNoteAttachments(host, item);
        });
    }).catch(() => {});

    import('../flowchartUi.js').then(({ attachFlowchartInteractions }) => {
        body.querySelectorAll('[data-note-flowchart]').forEach((sec) => {
            attachFlowchartInteractions(sec.closest('.editor-note-body') || sec.parentElement, item);
        });
    }).catch(() => {});
}

export async function _hostDrawingBoard(magicFocus, hostEl, item) {
    const board = document.getElementById('drawing-board');
    if (!board || !hostEl) return;
    const { DrawingBoard } = await import('../drawingBoard.js');
    const { DrawingToolbarChrome } = await import('../drawingToolbarChrome.js');

    if (!magicFocus.drawingHomeParent) {
        magicFocus.drawingHomeParent = board.parentElement;
    }
    hostEl.appendChild(board);
    board.classList.add('magic-focus-canvas-board');
    board.classList.remove('is-hidden');
    board.setAttribute('aria-hidden', 'false');
    magicFocus.drawingHosted = true;

    DrawingToolbarChrome.setHostBounds?.(board, {
        storageKey: 'matrix_focus_drawing_toolbar',
        defaultCollapsed: true
    });

    // Activate note canvas without leaving focus / setting data-drawing-mode
    await DrawingBoard.activateForNote(item);
    // Force collapsed toolbar for focus default
    if (!DrawingToolbarChrome.collapsed) {
        DrawingToolbarChrome.collapse?.();
    }
    // Layout may still be settling (multi-section flex); resize + re-seat chip.
    magicFocus._relayoutFocusCanvas();
}

export async function _unhostDrawingBoard(magicFocus) {
    if (!magicFocus.drawingHosted) return;
    const board = document.getElementById('drawing-board');
    const { DrawingBoard } = await import('../drawingBoard.js');
    const { DrawingToolbarChrome } = await import('../drawingToolbarChrome.js');

    if (DrawingBoard.active || DrawingBoard.isNoteCanvasMode || DrawingBoard.docOwner) {
        await DrawingBoard.deactivate();
    }

    DrawingToolbarChrome.clearHostBounds?.();

    if (board && magicFocus.drawingHomeParent) {
        board.classList.remove('magic-focus-canvas-board');
        board.classList.add('is-hidden');
        board.setAttribute('aria-hidden', 'true');
        magicFocus.drawingHomeParent.appendChild(board);
    }
    magicFocus.drawingHosted = false;
}

export async function refreshChecklistPane(magicFocus, body) {
    if (!magicFocus.isOpen() || magicFocus.showingSetup || !body?.isConnected) return;
    const zoneId = body.getAttribute('data-focus-pane-body');
    const item = magicFocus.resolveItem();
    if (!zoneId || !item) return;
    const blocks = magicFocus.sessionSpawnBlocks?.length
        ? asBlockList(magicFocus.sessionSpawnBlocks)
        : asBlockList(normalizeFocus(item.focus)?.zones?.[zoneId]);
    if (!blocks.length) return;
    await magicFocus._fillPane(body, item, blocks, zoneId);
}

export async function refreshPlannerPanes(magicFocus, item) {
    if (!magicFocus.isOpen() || !item || magicFocus.showingSetup) return;
    const live = magicFocus.resolveItem() || item;
    const { renderPlannerTableHtml, refreshPlannerDerivedViews, growPlannerTextareas } = await import('../plannerUi.js');
    const { normalizePlanner } = await import('../planner.js');
    if (live.planner) live.planner = normalizePlanner(live.planner) || live.planner;

    /** @type {{ zid: string, blocks: string[] }[]} */
    let paneSpecs;
    if (magicFocus.sessionSpawnBlocks?.length) {
        paneSpecs = [{ zid: 'z0', blocks: asBlockList(magicFocus.sessionSpawnBlocks) }];
    } else {
        const focus = normalizeFocus(live.focus);
        if (!focus) return;
        const count = PRESET_ZONE_COUNTS[focus.preset] || 2;
        paneSpecs = [];
        for (let i = 0; i < count; i += 1) {
            const zid = `z${i}`;
            paneSpecs.push({ zid, blocks: asBlockList(focus.zones[zid]) });
        }
    }

    for (const { zid, blocks } of paneSpecs) {
        if (!blocks.includes('table') && !blocks.includes('chart') && !blocks.includes('kanban') && !blocks.includes('wbs')) continue;
        const body = magicFocus.bodyEl.querySelector(`[data-focus-pane-body="${zid}"]`);
        if (!body) continue;
        const tableSec = body.querySelector('[data-note-planner][data-focus-table-only]');
        const chartSec = body.querySelector('[data-note-planner][data-focus-chart-only]');
        const kanbanSec = body.querySelector('[data-note-planner][data-focus-kanban-only]');
        const wbsSec = body.querySelector('[data-note-planner][data-focus-wbs-only]');
        if (!tableSec && !chartSec && !kanbanSec && !wbsSec) {
            // Planner section not mounted yet — render the pane from scratch.
            await magicFocus._fillPane(body, live, blocks, zid);
            continue;
        }
        if (tableSec && live.planner) {
            tableSec.innerHTML = renderPlannerTableHtml(live.planner, { canEdit: true });
            // Host stays bound; re-measure textareas so multi-line Comments/Name keep height.
            growPlannerTextareas(tableSec);
            requestAnimationFrame(() => {
                if (tableSec.isConnected) growPlannerTextareas(tableSec);
            });
        }
    }
    // Gantt + kanban + wbs + summary refresh, in place across every host (board/modal/focus).
    refreshPlannerDerivedViews(live);
}
