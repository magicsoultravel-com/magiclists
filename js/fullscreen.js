import { ACTION_ICONS } from './icons.js';

function isSupported() {
    return typeof document.documentElement.requestFullscreen === 'function';
}

export const Fullscreen = {
    buttons: new Set(),
    supported: isSupported(),

    init() {
        this.buttons = new Set();
        const btn = document.getElementById('btn-fullscreen');
        if (btn) this.registerButton(btn);

        if (!this.supported) {
            this.buttons.forEach((b) => {
                b.disabled = true;
                b.title = 'Full screen not supported';
                b.setAttribute('aria-label', 'Full screen not supported');
            });
            return;
        }

        document.addEventListener('fullscreenchange', () => this.syncButtons());
        this.syncButtons();
    },

    registerButton(btn) {
        if (!btn || this.buttons.has(btn)) return;
        this.buttons.add(btn);
        btn.addEventListener('click', () => this.toggle());
        this.syncButtons();
    },

    rebindMainButton() {
        const btn = document.getElementById('btn-fullscreen');
        if (!btn) return;
        for (const b of [...this.buttons]) {
            if (!b.isConnected) this.buttons.delete(b);
        }
        if (!this.buttons.has(btn)) this.registerButton(btn);
        else this.syncButtons();
    },

    isActive() {
        return Boolean(document.fullscreenElement);
    },

    async enter() {
        if (!this.supported) return;
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

    syncButtons() {
        const active = this.isActive();
        const label = active ? 'Back to normal' : 'Full screen';
        this.buttons.forEach((btn) => {
            if (btn.disabled && !this.supported) return;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-pressed', active ? 'true' : 'false');
            btn.innerHTML = active ? ACTION_ICONS.fullscreenExit : ACTION_ICONS.fullscreenEnter;
            btn.title = label;
            btn.setAttribute('aria-label', label);
        });
    }
};
