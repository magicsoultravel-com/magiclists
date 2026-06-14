const MIN_VISIBLE_MS = 400;
const HOLD_AT_100_MS = 200;
const FADE_MS = 280;

let root = null;
let bar = null;
let status = null;
let shownAt = 0;
let currentPct = 0;

function clampPct(pct) {
    return Math.min(100, Math.max(0, Number(pct) || 0));
}

export const BootProgress = {
    init() {
        root = document.getElementById('app-boot');
        bar = document.getElementById('app-boot-bar');
        status = document.getElementById('app-boot-status');
        if (!root || !bar) return;
        shownAt = Date.now();
        root.classList.remove('is-indeterminate');
        bar.style.transform = '';
        this.set(0);
    },

    set(pct, label) {
        if (!root || !bar) return;
        currentPct = clampPct(pct);
        bar.style.width = `${currentPct}%`;
        root.setAttribute('aria-valuenow', String(Math.round(currentPct)));
        if (label && status) status.textContent = label;
    },

    async complete() {
        if (!root || !bar) {
            document.body?.removeAttribute('aria-busy');
            return;
        }

        this.set(100);

        const elapsed = Date.now() - (shownAt || Date.now());
        const minWait = Math.max(0, MIN_VISIBLE_MS - elapsed);
        if (minWait) await new Promise((r) => setTimeout(r, minWait));

        await new Promise((r) => setTimeout(r, HOLD_AT_100_MS));

        root.classList.add('is-hiding');
        document.body?.removeAttribute('aria-busy');

        await new Promise((r) => setTimeout(r, FADE_MS));
        root.remove();
        root = null;
        bar = null;
        status = null;
    }
};
