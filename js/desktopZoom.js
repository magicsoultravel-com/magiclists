const STORAGE_KEY = 'matrix_desktop_zoom';
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;
const ZOOM_DEFAULT = 1;

function clampZoom(value) {
    return Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, value)) * 100) / 100;
}

function readZoom() {
    try {
        const raw = parseFloat(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(raw) ? clampZoom(raw) : ZOOM_DEFAULT;
    } catch {
        return ZOOM_DEFAULT;
    }
}

function writeZoom(value) {
    const next = clampZoom(value);
    localStorage.setItem(STORAGE_KEY, String(next));
    return next;
}

export const DesktopZoom = {
    ZOOM_MIN,
    ZOOM_MAX,
    ZOOM_STEP,

    getScale() {
        return readZoom();
    },

    setScale(value) {
        const next = writeZoom(value);
        this.apply();
        window.dispatchEvent(new CustomEvent('desktop:zoom_changed', { detail: next }));
        return next;
    },

    step(delta) {
        return this.setScale(readZoom() + delta);
    },

    apply({ enabled = true } = {}) {
        const zoom = readZoom();
        const shell = document.getElementById('workspace-main');
        const surface = document.getElementById('desktop-surface');
        const canvas = document.getElementById('app-canvas');
        if (shell) {
            shell.style.setProperty('--desktop-zoom', String(zoom));
            shell.classList.toggle('desktop-zoom-enabled', enabled);
            shell.classList.toggle('desktop-zoom-expanded', enabled && zoom < 1);
        }
        if (surface) {
            surface.dataset.desktopZoom = String(zoom);
        }
        if (canvas) {
            canvas.dataset.desktopZoom = String(zoom);
        }
        this.updateButtons();
        window.dispatchEvent(new CustomEvent('tools:desktop_bounds_changed'));
    },

    isCustomized() {
        return Math.abs(readZoom() - ZOOM_DEFAULT) > 0.001;
    },

    updateButtons() {
        const zoom = readZoom();
        const outBtn = document.getElementById('display-opt-desktop-zoom-out');
        const inBtn = document.getElementById('display-opt-desktop-zoom-in');
        const label = document.getElementById('display-opt-desktop-zoom-label');
        if (outBtn) outBtn.disabled = zoom <= ZOOM_MIN + 0.001;
        if (inBtn) inBtn.disabled = zoom >= ZOOM_MAX - 0.001;
        if (label) label.textContent = `${Math.round(zoom * 100)}%`;
    },

    init() {
        /* Stepper buttons are bound when the display options popover opens. */
    },

    isDesktopViewport() {
        return window.matchMedia('(min-width: 769px)').matches;
    },

    pointerDelta(clientDx, clientDy) {
        const zoom = readZoom();
        return {
            dx: clientDx / zoom,
            dy: clientDy / zoom
        };
    }
};
