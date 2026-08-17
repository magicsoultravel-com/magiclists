/** Position a fixed popover below its anchor, right-aligned, flipping above if needed. */
import { raiseDesktopElement } from './desktopStack.js';
import { getAppWindowForElement } from './appDocuments.js';

function viewportSizeFor(anchor) {
    const win = anchor ? getAppWindowForElement(anchor) : window;
    return { width: win.innerWidth, height: win.innerHeight };
}

export function positionPopoverBelowAnchor(popover, anchor, { gap = 8, margin = 8 } = {}) {
    if (!popover || !anchor) return;

    const rect = anchor.getBoundingClientRect();
    const popRect = popover.getBoundingClientRect();
    const viewport = viewportSizeFor(anchor);

    let top = rect.bottom + gap;
    let left = rect.right - popRect.width;

    left = Math.max(margin, Math.min(left, viewport.width - popRect.width - margin));
    if (top + popRect.height > viewport.height - margin) {
        top = rect.top - popRect.height - gap;
    }
    top = Math.max(margin, top);

    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
}

/** Position a fixed panel below an anchor element, left-aligned to it. */
export function positionPanelBelowElement(panel, anchorEl, { gap = 8, margin = 8 } = {}) {
    if (!panel || !anchorEl) return;

    const rect = anchorEl.getBoundingClientRect();
    const panelW = panel.offsetWidth;
    const panelH = panel.offsetHeight;
    const viewport = viewportSizeFor(anchorEl);

    let left = rect.left;
    let top = rect.bottom + gap;

    left = Math.max(margin, Math.min(left, viewport.width - panelW - margin));
    if (top + panelH > viewport.height - margin) {
        top = Math.max(margin, rect.top - panelH - gap);
    } else {
        top = Math.max(margin, top);
    }

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
}

/** @deprecated use positionPanelBelowElement for radio browser */
export function positionPanelBesideSidebar(panel, anchor, { gap = 8, margin = 8 } = {}) {
    if (!panel) return;

    const sidePanel = document.getElementById('side-panel');
    const sideRect = sidePanel?.getBoundingClientRect();
    const anchorRect = anchor?.getBoundingClientRect();
    const popRect = panel.getBoundingClientRect();
    const panelW = panel.offsetWidth || popRect.width;
    const panelH = panel.offsetHeight || popRect.height;

    let left;
    if (sidePanel && !sidePanel.classList.contains('is-collapsed') && sideRect) {
        left = sideRect.right + gap;
    } else if (anchorRect) {
        left = anchorRect.right + gap;
    } else {
        left = margin;
    }

    let top = anchorRect ? anchorRect.top - 12 : margin;
    top = Math.max(margin, Math.min(top, window.innerHeight - panelH - margin));
    left = Math.max(margin, Math.min(left, window.innerWidth - panelW - margin));

    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
}

export function clampPanelToViewport(panel, x, y, { margin = 8 } = {}) {
    const w = panel.offsetWidth;
    const h = panel.offsetHeight;
    const win = panel?.ownerDocument?.defaultView || window;
    return {
        x: Math.max(margin, Math.min(x, win.innerWidth - w - margin)),
        y: Math.max(margin, Math.min(y, win.innerHeight - h - margin))
    };
}

export function raiseUndockedAttachStack(attachEl, panel) {
    if (!attachEl?.classList.contains('sidebar-module--undocked')) return;
    raiseDesktopElement(attachEl);
    raiseDesktopElement(panel);
}
