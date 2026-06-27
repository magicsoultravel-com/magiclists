const STORAGE_KEY = 'matrix_board_overlay';
const MIGRATION_FLAG = 'matrix_board_overlay_migrated';

function readOverlay() {
    return localStorage.getItem(STORAGE_KEY) === '1';
}

function writeOverlay(enabled) {
    if (enabled) {
        localStorage.setItem(STORAGE_KEY, '1');
    } else {
        localStorage.removeItem(STORAGE_KEY);
    }
}

export function isBoardOverlayEnabled() {
    return readOverlay();
}

export function applyBoardOverlayDom(enabled = readOverlay()) {
    document.documentElement.dataset.boardOverlay = enabled ? '1' : '0';
}

export const BoardOverlay = {
    isEnabled() {
        return readOverlay();
    },

    setEnabled(enabled) {
        writeOverlay(!!enabled);
        applyBoardOverlayDom(!!enabled);
        window.dispatchEvent(new CustomEvent('board:overlay_changed', { detail: !!enabled }));
        return !!enabled;
    },

    toggle() {
        return this.setEnabled(!readOverlay());
    },

    init() {
        applyBoardOverlayDom(readOverlay());
    },

    isMigrationComplete() {
        return localStorage.getItem(MIGRATION_FLAG) === '1';
    },

    markMigrationComplete() {
        try {
            localStorage.setItem(MIGRATION_FLAG, '1');
        } catch {
            /* ignore */
        }
    }
};

export { MIGRATION_FLAG as BOARD_OVERLAY_MIGRATION_FLAG };
