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
    animate = true
}) {
    clearPreview(false);
    endScrollPolicy?.();
    const bounds = getBounds();
    const rect = UI.snapNoteRect(UI.readNoteRect(card), { maxW: bounds.packW, maxH: bounds.maxH });
    UI.applyNoteRect(card, rect, { settling: animate });

    const item = currentItems.find((i) => i.id === card.dataset.id);
    const tileSize = item ? UI.getCardTileSize(card, item) : 'compact';
    if (item && UI.isCollapsedTile(card) && UI.shouldSnapPanelExpand(rect.w, rect.h, tileSize)) {
        saveLayout(card, rect, { customCompact: false });
        onExpandFromResize(card, item, rect, { animate, bounds });
        cleanupActive?.();
        return;
    }
    if (item && card.classList.contains('expanded') && UI.shouldSnapPanelCollapse(rect.w, rect.h, tileSize)) {
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

    const finishAction = (card, { animate = true } = {}) => {
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
            animate
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
        const clamped = UI.clampGridResize(nextW, nextH, { packW: bounds.packW });
        if (axis.includes('w')) nextX = origX + (origW - clamped.w);
        if (axis.includes('n')) nextY = origY + (origH - clamped.h);

        nextX = Math.max(origin, nextX);
        nextY = Math.max(origin, nextY);
        let finalW = clamped.w;
        let finalH = clamped.h;
        if (nextX + finalW > bounds.packW + origin) {
            if (axis.includes('w')) {
                nextX = Math.max(origin, bounds.packW + origin - finalW);
            } else {
                finalW = Math.max(COLUMN_GRID_CELL_W, bounds.packW + origin - nextX);
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
        const { card, moved } = resizeActive;
        card.classList.remove(resizeClass);
        if (moved) {
            card.dataset.skipExpand = '1';
            finishAction(card);
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
                resizeActive = {
                    card,
                    axis: resizeHandle.dataset.axis || 'se',
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: parseFloat(card.style.left) || 0,
                    origY: parseFloat(card.style.top) || 0,
                    origW,
                    origH,
                    moved: false
                };
                card.classList.add(resizeClass);
                card.dataset.skipExpand = '1';
                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeUp);
                return;
            }

            if (e.target.closest('.editor-note-body .card-inline-edit, .editor-note-header .card-inline-edit')) {
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
        '.grab-handle--note-cat, .ff-resize, .col-resize, .card-act--pin, ' +
        '.tool-panel, .tool-chip, .tool-chip__drag, .tool-chip__actions, .tool-chip__expand, .tool-panel__resize-e, .tool-panel__resize-s, .tool-panel__resize-se, .tool-panel__header, ' +
        'a, button, input, textarea, select'
    );
}

function pointerHitsStepGrab(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    return document.elementsFromPoint(clientX, clientY)
        .some((el) => el instanceof Element && el.closest('.grab-handle--step'));
}

function shouldStartCardDrag(target) {
    if (!target) return false;
    if (target.closest('.card-act--drag')) return true;
    if (isInsideDragControl(target)) return false;
    if (target.closest('.editor-note-body, .card-body.editor-note-body')) return false;
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

        if (canvas.classList.contains('view-freeform')) {
            this.initFreeformInteractions(canvas, currentItems, signal);
            return;
        }

        if (canvas.classList.contains('view-grid')) {
            this.initGridBoardInteractions(canvas, currentItems, signal);
            return;
        }

        if (canvas.classList.contains('view-columns')) {
            this.initColumnsViewInteractions(canvas, currentItems, onMutationComplete, userState, signal);
        }
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
            const { card, axis, startX, startY, origX, origY, origW, origH } = resizeActive;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, startX, startY);

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
            const { card } = resizeActive;
            card.classList.remove('is-freeform-resizing');
            UI.saveFreeformPosition(
                card.dataset.id,
                parseFloat(card.style.left) || 0,
                parseFloat(card.style.top) || 0
            );
            UI.saveFreeformSizeFromCard(card);
            card.dataset.skipExpand = '1';
            resizeActive = null;
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeUp);
        };

        cards.forEach(card => {
            card.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;

                const resizeHandle = e.target.closest('.ff-resize');
                if (resizeHandle) {
                    if (cardIsPinned(card)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    UI.cancelCardAnimation(card);
                    let { w: startW, h: startH } = UI.readFreeformCardSize(card);
                    if (UI.isCollapsedTile(card)) {
                        const itemMatch = currentItems.find(i => i.id === card.dataset.id);
                        if (itemMatch) {
                            UI.updateFreeformCard(card, itemMatch, {
                                expanded: true,
                                dimensions: { w: startW, h: startH }
                            });
                        }
                        ({ w: startW, h: startH } = UI.readFreeformCardSize(card));
                    }
                    resizeActive = {
                        card,
                        axis: resizeHandle.dataset.axis || 'se',
                        startX: e.clientX,
                        startY: e.clientY,
                        origX: parseFloat(card.style.left) || 0,
                        origY: parseFloat(card.style.top) || 0,
                        origW: startW,
                        origH: startH
                    };
                    card.classList.add('is-freeform-resizing');
                    card.dataset.skipExpand = '1';
                    document.addEventListener('mousemove', onResizeMove);
                    document.addEventListener('mouseup', onResizeUp);
                    return;
                }

                if (e.target.closest('.editor-note-body .card-inline-edit, .editor-note-header .card-inline-edit')) {
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

    initColumnNotesSnapInteractions(canvas, columnNotesEl, currentItems, signal) {
        bindSnapPanelCardInteractions({
            canvas,
            panelEl: columnNotesEl,
            cardSelector: '.mini-card[data-column-note="1"]',
            currentItems,
            signal,
            getBounds: () => UI.getColumnNotesSnapBounds(columnNotesEl),
            computeLayout: (actorId, actorRect) => UI.computeColumnNotesLayout(columnNotesEl, actorId, actorRect),
            raiseCard: (card) => UI.raiseLayoutCard(card),
            dragClass: 'is-column-dragging',
            resizeClass: 'is-column-resizing',
            saveLayout: (card, rect, { customCompact }) => {
                const cat = card.dataset.category || columnNotesEl.dataset.category;
                if (cat) UI.saveColumnNoteLayout(cat, card.dataset.id, rect, { customCompact });
            },
            reflow: (card, { animate }) => {
                UI.reflowColumnNotesPanel(columnNotesEl, card.dataset.id, { animate });
            },
            onExpandFromResize: (card, item, rect) => {
                UI.updateColumnNoteCard(card, item, {
                    expanded: true,
                    dimensions: { w: rect.w, h: rect.h }
                });
            },
            onCollapseFromResize: (card, item, rect, { animate, bounds }) => {
                const cat = card.dataset.category || columnNotesEl.dataset.category;
                UI.collapseSnapPanelCard(card, item);
                const tileSize = UI.getCardTileSize(card, item);
                const compact = UI.gridTileRect(tileSize, rect, { ...rect, customCompact: true });
                const finalRect = UI.snapNoteRect(
                    { ...compact, x: rect.x, y: rect.y },
                    { maxW: bounds.packW, maxH: bounds.maxH }
                );
                UI.applyNoteRect(card, finalRect, { settling: animate });
                if (cat) {
                    UI.saveColumnNoteLayout(cat, card.dataset.id, finalRect, {
                        customCompact: UI.isCustomTileRect(finalRect.w, finalRect.h, tileSize)
                    });
                }
                UI.reflowColumnNotesPanel(columnNotesEl, card.dataset.id, { animate });
            }
        });
    },

    initColumnsViewInteractions(canvas, currentItems, onMutationComplete, userState, signal) {
        const readCategories = () => readStoredCategories();

        const persistCategoryOrderFromDom = () => {
            const categories = readCategories();
            const visibleOrder = [...canvas.querySelectorAll('.canvas-column')]
                .sort((a, b) => {
                    const ay = parseFloat(a.style.top) || 0;
                    const by = parseFloat(b.style.top) || 0;
                    if (ay !== by) return ay - by;
                    return (parseFloat(a.style.left) || 0) - (parseFloat(b.style.left) || 0);
                })
                .map(column => column.dataset.category)
                .filter(Boolean);
            if (visibleOrder.length === 0) return false;

            const byName = new Map(categories.map(cat => [categoryKey(cat.name || cat), cat]));
            const orderedVisible = visibleOrder
                .map(name => byName.get(categoryKey(name)))
                .filter(Boolean);
            const visibleNames = new Set(visibleOrder.map(categoryKey));
            const hiddenOrMissing = categories.filter(cat => !visibleNames.has(categoryKey(cat.name || cat)));
            const nextCategories = [...orderedVisible, ...hiddenOrMissing];

            localStorage.setItem('matrix_custom_categories', JSON.stringify(nextCategories));
            window.dispatchEvent(new CustomEvent('category:order_changed', { detail: nextCategories }));
            return true;
        };

        canvas.addEventListener('dragover', (e) => {
            if ([...e.dataTransfer.types].includes('text/plain') && !e.target.closest('.canvas-column')) {
                e.preventDefault();
            }
        }, { signal });

        canvas.addEventListener('drop', async (e) => {
            if (e.target.closest('.canvas-column')) return;

            const cardId = e.dataTransfer.getData('text/plain');
            if (!cardId) return;
            e.preventDefault();

            const itemMatch = currentItems.find(i => i.id === cardId);
            if (itemMatch && itemHasCategory(itemMatch)) {
                const oldCat = itemMatch.categories?.[0];
                itemMatch.categories = [];
                UI.removeColumnNoteLayout(itemMatch.id, oldCat);
                const success = await API.saveItem(itemMatch, userState.token);
                if (success && typeof onMutationComplete === 'function') {
                    await onMutationComplete();
                }
            }
        }, { signal });

        canvas.querySelectorAll('.canvas-column').forEach(column => {
            column.addEventListener('dragover', (e) => {
                e.preventDefault();
                column.classList.add('is-category-drop-target');
            }, { signal });

            column.addEventListener('dragleave', (e) => {
                if (!column.contains(e.relatedTarget)) {
                    column.classList.remove('is-category-drop-target');
                }
            }, { signal });

            column.addEventListener('drop', async (e) => {
                e.preventDefault();
                column.classList.remove('is-category-drop-target');

                const cardId = e.dataTransfer.getData('text/plain');
                const targetCategory = column.dataset.category;
                if (!cardId || !targetCategory) return;

                const itemMatch = currentItems.find(i => i.id === cardId);
                const currentCat = itemMatch?.categories?.[0] || '';
                const currentKey = categoryKey(currentCat || UNCATEGORIZED_CATEGORY);
                const targetKey = categoryKey(targetCategory);
                if (itemMatch && currentKey !== targetKey) {
                    if (currentCat) UI.removeColumnNoteLayout(itemMatch.id, currentCat);
                    else UI.removeColumnNoteLayout(itemMatch.id, UNCATEGORIZED_CATEGORY);
                    itemMatch.categories = isUncategorizedCategory(targetCategory) ? [] : [targetCategory];
                    const success = await API.saveItem(itemMatch, userState.token);
                    if (success && typeof onMutationComplete === 'function') {
                        await onMutationComplete();
                    }
                }
            }, { signal });
        });

        canvas.addEventListener('dragstart', (e) => {
            const handle = e.target.closest('.grab-handle--note-cat');
            if (!handle || !canvas.contains(handle)) return;
            const card = handle.closest('.mini-card');
            if (!card) return;
            e.dataTransfer.setData('text/plain', card.dataset.id);
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('is-column-cat-dragging');
        }, { signal });

        canvas.addEventListener('dragend', (e) => {
            const handle = e.target.closest('.grab-handle--note-cat');
            if (!handle || !canvas.contains(handle)) return;
            handle.closest('.mini-card')?.classList.remove('is-column-cat-dragging');
        }, { signal });

        canvas.querySelectorAll('.column-notes').forEach((notesEl) => {
            this.initColumnNotesSnapInteractions(canvas, notesEl, currentItems, signal);
        });
        this.bindColumnPointerDrag(canvas, currentItems, signal);
        this.bindColumnPointerResize(canvas, currentItems, signal);
        this.bindColumnContainerResize(canvas, signal);
        this.bindColumnDrag(canvas, signal, persistCategoryOrderFromDom);
    },

    bindColumnDrag(canvas, signal, persistCategoryOrder) {
        let colDrag = null;
        let snapshot = null;

        const restore = () => {
            if (!snapshot) return;
            snapshot.forEach(({ el, left, top }) => {
                el.style.left = left;
                el.style.top = top;
            });
            snapshot = null;
        };

        const onMove = (e) => {
            if (!colDrag) return;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, colDrag.startX, colDrag.startY);
            if (!colDrag.moved) {
                if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
                colDrag.moved = true;
                colDrag.column.classList.add('is-canvas-col-dragging');
                canvas.classList.add('is-layout-active');
            }
            e.preventDefault();
            colDrag.column.style.left = `${Math.max(0, colDrag.origX + dx)}px`;
            colDrag.column.style.top = `${Math.max(0, colDrag.origY + dy)}px`;
        };

        const onUp = () => {
            if (!colDrag) return;
            const { column, moved } = colDrag;
            column.classList.remove('is-canvas-col-dragging');
            canvas.classList.remove('is-layout-active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            sessionCleanup?.();

            if (!moved) {
                restore();
            } else {
                const x = Math.max(0, Math.round(parseFloat(column.style.left) || 0));
                const y = Math.max(0, Math.round(parseFloat(column.style.top) || 0));
                column.style.left = `${x}px`;
                column.style.top = `${y}px`;
                const cat = column.dataset.category;
                if (cat) {
                    UI.saveColumnPosition(cat, x, y);
                    UI.pushOverlappingCanvasItems(canvas, { type: 'category', name: cat }, { animate: true });
                }
                persistCategoryOrder();
            }
            colDrag = null;
            snapshot = null;
        };

        let sessionCleanup = null;

        canvas.querySelectorAll('.grab-handle--col').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                const column = handle.closest('.canvas-column');
                if (!column) return;

                snapshot = [...canvas.querySelectorAll('.canvas-column')].map((el) => ({
                    el,
                    left: el.style.left,
                    top: el.style.top
                }));

                colDrag = {
                    column,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: parseFloat(column.style.left) || 0,
                    origY: parseFloat(column.style.top) || 0,
                    moved: false
                };

                sessionCleanup = bindPointerSession({
                    onCancel: () => {
                        restore();
                        column.classList.remove('is-canvas-col-dragging');
                        canvas.classList.remove('is-layout-active');
                        colDrag = null;
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                    }
                });

                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            }, { signal });
        });
    },

    bindColumnPointerDrag(canvas, currentItems, signal) {
        let dragActive = null;
        let snapshot = null;

        const getBoundsEl = (card) => {
            if (card.dataset.columnNote === '1') {
                return card.closest('.column-notes');
            }
            return canvas;
        };

        const restoreCard = () => {
            if (!dragActive?.snapshot) return;
            const { card, snapshot: snap } = dragActive;
            card.style.left = snap.left;
            card.style.top = snap.top;
            card.style.width = snap.width;
            card.style.height = snap.height;
        };

        const onMove = (e) => {
            if (!dragActive) return;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, dragActive.startX, dragActive.startY);
            if (!dragActive.moved) {
                if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
                dragActive.moved = true;
                dragActive.card.classList.add('is-column-dragging');
                canvas.classList.add('is-layout-active');
            }
            e.preventDefault();
            const maxX = Math.max(0, dragActive.boundsEl.clientWidth - dragActive.cardW);
            const maxY = Math.max(0, dragActive.boundsEl.clientHeight - dragActive.cardH);
            let x = Math.min(maxX, Math.max(0, dragActive.origX + dx));
            let y = Math.min(maxY, Math.max(0, dragActive.origY + dy));
            dragActive.card.style.left = `${x}px`;
            dragActive.card.style.top = `${y}px`;
        };

        const onUp = () => {
            if (!dragActive) return;
            const { card, moved, boundsEl, isFloat } = dragActive;
            card.classList.remove('is-column-dragging');
            canvas.classList.remove('is-layout-active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            dragActive.sessionCleanup?.();

            if (!moved) {
                restoreCard();
            } else {
                const innerW = isFloat
                    ? canvas.clientWidth
                    : UI.getColumnNotesInnerWidth(boundsEl);
                const maxH = isFloat
                    ? Math.max(canvas.scrollHeight, canvas.clientHeight, window.innerHeight)
                    : UI.getColumnNotesMaxHeight(boundsEl);
                const rect = UI.clampManualNoteRect(UI.readNoteRect(card), { maxW: innerW, maxH });
                UI.applyNoteRect(card, rect, { settling: true });

                if (isFloat) {
                    UI.saveColumnsFloatPosition(card.dataset.id, rect.x, rect.y);
                    if (card.classList.contains('expanded')) {
                        UI.saveColumnsFloatSize(card.dataset.id, rect.w, rect.h);
                    }
                } else {
                    const cat = card.dataset.category;
                    if (cat) UI.saveColumnNoteLayout(cat, card.dataset.id, rect);
                    const column = boundsEl.closest('.canvas-column');
                    if (column) UI.resizeColumnToFit(column, { animate: true });
                }
            }
            dragActive = null;
        };

        const attachCard = (card) => {
            card.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (card.dataset.columnNote === '1') return;
                if (e.target.closest('.grab-handle--note-cat')) return;
                if (pointerHitsStepGrab(e.clientX, e.clientY)) return;
                if (!shouldStartCardDrag(e.target)) return;
                if (cardIsPinned(card)) return;

                const scrollHost = e.target.closest('.editor-note-body') || e.target.closest('.card-body');
                if (scrollHost && isScrollbarGrip(scrollHost, e.clientX)) return;

                e.stopPropagation();
                const boundsEl = getBoundsEl(card);
                if (!boundsEl) return;
                const rect = UI.readNoteRect(card);
                const isFloat = card.dataset.columnsFloat === '1';

                const sessionCleanup = bindPointerSession({
                    onCancel: () => {
                        restoreCard();
                        card.classList.remove('is-column-dragging');
                        canvas.classList.remove('is-layout-active');
                        dragActive = null;
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                    }
                });

                dragActive = {
                    card,
                    boundsEl,
                    isFloat,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: rect.x,
                    origY: rect.y,
                    cardW: rect.w,
                    cardH: rect.h,
                    moved: false,
                    snapshot: {
                        left: card.style.left,
                        top: card.style.top,
                        width: card.style.width,
                        height: card.style.height
                    },
                    sessionCleanup
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            }, { signal });
        };

        canvas.querySelectorAll('.mini-card[data-column-note="1"], .mini-card[data-columns-float="1"]').forEach(attachCard);
    },

    bindColumnPointerResize(canvas, currentItems, signal) {
        let resizeActive = null;

        const onMove = (e) => {
            if (!resizeActive) return;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, resizeActive.startX, resizeActive.startY);
            if (!resizeActive.moved) {
                if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
                resizeActive.moved = true;
            }
            const { card, axis, origX, origY, origW, origH, boundsEl, isFloat } = resizeActive;

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

            const clamped = clampSize(nextW, nextH);
            if (axis.includes('w')) nextX = origX + (origW - clamped.w);
            if (axis.includes('n')) nextY = origY + (origH - clamped.h);

            const innerW = isFloat ? canvas.clientWidth : UI.getColumnNotesInnerWidth(boundsEl);
            nextX = Math.max(0, nextX);
            nextY = Math.max(0, nextY);
            if (nextX + clamped.w > innerW) {
                if (axis.includes('w')) nextX = Math.max(0, innerW - clamped.w);
                else nextW = Math.max(FREEFORM_MIN_W, innerW - nextX);
            }

            card.style.left = `${nextX}px`;
            card.style.top = `${nextY}px`;
            card.style.setProperty('width', `${clamped.w}px`, 'important');
            card.style.setProperty('height', `${clamped.h}px`, 'important');
            card.style.setProperty('min-height', `${clamped.h}px`, 'important');
            card.style.setProperty('max-height', `${clamped.h}px`, 'important');
        };

        const onUp = () => {
            if (!resizeActive) return;
            const { card, moved, boundsEl, isFloat, snapshot } = resizeActive;
            card.classList.remove('is-column-resizing');
            canvas.classList.remove('is-layout-active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            resizeActive.sessionCleanup?.();

            if (!moved && snapshot) {
                card.style.left = snapshot.left;
                card.style.top = snapshot.top;
                card.style.setProperty('width', snapshot.width, 'important');
                card.style.setProperty('height', snapshot.height, 'important');
            } else {
                const innerW = isFloat ? canvas.clientWidth : UI.getColumnNotesInnerWidth(boundsEl);
                const maxH = isFloat
                    ? Math.max(canvas.scrollHeight, canvas.clientHeight, window.innerHeight)
                    : UI.getColumnNotesMaxHeight(boundsEl);
                const rect = UI.clampManualNoteRect(UI.readNoteRect(card), { maxW: innerW, maxH });
                UI.applyNoteRect(card, rect, { settling: true });

                if (isFloat) {
                    UI.saveColumnsFloatPosition(card.dataset.id, rect.x, rect.y);
                    UI.saveColumnsFloatSize(card.dataset.id, rect.w, rect.h);
                } else {
                    const cat = card.dataset.category;
                    if (cat) UI.saveColumnNoteLayout(cat, card.dataset.id, rect);
                    const column = boundsEl.closest('.canvas-column');
                    if (column) UI.resizeColumnToFit(column, { animate: true });
                }
            }
            resizeActive = null;
        };

        const attachCard = (card) => {
            card.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                if (card.dataset.columnNote === '1') return;

                const resizeHandle = e.target.closest('.ff-resize');
                if (!resizeHandle) return;
                if (cardIsPinned(card)) return;

                e.preventDefault();
                e.stopPropagation();
                UI.cancelCardAnimation(card);
                const boundsEl = canvas;
                const isFloat = card.dataset.columnsFloat === '1';
                let { w: startW, h: startH } = UI.readFreeformCardSize(card);

                if (UI.isCollapsedTile(card)) {
                    const itemMatch = currentItems.find(i => i.id === card.dataset.id);
                    if (itemMatch && isFloat) {
                        UI.updateColumnsFloatCard(card, itemMatch, {
                            expanded: true,
                            dimensions: { w: startW, h: startH }
                        });
                    }
                    ({ w: startW, h: startH } = UI.readFreeformCardSize(card));
                }

                const snapshot = {
                    left: card.style.left,
                    top: card.style.top,
                    width: card.style.width || `${startW}px`,
                    height: card.style.height || `${startH}px`
                };

                const sessionCleanup = bindPointerSession({
                    onCancel: () => {
                        card.style.left = snapshot.left;
                        card.style.top = snapshot.top;
                        card.style.setProperty('width', snapshot.width, 'important');
                        card.style.setProperty('height', snapshot.height, 'important');
                        card.classList.remove('is-column-resizing');
                        canvas.classList.remove('is-layout-active');
                        resizeActive = null;
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                    }
                });

                resizeActive = {
                    card,
                    boundsEl,
                    isFloat,
                    axis: resizeHandle.dataset.axis || 'se',
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: parseFloat(card.style.left) || 0,
                    origY: parseFloat(card.style.top) || 0,
                    origW: startW,
                    origH: startH,
                    moved: false,
                    snapshot,
                    sessionCleanup
                };
                card.classList.add('is-column-resizing');
                canvas.classList.add('is-layout-active');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            }, { signal });
        };

        canvas.querySelectorAll('.mini-card[data-column-note="1"], .mini-card[data-columns-float="1"]').forEach(attachCard);
    },

    bindColumnContainerResize(canvas, signal) {
        let resizeActive = null;

        const onMove = (e) => {
            if (!resizeActive) return;
            const { dx, dy } = pointerDelta(canvas, e.clientX, e.clientY, resizeActive.startX, resizeActive.startY);
            if (!resizeActive.moved) {
                if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return;
                resizeActive.moved = true;
            }
            const { column, axis, origW, origH, origX, origY } = resizeActive;
            let nextW = origW;
            let nextH = origH;
            let nextX = origX;
            let nextY = origY;
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
            nextW = Math.max(CANVAS_GRID_W, Math.round(nextW));
            nextH = Math.max(COLUMN_MIN_CANVAS_H, Math.round(nextH));
            if (axis.includes('w')) nextX = origX + (origW - nextW);
            if (axis.includes('n')) nextY = origY + (origH - nextH);
            column.style.left = `${nextX}px`;
            column.style.top = `${nextY}px`;
            UI.applyColumnCanvasSize(column, nextW, nextH);
        };

        const onUp = () => {
            if (!resizeActive) return;
            const { column, moved, snapshot } = resizeActive;
            column.classList.remove('is-column-resizing');
            canvas.classList.remove('is-layout-active');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            resizeActive.sessionCleanup?.();

            if (!moved && snapshot) {
                column.style.left = `${snapshot.x}px`;
                column.style.top = `${snapshot.y}px`;
                UI.applyColumnCanvasSize(column, snapshot.w, snapshot.h);
            } else {
                const rect = UI.readColumnCanvasRect(column);
                const cat = column.dataset.category;
                if (cat) {
                    UI.saveColumnPosition(cat, rect.x, rect.y);
                    UI.saveColumnSize(cat, rect.w, rect.h);
                    UI.pushOverlappingCanvasItems(canvas, { type: 'category', name: cat }, { animate: true });
                }
            }
            resizeActive = null;
        };

        canvas.querySelectorAll('.canvas-column').forEach((column) => {
            column.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                const handle = e.target.closest('.col-resize');
                if (!handle) return;
                e.preventDefault();
                e.stopPropagation();

                const rect = UI.readColumnCanvasRect(column);
                const snapshot = { w: rect.w, h: rect.h, x: rect.x, y: rect.y };
                const sessionCleanup = bindPointerSession({
                    onCancel: () => {
                        column.style.left = `${snapshot.x}px`;
                        column.style.top = `${snapshot.y}px`;
                        UI.applyColumnCanvasSize(column, snapshot.w, snapshot.h);
                        column.classList.remove('is-column-resizing');
                        canvas.classList.remove('is-layout-active');
                        resizeActive = null;
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                    }
                });

                resizeActive = {
                    column,
                    axis: handle.dataset.axis || 'se',
                    startX: e.clientX,
                    startY: e.clientY,
                    origW: rect.w,
                    origH: rect.h,
                    origX: rect.x,
                    origY: rect.y,
                    moved: false,
                    snapshot,
                    sessionCleanup
                };
                column.classList.add('is-column-resizing');
                canvas.classList.add('is-layout-active');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            }, { signal });
        });
    }
};
