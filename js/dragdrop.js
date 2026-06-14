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
    isDesktopCard,
    FREEFORM_MIN_W,
    FREEFORM_MIN_H,
    CANVAS_COL_GAP,
    CANVAS_LAYOUT_ORIGIN,
    getGridMetrics
} from './ui.js';
import { isAtSmallSize } from './tileGeometry.js';
import { readTileSmallFootprint } from './tileFootprint.js';
import { initFileCabinetDrag, isFileCabinetActive, fileItemToCabinet, shouldFileItem } from './fileCabinet.js';
import { isAtOrBelowCompactZone } from './tileGeometry.js';

const DRAG_THRESHOLD = 4;
const GRID_SCROLL_EDGE = 40;
const GRID_SCROLL_STEP = 10;

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

function autoScrollDesktopCanvas(canvas, clientX, clientY, { scrollX = true } = {}) {
    const rect = canvas.getBoundingClientRect();
    if (clientY > rect.bottom - GRID_SCROLL_EDGE) {
        canvas.scrollTop += GRID_SCROLL_STEP;
    } else if (clientY < rect.top + GRID_SCROLL_EDGE) {
        canvas.scrollTop = Math.max(0, canvas.scrollTop - GRID_SCROLL_STEP);
    }
    if (scrollX && clientX != null) {
        if (clientX > rect.right - GRID_SCROLL_EDGE) {
            canvas.scrollLeft += GRID_SCROLL_STEP;
        } else if (clientX < rect.left + GRID_SCROLL_EDGE) {
            canvas.scrollLeft = Math.max(0, canvas.scrollLeft - GRID_SCROLL_STEP);
        }
    }
}

function cardIsPinned(card) {
    const id = card?.dataset?.id;
    return !!id && UI.isBoardPinned(id);
}

