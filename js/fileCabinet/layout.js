/** @module {"owns":"file cabinet drawer metrics - cascade geometry, drawer height, UI scale and the stack positioner every rail layer reuses", "related":["fileCabinet.js","fileCabinet/chrome.js","fileCabinet/render.js","fileCabinet/drag.js","tileGeometry.js"]} */
import { getLabelRect } from '../tileGeometry.js';

export const FILE_CABINET_STACK_OFFSET_Y = 18;
export const FILE_CABINET_STACK_OFFSET_X = 10;
export const FILE_CABINET_DRAWER_WIDTH = 160;
export const FILE_CABINET_DRAWER_MIN_CARDS = 4;
export const FILE_CABINET_DRAWER_CARDS_PER_COL = 8;
export const FILE_CABINET_COL_GAP = 0;
export const FILE_CABINET_MIN_HEIGHT = 96;
export const FILE_CABINET_REF_HEIGHT = 220;
export const FILE_CABINET_MIN_HEIGHT_RATIO = 0.5;
const FILE_CABINET_CATEGORY_HEADER_PAD = 20;
export const DRAG_THRESHOLD = 4;

export function getFileCabinetDragMinHeight() {
    return FILE_CABINET_REF_HEIGHT * FILE_CABINET_MIN_HEIGHT_RATIO;
}

export function collapsedTabWidth() {
    return getLabelRect().w;
}

/** Width of a single cascaded column (px): first tab plus one OFFSET_X per extra note in that column. */
export function fileCabinetCascadeWidth(count) {
    const slots = Math.max(count || 0, 1);
    return collapsedTabWidth() + (slots - 1) * FILE_CABINET_STACK_OFFSET_X;
}

/** Height of a cascaded column (px): first tab plus one OFFSET_Y per extra note in that column. */
export function fileCabinetCascadeHeight(count) {
    const slots = Math.max(count || 0, 1);
    return getLabelRect().h + (slots - 1) * FILE_CABINET_STACK_OFFSET_Y;
}

export function fileCabinetCascadeCol(index) {
    return Math.floor(Math.max(0, index) / FILE_CABINET_DRAWER_CARDS_PER_COL);
}

export function fileCabinetCascadeSlot(index) {
    return Math.max(0, index) % FILE_CABINET_DRAWER_CARDS_PER_COL;
}

/**
 * Pitch between cascade column origins.
 * Perceived gap = left-col leading-tab right edge → right-col left edge
 * (= cascade fan + COL_GAP when columns sit fully past each other).
 * Use half of that so columns sit 50% closer without stacking on the same origin.
 */
export function fileCabinetStackPitch() {
    const fan = (FILE_CABINET_DRAWER_CARDS_PER_COL - 1) * FILE_CABINET_STACK_OFFSET_X;
    return collapsedTabWidth() + Math.round((fan + FILE_CABINET_COL_GAP) / 2);
}

export function fileCabinetTabLeft(index) {
    return fileCabinetCascadeCol(index) * fileCabinetStackPitch()
        + fileCabinetCascadeSlot(index) * FILE_CABINET_STACK_OFFSET_X;
}

export function fileCabinetTabTop(index) {
    return fileCabinetCascadeSlot(index) * FILE_CABINET_STACK_OFFSET_Y;
}

/** Stack height for N notes: capped at one column of FILE_CABINET_DRAWER_CARDS_PER_COL. */
export function fileCabinetStackHeight(count) {
    const capped = Math.min(Math.max(count || 0, 1), FILE_CABINET_DRAWER_CARDS_PER_COL);
    return fileCabinetCascadeHeight(capped);
}

/** Total width of a multi-column wrapped stack (px). */
export function fileCabinetStackWidth(count) {
    const n = Math.max(count || 0, 1);
    const cols = Math.ceil(n / FILE_CABINET_DRAWER_CARDS_PER_COL);
    if (cols <= 1) return fileCabinetCascadeWidth(n);
    const lastCount = n - (cols - 1) * FILE_CABINET_DRAWER_CARDS_PER_COL;
    return (cols - 1) * fileCabinetStackPitch() + fileCabinetCascadeWidth(lastCount);
}

