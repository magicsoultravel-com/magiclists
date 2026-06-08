// js/toolPanelChrome.js — floating desktop tool panels (drag, resize, collapse chip)
import { CARD_ICONS } from './ui.js';

const STORAGE_KEY = 'magiclists_tool_panels';
const BASE_Z = 320;

const GENERIC_TOOL_ICON =
    '<rect x="2.2" y="2.2" width="7.6" height="7.6" rx="1" fill="none" stroke="currentColor" stroke-width="0.95"/>' +
    '<path d="M4.5 6h3" fill="none" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/>';

export function renderToolIcon(markup) {
    const body = (markup || '').trim() || GENERIC_TOOL_ICON;
    if (body.startsWith('<svg')) return body;
    return `<svg viewBox="0 0 12 12" width="12" height="12" focusable="false" aria-hidden="true">${body}</svg>`;
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

let zStack = 0;

export function bringToFront(el) {
    if (!el) return;
    zStack += 1;
    el.style.zIndex = String(BASE_Z + zStack);
}

function defaultSizeFor(meta) {
    if (meta?.defaultSize?.w) {
        return {
            w: meta.defaultSize.w,
            h: meta.defaultSize.h || 400
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
    const h = saved.h || defaults.h;
    const x = saved.x ?? Math.max(16, (window.innerWidth - w) / 2);
    const y = saved.y ?? Math.max(16, (window.innerHeight - h) / 3);

    panel.style.width = `${w}px`;
    if (h && h !== 'auto') panel.style.height = `${h}px`;
    panel.style.left = `${x}px`;
    panel.style.top = `${y}px`;

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
        ${meta?.resizable ? '<div class="tool-panel__resize-se ff-resize ff-resize-se" aria-hidden="true"></div>' : ''}
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

    const persist = () => {
        const rect = panel.getBoundingClientRect();
        savePanelState(toolId, {
            x: rect.left,
            y: rect.top,
            w: panel.offsetWidth,
            h: panel.offsetHeight,
            collapsed
        });
    };

    const createChip = () => {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tool-chip';
        chip.dataset.toolId = toolId;
        chip.title = meta?.label || toolId;
        chip.setAttribute('aria-label', `${meta?.label || toolId} — expand`);
        chip.innerHTML = `
            <span class="tool-chip__icon menu-tool-icon">${iconMarkup}</span>
            <span class="tool-chip__close card-act card-act--close" role="button" tabindex="0" title="Remove from desktop" aria-label="Remove from desktop"></span>
        `;
        chip.querySelector('.tool-chip__close').innerHTML = CARD_ICONS.close;

        const chipX = saved.chipX ?? saved.x ?? 24;
        const chipY = saved.chipY ?? saved.y ?? window.innerHeight - 80;
        chip.style.left = `${chipX}px`;
        chip.style.top = `${chipY}px`;

        desktop.appendChild(chip);
        bringToFront(chip);

        chip.addEventListener('click', (e) => {
            if (e.target.closest('.tool-chip__close')) return;
            expand();
        });

        const chipClose = chip.querySelector('.tool-chip__close');
        chipClose.addEventListener('click', (e) => {
            e.stopPropagation();
            callbacks.onDismiss?.();
        });
        chipClose.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                callbacks.onDismiss?.();
            }
        });

        bindChipDrag(chip, () => {
            const r = chip.getBoundingClientRect();
            savePanelState(toolId, { chipX: r.left, chipY: r.top });
        });
    };

    const collapse = () => {
        collapsed = true;
        panel.classList.add('is-hidden');
        if (!chip) createChip();
        chip.classList.remove('is-hidden');
        persist();
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
        bringToFront(panel);
        if (collapsed) {
            panel.classList.add('is-hidden');
            createChip();
        } else {
            panel.classList.remove('is-hidden');
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
        bindPanelResize(panel, mins, persist, () => callbacks.onResize?.(bodyEl));
    }

    panel.addEventListener('pointerdown', () => bringToFront(panel));

    return {
        panel,
        bodyEl,
        show,
        collapse,
        expand,
        destroy,
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
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const maxX = window.innerWidth - panel.offsetWidth;
        const maxY = window.innerHeight - 40;
        panel.style.left = `${clamp(originLeft + dx, 0, Math.max(0, maxX))}px`;
        panel.style.top = `${clamp(originTop + dy, 0, Math.max(0, maxY))}px`;
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

function bindChipDrag(chip, onEnd) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    chip.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.tool-chip__close')) return;
        if (e.button !== 0) return;
        e.preventDefault();
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        originLeft = chip.offsetLeft;
        originTop = chip.offsetTop;
        chip.setPointerCapture(e.pointerId);
        chip.classList.add('is-dragging');
        bringToFront(chip);
    });

    chip.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        const size = chip.offsetWidth;
        chip.style.left = `${clamp(originLeft + dx, 0, window.innerWidth - size)}px`;
        chip.style.top = `${clamp(originTop + dy, 0, window.innerHeight - size)}px`;
    });

    const endDrag = (e) => {
        if (!dragging) return;
        dragging = false;
        chip.classList.remove('is-dragging');
        try {
            chip.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        onEnd?.();
    };

    chip.addEventListener('pointerup', endDrag);
    chip.addEventListener('pointercancel', endDrag);
}

function bindPanelResize(panel, mins, onEnd, onResize) {
    const handle = panel.querySelector('.tool-panel__resize-se');
    if (!handle) return;

    let resizing = false;
    let startX = 0;
    let startY = 0;
    let startW = 0;
    let startH = 0;

    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        resizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = panel.offsetWidth;
        startH = panel.offsetHeight;
        handle.setPointerCapture(e.pointerId);
        panel.classList.add('is-resizing');
        bringToFront(panel);
    });

    handle.addEventListener('pointermove', (e) => {
        if (!resizing) return;
        const maxW = window.innerWidth - panel.offsetLeft - 8;
        const maxH = window.innerHeight - panel.offsetTop - 8;
        panel.style.width = `${clamp(startW + (e.clientX - startX), mins.w, maxW)}px`;
        panel.style.height = `${clamp(startH + (e.clientY - startY), mins.h, maxH)}px`;
        onResize?.();
    });

    const endResize = (e) => {
        if (!resizing) return;
        resizing = false;
        panel.classList.remove('is-resizing');
        try {
            handle.releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        onEnd?.();
        onResize?.();
    };

    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);
}

export function getPersistedOpenToolIds() {
    return Object.keys(loadAllPanelState()).filter((id) => {
        const s = loadAllPanelState()[id];
        return s && !s.dismissed;
    });
}
