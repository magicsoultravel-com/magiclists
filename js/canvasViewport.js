const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.1;
const VIEWPORT_KEY = 'matrix_canvas_viewport';
const SCROLLBAR_MIN_THUMB = 28;

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
    handMode: false,
    contentCssW: 0,
    contentCssH: 0,
    scrollBarX: null,
    scrollBarY: null,
    scrollThumbX: null,
    scrollThumbY: null,
    thumbDrag: null,

    init(innerEl, viewportEl) {
        this.innerEl = innerEl;
        this.viewportEl = viewportEl;
        this.ensureScrollbars();
        this.bindEvents();
    },

    loadFromDoc(viewport) {
        this.scale = clampZoom(viewport?.scale ?? 1);
        this.offsetX = viewport?.offsetX ?? 0;
        this.offsetY = viewport?.offsetY ?? 0;
        this.clampOffsets();
        this.applyTransform();
        this.syncScrollbars();
    },

    toDoc() {
        return { scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY };
    },

    setContentSize(cssW, cssH) {
        this.contentCssW = Math.max(0, cssW || 0);
        this.contentCssH = Math.max(0, cssH || 0);
        this.clampOffsets();
        this.applyTransform();
        this.syncScrollbars();
    },

    getViewportSize() {
        return {
            w: this.viewportEl?.clientWidth || 0,
            h: this.viewportEl?.clientHeight || 0
        };
    },

    getMaxScroll() {
        const { w, h } = this.getViewportSize();
        return {
            x: Math.max(0, this.contentCssW * this.scale - w),
            y: Math.max(0, this.contentCssH * this.scale - h)
        };
    },

    /**
     * Top/left wall at origin (offset <= 0).
     * Right/bottom clamped to content extent so scrollbars have a real range.
     */
    clampOffsets() {
        const max = this.getMaxScroll();
        this.offsetX = Math.min(0, Math.max(-max.x, this.offsetX));
        this.offsetY = Math.min(0, Math.max(-max.y, this.offsetY));
    },

    applyTransform() {
        if (!this.innerEl) return;
        this.innerEl.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
        this.innerEl.style.transformOrigin = '0 0';
    },

    emitChange(type = 'canvas:viewport') {
        this.viewportEl?.dispatchEvent(new CustomEvent(type, {
            detail: { scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY },
            bubbles: true
        }));
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
        this.clampOffsets();
        this.applyTransform();
        this.syncScrollbars();
        this.emitChange('canvas:zoom');
    },

    stepZoom(delta, pivotX, pivotY) {
        this.setScale(this.scale + delta, pivotX, pivotY);
    },

    panBy(dx, dy, { emit = true } = {}) {
        this.offsetX += dx;
        this.offsetY += dy;
        this.clampOffsets();
        this.applyTransform();
        this.syncScrollbars();
        if (emit) this.emitChange('canvas:pan');
    },

    setHandMode(on) {
        this.handMode = !!on;
        this.viewportEl?.classList.toggle('is-hand-mode', this.handMode);
        if (!this.handMode && this.panning && !this.spaceHeld) {
            this.panning = false;
            this.panStart = null;
            this.viewportEl?.classList.remove('is-panning');
        }
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

    ensureScrollbars() {
        if (!this.viewportEl || this.scrollBarX) return;

        const makeBar = (axis) => {
            const bar = document.createElement('div');
            bar.className = `canvas-scrollbar canvas-scrollbar--${axis} is-hidden`;
            bar.setAttribute('aria-hidden', 'true');
            const thumb = document.createElement('div');
            thumb.className = 'canvas-scrollbar__thumb';
            thumb.dataset.axis = axis;
            thumb.tabIndex = -1;
            bar.appendChild(thumb);
            this.viewportEl.appendChild(bar);
            return { bar, thumb };
        };

        const x = makeBar('x');
        const y = makeBar('y');
        this.scrollBarX = x.bar;
        this.scrollThumbX = x.thumb;
        this.scrollBarY = y.bar;
        this.scrollThumbY = y.thumb;

        const onThumbDown = (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            const axis = e.currentTarget.dataset.axis;
            const max = this.getMaxScroll();
            this.thumbDrag = {
                axis,
                startClient: axis === 'x' ? e.clientX : e.clientY,
                startOffset: axis === 'x' ? this.offsetX : this.offsetY,
                maxScroll: axis === 'x' ? max.x : max.y,
                trackSize: axis === 'x'
                    ? (this.scrollBarX.clientWidth - this.scrollThumbX.offsetWidth)
                    : (this.scrollBarY.clientHeight - this.scrollThumbY.offsetHeight)
            };
            e.currentTarget.setPointerCapture?.(e.pointerId);
        };

        this.scrollThumbX.addEventListener('pointerdown', onThumbDown);
        this.scrollThumbY.addEventListener('pointerdown', onThumbDown);

        window.addEventListener('pointermove', (e) => {
            if (!this.thumbDrag) return;
            const { axis, startClient, startOffset, maxScroll, trackSize } = this.thumbDrag;
            if (trackSize <= 0 || maxScroll <= 0) return;
            const delta = (axis === 'x' ? e.clientX : e.clientY) - startClient;
            // Thumb moves positive as scroll increases; scroll = -offset.
            const scroll = (-startOffset) + (delta / trackSize) * maxScroll;
            if (axis === 'x') this.offsetX = -scroll;
            else this.offsetY = -scroll;
            this.clampOffsets();
            this.applyTransform();
            this.syncScrollbars();
        });

        window.addEventListener('pointerup', () => {
            if (!this.thumbDrag) return;
            this.thumbDrag = null;
            this.emitChange('canvas:pan');
        });
    },

    syncScrollbars() {
        if (!this.viewportEl) return;
        this.ensureScrollbars();
        const { w, h } = this.getViewportSize();
        const max = this.getMaxScroll();
        const scrollX = -this.offsetX;
        const scrollY = -this.offsetY;

        const syncAxis = (axis, bar, thumb, maxScroll, scroll, viewportSize, contentScaled, trackSize) => {
            if (!bar || !thumb) return;
            const show = maxScroll > 0.5;
            bar.classList.toggle('is-hidden', !show);
            bar.setAttribute('aria-hidden', show ? 'false' : 'true');
            if (!show) return;

            const track = Math.max(0, trackSize);
            const ratio = contentScaled > 0 ? viewportSize / contentScaled : 1;
            const thumbSize = Math.max(SCROLLBAR_MIN_THUMB, Math.min(track, track * ratio));
            const travel = Math.max(0, track - thumbSize);
            const pos = maxScroll > 0 ? (scroll / maxScroll) * travel : 0;

            if (axis === 'x') {
                thumb.style.width = `${thumbSize}px`;
                thumb.style.height = '';
                thumb.style.transform = `translateX(${pos}px)`;
            } else {
                thumb.style.height = `${thumbSize}px`;
                thumb.style.width = '';
                thumb.style.transform = `translateY(${pos}px)`;
            }
        };

        const showX = max.x > 0.5;
        const showY = max.y > 0.5;
        const trackX = Math.max(0, w - (showY ? 18 : 12));
        const trackY = Math.max(0, h - (showX ? 18 : 12));

        syncAxis('x', this.scrollBarX, this.scrollThumbX, max.x, scrollX, w, this.contentCssW * this.scale, trackX);
        syncAxis('y', this.scrollBarY, this.scrollThumbY, max.y, scrollY, h, this.contentCssH * this.scale, trackY);
        this.viewportEl.classList.toggle('has-scrollbar-x', showX);
        this.viewportEl.classList.toggle('has-scrollbar-y', showY);
    },

    bindEvents() {
        window.addEventListener('keydown', (e) => {
            if (e.code === 'Space' && !e.repeat) {
                this.spaceHeld = true;
                this.viewportEl?.classList.add('is-space-pan');
            }
        });
        window.addEventListener('keyup', (e) => {
            if (e.code === 'Space') {
                this.spaceHeld = false;
                this.viewportEl?.classList.remove('is-space-pan');
                if (!this.handMode) {
                    this.panning = false;
                    this.panStart = null;
                    this.viewportEl?.classList.remove('is-panning');
                }
            }
        });

        this.viewportEl?.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
                const rect = this.viewportEl.getBoundingClientRect();
                this.stepZoom(delta, e.clientX - rect.left, e.clientY - rect.top);
                return;
            }
            e.preventDefault();
            const factor = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 40 : 1;
            this.panBy(-e.deltaX * factor, -e.deltaY * factor);
        }, { passive: false });

        this.viewportEl?.addEventListener('pointerdown', (e) => {
            if (e.target?.closest?.('.canvas-scrollbar')) return;
            const wantPan = e.button === 1 || this.spaceHeld || (this.handMode && e.button === 0);
            if (!wantPan) return;
            this.panning = true;
            this.viewportEl?.classList.add('is-panning');
            this.panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY, id: e.pointerId };
            this.viewportEl.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        this.viewportEl?.addEventListener('pointermove', (e) => {
            if (!this.panning || !this.panStart) return;
            this.offsetX = e.clientX - this.panStart.x;
            this.offsetY = e.clientY - this.panStart.y;
            this.clampOffsets();
            this.applyTransform();
            this.syncScrollbars();
        });

        const endPan = (e) => {
            if (!this.panning) return;
            this.panning = false;
            this.viewportEl?.classList.remove('is-panning');
            this.panStart = null;
            this.emitChange('canvas:pan');
            try { this.viewportEl?.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        };
        this.viewportEl?.addEventListener('pointerup', endPan);
        this.viewportEl?.addEventListener('pointercancel', endPan);
    },

    ZOOM_MIN,
    ZOOM_MAX,
    ZOOM_STEP
};
