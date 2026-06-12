import { API } from './api.js';
import {
    categoryKey,
    isUncategorizedCategory,
    readStoredCategories,
    UNCATEGORIZED_CATEGORY
} from './categories.js';
import {
    UI,
    itemHasCategory,
    FREEFORM_MIN_W,
    FREEFORM_MIN_H,
    CANVAS_GRID_W,
    CANVAS_COL_GAP,
    CANVAS_LAYOUT_ORIGIN,
    COLUMN_MIN_CANVAS_H,
    COLUMN_GRID_CELL_W,
    COLUMN_GRID_CELL_H
} from './ui.js';

const DRAG_THRESHOLD = 4;

function teardownCanvasInit(canvas) {
    if (canvas?._dragDropAbort) {
        canvas._dragDropAbort.abort();
        canvas._dragDropAbort = null;
    }
}

function clampSize(w, h) {
    return {
        w: Math.max(FREEFORM_MIN_W, w),
        h: Math.max(FREEFORM_MIN_H, h)
    };
}

function getCanvasZoom(canvas) {
    const zoom = parseFloat(canvas?.dataset?.desktopZoom);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
}

function pointerDelta(canvas, clientX, clientY, startX, startY) {
    const zoom = getCanvasZoom(canvas);
    return {
        dx: (clientX - startX) / zoom,
        dy: (clientY - startY) / zoom
    };
}

function cardIsPinned(card) {
    const id = card?.dataset?.id;
    return !!id && UI.isBoardPinned(id);
}

function finishSnapPanelGesture(card, {
    canvas,
    currentItems,
    getBounds,
    saveLayout,
    reflow,
    onExpandFromResize,
    onCollapseFromResize,
    clearPreview,
    endScrollPolicy,
    cleanupActive,
    animate = true,
    tierResizeState = null,
    snapMode = 'full'
} = {}) {
    clearPreview(false);
    endScrollPolicy?.();
    const bounds = getBounds();
    const live = UI.readNoteRect(card);
    const origin = bounds.origin ?? CANVAS_LAYOUT_ORIGIN;
    const rect = snapMode === 'position'
        ? UI.snapNotePosition(live, { maxW: bounds.packW, maxH: bounds.maxH, origin })
        : UI.snapNoteRect(live, { maxW: bounds.packW, maxH: bounds.maxH });
    UI.applyNoteRect(card, rect, { settling: animate });

    const item = currentItems.find((i) => i.id === card.dataset.id);
    let tileSize = item ? UI.getCardTileSize(card, item) : 'compact';
    if (item && tierResizeState && UI.isCollapsedTile(card)) {
        tileSize = UI.commitTierResize(card, item, tierResizeState);
    }
    if (item && card.classList.contains('expanded') && UI.shouldSnapPanelCollapse(rect.w, rect.h, tileSize, { isExpanded: true })) {
        onCollapseFromResize(card, item, rect, { animate, bounds });
        cleanupActive?.();
        return;
    }

    saveLayout(card, rect, {
        customCompact: UI.isCollapsedTile(card) && UI.isCustomTileRect(rect.w, rect.h, tileSize)
    });
    reflow(card, { animate });
    cleanupActive?.();
}

