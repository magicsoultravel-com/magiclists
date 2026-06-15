import { CARD_ICONS } from './icons.js';

const STORAGE_KEY = 'matrix_drawing_toolbar';

function loadState() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveState(patch) {
    const next = { ...loadState(), ...patch };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getDesktopZoom() {
    const surface = document.getElementById('desktop-surface');
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
    const surface = document.getElementById('desktop-surface');
    if (surface) {
        return { left: 0, top: 0, right: surface.clientWidth, bottom: surface.clientHeight };
    }
    const sidePanel = document.getElementById('side-panel');
    let left = 0;
    if (sidePanel && !sidePanel.classList.contains('is-collapsed')) {
        left = sidePanel.getBoundingClientRect().right;
    }
    return { left, top: 0, right: window.innerWidth, bottom: window.innerHeight };
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

function bindDrag(handle, el, onEnd) {
    if (!handle || !el) return;
    handle.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const originLeft = el.offsetLeft;
        const originTop = el.offsetTop;
        handle.setPointerCapture?.(e.pointerId);

        const onMove = (ev) => {
            const { dx, dy } = pointerDelta(ev.clientX, ev.clientY, startX, startY);
            const pos = clampPosition(el, originLeft + dx, originTop + dy);
            el.style.left = `${pos.x}px`;
            el.style.top = `${pos.y}px`;
        };

        const onUp = () => {
            handle.releasePointerCapture?.(e.pointerId);
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            onEnd?.();
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    });
}

export const DrawingToolbarChrome = {
    panel: null,
    chip: null,
    bodyEl: null,
    collapsed: false,
    onCollapse: null,
    onExpand: null,

    init() {
        this.panel = document.getElementById('drawing-toolbar-panel');
        this.chip = document.getElementById('drawing-toolbar-chip');
        this.bodyEl = document.getElementById('drawing-control-actions');
        if (!this.panel || !this.chip || !this.bodyEl) return;

        const collapseBtn = document.getElementById('draw-panel-collapse');
        const expandBtn = document.getElementById('draw-panel-expand');
        collapseBtn.innerHTML = CARD_ICONS.collapse;
        expandBtn.innerHTML = CARD_ICONS.expand;

        collapseBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.collapse();
        });
        expandBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.expand();
        });

        bindDrag(this.panel.querySelector('[data-draw-toolbar-drag]'), this.panel, () => {
            saveState({ x: this.panel.offsetLeft, y: this.panel.offsetTop, collapsed: this.collapsed });
        });
        bindDrag(this.chip.querySelector('[data-draw-chip-drag]'), this.chip, () => {
            saveState({ chipX: this.chip.offsetLeft, chipY: this.chip.offsetTop, collapsed: this.collapsed });
        });

        window.addEventListener('resize', () => {
            if (!this.panel || this.panel.classList.contains('is-hidden')) return;
            if (this.collapsed) this.positionChip(false);
            else {
                const pos = clampPosition(this.panel, this.panel.offsetLeft, this.panel.offsetTop);
                this.panel.style.left = `${pos.x}px`;
                this.panel.style.top = `${pos.y}px`;
            }
        });
    },

    show() {
        if (!this.panel || !this.chip) return;
        const saved = loadState();
        this.collapsed = saved.collapsed === true;

        const bounds = getDesktopBounds();
        const defaultX = bounds.left + 12;
        const defaultY = 12;
        const x = loadSavedCoord(saved.x, bounds.left, bounds.right, 280, defaultX);
        const y = loadSavedCoord(saved.y, bounds.top, bounds.bottom, 48, defaultY);

        this.panel.classList.remove('is-hidden');
        this.panel.style.left = `${x}px`;
        this.panel.style.top = `${y}px`;

        if (this.collapsed) {
            this.panel.classList.add('is-collapsed');
            this.positionChip(false);
            this.chip.classList.remove('is-hidden');
        } else {
            this.panel.classList.remove('is-collapsed');
            this.chip.classList.add('is-hidden');
            const pos = clampPosition(this.panel, x, y);
            this.panel.style.left = `${pos.x}px`;
            this.panel.style.top = `${pos.y}px`;
        }
    },

    hide() {
        this.panel?.classList.add('is-hidden');
        this.chip?.classList.add('is-hidden');
    },

    positionChip(anchorToPanel = false) {
        if (!this.chip || !this.panel) return;
        const bounds = getDesktopBounds();
        const chipW = this.chip.offsetWidth || 44;
        const chipH = this.chip.offsetHeight || 44;
        const saved = loadState();

        let chipX;
        let chipY;
        if (anchorToPanel) {
            chipX = this.panel.offsetLeft + this.panel.offsetWidth - chipW - 4;
            chipY = this.panel.offsetTop + 4;
        } else {
            const fallbackX = this.panel.offsetLeft + this.panel.offsetWidth - chipW - 4;
            const fallbackY = this.panel.offsetTop + 4;
            chipX = loadSavedCoord(saved.chipX, bounds.left, bounds.right, chipW, fallbackX);
            chipY = loadSavedCoord(saved.chipY, bounds.top, bounds.bottom, chipH, fallbackY);
        }

        const pos = clampPosition(this.chip, chipX, chipY);
        this.chip.style.left = `${pos.x}px`;
        this.chip.style.top = `${pos.y}px`;
    },

    collapse() {
        if (!this.panel || !this.chip) return;
        this.collapsed = true;
        this.panel.classList.add('is-collapsed');
        this.positionChip(true);
        this.chip.classList.remove('is-hidden');
        saveState({
            x: this.panel.offsetLeft,
            y: this.panel.offsetTop,
            chipX: this.chip.offsetLeft,
            chipY: this.chip.offsetTop,
            collapsed: true
        });
        this.onCollapse?.();
    },

    expand() {
        if (!this.panel || !this.chip) return;
        this.collapsed = false;
        this.panel.classList.remove('is-collapsed');
        this.chip.classList.add('is-hidden');
        const pos = clampPosition(this.panel, this.panel.offsetLeft, this.panel.offsetTop);
        this.panel.style.left = `${pos.x}px`;
        this.panel.style.top = `${pos.y}px`;
        saveState({
            x: pos.x,
            y: pos.y,
            collapsed: false
        });
        this.onExpand?.();
    },

    getToolbarMount() {
        return this.bodyEl;
    }
};
