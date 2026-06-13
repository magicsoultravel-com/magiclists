import { DesktopBackground } from './desktopBackground.js';
import { ChromeBackground } from './chromeBackground.js';

const STORAGE_KEY = 'matrix_app_theme';

const TOKEN_KEYS = [
    '--bg-primary',
    '--bg-surface',
    '--bg-card',
    '--text-main',
    '--text-muted',
    '--accent',
    '--border-color',
    '--desktop-bg',
    '--chrome-bg'
];

export const APP_THEMES = [
    {
        id: 'dark',
        label: 'Dark',
        desc: 'Default workspace',
        swatch: ['#121214', '#26262b', '#4f46e5'],
        tokens: {
            '--bg-primary': '#121214',
            '--bg-surface': '#121214',
            '--bg-card': '#26262b',
            '--text-main': '#e2e2e9',
            '--text-muted': '#8b8b93',
            '--accent': '#4f46e5',
            '--border-color': '#323238',
            '--desktop-bg': '#121214',
            '--chrome-bg': '#151519'
        }
    },
    {
        id: 'light',
        label: 'Light',
        desc: 'Bright surfaces',
        swatch: ['#f4f4f5', '#ffffff', '#4f46e5'],
        tokens: {
            '--bg-primary': '#f4f4f5',
            '--bg-surface': '#ffffff',
            '--bg-card': '#ffffff',
            '--text-main': '#18181b',
            '--text-muted': '#71717a',
            '--accent': '#4f46e5',
            '--border-color': '#e4e4e7',
            '--desktop-bg': '#ececef',
            '--chrome-bg': '#ffffff'
        }
    },
    {
        id: 'black',
        label: 'OLED Black',
        desc: 'True black for OLED displays',
        swatch: ['#000000', '#000000', '#6366f1'],
        tokens: {
            '--bg-primary': '#000000',
            '--bg-surface': '#000000',
            '--bg-card': '#000000',
            '--text-main': '#f4f4f5',
            '--text-muted': '#71717a',
            '--accent': '#6366f1',
            '--border-color': '#1a1a1a',
            '--desktop-bg': '#000000',
            '--chrome-bg': '#000000'
        }
    },
    {
        id: 'white',
        label: 'White',
        desc: 'Clean bright',
        swatch: ['#ffffff', '#fafafa', '#6366f1'],
        tokens: {
            '--bg-primary': '#ffffff',
            '--bg-surface': '#fafafa',
            '--bg-card': '#ffffff',
            '--text-main': '#09090b',
            '--text-muted': '#52525b',
            '--accent': '#6366f1',
            '--border-color': '#e4e4e7',
            '--desktop-bg': '#f8f8f8',
            '--chrome-bg': '#ffffff'
        }
    },
    {
        id: 'blue',
        label: 'Blue',
        desc: 'Cool navy',
        swatch: ['#0f172a', '#1e293b', '#3b82f6'],
        tokens: {
            '--bg-primary': '#0f172a',
            '--bg-surface': '#111c33',
            '--bg-card': '#1e293b',
            '--text-main': '#e2e8f0',
            '--text-muted': '#94a3b8',
            '--accent': '#3b82f6',
            '--border-color': '#334155',
            '--desktop-bg': '#0f172a',
            '--chrome-bg': '#111c33'
        }
    },
    {
        id: 'turquoise',
        label: 'Turquoise',
        desc: 'Teal accent',
        swatch: ['#042f2e', '#134e4a', '#2dd4bf'],
        tokens: {
            '--bg-primary': '#042f2e',
            '--bg-surface': '#0a3d3a',
            '--bg-card': '#134e4a',
            '--text-main': '#ccfbf1',
            '--text-muted': '#5eead4',
            '--accent': '#2dd4bf',
            '--border-color': '#115e59',
            '--desktop-bg': '#042f2e',
            '--chrome-bg': '#0a3d3a'
        }
    },
    {
        id: 'greenish',
        label: 'Greenish',
        desc: 'Olive tones',
        swatch: ['#14532d', '#1a2e1a', '#84cc16'],
        tokens: {
            '--bg-primary': '#0f1a12',
            '--bg-surface': '#142018',
            '--bg-card': '#1a2e1a',
            '--text-main': '#ecfccb',
            '--text-muted': '#a3e635',
            '--accent': '#84cc16',
            '--border-color': '#365314',
            '--desktop-bg': '#0f1a12',
            '--chrome-bg': '#142018'
        }
    },
    {
        id: 'monochrome',
        label: 'Monochrome',
        desc: 'Grayscale notes',
        special: 'monochrome',
        swatch: ['#141414', '#2a2a2a', '#9ca3af'],
        tokens: {
            '--bg-primary': '#101010',
            '--bg-surface': '#141414',
            '--bg-card': '#1c1c1c',
            '--text-main': '#f0f0f0',
            '--text-muted': '#9ca3af',
            '--accent': '#a3a3a3',
            '--border-color': '#3f3f3f',
            '--desktop-bg': '#101010',
            '--chrome-bg': '#141414'
        }
    },
    {
        id: 'matrix',
        label: 'Matrix',
        desc: 'Terminal green',
        special: 'matrix',
        swatch: ['#020402', '#0a140a', '#39ff65'],
        tokens: {
            '--bg-primary': '#020402',
            '--bg-surface': '#050a05',
            '--bg-card': '#0a140a',
            '--text-main': '#39ff65',
            '--text-muted': 'rgba(57, 255, 101, 0.62)',
            '--accent': '#39ff65',
            '--border-color': 'rgba(57, 255, 65, 0.22)',
            '--desktop-bg': '#020402',
            '--chrome-bg': '#050a05'
        }
    },
    {
        id: 'casual',
        label: 'Casual',
        desc: 'Lined notepad',
        special: 'casual',
        swatch: ['#e8e4d9', '#fffef9', '#3b6ea8'],
        tokens: {
            '--bg-primary': '#e8e4d9',
            '--bg-surface': '#f0ece3',
            '--bg-card': '#fffef9',
            '--text-main': '#2c4a6e',
            '--text-muted': '#6b8ab0',
            '--accent': '#3b6ea8',
            '--border-color': '#c9d4e4',
            '--desktop-bg': '#e8e4d9',
            '--chrome-bg': '#f5f1e8'
        }
    },
    {
        id: 'casual-dark',
        label: 'Casual Dark',
        desc: 'Dark lined notepad',
        special: 'casual-dark',
        swatch: ['#1a1c20', '#2a2e36', '#6b9fd4'],
        tokens: {
            '--bg-primary': '#1a1c20',
            '--bg-surface': '#22252b',
            '--bg-card': '#2a2e36',
            '--text-main': '#dce6f2',
            '--text-muted': '#8fa8c4',
            '--accent': '#6b9fd4',
            '--border-color': '#3a4150',
            '--desktop-bg': '#1a1c20',
            '--chrome-bg': '#22252b'
        }
    },
    {
        id: 'wood',
        label: 'Wood',
        desc: 'Old furniture desk',
        special: 'wood',
        swatch: ['#a67c3a', '#f5e8b8', '#c9a227'],
        tokens: {
            '--bg-primary': '#3d2817',
            '--bg-surface': '#4a3220',
            '--bg-card': '#f5e8b8',
            '--text-main': '#f0e6d0',
            '--text-muted': '#b8a080',
            '--accent': '#c9a227',
            '--border-color': '#6b4c2a',
            '--desktop-bg': '#a67c3a',
            '--chrome-bg': '#5c3317'
        }
    },
    {
        id: 'corkboard',
        label: 'Corkboard',
        desc: 'Bulletin board',
        special: 'corkboard',
        swatch: ['#c4a06a', '#faf6ef', '#c0392b'],
        tokens: {
            '--bg-primary': '#5c4028',
            '--bg-surface': '#6b5030',
            '--bg-card': '#faf6ef',
            '--text-main': '#f0ece6',
            '--text-muted': '#c4a888',
            '--accent': '#c0392b',
            '--border-color': '#8b6840',
            '--desktop-bg': '#c4a06a',
            '--chrome-bg': '#6b5030'
        }
    },
    {
        id: 'slate',
        label: 'Slate',
        desc: 'Chalkboard',
        special: 'slate',
        swatch: ['#2a3d32', '#344a3f', '#d4c896'],
        tokens: {
            '--bg-primary': '#1e2e26',
            '--bg-surface': '#243830',
            '--bg-card': '#344a3f',
            '--text-main': '#e8e4dc',
            '--text-muted': '#9aa898',
            '--accent': '#d4c896',
            '--border-color': '#3d5548',
            '--desktop-bg': '#2a3d32',
            '--chrome-bg': '#1e2e26'
        }
    },
    {
        id: 'library',
        label: 'Library',
        desc: 'Study desk',
        special: 'library',
        swatch: ['#3d2e1f', '#f4ecd8', '#3d6b4f'],
        tokens: {
            '--bg-primary': '#2a2018',
            '--bg-surface': '#3d2e1f',
            '--bg-card': '#f4ecd8',
            '--text-main': '#f0ece6',
            '--text-muted': '#b8a890',
            '--accent': '#3d6b4f',
            '--border-color': '#5c4a38',
            '--desktop-bg': '#3d2e1f',
            '--chrome-bg': '#4a2820'
        }
    },
    {
        id: 'parchment',
        label: 'Parchment',
        desc: 'Archive desk',
        special: 'parchment',
        swatch: ['#2a1f14', '#e8d5a8', '#9a4a3a'],
        tokens: {
            '--bg-primary': '#2a1f14',
            '--bg-surface': '#352818',
            '--bg-card': '#e8d5a8',
            '--text-main': '#f0ece6',
            '--text-muted': '#b8a080',
            '--accent': '#9a4a3a',
            '--border-color': '#5c4030',
            '--desktop-bg': '#2a1f14',
            '--chrome-bg': '#3d2817'
        }
    },
    {
        id: 'neon',
        label: 'Neon',
        desc: 'Soft synthwave',
        special: 'neon',
        swatch: ['#12101a', '#1a1628', '#5ec8d8'],
        tokens: {
            '--bg-primary': '#12101a',
            '--bg-surface': '#161422',
            '--bg-card': '#1a1628',
            '--text-main': '#d8e8f0',
            '--text-muted': '#8aa0b0',
            '--accent': '#5ec8d8',
            '--border-color': '#2a2840',
            '--desktop-bg': '#12101a',
            '--chrome-bg': '#0e0c16'
        }
    },
    {
        id: 'rose',
        label: 'Rose',
        desc: 'Soft blush',
        swatch: ['#f5ecec', '#ffffff', '#e11d48'],
        tokens: {
            '--bg-primary': '#faf5f5',
            '--bg-surface': '#ffffff',
            '--bg-card': '#ffffff',
            '--text-main': '#3d2a2a',
            '--text-muted': '#9a7070',
            '--accent': '#e11d48',
            '--border-color': '#f0d4d4',
            '--desktop-bg': '#f5ecec',
            '--chrome-bg': '#ffffff'
        }
    },
    {
        id: 'amber',
        label: 'Amber',
        desc: 'Honey gold',
        swatch: ['#1a1408', '#2e2410', '#f59e0b'],
        tokens: {
            '--bg-primary': '#1a1408',
            '--bg-surface': '#241c0c',
            '--bg-card': '#2e2410',
            '--text-main': '#f5e6c8',
            '--text-muted': '#c4a060',
            '--accent': '#f59e0b',
            '--border-color': '#4a3820',
            '--desktop-bg': '#1a1408',
            '--chrome-bg': '#241c0c'
        }
    },
    {
        id: 'arctic',
        label: 'Arctic',
        desc: 'Icy light',
        swatch: ['#e4f0f8', '#ffffff', '#0ea5e9'],
        tokens: {
            '--bg-primary': '#eef4f8',
            '--bg-surface': '#f8fbfd',
            '--bg-card': '#ffffff',
            '--text-main': '#1e3a4f',
            '--text-muted': '#6b8fa8',
            '--accent': '#0ea5e9',
            '--border-color': '#d0e4f0',
            '--desktop-bg': '#e4f0f8',
            '--chrome-bg': '#f8fbfd'
        }
    }
];

