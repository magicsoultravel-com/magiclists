const STORAGE_KEY = 'magiclists-sudoku-theme';
const THEMES = [
    { id: 'dark', label: 'Dark', swatch: '#1a2332' },
    { id: 'light', label: 'Light', swatch: '#f4f4f5' },
    { id: 'blue', label: 'Ocean', swatch: '#3b82f6' },
    { id: 'green', label: 'Forest', swatch: '#22c55e' }
];

export function readSudokuTheme() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        return THEMES.some((t) => t.id === saved) ? saved : 'dark';
    } catch {
        return 'dark';
    }
}

export function writeSudokuTheme(id) {
    try {
        localStorage.setItem(STORAGE_KEY, id);
    } catch {
        /* ignore */
    }
}

export function applySudokuTheme(root, themeId) {
    if (!root) return;
    const id = THEMES.some((t) => t.id === themeId) ? themeId : 'dark';
    root.dataset.sudokuTheme = id;
    root.querySelectorAll('[data-sudoku-theme-dot]').forEach((btn) => {
        const active = btn.dataset.sudokuThemeDot === id;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
}

export function renderThemeDots() {
    return `<div class="sudoku-theme-dots" role="radiogroup" aria-label="Sudoku theme">
        ${THEMES.map((t) => `<button type="button" class="sudoku-theme-dot" data-sudoku-theme-dot="${t.id}" role="radio" aria-checked="false" aria-label="${t.label}" title="${t.label}" style="--dot-color:${t.swatch}"></button>`).join('')}
    </div>`;
}

export function bindThemeDots(root, onChange) {
    const handler = (e) => {
        const btn = e.target.closest('[data-sudoku-theme-dot]');
        if (!btn || !root.contains(btn)) return;
        const id = btn.dataset.sudokuThemeDot;
        writeSudokuTheme(id);
        applySudokuTheme(root, id);
        onChange?.(id);
    };
    root.addEventListener('click', handler);
    return () => root.removeEventListener('click', handler);
}

export function initSudokuTheme(root) {
    applySudokuTheme(root, readSudokuTheme());
    return bindThemeDots(root);
}
