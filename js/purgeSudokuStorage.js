const PURGED_KEY = 'magiclists_sudoku_purged_v1';
const PANELS_KEY = 'magiclists_tool_panels';

const SUDOKU_KEYS = [
    'magiclists-sudoku-game',
    'magiclists-sudoku-seeds',
    'magiclists-sudoku-stats',
    'magiclists-sudoku-zen',
    'magiclists-sudoku-cat',
    'magiclists-sudoku-theme'
];

export function purgeSudokuStorageIfNeeded() {
    try {
        if (localStorage.getItem(PURGED_KEY)) return;
    } catch {
        return;
    }

    SUDOKU_KEYS.forEach((key) => {
        try {
            localStorage.removeItem(key);
        } catch {
            /* ignore */
        }
    });

    try {
        const raw = localStorage.getItem(PANELS_KEY);
        if (raw) {
            const panels = JSON.parse(raw);
            if (panels && typeof panels === 'object' && 'sudoku' in panels) {
                delete panels.sudoku;
                if (Object.keys(panels).length) {
                    localStorage.setItem(PANELS_KEY, JSON.stringify(panels));
                } else {
                    localStorage.removeItem(PANELS_KEY);
                }
            }
        }
    } catch {
        /* ignore */
    }

    try {
        localStorage.setItem(PURGED_KEY, '1');
    } catch {
        /* ignore */
    }
}
