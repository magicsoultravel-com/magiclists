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
    /** Live touch pointers by id. Two of them drive the pan/pinch gesture. */
    touchPoints: new Map(),
    touchGestureActive: false,
    touchPanIds: null,
    touchPrev: null,
    touchZoomPending: 1,
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

    /**
     * Touch transform. Two fingers drive two independent outputs from the same
     * pair of points: the midpoint translating pans, the distance between them
     * changing zooms. Rotation is ignored — the canvas has no rotation state.
     *
     * `panning` stays true until the LAST finger lifts rather than until the
     * pair breaks: a leftover finger falls through to the board otherwise, and
     * with the eraser armed that erases where the user only meant to pan.
     */
    touchLocalPoint(e) {
        const rect = this.viewportEl?.getBoundingClientRect?.();
        return { x: e.clientX - (rect?.left || 0), y: e.clientY - (rect?.top || 0) };
    },

    touchPairState() {
        if (!this.touchPanIds) return null;
        const a = this.touchPoints.get(this.touchPanIds[0]);
        const b = this.touchPoints.get(this.touchPanIds[1]);
        if (!a || !b) return null;
        return {
            midX: (a.x + b.x) / 2,
            midY: (a.y + b.y) / 2,
            dist: Math.hypot(a.x - b.x, a.y - b.y)
        };
    },

    onTouchDown(e) {
        this.touchPoints.set(e.pointerId, this.touchLocalPoint(e));
        // A finger arriving during a mouse/space pan, or a third finger during
        // a touch gesture, is tracked (so its lift ends nothing early) and
        // otherwise ignored.
        if (this.panning) return;
        if (this.touchPoints.size < 2) return;
        this.touchPanIds = [...this.touchPoints.keys()].slice(-2);
        this.touchPrev = this.touchPairState();
        this.touchZoomPending = 1;
        this.touchGestureActive = true;
        this.panning = true;
        this.panStart = null;
        this.viewportEl?.classList.add('is-panning');
        // The board kills whatever the first finger started on this signal:
        // a pinch must never leave a half-drawn stroke behind.
        this.emitChange('canvas:panstart');
    },

    onTouchMove(e) {
        if (!this.touchPoints.has(e.pointerId)) return;
        this.touchPoints.set(e.pointerId, this.touchLocalPoint(e));
        if (!this.touchGestureActive || !this.touchPrev) return;
        const next = this.touchPairState();
        if (!next) return;
        const prev = this.touchPrev;
        this.touchPrev = next;

        // Zoom about the PREVIOUS midpoint, then translate by the midpoint
        // delta: that is what keeps the world point under the fingers under the
        // fingers. Pivoting on the new midpoint instead leaves it a whole pan
        // distance behind.
        this.touchZoomPending *= prev.dist > 0 ? next.dist / prev.dist : 1;
        const target = clampZoom(this.scale * this.touchZoomPending);
        if (target !== this.scale) {
            this.setScale(target, prev.midX, prev.midY);
            this.touchZoomPending = 1;
        } else if ((this.touchZoomPending > 1 && this.scale >= ZOOM_MAX)
            || (this.touchZoomPending < 1 && this.scale <= ZOOM_MIN)) {
            // Saturated: drop the banked ratio, or releasing the pinch at the
            // limit unwinds as one jump later.
            this.touchZoomPending = 1;
        }

        const dx = next.midX - prev.midX;
        const dy = next.midY - prev.midY;
        // panBy syncs the scrollbars itself; a single canvas:pan is emitted when
        // the gesture ends, exactly like the mouse-drag path.
        if (dx || dy) this.panBy(dx, dy, { emit: false });
    },

    onTouchUp(e) {
        if (!this.touchPoints.has(e.pointerId)) return false;
        this.touchPoints.delete(e.pointerId);
        if (!this.touchGestureActive) return true;
        // Breaking the pair stops the transform, but the gesture (and with it
        // `panning`) survives until every finger is up. No re-pairing with a
        // later finger: new input needs a fresh pointerdown.
        if (this.touchPanIds?.includes(e.pointerId)) {
            this.touchPanIds = null;
            this.touchPrev = null;
            this.touchZoomPending = 1;
        }
        if (this.touchPoints.size === 0) this.endTouchGesture();
        return true;
    },

    endTouchGesture() {
        if (!this.touchGestureActive) return;
        this.touchGestureActive = false;
        this.touchPanIds = null;
        this.touchPrev = null;
        this.touchZoomPending = 1;
        this.panning = false;
        this.viewportEl?.classList.remove('is-panning');
        this.emitChange('canvas:pan');
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
                if (!this.touchGestureActive) {
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
            if (e.pointerType === 'touch') {
                this.onTouchDown(e);
                return;
            }
            const wantPan = e.button === 1 || this.spaceHeld;
            if (!wantPan) return;
            this.panning = true;
            this.viewportEl?.classList.add('is-panning');
            this.panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY, id: e.pointerId };
            this.viewportEl.setPointerCapture(e.pointerId);
            e.preventDefault();
        });

        this.viewportEl?.addEventListener('pointermove', (e) => {
            if (e.pointerType === 'touch') {
                this.onTouchMove(e);
                return;
            }
            if (!this.panning || !this.panStart) return;
            this.offsetX = e.clientX - this.panStart.x;
            this.offsetY = e.clientY - this.panStart.y;
            this.clampOffsets();
            this.applyTransform();
            this.syncScrollbars();
        });

        const endPan = (e) => {
            if (e.pointerType === 'touch') {
                this.onTouchUp(e);
                return;
            }
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
