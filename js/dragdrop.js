import { API } from './api.js';
import { categoryKey, readStoredCategories } from './categories.js';
import {
    UI,
    itemHasCategory,
    FREEFORM_DEFAULT_W,
    FREEFORM_DEFAULT_H,
    FREEFORM_MIN_W,
    FREEFORM_MIN_H
} from './ui.js';

export const DragDropEngine = {
    init(userState, currentItems, onMutationComplete) {
        if (!userState || !userState.isLoggedIn) return;

        const canvas = document.getElementById('app-canvas');
        if (!canvas) return;

        if (canvas.classList.contains('view-freeform')) {
            this.initFreeformInteractions(canvas, currentItems);
            return;
        }

        const cards = document.querySelectorAll('.mini-card');
        const columns = document.querySelectorAll('.canvas-column');
        const columnHeaders = document.querySelectorAll('.column-header');
        let draggedCategoryColumn = null;

        const readCategories = () => readStoredCategories();

        const persistCategoryOrderFromDom = () => {
            const categories = readCategories();
            const visibleOrder = [...document.querySelectorAll('.canvas-column')]
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

        const getCategoryInsertBefore = (clientX, clientY) => {
            const availableColumns = [...canvas.querySelectorAll('.canvas-column:not(.is-category-dragging)')];
            return availableColumns.reduce((closest, column) => {
                const box = column.getBoundingClientRect();
                const sameRow = clientY >= box.top - 8 && clientY <= box.bottom + 8;
                const offset = sameRow
                    ? clientX - box.left - box.width / 2
                    : clientY - box.top - box.height / 2;

                if (offset < 0 && offset > closest.offset) {
                    return { offset, column };
                }
                return closest;
            }, { offset: Number.NEGATIVE_INFINITY, column: null }).column;
        };

        columnHeaders.forEach(header => {
            header.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('application/x-category-name', header.dataset.category || '');
                e.dataTransfer.effectAllowed = 'move';
                draggedCategoryColumn = header.closest('.canvas-column');
                draggedCategoryColumn?.classList.add('is-category-dragging');
            });

            header.addEventListener('dragend', () => {
                document.querySelectorAll('.canvas-column').forEach(col => {
                    col.classList.remove('is-category-dragging', 'is-category-drop-target');
                });
                draggedCategoryColumn = null;
            });
        });

        if (canvas.classList.contains('view-columns')) {
            canvas.addEventListener('dragover', (e) => {
                if ([...e.dataTransfer.types].includes('application/x-category-name') && draggedCategoryColumn) {
                    e.preventDefault();
                    const insertBefore = getCategoryInsertBefore(e.clientX, e.clientY);
                    if (insertBefore) canvas.insertBefore(draggedCategoryColumn, insertBefore);
                    else canvas.appendChild(draggedCategoryColumn);
                    return;
                }

                if ([...e.dataTransfer.types].includes('text/plain') && !e.target.closest('.canvas-column')) {
                    e.preventDefault();
                }
            });

            canvas.addEventListener('drop', async (e) => {

                if ([...e.dataTransfer.types].includes('application/x-category-name')) {
                    e.preventDefault();
                    persistCategoryOrderFromDom();
                    return;
                }

                if (e.target.closest('.canvas-column')) return;

                const cardId = e.dataTransfer.getData('text/plain');
                if (!cardId) return;
                e.preventDefault();

                const itemMatch = currentItems.find(i => i.id === cardId);
                if (itemMatch && itemHasCategory(itemMatch)) {
                    itemMatch.categories = [];
                    const success = await API.saveItem(itemMatch, userState.token);
                    if (success && typeof onMutationComplete === 'function') {
                        await onMutationComplete();
                    }
                }
            });
        }

        cards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', card.dataset.id);
                card.style.opacity = '0.4';
            });

            card.addEventListener('dragend', () => {
                card.style.opacity = '1';
                columns.forEach(col => col.style.background = '');
            });
        });

        columns.forEach(column => {
            column.addEventListener('dragover', (e) => {
                e.preventDefault();
                if ([...e.dataTransfer.types].includes('application/x-category-name')) {
                    column.classList.add('is-category-drop-target');
                    return;
                }
                column.style.background = '#222227';
            });

            column.addEventListener('dragleave', () => {
                column.style.background = '';
                column.classList.remove('is-category-drop-target');
            });

            column.addEventListener('drop', async (e) => {
                e.preventDefault();
                column.style.background = '';
                column.classList.remove('is-category-drop-target');

                if (e.dataTransfer.getData('application/x-category-name')) return;

                const cardId = e.dataTransfer.getData('text/plain');
                const targetCategory = column.dataset.category;
                if (!cardId || !targetCategory) return;

                const itemMatch = currentItems.find(i => i.id === cardId);
                const currentCat = itemMatch?.categories?.[0] || '';
                if (itemMatch && currentCat !== targetCategory) {
                    itemMatch.categories = [targetCategory];
                    const success = await API.saveItem(itemMatch, userState.token);
                    if (success && typeof onMutationComplete === 'function') {
                        await onMutationComplete();
                    }
                }
            });
        });

    },

    initFreeformInteractions(canvas, currentItems = []) {
        const cards = canvas.querySelectorAll('.mini-card');
        let dragActive = null;
        let resizeActive = null;
        const dragThreshold = 4;

        const clampSize = (w, h) => ({
            w: Math.max(FREEFORM_MIN_W, w),
            h: Math.max(FREEFORM_MIN_H, h)
        });

        const onDragMove = (e) => {
            if (!dragActive) return;
            const dx = e.clientX - dragActive.startX;
            const dy = e.clientY - dragActive.startY;
            if (!dragActive.moved && (Math.abs(dx) > dragThreshold || Math.abs(dy) > dragThreshold)) {
                dragActive.moved = true;
            }
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
            const { card, axis, startX, startY, origX, origY, origW, origH } = resizeActive;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

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
                    e.preventDefault();
                    e.stopPropagation();
                    const { w: startW, h: startH } = UI.readFreeformCardSize(card);
                    if (card.classList.contains('compact')) {
                        const itemMatch = currentItems.find(i => i.id === card.dataset.id);
                        if (itemMatch) {
                            UI.updateFreeformCard(card, itemMatch, {
                                expanded: true,
                                dimensions: { w: startW, h: startH }
                            });
                        }
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

                if (e.target.closest('.card-actions, .step-check, .step-delete-btn, .quicklink-anchor-row, .card-inline-edit, .step-nest-controls, .expanded-checklist, .card-content-preview, .ff-resize, a, button, input, textarea, [contenteditable]')) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();
                dragActive = {
                    card,
                    startX: e.clientX,
                    startY: e.clientY,
                    origX: parseFloat(card.style.left) || 0,
                    origY: parseFloat(card.style.top) || 0,
                    moved: false
                };
                card.classList.add('is-freeform-dragging');
                document.addEventListener('mousemove', onDragMove);
                document.addEventListener('mouseup', onDragUp);
            });
        });
    }
};
