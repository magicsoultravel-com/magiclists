/** @module {"owns":"file cabinet category rail - folded-slot hover previews, rename/color/hide actions, empty-shelf toggles and dragging a whole shelf onto another desktop", "related":["fileCabinet.js","fileCabinet/render.js","fileCabinet/transfer.js","desktopManager.js"]} */
import { resolveCategoryColor, isUncategorizedCategory, renameCategory } from '../categories.js';
import { escapeAttr, escapeHTML } from '../domEscape.js';
import { ColorPicker, PALETTE_NOTE } from '../colorPicker.js';
import { getLabelRect } from '../tileGeometry.js';
import { DesktopManager } from '../desktopManager.js';
import { createCardComponent } from '../noteSurfaceHtml.js';
import {
    getDockButtonAt,
    setDesktopDockDragHighlight,
    clearDesktopDockDragHighlight
} from '../desktopDockDrop.js';
import {
    getFileCabinetOrder,
    persistFileCabinetCategoryOrderFromDom,
    sortItemsByFileCabinetOrder,
    toggleFileCabinetCategoryFiled,
    toggleFileCabinetEmptyShelvesCollapsed
} from './order.js';
import { applyFileCabinetStackPositions, DRAG_THRESHOLD } from './layout.js';
import { ensureFileCabinetTabDragHandle } from './render.js';
import { expandFileCabinetCategoryToBoard } from './transfer.js';

export function buildFileCabinetRolloutStack({ catName, items, activeCategories, UI }) {
    const label = getLabelRect();

    const stack = document.createElement('div');
    stack.className = 'file-cabinet-tab-stack';
    stack.dataset.category = catName;

    items.forEach((item, index) => {
        const card = createCardComponent(UI, item, activeCategories);
        card.classList.add('file-cabinet-tab', 'spatial-at-small');
        card.dataset.fileCabinetCategory = catName;
        card.dataset.fileCabinetStackIndex = String(index);
        ensureFileCabinetTabDragHandle(card);
        UI.applyNoteRect(card, { x: 0, y: 0, w: label.w, h: label.h }, { settling: false });
        UI.finalizeDesktopCard(card);
        UI.syncSpatialToggleButton(card);
        stack.appendChild(card);
    });

    applyFileCabinetStackPositions(stack);
    // Pre-append the stack takes the open-column branch (no rollout ancestor yet);
    // pin it to the pure cascade width so the preview popover hugs the notes.
    stack.style.width = `${fileCabinetStackWidth(items.length)}px`;
    return stack;
}

