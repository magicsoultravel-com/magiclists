const STORAGE_KEY = 'matrix_note_font';

export const NOTE_FONTS = [
    { id: 'default', label: 'Theme default', desc: 'Use theme\'s font', family: null },
    { id: 'system-ui', label: 'System UI', desc: 'Clean standard sans', family: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
    { id: 'handwriting', label: 'Handwriting', desc: 'Neat script style', family: "'Patrick Hand', cursive" },
    { id: 'caveat', label: 'Caveat', desc: 'Casual handwritten', family: "'Caveat', cursive" },
    { id: 'comic-neue', label: 'Comic Neue', desc: 'Comic-style sans', family: "'Comic Neue', cursive" },
    { id: 'courier-prime', label: 'Courier Prime', desc: 'Monospaced typewriter', family: "'Courier Prime', monospace" },
    { id: 'fredericka', label: 'Fredericka the Great', desc: 'Elegant serif', family: "'Fredericka the Great', cursive" },
    { id: 'ibm-plex-mono', label: 'IBM Plex Mono', desc: 'Technical monospace', family: "'IBM Plex Mono', monospace" },
    { id: 'indie-flower', label: 'Indie Flower', desc: 'Playful handwritten', family: "'Indie Flower', cursive" },
    { id: 'inter', label: 'Inter', desc: 'Modern sans-serif', family: "'Inter', system-ui, sans-serif" },
    { id: 'jetbrains-mono', label: 'JetBrains Mono', desc: 'Coding monospace', family: "'JetBrains Mono', monospace" },
    { id: 'kalam', label: 'Kalam', desc: 'Friendly handwriting', family: "'Kalam', cursive" },
    { id: 'libre-baskerville', label: 'Libre Baskerville', desc: 'Classic serif', family: "'Libre Baskerville', serif" },
    { id: 'merriweather', label: 'Merriweather', desc: 'Readable serif', family: "'Merriweather', serif" },
    { id: 'orbitron', label: 'Orbitron', desc: 'Digital display', family: "'Orbitron', sans-serif" },
    { id: 'overpass-mono', label: 'Overpass Mono', desc: 'Clean monospace', family: "'Overpass Mono', monospace" },
    { id: 'permanent-marker', label: 'Permanent Marker', desc: 'Marker brush', family: "'Permanent Marker', cursive" },
    { id: 'press-start', label: 'Press Start 2P', desc: 'Retro pixel', family: "'Press Start 2P', monospace" },
    { id: 'sacramento', label: 'Sacramento', desc: 'Elegant script', family: "'Sacramento', cursive" },
    { id: 'shadows-into-light', label: 'Shadows Into Light', desc: 'Light handwriting', family: "'Shadows Into Light', cursive" },
    { id: 'share-tech-mono', label: 'Share Tech Mono', desc: 'Tech monospace', family: "'Share Tech Mono', monospace" },
    { id: 'special-elite', label: 'Special Elite', desc: 'Typewriter', family: "'Special Elite', monospace" },
    { id: 'vt323', label: 'VT323', desc: 'Terminal font', family: "'VT323', monospace" }
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