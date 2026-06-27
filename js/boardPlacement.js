import {
    PLACEMENT_STRIDE_STEPS,
    DEFAULT_PLACEMENT_STEP,
    PLACEMENT_STRIDE_STORAGE_KEY,
    applyGridFineness,
    getPlacementStridePx
} from './gridDensity.js';

function clampStep(step) {
    const n = Number(step);
    if (!Number.isFinite(n)) return DEFAULT_PLACEMENT_STEP;
    return Math.max(1, Math.min(PLACEMENT_STRIDE_STEPS.length, Math.round(n)));
}

function readStep() {
    try {
        const raw = parseInt(localStorage.getItem(PLACEMENT_STRIDE_STORAGE_KEY), 10);
        return clampStep(raw);
    } catch {
        return DEFAULT_PLACEMENT_STEP;
    }
}

function writeStep(step) {
    const next = clampStep(step);
    localStorage.setItem(PLACEMENT_STRIDE_STORAGE_KEY, String(next));
    return next;
}

export const BoardPlacement = {
    STEP_MIN: 1,
    STEP_MAX: PLACEMENT_STRIDE_STEPS.length,
    DEFAULT_STEP: DEFAULT_PLACEMENT_STEP,

    getStep() {
        return readStep();
    },

    getStridePx(step = readStep()) {
        return getPlacementStridePx(step);
    },

    setStep(step) {
        const next = writeStep(step);
        applyGridFineness();
        window.dispatchEvent(new CustomEvent('board:placement_stride_changed', { detail: next }));
        return next;
    },

    step(delta) {
        return this.setStep(readStep() + delta);
    },

    apply() {
        applyGridFineness();
        this.updateLabels();
    },

    isCustomized() {
        return readStep() !== DEFAULT_PLACEMENT_STEP;
    },

    updateLabels() {
        const step = readStep();
        const px = getPlacementStridePx(step);
        const outBtn = document.getElementById('display-opt-placement-stride-out');
        const inBtn = document.getElementById('display-opt-placement-stride-in');
        const label = document.getElementById('display-opt-placement-stride-label');
        if (outBtn) outBtn.disabled = step <= this.STEP_MIN;
        if (inBtn) inBtn.disabled = step >= this.STEP_MAX;
        if (label) label.textContent = `${px}px`;
    },

    init() {
        applyGridFineness();
    }
};