export function initFileCabinetFoldedHoverPreview(mount, getPreviewContext, signal) {
    if (!mount || !signal) return null;

    let activeSlot = null;
    let pinnedByDrag = false;
    let dragMode = false;

    const getSlotChip = (slot) => slot?.querySelector('.file-cabinet-filed-chip');
    const getSlotRollout = (slot) => slot?.querySelector('.file-cabinet-filed-rollout');

    const closeSlot = (slot) => {
        if (!slot?.isConnected) return;
        const rollout = getSlotRollout(slot);
        if (rollout) {
            rollout.innerHTML = '';
            rollout.removeAttribute('style');
            rollout.setAttribute('aria-hidden', 'true');
        }
        slot.classList.remove('is-fold-rollout-open');
        getSlotChip(slot)?.classList.remove('is-fold-preview-source');
    };

    const isInsidePreviewZone = (el) => {
        if (!el || !activeSlot?.isConnected) return false;
        return activeSlot.contains(el);
    };

    const hidePreview = (force = false) => {
        if (!force && pinnedByDrag) return;
        if (!force && dragMode) return;
        if (!force && document.body.classList.contains('is-file-cabinet-drag-active') && !dragMode) return;
        mount.querySelectorAll('.file-cabinet-filed-slot.is-fold-rollout-open').forEach((slot) => {
            closeSlot(slot);
        });
        mount.classList.remove('is-rollout-active');
        activeSlot = null;
    };

    const showPreview = (slot, { duringDrag = false } = {}) => {
        if (!duringDrag && document.body.classList.contains('is-file-cabinet-drag-active') && !dragMode) return;
        const ctx = getPreviewContext?.();
        if (!ctx || !slot) return;

        const catName = slot.dataset.category;
        if (!catName) return;

        const items = ctx.byCategory?.get(catName);
        if (!items?.length) return;

        const rollout = getSlotRollout(slot);
        const chip = getSlotChip(slot);
        if (!rollout) return;

        if (activeSlot === slot && rollout.querySelector('.file-cabinet-tab-stack')) {
            slot.classList.add('is-fold-rollout-open');
            chip?.classList.add('is-fold-preview-source');
            mount.classList.add('is-rollout-active');
            return;
        }

        if (activeSlot && activeSlot !== slot) closeSlot(activeSlot);
        activeSlot = slot;

        const sorted = sortItemsByFileCabinetOrder(items, catName, ctx.order || getFileCabinetOrder());
        rollout.innerHTML = '';
        rollout.appendChild(buildFileCabinetRolloutStack({
            catName,
            items: sorted,
            activeCategories: ctx.activeCategories,
            UI: ctx.UI
        }));
        rollout.setAttribute('aria-hidden', 'false');
        slot.classList.add('is-fold-rollout-open');
        chip?.classList.add('is-fold-preview-source');
        mount.classList.add('is-rollout-active');
    };

    const maybeHidePreview = (relatedTarget) => {
        if (isInsidePreviewZone(relatedTarget)) return;
        if (pinnedByDrag || dragMode) return;
        if (document.body.classList.contains('is-file-cabinet-drag-active')) return;
        hidePreview();
    };

    mount.addEventListener('pointerover', (e) => {
        const slot = e.target.closest('.file-cabinet-filed-slot');
        if (!slot || !mount.contains(slot)) return;
        if (e.relatedTarget && slot.contains(e.relatedTarget)) return;
        if (document.body.classList.contains('is-file-cabinet-drag-active') && !dragMode) return;
        showPreview(slot, { duringDrag: dragMode });
    }, { signal });

    mount.addEventListener('pointerout', (e) => {
        const slot = e.target.closest('.file-cabinet-filed-slot');
        const fromRollout = e.target.closest('.file-cabinet-filed-rollout');
        if (!slot && !fromRollout) return;
        maybeHidePreview(e.relatedTarget);
    }, { signal });

    mount.addEventListener('focusin', (e) => {
        const slot = e.target.closest('.file-cabinet-filed-slot');
        if (!slot) return;
        showPreview(slot);
    }, { signal });

    mount.addEventListener('focusout', (e) => {
        const slot = e.target.closest('.file-cabinet-filed-slot');
        const fromRollout = e.target.closest('.file-cabinet-filed-rollout');
        if (!slot && !fromRollout) return;
        requestAnimationFrame(() => {
            if (isInsidePreviewZone(document.activeElement)) return;
            if (pinnedByDrag || dragMode) return;
            if (document.body.classList.contains('is-file-cabinet-drag-active')) return;
            hidePreview();
        });
    }, { signal });

    return {
        onDragStart(stack) {
            dragMode = true;
            if (stack?.closest('.file-cabinet-filed-rollout')) pinnedByDrag = true;
        },
        onDragEnd() {
            const wasPinned = pinnedByDrag;
            pinnedByDrag = false;
            dragMode = false;
            if (wasPinned) hidePreview(true);
            else hidePreview(true);
        },
        showPreviewDuringDrag(slot) {
            dragMode = true;
            if (slot) showPreview(slot, { duringDrag: true });
        },
        hidePreview
    };
}

export function readStoredCategoriesFromContext(mount) {
    return mount?.__fcPreviewContext?.activeCategories || [];
}