function bindSnapPanelCardInteractions({
    canvas,
    panelEl,
    cardSelector,
    currentItems,
    signal,
    getBounds,
    computeLayout,
    raiseCard,
    dragClass,
    resizeClass,
    saveLayout,
    reflow,
    onExpandFromResize,
    onCollapseFromResize,
    scrollPolicy = false
}) {
    const cards = panelEl.querySelectorAll(cardSelector);
    let dragActive = null;
    let resizeActive = null;
    let previewFrame = null;
    let previewBaseline = null;

    const snapshotPreviewBaseline = () => {
        previewBaseline = new Map();
        panelEl.querySelectorAll(cardSelector).forEach((c) => {
            const id = c.dataset.id;
            if (id) previewBaseline.set(id, UI.readNoteRect(c));
        });
    };

    const restorePreviewBaseline = () => {
        if (!previewBaseline) return;
        previewBaseline.forEach((rect, id) => {
            const c = panelEl.querySelector(`${cardSelector}[data-id="${CSS.escape(id)}"]`);
            if (c) UI.applyNoteRect(c, rect, { settling: false });
        });
        previewBaseline = null;
    };

    const runLayoutPreview = (actorCard) => {
        if (!actorCard?.dataset?.id) return;
        if (previewFrame) return;
        previewFrame = requestAnimationFrame(() => {
            previewFrame = null;
            const actorRect = UI.readNoteRect(actorCard);
            const layout = computeLayout(actorCard.dataset.id, actorRect);
            layout.forEach((rect, id) => {
                if (id === actorCard.dataset.id) return;
                const other = panelEl.querySelector(`${cardSelector}[data-id="${CSS.escape(id)}"]`);
                if (!other) return;
                const base = previewBaseline?.get(id);
                const changed = !base
                    || base.x !== rect.x
                    || base.y !== rect.y
                    || base.w !== rect.w
                    || base.h !== rect.h;
                if (changed) {
                    UI.applyNoteRect(other, rect, { settling: true });
                    other.classList.add('layout-preview');
                }
            });
        });
    };

    const clearLayoutPreview = (restore = false) => {
        if (previewFrame) {
            cancelAnimationFrame(previewFrame);
            previewFrame = null;
        }
        UI.clearSnapPanelPreview(panelEl);
        if (restore) restorePreviewBaseline();
        else previewBaseline = null;
    };

    const endScrollPolicy = scrollPolicy
        ? () => UI.updateGridScrollPolicy(canvas, { forcing: false })
        : null;

    const startScrollPolicy = scrollPolicy
        ? () => UI.updateGridScrollPolicy(canvas, { forcing: true })
        : null;

    const markLayoutActive = () => {
        canvas.classList.add('is-layout-active');
        if (panelEl !== canvas) panelEl.classList.add('is-layout-active');
    };

    const cleanupActive = () => {
        canvas.classList.remove('is-layout-active', 'is-grid-forcing');
        if (panelEl !== canvas) panelEl.classList.remove('is-layout-active');
    };

    const finishAction = (card, { animate = true, tierResizeState = null } = {}) => {
        finishSnapPanelGesture(card, {
            canvas,
            currentItems,
            getBounds,
            saveLayout,
            reflow,
            onExpandFromResize,
            onCollapseFromResize,
            clearPreview: clearLayoutPreview,
            endScrollPolicy,
            cleanupActive,
            animate,
            tierResizeState
        });
    };

    const onDragMove = (e) => {
        if (!dragActive) return;
        const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, dragActive.startX, dragActive.startY);
        if (!dragActive.moved) {
            if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
            dragActive.moved = true;
            dragActive.card.classList.add(dragClass);
            markLayoutActive();
            snapshotPreviewBaseline();
            startScrollPolicy?.();
        }
        e.preventDefault();
        const bounds = getBounds();
        const origin = bounds.origin ?? 0;
        const x = Math.max(origin, dragActive.origX + dx);
        const y = Math.max(origin, dragActive.origY + dy);
        dragActive.card.style.left = `${x}px`;
        dragActive.card.style.top = `${y}px`;
        runLayoutPreview(dragActive.card);
    };

    const onDragUp = () => {
        if (!dragActive) return;
        const { card, moved } = dragActive;
        card.classList.remove(dragClass);
        if (moved) {
            card.dataset.skipExpand = '1';
            finishAction(card);
        } else {
            clearLayoutPreview(true);
            endScrollPolicy?.();
            cleanupActive();
        }
        dragActive = null;
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragUp);
    };

    const onResizeMove = (e) => {
        if (!resizeActive) return;
        const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, resizeActive.startX, resizeActive.startY);
        if (!resizeActive.moved) {
            if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
            resizeActive.moved = true;
            markLayoutActive();
            snapshotPreviewBaseline();
            startScrollPolicy?.();
        }
        const { card, axis, origX, origY, origW, origH } = resizeActive;

        let nextX = origX;
        let nextY = origY;
        let nextW = origW;
        let nextH = origH;

        if (axis.includes('e')) nextW = origW + dx;
        if (axis.includes('w')) {
            nextW = origW - dx;
            nextX = origX + dx;
        }
        if (axis.includes('s')) nextH = origH + dy;
        if (axis.includes('n')) {
            nextH = origH - dy;
            nextY = origY + dy;
        }

        const bounds = getBounds();
        const origin = bounds.origin ?? 0;
        const item = currentItems.find((i) => i.id === card.dataset.id);
        const maxW = bounds.packW + origin;

        if (item && UI.isCollapsedTile(card) && resizeActive.tierResizeState) {
            nextX = Math.max(origin, nextX);
            nextY = Math.max(origin, nextY);
            UI.processCollapsedTierResizeMove(card, item, resizeActive.tierResizeState, {
                x: nextX,
                y: nextY,
                w: nextW,
                h: nextH
            }, { maxW, axis });
            runLayoutPreview(card);
            return;
        }

        const clamped = UI.clampGridResize(nextW, nextH, { packW: bounds.packW });
        if (axis.includes('w')) nextX = origX + (origW - clamped.w);
        if (axis.includes('n')) nextY = origY + (origH - clamped.h);

        nextX = Math.max(origin, nextX);
        nextY = Math.max(origin, nextY);
        let finalW = clamped.w;
        let finalH = clamped.h;
        if (nextX + finalW > maxW) {
            if (axis.includes('w')) {
                nextX = Math.max(origin, maxW - finalW);
            } else {
                finalW = Math.max(COLUMN_GRID_CELL_W, maxW - nextX);
            }
        }

        card.style.left = `${nextX}px`;
        card.style.top = `${nextY}px`;
        card.style.setProperty('width', `${finalW}px`, 'important');
        card.style.setProperty('height', `${finalH}px`, 'important');
        card.style.setProperty('min-height', `${finalH}px`, 'important');
        card.style.setProperty('max-height', `${finalH}px`, 'important');
        runLayoutPreview(card);
    };

    const onResizeUp = () => {
        if (!resizeActive) return;
        const { card, moved, tierResizeState } = resizeActive;
        const item = currentItems.find((i) => i.id === card.dataset.id);
        card.classList.remove(resizeClass);
        if (moved) {
            card.dataset.skipExpand = '1';
            finishAction(card, { tierResizeState });
        } else if (tierResizeState && item) {
            UI.revertTierResizePreview(card, item, tierResizeState);
            clearLayoutPreview(true);
            endScrollPolicy?.();
            cleanupActive();
        } else {
            clearLayoutPreview(true);
            endScrollPolicy?.();
            cleanupActive();
        }
        resizeActive = null;
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeUp);
    };

    cards.forEach((card) => {
        card.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;

            if (shouldYieldToNoteEditor(e, card)) return;

            const resizeHandle = e.target.closest('.ff-resize');
            if (resizeHandle) {
                if (cardIsPinned(card)) return;
                e.preventDefault();
                e.stopPropagation();
                UI.cancelCardAnimation(card);
                raiseCard(card);
                markLayoutActive();
                startScrollPolicy?.();
                const { w: origW, h: origH } = UI.readFreeformCardSize(card);
                const item = currentItems.find((i) => i.id === card.dataset.id);
                const tierResizeState = item && UI.isCollapsedTile(card)
                    ? UI.createTierResizeSession(card, item)
                    : null;
                resizeActive = {
                    card,
                    axis: resizeHandle.dataset.axis || 'se',
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: parseFloat(card.style.left) || 0,
                    origY: parseFloat(card.style.top) || 0,
                    origW,
                    origH,
                    moved: false,
                    tierResizeState
                };
                card.classList.add(resizeClass);
                card.dataset.skipExpand = '1';
                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeUp);
                return;
            }

            if (pointerHitsStepGrab(e.clientX, e.clientY)) return;
            if (!shouldStartCardDrag(e.target)) return;
            if (cardIsPinned(card)) return;

            const scrollHost = e.target.closest('.editor-note-body') || e.target.closest('.card-body');
            if (scrollHost && isScrollbarGrip(scrollHost, e.clientX)) return;

            e.stopPropagation();
            dragActive = {
                card,
                startX: e.clientX,
                startY: e.clientY,
                origX: parseFloat(card.style.left) || 0,
                origY: parseFloat(card.style.top) || 0,
                moved: false
            };
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragUp);
        }, { signal });
    });
}

