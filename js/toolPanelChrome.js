// js/toolPanelChrome.js — floating desktop tool panels (drag, resize, collapse chip)
import { raiseDesktopElement } from './desktopStack.js';
import { CARD_ICONS } from './ui.js';

const STORAGE_KEY = 'magiclists_tool_panels';

const GENERIC_TOOL_ICON =
    '<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" fill="none" stroke="currentColor" stroke-width="0.95"/>' +
    '<path d="M4.5 6h3" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>';

export function renderToolIcon(markup, size = 12) {
    const body = (markup || '').trim() || GENERIC_TOOL_ICON;
    if (body.startsWith('<svg')) {
        return body.replace(/\bwidth="[^"]*"/, `width="${size}"`).replace(/\bheight="[^"]*"/, `height="${size}"`);
    }
    return `<svg viewBox="0 0 12 12" width="${size}" height="${size}" focusable="false" aria-hidden="true">${body}</svg>`;
}

function loadAllPanelState() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function savePanelState(toolId, patch) {
    const all = loadAllPanelState();
    all[toolId] = { ...(all[toolId] || {}), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function removePanelState(toolId) {
    const all = loadAllPanelState();
    delete all[toolId];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getDesktopSurface() {
    return document.getElementById('desktop-surface');
}

function getDesktopZoom() {
    const surface = getDesktopSurface();
    const canvas = document.getElementById('app-canvas');
    const raw = parseFloat(surface?.dataset?.desktopZoom ?? canvas?.dataset?.desktopZoom);
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

function pointerDelta(clientX, clientY, startX, startY) {
    const zoom = getDesktopZoom();
    return {
        dx: (clientX - startX) / zoom,
        dy: (clientY - startY) / zoom
    };
}

function getDesktopBounds() {
    const surface = getDesktopSurface();
    if (surface) {
        return {
            left: 0,
            top: 0,
            right: surface.clientWidth,
            bottom: surface.clientHeight
        };
    }
    const sidePanel = document.getElementById('side-panel');
    let left = 0;
    if (sidePanel && !sidePanel.classList.contains('is-collapsed')) {
        left = sidePanel.getBoundingClientRect().right;
    }
    return {
        left,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight
    };
}

function clampPosition(el, x, y) {
    const bounds = getDesktopBounds();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    return {
        x: clamp(x, bounds.left, Math.max(bounds.left, bounds.right - w)),
        y: clamp(y, bounds.top, Math.max(bounds.top, bounds.bottom - h))
    };
}

function loadSavedCoord(value, min, max, size, fallback) {
    if (!Number.isFinite(value)) return fallback;
    if (value < min || value + size > max) return fallback;
    return value;
}

function chipAnchorFromPanel(panel, chip) {
    const chipW = chip?.offsetWidth || 44;
    const chipH = chip?.offsetHeight || 44;
    return {
        x: panel.offsetLeft + panel.offsetWidth - chipW - 4,
        y: panel.offsetTop + 4
    };
}

function bringToFront(el) {
    if (!el) return;
    raiseDesktopElement(el);
    const desktop = el.closest('#tools-desktop');
    desktop?.querySelectorAll('.is-desktop-front').forEach((other) => {
        if (other !== el) other.classList.remove('is-desktop-front');
    });
    el.classList.add('is-desktop-front');
}

function defaultSizeFor(meta) {
    if (meta?.defaultSize?.w) {
        return {
            w: meta.defaultSize.w,
            h: meta.defaultSize.h ?? null
        };
    }
    if (meta?.wide) return { w: 720, h: 560 };
    return { w: 340, h: 380 };
}

function minSizeFor(meta) {
    return {
        w: meta?.minSize?.w || 240,
        h: meta?.minSize?.h || 160
    };
}

export function createToolPanel(toolId, meta, desktop, callbacks = {}) {
    const saved = loadAllPanelState()[toolId] || {};
    const defaults = defaultSizeFor(meta);
    const mins = minSizeFor(meta);

    const panel = document.createElement('div');
    panel.className = `tool-panel tool-panel--${toolId}`;
    if (meta?.mountClass) panel.classList.add(meta.mountClass.replace('tool-mount--', 'tool-panel--'));
    panel.dataset.toolId = toolId;

    const w = saved.w || defaults.w;
    let h = saved.h ?? defaults.h;
    if (!defaults.h && !saved.manuallySized) {
        h = null;
    }
    const bounds = getDesktopBounds();
    const defaultX = bounds.left + Math.max(16, (bounds.right - bounds.left - w) / 2);
    const defaultY = Math.max(16, (bounds.bottom - (h || 300)) / 3);
    const estH = h || 300;
    const x = loadSavedCoord(saved.x, bounds.left, bounds.right, w, defaultX);
    const y = loadSavedCoord(saved.y, bounds.top, bounds.bottom, estH, defaultY);
    const initialPos = clampPosition({ offsetWidth: w, offsetHeight: estH }, x, y);

    panel.style.width = `${w}px`;
    if (h) panel.style.height = `${h}px`;
    else panel.classList.add('tool-panel--auto-height');
    panel.style.left = `${initialPos.x}px`;
    panel.style.top = `${initialPos.y}px`;

    const iconMarkup = renderToolIcon(meta?.icon);

    panel.innerHTML = `
        <div class="tool-panel__header">
            <span class="tool-panel__icon menu-tool-icon">${iconMarkup}</span>
            <span class="tool-panel__title"></span>
            <span class="tool-panel__spacer"></span>
            <div class="tool-panel__actions">
                <button type="button" class="card-act card-act--collapse" title="Collapse" aria-label="Collapse"></button>
                <button type="button" class="card-act card-act--close" title="Remove from desktop" aria-label="Remove from desktop"></button>
            </div>
        </div>
        <div class="tool-panel__body"></div>
        ${meta?.resizable ? `
            <div class="tool-panel__resize-e" data-resize-axis="e" aria-hidden="true"></div>
            <div class="tool-panel__resize-s" data-resize-axis="s" aria-hidden="true"></div>
            <div class="tool-panel__resize-se" data-resize-axis="se" aria-hidden="true"></div>
        ` : ''}
    `;

    const titleEl = panel.querySelector('.tool-panel__title');
    if (titleEl) titleEl.textContent = meta?.label || toolId;

    const collapseBtn = panel.querySelector('.card-act--collapse');
    const closeBtn = panel.querySelector('.card-act--close');
    collapseBtn.innerHTML = CARD_ICONS.collapse;
    closeBtn.innerHTML = CARD_ICONS.close;

    const bodyEl = panel.querySelector('.tool-panel__body');
    if (meta?.mountClass) bodyEl.classList.add(meta.mountClass);

    let chip = null;
    let collapsed = !!saved.collapsed;

    const persist = (extra = {}) => {
        savePanelState(toolId, {
            x: panel.offsetLeft,
            y: panel.offsetTop,
            w: panel.offsetWidth,
            h: panel.offsetHeight,
            collapsed,
            ...extra
        });
    };

    const positionChip = (anchorToPanel = false) => {
        if (!chip) return;
        const desktopBounds = getDesktopBounds();
        const chipW = chip.offsetWidth || 44;
        const chipH = chip.offsetHeight || 44;
        const panelAnchor = chipAnchorFromPanel(panel, chip);
        const fallbackX = panelAnchor.x;
        const fallbackY = panelAnchor.y;

        let chipX;
        let chipY;
        if (anchorToPanel) {
            chipX = fallbackX;
            chipY = fallbackY;
        } else {
            chipX = loadSavedCoord(saved.chipX, desktopBounds.left, desktopBounds.right, chipW, fallbackX);
            chipY = loadSavedCoord(saved.chipY, desktopBounds.top, desktopBounds.bottom, chipH, fallbackY);
        }

        const chipPos = clampPosition(chip, chipX, chipY);
        chip.style.left = `${chipPos.x}px`;
        chip.style.top = `${chipPos.y}px`;
    };

    const createChip = () => {
        if (chip) return;

        chip = document.createElement('div');
        chip.className = 'tool-chip';
        chip.dataset.toolId = toolId;
        chip.title = meta?.label || toolId;
        const chipIconMarkup = renderToolIcon(meta?.icon, 16);
        chip.innerHTML = `
            <div class="tool-chip__drag" title="Drag ${meta?.label || toolId}">
                <span class="tool-chip__icon menu-tool-icon">${chipIconMarkup}</span>
            </div>
            <div class="tool-chip__actions">
                <button type="button" class="card-act card-act--expand tool-chip__expand" title="Expand" aria-label="Expand"></button>
                <button type="button" class="card-act card-act--close tool-chip__close" title="Remove from desktop" aria-label="Remove from desktop"></button>
            </div>
        `;
        chip.querySelector('.tool-chip__expand').innerHTML = CARD_ICONS.expand;
        chip.querySelector('.tool-chip__close').innerHTML = CARD_ICONS.close;

        desktop.appendChild(chip);

        chip.addEventListener('pointerdown', (e) => {
            if (e.target.closest('.card-act, .tool-chip__actions')) return;
            bringToFront(chip);
        });

        chip.querySelector('.tool-chip__expand').addEventListener('click', (e) => {
            e.stopPropagation();
            expand();
        });

        chip.querySelector('.tool-chip__close').addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.onDismiss?.();
        });

        bindChipDrag(chip.querySelector('.tool-chip__drag'), chip, () => {
            savePanelState(toolId, { chipX: chip.offsetLeft, chipY: chip.offsetTop });
        });
    };

    const collapse = () => {
        collapsed = true;
        if (!chip) createChip();
        positionChip(true);
        panel.classList.add('is-hidden');
        chip.classList.remove('is-hidden');
        bringToFront(chip);
        persist({
            chipX: chip.offsetLeft,
            chipY: chip.offsetTop
        });
        callbacks.onCollapse?.();
    };

    const expand = () => {
        collapsed = false;
        panel.classList.remove('is-hidden');
        if (chip) chip.classList.add('is-hidden');
        bringToFront(panel);
        persist();
        callbacks.onExpand?.();
        callbacks.onResize?.(bodyEl);
    };

    const show = () => {
        desktop.appendChild(panel);
        if (collapsed) {
            panel.classList.add('is-hidden');
            createChip();
            positionChip(false);
            chip.classList.remove('is-hidden');
            bringToFront(chip);
        } else {
            panel.classList.remove('is-hidden');
            bringToFront(panel);
        }
    };

    const destroy = () => {
        panel.remove();
        chip?.remove();
        removePanelState(toolId);
    };

    collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        collapse();
    });

    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        callbacks.onDismiss?.();
    });

    bindPanelDrag(panel, persist);
    if (meta?.resizable) {
        bindPanelResize(
            panel,
            mins,
            () => persist({ manuallySized: true }),
            () => callbacks.onResize?.(bodyEl)
        );
    }

    panel.addEventListener('pointerdown', () => bringToFront(panel));

    const onViewportChange = () => {
        const pos = clampPosition(panel, panel.offsetLeft, panel.offsetTop);
        panel.style.left = `${pos.x}px`;
        panel.style.top = `${pos.y}px`;
        if (chip && !chip.classList.contains('is-hidden')) {
            const cpos = clampPosition(chip, chip.offsetLeft, chip.offsetTop);
            chip.style.left = `${cpos.x}px`;
            chip.style.top = `${cpos.y}px`;
        }
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('tools:desktop_bounds_changed', onViewportChange);
    window.addEventListener('desktop:zoom_changed', onViewportChange);

    const originalDestroy = destroy;
    const destroyWithCleanup = () => {
        window.removeEventListener('resize', onViewportChange);
        window.removeEventListener('tools:desktop_bounds_changed', onViewportChange);
        window.removeEventListener('desktop:zoom_changed', onViewportChange);
        originalDestroy();
    };

    return {
        panel,
        bodyEl,
        show,
        collapse,
        expand,
        destroy: destroyWithCleanup,
        persist,
        isCollapsed: () => collapsed,
        focus: () => {
            if (collapsed) expand();
            else bringToFront(panel);
        }
    };
}