export function initFileCabinetCategoryActions(mount, signal, UI = null) {
    if (!mount || !signal) return;

    const nameSelector = '.file-cabinet-category-name.card-inline-edit, .file-cabinet-filed-chip-name.card-inline-edit';

    const commitNameEdit = (nameEl, { revert = false } = {}) => {
        if (!nameEl || nameEl.dataset.renaming !== '1') return;
        const oldName = nameEl.dataset.renameFrom || '';
        const displayBefore = nameEl.dataset.renameDisplay || oldName;
        delete nameEl.dataset.renaming;
        delete nameEl.dataset.renameFrom;
        delete nameEl.dataset.renameDisplay;

        if (revert || isUncategorizedCategory(oldName)) {
            nameEl.textContent = displayBefore;
            return;
        }

        let next = (nameEl.textContent || '').trim();
        if (nameEl.classList.contains('file-cabinet-filed-chip-name')) {
            next = next.replace(/\s*\(\d+\)\s*$/, '').trim();
        }
        if (!next || next === oldName) {
            nameEl.textContent = displayBefore;
            return;
        }
        const result = renameCategory(oldName, next);
        if (!result.ok) {
            alert(result.error || 'Could not rename category.');
            nameEl.textContent = displayBefore;
        }
        // category:renamed listener handles item patch + FC re-render
    };

    mount.addEventListener('focusin', (e) => {
        const nameEl = e.target.closest?.(nameSelector);
        if (!nameEl || !mount.contains(nameEl) || nameEl.dataset.renaming === '1') return;
        const host = nameEl.closest('.file-cabinet-category, .file-cabinet-filed-chip');
        const cat = host?.dataset.category;
        if (!cat || isUncategorizedCategory(cat)) return;
        nameEl.dataset.renaming = '1';
        nameEl.dataset.renameFrom = cat;
        nameEl.dataset.renameDisplay = nameEl.textContent || cat;
        if (nameEl.classList.contains('file-cabinet-filed-chip-name')) {
            nameEl.textContent = cat;
        }
    }, { signal });

    mount.addEventListener('keydown', (e) => {
        const nameEl = e.target.closest?.(nameSelector);
        if (!nameEl || !mount.contains(nameEl)) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            nameEl.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            commitNameEdit(nameEl, { revert: true });
            nameEl.blur();
        }
    }, { signal });

    mount.addEventListener('focusout', (e) => {
        const nameEl = e.target.closest?.(nameSelector);
        if (!nameEl || !mount.contains(nameEl)) return;
        // Defer so Escape can set revert before blur commit
        queueMicrotask(() => commitNameEdit(nameEl));
    }, { signal });

    mount.addEventListener('mousedown', (e) => {
        const nameEl = e.target.closest?.(nameSelector);
        if (nameEl && mount.contains(nameEl)) {
            e.stopPropagation();
        }
    }, { signal });

    mount.addEventListener('click', (e) => {
        const emptyToggle = e.target.closest('.file-cabinet-empty-shelves__toggle');
        if (emptyToggle) {
            e.preventDefault();
            e.stopPropagation();
            toggleFileCabinetEmptyShelvesCollapsed();
            window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            return;
        }

        const addBtn = e.target.closest('.file-cabinet-add-category-btn');
        if (addBtn) {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(new CustomEvent('category:add_prompt', { detail: { anchor: addBtn } }));
            return;
        }

        const colorBtn = e.target.closest('.file-cabinet-category-color-btn');
        if (colorBtn) {
            e.preventDefault();
            e.stopPropagation();
            const host = colorBtn.closest('.file-cabinet-category, .file-cabinet-filed-chip');
            const cat = host?.dataset.category;
            if (!cat || isUncategorizedCategory(cat)) return;
            ColorPicker.open({
                anchor: colorBtn,
                presets: PALETTE_NOTE,
                value: resolveCategoryColor(cat, readStoredCategoriesFromContext(mount)),
                align: 'end',
                onSelect: (color) => {
                    window.dispatchEvent(new CustomEvent('category:color_changed', {
                        detail: { name: cat, color }
                    }));
                }
            });
            return;
        }

        const hideBtn = e.target.closest('.file-cabinet-category-hide-btn');
        if (hideBtn) {
            e.preventDefault();
            e.stopPropagation();
            const host = hideBtn.closest('.file-cabinet-category, .file-cabinet-filed-chip');
            const cat = host?.dataset.category;
            if (!cat || isUncategorizedCategory(cat)) return;
            window.dispatchEvent(new CustomEvent('category:hide_requested', { detail: { name: cat } }));
            return;
        }

        const openAllBtn = e.target.closest('.file-cabinet-category-open-all-btn');
        if (openAllBtn) {
            e.preventDefault();
            e.stopPropagation();
            const host = openAllBtn.closest('.file-cabinet-category, .file-cabinet-filed-chip');
            const cat = host?.dataset.category;
            if (cat && UI) expandFileCabinetCategoryToBoard(cat, UI);
            return;
        }
        const foldBtn = e.target.closest('.file-cabinet-category-fold-btn');
        if (foldBtn) {
            e.preventDefault();
            e.stopPropagation();
            const col = foldBtn.closest('.file-cabinet-category');
            const cat = col?.dataset.category;
            if (cat) {
                toggleFileCabinetCategoryFiled(cat);
                window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            }
            return;
        }
        const expandBtn = e.target.closest('.file-cabinet-filed-chip-expand');
        if (expandBtn) {
            e.preventDefault();
            e.stopPropagation();
            const chip = expandBtn.closest('.file-cabinet-filed-chip');
            const cat = chip?.dataset.category;
            if (cat) {
                toggleFileCabinetCategoryFiled(cat);
                window.dispatchEvent(new CustomEvent('filecabinet:layout_changed', { detail: { flushLayout: false } }));
            }
        }
    }, { signal });
}