export function readAppTheme() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && APP_THEMES.some((t) => t.id === stored)) return stored;
    } catch {
        /* ignore */
    }
    return 'dark';
}

export function writeAppTheme(themeId) {
    try {
        localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
        /* ignore */
    }
}

export function getThemeById(themeId) {
    return APP_THEMES.find((t) => t.id === themeId) || APP_THEMES[0];
}

export function applyAppTheme(themeId, { silent = false } = {}) {
    const theme = getThemeById(themeId);
    const root = document.documentElement;

    TOKEN_KEYS.forEach((key) => {
        const value = theme.tokens[key];
        if (value) root.style.setProperty(key, value);
    });

    root.dataset.appTheme = theme.id;

    const desktop = theme.tokens['--desktop-bg'];
    const chrome = theme.tokens['--chrome-bg'];
    DesktopBackground.apply(desktop, { silent: true });
    ChromeBackground.apply(chrome, { silent: true });
    document.body.style.backgroundColor = desktop;

    if (!silent) writeAppTheme(theme.id);
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function swatchHtml(swatch) {
    const colors = Array.isArray(swatch) ? swatch : ['#121214', '#26262b', '#4f46e5'];
    return `<span class="app-theme-swatch" aria-hidden="true">${colors.map((c) => `<span class="app-theme-swatch-chip" style="background:${c}"></span>`).join('')}</span>`;
}

export function isAppThemeCustomized() {
    return readAppTheme() !== 'dark';
}

export function buildThemeOptionsHtml(selectedId, { compact = false } = {}) {
    return APP_THEMES.map((theme) => {
        const selected = theme.id === selectedId;
        if (compact) {
            return `<button type="button" class="app-theme-option app-theme-option--compact${selected ? ' is-selected' : ''}" data-theme="${theme.id}" role="menuitemradio" aria-checked="${selected}" title="${escapeHtml(theme.label)}" aria-label="${escapeHtml(theme.label)}">
                ${swatchHtml(theme.swatch)}
                ${selected ? '<span class="clock-style-check" aria-hidden="true">✓</span>' : ''}
            </button>`;
        }
        return `<button type="button" class="clock-style-option app-theme-option${selected ? ' is-selected' : ''}" data-theme="${theme.id}" role="menuitemradio" aria-checked="${selected}">
            ${swatchHtml(theme.swatch)}
            <span class="clock-style-meta">
                <span class="clock-style-label">${escapeHtml(theme.label)}</span>
                <span class="clock-style-desc">${escapeHtml(theme.desc)}</span>
            </span>
            ${selected ? '<span class="clock-style-check" aria-hidden="true">✓</span>' : ''}
        </button>`;
    }).join('');
}

export const AppTheme = {
    currentId: 'dark',

    init() {
        this.currentId = readAppTheme();
        applyAppTheme(this.currentId, { silent: true });
    },

    setTheme(themeId) {
        this.currentId = themeId;
        applyAppTheme(themeId);
        window.dispatchEvent(new CustomEvent('app:theme_changed', { detail: themeId }));
    }
};
