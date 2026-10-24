/** @module {"owns":"file cabinet drag layer - tab drags inside the rail, board<->cabinet filing ghosts, drop targeting, insert markers and the shut snap", "related":["fileCabinet.js","fileCabinet/layout.js","fileCabinet/chrome.js","fileCabinet/render.js","fileCabinet/categoryRail.js","fileCabinet/transfer.js","dragdrop.js"]} */

import { getLabelRect } from '../tileGeometry.js';
import { DesktopManager } from '../desktopManager.js';
import {
    getDockButtonAt,
    setDesktopDockDragHighlight,
    clearDesktopDockDragHighlight
} from '../desktopDockDrop.js';
import { getFileCabinetOrder, reorderInCategory } from './order.js';
import {
    DRAG_THRESHOLD,
    applyFileCabinetStackPositions,
    applyOpenDrawerStackDimensions,
    fileCabinetCascadeCol,
    fileCabinetCascadeSlot,
    fileCabinetInsertIndexFromPoint,
    fileCabinetStackHeight
} from './layout.js';
import { syncFileCabinetDrawerHeight } from './chrome.js';
import {
    captureClientRect,
    expandFileCabinetItemToBoard,
    moveItemBetweenCategories
} from './transfer.js';
import {
    initFileCabinetFoldedHoverPreview,
    initFileCabinetCategoryActions,
    initFileCabinetCategoryColumnDrag
} from './categoryRail.js';

const FILE_CABINET_SCROLL_EDGE = 36;
const FILE_CABINET_SCROLL_STEP = 18;
let activeDropHighlightKey = '';

export function snapshotStackTabs(stackEl) {
    const map = new Map();
    if (!stackEl) return map;
    stackEl.querySelectorAll('.file-cabinet-tab').forEach((tab) => {
        const id = tab.dataset.id;
        if (!id) return;
        map.set(id, {
            left: tab.style.left,
            top: tab.style.top,
            position: tab.style.position,
            width: tab.style.width,
            height: tab.style.height,
            zIndex: tab.style.zIndex
        });
    });
    return map;
}

export function restoreStackPreview(stackEl, baseline) {
    if (!stackEl || !baseline) return;
    baseline.forEach((pos, id) => {
        const tab = stackEl.querySelector(`.file-cabinet-tab[data-id="${CSS.escape(id)}"]`);
        if (!tab || tab.classList.contains('is-file-cabinet-dragging')) return;
        tab.style.position = pos.position || 'absolute';
        tab.style.left = pos.left;
        tab.style.top = pos.top;
        tab.style.width = pos.width;
        tab.style.height = pos.height;
        tab.style.zIndex = pos.zIndex;
        tab.classList.remove('layout-settling', 'layout-preview');
    });
    const layoutTabs = [...stackEl.querySelectorAll('.file-cabinet-tab')].filter(
        (tab) => !tab.classList.contains('is-file-cabinet-dragging')
    );
    if (layoutTabs.length) applyFileCabinetStackPositions(stackEl);
}

export function beginFileCabinetDragGhost(card, stack) {
    if (!card || !stack) return null;
    const placeholder = document.createComment('fc-drag-placeholder');
    stack.insertBefore(placeholder, card);
    document.body.appendChild(card);
    return placeholder;
}

export function endFileCabinetDragGhost(card, placeholder) {
    if (!card || !placeholder?.parentNode) return;
    placeholder.parentNode.insertBefore(card, placeholder);
    placeholder.remove();
}

/**
 * Lift a board card onto document.body as a fixed-position filing ghost.
 * Returns restore metadata so the card can be put back into the canvas.
 */
export function beginBoardFilingGhost(card, clientX, clientY) {
    if (!card) return null;
    const parent = card.parentNode;
    if (!parent) return null;
    const rect = card.getBoundingClientRect();
    const placeholder = document.createComment('board-filing-placeholder');
    parent.insertBefore(placeholder, card);
    document.body.appendChild(card);

    const label = getLabelRect();
    const offsetX = Math.min(Math.max(8, clientX - rect.left), Math.max(16, label.w - 8));
    const offsetY = Math.min(Math.max(8, clientY - rect.top), Math.max(12, label.h - 4));

    card.classList.add('spatial-at-small');
    card.style.position = 'fixed';
    card.style.left = `${clientX - offsetX}px`;
    card.style.top = `${clientY - offsetY}px`;
    card.style.width = `${label.w}px`;
    card.style.height = `${label.h}px`;
    card.style.margin = '0';
    card.style.zIndex = '10000';
    card.style.pointerEvents = 'none';

    return {
        placeholder,
        parent,
        offsetX,
        offsetY
    };
}

export function moveBoardFilingGhost(card, filingState, clientX, clientY) {
    if (!card || !filingState) return;
    card.style.left = `${clientX - filingState.offsetX}px`;
    card.style.top = `${clientY - filingState.offsetY}px`;
}