export function createCategoryChipGhost(dragEl) {
    const cat = dragEl.dataset.category || 'Uncategorized';
    const nameEl = dragEl.querySelector('.file-cabinet-category-name, .file-cabinet-filed-chip-name');
    let name = nameEl?.textContent?.trim() || cat;
    name = name.replace(/\s*\(\d+\)\s*$/, '').trim() || cat;
    const countEl = dragEl.querySelector('.file-cabinet-category-count');
    const count = countEl?.textContent?.trim()
        || (nameEl?.textContent?.match(/\((\d+)\)/)?.[1] ?? '');
    const dot = dragEl.querySelector('.file-cabinet-category-dot');
    const color = dragEl.style.getPropertyValue('--file-cabinet-category-color')?.trim()
        || dragEl.style.getPropertyValue('--card-category-color')?.trim()
        || dot?.style?.background
        || 'var(--accent-color)';

    const ghost = document.createElement('div');
    ghost.className = 'file-cabinet-category-chip-ghost';
    ghost.style.setProperty('--card-category-color', color);
    ghost.innerHTML = `<span class="file-cabinet-category-dot" style="background:${escapeAttr(color)}"></span><span class="file-cabinet-category-chip-ghost-name u-truncate">${escapeHTML(name)}${count ? ` (${escapeHTML(count)})` : ''}</span>`;
    return ghost;
}

export function collectFileCabinetCategoryNoteIds(mount, category, items, activeDesktop) {
    if (!category) return [];
    const col = mount?.querySelector(`.file-cabinet-category[data-category="${CSS.escape(category)}"]`);
    if (col) {
        return [...col.querySelectorAll('.file-cabinet-tab')]
            .map((tab) => tab.dataset.id)
            .filter(Boolean);
    }
    const order = getFileCabinetOrder()[category] || [];
    const byId = new Map((items || []).map((item) => [item.id, item]));
    return order.filter((id) => {
        const item = byId.get(id);
        return item && (item.desktopId || 1) === activeDesktop;
    });
}

export function assignFileCabinetItemsToDesktop(itemIds, targetDesktopId, items) {
    const byId = new Map((items || []).map((item) => [item.id, item]));
    let changed = false;
    (itemIds || []).forEach((id) => {
        const item = byId.get(id);
        if (!item) return;
        const current = item.desktopId || 1;
        if (current === targetDesktopId) return;
        DesktopManager.assignNoteToDesktop(item, targetDesktopId);
        changed = true;
    });
    if (changed) {
        window.dispatchEvent(new CustomEvent('desktop:changed', {
            detail: { desktopId: DesktopManager.getActiveDesktop() }
        }));
    }
    return changed;
}