function isScrollbarGrip(el, clientX) {
    if (!el || el.scrollHeight <= el.clientHeight) return false;
    const scrollbarWidth = el.offsetWidth - el.clientWidth;
    if (scrollbarWidth <= 0) return false;
    const rect = el.getBoundingClientRect();
    return clientX >= rect.right - scrollbarWidth - 2;
}

function isInsideDragControl(target) {
    if (target?.closest('.card-act--drag')) return false;
    return !!target.closest(
        '.card-actions, .card-act, .step-check, .step-delete-btn, .step-collapse-btn, ' +
        '.card-inline-edit, .rich-text--edit, .step-nest-controls, .step-row-actions, ' +
        '.grab-handle--step, .expanded-checklist-add-btn, .checklist-expand-collapse-all-btn, .editor-body-convert-bar, ' +
        '.ff-resize, .card-act--pin, ' +
        '.tool-panel, .tool-chip, .tool-chip__drag, .tool-chip__actions, .tool-chip__expand, .tool-panel__resize-e, .tool-panel__resize-s, .tool-panel__resize-se, .tool-panel__header, ' +
        'a, button, input, textarea, select'
    );
}

function pointerHitsStepGrab(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    return document.elementsFromPoint(clientX, clientY)
        .some((el) => el instanceof Element && el.closest('.grab-handle--step'));
}