/**
 * Restore a board card from body ghost back into the canvas.
 * @param {Object} opts.filingPreview - { w, h } original size before morph
 * @param {Object} opts.canvasRect - { x, y } canvas-local position to restore
 */
export function endBoardFilingGhost(card, filingState, {
    filingPreview = null,
    canvasRect = null,
    keepCollapsed = false
} = {}) {
    if (!card || !filingState) return;
    const { placeholder } = filingState;
    if (placeholder?.parentNode) {
        placeholder.parentNode.insertBefore(card, placeholder);
        placeholder.remove();
    } else if (filingState.parent?.isConnected) {
        filingState.parent.appendChild(card);
    }

    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.width = '';
    card.style.height = '';
    card.style.margin = '';
    card.style.zIndex = '';
    card.style.pointerEvents = '';

    if (!keepCollapsed) {
        card.classList.remove('spatial-at-small');
    }

    if (canvasRect && Number.isFinite(canvasRect.x) && Number.isFinite(canvasRect.y)) {
        card.style.left = `${canvasRect.x}px`;
        card.style.top = `${canvasRect.y}px`;
    }
    if (filingPreview && Number.isFinite(filingPreview.w) && Number.isFinite(filingPreview.h)) {
        card.style.width = `${filingPreview.w}px`;
        card.style.height = `${filingPreview.h}px`;
    }
}

/**
 * Clear stack insert previews used during board→FC filing.
 */
export function clearFileCabinetFilingPreview(mount, previewState) {
    if (previewState?.targetStack && previewState?.targetBaseline) {
        restoreStackPreview(previewState.targetStack, previewState.targetBaseline);
    }
    if (previewState) {
        previewState.targetStack = null;
        previewState.targetBaseline = null;
        previewState._lastPreviewKey = '';
    }
    clearFileCabinetSurfaceHighlights(mount);
}

/**
 * Preview insert slot while dragging a board label over FC stacks.
 * Mutates previewState in place: { targetStack, targetBaseline }.
 */
export function previewFileCabinetTabDrop(mount, dragState, clientX, clientY, previewState = {}) {
    if (!mount || !dragState?.card) return null;
    const canvas = document.getElementById('app-canvas');
    const target = resolveCrossSurfaceDropTarget(clientX, clientY, {
        dragKind: 'board-card',
        mount,
        canvas,
        dragState
    });

    applyFileCabinetDropHighlight(mount, target?.kind === 'file-cabinet' ? target : null);
    autoScrollFileCabinetInner(mount, clientX);

    const draggedId = dragState.card.dataset.id;
    if (target?.kind === 'file-cabinet' && target.targetStack) {
        if (previewState.targetStack !== target.targetStack) {
            if (previewState.targetStack && previewState.targetBaseline) {
                restoreStackPreview(previewState.targetStack, previewState.targetBaseline);
            }
            previewState.targetStack = target.targetStack;
            previewState.targetBaseline = snapshotStackTabs(target.targetStack);
        }
        applyStackPreviewPositions(target.targetStack, {
            draggedId,
            insertIndex: target.insertIndex,
            settling: true
        });
    } else if (previewState.targetStack && previewState.targetBaseline) {
        restoreStackPreview(previewState.targetStack, previewState.targetBaseline);
        previewState.targetStack = null;
        previewState.targetBaseline = null;
    }

    return target;
}

export function getFileCabinetHitRect(mount) {
    if (!mount) return null;
    const mountRect = mount.getBoundingClientRect();
    const splitter = document.getElementById('shell-splitter-h');
    const splitterRect = splitter?.getBoundingClientRect?.();
    if (!splitterRect) return mountRect;
    // Include the horizontal splitter band as FC-adjacent so filing doesn't flicker.
    return {
        left: Math.min(mountRect.left, splitterRect.left),
        right: Math.max(mountRect.right, splitterRect.right),
        top: Math.min(mountRect.top, splitterRect.top),
        bottom: Math.max(mountRect.bottom, splitterRect.bottom)
    };
}

export function updateStackPreviewDimensions(stackEl, slotCount, { minSlotCount = 0 } = {}) {
    if (!stackEl) return;
    const count = Math.max(slotCount, minSlotCount, 1);
    const stackHeight = fileCabinetStackHeight(count);
    const rollout = stackEl.closest('.file-cabinet-filed-rollout');

    if (rollout) {
        // Preview adapts to the notes: JS sizes the stack to the wrapped tab cascade;
        // the popover shrink-wraps via CSS (min-width keeps the chip-width floor).
        stackEl.style.width = `${fileCabinetStackWidth(count)}px`;
        stackEl.style.minWidth = '';
        stackEl.style.height = `${stackHeight}px`;
        rollout.style.width = '';
        rollout.style.minWidth = '';
        rollout.style.height = '';
        return;
    }

    applyOpenDrawerStackDimensions(stackEl, count);
}

