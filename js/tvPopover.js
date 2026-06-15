import { positionPanelBelowElement, clampPanelToViewport } from './popoverPosition.js';
import { TvPlayer } from './tvPlayer.js';
import { CARD_ICONS } from './icons.js';

const MIN_BROWSER_W = 320;
const MIN_BROWSER_H = 280;

export const TvPopover = {
    panel: null,
    attachEl: null,
    iconAnchor: null,
    mode: null,
    activeTab: 'browse',
    outsideHandler: null,
    keyHandler: null,
    boundsHandler: null,
    onClose: null,
    onTabChange: null,
    onOpen: null,
    tabsBound: false,

    ensurePanel() {
        if (this.panel) return this.panel;

        const panel = document.createElement('div');
        panel.className = 'tv-popover clock-style-popover is-hidden';
        panel.setAttribute('role', 'dialog');
        panel.innerHTML = `
            <div class="tv-popover__header" data-tv-pop-drag>
                <button type="button" class="btn btn--compact btn-icon tv-popover__back is-hidden" data-tv-pop-back aria-label="Back">◀</button>
                <span class="tv-popover__title" data-tv-pop-title>TV</span>
                <span class="tv-popover__spacer"></span>
                <button type="button" class="card-act tv-popover__close" data-tv-pop-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            </div>
            <div class="tv-popover__video-wrap is-hidden" data-tv-video-wrap>
                <div class="tv-popover__video-slot" data-tv-video-slot aria-label="Live video"></div>
            </div>
            <div class="tv-popover__toolbar is-hidden" data-tv-pop-toolbar></div>
            <div class="tv-popover__body" data-tv-pop-body></div>
            <div class="tv-popover__tabs" data-tv-pop-tabs>
                <button type="button" class="tv-popover__tab is-active" data-tv-tab="browse">Browse</button>
                <button type="button" class="tv-popover__tab" data-tv-tab="recents">Recents</button>
                <button type="button" class="tv-popover__tab" data-tv-tab="favorites">Favorites</button>
            </div>
            <div class="tv-popover__resize-se ff-resize ff-resize-se" data-tv-pop-resize aria-hidden="true"></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('[data-tv-pop-close]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });

        this.bindResize(panel);
        this.bindHeaderDrag(panel);
        this.bindTabs(panel);
        this.panel = panel;
        return panel;
    },

    bindTabs(panel) {
        if (this.tabsBound) return;
        this.tabsBound = true;
        panel.querySelector('[data-tv-pop-tabs]')?.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-tv-tab]');
            if (!btn || this.mode === 'special') return;
            e.stopPropagation();
            const tab = btn.getAttribute('data-tv-tab');
            if (tab && tab !== this.activeTab) {
                this.setActiveTab(tab);
                this.onTabChange?.(tab);
            }
        });
    },

    setActiveTab(tab) {
        this.activeTab = tab;
        this.panel?.querySelectorAll('[data-tv-tab]').forEach((btn) => {
            btn.classList.toggle('is-active', btn.getAttribute('data-tv-tab') === tab);
        });
    },

    setTabsVisible(visible) {
        this.panel?.querySelector('[data-tv-pop-tabs]')?.classList.toggle('is-hidden', !visible);
    },

    bindHeaderDrag(panel) {
        const header = panel.querySelector('[data-tv-pop-drag]');
        if (!header || header.dataset.dragBound === 'true') return;
        header.dataset.dragBound = 'true';

        header.addEventListener('pointerdown', (e) => {
            if (e.target.closest('[data-tv-pop-close]')
                || e.target.closest('[data-tv-pop-back]')
                || e.button !== 0) return;

            e.preventDefault();
            let dragging = true;
            const startX = e.clientX;
            const startY = e.clientY;
            const startLeft = parseFloat(panel.style.left) || panel.getBoundingClientRect().left;
            const startTop = parseFloat(panel.style.top) || panel.getBoundingClientRect().top;

            panel.classList.add('tv-popover--dragging');
            header.setPointerCapture(e.pointerId);

            const onMove = (ev) => {
                if (!dragging) return;
                const nx = startLeft + (ev.clientX - startX);
                const ny = startTop + (ev.clientY - startY);
                const clamped = clampPanelToViewport(panel, nx, ny);
                panel.style.left = `${clamped.x}px`;
                panel.style.top = `${clamped.y}px`;
            };

            const onUp = (ev) => {
                if (!dragging) return;
                dragging = false;
                panel.classList.remove('tv-popover--dragging');
                header.releasePointerCapture(ev.pointerId);
                TvPlayer.saveBrowserPosition({
                    browserFloating: true,
                    browserX: parseFloat(panel.style.left) || 0,
                    browserY: parseFloat(panel.style.top) || 0
                });
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                document.removeEventListener('pointercancel', onUp);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
            document.addEventListener('pointercancel', onUp);
        });
    },

    bindResize(panel) {
        const handle = panel.querySelector('[data-tv-pop-resize]');
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
                TvPlayer.saveBrowserSize(panel.offsetWidth, panel.offsetHeight);
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
        const { w, h } = TvPlayer.getBrowserSize();
        panel.style.width = `${w}px`;
        panel.style.height = `${h}px`;
    },

    getVideoSlot() {
        return this.panel?.querySelector('[data-tv-video-slot]');
    },

    syncVideoMount() {
        const slot = this.getVideoSlot();
        const wrap = this.panel?.querySelector('[data-tv-video-wrap]');
        const inSettings = this.mode === 'special';
        const hasChannel = !!TvPlayer.channel;
        const showVideo = hasChannel && !inSettings && !this.panel?.classList.contains('is-hidden');
        wrap?.classList.toggle('is-hidden', !showVideo);
        if (showVideo && slot) {
            TvPlayer.mountVideo(slot);
        } else if (inSettings || this.panel?.classList.contains('is-hidden')) {
            TvPlayer.mountToHolder();
        }
    },

    open(mode, { attachEl, iconAnchor, title = 'TV', force = false, tab = 'browse' } = {}) {
        const wasOpen = !this.panel?.classList.contains('is-hidden');
        const sameBrowse = mode === 'browse'
            && this.mode === 'browse'
            && this.iconAnchor === iconAnchor
            && this.activeTab === tab;
        const sameSpecial = mode === 'special' && this.mode === 'special' && this.iconAnchor === iconAnchor;

        if (wasOpen && !force && (sameBrowse || sameSpecial)) {
            this.close();
            return false;
        }

        this.close(false);
        this.attachEl = attachEl;
        this.iconAnchor = iconAnchor;
        this.mode = mode;
        this.activeTab = mode === 'browse' ? tab : null;

        const panel = this.ensurePanel();
        this.applyBrowserSize(panel);
        panel.classList.remove('is-hidden');
        panel.setAttribute('aria-label', title);
        panel.querySelector('[data-tv-pop-title]').textContent = title;

        this.setTabsVisible(mode === 'browse');
        if (mode === 'browse') {
            this.setActiveTab(tab);
        }

        iconAnchor?.setAttribute('aria-expanded', 'true');
        this.syncVideoMount();
        this.onOpen?.();

        requestAnimationFrame(() => {
            this.reposition();
        });

        this.attachListeners();
        this.attachBoundsWatcher();
        return true;
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
        TvPlayer.mountToHolder();
        this.attachEl = null;
        this.iconAnchor = null;
        this.mode = null;
        this.activeTab = 'browse';
        this.onClose?.();
    },

    getBodyEl() {
        return this.panel?.querySelector('[data-tv-pop-body]');
    },

    getToolbarEl() {
        return this.panel?.querySelector('[data-tv-pop-toolbar]');
    },

    setBackVisible(visible, onClick) {
        const back = this.panel?.querySelector('[data-tv-pop-back]');
        if (!back) return;
        back.classList.toggle('is-hidden', !visible);
        back.onclick = visible ? (e) => { e.stopPropagation(); onClick?.(); } : null;
    },

    setTitle(text) {
        const el = this.panel?.querySelector('[data-tv-pop-title]');
        if (el) el.textContent = text;
    },

    setToolbarHtml(html) {
        const toolbar = this.getToolbarEl();
        if (!toolbar) return;
        toolbar.innerHTML = html || '';
        toolbar.classList.toggle('is-hidden', !html);
    },

    reposition() {
        if (!this.panel || this.panel.classList.contains('is-hidden')) return;

        const { browserX, browserY, browserFloating } = TvPlayer.getBrowserPosition();
        if (browserFloating && browserX != null && browserY != null) {
            this.panel.style.left = `${browserX}px`;
            this.panel.style.top = `${browserY}px`;
            const clamped = clampPanelToViewport(
                this.panel,
                browserX,
                browserY
            );
            this.panel.style.left = `${clamped.x}px`;
            this.panel.style.top = `${clamped.y}px`;
            return;
        }

        if (!this.attachEl) return;
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