function bindPanelDrag(panel, onEnd) {
    const header = panel.querySelector('.tool-panel__header');
    if (!header) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    header.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.card-act, .tool-panel__actions')) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = panel.offsetLeft;
        originTop = panel.offsetTop;
        header.setPointerCapture(e.pointerId);
        panel.classList.add('is-dragging');
        bringToFront(panel);
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const { dx, dy } = pointerDelta(e.clientX, e.clientY, startX, startY);
        const pos = clampPosition(panel, originLeft + dx, originTop + dy);
        panel.style.left = `${pos.x}px`;
        panel.style.top = `${pos.y}px`;
    });

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        panel.classList.remove('is-dragging');
        try {
            header.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        onEnd?.();
    };

    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);
}

function bindChipDrag(dragHandle, chipEl, onEnd) {
    if (!dragHandle || !chipEl) return;

    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    dragHandle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = chipEl.offsetLeft;
        originTop = chipEl.offsetTop;
        dragHandle.setPointerCapture(e.pointerId);
        chipEl.classList.add('is-dragging');
        bringToFront(chipEl);
    });

    dragHandle.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const { dx, dy } = pointerDelta(e.clientX, e.clientY, startX, startY);
        const pos = clampPosition(chipEl, originLeft + dx, originTop + dy);
        chipEl.style.left = `${pos.x}px`;
        chipEl.style.top = `${pos.y}px`;
    });

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        chipEl.classList.remove('is-dragging');
        try {
            dragHandle.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        onEnd?.();
    };

    dragHandle.addEventListener('pointerup', endDrag);
    dragHandle.addEventListener('pointercancel', endDrag);
}