export function applyStackPreviewPositions(stackEl, { draggedId, insertIndex = null, settling = true, minSlotCount = 0 } = {}) {
    if (!stackEl) return;
    const tabs = [...stackEl.querySelectorAll('.file-cabinet-tab')].filter((t) => t.dataset.id !== draggedId);
    const label = getLabelRect();
    let visualIndex = 0;
    tabs.forEach((tab, i) => {
        if (insertIndex != null && i === insertIndex) visualIndex++;
        tab.style.position = 'absolute';
        tab.style.left = `${fileCabinetTabLeft(visualIndex)}px`;
        tab.style.top = `${fileCabinetTabTop(visualIndex)}px`;
        tab.style.width = `${collapsedTabWidth()}px`;
        tab.style.height = `${label.h}px`;
        tab.style.zIndex = String(visualIndex + 1);
        tab.classList.toggle('layout-settling', settling);
        tab.classList.toggle('layout-preview', settling);
        visualIndex++;
    });
    const slotCount = tabs.length + (insertIndex != null ? 1 : 0);
    updateStackPreviewDimensions(stackEl, slotCount, { minSlotCount });
}

export function resolveFileCabinetDropTarget(clientX, clientY, dragState, mount) {
    if (!mount) return null;
    const prev = dragState?.card;
    const prevPe = prev?.style.pointerEvents;
    if (prev) prev.style.pointerEvents = 'none';
    const el = document.elementFromPoint(clientX, clientY);
    if (prev) prev.style.pointerEvents = prevPe || '';

    if (!el || !mount.contains(el)) return null;

    const chip = el.closest('.file-cabinet-filed-chip');
    if (chip) {
        const category = chip.dataset.category || 'Uncategorized';
        const order = getFileCabinetOrder();
        const count = (order[category] || []).filter((id) => id !== dragState?.card?.dataset?.id).length;
        return {
            kind: 'file-cabinet',
            targetStack: null,
            targetCategory: category,
            insertIndex: count,
            targetChip: chip,
            isFolded: true
        };
    }

    const stack = el.closest('.file-cabinet-tab-stack');
    if (stack) {
        const category = stack.dataset.category || 'Uncategorized';
        const tabs = [...stack.querySelectorAll('.file-cabinet-tab')].filter(
            (t) => t.dataset.id !== dragState?.card?.dataset?.id
        );
        const insertIndex = fileCabinetInsertIndexFromPoint(stack, clientX, clientY, tabs.length);
        const inRollout = !!stack.closest('.file-cabinet-filed-rollout');
        return {
            kind: 'file-cabinet',
            targetStack: stack,
            targetCategory: category,
            insertIndex,
            isFolded: inRollout
        };
    }

    const col = el.closest('.file-cabinet-category');
    if (col) {
        const category = col.dataset.category || 'Uncategorized';
        const stackEl = col.querySelector('.file-cabinet-tab-stack');
        return {
            kind: 'file-cabinet',
            targetStack: stackEl,
            targetCategory: category,
            insertIndex: 0,
            isFolded: false
        };
    }

    // Over FC mount but not a specific category — still a valid FC surface.
    return {
        kind: 'file-cabinet',
        targetStack: null,
        targetCategory: null,
        insertIndex: null,
        isFolded: false,
        isMountOnly: true
    };
}

/**
 * Resolve drop across FC and board surfaces.
 * Prefer geometry over elementFromPoint.contains — canvas uses CSS transform scale.
 * @param {'fc-tab'|'board-card'} dragKind
 */
export function resolveCrossSurfaceDropTarget(clientX, clientY, {
    dragKind = 'fc-tab',
    mount = null,
    canvas = null,
    dragState = null
} = {}) {
    const prev = dragState?.card;
    const prevPe = prev?.style.pointerEvents;
    if (prev) prev.style.pointerEvents = 'none';

    const pointInRect = (rect) => rect
        && clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom;

    const mountHitRect = getFileCabinetHitRect(mount);
    if (mount && pointInRect(mountHitRect)) {
        let fcTarget = resolveFileCabinetDropTarget(clientX, clientY, dragState, mount);
        if (!fcTarget?.targetCategory || fcTarget.isMountOnly) {
            const nearest = resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount);
            if (nearest) fcTarget = nearest;
        }
        // Pointer over splitter band (inside extended hit rect but outside mount DOM)
        if (!fcTarget || fcTarget.isMountOnly) {
            const el = document.elementFromPoint(clientX, clientY);
            if (el?.closest?.('#shell-splitter-h')) {
                const nearest = resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount);
                if (nearest) fcTarget = nearest;
                else {
                    fcTarget = {
                        kind: 'file-cabinet',
                        targetStack: null,
                        targetCategory: null,
                        insertIndex: null,
                        isMountOnly: true
                    };
                }
            }
        }
        if (prev) prev.style.pointerEvents = prevPe || '';
        return fcTarget || {
            kind: 'file-cabinet',
            targetStack: null,
            targetCategory: null,
            insertIndex: null,
            isMountOnly: true
        };
    }

    if (dragKind === 'fc-tab' && canvas) {
        const canvasRect = canvas.getBoundingClientRect();
        if (pointInRect(canvasRect)) {
            if (prev) prev.style.pointerEvents = prevPe || '';
            return { kind: 'board', clientX, clientY };
        }
    }

    // Secondary: elementsFromPoint can still help when geometry is ambiguous
    const stack = document.elementsFromPoint?.(clientX, clientY) || [];
    if (prev) prev.style.pointerEvents = prevPe || '';

    if (mount && stack.some((el) => el === mount || mount.contains(el) || el?.id === 'shell-splitter-h' || el?.closest?.('#shell-splitter-h'))) {
        return resolveFileCabinetDropTarget(clientX, clientY, dragState, mount)
            || resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount)
            || {
                kind: 'file-cabinet',
                targetStack: null,
                targetCategory: null,
                insertIndex: null,
                isMountOnly: true
            };
    }
    if (dragKind === 'fc-tab' && canvas && stack.some((el) => el === canvas || canvas.contains(el))) {
        return { kind: 'board', clientX, clientY };
    }

    return null;
}

