import { positionPanelBelowElement, clampPanelToViewport } from './popoverPosition.js';
import { RadioPlayer } from './radioPlayer.js';
import { CARD_ICONS } from './ui.js';

const MIN_BROWSER_W = 240;
const MIN_BROWSER_H = 200;

export const RadioPopover = {
    panel: null,
    attachEl: null,
    iconAnchor: null,
    mode: null,
    outsideHandler: null,
    keyHandler: null,
    resizeHandler: null,
    boundsHandler: null,
    onClose: null,

    ensurePanel() {
        if (this.panel) return this.panel;

        const panel = document.createElement('div');
        panel.className = 'radio-popover clock-style-popover is-hidden';
        panel.setAttribute('role', 'dialog');
        panel.innerHTML = `
            <div class="radio-popover__header">
                <button type="button" class="btn btn--compact btn-icon radio-popover__back is-hidden" data-radio-pop-back aria-label="Back">◀</button>
                <span class="radio-popover__title" data-radio-pop-title>Radio</span>
                <span class="radio-popover__spacer"></span>
                <button type="button" class="card-act radio-popover__close" data-radio-pop-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            </div>
            <div class="radio-popover__toolbar is-hidden" data-radio-pop-toolbar></div>
            <div class="radio-popover__body" data-radio-pop-body></div>
            <div class="radio-popover__resize-se ff-resize ff-resize-se" data-radio-pop-resize aria-hidden="true"></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('[data-radio-pop-close]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });

        this.bindResize(panel);
        this.panel = panel;
        return panel;
    },

    bindResize(panel) {
        const handle = panel.querySelector('[data-radio-pop-resize]');
        if (!handle) return;

        handle.addEventListener('pointerdown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const startX = e.clientX;
            const startY = e.clientY;
            const startW = panel.offsetWidth;
            const startH = panel.offsetHeight;

            panel.classList.add('is-resizing');

            const onMove = (ev) => {
                const w = Math.max(MIN_BROWSER_W, startW + (ev.clientX - startX));
                const h = Math.max(MIN_BROWSER_H, startH + (ev.clientY - startY));
                panel.style.width = `${w}px`;
                panel.style.height = `${h}px`;
                this.reposition();
            };

            const onUp = () => {
                panel.classList.remove('is-resizing');
                RadioPlayer.saveBrowserSize(panel.offsetWidth, panel.offsetHeight);
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    },

    applyBrowserSize(panel) {
        const { w, h } = RadioPlayer.getBrowserSize();
        panel.style.width = `${w}px`;
        panel.style.height = `${h}px`;
    },

    open(mode, { attachEl, iconAnchor, title = 'Radio' } = {}) {
        const wasOpen = !this.panel?.classList.contains('is-hidden');
        const sameMode = this.mode === mode && this.iconAnchor === iconAnchor;

        if (wasOpen && sameMode) {
            this.close();
            return;
        }

        this.close(false);
        this.attachEl = attachEl;
        this.iconAnchor = iconAnchor;
        this.mode = mode;

        const panel = this.ensurePanel();
        this.applyBrowserSize(panel);
        panel.classList.remove('is-hidden');
        panel.setAttribute('aria-label', title);
        panel.querySelector('[data-radio-pop-title]').textContent = title;

        iconAnchor?.setAttribute('aria-expanded', 'true');

        requestAnimationFrame(() => {
            this.reposition();
        });

        this.attachListeners();
        this.attachBoundsWatcher();
    },

    attachBoundsWatcher() {
        if (this.boundsHandler) return;
        this.boundsHandler = () => {
            if (!this.panel || this.panel.classList.contains('is-hidden')) return;
            this.reposition();
        };
        window.addEventListener('tools:desktop_bounds_changed', this.boundsHandler);
        window.addEventListener('resize', this.boundsHandler);
    },

    detachBoundsWatcher() {
        if (!this.boundsHandler) return;
        window.removeEventListener('tools:desktop_bounds_changed', this.boundsHandler);
        window.removeEventListener('resize', this.boundsHandler);
        this.boundsHandler = null;
    },

    attachListeners() {
        this.detachListeners();
        this.outsideHandler = (e) => {
            if (this.panel?.contains(e.target)) return;
            if (this.attachEl?.contains(e.target)) return;
            if (this.iconAnchor?.contains(e.target)) return;
            this.close();
        };
        this.keyHandler = (e) => {
            if (e.key === 'Escape') this.close();
        };
        requestAnimationFrame(() => {
            document.addEventListener('mousedown', this.outsideHandler, true);
            document.addEventListener('keydown', this.keyHandler);
        });
    },

    detachListeners() {
        if (this.outsideHandler) {
            document.removeEventListener('mousedown', this.outsideHandler, true);
            this.outsideHandler = null;
        }
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
    },

    close(resetAnchor = true) {
        this.detachListeners();
        this.detachBoundsWatcher();
        if (resetAnchor) {
            this.iconAnchor?.setAttribute('aria-expanded', 'false');
        }
        this.panel?.classList.add('is-hidden');
        this.attachEl = null;
        this.iconAnchor = null;
        this.mode = null;
        this.onClose?.();
    },

    getBodyEl() {
        return this.panel?.querySelector('[data-radio-pop-body]');
    },

    getToolbarEl() {
        return this.panel?.querySelector('[data-radio-pop-toolbar]');
    },

    setBackVisible(visible, onClick) {
        const back = this.panel?.querySelector('[data-radio-pop-back]');
        if (!back) return;
        back.classList.toggle('is-hidden', !visible);
        back.onclick = visible ? (e) => { e.stopPropagation(); onClick?.(); } : null;
    },

    setTitle(text) {
        const el = this.panel?.querySelector('[data-radio-pop-title]');
        if (el) el.textContent = text;
    },

    setToolbarHtml(html) {
        const toolbar = this.getToolbarEl();
        if (!toolbar) return;
        toolbar.innerHTML = html || '';
        toolbar.classList.toggle('is-hidden', !html);
    },

    reposition() {
        if (!this.panel || this.panel.classList.contains('is-hidden') || !this.attachEl) return;
        positionPanelBelowElement(this.panel, this.attachEl);
        const clamped = clampPanelToViewport(
            this.panel,
            parseFloat(this.panel.style.left) || 0,
            parseFloat(this.panel.style.top) || 0
        );
        this.panel.style.left = `${clamped.x}px`;
        this.panel.style.top = `${clamped.y}px`;
    }
};
