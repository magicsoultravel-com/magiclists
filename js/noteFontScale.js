const STORAGE_KEY = 'matrix_note_font_scale';
const SCALE_MIN = 0.85;
const SCALE_MAX = 1.25;
const SCALE_STEP = 0.05;
const SCALE_DEFAULT = 1;

function clampScale(value) {
    return Math.round(Math.max(SCALE_MIN, Math.min(SCALE_MAX, value)) * 100) / 100;
}

function readScale() {
    try {
        const raw = parseFloat(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(raw) ? clampScale(raw) : SCALE_DEFAULT;
    } catch {
        return SCALE_DEFAULT;
    }
}

function writeScale(value) {
    const next = clampScale(value);
    localStorage.setItem(STORAGE_KEY, String(next));
    return next;
}

export const NoteFontScale = {
    SCALE_MIN,
    SCALE_MAX,
    SCALE_STEP,
    SCALE_DEFAULT,

    getScale() {
        return readScale();
    },

    setScale(value) {
        const next = writeScale(value);
        this.apply();
        window.dispatchEvent(new CustomEvent('note:font_scale_changed', { detail: next }));
        return next;
    },

    step(delta) {
        return this.setScale(readScale() + delta);
    },

    apply() {
        const scale = readScale();
        document.documentElement.style.setProperty('--note-font-scale', String(scale));
        this.updateLabels();
    },

    isCustomized() {
        return Math.abs(readScale() - SCALE_DEFAULT) > 0.001;
    },

    updateLabels() {
        const scale = readScale();
        const pct = `${Math.round(scale * 100)}%`;
        document.getElementById('display-opt-note-scale-label')?.replaceChildren(document.createTextNode(pct));
        const outBtn = document.getElementById('display-opt-note-scale-out');
        const inBtn = document.getElementById('display-opt-note-scale-in');
        if (outBtn) outBtn.disabled = scale <= SCALE_MIN + 0.001;
        if (inBtn) inBtn.disabled = scale >= SCALE_MAX - 0.001;
    },

    init() {
        this.apply();
    }
};