export function resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount) {
    if (!mount) return null;
    const candidates = [
        ...mount.querySelectorAll('.file-cabinet-category'),
        ...mount.querySelectorAll('.file-cabinet-filed-chip')
    ];
    let best = null;
    let bestDist = Infinity;
    candidates.forEach((el) => {
        const r = el.getBoundingClientRect();
        const cx = Math.max(r.left, Math.min(clientX, r.right));
        const cy = Math.max(r.top, Math.min(clientY, r.bottom));
        const dist = Math.hypot(clientX - cx, clientY - cy);
        if (dist < bestDist) {
            bestDist = dist;
            best = el;
        }
    });
    // ~half a column away is still a valid snap
    if (!best || bestDist > 96) return null;

    if (best.classList.contains('file-cabinet-filed-chip')) {
        const category = best.dataset.category || 'Uncategorized';
        const order = getFileCabinetOrder();
        const count = (order[category] || []).filter((id) => id !== dragState?.card?.dataset?.id).length;
        return {
            kind: 'file-cabinet',
            targetStack: null,
            targetCategory: category,
            insertIndex: count,
            targetChip: best,
            isFolded: true
        };
    }

    const category = best.dataset.category || 'Uncategorized';
    const stackEl = best.querySelector('.file-cabinet-tab-stack');
    if (!stackEl) {
        return {
            kind: 'file-cabinet',
            targetStack: null,
            targetCategory: category,
            insertIndex: 0,
            isFolded: false
        };
    }
    const tabs = [...stackEl.querySelectorAll('.file-cabinet-tab')].filter(
        (t) => t.dataset.id !== dragState?.card?.dataset?.id
    );
    const insertIndex = fileCabinetInsertIndexFromPoint(stackEl, clientX, clientY, tabs.length);
    return {
        kind: 'file-cabinet',
        targetStack: stackEl,
        targetCategory: category,
        insertIndex,
        isFolded: false
    };
}

export function clearFileCabinetDropTargets(mount) {
    mount?.querySelectorAll('.is-file-cabinet-drop-target').forEach((el) => {
        el.classList.remove('is-file-cabinet-drop-target');
    });
    mount?.classList.remove('is-file-cabinet-drop-target');
    document.getElementById('app-canvas')?.classList.remove('is-file-cabinet-board-drop-target');
    clearFileCabinetInsertMarker(mount);
    activeDropHighlightKey = '';
}

export function clearFileCabinetSurfaceHighlights(mount = document.getElementById('file-cabinet')) {
    clearFileCabinetDropTargets(mount);
}

export function clearFileCabinetInsertMarker(mount) {
    mount?.querySelectorAll('.file-cabinet-insert-marker').forEach((el) => el.remove());
}

export function ensureFileCabinetInsertMarker(stack, insertIndex) {
    if (!stack || !Number.isFinite(insertIndex)) return;
    const mount = stack.closest('#file-cabinet');
    let marker = stack.querySelector(':scope > .file-cabinet-insert-marker');
    if (!marker) {
        if (mount) {
            mount.querySelectorAll('.file-cabinet-insert-marker').forEach((el) => {
                if (el.parentElement !== stack) el.remove();
            });
        }
        marker = document.createElement('div');
        marker.className = 'file-cabinet-insert-marker';
        stack.appendChild(marker);
    }
    const idx = Math.max(0, insertIndex);
    const col = fileCabinetCascadeCol(idx);
    const slot = fileCabinetCascadeSlot(idx);
    // At a column boundary (slot 0 after wrap), mark the start of that column strip.
    marker.style.left = `${col * fileCabinetStackPitch()}px`;
    marker.style.right = 'auto';
    marker.style.width = `${fileCabinetCascadeWidth(FILE_CABINET_DRAWER_CARDS_PER_COL)}px`;
    marker.style.top = `${slot * FILE_CABINET_STACK_OFFSET_Y}px`;
}

