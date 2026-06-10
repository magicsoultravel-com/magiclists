import { positionPopoverBelowAnchor, positionPanelBesideSidebar, clampPanelToViewport } from './popoverPosition.js';
import { RadioPlayer } from './radioPlayer.js';
import { CARD_ICONS, ACTION_ICONS } from './ui.js';

export const RadioPopover = {
    panel: null,
    anchor: null,
    mode: null,
    expanded: false,
    docked: true,
    outsideHandler: null,
    keyHandler: null,
    drag: null,
    onClose: null,
    boundsHandler: null,

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
                <button type="button" class="card-act radio-popover__dock is-hidden" data-radio-pop-dock title="Undock panel" aria-label="Undock panel">${CARD_ICONS.unpin}</button>
                <button type="button" class="card-act radio-popover__expand" data-radio-pop-expand title="Expand panel" aria-label="Expand panel">${ACTION_ICONS.expandAll}</button>
                <button type="button" class="card-act radio-popover__close" data-radio-pop-close title="Close" aria-label="Close">${CARD_ICONS.close}</button>
            </div>
            <div class="radio-popover__toolbar is-hidden" data-radio-pop-toolbar></div>
            <div class="radio-popover__body" data-radio-pop-body></div>
        `;
        document.body.appendChild(panel);

        panel.querySelector('[data-radio-pop-close]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.close();
        });

        panel.querySelector('[data-radio-pop-expand]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.setExpanded(!this.expanded);
        });

        panel.querySelector('[data-radio-pop-dock]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDock();
        });

        const header = panel.querySelector('.radio-popover__header');
        header?.addEventListener('pointerdown', (e) => {
            if (!this.expanded || this.docked) return;
            if (e.target.closest('button')) return;
            this.startDrag(e);
        });

        this.panel = panel;
        return panel;
    },

    startDrag(e) {
        if (!this.panel || e.button !== 0) return;
        const rect = this.panel.getBoundingClientRect();
        this.drag = {
            startX: e.clientX,
            startY: e.clientY,
            origLeft: rect.left,
            origTop: rect.top,
            pointerId: e.pointerId
        };
        this.panel.classList.add('is-dragging');
        e.currentTarget.setPointerCapture?.(e.pointerId);

        const onMove = (ev) => {
            if (!this.drag) return;
            const dx = ev.clientX - this.drag.startX;
            const dy = ev.clientY - this.drag.startY;
            const next = clampPanelToViewport(
                this.panel,
                this.drag.origLeft + dx,
                this.drag.origTop + dy
            );
            this.panel.style.left = `${next.x}px`;
            this.panel.style.top = `${next.y}px`;
        };

        const onUp = (ev) => {
            if (!this.drag) return;
            e.currentTarget.releasePointerCapture?.(this.drag.pointerId);
            this.panel.classList.remove('is-dragging');
            const rect = this.panel.getBoundingClientRect();
            RadioPlayer.savePanelState({
                panelX: rect.left,
                panelY: rect.top,
                panelDocked: false
            });
            this.drag = null;
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    },

    setExpanded(on) {
        this.expanded = on;
        const panel = this.panel;
        if (!panel) return;

        panel.classList.toggle('is-expanded', on);
        const dockBtn = panel.querySelector('[data-radio-pop-dock]');
        dockBtn?.classList.toggle('is-hidden', !on);

        const expandBtn = panel.querySelector('[data-radio-pop-expand]');
        if (expandBtn) {
            expandBtn.innerHTML = on ? ACTION_ICONS.collapseAll : ACTION_ICONS.expandAll;
            expandBtn.title = on ? 'Compact panel' : 'Expand panel';
            expandBtn.setAttribute('aria-label', expandBtn.title);
        }

        if (on) {
            const saved = RadioPlayer.getPanelState();
            this.docked = saved.panelDocked !== false;
            panel.classList.toggle('is-undocked', !this.docked);
            this.updateDockButton();
            if (this.docked) {
                positionPanelBesideSidebar(panel, this.anchor);
            } else if (Number.isFinite(saved.panelX) && Number.isFinite(saved.panelY)) {
                const next = clampPanelToViewport(panel, saved.panelX, saved.panelY);
                panel.style.left = `${next.x}px`;
                panel.style.top = `${next.y}px`;
            } else {
                positionPanelBesideSidebar(panel, this.anchor);
            }
        } else {
            panel.classList.remove('is-undocked');
            positionPopoverBelowAnchor(panel, this.anchor);
        }
    },

    toggleDock() {
        if (!this.expanded) return;
        this.docked = !this.docked;
        this.panel?.classList.toggle('is-undocked', !this.docked);
        this.updateDockButton();

        if (this.docked) {
            RadioPlayer.savePanelState({ panelDocked: true, panelX: null, panelY: null });
            positionPanelBesideSidebar(this.panel, this.anchor);
        } else {
            const rect = this.panel.getBoundingClientRect();
            RadioPlayer.savePanelState({
                panelDocked: false,
                panelX: rect.left,
                panelY: rect.top
            });
        }
    },

    updateDockButton() {
        const dockBtn = this.panel?.querySelector('[data-radio-pop-dock]');
        if (!dockBtn) return;
        dockBtn.innerHTML = this.docked ? CARD_ICONS.unpin : CARD_ICONS.pin;
        dockBtn.title = this.docked ? 'Undock panel' : 'Dock beside sidebar';
        dockBtn.setAttribute('aria-label', dockBtn.title);
    },

    open(mode, anchor, { title = 'Radio', expanded = false } = {}) {
        const wasOpen = !this.panel?.classList.contains('is-hidden');
        const sameAnchor = this.anchor === anchor && this.mode === mode;

        if (wasOpen && sameAnchor) {
            this.close();
            return;
        }

        this.close(false);
        this.anchor = anchor;
        this.mode = mode;
        this.docked = RadioPlayer.getPanelState().panelDocked !== false;

        const panel = this.ensurePanel();
        panel.classList.remove('is-hidden');
        panel.setAttribute('aria-label', title);
        panel.querySelector('[data-radio-pop-title]').textContent = title;

        anchor?.setAttribute('aria-expanded', 'true');
        this.expanded = false;
        this.setExpanded(expanded);

        if (!expanded) {
            positionPopoverBelowAnchor(panel, anchor);
        }

        this.attachListeners();
        this.attachBoundsWatcher();
    },

    attachBoundsWatcher() {
        if (this.boundsHandler) return;
        this.boundsHandler = () => {
            if (!this.panel || this.panel.classList.contains('is-hidden')) return;
            if (this.expanded && this.docked) {
                positionPanelBesideSidebar(this.panel, this.anchor);
            } else if (!this.expanded) {
                positionPopoverBelowAnchor(this.panel, this.anchor);
            }
        };
        window.addEventListener('tools:desktop_bounds_changed', this.boundsHandler);
    },

    detachBoundsWatcher() {
        if (!this.boundsHandler) return;
        window.removeEventListener('tools:desktop_bounds_changed', this.boundsHandler);
        this.boundsHandler = null;
    },

    attachListeners() {
        this.detachListeners();
        this.outsideHandler = (e) => {
            if (this.panel?.contains(e.target) || this.anchor?.contains(e.target)) return;
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
            this.anchor?.setAttribute('aria-expanded', 'false');
        }
        this.panel?.classList.add('is-hidden');
        this.anchor = null;
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
        if (!this.panel || this.panel.classList.contains('is-hidden')) return;
        if (this.expanded && this.docked) {
            positionPanelBesideSidebar(this.panel, this.anchor);
        } else if (!this.expanded) {
            positionPopoverBelowAnchor(this.panel, this.anchor);
        }
    }
};