function maybeRepartitionFileCabinetAfterResize(canvas, card, currentItems) {
    if (!isFileCabinetActive() || !canvas || !card?.dataset?.id) return;
    const sortBy = canvas.classList.contains('view-grid') ? 'grid' : 'freeform';
    const item = currentItems.find((i) => i.id === card.dataset.id);
    if (!item) return;
    const rect = UI.readNoteRect(card);
    const tileSize = UI.getCardTileSize(card, item);
    if (shouldFileItem(item, sortBy, UI) || isAtOrBelowCompactZone(rect.w, rect.h, tileSize)) {
        fileItemToCabinet(item, sortBy, UI, { x: rect.x, y: rect.y, rememberW: rect.w, rememberH: rect.h });
        window.dispatchEvent(new CustomEvent('board:visibility_changed', { detail: { flushLayout: false } }));
    }
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
    const edgePad = bounds.edgePad ?? getGridMetrics().edgePad;
    const rect = snapMode === 'position'
        ? UI.snapNotePosition(live, { maxW: bounds.packW, maxH: bounds.maxH, origin, edgePad })
        : UI.snapNoteRect(live, { maxW: bounds.packW, maxH: bounds.maxH, origin, edgePad });
    UI.applyNoteRect(card, rect, { settling: animate });

    const item = currentItems.find((i) => i.id === card.dataset.id);
    let tileSize = item ? UI.getCardTileSize(card, item) : 'large';
    if (item && tierResizeState && UI.isSpatiallyCollapsed(card)) {
        tileSize = UI.commitTierResize(card, item, tierResizeState);
    }
    if (item && card.classList.contains('expanded') && !isDesktopCard(card)
        && isAtSmallSize(rect.w, rect.h, readTileSmallFootprint())) {
        onCollapseFromResize(card, item, rect, { animate, bounds });
        maybeRepartitionFileCabinetAfterResize(canvas, card, currentItems);
        cleanupActive?.();
        return;
    }

    saveLayout(card, rect, {
        updateRemembered: UI.isSpatiallyCollapsed(card) && !isAtSmallSize(rect.w, rect.h, readTileSmallFootprint())
    });
    reflow(card, { animate });
    if (isDesktopCard(card)) {
        UI.finalizeDesktopCard(card);
    }
    maybeRepartitionFileCabinetAfterResize(canvas, card, currentItems);
    cleanupActive?.();
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
            && !el.closest('.card-act--drag')
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
    if (e.target?.closest?.('.card-act--drag')) return false;
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
    if (target.closest('.editor-note-body, .card-body.editor-note-body')) return false;
    if (target.closest('.editor-note-header') && !target.closest('.card-drag-zone')) return false;
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

        if (isFileCabinetActive()) {
            const fileCabinet = document.getElementById('file-cabinet');
            if (fileCabinet) {
                initFileCabinetDrag(fileCabinet, currentItems, UI, signal);
            }
        }
    },

    initDesktopInteractions(canvas, currentItems = [], signal, { snapEnabled = false } = {}) {
        const cards = canvas.querySelectorAll('.mini-card[data-desktop="1"]');
        let dragActive = null;
        let resizeActive = null;
        let previewFrame = null;
        let previewBaseline = null;
        let extentsFrame = null;

        const runExtentsUpdate = () => {
            if (extentsFrame) return;
            extentsFrame = requestAnimationFrame(() => {
                extentsFrame = null;
                UI.updateBoardCanvasExtents(canvas);
            });
        };

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
                const zoom = getCanvasZoom(canvas);
                const { origin, viewportH } = UI.getGridViewportBounds(canvas);
                const scrollY = canvas.scrollTop / zoom;
                const maxH = origin + scrollY + viewportH + getGridMetrics().cellH;
                const layout = UI.computeGridBoardLayout(
                    canvas,
                    actorCard.dataset.id,
                    actorRect,
                    { maxH }
                );
                previewBaseline?.forEach((base, id) => {
                    if (id === actorCard.dataset.id) return;
                    const other = canvas.querySelector(`.mini-card[data-desktop="1"][data-id="${CSS.escape(id)}"]`);
                    if (!other) return;
                    const rect = layout.get(id) ?? base;
                    const pushed = base.x !== rect.x
                        || base.y !== rect.y
                        || base.w !== rect.w
                        || base.h !== rect.h;
                    if (pushed) {
                        UI.applyNoteRect(other, rect, { settling: true });
                        other.classList.add('layout-preview');
                    } else if (other.classList.contains('layout-preview')) {
                        UI.applyNoteRect(other, base, { settling: true });
                        other.classList.remove('layout-preview');
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
                saveLayout: (c, rect, { updateRemembered }) => {
                    UI.saveGridLayout(c.dataset.id, rect, { updateRemembered });
                },
                reflow: (c, { animate }) => {
                    UI.reflowGridBoard(canvas, c.dataset.id, { animate });
                },
                onExpandFromResize: () => {},
                onCollapseFromResize: (c, item, rect, { animate, bounds }) => {
                    UI.collapseSnapPanelCard(c, item);
                    const tileSize = UI.getCardTileSize(c, item);
                    const sized = UI.gridTileRect(tileSize, rect, rect);
                    const finalRect = UI.snapNoteRect(
                        { ...sized, x: rect.x, y: rect.y },
                        { maxW: bounds.packW, maxH: bounds.maxH }
                    );
                    UI.applyNoteRect(c, finalRect, { settling: animate });
                    UI.saveGridLayout(c.dataset.id, finalRect, {
                        updateRemembered: !isAtSmallSize(finalRect.w, finalRect.h, readTileSmallFootprint())
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
            const boardBounds = snapEnabled ? UI.getGridBoardBounds(canvas) : null;
            const origin = boardBounds?.origin ?? 0;
            const minCoord = origin + (boardBounds?.edgePad ?? 0);
            const x = Math.max(minCoord, dragActive.origX + dx);
            const y = Math.max(minCoord, dragActive.origY + dy);
            dragActive.card.style.left = `${x}px`;
            dragActive.card.style.top = `${y}px`;
            if (snapEnabled) {
                autoScrollDesktopCanvas(canvas, e.clientX, e.clientY, { scrollX: false });
                runLayoutPreview(dragActive.card);
            } else {
                runExtentsUpdate();
                autoScrollDesktopCanvas(canvas, e.clientX, e.clientY);
            }
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
                    const rect = UI.clampNoteToBoardEdges(UI.readNoteRect(card), UI.getGridBoardBounds(canvas));
                    UI.applyNoteRect(card, rect, { settling: false });
                    UI.saveFreeformPosition(card.dataset.id, rect.x, rect.y);
                    UI.updateBoardCanvasExtents(canvas);
                }
            } else if (snapEnabled) {
                clearLayoutPreview(true);
                UI.updateGridScrollPolicy(canvas, { forcing: false });
                canvas.classList.remove('is-layout-active', 'is-grid-forcing');
            }
            if (extentsFrame) {
                cancelAnimationFrame(extentsFrame);
                extentsFrame = null;
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
            const boardBounds = snapEnabled ? UI.getGridBoardBounds(canvas) : null;
            const origin = boardBounds?.origin ?? 0;
            const minCoord = origin + (boardBounds?.edgePad ?? 0);

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

            if (item && UI.isSpatiallyCollapsed(card) && tierResizeState) {
                nextX = Math.max(minCoord, nextX);
                nextY = Math.max(minCoord, nextY);
                const bounds = boardBounds;
                const maxW = bounds ? bounds.packW + origin : undefined;
                UI.processCollapsedTierResizeMove(card, item, tierResizeState, {
                    x: nextX,
                    y: nextY,
                    w: nextW,
                    h: nextH
                }, { axis, maxW });
                if (snapEnabled) {
                    autoScrollDesktopCanvas(canvas, e.clientX, e.clientY, { scrollX: false });
                    runLayoutPreview(card);
                } else {
                    runExtentsUpdate();
                    autoScrollDesktopCanvas(canvas, e.clientX, e.clientY);
                }
                return;
            }

            const clamped = clampSize(nextW, nextH);
            if (axis.includes('w')) nextX = origX + (origW - clamped.w);
            if (axis.includes('n')) nextY = origY + (origH - clamped.h);

            nextX = Math.max(minCoord, nextX);
            nextY = Math.max(minCoord, nextY);
            const finalW = clamped.w;
            const finalH = clamped.h;

            card.style.left = `${nextX}px`;
            card.style.top = `${nextY}px`;
            UI.applyFreeformDimensions(card, finalW, finalH);
            if (isDesktopCard(card)) {
                UI.syncSpatialCollapseState(card, item, finalW, finalH);
            }
            if (snapEnabled) {
                autoScrollDesktopCanvas(canvas, e.clientX, e.clientY, { scrollX: false });
                runLayoutPreview(card);
            } else {
                runExtentsUpdate();
                autoScrollDesktopCanvas(canvas, e.clientX, e.clientY);
            }
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
                    if (item && tierResizeState && UI.isSpatiallyCollapsed(card)) {
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
                    if (item && tierResizeState && UI.isSpatiallyCollapsed(card)) {
                        const tileSize = UI.commitTierResize(card, item, tierResizeState);
                        const { w, h } = UI.readFreeformCardSize(card);
                        UI.saveFreeformSize(card.dataset.id, w, h, {
                            updateRemembered: !isAtSmallSize(w, h, readTileSmallFootprint())
                        });
                        UI.finalizeDesktopCard(card);
                    } else {
                        UI.saveFreeformSizeFromCard(card);
                        if (isDesktopCard(card)) {
                            UI.finalizeDesktopCard(card);
                        }
                    }
                    UI.updateBoardCanvasExtents(canvas);
                    maybeRepartitionFileCabinetAfterResize(canvas, card, currentItems);
                }
            } else if (snapEnabled) {
                clearLayoutPreview(true);
                UI.updateGridScrollPolicy(canvas, { forcing: false });
                canvas.classList.remove('is-layout-active', 'is-grid-forcing');
            }
            if (extentsFrame) {
                cancelAnimationFrame(extentsFrame);
                extentsFrame = null;
            }
            resizeActive = null;
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeUp);
        };

        cards.forEach((card) => {
            card.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;

                const resizeHandle = e.target.closest('.ff-resize');
                if (resizeHandle) {
                    if (cardIsPinned(card)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    UI.cancelCardAnimation(card);
                    if (snapEnabled) UI.raiseDesktopCard(card);
                    const { w: startW, h: startH } = UI.readFreeformCardSize(card);
                    const itemMatch = currentItems.find((i) => i.id === card.dataset.id);
                    const tierResizeState = itemMatch && UI.isSpatiallyCollapsed(card)
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

                const wantsDrag = shouldStartCardDrag(e.target);
                if (!wantsDrag && shouldYieldToNoteEditor(e, card)) return;

                if (pointerHitsStepGrab(e.clientX, e.clientY)) return;
                if (!wantsDrag) return;
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


};