/** Idempotent drop highlight — avoids blink from clear/re-add every frame. */
export function applyFileCabinetDropHighlight(mount, target) {
    if (!target) {
        clearFileCabinetDropTargets(mount);
        return;
    }

    const highlightKey = target.kind === 'board'
        ? 'board'
        : target.targetChip
            ? `chip:${target.targetCategory}`
            : target.isMountOnly
                ? 'mount'
                : `col:${target.targetCategory || ''}`;

    if (highlightKey !== activeDropHighlightKey) {
        mount?.querySelectorAll('.is-file-cabinet-drop-target').forEach((el) => {
            el.classList.remove('is-file-cabinet-drop-target');
        });
        mount?.classList.remove('is-file-cabinet-drop-target');
        document.getElementById('app-canvas')?.classList.remove('is-file-cabinet-board-drop-target');
        activeDropHighlightKey = highlightKey;

        if (target.kind === 'board') {
            document.getElementById('app-canvas')?.classList.add('is-file-cabinet-board-drop-target');
        } else if (target.targetChip) {
            target.targetChip.classList.add('is-file-cabinet-drop-target');
        } else if (target.isMountOnly) {
            mount?.classList.add('is-file-cabinet-drop-target');
        } else {
            const col = target.targetStack?.closest('.file-cabinet-category')
                || [...(mount?.querySelectorAll('.file-cabinet-category') || [])]
                    .find((c) => c.dataset.category === target.targetCategory);
            col?.classList.add('is-file-cabinet-drop-target');
        }
    }

    if (target.kind === 'file-cabinet' && target.targetStack && Number.isFinite(target.insertIndex)) {
        ensureFileCabinetInsertMarker(target.targetStack, target.insertIndex);
    } else {
        clearFileCabinetInsertMarker(mount);
    }
}

export function setFileCabinetDropTarget(mount, target) {
    applyFileCabinetDropHighlight(mount, target);
}

export function autoScrollFileCabinetInner(mount, clientX) {
    const inner = mount?.querySelector('.file-cabinet-inner');
    if (!inner) return;
    const rect = inner.getBoundingClientRect();
    if (clientX > rect.right - FILE_CABINET_SCROLL_EDGE) {
        inner.scrollLeft += FILE_CABINET_SCROLL_STEP;
    } else if (clientX < rect.left + FILE_CABINET_SCROLL_EDGE) {
        inner.scrollLeft = Math.max(0, inner.scrollLeft - FILE_CABINET_SCROLL_STEP);
    }
}

export function updateFileCabinetCategoryCount(mount, category) {
    const col = mount?.querySelector(`.file-cabinet-category[data-category="${CSS.escape(category)}"]`);
    if (!col) return;
    const count = col.querySelectorAll('.file-cabinet-tab').length;
    const countEl = col.querySelector('.file-cabinet-category-count');
    if (countEl) countEl.textContent = String(count);
}

export function flashFileCabinetDropRejected(card) {
    if (!card) return;
    card.classList.add('is-drop-rejected');
    window.setTimeout(() => card.classList.remove('is-drop-rejected'), 180);
}

export function resetDraggedTabStyles(card, stack) {
    if (!card) return;
    card.classList.remove('is-file-cabinet-dragging', 'layout-settling', 'layout-preview');
    card.style.position = '';
    card.style.left = '';
    card.style.top = '';
    card.style.width = '';
    card.style.height = '';
    card.style.margin = '';
    card.style.zIndex = '';
    card.style.pointerEvents = '';
    if (stack?.contains(card)) applyFileCabinetStackPositions(stack);
}

/**
 * @param {HTMLElement} mount
 * @param {Array|Function} currentItemsOrGetter - items array or () => items
 * @param {Object} UI
 * @param {AbortSignal} signal
 */
