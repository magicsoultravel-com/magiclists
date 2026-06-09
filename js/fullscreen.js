import { ACTION_ICONS } from './ui.js';

function isSupported() {
    return typeof document.documentElement.requestFullscreen === 'function';
}

export const Fullscreen = {
    btn: null,

    init() {
        this.btn = document.getElementById('btn-fullscreen');
        if (!this.btn) return;

        if (!isSupported()) {
            this.btn.disabled = true;
            this.btn.title = 'Full screen not supported';
            this.btn.setAttribute('aria-label', 'Full screen not supported');
            return;
        }

        this.btn.addEventListener('click', () => this.toggle());
        document.addEventListener('fullscreenchange', () => this.syncButton());
        this.syncButton();
    },

    isActive() {
        return Boolean(document.fullscreenElement);
    },

    async enter() {
        if (!isSupported()) return;
        try {
            await document.documentElement.requestFullscreen();
        } catch {
            /* user gesture denied or policy */
        }
    },

    async exit() {
        if (!document.fullscreenElement) return;
        try {
            await document.exitFullscreen();
        } catch {
            /* ignore */
        }
    },

    toggle() {
        if (this.isActive()) this.exit();
        else this.enter();
    },

    syncButton() {
        const btn = this.btn;
        if (!btn || btn.disabled) return;

        const active = this.isActive();
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.innerHTML = active ? ACTION_ICONS.fullscreenExit : ACTION_ICONS.fullscreenEnter;
        const label = active ? 'Back to normal' : 'Full screen';
        btn.title = label;
        btn.setAttribute('aria-label', label);
    }
};
