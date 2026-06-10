const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;
const VIEWPORT_KEY = 'matrix_canvas_viewport';

function clampZoom(v) {
    return Math.round(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)) * 100) / 100;
}

export const CanvasViewport = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    innerEl: null,
    viewportEl: null,
    panning: false,
    panStart: null,
    spaceHeld: false,

    init(innerEl, viewportEl) {
        this.innerEl = innerEl;
        this.viewportEl = viewportEl;
        this.bindEvents();
    },

    loadFromDoc(viewport) {
        this.scale = clampZoom(viewport?.scale ?? 1);
        this.offsetX = viewport?.offsetX ?? 0;
        this.offsetY = viewport?.offsetY ?? 0;
        this.applyTransform();
    },

    toDoc() {
        return { scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY };
    },

    applyTransform() {
        if (!this.innerEl) return;
        this.innerEl.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
        this.innerEl.style.transformOrigin = '0 0';
    },

    setScale(next, pivotX, pivotY) {
        const prev = this.scale;
        const scale = clampZoom(next);
        if (pivotX != null && pivotY != null && prev !== scale) {
            const ratio = scale / prev;
            this.offsetX = pivotX - (pivotX - this.offsetX) * ratio;
            this.offsetY = pivotY - (pivotY - this.offsetY) * ratio;
        }
        this.scale = scale;
        this.applyTransform();
    },

    stepZoom(delta, pivotX, pivotY) {
        this.setScale(this.scale + delta, pivotX, pivotY);
    },

    screenToWorld(clientX, clientY, canvasEl) {
        const vpRect = this.viewportEl?.getBoundingClientRect();
        if (!vpRect) return { x: 0, y: 0 };
        const x = (clientX - vpRect.left - this.offsetX) / this.scale;
        const y = (clientY - vpRect.top - this.offsetY) / this.scale;
        if (!canvasEl) return { x, y };
        const dpr = window.devicePixelRatio || 1;
        return { x: x * dpr, y: y * dpr };
    },

    bindEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.repeat) this.spaceHeld = true;
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.spaceHeld = false;
                this.panning = false;
            }
        });

        this.viewportEl?.addEventListener('wheel', (e) => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
            this.stepZoom(delta, e.clientX - (this.viewportEl.getBoundingClientRect().left), e.clientY - (this.viewportEl.getBoundingClientRect().top));
        }, { passive: false });

        this.viewportEl?.addEventListener('pointerdown', (e) => {
            if (e.button === 1 || this.spaceHeld) {
                this.panning = true;
                this.panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY, id: e.pointerId };
                this.viewportEl.setPointerCapture(e.pointerId);
                e.preventDefault();
            }
        });

        this.viewportEl?.addEventListener('pointermove', (e) => {
            if (!this.panning || !this.panStart) return;
            this.offsetX = e.clientX - this.panStart.x;
            this.offsetY = e.clientY - this.panStart.y;
            this.applyTransform();
        });

        const endPan = (e) => {
            if (!this.panning) return;
            this.panning = false;
            this.panStart = null;
            try { this.viewportEl?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        };
        this.viewportEl?.addEventListener('pointerup', endPan);
        this.viewportEl?.addEventListener('pointercancel', endPan);
    },

    ZOOM_MIN,
    ZOOM_MAX,
    ZOOM_STEP
};
