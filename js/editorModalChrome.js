const STORAGE_KEY = 'matrix_modal_editor_geometry';
const MIN_W = 320;
const MIN_H = 280;
const PAD = 16;
const DEFAULT_W = 520;

function defaultHeight() {
    return window.innerHeight - PAD * 2;
}

function clampGeometry(geom) {
    const maxW = window.innerWidth - PAD * 2;
    const maxH = window.innerHeight - PAD * 2;
    const w = Math.min(Math.max(geom.w, MIN_W), maxW);
    const h = Math.min(Math.max(geom.h, MIN_H), maxH);
    const x = Math.min(Math.max(geom.x, PAD), window.innerWidth - w - PAD);
    const y = Math.min(Math.max(geom.y, PAD), window.innerHeight - h - PAD);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

function isDesktopViewport() {
    return window.matchMedia('(min-width: 769px)').matches;
}

export const EditorModalChrome = {
    _bindings: new WeakMap(),

    isEnabled() {
        return isDesktopViewport();
    },

    isInitialized(modalEl) {
        const binding = this._bindings.get(modalEl);
        return !!(binding && binding.desktopEnabled === this.isEnabled());
    },

    loadGeometry() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!Number.isFinite(parsed?.x) || !Number.isFinite(parsed?.w)) return null;
            return clampGeometry(parsed);
        } catch {
            return null;
        }
    },

    saveGeometry(geom) {
        if (!geom) return;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clampGeometry(geom)));
    },

    readGeometry(modalEl) {
        if (!modalEl) return null;
        const rect = modalEl.getBoundingClientRect();
        return clampGeometry({
            x: rect.left,
            y: rect.top,
            w: rect.width,
            h: rect.height
        });
    },

    applyGeometry(modalEl, geom) {
        if (!modalEl || !geom) return;
        const g = clampGeometry(geom);
        modalEl.style.position = 'fixed';
        modalEl.style.left = `${g.x}px`;
        modalEl.style.top = `${g.y}px`;
        modalEl.style.width = `${g.w}px`;
        modalEl.style.height = `${g.h}px`;
        modalEl.style.maxWidth = 'none';
        modalEl.style.maxHeight = 'none';
        modalEl.classList.add('modal--floating');
    },

    applyDefaultCentered(modalEl) {
        if (!modalEl) return;
        const w = Math.min(DEFAULT_W, window.innerWidth - PAD * 2);
        const h = defaultHeight();
        this.applyGeometry(modalEl, {
            x: (window.innerWidth - w) / 2,
            y: (window.innerHeight - h) / 2,
            w,
            h
        });
    },

    ensureChrome(modalEl) {
        if (!modalEl.querySelector('.modal-chrome')) {
            const chrome = document.createElement('div');
            chrome.className = 'modal-chrome';
            chrome.innerHTML = `
                <span class="modal-resize modal-resize-n" data-axis="n" aria-hidden="true"></span>
                <span class="modal-resize modal-resize-s" data-axis="s" aria-hidden="true"></span>
                <span class="modal-resize modal-resize-e" data-axis="e" aria-hidden="true"></span>
                <span class="modal-resize modal-resize-w" data-axis="w" aria-hidden="true"></span>
                <span class="modal-resize modal-resize-nw" data-axis="nw" aria-hidden="true"></span>
                <span class="modal-resize modal-resize-ne" data-axis="ne" aria-hidden="true"></span>
                <span class="modal-resize modal-resize-sw" data-axis="sw" aria-hidden="true"></span>
                <span class="modal-resize modal-resize-se" data-axis="se" aria-hidden="true"></span>
            `;
            modalEl.appendChild(chrome);
        }
    },

    teardown(modalEl) {
        const binding = this._bindings.get(modalEl);
        if (!binding) return;
        binding.abort.abort();
        this._bindings.delete(modalEl);
    },

    init(modalEl, { onGeometryChange } = {}) {
        if (!modalEl) return;

        const desktopEnabled = this.isEnabled();
        if (this.isInitialized(modalEl)) return;

        this.teardown(modalEl);

        if (!desktopEnabled) {
            modalEl.classList.remove('modal--floating');
            modalEl.style.position = '';
            modalEl.style.left = '';
            modalEl.style.top = '';
            modalEl.style.width = '';
            modalEl.style.height = '';
            modalEl.style.maxWidth = '';
            modalEl.style.maxHeight = '';
            return;
        }

        this.ensureChrome(modalEl);
        const saved = this.loadGeometry();
        if (saved) {
            this.applyGeometry(modalEl, saved);
        } else {
            this.applyDefaultCentered(modalEl);
        }

        const abort = new AbortController();
        const { signal } = abort;
        const toolbar = modalEl.querySelector('.editor-toolbar');
        let dragActive = null;
        let resizeActive = null;
        let dragRaf = null;
        let resizeRaf = null;

        const commitGeometry = () => {
            const geom = this.readGeometry(modalEl);
            this.saveGeometry(geom);
            onGeometryChange?.(geom);
        };

        const onDragMove = (e) => {
            if (!dragActive) return;
            const dx = e.clientX - dragActive.startX;
            const dy = e.clientY - dragActive.startY;
            if (!dragActive.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
            dragActive.moved = true;
            dragActive.pending = {
                x: dragActive.origX + dx,
                y: dragActive.origY + dy,
                w: dragActive.w,
                h: dragActive.h
            };
            if (dragRaf) return;
            dragRaf = requestAnimationFrame(() => {
                dragRaf = null;
                if (!dragActive?.pending) return;
                modalEl.classList.add('is-modal-dragging');
                this.applyGeometry(modalEl, dragActive.pending);
            });
        };

        const onDragUp = () => {
            if (!dragActive) return;
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragUp);
            if (dragRaf) {
                cancelAnimationFrame(dragRaf);
                dragRaf = null;
            }
            modalEl.classList.remove('is-modal-dragging');
            if (dragActive.moved) commitGeometry();
            dragActive = null;
        };

        toolbar?.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (e.target.closest('.card-act, input, select, textarea, button')) return;
            e.preventDefault();
            const geom = this.readGeometry(modalEl);
            dragActive = {
                startX: e.clientX,
                startY: e.clientY,
                origX: geom.x,
                origY: geom.y,
                w: geom.w,
                h: geom.h,
                moved: false
            };
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragUp);
        }, { signal });

        const onResizeMove = (e) => {
            if (!resizeActive) return;
            const dx = e.clientX - resizeActive.startX;
            const dy = e.clientY - resizeActive.startY;
            let { x, y, w, h } = resizeActive.orig;
            const axis = resizeActive.axis;
            if (axis.includes('e')) w = resizeActive.orig.w + dx;
            if (axis.includes('w')) {
                w = resizeActive.orig.w - dx;
                x = resizeActive.orig.x + dx;
            }
            if (axis.includes('s')) h = resizeActive.orig.h + dy;
            if (axis.includes('n')) {
                h = resizeActive.orig.h - dy;
                y = resizeActive.orig.y + dy;
            }
            resizeActive.pending = { x, y, w, h };
            if (resizeRaf) return;
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null;
                if (!resizeActive?.pending) return;
                this.applyGeometry(modalEl, resizeActive.pending);
            });
        };

        const onResizeUp = () => {
            if (!resizeActive) return;
            document.removeEventListener('mousemove', onResizeMove);
            document.removeEventListener('mouseup', onResizeUp);
            if (resizeRaf) {
                cancelAnimationFrame(resizeRaf);
                resizeRaf = null;
            }
            modalEl.classList.remove('is-modal-resizing');
            commitGeometry();
            resizeActive = null;
        };

        modalEl.querySelectorAll('.modal-resize').forEach((handle) => {
            handle.addEventListener('mousedown', (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                resizeActive = {
                    axis: handle.dataset.axis || 'se',
                    startX: e.clientX,
                    startY: e.clientY,
                    orig: this.readGeometry(modalEl)
                };
                modalEl.classList.add('is-modal-resizing');
                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeUp);
            }, { signal });
        });

        this._bindings.set(modalEl, { abort, desktopEnabled });
    }
};
