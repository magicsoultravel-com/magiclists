import {
    CHIP_ENTER_MS,
    CHIP_MOTION_EASING,
    CHIP_MOTION_MS,
    canAnimateElement,
    chipOriginForPanel,
    chipScaleForPanel,
    resolveExpandedPanelOrigin
} from './chipMotion.js';
import { CARD_ICONS } from './icons.js';

const STORAGE_KEY_DEFAULT = 'matrix_drawing_toolbar';

let activeStorageKey = STORAGE_KEY_DEFAULT;
let hostBoundsEl = null;
let chipMotion = null;
let chipEnterMotion = null;

function cancelChipMotion() {
    chipMotion?.cancel();
    chipMotion = null;
    chipEnterMotion?.cancel();
    chipEnterMotion = null;
}

/** Drop the inline styles the collapse/expand morph leaves behind. */
function resetPanelMotion(panel) {
    if (!panel) return;
    panel.style.visibility = '';
    panel.style.transform = '';
    panel.style.transformOrigin = '';
    panel.style.opacity = '';
    panel.style.pointerEvents = '';
}

/** Short pop from 72% once the panel has shrunk onto the token's rect. */
function animateChipIn(chip) {
    if (!chip) return;
    if (!canAnimateElement(chip)) {
        chip.style.opacity = '';
        return;
    }
    chipEnterMotion = chip.animate(
        [
            { transform: 'scale(0.72)', opacity: 0 },
            { transform: 'scale(1)', opacity: 1 }
        ],
        { duration: CHIP_ENTER_MS, easing: CHIP_MOTION_EASING }
    );
    chipEnterMotion.addEventListener(
        'finish',
        () => {
            chipEnterMotion?.cancel();
            chipEnterMotion = null;
            chip.style.opacity = '';
        },
        { once: true }
    );
}

function loadState() {
    try {
        return JSON.parse(localStorage.getItem(activeStorageKey) || '{}');
    } catch {
        return {};
    }
}