export function initFileCabinetCategoryColumnDrag(mount, getItems, signal) {
    if (!mount || !signal) return;

    mount.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const grab = e.target.closest('.file-cabinet-category-grab-btn, .file-cabinet-filed-chip-grab');
        if (!grab || !mount.contains(grab)) return;

        const col = grab.closest('.file-cabinet-category');
        const slot = grab.closest('.file-cabinet-filed-slot');
        const dragEl = col || slot;
        if (!dragEl) return;

        e.preventDefault();
        e.stopPropagation();

        const parent = col
            ? mount.querySelector('.file-cabinet-row')
            : mount.querySelector('.file-cabinet-filed-rail');
        if (!parent) return;

        const siblings = [...parent.children];
        const startIndex = siblings.indexOf(dragEl);
        if (startIndex < 0) return;
        const category = dragEl.dataset.category || 'Uncategorized';

        const startX = e.clientX;
        const startY = e.clientY;
        let active = false;
        let placeholder = null;
        let ghost = null;
        let offsetX = 0;
        let offsetY = 0;

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;
            if (!active && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

            if (!active) {
                active = true;
                // Measure WHILE still in the row — never after reparenting.
                const rect = dragEl.getBoundingClientRect();
                offsetX = Math.min(Math.max(8, ev.clientX - rect.left), Math.max(16, rect.width - 8));
                offsetY = Math.min(Math.max(8, ev.clientY - rect.top), 18);

                placeholder = document.createElement('div');
                placeholder.className = col
                    ? 'file-cabinet-category-placeholder'
                    : 'file-cabinet-filed-slot-placeholder';
                placeholder.style.width = `${rect.width}px`;
                placeholder.style.height = `${rect.height}px`;
                placeholder.style.minWidth = `${rect.width}px`;
                placeholder.style.flex = '0 0 auto';
                placeholder.dataset.category = dragEl.dataset.category || '';
                parent.insertBefore(placeholder, dragEl);
                dragEl.remove();

                ghost = createCategoryChipGhost(dragEl);
                document.body.appendChild(ghost);
                ghost.style.position = 'fixed';
                ghost.style.left = `${ev.clientX - offsetX}px`;
                ghost.style.top = `${ev.clientY - offsetY}px`;
                ghost.style.zIndex = '10000';
                ghost.style.pointerEvents = 'none';
                document.body.classList.add('is-file-cabinet-drag-active');
                try { grab.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
            }

            if (!ghost) return;
            ghost.style.left = `${ev.clientX - offsetX}px`;
            ghost.style.top = `${ev.clientY - offsetY}px`;

            const dockButtons = setDesktopDockDragHighlight(ev.clientX, ev.clientY);
            if (dockButtons.length > 0) return;

            const hit = document.elementFromPoint(ev.clientX, ev.clientY);
            const over = col
                ? hit?.closest?.('.file-cabinet-category, .file-cabinet-category-placeholder')
                : hit?.closest?.('.file-cabinet-filed-slot, .file-cabinet-filed-slot-placeholder');
            if (!over || over === placeholder || over === dragEl) return;
            if (!parent.contains(over) && over !== placeholder) return;

            const overRect = over.getBoundingClientRect();
            const before = col
                ? ev.clientX < overRect.left + overRect.width / 2
                : ev.clientY < overRect.top + overRect.height / 2;
            if (before) parent.insertBefore(placeholder, over);
            else parent.insertBefore(placeholder, over.nextSibling);
        };

        const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            try { grab.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }

            document.body.classList.remove('is-file-cabinet-drag-active');
            clearDesktopDockDragHighlight();
            ghost?.remove();
            ghost = null;

            const dockButtons = getDockButtonAt(ev.clientX, ev.clientY);
            const targetDesktopId = dockButtons.length
                ? Number(dockButtons[0].dataset.desktopId)
                : null;
            const activeDesktop = DesktopManager.getActiveDesktop();

            if (
                active
                && Number.isInteger(targetDesktopId)
                && targetDesktopId !== activeDesktop
            ) {
                const items = typeof getItems === 'function' ? getItems() : [];
                const itemIds = collectFileCabinetCategoryNoteIds(mount, category, items, activeDesktop);
                if (placeholder?.parentNode) {
                    placeholder.parentNode.insertBefore(dragEl, placeholder);
                    placeholder.remove();
                } else if (!dragEl.isConnected) {
                    parent.appendChild(dragEl);
                }
                assignFileCabinetItemsToDesktop(itemIds, targetDesktopId, items);
                return;
            }

            if (!active || !placeholder?.parentNode) {
                if (placeholder?.parentNode) {
                    placeholder.parentNode.insertBefore(dragEl, placeholder);
                    placeholder.remove();
                } else if (!dragEl.isConnected) {
                    parent.appendChild(dragEl);
                }
                return;
            }

            placeholder.parentNode.insertBefore(dragEl, placeholder);
            placeholder.remove();
            persistFileCabinetCategoryOrderFromDom(mount);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }, { signal });
}
