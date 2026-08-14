/** @module Shared desktop dock drop-target helpers for board and FC drags. */

/**
 * Find dock buttons at a given coordinate.
 * @param {number} x
 * @param {number} y
 * @returns {Element[]}
 */
export function getDockButtonAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    return document.elementsFromPoint(x, y)
        .filter(el => el instanceof Element && el.classList.contains('desktop-dock-btn'));
}

/** Toggle drag-over highlight on desktop dock buttons under the pointer. */
export function setDesktopDockDragHighlight(clientX, clientY) {
    const hoveredButtons = getDockButtonAt(clientX, clientY);
    document.querySelectorAll('.desktop-dock-btn').forEach((btn) => {
        btn.classList.toggle('drag-over', hoveredButtons.includes(btn));
    });
    return hoveredButtons;
}

/** Remove drag-over highlight from all desktop dock buttons. */
export function clearDesktopDockDragHighlight() {
    document.querySelectorAll('.desktop-dock-btn.drag-over').forEach((btn) => {
        btn.classList.remove('drag-over');
    });
}