function saveState(patch) {
    const next = { ...loadState(), ...patch };
    localStorage.setItem(activeStorageKey, JSON.stringify(next));
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function getDesktopZoom() {
    // Focus-hosted toolbar is never under desktop zoom.
    if (hostBoundsEl) return 1;
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
    if (hostBoundsEl) {
        return {
            left: 0,
            top: 0,
            right: hostBoundsEl.clientWidth || 0,
            bottom: hostBoundsEl.clientHeight || 0
        };
    }
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
        // Let toolbar buttons / inputs receive clicks (toggles live in the header).
        if (e.target.closest('button, a, input, select, textarea, [data-no-drag]')) return;
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
            this.expand({ restoreFocus: e.detail === 0 });
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
        cancelChipMotion();
        resetPanelMotion(this.panel);
        if (this.chip) {
            this.chip.style.opacity = '';
            this.chip.style.pointerEvents = '';
        }

        const saved = loadState();
        // Focus host: default collapsed unless user has expanded before in this storage key.
        if (hostBoundsEl && saved.collapsed == null && this._forceDefaultCollapsed) {
            this.collapsed = true;
        } else {
            this.collapsed = saved.collapsed === true;
        }

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
        cancelChipMotion();
        resetPanelMotion(this.panel);
        this.panel?.classList.add('is-hidden');
        this.chip?.classList.add('is-hidden');
        if (this.chip) {
            this.chip.style.opacity = '';
            this.chip.style.pointerEvents = '';
        }
    },

    positionChip(anchorToPanel = false) {
        if (!this.chip || !this.panel) return;
        const bounds = getDesktopBounds();
        const fallback = chipOriginForPanel(this.panel.offsetLeft, this.panel.offsetTop);
        const chipW = this.chip.offsetWidth || 44;
        const chipH = this.chip.offsetHeight || 44;

        let chipX = fallback.x;
        let chipY = fallback.y;
        if (!anchorToPanel) {
            const saved = loadState();
            chipX = loadSavedCoord(saved.chipX, bounds.left, bounds.right, chipW, fallback.x);
            chipY = loadSavedCoord(saved.chipY, bounds.top, bounds.bottom, chipH, fallback.y);
        }

        const pos = clampPosition(this.chip, chipX, chipY);
        this.chip.style.left = `${pos.x}px`;
        this.chip.style.top = `${pos.y}px`;
    },

    collapse() {
        if (!this.panel || !this.chip) return;
        // Already collapsed and resting: nothing to morph. Re-running would
        // measure a display:none panel and save a 0,0 position.
        if (
            this.collapsed &&
            this.panel.classList.contains('is-collapsed') &&
            !this.chip.classList.contains('is-hidden')
        ) {
            return;
        }
        this.collapsed = true;

        // Measure before `is-collapsed` lands: it is display:none, which reports
        // every offset as 0.
        const panelLeft = this.panel.offsetLeft;
        const panelTop = this.panel.offsetTop;
        const panelW = this.panel.offsetWidth;
        const panelH = this.panel.offsetHeight;

        cancelChipMotion();

        this.chip.classList.remove('is-hidden');
        this.chip.style.opacity = '0';
        this.chip.style.pointerEvents = 'none';
        this.positionChip(true);
        const chipX = this.chip.offsetLeft;
        const chipY = this.chip.offsetTop;
        const chipW = this.chip.offsetWidth || 44;
        const chipH = this.chip.offsetHeight || 44;

        const finish = () => {
            // Save while the panel is still laid out; offsets read 0 once it is
            // display:none.
            this.chip.classList.remove('is-hidden');
            this.chip.style.opacity = '0';
            this.chip.style.pointerEvents = '';
            const next = {
                chipX: this.chip.offsetLeft,
                chipY: this.chip.offsetTop,
                collapsed: true
            };
            // Only rewrite the panel rect when it had a layout box to measure.
            if (panelW && panelH) {
                next.x = panelLeft;
                next.y = panelTop;
            }
            saveState(next);
            this.panel.classList.add('is-collapsed');
            cancelChipMotion();
            resetPanelMotion(this.panel);
            animateChipIn(this.chip);
            this.onCollapse?.();
        };

        if (!panelW || !panelH || !canAnimateElement(this.panel)) {
            finish();
            return;
        }

        const { sx, sy } = chipScaleForPanel(panelW, panelH, chipW, chipH);
        this.panel.style.transformOrigin = `${chipX - panelLeft}px ${chipY - panelTop}px`;
        this.panel.style.pointerEvents = 'none';
        chipMotion = this.panel.animate(
            [
                { transform: 'scale(1, 1)', opacity: 1 },
                { transform: `scale(${sx}, ${sy})`, opacity: 0.35 }
            ],
            { duration: CHIP_MOTION_MS, easing: CHIP_MOTION_EASING, fill: 'forwards' }
        );
        chipMotion.addEventListener('finish', finish, { once: true });
    },

    expand({ restoreFocus = false } = {}) {
        if (!this.panel || !this.chip) return;
        this.collapsed = false;
        cancelChipMotion();

        // Re-render toolbar buttons before measuring so the expanded rect (and
        // therefore the animation target) reflects the final content.
        this.onExpand?.();

        const chipVisible = !this.chip.classList.contains('is-hidden');
        const chipX = chipVisible ? this.chip.offsetLeft : 0;
        const chipY = chipVisible ? this.chip.offsetTop : 0;
        const chipW = chipVisible ? this.chip.offsetWidth || 44 : 0;
        const chipH = chipVisible ? this.chip.offsetHeight || 44 : 0;

        // Lay the panel out under `visibility: hidden` so the expanded rect can
        // be measured without painting a full-size frame first.
        const wasCollapsed = this.panel.classList.contains('is-collapsed');
        if (wasCollapsed) {
            this.panel.style.visibility = 'hidden';
            this.panel.classList.remove('is-collapsed');
        }
        const panelW = this.panel.offsetWidth;
        const panelH = this.panel.offsetHeight;

        // Clamp-only anchoring: open at the token's corner, slide inward near an
        // edge, never flip to another corner.
        const origin =
            chipVisible && panelW && panelH
                ? resolveExpandedPanelOrigin({
                      chipX,
                      chipY,
                      panelWidth: panelW,
                      panelHeight: panelH,
                      bounds: getDesktopBounds()
                  })
                : null;
        if (origin) {
            this.panel.style.left = `${origin.x}px`;
            this.panel.style.top = `${origin.y}px`;
        }

        this.chip.classList.add('is-hidden');
        this.chip.style.opacity = '';
        this.chip.style.pointerEvents = '';

        const finish = () => {
            this.panel.classList.remove('is-collapsed');
            resetPanelMotion(this.panel);
            cancelChipMotion();
            if (restoreFocus) {
                document.getElementById('draw-panel-collapse')?.focus({ preventScroll: true });
            }
            if (panelW) {
                saveState({
                    x: this.panel.offsetLeft,
                    y: this.panel.offsetTop,
                    collapsed: false
                });
            } else {
                saveState({ collapsed: false });
            }
        };

        if (!origin || !canAnimateElement(this.panel)) {
            finish();
            return;
        }

        const { sx, sy } = chipScaleForPanel(panelW, panelH, chipW, chipH);
        this.panel.style.transformOrigin = `${chipX - origin.x}px ${chipY - origin.y}px`;
        this.panel.style.transform = `scale(${sx}, ${sy})`;
        this.panel.style.opacity = '0.35';
        this.panel.style.pointerEvents = 'none';
        this.panel.style.visibility = '';
        chipMotion = this.panel.animate(
            [
                { transform: `scale(${sx}, ${sy})`, opacity: 0.35 },
                { transform: 'scale(1, 1)', opacity: 1 }
            ],
            { duration: CHIP_MOTION_MS, easing: CHIP_MOTION_EASING, fill: 'forwards' }
        );
        chipMotion.addEventListener('finish', finish, { once: true });
    },

    getToolbarMount() {
        return this.bodyEl;
    },

    /**
     * Clamp/drag relative to a host element (Focus canvas zone). Positions are
     * offset-parent coordinates inside the host.
     * @param {HTMLElement|null} el
     * @param {{ storageKey?: string, defaultCollapsed?: boolean }} [opts]
     */
    setHostBounds(el, { storageKey = 'matrix_focus_drawing_toolbar', defaultCollapsed = true } = {}) {
        hostBoundsEl = el || null;
        activeStorageKey = storageKey || STORAGE_KEY_DEFAULT;
        this._forceDefaultCollapsed = !!defaultCollapsed;
    },

    clearHostBounds() {
        hostBoundsEl = null;
        activeStorageKey = STORAGE_KEY_DEFAULT;
        this._forceDefaultCollapsed = false;
    }
};
