/** Position a fixed popover below its anchor, right-aligned, flipping above if needed. */
export function positionPopoverBelowAnchor(popover, anchor, { gap = 8, margin = 8 } = {}) {
    if (!popover || !anchor) return;

    const rect = anchor.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();

    let top = rect.bottom + gap;
    let left = rect.right - popRect.width;

    left = Math.max(margin, Math.min(left, window.innerWidth - popRect.width - margin));
    if (top + popRect.height > window.innerHeight - margin) {
        top = rect.top - popRect.height - gap;
    }
    top = Math.max(margin, top);

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
}