function pointerHitsInlineEdit(clientX, clientY, card) {
    return pointerHitsNoteEditor(clientX, clientY, card);
}

function pointerHitsNoteEditor(clientX, clientY, card) {
    if (!card || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    return document.elementsFromPoint(clientX, clientY)
        .some((el) => el instanceof Element
            && card.contains(el)
            && el.closest(
                '.editor-note-shell .card-inline-edit, '
                + '.editor-note-shell .step-check, '
                + '.editor-note-shell .step-text, '
                + '.editor-note-shell .step-collapse-btn, '
                + '.editor-note-shell .expanded-checklist, '
                + '.editor-note-shell .checklist-done-toggle, '
                + '.editor-note-shell input, '
                + '.editor-note-shell textarea, '
                + '.editor-note-shell button, '
                + '.editor-note-shell a, '
                + '.editor-note-shell .grab-handle--step'
            ));
}

function shouldYieldToNoteEditor(e, card) {
    if (!e || !card) return false;
    if (pointerHitsNoteEditor(e.clientX, e.clientY, card)) return true;
    return !!e.target?.closest?.(
        '.editor-note-shell .card-inline-edit, '
        + '.editor-note-shell .step-text, '
        + '.editor-note-shell .step-check'
    );
}

function shouldStartCardDrag(target) {
    if (!target) return false;
    if (target.closest('.card-act--drag')) return true;
    if (isInsideDragControl(target)) return false;
    if (target.closest('.editor-note-header, .editor-note-body, .card-body.editor-note-body')) return false;
    const surface = target.closest('.card-drag-zone, .ff-drag-gutter');
    if (!surface) return false;
    return true;
}

function bindPointerSession({ onKeyDown, onCancel }) {
    const onEsc = (e) => {
        if (e.key === 'Escape') {
            onCancel();
            cleanup();
        }
    };
    const cleanup = () => {
        document.removeEventListener('keydown', onEsc);
        document.removeEventListener('pointercancel', onCancel);
    };
    document.addEventListener('keydown', onEsc);
    document.addEventListener('pointercancel', onCancel);
    if (onKeyDown) document.addEventListener('keydown', onKeyDown);
    return cleanup;
}

export const DragDropEngine = {
    init(userState, currentItems, onMutationComplete) {
        if (!userState || !userState.isLoggedIn) return;

        const canvas = document.getElementById('app-canvas');
        if (!canvas) return;

        teardownCanvasInit(canvas);
        const ac = new AbortController();
        canvas._dragDropAbort = ac;
        const { signal } = ac;

        if (canvas.classList.contains('view-freeform') || canvas.classList.contains('view-grid')) {
            const snapEnabled = canvas.classList.contains('view-grid');
            this.initDesktopInteractions(canvas, currentItems, signal, { snapEnabled });
        }
    },

    initDesktopInteractions(canvas, currentItems = [], signal, { snapEnabled = false } = {}) {
        const cards = canvas.querySelectorAll('.mini-card[data-desktop="1"]');
        let dragActive = null;
        let resizeActive = null;
        let previewFrame = null;
        let previewBaseline = null;

        const snapshotPreviewBaseline = () => {
            previewBaseline = new Map();
            canvas.querySelectorAll('.mini-card[data-desktop="1"]').forEach((c) => {
                const id = c.dataset.id;
                if (id) previewBaseline.set(id, UI.readNoteRect(c));
            });
        };

        const restorePreviewBaseline = () => {
            if (!previewBaseline) return;
            previewBaseline.forEach((rect, id) => {
                const c = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
                if (c) UI.applyNoteRect(c, rect, { settling: false });
            });
            previewBaseline = null;
        };

        const runLayoutPreview = (actorCard) => {
            if (!snapEnabled || !actorCard?.dataset?.id) return;
            if (previewFrame) return;
            previewFrame = requestAnimationFrame(() => {
                previewFrame = null;
                const actorRect = UI.readNoteRect(actorCard);
                const layout = UI.computeGridBoardLayout(canvas, actorCard.dataset.id, actorRect);
                layout.forEach((rect, id) => {
                    if (id === actorCard.dataset.id) return;
                    const other = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
                    if (!other) return;
                    const base = previewBaseline?.get(id);
                    const changed = !base
                        || base.x !== rect.x
                        || base.y !== rect.y
                        || base.w !== rect.w
                        || base.h !== rect.h;
                    if (changed) {
                        UI.applyNoteRect(other, rect, { settling: true });
                        other.classList.add('layout-preview');
                    }
                });
            });
        };

        const clearLayoutPreview = (restore = false) => {
            if (previewFrame) {
                cancelAnimationFrame(previewFrame);
                previewFrame = null;
            }
            UI.clearSnapPanelPreview(canvas);
            if (restore) restorePreviewBaseline();
            else previewBaseline = null;
        };

        const finishSnapDrop = (card, { tierResizeState = null } = {}) => {
            finishSnapPanelGesture(card, {
                canvas,
                currentItems,
                getBounds: () => UI.getGridBoardBounds(canvas),
                saveLayout: (c, rect, { customCompact }) => {
                    UI.saveGridLayout(c.dataset.id, rect, { customCompact });
                },
                reflow: (c, { animate }) => {
                    UI.reflowGridBoard(canvas, c.dataset.id, { animate });
                },
                onExpandFromResize: (c, item, rect) => {
                    UI.updateDesktopCard(c, item, {
                        expanded: true,
                        dimensions: { w: rect.w, h: rect.h }
                    });
                },
                onCollapseFromResize: (c, item, rect, { animate, bounds }) => {
                    UI.collapseSnapPanelCard(c, item);
                    const tileSize = UI.getCardTileSize(c, item);
                    const compact = UI.gridTileRect(tileSize, rect, { ...rect, customCompact: true });
                    const finalRect = UI.snapNoteRect(
                        { ...compact, x: rect.x, y: rect.y },
                        { maxW: bounds.packW, maxH: bounds.maxH }
                    );
                    UI.applyNoteRect(c, finalRect, { settling: animate });
                    UI.saveGridLayout(c.dataset.id, finalRect, {
                        customCompact: UI.isCustomTileRect(finalRect.w, finalRect.h, tileSize)
                    });
                    UI.reflowGridBoard(canvas, c.dataset.id, { animate });
                },
                clearPreview: clearLayoutPreview,
                endScrollPolicy: () => UI.updateGridScrollPolicy(canvas, { forcing: false }),
                cleanupActive: () => {
                    canvas.classList.remove('is-layout-active', 'is-grid-forcing');
                },
                animate: true,
                tierResizeState,
                snapMode: 'position'
            });
        };

        const onDragMove = (e) => {
            if (!dragActive) return;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, dragActive.startX, dragActive.startY);
            if (!dragActive.moved) {
                if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
                dragActive.moved = true;
                dragActive.card.classList.add(snapEnabled ? 'is-grid-dragging' : 'is-freeform-dragging');
                if (snapEnabled) {
                    canvas.classList.add('is-layout-active');
                    snapshotPreviewBaseline();
                    UI.updateGridScrollPolicy(canvas, { forcing: true });
                }
            }
            e.preventDefault();
            const origin = snapEnabled ? (UI.getGridBoardBounds(canvas).origin ?? 0) : 0;
            const x = Math.max(origin, dragActive.origX + dx);
            const y = Math.max(origin, dragActive.origY + dy);
            dragActive.card.style.left = `${x}px`;
            dragActive.card.style.top = `${y}px`;
            if (snapEnabled) runLayoutPreview(dragActive.card);
        };

        const onDragUp = () => {
            if (!dragActive) return;
            const { card, moved } = dragActive;
            card.classList.remove('is-grid-dragging', 'is-freeform-dragging');
            if (moved) {
                card.dataset.skipExpand = '1';
                if (snapEnabled) {
                    finishSnapDrop(card);
                } else {
                    UI.saveFreeformPosition(
                        card.dataset.id,
                        parseFloat(card.style.left) || 0,
                        parseFloat(card.style.top) || 0
                    );
                }
            } else if (snapEnabled) {
                clearLayoutPreview(true);
                UI.updateGridScrollPolicy(canvas, { forcing: false });
                canvas.classList.remove('is-layout-active', 'is-grid-forcing');
            }
            dragActive = null;
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragUp);
        };

        const onResizeMove = (e) => {
            if (!resizeActive) return;
            e.preventDefault();
            const { card, axis, startX, startY, origX, origY, origW, origH, tierResizeState } = resizeActive;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, startX, startY);
            if (!resizeActive.moved) {
                if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
                resizeActive.moved = true;
                if (snapEnabled) {
                    canvas.classList.add('is-layout-active');
                    snapshotPreviewBaseline();
                    UI.updateGridScrollPolicy(canvas, { forcing: true });
                }
            }
            const item = currentItems.find((i) => i.id === card.dataset.id);
            const origin = snapEnabled ? (UI.getGridBoardBounds(canvas).origin ?? 0) : 0;

            let nextX = origX;
            let nextY = origY;
            let nextW = origW;
            let nextH = origH;

            if (axis.includes('e')) nextW = origW + dx;
            if (axis.includes('w')) {
                nextW = origW - dx;
                nextX = origX + dx;
            }
            if (axis.includes('s')) nextH = origH + dy;
            if (axis.includes('n')) {
                nextH = origH - dy;
                nextY = origY + dy;
            }

            if (item && UI.isCollapsedTile(card) && tierResizeState && !snapEnabled) {
                nextX = Math.max(origin, nextX);
                nextY = Math.max(origin, nextY);
                UI.processCollapsedTierResizeMove(card, item, tierResizeState, {
                    x: nextX,
                    y: nextY,
                    w: nextW,
                    h: nextH
                }, { axis });
                return;
            }

            if (item && UI.isCollapsedTile(card) && tierResizeState && snapEnabled) {
                nextX = Math.max(origin, nextX);
                nextY = Math.max(origin, nextY);
                card.dataset.tierResizePreview = '1';
                card.classList.add('is-tier-resizing');
                card.style.left = `${nextX}px`;
                card.style.top = `${nextY}px`;
                card.style.setProperty('width', `${Math.max(FREEFORM_MIN_W, nextW)}px`, 'important');
                card.style.setProperty('height', `${Math.max(FREEFORM_MIN_H, nextH)}px`, 'important');
                card.style.setProperty('min-height', `${Math.max(FREEFORM_MIN_H, nextH)}px`, 'important');
                card.style.setProperty('max-height', `${Math.max(FREEFORM_MIN_H, nextH)}px`, 'important');
                runLayoutPreview(card);
                return;
            }

            const clamped = clampSize(nextW, nextH);
            if (axis.includes('w')) nextX = origX + (origW - clamped.w);
            if (axis.includes('n')) nextY = origY + (origH - clamped.h);

            nextX = Math.max(origin, nextX);
            nextY = Math.max(origin, nextY);
            const finalW = clamped.w;
            const finalH = clamped.h;

            card.style.left = `${nextX}px`;
            card.style.top = `${nextY}px`;
            card.style.setProperty('width', `${finalW}px`, 'important');
            card.style.setProperty('height', `${finalH}px`, 'important');
            card.style.setProperty('min-height', `${finalH}px`, 'important');
            card.style.setProperty('max-height', `${finalH}px`, 'important');
            if (snapEnabled) runLayoutPreview(card);
        };

        const onResizeUp = () => {
            if (!resizeActive) return;
            const { card, moved, tierResizeState } = resizeActive;
            const item = currentItems.find((i) => i.id === card.dataset.id);
            card.classList.remove('is-grid-resizing', 'is-freeform-resizing');

            if (!moved && tierResizeState && item) {
                UI.revertTierResizePreview(card, item, tierResizeState);
                if (snapEnabled) {
                    clearLayoutPreview(true);
                    UI.updateGridScrollPolicy(canvas, { forcing: false });
                    canvas.classList.remove('is-layout-active', 'is-grid-forcing');
                }
            } else if (moved) {
                card.dataset.skipExpand = '1';
                if (snapEnabled) {
                    if (item && tierResizeState && UI.isCollapsedTile(card)) {
                        const { w, h } = UI.readFreeformCardSize(card);
                        tierResizeState.previewTier = UI.inferCollapsedTileTier(
                            w,
                            h,
                            tierResizeState.previewTier
                        );
                        delete card.dataset.tierResizePreview;
                        card.classList.remove('is-tier-resizing');
                    }
                    finishSnapDrop(card, { tierResizeState });
                } else {
                    UI.saveFreeformPosition(
                        card.dataset.id,
                        parseFloat(card.style.left) || 0,
                        parseFloat(card.style.top) || 0
                    );
                    if (item && tierResizeState && UI.isCollapsedTile(card)) {
                        const tileSize = UI.commitTierResize(card, item, tierResizeState);
                        const { w, h } = UI.readFreeformCardSize(card);
                        UI.saveFreeformSize(card.dataset.id, w, h, {
                            customCompact: UI.isCustomTileRect(w, h, tileSize)
                        });
                        UI.finalizeDesktopCard(card);
                    } else {
                        UI.saveFreeformSizeFromCard(card);
                    }
                }
            } else if (snapEnabled) {
                clearLayoutPreview(true);
                UI.updateGridScrollPolicy(canvas, { forcing: false });
                canvas.classList.remove('is-layout-active', 'is-grid-forcing');
            }
            resizeActive = null;
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeUp);
        };

        cards.forEach((card) => {
            card.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;

                if (shouldYieldToNoteEditor(e, card)) return;

                const resizeHandle = e.target.closest('.ff-resize');
                if (resizeHandle) {
                    if (cardIsPinned(card)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    UI.cancelCardAnimation(card);
                    if (snapEnabled) UI.raiseDesktopCard(card);
                    const { w: startW, h: startH } = UI.readFreeformCardSize(card);
                    const itemMatch = currentItems.find((i) => i.id === card.dataset.id);
                    const tierResizeState = itemMatch && UI.isCollapsedTile(card)
                        ? UI.createTierResizeSession(card, itemMatch)
                        : null;
                    resizeActive = {
                        card,
                        axis: resizeHandle.dataset.axis || 'se',
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: parseFloat(card.style.left) || 0,
                        origY: parseFloat(card.style.top) || 0,
                        origW: startW,
                        origH: startH,
                        moved: false,
                        tierResizeState
                    };
                    card.classList.add(snapEnabled ? 'is-grid-resizing' : 'is-freeform-resizing');
                    card.dataset.skipExpand = '1';
                    document.addEventListener('mousemove', onResizeMove);
                    document.addEventListener('mouseup', onResizeUp);
                    return;
                }

                if (pointerHitsStepGrab(e.clientX, e.clientY)) return;
                if (!shouldStartCardDrag(e.target)) return;
                if (cardIsPinned(card)) return;

                const scrollHost = e.target.closest('.editor-note-body') || e.target.closest('.card-body');
                if (scrollHost && isScrollbarGrip(scrollHost, e.clientX)) return;

                e.stopPropagation();
                dragActive = {
                    card,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: parseFloat(card.style.left) || 0,
                    origY: parseFloat(card.style.top) || 0,
                    moved: false
                };
                document.addEventListener('mousemove', onDragMove);
                document.addEventListener('mouseup', onDragUp);
            }, { signal });
        });
    },

    initFreeformInteractions(canvas, currentItems = [], signal) {
        const cards = canvas.querySelectorAll('.mini-card');
        let dragActive = null;
        let resizeActive = null;

        const onDragMove = (e) => {
            if (!dragActive) return;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, dragActive.startX, dragActive.startY);
            if (!dragActive.moved) {
                if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
                dragActive.moved = true;
                dragActive.card.classList.add('is-freeform-dragging');
            }
            e.preventDefault();
            const x = Math.max(0, dragActive.origX + dx);
            const y = Math.max(0, dragActive.origY + dy);
            dragActive.card.style.left = `${x}px`;
            dragActive.card.style.top = `${y}px`;
        };

        const onDragUp = () => {
            if (!dragActive) return;
            const { card, moved } = dragActive;
            card.classList.remove('is-freeform-dragging');
            if (moved) {
                card.dataset.skipExpand = '1';
                UI.saveFreeformPosition(
                    card.dataset.id,
                    parseFloat(card.style.left) || 0,
                    parseFloat(card.style.top) || 0
                );
            }
            dragActive = null;
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragUp);
        };

        const onResizeMove = (e) => {
            if (!resizeActive) return;
            e.preventDefault();
            const { card, axis, startX, startY, origX, origY, origW, origH, tierResizeState } = resizeActive;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, startX, startY);
            if (!resizeActive.moved) {
                if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
                resizeActive.moved = true;
            }
            const item = currentItems.find((i) => i.id === card.dataset.id);

            let nextX = origX;
            let nextY = origY;
            let nextW = origW;
            let nextH = origH;

            if (axis.includes('e')) nextW = origW + dx;
            if (axis.includes('w')) {
                nextW = origW - dx;
                nextX = origX + dx;
            }
            if (axis.includes('s')) nextH = origH + dy;
            if (axis.includes('n')) {
                nextH = origH - dy;
                nextY = origY + dy;
            }

            if (item && UI.isCollapsedTile(card) && tierResizeState) {
                nextX = Math.max(0, nextX);
                nextY = Math.max(0, nextY);
                UI.processCollapsedTierResizeMove(card, item, tierResizeState, {
                    x: nextX,
                    y: nextY,
                    w: nextW,
                    h: nextH
                }, { axis });
                return;
            }

            const clamped = clampSize(nextW, nextH);
            if (axis.includes('w')) nextX = origX + (origW - clamped.w);
            if (axis.includes('n')) nextY = origY + (origH - clamped.h);

            nextX = Math.max(0, nextX);
            nextY = Math.max(0, nextY);

            card.style.left = `${nextX}px`;
            card.style.top = `${nextY}px`;
            card.style.setProperty('width', `${clamped.w}px`, 'important');
            card.style.setProperty('height', `${clamped.h}px`, 'important');
            card.style.setProperty('min-height', `${clamped.h}px`, 'important');
            card.style.setProperty('max-height', `${clamped.h}px`, 'important');
        };

        const onResizeUp = () => {
            if (!resizeActive) return;
            const { card, moved, tierResizeState } = resizeActive;
            const item = currentItems.find((i) => i.id === card.dataset.id);
            card.classList.remove('is-freeform-resizing');

            if (!moved && tierResizeState && item) {
                UI.revertTierResizePreview(card, item, tierResizeState);
            } else if (moved) {
                card.dataset.skipExpand = '1';
                UI.saveFreeformPosition(
                    card.dataset.id,
                    parseFloat(card.style.left) || 0,
                    parseFloat(card.style.top) || 0
                );
                if (item && tierResizeState && UI.isCollapsedTile(card)) {
                    const tileSize = UI.commitTierResize(card, item, tierResizeState);
                    const { w, h } = UI.readFreeformCardSize(card);
                    UI.saveFreeformSize(card.dataset.id, w, h, {
                        customCompact: UI.isCustomTileRect(w, h, tileSize)
                    });
                    UI.finalizeFreeformCard(card);
                } else {
                    UI.saveFreeformSizeFromCard(card);
                }
            }
            resizeActive = null;
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeUp);
        };

        cards.forEach(card => {
            card.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;

                if (shouldYieldToNoteEditor(e, card)) return;

                const resizeHandle = e.target.closest('.ff-resize');
                if (resizeHandle) {
                    if (cardIsPinned(card)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    UI.cancelCardAnimation(card);
                    const { w: startW, h: startH } = UI.readFreeformCardSize(card);
                    const itemMatch = currentItems.find((i) => i.id === card.dataset.id);
                    const tierResizeState = itemMatch && UI.isCollapsedTile(card)
                        ? UI.createTierResizeSession(card, itemMatch)
                        : null;
                    resizeActive = {
                        card,
                        axis: resizeHandle.dataset.axis || 'se',
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: parseFloat(card.style.left) || 0,
                        origY: parseFloat(card.style.top) || 0,
                        origW: startW,
                        origH: startH,
                        moved: false,
                        tierResizeState
                    };
                    card.classList.add('is-freeform-resizing');
                    card.dataset.skipExpand = '1';
                    document.addEventListener('mousemove', onResizeMove);
                    document.addEventListener('mouseup', onResizeUp);
                    return;
                }

                if (pointerHitsStepGrab(e.clientX, e.clientY)) return;
                if (!shouldStartCardDrag(e.target)) return;
                if (cardIsPinned(card)) return;

                const scrollHost = e.target.closest('.editor-note-body') || e.target.closest('.card-body');
                if (scrollHost && isScrollbarGrip(scrollHost, e.clientX)) return;

                e.stopPropagation();
                dragActive = {
                    card,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: parseFloat(card.style.left) || 0,
                    origY: parseFloat(card.style.top) || 0,
                    moved: false
                };
                document.addEventListener('mousemove', onDragMove);
                document.addEventListener('mouseup', onDragUp);
            }, { signal });
        });
    },

    initGridBoardInteractions(canvas, currentItems = [], signal) {
        bindSnapPanelCardInteractions({
            canvas,
            panelEl: canvas,
            cardSelector: '.mini-card[data-grid-board="1"]',
            currentItems,
            signal,
            getBounds: () => UI.getGridBoardBounds(canvas),
            computeLayout: (actorId, actorRect) => UI.computeGridBoardLayout(canvas, actorId, actorRect),
            raiseCard: (card) => UI.raiseGridBoardCard(card),
            dragClass: 'is-grid-dragging',
            resizeClass: 'is-grid-resizing',
            scrollPolicy: true,
            saveLayout: (card, rect, { customCompact }) => {
                UI.saveGridLayout(card.dataset.id, rect, { customCompact });
            },
            reflow: (card, { animate }) => {
                UI.reflowGridBoard(canvas, card.dataset.id, { animate });
            },
            onExpandFromResize: (card, item, rect) => {
                UI.updateGridBoardCard(card, item, {
                    expanded: true,
                    dimensions: { w: rect.w, h: rect.h }
                });
            },
            onCollapseFromResize: (card, item, rect, { animate, bounds }) => {
                UI.collapseSnapPanelCard(card, item);
                const tileSize = UI.getCardTileSize(card, item);
                const compact = UI.gridTileRect(tileSize, rect, { ...rect, customCompact: true });
                const finalRect = UI.snapNoteRect(
                    { ...compact, x: rect.x, y: rect.y },
                    { maxW: bounds.packW, maxH: bounds.maxH }
                );
                UI.applyNoteRect(card, finalRect, { settling: animate });
                UI.saveGridLayout(card.dataset.id, finalRect, {
                    customCompact: UI.isCustomTileRect(finalRect.w, finalRect.h, tileSize)
                });
                UI.reflowGridBoard(canvas, card.dataset.id, { animate });
            }
        });
    },

};
