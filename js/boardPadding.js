import { applyGridFineness, getGridMetrics, GridFineness } from './gridDensity.js';

export const STORAGE_KEY = 'matrix_board_padding';
export const INSET_BASE_PX = 14;
export const PADDING_STEPS_PX = [2, 5, 8, 11, 14, 15, 17];
export const DEFAULT_STEP = 5;
export const STEP_MIN = 1;
export const STEP_MAX = PADDING_STEPS_PX.length;

function clampPaddingStep(step) {
    const n = Number(step);
    if (!Number.isFinite(n)) return DEFAULT_STEP;
    return Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round(n)));
}

function readPaddingStep() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw == null) return null;
        return clampPaddingStep(parseInt(raw, 10));
    } catch {
        return null;
    }
}

function writePaddingStep(step) {
    const next = clampPaddingStep(step);
    try {
        localStorage.setItem(STORAGE_KEY, String(next));
    } catch {
        /* ignore */
    }
    return next;
}

export function getBoardPaddingScale(step = readPaddingStep() ?? DEFAULT_STEP) {
    const index = clampPaddingStep(step) - 1;
    return PADDING_STEPS_PX[index] / INSET_BASE_PX;
}

export function isBoardPaddingCustomized(step = readPaddingStep()) {
    return step != null && step !== DEFAULT_STEP;
}

export const BoardPadding = {
    PADDING_STEPS_PX,
    INSET_BASE_PX,
    DEFAULT_STEP,
    STEP_MIN,
    STEP_MAX,

    getStep() {
        return readPaddingStep() ?? DEFAULT_STEP;
    },

    getLabel(step = this.getStep()) {
        const index = clampPaddingStep(step) - 1;
        return `${PADDING_STEPS_PX[index]}px`;
    },

    getScale(step = this.getStep()) {
        return getBoardPaddingScale(step);
    },

    apply() {
        const scale = getBoardPaddingScale();
        document.documentElement.style.setProperty('--board-padding-scale', String(scale));
        this.updateLabels();
    },

    setStep(step) {
        const prev = getGridMetrics();
        const nextStep = writePaddingStep(step);
        this.apply();
        const next = applyGridFineness(GridFineness.getStep());
        window.dispatchEvent(new CustomEvent('appearance:board_padding_changed', {
            detail: { step: nextStep, prevMetrics: prev, nextMetrics: next }
        }));
        return nextStep;
    },

    step(delta) {
        return this.setStep(this.getStep() + delta);
    },

    isCustomized() {
        return isBoardPaddingCustomized();
    },

    updateLabels() {
        const step = this.getStep();
        const label = this.getLabel(step);
        document.getElementById('display-opt-board-spacing-label')?.replaceChildren(document.createTextNode(label));
        const outBtn = document.getElementById('display-opt-board-spacing-out');
        const inBtn = document.getElementById('display-opt-board-spacing-in');
        if (outBtn) outBtn.disabled = step <= STEP_MIN;
        if (inBtn) inBtn.disabled = step >= STEP_MAX;
    },

    init() {
        this.apply();
    }
};