/** Left+right padding on `.file-cabinet-category` (shelf inset around the notes). */
export function fileCabinetCategoryPadX(colEl) {
    if (!colEl) return 0;
    const styles = getComputedStyle(colEl);
    return (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
}

/**
 * Open drawer: stack = note cascade width; shelf = stack + CSS L/R padding.
 * Without the pad, border-box sizing makes the rightmost note (e.g. Tunes) stick
 * out past the shelf background while left/bottom still look inset.
 */
export function applyOpenDrawerStackDimensions(stackEl, count) {
    const stackW = fileCabinetStackWidth(count);
    const stackH = Math.max(fileCabinetStackHeight(count), fileCabinetDrawerMinHeight());
    stackEl.style.width = `${stackW}px`;
    stackEl.style.minWidth = `${stackW}px`;
    stackEl.style.height = `${stackH}px`;
    const col = stackEl.closest('.file-cabinet-category');
    if (!col) return;
    const colW = Math.max(stackW + fileCabinetCategoryPadX(col), FILE_CABINET_DRAWER_WIDTH);
    col.style.width = `${colW}px`;
    col.style.minWidth = `${colW}px`;
    col.style.flexBasis = `${colW}px`;
}

/** Open-drawer minimum stack height: fits FILE_CABINET_DRAWER_MIN_CARDS cards. */
export function fileCabinetDrawerMinHeight() {
    return fileCabinetCascadeHeight(FILE_CABINET_DRAWER_MIN_CARDS);
}

/** Insert index from pointer position inside a tab stack (2D wrap-aware). */
export function fileCabinetInsertIndexFromPoint(stackEl, clientX, clientY, tabCount) {
    const rect = stackEl.getBoundingClientRect();
    const scale = getFileCabinetUiScale(stackEl.closest('#file-cabinet')) || 1;
    const dx = (clientX - rect.left) / scale;
    const dy = (clientY - rect.top) / scale;
    const pitch = fileCabinetStackPitch();
    const maxCol = Math.max(0, Math.ceil(Math.max(tabCount, 1) / FILE_CABINET_DRAWER_CARDS_PER_COL));
    let col = Math.floor(dx / pitch);
    col = Math.max(0, Math.min(maxCol, col));
    let slot = Math.floor(dy / FILE_CABINET_STACK_OFFSET_Y);
    slot = Math.max(0, Math.min(FILE_CABINET_DRAWER_CARDS_PER_COL, slot));
    const insertIndex = col * FILE_CABINET_DRAWER_CARDS_PER_COL + slot;
    return Math.max(0, Math.min(tabCount, insertIndex));
}

export function getFileCabinetUiScale(mount) {
    if (!mount) return 1;
    const raw = parseFloat(getComputedStyle(mount).getPropertyValue('--file-cabinet-ui-scale'));
    return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

export function getFileCabinetContentMinHeight(mount) {
    if (!mount) return FILE_CABINET_MIN_HEIGHT;
    const label = getLabelRect();
    let maxStackH = label.h;
    mount.querySelectorAll('.file-cabinet-tab-stack').forEach((stack) => {
        if (stack.closest('.file-cabinet-filed-rollout')) return;
        const count = stack.querySelectorAll('.file-cabinet-tab').length;
        // Include the open-drawer minimum so the cabinet can't drag shorter than it.
        maxStackH = Math.max(maxStackH, fileCabinetStackHeight(count), fileCabinetDrawerMinHeight());
    });

    let contentH = maxStackH + FILE_CABINET_CATEGORY_HEADER_PAD;

    const rail = mount.querySelector('.file-cabinet-filed-rail');
    if (rail) {
        const scale = getFileCabinetUiScale(mount);
        const railNatural = rail.getBoundingClientRect().height / scale;
        if (Number.isFinite(railNatural) && railNatural > 0) {
            contentH = Math.max(contentH, railNatural);
        }
    }

    const styles = getComputedStyle(mount);
    const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    return contentH + padY;
}

export function applyFileCabinetStackPositions(stackEl) {
    if (!stackEl) return;
    const tabs = [...stackEl.querySelectorAll('.file-cabinet-tab')];
    const label = getLabelRect();
    const count = tabs.length;
    const stackHeight = fileCabinetStackHeight(count);
    const rollout = stackEl.closest('.file-cabinet-filed-rollout');

    if (rollout) {
        // Preview adapts to the notes: stack width = wrapped tab cascade; the popover
        // shrink-wraps via CSS (min-width keeps the chip-width floor).
        stackEl.style.width = `${fileCabinetStackWidth(count)}px`;
        stackEl.style.minWidth = '';
        stackEl.style.height = `${Math.max(stackHeight, label.h)}px`;
        rollout.style.width = '';
        rollout.style.minWidth = '';
        rollout.style.height = '';
    } else {
        applyOpenDrawerStackDimensions(stackEl, count);
    }

    let layoutIndex = 0;
    tabs.forEach((card) => {
        if (card.classList.contains('is-file-cabinet-dragging')) return;
        card.style.position = 'absolute';
        card.style.left = `${fileCabinetTabLeft(layoutIndex)}px`;
        card.style.top = `${fileCabinetTabTop(layoutIndex)}px`;
        card.style.width = `${collapsedTabWidth()}px`;
        card.style.height = `${label.h}px`;
        card.style.zIndex = String(layoutIndex + 1);
        card.dataset.fileCabinetStackIndex = String(layoutIndex);
        layoutIndex++;
    });
}