function bindPanelResize(panel, mins, onEnd, onResize) {
    const handles = panel.querySelectorAll('[data-resize-axis]');
    if (!handles.length) return;

    let resizing = false;
    let activeHandle = null;
    let axis = 'se';
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    const lockPanelDimensions = () => {
        panel.classList.remove('tool-panel--auto-height');
        panel.style.width = `${panel.offsetWidth}px`;
        panel.style.height = `${panel.offsetHeight}px`;
    };

    const applyResize = (dx, dy) => {
        const desktop = getDesktopBounds();
        const maxW = desktop.right - panel.offsetLeft - 8;
        const maxH = desktop.bottom - panel.offsetTop - 8;
        if (axis === 'e' || axis === 'se') {
            panel.style.width = `${clamp(startW + dx, mins.w, maxW)}px`;
        }
        if (axis === 's' || axis === 'se') {
            panel.style.height = `${clamp(startH + dy, mins.h, maxH)}px`;
        }
        onResize?.();
    };

    const endResize = (e) => {
        if (!resizing) return;
        resizing = false;
        panel.classList.remove('is-resizing');
        try {
            activeHandle?.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        activeHandle = null;
        onEnd?.();
        onResize?.();
    };

    handles.forEach((handle) => {
        handle.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            lockPanelDimensions();
            resizing = true;
            axis = handle.dataset.resizeAxis || 'se';
            activeHandle = handle;
            startX = e.clientX;
            startY = e.clientY;
            startW = panel.offsetWidth;
            startH = panel.offsetHeight;
            handle.setPointerCapture(e.pointerId);
            panel.classList.add('is-resizing');
            bringToFront(panel);
        });

        handle.addEventListener('pointermove', (e) => {
            if (!resizing || activeHandle !== handle) return;
            const { dx, dy } = pointerDelta(e.clientX, e.clientY, startX, startY);
            applyResize(dx, dy);
        });

        handle.addEventListener('pointerup', endResize);
        handle.addEventListener('pointercancel', endResize);
    });
}

export function getPersistedOpenToolIds() {
    return Object.keys(loadAllPanelState()).filter((id) => {
        const s = loadAllPanelState()[id];
        return s && !s.dismissed;
    });
}