export function initFileCabinetDrag(mount, currentItemsOrGetter = [], UI, signal) {
    if (!mount || !signal) return;

    const getItems = typeof currentItemsOrGetter === 'function'
        ? currentItemsOrGetter
        : () => currentItemsOrGetter || [];

    initFileCabinetCategoryActions(mount, signal, UI);
    initFileCabinetCategoryColumnDrag(mount, getItems, signal);

    const foldedHoverPreview = initFileCabinetFoldedHoverPreview(
        mount,
        () => mount.__fcPreviewContext,
        signal
    );

    const itemsById = () => new Map(getItems().map((item) => [item.id, item]));
    let dragState = null;
    let previewFrame = null;

    const cancelPreviewFrame = () => {
        if (!previewFrame) return;
        cancelAnimationFrame(previewFrame);
        previewFrame = null;
    };

    const restorePreviewFromState = (state) => {
        restoreStackPreview(state.sourceStack, state.sourceBaseline);
        if (state.targetStack && state.targetStack !== state.sourceStack) {
            restoreStackPreview(state.targetStack, state.targetBaseline);
        }
    };

    const applyPreviewAt = (clientX, clientY) => {
        if (!dragState?.active) return null;
        const dockButtons = setDesktopDockDragHighlight(clientX, clientY);
        if (dockButtons.length > 0) {
            restorePreviewFromState(dragState);
            clearFileCabinetDropTargets(mount);
            if (dragState.targetStack && dragState.targetStack !== dragState.sourceStack) {
                dragState.targetStack = null;
                dragState.targetBaseline = null;
            }
            dragState.currentTarget = { kind: 'desktop-dock' };
            return dragState.currentTarget;
        }

        const canvas = document.getElementById('app-canvas');
        const target = resolveCrossSurfaceDropTarget(clientX, clientY, {
            dragKind: 'fc-tab',
            mount,
            canvas,
            dragState
        });
        dragState.currentTarget = target;
        setFileCabinetDropTarget(mount, target);

        if (target?.kind === 'file-cabinet' && target.isFolded && target.targetChip) {
            const slot = target.targetChip.closest('.file-cabinet-filed-slot');
            foldedHoverPreview?.showPreviewDuringDrag(slot);
            const refreshed = resolveFileCabinetDropTarget(clientX, clientY, dragState, mount)
                || resolveNearestFileCabinetCategory(clientX, clientY, dragState, mount);
            if (refreshed?.targetStack) {
                Object.assign(target, refreshed);
                dragState.currentTarget = target;
                setFileCabinetDropTarget(mount, target);
            }
        }

        const draggedId = dragState.card.dataset.id;
        const sourceMinSlots = dragState.sourceTabCount || 0;
        const sameStack = target?.kind === 'file-cabinet'
            && target.targetStack
            && target.targetStack === dragState.sourceStack;
        const crossStack = target?.kind === 'file-cabinet'
            && target.targetStack
            && target.targetStack !== dragState.sourceStack;

        // Single preview pass — never collapse-then-reopen the same stack in one frame.
        if (sameStack) {
            applyStackPreviewPositions(dragState.sourceStack, {
                draggedId,
                insertIndex: target.insertIndex,
                settling: true,
                minSlotCount: sourceMinSlots
            });
            if (dragState.targetStack && dragState.targetStack !== dragState.sourceStack) {
                restoreStackPreview(dragState.targetStack, dragState.targetBaseline);
                dragState.targetStack = null;
                dragState.targetBaseline = null;
            }
        } else {
            applyStackPreviewPositions(dragState.sourceStack, {
                draggedId,
                insertIndex: null,
                settling: true,
                minSlotCount: sourceMinSlots
            });

            if (crossStack) {
                if (dragState.targetStack !== target.targetStack) {
                    if (dragState.targetStack && dragState.targetBaseline) {
                        restoreStackPreview(dragState.targetStack, dragState.targetBaseline);
                    }
                    dragState.targetStack = target.targetStack;
                    dragState.targetBaseline = snapshotStackTabs(target.targetStack);
                }
                applyStackPreviewPositions(target.targetStack, {
                    draggedId,
                    insertIndex: target.insertIndex,
                    settling: true
                });
            } else if (dragState.targetStack && dragState.targetStack !== dragState.sourceStack) {
                restoreStackPreview(dragState.targetStack, dragState.targetBaseline);
                dragState.targetStack = null;
                dragState.targetBaseline = null;
            }
        }

        autoScrollFileCabinetInner(mount, clientX);

        const slotKey = `${dragState.sourceStack?.querySelectorAll('.file-cabinet-tab').length || 0}:${target?.targetStack?.querySelectorAll('.file-cabinet-tab').length || 0}:${target?.insertIndex ?? ''}`;
        if (dragState._lastSlotKey !== slotKey) {
            dragState._lastSlotKey = slotKey;
            syncFileCabinetDrawerHeight(mount);
        }
        return target;
    };

    const runPreview = (clientX, clientY) => {
        if (!dragState?.active) return;
        dragState.lastX = clientX;
        dragState.lastY = clientY;
        if (previewFrame) return;
        previewFrame = requestAnimationFrame(() => {
            previewFrame = null;
            if (!dragState?.active) return;
            applyPreviewAt(dragState.lastX, dragState.lastY);
        });
    };

    const moveTabDomToCategory = (state, toCategory, toIndex, target) => {
        let destStack = target?.targetStack;
        if (!destStack) {
            destStack = mount.querySelector(
                `.file-cabinet-category[data-category="${CSS.escape(toCategory)}"] .file-cabinet-tab-stack`
            );
        }
        if (!destStack) return false;

        const destTabs = [...destStack.querySelectorAll('.file-cabinet-tab')]
            .filter((t) => t !== state.card);
        if (toIndex >= destTabs.length) destStack.appendChild(state.card);
        else destStack.insertBefore(state.card, destTabs[toIndex]);

        state.card.dataset.fileCabinetCategory = toCategory;
        const colorHost = destStack.closest('.file-cabinet-category');
        const color = colorHost?.style.getPropertyValue('--file-cabinet-category-color');
        if (color) {
            state.card.style.setProperty('--card-category-color', color);
            state.card.style.setProperty('--file-cabinet-category-color', color);
        }
        // Must clear before apply — applyFileCabinetStackPositions skips dragging tabs,
        // which would leave dest siblings packed one slot early and the moved note unpositioned.
        state.card.classList.remove('is-file-cabinet-dragging', 'layout-settling', 'layout-preview');
        applyFileCabinetStackPositions(state.sourceStack);
        applyFileCabinetStackPositions(destStack);
        updateFileCabinetCategoryCount(mount, state.sourceCategory);
        updateFileCabinetCategoryCount(mount, toCategory);

        if (!state.sourceStack.querySelector('.file-cabinet-tab')) {
            const emptyCol = state.sourceStack.closest('.file-cabinet-category');
            emptyCol?.remove();
            return 'structural';
        }
        return true;
    };

    const finishDrag = (e) => {
        if (!dragState) return;
        const state = dragState;
        dragState = null;

        cancelPreviewFrame();

        if (!state.active) {
            document.body.classList.remove('is-file-cabinet-drag-active');
            mount.classList.remove('is-layout-active');
            clearFileCabinetDropTargets(mount);
            clearDesktopDockDragHighlight();
            foldedHoverPreview?.onDragEnd();
            resetDraggedTabStyles(state.card, state.sourceStack);
            return;
        }

        clearDesktopDockDragHighlight();

        const dockButtons = getDockButtonAt(e.clientX, e.clientY);
        const targetDesktopId = dockButtons.length
            ? Number(dockButtons[0].dataset.desktopId)
            : null;

        // Always resolve fresh at drop — never trust stale rAF currentTarget.
        const canvas = document.getElementById('app-canvas');
        const target = resolveCrossSurfaceDropTarget(e.clientX, e.clientY, {
            dragKind: 'fc-tab',
            mount,
            canvas,
            dragState: state
        });

        restorePreviewFromState(state);
        clearFileCabinetDropTargets(mount);
        document.body.classList.remove('is-file-cabinet-drag-active');
        mount.classList.remove('is-layout-active');
        foldedHoverPreview?.onDragEnd();

        const fromCategory = state.sourceCategory;
        const itemId = state.card.dataset.id;
        const item = itemsById().get(itemId) || UI?.resolveBoardItem?.(itemId);

        if (!itemId) {
            endFileCabinetDragGhost(state.card, state.placeholder);
            resetDraggedTabStyles(state.card, state.sourceStack);
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        // FC tab → desktop dock (stay filed on target desktop)
        if (Number.isInteger(targetDesktopId)) {
            const currentDesktop = item?.desktopId || 1;
            endFileCabinetDragGhost(state.card, state.placeholder);
            resetDraggedTabStyles(state.card, state.sourceStack);
            if (targetDesktopId !== currentDesktop && item) {
                DesktopManager.assignNoteToDesktop(item, targetDesktopId);
                window.dispatchEvent(new CustomEvent('desktop:changed', {
                    detail: { desktopId: DesktopManager.getActiveDesktop() }
                }));
            }
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        // FC tab → board
        if (target?.kind === 'board') {
            const sourceRect = captureClientRect(state.card)
                || (Number.isFinite(e.clientX)
                    ? { left: e.clientX - 40, top: e.clientY - 16, width: 80, height: 32, x: e.clientX - 40, y: e.clientY - 16 }
                    : null);
            endFileCabinetDragGhost(state.card, state.placeholder);
            resetDraggedTabStyles(state.card, state.sourceStack);
            expandFileCabinetItemToBoard({
                item,
                dropX: e.clientX,
                dropY: e.clientY,
                UI,
                card: state.card,
                sourceRect
            });
            return;
        }

        if (!target || target.kind !== 'file-cabinet' || target.isMountOnly || !target.targetCategory) {
            endFileCabinetDragGhost(state.card, state.placeholder);
            resetDraggedTabStyles(state.card, state.sourceStack);
            flashFileCabinetDropRejected(state.card);
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        const toCategory = target.targetCategory || 'Uncategorized';
        const toIndex = target.insertIndex ?? 0;

        endFileCabinetDragGhost(state.card, state.placeholder);

        if (fromCategory === toCategory) {
            const tabs = [...state.sourceStack.querySelectorAll('.file-cabinet-tab')];
            const startIndex = state.startIndex;
            const finalIndex = Math.max(0, Math.min(tabs.length - 1, toIndex));

            resetDraggedTabStyles(state.card, state.sourceStack);

            if (finalIndex !== startIndex) {
                reorderInCategory(fromCategory, startIndex, finalIndex);
                const moved = tabs.splice(startIndex, 1)[0];
                tabs.splice(finalIndex, 0, moved);
                tabs.forEach((tab) => state.sourceStack.appendChild(tab));
            }
            applyFileCabinetStackPositions(state.sourceStack);
            syncFileCabinetDrawerHeight(mount);
            return;
        }

        moveItemBetweenCategories({
            itemId,
            fromCategory,
            toCategory,
            toIndex,
            item,
            UI
        });

        // Folded chip without an open stack needs a full re-render.
        if (target.isFolded && !target.targetStack) {
            resetDraggedTabStyles(state.card, state.sourceStack);
            window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            return;
        }

        const moved = moveTabDomToCategory(state, toCategory, toIndex, target);
        const destStackForReset = state.card.closest('.file-cabinet-tab-stack') || target?.targetStack;
        resetDraggedTabStyles(state.card, destStackForReset);
        if (moved === 'structural' || moved === false) {
            window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            return;
        }
        syncFileCabinetDrawerHeight(mount);
    };

    mount.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        // Restrict tab drag to the dedicated grab handle.
        const handle = e.target.closest('.card-act--drag');
        if (!handle) return;
        const card = handle.closest('.file-cabinet-tab');
        if (!card || !mount.contains(card)) return;
        const stack = card.closest('.file-cabinet-tab-stack');
        if (!stack) return;

        e.preventDefault();
        e.stopPropagation();

        const startX = e.clientX;
        const startY = e.clientY;
        const tabs = [...stack.querySelectorAll('.file-cabinet-tab')];
        const startIndex = tabs.indexOf(card);
        if (startIndex < 0) return;

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!dragState?.active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

            if (!dragState) {
                ev.preventDefault();
                window.getSelection?.()?.removeAllRanges?.();
                card.querySelector('.card-inline-edit:focus')?.blur?.();
                const rect = card.getBoundingClientRect();
                const colorHost = card.closest('.file-cabinet-category')
                    || card.closest('.file-cabinet-tab-stack');
                if (colorHost) {
                    card.style.setProperty(
                        '--file-cabinet-category-color',
                        colorHost.style.getPropertyValue('--file-cabinet-category-color')
                    );
                }
                const sourceBaseline = snapshotStackTabs(stack);
                const placeholder = beginFileCabinetDragGhost(card, stack);
                dragState = {
                    active: true,
                    card,
                    sourceStack: stack,
                    sourceCategory: stack.dataset.category || 'Uncategorized',
                    startIndex,
                    sourceTabCount: tabs.length,
                    sourceBaseline,
                    targetStack: null,
                    targetBaseline: null,
                    currentTarget: null,
                    placeholder,
                    fixedOffsetX: startX - rect.left,
                    fixedOffsetY: startY - rect.top
                };
                card.classList.add('is-file-cabinet-dragging');
                card.style.pointerEvents = 'none';
                document.body.classList.add('is-file-cabinet-drag-active');
                mount.classList.add('is-layout-active');
                card.style.position = 'fixed';
                card.style.left = `${rect.left}px`;
                card.style.top = `${rect.top}px`;
                card.style.width = `${rect.width}px`;
                card.style.height = `${rect.height}px`;
                card.style.margin = '0';
                card.style.zIndex = '9999';
                foldedHoverPreview?.onDragStart(stack);
            }

            card.style.left = `${ev.clientX - dragState.fixedOffsetX}px`;
            card.style.top = `${ev.clientY - dragState.fixedOffsetY}px`;
            runPreview(ev.clientX, ev.clientY);
        };

        function onKey(ev) {
            if (ev.key !== 'Escape' || !dragState) return;
            cancelPreviewFrame();
            const state = dragState;
            dragState = null;
            if (state.active) {
                restorePreviewFromState(state);
                endFileCabinetDragGhost(state.card, state.placeholder);
            }
            clearFileCabinetDropTargets(mount);
            clearDesktopDockDragHighlight();
            document.body.classList.remove('is-file-cabinet-drag-active');
            mount.classList.remove('is-layout-active');
            foldedHoverPreview?.onDragEnd();
            resetDraggedTabStyles(state.card, state.sourceStack);
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('keydown', onKey);
        }

        function onUp(ev) {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            document.removeEventListener('keydown', onKey);
            if (!dragState) {
                dragState = {
                    active: false,
                    card,
                    sourceStack: stack,
                    sourceCategory: stack.dataset.category || 'Uncategorized',
                    startIndex
                };
            }
            finishDrag(ev);
        }

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        document.addEventListener('keydown', onKey);
    }, { signal });
}
