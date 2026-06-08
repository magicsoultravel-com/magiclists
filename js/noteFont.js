const STORAGE_KEY = 'matrix_note_font';

export const NOTE_FONTS = [
    { id: 'default', label: 'Default', desc: 'Follows app theme', family: null },
    { id: 'system-sans', label: 'System Sans', desc: 'Clean & neutral', family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
    { id: 'system-serif', label: 'Serif', desc: 'Classic book', family: "ui-serif, Georgia, 'Times New Roman', serif" },
    { id: 'system-mono', label: 'Monospace', desc: 'Code style', family: "ui-monospace, 'Cascadia Code', Consolas, monospace" },
    { id: 'inter', label: 'Inter', desc: 'Modern sans', family: "'Inter', system-ui, sans-serif" },
    { id: 'merriweather', label: 'Merriweather', desc: 'Readable serif', family: "'Merriweather', Georgia, serif" },
    { id: 'jetbrains', label: 'JetBrains Mono', desc: 'Developer mono', family: "'JetBrains Mono', monospace" },
    { id: 'caveat', label: 'Caveat', desc: 'Loose handwriting', family: "'Caveat', cursive" },
    { id: 'patrick-hand', label: 'Patrick Hand', desc: 'Neat handwriting', family: "'Patrick Hand', cursive" },
    { id: 'indie-flower', label: 'Indie Flower', desc: 'Light script', family: "'Indie Flower', cursive" },
    { id: 'kalam', label: 'Kalam', desc: 'Marker pen', family: "'Kalam', cursive" },
    { id: 'shadows-into-light', label: 'Shadows Into Light', desc: 'Sketchy notes', family: "'Shadows Into Light', cursive" },
    { id: 'sacramento', label: 'Sacramento', desc: 'Elegant script', family: "'Sacramento', cursive" },
    { id: 'comic-neue', label: 'Comic Neue', desc: 'Casual comic', family: "'Comic Neue', cursive" },
    { id: 'permanent-marker', label: 'Permanent Marker', desc: 'Bold marker', family: "'Permanent Marker', cursive" },
    { id: 'press-start', label: 'Press Start 2P', desc: 'Retro pixel', family: "'Press Start 2P', cursive", compact: true },
    { id: 'orbitron', label: 'Orbitron', desc: 'Sci-fi display', family: "'Orbitron', sans-serif" },
    { id: 'vt323', label: 'VT323', desc: 'Retro CRT terminal', family: "'VT323', monospace" },
    { id: 'share-tech-mono', label: 'Share Tech Mono', desc: 'Tech terminal', family: "'Share Tech Mono', monospace" },
    { id: 'fredericka', label: 'Fredericka', desc: 'Ornate display', family: "'Fredericka the Great', cursive" }
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
    } else {
        root.dataset.noteFont = font.id;
        root.style.setProperty('--note-font-family', font.family);
    }
}

export function isNoteFontCustomized(fontId = readNoteFont()) {
    return fontId !== 'default';
}
