const STORAGE_KEY = 'matrix_note_font';

// 3-way typography toggle: Theme Default, System UI, Handwriting
export const NOTE_FONTS = [
    { id: 'default', label: 'Theme default', desc: 'Use theme\'s font', family: null },
    { id: 'system-ui', label: 'System UI', desc: 'Clean standard sans', family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
    { id: 'handwriting', label: 'Handwriting', desc: 'Neat script style', family: "'Patrick Hand', cursive" }
];

export function getNoteFontById(fontId) {
    return NOTE_FONTS.find((f) => f.id === fontId) || NOTE_FONTS[0];
}

export function readNoteFont() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && NOTE_FONTS.some((f) => f.id === stored)) return stored;
    } catch {
        /* ignore */
    }
    return 'default';
}

export function writeNoteFont(fontId) {
    try {
        localStorage.setItem(STORAGE_KEY, fontId);
    } catch {
        /* ignore */
    }
}

export function applyNoteFont(fontId = readNoteFont()) {
    const font = getNoteFontById(fontId);
    const root = document.documentElement;

    if (font.id === 'default') {
        root.dataset.noteFont = 'default';
        root.style.removeProperty('--note-font-family');
        root.style.removeProperty('font-family');
    } else {
        root.dataset.noteFont = font.id;
        root.style.setProperty('--note-font-family', font.family);
        root.style.setProperty('font-family', font.family);
    }
}

export function isNoteFontCustomized(fontId = readNoteFont()) {
    return fontId !== 'default';
}